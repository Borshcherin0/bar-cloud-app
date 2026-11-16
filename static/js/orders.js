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
    const container = document.getElementById('ordersList');
    const sessionId = currentSessionId;
    try {
        const orders = await api('GET', `/api/orders?session_id=${sessionId}`);
        if (sessionId !== currentSessionId) return;
        if (!orders.length) {
            container.innerHTML = '<div class="empty">Заказов нет</div>';
            return;
        }

        const accounts = new Map();
        for (const order of orders) {
            if (!accounts.has(order.guest_id)) {
                const guest = allGuests.find(item => item.id === order.guest_id);
                accounts.set(order.guest_id, { guest, items: new Map(), total: 0 });
            }
            const account = accounts.get(order.guest_id);
            if (!account.items.has(order.drink_id)) {
                const drink = allDrinks.find(item => item.id === order.drink_id);
                account.items.set(order.drink_id, { name: drink?.name, count: 0, total: 0 });
            }
            const item = account.items.get(order.drink_id);
            item.count++;
            item.total += order.price;
            account.total += order.price;
        }

        const guestAccounts = [];
        const otherAccounts = [];
        let guestTotal = 0;
        for (const [guestId, account] of accounts) {
            if (account.guest && account.guest.role !== 'staff') {
                guestAccounts.push(renderOrderAccount(guestId, account));
                guestTotal += account.total;
            } else {
                otherAccounts.push(renderOrderAccount(guestId, account));
            }
        }

        container.innerHTML = `
            ${guestAccounts.join('')}
            ${otherAccounts.join('')}
            <div class="summary">
                <div>💸 Итого к оплате гостями</div>
                <div class="total">${guestTotal} ₽</div>
            </div>`;
    } catch (e) {
        if (sessionId === currentSessionId) {
            container.innerHTML = '<div class="empty">Ошибка загрузки</div>';
        }
    }
}

function renderOrderAccount(guestId, { guest, items, total }) {
    const icon = guest?.role === 'staff' ? '👔' : '👤';
    const accountLabel = !guest || guest.role === 'staff'
        ? '<small> · Вне гостевого счёта</small>'
        : '';
    const rows = Array.from(items, ([drinkId, item]) => `
        <div class="list-item">
            <span>🍹 ${esc(item.name || 'Неизвестная позиция')}</span>
            <div class="counter">
                <span>×${item.count}</span>
                <span class="counter-val">${item.total} ₽</span>
                <button type="button" class="btn btn-danger btn-sm" data-action="removeOne"
                    aria-label="Убрать одну позицию" data-guest="${guestId}" data-drink="${drinkId}">−1</button>
                <button type="button" class="btn btn-outline btn-sm" data-action="removeAll"
                    aria-label="Удалить все единицы позиции" data-guest="${guestId}" data-drink="${drinkId}">✕</button>
            </div>
        </div>`).join('');

    return `<div class="card">
        <h4>${icon} ${esc(guest?.name || 'Неизвестный гость')} · ${total} ₽${accountLabel}</h4>
        ${rows}
    </div>`;
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
        showToast('🗑 Группа удалена');
    } catch (e) {
        showToast(e.message, 'err');
    } finally {
        await renderOrders();
    }
}
