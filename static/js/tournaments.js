// ============ ТУРНИРЫ V2 ============
var allTournaments = [];

window.loadTournaments = async function() {
    try {
        allTournaments = await api('GET', '/api/tournaments/v2');
        renderList();
    } catch(e) { console.error(e); }
};

function renderList() {
    var c = document.getElementById('tournamentsList');
    if (!c) return;
    if (!allTournaments.length) { c.innerHTML = '<div class="empty">Нет турниров</div>'; return; }
    var html = '';
    allTournaments.forEach(function(t) {
        var badge = t.status === 'upcoming' ? '⏳' : t.status === 'groups' ? '📋' : t.status === 'playoffs' ? '🏆' : '✅';
        html += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<div><strong>'+esc(t.title)+'</strong> '+badge+' <span style="font-size:11px;">'+t.game+'</span></div>' +
            '<div style="display:flex;gap:4px;">' +
                '<button class="btn btn-outline btn-sm" onclick="window.open(\'/bracket?id='+t.id+'\')">Сетка</button>' +
                (t.status==='upcoming'?'<button class="btn btn-accent btn-sm" onclick="window.startGroups(\''+t.id+'\')">Группы</button>':'') +
                (t.status==='groups'?'<button class="btn btn-accent btn-sm" onclick="window.genPlayoffs(\''+t.id+'\')">Плей-офф</button>':'') +
                (t.status==='playoffs'?'<button class="btn btn-accent btn-sm" onclick="window.finishTrn(\''+t.id+'\')">Завершить</button>':'') +
            '</div></div></div>';
    });
    c.innerHTML = html;
}

window.showCreateForm = function() {
    var html = '<input type="text" id="trnTitle" placeholder="Название" style="width:100%;margin-bottom:8px;">' +
        '<textarea id="trnPlayers" placeholder="Игроки (по одному на строку)" style="width:100%;height:120px;margin-bottom:8px;"></textarea>' +
        '<button class="btn btn-accent" onclick="window.createTrn()" style="width:100%;">Создать</button>';
    showModal('Новый турнир', html);
};

window.createTrn = async function() {
    var title = document.getElementById('trnTitle').value.trim();
    var players = document.getElementById('trnPlayers').value.split('\n').map(function(s){return s.trim();}).filter(Boolean);
    if (!title || players.length < 2) return showToast('Заполни', 'err');
    try {
        await api('POST', '/api/tournaments/v2', {title:title, game:'poker', participants:players});
        closeModal();
        await loadTournaments();
        showToast('Создан');
    } catch(e) { showToast(e.message, 'err'); }
};

window.startGroups = async function(id) {
    try {
        await api('PUT', '/api/tournaments/v2/'+id+'/start-groups');
        await loadTournaments();
        showToast('Группы созданы');
    } catch(e) { showToast(e.message, 'err'); }
};

window.genPlayoffs = async function(id) {
    try {
        await api('PUT', '/api/tournaments/v2/'+id+'/generate-playoffs');
        await loadTournaments();
        showToast('Плей-офф сгенерирован');
    } catch(e) { showToast(e.message, 'err'); }
};

window.finishTrn = async function(id) {
    if (!confirm('Завершить турнир?')) return;
    try {
        await api('PUT', '/api/tournaments/v2/'+id+'/finish');
        await loadTournaments();
        showToast('Завершён');
    } catch(e) { showToast(e.message, 'err'); }
};
