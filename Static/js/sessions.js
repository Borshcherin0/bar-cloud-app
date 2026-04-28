// ============ СЕССИИ ============

async function loadActiveSession() {
    const session = await api('GET', '/api/sessions/active');
    currentSessionId = session.id;
    document.getElementById('sessId').textContent = currentSessionId;
}

async function closeAndNewSession() {
    try {
        await api('POST', '/api/sessions/close');
        await loadActiveSession();
        await refreshAll();
        showToast('🆕 Новая сессия!');
    } catch (e) { showToast(e.message, 'err'); }
}

async function renderHistory() {
    const c = document.getElementById('sessionsList');
    try {
        const sessions = await api('GET', '/api/sessions');
        const closed = sessions.filter(s => s.closed_at)
            .sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));

        if (!closed.length) {
            c.innerHTML = '<div class="empty">Нет завершённых сессий</div>';
            return;
        }

        c.innerHTML = closed.slice(0, 20).map(s => {
            const d = new Date(s.closed_at).toLocaleString('ru-RU');
            return `<div class="card">
                <h3>📅 ${d}</h3>
                <p>💰 <strong>${s.total_amount} ₽</strong></p>
                <div class="session-actions">
                    <button class="btn btn-outline btn-sm" data-action="viewSession" data-id="${s.id}">👁 Детали</button>
                    <button class="btn btn-gold btn-sm" data-action="downloadReceipt" data-id="${s.id}">🧾 Чек</button>
                    <button class="btn btn-danger btn-sm" data-action="deleteSession" data-id="${s.id}">🗑</button>
                </div>
            </div>`;
        }).join('');
    } catch (e) { c.innerHTML = '<div class="empty">Ошибка</div>'; }
}

async function viewSession(sid) {
    try {
        const [orders, guests, drinks] = await Promise.all([
            api('GET', `/api/orders?session_id=${sid}`),
            api('GET', '/api/guests'),
            api('GET', '/api/drinks'),
        ]);

        let msg = `Сессия ${sid}\n\n`;
        const groups = {};
        for (const o of orders) {
            const guest = guests.find(g => g.id === o.guest_id);
            const drink = drinks.find(d => d.id === o.drink_id);
            const k = `${guest?.name||'?'} — ${drink?.name||'?'}`;
            if (!groups[k]) groups[k] = { count: 0, sum: 0 };
            groups[k].count++;
            groups[k].sum += o.price;
        }
        for (const [k, v] of Object.entries(groups)) {
            msg += `${k}: ×${v.count} = ${v.sum} ₽\n`;
        }
        msg += `\nИтого: ${orders.reduce((s,o)=>s+o.price,0)} ₽`;
        alert(msg);
    } catch (e) { showToast(e.message, 'err'); }
}

async function deleteSession(sid) {
    if (!confirm('Удалить сессию и все заказы?')) return;
    try {
        await api('DELETE', `/api/sessions/${sid}`);
        await renderHistory();
        showToast('🗑 Сессия удалена');
    } catch (e) { showToast(e.message, 'err'); }
}
