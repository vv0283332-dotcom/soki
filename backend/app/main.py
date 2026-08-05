from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
import app.models

from app.routes.auth import router as auth_router
from app.routes.wallet import router as wallet_router


Base.metadata.create_all(bind=engine)


app = FastAPI(
    title="Zelix Wallet API",
    description="Multi-currency Digital Wallet API",
    version="1.0.0"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://zelix-wallet.onrender.com",
        "http://localhost:5500"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router)
app.include_router(wallet_router)


@app.get("/")
async def root():
    return {
        "message": "Welcome to Zelix Wallet API",
        "status": "online"
    }
