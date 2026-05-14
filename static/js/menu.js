// ============ ГОСТЕВОЕ МЕНЮ ============
const API_BASE = window.location.origin;

const CATEGORIES = {
    'alco': { name: 'Коктейли', icon: '🍸' },
    'no_alco': { name: 'Напитки', icon: '🥤' },
    'hookah': { name: 'Кальяны', icon: '💨' },
    'poker': { name: 'Покер', icon: '♠️' },
};

// ============ ТАБЫ ============

function showTab(tab, btn) {
    // Скрываем все вкладки
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));

    // Показываем выбранную
    document.getElementById('tab-' + tab).classList.add('active');
    if (btn) btn.classList.add('active');

    if (tab === 'events') loadEvents();
    if (tab === 'menu') loadMenu();
}

// ============ МЕНЮ ============

async function loadMenu() {
    try {
        const [drinksRes, inventoryRes] = await Promise.all([
            fetch(`${API_BASE}/api/drinks?category=positive`),
            fetch(`${API_BASE}/api/inventory/report`).catch(() => null)
        ]);

        const drinks = await drinksRes.json();
        const inventory = inventoryRes ? await inventoryRes.json() : [];

        const stockMap = {};
        if (Array.isArray(inventory)) {
            inventory.forEach(item => { stockMap[item.drink_id] = item.max_servings; });
        }

        renderMenu(drinks, stockMap);
    } catch (e) {
        console.error('Ошибка загрузки меню:', e);
        document.getElementById('menuContainer').innerHTML =
            '<div class="menu-loading">Не удалось загрузить меню</div>';
    }
}

function renderMenu(drinks, stockMap) {
    const container = document.getElementById('menuContainer');

    if (!drinks.length) {
        container.innerHTML = '<div class="menu-loading">Меню пока пусто</div>';
        return;
    }

    // Группируем по категориям
    const grouped = {};
    drinks.forEach(d => {
        if (d.price <= 0 || d.price_type !== 'regular') return;
        const cat = d.category || 'alco';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(d);
    });

    const activeCategories = Object.entries(CATEGORIES).filter(([key]) => grouped[key]?.length);

    container.innerHTML = activeCategories.map(([key, cat]) => `
        <div class="category-section" id="cat-${key}">
            <div class="category-title">${cat.icon} ${cat.name}</div>
            <div class="drinks-grid">
                ${grouped[key].map(d => renderDrinkCard(d, stockMap)).join('')}
            </div>
        </div>
    `).join('');
}

function renderDrinkCard(d, stockMap) {
    const servings = stockMap[d.id];
    const outOfStock = servings !== undefined && servings === 0;

    let stockHtml = '';
    if (servings !== undefined) {
        if (servings >= 999) {
            stockHtml = '';
        } else if (servings > 5) {
            stockHtml = `<span class="drink-stock available">${servings} порц.</span>`;
        } else if (servings > 0) {
            stockHtml = `<span class="drink-stock low">${servings} порц.</span>`;
        } else {
            stockHtml = `<span class="drink-stock out">Нет</span>`;
        }
    }

    const imageHtml = d.image_url
        ? `<img src="${d.image_url}" class="drink-image" alt="${esc(d.name)}" loading="lazy">`
        : `<div class="drink-placeholder">🍹</div>`;

    const ingredients = d.ingredients || [];

    return `
        <div class="drink-card ${outOfStock ? 'out-of-stock-card' : ''}">
            ${outOfStock ? '<div class="out-of-stock-badge">Нет в наличии</div>' : ''}
            <div class="drink-image-container">${imageHtml}</div>
            <div class="drink-info">
                <div class="drink-name">${esc(d.name)}</div>
                ${ingredients.length ? `
                <div class="drink-tags">
                    ${ingredients.slice(0, 5).map(i =>
                        `<span class="ingredient-tag">${esc(i.name)}</span>`
                    ).join('')}
                </div>` : ''}
                <div class="drink-footer">
                    <div class="drink-price">${d.price} ₽</div>
                    ${stockHtml}
                </div>
            </div>
        </div>
    `;
}

// ============ СОБЫТИЯ ============
let currentMonth, currentYear;
let eventDates = {};

async function loadEvents() {
    try {
        const events = await fetch(`${API_BASE}/api/events`).then(r => r.json());
        
        // Группируем события по датам
        eventDates = {};
        events.forEach(e => {
            if (!eventDates[e.event_date]) eventDates[e.event_date] = [];
            eventDates[e.event_date].push(e);
        });
        
        const now = new Date();
        currentMonth = now.getMonth();
        currentYear = now.getFullYear();
        
        renderCalendar();
        renderUpcomingEvents(events);
    } catch (e) {
        document.getElementById('eventsContainer').innerHTML =
            '<div class="menu-loading">Пока нет запланированных событий</div>';
    }
}

function renderCalendar() {
    const container = document.getElementById('eventsContainer');
    
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const daysOfWeek = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startDay = firstDay.getDay() || 7; // Пн=1, Вс=7
    const totalDays = lastDay.getDate();
    
    let calendarHTML = '';
    
    // Ячейки до первого дня
    for (let i = 1; i < startDay; i++) {
        calendarHTML += '<div class="cal-day empty"></div>';
    }
    
    // Дни месяца
    const today = new Date();
    for (let d = 1; d <= totalDays; d++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const hasEvent = eventDates[dateStr];
        const isToday = d === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
        
        calendarHTML += `
            <div class="cal-day ${hasEvent ? 'has-event' : ''} ${isToday ? 'today' : ''}" 
                 ${hasEvent ? `onclick="showDayEvents('${dateStr}')"` : ''}>
                <span class="cal-num">${d}</span>
                ${hasEvent ? '<span class="cal-dot"></span>' : ''}
            </div>
        `;
    }
    
    container.innerHTML = `
        <div class="category-title">Events</div>
        
        <div class="calendar-card">
            <div class="cal-header">
                <button class="cal-nav" onclick="changeMonth(-1)">‹</button>
                <span class="cal-month-title">${months[currentMonth]} ${currentYear}</span>
                <button class="cal-nav" onclick="changeMonth(1)">›</button>
            </div>
            <div class="cal-weekdays">
                ${daysOfWeek.map(d => `<span>${d}</span>`).join('')}
            </div>
            <div class="cal-grid">
                ${calendarHTML}
            </div>
        </div>
        
        <div class="upcoming-events" id="upcomingEvents">
            <div class="category-subtitle">Upcoming</div>
            <div id="upcomingList"></div>
        </div>
    `;
}

function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
    // Перезагружаем события на новый месяц
    loadMonthEvents();
}

async function loadMonthEvents() {
    const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    try {
        const events = await fetch(`${API_BASE}/api/events?month=${monthStr}`).then(r => r.json());
        eventDates = {};
        events.forEach(e => {
            if (!eventDates[e.event_date]) eventDates[e.event_date] = [];
            eventDates[e.event_date].push(e);
        });
        renderCalendar();
        renderUpcomingEvents(events);
    } catch (e) {}
}

function showDayEvents(dateStr) {
    const events = eventDates[dateStr] || [];
    if (!events.length) return;
    
    const d = new Date(dateStr);
    const dateFormatted = d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', weekday: 'long' });
    
    const html = `
        <div style="margin-bottom:16px;">
            <h4>${dateFormatted}</h4>
        </div>
        ${events.map(e => `
            <div class="event-card-glass" style="margin-bottom:12px;">
                <div class="event-info">
                    <div class="event-title">${esc(e.title)}</div>
                    <div class="event-meta">${e.event_time?.slice(0,5)}</div>
                    ${e.description ? `<div class="event-desc">${esc(e.description)}</div>` : ''}
                </div>
            </div>
        `).join('')}
    `;
    
    showGuestModal('📅 Event Details', html);
}



// Модалка для гостевой страницы
function showGuestModal(title, content) {
    let modal = document.getElementById('guestModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'guestModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <h3 id="guestModalTitle" style="color:var(--text);margin-bottom:16px;"></h3>
                <div id="guestModalBody"></div>
                <button class="btn btn-outline" onclick="closeGuestModal()" style="width:100%;margin-top:12px;">Close</button>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', function(e) {
            if (e.target === this) closeGuestModal();
        });
    }
    
    document.getElementById('guestModalTitle').textContent = title;
    document.getElementById('guestModalBody').innerHTML = content;
    modal.classList.add('active');
}

function closeGuestModal() {
    const modal = document.getElementById('guestModal');
    if (modal) modal.classList.remove('active');
}

function renderUpcomingEvents(events) {
    const list = document.getElementById('upcomingList');
    if (!list) return;
    
    const upcoming = events
        .filter(e => new Date(e.event_date) >= new Date(new Date().setHours(0,0,0,0)))
        .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
        .slice(0, 5);
    
    if (!upcoming.length) {
        list.innerHTML = '<div class="menu-loading">Нет ближайших событий</div>';
        return;
    }
    
    list.innerHTML = upcoming.map(e => {
        const d = new Date(e.event_date);
        const dateStr = d.toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
        
        return `
            <div class="event-card-glass" onclick="showEventDetail('${e.id}')">
                <div class="event-date-badge">
                    <span class="event-day">${d.getDate()}</span>
                    <span class="event-month">${d.toLocaleDateString('en-US', {month: 'short'})}</span>
                </div>
                <div class="event-info">
                    <div class="event-title">${esc(e.title)}</div>
                    <div class="event-meta">${dateStr} • ${e.event_time?.slice(0,5)}</div>
                    ${e.description ? `<div class="event-desc">${esc(e.description).substring(0, 80)}${e.description.length > 80 ? '...' : ''}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function showDayEvents(dateStr) {
    const events = eventDates[dateStr] || [];
    if (!events.length) return;
    
    const d = new Date(dateStr);
    const dateFormatted = d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', weekday: 'long' });
    
    const html = `
        <div style="margin-bottom:16px;">
            <h4 style="font-family:'Tilt Neon',sans-serif;font-weight:400;">${dateFormatted}</h4>
        </div>
        ${events.map(e => `
            <div class="event-card-glass" style="margin-bottom:8px;cursor:pointer;" onclick="showEventDetail('${e.id}')">
                <div class="event-info">
                    <div class="event-title">${esc(e.title)}</div>
                    <div class="event-meta">${e.event_time?.slice(0,5)}</div>
                    ${e.description ? `<div class="event-desc">${esc(e.description)}</div>` : ''}
                </div>
            </div>
        `).join('')}
    `;
    
    showGuestModal('📅 Events', html);
}

function showEventDetail(eventId) {
    // Ищем событие во всех eventDates
    let event = null;
    for (const date in eventDates) {
        const found = eventDates[date].find(e => e.id === eventId);
        if (found) { event = found; break; }
    }
    
    if (!event) return;
    
    const d = new Date(event.event_date);
    const dateFormatted = d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', weekday: 'long' });
    
    const html = `
        <div style="margin-bottom:20px;">
            <div style="font-family:'Tilt Neon',sans-serif;font-size:1.4em;font-weight:400;margin-bottom:8px;">${esc(event.title)}</div>
            <div class="event-date-badge" style="display:inline-flex;margin-bottom:12px;">
                <span class="event-day">${d.getDate()}</span>
                <span class="event-month">${d.toLocaleDateString('en-US', {month: 'short'})}</span>
            </div>
            <div style="font-size:0.9em;color:var(--text-secondary);margin-bottom:12px;">
                ${dateFormatted} • ${event.event_time?.slice(0,5)}
            </div>
            ${event.description ? `<div style="font-size:0.9em;color:var(--text);line-height:1.5;">${esc(event.description)}</div>` : ''}
        </div>
    `;
    
    showGuestModal('📅 Event Details', html);
}

// ============ УТИЛИТЫ ============

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

// ============ ЗАПУСК ============
loadMenu();
