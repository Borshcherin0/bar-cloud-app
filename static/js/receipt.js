// ============ ЧЕК (без сотрудников, с покерными местами) ============

async function generateReceipt(sid) {
    const [sessions, orders, guests, drinks, tournaments] = await Promise.all([
        api('GET', '/api/sessions'),
        api('GET', `/api/orders?session_id=${sid}`),
        api('GET', '/api/guests'),
        api('GET', '/api/drinks'),
        api('GET', `/api/poker/tournaments?session_id=${sid}`),
    ]);

    const session = sessions.find(s => s.id === sid);
    if (!session) throw new Error('Сессия не найдена');

    // Фильтруем: только гости (не сотрудники)
    const guestOrders = orders.filter(o => {
        const guest = guests.find(g => g.id === o.guest_id);
        return guest && guest.role !== 'staff';
    });

    if (guestOrders.length === 0) {
        throw new Error('Нет заказов для гостей в этой сессии');
    }

    // Собираем информацию о покерных местах
    const pokerPlaces = {};
    if (tournaments && tournaments.length > 0) {
        tournaments.forEach(t => {
            if (t.participants) {
                t.participants.forEach(p => {
                    if (p.place && p.place > 0) {
                        pokerPlaces[p.guest_id] = p.place;
                    }
                });
            }
        });
    }

    // Группируем заказы по гостям
    const gt = {}, gd = {};
    guestOrders.forEach(o => {
        if (!gt[o.guest_id]) gt[o.guest_id] = 0;
        gt[o.guest_id] += o.price;
        if (!gd[o.guest_id]) gd[o.guest_id] = {};
        if (!gd[o.guest_id][o.drink_id]) {
            const d = drinks.find(x => x.id === o.drink_id);
            let itemName = d?.name || '?';
            
            // Если это покерный приз — добавляем место
            if (o.drink_id === 'd_poker_prize' && pokerPlaces[o.guest_id]) {
                itemName = `Покер — Победа ${pokerPlaces[o.guest_id]} место`;
            }
            if (o.drink_id === 'd_poker_buyin') {
                itemName = 'Покер Бай-ин';
            }
            
            gd[o.guest_id][o.drink_id] = { 
                count: 0, 
                price: o.price, 
                name: itemName 
            };
        }
        gd[o.guest_id][o.drink_id].count++;
    });

    const total = guestOrders.reduce((s, o) => s + o.price, 0);
    const dateStr = new Date(session.closed_at || session.created_at).toLocaleString('ru-RU', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const W = 600, P = 40, LH = 26;
    let items = 5;
    for (const gid of Object.keys(gd)) items += 1 + Object.keys(gd[gid]).length + 1;
    const H = Math.max(400, P * 2 + 100 + items * LH);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Фон
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a1a2e');
    bg.addColorStop(1, '#0f0f1a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Рамки
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 1;
    ctx.strokeRect(14, 14, W - 28, H - 28);

    let y = P + 16;
    ctx.textAlign = 'center';

    // Заголовок
    ctx.fillStyle = '#f5c518';
    ctx.font = 'bold 26px "Segoe UI", sans-serif';
    ctx.fillText('🍸 BAR CHECK', W / 2, y);
    y += 34;

    ctx.fillStyle = '#e94560';
    ctx.font = 'bold 15px "Segoe UI", sans-serif';
    ctx.fillText('Барный учёт Pro', W / 2, y);
    y += 24;

    // Дата и номер
    ctx.fillStyle = '#999';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.fillText(dateStr, W / 2, y);
    y += 18;
    ctx.fillText(`Чек № ${sid.slice(-8).toUpperCase()}`, W / 2, y);
    y += 24;

    // Разделитель
    ctx.strokeStyle = '#f5c518';
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(P, y);
    ctx.lineTo(W - P, y);
    ctx.stroke();
    ctx.setLineDash([]);
    y += 18;

    // Список гостей
    for (const gid of Object.keys(gd)) {
        const guest = guests.find(g => g.id === gid);
        
        // Имя гостя + место в покере если есть
        let guestLabel = `👤 ${guest?.name || 'Неизвестный'}`;
        if (pokerPlaces[gid]) {
            guestLabel += `  🏆 ${pokerPlaces[gid]} место`;
        }
        
        ctx.fillStyle = '#e94560';
        ctx.font = 'bold 15px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(guestLabel, P, y);
        ctx.textAlign = 'right';
        ctx.fillText(`${gt[gid]} ₽`, W - P, y);
        
        // Золотая звёздочка для призёров
        if (pokerPlaces[gid]) {
            ctx.fillStyle = '#f5c518';
            ctx.font = '14px "Segoe UI", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('⭐', P - 2, y);
        }
        
        y += 32;

        for (const did of Object.keys(gd[gid])) {
            const d = gd[gid][did];
            ctx.fillStyle = '#ccc';
            ctx.font = '13px "Segoe UI", sans-serif';
            ctx.textAlign = 'left';
            
            // Особое выделение для покерных строк
            if (d.name.includes('Покер')) {
                ctx.fillStyle = '#f5c518';
                ctx.fillText(`  ♠️ ${d.name}`, P + 14, y);
            } else {
                ctx.fillStyle = '#ccc';
                ctx.fillText(`  🍹 ${d.name}`, P + 14, y);
            }
            
            ctx.textAlign = 'center';
            ctx.fillText(`×${d.count}`, W / 2 + 30, y);
            ctx.textAlign = 'right';
            
            // Зелёный для призов (отрицательные суммы)
            if (d.price < 0) {
                ctx.fillStyle = '#2ecc71';
            } else {
                ctx.fillStyle = '#ccc';
            }
            ctx.fillText(`${d.price * d.count} ₽`, W - P, y);
            y += LH;
        }
        y += 2;
    }

    // Итого
    y += 4;
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(P, y);
    ctx.lineTo(W - P, y);
    ctx.stroke();
    y += 22;

    ctx.fillStyle = '#f5c518';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('💸 ИТОГО:', P, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${total} ₽`, W - P, y);
    y += 26;

    ctx.fillStyle = '#999';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`На ${Object.keys(gt).length} гостей`, W / 2, y);
    y += 28;

    ctx.fillStyle = '#666';
    ctx.font = 'italic 11px "Segoe UI", sans-serif';
    ctx.fillText('Спасибо за вечер! 🍸', W / 2, y);

    return canvas.toDataURL('image/png');
}

async function downloadReceipt(sid) {
    showToast('🧾 Генерирую чек...');
    try {
        const url = await generateReceipt(sid);
        currentReceiptDataUrl = url;
        document.getElementById('receiptImage').src = url;
        document.getElementById('receiptModal').classList.add('active');
        showToast('✅ Чек готов! (только для гостей)');
    } catch (e) { 
        showToast('Ошибка: ' + e.message, 'err'); 
    }
}

function saveReceiptToFile() {
    if (!currentReceiptDataUrl) return;
    const a = document.createElement('a');
    a.href = currentReceiptDataUrl;
    a.download = `bar_receipt_${new Date().toISOString().slice(0,10)}.png`;
    a.click();
    showToast('💾 Чек сохранён!');
}
