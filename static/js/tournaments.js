var allTournaments = [];

async function loadTournaments() {
    try {
        allTournaments = await api('GET', '/api/tournaments/v2');
        renderList();
    } catch(e) { console.error(e); }
}

function renderList() {
    var c = document.getElementById('tournamentsList');
    if (!allTournaments.length) { c.innerHTML = '<div class="empty">Нет турниров</div>'; return; }
    var html = '';
    allTournaments.forEach(function(t) {
        var badge = t.status === 'upcoming' ? '⏳' : t.status === 'groups' ? '📋' : t.status === 'playoffs' ? '🏆' : '✅';
        html += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<div><strong>'+esc(t.title)+'</strong> '+badge+' <span style="font-size:11px;">'+t.game+'</span></div>' +
            '<div style="display:flex;gap:4px;">' +
                '<button class="btn btn-outline btn-sm" onclick="window.open(\'/bracket?id='+t.id+'\')">Сетка</button>' +
                (t.status==='upcoming'?'<button class="btn btn-accent btn-sm" onclick="startGroups(\''+t.id+'\')">Группы</button>':'') +
                (t.status==='groups'?'<button class="btn btn-accent btn-sm" onclick="genPlayoffs(\''+t.id+'\')">Плей-офф</button>':'') +
                (t.status==='playoffs'?'<button class="btn btn-accent btn-sm" onclick="finishTrn(\''+t.id+'\')">Завершить</button>':'') +
            '</div></div></div>';
    });
    c.innerHTML = html;
}

function showCreateForm() {
    var html = '<input type="text" id="trnTitle" placeholder="Название" style="width:100%;margin-bottom:8px;">' +
        '<textarea id="trnPlayers" placeholder="Игроки (по одному на строку)" style="width:100%;height:120px;margin-bottom:8px;"></textarea>' +
        '<button class="btn btn-accent" onclick="createTrn()" style="width:100%;">Создать</button>';
    showModal('Новый турнир', html);
}

async function createTrn() {
    var title = document.getElementById('trnTitle').value.trim();
    var players = document.getElementById('trnPlayers').value.split('\n').map(function(s){return s.trim();}).filter(Boolean);
    if (!title || players.length < 2) return showToast('Заполни', 'err');
    await api('POST', '/api/tournaments/v2', {title:title, game:'poker', participants:players});
    closeModal();
    await loadTournaments();
    showToast('Создан');
}

async function startGroups(id) {
    await api('PUT', '/api/tournaments/v2/'+id+'/start-groups');
    await loadTournaments();
    showToast('Группы созданы');
}

async function genPlayoffs(id) {
    await api('PUT', '/api/tournaments/v2/'+id+'/generate-playoffs');
    await loadTournaments();
    showToast('Плей-офф сгенерирован');
}

async function finishTrn(id) {
    if (!confirm('Завершить турнир?')) return;
    await api('PUT', '/api/tournaments/v2/'+id+'/finish');
    await loadTournaments();
    showToast('Завершён');
}

function showModal(title, content) {
    document.getElementById('pokerModalTitle').textContent = title;
    document.getElementById('pokerModalBody').innerHTML = content;
    document.getElementById('pokerModal').classList.add('active');
}
function closeModal() { document.getElementById('pokerModal').classList.remove('active'); }
