// ============ ГОСТЕВОЕ МЕНЮ ============
const API_BASE = window.location.origin;

const CATEGORIES = {
    'alco': { name: 'Cocktails', icon: '🍸' },
    'no_alco': { name: 'Soft Drinks', icon: '🥤' },
    'hookah': { name: 'Hookah', icon: '💨' },
    'poker': { name: 'Poker', icon: '♠️' },
};

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
    const navContainer = document.getElementById('categoriesNav');

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

    // Навигация
    navContainer.innerHTML = activeCategories.map(([key, cat], i) => `
        <button class="cat-btn ${i === 0 ? 'active' : ''}" onclick="scrollToCat('${key}', this)">
            ${cat.icon} ${cat.name}
        </button>
    `).join('');

    // Меню
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

function scrollToCat(key, btn) {
    document.getElementById('cat-' + key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

// Запуск
loadMenu();

async function loadEvents() {
    try {
        const events = await fetch(`${API_BASE}/api/events`).then(r => r.json());
        renderEvents(events);
    } catch (e) {
        document.getElementById('eventsList').innerHTML = '';
    }
}

function renderEvents(events) {
    const container = document.getElementById('eventsList');
    if (!events.length) {
        container.innerHTML = '<div class="menu-loading">Пока нет запланированных событий</div>';
        return;
    }
    
    container.innerHTML = events.map(e => {
        const d = new Date(e.event_date);
        const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        const dayName = d.toLocaleDateString('ru-RU', { weekday: 'short' });
        
        return `
            <div class="event-card">
                <div class="event-date-badge">
                    <span class="event-day">${d.getDate()}</span>
                    <span class="event-month">${d.toLocaleDateString('ru-RU', {month: 'short'})}</span>
                </div>
                <div class="event-info">
                    <div class="event-title">${esc(e.title)}</div>
                    <div class="event-meta">${dayName}, ${dateStr} • ${e.event_time.slice(0,5)}</div>
                    ${e.description ? `<div class="event-desc">${esc(e.description)}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Вызов при загрузке
loadEvents();
