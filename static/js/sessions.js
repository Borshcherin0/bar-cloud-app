// ============ СЕССИИ ============

async function loadActiveSession() {
    try {
        const session = await api('GET', '/api/sessions/active');
        currentSessionId = session.id;
        document.getElementById('sessId').textContent = currentSessionId;
    } catch (e) {
        console.error('Ошибка загрузки сессии:', e);
        showToast('Ошибка загрузки сессии', 'err');
    }
}

async function closeAndNewSession() {
    try {
        // Проверяем есть ли активный турнир
        const tournaments = await api('GET', `/api/poker/tournaments?session_id=${currentSessionId}`);
        const active = tournaments.find(t => t.status === 'active');
        
        if (active) {
            // Показываем окно завершения турнира
            showToast('Сначала завершите покерный турнир', 'err');
            await showFinishTournamentBeforeClose(active);
            return;
        }
        
        // Закрываем сессию
        await closeSessionAndStartNew();
    } catch (e) {
        console.error('Ошибка закрытия сессии:', e);
        showToast('Ошибка: ' + e.message, 'err');
    }
}

async function closeSessionAndStartNew() {
    const result = await api('POST', '/api/sessions/close');
    console.log('Сессия закрыта:', result);
    
    const session = await api('GET', '/api/sessions/active');
    currentSessionId = session.id;
    document.getElementById('sessId').textContent = currentSessionId;
    
    await refreshAll();
    showToast('🆕 Новая сессия!');
}

async function showFinishTournamentBeforeClose(tournament) {
    const participants = tournament.participants || [];
    const prizes = typeof tournament.prizes === 'string' ? JSON.parse(tournament.prizes) : tournament.prizes;
    
    let html = `
        <div style="background:var(--card2);padding:12px;border-radius:8px;margin-bottom:12px;">
            <p style="color:var(--gold);margin-bottom:4px;">⚠️ В сессии активен покерный турнир</p>
            <p style="font-size:12px;color:var(--muted);">Его нужно завершить перед закрытием сессии. Распределите места:</p>
        </div>
        
        <div style="margin-bottom:12px;">
            <strong>Бай-ин:</strong> ${tournament.buy_in} ₽ | 
            <strong>Призовых мест:</strong> ${tournament.prize_places}
        </div>
        
        <div style="margin-bottom:4px;color:var(--muted);font-size:12px;">Призы:</div>
        ${prizes.map(p => `
            <div style="font-size:12px;margin-bottom:4px;">
                🏅 ${p.place} место: <strong style="color:var(--gold);">${p.amount} ₽</strong>
            </div>
        `).join('')}
        
        <div style="margin-top:12px;margin-bottom:4px;color:var(--muted);font-size:12px;">Участники:</div>
    `;
    
    participants.forEach(p => {
        html += `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="min-width:100px;">👤 ${esc(p.guest_name)}</span>
                <select id="close_place_${p.guest_id}" class="close-place-select" style="flex:1;">
                    <option value="">— Не призовое —</option>
                    ${Array.from({length: tournament.prize_places}, (_, i) => i + 1).map(place => `
                        <option value="${place}">${place} место (${prizes.find(pr => pr.place === place)?.amount || 0} ₽)</option>
                    `).join('')}
                </select>
            </div>
        `;
    });
    
    html += `
        <div style="display:flex;gap:8px;margin-top:16px;">
            <button class="btn btn-accent" onclick="finishTournamentAndClose('${tournament.id}')" style="flex:1;">
                🏁 Завершить турнир и закрыть сессию
            </button>
            <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
        </div>
    `;
    
    showModal('🏁 Завершение турнира перед закрытием сессии', html);
}

async function finishTournamentAndClose(tournamentId) {
    // Проверяем что места не дублируются
    const places = {};
    const selects = document.querySelectorAll('.close-place-select');
    let hasDuplicates = false;
    
    selects.forEach(select => {
        if (select.value) {
            if (places[select.value]) {
                hasDuplicates = true;
            }
            places[select.value] = true;
        }
    });
    
    if (hasDuplicates) {
        showToast('Каждое место может занять только один участник', 'err');
        return;
    }
    
    // Собираем результаты
    const results = [];
    selects.forEach(select => {
        if (select.value) {
            const guestId = select.id.replace('close_place_', '');
            results.push({ guest_id: guestId, place: parseInt(select.value) });
        }
    });
    
    try {
        // Завершаем турнир
        await api('POST', `/api/poker/tournaments/${tournamentId}/finish`, { results });
        
        // Закрываем сессию
        await closeSessionAndStartNew();
        
        closeModal();
        showToast('✅ Турнир завершён, сессия закрыта');
    } catch (e) {
        showToast(e.message, 'err');
    }
}

async function renderHistory() {
    const c = document.getElementById('sessionsList');
    try {
        const dateFrom = document.getElementById('historyDateFrom')?.value || '';
        const dateTo = document.getElementById('historyDateTo')?.value || '';
        
        const params = new URLSearchParams();
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo + 'T23:59:59');
        
        const queryString = params.toString();
        const sessions = await api('GET', `/api/sessions${queryString ? '?' + queryString : ''}`);
        
        const closed = sessions
            .filter(s => s.closed_at)
            .sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));

        if (!closed.length) {
            c.innerHTML = '<div class="empty">Нет завершённых сессий</div>';
            return;
        }

        c.innerHTML = closed.slice(0, 50).map(s => {
            const d = new Date(s.closed_at).toLocaleString('ru-RU');
            return `<div class="card">
                <h3>📅 ${d}</h3>
                <p>💰 <strong>${s.total_amount || 0} ₽</strong> <span style="font-size:10px;color:var(--muted);">(только гости)</span></p>
                <div class="session-actions">
                    <button class="btn btn-outline btn-sm" data-action="viewSession" data-id="${s.id}">👁 Детали</button>
                    <button class="btn btn-gold btn-sm" data-action="downloadReceipt" data-id="${s.id}">🧾 Чек</button>
                    <button class="btn btn-danger btn-sm" data-action="deleteSession" data-id="${s.id}">🗑</button>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        console.error('Ошибка истории:', e);
        c.innerHTML = '<div class="empty">Ошибка загрузки</div>';
    }
}

async function viewSession(sid) {
    try {
        const [orders, guests, drinks] = await Promise.all([
            api('GET', `/api/orders?session_id=${sid}`),
            api('GET', '/api/guests'),
            api('GET', '/api/drinks'),
        ]);

        // Разделяем гостей и сотрудников
        const guestOrders = orders.filter(o => {
            const guest = guests.find(g => g.id === o.guest_id);
            return guest && guest.role !== 'staff';
        });
        
        const staffOrders = orders.filter(o => {
            const guest = guests.find(g => g.id === o.guest_id);
            return guest && guest.role === 'staff';
        });

        let msg = `🧾 Сессия ${sid}\n\n`;
        
        // Гости
        if (guestOrders.length > 0) {
            msg += `👤 ГОСТИ:\n`;
            const groups = {};
            for (const o of guestOrders) {
                const guest = guests.find(g => g.id === o.guest_id);
                const drink = drinks.find(d => d.id === o.drink_id);
                const k = `${guest?.name||'?'} — ${drink?.name||'?'}`;
                if (!groups[k]) groups[k] = { count: 0, sum: 0 };
                groups[k].count++;
                groups[k].sum += o.price;
            }
            for (const [k, v] of Object.entries(groups)) {
                msg += `  ${k}: ×${v.count} = ${v.sum} ₽\n`;
            }
            msg += `  Итого гости: ${guestOrders.reduce((s,o)=>s+o.price,0)} ₽\n\n`;
        }
        
        // Сотрудники (информационно)
        if (staffOrders.length > 0) {
            msg += `👔 СОТРУДНИКИ (не в счёте):\n`;
            const staffGroups = {};
            for (const o of staffOrders) {
                const guest = guests.find(g => g.id === o.guest_id);
                const drink = drinks.find(d => d.id === o.drink_id);
                const k = `${guest?.name||'?'} — ${drink?.name||'?'}`;
                if (!staffGroups[k]) staffGroups[k] = { count: 0, sum: 0 };
                staffGroups[k].count++;
                staffGroups[k].sum += o.price;
            }
            for (const [k, v] of Object.entries(staffGroups)) {
                msg += `  ${k}: ×${v.count} = ${v.sum} ₽\n`;
            }
        }
        
        msg += `\n💸 Итого к оплате (гости): ${guestOrders.reduce((s,o)=>s+o.price,0)} ₽`;
        alert(msg);
    } catch (e) { 
        console.error('Ошибка просмотра сессии:', e);
        showToast(e.message, 'err'); 
    }
}

async function deleteSession(sid) {
    if (!confirm('Удалить сессию и все заказы?')) return;
    try {
        await api('DELETE', `/api/sessions/${sid}`);
        await renderHistory();
        showToast('🗑 Сессия удалена');
    } catch (e) { 
        console.error('Ошибка удаления сессии:', e);
        showToast(e.message, 'err'); 
    }
}
