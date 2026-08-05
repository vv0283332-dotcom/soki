from sqlalchemy import Column, Integer, String, Float
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    full_name = Column(String, nullable=False)

    email = Column(
        String,
        unique=True,
        index=True,
        nullable=False
    )

    password_hash = Column(
        String,
        nullable=False
    )

    preferred_currency = Column(
        String,
        nullable=False
    )

    balance = Column(
        Float,
        default=0.0
    )
from sqlalchemy import DateTime
from datetime import datetime


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, nullable=False)

    transaction_type = Column(String, nullable=False)

    amount = Column(Float, nullable=False)

    description = Column(String, nullable=False)

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )
