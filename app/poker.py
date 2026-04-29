import uuid
import json
from datetime import datetime, timezone
from typing import Optional

from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException

from app.database import get_db
from app.models import PokerTournamentCreate, PokerFinishData

router = APIRouter(prefix="/api/poker", tags=["poker"])


def finish_tournament_impl(conn, tournament_id: str, data: Optional[PokerFinishData], auto_finish: bool = False):
    """Внутренняя функция завершения турнира (используется также при закрытии сессии)"""
    cur = conn.cursor(row_factory=dict_row)

    cur.execute("SELECT * FROM poker_tournaments WHERE id = %s", (tournament_id,))
    tournament = cur.fetchone()

    if isinstance(tournament.get("prizes"), str):
        prizes = json.loads(tournament["prizes"])
    else:
        prizes = tournament["prizes"]

    now = datetime.now(timezone.utc).isoformat()

    if data and data.results:
        for result in data.results:
            cur.execute(
                "UPDATE poker_participants SET place = %s WHERE tournament_id = %s AND guest_id = %s",
                (result["place"], tournament_id, result["guest_id"]))

            prize = next((p for p in prizes if p["place"] == result["place"]), None)
            if prize and prize["amount"] > 0:
                oid = f"o_{uuid.uuid4().hex[:10]}"
                cur.execute(
                    "INSERT INTO orders (id, session_id, guest_id, drink_id, price, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
                    (oid, tournament["session_id"], result["guest_id"], 'd_poker_prize', -prize["amount"], now))
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


@router.delete("/tournaments/{tournament_id}")
def delete_tournament(tournament_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM poker_participants WHERE tournament_id = %s", (tournament_id,))
    cur.execute("DELETE FROM poker_tournaments WHERE id = %s", (tournament_id,))
    conn.commit()
    conn.close()
    return {"ok": True}
