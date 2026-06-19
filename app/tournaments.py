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
    cur.execute("SELECT * FROM tournament_matches WHERE tournament_id = %s ORDER BY round, match_number", (tournament_id,))
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
        cur.execute("INSERT INTO tournament_participants (id, tournament_id, name, seed) VALUES (%s,%s,%s,%s) RETURNING *",
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
    n = len(participants)
    random.shuffle(participants)

    # Групповая стадия
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
        gn = chr(65 + g_idx)
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                mid = f"tm_{uuid.uuid4().hex[:10]}"
                cur.execute("INSERT INTO tournament_matches (id,tournament_id,round,match_number,player1_id,player2_id,status,bracket_position) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                           (mid, tournament_id, 0, 0, group[i]["id"], group[j]["id"], 'pending', f"group_{gn}"))

    # Сетка плей-офф
    slots = 2 * len(groups)
    size = 1
    while size < slots:
        size *= 2
    total_rounds = size.bit_length()

    # Winners bracket
    for rnd in range(1, total_rounds + 1):
        matches_in_round = 2 ** (total_rounds - rnd)
        for mn in range(1, matches_in_round + 1):
            mid = f"tm_{uuid.uuid4().hex[:10]}"
            cur.execute("INSERT INTO tournament_matches (id,tournament_id,round,match_number,player1_id,player2_id,status,bracket_position) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                       (mid, tournament_id, rnd, mn, None, None, 'pending', 'winners'))

    # Losers bracket
    for rnd in range(1, total_rounds + 1):
        matches_in_round = 2 ** (total_rounds - rnd)
        for mn in range(1, matches_in_round + 1):
            mid = f"tm_{uuid.uuid4().hex[:10]}"
            cur.execute("INSERT INTO tournament_matches (id,tournament_id,round,match_number,player1_id,player2_id,status,bracket_position) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                       (mid, tournament_id, rnd, mn, None, None, 'pending', 'losers'))

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
    for f in ['player1_score', 'player2_score', 'winner_id', 'status']:
        v = getattr(data, f, None)
        if v is not None:
            updates.append(f"{f}=%s")
            params.append(v)
    if updates:
        params.append(match_id)
        cur.execute(f"UPDATE tournament_matches SET {', '.join(updates)} WHERE id=%s RETURNING *", params)
        updated = dict(cur.fetchone())
        conn.commit()
        if data.winner_id and match["round"] < 10:
            advance_winner(conn, match, data.winner_id)
    else:
        updated = dict(match)
    conn.close()
    return updated


@router.put("/{tournament_id}/generate-playoff")
def generate_playoff(tournament_id: str):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM tournaments WHERE id=%s", (tournament_id,))
    t = cur.fetchone()
    if not t or t["status"] != "live":
        conn.close()
        raise HTTPException(400, "Турнир не live")

    cur.execute("SELECT * FROM tournament_matches WHERE tournament_id=%s AND bracket_position LIKE 'group_%'", (tournament_id,))
    gm = cur.fetchall()
    if not gm:
        conn.close()
        raise HTTPException(400, "Нет групп")

    scores = {}
    for m in gm:
        scores[m["player1_id"]] = scores.get(m["player1_id"], 0)
        scores[m["player2_id"]] = scores.get(m["player2_id"], 0)
        if m["winner_id"] == m["player1_id"]: scores[m["player1_id"]] += 1
        elif m["winner_id"] == m["player2_id"]: scores[m["player2_id"]] += 1

    groups = {}
    for m in gm:
        g = m["bracket_position"]
        if g not in groups: groups[g] = set()
        groups[g].add(m["player1_id"])
        groups[g].add(m["player2_id"])

    winners_seeds = []
    losers_seeds = []
    for g, pids in groups.items():
        srt = sorted(pids, key=lambda x: scores.get(x, 0), reverse=True)
        winners_seeds.append(srt[0])
        losers_seeds.append(srt[1])
        if len(srt) > 2: losers_seeds.append(srt[2])
        if len(srt) > 3: losers_seeds.append(srt[3])

    random.shuffle(winners_seeds)
    random.shuffle(losers_seeds)

    fill_bracket(conn, tournament_id, "winners", winners_seeds)
    fill_bracket(conn, tournament_id, "losers", losers_seeds)

    conn.commit()
    conn.close()
    return {"ok": True}


def fill_bracket(conn, tournament_id, bracket, players):
    cur = conn.cursor(row_factory=dict_row)
    cur.execute(
        "SELECT round FROM tournament_matches WHERE tournament_id=%s AND bracket_position=%s ORDER BY round DESC LIMIT 1",
        (tournament_id, bracket))
    row = cur.fetchone()
    if not row:
        return
    first_round = row["round"]

    cur.execute(
        "SELECT * FROM tournament_matches WHERE tournament_id=%s AND round=%s AND bracket_position=%s ORDER BY match_number",
        (tournament_id, first_round, bracket))
    matches = cur.fetchall()

    for i, m in enumerate(matches):
        p1 = players[i*2] if i*2 < len(players) else None
        p2 = players[i*2+1] if i*2+1 < len(players) else None
        winner_id = None
        status = 'pending'
        if p1 and not p2:
            winner_id = p1
            status = 'finished'
        elif p2 and not p1:
            winner_id = p2
            status = 'finished'
        cur.execute("UPDATE tournament_matches SET player1_id=%s, player2_id=%s, winner_id=%s, status=%s WHERE id=%s",
                   (p1, p2, winner_id, status, m["id"]))
    conn.commit()


@router.put("/{tournament_id}/finish")
def finish_tournament(tournament_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE tournaments SET status='finished', finished_at=%s WHERE id=%s",
               (datetime.now().isoformat(), tournament_id))
    conn.commit()
    conn.close()
    return {"ok": True}


def advance_winner(conn, match, winner_id):
    cur = conn.cursor(row_factory=dict_row)
    next_round = match["round"] + 1
    target = (match["match_number"] + 1) // 2
    cur.execute("SELECT * FROM tournament_matches WHERE tournament_id=%s AND round=%s AND match_number=%s AND bracket_position=%s",
               (match["tournament_id"], next_round, target, match["bracket_position"]))
    nm = cur.fetchone()
    if nm:
        col = "player1_id" if (match["match_number"] % 2 == 1) else "player2_id"
        cur.execute(f"UPDATE tournament_matches SET {col}=%s WHERE id=%s", (winner_id, nm["id"]))
        conn.commit()
