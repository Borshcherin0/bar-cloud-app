// ============ ГЛАВНЫЙ МОДУЛЬ ============

async function refreshAll() {
    await Promise.all([loadGuests(), loadDrinks()]);
    updateSelects();
    await renderOrders();
    await loadActiveTournament();
    await loadTelegramSettings();

    var active = document.querySelector('.panel.active');
    if (active) {
        var id = active.id;
        if (id === 'panel-bill') await renderBill();
        if (id === 'panel-history') await renderHistory();
        if (id === 'panel-analytics') await renderAnalytics();
    }
}

function initEvents() {
    document.querySelectorAll('.nav-btn').forEach(function(b) {
        b.addEventListener('click', function() {
            switchPanel(this.dataset.panel);
        });
    });

    document.getElementById('btnAddGuest').addEventListener('click', addGuest);
    document.getElementById('btnAddDrink').addEventListener('click', addDrink);
    document.getElementById('btnAddOrder').addEventListener('click', addOrder);
    document.getElementById('btnNewSess').addEventListener('click', closeAndNewSession);
    document.getElementById('btnCloseSess').addEventListener('click', closeAndNewSession);
    document.getElementById('btnRefreshHist').addEventListener('click', renderHistory);

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

    document.getElementById('guestName').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') addGuest();
    });
    document.getElementById('drinkPrice').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') addDrink();
    });

    document.addEventListener('click', function(e) {
        var t = e.target.closest('[data-action]');
        if (!t) return;
        e.stopPropagation();

        var a = t.dataset.action;
        var id = t.dataset.id;
        var g = t.dataset.guest;
        var d = t.dataset.drink;

        if (a === 'deleteGuest') deleteGuest(id);
        if (a === 'deleteDrink') deleteDrink(id);
        if (a === 'removeOne') removeOne(g, d);
        if (a === 'removeAll') removeAll(g, d);
        if (a === 'viewSession') viewSession(id);
        if (a === 'downloadReceipt') downloadReceipt(id);
        if (a === 'deleteSession') deleteSession(id);
    });
}

function checkReminders() {
    fetch('/api/events/check-reminders', { method: 'POST' }).catch(function() {});
}

(function() {
    if (!checkAuth()) return;

    initEvents();
    checkServer();
    loadActiveSession();
    refreshAll();
    checkReminders();
    setInterval(checkServer, 30000);
})();
