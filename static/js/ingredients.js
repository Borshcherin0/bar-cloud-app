// ============ ИНГРЕДИЕНТЫ ============
let allIngredients = [];

const ING_CATEGORIES = {
    'alco': '🍸 Алкоголь',
    'no_alco': '🥤 Безалкогольное',
    'syrup': '🍯 Сиропы',
    'plant': '🌿 Растительное',
    'other': '📦 Побочное'
};

async function loadIngredients() {
    try {
        allIngredients = await api('GET', '/api/ingredients');
        renderIngredients();
    } catch (e) {
        console.error('Ошибка загрузки:', e);
    }
}

async function addIngredient() {
    const name = document.getElementById('ingName').value.trim();
    const volume = parseFloat(document.getElementById('ingVolume').value);
    const cost = parseFloat(document.getElementById('ingCost').value);
    const unit = document.getElementById('ingUnit').value;
    const category = document.getElementById('ingCategory').value;
    
    if (!name || !volume || !cost) return showToast('Заполни все поля', 'err');
    
    try {
        await api('POST', '/api/ingredients', { name, volume, cost, unit, category });
        document.getElementById('ingName').value = '';
        document.getElementById('ingVolume').value = '';
        document.getElementById('ingCost').value = '';
        await loadIngredients();
        showToast('✅ Ингредиент добавлен');
    } catch (e) { showToast(e.message, 'err'); }
}

async function deleteIngredient(id) {
    if (!confirm('Удалить ингредиент?')) return;
    try {
        await api('DELETE', `/api/ingredients/${id}`);
        await loadIngredients();
        showToast('🗑 Удалён');
    } catch (e) { showToast(e.message, 'err'); }
}

function startEditIngredient(id) {
    const ing = allIngredients.find(i => i.id === id);
    if (!ing) return;
    
    const item = document.querySelector(`[data-ing-id="${id}"]`);
    item.innerHTML = `
        <div class="row" style="flex:1;align-items:center;">
            <input type="text" class="edit-ing-name" value="${esc(ing.name)}" style="flex:2;">
            <input type="number" class="edit-ing-volume" value="${ing.volume}" style="max-width:80px;">
            <select class="edit-ing-unit">
                <option value="ml" ${ing.unit==='ml'?'selected':''}>мл</option>
                <option value="g" ${ing.unit==='g'?'selected':''}>г</option>
                <option value="pcs" ${ing.unit==='pcs'?'selected':''}>шт</option>
            </select>
            <input type="number" class="edit-ing-cost" value="${ing.cost}" style="max-width:100px;">
            <select class="edit-ing-category">
                ${Object.entries(ING_CATEGORIES).map(([k, v]) => `
                    <option value="${k}" ${ing.category===k?'selected':''}>${v}</option>
                `).join('')}
            </select>
        </div>
        <div style="display:flex;gap:4px;">
            <button class="btn btn-green btn-sm" onclick="saveEditIngredient('${id}')">✓</button>
            <button class="btn btn-outline btn-sm" onclick="loadIngredients()">✕</button>
        </div>
    `;
}

async function saveEditIngredient(id) {
    const item = document.querySelector(`[data-ing-id="${id}"]`);
    const name = item.querySelector('.edit-ing-name').value.trim();
    const volume = parseFloat(item.querySelector('.edit-ing-volume').value);
    const cost = parseFloat(item.querySelector('.edit-ing-cost').value);
    const unit = item.querySelector('.edit-ing-unit').value;
    const category = item.querySelector('.edit-ing-category').value;
    
    if (!name || !volume || !cost) return showToast('Заполни все поля', 'err');
    
    try {
        await api('PUT', `/api/ingredients/${id}`, { name, volume, cost, unit, category });
        await loadIngredients();
        showToast('✅ Обновлено');
    } catch (e) { showToast(e.message, 'err'); }
}

function renderIngredients() {
    const c = document.getElementById('ingredientsList');
    if (!allIngredients.length) {
        c.innerHTML = '<div class="empty">Нет ингредиентов</div>';
        return;
    }
    
    // Группируем по категориям
    const grouped = {};
    allIngredients.forEach(i => {
        const cat = i.category || 'other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(i);
    });
    
    let html = '';
    
    for (const [cat, name] of Object.entries(ING_CATEGORIES)) {
        const items = grouped[cat];
        if (!items || !items.length) continue;
        
        html += `<div class="card" style="border-left:3px solid var(--ios-tint);">
            <h3>${name} <span style="color:var(--muted);font-size:0.7em;">(${items.length})</span></h3>`;
        
        items.forEach(i => {
            const pricePerUnit = (i.cost / i.volume).toFixed(2);
            html += `
                <div class="list-item" data-ing-id="${i.id}">
                    <span style="flex:1;">
                        🧴 ${esc(i.name)} — 
                        <strong>${i.volume} ${i.unit}</strong> за <strong>${i.cost} ₽</strong>
                        <span style="color:var(--muted);font-size:11px;">
                            (${pricePerUnit} ₽/${i.unit})
                        </span>
                    </span>
                    <div style="display:flex;gap:4px;">
                        <button class="btn btn-outline btn-sm" onclick="startEditIngredient('${i.id}')">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteIngredient('${i.id}')">✕</button>
                    </div>
                </div>`;
        });
        
        html += '</div>';
    }
    
    c.innerHTML = html;
}

// ===== СОСТАВ НАПИТКА И МАРЖА =====
async function loadDrinkIngredients(drinkId) {
    try {
        return await api('GET', `/api/ingredients/drink/${drinkId}`);
    } catch (e) { return []; }
}

async function addIngredientToDrink(drinkId, ingredientId, volume) {
    try {
        await api('POST', '/api/ingredients/drink', { drink_id: drinkId, ingredient_id: ingredientId, volume });
        return true;
    } catch (e) { showToast(e.message, 'err'); return false; }
}

async function removeIngredientFromDrink(diId) {
    try {
        await api('DELETE', `/api/ingredients/drink/${diId}`);
        return true;
    } catch (e) { showToast(e.message, 'err'); return false; }
}

async function updateMargin(drinkId, marginPercent) {
    try {
        await api('PUT', '/api/ingredients/margin', { drink_id: drinkId, margin_percent: marginPercent });
        return true;
    } catch (e) { showToast(e.message, 'err'); return false; }
}

async function recalculateAll() {
    try {
        const result = await api('POST', '/api/ingredients/recalculate-all');
        showToast(`✅ Пересчитано ${result.count} напитков`);
        await loadDrinks();
    } catch (e) { showToast(e.message, 'err'); }
}

async function showDrinkComposition(drinkId) {
    const drink = allDrinks.find(d => d.id === drinkId);
    if (!drink) return;
    
    const [ingredients] = await Promise.all([
        loadDrinkIngredients(drinkId),
        loadIngredients()
    ]);
    
    const costPrice = drink.cost_price || 0;
    const margin = drink.margin_percent ?? 30;
    const finalPrice = drink.price || 0;
    
    let html = `
        <div style="margin-bottom:16px;">
            <h4>🧪 ${esc(drink.name)}</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
                <div style="background:var(--card2);padding:10px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:var(--muted);">Себестоимость</div>
                    <div style="font-size:18px;font-weight:700;">${costPrice} ₽</div>
                </div>
                <div style="background:var(--card2);padding:10px;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;color:var(--muted);">Финальная цена</div>
                    <div style="font-size:18px;font-weight:700;color:var(--gold);">${finalPrice} ₽</div>
                </div>
            </div>
        </div>
        
        <div style="margin-bottom:12px;">
            <label style="color:var(--muted);font-size:12px;">Маржа (%)</label>
            <div class="row">
                <input type="number" id="drinkMargin" value="${margin}" min="0" max="1000" style="flex:1;">
                <button class="btn btn-accent btn-sm" onclick="
                    const m = parseFloat(document.getElementById('drinkMargin').value);
                    if (isNaN(m)) return showToast('Введи процент', 'err');
                    updateMargin('${drinkId}', m).then(r => {
                        if (r) { loadDrinks(); showDrinkComposition('${drinkId}'); }
                    });
                ">Применить</button>
            </div>
            <span style="font-size:11px;color:var(--muted);">
                Цена = себестоимость × (1 + маржа/100), округление до десятков ↑
            </span>
        </div>
    `;
    
    // Состав
    if (ingredients.length > 0) {
        html += `<h4 style="margin-bottom:8px;">📋 Состав</h4>`;
        ingredients.forEach(di => {
            const ingCost = (di.volume * di.ingredient_cost / di.ingredient_volume).toFixed(2);
            html += `
                <div class="list-item">
                    <span>🧴 ${esc(di.ingredient_name)} — ${di.volume} мл (${ingCost} ₽)</span>
                    <button class="btn btn-danger btn-sm" onclick="
                        removeIngredientFromDrink('${di.id}').then(r => {
                            if (r) { loadDrinks(); showDrinkComposition('${drinkId}'); }
                        });
                    ">✕</button>
                </div>`;
        });
    } else {
        html += `<div class="empty">Нет ингредиентов в составе</div>`;
    }
    
    // Добавить ингредиент
    html += `
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:12px;">
            <h4 style="margin-bottom:8px;">➕ Добавить ингредиент</h4>
            <select id="compIngredient" style="width:100%;margin-bottom:8px;">
                <option value="">Выбери ингредиент...</option>
                ${allIngredients.map(i => `
                    <option value="${i.id}">🧴 ${esc(i.name)} (${(i.cost/i.volume).toFixed(2)} ₽/${i.unit})</option>
                `).join('')}
            </select>
            <div class="row">
                <input type="number" id="compVolume" placeholder="Объём (мл)" style="flex:1;">
                <button class="btn btn-accent btn-sm" onclick="
                    const ingId = document.getElementById('compIngredient').value;
                    const vol = parseFloat(document.getElementById('compVolume').value);
                    if (!ingId || !vol) return showToast('Заполни поля', 'err');
                    addIngredientToDrink('${drinkId}', ingId, vol).then(r => {
                        if (r) { loadDrinks(); showDrinkComposition('${drinkId}'); }
                    });
                ">Добавить</button>
            </div>
        </div>
    `;
    
    showModal('🧪 Управление напитком', html);
}
