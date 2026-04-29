import uuid
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Query

from app.database import get_db
from app.models import GuestCreate, GuestUpdate

router = APIRouter(prefix="/api/guests", tags=["guests"])


@router.get("")
def get_guests(role: str = Query(None)):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)

    query = "SELECT * FROM guests WHERE 1=1"
    params = []

    if role:
        query += " AND role = %s"
        params.append(role)

    query += " ORDER BY role DESC, name"

    cur.execute(query, params)
    result = [dict(r) for r in cur.fetchall()]
    conn.close()
    return result


@router.post("")
def create_guest(guest: GuestCreate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    gid = f"g_{uuid.uuid4().hex[:10]}"
    cur.execute(
        "INSERT INTO guests (id, name, role) VALUES (%s, %s, %s) RETURNING *",
        (gid, guest.name, guest.role))
    result = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return result


@router.put("/{guest_id}")
def update_guest(guest_id: str, guest: GuestUpdate):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)

    cur.execute("SELECT * FROM guests WHERE id = %s", (guest_id,))
    existing = cur.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Гость не найден")

    updates = []
    params = []

    if guest.name is not None:
        updates.append("name = %s")
        params.append(guest.name)
    if guest.role is not None:
        updates.append("role = %s")
        params.append(guest.role)

    if updates:
        params.append(guest_id)
        cur.execute(f"UPDATE guests SET {', '.join(updates)} WHERE id = %s RETURNING *", params)
        result = dict(cur.fetchone())
        conn.commit()
    else:
        result = dict(existing)

    conn.close()
    return result


@router.delete("/{guest_id}")
def delete_guest(guest_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM orders WHERE guest_id = %s", (guest_id,))
    if cur.fetchone()[0] > 0:
        conn.close()
        raise HTTPException(400, "Гость есть в заказах")
    cur.execute("DELETE FROM guests WHERE id = %s", (guest_id,))
    conn.commit()
    conn.close()
    return {"ok": True}
