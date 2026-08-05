from fastapi import FastAPI

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


app.include_router(auth_router)
app.include_router(wallet_router)


@app.get("/")
async def root():
    return {
        "message": "Welcome to Zelix Wallet API",
        "status": "online"
    }
