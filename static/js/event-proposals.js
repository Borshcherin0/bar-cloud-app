function restoreProposal() {
    const form = document.getElementById('proposalForm');
    form.elements.description.value = form.elements.original_text.value;
    delete form.elements.description.dataset.edited;
}

function styleProposal() {
    const form = document.getElementById('proposalForm');
    const original = form.elements.original_text.value.trim();
    form.elements.description.dataset.edited = 'true';
    if (!original) return;
    form.elements.description.value = `Монстры, общий сбор! 🍸\n\n${original}\n\nЗалетайте — соберём свою стаю и сделаем этот вечер легендарным. 🖤`;
}

async function submitProposal(event) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('[type="submit"]');
    const status = document.getElementById('proposalStatus');
    button.disabled = true;
    status.textContent = 'Отправляем…';
    try {
        const response = await fetch(`${API_BASE}/api/event-proposals`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        if (!response.ok) throw new Error('Не удалось отправить. Проверь поля и попробуй ещё раз.');
        form.reset();
        delete form.elements.description.dataset.edited;
        status.textContent = 'Предложение отправлено на модерацию!';
    } catch (error) {
        status.textContent = error.message;
    } finally {
        button.disabled = false;
    }
}

document.querySelector('#proposalForm [name="original_text"]').addEventListener('input', () => {
    const form = document.getElementById('proposalForm');
    if (!form.elements.description.dataset.edited) restoreProposal();
});
document.querySelector('#proposalForm [name="description"]').addEventListener('input', event => {
    event.target.dataset.edited = 'true';
});
