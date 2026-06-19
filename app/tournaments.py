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
    participants: list[str]


class MatchUpdate(BaseModel):
    player1_score: Optional[int] = None
    player2_score: Optional[int] = None
    winner_id: Optional[str] = None
    status: Optional[str] = None


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
    
    # Обновляем счёт
    score_updates = []
    score_params = []
    if data.player1_score is not None:
        score_updates.append("player1_score = %s")
        score_params.append(data.player1_score)
    if data.player2_score is not None:
        score_updates.append("player2_score = %s")
        score_params.append(data.player2_score)
    if data.winner_id is not None:
        score_updates.append("winner_id = %s")
        score_params.append(data.winner_id)
    if data.status is not None:
        score_updates.append("status = %s")
        score_params.append(data.status)
    
    if score_updates:
        score_params.append(match_id)
        cur.execute(f"UPDATE tournament_matches SET {', '.join(score_updates)} WHERE id = %s RETURNING *", score_params)
        updated_match = dict(cur.fetchone())
        conn.commit()
        
        # Авто-продвижение победителя в следующий раунд
        if data.winner_id and match["round"] > 1:
            advance_winner(conn, match, data.winner_id)
    else:
        updated_match = dict(match)
    
    conn.close()
    return updated_match


@router.put("/{tournament_id}/finish")
def finish_tournament(tournament_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE tournaments SET status = 'finished', finished_at = %s WHERE id = %s",
                (datetime.now().isoformat(), tournament_id))
    conn.commit()
    conn.close()
    return {"ok": True}


def generate_bracket(conn, tournament_id, participants, format_type):
    cur = conn.cursor()
    random.shuffle(participants)
    n = len(participants)
    
    # Ближайшая степень двойки
    bracket_size = 1
    while bracket_size < n:
        bracket_size *= 2
    
    round_num = bracket_size.bit_length()
    matches_count = bracket_size // 2
    
    for i in range(matches_count):
        p1 = participants[i * 2] if i * 2 < n else None
        p2 = participants[i * 2 + 1] if i * 2 + 1 < n else None
        
        winner_id = None
        status = 'pending'
        if p1 and not p2:
            winner_id = p1["id"]
            status = 'finished'
        elif p2 and not p1:
            winner_id = p2["id"]
            status = 'finished'
        
        mid = f"tm_{uuid.uuid4().hex[:10]}"
        cur.execute(
            "INSERT INTO tournament_matches (id, tournament_id, round, match_number, player1_id, player2_id, winner_id, status, bracket_position) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (mid, tournament_id, round_num, i + 1,
             p1["id"] if p1 else None, p2["id"] if p2 else None,
             winner_id, status, "winners"))
    
    conn.commit()


def advance_winner(conn, match, winner_id):
    """Продвигает победителя в следующий раунд"""
    cur = conn.cursor(row_factory=dict_row)
    next_round = match["round"] - 1
    position_in_match = 1 if winner_id == match["player1_id"] else 2
    
    # Ищем матч следующего раунда, куда должен попасть победитель
    target_match_number = (match["match_number"] + 1) // 2
    
    cur.execute(
        "SELECT * FROM tournament_matches WHERE tournament_id = %s AND round = %s AND match_number = %s AND bracket_position = %s",
        (match["tournament_id"], next_round, target_match_number, match["bracket_position"]))
    next_match = cur.fetchone()
    
    if next_match:
        if position_in_match == 1:
            cur.execute("UPDATE tournament_matches SET player1_id = %s WHERE id = %s",
                       (winner_id, next_match["id"]))
        else:
            cur.execute("UPDATE tournament_matches SET player2_id = %s WHERE id = %s",
                       (winner_id, next_match["id"]))
        conn.commit()
