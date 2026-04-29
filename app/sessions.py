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
    """Отправка чека в Telegram"""
    # Проверяем настройки бота
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
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
    
    print(f"📤 Отправляю чек в Telegram: chat_id={chat_id}, session={session_id[:8]}")
    
    # Получаем данные сессии
    cur.execute("SELECT * FROM sessions WHERE id = %s", (session_id,))
    session = cur.fetchone()
    
    if not session:
        conn.close()
        return {"status": "no_session"}
    
    # Получаем заказы гостей
    cur.execute("""
        SELECT o.*, g.name as guest_name, g.role, d.name as drink_name
        FROM orders o 
        JOIN guests g ON o.guest_id = g.id 
        JOIN drinks d ON o.drink_id = d.id
        WHERE o.session_id = %s AND g.role = 'guest'
        ORDER BY o.created_at
    """, (session_id,))
    orders = cur.fetchall()
    
    # Проверяем покерные результаты
    cur.execute("""
        SELECT pp.*, g.name as guest_name
        FROM poker_participants pp
        JOIN guests g ON pp.guest_id = g.id
        WHERE pp.tournament_id IN (
            SELECT id FROM poker_tournaments WHERE session_id = %s
        ) AND pp.place IS NOT NULL AND pp.place > 0
        ORDER BY pp.place
    """, (session_id,))
    poker_results = cur.fetchall()
    conn.close()
    
    if not orders:
        print("ℹ️ Нет заказов для гостей")
        return {"status": "no_orders"}
    
    # Формируем текст
    # ИСПРАВЛЕНО: работаем с datetime как с объектом, а не как со словарём
    closed_at = session["closed_at"]
    created_at = session["created_at"]
    
    # Преобразуем в строку
    if closed_at:
        if isinstance(closed_at, str):
            date_str = closed_at[:16].replace("T", " ")
        else:
            date_str = closed_at.isoformat()[:16].replace("T", " ")
    else:
        if isinstance(created_at, str):
            date_str = created_at[:16].replace("T", " ")
        else:
            date_str = created_at.isoformat()[:16].replace("T", " ")
    
    total = int(session.get("total_amount", 0) or 0)
    
    text = f"🧾 <b>ЧЕК ЗА СЕССИЮ</b>\n"
    text += f"📅 {date_str}\n"
    text += f"🔢 {session_id[:8]}\n"
    text += "─" * 20 + "\n\n"
    
    # Группируем по гостям
    guests_orders = {}
    for o in orders:
        gname = o["guest_name"]
        if gname not in guests_orders:
            guests_orders[gname] = []
        guests_orders[gname].append(o)
    
    for gname, gorders in guests_orders.items():
        # Проверяем покерное место
        poker_place = ""
        for pr in poker_results:
            if pr["guest_name"] == gname:
                poker_place = f"  🏆 {pr['place']} место в покере"
                break
        
        text += f"👤 <b>{gname}</b>{poker_place}\n"
        guest_total = 0
        for o in gorders:
            drink_name = o["drink_name"]
            if o["drink_id"] == "d_poker_buyin":
                drink_name = "♠️ Покер Бай-ин"
            elif o["drink_id"] == "d_poker_prize":
                drink_name = "♠️ Покер Приз"
            
            price = int(o["price"])
            text += f"  • {drink_name}: {price} ₽\n"
            guest_total += price
        
        emoji = "💵" if guest_total > 0 else "🎁"
        text += f"  <i>Итого: {guest_total} ₽ {emoji}</i>\n\n"
    
    text += "─" * 20 + "\n"
    
    if total > 0:
        text += f"💸 <b>К ОПЛАТЕ: {total} ₽</b>\n"
    else:
        text += f"🎉 <b>Заведение платит: {abs(total)} ₽</b>\n"
    
    text += f"👥 Гостей: {len(guests_orders)}\n"
    text += "\n🍸 Спасибо за вечер! Приходите ещё!"
    
    # Отправляем
    print(f"📤 Отправляю сообщение длиной {len(text)} символов")
    
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    response = requests.post(url, json={
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }, timeout=10)
    
    result = response.json()
    print(f"📨 Ответ Telegram: {result}")
    
    if not result.get("ok"):
        raise Exception(f"Telegram API error: {result.get('description', 'Unknown')}")
    
    print(f"✅ Чек отправлен в Telegram!")
    return {"status": "sent", "message_id": result.get("result", {}).get("message_id")}
