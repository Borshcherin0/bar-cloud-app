// ============ НАПИТКИ (drag-and-drop) ============
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

// === DRAG AND DROP ===
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

    // Убираем подсветку со всех в этом контейнере
    const container = this.closest('.drink-category') || this.closest('.card');
    if (container) {
        container.querySelectorAll('.list-item').forEach(item => {
            item.classList.remove('drag-over-top', 'drag-over-bottom');
        });
    }

    // Показываем куда вставим
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
    this.classList.remove('drag-over-top', 'drag-over-bottom');

    if (!draggedItem || this === draggedItem) return;

    const rect = this.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;

    // Вставляем элемент
    if (e.clientY < midpoint) {
        this.parentNode.insertBefore(draggedItem, this);
    } else {
        this.parentNode.insertBefore(draggedItem, this.nextSibling);
    }

    // Сохраняем новый порядок
    const container = this.closest('.drink-category') || this.closest('.card');
    await saveDrinksOrder(container);
}

async function saveDrinksOrder(container) {
    const items = container.querySelectorAll('[data-drink-id]');
    const itemsList = [];

    items.forEach((item, index) => {
        const drinkId = item.getAttribute('data-drink-id');
        if (drinkId) {
            itemsList.push({
                id: drinkId,
                sort_order: index
            });
        }
    });

    if (itemsList.length === 0) return;

    console.log('Сохраняю порядок:', JSON.stringify({ items: itemsList }));

    try {
        const response = await fetch('/api/drinks/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: itemsList })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Ошибка сервера:', response.status, errorText);
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        console.log('Порядок сохранён:', result);

        // Обновляем allDrinks без перезагрузки
        itemsList.forEach(update => {
            const drink = allDrinks.find(d => d.id === update.id);
            if (drink) drink.sort_order = update.sort_order;
        });
    } catch (e) {
        console.error('Ошибка сохранения порядка:', e);
        showToast('Ошибка сортировки', 'err');
        await loadDrinks(); // Перезагружаем для восстановления
    }
}

// === РЕДАКТИРОВАНИЕ ===
function startEditDrink(id) {
    const drink = allDrinks.find(d => d.id === id);
    if (!drink) return;

    const card = document.querySelector(`[data-drink-id="${id}"]`);

    // Сохраняем оригинальный HTML для отмены
    card.setAttribute('data-original-html', card.innerHTML);
    card.setAttribute('draggable', 'false');
    card.style.cursor = 'default';

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
    const name = card.querySelector('.edit-name')?.value?.trim();
    const price = parseInt(card.querySelector('.edit-price')?.value);
    const category = card.querySelector('.edit-category')?.value;
    const priceType = card.querySelector('.edit-price-type')?.value;

    if (!name || isNaN(price) || price === 0) return showToast('Проверь данные', 'err');

    updateDrink(id, { name, price, category, price_type: priceType });
}

// === ОТОБРАЖЕНИЕ ===
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

function renderDrinkItem(d, isFirst, isLast) {
    const priceClass = getPriceClass(d.price, d.price_type);
    const typeIcon = getTypeIcon(d.price_type);
    
    // Форматируем цену без знака + для положительных
    const priceDisplay = d.price > 0 ? `${d.price} ₽` : `${d.price} ₽`;
    
    return `
        <div class="list-item" draggable="true" data-drink-id="${d.id}">
            <span class="drag-handle" style="cursor:grab;margin-right:8px;color:var(--muted);user-select:none;">⋮⋮</span>
            <span style="flex:1;pointer-events:none;">
                ${typeIcon}
                🍹 ${esc(d.name)} — 
                <strong class="${priceClass}">${priceDisplay}</strong>
                ${d.price_type !== 'regular' ? `<span style="font-size:10px;color:var(--muted);">(${d.price_type})</span>` : ''}
            </span>
            <div style="display:flex;gap:4px;align-items:center;" class="item-actions">
                <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();startEditDrink('${d.id}')">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteDrink('${d.id}')">✕</button>
                <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();showDrinkComposition('${d.id}')">🧪</button>
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

        html += `<div class="card drink-category" style="border-left: 3px solid var(--accent);">
            <h3>${cat.name} <span style="color:var(--muted);font-size:0.7em;">(${cat.drinks.length})</span>
                <span style="font-size:10px;color:var(--muted);margin-left:8px;">🖱 перетаскивай для сортировки</span>
            </h3>`;

        cat.drinks.forEach(d => {
            html += renderDrinkItem(d);
        });

        html += '</div>';
    }

    // Скидки и возвраты
    if (discounts.length > 0) {
        html += `<div class="card drink-category" style="border-left: 3px solid var(--red);">
            <h3>🔻 Скидки, возвраты, комплименты <span style="color:var(--muted);font-size:0.7em;">(${discounts.length})</span>
                <span style="font-size:10px;color:var(--muted);margin-left:8px;">🖱 перетаскивай для сортировки</span>
            </h3>`;

        discounts.forEach(d => {
            html += renderDrinkItem(d);
        });

        html += '</div>';
    }

    c.innerHTML = html;

    // Навешиваем обработчики drag-and-drop
    c.querySelectorAll('.list-item[draggable="true"]').forEach(item => {
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
