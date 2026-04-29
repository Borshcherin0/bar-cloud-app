// ============ АНАЛИТИКА ============

async function renderAnalytics() {
    try {
        const dateFrom = document.getElementById('analyticsDateFrom')?.value || '';
        const dateTo = document.getElementById('analyticsDateTo')?.value || '';
        
        const params = new URLSearchParams();
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo + 'T23:59:59');
        
        const queryString = params.toString();
        const [data, pokerData] = await Promise.all([
            api('GET', `/api/analytics${queryString ? '?' + queryString : ''}`),
            api('GET', '/api/analytics/poker'),
        ]);

        // Статистика
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

        // Выручка по дням
        if (data.revenue_by_day && data.revenue_by_day.length > 0) {
            const maxR = Math.max(...data.revenue_by_day.map(d => d.total));
            document.getElementById('revenueChart').innerHTML = `
                <div class="bar-chart">${data.revenue_by_day.reverse().map(d => `
                    <div class="bar-wrap">
                        <div class="bar" style="height:${(d.total/maxR)*100}%;background:var(--green);">
                            <span class="bar-val">${d.total}₽</span>
                        </div>
                        <div class="bar-lbl">${new Date(d.day).toLocaleDateString('ru-RU', {day:'numeric',month:'short'})}</div>
                    </div>`).join('')}</div>`;
        }

        // ПОКЕРНАЯ СТАТИСТИКА
        renderPokerStats(pokerData);
        
    } catch (e) {
        console.error('Ошибка аналитики:', e);
        showToast('Ошибка аналитики', 'err');
    }
}

function renderPokerStats(data) {
    if (!data) return;
    
    const container = document.getElementById('pokerStatsSection');
    if (!container) return;
    
    if (data.total_tournaments === 0) {
        container.innerHTML = '<div class="card"><h3>♠️ Покерная статистика</h3><div class="empty">Нет данных о турнирах</div></div>';
        return;
    }
    
    let html = `
        <div class="card" style="border-left: 3px solid var(--gold);">
            <h3>♠️ Покерная статистика</h3>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-val">${data.total_tournaments}</div>
                    <div class="stat-lbl">Всего турниров</div>
                </div>
                <div class="stat-card">
                    <div class="stat-val">${data.finished_tournaments}</div>
                    <div class="stat-lbl">Завершено</div>
                </div>
                <div class="stat-card">
                    <div class="stat-val">${data.total_buyins}₽</div>
                    <div class="stat-lbl">Сумма бай-инов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-val">${data.avg_buyin}₽</div>
                    <div class="stat-lbl">Средний бай-ин</div>
                </div>
            </div>`;
    
    // Топ победителей
    if (data.top_winners && data.top_winners.length > 0) {
        html += `<h4 style="color:var(--gold);margin-bottom:8px;">🏆 Топ победителей</h4>
            <table>
                <thead><tr><th>Игрок</th><th>🥇</th><th>🥈</th><th>🥉</th><th>Всего побед</th></tr></thead>
                <tbody>`;
        
        data.top_winners.forEach(p => {
            html += `<tr>
                <td>👤 ${esc(p.name)}</td>
                <td>${p.first_places || 0}</td>
                <td>${p.second_places || 0}</td>
                <td>${p.third_places || 0}</td>
                <td><strong>${p.wins}</strong></td>
            </tr>`;
        });
        
        html += `</tbody></table>`;
    }
    
    // Статистика по бай-инам
    if (data.buyin_stats && data.buyin_stats.length > 0) {
        html += `<h4 style="color:var(--gold);margin:12px 0 8px;">💰 По бай-инам</h4>
            <table>
                <thead><tr><th>Бай-ин</th><th>Турниров</th><th>Завершено</th></tr></thead>
                <tbody>`;
        
        data.buyin_stats.forEach(b => {
            html += `<tr>
                <td>${b.buy_in} ₽</td>
                <td>${b.count}</td>
                <td>${b.finished}</td>
            </tr>`;
        });
        
        html += `</tbody></table>`;
    }
    
    html += '</div>';
    
    container.innerHTML = html;
}
