import uuid
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.database import get_db

router = APIRouter(prefix="/api/ingredients", tags=["ingredients"])


class IngredientCreate(BaseModel):
    name: str
    volume: float
    cost: float
    unit: str = "ml"


class IngredientUpdate(BaseModel):
    name: Optional[str] = None
    volume: Optional[float] = None
    cost: Optional[float] = None
    unit: Optional[str] = None


class DrinkIngredientCreate(BaseModel):
    drink_id: str
    ingredient_id: str
    volume: float


@router.get("")
def get_ingredients():
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM ingredients ORDER BY name")
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@router.post("")
def create_ingredient(data: IngredientCreate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    iid = f"ing_{uuid.uuid4().hex[:10]}"
    cur.execute(
        "INSERT INTO ingredients (id, name, volume, cost, unit) VALUES (%s,%s,%s,%s,%s) RETURNING *",
        (iid, data.name, data.volume, data.cost, data.unit))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@router.put("/{ingredient_id}")
def update_ingredient(ingredient_id: str, data: IngredientUpdate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM ingredients WHERE id = %s", (ingredient_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(404, "Ингредиент не найден")
    
    updates = []
    params = []
    for field in ['name', 'volume', 'cost', 'unit']:
        val = getattr(data, field, None)
        if val is not None:
            updates.append(f"{field} = %s")
            params.append(val)
    
    if updates:
        params.append(ingredient_id)
        cur.execute(f"UPDATE ingredients SET {', '.join(updates)} WHERE id = %s RETURNING *", params)
        result = dict(cur.fetchone())
        conn.commit()
    else:
        result = dict(cur.fetchone())
    
    # Пересчитываем себестоимость всех напитков с этим ингредиентом
    recalculate_drinks_with_ingredient(conn, ingredient_id)
    
    conn.close()
    return result


@router.delete("/{ingredient_id}")
def delete_ingredient(ingredient_id: str):
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("SELECT COUNT(*) FROM drink_ingredients WHERE ingredient_id = %s", (ingredient_id,))
    if cur.fetchone()[0] > 0:
        conn.close()
        raise HTTPException(400, "Ингредиент используется в напитках")
    
    cur.execute("DELETE FROM ingredients WHERE id = %s", (ingredient_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ===== СОСТАВ НАПИТКА =====

@router.get("/drink/{drink_id}")
def get_drink_ingredients(drink_id: str):
    """Получить состав конкретного напитка"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("""
        SELECT di.*, i.name as ingredient_name, i.cost as ingredient_cost, i.volume as ingredient_volume, i.unit
        FROM drink_ingredients di
        JOIN ingredients i ON di.ingredient_id = i.id
        WHERE di.drink_id = %s
        ORDER BY i.name
    """, (drink_id,))
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@router.post("/drink")
def add_ingredient_to_drink(data: DrinkIngredientCreate):
    """Добавить ингредиент в напиток"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    # Проверяем существование
    cur.execute("SELECT * FROM drinks WHERE id = %s", (data.drink_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(404, "Напиток не найден")
    
    cur.execute("SELECT * FROM ingredients WHERE id = %s", (data.ingredient_id,))
    ing = cur.fetchone()
    if not ing:
        conn.close()
        raise HTTPException(404, "Ингредиент не найден")
    
    # Проверяем что объём не превышает объём упаковки
    if data.volume > ing["volume"]:
        conn.close()
        raise HTTPException(400, f"Объём в напитке ({data.volume}мл) превышает объём упаковки ({ing['volume']}мл)")
    
    diid = f"di_{uuid.uuid4().hex[:10]}"
    cur.execute(
        "INSERT INTO drink_ingredients (id, drink_id, ingredient_id, volume) VALUES (%s,%s,%s,%s) RETURNING *",
        (diid, data.drink_id, data.ingredient_id, data.volume))
    result = dict(cur.fetchone())
    
    # Пересчитываем себестоимость
    recalculate_drink_cost(conn, data.drink_id)
    
    conn.commit()
    conn.close()
    return result


@router.delete("/drink/{di_id}")
def remove_ingredient_from_drink(di_id: str):
    """Удалить ингредиент из напитка"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM drink_ingredients WHERE id = %s", (di_id,))
    di = cur.fetchone()
    if not di:
        conn.close()
        raise HTTPException(404, "Связь не найдена")
    
    drink_id = di["drink_id"]
    cur.execute("DELETE FROM drink_ingredients WHERE id = %s", (di_id,))
    
    # Пересчитываем себестоимость
    recalculate_drink_cost(conn, drink_id)
    
    conn.commit()
    conn.close()
    return {"ok": True}


def recalculate_drink_cost(conn, drink_id: str):
    """Пересчитывает себестоимость напитка на основе ингредиентов"""
    cur = conn.cursor()
    
    cur.execute("""
        SELECT SUM(di.volume * i.cost / i.volume) as total_cost
        FROM drink_ingredients di
        JOIN ingredients i ON di.ingredient_id = i.id
        WHERE di.drink_id = %s
    """, (drink_id,))
    
    result = cur.fetchone()
    cost = round(result[0], 2) if result and result[0] else 0
    
    cur.execute("UPDATE drinks SET cost_price = %s WHERE id = %s", (cost, drink_id))
    conn.commit()


def recalculate_drinks_with_ingredient(conn, ingredient_id: str):
    """Пересчитывает себестоимость всех напитков с указанным ингредиентом"""
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT drink_id FROM drink_ingredients WHERE ingredient_id = %s", (ingredient_id,))
    for row in cur.fetchall():
        recalculate_drink_cost(conn, row[0])
