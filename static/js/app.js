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
}

// Инициализация событий
function initEvents() {
    // Навигация
    document.querySelectorAll('.nav-btn').forEach(b => {
        b.addEventListener('click', function() {
            switchPanel(this.dataset.panel);
        });
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
    document.getElementById('btnCloseModal').addEventListener('click', function() {
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
    document.getElementById('guestName').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') addGuest();
    });
    document.getElementById('drinkPrice').addEventListener('keydown', function(e) {
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

        if (a === 'deleteGuest') await deleteGuest(id);
        if (a === 'deleteDrink') await deleteDrink(id);
        if (a === 'removeOne') await removeOne(g, d);
        if (a === 'removeAll') await removeAll(g, d);
        if (a === 'viewSession') await viewSession(id);
        if (a === 'downloadReceipt') await downloadReceipt(id);
        if (a === 'deleteSession') await deleteSession(id);
    });
}

// Проверка напоминаний (тихо)
function checkReminders() {
    fetch('/api/events/check-reminders', { method: 'POST' }).catch(function() {});
}

// Запуск
(function() {
    if (!checkAuth()) return;

    initEvents();
    checkServer();
    loadActiveSession();
    refreshAll();
    checkReminders();
    setInterval(checkServer, 30000);
})();
