from fastapi import APIRouter
from fastapi.responses import JSONResponse
from app.database import get_db

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def health():
    try:
        conn = get_db()
        conn.close()
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=500)
