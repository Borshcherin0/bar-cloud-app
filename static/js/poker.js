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
    document.getElementById('pokerSection').innerHTML = `
        <div class="card">
            <h3>♠️ Покерный турнир</h3>
            <button class="btn btn-accent" type="button" onclick="openPokerTournament()">
                Начать турнир
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

function showModal(title, content) {
    const modal = document.getElementById('pokerModal');
    document.getElementById('pokerModalTitle').textContent = title;
    document.getElementById('pokerModalBody').innerHTML = content;
    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('pokerModal').classList.remove('active');
}

// Закрытие по клику на оверлей
document.getElementById('pokerModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeModal();
    }
});
