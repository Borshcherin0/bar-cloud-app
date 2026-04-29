import os
import uuid
import json
from datetime import datetime, timezone
from typing import Optional

import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Барный учёт API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL не задан!")


def get_db():
    return psycopg.connect(DATABASE_URL)


# ===== МОДЕЛИ =====
class GuestCreate(BaseModel):
    name: str
    role: str = "guest"  # guest или staff


class GuestUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None


class DrinkCreate(BaseModel):
    name: str
    price: int  # Может быть отрицательным для скидок
    category: str = "alco"
    sort_order: int = 0
    price_type: str = "regular"  # regular, discount, refund, compliment


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
    prizes: list[dict]  # [{"place": 1, "amount": 5000}, ...]
    participants: list[str]  # guest_ids


class PokerFinishData(BaseModel):
    results: list[dict]  # [{"guest_id": "...", "place": 1}, ...]


# ===== ГОСТИ (С РОЛЯМИ) =====
@app.get("/api/guests")
def get_guests(role: str = Query(None)):
    """Получение гостей. role: guest, staff, или все (без параметра)"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    query = "SELECT * FROM guests WHERE 1=1"
    params = []
    
    if role:
        query += " AND role = %s"
        params.append(role)
    
    query += " ORDER BY role DESC, name"
    
    cur.execute(query, params)
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@app.post("/api/guests")
def create_guest(guest: GuestCreate):
    """Создание гостя или сотрудника"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    gid = f"g_{uuid.uuid4().hex[:10]}"
    cur.execute(
        "INSERT INTO guests (id, name, role) VALUES (%s, %s, %s) RETURNING *",
        (gid, guest.name, guest.role))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@app.put("/api/guests/{guest_id}")
def update_guest(guest_id: str, guest: GuestUpdate):
    """Обновление гостя (имя, роль)"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM guests WHERE id = %s", (guest_id,))
    existing = cur.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Гость не найден")
    
    updates = []
    params = []
    
    if guest.name is not None:
        updates.append("name = %s")
        params.append(guest.name)
    if guest.role is not None:
        updates.append("role = %s")
        params.append(guest.role)
    
    if updates:
        params.append(guest_id)
        cur.execute(f"UPDATE guests SET {', '.join(updates)} WHERE id = %s RETURNING *", params)
        result = dict(cur.fetchone())
        conn.commit()
    else:
        result = dict(existing)
    
    conn.close()
    return result


@app.delete("/api/guests/{guest_id}")
def delete_guest(guest_id: str):
    """Удаление гостя"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM orders WHERE guest_id = %s", (guest_id,))
    if cur.fetchone()[0] > 0:
        conn.close()
        raise HTTPException(400, "Гость есть в заказах")
    cur.execute("DELETE FROM guests WHERE id = %s", (guest_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ===== НАПИТКИ (С ПОДДЕРЖКОЙ ОТРИЦАТЕЛЬНЫХ ЦЕН) =====
@app.get("/api/drinks")
def get_drinks(search: str = Query(None), category: str = Query(None)):
    """Получение напитков с фильтрацией, поиском и поддержкой отрицательных цен"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    query = "SELECT * FROM drinks WHERE 1=1"
    params = []
    
    if search:
        query += " AND LOWER(name) LIKE %s"
        params.append(f"%{search.lower()}%")
    
    if category:
        if category == 'negative':
            query += " AND price < 0"
        elif category == 'positive':
            query += " AND price >= 0"
        else:
            query += " AND category = %s"
            params.append(category)
    
    query += " ORDER BY price_type, category, sort_order, name"
    
    cur.execute(query, params)
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@app.get("/api/drinks/categories")
def get_categories():
    """Возвращает список категорий с количеством обычных и скидочных позиций"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("""
        SELECT 
            category, 
            COUNT(*) as count,
            SUM(CASE WHEN price >= 0 THEN 1 ELSE 0 END) as positive_count,
            SUM(CASE WHEN price < 0 THEN 1 ELSE 0 END) as negative_count
        FROM drinks 
        GROUP BY category 
        ORDER BY category
    """)
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@app.post("/api/drinks")
def create_drink(drink: DrinkCreate):
    """Создание напитка (цена может быть отрицательной для скидок)"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    did = f"d_{uuid.uuid4().hex[:10]}"
    
    # Автоопределение типа цены если не указан явно
    price_type = drink.price_type
    if price_type == "regular" and drink.price < 0:
        price_type = "discount"
    
    cur.execute(
        "INSERT INTO drinks (id, name, price, category, sort_order, price_type) VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
        (did, drink.name, drink.price, drink.category, drink.sort_order, price_type)
    )
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@app.put("/api/drinks/{drink_id}")
def update_drink(drink_id: str, drink: DrinkUpdate):
    """Обновление напитка с возможностью изменения типа цены"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    # Проверяем существование
    cur.execute("SELECT * FROM drinks WHERE id = %s", (drink_id,))
    existing = cur.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Напиток не найден")
    
    # Собираем поля для обновления
    updates = []
    params = []
    
    if drink.name is not None:
        updates.append("name = %s")
        params.append(drink.name)
    
    if drink.price is not None:
        updates.append("price = %s")
        params.append(drink.price)
        # Автоопределение типа при отрицательной цене
        if drink.price < 0 and drink.price_type is None and existing["price_type"] == "regular":
            updates.append("price_type = %s")
            params.append("discount")
        elif drink.price >= 0 and drink.price_type is None and existing["price_type"] != "regular":
            updates.append("price_type = %s")
            params.append("regular")
    
    if drink.category is not None:
        updates.append("category = %s")
        params.append(drink.category)
    
    if drink.sort_order is not None:
        updates.append("sort_order = %s")
        params.append(drink.sort_order)
    
    if drink.price_type is not None:
        updates.append("price_type = %s")
        params.append(drink.price_type)
    
    if updates:
        params.append(drink_id)
        cur.execute(f"UPDATE drinks SET {', '.join(updates)} WHERE id = %s RETURNING *", params)
        result = dict(cur.fetchone())
        conn.commit()
    else:
        result = dict(existing)
    
    conn.close()
    return result


@app.put("/api/drinks/reorder")
def reorder_drinks(items: list[dict]):
    """Изменение порядка напитков [{id: ..., sort_order: ...}, ...]"""
    conn = get_db()
    cur = conn.cursor()
    
    for item in items:
        cur.execute(
            "UPDATE drinks SET sort_order = %s WHERE id = %s",
            (item["sort_order"], item["id"])
        )
    
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/drinks/{drink_id}")
def delete_drink(drink_id: str):
    """Удаление напитка"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM orders WHERE drink_id = %s", (drink_id,))
    if cur.fetchone()[0] > 0:
        conn.close()
        raise HTTPException(400, "Напиток есть в заказах. Удалите сначала заказы с этим напитком.")
    cur.execute("DELETE FROM drinks WHERE id = %s", (drink_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ===== СЕССИИ (С ФИЛЬТРАМИ ПО ДАТАМ) =====
@app.get("/api/sessions")
def get_sessions(
    date_from: str = Query(None),
    date_to: str = Query(None)
):
    """Получение сессий с возможностью фильтрации по датам"""
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


@app.get("/api/sessions/active")
def get_active_session():
    """Получение активной (незакрытой) сессии или создание новой"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM sessions WHERE closed_at IS NULL LIMIT 1")
    active = cur.fetchone()
    if active:
        conn.close()
        return dict(active)
    
    # Создаём новую сессию
    sid = f"sess_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()
    cur.execute("INSERT INTO sessions (id, created_at) VALUES (%s, %s) RETURNING *", (sid, now))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@app.post("/api/sessions/close")
def close_session():
    """Закрытие активной сессии с подсчётом общей суммы (только для гостей)"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM sessions WHERE closed_at IS NULL LIMIT 1")
    active = cur.fetchone()
    if not active:
        conn.close()
        raise HTTPException(404, "Нет активной сессии")
    
    sid = active["id"]
    
    # Автоматически завершаем все активные турниры
    cur.execute("SELECT id FROM poker_tournaments WHERE session_id = %s AND status = 'active'", (sid,))
    active_tournaments = cur.fetchall()
    
    for tournament in active_tournaments:
        finish_tournament_impl(conn, tournament["id"], None, auto_finish=True)
    
    # Считаем сумму ТОЛЬКО для гостей (не сотрудников)
    cur.execute("""
        SELECT COALESCE(SUM(o.price), 0) as total 
        FROM orders o 
        JOIN guests g ON o.guest_id = g.id 
        WHERE o.session_id = %s AND g.role = 'guest'
    """, (sid,))
    total = cur.fetchone()["total"]
    
    now = datetime.now(timezone.utc).isoformat()
    cur.execute(
        "UPDATE sessions SET closed_at = %s, total_amount = %s WHERE id = %s",
        (now, total, sid)
    )
    conn.commit()
    conn.close()
    
    return {"ok": True, "session_id": sid, "total_amount": total}


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    """Удаление сессии и всех связанных данных"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM poker_participants WHERE tournament_id IN (SELECT id FROM poker_tournaments WHERE session_id = %s)", (session_id,))
    cur.execute("DELETE FROM poker_tournaments WHERE session_id = %s", (session_id,))
    cur.execute("DELETE FROM orders WHERE session_id = %s", (session_id,))
    cur.execute("DELETE FROM sessions WHERE id = %s", (session_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ===== ЗАКАЗЫ =====
@app.get("/api/orders")
def get_orders(session_id: str = None):
    """Получение заказов (всех или по сессии)"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    if session_id:
        cur.execute("SELECT * FROM orders WHERE session_id = %s ORDER BY created_at DESC", (session_id,))
    else:
        cur.execute("SELECT * FROM orders ORDER BY created_at DESC LIMIT 500")
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@app.post("/api/orders")
def create_order(order: OrderCreate):
    """Создание заказа (поддерживает отрицательные цены для скидок)"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)

    # Проверяем сессию
    cur.execute("SELECT * FROM sessions WHERE id = %s AND closed_at IS NULL", (order.session_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(400, "Сессия закрыта или не найдена")

    # Получаем напиток (цена может быть отрицательной)
    cur.execute("SELECT * FROM drinks WHERE id = %s", (order.drink_id,))
    drink = cur.fetchone()
    if not drink:
        conn.close()
        raise HTTPException(404, "Напиток не найден")

    oid = f"o_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()
    cur.execute(
        "INSERT INTO orders (id, session_id, guest_id, drink_id, price, created_at) VALUES (%s,%s,%s,%s,%s,%s) RETURNING *",
        (oid, order.session_id, order.guest_id, order.drink_id, drink["price"], now))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@app.delete("/api/orders/{order_id}")
def delete_order(order_id: str):
    """Удаление заказа"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM orders WHERE id = %s", (order_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ===== СЧЁТ (РАЗДЕЛЬНЫЙ ДЛЯ ГОСТЕЙ И СОТРУДНИКОВ) =====
@app.get("/api/bill/total")
def get_bill_total(session_id: str = Query(None)):
    """Получение сумм счёта раздельно для гостей и сотрудников"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    if not session_id:
        cur.execute("SELECT id FROM sessions WHERE closed_at IS NULL LIMIT 1")
        active = cur.fetchone()
        if not active:
            conn.close()
            raise HTTPException(404, "Нет активной сессии")
        session_id = active["id"]
    
    # Сумма для гостей
    cur.execute("""
        SELECT COALESCE(SUM(o.price), 0) as guest_total
        FROM orders o
        JOIN guests g ON o.guest_id = g.id
        WHERE o.session_id = %s AND g.role = 'guest'
    """, (session_id,))
    guest_total = cur.fetchone()["guest_total"]
    
    # Сумма для сотрудников (информационно)
    cur.execute("""
        SELECT COALESCE(SUM(o.price), 0) as staff_total
        FROM orders o
        JOIN guests g ON o.guest_id = g.id
        WHERE o.session_id = %s AND g.role = 'staff'
    """, (session_id,))
    staff_total = cur.fetchone()["staff_total"]
    
    # Общая сумма
    cur.execute("SELECT COALESCE(SUM(price), 0) as total FROM orders WHERE session_id = %s", (session_id,))
    total = cur.fetchone()["total"]
    
    conn.close()
    return {
        "guest_total": guest_total,
        "staff_total": staff_total,
        "total": total,
        "session_id": session_id,
    }


# ===== ПОКЕРНЫЕ ТУРНИРЫ =====
@app.get("/api/poker/tournaments")
def get_tournaments(session_id: str = None):
    """Получение турниров (всех или по сессии) с участниками"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    if session_id:
        cur.execute("SELECT * FROM poker_tournaments WHERE session_id = %s ORDER BY created_at DESC", (session_id,))
    else:
        cur.execute("SELECT * FROM poker_tournaments ORDER BY created_at DESC LIMIT 50")
    
    tournaments = [dict(r) for r in cur.fetchall()]
    
    # Добавляем участников к каждому турниру
    for t in tournaments:
        cur.execute("""
            SELECT p.*, g.name as guest_name, g.role as guest_role
            FROM poker_participants p
            JOIN guests g ON p.guest_id = g.id
            WHERE p.tournament_id = %s
            ORDER BY p.place NULLS LAST, p.created_at
        """, (t["id"],))
        t["participants"] = [dict(r) for r in cur.fetchall()]
        
        # Парсим prizes из JSON
        if isinstance(t.get("prizes"), str):
            t["prizes"] = json.loads(t["prizes"])
    
    conn.close()
    return tournaments


@app.post("/api/poker/tournaments")
def create_tournament(data: PokerTournamentCreate):
    """Создание покерного турнира с добавлением бай-инов в счёт"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    # Проверяем сессию
    cur.execute("SELECT * FROM sessions WHERE id = %s AND closed_at IS NULL", (data.session_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(400, "Сессия закрыта")
    
    # Проверяем что нет активного турнира в этой сессии
    cur.execute("SELECT COUNT(*) as cnt FROM poker_tournaments WHERE session_id = %s AND status = 'active'", (data.session_id,))
    if cur.fetchone()["cnt"] > 0:
        conn.close()
        raise HTTPException(400, "В этой сессии уже есть активный турнир")
    
    # Создаём турнир
    tid = f"poker_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()
    
    cur.execute(
        "INSERT INTO poker_tournaments (id, session_id, buy_in, prize_places, prizes, status, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (tid, data.session_id, data.buy_in, data.prize_places, json.dumps(data.prizes), 'active', now))
    tournament = dict(cur.fetchone())
    
    # Добавляем участников и бай-ины в счёт
    for guest_id in data.participants:
        pid = f"pp_{uuid.uuid4().hex[:10]}"
        cur.execute(
            "INSERT INTO poker_participants (id, tournament_id, guest_id, created_at) VALUES (%s,%s,%s,%s)",
            (pid, tid, guest_id, now))
        
        # Добавляем бай-ин в заказы
        oid = f"o_{uuid.uuid4().hex[:10]}"
        cur.execute(
            "INSERT INTO orders (id, session_id, guest_id, drink_id, price, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
            (oid, data.session_id, guest_id, 'd_poker_buyin', data.buy_in, now))
    
    conn.commit()
    conn.close()
    
    return {"ok": True, "tournament_id": tid}


@app.post("/api/poker/tournaments/{tournament_id}/finish")
def finish_tournament(tournament_id: str, data: Optional[PokerFinishData] = None):
    """Завершение покерного турнира с распределением призовых"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    # Проверяем турнир
    cur.execute("SELECT * FROM poker_tournaments WHERE id = %s", (tournament_id,))
    tournament = cur.fetchone()
    if not tournament:
        conn.close()
        raise HTTPException(404, "Турнир не найден")
    
    if tournament["status"] != "active":
        conn.close()
        raise HTTPException(400, "Турнир уже завершён")
    
    finish_tournament_impl(conn, tournament_id, data)
    
    conn.commit()
    conn.close()
    
    return {"ok": True}


def finish_tournament_impl(conn, tournament_id: str, data: Optional[PokerFinishData], auto_finish: bool = False):
    """Внутренняя функция завершения турнира"""
    cur = conn.cursor(row_factory=dict_row)
    
    # Получаем турнир
    cur.execute("SELECT * FROM poker_tournaments WHERE id = %s", (tournament_id,))
    tournament = cur.fetchone()
    
    if isinstance(tournament.get("prizes"), str):
        prizes = json.loads(tournament["prizes"])
    else:
        prizes = tournament["prizes"]
    
    now = datetime.now(timezone.utc).isoformat()
    
    if data and data.results:
        # Распределяем места
        for result in data.results:
            cur.execute(
                "UPDATE poker_participants SET place = %s WHERE tournament_id = %s AND guest_id = %s",
                (result["place"], tournament_id, result["guest_id"]))
            
            # Находим приз для этого места
            prize = next((p for p in prizes if p["place"] == result["place"]), None)
            if prize and prize["amount"] > 0:
                # Добавляем призовые в счёт (отрицательная сумма = вычет из счёта)
                oid = f"o_{uuid.uuid4().hex[:10]}"
                cur.execute(
                    "INSERT INTO orders (id, session_id, guest_id, drink_id, price, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
                    (oid, tournament["session_id"], result["guest_id"], 'd_poker_prize', -prize["amount"], now))
    elif auto_finish:
        # При авто-завершении (закрытие сессии) просто отмечаем всех без мест
        cur.execute(
            "UPDATE poker_participants SET place = 0 WHERE tournament_id = %s AND place IS NULL",
            (tournament_id,))
    
    # Закрываем турнир
    cur.execute(
        "UPDATE poker_tournaments SET status = 'finished', finished_at = %s WHERE id = %s",
        (now, tournament_id))
    
    return True


@app.delete("/api/poker/tournaments/{tournament_id}")
def delete_tournament(tournament_id: str):
    """Удаление турнира и всех связанных данных"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM poker_participants WHERE tournament_id = %s", (tournament_id,))
    cur.execute("DELETE FROM poker_tournaments WHERE id = %s", (tournament_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ===== АНАЛИТИКА (С ФИЛЬТРАМИ ПО ДАТАМ) =====
@app.get("/api/analytics")
def get_analytics(
    date_from: str = Query(None),
    date_to: str = Query(None)
):
    """Получение аналитики с возможностью фильтрации по датам"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    # Строим WHERE для фильтрации
    where_clause = "WHERE 1=1"
    params = []
    
    if date_from:
        where_clause += " AND o.created_at >= %s"
        params.append(date_from)
    if date_to:
        where_clause += " AND o.created_at <= %s"
        params.append(date_to)
    
    # Общая статистика
    if date_from or date_to:
        cur.execute(f"SELECT COUNT(*) as c FROM orders o {where_clause}", params)
        total_orders = cur.fetchone()["c"]
        
        cur.execute(f"SELECT COALESCE(SUM(o.price), 0) as s FROM orders o {where_clause}", params)
        total_revenue = cur.fetchone()["s"]
    else:
        cur.execute("SELECT COUNT(*) as c FROM orders")
        total_orders = cur.fetchone()["c"]
        
        cur.execute("SELECT COALESCE(SUM(price), 0) as s FROM orders")
        total_revenue = cur.fetchone()["s"]
    
    # Сессии в выбранном периоде
    session_where = "WHERE closed_at IS NOT NULL"
    session_params = []
    if date_from:
        session_where += " AND created_at >= %s"
        session_params.append(date_from)
    if date_to:
        session_where += " AND created_at <= %s"
        session_params.append(date_to)
    
    cur.execute(f"SELECT COUNT(*) as c FROM sessions {session_where}", session_params)
    sessions_count = cur.fetchone()["c"]
    
    cur.execute("SELECT COUNT(*) as c FROM guests")
    guests_count = cur.fetchone()["c"]
    
    # Топ напитков
    cur.execute(f"""
        SELECT d.name, d.category, d.price_type, COUNT(*) as cnt, SUM(o.price) as revenue
        FROM orders o JOIN drinks d ON o.drink_id = d.id
        {where_clause}
        GROUP BY d.id, d.name, d.category, d.price_type
        ORDER BY cnt DESC LIMIT 8
    """, params)
    top_drinks = [dict(r) for r in cur.fetchall()]
    
    # Топ гостей
    cur.execute(f"""
        SELECT g.name, g.role, COUNT(*) as cnt, SUM(o.price) as total
        FROM orders o JOIN guests g ON o.guest_id = g.id
        {where_clause}
        GROUP BY g.id, g.name, g.role
        ORDER BY total DESC LIMIT 8
    """, params)
    top_guests = [dict(r) for r in cur.fetchall()]
    
    # Выручка по дням
    cur.execute(f"""
        SELECT DATE(o.created_at) as day, SUM(o.price) as total, COUNT(*) as orders
        FROM orders o
        {where_clause}
        GROUP BY DATE(o.created_at)
        ORDER BY day DESC LIMIT 30
    """, params)
    revenue_by_day = [dict(r) for r in cur.fetchall()]
    
    # Статистика по покеру
    cur.execute("SELECT COUNT(*) as total_tournaments FROM poker_tournaments")
    poker_stats = dict(cur.fetchone())
    
    cur.execute("SELECT COALESCE(SUM(buy_in), 0) as total_buyins FROM poker_tournaments")
    poker_stats.update(dict(cur.fetchone()))
    
    cur.execute("SELECT COUNT(*) as total_participants FROM poker_participants")
    poker_stats.update(dict(cur.fetchone()))
    
    conn.close()
    return {
        "total_orders": total_orders,
        "total_revenue": total_revenue,
        "sessions_count": sessions_count,
        "guests_count": guests_count,
        "top_drinks": top_drinks,
        "top_guests": top_guests,
        "revenue_by_day": revenue_by_day,
        "poker_stats": poker_stats,
    }


# ===== ЗДОРОВЬЕ =====
@app.get("/health")
def health():
    """Проверка работоспособности сервера и подключения к БД"""
    try:
        conn = get_db()
        conn.close()
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=500)


# ===== СТАТИКА И ФРОНТЕНД =====
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static", html=False), name="static")


@app.get("/", response_class=HTMLResponse)
def serve_frontend():
    """Отдача главной страницы"""
    paths = ["index.html", "static/index.html"]
    for path in paths:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
    return HTMLResponse("<h1>index.html не найден</h1>", status_code=404)


# ===== ЗАПУСК =====
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"🚀 Барный учёт запущен на порту {port}")
    print(f"📂 Файлы в корне: {os.listdir('.')}")
    if os.path.exists("static"):
        print(f"📂 static/: {os.listdir('static')}")
        if os.path.exists("static/js"):
            print(f"📂 static/js/: {os.listdir('static/js')}")
    uvicorn.run(app, host="0.0.0.0", port=port)
