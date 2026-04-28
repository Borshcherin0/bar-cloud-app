// ============ НАПИТКИ ============
let drinkCategoryFilter = 'all';
let drinksSortOrder = [];

async function loadDrinks() {
    try {
        const params = new URLSearchParams();
        const searchInput = document.getElementById('drinkSearch');
        if (searchInput && searchInput.value.trim()) {
            params.append('search', searchInput.value.trim());
        }
        if (drinkCategoryFilter !== 'all') {
            params.append('category', drinkCategoryFilter);
        }
        
        const queryString = params.toString();
        allDrinks = await api('GET', `/api/drinks${queryString ? '?' + queryString : ''}`);
        renderDrinks();
        updateSelects();
    } catch (e) {
        console.error('Ошибка загрузки напитков:', e);
        showToast('Ошибка загрузки напитков', 'err');
    }
}

async function addDrink() {
    const name = document.getElementById('drinkName').value.trim();
    const price = parseInt(document.getElementById('drinkPrice').value);
    const category = document.getElementById('drinkCategory').value;
    
    if (!name || isNaN(price) || price <= 0) return showToast('Проверь данные', 'err');
    
    try {
        await api('POST', '/api/drinks', { 
            name, 
            price, 
            category,
            sort_order: allDrinks.filter(d => d.category === category).length
        });
        document.getElementById('drinkName').value = '';
        document.getElementById('drinkPrice').value = '';
        await loadDrinks();
        showToast('🍹 Напиток добавлен');
    } catch (e) { showToast(e.message, 'err'); }
}

async function updateDrink(id, data) {
    try {
        await api('PUT', `/api/drinks/${id}`, data);
        await loadDrinks();
        showToast('✅ Обновлено');
    } catch (e) { showToast(e.message, 'err'); }
}

async function deleteDrink(id) {
    if (!confirm('Удалить напиток?')) return;
    try {
        await api('DELETE', `/api/drinks/${id}`);
        await loadDrinks();
        showToast('🗑 Удалён');
    } catch (e) { showToast(e.message, 'err'); }
}

async function reorderDrinks(items) {
    try {
        await api('PUT', '/api/drinks/reorder', items);
    } catch (e) { console.error('Ошибка сортировки:', e); }
}

function startEditDrink(id) {
    const drink = allDrinks.find(d => d.id === id);
    if (!drink) return;
    
    const card = document.querySelector(`[data-drink-id="${id}"]`);
    card.innerHTML = `
        <div class="row" style="flex:1;">
            <input type="text" class="edit-name" value="${esc(drink.name)}" style="flex:2;">
            <input type="number" class="edit-price" value="${drink.price}" style="max-width:80px;">
            <select class="edit-category">
                <option value="alco" ${drink.category==='alco'?'selected':''}>🍸 Алко</option>
                <option value="no_alco" ${drink.category==='no_alco'?'selected':''}>🥤 Без алко</option>
                <option value="hookah" ${drink.category==='hookah'?'selected':''}>💨 Кальян</option>
                <option value="poker" ${drink.category==='poker'?'selected':''}>♠️ Покер</option>
            </select>
        </div>
        <div style="display:flex;gap:4px;">
            <button class="btn btn-green btn-sm" onclick="saveEditDrink('${id}')">✓</button>
            <button class="btn btn-outline btn-sm" onclick="loadDrinks()">✕</button>
        </div>
    `;
}

function saveEditDrink(id) {
    const card = document.querySelector(`[data-drink-id="${id}"]`);
    const name = card.querySelector('.edit-name').value.trim();
    const price = parseInt(card.querySelector('.edit-price').value);
    const category = card.querySelector('.edit-category').value;
    
    if (!name || isNaN(price) || price <= 0) return showToast('Проверь данные', 'err');
    
    updateDrink(id, { name, price, category });
}

function moveDrink(id, direction) {
    const categoryDrinks = allDrinks.filter(d => d.category === allDrinks.find(x => x.id === id)?.category);
    const currentIndex = categoryDrinks.findIndex(d => d.id === id);
    const newIndex = currentIndex + direction;
    
    if (newIndex < 0 || newIndex >= categoryDrinks.length) return;
    
    // Меняем sort_order
    const updates = [
        { id: categoryDrinks[currentIndex].id, sort_order: newIndex },
        { id: categoryDrinks[newIndex].id, sort_order: currentIndex },
    ];
    
    reorderDrinks(updates).then(() => loadDrinks());
}

function renderDrinks() {
    const c = document.getElementById('drinksList');
    if (!allDrinks.length) {
        c.innerHTML = '<div class="empty">Меню пусто</div>';
        return;
    }
    
    // Группируем по категориям
    const categories = {
        'alco': { name: '🍸 Алкоголь', drinks: [] },
        'no_alco': { name: '🥤 Безалкогольные', drinks: [] },
        'hookah': { name: '💨 Кальяны', drinks: [] },
        'poker': { name: '♠️ Покер', drinks: [] },
    };
    
    allDrinks.forEach(d => {
        if (categories[d.category]) {
            categories[d.category].drinks.push(d);
        }
    });
    
    let html = '';
    
    for (const [key, cat] of Object.entries(categories)) {
        if (cat.drinks.length === 0) continue;
        
        html += `<div class="card" style="border-left: 3px solid var(--accent);">
            <h3>${cat.name} <span style="color:var(--muted);font-size:0.7em;">(${cat.drinks.length})</span></h3>`;
        
        cat.drinks.forEach((d, index) => {
            html += `
                <div class="list-item" data-drink-id="${d.id}">
                    <span>🍹 ${esc(d.name)} — <strong>${d.price} ₽</strong></span>
                    <div style="display:flex;gap:4px;align-items:center;">
                        <button class="btn btn-outline btn-sm" onclick="moveDrink('${d.id}', -1)" ${index === 0 ? 'disabled' : ''}>↑</button>
                        <button class="btn btn-outline btn-sm" onclick="moveDrink('${d.id}', 1)" ${index === cat.drinks.length-1 ? 'disabled' : ''}>↓</button>
                        <button class="btn btn-outline btn-sm" onclick="startEditDrink('${d.id}')">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteDrink('${d.id}')">✕</button>
                    </div>
                </div>`;
        });
        
        html += '</div>';
    }
    
    c.innerHTML = html;
}
