// ============ СОБЫТИЯ ============
let allEvents = [];

async function loadEventsAdmin() {
    try {
        allEvents = await api('GET', '/api/events?limit=50');
        renderEventsAdmin();
    } catch (e) {
        console.error('Ошибка загрузки событий:', e);
    }
}

async function addEvent() {
    const title = document.getElementById('eventTitle').value.trim();
    const description = document.getElementById('eventDesc').value.trim();
    const event_date = document.getElementById('eventDate').value;
    const event_time = document.getElementById('eventTime').value || '20:00';
    const notify = document.getElementById('eventNotify').checked;
    
    if (!title || !event_date) return showToast('Заполни заголовок и дату', 'err');
    
    try {
        await api('POST', '/api/events', { title, description, event_date, event_time, notify_telegram: notify });
        document.getElementById('eventTitle').value = '';
        document.getElementById('eventDesc').value = '';
        document.getElementById('eventDate').value = '';
        document.getElementById('eventNotify').checked = false;
        await loadEventsAdmin();
        showToast(notify ? '✅ Событие создано и уведомление отправлено' : '✅ Событие создано');
    } catch (e) { showToast(e.message, 'err'); }
}

async function deleteEvent(id) {
    if (!confirm('Удалить событие?')) return;
    try {
        await api('DELETE', `/api/events/${id}`);
        await loadEventsAdmin();
        showToast('🗑 Удалено');
    } catch (e) { showToast(e.message, 'err'); }
}

function startEditEvent(id) {
    const evt = allEvents.find(e => e.id === id);
    if (!evt) return;
    
    const item = document.querySelector(`[data-event-id="${id}"]`);
    item.innerHTML = `
        <div class="row" style="flex:1;">
            <input type="text" class="edit-ev-title" value="${esc(evt.title)}" style="flex:1;">
            <input type="date" class="edit-ev-date" value="${evt.event_date}" style="max-width:140px;">
            <input type="time" class="edit-ev-time" value="${evt.event_time?.slice(0,5) || '20:00'}" style="max-width:100px;">
        </div>
        <textarea class="edit-ev-desc" style="width:100%;margin-top:4px;">${esc(evt.description || '')}</textarea>
        <div style="display:flex;gap:4px;margin-top:4px;">
            <button class="btn btn-green btn-sm" onclick="saveEditEvent('${id}')">✓</button>
            <button class="btn btn-outline btn-sm" onclick="loadEventsAdmin()">✕</button>
        </div>
    `;
}

async function saveEditEvent(id) {
    const item = document.querySelector(`[data-event-id="${id}"]`);
    const title = item.querySelector('.edit-ev-title').value.trim();
    const event_date = item.querySelector('.edit-ev-date').value;
    const event_time = item.querySelector('.edit-ev-time').value;
    const description = item.querySelector('.edit-ev-desc').value.trim();
    
    if (!title || !event_date) return showToast('Заполни заголовок и дату', 'err');
    
    try {
        await api('PUT', `/api/events/${id}`, { title, event_date, event_time, description });
        await loadEventsAdmin();
        showToast('✅ Обновлено');
    } catch (e) { showToast(e.message, 'err'); }
}

function renderEventsAdmin() {
    const c = document.getElementById('eventsListAdmin');
    if (!allEvents.length) {
        c.innerHTML = '<div class="empty">Нет событий</div>';
        return;
    }
    
    c.innerHTML = allEvents.map(e => {
        const d = new Date(e.event_date);
        const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        
        return `
            <div class="list-item" data-event-id="${e.id}" style="flex-direction:column;align-items:stretch;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span>
                        📅 <strong>${esc(e.title)}</strong>
                        <span style="color:var(--muted);font-size:12px;">— ${dateStr} в ${e.event_time?.slice(0,5)}</span>
                    </span>
                    <div style="display:flex;gap:4px;">
                        <button class="btn btn-outline btn-sm" onclick="startEditEvent('${e.id}')">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteEvent('${e.id}')">✕</button>
                    </div>
                </div>
                ${e.description ? `<p style="color:var(--muted);font-size:12px;margin-top:4px;">${esc(e.description)}</p>` : ''}
            </div>
        `;
    }).join('');
}
