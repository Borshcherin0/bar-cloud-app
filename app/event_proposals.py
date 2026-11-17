import uuid
from datetime import date, time, datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from psycopg.rows import dict_row

from app.database import get_db

router = APIRouter(prefix="/api/event-proposals", tags=["event-proposals"])


def init_proposals():
    with get_db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS event_proposals (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, original_text TEXT NOT NULL,
            description TEXT NOT NULL, event_date DATE NOT NULL, event_time TIME NOT NULL,
            location TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(), event_id TEXT
        )""")


class Proposal(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    original_text: str = Field(min_length=1, max_length=4000)
    description: str = Field(min_length=1, max_length=5000)
    event_date: date
    event_time: time
    location: str = Field(min_length=1, max_length=300)


@router.post("")
def propose(data: Proposal):
    if not all(value.strip() for value in (data.title, data.original_text, data.description, data.location)):
        raise HTTPException(422, "Заполни все поля")
    if data.event_date < datetime.now(timezone(timedelta(hours=3))).date():
        raise HTTPException(422, "Выбери дату в будущем")
    proposal_id = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute("""INSERT INTO event_proposals
            (id,title,original_text,description,event_date,event_time,location)
            VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (proposal_id, data.title.strip(), data.original_text.strip(), data.description.strip(),
             data.event_date, data.event_time, data.location.strip()))
    return {"id": proposal_id, "status": "pending"}


@router.get("")
def list_proposals():
    with get_db() as conn:
        return conn.execute("SELECT * FROM event_proposals WHERE status = 'pending' ORDER BY created_at",
                            row_factory=dict_row).fetchall()


@router.post("/{proposal_id}/{decision}")
def moderate(proposal_id: str, decision: str):
    if decision not in ("approve", "reject"):
        raise HTTPException(422, "Неизвестное действие")
    with get_db() as conn:
        proposal = conn.execute("SELECT * FROM event_proposals WHERE id = %s FOR UPDATE",
                                (proposal_id,), row_factory=dict_row).fetchone()
        if not proposal:
            raise HTTPException(404, "Предложение не найдено")
        if proposal["status"] != "pending":
            return {"status": proposal["status"], "event_id": proposal["event_id"]}
        event_id = None
        if decision == "approve":
            event_id = f"evt_{uuid.uuid4().hex[:10]}"
            conn.execute("""INSERT INTO events
                (id,title,description,event_date,event_time,location,image_url,notify_telegram)
                VALUES (%s,%s,%s,%s,%s,%s,'',false)""",
                (event_id, proposal["title"], proposal["description"], proposal["event_date"],
                 proposal["event_time"], proposal["location"]))
        status = "approved" if decision == "approve" else "rejected"
        conn.execute("UPDATE event_proposals SET status = %s, event_id = %s WHERE id = %s",
                     (status, event_id, proposal_id))
    return {"status": status, "event_id": event_id}
