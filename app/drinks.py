import os
import uuid
from typing import Optional

from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.database import get_db
from app.models import DrinkCreate, DrinkUpdate

router = APIRouter(prefix="/api/drinks", tags=["drinks"])

CATALOG_IMAGE_DEFAULTS = {
    ("d_b03c770471", "/static/img/drinks/cappu.jpg"): "/static/img/drinks/coffee-knives.jpg",
    ("d_785014f106", "/static/img/drinks/cappu.jpg"): "/static/img/drinks/banana-latte.jpg",
    ("d_74fa2ded69", "/static/img/drinks/cappu.jpg"): "/static/img/drinks/orange-raf.jpg",
    ("d_872a6a735f", "/static/img/drinks/mojito.jpg"): "/static/img/drinks/monster-zero.jpg",
    ("d_4d49d3380c", "/static/img/drinks/whiskeyco.jpg"): "/static/img/drinks/honey-cola.jpg",
    ("d_2323b1ecc3", ""): "/static/img/drinks/corona-extra.jpg",
    ("d_4f61b0b1c5", ""): "/static/img/drinks/honey-whiskey.jpg",
    ("d_9d0b6f686c", ""): "/static/img/drinks/guinness.jpg",
    ("d_0eb15b15b5", ""): "/static/img/drinks/absinthe.jpg",
    ("d_e7b6a3f841", ""): "/static/img/drinks/baltika.jpg",
    ("d_c112902e89", ""): "/static/img/drinks/bloody-mary.jpg",
    ("d_80ee86c097", "/static/img/drinks/aperol.jpg"): "/static/img/drinks/aperol-straw.jpg",
    ("d_73d830dba9", "/static/img/drinks/whiskeyco.jpg"): "/static/img/drinks/whiskeyco-straw.jpg",
    ("d_5f956c2bb5", "/static/img/drinks/laguna.jpg"): "/static/img/drinks/laguna-straw.jpg",
    ("d_d646503015", "/static/img/drinks/cubalibre.jpg"): "/static/img/drinks/cubalibre-straw.jpg",
    ("d_ae2908fe42", "/static/img/drinks/pinaco.jpg"): "/static/img/drinks/pinaco-straw.jpg",
    ("d_8fb41d0f60", "/static/img/drinks/sex.jpg"): "/static/img/drinks/sex-straw.jpg",
}


class ReorderItem(BaseModel):
    id: str
    sort_order: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


@router.get("")
def get_drinks(search: str = Query(None), category: str = Query(None), menu_only: bool = Query(False)):
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
    if menu_only:
        query += " AND show_in_menu = true AND price > 0"
    query += " ORDER BY category, sort_order, name"
    cur.execute(query, params)
    drinks = [dict(r) for r in cur.fetchall()]

    for drink in drinks:
        image_url = (drink.get("image_url") or "").strip()
        if image_url == "/static/img/drinks/":
            image_url = ""
        default_image = CATALOG_IMAGE_DEFAULTS.get((drink["id"], image_url))
        if default_image:
            drink["image_url"] = default_image

    # Добавляем ингредиенты
    try:
        for drink in drinks:
            cur.execute("""
                SELECT i.name FROM drink_ingredients di
                JOIN ingredients i ON di.ingredient_id = i.id
                WHERE di.drink_id = %s ORDER BY i.name
            """, (drink["id"],))
            drink["ingredients"] = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        print(f"Ошибка загрузки ингредиентов: {e}")
        for drink in drinks:
            drink["ingredients"] = []
    
    conn.close()
    return drinks


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


@router.put("/reorder")
def reorder_drinks(data: ReorderRequest):
    conn = get_db()
    cur = conn.cursor()
    for item in data.items:
        cur.execute("UPDATE drinks SET sort_order = %s WHERE id = %s", (item.sort_order, item.id))
    conn.commit()
    conn.close()
    return {"ok": True}


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
    if drink.show_in_menu is not None:
        updates.append("show_in_menu = %s")
        params.append(drink.show_in_menu)
    if drink.image_url is not None:
        updates.append("image_url = %s")
        params.append(drink.image_url)
    if updates:
        params.append(drink_id)
        cur.execute(f"UPDATE drinks SET {', '.join(updates)} WHERE id = %s RETURNING *", params)
        result = dict(cur.fetchone())
        conn.commit()
    else:
        result = dict(existing)
    conn.close()
    return result


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
