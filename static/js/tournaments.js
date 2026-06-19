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
    var pmap = {};
    (t.participants || []).forEach(function(p) { pmap[p.id] = p; });

    // Группируем матчи
    var groups = {};
    var playoffRounds = {};
    
    matches.forEach(function(m) {
        if (m.bracket_position && m.bracket_position.startsWith('group_')) {
            var g = m.bracket_position;
            if (!groups[g]) groups[g] = [];
            groups[g].push(m);
        } else if (m.bracket_position === 'winners' || m.bracket_position === 'losers') {
            if (!playoffRounds[m.round]) playoffRounds[m.round] = [];
            playoffRounds[m.round].push(m);
        }
    });

    var html = '<div style="margin-bottom:16px;">' +
        '<button class="btn btn-outline btn-sm" onclick="loadTournaments()">← Назад</button>' +
    '</div>' +
    '<div class="card" style="border-left:3px solid var(--neon-purple);">' +
        '<h3>' + esc(t.title) + '</h3>';

    // Групповая стадия
    if (Object.keys(groups).length > 0) {
        html += '<h4 style="margin-top:12px;">Групповая стадия</h4>';
        
        for (var g in groups) {
            html += '<div style="margin:8px 0;padding:8px;background:var(--glass-bg);border-radius:8px;">' +
                '<strong>Группа ' + g.replace('group_', '') + '</strong>';

            // Считаем очки
            var scores = {};
            groups[g].forEach(function(m) {
                scores[m.player1_id] = scores[m.player1_id] || {wins:0,losses:0};
                scores[m.player2_id] = scores[m.player2_id] || {wins:0,losses:0};
                if (m.winner_id === m.player1_id) {
                    scores[m.player1_id].wins++;
                    scores[m.player2_id].losses++;
                } else if (m.winner_id === m.player2_id) {
                    scores[m.player2_id].wins++;
                    scores[m.player1_id].losses++;
                }
            });

            html += '<table style="margin-top:4px;font-size:12px;">' +
                '<tr><th>Игрок</th><th>W</th><th>L</th></tr>';
            for (var pid in scores) {
                var p = pmap[pid];
                html += '<tr>' +
                    '<td>' + esc(p ? p.name : '?') + '</td>' +
                    '<td>' + scores[pid].wins + '</td>' +
                    '<td>' + scores[pid].losses + '</td>' +
                '</tr>';
            }
            html += '</table>';

            // Матчи
                       // Матчи — показываем все
            groups[g].forEach(function(m) {
                var p1 = pmap[m.player1_id];
                var p2 = pmap[m.player2_id];
                var p1won = m.winner_id === m.player1_id;
                var p2won = m.winner_id === m.player2_id;
                
                html += '<div class="list-item" style="flex-direction:column;align-items:stretch;gap:2px;padding:4px 0;">' +
                    '<div style="display:flex;justify-content:space-between;">' +
                        '<span style="'+(p1won?'color:var(--neon-gold);font-weight:700;':'')+'">' + esc(p1?p1.name:'?') + '</span>' +
                        '<span>' + (m.player1_score||0) + '</span>' +
                    '</div>' +
                    '<div style="display:flex;justify-content:space-between;">' +
                        '<span style="'+(p2won?'color:var(--neon-gold);font-weight:700;':'')+'">' + esc(p2?p2.name:'?') + '</span>' +
                        '<span>' + (m.player2_score||0) + '</span>' +
                    '</div>';

                // Кнопки для live-турнира
                if (t.status === 'live' && m.status !== 'finished') {
                    html += '<div style="display:flex;gap:4px;margin-top:4px;">' +
                        '<button class="btn btn-xs btn-green" onclick="updateMatch(\''+m.id+'\',\''+m.player1_id+'\')">' + esc(p1?p1.name:'?') + ' победил</button>' +
                        '<button class="btn btn-xs btn-green" onclick="updateMatch(\''+m.id+'\',\''+m.player2_id+'\')">' + esc(p2?p2.name:'?') + ' победил</button>' +
                    '</div>';
                }
                html += '</div>';
            });
            html += '</div>';
        }
    }
        // Кнопка генерации плей-офф
    if (t.status === 'live' && Object.keys(groups).length > 0 && Object.keys(playoffRounds).length === 0) {
        html += '<button class="btn btn-accent btn-sm" onclick="generatePlayoff(\'' + t.id + '\')" style="margin-top:12px;width:100%;">Сгенерировать плей-офф</button>';
    }
    // Плей-офф
    if (Object.keys(playoffRounds).length > 0) {
        html += '<h4 style="margin-top:12px;">Плей-офф</h4>';
        var sortedRounds = Object.keys(playoffRounds).sort(function(a,b){return b-a;});
        
        sortedRounds.forEach(function(r) {
            var roundNames = {4:'Финал',3:'Полуфинал',2:'1/4',1:'1/8'};
            html += '<div style="margin:4px 0;font-size:12px;color:var(--text-secondary);">' + (roundNames[r]||'Раунд '+r) + '</div>';
            
            playoffRounds[r].forEach(function(m) {
                var p1 = pmap[m.player1_id];
                var p2 = pmap[m.player2_id];
                var p1won = m.winner_id === m.player1_id;
                var p2won = m.winner_id === m.player2_id;
                
                html += '<div class="list-item" style="flex-direction:column;align-items:stretch;gap:2px;padding:4px 0;">' +
                    '<div style="display:flex;justify-content:space-between;">' +
                        '<span style="'+(p1won?'color:var(--neon-gold);font-weight:700;':'')+'">' + esc(p1?p1.name:'TBD') + '</span>' +
                        '<span>' + (m.player1_score||0) + '</span>' +
                    '</div>' +
                    '<div style="display:flex;justify-content:space-between;">' +
                        '<span style="'+(p2won?'color:var(--neon-gold);font-weight:700;':'')+'">' + esc(p2?p2.name:'TBD') + '</span>' +
                        '<span>' + (m.player2_score||0) + '</span>' +
                    '</div>';
                
                if (t.status === 'live' && m.status !== 'finished') {
                    html += '<div style="display:flex;gap:4px;margin-top:4px;">' +
                        '<button class="btn btn-xs btn-green" onclick="updateMatch(\''+m.id+'\',\''+m.player1_id+'\')">' + esc(p1?p1.name:'?') + ' победил</button>' +
                        '<button class="btn btn-xs btn-green" onclick="updateMatch(\''+m.id+'\',\''+m.player2_id+'\')">' + esc(p2?p2.name:'?') + ' победил</button>' +
                    '</div>';
                }
                html += '</div>';
            });
        });
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
