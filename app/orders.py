import uuid
from datetime import datetime, timezone

from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException

from app.database import get_db
from app.models import OrderCreate

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.get("")
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


@router.post("")
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


@router.delete("/{order_id}")
def delete_order(order_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM orders WHERE id = %s", (order_id,))
    conn.commit()
    conn.close()
    return {"ok": True}
