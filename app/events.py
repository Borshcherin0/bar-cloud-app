import uuid
import requests
from datetime import date
from datetime import datetime, timedelta
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.database import get_db

router = APIRouter(prefix="/api/events", tags=["events"])


class EventCreate(BaseModel):
    title: str
    description: str = ""
    event_date: str
    event_time: str = "20:00"
    image_url: str = ""
    location: str = "Monster Bar"
    notify_telegram: bool = False
    reminder: Optional[str] = None  # "2h", "1d", "3d"


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_date: Optional[str] = None
    event_time: Optional[str] = None
    image_url: Optional[str] = None
    location: Optional[str] = None
    notify_telegram: Optional[bool] = None


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
    location = data.location.strip() if data.location and data.location.strip() else "Monster Bar"
    
    cur.execute(
        "INSERT INTO events (id, title, description, event_date, event_time, image_url, location, notify_telegram, reminder) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (eid, data.title, data.description, data.event_date, data.event_time, data.image_url, location, data.notify_telegram, data.reminder))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    
    if data.notify_telegram:
        try:
            send_event_notification(result)
        except Exception as e:
            print(f"Ошибка уведомления: {e}")
    
    return result

def send_event_notification(event: dict):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM bot_settings WHERE id = 1 AND enabled = true")
    settings = cur.fetchone()
    conn.close()
    
    if not settings or not settings["bot_token"] or not settings["chat_id"]:
        return
    
    bot_token = settings["bot_token"]
    chat_id = settings["chat_id"]
    
    d = event["event_date"]
    date_str = d.strftime('%d.%m.%Y') if hasattr(d, 'strftime') else str(d)
    
    t = event["event_time"]
    time_str = t.strftime('%H:%M') if hasattr(t, 'strftime') else str(t)[:5]
    
    location = event.get("location") or "Monster Bar"
    
    text = (
        f"📅 <b>Новое событие!</b>\n\n"
        f"<b>{event['title']}</b>\n"
        f"{event['description'] or ''}\n\n"
        f"📆 {date_str} в {time_str}\n"
        f"📍 {location}"
    )
    
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    requests.post(url, json={
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }, timeout=10)

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


def send_reminder_notification(event: dict):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM bot_settings WHERE id = 1 AND enabled = true")
    settings = cur.fetchone()
    conn.close()
    
    if not settings or not settings["bot_token"] or not settings["chat_id"]:
        return
    
    bot_token = settings["bot_token"]
    chat_id = settings["chat_id"]
    
    d = event["event_date"]
    date_str = d.strftime('%d.%m.%Y') if hasattr(d, 'strftime') else str(d)
    t = event["event_time"]
    time_str = t.strftime('%H:%M') if hasattr(t, 'strftime') else str(t)[:5]
    location = event.get("location") or "Monster Bar"
    
    reminder = event["reminder"]
    if reminder == "2h": reminder_text = "через 2 часа"
    elif reminder == "1d": reminder_text = "завтра"
    elif reminder == "3d": reminder_text = "через 3 дня"
    else: reminder_text = "скоро"
    
    text = (
        f"⏰ <b>Напоминание!</b>\n\n"
        f"<b>{event['title']}</b> — {reminder_text}\n"
        f"{event['description'] or ''}\n\n"
        f"📆 {date_str} в {time_str}\n"
        f"📍 {location}"
    )
    
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    requests.post(url, json={
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }, timeout=10)


@router.post("/check-reminders")
def check_reminders():
    """Проверить и отправить напоминания (вызывается периодически)"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    now = datetime.now()
    
    cur.execute("""
        SELECT * FROM events 
        WHERE reminder IS NOT NULL 
        AND reminder_sent = false 
        AND event_date >= CURRENT_DATE
    """)
    events = cur.fetchall()
    conn.close()
    
    sent = 0
    for event in events:
        event_dt = datetime.combine(event["event_date"], event["event_time"])
        reminder = event["reminder"]
        
        # Вычисляем когда отправлять
        if reminder == "2h":
            remind_at = event_dt - timedelta(hours=2)
        elif reminder == "1d":
            remind_at = event_dt - timedelta(days=1)
        elif reminder == "3d":
            remind_at = event_dt - timedelta(days=3)
        else:
            continue
        
        # Если пора отправлять
        if now >= remind_at:
            try:
                send_reminder_notification(event)
                # Отмечаем как отправленное
                conn = get_db()
                cur = conn.cursor()
                cur.execute("UPDATE events SET reminder_sent = true WHERE id = %s", (event["id"],))
                conn.commit()
                conn.close()
                sent += 1
            except Exception as e:
                print(f"Ошибка напоминания: {e}")
    
    return {"ok": True, "sent": sent}


