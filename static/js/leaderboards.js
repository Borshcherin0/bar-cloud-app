(() => {
    const root = document.getElementById('leaderboards');
    if (!root) return;

    const admin = root.dataset.admin === 'true';
    const endpoint = '/api/leaderboards';
    const formatNames = { single: 'До одного поражения', double: 'До двух поражений', table: 'Покерный стол' };
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

        const format = element('select');
        const poker = discipline === 'poker';
        for (const key of (poker ? ['table'] : ['double', 'single'])) {
            const option = element('option', formatNames[key]);
            option.value = key;
            format.append(option);
        }
        const chips = numeric(0, 1000000000);
        if (poker) form.append(field('Фишек на старте у каждого', chips));
        else form.append(field('Формат сетки', format));

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
        section.append(element('p', 'Матч ' + match.id + ' · ' + label, 'lb-match-meta'));
        const form = element('form', undefined, 'lb-match-form');
        match.players.forEach((player, index) => {
            const row = element('div', undefined, 'lb-match-player');
            const [kind, source] = match.sources[index];
            const name = player !== null ? tournament.players[player] :
                match.known[index] ? 'Свободное место' :
                (kind === 'win' ? 'Победитель матча ' : 'Проигравший матча ') + source;
            row.append(element('span', name, player !== null && player === match.winner ? 'lb-winner' : ''));
            if (authorized && match.ready && !match.done) {
                const input = numeric(match.score?.[index] ?? 0, 99);
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
        if (tournament.matches) section.append(bracket(tournament));
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
