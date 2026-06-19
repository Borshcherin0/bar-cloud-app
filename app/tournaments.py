import uuid
import random
from datetime import datetime
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.database import get_db

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])


class TournamentCreate(BaseModel):
    title: str
    game: str = "poker"
    format: str = "double_elimination"
    participants: list[str]  # имена игроков


class MatchUpdate(BaseModel):
    player1_score: Optional[int] = None
    player2_score: Optional[int] = None
    winner_id: Optional[str] = None
    status: Optional[str] = None


# ===== ТУРНИРЫ =====

@router.get("")
def get_tournaments(game: str = None):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    if game:
        cur.execute("SELECT * FROM tournaments WHERE game = %s ORDER BY created_at DESC", (game,))
    else:
        cur.execute("SELECT * FROM tournaments ORDER BY created_at DESC LIMIT 50")
    tournaments = [dict(r) for r in cur.fetchall()]
    conn.close()
    return tournaments


@router.get("/{tournament_id}")
def get_tournament(tournament_id: str):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM tournaments WHERE id = %s", (tournament_id,))
    t = cur.fetchone()
    if not t:
        conn.close()
        raise HTTPException(404, "Турнир не найден")
    
    cur.execute("SELECT * FROM tournament_participants WHERE tournament_id = %s ORDER BY seed", (tournament_id,))
    participants = [dict(r) for r in cur.fetchall()]
    
    cur.execute("SELECT * FROM tournament_matches WHERE tournament_id = %s ORDER BY round DESC, match_number", (tournament_id,))
    matches = [dict(r) for r in cur.fetchall()]
    
    conn.close()
    return {**dict(t), "participants": participants, "matches": matches}


@router.post("")
def create_tournament(data: TournamentCreate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    tid = f"trn_{uuid.uuid4().hex[:10]}"
    
    cur.execute(
        "INSERT INTO tournaments (id, title, game, format, status) VALUES (%s,%s,%s,%s,'upcoming') RETURNING *",
        (tid, data.title, data.game, data.format))
    result = dict(cur.fetchone())
    
    # Добавляем участников
    participants = []
    for i, name in enumerate(data.participants):
        pid = f"tp_{uuid.uuid4().hex[:10]}"
        cur.execute(
            "INSERT INTO tournament_participants (id, tournament_id, name, seed) VALUES (%s,%s,%s,%s) RETURNING *",
            (pid, tid, name, i + 1))
        participants.append(dict(cur.fetchone()))
    
    conn.commit()
    conn.close()
    return {**result, "participants": participants}


@router.put("/{tournament_id}/start")
def start_tournament(tournament_id: str):
    """Запустить турнир и сгенерировать сетку"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM tournaments WHERE id = %s", (tournament_id,))
    t = cur.fetchone()
    if not t:
        conn.close()
        raise HTTPException(404, "Турнир не найден")
    
    cur.execute("SELECT * FROM tournament_participants WHERE tournament_id = %s ORDER BY seed", (tournament_id,))
    participants = cur.fetchall()
    
    if len(participants) < 2:
        conn.close()
        raise HTTPException(400, "Нужно минимум 2 участника")
    
    # Генерируем сетку
    generate_bracket(conn, tournament_id, participants, t["format"])
    
    cur.execute("UPDATE tournaments SET status = 'live' WHERE id = %s", (tournament_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.put("/matches/{match_id}")
def update_match(match_id: str, data: MatchUpdate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM tournament_matches WHERE id = %s", (match_id,))
    match = cur.fetchone()
    if not match:
        conn.close()
        raise HTTPException(404, "Матч не найден")
    
    updates = []
    params = []
    for field in ['player1_score', 'player2_score', 'winner_id', 'status']:
        val = getattr(data, field, None)
        if val is not None:
            updates.append(f"{field} = %s")
            params.append(val)
    
    if updates:
        params.append(match_id)
        cur.execute(f"UPDATE tournament_matches SET {', '.join(updates)} WHERE id = %s RETURNING *", params)
        result = dict(cur.fetchone())
        conn.commit()
    else:
        result = dict(match)
    
    conn.close()
    return result


@router.put("/{tournament_id}/finish")
def finish_tournament(tournament_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE tournaments SET status = 'finished', finished_at = %s WHERE id = %s", 
                (datetime.now().isoformat(), tournament_id))
    conn.commit()
    conn.close()
    return {"ok": True}


# ===== ГЕНЕРАЦИЯ СЕТКИ =====

def generate_bracket(conn, tournament_id, participants, format_type):
    cur = conn.cursor()
    n = len(participants)
    
    if format_type in ('single_elimination', 'double_elimination'):
        # Групповая стадия
        groups = []
        if n <= 4:
            groups = [participants]
        elif n <= 8:
            mid = n // 2
            groups = [participants[:mid], participants[mid:]]
        else:
            # Делим на группы по 4-5 человек
            group_size = 4 if n <= 16 else 5
            for i in range(0, n, group_size):
                groups.append(participants[i:i+group_size])
        
        # Генерируем матчи групповой стадии
        for g_idx, group in enumerate(groups):
            group_name = chr(65 + g_idx)  # A, B, C...
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    cur.execute("""
                        INSERT INTO tournament_matches 
                        (id, tournament_id, round, match_number, player1_id, player2_id, status, bracket_position)
                        VALUES (%s,%s,%s,%s,%s,%s,'pending',%s)
                    """, (
                        f"tm_{uuid.uuid4().hex[:10]}", tournament_id, 0, 0,
                        group[i]["id"], group[j]["id"],
                        f"group_{group_name}"
                    ))
    
    elif format_type == 'round_robin':
        for i in range(n):
            for j in range(i + 1, n):
                cur.execute("""
                    INSERT INTO tournament_matches 
                    (id, tournament_id, round, match_number, player1_id, player2_id, status, bracket_position)
                    VALUES (%s,%s,%s,%s,%s,%s,'pending','group')
                """, (
                    f"tm_{uuid.uuid4().hex[:10]}", tournament_id, 1, 0,
                    participants[i]["id"], participants[j]["id"]
                ))
    
    conn.commit()
