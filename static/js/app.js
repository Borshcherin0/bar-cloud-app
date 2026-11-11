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

let checkingReminders = false;
const deferredReminderIds = new Set();

async function checkReminders(manual = false) {
    if (checkingReminders) return;
    checkingReminders = true;
    const endpoints = ['/api/events/check-reminders', '/api/sessions/check-unpaid'];
    try {
        const checks = await Promise.allSettled(endpoints.map(path => api('GET', path)));
        const lists = checks.map((result, index) => result.status === 'fulfilled'
            ? result.value.ids.filter(id => manual || !deferredReminderIds.has(index + ':' + id))
            : []);
        if (manual && checks.some(result => result.status === 'rejected')) {
            showToast('Не удалось проверить часть напоминаний', 'err');
        }
        if (!lists.some(ids => ids.length)) {
            if (manual && checks.every(result => result.status === 'fulfilled')) {
                showToast('Сейчас нет напоминаний к отправке');
            }
            return;
        }

        const dialog = document.getElementById('reminderDialog');
        [['reminderEvents', 'reminderEventCount'], ['reminderPayments', 'reminderPaymentCount']]
            .forEach(([rowId, countId], index) => {
                const count = lists[index].length;
                document.getElementById(rowId).hidden = count === 0;
                document.getElementById(countId).textContent = count;
            });
        dialog.returnValue = '';
        const choice = new Promise(resolve => {
            dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
        });
        dialog.showModal();
        if (await choice !== 'send') {
            lists.forEach((ids, index) => ids.forEach(id => deferredReminderIds.add(index + ':' + id)));
            return;
        }

        const results = await Promise.allSettled(lists.map((ids, index) =>
            ids.length ? api('POST', endpoints[index], ids) : Promise.resolve({ sent: 0, failed: 0 })
        ));
        const sent = results.reduce((total, result) =>
            total + (result.status === 'fulfilled' ? result.value.sent : 0), 0);
        if (results.some(result => result.status === 'rejected' || result.value.failed)) {
            showToast(`Отправлено: ${sent}. Часть напоминаний не удалось отправить.`, 'err');
        } else {
            showToast(`Отправлено напоминаний: ${sent}`);
        }
    } catch (error) {
        showToast('Не удалось проверить напоминания', 'err');
    } finally {
        checkingReminders = false;
    }
}

(function() {
    if (!checkAuth()) return;

    initEvents();
    checkServer();
    loadActiveSession();
    refreshAll();
    document.getElementById('btnCheckReminders').addEventListener('click', () => checkReminders(true));
    checkReminders();
    setInterval(() => checkReminders(), 30000);
    setInterval(checkServer, 30000);
})();
