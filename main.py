import os
import uuid
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
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


class DrinkCreate(BaseModel):
    name: str
    price: int


class OrderCreate(BaseModel):
    session_id: str
    guest_id: str
    drink_id: str


# ===== ГОСТИ =====
@app.get("/api/guests")
def get_guests():
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM guests ORDER BY name")
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@app.post("/api/guests")
def create_guest(guest: GuestCreate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    gid = f"g_{uuid.uuid4().hex[:10]}"
    cur.execute("INSERT INTO guests (id, name) VALUES (%s, %s) RETURNING *", (gid, guest.name))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@app.delete("/api/guests/{guest_id}")
def delete_guest(guest_id: str):
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


# ===== НАПИТКИ =====
@app.get("/api/drinks")
def get_drinks():
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM drinks ORDER BY name")
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@app.post("/api/drinks")
def create_drink(drink: DrinkCreate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    did = f"d_{uuid.uuid4().hex[:10]}"
    cur.execute("INSERT INTO drinks (id, name, price) VALUES (%s, %s, %s) RETURNING *",
                (did, drink.name, drink.price))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@app.delete("/api/drinks/{drink_id}")
def delete_drink(drink_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM orders WHERE drink_id = %s", (drink_id,))
    if cur.fetchone()[0] > 0:
        conn.close()
        raise HTTPException(400, "Напиток есть в заказах")
    cur.execute("DELETE FROM drinks WHERE id = %s", (drink_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ===== СЕССИИ =====
@app.get("/api/sessions")
def get_sessions():
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM sessions ORDER BY created_at DESC LIMIT 50")
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@app.get("/api/sessions/active")
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


@app.post("/api/sessions/close")
def close_session():
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT id FROM sessions WHERE closed_at IS NULL LIMIT 1")
    active = cur.fetchone()
    if not active:
        conn.close()
        raise HTTPException(404, "Нет активной сессии")
    sid = active["id"]
    cur.execute("SELECT COALESCE(SUM(price), 0) FROM orders WHERE session_id = %s", (sid,))
    total = cur.fetchone()[0]
    now = datetime.now(timezone.utc).isoformat()
    cur.execute("UPDATE sessions SET closed_at = %s, total_amount = %s WHERE id = %s", (now, total, sid))
    conn.commit()
    conn.close()
    return {"ok": True, "session_id": sid, "total_amount": total}


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM orders WHERE session_id = %s", (session_id,))
    cur.execute("DELETE FROM sessions WHERE id = %s", (session_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ===== ЗАКАЗЫ =====
@app.get("/api/orders")
def get_orders(session_id: str = None):
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
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)

    cur.execute("SELECT * FROM sessions WHERE id = %s AND closed_at IS NULL", (order.session_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(400, "Сессия закрыта")

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
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM orders WHERE id = %s", (order_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ===== АНАЛИТИКА =====
@app.get("/api/analytics")
def get_analytics():
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)

    cur.execute("SELECT COUNT(*) as c FROM orders")
    total_orders = cur.fetchone()["c"]

    cur.execute("SELECT COALESCE(SUM(price), 0) as s FROM orders")
    total_revenue = cur.fetchone()["s"]

    cur.execute("SELECT COUNT(*) as c FROM sessions WHERE closed_at IS NOT NULL")
    sessions_count = cur.fetchone()["c"]

    cur.execute("SELECT COUNT(*) as c FROM guests")
    guests_count = cur.fetchone()["c"]

    cur.execute("""
        SELECT d.name, COUNT(*) as cnt, SUM(o.price) as revenue
        FROM orders o JOIN drinks d ON o.drink_id = d.id
        GROUP BY d.id, d.name ORDER BY cnt DESC LIMIT 8
    """)
    top_drinks = [dict(r) for r in cur.fetchall()]

    cur.execute("""
        SELECT g.name, COUNT(*) as cnt, SUM(o.price) as total
        FROM orders o JOIN guests g ON o.guest_id = g.id
        GROUP BY g.id, g.name ORDER BY total DESC LIMIT 8
    """)
    top_guests = [dict(r) for r in cur.fetchall()]

    conn.close()
    return {
        "total_orders": total_orders,
        "total_revenue": total_revenue,
        "sessions_count": sessions_count,
        "guests_count": guests_count,
        "top_drinks": top_drinks,
        "top_guests": top_guests,
    }


# ===== ЗДОРОВЬЕ =====
@app.get("/health")
def health():
    try:
        conn = get_db()
        conn.close()
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=500)


# ===== ФРОНТЕНД =====
@app.get("/", response_class=HTMLResponse)
def serve_frontend():
    paths = ["static/index.html", "index.html"]
    for path in paths:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
    return HTMLResponse("<h1>index.html не найден</h1>", status_code=404)


# ===== ЗАПУСК =====
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"🚀 Запуск на порту {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
