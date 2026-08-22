import io
import uuid
import requests
from datetime import datetime, timezone, timedelta

from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query

from app.database import get_db
from app.poker import finish_tournament_impl

from pydantic import BaseModel

class CloseSessionData(BaseModel):
    include_staff: bool = False

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
def close_session(data: CloseSessionData = CloseSessionData()):
    """Закрытие сессии с опцией включения сотрудников"""
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

    # Считаем сумму
    if data.include_staff:
        # Все заказы
        cur.execute("SELECT COALESCE(SUM(price), 0) as total FROM orders WHERE session_id = %s", (sid,))
    else:
        # Только гости
        cur.execute("""
            SELECT COALESCE(SUM(o.price), 0) as total
            FROM orders o JOIN guests g ON o.guest_id = g.id
            WHERE o.session_id = %s AND g.role = 'guest'
        """, (sid,))
    total = cur.fetchone()["total"]

    now = datetime.now(timezone.utc).isoformat()
    cur.execute(
    "UPDATE sessions SET closed_at = %s, total_amount = %s, include_staff = %s, is_paid = %s WHERE id = %s",
    (now, total, data.include_staff, False, sid))
    conn.commit()
    conn.close()

    # Отправка в Telegram (всегда, независимо от include_staff)
    try:
        send_receipt_to_telegram(sid, include_staff=data.include_staff)
    except Exception as e:
        print(f"Ошибка Telegram: {e}")

    return {"ok": True, "session_id": sid, "total_amount": total}


@router.post("/close-external")
def close_session_external(api_key: str = Query(...), include_staff: bool = False):
    """Закрытие сессии через внешний вызов (iOS команды)"""
    
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT api_key FROM bot_settings WHERE id = 1")
    settings = cur.fetchone()
    conn.close()
    
    if not settings or settings.get("api_key") != api_key:
        raise HTTPException(403, "Неверный API ключ")
    
    # Вызываем обычное закрытие сессии с параметром
    return close_session(CloseSessionData(include_staff=include_staff))


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


def send_receipt_to_telegram(session_id: str, include_staff: bool = False):
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
    
    # Дата с учётом часового пояса (Москва UTC+3)
    closed_at = session["closed_at"] or session["created_at"]
    if isinstance(closed_at, str):
        dt_obj = datetime.fromisoformat(closed_at.replace('Z', '+00:00'))
    else:
        dt_obj = closed_at
    
    moscow_time = dt_obj + timedelta(hours=3)
    date_str = moscow_time.strftime('%d.%m.%Y %H:%M')
    
    # Заказы (гости + сотрудники если include_staff)
    if include_staff:
        cur.execute("""
            SELECT o.*, g.name as guest_name, g.role, d.name as drink_name, d.id as drink_id
            FROM orders o 
            JOIN guests g ON o.guest_id = g.id 
            JOIN drinks d ON o.drink_id = d.id
            WHERE o.session_id = %s
            ORDER BY o.guest_id, o.created_at
        """, (session_id,))
    else:
        cur.execute("""
            SELECT o.*, g.name as guest_name, g.role, d.name as drink_name, d.id as drink_id
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
        return send_text_receipt(bot_token, chat_id, session_id, date_str, guests, grand_total)
    
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
        print(f"❌ Ошибка отправки изображения: {e}")
        return send_text_receipt(bot_token, chat_id, session_id, date_str, guests, grand_total)


def send_text_receipt(bot_token: str, chat_id: str, session_id: str, date_str: str, guests: dict, grand_total: int):
    """Отправка текстового чека (если не получилось отправить PNG)"""
    
    text = f"🧾 <b>ЧЕК ЗА СЕССИЮ</b>\n"
    text += f"📅 {date_str}\n"
    text += f"🔢 {session_id[:8]}\n"
    text += "─" * 20 + "\n\n"
    
    for guest in guests.values():
        name = guest["name"]
        total = guest["total"]
        place = guest.get("poker_place")
        
        poker_str = f"  🏆 {place} место в покере" if place else ""
        text += f"👤 <b>{name}</b>{poker_str}\n"
        
        for item in guest.get("items", []):
            text += f"  • {item['name']}: ×{item['count']} = {item['total']} ₽\n"
        
        emoji = "💵" if total > 0 else "🎁"
        text += f"  <i>Итого: {total} ₽ {emoji}</i>\n\n"
    
    text += "─" * 20 + "\n"
    if grand_total > 0:
        text += f"💸 <b>К ОПЛАТЕ: {grand_total} ₽</b>\n"
    else:
        text += f"🎉 <b>Заведение платит: {abs(grand_total)} ₽</b>\n"
    text += f"👥 Гостей: {len(guests)}\n"
    text += "\n🍸 Спасибо за вечер!"
    
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    response = requests.post(url, json={
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }, timeout=10)
    
    result = response.json()
    print(f"📨 Текстовый чек: {result}")
    return {"status": "text_sent" if result.get("ok") else "error"}


@router.put("/{session_id}/pay")
def mark_session_paid(session_id: str):
    """Отметить сессию как оплаченную"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE sessions SET is_paid = true WHERE id = %s", (session_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/check-unpaid")
def check_unpaid():
    """Проверить неоплаченные сессии и отправить напоминания"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    # Находим неоплаченные сессии старше 2 дней
    cur.execute("""
        SELECT * FROM sessions 
        WHERE closed_at IS NOT NULL 
        AND is_paid = false 
        AND closed_at <= NOW() - INTERVAL '2 days'
    """)
    unpaid = cur.fetchall()
    conn.close()
    
    sent = 0
    for session in unpaid:
        try:
            send_unpaid_reminder(session)
            # Обновляем время последнего напоминания
            conn2 = get_db()
            cur2 = conn2.cursor()
            cur2.execute("UPDATE sessions SET last_reminder_at = NOW() WHERE id = %s", (session["id"],))
            conn2.commit()
            conn2.close()
            sent += 1
        except Exception as e:
            print(f"Ошибка напоминания: {e}")
    
    return {"ok": True, "sent": sent}


def send_unpaid_reminder(session: dict):
    print(f"Отправляю напоминание для {session['id']}...")
    
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM bot_settings WHERE id = 1 AND enabled = true")
    settings = cur.fetchone()
    conn.close()
    
    if not settings:
        print("  Бот не настроен")
        return
    if not settings["bot_token"] or not settings["chat_id"]:
        print("  Нет токена или chat_id")
        return
    
    print(f"  Токен: {settings['bot_token'][:10]}..., chat_id: {settings['chat_id']}")
    # ... остальной код

@router.post("/check-unpaid")
def check_unpaid():
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("""
        SELECT * FROM sessions 
        WHERE closed_at IS NOT NULL 
        AND is_paid = false 
        AND closed_at <= NOW() - INTERVAL '2 days'
        AND (last_reminder_at IS NULL OR last_reminder_at <= NOW() - INTERVAL '2 days')
    """)
    unpaid = cur.fetchall()
    conn.close()
    
    print(f"Найдено неоплаченных: {len(unpaid)}")
    for s in unpaid:
        print(f"  - {s['id']}: {s['total_amount']} ₽, closed_at={s['closed_at']}")
    
    sent = 0
    for session in unpaid:
        try:
            send_unpaid_reminder(session)
            conn2 = get_db()
            cur2 = conn2.cursor()
            cur2.execute("UPDATE sessions SET last_reminder_at = NOW() WHERE id = %s", (session["id"],))
            conn2.commit()
            conn2.close()
            sent += 1
            print(f"    ✓ Отправлено для {session['id']}")
        except Exception as e:
            print(f"    ✗ Ошибка для {session['id']}: {e}")
    
    return {"ok": True, "sent": sent}
