import os
import psycopg

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL не задан!")


def get_db():
    """Создаёт подключение к PostgreSQL"""
    return psycopg.connect(DATABASE_URL)
