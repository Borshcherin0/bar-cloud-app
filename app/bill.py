from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query

from app.database import get_db

router = APIRouter(prefix="/api/bill", tags=["bill"])


@router.get("/total")
def get_bill_total(session_id: str = Query(None)):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)

    if not session_id:
        cur.execute("SELECT id FROM sessions WHERE closed_at IS NULL LIMIT 1")
        active = cur.fetchone()
        if not active:
            conn.close()
            raise HTTPException(404, "Нет активной сессии")
        session_id = active["id"]

    cur.execute("""
        SELECT COALESCE(SUM(o.price), 0) as guest_total
        FROM orders o JOIN guests g ON o.guest_id = g.id
        WHERE o.session_id = %s AND g.role = 'guest'
    """, (session_id,))
    guest_total = cur.fetchone()["guest_total"]

    cur.execute("""
        SELECT COALESCE(SUM(o.price), 0) as staff_total
        FROM orders o JOIN guests g ON o.guest_id = g.id
        WHERE o.session_id = %s AND g.role = 'staff'
    """, (session_id,))
    staff_total = cur.fetchone()["staff_total"]

    cur.execute("SELECT COALESCE(SUM(price), 0) as total FROM orders WHERE session_id = %s", (session_id,))
    total = cur.fetchone()["total"]

    conn.close()
    return {"guest_total": guest_total, "staff_total": staff_total, "total": total, "session_id": session_id}
