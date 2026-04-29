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
    
    // Сотрудники отдельно
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
    
    // Напитки с поиском
    updateDrinkSelect();
}

function updateDrinkSelect(filter = '') {
    const ds = document.getElementById('barDrink');
    const searchInput = document.getElementById('drinkSearchInput');
    const searchTerm = (searchInput?.value || filter).toLowerCase();
    
    const filtered = searchTerm 
        ? allDrinks.filter(d => d.name.toLowerCase().includes(searchTerm))
        : allDrinks;
    
    // Группируем по категориям
    const categories = {
        'alco': '🍸 Алко',
        'no_alco': '🥤 Без алко',
        'hookah': '💨 Кальян',
        'poker': '♠️ Покер',
    };
    
    let html = '<option value="">Напиток...</option>';
    
    for (const [cat, catName] of Object.entries(categories)) {
        const catDrinks = filtered.filter(d => d.category === cat);
        if (catDrinks.length > 0) {
            html += `<optgroup label="${catName}">`;
            catDrinks.forEach(d => {
                html += `<option value="${d.id}">🍹 ${esc(d.name)} (${d.price}₽)</option>`;
            });
            html += '</optgroup>';
        }
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
