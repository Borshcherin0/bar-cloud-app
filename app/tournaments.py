import uuid
import random
import math
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
    format: str = "single_elimination"
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
    """Запускает турнир: генерирует групповую стадию и ПОЛНУЮ сетку плей-офф"""
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
    
    n = len(participants)
    random.shuffle(participants)
    
    # 1. Групповая стадия
    groups = []
    if n <= 4:
        groups = [participants]
    elif n <= 8:
        mid = n // 2
        groups = [participants[:mid], participants[mid:]]
    else:
        for i in range(0, n, 4):
            groups.append(participants[i:i+4])
    
    for g_idx, group in enumerate(groups):
        group_name = chr(65 + g_idx)
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                mid = f"tm_{uuid.uuid4().hex[:10]}"
                cur.execute(
                    "INSERT INTO tournament_matches (id, tournament_id, round, match_number, player1_id, player2_id, status, bracket_position) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                    (mid, tournament_id, 0, 0, group[i]["id"], group[j]["id"], 'pending', f"group_{group_name}"))
    
    # 2. ПОЛНАЯ сетка плей-офф (сразу все раунды, пустые TBD)
    total_playoff_slots = 2 * len(groups)  # топ-2 из каждой группы
    bracket_size = 1
    while bracket_size < total_playoff_slots:
        bracket_size *= 2
    
    # Генерируем ВСЕ раунды
    for rnd in range(bracket_size.bit_length(), 0, -1):
        matches_in_round = 2 ** (rnd - 1)
        for m_num in range(1, matches_in_round + 1):
            mid = f"tm_{uuid.uuid4().hex[:10]}"
            cur.execute(
                "INSERT INTO tournament_matches (id, tournament_id, round, match_number, player1_id, player2_id, status, bracket_position) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (mid, tournament_id, rnd, m_num, None, None, 'pending', 'winners'))
    
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
        
        # Продвигаем победителя в следующий раунд (если есть)
        if data.winner_id and match["round"] > 1:
            advance_winner(conn, match, data.winner_id)
    else:
        updated_match = dict(match)
    
    conn.close()
    return updated_match


@router.put("/{tournament_id}/generate-playoff")
def generate_playoff(tournament_id: str):
    """Заполняет первый раунд плей-офф результатами групп"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    
    cur.execute("SELECT * FROM tournaments WHERE id = %s", (tournament_id,))
    t = cur.fetchone()
    if not t or t["status"] != "live":
        conn.close()
        raise HTTPException(400, "Турнир не в статусе live")
    
    # Считаем очки в группах
    cur.execute(
        "SELECT * FROM tournament_matches WHERE tournament_id = %s AND bracket_position LIKE %s",
        (tournament_id, "group_%"))
    group_matches = cur.fetchall()
    
    if not group_matches:
        conn.close()
        raise HTTPException(400, "Нет групповой стадии")
    
    scores = {}
    for m in group_matches:
        scores[m["player1_id"]] = scores.get(m["player1_id"], 0)
        scores[m["player2_id"]] = scores.get(m["player2_id"], 0)
        if m["winner_id"] == m["player1_id"]: scores[m["player1_id"]] += 1
        elif m["winner_id"] == m["player2_id"]: scores[m["player2_id"]] += 1
    
    # Группируем
    groups = {}
    for m in group_matches:
        g = m["bracket_position"]
        if g not in groups: groups[g] = set()
        groups[g].add(m["player1_id"])
        groups[g].add(m["player2_id"])
    
    # Топ-2 из каждой группы
    top_seeds = []
    low_seeds = []
    for g, pids in groups.items():
        sorted_players = sorted(pids, key=lambda pid: scores.get(pid, 0), reverse=True)
        top_seeds.append(sorted_players[0])
        low_seeds.append(sorted_players[1])
    
    # Перемешиваем пары: топ vs лоу из разных групп
    random.shuffle(low_seeds)
    all_players = []
    for i in range(len(top_seeds)):
        all_players.append(top_seeds[i])
        all_players.append(low_seeds[i])
    
    # Заполняем первый раунд
    max_round = 1
    cur.execute("SELECT MAX(round) as mr FROM tournament_matches WHERE tournament_id = %s AND bracket_position = 'winners'", (tournament_id,))
    row = cur.fetchone()
    if row: max_round = row["mr"]
    
    cur.execute(
        "SELECT * FROM tournament_matches WHERE tournament_id = %s AND round = %s AND bracket_position = 'winners' ORDER BY match_number",
        (tournament_id, max_round))
    first_round_matches = cur.fetchall()
    
    for i, m in enumerate(first_round_matches):
        p1 = all_players[i * 2] if i * 2 < len(all_players) else None
        p2 = all_players[i * 2 + 1] if i * 2 + 1 < len(all_players) else None
        cur.execute("UPDATE tournament_matches SET player1_id = %s, player2_id = %s WHERE id = %s",
                   (p1, p2, m["id"]))
    
    conn.commit()
    conn.close()
    return {"ok": True}


@router.put("/{tournament_id}/finish")
def finish_tournament(tournament_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE tournaments SET status = 'finished', finished_at = %s WHERE id = %s",
                (datetime.now().isoformat(), tournament_id))
    conn.commit()
    conn.close()
    return {"ok": True}


def advance_winner(conn, match, winner_id):
    """Продвигает победителя в следующий раунд"""
    cur = conn.cursor(row_factory=dict_row)
    next_round = match["round"] - 1
    if next_round < 1: return
    
    position = 1 if winner_id == match["player1_id"] else 2
    target_match_number = (match["match_number"] + 1) // 2
    
    cur.execute(
        "SELECT * FROM tournament_matches WHERE tournament_id = %s AND round = %s AND match_number = %s AND bracket_position = %s",
        (match["tournament_id"], next_round, target_match_number, match["bracket_position"]))
    next_match = cur.fetchone()
    
    if next_match:
        col = "player1_id" if position == 1 else "player2_id"
        cur.execute(f"UPDATE tournament_matches SET {col} = %s WHERE id = %s", (winner_id, next_match["id"]))
        conn.commit()
