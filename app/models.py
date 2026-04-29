from typing import Optional
from pydantic import BaseModel


class GuestCreate(BaseModel):
    name: str
    role: str = "guest"


class GuestUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None


class DrinkCreate(BaseModel):
    name: str
    price: int
    category: str = "alco"
    sort_order: int = 0
    price_type: str = "regular"


class DrinkUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[int] = None
    category: Optional[str] = None
    sort_order: Optional[int] = None
    price_type: Optional[str] = None


class OrderCreate(BaseModel):
    session_id: str
    guest_id: str
    drink_id: str


class PokerTournamentCreate(BaseModel):
    session_id: str
    buy_in: int
    prize_places: int
    prizes: list[dict]
    participants: list[str]


class PokerFinishData(BaseModel):
    results: list[dict]
