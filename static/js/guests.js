// ============ ГОСТИ ============

async function loadGuests() {
    allGuests = await api('GET', '/api/guests');
    renderGuests();
}

async function addGuest() {
    const inp = document.getElementById('guestName');
    const name = inp.value.trim();
    if (!name) return showToast('Введи имя', 'err');
    try {
        await api('POST', '/api/guests', { name });
        inp.value = '';
        await loadGuests();
        updateSelects();
        showToast('✅ Гость добавлен');
    } catch (e) { showToast(e.message, 'err'); }
}

async function deleteGuest(id) {
    if (!confirm('Удалить гостя?')) return;
    try {
        await api('DELETE', `/api/guests/${id}`);
        await loadGuests();
        updateSelects();
        showToast('🗑 Удалён');
    } catch (e) { showToast(e.message, 'err'); }
}

function renderGuests() {
    const c = document.getElementById('guestsList');
    if (!allGuests.length) {
        c.innerHTML = '<div class="empty">Нет гостей</div>';
        return;
    }
    c.innerHTML = allGuests.map(g => `
        <div class="list-item">
            <span>👤 ${esc(g.name)}</span>
            <button class="btn btn-danger btn-sm" data-action="deleteGuest" data-id="${g.id}">✕</button>
        </div>
    `).join('');
}
