// ============ ИНВЕНТАРИЗАЦИЯ ============
let inventoryData = [];

async function loadInventory() {
    try {
        inventoryData = await api('GET', '/api/inventory');
        renderInventory();
    } catch (e) {
        console.error('Ошибка загрузки:', e);
    }
}

function renderInventory() {
    const c = document.getElementById('inventoryList');
    if (!inventoryData.length) {
        c.innerHTML = '<div class="empty">Нет данных</div>';
        return;
    }
    
    const categories = {
        'alco': { name: '🍸 Алкоголь', items: [] },
        'no_alco': { name: '🥤 Безалкогольное', items: [] },
        'syrup': { name: '🍯 Сиропы', items: [] },
        'plant': { name: '🌿 Растительное', items: [] },
        'other': { name: '📦 Побочное', items: [] },
    };
    
    inventoryData.forEach(item => {
        const cat = item.category || 'other';
        if (categories[cat]) categories[cat].items.push(item);
    });
    
    let html = '';
    
    for (const [key, cat] of Object.entries(categories)) {
        if (!cat.items.length) continue;
        
        html += `<div class="card" style="border-left:3px solid var(--ios-tint);">
            <h3>${cat.name} (${cat.items.length})</h3>`;
        
        cat.items.forEach(item => {
            html += `
                <div class="list-item" style="flex-direction:column;align-items:stretch;gap:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span>
                            🧴 ${esc(item.name)}
                            ${item.is_unlimited ? '<span style="color:var(--ios-purple);font-size:11px;"> ∞ бесконечно</span>' : ''}
                        </span>
                    </div>
                    
                    <div style="display:flex;gap:8px;align-items:center;">
                        ${!item.is_unlimited ? `
                        <input type="number" id="stock_${item.stock_id}" 
                               value="${item.stock_volume}" min="0" step="0.1"
                               style="width:120px;" 
                               onchange="updateStock('${item.stock_id}', '${item.ingredient_id}', parseFloat(this.value), false)">
                        <span style="font-size:12px;color:var(--muted);">${item.unit}</span>
                        <span style="font-size:10px;color:var(--muted);">
                            (1 упак = ${item.package_volume} ${item.unit})
                        </span>
                        ` : ''}
                        
                        <label style="cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;">
                            <input type="checkbox" ${item.is_unlimited ? 'checked' : ''} 
                                   onchange="updateStock('${item.stock_id}', '${item.ingredient_id}', ${item.stock_volume}, this.checked)">
                            Бесконечно
                        </label>
                    </div>
                </div>`;
        });
        
        html += '</div>';
    }
    
    c.innerHTML = html;
}

async function updateStock(stockId, ingredientId, volume, isUnlimited) {
    try {
        await api('PUT', `/api/inventory/${stockId}`, {
            ingredient_id: ingredientId,
            volume: isUnlimited ? 0 : volume,
            is_unlimited: isUnlimited
        });
        // Обновляем данные локально без перезагрузки
        const item = inventoryData.find(i => i.stock_id === stockId);
        if (item) {
            item.stock_volume = isUnlimited ? item.package_volume : volume;
            item.is_unlimited = isUnlimited;
        }
    } catch (e) {
        showToast('Ошибка: ' + e.message, 'err');
    }
}

async function loadInventoryReport() {
    try {
        const report = await api('GET', '/api/inventory/report');
        renderReport(report);
    } catch (e) {
        showToast('Ошибка загрузки отчёта', 'err');
    }
}

function renderReport(report) {
    const c = document.getElementById('inventoryReport');
    
    if (!report || !report.length) {
        c.innerHTML = '<div class="empty">Нет напитков с ингредиентами</div>';
        return;
    }
    
    let html = '';
    
    report.forEach(drink => {
        const maxServings = drink.max_servings;
        const canMake = maxServings > 0 && maxServings < 999;
        const unlimited = maxServings >= 999;
        
        const statusColor = unlimited ? 'var(--ios-purple)' : canMake ? 'var(--ios-green)' : 'var(--ios-red)';
        const statusText = unlimited ? '∞' : maxServings;
        const statusLabel = unlimited ? 'Бесконечно' : canMake ? `Можно: ${maxServings}` : 'Нельзя';
        
        html += `
            <div class="card" style="border-left:3px solid ${statusColor};">
                <h3>🍹 ${esc(drink.drink_name)} 
                    <span style="color:${statusColor};float:right;">${statusText} порций</span>
                </h3>
                <p style="color:var(--muted);font-size:12px;margin-bottom:8px;">${statusLabel}</p>
                
                <div style="font-size:12px;">
                    ${drink.ingredients.map(ing => {
                        const ingColor = ing.is_unlimited ? 'var(--ios-purple)' : 
                                        ing.possible_servings >= maxServings ? 'var(--ios-green)' : 'var(--ios-red)';
                        return `
                            <div style="display:flex;justify-content:space-between;padding:2px 0;">
                                <span>🧴 ${esc(ing.ingredient_name)} (${ing.required_volume} ${ing.unit})</span>
                                <span style="color:${ingColor};">
                                    ${ing.is_unlimited ? '∞' : ing.possible_servings + ' порц.'}
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>
                
                ${drink.limiting_ingredient ? `
                <p style="font-size:11px;color:var(--ios-red);margin-top:8px;">
                    ⚠️ Лимитирующий: ${drink.limiting_ingredient}
                </p>` : ''}
            </div>
        `;
    });
    
    c.innerHTML = html;
}

async function showInventoryReport() {
    showModal('📊 Отчёт по остаткам', '<div id="reportContent"><div class="empty">Загрузка...</div></div>');
    await loadInventoryReport();
    
    // Перемещаем отчёт в модалку
    setTimeout(() => {
        const report = document.getElementById('inventoryReport');
        const modalBody = document.getElementById('pokerModalBody');
        if (report && modalBody) {
            modalBody.innerHTML = report.innerHTML;
        }
    }, 300);
}


async function loadInventoryReportForDrinks() {
    try {
        const report = await api('GET', '/api/inventory/report');
        // Обновляем allDrinks с информацией об остатках
        report.forEach(r => {
            const drink = allDrinks.find(d => d.id === r.drink_id);
            if (drink) {
                drink.max_servings = r.max_servings;
                drink.limiting_ingredient = r.limiting_ingredient;
            }
        });
        // Перерисовываем меню
        if (document.getElementById('panel-bar').classList.contains('active') ||
            document.getElementById('panel-drinks').classList.contains('active')) {
            renderDrinks();
        }
    } catch (e) {
        console.error('Ошибка загрузки остатков:', e);
    }
}
