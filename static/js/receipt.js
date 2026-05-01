// ============ ЧЕК (Liquid Glass стиль) ============

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

    const guestOrders = orders.filter(o => {
        const guest = guests.find(g => g.id === o.guest_id);
        return guest && guest.role !== 'staff';
    });

    if (guestOrders.length === 0) throw new Error('Нет заказов для гостей');

    const pokerPlaces = {};
    if (tournaments) {
        tournaments.forEach(t => {
            (t.participants || []).forEach(p => {
                if (p.place > 0) pokerPlaces[p.guest_id] = p.place;
            });
        });
    }

    const gt = {}, gd = {};
    guestOrders.forEach(o => {
        if (!gt[o.guest_id]) gt[o.guest_id] = 0;
        gt[o.guest_id] += o.price;
        if (!gd[o.guest_id]) gd[o.guest_id] = {};
        if (!gd[o.guest_id][o.drink_id]) {
            const d = drinks.find(x => x.id === o.drink_id);
            let itemName = d?.name || '?';
            if (o.drink_id === 'd_poker_prize' && pokerPlaces[o.guest_id]) {
                itemName = `Покер — Победа ${pokerPlaces[o.guest_id]} место`;
            }
            if (o.drink_id === 'd_poker_buyin') itemName = 'Покер Бай-ин';
            gd[o.guest_id][o.drink_id] = { count: 0, price: o.price, name: itemName };
        }
        gd[o.guest_id][o.drink_id].count++;
    });

    const total = guestOrders.reduce((s, o) => s + o.price, 0);
    const dateStr = new Date(session.closed_at || session.created_at).toLocaleString('ru-RU', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const W = 640, P = 36, CARD_MARGIN = 10;
    let y = 0;
    const cardWidth = W - 2 * P - 2 * CARD_MARGIN;

    // Высота
    let cardsH = 0;
    for (const gid of Object.keys(gd)) cardsH += 50 + Object.keys(gd[gid]).length * 26 + 20;
    const H = 150 + cardsH + 120;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Фон
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    // Vibrant сферы
    [
        { x: 80, y: 60, r: 180, c: 'rgba(10,132,255,0.08)' },
        { x: W-100, y: H/2, r: 220, c: 'rgba(191,90,242,0.06)' },
        { x: W/2, y: H-80, r: 160, c: 'rgba(255,159,10,0.05)' },
    ].forEach(s => {
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        grad.addColorStop(0, s.c);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    });

    y = 50;

    // Хедер
    drawGlassCard(ctx, P, y, W - 2*P, 110, 20, true);
    y += 20;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🍸 BAR CHECK', W/2, y);
    y += 36;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = 'bold 14px -apple-system, sans-serif';
    ctx.fillText('Барный учёт Pro', W/2, y);
    y += 24;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.fillText(dateStr, W/2, y);

    y = 170;

    // Гости
    for (const gid of Object.keys(gd)) {
        const guest = guests.find(g => g.id === gid);
        const name = guest?.name || 'Неизвестный';
        const sum = gt[gid];
        const place = pokerPlaces[gid];
        const items = Object.values(gd[gid]);
        const cardH = 40 + items.length * 26 + 16;

        drawGlassCard(ctx, P + CARD_MARGIN, y, cardWidth, cardH, 16);

        let innerY = y + 14;

        let label = `👤 ${name}`;
        if (place) label += `  🏆 ${place} место`;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(label, P + CARD_MARGIN + 16, innerY);
        
        ctx.fillStyle = 'rgba(10,132,255,0.9)';
        ctx.textAlign = 'right';
        ctx.fillText(`${sum} ₽`, W - P - CARD_MARGIN - 16, innerY);
        innerY += 36;

        items.forEach(item => {
            const isPoker = item.name.includes('Покер') || item.name.includes('Poker');
            const nameColor = isPoker ? 'rgba(255,159,10,0.9)' : 'rgba(255,255,255,0.7)';
            const prefix = isPoker ? '  ♠️ ' : '  · ';

            ctx.fillStyle = nameColor;
            ctx.textAlign = 'left';
            ctx.font = '13px -apple-system, sans-serif';
            ctx.fillText(`${prefix}${item.name}`, P + CARD_MARGIN + 24, innerY);

            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.textAlign = 'center';
            ctx.fillText(`×${item.count}`, W/2 + 40, innerY);

            ctx.fillStyle = item.total < 0 ? 'rgba(48,209,88,0.9)' : 'rgba(255,255,255,0.6)';
            ctx.textAlign = 'right';
            ctx.fillText(`${item.total} ₽`, W - P - CARD_MARGIN - 16, innerY);
            innerY += 26;
        });

        y += cardH + 14;
    }

    y += 10;

    // Итого
    drawGlassCard(ctx, P, y, W - 2*P, 80, 20, true);
    y += 18;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = 'bold 22px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('💸 ИТОГО', P + 20, y);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(`${total} ₽`, W - P - 20, y);
    y += 60;

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`👥 ${Object.keys(gd).length} гостей  •  Спасибо за вечер!`, W/2, y);

    return canvas.toDataURL('image/png');
}

function drawGlassCard(ctx, x, y, w, h, radius, highlight) {
    // Фон
    ctx.fillStyle = 'rgba(28,28,30,0.5)';
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();

    // Граница
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, radius);
    ctx.stroke();

    // Блик
    ctx.fillStyle = highlight ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)';
    roundRect(ctx, x + 2, y, w - 4, 2, radius);
    ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

async function downloadReceipt(sid) {
    showToast('🧾 Генерирую чек...');
    try {
        const url = await generateReceipt(sid);
        currentReceiptDataUrl = url;
        document.getElementById('receiptImage').src = url;
        document.getElementById('receiptModal').classList.add('active');
        showToast('✅ Чек готов!');
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
