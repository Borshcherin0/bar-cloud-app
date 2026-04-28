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
            <label style="color:var(--muted);font-size:12px;">Бай-ин (₽):</label>
            <input type="number" id="pokerBuyIn" value="1000" min="1" style="width:100%;margin-top:4px;">
        </div>
        
        <div style="margin-bottom:12px;">
            <label style="color:var(--muted);font-size:12px;">Число призовых мест:</label>
            <select id="pokerPrizePlaces" onchange="updatePrizeInputs()" style="width:100%;margin-top:4px;">
                <option value="1">1 место</option>
                <option value="2">2 места</option>
                <option value="3">3 места</option>
            </select>
        </div>
        
        <div id="prizeInputs" style="margin-bottom:12px;">
            <label style="color:var(--muted);font-size:12px;">Приз за 1 место (₽):</label>
            <input type="number" id="prizePlace1" value="5000" min="0" style="width:100%;margin-top:4px;">
        </div>
        
        <div style="margin-bottom:12px;">
            <label style="color:var(--muted);font-size:12px;">Выберите участников:</label>
            <div style="max-height:200px;overflow-y:auto;margin-top:4px;">
                ${guests.map(g => `
                    <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;">
                        <input type="checkbox" class="poker-participant" value="${g.id}">
                        👤 ${esc(g.name)}
                    </label>
                `).join('')}
            </div>
        </div>
        
        <button class="btn btn-accent" onclick="createTournament()" style="width:100%;">
            🏆 Начать турнир
        </button>
    `;
    
    showModal('♠️ Новый покерный турнир', html);
}

function updatePrizeInputs() {
    const places = parseInt(document.getElementById('pokerPrizePlaces').value);
    const container = document.getElementById('prizeInputs');
    
    let html = '';
    for (let i = 1; i <= places; i++) {
        const defaultPrize = i === 1 ? 5000 : i === 2 ? 2000 : 1000;
        html += `
            <div style="margin-bottom:8px;">
                <label style="color:var(--muted);font-size:12px;">Приз за ${i} место (₽):</label>
                <input type="number" id="prizePlace${i}" value="${defaultPrize}" min="0" style="width:100%;margin-top:4px;">
            </div>
        `;
    }
    container.innerHTML = html;
}

async function createTournament() {
    const buyIn = parseInt(document.getElementById('pokerBuyIn').value);
    const prizePlaces = parseInt(document.getElementById('pokerPrizePlaces').value);
    
    if (!buyIn || buyIn <= 0) return showToast('Укажи бай-ин', 'err');
    
    // Собираем призы
    const prizes = [];
    for (let i = 1; i <= prizePlaces; i++) {
        const amount = parseInt(document.getElementById(`prizePlace${i}`).value);
        prizes.push({ place: i, amount: amount || 0 });
    }
    
    // Собираем участников
    const participants = [];
    document.querySelectorAll('.poker-participant:checked').forEach(cb => {
        participants.push(cb.value);
    });
    
    if (participants.length < 2) return showToast('Выбери минимум 2 участников', 'err');
    
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
    
    let html = `
        <p style="color:var(--muted);margin-bottom:12px;">Распределите места среди участников</p>
    `;
    
    participants.forEach((p, index) => {
        html += `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="min-width:100px;">👤 ${esc(p.guest_name)}</span>
                <select id="place_${p.guest_id}" style="flex:1;">
                    <option value="">— Не призовое —</option>
                    ${Array.from({length: tournament.prize_places}, (_, i) => i + 1).map(place => `
                        <option value="${place}">${place} место</option>
                    `).join('')}
                </select>
            </div>
        `;
    });
    
    html += `
        <button class="btn btn-accent" onclick="finishTournament('${tournamentId}')" style="width:100%;margin-top:12px;">
            🏁 Завершить турнир
        </button>
    `;
    
    showModal('🏁 Завершение турнира', html);
}

async function finishTournament(tournamentId) {
    const tournaments = await api('GET', `/api/poker/tournaments?session_id=${currentSessionId}`);
    const tournament = tournaments.find(t => t.id === tournamentId);
    
    if (!tournament) return;
    
    const results = [];
    const usedPlaces = new Set();
    
    tournament.participants.forEach(p => {
        const select = document.getElementById(`place_${p.guest_id}`);
        if (select && select.value) {
            const place = parseInt(select.value);
            if (usedPlaces.has(place)) {
                return; // Пропускаем дубликаты
            }
            usedPlaces.add(place);
            results.push({ guest_id: p.guest_id, place: place });
        }
    });
    
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
