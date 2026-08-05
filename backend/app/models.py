from sqlalchemy import Column, Integer, String, Float, DateTime
from app.database import Base
from datetime import datetime


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)

    full_name = Column(String, nullable=False)

    email = Column(String, unique=True, nullable=False)

    password_hash = Column(String, nullable=False)

    preferred_currency = Column(String, default="USD")

    balance = Column(Float, default=0.0)


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True)

    user_id = Column(Integer, nullable=False)

    transaction_type = Column(String, nullable=False)

    amount = Column(Float, nullable=False)

    description = Column(String, nullable=False)

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )
