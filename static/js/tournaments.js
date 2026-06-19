// ============ ТУРНИРЫ ============
var allTournaments = [];
var currentTournament = null;

async function loadTournaments() {
    try {
        allTournaments = await api('GET', '/api/tournaments');
        renderTournamentsList();
    } catch (e) {
        console.error(e);
    }
}

function renderTournamentsList() {
    var c = document.getElementById('tournamentsList');
    if (!allTournaments.length) {
        c.innerHTML = '<div class="empty">Нет турниров</div>';
        return;
    }

    var html = '';
    allTournaments.forEach(function(t) {
        var statusBadge = '';
        if (t.status === 'upcoming') statusBadge = '<span style="color:var(--neon-cyan);font-size:11px;">Upcoming</span>';
        if (t.status === 'live') statusBadge = '<span style="color:var(--neon-green);font-size:11px;">● Live</span>';
        if (t.status === 'finished') statusBadge = '<span style="color:var(--text-tertiary);font-size:11px;">Finished</span>';

        html += '<div class="card" style="border-left:3px solid ' + (t.status === 'live' ? 'var(--neon-green)' : t.status === 'finished' ? 'var(--text-tertiary)' : 'var(--neon-cyan)') + ';">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                '<div>' +
                    '<strong>' + esc(t.title) + '</strong> ' + statusBadge +
                    '<div style="font-size:11px;color:var(--text-secondary);">' + esc(t.game) + ' • ' + esc(t.format) + '</div>' +
                '</div>' +
                '<div style="display:flex;gap:4px;">' +
                    '<button class="btn btn-outline btn-sm" onclick="openTournament(\'' + t.id + '\')">Открыть</button>' +
                    (t.status === 'upcoming' ? '<button class="btn btn-accent btn-sm" onclick="startTournament(\'' + t.id + '\')">Старт</button>' : '') +
                    (t.status === 'live' ? '<button class="btn btn-accent btn-sm" onclick="finishTournament(\'' + t.id + '\')">Завершить</button>' : '') +
                '</div>' +
            '</div>' +
        '</div>';
    });
    c.innerHTML = html;
}

// ===== СОЗДАНИЕ ТУРНИРА =====
function showCreateTournament() {
    var html = '' +
        '<div style="margin-bottom:12px;">' +
            '<label>Название турнира</label>' +
            '<input type="text" id="trnTitle" placeholder="Weekend Cup #1" style="width:100%;">' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
            '<label>Игра</label>' +
            '<select id="trnGame" style="width:100%;">' +
                '<option value="poker">Poker</option>' +
                '<option value="soulcalibur">SoulCalibur</option>' +
                '<option value="other">Другое</option>' +
            '</select>' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
            '<label>Формат</label>' +
            '<select id="trnFormat" style="width:100%;">' +
                '<option value="double_elimination">Double Elimination</option>' +
                '<option value="single_elimination">Single Elimination</option>' +
                '<option value="round_robin">Round Robin</option>' +
            '</select>' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
            '<label>Участники (по одному на строку)</label>' +
            '<textarea id="trnParticipants" placeholder="Игрок 1&#10;Игрок 2&#10;Игрок 3" style="width:100%;height:120px;"></textarea>' +
        '</div>' +
        '<button class="btn btn-accent" onclick="createTournament()" style="width:100%;">Создать турнир</button>';

    showModal('Новый турнир', html);
}

async function createTournament() {
    var title = document.getElementById('trnTitle').value.trim();
    var game = document.getElementById('trnGame').value;
    var format = document.getElementById('trnFormat').value;
    var participantsText = document.getElementById('trnParticipants').value.trim();

    if (!title || !participantsText) return showToast('Заполни все поля', 'err');

    var participants = participantsText.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);

    if (participants.length < 2) return showToast('Минимум 2 участника', 'err');

    try {
        await api('POST', '/api/tournaments', { title: title, game: game, format: format, participants: participants });
        closeModal();
        await loadTournaments();
        showToast('Турнир создан');
    } catch (e) { showToast(e.message, 'err'); }
}

// ===== УПРАВЛЕНИЕ ТУРНИРОМ =====
async function openTournament(id) {
    try {
        currentTournament = await api('GET', '/api/tournaments/' + id);
        renderTournamentDetail();
    } catch (e) { showToast(e.message, 'err'); }
}

async function startTournament(id) {
    if (!confirm('Запустить турнир и сгенерировать сетку?')) return;
    try {
        await api('PUT', '/api/tournaments/' + id + '/start');
        await loadTournaments();
        await openTournament(id);
        showToast('Турнир запущен!');
    } catch (e) { showToast(e.message, 'err'); }
}

async function finishTournament(id) {
    if (!confirm('Завершить турнир?')) return;
    try {
        await api('PUT', '/api/tournaments/' + id + '/finish');
        await loadTournaments();
        await openTournament(id);
        showToast('Турнир завершён');
    } catch (e) { showToast(e.message, 'err'); }
}

function renderTournamentDetail() {
    var t = currentTournament;
    var c = document.getElementById('tournamentsList');

    var matches = t.matches || [];
    var participants = t.participants || [];
    var participantMap = {};
    participants.forEach(function(p) { participantMap[p.id] = p.name; });

    // Группируем матчи по раундам
    var rounds = {};
    matches.forEach(function(m) {
        var key = m.bracket_position + '_' + m.round;
        if (!rounds[key]) rounds[key] = [];
        rounds[key].push(m);
    });

    var roundNames = {};
    var sortedRounds = Object.keys(rounds).sort(function(a, b) {
        return parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]);
    });

    var maxRound = sortedRounds.length > 0 ? parseInt(sortedRounds[0].split('_')[1]) : 0;
    sortedRounds.forEach(function(key) {
        var r = parseInt(key.split('_')[1]);
        if (r === maxRound) roundNames[key] = 'Финал';
        else if (r === maxRound - 1) roundNames[key] = 'Полуфинал';
        else if (r === maxRound - 2) roundNames[key] = '1/4 финала';
        else roundNames[key] = 'Раунд ' + (maxRound - r + 1);
    });

    var html = '<div style="margin-bottom:16px;">' +
        '<button class="btn btn-outline btn-sm" onclick="loadTournaments()">← Назад</button>' +
    '</div>' +
    '<div class="card" style="border-left:3px solid var(--neon-purple);">' +
        '<h3>' + esc(t.title) + '</h3>' +
        '<p style="font-size:12px;color:var(--text-secondary);">' + esc(t.game) + ' • ' + esc(t.format) + ' • ' + 
            (t.status === 'live' ? '● Live' : t.status === 'finished' ? 'Finished' : 'Upcoming') +
        '</p>';

    // Сетка
    if (Object.keys(rounds).length > 0) {
        html += '<div style="margin-top:12px;">';
        sortedRounds.forEach(function(key) {
            var bracket = key.split('_')[0];
            var bracketLabel = bracket === 'winners' ? '🏆 Winners' : bracket === 'losers' ? '🔄 Losers' : '📋 Группа';
            
            html += '<h4 style="margin:12px 0 8px;color:var(--text-secondary);">' + bracketLabel + ' — ' + roundNames[key] + '</h4>';
            
            rounds[key].forEach(function(m) {
                var p1name = participantMap[m.player1_id] || '—';
                var p2name = participantMap[m.player2_id] || '—';
                var p1won = m.winner_id === m.player1_id;
                var p2won = m.winner_id === m.player2_id;

                html += '<div class="list-item" style="flex-direction:column;align-items:stretch;gap:4px;' + (m.status === 'live' ? 'border:1px solid var(--neon-green);border-radius:8px;padding:8px;' : '') + '">' +
                    '<div style="display:flex;justify-content:space-between;">' +
                        '<span style="' + (p1won ? 'color:var(--neon-gold);font-weight:700;' : '') + '">' + esc(p1name) + '</span>' +
                        (m.status !== 'pending' ? '<span style="font-weight:700;">' + (m.player1_score || 0) + '</span>' : '<span style="color:var(--text-tertiary);">vs</span>') +
                    '</div>' +
                    '<div style="display:flex;justify-content:space-between;">' +
                        '<span style="' + (p2won ? 'color:var(--neon-gold);font-weight:700;' : '') + '">' + esc(p2name) + '</span>' +
                        (m.status !== 'pending' ? '<span style="font-weight:700;">' + (m.player2_score || 0) + '</span>' : '') +
                    '</div>';

                if (t.status === 'live' && m.status !== 'finished') {
                    html += '<div style="display:flex;gap:4px;margin-top:4px;">' +
                        '<button class="btn btn-xs btn-green" onclick="updateMatch(\'' + m.id + '\',\'' + m.player1_id + '\')">' + esc(p1name) + ' победил</button>' +
                        '<button class="btn btn-xs btn-green" onclick="updateMatch(\'' + m.id + '\',\'' + m.player2_id + '\')">' + esc(p2name) + ' победил</button>' +
                    '</div>';
                }

                html += '</div>';
            });
        });
        html += '</div>';
    }

    html += '</div>';

    c.innerHTML = html;
}

async function updateMatch(matchId, winnerId) {
    try {
        await api('PUT', '/api/tournaments/matches/' + matchId, { winner_id: winnerId, status: 'finished' });
        await openTournament(currentTournament.id);
        showToast('Результат записан');
    } catch (e) { showToast(e.message, 'err'); }
}

function showModal(title, content) {
    var modal = document.getElementById('pokerModal');
    document.getElementById('pokerModalTitle').textContent = title;
    document.getElementById('pokerModalBody').innerHTML = content;
    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('pokerModal').classList.remove('active');
}
