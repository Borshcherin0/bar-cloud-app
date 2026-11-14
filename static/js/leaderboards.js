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
    let diagramObserver;

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

        const format = element('select');
        const poker = discipline === 'poker';
        for (const key of (poker ? ['table'] : ['group'])) {
            const option = element('option', formatNames[key]);
            option.value = key;
            format.append(option);
        }
        const chips = numeric(0, 1000000000);
        if (poker) form.append(field('Фишек на старте у каждого', chips));
        else form.append(element('p', 'Круговая группа, затем верхняя и нижняя сетки.', 'lb-muted'));

        form.append(element('button', 'Начать турнир', 'lb-button lb-primary'));
        form.addEventListener('submit', event => {
            event.preventDefault();
            mutate(async () => {
                const names = players.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
                const tournament = await request('', {
                    method: 'POST', body: JSON.stringify({
                        title: title.value, format: format.value, players: names, starting_chips: Number(chips.value),
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
        panel.append(element('h3', 'Лидеры по первым местам'));
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
        stage.append(element('h3', 'Групповой этап'));
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
        const section = element('section', undefined, 'lb-card');
        section.append(element('h3', 'Плей-офф'));
        if (!tournament.matches.length) {
            section.append(element('p', 'Сетка появится после определения мест в группе.', 'lb-muted'));
            return section;
        }

        section.append(element('p', 'Сплошная линия — проход победителя. Пунктир — переход проигравшего.', 'lb-muted'));
        const scroll = element('div', undefined, 'lb-flow-scroll');
        scroll.tabIndex = 0;
        scroll.setAttribute('aria-label', 'Сетка плей-офф с горизонтальной прокруткой');
        const diagram = element('div', undefined, 'lb-flow');
        const canvas = element('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        diagram.append(canvas);
        scroll.append(diagram);
        section.append(scroll);

        const anchors = new Map();
        const edges = [];
        const seedColumn = element('div', undefined, 'lb-flow-column');
        seedColumn.append(element('h4', 'Из группы'));
        const split = Math.ceil(tournament.players.length / 2);
        const seeds = tournament.tables[tournament.tables.length - 1];
        seeds.forEach((row, index) => {
            const seed = element('div', (index + 1) + '. ' + tournament.players[row.player], 'lb-seed');
            seed.append(element('small', index < split ? 'Верхняя сетка' : 'Нижняя сетка'));
            seedColumn.append(seed);
            anchors.set('player:' + row.player, seed);
        });
        diagram.append(seedColumn);
        for (const [group, label] of [['upper', 'Верхняя сетка'], ['lower', 'Нижняя сетка'], ['final', 'Гранд-финал']]) {
            const matches = tournament.matches.filter(match => match.group === group);
            for (const round of new Set(matches.map(match => match.round))) {
                const column = element('div', undefined, 'lb-flow-column');
                const title = group === 'final' ? label : label + ' · ' + round;
                column.append(element('h4', title));
                matches.filter(match => match.round === round).forEach(match => {
                    const card = matchCard(tournament, match);
                    column.append(card);
                    anchors.set('win:' + match.id, card);
                    anchors.set('loss:' + match.id, card);
                    match.sources.forEach(([kind, id], index) => {
                        if (id !== null) edges.push([kind, id, card.querySelectorAll('.lb-match-player')[index], card]);
                    });
                });
                diagram.append(column);
            }
        }

        function draw() {
            const width = diagram.offsetWidth;
            const height = diagram.offsetHeight;
            if (!width || !height) return;
            const scale = window.devicePixelRatio || 1;
            canvas.width = width * scale;
            canvas.height = height * scale;
            const context = canvas.getContext('2d');
            context.scale(scale, scale);
            const origin = diagram.getBoundingClientRect();
            for (const [index, [kind, id, row, card]] of edges.entries()) {
                const start = anchors.get(kind + ':' + id)?.getBoundingClientRect();
                if (!start) continue;
                const end = card.getBoundingClientRect();
                const slot = row.getBoundingClientRect();
                const x1 = start.right - origin.left;
                const x2 = end.left - origin.left;
                const y1 = start.top + start.height / 2 - origin.top;
                const y2 = slot.top + slot.height / 2 - origin.top;
                const turn = x2 - 12;
                context.strokeStyle = kind === 'loss' ? '#d69acb' : '#d6b77e';
                context.lineWidth = 1.5;
                context.setLineDash(kind === 'loss' ? [4, 4] : []);
                context.beginPath();
                context.moveTo(x1, y1);
                context.lineTo(x1 + 8, y1);
                if (x2 - x1 > 55) {
                    const rail = height - 12 - (index % 5) * 5;
                    context.lineTo(x1 + 8, rail);
                    context.lineTo(turn, rail);
                }
                context.lineTo(turn, y2);
                context.lineTo(x2, y2);
                context.stroke();
            }
        }
        const observer = new ResizeObserver(draw);
        observer.observe(diagram);
        diagramObserver = observer;
        return section;
    }

    function standings(tournament) {
        const panel = element('section', undefined, 'lb-card');
        panel.append(element('h3', tournament.finished || tournament.legacy ? 'Итоговые места' : 'Игроки за столом'));
        const list = element('ul', undefined, 'lb-ranking');
        tournament.players.map((_, index) => index).sort((a, b) =>
            (tournament.places[a] ?? (tournament.finished ? Infinity : 0)) -
            (tournament.places[b] ?? (tournament.finished ? Infinity : 0)) ||
            (tournament.chips?.[b] ?? 0) - (tournament.chips?.[a] ?? 0)
        ).forEach(index => {
            const name = tournament.players[index];
            const row = element('li', undefined, 'lb-standing');
            const line = element('div', undefined, 'lb-line');
            const place = tournament.places[index];
            line.append(element('span', place === null ? '·' : String(place), 'lb-place'), element('span', name));
            if (tournament.chips && place === null) {
                line.append(element('strong', numberFormat.format(tournament.chips[index]) + ' фишек', 'lb-count'));
            }
            row.append(line);
            if (authorized && tournament.chips && place === null) {
                const form = element('form', undefined, 'lb-actions');
                const input = numeric(tournament.chips[index], 1000000000);
                input.setAttribute('aria-label', 'Фишки: ' + name);
                form.append(input, element('button', 'Сохранить', 'lb-button'), button('Выбыл', () => {
                    if (window.confirm(name + ' выбывает из турнира?')) {
                        updateTournament(tournament, { action: 'eliminate', target: index });
                    }
                }));
                form.addEventListener('submit', event => {
                    event.preventDefault();
                    updateTournament(tournament, { action: 'stack', target: index, chips: Number(input.value) });
                });
                row.append(form);
            }
            list.append(row);
        });
        panel.append(list);
        return panel;
    }

    function details(tournament) {
        const section = element('section', undefined, 'lb-detail');
        const header = element('div', undefined, 'lb-card lb-detail-head');
        header.append(element('h3', tournament.title), element('p', formatNames[tournament.format], 'lb-muted'));
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
        if (tournament.finished || tournament.format === 'table') section.append(standings(tournament));
        if (tournament.format === 'group') section.append(groupStage(tournament), playoffDiagram(tournament));
        else if (tournament.matches) section.append(bracket(tournament));
        return section;
    }

    function tournamentList(title, entries, empty) {
        const panel = element('section', undefined, 'lb-card');
        panel.append(element('h3', title));
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
            const meta = [Number.isNaN(time.valueOf()) ? null : dateFormat.format(time), formatNames[tournament.format]]
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
        diagramObserver?.disconnect();
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
        content.replaceChildren(header, tabs);
        if (admin) content.append(authorized ? createForm() : loginForm());
        content.append(tournamentList('Сейчас играют', active, 'Активных турниров пока нет.'),
            ranking(items), tournamentList('История', history, 'Завершённых турниров пока нет.'));
    }

    render();
    window.loadLeaderboards = load;
})();
