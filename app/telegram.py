import json
import base64
import io
from datetime import datetime, timezone

import requests
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import get_db

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


class BotSettings(BaseModel):
    bot_token: str
    chat_id: str
    enabled: bool


@router.get("/settings")
def get_settings():
    """Получить настройки бота"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM bot_settings WHERE id = 1")
    settings = cur.fetchone()
    conn.close()
    
    if not settings:
        return {"bot_token": "", "chat_id": "", "enabled": False}
    
    return {
        "bot_token": settings.get("bot_token", ""),
        "chat_id": settings.get("chat_id", ""),
        "enabled": settings.get("enabled", False),
    }


@router.put("/settings")
def update_settings(settings: BotSettings):
    """Обновить настройки бота"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        UPDATE bot_settings 
        SET bot_token = %s, chat_id = %s, enabled = %s, updated_at = %s
        WHERE id = 1
    """, (settings.bot_token, settings.chat_id, settings.enabled, 
          datetime.now(timezone.utc).isoformat()))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/test")
def test_bot():
    """Отправить тестовое сообщение"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM bot_settings WHERE id = 1 AND enabled = true")
    settings = cur.fetchone()
    conn.close()
    
    if not settings:
        raise HTTPException(400, "Бот не настроен или отключен")
    
    if not settings["bot_token"] or not settings["chat_id"]:
        raise HTTPException(400, "Не указан токен или chat_id")
    
    try:
        result = send_telegram_message(
            settings["bot_token"],
            settings["chat_id"],
            "🧪 Тестовое сообщение от Барного учёта!\n\nБот настроен и работает ✅"
        )
        return {"ok": True, "result": result}
    except Exception as e:
        raise HTTPException(500, f"Ошибка отправки: {str(e)}")


@router.post("/send-receipt/{session_id}")
def send_receipt(session_id: str, image_data: dict = None):
    """Отправить чек в Telegram"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM bot_settings WHERE id = 1 AND enabled = true")
    settings = cur.fetchone()
    conn.close()
    
    if not settings:
        raise HTTPException(400, "Бот не настроен или отключен")
    
    if not image_data or not image_data.get("image"):
        raise HTTPException(400, "Нет данных изображения")
    
    try:
        # Декодируем base64 в байты
        image_bytes = base64.b64decode(image_data["image"].split(",")[1] if "," in image_data["image"] else image_data["image"])
        
        # Отправляем фото
        result = send_telegram_photo(
            settings["bot_token"],
            settings["chat_id"],
            image_bytes,
            caption=f"🧾 Чек за сессию {session_id[:8]}..."
        )
        return {"ok": True, "result": result}
    except Exception as e:
        raise HTTPException(500, f"Ошибка отправки: {str(e)}")


def send_telegram_message(bot_token: str, chat_id: str, text: str):
    """Отправить текстовое сообщение"""
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    response = requests.post(url, json={
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }, timeout=10)
    return response.json()


def send_telegram_photo(bot_token: str, chat_id: str, image_bytes: bytes, caption: str = ""):
    """Отправить фото"""
    url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
    files = {"photo": ("receipt.png", io.BytesIO(image_bytes), "image/png")}
    data = {"chat_id": chat_id, "caption": caption}
    response = requests.post(url, data=data, files=files, timeout=30)
    return response.json()
