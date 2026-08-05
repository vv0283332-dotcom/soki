from pydantic import BaseModel, EmailStr


class UserRegister(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    preferred_currency: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str
