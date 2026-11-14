import hashlib
import secrets
from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, conint

from app.database import get_db
from app.tournament_bracket import build_bracket, resolve_bracket

from app.tournament_groups import (
    advance_group, group_table, make_group, playoff_places, playoff_view,
)

router = APIRouter(prefix="/api/leaderboards", tags=["leaderboards"])
COOKIE = "bar_tournaments_session"
SESSION_SECONDS = 8 * 3600
schema_ready = False
schema_lock = Lock()


def ensure_schema():
    global schema_ready
    with schema_lock:
        if schema_ready:
            return
        with get_db() as conn:
            conn.execute("SELECT pg_advisory_xact_lock(21745981)")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS leaderboard_tournaments (
                    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    state jsonb NOT NULL,
                    version integer NOT NULL DEFAULT 1
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS leaderboard_sessions (
                    token_hash text PRIMARY KEY,
                    expires_at timestamptz NOT NULL
                )
            """)
        schema_ready = True


class Login(BaseModel):
    password: str


class Create(BaseModel):
    title: str
    format: Literal["single", "double", "table", "group"]
    players: list[str]
    buy_in: Optional[conint(strict=True, ge=1, le=1000000)] = None


class Update(BaseModel):
    version: conint(strict=True, ge=1)
    action: Literal["score", "rebuy", "eliminate", "undo"]
    target: conint(strict=True, ge=0) = 0
    score: Optional[list[conint(strict=True, ge=0, le=99)]] = None
    confirm: bool = False


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def require_session(request: Request):
    ensure_schema()
    token = request.cookies.get(COOKIE)
    if token:
        with get_db() as conn:
            session = conn.execute("""
                SELECT 1 FROM leaderboard_sessions
                WHERE token_hash = %s AND expires_at > now()
            """, (digest(token),)).fetchone()
        if session:
            return
    raise HTTPException(401, "Войдите, чтобы управлять турнирами")


@router.post("/login", status_code=204)
def login(data: Login, request: Request, response: Response):
    ensure_schema()
    with get_db() as conn:
        row = conn.execute("SELECT admin_password FROM bot_settings WHERE id = 1").fetchone()
        if not row or not row[0] or not secrets.compare_digest(
                data.password.encode(), row[0].encode()):
            raise HTTPException(403, "Неверный пароль админки")
        token = secrets.token_urlsafe(32)
        conn.execute("DELETE FROM leaderboard_sessions WHERE expires_at <= now() OR token_hash = %s",
                     (digest(request.cookies.get(COOKIE, "")),))
        conn.execute("""
            INSERT INTO leaderboard_sessions VALUES (%s, now() + interval '8 hours')
        """, (digest(token),))
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True,
                        secure=request.url.scheme == "https", samesite="strict", path="/api/leaderboards")


@router.delete("/login", status_code=204)
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token:
        ensure_schema()
        with get_db() as conn:
            conn.execute("DELETE FROM leaderboard_sessions WHERE token_hash = %s", (digest(token),))
    response.delete_cookie(COOKIE, path="/api/leaderboards")


@router.get("/session", status_code=204, dependencies=[Depends(require_session)])
def session():
    pass


def poker_prizes(buy_in, players, rebuys):
    """Split entry fees and rebuy fees, then round once to whole rubles."""
    weights = {1: ([100], [100]), 2: ([65, 35], [60, 40]),
               3: ([50, 30, 20], [50, 40, 10])}
    entry_weights, rebuy_weights = weights[(players + 1) // 2]
    pool = buy_in * (players + rebuys)
    shares = [
        buy_in * (players * entry + rebuys * extra)
        for entry, extra in zip(entry_weights, rebuy_weights)
    ]
    prizes = [share // 100 for share in shares]
    order = sorted(range(len(shares)), key=lambda i: (-(shares[i] % 100), i))
    for index in order[:pool - sum(prizes)]:
        prizes[index] += 1
    return pool, prizes


def preview(row):
    state = {key: value for key, value in row["state"].items() if key != "undo"}
    if state["format"] == "group":
        state["matches"] = playoff_view(state["matches"])[0]
        state["tables"] = [group_table(group, len(state["players"])) for group in state["groups"]]
    elif state["format"] == "table":
        state.pop("chips", None)
        if state.get("buy_in") is not None:
            state["prize_pool"], state["prizes"] = poker_prizes(
                state["buy_in"], len(state["players"]), sum(state["rebuys"]),
            )
    else:
        state["matches"] = resolve_bracket(state["matches"])[0]
    return {"id": str(row["id"]), "version": row["version"],
            "can_undo": bool(row["state"].get("undo")), **state}


def legacy_poker(conn):
    rows = conn.execute("""
        SELECT t.id, t.finished_at, p.place, g.name
        FROM poker_tournaments t
        JOIN poker_participants p ON p.tournament_id = t.id
        JOIN guests g ON g.id = p.guest_id
        WHERE t.status = 'finished' AND p.place > 0
        ORDER BY t.finished_at DESC NULLS LAST, t.id, p.place, g.name
    """).fetchall()
    items = {}
    for tournament_id, finished, place, name in rows:
        entry = items.setdefault(tournament_id, {
            "id": "poker-" + str(tournament_id), "title": "Покерный турнир",
            "format": "table", "finished": str(finished) if finished else None,
            "legacy": True, "players": [], "places": [],
        })
        entry["players"].append(name)
        entry["places"].append(place)
    return [entry for entry in items.values() if 1 in entry["places"]]


@router.get("")
def list_tournaments():
    ensure_schema()
    with get_db() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT id, state, version FROM leaderboard_tournaments ORDER BY id DESC")
            entries = [preview(row) for row in cur.fetchall()]
        entries.extend(legacy_poker(conn))
    entries.sort(key=lambda item: item.get("finished") or item.get("created") or "", reverse=True)
    return entries


@router.post("", status_code=201, dependencies=[Depends(require_session)])
def create(data: Create):
    title = data.title.strip()
    players = [" ".join(name.split()) for name in data.players]
    limit = 6 if data.format == "table" else 32
    if not 1 <= len(title) <= 80:
        raise HTTPException(422, "Введите название до 80 символов")
    if not 2 <= len(players) <= limit or any(not 1 <= len(p) <= 40 for p in players):
        raise HTTPException(422, f"Нужно от 2 до {limit} участников. Имя — до 40 символов")
    if len({name.casefold() for name in players}) != len(players):
        raise HTTPException(422, "Имена участников должны различаться")

    state = {
        "title": title, "format": data.format, "players": players,
        "created": now(), "finished": None, "places": [None] * len(players),
    }
    if data.format == "table":
        if data.buy_in is None:
            raise HTTPException(422, "Укажите бай-ин в рублях")
        state.update(buy_in=data.buy_in, rebuys=[0] * len(players))
    elif data.format == "group":
        state["groups"] = [make_group(len(players), 1)]
        state["matches"] = []
    else:
        state["matches"] = build_bracket(players, data.format == "double")
    with get_db() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""
            INSERT INTO leaderboard_tournaments (state) VALUES (%s)
            RETURNING id, state, version
        """, (Jsonb(state),))
        return preview(cur.fetchone())


def update_bracket(state, data):
    resolved, _, _ = resolve_bracket(state["matches"])
    if data.target < 1 or data.target > len(resolved):
        raise HTTPException(404, "Матч не найден")
    current = resolved[data.target - 1]
    if not current["ready"] or current["done"]:
        raise HTTPException(409, "Этот матч сейчас нельзя изменить")
    if data.score is None or len(data.score) != 2:
        raise HTTPException(422, "Введите счёт обоих игроков")
    if data.confirm and data.score[0] == data.score[1]:
        raise HTTPException(422, "Для завершения матча нужен победитель")
    match = state["matches"][data.target - 1]
    match.update(score=data.score, confirmed=data.confirm)
    resolved, champion, reset_needed = resolve_bracket(state["matches"])
    if reset_needed:
        final = resolved[-1]
        state["matches"].append({
            "id": final["id"] + 1, "group": "reset", "round": 1,
            "sources": [("loss", final["id"]), ("win", final["id"])],
            "score": None, "confirmed": False,
        })
    losses = {}
    places = [None] * len(state["players"])
    threshold = 2 if state["format"] == "double" else 1
    # Elimination order in the bracket is deterministic even if independent
    # matches are played in a different order. Same-round eliminations tie.
    for match in resolved:
        if not match["confirmed"]:
            continue
        loser = next(player for player in match["players"] if player != match["winner"])
        losses[loser] = losses.get(loser, 0) + 1
    remaining = len(places)
    groups = {}
    for match in reversed(resolved):
        if not match["confirmed"]:
            continue
        loser = next(player for player in match["players"] if player != match["winner"])
        if losses[loser] == threshold:
            groups.setdefault((match["group"], match["round"]), []).append(loser)
        losses[loser] -= 1
    if champion is not None:
        places[champion] = 1
        rank = 2
        for players in groups.values():
            for player in players:
                places[player] = rank
            rank += len(players)
        state["finished"] = now()
    else:
        for players in reversed(list(groups.values())):
            remaining -= len(players)
            for player in players:
                places[player] = remaining + 1
    state["places"] = places


def update_group_tournament(state, data):
    if state["matches"]:
        matches = playoff_view(state["matches"])[0]
        current = next((m for m in matches if m["id"] == data.target), None)
        stored = next((m for m in state["matches"] if m["id"] == data.target), None)
    else:
        current = stored = next((m for m in state["groups"][-1] if m["id"] == data.target), None)
    if not current:
        raise HTTPException(404, "Матч не найден")
    if not current["ready"] or current["done"]:
        raise HTTPException(409, "Этот матч сейчас нельзя изменить")

    target = current["wins_required"]
    score = data.score
    if score is None or len(score) != 2 or max(score) > target or min(score) >= target:
        raise HTTPException(422, f"Введите допустимый счёт для матча до {target} побед")
    if data.confirm and max(score) != target:
        raise HTTPException(422, f"Для завершения матча один игрок должен набрать {target} побед")

    stored.update(score=score, confirmed=data.confirm)
    if not state["matches"]:
        if data.confirm:
            stored.update(done=True, winner=stored["players"][int(score[1] > score[0])])
            advance_group(state)
        return

    resolved, champion = playoff_view(state["matches"])
    if champion is not None:
        state["places"] = playoff_places(resolved, champion, len(state["players"]))
        state["finished"] = now()


def update_table(state, data):
    places = state["places"]
    index = data.target
    if index >= len(places) or places[index] is not None:
        raise HTTPException(409, "Этот игрок уже выбыл или не найден")
    if data.action == "rebuy":
        if "rebuys" not in state:
            raise HTTPException(422, "Ребаи доступны в турнирах Sit & Go с указанным бай-ином")
        state["rebuys"][index] += 1
        return
    if data.action != "eliminate":
        raise HTTPException(422, "Для покера выберите ребай или вылет")
    remaining = places.count(None)
    places[index] = remaining
    if remaining == 2:
        places[places.index(None)] = 1
        state["finished"] = now()


@router.patch("/{tournament_id}", dependencies=[Depends(require_session)])
def update(tournament_id: int, data: Update):
    with get_db() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""
            SELECT id, state, version FROM leaderboard_tournaments WHERE id = %s FOR UPDATE
        """, (tournament_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Турнир не найден")
        if data.version != row["version"]:
            raise HTTPException(409, "Турнир уже обновился. Обновите страницу турнира")
        state = row["state"]
        if data.action == "undo":
            previous = state.get("undo")
            if not previous:
                raise HTTPException(409, "Нет изменений для отмены")
            state = previous
        else:
            if state["finished"]:
                raise HTTPException(409, "Турнир уже завершён")
            previous = deepcopy({key: value for key, value in state.items() if key != "undo"})
            if state["format"] == "table":
                update_table(state, data)
            elif data.action == "score":
                if state["format"] == "group":
                    update_group_tournament(state, data)
                else:
                    update_bracket(state, data)
            else:
                raise HTTPException(422, "Для сетки можно сохранить только счёт матча")
            state["undo"] = previous
        cur.execute("""
            UPDATE leaderboard_tournaments SET state = %s, version = version + 1
            WHERE id = %s RETURNING id, state, version
        """, (Jsonb(state), tournament_id))
        return preview(cur.fetchone())


@router.delete("/{tournament_id}", status_code=204, dependencies=[Depends(require_session)])
def remove(tournament_id: int, version: int):
    with get_db() as conn:
        result = conn.execute("DELETE FROM leaderboard_tournaments WHERE id = %s AND version = %s",
                              (tournament_id, version))
        if not result.rowcount:
            raise HTTPException(409, "Турнир уже изменился или удалён")
