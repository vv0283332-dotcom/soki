from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.auth import get_current_user
from app.database import get_db
from app.models import User, Transaction


router = APIRouter(
    prefix="/wallet",
    tags=["Wallet"]
)


class AmountRequest(BaseModel):
    amount: float


class TransferRequest(BaseModel):
    receiver_email: str
    amount: float


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
    request: AmountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    current_user.balance += request.amount

    transaction = Transaction(
        user_id=current_user.id,
        transaction_type="deposit",
        amount=request.amount,
        description="Wallet deposit"
    )

    db.add(transaction)
    db.commit()
    db.refresh(current_user)

    return {
        "message": "Deposit successful",
        "balance": current_user.balance
    }


@router.post("/withdraw")
async def withdraw(
    request: AmountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    if current_user.balance < request.amount:
        raise HTTPException(
            status_code=400,
            detail="Insufficient balance"
        )

    current_user.balance -= request.amount

    transaction = Transaction(
        user_id=current_user.id,
        transaction_type="withdraw",
        amount=request.amount,
        description="Wallet withdrawal"
    )

    db.add(transaction)
    db.commit()

    return {
        "message": "Withdrawal successful",
        "balance": current_user.balance
    }


@router.post("/transfer")
async def transfer(
    request: TransferRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    receiver = db.query(User).filter(
        User.email == request.receiver_email
    ).first()

    if not receiver:
        raise HTTPException(
            status_code=404,
            detail="Receiver not found"
        )

    if current_user.balance < request.amount:
        raise HTTPException(
            status_code=400,
            detail="Insufficient balance"
        )

    current_user.balance -= request.amount
    receiver.balance += request.amount

    transaction = Transaction(
        user_id=current_user.id,
        transaction_type="transfer",
        amount=request.amount,
        description=f"Transfer to {receiver.email}"
    )

    db.add(transaction)
    db.commit()

    return {
        "message": "Transfer successful",
        "to": receiver.email,
        "amount": request.amount
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
