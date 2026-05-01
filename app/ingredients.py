import uuid
import math
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.database import get_db

router = APIRouter(prefix="/api/ingredients", tags=["ingredients"])


class IngredientCreate(BaseModel):
    name: str
    volume: float
    cost: float
    unit: str = "ml"
    category: str = "alco"


class IngredientUpdate(BaseModel):
    name: Optional[str] = None
    volume: Optional[float] = None
    cost: Optional[float] = None
    unit: Optional[str] = None
    category: Optional[str] = None


class DrinkIngredientCreate(BaseModel):
    drink_id: str
    ingredient_id: str
    volume: float


class MarginUpdate(BaseModel):
    drink_id: str
    margin_percent: float = 30.0


@router.get("")
def get_ingredients():
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM ingredients ORDER BY category, name")
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@router.post("")
def create_ingredient(data: IngredientCreate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    iid = f"ing_{uuid.uuid4().hex[:10]}"
    cur.execute(
        "INSERT INTO ingredients (id, name, volume, cost, unit, category) VALUES (%s,%s,%s,%s,%s,%s) RETURNING *",
        (iid, data.name, data.volume, data.cost, data.unit, data.category))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result

# ВАЖНО: этот эндпоинт должен быть ПЕРЕД @router.put("/{ingredient_id}")
@router.put("/margin")
def update_margin(data: MarginUpdate):
    """Обновить процент маржи напитка"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM drinks WHERE id = %s", (data.drink_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(404, "Напиток не найден")
    
    cur.execute(
        "UPDATE drinks SET margin_percent = %s WHERE id = %s RETURNING *",
        (data.margin_percent, data.drink_id))
    result = dict(cur.fetchone())
    
    # Обновляем финальную цену
    update_drink_price(conn, data.drink_id)
    
    conn.commit()
    conn.close()
    return result


@router.put("/{ingredient_id}")
def update_ingredient(ingredient_id: str, data: IngredientUpdate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM ingredients WHERE id = %s", (ingredient_id,))
    existing = cur.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Ингредиент не найден")
    
    updates = []
    params = []
    for field in ['name', 'volume', 'cost', 'unit', 'category']:
        val = getattr(data, field, None)
        if val is not None:
            updates.append(f"{field} = %s")
            params.append(val)
    
    if updates:
        params.append(ingredient_id)
        cur.execute(f"UPDATE ingredients SET {', '.join(updates)} WHERE id = %s RETURNING *", params)
        result = dict(cur.fetchone())
        conn.commit()
        
        # Пересчитываем себестоимость напитков с этим ингредиентом
        recalculate_drinks_with_ingredient(conn, ingredient_id)
    else:
        result = dict(existing)
    
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
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("""
        SELECT di.*, i.name as ingredient_name, i.cost as ingredient_cost, 
               i.volume as ingredient_volume, i.unit, i.category
        FROM drink_ingredients di
        JOIN ingredients i ON di.ingredient_id = i.id
        WHERE di.drink_id = %s
        ORDER BY i.category, i.name
    """, (drink_id,))
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@router.post("/drink")
def add_ingredient_to_drink(data: DrinkIngredientCreate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM drinks WHERE id = %s", (data.drink_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(404, "Напиток не найден")
    
    cur.execute("SELECT * FROM ingredients WHERE id = %s", (data.ingredient_id,))
    ing = cur.fetchone()
    if not ing:
        conn.close()
        raise HTTPException(404, "Ингредиент не найден")
    
    diid = f"di_{uuid.uuid4().hex[:10]}"
    cur.execute(
        "INSERT INTO drink_ingredients (id, drink_id, ingredient_id, volume) VALUES (%s,%s,%s,%s) RETURNING *",
        (diid, data.drink_id, data.ingredient_id, data.volume))
    result = dict(cur.fetchone())
    
    recalculate_drink_cost(conn, data.drink_id)
    
    conn.commit()
    conn.close()
    return result


@router.delete("/drink/{di_id}")
def remove_ingredient_from_drink(di_id: str):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM drink_ingredients WHERE id = %s", (di_id,))
    di = cur.fetchone()
    if not di:
        conn.close()
        raise HTTPException(404, "Связь не найдена")
    
    drink_id = di["drink_id"]
    cur.execute("DELETE FROM drink_ingredients WHERE id = %s", (di_id,))
    
    recalculate_drink_cost(conn, drink_id)
    
    conn.commit()
    conn.close()
    return {"ok": True}



@router.post("/recalculate-all")
def recalculate_all():
    """Пересчитать себестоимость и цены всех напитков"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM drinks")
    drink_ids = [r[0] for r in cur.fetchall()]
    
    for did in drink_ids:
        recalculate_drink_cost(conn, did)
        update_drink_price(conn, did)
    
    conn.commit()
    conn.close()
    return {"ok": True, "count": len(drink_ids)}


# ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

def recalculate_drink_cost(conn, drink_id: str):
    cur = conn.cursor()
    
    cur.execute("""
        SELECT COALESCE(SUM(di.volume * i.cost / NULLIF(i.volume, 0)), 0) as total_cost
        FROM drink_ingredients di
        JOIN ingredients i ON di.ingredient_id = i.id
        WHERE di.drink_id = %s
    """, (drink_id,))
    
    result = cur.fetchone()
    cost = round(result[0], 2) if result else 0
    
    cur.execute("UPDATE drinks SET cost_price = %s WHERE id = %s", (cost, drink_id))
    conn.commit()


def update_drink_price(conn, drink_id: str):
    """Обновляет финальную цену: себестоимость + маржа, округление до десятков вверх"""
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT cost_price, margin_percent FROM drinks WHERE id = %s", (drink_id,))
    drink = cur.fetchone()
    
    if drink:
        cost = drink["cost_price"] or 0
        margin = drink["margin_percent"] if drink["margin_percent"] is not None else 30
        
        # Цена = себестоимость × (1 + маржа/100)
        raw_price = cost * (1 + margin / 100)
        
        # Округляем до десятков в большую сторону
        # Пример: 143 → 150, 128 → 130, 100 → 100
        final_price = math.ceil(raw_price / 10) * 10
        
        cur.execute("UPDATE drinks SET price = %s WHERE id = %s", (final_price, drink_id))
        conn.commit()

def recalculate_drinks_with_ingredient(conn, ingredient_id: str):
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT drink_id FROM drink_ingredients WHERE ingredient_id = %s", (ingredient_id,))
    for row in cur.fetchall():
        recalculate_drink_cost(conn, row[0])
        update_drink_price(conn, row[0])
