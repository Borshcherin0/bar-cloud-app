import uuid
from datetime import datetime, timezone
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.database import get_db

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


class StockUpdate(BaseModel):
    ingredient_id: str
    volume: float
    is_unlimited: bool = False


@router.get("")
def get_inventory():
    """Получить все остатки с информацией об ингредиентах"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("""
        SELECT 
            s.id as stock_id,
            s.volume as stock_volume,
            s.is_unlimited,
            s.updated_at,
            i.id as ingredient_id,
            i.name,
            i.volume as package_volume,
            i.cost,
            i.unit,
            i.category
        FROM ingredient_stock s
        JOIN ingredients i ON s.ingredient_id = i.id
        ORDER BY i.category, i.name
    """)
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@router.put("/{stock_id}")
def update_stock(stock_id: str, data: StockUpdate):
    """Обновить остаток ингредиента"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM ingredient_stock WHERE id = %s", (stock_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(404, "Запись не найдена")
    
    cur.execute("""
        UPDATE ingredient_stock 
        SET volume = %s, is_unlimited = %s, updated_at = %s
        WHERE id = %s
        RETURNING *
    """, (data.volume, data.is_unlimited, datetime.now(timezone.utc).isoformat(), stock_id))
    
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@router.get("/report")
def get_inventory_report():
    """
    Отчёт: на сколько порций каждого напитка хватит остатков.
    Учитывает состав напитка и текущие остатки.
    """
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    # Получаем все напитки с ингредиентами
    cur.execute("""
        SELECT 
            d.id as drink_id,
            d.name as drink_name,
            d.price,
            d.cost_price,
            di.ingredient_id,
            di.volume as required_volume,
            i.name as ingredient_name,
            i.unit,
            s.volume as stock_volume,
            s.is_unlimited,
            s.id as stock_id
        FROM drinks d
        JOIN drink_ingredients di ON d.id = di.drink_id
        JOIN ingredients i ON di.ingredient_id = i.id
        LEFT JOIN ingredient_stock s ON i.id = s.ingredient_id
        ORDER BY d.name, i.category, i.name
    """)
    rows = cur.fetchall()
    conn.close()
    
    # Группируем по напиткам
    drinks = {}
    for r in rows:
        did = r["drink_id"]
        if did not in drinks:
            drinks[did] = {
                "drink_id": did,
                "drink_name": r["drink_name"],
                "price": r["price"],
                "cost_price": r["cost_price"],
                "ingredients": [],
                "max_servings": None  # будет вычислено
            }
        
        stock = r["stock_volume"] or 0
        required = r["required_volume"] or 1
        is_unlimited = r["is_unlimited"] or False
        
        # Сколько порций можно сделать из этого ингредиента
        if is_unlimited:
            servings = float('inf')
        elif required > 0:
            servings = int(stock // required)
        else:
            servings = 0
        
        drinks[did]["ingredients"].append({
            "ingredient_id": r["ingredient_id"],
            "ingredient_name": r["ingredient_name"],
            "required_volume": required,
            "stock_volume": stock,
            "unit": r["unit"],
            "is_unlimited": is_unlimited,
            "possible_servings": servings
        })
    
    # Вычисляем максимум порций для каждого напитка
    result = []
    for drink in drinks.values():
        servings = []
        limiting_ingredient = None
        
        for ing in drink["ingredients"]:
            if ing["possible_servings"] != float('inf'):
                servings.append(ing["possible_servings"])
            if ing["possible_servings"] != float('inf') and (limiting_ingredient is None or ing["possible_servings"] < limiting_ingredient["possible_servings"]):
                limiting_ingredient = ing
        
        max_servings = min(servings) if servings else float('inf')
        if max_servings == float('inf'):
            max_servings = 999  # бесконечно (условно)
        
        drink["max_servings"] = max_servings
        drink["limiting_ingredient"] = limiting_ingredient["ingredient_name"] if limiting_ingredient else None
        result.append(drink)
    
    # Сортируем: сначала те, что можно сделать
    result.sort(key=lambda d: (-d["max_servings"] if d["max_servings"] > 0 else 99999, d["drink_name"]))
    
    return result
