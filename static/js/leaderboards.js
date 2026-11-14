(() => {
    const root = document.getElementById('leaderboards');
    if (!root) return;

    const admin = root.dataset.admin === 'true';
    const endpoint = '/api/leaderboards';
    const formatNames = { single: 'До одного поражения', double: 'До двух поражений', table: 'Покерный стол', group: 'Группа и плей-офф' };
    const groupNames = { upper: 'Верхняя сетка', lower: 'Нижняя сетка', final: 'Гранд-финал', reset: 'Решающий финал' };
    const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'Europe/Moscow' });
    const numberFormat = new Intl.NumberFormat('ru-RU');
    let tournaments = [];
    let discipline = 'soulcalibur';
    let selected = null;
    let authorized = false;
    let busy = false;

    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    }

    function button(label, action, className = 'lb-button') {
        const node = element('button', label, className);
        node.type = 'button';
        node.addEventListener('click', action);
        return node;
    }

    function field(label, control) {
        const node = element('label', undefined, 'lb-field');
        node.append(element('span', label), control);
        return node;
    }

    function numeric(value, max) {
        const input = element('input');
        input.type = 'number';
        input.inputMode = 'numeric';
        input.required = true;
        input.min = 0;
        input.max = max;
        input.value = value;
        return input;
    }

    async function request(path = '', options = {}) {
        const response = await fetch(endpoint + path, {
            ...options,
            headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
            cache: 'no-store',
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            if (response.status === 401) authorized = false;
            throw new Error(typeof body.detail === 'string' ? body.detail : 'Не удалось выполнить запрос');
        }
        return response.status === 204 ? null : response.json();
    }

    function forDiscipline() {
        return tournaments.filter(t => (t.format === 'table') === (discipline === 'poker'));
    }

    async function load() {
        if (busy) return;
        busy = true;
        try {
            tournaments = await request();
            if (admin) {
                authorized = await request('/session').then(() => true).catch(() => false);
            }
            render();
            setStatus('');
        } catch (error) {
            setStatus(error.message);
        } finally {
            busy = false;
        }
    }

    const status = element('p', '', 'lb-status');
    status.setAttribute('role', 'status');
    const content = element('div', undefined, 'lb-content');
    root.append(status, content);

    function setStatus(message) {
        status.textContent = message;
        status.hidden = !message;
    }

    async function mutate(action, message) {
        if (busy) return;
        busy = true;
        try {
            await action();
            render();
            setStatus(message);
        } catch (error) {
            if (!authorized) render();
            setStatus(error.message);
        } finally {
            busy = false;
        }
    }

    function updateTournament(tournament, patch) {
        return mutate(async () => {
            const updated = await request('/' + tournament.id, {
                method: 'PATCH',
                body: JSON.stringify({ version: tournament.version, ...patch }),
            });
            tournaments = tournaments.map(item => item.id === updated.id ? updated : item);
        }, 'Изменения сохранены');
    }

    function loginForm() {
        const form = element('form', undefined, 'lb-card lb-form');
        form.append(element('h3', 'Управление турнирами'));
        const password = element('input');
        password.type = 'password';
        password.required = true;
        password.autocomplete = 'current-password';
        const submit = element('button', 'Войти', 'lb-button lb-primary');
        form.append(field('Пароль админки', password), submit);
        form.addEventListener('submit', event => {
            event.preventDefault();
            mutate(async () => {
                await request('/login', { method: 'POST', body: JSON.stringify({ password: password.value }) });
                authorized = true;
            }, 'Управление доступно');
        });
        return form;
    }

    function createForm() {
        const details = element('details', undefined, 'lb-card');
        details.append(element('summary', 'Новый турнир'));
        const form = element('form', undefined, 'lb-form');
        const title = element('input');
        title.required = true;
        title.maxLength = 80;
        title.placeholder = discipline === 'poker' ? 'Например, Пятничный покер' : 'Например, Кубок Monster Bar';
        const players = element('textarea');
        players.required = true;
        players.rows = 4;
        players.placeholder = 'Один никнейм на строку';
        form.append(field('Название', title), field('Публичные имена участников', players));

        const poker = discipline === 'poker';
        const buyIn = numeric(1000, 1000000);
        buyIn.min = 1;
        if (poker) {
            form.append(field('Бай-ин и цена ребая, ₽', buyIn),
                element('p', 'Sit & Go · до 6 игроков. Весь бай-ин и каждый ребай идут в призовой фонд.', 'lb-muted'));
        } else {
            form.append(element('p', 'Круговая группа, затем верхняя и нижняя сетки.', 'lb-muted'));
        }

        form.append(element('button', 'Начать турнир', 'lb-button lb-primary'));
        form.addEventListener('submit', event => {
            event.preventDefault();
            mutate(async () => {
                const names = players.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
                const tournament = await request('', {
                    method: 'POST', body: JSON.stringify({
                        title: title.value, format: poker ? 'table' : 'group', players: names,
                        buy_in: poker ? Number(buyIn.value) : null,
                    }),
                });
                tournaments.unshift(tournament);
                selected = tournament.id;
            }, 'Турнир открыт для гостей');
        });
        details.append(form);
        return details;
    }

    function ranking(items) {
        const wins = new Map();
        for (const tournament of items.filter(item => item.finished || item.legacy)) {
            const champion = tournament.players[tournament.places.indexOf(1)];
            if (!champion) continue;
            const key = champion.toLowerCase();
            const current = wins.get(key) || { name: champion, count: 0 };
            current.count += 1;
            wins.set(key, current);
        }
        const panel = element('section', undefined, 'lb-card');
        panel.append(element('h3', 'Лидеры по первым местам', admin ? '' : 'category-subtitle'));
        const ordered = [...wins.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));
        if (!ordered.length) {
            panel.append(element('p', 'Первые места появятся после завершения турнира.', 'lb-muted'));
            return panel;
        }
        const list = element('ol', undefined, 'lb-ranking');
        let rank = 0;
        ordered.forEach(({ name, count }, index) => {
            if (index === 0 || count !== ordered[index - 1].count) rank = index + 1;
            const entry = element('li', undefined, 'lb-line');
            entry.append(element('span', String(rank), 'lb-place'), element('span', name),
                element('strong', String(count), 'lb-count'));
            entry.lastChild.setAttribute('aria-label', 'Первых мест: ' + count);
            list.append(entry);
        });
        panel.append(list);
        return panel;
    }

    function matchCard(tournament, match) {
        const section = element('article', undefined, 'lb-match');
        const label = match.done ? (match.score ? 'Завершён' : 'Свободный проход') :
            match.ready ? 'Можно играть' : 'Ожидает игроков';
        if (match.label) section.append(element('h4', match.label));
        section.append(element('p', 'Матч ' + match.id + ' · ' + label, 'lb-match-meta'));
        const form = element('form', undefined, 'lb-match-form');
        match.players.forEach((player, index) => {
            const row = element('div', undefined, 'lb-match-player');
            const [kind, source] = match.sources?.[index] ?? [];
            const name = player !== null ? tournament.players[player] :
                match.known[index] ? 'Свободное место' :
                (kind === 'win' ? 'Победитель матча ' : 'Проигравший матча ') + source;
            row.append(element('span', name, player !== null && player === match.winner ? 'lb-winner' : ''));
            if (authorized && match.ready && !match.done) {
                const input = numeric(match.score?.[index] ?? 0, match.wins_required ?? 99);
                input.name = 'score' + index;
                input.setAttribute('aria-label', 'Счёт: ' + name);
                row.append(input);
            } else if (match.score) {
                row.append(element('strong', String(match.score[index])));
            }
            form.append(row);
        });
        if (authorized && match.ready && !match.done) {
            const actions = element('div', undefined, 'lb-actions');
            for (const [label, value] of [['Сохранить счёт', 'live'], ['Завершить матч', 'final']]) {
                const submit = element('button', label, 'lb-button');
                submit.value = value;
                actions.append(submit);
            }
            form.append(actions);
            form.addEventListener('submit', event => {
                event.preventDefault();
                updateTournament(tournament, {
                    action: 'score', target: match.id,
                    score: [Number(form.elements.score0.value), Number(form.elements.score1.value)],
                    confirm: event.submitter?.value === 'final',
                });
            });
        }
        section.append(form);
        return section;
    }

    function bracket(tournament) {
        const board = element('div', undefined, 'lb-bracket');
        for (const [group, name] of Object.entries(groupNames)) {
            const matches = tournament.matches.filter(match => match.group === group);
            if (!matches.length) continue;
            const section = element('section', undefined, 'lb-card');
            section.append(element('h3', group === 'upper' && tournament.format === 'single' ? 'Сетка' : name));
            const rounds = element('div', undefined, 'lb-rounds');
            for (const roundNo of new Set(matches.map(match => match.round))) {
                const round = element('div', undefined, 'lb-round');
                if (group === 'upper' || group === 'lower') round.append(element('h4', 'Раунд ' + roundNo));
                matches.filter(match => match.round === roundNo)
                    .forEach(match => round.append(matchCard(tournament, match)));
                rounds.append(round);
            }
            section.append(rounds);
            board.append(section);
        }
        return board;
    }

    function groupStage(tournament) {
        const stage = element('section', undefined, 'lb-card');
        stage.append(element('h3', 'Групповой этап', admin ? '' : 'category-subtitle'));
        const last = tournament.groups.length - 1;
        tournament.groups.forEach((matches, index) => {
            const attempt = element('details', undefined, 'lb-attempt');
            attempt.open = index === last;
            attempt.append(element('summary', index === 0 ? 'Группа' : 'Повтор группы ' + index));
            const table = element('table', undefined, 'lb-group-table');
            const head = table.createTHead().insertRow();
            for (const label of ['Игрок', 'В', 'П', 'Партии', 'Отбор']) {
                const cell = element('th', label);
                cell.scope = 'col';
                head.append(cell);
            }
            const body = table.createTBody();
            const split = Math.ceil(tournament.players.length / 2);
            tournament.tables[index].forEach((row, rank) => {
                const line = body.insertRow();
                const lane = index === last && tournament.matches.length
                    ? (rank < split ? 'Верхняя' : 'Нижняя') : '—';
                for (const item of [tournament.players[row.player], row.wins, row.losses,
                    row.won + ':' + row.lost, lane]) {
                    line.insertCell().textContent = item;
                }
            });
            attempt.append(table);
            if (index < last) {
                attempt.append(element('p', 'По итогам группы отбор не определился. Сыграли повтор.', 'lb-muted'));
            }
            const cards = element('div', undefined, 'lb-rounds');
            matches.forEach(match => cards.append(matchCard(tournament, match)));
            attempt.append(cards);
            stage.append(attempt);
        });
        return stage;
    }

    function playoffDiagram(tournament) {
        const section = element('section', undefined, 'lb-card lb-playoff');
        section.append(element('h3', 'Плей-офф', admin ? '' : 'category-subtitle'));
        if (!tournament.matches.length) {
            section.append(element('p', 'Сетка появится после определения мест в группе.', 'lb-muted'));
            return section;
        }

        const hasLower = tournament.matches.some(match => match.group === 'lower');
        if (hasLower) {
            section.append(element('p', 'Пунктир показывает переход в нижнюю сетку.', 'lb-muted'));
        }
        const scroll = element('div', undefined, 'lb-flow-scroll');
        scroll.tabIndex = 0;
        scroll.setAttribute('aria-label', 'Сетка плей-офф с горизонтальной прокруткой');
        const diagram = element('div', undefined, 'lb-flow');
        const stage = element('div', undefined, 'lb-flow-stage');
        const canvas = element('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        stage.append(canvas);
        diagram.append(stage);
        scroll.append(diagram);
        section.append(scroll);

        const byId = new Map(tournament.matches.map(match => [match.id, match]));
        function actualSource([kind, id]) {
            if (kind !== 'win' && kind !== 'loss') return [kind, id];
            const match = byId.get(id);
            if (!match || !match.done || match.confirmed) return [kind, id];
            if (kind === 'loss' || match.winner === null) return ['player', null];
            const side = match.players.indexOf(match.winner);
            return actualSource(match.sources[side]);
        }

        const slots = new Map();
        const cardWidth = 164;
        const columnStep = 198;
        const cardHeight = 80;
        const rowStep = 94;
        const left = 12;
        function add(match, column, center) {
            const slot = { match, x: left + column * columnStep, center };
            slots.set(match.id, slot);
            return slot;
        }

        function lane(group, label, top) {
            const matches = tournament.matches.filter(match =>
                match.group === group && (!match.done || match.confirmed));
            if (!matches.length) return { columns: 0, bottom: top };
            const heading = element('h4', label, 'lb-lane-label');
            heading.style.top = top + 'px';
            stage.append(heading);
            const rounds = [...new Set(matches.map(match => match.round))];
            let bottom = top + 38;
            rounds.forEach((round, column) => {
                let next = top + 38 + cardHeight / 2;
                for (const match of matches.filter(item => item.round === round)) {
                    const parents = match.sources.map(actualSource)
                        .filter(([kind, id]) => kind === 'win' && byId.get(id)?.group === group)
                        .map(([, id]) => slots.get(id)?.center).filter(center => center !== undefined);
                    const center = parents.length
                        ? Math.max(next, (Math.min(...parents) + Math.max(...parents)) / 2)
                        : next;
                    add(match, column, center);
                    next = center + rowStep;
                    bottom = Math.max(bottom, center + cardHeight / 2);
                }
            });
            return { columns: rounds.length, bottom };
        }

        const upper = lane('upper', hasLower ? 'Верхняя сетка' : 'Сетка', 10);
        const lower = lane('lower', 'Нижняя сетка', upper.bottom + 42);
        const finalColumn = Math.max(upper.columns, lower.columns);
        const final = tournament.matches.find(match => match.group === 'final');
        const reset = tournament.matches.find(match => match.group === 'reset');
        if (final) {
            const parents = final.sources.map(actualSource).map(([, id]) => slots.get(id)?.center)
                .filter(center => center !== undefined);
            const center = parents.length ? (Math.min(...parents) + Math.max(...parents)) / 2 : 88;
            add(final, finalColumn, center);
            if (reset) add(reset, finalColumn + 1, center);
        }

        const width = Math.max(...[...slots.values()].map(slot => slot.x + cardWidth), cardWidth) + left;
        const height = Math.max(...[...slots.values()].map(slot => slot.center + cardHeight / 2), 130) + 16;
        stage.style.width = width + 'px';
        stage.style.height = height + 'px';
        const scale = window.devicePixelRatio || 1;
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const ink = canvas.getContext('2d');
        ink.scale(scale, scale);
        ink.lineWidth = 1.5;
        for (const slot of slots.values()) {
            slot.match.sources.map(actualSource).forEach(([kind, id], side) => {
                if (kind !== 'win' && kind !== 'loss') return;
                const source = slots.get(id);
                if (!source) return;
                const x1 = source.x + cardWidth;
                const x2 = slot.x;
                const y1 = source.center + (kind === 'loss' ? 14 : 1);
                const y2 = slot.center + (side === 0 ? -6 : 19);
                const cross = source.match.group !== slot.match.group;
                const turn = kind === 'loss' ? x1 + 10 : x2 - 12;
                ink.strokeStyle = kind === 'loss' ? '#dda1c8' : '#deb677';
                ink.setLineDash(kind === 'loss' ? [4, 4] : []);
                ink.beginPath();
                ink.moveTo(x1, y1);
                if (cross && (kind === 'loss' || x2 - x1 > columnStep)) {
                    const rail = upper.bottom + (kind === 'loss' ? 15 + (id % 3) * 5 : 33);
                    ink.lineTo(x1 + 10, y1);
                    ink.lineTo(x1 + 10, rail);
                    ink.lineTo(x2 - 8, rail);
                    ink.lineTo(x2 - 8, y2);
                } else {
                    ink.lineTo(turn, y1);
                    ink.lineTo(turn, y2);
                }
                ink.lineTo(x2, y2);
                ink.stroke();
            });
        }

        for (const { match, x, center } of slots.values()) {
            const card = element('article', undefined, 'lb-flow-match');
            card.style.left = x + 'px';
            card.style.top = center - cardHeight / 2 + 'px';
            const heading = match.label || (match.group === 'final' ? 'Гранд-финал' :
                match.group === 'reset' ? 'Решающий финал' : 'Матч ' + match.id);
            card.append(element('h4', heading));
            if (match.group === 'final' || match.group === 'reset') card.classList.add('lb-flow-final');
            match.players.forEach((player, side) => {
                const [kind, id] = actualSource(match.sources[side]);
                const name = player !== null ? tournament.players[player] : match.known[side] ? 'Свободное место' :
                    (kind === 'loss' ? 'Проигравший матча ' : 'Победитель матча ') + id;
                const row = element('div', undefined, 'lb-flow-player');
                if (match.done && match.winner === player && player !== null) row.classList.add('lb-picked');
                const caption = element('span', name);
                caption.title = name;
                if (player === null && !match.known[side]) {
                    caption.textContent = (kind === 'loss' ? 'Проигравший №' : 'Победитель №') + id;
                    caption.setAttribute('aria-label', name);
                }
                row.append(caption, element('strong', String(match.score?.[side] ?? '—')));
                card.append(row);
            });
            stage.append(card);
        }
        return section;
    }

    function rubles(amount) {
        return numberFormat.format(amount) + ' ₽';
    }

    function prizes(tournament) {
        const panel = element('section', undefined, 'lb-card lb-prizes');
        const total = element('div', undefined, 'lb-prize-total');
        total.append(element('h3', 'Призовой фонд', admin ? '' : 'category-subtitle'), element('strong', rubles(tournament.prize_pool)));
        panel.append(total);
        const count = tournament.rebuys.reduce((sum, value) => sum + value, 0);
        panel.append(element('p', `Бай-ин ${rubles(tournament.buy_in)} · Ребаи: ${count}`, 'lb-muted'));
        const list = element('ol', undefined, 'lb-ranking');
        tournament.prizes.forEach((amount, index) => {
            const row = element('li', undefined, 'lb-line lb-prize-line');
            row.append(element('span', (index + 1) + '-е место'), element('strong', rubles(amount)));
            list.append(row);
        });
        panel.append(list);
        return panel;
    }

    function standings(tournament) {
        const panel = element('section', undefined, 'lb-card');
        const poker = tournament.format === 'table';
        const remaining = tournament.places.filter(place => place === null).length;
        panel.append(element('h3', tournament.finished || tournament.legacy ? 'Итоговые места' : 'Игроки за столом', admin ? '' : 'category-subtitle'));
        const list = element('ul', undefined, 'lb-ranking');
        tournament.players.map((_, index) => index).sort((a, b) =>
            (tournament.places[a] ?? (tournament.finished ? Infinity : 0)) -
            (tournament.places[b] ?? (tournament.finished ? Infinity : 0))
        ).forEach(index => {
            const name = tournament.players[index];
            const row = element('li', undefined, 'lb-standing');
            const line = element('div', undefined, 'lb-line');
            const place = tournament.places[index];
            line.append(element('span', place === null ? '·' : String(place), 'lb-place'), element('span', name));
            if (tournament.finished && tournament.prizes && place !== null && place <= tournament.prizes.length) {
                line.append(element('strong', rubles(tournament.prizes[place - 1]), 'lb-count'));
            } else if (authorized && tournament.rebuys?.[index]) {
                line.append(element('small', 'Ребаи: ' + tournament.rebuys[index], 'lb-muted'));
            }
            row.append(line);
            if (authorized && poker && !tournament.legacy && !tournament.finished) {
                const actions = element('div', undefined, 'lb-actions');
                if (tournament.rebuys && place !== null) {
                    actions.append(button('Ребай', () => {
                        if (window.confirm(`Вернуть ${name} за стол? Ребай ${rubles(tournament.buy_in)} пойдёт в призовой фонд.`)) {
                            updateTournament(tournament, { action: 'rebuy', target: index });
                        }
                    }));
                } else if (place === null && remaining > 1) {
                    actions.append(button('Выбыл', () => {
                        if (window.confirm(name + ' выбывает из турнира?')) {
                            updateTournament(tournament, { action: 'eliminate', target: index });
                        }
                    }));
                }
                if (actions.childElementCount) row.append(actions);
            }
            list.append(row);
        });
        panel.append(list);
        if (authorized && tournament.rebuys && !tournament.finished && remaining === 1) {
            const finish = element('div', undefined, 'lb-finish');
            finish.append(element('p', 'За столом остался один игрок. Если ребаев больше не будет, завершите турнир.', 'lb-muted'),
                button('Завершить турнир', () => {
                    if (window.confirm('Завершить турнир и зафиксировать места и призовые?')) {
                        updateTournament(tournament, { action: 'finish' });
                    }
                }, 'lb-button lb-primary'));
            panel.append(finish);
        }
        return panel;
    }

    function details(tournament) {
        const section = element('section', undefined, 'lb-detail');
        const header = element('div', undefined, 'lb-card lb-detail-head');
        const format = tournament.rebuys ? 'Sit & Go · 6-max' : formatNames[tournament.format];
        header.append(element('h3', tournament.title), element('p', format, 'lb-muted'));
        if (authorized && !tournament.legacy) {
            const actions = element('div', undefined, 'lb-actions');
            if (tournament.can_undo) actions.append(button('Отменить последнее изменение', () => {
                if (window.confirm('Отменить последнее изменение турнира?')) {
                    updateTournament(tournament, { action: 'undo' });
                }
            }));
            actions.append(button('Удалить турнир', () => {
                if (!window.confirm('Удалить турнир «' + tournament.title + '»?')) return;
                mutate(async () => {
                    await request('/' + tournament.id + '?version=' + tournament.version, { method: 'DELETE' });
                    tournaments = tournaments.filter(item => item.id !== tournament.id);
                    selected = null;
                }, 'Турнир удалён');
            }, 'lb-button lb-danger'));
            header.append(actions);
        }
        section.append(header);
        if (tournament.prizes) section.append(prizes(tournament));
        if (tournament.finished || tournament.format === 'table') section.append(standings(tournament));
        if (tournament.format === 'group') section.append(groupStage(tournament));
        if (tournament.matches) section.append(authorized && tournament.matches.length
            ? bracket(tournament) : playoffDiagram(tournament));
        return section;
    }

    function tournamentList(title, entries, empty) {
        const panel = element('section', undefined, 'lb-card');
        panel.append(element('h3', title, admin ? '' : 'category-subtitle'));
        if (!entries.length) panel.append(element('p', empty, 'lb-muted'));
        entries.forEach(tournament => {
            const match = button('', () => {
                selected = selected === tournament.id ? null : tournament.id;
                render();
                if (selected) {
                    const detail = root.querySelector('.lb-detail');
                    detail.tabIndex = -1;
                    detail.focus();
                }
            }, 'lb-entry');
            const time = new Date(tournament.finished || tournament.created || '');
            const meta = [Number.isNaN(time.valueOf()) ? null : dateFormat.format(time), tournament.rebuys ? 'Sit & Go · 6-max' : formatNames[tournament.format]]
                .filter(Boolean).join(' · ');
            const copy = element('span');
            copy.append(element('strong', tournament.title), element('small', meta));
            match.append(copy, element('span', selected === tournament.id ? '−' : '+', 'lb-count'));
            match.setAttribute('aria-expanded', String(selected === tournament.id));
            panel.append(match);
            if (selected === tournament.id) panel.append(details(tournament));
        });
        return panel;
    }

    function render() {
        const header = element('header', undefined, 'lb-header');
        const title = element('div');
        title.append(element('h2', 'Турниры'));
        header.append(title, button('Обновить', load));
        const tabs = element('div', undefined, 'lb-tabs');
        for (const [value, label] of [['soulcalibur', 'Soulcalibur VI'], ['poker', 'Покер']]) {
            const tab = button(label, () => {
                discipline = value;
                selected = null;
                render();
                content.querySelector('[aria-pressed="true"]').focus();
            });
            tab.setAttribute('aria-pressed', String(value === discipline));
            tabs.append(tab);
        }

        const items = forDiscipline();
        const active = items.filter(item => !item.finished && !item.legacy);
        const history = items.filter(item => item.finished || item.legacy);
        if (admin) {
            content.replaceChildren(header, tabs);
        } else {
            const toolbar = element('div', undefined, 'lb-guest-toolbar');
            toolbar.append(tabs, button('Обновить', load));
            content.replaceChildren(toolbar);
        }
        if (admin) content.append(authorized ? createForm() : loginForm());
        content.append(tournamentList('Сейчас играют', active, 'Активных турниров пока нет.'),
            ranking(items), tournamentList('История', history, 'Завершённых турниров пока нет.'));
    }

    render();
    window.loadLeaderboards = load;
})();
