import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./wallet.db")
is_sqlite = DATABASE_URL.startswith("sqlite")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if is_sqlite else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


if is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")       # concurrent readers + writer
        cur.execute("PRAGMA foreign_keys=ON")        # enforce FK constraints
        cur.execute("PRAGMA busy_timeout=5000")      # wait on lock instead of failing
        cur.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
from datetime import datetime, timezone
from sqlalchemy import BigInteger, Column, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship
from .database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(32), unique=True, index=True, nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)          # bcrypt, never plaintext
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    accounts = relationship("Account", back_populates="owner", cascade="all, delete-orphan")


class Account(Base):
    """One balance per (user, currency). Balances are stored as INTEGER minor units
    (cents, satoshis, wei…) — never floats."""
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("user_id", "currency", name="uq_user_currency"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    currency = Column(String(10), nullable=False, index=True)
    balance_minor = Column(BigInteger, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    owner = relationship("User", back_populates="accounts")
    transactions = relationship("Transaction", back_populates="account", cascade="all, delete-orphan")


class Transaction(Base):
    """Append-only ledger. amount_minor is signed (+ credit / − debit)."""
    __tablename__ = "transactions"
    __table_args__ = (Index("ix_tx_user_created", "user_id", "created_at"),)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    tx_type = Column(String(20), nullable=False)   # deposit|withdraw|transfer_in|transfer_out|convert_in|convert_out
    currency = Column(String(10), nullable=False)
    amount_minor = Column(BigInteger, nullable=False)          # signed
    balance_after_minor = Column(BigInteger, nullable=False)   # account balance snapshot after this tx
    counterparty = Column(String(255), nullable=True)          # other user / other currency
    reference = Column(String(64), nullable=True)              # idempotency / withdrawal ref
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    account = relationship("Account", back_populates="transactions")


class Rate(Base):
    """Exchange rate: 1 unit of currency = to_usd USD. Pivot conversion via USD."""
    __tablename__ = "rates"
    currency = Column(String(10), primary_key=True)
    to_usd = Column(Float, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_utcnow)
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
if SECRET_KEY == "dev-secret-change-me":
    print("WARNING: using default SECRET_KEY — set SECRET_KEY in production", flush=True)

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "120"))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(subject: int, expires_minutes: int = ACCESS_TOKEN_EXPIRE_MINUTES) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(subject), "iat": now, "exp": now + timedelta(minutes=expires_minutes)}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


class RateLimiter:
    """Tiny in-memory sliding-window limiter (per key). Swap for Redis in multi-instance deploys."""
    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < self.window]
            if len(hits) >= self.limit:
                self._hits[key] = hits
                return False
            hits.append(now)
            self._hits[key] = hits
            return True
import re
from .currencies import CURRENCIES

_AMOUNT_RE = re.compile(r"^\d+(\.\d+)?$")


def get_currency(code: str):
    """Validate a currency code; raises ValueError if unsupported."""
    c = CURRENCIES.get(code.upper())
    if not c:
        raise ValueError(f"Unsupported currency: {code}")
    return code.upper(), c


def parse_amount(amount: str, currency: str) -> int:
    """Parse a decimal string into integer minor units. Raises ValueError on bad input."""
    code, meta = get_currency(currency)
    if not isinstance(amount, str) or not _AMOUNT_RE.match(amount):
        raise ValueError("Amount must be a positive decimal number")
    exp = meta["exponent"]
    if "." in amount:
        whole, frac = amount.split(".")
        if len(frac) > exp:
            raise ValueError(f"{code} supports at most {exp} decimal places")
        frac = frac.ljust(exp, "0")
    else:
        whole, frac = amount, "0" * exp
    return int(whole) * (10 ** exp) + int(frac)


def minor_to_major(minor: int, currency: str) -> str:
    code, meta = get_currency(currency)
    exp = meta["exponent"]
    return f"{minor / (10 ** exp):.{exp}f}" if exp <= 8 else f"{minor / (10 ** exp):.8f}"


def usd_value(minor: int, exponent: int, rate_to_usd: float) -> float:
    return minor / (10 ** exponent) * rate_to_usd
"""Currency metadata + seed rates (1 unit = X USD). Live refresh is best-effort (see rates.py)."""

# (name, symbol, exponent, to_usd). Symbol falls back to the code if not listed.
_F = {
    "USD": ("US Dollar", "$", 2, 1.0),          "EUR": ("Euro", "€", 2, 1.0842),
    "GBP": ("British Pound", "£", 2, 1.2725),   "JPY": ("Japanese Yen", "¥", 0, 0.00661),
    "CHF": ("Swiss Franc", "Fr", 2, 1.1283),    "CAD": ("Canadian Dollar", "$", 2, 0.7306),
    "AUD": ("Australian Dollar", "$", 2, 0.6477), "NZD": ("New Zealand Dollar", "$", 2, 0.5968),
    "CNY": ("Chinese Yuan", "¥", 2, 0.1391),    "HKD": ("Hong Kong Dollar", "$", 2, 0.1283),
    "SGD": ("Singapore Dollar", "$", 2, 0.7417), "INR": ("Indian Rupee", "₹", 2, 0.01191),
    "KRW": ("South Korean Won", "₩", 0, 0.000725), "BRL": ("Brazilian Real", "R$", 2, 0.1809),
    "MXN": ("Mexican Peso", "$", 2, 0.0551),    "SEK": ("Swedish Krona", "kr", 2, 0.0953),
    "NOK": ("Norwegian Krone", "kr", 2, 0.0922), "DKK": ("Danish Krone", "kr", 2, 0.1447),
    "PLN": ("Polish Zloty", "zł", 2, 0.2517),   "CZK": ("Czech Koruna", "Kč", 2, 0.0429),
    "HUF": ("Hungarian Forint", "Ft", 0, 0.00279), "RON": ("Romanian Leu", "lei", 2, 0.2179),
    "BGN": ("Bulgarian Lev", "лв", 2, 0.5522),  "TRY": ("Turkish Lira", "₺", 2, 0.0292),
    "ZAR": ("South African Rand", "R", 2, 0.0553), "THB": ("Thai Baht", "฿", 2, 0.0284),
    "RUB": ("Russian Ruble", "₽", 2, 0.0106),   "IDR": ("Indonesian Rupiah", "Rp", 0, 0.000062),
    "PHP": ("Philippine Peso", "₱", 2, 0.0170), "MYR": ("Malaysian Ringgit", "RM", 2, 0.2156),
    "VND": ("Vietnamese Dong", "₫", 0, 0.0000393), "NGN": ("Nigerian Naira", "₦", 2, 0.000634),
    "AED": ("UAE Dirham", "د.إ", 2, 0.2723),    "SAR": ("Saudi Riyal", "﷼", 2, 0.2666),
    "QAR": ("Qatari Riyal", "ر.ق", 2, 0.2747),  "KWD": ("Kuwaiti Dinar", "د.ك", 3, 3.2528),
    "BHD": ("Bahraini Dinar", "ب.د", 3, 2.6525), "OMR": ("Omani Rial", "ر.ع.", 3, 2.5979),
    "JOD": ("Jordanian Dinar", "د.أ", 3, 1.4094), "LBP": ("Lebanese Pound", "ل.ل", 0, 0.0000112),
    "ILS": ("Israeli Shekel", "₪", 2, 0.2701),  "EGP": ("Egyptian Pound", "£", 2, 0.0201),
    "MAD": ("Moroccan Dirham", "د.م.", 2, 0.1019), "TND": ("Tunisian Dinar", "د.ت", 3, 0.3199),
    "DZD": ("Algerian Dinar", "دج", 2, 0.00742), "LYD": ("Libyan Dinar", "ل.د", 3, 0.2093),
    "GHS": ("Ghanaian Cedi", "₵", 2, 0.0694),   "KES": ("Kenyan Shilling", "KSh", 2, 0.00775),
    "TZS": ("Tanzanian Shilling", "TSh", 0, 0.00036), "UGX": ("Ugandan Shilling", "USh", 0, 0.00027),
    "ETB": ("Ethiopian Birr", "Br", 2, 0.0173), "MWK": ("Malawian Kwacha", "MK", 2, 0.000577),
    "ZMW": ("Zambian Kwacha", "ZK", 2, 0.0368), "MZN": ("Mozambican Metical", "MT", 2, 0.0157),
    "AOA": ("Angolan Kwanza", "Kz", 2, 0.00107), "BWP": ("Botswana Pula", "P", 2, 0.0737),
    "NAD": ("Namibian Dollar", "$", 2, 0.0553), "SZL": ("Eswatini Lilangeni", "E", 2, 0.0553),
    "LSL": ("Lesotho Loti", "L", 2, 0.0553),    "MUR": ("Mauritian Rupee", "₨", 2, 0.0221),
    "SCR": ("Seychellois Rupee", "₨", 2, 0.0733), "MVR": ("Maldivian Rufiyaa", "Rf", 2, 0.0648),
    "PKR": ("Pakistani Rupee", "₨", 2, 0.00359), "BDT": ("Bangladeshi Taka", "৳", 2, 0.00844),
    "LKR": ("Sri Lankan Rupee", "₨", 2, 0.00332), "NPR": ("Nepalese Rupee", "₨", 2, 0.00746),
    "BTN": ("Bhutanese Ngultrum", "Nu.", 2, 0.01191), "AFN": ("Afghan Afghani", "؋", 2, 0.0139),
    "IRR": ("Iranian Rial", "﷼", 0, 0.0000238), "IQD": ("Iraqi Dinar", "ع.د", 3, 0.000763),
    "YER": ("Yemeni Rial", "﷼", 2, 0.00399),    "SYP": ("Syrian Pound", "£", 2, 0.000398),
    "MMK": ("Myanmar Kyat", "K", 0, 0.000477),  "KZT": ("Kazakhstani Tenge", "₸", 2, 0.00205),
    "UZS": ("Uzbekistani Som", "so'm", 0, 0.0000779), "AZN": ("Azerbaijani Manat", "₼", 2, 0.5882),
    "GEL": ("Georgian Lari", "₾", 2, 0.3636),   "AMD": ("Armenian Dram", "֏", 2, 0.00258),
    "BYN": ("Belarusian Ruble", "Br", 2, 0.3056), "MDL": ("Moldovan Leu", "L", 2, 0.0557),
    "MNT": ("Mongolian Tugrik", "₮", 0, 0.000294), "KHR": ("Cambodian Riel", "៛", 0, 0.000246),
    "LAK": ("Lao Kip", "₭", 0, 0.0000456),      "BND": ("Brunei Dollar", "$", 2, 0.7429),
    "FJD": ("Fijian Dollar", "$", 2, 0.4436),   "PGK": ("Papua New Guinean Kina", "K", 2, 0.2525),
    "SBD": ("Solomon Islands Dollar", "$", 2, 0.1178), "TOP": ("Tongan Paʻanga", "T$", 2, 0.4202),
    "VUV": ("Vanuatu Vatu", "Vt", 0, 0.00834),   "WST": ("Samoan Tala", "T", 2, 0.3568),
    "XCD": ("East Caribbean Dollar", "$", 2, 0.3704), "BBD": ("Barbadian Dollar", "$", 2, 0.50),
    "BSD": ("Bahamian Dollar", "$", 2, 1.0),     "BZD": ("Belize Dollar", "$", 2, 0.50),
    "HTG": ("Haitian Gourde", "G", 2, 0.00759), "JMD": ("Jamaican Dollar", "$", 2, 0.00637),
    "TTD": ("Trinidadian Dollar", "$", 2, 0.1475), "BMD": ("Bermudian Dollar", "$", 2, 1.0),
    "KYD": ("Cayman Islands Dollar", "$", 2, 1.20), "AWG": ("Aruban Florin", "ƒ", 2, 0.5556),
    "ANG": ("Netherlands Antillean Guilder", "ƒ", 2, 0.5548), "CUP": ("Cuban Peso", "$", 2, 0.0417),
    "DOP": ("Dominican Peso", "RD$", 2, 0.0166), "GTQ": ("Guatemalan Quetzal", "Q", 2, 0.1289),
    "HNL": ("Honduran Lempira", "L", 2, 0.0403), "NIO": ("Nicaraguan Córdoba", "C$", 2, 0.0272),
    "PAB": ("Panamanian Balboa", "B/.", 2, 1.0), "PYG": ("Paraguayan Guarani", "₲", 0, 0.000131),
    "UYU": ("Uruguayan Peso", "$", 2, 0.0237),  "VES": ("Venezuelan Bolívar", "Bs", 2, 0.0262),
    "ARS": ("Argentine Peso", "$", 2, 0.00098), "CLP": ("Chilean Peso", "$", 0, 0.00105),
    "COP": ("Colombian Peso", "$", 2, 0.000232), "PEN": ("Peruvian Sol", "S/", 2, 0.2625),
    "BOB": ("Bolivian Boliviano", "Bs", 2, 0.1449), "CRC": ("Costa Rican Colón", "₡", 2, 0.00194),
    "SVC": ("Salvadoran Colón", "₡", 2, 0.1143), "XOF": ("West African CFA Franc", "CFA", 0, 0.001652),
    "XAF": ("Central African CFA Franc", "FCFA", 0, 0.001652), "XPF": ("CFP Franc", "F", 0, 0.00909),
    "KMF": ("Comorian Franc", "CF", 0, 0.00220), "CVE": ("Cape Verdean Escudo", "$", 2, 0.00981),
    "STN": ("São Tomé Dobra", "Db", 2, 0.0442), "ERN": ("Eritrean Nakfa", "Nfk", 2, 0.0667),
    "DJF": ("Djiboutian Franc", "Fdj", 0, 0.00562), "GMD": ("Gambian Dalasi", "D", 2, 0.0147),
    "GNF": ("Guinean Franc", "FG", 0, 0.000116), "GYD": ("Guyanese Dollar", "$", 2, 0.00478),
    "MRU": ("Mauritanian Ouguiya", "UM", 2, 0.0252), "RSD": ("Serbian Dinar", "дин", 2, 0.00924),
    "ALL": ("Albanian Lek", "L", 2, 0.0108),    "BAM": ("Bosnian Mark", "KM", 2, 0.5522),
    "MKD": ("Macedonian Denar", "ден", 2, 0.0176), "SLE": ("Sierra Leonean Leone", "Le", 2, 0.0439),
    "SRD": ("Surinamese Dollar", "$", 2, 0.0289), "SHP": ("Saint Helena Pound", "£", 2, 1.2725),
    "FKP": ("Falkland Islands Pound", "£", 2, 1.2725), "GIP": ("Gibraltar Pound", "£", 2, 1.2725),
    "TWD": ("New Taiwan Dollar", "NT$", 2, 0.0307), "MOP": ("Macanese Pataca", "P", 2, 0.1241),
    "UAH": ("Ukrainian Hryvnia", "₴", 2, 0.0242), "ISK": ("Icelandic Króna", "kr", 0, 0.00729),
    "TMT": ("Turkmenistani Manat", "m", 2, 0.2857), "TJS": ("T

