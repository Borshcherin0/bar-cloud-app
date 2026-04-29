// ============ НАПИТКИ ============
let drinkCategoryFilter = 'all';
let drinkTypeFilter = 'all';
let draggedItem = null;

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
    } catch (e) {
        showToast(e.message, 'err');
    }
}

async function updateDrink(id, data) {
    try {
        await api('PUT', `/api/drinks/${id}`, data);
        await loadDrinks();
        showToast('✅ Обновлено');
    } catch (e) {
        showToast(e.message, 'err');
    }
}

async function deleteDrink(id) {
    if (!confirm('Удалить позицию?')) return;
    try {
        await api('DELETE', `/api/drinks/${id}`);
        await loadDrinks();
        showToast('🗑 Удалена');
    } catch (e) {
        showToast(e.message, 'err');
    }
}

// Сохраняем порядок напитков в категории
async function saveDrinksOrder(categoryElement) {
    // Собираем все элементы с data-drink-id в порядке их расположения
    const items = categoryElement.querySelectorAll('[data-drink-id]');
    const updates = [];
    
    items.forEach((item, index) => {
        updates.push({
            id: item.dataset.drinkId,
            sort_order: index
        });
    });
    
    console.log('Сохраняем порядок:', updates);
    
    try {
        await api('PUT', '/api/drinks/reorder', updates);
        return true;
    } catch (e) {
        console.error('Ошибка сохранения порядка:', e);
        showToast('Ошибка сортировки: ' + e.message, 'err');
        return false;
    }
}

// Drag and drop handlers
function handleDragStart(e) {
    draggedItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    draggedItem = null;
    
    // Убираем все подсветки
    document.querySelectorAll('.list-item').forEach(item => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (!draggedItem || this === draggedItem) return;
    
    // Убираем подсветку со всех элементов в этой категории
    const category = this.closest('.drink-category');
    category.querySelectorAll('.list-item').forEach(item => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    
    // Определяем куда вставлять
    const rect = this.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    
    if (e.clientY < midpoint) {
        this.classList.add('drag-over-top');
    } else {
        this.classList.add('drag-over-bottom');
    }
}

function handleDragLeave(e) {
    this.classList.remove('drag-over-top', 'drag-over-bottom');
}

async function handleDrop(e) {
    e.preventDefault();
    
    // Убираем подсветку
    this.classList.remove('drag-over-top', 'drag-over-bottom');
    
    if (!draggedItem || this === draggedItem) return;
    
    const rect = this.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    
    // Вставляем элемент до или после
    if (e.clientY < midpoint) {
        this.parentNode.insertBefore(draggedItem, this);
    } else {
        this.parentNode.insertBefore(draggedItem, this.nextSibling);
    }
    
    // Сохраняем новый порядок
    const categoryElement = this.closest('.drink-category');
    await saveDrinksOrder(categoryElement);
    
    // Обновляем allDrinks для соответствия новому порядку
    await loadDrinks();
}

function startEditDrink(id) {
    const drink = allDrinks.find(d => d.id === id);
    if (!drink) return;
    
    const card = document.querySelector(`[data-drink-id="${id}"]`);
    // Сохраняем атрибуты для drag-and-drop
    card.setAttribute('draggable', 'false');
    
    card.innerHTML = `
        <div class="row" style="flex:1;align-items:center;">
            <input type="text" class="edit-name" value="${esc(drink.name)}" style="flex:2;">
            <input type="number" class="edit-price" value="${drink.price}" style="max-width:90px;" placeholder="-100">
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

function renderDrinkItem(d) {
    const priceClass = getPriceClass(d.price, d.price_type);
    const typeIcon = getTypeIcon(d.price_type);
    
    return `
        <div class="list-item" draggable="true" data-drink-id="${d.id}">
            <span style="cursor:grab;margin-right:4px;color:var(--muted);">⋮⋮</span>
            <span style="flex:1;">
                ${typeIcon}
                🍹 ${esc(d.name)} — 
                <strong class="${priceClass}">${d.price > 0 ? '+' : ''}${d.price} ₽</strong>
                ${d.price_type !== 'regular' ? `<span style="font-size:10px;color:var(--muted);">(${d.price_type})</span>` : ''}
            </span>
            <div style="display:flex;gap:4px;align-items:center;">
                <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();startEditDrink('${d.id}')">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteDrink('${d.id}')">✕</button>
            </div>
        </div>`;
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
    
    const discounts = [];
    
    allDrinks.forEach(d => {
        if (d.price < 0 || d.price_type !== 'regular') {
            discounts.push(d);
        } else if (categories[d.category]) {
            categories[d.category].drinks.push(d);
        }
    });
    
    let html = '';
    
    // Обычные категории
    for (const [key, cat] of Object.entries(categories)) {
        if (cat.drinks.length === 0) continue;
        
        html += `<div class="card drink-category" data-category="${key}" style="border-left: 3px solid var(--accent);">
            <h3>${cat.name} <span style="color:var(--muted);font-size:0.7em;">(${cat.drinks.length})</span>
                <span style="font-size:10px;color:var(--muted);margin-left:8px;">🖱 перетаскивай</span>
            </h3>
            <div class="category-items">`;
        
        cat.drinks.forEach(d => {
            html += renderDrinkItem(d);
        });
        
        html += `</div></div>`;
    }
    
    // Скидки
    if (discounts.length > 0) {
        html += `<div class="card drink-category" data-category="discounts" style="border-left: 3px solid var(--red);">
            <h3>🔻 Скидки, возвраты, комплименты <span style="color:var(--muted);font-size:0.7em;">(${discounts.length})</span>
                <span style="font-size:10px;color:var(--muted);margin-left:8px;">🖱 перетаскивай</span>
            </h3>
            <div class="category-items">`;
        
        discounts.forEach(d => {
            html += renderDrinkItem(d);
        });
        
        html += `</div></div>`;
    }
    
    c.innerHTML = html;
    
    // Навешиваем обработчики на элементы внутри category-items
    document.querySelectorAll('.drink-category .list-item').forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', handleDrop);
    });
}

function updateFilterTabs() {
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    const activeIndex = drinkTypeFilter === 'all' ? 0 : drinkTypeFilter === 'positive' ? 1 : 2;
    const tabs = document.querySelectorAll('.filter-tab');
    if (tabs[activeIndex]) tabs[activeIndex].classList.add('active');
}
