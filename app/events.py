import uuid
import requests
from datetime import datetime, timezone, timedelta
from typing import Optional

from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

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
    reminder: Optional[str] = None


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_date: Optional[str] = None
    event_time: Optional[str] = None
    image_url: Optional[str] = None
    location: Optional[str] = None
    notify_telegram: Optional[bool] = None
    reminder: Optional[str] = None

@router.get("")
def get_events(month: str = Query(None)):
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
    description = event.get("description") or ""
    
    text = (
        f"📅 <b>Новое событие!</b>\n\n"
        f"<b>{event['title']}</b>\n"
        f"{description}\n\n"
        f"📆 {date_str} в {time_str}\n"
        f"📍 {location}"
    )
    
    # 1. Текст события
    requests.post(
        f"https://api.telegram.org/bot{bot_token}/sendMessage",
        json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
        timeout=10
    )
    
    # 2. Опрос
    requests.post(
        f"https://api.telegram.org/bot{bot_token}/sendPoll",
        json={
            "chat_id": chat_id,
            "question": "Участвуешь?",
            "options": ["✅ Да", "❌ Нет", "🤔 Думаю"],
            "is_anonymous": False,
            "allows_multiple_answers": False
        },
        timeout=10
    )

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
    for field in ['title', 'description', 'event_date', 'event_time', 'image_url', 'location', 'notify_telegram', 'reminder']:
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


@router.get("/check-reminders")
def pending_event_reminders():
    return check_reminders()


@router.post("/check-reminders")
def check_reminders(ids: Optional[list[str]] = None):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    offsets = {"2h": timedelta(hours=2), "1d": timedelta(days=1), "3d": timedelta(days=3)}
    with get_db() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""
            SELECT e.* FROM events e
            WHERE e.reminder IS NOT NULL AND e.reminder_sent = false
            AND e.event_date >= CURRENT_DATE
            AND EXISTS (
                SELECT 1 FROM bot_settings WHERE id = 1 AND enabled = true
                AND bot_token <> '' AND chat_id <> ''
            )
        """ + (" AND e.id = ANY(%s) ORDER BY e.id FOR UPDATE OF e SKIP LOCKED"
               if ids is not None else ""), (ids,) if ids is not None else ())
        due = []
        for event in cur.fetchall():
            offset = offsets.get(event["reminder"])
            if offset is None:
                continue
            event_at = datetime.strptime(
                f"{event['event_date']} {str(event['event_time'])[:5]}", "%Y-%m-%d %H:%M"
            )
            if now >= event_at - timedelta(hours=3) - offset:
                due.append(event)
        if ids is None:
            return {"ids": [event["id"] for event in due]}

        sent = failed = 0
        for event in due:
            if send_reminder_notification(event):
                cur.execute("UPDATE events SET reminder_sent = true WHERE id = %s", (event["id"],))
                sent += 1
            else:
                failed += 1
        return {"ok": True, "sent": sent, "failed": failed}


@router.get("/ical")
def get_ical():
    """Экспорт событий в iCal для iOS"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM events WHERE event_date >= CURRENT_DATE ORDER BY event_date")
    events = cur.fetchall()
    conn.close()
    
    ical = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Monster Bar//RU\r\n"
    
    for event in events:
        d = event["event_date"]
        date_str = d.strftime('%Y%m%d') if hasattr(d, 'strftime') else str(d).replace('-', '')
        
        t = event["event_time"]
        time_str = t.strftime('%H%M%S') if hasattr(t, 'strftime') else str(t).replace(':', '') + '00'
        
        location = (event.get("location") or "Monster Bar").replace(',', '\\,')
        description = (event.get("description") or "").replace('\n', '\\n').replace(',', '\\,')
        
        ical += "BEGIN:VEVENT\r\n"
        ical += f"DTSTART:{date_str}T{time_str}\r\n"
        ical += f"SUMMARY:{event['title']}\r\n"
        ical += f"DESCRIPTION:{description}\r\n"
        ical += f"LOCATION:{location}\r\n"
        ical += "END:VEVENT\r\n"
    
    ical += "END:VCALENDAR\r\n"
    
    return Response(
        content=ical,
        media_type="text/calendar",
        headers={"Content-Disposition": "attachment; filename=monster-bar-events.ics"}
    )

def send_reminder_notification(event: dict):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM bot_settings WHERE id = 1 AND enabled = true")
    settings = cur.fetchone()
    conn.close()
    
    if not settings or not settings["bot_token"] or not settings["chat_id"]:
        return False
    
    bot_token = settings["bot_token"]
    chat_id = settings["chat_id"]
    
    d = event["event_date"]
    date_str = d.strftime('%d.%m.%Y') if hasattr(d, 'strftime') else str(d)
    t = event["event_time"]
    time_str = t.strftime('%H:%M') if hasattr(t, 'strftime') else str(t)[:5]
    location = event.get("location") or "Monster Bar"
    
    # Вычисляем разницу во времени
    event_date = str(d)
    event_dt = datetime.strptime(f"{event_date} {time_str}", "%Y-%m-%d %H:%M")
    now = datetime.now()
    diff = event_dt - now
    
    # Формируем читаемую строку
    total_hours = diff.total_seconds() / 3600
    if total_hours < 1:
        time_left = "меньше часа"
    elif total_hours < 24:
        h = int(total_hours)
        time_left = f"{h} ч"
    else:
        d = int(total_hours // 24)
        h = int(total_hours % 24)
        if h == 0:
            time_left = f"{d} дн"
        else:
            time_left = f"{d} дн {h} ч"
    
    text = (
        f"⏰ <b>Напоминание!</b>\n\n"
        f"<b>{event['title']}</b>\n"
        f"{event['description'] or ''}\n\n"
        f"📆 {date_str} в {time_str}\n"
        f"📍 {location}\n\n"
        f"⏳ До события: {time_left}"
    )
    
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        response = requests.post(url, json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML"
        }, timeout=10)
        return response.ok and response.json().get("ok", False)
    except (requests.RequestException, ValueError):
        return False
