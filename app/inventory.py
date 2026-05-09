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
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
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
            COALESCE(s.volume, 0) as stock_volume,
            COALESCE(s.is_unlimited, false) as is_unlimited,
            s.id as stock_id
        FROM drinks d
        JOIN drink_ingredients di ON d.id = di.drink_id
        JOIN ingredients i ON di.ingredient_id = i.id
        LEFT JOIN ingredient_stock s ON i.id = s.ingredient_id
        ORDER BY d.name, i.category, i.name
    """)
    rows = cur.fetchall()
    conn.close()
    
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
                "max_servings": None
            }
        
        stock = float(r["stock_volume"] or 0)
        required = float(r["required_volume"] or 1)
        is_unlimited = bool(r["is_unlimited"])
        
        if is_unlimited:
            servings = float('inf')
        elif required > 0 and stock > 0:
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
            "possible_servings": servings if servings != float('inf') else 99999
        })
    
    result = []
    for drink in drinks.values():
        servings = [ing["possible_servings"] for ing in drink["ingredients"] if not ing["is_unlimited"]]
        
        if all(ing["is_unlimited"] for ing in drink["ingredients"]):
            max_servings = 99999
            limiting = None
        elif servings:
            max_servings = min(servings)
            limiting = next((ing["ingredient_name"] for ing in drink["ingredients"] if ing["possible_servings"] == max_servings), None)
        else:
            max_servings = 0
            limiting = drink["ingredients"][0]["ingredient_name"] if drink["ingredients"] else None
        
        drink["max_servings"] = max_servings
        drink["limiting_ingredient"] = limiting
        result.append(drink)
    
    result.sort(key=lambda d: (-d["max_servings"] if d["max_servings"] > 0 else 99999, d["drink_name"]))
    
    return result


def consume_ingredients_for_order(conn, drink_id: str, quantity: int = 1):
    """
    Списывает ингредиенты при заказе напитка.
    Вызывается при создании заказа.
    """
    cur = conn.cursor()
    
    # Получаем состав напитка
    cur.execute("""
        SELECT di.ingredient_id, di.volume
        FROM drink_ingredients di
        WHERE di.drink_id = %s
    """, (drink_id,))
    ingredients = cur.fetchall()
    
    for ing in ingredients:
        ingredient_id = ing[0]
        required_volume = ing[1] * quantity
        
        # Находим запись остатка
        cur.execute("""
            SELECT id, volume, is_unlimited 
            FROM ingredient_stock 
            WHERE ingredient_id = %s
        """, (ingredient_id,))
        stock = cur.fetchone()
        
        if not stock:
            continue
        
        stock_id, current_volume, is_unlimited = stock
        
        # Бесконечные не списываем
        if is_unlimited:
            continue
        
        new_volume = max(0, current_volume - required_volume)
        cur.execute("""
            UPDATE ingredient_stock 
            SET volume = %s, updated_at = %s
            WHERE id = %s
        """, (new_volume, datetime.now(timezone.utc).isoformat(), stock_id))
    
    conn.commit()


def return_ingredients_for_order(conn, drink_id: str, quantity: int = 1):
    """Возвращает ингредиенты при удалении заказа."""
    cur = conn.cursor()
    
    cur.execute("""
        SELECT di.ingredient_id, di.volume
        FROM drink_ingredients di
        WHERE di.drink_id = %s
    """, (drink_id,))
    ingredients = cur.fetchall()
    
    for ing in ingredients:
        ingredient_id = ing[0]
        return_volume = ing[1] * quantity
        
        cur.execute("""
            SELECT id, volume, is_unlimited 
            FROM ingredient_stock 
            WHERE ingredient_id = %s
        """, (ingredient_id,))
        stock = cur.fetchone()
        
        if not stock or stock[2]:  # бесконечные пропускаем
            continue
        
        stock_id, current_volume, _ = stock
        new_volume = current_volume + return_volume
        
        cur.execute("""
            UPDATE ingredient_stock 
            SET volume = %s, updated_at = %s
            WHERE id = %s
        """, (new_volume, datetime.now(timezone.utc).isoformat(), stock_id))
    
    conn.commit()
