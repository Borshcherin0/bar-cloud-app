import uuid
from datetime import datetime, timezone

from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query

from app.database import get_db
from app.poker import finish_tournament_impl

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

    # Отправка в Telegram
    try:
        send_receipt_to_telegram(sid)
    except Exception as e:
        print(f"Ошибка отправки в Telegram: {e}")

    return {"ok": True, "session_id": sid, "total_amount": total}


def send_receipt_to_telegram(session_id: str):
    """Отправка чека в Telegram при закрытии сессии"""
    import base64
    import requests
    import io
    
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM bot_settings WHERE id = 1 AND enabled = true")
    settings = cur.fetchone()
    conn.close()
    
    if not settings or not settings["bot_token"] or not settings["chat_id"]:
        print("Бот не настроен, пропускаем отправку")
        return
    
    # Генерируем чек через внутренний вызов
    # Примечание: чек генерируется на фронтенде (canvas), 
    # поэтому здесь мы отправляем только текстовое уведомление
    
    # Получаем данные сессии
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM sessions WHERE id = %s", (session_id,))
    session = cur.fetchone()
    
    cur.execute("""
        SELECT o.*, g.name as guest_name, g.role, d.name as drink_name
        FROM orders o 
        JOIN guests g ON o.guest_id = g.id 
        JOIN drinks d ON o.drink_id = d.id
        WHERE o.session_id = %s AND g.role = 'guest'
        ORDER BY o.created_at
    """, (session_id,))
    orders = cur.fetchall()
    conn.close()
    
    if not orders:
        return
    
    # Формируем текстовый чек
    date_str = session["created_at"][:16].replace("T", " ")
    total = session["total_amount"]
    
    text = f"🧾 <b>ЧЕК ЗА СЕССИЮ</b>\n"
    text += f"📅 {date_str}\n"
    text += f"🔢 Сессия: {session_id[:8]}\n"
    text += "─" * 20 + "\n\n"
    
    # Группируем по гостям
    guests_orders = {}
    for o in orders:
        gname = o["guest_name"]
        if gname not in guests_orders:
            guests_orders[gname] = []
        guests_orders[gname].append(o)
    
    for gname, gorders in guests_orders.items():
        text += f"👤 <b>{gname}</b>\n"
        guest_total = 0
        for o in gorders:
            drink_name = o["drink_name"]
            if o["drink_id"] == "d_poker_buyin":
                drink_name = "♠️ Покер Бай-ин"
            elif o["drink_id"] == "d_poker_prize":
                drink_name = "♠️ Покер Приз"
            
            text += f"  • {drink_name}: {o['price']} ₽\n"
            guest_total += o["price"]
        text += f"  <i>Итого: {guest_total} ₽</i>\n\n"
    
    text += "─" * 20 + "\n"
    text += f"💸 <b>ОБЩИЙ ИТОГ: {total} ₽</b>\n"
    text += f"👥 Гостей: {len(guests_orders)}\n"
    text += "\n🍸 Спасибо за вечер!"
    
    # Отправляем
    url = f"https://api.telegram.org/bot{settings['bot_token']}/sendMessage"
    requests.post(url, json={
        "chat_id": settings["chat_id"],
        "text": text,
        "parse_mode": "HTML"
    }, timeout=10)


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
