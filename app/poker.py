import uuid
import json
from datetime import datetime, timezone
from typing import Optional

from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.database import get_db
from app.models import PokerTournamentCreate, PokerFinishData

router = APIRouter(prefix="/api/poker", tags=["poker"])


class QuickPokerResult(BaseModel):
    session_id: str
    results: list[dict]  # [{"guest_name": "Алексей", "place": 1}, ...]


def finish_tournament_impl(conn, tournament_id: str, data, auto_finish: bool = False):
    """Внутренняя функция завершения турнира"""
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM poker_tournaments WHERE id = %s", (tournament_id,))
    tournament = cur.fetchone()
    
    if isinstance(tournament.get("prizes"), str):
        prizes = json.loads(tournament["prizes"])
    else:
        prizes = tournament["prizes"]
    
    now = datetime.now(timezone.utc).isoformat()
    
    results = None
    if data:
        if hasattr(data, 'results'):
            results = data.results
        elif isinstance(data, dict) and 'results' in data:
            results = data['results']
    
    if results:
        for result in results:
            guest_id = result.get('guest_id') if isinstance(result, dict) else getattr(result, 'guest_id', None)
            place = result.get('place') if isinstance(result, dict) else getattr(result, 'place', None)
            
            cur.execute(
                "UPDATE poker_participants SET place = %s WHERE tournament_id = %s AND guest_id = %s",
                (place, tournament_id, guest_id))
            
            prize = next((p for p in prizes if p["place"] == place), None)
            if prize and prize["amount"] > 0:
                oid = f"o_{uuid.uuid4().hex[:10]}"
                cur.execute(
                    "INSERT INTO orders (id, session_id, guest_id, drink_id, price, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
                    (oid, tournament["session_id"], guest_id, 'd_poker_prize', -prize["amount"], now))
    elif auto_finish:
        cur.execute(
            "UPDATE poker_participants SET place = 0 WHERE tournament_id = %s AND place IS NULL",
            (tournament_id,))
    
    cur.execute(
        "UPDATE poker_tournaments SET status = 'finished', finished_at = %s WHERE id = %s",
        (now, tournament_id))
    
    return True


@router.get("/tournaments")
def get_tournaments(session_id: str = None):
    """Получение турниров (всех или по сессии) с участниками"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    if session_id:
        cur.execute("SELECT * FROM poker_tournaments WHERE session_id = %s ORDER BY created_at DESC", (session_id,))
    else:
        cur.execute("SELECT * FROM poker_tournaments ORDER BY created_at DESC LIMIT 50")
    
    tournaments = [dict(r) for r in cur.fetchall()]
    
    for t in tournaments:
        cur.execute("""
            SELECT p.*, g.name as guest_name, g.role as guest_role
            FROM poker_participants p JOIN guests g ON p.guest_id = g.id
            WHERE p.tournament_id = %s
            ORDER BY p.place NULLS LAST, p.created_at
        """, (t["id"],))
        t["participants"] = [dict(r) for r in cur.fetchall()]
        
        if isinstance(t.get("prizes"), str):
            t["prizes"] = json.loads(t["prizes"])
    
    conn.close()
    return tournaments


@router.post("/tournaments")
def create_tournament(data: PokerTournamentCreate):
    """Создание покерного турнира с добавлением бай-инов в счёт"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM sessions WHERE id = %s AND closed_at IS NULL", (data.session_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(400, "Сессия закрыта")
    
    cur.execute("SELECT COUNT(*) as cnt FROM poker_tournaments WHERE session_id = %s AND status = 'active'", (data.session_id,))
    if cur.fetchone()["cnt"] > 0:
        conn.close()
        raise HTTPException(400, "В этой сессии уже есть активный турнир")
    
    tid = f"poker_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()
    
    cur.execute(
        "INSERT INTO poker_tournaments (id, session_id, buy_in, prize_places, prizes, status, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (tid, data.session_id, data.buy_in, data.prize_places, json.dumps(data.prizes), 'active', now))
    
    for guest_id in data.participants:
        pid = f"pp_{uuid.uuid4().hex[:10]}"
        cur.execute(
            "INSERT INTO poker_participants (id, tournament_id, guest_id, created_at) VALUES (%s,%s,%s,%s)",
            (pid, tid, guest_id, now))
        
        oid = f"o_{uuid.uuid4().hex[:10]}"
        cur.execute(
            "INSERT INTO orders (id, session_id, guest_id, drink_id, price, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
            (oid, data.session_id, guest_id, 'd_poker_buyin', data.buy_in, now))
    
    conn.commit()
    conn.close()
    return {"ok": True, "tournament_id": tid}


@router.post("/tournaments/{tournament_id}/finish")
def finish_tournament(tournament_id: str, data: Optional[PokerFinishData] = None):
    """Завершение покерного турнира с распределением призовых"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM poker_tournaments WHERE id = %s", (tournament_id,))
    tournament = cur.fetchone()
    if not tournament:
        conn.close()
        raise HTTPException(404, "Турнир не найден")
    
    if tournament["status"] != "active":
        conn.close()
        raise HTTPException(400, "Турнир уже завершён")
    
    finish_tournament_impl(conn, tournament_id, data)
    
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/quick-finish")
def quick_finish_tournament(data: QuickPokerResult, api_key: str = Query(...)):
    """Быстрое завершение турнира через iOS (по именам гостей)"""
    
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT api_key FROM bot_settings WHERE id = 1")
    settings = cur.fetchone()
    
    if not settings or settings.get("api_key") != api_key:
        conn.close()
        raise HTTPException(403, "Неверный API ключ")
    
    # Находим активный турнир
    cur.execute("SELECT id FROM poker_tournaments WHERE session_id = %s AND status = 'active'", (data.session_id,))
    tournament = cur.fetchone()
    
    if not tournament:
        conn.close()
        raise HTTPException(404, "Нет активного турнира в этой сессии")
    
    tid = tournament["id"]
    
    # Ищем гостей по именам
    results_with_ids = []
    not_found = []
    
    for result in data.results:
        name = result["guest_name"].strip().lower()
        cur.execute("SELECT id FROM guests WHERE LOWER(name) = %s", (name,))
        guest = cur.fetchone()
        
        if guest:
            results_with_ids.append({
                "guest_id": guest["id"],
                "place": result["place"],
                "name": result["guest_name"]
            })
        else:
            not_found.append(result["guest_name"])
    
    if not_found:
        conn.close()
        raise HTTPException(404, f"Гости не найдены: {', '.join(not_found)}")
    
    # Завершаем турнир
    finish_tournament_impl(conn, tid, {"results": results_with_ids})
    
    conn.commit()
    conn.close()
    
    return {
        "ok": True,
        "message": f"Турнир завершён! Распределено {len(results_with_ids)} мест.",
        "results": results_with_ids
    }


@router.delete("/tournaments/{tournament_id}")
def delete_tournament(tournament_id: str):
    """Удаление турнира и всех связанных данных"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM poker_participants WHERE tournament_id = %s", (tournament_id,))
    cur.execute("DELETE FROM poker_tournaments WHERE id = %s", (tournament_id,))
    conn.commit()
    conn.close()
    return {"ok": True}
