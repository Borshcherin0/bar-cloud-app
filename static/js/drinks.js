// ============ НАПИТКИ ============
let drinkCategoryFilter = 'all';
let drinkTypeFilter = 'all'; // all, positive, negative

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
        if (drinkTypeFilter === 'negative') {
            params.append('category', 'negative');
        } else if (drinkTypeFilter === 'positive') {
            params.append('category', 'positive');
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
    const priceType = document.getElementById('drinkPriceType')?.value || 'regular';
    
    if (!name || isNaN(price)) return showToast('Проверь данные', 'err');
    if (price === 0) return showToast('Цена не может быть нулевой', 'err');
    
    // Предупреждение для отрицательных цен
    if (price < 0 && !confirm(`Добавить позицию с отрицательной ценой ${price}₽?`)) return;
    
    try {
        await api('POST', '/api/drinks', { 
            name, 
            price, 
            category,
            price_type: price < 0 ? 'discount' : priceType,
            sort_order: allDrinks.filter(d => d.category === category).length
        });
        document.getElementById('drinkName').value = '';
        document.getElementById('drinkPrice').value = '';
        await loadDrinks();
        showToast(price < 0 ? '🔻 Скидка добавлена' : '🍹 Напиток добавлен');
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
    if (!confirm('Удалить позицию?')) return;
    try {
        await api('DELETE', `/api/drinks/${id}`);
        await loadDrinks();
        showToast('🗑 Удалена');
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
            <input type="number" class="edit-price" value="${drink.price}" style="max-width:90px;" 
                   placeholder="Может быть отрицательным">
            <select class="edit-category">
                <option value="alco" ${drink.category==='alco'?'selected':''}>🍸 Алко</option>
                <option value="no_alco" ${drink.category==='no_alco'?'selected':''}>🥤 Без алко</option>
                <option value="hookah" ${drink.category==='hookah'?'selected':''}>💨 Кальян</option>
                <option value="poker" ${drink.category==='poker'?'selected':''}>♠️ Покер</option>
            </select>
            <select class="edit-price-type">
                <option value="regular" ${drink.price_type==='regular'?'selected':''}>Обычная</option>
                <option value="discount" ${drink.price_type==='discount'?'selected':''}>Скидка</option>
                <option value="refund" ${drink.price_type==='refund'?'selected':''}>Возврат</option>
                <option value="compliment" ${drink.price_type==='compliment'?'selected':''}>Комплимент</option>
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
    const priceType = card.querySelector('.edit-price-type').value;
    
    if (!name || isNaN(price) || price === 0) return showToast('Проверь данные', 'err');
    
    updateDrink(id, { name, price, category, price_type: priceType });
}

function moveDrink(id, direction) {
    const drink = allDrinks.find(d => d.id === id);
    if (!drink) return;
    
    const categoryDrinks = allDrinks.filter(d => d.category === drink.category);
    const currentIndex = categoryDrinks.findIndex(d => d.id === id);
    const newIndex = currentIndex + direction;
    
    if (newIndex < 0 || newIndex >= categoryDrinks.length) return;
    
    const updates = [
        { id: categoryDrinks[currentIndex].id, sort_order: newIndex },
        { id: categoryDrinks[newIndex].id, sort_order: currentIndex },
    ];
    
    reorderDrinks(updates).then(() => loadDrinks());
}

function getPriceClass(price, priceType) {
    if (priceType === 'discount') return 'price-discount';
    if (priceType === 'refund') return 'price-refund';
    if (priceType === 'compliment') return 'price-compliment';
    if (price < 0) return 'price-negative';
    return 'price-regular';
}

function getTypeIcon(priceType) {
    const icons = {
        'discount': '🔻',
        'refund': '↩️',
        'compliment': '🎁',
        'regular': ''
    };
    return icons[priceType] || '';
}

function renderDrinks() {
    const c = document.getElementById('drinksList');
    if (!allDrinks.length) {
        c.innerHTML = '<div class="empty">Меню пусто</div>';
        return;
    }
    
    // Разделяем на категории
    const categories = {
        'alco': { name: '🍸 Алкоголь', drinks: [] },
        'no_alco': { name: '🥤 Безалкогольные', drinks: [] },
        'hookah': { name: '💨 Кальяны', drinks: [] },
        'poker': { name: '♠️ Покер', drinks: [] },
    };
    
    // Отдельно скидки
    const discounts = [];
    
    allDrinks.forEach(d => {
        if (d.price < 0 || d.price_type !== 'regular') {
            discounts.push(d);
        } else if (categories[d.category]) {
            categories[d.category].drinks.push(d);
        } else {
            // Неизвестная категория
            if (!categories[d.category]) {
                categories[d.category] = { name: d.category, drinks: [] };
            }
            categories[d.category].drinks.push(d);
        }
    });
    
    let html = '';
    
    // Обычные категории
    for (const [key, cat] of Object.entries(categories)) {
        if (cat.drinks.length === 0) continue;
        
        html += `<div class="card" style="border-left: 3px solid var(--accent);">
            <h3>${cat.name} <span style="color:var(--muted);font-size:0.7em;">(${cat.drinks.length})</span></h3>`;
        
        cat.drinks.forEach((d, index) => {
            html += renderDrinkItem(d, index, cat.drinks.length);
        });
        
        html += '</div>';
    }
    
    // Скидки и возвраты
    if (discounts.length > 0) {
        html += `<div class="card" style="border-left: 3px solid var(--red);">
            <h3>🔻 Скидки, возвраты, комплименты <span style="color:var(--muted);font-size:0.7em;">(${discounts.length})</span></h3>`;
        
        discounts.forEach((d, index) => {
            html += renderDrinkItem(d, index, discounts.length);
        });
        
        html += '</div>';
    }
    
    c.innerHTML = html;
}

function renderDrinkItem(d, index, total) {
    const priceClass = getPriceClass(d.price, d.price_type);
    const typeIcon = getTypeIcon(d.price_type);
    
    return `
        <div class="list-item" data-drink-id="${d.id}">
            <span>
                ${typeIcon}
                🍹 ${esc(d.name)} — 
                <strong class="${priceClass}">${d.price > 0 ? '+' : ''}${d.price} ₽</strong>
                ${d.price_type !== 'regular' ? `<span style="font-size:10px;color:var(--muted);">(${d.price_type})</span>` : ''}
            </span>
            <div style="display:flex;gap:4px;align-items:center;">
                <button class="btn btn-outline btn-sm" onclick="moveDrink('${d.id}', -1)" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button class="btn btn-outline btn-sm" onclick="moveDrink('${d.id}', 1)" ${index === total-1 ? 'disabled' : ''}>↓</button>
                <button class="btn btn-outline btn-sm" onclick="startEditDrink('${d.id}')">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="deleteDrink('${d.id}')">✕</button>
            </div>
        </div>`;
}
