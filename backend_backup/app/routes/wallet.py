from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.auth import get_current_user
from app.database import get_db
from app.models import User, Transaction


router = APIRouter(
    prefix="/wallet",
    tags=["Wallet"]
)


class DepositRequest(BaseModel):
    amount: float
class WithdrawRequest(BaseModel):
    amount: float


@router.post("/withdraw")
async def withdraw(
    withdraw: WithdrawRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    if current_user.balance < withdraw.amount:
        return {
            "message": "Insufficient balance"
        }

    current_user.balance -= withdraw.amount

    db.commit()
    db.refresh(current_user)

    return {
        "message": "Withdrawal successful",
        "balance": current_user.balance,
        "currency": current_user.preferred_currency
    }

@router.get("/balance")
async def get_balance(
    current_user: User = Depends(get_current_user)
):
    return {
        "user": current_user.email,
        "balance": current_user.balance,
        "currency": current_user.preferred_currency
    }


@router.post("/deposit")
async def deposit(
    deposit: DepositRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    current_user.balance += deposit.amount

    db.commit()
    db.refresh(current_user)

    return {
        "message": "Deposit successful",
        "balance": current_user.balance,
        "currency": current_user.preferred_currency
    }
class TransferRequest(BaseModel):
    receiver_email: str
    amount: float


@router.post("/transfer")
async def transfer(
    transfer: TransferRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    if current_user.balance < transfer.amount:
        return {
            "message": "Insufficient balance"
        }

    receiver = db.query(User).filter(
        User.email == transfer.receiver_email
    ).first()

    if not receiver:
        return {
            "message": "Receiver not found"
        }

    current_user.balance -= transfer.amount
    receiver.balance += transfer.amount

    db.commit()

    return {
        "message": "Transfer successful",
        "from": current_user.email,
        "to": receiver.email,
        "amount": transfer.amount
    }
@router.get("/transactions")
async def get_transactions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    transactions = db.query(Transaction).filter(
        Transaction.user_id == current_user.id
    ).all()

    return transactions
