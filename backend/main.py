from fastapi import FastAPI

app = FastAPI(
    title="Wallet API",
    version="1.0.0"
)

@app.get("/")
def home():
    return {
        "message": "Welcome to the Digital Wallet API",
        "status": "running"
    }
