// ============ АВТОРИЗАЦИЯ ============

async function checkAuth() {
    try {
        await api('GET', '/api/leaderboards/session');
        return true;
    } catch (error) {
        showLoginScreen();
        if (error.status !== 401) showLoginError('Не удалось проверить вход. Попробуй ещё раз.');
        return false;
    }
}

function showLoginError(message) {
    const error = document.getElementById('loginError');
    error.textContent = message;
    error.style.display = 'block';
}

function showLoginScreen() {
    document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#080614;padding:20px;">
            <div style="background:var(--glass-bg-heavy);backdrop-filter:blur(30px);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:40px;max-width:400px;width:100%;text-align:center;">
                <div style="font-size:3em;margin-bottom:8px;">🍸</div>
                <h2 style="font-family:'Tilt Neon',sans-serif;color:#fff;margin-bottom:24px;">Барный учёт</h2>
                <input type="password" id="adminPassword" placeholder="Пароль" 
                       style="width:100%;padding:14px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:16px;margin-bottom:12px;text-align:center;"
                       onkeydown="if(event.key==='Enter')tryLogin()">
                <button onclick="tryLogin()" 
                        style="width:100%;padding:14px;background:#ff2d75;border:none;border-radius:12px;color:#fff;font-size:16px;font-weight:600;cursor:pointer;">
                    Войти
                </button>
                <p id="loginError" style="color:#ff2d75;font-size:13px;margin-top:12px;display:none;">Неверный пароль</p>
            </div>
        </div>
    `;
}

async function tryLogin() {
    const password = document.getElementById('adminPassword').value;
    try {
        await api('POST', '/api/leaderboards/login', { password });
        location.reload();
    } catch (error) {
        showLoginError(error.status === 403 ? 'Неверный пароль' : 'Не удалось войти. Попробуй ещё раз.');
    }
}

async function logout() {
    await api('DELETE', '/api/leaderboards/login');
    location.reload();
}
