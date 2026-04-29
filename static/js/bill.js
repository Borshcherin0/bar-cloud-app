// ============ СЧЁТ (без сотрудников) ============

async function renderBill() {
    const c = document.getElementById('billContent');
    try {
        const orders = await api('GET', `/api/orders?session_id=${currentSessionId}`);
        if (!orders.length) {
            c.innerHTML = '<div class="empty">Счёт пуст</div>';
            return;
        }

        // Разделяем заказы гостей и сотрудников
        const guestOrders = orders.filter(o => {
            const guest = allGuests.find(g => g.id === o.guest_id);
            return guest && guest.role !== 'staff';
        });
        
        const staffOrders = orders.filter(o => {
            const guest = allGuests.find(g => g.id === o.guest_id);
            return guest && guest.role === 'staff';
        });

        const guestTotals = {};
        const guestDetails = {};
        
        // Считаем только гостей
        guestOrders.forEach(o => {
            if (!guestTotals[o.guest_id]) guestTotals[o.guest_id] = 0;
            guestTotals[o.guest_id] += o.price;
            if (!guestDetails[o.guest_id]) guestDetails[o.guest_id] = {};
            if (!guestDetails[o.guest_id][o.drink_id]) {
                const drink = allDrinks.find(d => d.id === o.drink_id);
                guestDetails[o.guest_id][o.drink_id] = { 
                    count: 0, 
                    price: o.price, 
                    name: drink?.name || '?' 
                };
            }
            guestDetails[o.guest_id][o.drink_id].count++;
        });

        let html = '';
        let guestTotal = 0;

        // Счёт гостей
        if (Object.keys(guestTotals).length > 0) {
            html += '<div class="card" style="border-left: 3px solid var(--accent);"><h3>👤 Счёт для гостей</h3>';
            
            for (const [gid, sum] of Object.entries(guestTotals)) {
                guestTotal += sum;
                const guest = allGuests.find(g => g.id === gid);
                html += `<div style="margin-bottom:12px;">
                    <h4 style="color:var(--text);margin-bottom:4px;">👤 ${esc(guest?.name||'Неизвестный')}</h4>
                    <table>
                        <thead><tr><th>Напиток</th><th>Цена</th><th>×</th><th>Сумма</th></tr></thead><tbody>`;
                for (const [did, d] of Object.entries(guestDetails[gid])) {
                    html += `<tr>
                        <td>🍹 ${esc(d.name)}</td>
                        <td>${d.price}₽</td>
                        <td>×${d.count}</td>
                        <td><strong>${d.price*d.count}₽</strong></td>
                    </tr>`;
                }
                html += `<tfoot><tr><td colspan="3">Итого</td><td>${sum} ₽</td></tr></tfoot></table></div>`;
            }
            html += '</div>';
        }

        // Сотрудники (информационно, без итога)
        if (staffOrders.length > 0) {
            const staffTotals = {};
            staffOrders.forEach(o => {
                if (!staffTotals[o.guest_id]) staffTotals[o.guest_id] = 0;
                staffTotals[o.guest_id] += o.price;
            });
            
            html += '<div class="card" style="border-left: 3px solid var(--blue);">';
            html += '<h3>👔 Сотрудники <span style="color:var(--muted);font-size:0.7em;">(не входят в счёт)</span></h3>';
            
            for (const [gid, sum] of Object.entries(staffTotals)) {
                const guest = allGuests.find(g => g.id === gid);
                html += `<div class="list-item">
                    <span>👔 ${esc(guest?.name||'Неизвестный')}</span>
                    <span style="color:var(--muted);">${sum} ₽</span>
                </div>`;
            }
            html += '</div>';
        }

        // Итог
        if (guestTotal > 0 || Object.keys(guestTotals).length > 0) {
            html += `<div class="summary">
                <div style="color:var(--muted);">💸 Счёт для гостей</div>
                <div class="total">${guestTotal} ₽</div>
                <div style="color:var(--muted);font-size:0.8em;margin-top:4px;">
                    На ${Object.keys(guestTotals).length} гостей
                </div>
            </div>`;
        } else {
            html += '<div class="empty">Счёт для гостей пуст</div>';
        }

        c.innerHTML = html;
    } catch (e) { 
        console.error('Ошибка счёта:', e);
        c.innerHTML = '<div class="empty">Ошибка загрузки</div>'; 
    }
}
