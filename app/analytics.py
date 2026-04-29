from psycopg.rows import dict_row
from fastapi import APIRouter, Query

from app.database import get_db

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("")
def get_analytics(date_from: str = Query(None), date_to: str = Query(None)):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)

    where_clause = "WHERE 1=1"
    params = []

    if date_from:
        where_clause += " AND o.created_at >= %s"
        params.append(date_from)
    if date_to:
        where_clause += " AND o.created_at <= %s"
        params.append(date_to)

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

    cur.execute(f"""
        SELECT d.name, d.category, d.price_type, COUNT(*) as cnt, SUM(o.price) as revenue
        FROM orders o JOIN drinks d ON o.drink_id = d.id
        {where_clause}
        GROUP BY d.id, d.name, d.category, d.price_type
        ORDER BY cnt DESC LIMIT 8
    """, params)
    top_drinks = [dict(r) for r in cur.fetchall()]

    cur.execute(f"""
        SELECT g.name, g.role, COUNT(*) as cnt, SUM(o.price) as total
        FROM orders o JOIN guests g ON o.guest_id = g.id
        {where_clause}
        GROUP BY g.id, g.name, g.role
        ORDER BY total DESC LIMIT 8
    """, params)
    top_guests = [dict(r) for r in cur.fetchall()]

    cur.execute(f"""
        SELECT DATE(o.created_at) as day, SUM(o.price) as total, COUNT(*) as orders
        FROM orders o {where_clause}
        GROUP BY DATE(o.created_at)
        ORDER BY day DESC LIMIT 30
    """, params)
    revenue_by_day = [dict(r) for r in cur.fetchall()]

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
