// ============ ГЛАВНЫЙ МОДУЛЬ ============

async function refreshAll() {
    await Promise.all([loadGuests(), loadDrinks()]);
    updateSelects();
    await renderOrders();
    await loadActiveTournament();
    await loadTelegramSettings();

    const active = document.querySelector('.panel.active')?.id;
    if (active === 'panel-bill') await renderBill();
    if (active === 'panel-history') await renderHistory();
    if (active === 'panel-analytics') await renderAnalytics();
    if (name === 'ingredients') await loadIngredients();
}

// Инициализация событий
function initEvents() {
    // Навигация
    document.querySelectorAll('.nav-btn').forEach(b => {
        b.addEventListener('click', () => switchPanel(b.dataset.panel));
    });

    // Кнопки
    document.getElementById('btnAddGuest').addEventListener('click', addGuest);
    document.getElementById('btnAddDrink').addEventListener('click', addDrink);
    document.getElementById('btnAddOrder').addEventListener('click', addOrder);
    document.getElementById('btnNewSess').addEventListener('click', closeAndNewSession);
    document.getElementById('btnCloseSess').addEventListener('click', closeAndNewSession);
    document.getElementById('btnRefreshHist').addEventListener('click', renderHistory);

    // Чек
    document.getElementById('btnDownloadReceipt').addEventListener('click', saveReceiptToFile);
    document.getElementById('btnCloseModal').addEventListener('click', () => {
        document.getElementById('receiptModal').classList.remove('active');
        currentReceiptDataUrl = '';
    });
    document.getElementById('receiptModal').addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.remove('active');
            currentReceiptDataUrl = '';
        }
    });

    // Enter в полях
    document.getElementById('guestName').addEventListener('keydown', e => {
        if (e.key === 'Enter') addGuest();
    });
    document.getElementById('drinkPrice').addEventListener('keydown', e => {
        if (e.key === 'Enter') addDrink();
    });

    // Делегирование кликов
    document.addEventListener('click', async function(e) {
        const t = e.target.closest('[data-action]');
        if (!t) return;
        e.stopPropagation();

        const a = t.dataset.action;
        const id = t.dataset.id;
        const g = t.dataset.guest;
        const d = t.dataset.drink;

        switch (a) {
            case 'deleteGuest': await deleteGuest(id); break;
            case 'deleteDrink': await deleteDrink(id); break;
            case 'removeOne': await removeOne(g, d); break;
            case 'removeAll': await removeAll(g, d); break;
            case 'viewSession': await viewSession(id); break;
            case 'downloadReceipt': await downloadReceipt(id); break;
            case 'deleteSession': await deleteSession(id); break;
        }
    });
}

// Запуск
(async () => {
    initEvents();
    await checkServer();
    await loadActiveSession();
    await refreshAll();
    setInterval(checkServer, 30000);
})();
