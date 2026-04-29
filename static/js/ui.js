// ============ UI МОДУЛЬ ============

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function showToast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 2100);
}

async function checkServer() {
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusText');
    dot.className = 'status-dot checking';
    txt.textContent = 'Проверка...';
    try {
        await api('GET', '/api/guests');
        dot.className = 'status-dot online';
        txt.textContent = 'Сервер онлайн • Neon PostgreSQL';
    } catch (e) {
        dot.className = 'status-dot offline';
        txt.textContent = 'Сервер офлайн';
    }
}

async function switchPanel(name) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-panel="${name}"]`)?.classList.add('active');
    document.getElementById(`panel-${name}`)?.classList.add('active');

    if (name === 'bill') await renderBill();
    if (name === 'history') await renderHistory();
    if (name === 'analytics') await renderAnalytics();
    if (name === 'bar') await renderOrders();
}

function updateSelects() {
    // Гости — показываем всех
    const gs = document.getElementById('barGuest');
    gs.innerHTML = '<option value="">Гость...</option>';
    
    const staff = allGuests.filter(g => g.role === 'staff');
    const guests = allGuests.filter(g => g.role !== 'staff');
    
    if (guests.length > 0) {
        gs.innerHTML += '<optgroup label="👤 Гости">';
        guests.forEach(g => {
            gs.innerHTML += `<option value="${g.id}">👤 ${esc(g.name)}</option>`;
        });
        gs.innerHTML += '</optgroup>';
    }
    
    if (staff.length > 0) {
        gs.innerHTML += '<optgroup label="👔 Сотрудники">';
        staff.forEach(g => {
            gs.innerHTML += `<option value="${g.id}">👔 ${esc(g.name)}</option>`;
        });
        gs.innerHTML += '</optgroup>';
    }
    
    // Напитки — группируем по категориям как в меню
    updateDrinkSelect();
}

function updateDrinkSelect() {
    const ds = document.getElementById('barDrink');
    
    // Сортируем так же как в меню
    const sorted = [...allDrinks].sort((a, b) => {
        // Сначала по типу цены (regular вперёд)
        if (a.price_type !== b.price_type) {
            if (a.price_type === 'regular') return -1;
            if (b.price_type === 'regular') return 1;
        }
        // Потом по категории
        const catOrder = { 'alco': 0, 'no_alco': 1, 'hookah': 2, 'poker': 3 };
        if ((catOrder[a.category] || 99) !== (catOrder[b.category] || 99)) {
            return (catOrder[a.category] || 99) - (catOrder[b.category] || 99);
        }
        // Потом по sort_order
        return (a.sort_order || 0) - (b.sort_order || 0);
    });
    
    // Группируем по категориям
    const categories = {
        'alco': { name: '🍸 Алкоголь', drinks: [] },
        'no_alco': { name: '🥤 Безалкогольные', drinks: [] },
        'hookah': { name: '💨 Кальяны', drinks: [] },
        'poker': { name: '♠️ Покер', drinks: [] },
        'discounts': { name: '🔻 Скидки', drinks: [] },
    };
    
    sorted.forEach(d => {
        if (d.price_type !== 'regular') {
            categories['discounts'].drinks.push(d);
        } else if (categories[d.category]) {
            categories[d.category].drinks.push(d);
        }
    });
    
    let html = '<option value="">Напиток...</option>';
    
    for (const [key, cat] of Object.entries(categories)) {
        if (cat.drinks.length === 0) continue;
        
        html += `<optgroup label="${cat.name}">`;
        cat.drinks.forEach(d => {
            const icon = d.price_type !== 'regular' ? getTypeIcon(d.price_type) : '';
            const priceStr = d.price > 0 ? `${d.price}₽` : `${d.price}₽`;
            html += `<option value="${d.id}">${icon} ${esc(d.name)} (${priceStr})</option>`;
        });
        html += '</optgroup>';
    }
    
    ds.innerHTML = html;
}

function updateFilterTabs() {
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    const activeIndex = drinkTypeFilter === 'all' ? 0 : drinkTypeFilter === 'positive' ? 1 : 2;
    const tabs = document.querySelectorAll('.filter-tab');
    if (tabs[activeIndex]) tabs[activeIndex].classList.add('active');
}
