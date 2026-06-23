import uuid
import random
import math
from datetime import datetime
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.database import get_db

router = APIRouter(prefix="/api/tournaments/v2", tags=["tournaments_v2"])


class TournamentCreate(BaseModel):
    title: str
    game: str = "poker"
    participants: list[str]


class MatchUpdate(BaseModel):
    player1_name: Optional[str] = None
    player2_name: Optional[str] = None
    player1_score: Optional[int] = None
    player2_score: Optional[int] = None
    winner_name: Optional[str] = None
    status: Optional[str] = None


# ========== ТУРНИРЫ ==========

@router.get("")
def list_tournaments():
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM tournaments ORDER BY created_at DESC")
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@router.get("/{tid}")
def get_tournament(tid: str):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM tournaments WHERE id=%s", (tid,))
    t = cur.fetchone()
    if not t: raise HTTPException(404, "Не найден")
    cur.execute("SELECT * FROM tournament_participants WHERE tournament_id=%s ORDER BY seed", (tid,))
    participants = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT * FROM tournament_matches WHERE tournament_id=%s ORDER BY bracket, round, match_number", (tid,))
    matches = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {**dict(t), "participants": participants, "matches": matches}


@router.post("")
def create_tournament(data: TournamentCreate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    tid = f"trn_{uuid.uuid4().hex[:10]}"
    cur.execute("INSERT INTO tournaments (id,title,game,status) VALUES (%s,%s,%s,'upcoming') RETURNING *",
               (tid, data.title, data.game))
    for i, name in enumerate(data.participants):
        pid = f"tp_{uuid.uuid4().hex[:10]}"
        cur.execute("INSERT INTO tournament_participants (id,tournament_id,name,seed) VALUES (%s,%s,%s,%s)",
                   (pid, tid, name.strip(), i+1))
    conn.commit()
    conn.close()
    return {"ok": True, "id": tid}


@router.put("/{tid}/start-groups")
def start_groups(tid: str):
    """Создаёт групповую стадию"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM tournaments WHERE id=%s", (tid,))
    t = cur.fetchone()
    if not t: raise HTTPException(404, "Не найден")
    
    cur.execute("SELECT * FROM tournament_participants WHERE tournament_id=%s", (tid,))
    participants = cur.fetchall()
    n = len(participants)
    if n < 2: raise HTTPException(400, "Мало участников")
    
    random.shuffle(participants)
    
    # Делим на группы
    groups = []
    if n <= 4: groups = [participants]
    elif n <= 8:
        mid = n // 2
        groups = [participants[:mid], participants[mid:]]
    else:
        for i in range(0, n, 4):
            groups.append(participants[i:i+4])
    
    for gi, group in enumerate(groups):
        gn = chr(65 + gi)
        for i in range(len(group)):
            for j in range(i+1, len(group)):
                mid = f"tm_{uuid.uuid4().hex[:10]}"
                cur.execute("INSERT INTO tournament_matches (id,tournament_id,bracket,round,match_number,group_name,player1_id,player2_id,status) VALUES (%s,%s,'groups',0,0,%s,%s,%s,'pending')",
                           (mid, tid, gn, group[i]["id"], group[j]["id"]))
    
    cur.execute("UPDATE tournaments SET status='groups' WHERE id=%s", (tid,))
    conn.commit()
    conn.close()
    return {"ok": True, "groups": len(groups)}


@router.put("/{tid}/generate-playoffs")
def generate_playoffs(tid: str):
    """Генерирует сетки плей-офф из результатов групп"""
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM tournaments WHERE id=%s", (tid,))
    t = cur.fetchone()
    if not t or t["status"] != "groups": raise HTTPException(400, "Не в групповой стадии")
    
    # Считаем очки
    cur.execute("SELECT * FROM tournament_matches WHERE tournament_id=%s AND bracket='groups'", (tid,))
    gm = cur.fetchall()
    
    scores = {}
    for m in gm:
        scores[m["player1_id"]] = scores.get(m["player1_id"], 0)
        scores[m["player2_id"]] = scores.get(m["player2_id"], 0)
        if m["winner_id"] == m["player1_id"]: scores[m["player1_id"]] += 1
        elif m["winner_id"] == m["player2_id"]: scores[m["player2_id"]] += 1
    
    # Группируем
    groups = {}
    for m in gm:
        g = m["group_name"]
        if g not in groups: groups[g] = set()
        groups[g].add(m["player1_id"])
        groups[g].add(m["player2_id"])
    
    winners_seeds = []
    losers_seeds = []
    for g, pids in groups.items():
        srt = sorted(pids, key=lambda x: scores.get(x,0), reverse=True)
        winners_seeds.append(srt[0])
        if len(srt) > 1: winners_seeds.append(srt[1])
        for p in srt[2:]: losers_seeds.append(p)
    
    # Создаём сетки
    create_bracket(conn, tid, "winners", winners_seeds)
    create_bracket(conn, tid, "losers", losers_seeds)
    
    # Grand Finals
    mid = f"tm_{uuid.uuid4().hex[:10]}"
    cur.execute("INSERT INTO tournament_matches (id,tournament_id,bracket,round,match_number,status) VALUES (%s,%s,'grand_finals',1,1,'pending')",
               (mid, tid))
    
    cur.execute("UPDATE tournaments SET status='playoffs' WHERE id=%s", (tid,))
    conn.commit()
    conn.close()
    return {"ok": True}


def create_bracket(conn, tid, bracket, players):
    """Создаёт пустую сетку и заполняет первый раунд"""
    cur = conn.cursor()
    n = len(players)
    if n == 0: return
    
    # Размер сетки
    size = 1
    while size < n: size *= 2
    rounds = size.bit_length()
    
    # Создаём все матчи
    for rnd in range(1, rounds+1):
        matches_in_round = 2 ** (rounds - rnd)
        for mn in range(1, matches_in_round+1):
            mid = f"tm_{uuid.uuid4().hex[:10]}"
            cur.execute("INSERT INTO tournament_matches (id,tournament_id,bracket,round,match_number,status) VALUES (%s,%s,%s,%s,%s,'pending')",
                       (mid, tid, bracket, rnd, mn))
    
    # Заполняем первый раунд
    cur.execute("SELECT * FROM tournament_matches WHERE tournament_id=%s AND bracket=%s AND round=%s ORDER BY match_number",
               (tid, bracket, rounds))
    matches = cur.fetchall()
    for i, m in enumerate(matches):
        p1 = players[i*2] if i*2 < len(players) else None
        p2 = players[i*2+1] if i*2+1 < len(players) else None
        wid = None; st = 'pending'
        if p1 and not p2: wid = p1; st = 'finished'
        elif p2 and not p1: wid = p2; st = 'finished'
        cur.execute("UPDATE tournament_matches SET player1_id=%s, player2_id=%s, winner_id=%s, status=%s WHERE id=%s",
                   (p1, p2, wid, st, m["id"]))
    conn.commit()


@router.put("/matches/{mid}")
def update_match(mid: str, data: MatchUpdate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute("SELECT * FROM tournament_matches WHERE id=%s", (mid,))
    m = cur.fetchone()
    if not m: raise HTTPException(404, "Матч не найден")
    
    pid1 = m["player1_id"]
    pid2 = m["player2_id"]
    
    # Обновляем имена если указаны
    if data.player1_name:
        pid = find_or_create_participant(conn, m["tournament_id"], data.player1_name)
        pid1 = pid
    if data.player2_name:
        pid = find_or_create_participant(conn, m["tournament_id"], data.player2_name)
        pid2 = pid
    
    winner_id = m["winner_id"]
    if data.winner_name:
        wid = find_or_create_participant(conn, m["tournament_id"], data.winner_name)
        winner_id = wid
    
    cur.execute("UPDATE tournament_matches SET player1_id=%s, player2_id=%s, player1_score=%s, player2_score=%s, winner_id=%s, status=%s WHERE id=%s",
               (pid1, pid2, data.player1_score or m["player1_score"], data.player2_score or m["player2_score"], 
                winner_id, data.status or m["status"], mid))
    conn.commit()
    conn.close()
    return {"ok": True}


def find_or_create_participant(conn, tid, name):
    cur = conn.cursor()
    cur.execute("SELECT id FROM tournament_participants WHERE tournament_id=%s AND name=%s", (tid, name))
    row = cur.fetchone()
    if row: return row[0]
    pid = f"tp_{uuid.uuid4().hex[:10]}"
    cur.execute("INSERT INTO tournament_participants (id,tournament_id,name) VALUES (%s,%s,%s)", (pid, tid, name))
    conn.commit()
    return pid


@router.put("/{tid}/finish")
def finish_tournament(tid: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE tournaments SET status='finished', finished_at=%s WHERE id=%s",
               (datetime.now().isoformat(), tid))
    conn.commit()
    conn.close()
    return {"ok": True}
