// ============ АНАЛИТИКА ============

async function renderAnalytics() {
    try {
        const data = await api('GET', '/api/analytics');

        document.getElementById('statsGrid').innerHTML = `
            <div class="stat-card"><div class="stat-val">${data.total_orders}</div><div class="stat-lbl">Заказов</div></div>
            <div class="stat-card"><div class="stat-val">${data.total_revenue}₽</div><div class="stat-lbl">Выручка</div></div>
            <div class="stat-card"><div class="stat-val">${data.sessions_count}</div><div class="stat-lbl">Сессий</div></div>
            <div class="stat-card"><div class="stat-val">${data.guests_count}</div><div class="stat-lbl">Гостей</div></div>
        `;

        // Топ напитков
        const maxD = data.top_drinks[0]?.cnt || 1;
        document.getElementById('drinksChart').innerHTML = data.top_drinks.length ?
            `<div class="bar-chart">${data.top_drinks.map(d => `
                <div class="bar-wrap">
                    <div class="bar" style="height:${(d.cnt/maxD)*100}%;background:var(--accent);">
                        <span class="bar-val">${d.cnt}</span>
                    </div>
                    <div class="bar-lbl">${esc(d.name)}</div>
                </div>`).join('')}</div>` : '<div class="empty">Нет данных</div>';

        // Топ гостей
        const maxG = data.top_guests[0]?.total || 1;
        document.getElementById('guestsChart').innerHTML = data.top_guests.length ?
            `<div class="bar-chart">${data.top_guests.map(g => `
                <div class="bar-wrap">
                    <div class="bar" style="height:${(g.total/maxG)*100}%;background:var(--blue);">
                        <span class="bar-val">${g.total}₽</span>
                    </div>
                    <div class="bar-lbl">${esc(g.name)}</div>
                </div>`).join('')}</div>` : '<div class="empty">Нет данных</div>';
    } catch (e) {
        showToast('Ошибка аналитики', 'err');
    }
}
