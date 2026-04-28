// ============ АНАЛИТИКА ============
async function renderAnalytics() {
    try {
        const dateFrom = document.getElementById('analyticsDateFrom')?.value || '';
        const dateTo = document.getElementById('analyticsDateTo')?.value || '';
        
        const params = new URLSearchParams();
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo + 'T23:59:59');
        
        const queryString = params.toString();
        const data = await api('GET', `/api/analytics${queryString ? '?' + queryString : ''}`);

        document.getElementById('statsGrid').innerHTML = `
            <div class="stat-card"><div class="stat-val">${data.total_orders}</div><div class="stat-lbl">Заказов</div></div>
            <div class="stat-card"><div class="stat-val">${data.total_revenue}₽</div><div class="stat-lbl">Выручка</div></div>
            <div class="stat-card"><div class="stat-val">${data.sessions_count}</div><div class="stat-lbl">Сессий</div></div>
            <div class="stat-card"><div class="stat-val">${data.guests_count}</div><div class="stat-lbl">Гостей</div></div>
        `;

        // Топ напитков с категориями
        const maxD = data.top_drinks[0]?.cnt || 1;
        document.getElementById('drinksChart').innerHTML = data.top_drinks.length ?
            `<div class="bar-chart">${data.top_drinks.map(d => `
                <div class="bar-wrap">
                    <div class="bar" style="height:${(d.cnt/maxD)*100}%;background:var(--accent);">
                        <span class="bar-val">${d.cnt}</span>
                    </div>
                    <div class="bar-lbl">${esc(d.name)}<br><span style="font-size:7px;color:var(--gold);">${d.category||''}</span></div>
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
                
        // График выручки по дням
        if (data.revenue_by_day && data.revenue_by_day.length > 0) {
            const chartContainer = document.getElementById('revenueChart');
            if (chartContainer) {
                const maxR = data.revenue_by_day[0]?.total || 1;
                chartContainer.innerHTML = `<div class="bar-chart">${data.revenue_by_day.reverse().map(d => `
                    <div class="bar-wrap">
                        <div class="bar" style="height:${(d.total/maxR)*100}%;background:var(--green);">
                            <span class="bar-val">${d.total}₽</span>
                        </div>
                        <div class="bar-lbl">${new Date(d.day).toLocaleDateString('ru-RU', {day:'numeric',month:'short'})}</div>
                    </div>`).join('')}</div>`;
            }
        }
    } catch (e) {
        console.error('Ошибка аналитики:', e);
        showToast('Ошибка аналитики', 'err');
    }
}
