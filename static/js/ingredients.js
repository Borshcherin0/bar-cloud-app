// ============ ИНГРЕДИЕНТЫ ============
let allIngredients = [];

async function loadIngredients() {
    try {
        allIngredients = await api('GET', '/api/ingredients');
        renderIngredients();
    } catch (e) {
        console.error('Ошибка загрузки ингредиентов:', e);
    }
}

async function addIngredient() {
    const name = document.getElementById('ingName').value.trim();
    const volume = parseFloat(document.getElementById('ingVolume').value);
    const cost = parseFloat(document.getElementById('ingCost').value);
    const unit = document.getElementById('ingUnit').value;
    
    if (!name || !volume || !cost) return showToast('Заполни все поля', 'err');
    
    try {
        await api('POST', '/api/ingredients', { name, volume, cost, unit });
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

function renderIngredients() {
    const c = document.getElementById('ingredientsList');
    if (!allIngredients.length) {
        c.innerHTML = '<div class="empty">Нет ингредиентов</div>';
        return;
    }
    
    c.innerHTML = allIngredients.map(i => `
        <div class="list-item">
            <span>
                🧴 ${esc(i.name)} — 
                <strong>${i.volume} ${i.unit}</strong> за <strong>${i.cost} ₽</strong>
                <span style="color:var(--muted);font-size:11px;">
                    (${(i.cost / i.volume).toFixed(2)} ₽/${i.unit})
                </span>
            </span>
            <button class="btn btn-danger btn-sm" onclick="deleteIngredient('${i.id}')">✕</button>
        </div>
    `).join('');
}

// ===== УПРАВЛЕНИЕ СОСТАВОМ НАПИТКА =====
async function loadDrinkIngredients(drinkId) {
    try {
        const ingredients = await api('GET', `/api/ingredients/drink/${drinkId}`);
        return ingredients;
    } catch (e) {
        return [];
    }
}

async function addIngredientToDrink(drinkId, ingredientId, volume) {
    try {
        await api('POST', '/api/ingredients/drink', {
            drink_id: drinkId,
            ingredient_id: ingredientId,
            volume: volume
        });
        return true;
    } catch (e) {
        showToast(e.message, 'err');
        return false;
    }
}

async function removeIngredientFromDrink(diId) {
    try {
        await api('DELETE', `/api/ingredients/drink/${diId}`);
        return true;
    } catch (e) {
        showToast(e.message, 'err');
        return false;
    }
}

function showDrinkComposition(drinkId) {
    const drink = allDrinks.find(d => d.id === drinkId);
    if (!drink) return;
    
    loadDrinkIngredients(drinkId).then(ingredients => {
        let html = `
            <h4>🧪 Состав: ${esc(drink.name)}</h4>
            <p style="color:var(--muted);font-size:12px;margin-bottom:12px;">
                Текущая себестоимость: <strong>${drink.cost_price || 0} ₽</strong>
            </p>
        `;
        
        if (ingredients.length > 0) {
            html += `<div style="margin-bottom:12px;">`;
            ingredients.forEach(di => {
                const ingCost = (di.volume * di.ingredient_cost / di.ingredient_volume).toFixed(2);
                html += `
                    <div class="list-item">
                        <span>🧴 ${esc(di.ingredient_name)} — ${di.volume} мл (${ingCost} ₽)</span>
                        <button class="btn btn-danger btn-sm" onclick="removeIngredientFromDrink('${di.id}').then(()=>showDrinkComposition('${drinkId}'))">✕</button>
                    </div>`;
            });
            html += `</div>`;
        } else {
            html += `<div class="empty">Нет ингредиентов</div>`;
        }
        
        // Добавить ингредиент
        html += `
            <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:12px;">
                <h4 style="margin-bottom:8px;">➕ Добавить ингредиент</h4>
                <select id="compIngredient" style="width:100%;margin-bottom:8px;">
                    <option value="">Выбери ингредиент...</option>
                    ${allIngredients.map(i => `
                        <option value="${i.id}">🧴 ${esc(i.name)} (${i.cost}₽/${i.volume}${i.unit})</option>
                    `).join('')}
                </select>
                <div class="row">
                    <input type="number" id="compVolume" placeholder="Объём (мл)" style="flex:1;">
                    <button class="btn btn-accent btn-sm" onclick="
                        const ingId = document.getElementById('compIngredient').value;
                        const vol = parseFloat(document.getElementById('compVolume').value);
                        if (!ingId || !vol) return showToast('Заполни поля', 'err');
                        addIngredientToDrink('${drinkId}', ingId, vol).then(r => {
                            if (r) showDrinkComposition('${drinkId}');
                        });
                    ">Добавить</button>
                </div>
            </div>
        `;
        
        showModal('🧪 Состав напитка', html);
    });
}
