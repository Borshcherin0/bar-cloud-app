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
            return;
        }

        const groups = {};
        orders.forEach(o => {
            const k = `${o.guest_id}|${o.drink_id}`;
            if (!groups[k]) groups[k] = { guest_id: o.guest_id, drink_id: o.drink_id, count: 0, total: 0 };
            groups[k].count++;
            groups[k].total += o.price;
        });

        c.innerHTML = Object.values(groups).map(g => {
            const guest = allGuests.find(x => x.id === g.guest_id);
            const drink = allDrinks.find(x => x.id === g.drink_id);
            return `
                <div class="list-item">
                    <span>👤 ${esc(guest?.name)} — 🍹 ${esc(drink?.name)}</span>
                    <div class="counter">
                        <span style="color:var(--muted);">×${g.count}</span>
                        <span class="counter-val">${g.total}₽</span>
                        <button class="btn btn-danger btn-sm" data-action="removeOne" data-guest="${g.guest_id}" data-drink="${g.drink_id}">−1</button>
                        <button class="btn btn-outline btn-sm" data-action="removeAll" data-guest="${g.guest_id}" data-drink="${g.drink_id}">✕</button>
                    </div>
                </div>`;
        }).join('');
    } catch (e) { c.innerHTML = '<div class="empty">Ошибка загрузки</div>'; }
}

async function removeOne(gid, did) {
    try {
        const orders = await api('GET', `/api/orders?session_id=${currentSessionId}`);
        const order = orders.findLast(o => o.guest_id === gid && o.drink_id === did);
        if (order) {
            await api('DELETE', `/api/orders/${order.id}`);
            await renderOrders();
            showToast('−1');
        }
    } catch (e) { showToast(e.message, 'err'); }
}

async function removeAll(gid, did) {
    try {
        const orders = await api('GET', `/api/orders?session_id=${currentSessionId}`);
        for (const o of orders.filter(o => o.guest_id === gid && o.drink_id === did)) {
            await api('DELETE', `/api/orders/${o.id}`);
        }
        await renderOrders();
        showToast('🗑 Группа удалена');
    } catch (e) { showToast(e.message, 'err'); }
}
