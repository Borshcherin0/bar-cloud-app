// ============ API МОДУЛЬ ============
const API_BASE = '';

async function api(method, path, body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Ошибка сервера' }));
        throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
}

// Глобальное состояние
let currentSessionId = null;
let allGuests = [];
let allDrinks = [];
let currentReceiptDataUrl = '';
