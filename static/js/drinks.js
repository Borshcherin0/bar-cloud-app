// ============ НАПИТКИ ============
let drinkCategoryFilter = 'all';
let drinkTypeFilter = 'all';

async function loadDrinks() {
    try {
        var params = new URLSearchParams();
        var searchInput = document.getElementById('drinkSearch');
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

        var queryString = params.toString();
        allDrinks = await api('GET', '/api/drinks' + (queryString ? '?' + queryString : ''));
        renderDrinks();
        updateSelects();
    } catch (e) {
        console.error(e);
    }
}

async function addDrink() {
    var name = document.getElementById('drinkName').value.trim();
    var price = parseInt(document.getElementById('drinkPrice').value);
    var category = document.getElementById('drinkCategory').value;
    var priceType = document.getElementById('drinkPriceType') ? document.getElementById('drinkPriceType').value : 'regular';

    if (!name || isNaN(price)) return showToast('Проверь данные', 'err');
    if (price === 0) return showToast('Цена не может быть нулевой', 'err');
    if (price < 0 && !confirm('Добавить с отрицательной ценой?')) return;

    try {
        await api('POST', '/api/drinks', {
            name: name,
            price: price,
            category: category,
            price_type: price < 0 ? 'discount' : priceType,
            sort_order: allDrinks.filter(function(d) { return d.category === category; }).length
        });
        document.getElementById('drinkName').value = '';
        document.getElementById('drinkPrice').value = '';
        await loadDrinks();
        showToast(price < 0 ? 'Скидка добавлена' : 'Напиток добавлен');
    } catch (e) { showToast(e.message, 'err'); }
}

async function updateDrink(id, data) {
    try {
        await api('PUT', '/api/drinks/' + id, data);
        await loadDrinks();
        showToast('Обновлено');
    } catch (e) { showToast(e.message, 'err'); }
}

async function deleteDrink(id) {
    if (!confirm('Удалить?')) return;
    try {
        await api('DELETE', '/api/drinks/' + id);
        await loadDrinks();
        showToast('Удалена');
    } catch (e) { showToast(e.message, 'err'); }
}

async function saveDrinksOrder(itemsList) {
    try {
        var response = await fetch('/api/drinks/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: itemsList })
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return true;
    } catch (e) {
        console.error(e);
        showToast('Ошибка сортировки', 'err');
        await loadDrinks();
        return false;
    }
}

async function moveDrinkUp(drinkId) {
    var drink = allDrinks.find(function(d) { return d.id === drinkId; });
    if (!drink) return;

    var categoryDrinks = allDrinks.filter(function(d) {
        if (drink.price_type !== 'regular') return d.price_type !== 'regular';
        return d.category === drink.category;
    }).sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

    var idx = categoryDrinks.findIndex(function(d) { return d.id === drinkId; });
    if (idx <= 0) return;

    var items = [
        { id: categoryDrinks[idx].id, sort_order: idx - 1 },
        { id: categoryDrinks[idx - 1].id, sort_order: idx }
    ];

    await saveDrinksOrder(items);
    await loadDrinks();
}

async function moveDrinkDown(drinkId) {
    var drink = allDrinks.find(function(d) { return d.id === drinkId; });
    if (!drink) return;

    var categoryDrinks = allDrinks.filter(function(d) {
        if (drink.price_type !== 'regular') return d.price_type !== 'regular';
        return d.category === drink.category;
    }).sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

    var idx = categoryDrinks.findIndex(function(d) { return d.id === drinkId; });
    if (idx >= categoryDrinks.length - 1) return;

    var items = [
        { id: categoryDrinks[idx].id, sort_order: idx + 1 },
        { id: categoryDrinks[idx + 1].id, sort_order: idx }
    ];

    await saveDrinksOrder(items);
    await loadDrinks();
}

function startEditDrink(id) {
    var drink = allDrinks.find(function(d) { return d.id === id; });
    if (!drink) return;

    var card = document.querySelector('[data-drink-id="' + id + '"]');
    card.setAttribute('draggable', 'false');
    card.style.cursor = 'default';

    // Предзаполненный путь
    var imagePath = drink.image_url || '/static/img/drinks/';

    card.innerHTML = 
        '<div class="row" style="flex:1;align-items:center;">' +
            '<input type="text" class="edit-name" value="' + esc(drink.name) + '" style="flex:2;">' +
            '<input type="number" class="edit-price" value="' + drink.price + '" style="max-width:90px;">' +
            '<select class="edit-category">' +
                '<option value="alco" ' + (drink.category==='alco'?'selected':'') + '>Алко</option>' +
                '<option value="no_alco" ' + (drink.category==='no_alco'?'selected':'') + '>Без алко</option>' +
                '<option value="hookah" ' + (drink.category==='hookah'?'selected':'') + '>Кальян</option>' +
                '<option value="poker" ' + (drink.category==='poker'?'selected':'') + '>Покер</option>' +
            '</select>' +
            '<select class="edit-price-type">' +
                '<option value="regular" ' + (drink.price_type==='regular'?'selected':'') + '>Обычная</option>' +
                '<option value="discount" ' + (drink.price_type==='discount'?'selected':'') + '>Скидка</option>' +
                '<option value="refund" ' + (drink.price_type==='refund'?'selected':'') + '>Возврат</option>' +
                '<option value="compliment" ' + (drink.price_type==='compliment'?'selected':'') + '>Комплимент</option>' +
            '</select>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">' +
            '<label style="cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;">' +
                '<input type="checkbox" class="edit-show-menu" ' + (drink.show_in_menu !== false ? 'checked' : '') + '>' +
                'Показывать в гостевом меню' +
            '</label>' +
        '</div>' +
        '<div style="margin-top:6px;">' +
            '<input type="text" class="edit-image-url" value="' + esc(imagePath) + '" placeholder="/static/img/drinks/..." style="width:100%;font-size:12px;">' +
            (drink.image_url && drink.image_url !== '/static/img/drinks/' ? '<img src="' + drink.image_url + '" style="width:40px;height:40px;object-fit:cover;border-radius:6px;margin-top:4px;">' : '') +
        '</div>' +
        '<div style="display:flex;gap:4px;margin-top:6px;">' +
            '<button class="btn btn-green btn-sm" onclick="saveEditDrink(\'' + id + '\')">OK</button>' +
            '<button class="btn btn-outline btn-sm" onclick="loadDrinks()">X</button>' +
        '</div>';
}

async function saveEditDrink(id) {
    var card = document.querySelector('[data-drink-id="' + id + '"]');
    var name = card.querySelector('.edit-name') ? card.querySelector('.edit-name').value.trim() : '';
    var price = parseInt(card.querySelector('.edit-price') ? card.querySelector('.edit-price').value : 0);
    var category = card.querySelector('.edit-category') ? card.querySelector('.edit-category').value : 'alco';
    var priceType = card.querySelector('.edit-price-type') ? card.querySelector('.edit-price-type').value : 'regular';
    var showInMenu = card.querySelector('.edit-show-menu') ? card.querySelector('.edit-show-menu').checked : true;
    var imageUrl = card.querySelector('.edit-image-url') ? card.querySelector('.edit-image-url').value.trim() : '';

    // Если оставили только путь к папке — не сохраняем
    if (imageUrl === '/static/img/drinks/') imageUrl = '';

    if (!name || isNaN(price) || price === 0) return showToast('Проверь данные', 'err');

    await updateDrink(id, { 
        name: name, price: price, category: category, 
        price_type: priceType, show_in_menu: showInMenu, image_url: imageUrl 
    });
    
    showToast('Сохранено');
    await loadDrinks();
}

function getPriceClass(price, priceType) {
    if (priceType === 'discount') return 'price-discount';
    if (priceType === 'refund') return 'price-refund';
    if (priceType === 'compliment') return 'price-compliment';
    if (price < 0) return 'price-negative';
    return 'price-regular';
}

function getTypeIcon(priceType) {
    var icons = { 'discount': '🔻', 'refund': '↩️', 'compliment': '🎁', 'regular': '' };
    return icons[priceType] || '';
}

function renderDrinkItem(d, isFirst, isLast) {
    var priceClass = getPriceClass(d.price, d.price_type);
    var typeIcon = getTypeIcon(d.price_type);
    var priceDisplay = d.price > 0 ? d.price + ' ₽' : d.price + ' ₽';

    return '<div class="list-item" draggable="true" data-drink-id="' + d.id + '">' +
        '<span class="drag-handle">⋮⋮</span>' +
        '<span style="flex:1;pointer-events:none;">' +
            typeIcon + ' 🍹 ' + esc(d.name) + ' — ' +
            '<strong class="' + priceClass + '">' + priceDisplay + '</strong>' +
            (d.price_type !== 'regular' ? '<span style="font-size:10px;color:var(--muted);">(' + d.price_type + ')</span>' : '') +
        '</span>' +
        '<div style="display:flex;gap:4px;" class="item-actions">' +
            '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();showDrinkComposition(\'' + d.id + '\')">🧪</button>' +
            '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();startEditDrink(\'' + d.id + '\')">✏️</button>' +
            '<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteDrink(\'' + d.id + '\')">✕</button>' +
        '</div>' +
    '</div>';
}

function renderDrinks() {
    var c = document.getElementById('drinksList');
    if (!allDrinks.length) { c.innerHTML = '<div class="empty">Меню пусто</div>'; return; }

    var categories = { 'alco': { name: '🍸 Алкоголь', drinks: [] }, 'no_alco': { name: '🥤 Безалкогольные', drinks: [] }, 'hookah': { name: '💨 Кальяны', drinks: [] }, 'poker': { name: '♠️ Покер', drinks: [] } };
    var discounts = [];

    allDrinks.forEach(function(d) {
        if (d.price < 0 || d.price_type !== 'regular') { discounts.push(d); }
        else if (categories[d.category]) { categories[d.category].drinks.push(d); }
    });

    var html = '';

    for (var key in categories) {
        var cat = categories[key];
        if (!cat.drinks.length) continue;
        html += '<div class="card" style="border-left:3px solid var(--accent);"><h3>' + cat.name + ' (' + cat.drinks.length + ')</h3>';
        cat.drinks.forEach(function(d, i) { html += renderDrinkItem(d, i === 0, i === cat.drinks.length - 1); });
        html += '</div>';
    }

    if (discounts.length > 0) {
        html += '<div class="card" style="border-left:3px solid var(--red);"><h3>🔻 Скидки (' + discounts.length + ')</h3>';
        discounts.forEach(function(d, i) { html += renderDrinkItem(d, i === 0, i === discounts.length - 1); });
        html += '</div>';
    }

    c.innerHTML = html;
}

function updateFilterTabs() {
    document.querySelectorAll('.filter-tab').forEach(function(t) { t.classList.remove('active'); });
    var idx = drinkTypeFilter === 'all' ? 0 : drinkTypeFilter === 'positive' ? 1 : 2;
    var tabs = document.querySelectorAll('.filter-tab');
    if (tabs[idx]) tabs[idx].classList.add('active');
}
