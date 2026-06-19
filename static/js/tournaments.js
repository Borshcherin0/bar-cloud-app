// ============ ТУРНИРЫ ============
var allTournaments = [];

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

        html += '<div class="card" style="border-left:3px solid ' + 
            (t.status === 'live' ? 'var(--neon-green)' : t.status === 'finished' ? 'var(--text-tertiary)' : 'var(--neon-cyan)') + ';">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                '<div>' +
                    '<strong>' + esc(t.title) + '</strong> ' + statusBadge +
                    '<div style="font-size:11px;color:var(--text-secondary);">' + esc(t.game) + ' • ' + esc(t.format) + '</div>' +
                '</div>' +
                '<div style="display:flex;gap:4px;">' +
                    '<button class="btn btn-outline btn-sm" onclick="window.open(\'/bracket?id=' + t.id + '\')">Сетка</button>' +
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
                '<option value="single_elimination">Single Elimination</option>' +
                '<option value="double_elimination">Double Elimination</option>' +
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
        await api('POST', '/api/tournaments', { 
            title: title, 
            game: game, 
            format: format, 
            participants: participants 
        });
        closeModal();
        await loadTournaments();
        showToast('Турнир создан');
    } catch (e) { showToast(e.message, 'err'); }
}

// ===== УПРАВЛЕНИЕ ТУРНИРОМ =====
async function startTournament(id) {
    if (!confirm('Запустить турнир и сгенерировать сетку?')) return;
    try {
        await api('PUT', '/api/tournaments/' + id + '/start');
        await loadTournaments();
        showToast('Турнир запущен!');
    } catch (e) { showToast(e.message, 'err'); }
}

async function finishTournament(id) {
    if (!confirm('Завершить турнир?')) return;
    try {
        await api('PUT', '/api/tournaments/' + id + '/finish');
        await loadTournaments();
        showToast('Турнир завершён');
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

function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
