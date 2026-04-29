// ============ ГОСТИ ============

async function loadGuests(role = null) {
    try {
        const params = role ? `?role=${role}` : '';
        allGuests = await api('GET', `/api/guests${params}`);
        renderGuests();
    } catch (e) {
        console.error('Ошибка загрузки гостей:', e);
    }
}

async function addGuest() {
    const inp = document.getElementById('guestName');
    const roleSelect = document.getElementById('guestRole');
    const name = inp.value.trim();
    const role = roleSelect ? roleSelect.value : 'guest';
    
    if (!name) return showToast('Введи имя', 'err');
    
    try {
        await api('POST', '/api/guests', { name, role });
        inp.value = '';
        await loadGuests();
        updateSelects();
        showToast(role === 'staff' ? '👔 Сотрудник добавлен' : '✅ Гость добавлен');
    } catch (e) { showToast(e.message, 'err'); }
}

async function deleteGuest(id) {
    const guest = allGuests.find(g => g.id === id);
    const msg = guest?.role === 'staff' ? 'Удалить сотрудника?' : 'Удалить гостя?';
    if (!confirm(msg)) return;
    
    try {
        await api('DELETE', `/api/guests/${id}`);
        await loadGuests();
        updateSelects();
        showToast('🗑 Удалён');
    } catch (e) { showToast(e.message, 'err'); }
}

async function toggleGuestRole(id) {
    const guest = allGuests.find(g => g.id === id);
    if (!guest) return;
    
    const newRole = guest.role === 'staff' ? 'guest' : 'staff';
    try {
        await api('PUT', `/api/guests/${id}`, { role: newRole });
        await loadGuests();
        updateSelects();
        showToast(newRole === 'staff' ? '👔 Стал сотрудником' : '👤 Стал гостем');
    } catch (e) { showToast(e.message, 'err'); }
}

function renderGuests() {
    const c = document.getElementById('guestsList');
    if (!allGuests.length) {
        c.innerHTML = '<div class="empty">Нет гостей</div>';
        return;
    }
    
    // Разделяем на гостей и сотрудников
    const guests = allGuests.filter(g => g.role !== 'staff');
    const staff = allGuests.filter(g => g.role === 'staff');
    
    let html = '';
    
    if (staff.length > 0) {
        html += `<div class="card" style="border-left: 3px solid var(--blue);">
            <h3>👔 Сотрудники <span style="color:var(--muted);font-size:0.7em;">(${staff.length})</span></h3>`;
        staff.forEach(g => {
            html += renderGuestItem(g);
        });
        html += '</div>';
    }
    
    if (guests.length > 0) {
        html += `<div class="card" style="border-left: 3px solid var(--accent);">
            <h3>👤 Гости <span style="color:var(--muted);font-size:0.7em;">(${guests.length})</span></h3>`;
        guests.forEach(g => {
            html += renderGuestItem(g);
        });
        html += '</div>';
    }
    
    c.innerHTML = html;
}

function renderGuestItem(g) {
    const isStaff = g.role === 'staff';
    const icon = isStaff ? '👔' : '👤';
    const badge = isStaff ? '<span style="font-size:9px;color:var(--blue);background:#5b9bd522;padding:2px 6px;border-radius:10px;">СОТРУДНИК</span>' : '';
    
    return `
        <div class="list-item">
            <span>${icon} ${esc(g.name)} ${badge}</span>
            <div style="display:flex;gap:4px;">
                <button class="btn btn-outline btn-sm" onclick="toggleGuestRole('${g.id}')" 
                        title="${isStaff ? 'Сделать гостем' : 'Сделать сотрудником'}">
                    ${isStaff ? '👤' : '👔'}
                </button>
                <button class="btn btn-danger btn-sm" data-action="deleteGuest" data-id="${g.id}">✕</button>
            </div>
        </div>`;
}
