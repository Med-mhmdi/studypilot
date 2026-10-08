const list = document.querySelector('#task-list');
const emptyState = document.querySelector('#empty-state');
const dialog = document.querySelector('#task-dialog');
const form = document.querySelector('#task-form');
let tasks = [];
let activeStatus = 'all';

const escapeDate = (value) => new Date(`${value}T00:00:00`);
function prettyDate(value) {
  return escapeDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function isOverdue(task) {
  return task.status !== 'done' && escapeDate(task.due_date) < new Date(new Date().toDateString());
}
function visibleTasks() {
  const course = document.querySelector('#course-filter').value;
  return tasks.filter((task) => (activeStatus === 'all' || task.status === activeStatus) && (!course || task.course === course));
}
function render() {
  const shown = visibleTasks();
  document.querySelector('#count-all').textContent = tasks.length;
  document.querySelector('#in-progress').textContent = tasks.filter((task) => task.status === 'in_progress').length;
  document.querySelector('#completed').textContent = tasks.filter((task) => task.status === 'done').length;
  const next = tasks.filter((task) => task.status !== 'done').sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  document.querySelector('#up-next').textContent = next ? prettyDate(next.due_date) : 'All clear';
  list.replaceChildren();
  emptyState.classList.toggle('show', shown.length === 0);
  if (!shown.length) return;
  for (const task of shown) {
    const row = document.createElement('article');
    row.className = 'task-row';
    const check = document.createElement('button');
    check.className = `check-button ${task.status === 'done' ? 'checked' : ''}`;
    check.setAttribute('aria-label', task.status === 'done' ? 'Mark as not done' : 'Mark as done');
    check.textContent = task.status === 'done' ? '✓' : '';
    check.addEventListener('click', () => updateTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' }));
    const main = document.createElement('div');
    const title = document.createElement('div');
    title.className = `task-title ${task.status === 'done' ? 'is-done' : ''}`;
    title.textContent = task.title;
    main.append(title);
    if (task.course) { const course = document.createElement('div'); course.className = 'task-course'; course.textContent = task.course; main.append(course); }
    const due = document.createElement('span');
    due.className = `date-pill ${isOverdue(task) ? 'overdue' : ''}`;
    due.textContent = `${isOverdue(task) ? 'Overdue · ' : ''}${prettyDate(task.due_date)}`;
    const priority = document.createElement('span');
    priority.className = `priority-pill priority-${task.priority}`;
    priority.textContent = `${task.priority} priority`;
    const status = document.createElement('span');
    status.className = `status-pill ${task.status}`;
    status.textContent = task.status.replace('_', ' ');
    const menu = document.createElement('button');
    menu.className = 'row-menu'; menu.textContent = '···'; menu.setAttribute('aria-label', `Edit ${task.title}`);
    menu.addEventListener('click', () => openEdit(task));
    row.append(check, main, due, priority, status, menu);
    list.append(row);
  }
}
async function loadTasks() {
  const response = await fetch('/api/tasks');
  if (!response.ok) throw new Error('Could not load assignments. Please refresh.');
  tasks = await response.json();
  const courses = [...new Set(tasks.map((task) => task.course).filter(Boolean))].sort();
  const select = document.querySelector('#course-filter');
  const selected = select.value;
  select.replaceChildren(new Option('All courses', ''), ...courses.map((course) => new Option(course, course)));
  select.value = courses.includes(selected) ? selected : '';
  render();
}
function openNew() {
  form.reset();
  document.querySelector('#task-id').value = '';
  document.querySelector('#dialog-title').textContent = 'New assignment';
  document.querySelector('#status-wrap').hidden = true;
  const today = new Date();
  document.querySelector('#due-date').value = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  document.querySelector('#delete-task').hidden = true;
  document.querySelector('#form-error').textContent = '';
  dialog.showModal();
  document.querySelector('#title').focus();
}
function openEdit(task) {
  form.reset();
  document.querySelector('#task-id').value = task.id;
  document.querySelector('#dialog-title').textContent = 'Edit assignment';
  document.querySelector('#status-wrap').hidden = false;
  document.querySelector('#delete-task').hidden = false;
  for (const key of ['title', 'course', 'due_date', 'priority', 'status', 'description']) document.querySelector(`#${key.replace('_', '-')}`).value = task[key] ?? '';
  document.querySelector('#form-error').textContent = '';
  dialog.showModal();
}
async function updateTask(id, changes) {
  const response = await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
  if (!response.ok) throw new Error('Could not update the assignment.');
  await loadTasks();
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.querySelector('#task-id').value;
  const payload = Object.fromEntries(new FormData(form).entries());
  delete payload.status;
  if (id) payload.status = document.querySelector('#status').value;
  document.querySelector('#form-error').textContent = '';
  const response = await fetch(id ? `/api/tasks/${id}` : '/api/tasks', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    document.querySelector('#form-error').textContent = data.detail?.[0]?.msg || data.detail || 'Could not save. Check the fields and try again.';
    return;
  }
  dialog.close();
  await loadTasks();
});
document.querySelector('#new-task').addEventListener('click', openNew);
document.querySelector('#empty-add').addEventListener('click', openNew);
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
document.querySelector('#cancel-dialog').addEventListener('click', () => dialog.close());
document.querySelector('#delete-task').addEventListener('click', async () => {
  const id = document.querySelector('#task-id').value;
  if (!id || !window.confirm('Delete this assignment? This cannot be undone.')) return;
  const response = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  if (!response.ok) { document.querySelector('#form-error').textContent = 'Could not delete. Please try again.'; return; }
  dialog.close();
  await loadTasks();
});
document.querySelector('#course-filter').addEventListener('change', render);
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  document.querySelector('.filter.active').classList.remove('active');
  button.classList.add('active'); activeStatus = button.dataset.filter; render();
}));
loadTasks().catch((error) => { emptyState.classList.add('show'); emptyState.querySelector('p').textContent = error.message; });
