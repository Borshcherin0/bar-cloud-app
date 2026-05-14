import uuid
from datetime import date
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.database import get_db

router = APIRouter(prefix="/api/events", tags=["events"])


class EventCreate(BaseModel):
    title: str
    description: str = ""
    event_date: str  # YYYY-MM-DD
    event_time: str = "20:00"
    image_url: str = ""


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_date: Optional[str] = None
    event_time: Optional[str] = None
    image_url: Optional[str] = None


@router.get("")
def get_events(month: str = Query(None)):
    """Получить события (все или за месяц YYYY-MM)"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    if month:
        cur.execute(
            "SELECT * FROM events WHERE TO_CHAR(event_date, 'YYYY-MM') = %s ORDER BY event_date",
            (month,))
    else:
        cur.execute("SELECT * FROM events WHERE event_date >= CURRENT_DATE ORDER BY event_date LIMIT 20")
    
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@router.post("")
def create_event(data: EventCreate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    eid = f"evt_{uuid.uuid4().hex[:10]}"
    cur.execute(
        "INSERT INTO events (id, title, description, event_date, event_time, image_url) VALUES (%s,%s,%s,%s,%s,%s) RETURNING *",
        (eid, data.title, data.description, data.event_date, data.event_time, data.image_url))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@router.put("/{event_id}")
def update_event(event_id: str, data: EventUpdate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM events WHERE id = %s", (event_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(404, "Событие не найдено")
    
    updates = []
    params = []
    for field in ['title', 'description', 'event_date', 'event_time', 'image_url']:
        val = getattr(data, field, None)
        if val is not None:
            updates.append(f"{field} = %s")
            params.append(val)
    
    if updates:
        params.append(event_id)
        cur.execute(f"UPDATE events SET {', '.join(updates)} WHERE id = %s RETURNING *", params)
        result = dict(cur.fetchone())
        conn.commit()
    else:
        cur.execute("SELECT * FROM events WHERE id = %s", (event_id,))
        result = dict(cur.fetchone())
    
    conn.close()
    return result


@router.delete("/{event_id}")
def delete_event(event_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM events WHERE id = %s", (event_id,))
    conn.commit()
    conn.close()
    return {"ok": True}
