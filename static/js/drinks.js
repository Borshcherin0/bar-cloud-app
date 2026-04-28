// ============ НАПИТКИ ============

async function loadDrinks() {
    allDrinks = await api('GET', '/api/drinks');
    renderDrinks();
}

async function addDrink() {
    const name = document.getElementById('drinkName').value.trim();
    const price = parseInt(document.getElementById('drinkPrice').value);
    if (!name || isNaN(price) || price <= 0) return showToast('Проверь данные', 'err');
    try {
        await api('POST', '/api/drinks', { name, price });
        document.getElementById('drinkName').value = '';
        document.getElementById('drinkPrice').value = '';
        await loadDrinks();
        updateSelects();
        showToast('🍹 Напиток добавлен');
    } catch (e) { showToast(e.message, 'err'); }
}

async function deleteDrink(id) {
    if (!confirm('Удалить напиток?')) return;
    try {
        await api('DELETE', `/api/drinks/${id}`);
        await loadDrinks();
        updateSelects();
        showToast('🗑 Удалён');
    } catch (e) { showToast(e.message, 'err'); }
}

function renderDrinks() {
    const c = document.getElementById('drinksList');
    if (!allDrinks.length) {
        c.innerHTML = '<div class="empty">Меню пусто</div>';
        return;
    }
    c.innerHTML = allDrinks.map(d => `
        <div class="list-item">
            <span>🍹 ${esc(d.name)} — <strong>${d.price} ₽</strong></span>
            <button class="btn btn-danger btn-sm" data-action="deleteDrink" data-id="${d.id}">✕</button>
        </div>
    `).join('');
}
