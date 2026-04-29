import uuid
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query

from app.database import get_db
from app.models import DrinkCreate, DrinkUpdate

router = APIRouter(prefix="/api/drinks", tags=["drinks"])


@router.get("")
def get_drinks(search: str = Query(None), category: str = Query(None)):
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


@router.get("/categories")
def get_categories():
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("""
        SELECT category, COUNT(*) as count,
            SUM(CASE WHEN price >= 0 THEN 1 ELSE 0 END) as positive_count,
            SUM(CASE WHEN price < 0 THEN 1 ELSE 0 END) as negative_count
        FROM drinks GROUP BY category ORDER BY category
    """)
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@router.post("")
def create_drink(drink: DrinkCreate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    did = f"d_{uuid.uuid4().hex[:10]}"

    price_type = drink.price_type
    if price_type == "regular" and drink.price < 0:
        price_type = "discount"

    cur.execute(
        "INSERT INTO drinks (id, name, price, category, sort_order, price_type) VALUES (%s,%s,%s,%s,%s,%s) RETURNING *",
        (did, drink.name, drink.price, drink.category, drink.sort_order, price_type))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@router.put("/{drink_id}")
def update_drink(drink_id: str, drink: DrinkUpdate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)

    cur.execute("SELECT * FROM drinks WHERE id = %s", (drink_id,))
    existing = cur.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Напиток не найден")

    updates = []
    params = []

    if drink.name is not None:
        updates.append("name = %s")
        params.append(drink.name)
    if drink.price is not None:
        updates.append("price = %s")
        params.append(drink.price)
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


@router.put("/reorder")
def reorder_drinks(items: list[dict]):
    conn = get_db()
    cur = conn.cursor()
    for item in items:
        cur.execute("UPDATE drinks SET sort_order = %s WHERE id = %s", (item["sort_order"], item["id"]))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/{drink_id}")
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
