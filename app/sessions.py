import uuid
import requests
from datetime import datetime, timezone

from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query

from app.database import get_db

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("")
def get_sessions(date_from: str = Query(None), date_to: str = Query(None)):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)

    query = "SELECT * FROM sessions WHERE 1=1"
    params = []

    if date_from:
        query += " AND created_at >= %s"
        params.append(date_from)
    if date_to:
        query += " AND created_at <= %s"
        params.append(date_to)

    query += " ORDER BY created_at DESC LIMIT 100"

    cur.execute(query, params)
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@router.get("/active")
def get_active_session():
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM sessions WHERE closed_at IS NULL LIMIT 1")
    active = cur.fetchone()
    if active:
        conn.close()
        return dict(active)

    sid = f"sess_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()
    cur.execute("INSERT INTO sessions (id, created_at) VALUES (%s, %s) RETURNING *", (sid, now))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@router.post("/close")
def close_session():
    """Закрытие сессии с отправкой чека в Telegram"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)

    cur.execute("SELECT * FROM sessions WHERE closed_at IS NULL LIMIT 1")
    active = cur.fetchone()
    if not active:
        conn.close()
        raise HTTPException(404, "Нет активной сессии")

    sid = active["id"]

    # Автозавершение турниров
    cur.execute("SELECT id FROM poker_tournaments WHERE session_id = %s AND status = 'active'", (sid,))
    for t in cur.fetchall():
        from app.poker import finish_tournament_impl
        finish_tournament_impl(conn, t["id"], None, auto_finish=True)

    # Сумма только для гостей
    cur.execute("""
        SELECT COALESCE(SUM(o.price), 0) as total
        FROM orders o JOIN guests g ON o.guest_id = g.id
        WHERE o.session_id = %s AND g.role = 'guest'
    """, (sid,))
    total = cur.fetchone()["total"]

    now = datetime.now(timezone.utc).isoformat()
    cur.execute("UPDATE sessions SET closed_at = %s, total_amount = %s WHERE id = %s", (now, total, sid))
    conn.commit()
    conn.close()

    # Отправка в Telegram (после закрытия сессии)
    telegram_result = None
    try:
        telegram_result = send_receipt_to_telegram(sid)
    except Exception as e:
        print(f"❌ Ошибка отправки в Telegram: {e}")
        telegram_result = {"error": str(e)}

    return {
        "ok": True,
        "session_id": sid,
        "total_amount": total,
        "telegram_sent": telegram_result is not None and "error" not in str(telegram_result),
    }


@router.delete("/{session_id}")
def delete_session(session_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM poker_participants WHERE tournament_id IN (SELECT id FROM poker_tournaments WHERE session_id = %s)", (session_id,))
    cur.execute("DELETE FROM poker_tournaments WHERE session_id = %s", (session_id,))
    cur.execute("DELETE FROM orders WHERE session_id = %s", (session_id,))
    cur.execute("DELETE FROM sessions WHERE id = %s", (session_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


def send_receipt_to_telegram(session_id: str):
    """Отправка чека в Telegram (PNG + текст)"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    # Проверяем настройки бота
    cur.execute("SELECT * FROM bot_settings WHERE id = 1 AND enabled = true")
    settings = cur.fetchone()
    
    if not settings:
        print("ℹ️ Бот не настроен или отключен")
        return {"status": "disabled"}
    
    bot_token = settings["bot_token"].strip() if settings["bot_token"] else ""
    chat_id = settings["chat_id"].strip() if settings["chat_id"] else ""
    
    if not bot_token or not chat_id:
        print("ℹ️ Не указан токен или chat_id")
        return {"status": "no_credentials"}
    
    print(f"📤 Генерирую чек: session={session_id[:8]}")
    
    # Данные сессии
    cur.execute("SELECT * FROM sessions WHERE id = %s", (session_id,))
    session = cur.fetchone()
    if not session:
        conn.close()
        return {"status": "no_session"}
    
    # Дата
    closed_at = session["closed_at"] or session["created_at"]
    if isinstance(closed_at, str):
        date_str = closed_at[:16].replace("T", " ")
    else:
        date_str = closed_at.isoformat()[:16].replace("T", " ")
    
    # Заказы гостей
    cur.execute("""
        SELECT o.*, g.name as guest_name, d.name as drink_name, d.id as drink_id
        FROM orders o 
        JOIN guests g ON o.guest_id = g.id 
        JOIN drinks d ON o.drink_id = d.id
        WHERE o.session_id = %s AND g.role = 'guest'
        ORDER BY o.guest_id, o.created_at
    """, (session_id,))
    orders = cur.fetchall()
    
    # Покерные результаты
    cur.execute("""
        SELECT pp.guest_id, pp.place, g.name as guest_name
        FROM poker_participants pp
        JOIN guests g ON pp.guest_id = g.id
        WHERE pp.tournament_id IN (
            SELECT id FROM poker_tournaments WHERE session_id = %s
        ) AND pp.place IS NOT NULL AND pp.place > 0
    """, (session_id,))
    poker_results = {r["guest_id"]: r["place"] for r in cur.fetchall()}
    conn.close()
    
    if not orders:
        print("ℹ️ Нет заказов для гостей")
        return {"status": "no_orders"}
    
    # Группируем по гостям
    guests = {}
    for o in orders:
        gid = o["guest_id"]
        gname = o["guest_name"]
        if gid not in guests:
            guests[gid] = {
                "name": gname,
                "total": 0,
                "poker_place": poker_results.get(gid),
                "items": []
            }
        
        drink_name = o["drink_name"]
        if o["drink_id"] == "d_poker_buyin":
            drink_name = "Покер Бай-ин"
        elif o["drink_id"] == "d_poker_prize":
            place = poker_results.get(gid)
            if place:
                drink_name = f"Покер — Победа {place} место"
            else:
                drink_name = "Покер Приз"
        
        # Ищем существующую позицию
        existing = next((item for item in guests[gid]["items"] if item["name"] == drink_name), None)
        if existing:
            existing["count"] += 1
            existing["total"] += o["price"]
        else:
            guests[gid]["items"].append({
                "name": drink_name,
                "count": 1,
                "price": o["price"],
                "total": o["price"]
            })
        
        guests[gid]["total"] += o["price"]
    
    grand_total = sum(g["total"] for g in guests.values())
    
    # Генерируем PNG
    from app.receipt_generator import generate_receipt_png
    
    receipt_data = {
        "session_id": session_id,
        "date": date_str,
        "guests": list(guests.values()),
        "grand_total": grand_total,
    }
    
    try:
        image_bytes = generate_receipt_png(receipt_data)
        print(f"📸 Чек сгенерирован: {len(image_bytes)} байт")
    except Exception as e:
        print(f"❌ Ошибка генерации изображения: {e}")
        return {"status": "generation_error", "error": str(e)}
    
    # Отправляем изображение
    caption = f"🧾 Чек за сессию {session_id[:8]}\n📅 {date_str}\n💸 Итого: {grand_total} ₽"
    
    url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
    files = {"photo": ("receipt.png", io.BytesIO(image_bytes), "image/png")}
    data = {"chat_id": chat_id, "caption": caption}
    
    try:
        response = requests.post(url, data=data, files=files, timeout=30)
        result = response.json()
        print(f"📨 Ответ Telegram: {result}")
        
        if not result.get("ok"):
            raise Exception(f"Telegram API error: {result.get('description', 'Unknown')}")
        
        print(f"✅ Чек отправлен в Telegram!")
        return {"status": "sent"}
    except Exception as e:
        print(f"❌ Ошибка отправки в Telegram: {e}")
        raise
