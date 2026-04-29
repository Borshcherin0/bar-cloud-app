// ============ ПОКЕРНЫЕ ТУРНИРЫ ============

async function loadActiveTournament() {
    try {
        const tournaments = await api('GET', `/api/poker/tournaments?session_id=${currentSessionId}`);
        const active = tournaments.find(t => t.status === 'active');
        
        if (active) {
            renderActiveTournament(active);
        } else {
            renderNoTournament();
        }
    } catch (e) {
        console.error('Ошибка загрузки турнира:', e);
    }
}

function renderNoTournament() {
    const container = document.getElementById('pokerSection');
    container.innerHTML = `
        <div class="card" style="border-left: 3px solid var(--gold);">
            <h3>♠️ Покерный турнир</h3>
            <p style="color:var(--muted);margin-bottom:12px;">Нет активного турнира</p>
            <button class="btn btn-gold" onclick="showCreateTournament()">
                🏆 Начать покерный турнир
            </button>
        </div>
    `;
}

function renderActiveTournament(tournament) {
    const container = document.getElementById('pokerSection');
    const participants = tournament.participants || [];
    
    container.innerHTML = `
        <div class="card" style="border-left: 3px solid var(--green);">
            <h3>♠️ Покерный турнир <span style="color:var(--green);font-size:0.7em;">(активен)</span></h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;">
                <div><strong>Бай-ин:</strong> ${tournament.buy_in} ₽</div>
                <div><strong>Участников:</strong> ${participants.length}</div>
                <div><strong>Призовых мест:</strong> ${tournament.prize_places}</div>
            </div>
            
            <h4 style="color:var(--muted);margin-bottom:8px;">Участники:</h4>
            <div style="margin-bottom:12px;">
                ${participants.map(p => `
                    <span style="display:inline-block;padding:4px 10px;background:var(--card2);border-radius:20px;margin:2px;font-size:12px;">
                        👤 ${esc(p.guest_name)}
                    </span>
                `).join('')}
            </div>
            
            <h4 style="color:var(--muted);margin-bottom:8px;">Призы:</h4>
            <div style="margin-bottom:12px;">
                ${(typeof tournament.prizes === 'string' ? JSON.parse(tournament.prizes) : tournament.prizes).map(p => `
                    <div style="padding:4px 0;font-size:13px;">
                        🏅 ${p.place} место: <strong style="color:var(--gold);">${p.amount} ₽</strong>
                    </div>
                `).join('')}
            </div>
            
            <button class="btn btn-accent" onclick="showFinishTournament('${tournament.id}')">
                🏁 Завершить турнир
            </button>
        </div>
    `;
}

async function showCreateTournament() {
    const guests = allGuests;
    if (guests.length < 2) {
        showToast('Нужно минимум 2 гостя для турнира', 'err');
        return;
    }
    
    let html = `
        <div style="margin-bottom:12px;">
            <label style="color:var(--muted);font-size:12px;">💰 Бай-ин (₽):</label>
            <input type="number" id="pokerBuyIn" value="1000" min="1" style="width:100%;margin-top:4px;">
        </div>
        
        <div style="margin-bottom:12px;">
            <label style="color:var(--muted);font-size:12px;">Число призовых мест:</label>
            <select id="pokerPrizePlaces" onchange="updatePrizeInputs()" style="width:100%;margin-top:4px;">
                <option value="1">1 место</option>
                <option value="2" selected>2 места</option>
                <option value="3">3 места</option>
            </select>
        </div>
        
        <div id="prizeInputs" style="margin-bottom:12px;">
            <div style="margin-bottom:8px;">
                <label style="color:var(--muted);font-size:12px;">🥇 Приз за 1 место (₽):</label>
                <input type="number" id="prizePlace1" value="2500" min="0" style="width:100%;margin-top:4px;">
            </div>
            <div style="margin-bottom:8px;">
                <label style="color:var(--muted);font-size:12px;">🥈 Приз за 2 место (₽):</label>
                <input type="number" id="prizePlace2" value="1500" min="0" style="width:100%;margin-top:4px;">
            </div>
        </div>
        
        <div style="margin-bottom:12px;">
            <label style="color:var(--muted);font-size:12px;">👥 Выберите участников:</label>
            <div style="max-height:200px;overflow-y:auto;margin-top:4px;">
                ${guests.map(g => `
                    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;border-bottom:1px solid var(--border);">
                        <input type="checkbox" class="poker-participant" value="${g.id}">
                        <span>${g.role === 'staff' ? '👔' : '👤'} ${esc(g.name)}</span>
                        ${g.role === 'staff' ? '<span style="font-size:9px;color:var(--blue);">сотрудник</span>' : ''}
                    </label>
                `).join('')}
            </div>
        </div>
        
        <div style="display:flex;gap:8px;">
            <button class="btn btn-accent" onclick="createTournament()" style="flex:1;">
                🏆 Начать турнир
            </button>
            <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
        </div>
    `;
    
    showModal('♠️ Новый покерный турнир', html);
}

function updatePrizeInputs() {
    const places = parseInt(document.getElementById('pokerPrizePlaces').value);
    const container = document.getElementById('prizeInputs');
    
    // Предустановленные значения
    const defaults = {
        1: [{ place: 1, amount: 2500 }],
        2: [{ place: 1, amount: 2500 }, { place: 2, amount: 1500 }],
        3: [{ place: 1, amount: 2500 }, { place: 2, amount: 1500 }, { place: 3, amount: 1000 }],
    };
    
    const prizes = defaults[places] || [];
    
    let html = '';
    const medals = ['🥇', '🥈', '🥉'];
    
    prizes.forEach(p => {
        html += `
            <div style="margin-bottom:8px;">
                <label style="color:var(--muted);font-size:12px;">${medals[p.place - 1]} Приз за ${p.place} место (₽):</label>
                <input type="number" id="prizePlace${p.place}" value="${p.amount}" min="0" style="width:100%;margin-top:4px;">
            </div>
        `;
    });
    
    container.innerHTML = html;
}

async function createTournament() {
    const buyIn = parseInt(document.getElementById('pokerBuyIn').value);
    const prizePlaces = parseInt(document.getElementById('pokerPrizePlaces').value);
    
    if (!buyIn || buyIn <= 0) return showToast('Укажи бай-ин', 'err');
    
    // Собираем призы
    const prizes = [];
    for (let i = 1; i <= prizePlaces; i++) {
        const amountInput = document.getElementById(`prizePlace${i}`);
        const amount = amountInput ? parseInt(amountInput.value) : 0;
        prizes.push({ place: i, amount: amount || 0 });
    }
    
    // Собираем участников
    const participants = [];
    document.querySelectorAll('.poker-participant:checked').forEach(cb => {
        participants.push(cb.value);
    });
    
    if (participants.length < 2) return showToast('Выбери минимум 2 участников', 'err');
    
    // Проверяем что призовой фонд не превышает сумму бай-инов
    const totalPrizePool = prizes.reduce((sum, p) => sum + p.amount, 0);
    const totalBuyins = buyIn * participants.length;
    
    if (totalPrizePool > totalBuyins) {
        showToast(`Призовой фонд (${totalPrizePool}₽) больше суммы бай-инов (${totalBuyins}₽)`, 'err');
        return;
    }
    
    try {
        await api('POST', '/api/poker/tournaments', {
            session_id: currentSessionId,
            buy_in: buyIn,
            prize_places: prizePlaces,
            prizes: prizes,
            participants: participants,
        });
        
        closeModal();
        showToast('🏆 Турнир начат! Бай-ины добавлены в счёт');
        await refreshAll();
        await loadActiveTournament();
    } catch (e) {
        showToast(e.message, 'err');
    }
}

async function showFinishTournament(tournamentId) {
    const tournaments = await api('GET', `/api/poker/tournaments?session_id=${currentSessionId}`);
    const tournament = tournaments.find(t => t.id === tournamentId);
    
    if (!tournament) return showToast('Турнир не найден', 'err');
    
    const participants = tournament.participants || [];
    const prizes = typeof tournament.prizes === 'string' ? JSON.parse(tournament.prizes) : tournament.prizes;
    
    let html = `
        <p style="color:var(--muted);margin-bottom:12px;">Распределите места среди участников</p>
        
        <div style="background:var(--card2);padding:10px;border-radius:8px;margin-bottom:12px;">
            <strong>Призовой фонд:</strong>
            ${prizes.map(p => `
                <div style="font-size:12px;margin-top:4px;">
                    🏅 ${p.place} место: <strong style="color:var(--gold);">${p.amount} ₽</strong>
                </div>
            `).join('')}
        </div>
    `;
    
    participants.forEach((p, index) => {
        html += `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="min-width:100px;">👤 ${esc(p.guest_name)}</span>
                <select id="place_${p.guest_id}" style="flex:1;">
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
            <button class="btn btn-accent" onclick="finishTournament('${tournamentId}')" style="flex:1;">
                🏁 Завершить турнир
            </button>
            <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
        </div>
    `;
    
    showModal('🏁 Завершение турнира', html);
}

async function finishTournament(tournamentId) {
    const tournaments = await api('GET', `/api/poker/tournaments?session_id=${currentSessionId}`);
    const tournament = tournaments.find(t => t.id === tournamentId);
    
    if (!tournament) return;
    
    // Проверяем что места не дублируются
    const usedPlaces = {};
    const results = [];
    
    tournament.participants.forEach(p => {
        const select = document.getElementById(`place_${p.guest_id}`);
        if (select && select.value) {
            const place = parseInt(select.value);
            if (usedPlaces[place]) {
                return; // Пропускаем дубликаты
            }
            usedPlaces[place] = true;
            results.push({ guest_id: p.guest_id, place: place });
        }
    });
    
    if (results.length === 0) {
        showToast('Выбери хотя бы одного победителя', 'err');
        return;
    }
    
    try {
        await api('POST', `/api/poker/tournaments/${tournamentId}/finish`, {
            results: results,
        });
        
        closeModal();
        showToast('🏁 Турнир завершён! Призы добавлены в счёт');
        await refreshAll();
        await loadActiveTournament();
    } catch (e) {
        showToast(e.message, 'err');
    }
}

// Модальное окно (добавь в ui.js если ещё нет)
function showModal(title, content) {
    const modal = document.getElementById('pokerModal');
    document.getElementById('pokerModalTitle').textContent = title;
    document.getElementById('pokerModalBody').innerHTML = content;
    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('pokerModal').classList.remove('active');
}
