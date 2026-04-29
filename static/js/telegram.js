// ============ TELEGRAM БОТ ============

async function loadTelegramSettings() {
    try {
        const settings = await api('GET', '/api/telegram/settings');
        renderTelegramSettings(settings);
    } catch (e) {
        console.error('Ошибка загрузки настроек:', e);
    }
}

function renderTelegramSettings(settings) {
    const container = document.getElementById('telegramSettings');
    container.innerHTML = `
        <div class="card" style="border-left: 3px solid #2AABEE;">
            <h3>📱 Telegram бот</h3>
            
            <div style="margin-bottom:8px;">
                <label style="color:var(--muted);font-size:12px;">Токен бота:</label>
                <input type="text" id="botToken" value="${esc(settings.bot_token || '')}" 
                       placeholder="1234567890:ABCdef..." style="width:100%;">
            </div>
            
            <div style="margin-bottom:8px;">
                <label style="color:var(--muted);font-size:12px;">Chat ID:</label>
                <input type="text" id="botChatId" value="${esc(settings.chat_id || '')}" 
                       placeholder="-100123456789" style="width:100%;">
            </div>
            
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                <label style="cursor:pointer;">
                    <input type="checkbox" id="botEnabled" ${settings.enabled ? 'checked' : ''}>
                    Включить отправку чеков
                </label>
            </div>
            
            <div style="display:flex;gap:8px;">
                <button class="btn btn-accent btn-sm" onclick="saveTelegramSettings()">💾 Сохранить</button>
                <button class="btn btn-outline btn-sm" onclick="testBot()" ${!settings.enabled ? 'disabled' : ''}>🧪 Тест</button>
            </div>
            
            <div style="margin-top:12px;font-size:11px;color:var(--muted);">
                <p>💡 Как настроить:</p>
                <p>1. Создай бота в @BotFather и получи токен</p>
                <p>2. Добавь бота в чат и сделай админом</p>
                <p>3. Отправь /getid в чат или используй @getidsbot</p>
            </div>
        </div>
    `;
}

async function saveTelegramSettings() {
    const bot_token = document.getElementById('botToken').value.trim();
    const chat_id = document.getElementById('botChatId').value.trim();
    const enabled = document.getElementById('botEnabled').checked;
    
    if (!bot_token || !chat_id) {
        showToast('Заполни токен и chat_id', 'err');
        return;
    }
    
    try {
        await api('PUT', '/api/telegram/settings', { bot_token, chat_id, enabled });
        showToast('✅ Настройки сохранены');
    } catch (e) {
        showToast(e.message, 'err');
    }
}

async function testBot() {
    try {
        await api('POST', '/api/telegram/test');
        showToast('✅ Тестовое сообщение отправлено');
    } catch (e) {
        showToast('Ошибка: ' + e.message, 'err');
    }
}
