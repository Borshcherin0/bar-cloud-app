// ============ ЗАКАЗЫ ============

async function addOrder() {
    const gid = document.getElementById('barGuest').value;
    const did = document.getElementById('barDrink').value;
    if (!gid || !did) return showToast('Выбери гостя и напиток', 'err');
    try {
        await api('POST', '/api/orders', { session_id: currentSessionId, guest_id: gid, drink_id: did });
        await renderOrders();
        const guest = allGuests.find(g => g.id === gid);
        const drink = allDrinks.find(d => d.id === did);
        showToast(`📝 ${guest?.name||'?'} → ${drink?.name||'?'}`);
    } catch (e) { showToast(e.message, 'err'); }
}

async function renderOrders() {
    const c = document.getElementById('ordersList');
    try {
        const orders = await api('GET', `/api/orders?session_id=${currentSessionId}`);
        if (!orders.length) {
            c.innerHTML = '<div class="empty">Заказов нет</div>';
