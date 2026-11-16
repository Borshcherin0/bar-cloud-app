// ============ ГОСТИ ============

let guestNicknames = null;

async function fetchGuestNicknames() {
    const { guests } = await api('GET', '/api/leaderboards/billing');
    guestNicknames = new Map(guests.map(guest => [guest.id, guest.nickname]));
}

async function refreshGuestNicknames() {
    const list = document.getElementById('guestsList');
    if (list.querySelector('.guest-nickname-editor')) return;
    try {
        await fetchGuestNicknames();
    } catch (error) {
        if (error.status === 401) guestNicknames = null;
        else showToast('Не удалось загрузить никнеймы', 'err');
    }
    if (!list.querySelector('.guest-nickname-editor')) renderGuests();
}

function editGuestNickname(row, guestId, needsLogin = guestNicknames === null, draft) {
    const trigger = row.querySelector('.guest-nickname');
    const guest = allGuests.find(entry => entry.id === guestId);
    if (!guest) return;
    const form = document.createElement('form');
    form.className = 'guest-nickname-editor';
    form.innerHTML = `
        <label class="guest-nickname-field">
            <span>${needsLogin ? 'Подтвердить вход для редактирования' : 'Турнирный никнейм'}</span>
            <input ${needsLogin ? 'type="password" autocomplete="current-password" required' : 'type="text" maxlength="40" autocomplete="off" placeholder="Без никнейма"'}>
        </label>
        <button type="submit" class="btn btn-accent btn-sm">${needsLogin ? 'Войти' : 'Сохранить'}</button>
        <button type="button" class="btn btn-outline btn-sm">Отмена</button>
        <p class="guest-nickname-error" role="alert" hidden></p>`;
    const input = form.querySelector('input');
    const submit = form.querySelector('[type="submit"]');
    const cancel = form.querySelector('[type="button"]');
    const errorMessage = form.querySelector('[role="alert"]');
    if (!needsLogin) input.value = draft ?? guestNicknames.get(guestId) ?? '';
    row.querySelector('.guest-nickname-editor')?.remove();
    row.append(form);
    trigger.setAttribute('aria-expanded', 'true');
    input.focus();

    const close = () => {
        form.remove();
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
    };
    cancel.addEventListener('click', close);
    form.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !submit.disabled) {
            event.preventDefault();
            close();
        }
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (submit.disabled) return;
        const value = input.value;
        input.disabled = submit.disabled = cancel.disabled = true;
        errorMessage.hidden = true;
        try {
            if (needsLogin) {
                await api('POST', '/api/leaderboards/login', { password: value });
                await fetchGuestNicknames();
            } else {
                const nickname = value.trim().replace(/\s+/g, ' ');
                await api('PUT', '/api/leaderboards/nicknames/' + encodeURIComponent(guestId), { nickname });
                guestNicknames.set(guestId, nickname);
                showToast(nickname ? 'Никнейм сохранён' : 'Никнейм удалён');
            }
            renderGuests();
            const updatedTrigger = [...document.querySelectorAll('.guest-nickname')]
                .find(button => button.dataset.guestId === guestId);
            if (!updatedTrigger) return;
            if (needsLogin) editGuestNickname(updatedTrigger.closest('.guest-row'), guestId, false, draft);
            else updatedTrigger.focus();
        } catch (error) {
            if (!needsLogin && error.status === 401) {
                guestNicknames = null;
                editGuestNickname(row, guestId, true, value);
                return;
            }
            errorMessage.textContent = error.message;
            errorMessage.hidden = false;
            input.disabled = submit.disabled = cancel.disabled = false;
            input.focus();
        }
    });
}

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
    c.querySelectorAll('.guest-nickname').forEach(trigger => {
        trigger.addEventListener('click', () => {
            if (trigger.getAttribute('aria-expanded') === 'true' || c.querySelector('.guest-nickname-editor [type="submit"]:disabled')) return;
            c.querySelector('.guest-nickname-editor')?.remove();
            c.querySelector('.guest-nickname[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
            editGuestNickname(trigger.closest('.guest-row'), trigger.dataset.guestId);
        });
    });
}

function renderGuestItem(g) {
    const isStaff = g.role === 'staff';
    const icon = isStaff ? '👔' : '👤';
    const badge = isStaff ? '<span style="font-size:9px;color:var(--blue);background:#5b9bd522;padding:2px 6px;border-radius:10px;">СОТРУДНИК</span>' : '';
    
    const nickname = guestNicknames?.get(g.id);
    return `
        <div class="list-item guest-row">
            <div class="guest-identity">
                <span>${icon} ${esc(g.name)} ${badge}</span>
                <button type="button" class="guest-nickname${nickname ? ' has-nickname' : ''}"
                        data-guest-id="${g.id}" aria-expanded="false"
                        title="Редактировать турнирный никнейм">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m15 5 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"/>
                    </svg>
                    ${esc(nickname || (guestNicknames ? 'Добавить никнейм' : 'Никнейм'))}
                </button>
            </div>
            <div class="guest-actions">
                <button class="btn btn-outline btn-sm" onclick="toggleGuestRole('${g.id}')" 
                        title="${isStaff ? 'Сделать гостем' : 'Сделать сотрудником'}">
                    ${isStaff ? '👤' : '👔'}
                </button>
                <button class="btn btn-danger btn-sm" data-action="deleteGuest" data-id="${g.id}">✕</button>
            </div>
        </div>`;
}
