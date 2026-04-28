// ============ СЧЁТ ============

async function renderBill() {
    const c = document.getElementById('billContent');
    try {
        const orders = await api('GET', `/api/orders?session_id=${currentSessionId}`);
        if (!orders.length) {
            c.innerHTML = '<div class="empty">Счёт пуст</div>';
            return;
        }

        const guestTotals = {};
        const guestDetails = {};
        orders.forEach(o => {
            if (!guestTotals[o.guest_id]) guestTotals[o.guest_id] = 0;
            guestTotals[o.guest_id] += o.price;
            if (!guestDetails[o.guest_id]) guestDetails[o.guest_id] = {};
            if (!guestDetails[o.guest_id][o.drink_id]) {
                const drink = allDrinks.find(d => d.id === o.drink_id);
                guestDetails[o.guest_id][o.drink_id] = { count: 0, price: o.price, name: drink?.name || '?' };
            }
            guestDetails[o.guest_id][o.drink_id].count++;
        });

        let html = '';
        let total = 0;
        for (const [gid, sum] of Object.entries(guestTotals)) {
            total += sum;
            const guest = allGuests.find(g => g.id === gid);
            html += `<div class="card"><h3>👤 ${esc(guest?.name||'Неизвестный')}</h3><table>
                <thead><tr><th>Напиток</th><th>Цена</th><th>×</th><th>Сумма</th></tr></thead><tbody>`;
            for (const [did, d] of Object.entries(guestDetails[gid])) {
                html += `<tr><td>🍹 ${esc(d.name)}</td><td>${d.price}₽</td><td>×${d.count}</td><td><strong>${d.price*d.count}₽</strong></td></tr>`;
            }
            html += `<tfoot><tr><td colspan="3">Итого</td><td>${sum} ₽</td></tr></tfoot></table></div>`;
        }
        html += `<div class="summary"><div style="color:var(--muted);">💸 Общий счёт</div><div class="total">${total} ₽</div></div>`;
        c.innerHTML = html;
    } catch (e) { c.innerHTML = '<div class="empty">Ошибка</div>'; }
}
