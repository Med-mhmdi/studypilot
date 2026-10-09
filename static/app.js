const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const appMessage = $('#app-message');
const taskForm = $('#task-form');
let user = null;
let tasks = [];
let projects = [];
let people = [];
let conversations = [];
let groupThreads = [];
let calendarMilestones = [];
let activeProject = null;
let activeConversation = null;
let pendingConversationId = null;
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let pollTimer = null;
let lastGroupMessageId = 0;
let lastDirectMessageId = 0;
let activeGroupChatId = null;
let showFullArchive = false;
let boardMetric = '';

function showMessage(message, type = 'error') {
  appMessage.textContent = message;
  appMessage.className = `app-message ${type}`;
  appMessage.hidden = !message;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  if (response.status === 401) {
    $('#app-screen').hidden = true;
    $('#auth-screen').hidden = false;
    throw new Error('Please sign in to continue.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail || 'Something went wrong. Please try again.');
  }
  return response.status === 204 ? null : response.json();
}

const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });
const patch = (url, body) => api(url, { method: 'PATCH', body: JSON.stringify(body) });

function dateOnly(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timestamp(value) {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, options = { month: 'short', day: 'numeric' }) {
  const date = dateOnly(value);
  return date ? date.toLocaleDateString(undefined, options) : 'Date unavailable';
}

function formatTimestamp(value) {
  const date = timestamp(value);
  return date ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable';
}

function todayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isOverdue(task) {
  const due = dateOnly(task.due_date);
  return task.status !== 'done' && due && due < todayLocal();
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('studypilot-theme', theme);
  const dark = theme === 'dark';
  $('#theme-toggle').textContent = dark ? '☀' : '☾';
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  document.querySelector('meta[name="theme-color"]').content = dark ? '#171923' : '#f6f7fb';
}

function avatarLabel(profile) { return ({ violet: '✦', ocean: '◈', mint: '✿', coral: '●', sun: '☼' })[profile?.avatar] || (profile?.name || 'S').trim().slice(0, 1).toUpperCase(); }
function setAvatar(node, profile) { node.textContent = avatarLabel(profile); node.dataset.avatar = profile?.avatar || 'violet'; }

$('#theme-toggle').addEventListener('click', async () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; setTheme(theme); if (user) { try { user = await patch('/api/profile', { name: user.name, theme }); } catch (error) { showMessage(error.message); } } });
setTheme(localStorage.getItem('studypilot-theme') === 'dark' ? 'dark' : 'light');

function authMode(register) {
  const form = $('#auth-form');
  form.dataset.register = String(register);
  $('#name-field').hidden = !register;
  $('#username-field').hidden = !register;
  $('[name="name"]', form).required = register;
  $('[name="username"]', form).required = register;
  $('#auth-title').textContent = register ? 'Start your account.' : 'Welcome back.';
  $('#auth-submit').textContent = register ? 'Create account →' : 'Sign in →';
  $('#auth-switch').textContent = register ? 'Already have an account? Sign in' : 'New to StudyPilot? Create an account';
  const password = $('[name="password"]', form);
  password.autocomplete = register ? 'new-password' : 'current-password';
  password.minLength = register ? 10 : 1;
}

$('#auth-switch').addEventListener('click', () => authMode($('#auth-form').dataset.register !== 'true'));
$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const registering = event.currentTarget.dataset.register === 'true';
  $('#auth-error').textContent = '';
  try {
    const formData = new FormData(event.currentTarget);
    const payload = registering
      ? { email: formData.get('email'), name: formData.get('name'), username: formData.get('username'), password: formData.get('password') }
      : { email: formData.get('email'), password: formData.get('password') };
    user = await post(registering ? '/api/auth/register' : '/api/auth/login', payload);
    $('#auth-screen').hidden = true;
    $('#app-screen').hidden = false;
    await startApp();
    await acceptUrlInvitation();
    await renderRoute();
  } catch (error) { $('#auth-error').textContent = error.message; }
});

async function boot() {
  try {
    user = await api('/api/auth/me');
    $('#auth-screen').hidden = true;
    $('#app-screen').hidden = false;
    await startApp();
    await acceptUrlInvitation();
  } catch {
    $('#auth-screen').hidden = false;
    $('#app-screen').hidden = true;
    authMode(false);
    if (new URLSearchParams(location.search).has('invite')) $('#auth-error').textContent = 'Sign in with the invited email or create an account using it.';
  }
  await renderRoute();
}

async function startApp() {
  $('#account-name').textContent = user.name;
  setAvatar($('#avatar'), user);
  setTheme(user.theme || localStorage.getItem('studypilot-theme') || 'light');
  showMessage('');
  try { await Promise.all([loadProjects(), loadTasks(), loadNotifications(), loadPeople(), loadConversations()]); }
  catch (error) { showMessage(error.message); }
}

async function acceptUrlInvitation() {
  const token = new URLSearchParams(location.search).get('invite');
  if (!token) return;
  const result = await post(`/api/invitations/${encodeURIComponent(token)}/accept`, {});
  history.replaceState(null, '', `${location.pathname}${location.hash || '#/groups'}`);
  await loadProjects();
  location.hash = `#/groups/${result.id}`;
}

function routeFromHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] || 'dashboard', id: parts[0] === 'groups' && parts[1] ? Number(parts[1]) : null, query: new URLSearchParams(query) };
}

async function renderRoute() {
  const route = routeFromHash();
  const known = ['dashboard', 'board', 'groups', 'calendar', 'messages', 'people'];
  if (!known.includes(route.name)) { location.hash = '#/dashboard'; return; }
  $$('.view').forEach((view) => { view.hidden = true; view.classList.remove('active-view'); });
  $(`#view-${route.name}`).hidden = false;
  $(`#view-${route.name}`).classList.add('active-view');
  $$('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.route === route.name));
  activeProject = null;
  if (route.name !== 'messages') {
    if (activeGroupChatId) localStorage.setItem('studypilot-chat', JSON.stringify({ kind: 'group', id: activeGroupChatId }));
    if (activeConversation) localStorage.setItem('studypilot-chat', JSON.stringify({ kind: 'direct', id: activeConversation.id }));
    activeConversation = null; activeGroupChatId = null;
  }
  stopPolling();
  showMessage('');
  try {
    if (route.name === 'dashboard') { await Promise.all([loadTasks(), loadProjects()]); renderDashboard(); }
    if (route.name === 'board') { await loadTasks(); boardMetric = new URLSearchParams(location.hash.split('?')[1] || '').get('filter') || ''; renderBoardView(); }
    if (route.name === 'groups') {
      if (route.id) { $('#projects-grid').hidden = true; $('.page-heading', $('#view-groups')).hidden = true; }
      else { $('#projects-grid').hidden = false; $('.page-heading', $('#view-groups')).hidden = false; $('#project-detail').hidden = true; }
      await loadProjects();
      if (route.id) await renderProject(route.id);
    }
    if (route.name === 'calendar') {
      await Promise.all([loadTasks(), loadProjects()]);
      await loadCalendarMilestones();
      renderCalendar();
    }
    if (route.name === 'messages') await renderInbox();
    if (route.name === 'people') await renderPeople();
  } catch (error) { showMessage(error.message); }
}

window.addEventListener('hashchange', renderRoute);

async function loadTasks(projectId = null) {
  tasks = await api(projectId ? `/api/tasks?project_id=${projectId}` : '/api/tasks');
  return tasks;
}

async function loadProjects() {
  projects = await api('/api/projects');
  $('#group-count').textContent = projects.length;
  renderProjects();
}

async function loadPeople() {
  people = await api('/api/people');
}

async function loadCalendarMilestones() {
  const groups = await Promise.all(projects.map(async (project) => {
    const records = await api(`/api/projects/${project.id}/milestones`);
    return records.map((milestone) => ({ ...milestone, project_id: project.id, project_name: project.name }));
  }));
  calendarMilestones = groups.flat();
}

function renderDashboard() {
  const today = todayLocal();
  const dueTodayOrLater = tasks.filter((task) => task.status !== 'done' && dateOnly(task.due_date) >= today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const done = tasks.filter((task) => task.status === 'done').length;
  const pending = tasks.filter((task) => task.status !== 'done').length;
  $('#up-next').textContent = dueTodayOrLater.length ? formatDate(dueTodayOrLater[0].due_date) : 'All clear';
  $('#in-progress').textContent = tasks.filter((task) => task.status === 'in_progress').length;
  $('#completed').textContent = done;
  $('#overdue').textContent = tasks.filter(isOverdue).length;
  const rate = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  $('#completion-rate').textContent = `${rate}%`;
  $('#completion-bar').style.width = `${rate}%`;
  $('#progress-caption').textContent = tasks.length ? `${done} of ${tasks.length} assignments completed` : 'Add an assignment to start tracking progress.';
  $('#group-summary').textContent = `${projects.length} study groups · ${projects.reduce((sum, project) => sum + Number(project.member_count || 0), 0)} group memberships`;
  const preview = $('#todo-preview'); preview.replaceChildren();
  const focus = tasks.filter((task) => task.status !== 'done').sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || ({high:0,medium:1,low:2}[a.priority] - {high:0,medium:1,low:2}[b.priority]) || a.due_date.localeCompare(b.due_date)).slice(0, 5);
  if (!focus.length) { const empty = document.createElement('p'); empty.className = 'subtle-empty'; empty.textContent = 'Nothing pending. Enjoy the breathing room.'; preview.append(empty); }
  focus.forEach((task) => { const row = document.createElement('button'); row.className = 'todo-preview-row'; const title = document.createElement('strong'); title.textContent = task.title; const meta = document.createElement('small'); meta.textContent = `${isOverdue(task) ? 'Overdue' : `Due ${formatDate(task.due_date)}`} · ${task.priority} priority`; row.append(title, meta); row.addEventListener('click', () => { location.hash = `#/board?filter=${isOverdue(task) ? 'overdue' : 'all'}`; }); preview.append(row); });
}

function filterTasks(items) {
  const query = $('#task-search').value.trim().toLocaleLowerCase();
  const course = $('#course-filter').value;
  return items.filter((task) => (!course || task.course === course) && (!query || `${task.title} ${task.course} ${task.project_name || ''}`.toLocaleLowerCase().includes(query)));
}

function updateDashboardBoard() {
  const filtered = filterTasks(tasks);
  const statusFiltered = filtered.filter((task) => {
    if (boardMetric === 'up-next') return task.status !== 'done' && dateOnly(task.due_date) >= todayLocal();
    if (boardMetric === 'overdue') return isOverdue(task);
    if (boardMetric === 'in_progress' || boardMetric === 'done') return task.status === boardMetric;
    return true;
  });
  const done = statusFiltered.filter((task) => task.status === 'done').sort((a,b) => (b.completed_at || b.updated_at || '').localeCompare(a.completed_at || a.updated_at || ''));
  const shownDone = showFullArchive || $('#task-search').value.trim() ? done : done.slice(0, 15);
  const displayed = statusFiltered.filter((task) => task.status !== 'done').concat(shownDone);
  const hasMatches = displayed.length > 0;
  renderBoard($('#task-board'), displayed, null);
  $('#task-board').hidden = !hasMatches;
  $('#task-empty').hidden = hasMatches;
  const searching = $('#task-search').value.trim() || $('#course-filter').value;
  $('#task-empty h3').textContent = tasks.length && (searching || boardMetric) ? 'No matching assignments' : 'No assignments here yet';
  $('#task-empty p').textContent = tasks.length && (searching || boardMetric) ? 'Try another search or choose a different summary card.' : 'Add an assignment to get started.';
  $('#empty-add').textContent = tasks.length && (searching || boardMetric) ? 'Clear search and filters' : '＋ Add assignment';
  const note = $('#archive-note');
  if (note) { note.hidden = !done.length; note.textContent = `${shownDone.length} of ${done.length} completed assignments shown. `; const toggle = document.createElement('button'); toggle.className='text-button'; toggle.textContent = showFullArchive ? 'Show recent only' : 'Search full history / show all'; toggle.addEventListener('click', () => { showFullArchive = !showFullArchive; updateDashboardBoard(); }); note.append(toggle); }
}

$('#task-search').addEventListener('input', updateDashboardBoard);
$('#course-filter').addEventListener('change', updateDashboardBoard);
$('#new-task').addEventListener('click', () => openNewTask(null));
$('#board-new-task').addEventListener('click', () => openNewTask(null));
$$('.metric-card').forEach((card) => card.addEventListener('click', () => { location.hash = `#/board?filter=${card.dataset.metric}`; }));

function renderBoardView() {
  const courses = [...new Set(tasks.map((task) => task.course).filter(Boolean))].sort();
  const filter = $('#course-filter'); const chosen = filter.value;
  filter.replaceChildren(new Option('All courses', ''), ...courses.map((course) => new Option(course, course)));
  filter.value = courses.includes(chosen) ? chosen : '';
  updateDashboardBoard();
}
$('#empty-add').addEventListener('click', () => {
  if (tasks.length && ($('#task-search').value.trim() || $('#course-filter').value)) {
    $('#task-search').value = ''; $('#course-filter').value = ''; updateDashboardBoard();
  } else openNewTask(null);
});

const statusNames = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
function renderBoard(board, items, project) {
  board.replaceChildren();
  board.className = 'task-board';
  for (const [status, title] of Object.entries(statusNames)) {
    const lane = document.createElement('section');
    lane.className = `kanban-lane lane-${status}`;
    lane.dataset.status = status;
    const heading = document.createElement('div');
    heading.className = 'lane-heading';
    const label = document.createElement('h3'); label.textContent = title;
    const count = document.createElement('span'); count.className = 'lane-count';
    const cards = items.filter((task) => task.status === status);
    count.textContent = cards.length;
    heading.append(label, count);
    const content = document.createElement('div'); content.className = 'lane-cards';
    if (!cards.length) { const empty = document.createElement('p'); empty.className = 'lane-empty'; empty.textContent = 'Drop work here'; content.append(empty); }
    cards.forEach((task) => content.append(makeTaskCard(task, project)));
    lane.append(heading, content);
    lane.addEventListener('dragover', (event) => { if (!project || project.role !== 'viewer') { event.preventDefault(); lane.classList.add('drop-target'); } });
    lane.addEventListener('dragleave', () => lane.classList.remove('drop-target'));
    lane.addEventListener('drop', async (event) => {
      event.preventDefault(); lane.classList.remove('drop-target');
      const id = Number(event.dataTransfer.getData('text/plain'));
      const task = items.find((item) => item.id === id);
      if (task && task.status !== status) await changeTaskStatus(task, status, project);
    });
    board.append(lane);
  }
}

function makeTaskCard(task, project) {
  const card = document.createElement('article');
  card.className = `task-card priority-card-${task.priority}`;
  card.draggable = !project || project.role !== 'viewer';
  card.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/plain', String(task.id)); event.dataTransfer.effectAllowed = 'move'; });
  const titleLine = document.createElement('div'); titleLine.className = 'task-card-title';
  const canEdit = project?.role !== 'viewer';
  const title = document.createElement('button'); title.className = 'task-title'; title.textContent = task.title; title.disabled = !canEdit; title.addEventListener('click', () => openEditTask(task, project));
  const menu = document.createElement('button'); menu.className = 'row-menu'; menu.setAttribute('aria-label', `Edit ${task.title}`); menu.textContent = '···'; menu.disabled = !canEdit; menu.addEventListener('click', () => openEditTask(task, project));
  titleLine.append(title, menu);
  const context = document.createElement('div'); context.className = 'task-context';
  if (task.project_name && !project) context.append(makeTag(task.project_name, 'project-tag'));
  if (task.course) context.append(makeTag(task.course, 'course-tag'));
  if (task.priority) context.append(makeTag(`${task.priority} priority`, `priority-tag ${task.priority}`));
  const deadline = document.createElement('p'); deadline.className = `task-deadline ${isOverdue(task) ? 'overdue' : ''}`;
  deadline.textContent = `${isOverdue(task) ? 'Overdue · ' : 'Due · '}${formatDate(task.due_date, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const assignees = document.createElement('p'); assignees.className = 'task-assignees';
  assignees.textContent = task.assignees?.length ? task.assignees.map((person) => person.name).join(', ') : (project ? 'No teammates assigned' : 'Just you');
  if (task.started_at) {
    const start = timestamp(task.started_at); const end = timestamp(task.completed_at);
    if (start) { const duration = document.createElement('small'); duration.className='work-duration'; const hours=Math.max(0,Math.round((end-start)/3600000)); duration.textContent = end ? `Work time · ${hours < 24 ? `${hours} hours` : `${Math.round(hours/24)} days`}` : `Started · ${formatTimestamp(task.started_at)}`; assignees.append(document.createElement('br'),duration); }
  }
  const actions = document.createElement('div'); actions.className = 'task-card-actions';
  const move = document.createElement('button'); move.className = 'move-button';
  const nextStatus = task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'in_progress';
  move.textContent = task.status === 'todo' ? 'Start working' : task.status === 'in_progress' ? 'Mark done' : 'Reopen';
  move.setAttribute('aria-label', `${move.textContent}: ${task.title}`);
  move.disabled = project?.role === 'viewer';
  move.addEventListener('click', () => changeTaskStatus(task, nextStatus, project));
  const status = document.createElement('select'); status.className = 'task-status-select'; status.setAttribute('aria-label', `Status for ${task.title}`); status.disabled = !canEdit;
  Object.entries(statusNames).forEach(([value, name]) => status.add(new Option(name, value)));
  status.value = task.status; status.addEventListener('change', () => changeTaskStatus(task, status.value, project));
  const comment = document.createElement('button'); comment.className = 'text-button'; comment.textContent = 'Comments'; comment.addEventListener('click', () => toggleComments(card, task, project));
  const historyButton=document.createElement('button');historyButton.className='text-button';historyButton.textContent='History';historyButton.addEventListener('click',()=>toggleTaskHistory(card,task));
  actions.append(status, move, comment, historyButton);
  card.append(titleLine, context, deadline, assignees, actions);
  return card;
}

async function toggleTaskHistory(card, task) {
  const existing=$('.task-history',card);if(existing){existing.remove();return;}
  const panel=document.createElement('div');panel.className='task-history';panel.textContent='Loading history…';card.append(panel);
  try{const rows=await api(`/api/tasks/${task.id}/history`);panel.replaceChildren();if(!rows.length){panel.textContent='No status changes recorded yet.';return;}rows.forEach(row=>{const item=document.createElement('p');item.textContent=`${row.changed_by||'A teammate'} moved ${row.from_status||'new'} → ${row.to_status} · ${formatTimestamp(row.changed_at)}`;panel.append(item);});}catch(error){panel.textContent=error.message;}
}

function makeTag(text, className) { const tag = document.createElement('span'); tag.className = className; tag.textContent = text; return tag; }

async function changeTaskStatus(task, status, project) {
  try {
    await patch(`/api/tasks/${task.id}`, { status });
    showMessage('');
    await loadTasks(project?.id || null);
    if (project) await loadProjectBoard(project);
    else if (routeFromHash().name === 'board') renderBoardView();
    else renderDashboard();
  } catch (error) { showMessage(error.message); }
}

function openNewTask(project) {
  taskForm.reset();
  $('#task-id').value = '';
  $('#task-dialog-title').textContent = project ? `New assignment · ${project.name}` : 'New assignment';
  $('#status-wrap').hidden = true;
  $('#delete-task').hidden = true;
  $('#form-error').textContent = '';
  $('#assignee-wrap').hidden = !project;
  populateAssignees(project, []);
  const now = new Date();
  $('#due-date').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  taskForm.dataset.projectId = project?.id || '';
  $('#task-dialog').showModal();
  $('#title').focus();
}

function populateAssignees(project, selected) {
  const select = $('#assignees'); select.replaceChildren();
  if (!project) return;
  project.members.forEach((member) => {
    const option = new Option(member.name, member.id, false, selected.includes(member.id));
    if (member.id === user.id) option.disabled = true;
    select.add(option);
  });
}

function openEditTask(task, project) {
  taskForm.reset();
  $('#task-id').value = task.id;
  $('#task-dialog-title').textContent = 'Edit assignment';
  $('#status-wrap').hidden = false;
  $('#delete-task').hidden = false;
  $('#assignee-wrap').hidden = !project;
  $('#form-error').textContent = '';
  for (const key of ['title', 'course', 'due_date', 'priority', 'status', 'description']) $(`#${key.replace('_', '-')}`).value = task[key] ?? '';
  populateAssignees(project, task.assignees?.map((person) => person.id) || []);
  taskForm.dataset.projectId = project?.id || '';
  $('#task-dialog').showModal();
}

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('#task-id').value;
  const projectId = taskForm.dataset.projectId;
  const payload = Object.fromEntries(new FormData(taskForm).entries());
  if (!id) delete payload.status;
  else payload.status = $('#status').value;
  if (projectId) {
    if (!id) payload.project_id = Number(projectId);
    payload.assignee_ids = $$('#assignees option:checked').map((option) => Number(option.value));
  }
  $('#form-error').textContent = '';
  try {
    await api(id ? `/api/tasks/${id}` : '/api/tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    $('#task-dialog').close();
    await loadTasks(projectId || null);
    if (projectId) await loadProjectBoard(activeProject);
    else if (routeFromHash().name === 'board') renderBoardView();
    else renderDashboard();
  } catch (error) { $('#form-error').textContent = error.message; }
});

$('#delete-task').addEventListener('click', async () => {
  const id = $('#task-id').value;
  if (!id) return;
  if (!confirm('Delete this assignment? This cannot be undone.')) return;
  $('#form-error').textContent = '';
  try {
    await api(`/api/tasks/${id}`, { method: 'DELETE' });
    $('#task-dialog').close();
    const projectId = taskForm.dataset.projectId;
    await loadTasks(projectId || null);
    if (projectId) await loadProjectBoard(activeProject); else if (routeFromHash().name === 'board') renderBoardView(); else renderDashboard();
  } catch (error) { $('#form-error').textContent = error.message; }
});

async function toggleComments(card, task, project) {
  const old = $('.comments-panel', card);
  if (old) { old.remove(); return; }
  const panel = document.createElement('section'); panel.className = 'comments-panel'; panel.setAttribute('aria-label', `Comments on ${task.title}`);
  panel.textContent = 'Loading comments…'; card.append(panel);
  try {
    const comments = await api(`/api/tasks/${task.id}/comments`);
    panel.replaceChildren();
    const title = document.createElement('h4'); title.textContent = 'Assignment comments'; panel.append(title);
    const stream = document.createElement('div'); stream.className = 'comment-stream';
    if (!comments.length) stream.textContent = 'No comments yet.';
    comments.forEach((comment) => { const row = document.createElement('p'); row.className = 'comment-item'; const by = document.createElement('strong'); by.textContent = comment.name; const body = document.createElement('span'); body.textContent = comment.body; row.append(by, body); stream.append(row); });
    panel.append(stream);
    if (project?.role !== 'viewer') {
      const form = document.createElement('form'); form.className = 'comment-form';
      const input = document.createElement('input'); input.name = 'body'; input.maxLength = 2000; input.required = true; input.placeholder = 'Add a helpful note'; input.setAttribute('aria-label', 'Comment');
      const send = document.createElement('button'); send.className = 'secondary-button'; send.textContent = 'Send'; form.append(input, send);
      form.addEventListener('submit', async (event) => { event.preventDefault(); try { await post(`/api/tasks/${task.id}/comments`, { body: input.value }); panel.remove(); await toggleComments(card, task, project); } catch (error) { showMessage(error.message); } });
      panel.append(form);
    }
  } catch (error) { panel.textContent = error.message; }
}

function renderProjects() {
  const grid = $('#projects-grid'); grid.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement('div'); empty.className = 'group-empty';
    const icon = document.createElement('span'); icon.className = 'empty-check'; icon.textContent = '✦';
    const heading = document.createElement('h2'); heading.textContent = 'Your groups will live here';
    const text = document.createElement('p'); text.textContent = 'Start one group or join a classmate’s invitation to share deadlines and assignments.';
    empty.append(icon, heading, text); grid.append(empty); return;
  }
  projects.forEach((project) => {
    const card = document.createElement('button'); card.className = 'project-card';
    const icon = document.createElement('span'); icon.className = 'project-icon'; icon.textContent = project.name.trim().slice(0, 1).toUpperCase();
    const title = document.createElement('strong'); title.textContent = project.name;
    const description = document.createElement('p'); description.textContent = project.description || 'A shared space for your next big idea.';
    const foot = document.createElement('span'); foot.className = 'project-foot'; foot.textContent = `${project.member_count} members · ${project.task_count} assignments`;
    card.append(icon, title, description, foot); card.addEventListener('click', () => { location.hash = `#/groups/${project.id}`; }); grid.append(card);
  });
}

$('#new-project').addEventListener('click', () => { $('#project-form').reset(); $('#project-error').textContent = ''; $('#project-dialog').showModal(); });
$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { const project = await post('/api/projects', Object.fromEntries(new FormData(event.currentTarget))); $('#project-dialog').close(); await loadProjects(); location.hash = `#/groups/${project.id}`; }
  catch (error) { $('#project-error').textContent = error.message; }
});

$('#join-group-open').addEventListener('click', () => { $('#join-form').reset(); $('#join-error').textContent = ''; $('#join-dialog').showModal(); });
$('#join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = new FormData(event.currentTarget).get('code').trim().toUpperCase();
  try { const result = await post('/api/projects/join-requests', { code }); $('#join-dialog').close(); event.currentTarget.reset(); showMessage(result.status === 'already_member' ? 'You are already in this group.' : 'Request sent. You can open the group after its owner approves you.', 'success'); await loadNotifications(); }
  catch (error) { $('#join-error').textContent = error.message; }
});

async function loadJoinRequests(projectId) {
  const box=$('#group-join-requests'); box.replaceChildren();
  if(activeProject?.role!=='owner'){box.textContent='Only group owners can review access requests.';return;}
  try { const requests=await api(`/api/projects/${projectId}/join-requests`); if(!requests.length){box.textContent='No pending requests.';return;}
    requests.forEach((item)=>{const row=document.createElement('article');row.className='person-card';const info=document.createElement('span');info.className='person-copy';const name=document.createElement('strong');name.textContent=item.name;const handle=document.createElement('small');handle.textContent=`@${item.username} · ${formatTimestamp(item.created_at)}`;info.append(name,handle);row.append(info);['approve','reject','block'].forEach((action)=>{const b=document.createElement('button');b.className=action==='approve'?'primary-button':'secondary-button';b.textContent=action[0].toUpperCase()+action.slice(1);b.addEventListener('click',async()=>{try{await post(`/api/projects/${projectId}/join-requests/${item.id}/${action}`,{});await loadJoinRequests(projectId);await loadProjects();await loadNotifications();}catch(error){showMessage(error.message);}});row.append(b);});box.append(row);});
  } catch(error){box.textContent=error.message;}
}

$('#copy-join-code').addEventListener('click', async()=>{const code=$('#group-join-code').textContent;try{await navigator.clipboard.writeText(code);$('#copy-join-code').textContent='Copied';setTimeout(()=>$('#copy-join-code').textContent='Copy code',1400);}catch{const range=document.createRange();range.selectNodeContents($('#group-join-code'));getSelection().removeAllRanges();getSelection().addRange(range);}});
$('#rotate-join-code').addEventListener('click', async()=>{if(!activeProject||!confirm('Regenerate this code? The old code stops working immediately.'))return;try{const result=await post(`/api/projects/${activeProject.id}/join-code/rotate`,{});activeProject.join_code=result.code;$('#group-join-code').textContent=result.code;await loadProjects();}catch(error){showMessage(error.message);}});

async function renderProject(projectId) {
  activeProject = await api(`/api/projects/${projectId}`);
  const pane = $('#project-detail'); pane.hidden = false; pane.replaceChildren();
  const head = document.createElement('div'); head.className = 'project-detail-head';
  const back = document.createElement('a'); back.className = 'text-button back-link'; back.href = '#/groups'; back.textContent = '← All study groups';
  const top = document.createElement('div'); top.className = 'project-heading-row';
  const titlebox = document.createElement('div'); const title = document.createElement('h2'); title.textContent = activeProject.name; const description = document.createElement('p'); description.textContent = activeProject.description || 'A shared space for your next big idea.'; titlebox.append(title, description);
  const actions = document.createElement('div'); actions.className = 'page-actions';
  const addTask = document.createElement('button'); addTask.className = 'primary-button'; addTask.textContent = '＋ Assignment'; addTask.hidden = activeProject.role === 'viewer'; addTask.addEventListener('click', () => openNewTask(activeProject));
  const invite = document.createElement('button'); invite.className = 'secondary-button'; invite.textContent = 'Invite members'; invite.hidden = activeProject.role !== 'owner'; invite.addEventListener('click', async () => { $('#group-join-code').textContent = activeProject.join_code; await loadJoinRequests(activeProject.id); $('#invite-dialog').showModal(); });
  const openChat = document.createElement('a'); openChat.className = 'secondary-button'; openChat.href = `#/messages?group=${activeProject.id}`; openChat.textContent = 'Open group chat';
  actions.append(addTask, invite, openChat); top.append(titlebox, actions); head.append(back, top); pane.append(head);
  const layout = document.createElement('div'); layout.className = 'group-workspace-grid';
  const plan = document.createElement('section'); plan.className = 'group-plan';
  const taskHeading = document.createElement('div'); taskHeading.className = 'subsection-heading'; const taskTitle = document.createElement('h3'); taskTitle.textContent = 'Shared assignments'; taskHeading.append(taskTitle); plan.append(taskHeading);
  const groupBoard = document.createElement('div'); groupBoard.id = 'group-task-board'; plan.append(groupBoard);
  const sidebar = document.createElement('aside'); sidebar.className = 'group-sidebar';
  const memberPanel = document.createElement('section'); memberPanel.className = 'group-panel'; const memberTitle = document.createElement('h3'); memberTitle.textContent = `Your team · ${activeProject.members.length}`; memberPanel.append(memberTitle);
  activeProject.members.forEach((member) => { const row = document.createElement('div'); row.className = 'member-row'; const avatar = document.createElement('span'); avatar.className = 'avatar small-avatar'; setAvatar(avatar,member); const name = document.createElement('span'); name.className = 'member-name'; name.textContent = member.name + (member.id === user.id ? ' · You' : ''); const role = document.createElement('small'); role.textContent = member.role; row.append(avatar, name, role); if (member.id !== user.id) { const dm = document.createElement('button'); dm.className = 'text-button'; dm.textContent = 'Message'; dm.setAttribute('aria-label', `Message ${member.name}`); dm.addEventListener('click', () => openDirectConversation(member.id)); row.append(dm); } memberPanel.append(row); });
  const milestonePanel = document.createElement('section'); milestonePanel.className = 'group-panel milestones-panel'; const milestoneHead = document.createElement('div'); milestoneHead.className = 'subsection-heading'; const milestoneTitle = document.createElement('h3'); milestoneTitle.textContent = 'Milestones'; milestoneHead.append(milestoneTitle); const milestoneAdd = document.createElement('button'); milestoneAdd.className = 'text-button'; milestoneAdd.textContent = '＋ Add'; milestoneAdd.hidden = activeProject.role === 'viewer'; milestoneAdd.addEventListener('click', () => { $('#milestone-form').reset(); $('#milestone-error').textContent = ''; $('#milestone-dialog').showModal(); }); milestoneHead.append(milestoneAdd); milestonePanel.append(milestoneHead); const milestoneList = document.createElement('div'); milestoneList.id = 'milestone-list'; milestonePanel.append(milestoneList);
  sidebar.append(memberPanel, milestonePanel);
  layout.append(plan, sidebar); pane.append(layout);
  await Promise.all([loadProjectBoard(activeProject), loadMilestones(activeProject.id)]);
}

async function loadProjectBoard(project) {
  if (!project) return;
  const items = await loadTasks(project.id);
  const board = $('#group-task-board');
  if (board) renderBoard(board, items, project);
}

async function loadMilestones(projectId) {
  const milestones = await api(`/api/projects/${projectId}/milestones`);
  const list = $('#milestone-list'); if (!list) return;
  list.replaceChildren();
  if (!milestones.length) { const empty = document.createElement('p'); empty.className = 'subtle-empty'; empty.textContent = 'Add a checkpoint to keep your project on track.'; list.append(empty); return; }
  milestones.forEach((milestone) => { const row = document.createElement('div'); row.className = `milestone-row ${milestone.status}`; const toggle = document.createElement('button'); toggle.className = 'milestone-toggle'; toggle.textContent = milestone.status === 'done' ? '✓' : '○'; toggle.setAttribute('aria-label', `${milestone.status === 'done' ? 'Reopen' : 'Complete'} ${milestone.title}`); toggle.disabled = activeProject.role === 'viewer'; toggle.addEventListener('click', async () => { try { await patch(`/api/projects/${projectId}/milestones/${milestone.id}`, { status: milestone.status === 'done' ? 'open' : 'done' }); await loadMilestones(projectId); } catch (error) { showMessage(error.message); } }); const text = document.createElement('span'); text.textContent = milestone.title; const due = document.createElement('small'); due.textContent = formatDate(milestone.due_date); row.append(toggle, text, due); list.append(row); });
}

$('#milestone-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await post(`/api/projects/${activeProject.id}/milestones`, Object.fromEntries(new FormData(event.currentTarget))); $('#milestone-dialog').close(); await loadMilestones(activeProject.id); }
  catch (error) { $('#milestone-error').textContent = error.message; }
});

let lastGroupMessages = [];
async function loadGroupMessages() {
  if (!activeProject) return;
  const messages = await api(`/api/projects/${activeProject.id}/messages?after_id=${lastGroupMessageId}`);
  const stream = $('#chat-stream'); if (!stream) return;
  if (lastGroupMessageId === 0) {
    lastGroupMessages = messages;
    const latest = messages.slice(-60);
    stream.replaceChildren();
    if (!latest.length) { stream.textContent = 'Your group chat starts here. Share a question, a win, or what you’re working on.'; return; }
    latest.forEach((message) => appendChatMessage(stream, message, message.user_id === user.id));
    lastGroupMessageId = Math.max(...latest.map((message) => message.id));
    stream.scrollTop = stream.scrollHeight;
    return;
  }
  messages.forEach((message) => { appendChatMessage(stream, message, message.user_id === user.id); lastGroupMessageId = Math.max(lastGroupMessageId, message.id); });
  if (messages.length) stream.scrollTop = stream.scrollHeight;
}

function appendChatMessage(stream, message, mine) {
  const time=timestamp(message.created_at);const day=time?`${time.getFullYear()}-${time.getMonth()}-${time.getDate()}`:'unknown';const last=stream.querySelector('.message-row:last-of-type');
  if(last?.dataset.day!==day){const sep=document.createElement('div');sep.className='date-separator';sep.textContent=time?time.toLocaleDateString(undefined,{weekday:'short',month:'long',day:'numeric'}):'Earlier';stream.append(sep);}
  const article=document.createElement('article');article.className=`message-row ${mine?'mine':'incoming'} ${last&&last.dataset.sender===String(message.user_id||message.sender_id)&&last.dataset.day===day?'grouped':''} ${message.pinned_at?'is-pinned':''}`;article.dataset.messageId=message.id;article.dataset.sender=message.user_id||message.sender_id;article.dataset.day=day;
  const avatar=document.createElement('span');avatar.className='avatar message-avatar';setAvatar(avatar,mine?user:{name:message.name||message.sender_name,avatar:message.avatar});
  const box=document.createElement('div');box.className='message-content';const meta=document.createElement('div');meta.className='message-meta';meta.textContent=`${message.name||message.sender_name||'Classmate'} · ${time?time.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'Time unavailable'}${message.edited_at?' · edited':''}`;
  const bubble=document.createElement('p');bubble.className='message-bubble';bubble.textContent=message.deleted_at?'Message deleted':message.body||'';if(message.deleted_at)bubble.classList.add('deleted-message');box.append(meta,bubble);
  if((activeGroupChatId||activeConversation)&&!message.deleted_at){const details=document.createElement('details');details.className='message-menu';const summary=document.createElement('summary');summary.textContent='···';summary.setAttribute('aria-label','Message actions');const menu=document.createElement('div');menu.className='message-menu-items';const add=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',async()=>{details.open=false;await fn();});menu.append(b);};
    add('Copy message',async()=>{try{await navigator.clipboard.writeText(message.body);}catch{showMessage('Copy is unavailable in this browser.');}});
    if(mine)add('Edit message',async()=>{const next=prompt('Edit message',message.body);if(next===null)return;try{if(activeGroupChatId){await patch(`/api/projects/${activeGroupChatId}/messages/${message.id}`,{body:next.trim()});await refreshGroupThread();}else{await patch(`/api/direct/conversations/${activeConversation.id}/messages/${message.id}`,{body:next.trim()});lastDirectMessageId=0;await loadDirectMessages();}}catch(error){showMessage(error.message);}});
    if(mine)add('Delete message',async()=>{if(!confirm('Delete this message? It will remain as a deleted marker.'))return;try{if(activeGroupChatId){await api(`/api/projects/${activeGroupChatId}/messages/${message.id}`,{method:'DELETE'});await refreshGroupThread();}else{await api(`/api/direct/conversations/${activeConversation.id}/messages/${message.id}`,{method:'DELETE'});lastDirectMessageId=0;await loadDirectMessages();}}catch(error){showMessage(error.message);}});
    if(projects.find(p=>p.id===activeGroupChatId)?.role==='owner')add(message.pinned_at?'Unpin message':'Pin message',async()=>{try{await api(`/api/projects/${activeGroupChatId}/messages/${message.id}/pin`,{method:message.pinned_at?'DELETE':'POST'});await refreshGroupThread();}catch(error){showMessage(error.message);}});
    details.append(summary,menu);box.append(details);
  }
  if(message.pinned_at){const marker=document.createElement('span');marker.className='pinned-marker';marker.textContent='Pinned';box.append(marker);}
  if(!mine&&!article.classList.contains('grouped'))article.append(avatar);article.append(box);stream.append(article);
}

async function showPinnedMessages(projectId) {
  let dialog=$('#pinned-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='pinned-dialog';dialog.innerHTML='<section class="pinned-panel"><div class="dialog-head"><h2>Pinned messages</h2><button class="icon-button" aria-label="Close">×</button></div><div id="pinned-list" class="pinned-list"></div></section>';document.body.append(dialog);$('.icon-button',dialog).addEventListener('click',()=>dialog.close());}
  const box=$('#pinned-list');box.replaceChildren();const pins=await api(`/api/projects/${projectId}/pinned-messages`);if(!pins.length)box.textContent='No pinned messages yet.';
  pins.forEach(item=>{const row=document.createElement('article');row.className='pinned-item';const body=document.createElement('p');body.textContent=item.deleted_at?'Message deleted':item.body;const meta=document.createElement('small');meta.textContent=`${item.name} · ${formatTimestamp(item.created_at)}`;const jump=document.createElement('button');jump.className='text-button';jump.textContent='Jump to message';jump.addEventListener('click',async()=>{try{let target=$(`[data-message-id="${item.id}"]`);if(!target){const message=await api(`/api/projects/${projectId}/messages/${item.id}`);appendChatMessage($('#direct-stream'),message,message.user_id===user.id);target=$(`[data-message-id="${item.id}"]`);}target?.scrollIntoView({behavior:'smooth',block:'center'});}catch(error){showMessage(error.message);}});row.append(body,meta,jump);if(projects.find(p=>p.id===projectId)?.role==='owner'){const unpin=document.createElement('button');unpin.className='text-button';unpin.textContent='Unpin';unpin.addEventListener('click',async()=>{await api(`/api/projects/${projectId}/messages/${item.id}/pin`,{method:'DELETE'});await showPinnedMessages(projectId);});row.append(unpin);}box.append(row);});dialog.showModal();
}

$('#invite-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await post(`/api/projects/${activeProject.id}/invites`, Object.fromEntries(new FormData(event.currentTarget)));
    const linkUrl = `${location.origin}${location.pathname}?invite=${encodeURIComponent(result.token)}#/groups`;
    const box = $('#invite-result'); box.hidden = false; box.replaceChildren();
    const detail = document.createElement('p'); detail.textContent = `Private to ${result.email} · ${result.role} access · expires ${formatDate(result.expires_at)}`;
    const codeLabel = document.createElement('label'); codeLabel.className = 'field'; codeLabel.textContent = 'Invitation code'; const code = document.createElement('input'); code.readOnly = true; code.value = result.token; codeLabel.append(code);
    const linkLabel = document.createElement('label'); linkLabel.className = 'field'; linkLabel.textContent = 'Invitation link'; const link = document.createElement('input'); link.readOnly = true; link.value = linkUrl; linkLabel.append(link);
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'secondary-button'; copy.textContent = 'Copy link'; copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(linkUrl); copy.textContent = 'Copied'; } catch { link.select(); document.execCommand('copy'); copy.textContent = 'Copied'; } });
    const copyCode = document.createElement('button'); copyCode.type = 'button'; copyCode.className = 'secondary-button'; copyCode.textContent = 'Copy code'; copyCode.addEventListener('click', async () => { try { await navigator.clipboard.writeText(result.token); copyCode.textContent = 'Copied'; } catch { code.select(); document.execCommand('copy'); copyCode.textContent = 'Copied'; } });
    box.append(detail, codeLabel, copyCode, linkLabel, copy); $('#invite-error').textContent = ''; $('#invite-submit').hidden = true;
  } catch (error) { $('#invite-error').textContent = error.message; }
});

function renderCalendar() {
  const year = calendarCursor.getFullYear(); const month = calendarCursor.getMonth();
  $('#calendar-month').textContent = calendarCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const grid = $('#calendar-grid'); grid.replaceChildren();
  const first = new Date(year, month, 1); const offset = (first.getDay() + 6) % 7; const start = new Date(year, month, 1 - offset);
  for (let i = 0; i < 42; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const cell = document.createElement('div'); cell.className = `calendar-day ${date.getMonth() !== month ? 'outside' : ''} ${date.toDateString() === todayLocal().toDateString() ? 'today' : ''}`;
    const number = document.createElement('span'); number.className = 'day-number'; number.textContent = date.getDate(); cell.append(number);
    const matching = tasks.filter((task) => dateOnly(task.due_date)?.toDateString() === date.toDateString());
    const milestones = calendarMilestones.filter((milestone) => dateOnly(milestone.due_date)?.toDateString() === date.toDateString());
    const events = [...matching.map((task) => ({ kind: 'task', value: task })), ...milestones.map((milestone) => ({ kind: 'milestone', value: milestone }))];
    events.slice(0, 3).forEach(({ kind, value }) => {
      const event = document.createElement('button');
      event.className = kind === 'task' ? `calendar-event ${value.status}` : 'calendar-event milestone-event';
      event.textContent = kind === 'task' ? value.title : `◆ ${value.title}`;
      event.title = kind === 'task' ? `${value.title} · ${statusNames[value.status]}` : `${value.project_name} · milestone`;
      event.addEventListener('click', () => {
        if (kind === 'milestone' || value.project_id) location.hash = `#/groups/${value.project_id}`;
        else { location.hash = '#/dashboard'; setTimeout(() => openEditTask(value, null), 0); }
      });
      cell.append(event);
    });
    if (events.length > 3) { const more = document.createElement('small'); more.textContent = `+${events.length - 3} more`; cell.append(more); }
    grid.append(cell);
  }
}

$('#month-prev').addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1); renderCalendar(); });
$('#month-next').addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1); renderCalendar(); });

async function renderInbox() {
  await Promise.all([loadProjects(), loadConversations()]);
  groupThreads = await api('/api/group-conversations');
  renderConversations();
  const targetId = pendingConversationId;
  pendingConversationId = null;
  const groupId = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('group'));
  const saved = (() => { try { return JSON.parse(localStorage.getItem('studypilot-chat') || 'null'); } catch { return null; } })();
  if (groupId && projects.some((item) => item.id === groupId)) await openGroupConversation(groupId);
  else if (targetId && conversations.some((item) => item.id === targetId)) await openConversation(targetId);
  else if (saved?.kind === 'group' && projects.some((item) => item.id === saved.id)) await openGroupConversation(saved.id);
  else if (saved?.kind === 'direct' && conversations.some((item) => item.id === saved.id)) await openConversation(saved.id);
  else if (!activeConversation && !activeGroupChatId) $('#direct-thread').innerHTML = '<div class="thread-empty"><span class="empty-check">↗</span><h2>Choose a conversation</h2><p>Select a classmate or a study group on the left.</p></div>';
}

async function loadConversations() { conversations = await api('/api/direct/conversations'); updateUnreadCount(); }

function updateUnreadCount() {
  const unread = conversations.reduce((total, conversation) => total + conversation.unread_count, 0) + groupThreads.reduce((total, conversation) => total + conversation.unread_count, 0);
  const badge = $('#message-count'); badge.hidden = unread === 0; badge.textContent = unread > 99 ? '99+' : unread;
}

function renderConversations() {
  const list = $('#conversation-list'); list.replaceChildren();
  const search = ($('#conversation-search')?.value || '').trim().toLowerCase();
  const groupLabel = document.createElement('p'); groupLabel.className='eyebrow'; groupLabel.textContent='GROUPS'; list.append(groupLabel);
  const groups = groupThreads.filter((item) => !search || `${item.name} ${item.last_message || ''}`.toLowerCase().includes(search));
  groups.forEach((item) => { const button=document.createElement('button'); button.className=`conversation-item ${activeGroupChatId===item.project_id?'selected':''}`; const avatar=document.createElement('span'); avatar.className='avatar group-avatar'; avatar.textContent='✦'; const content=document.createElement('span'); content.className='conversation-content'; const name=document.createElement('strong'); name.textContent=item.name; const last=document.createElement('small'); last.textContent=item.last_message || 'No messages yet'; const activity=document.createElement('small'); activity.className='conversation-activity'; activity.textContent=formatTimestamp(item.last_message_at || item.created_at); content.append(name,last,activity); button.append(avatar,content); if(item.unread_count){const unread=document.createElement('span');unread.className='unread-pill';unread.textContent=item.unread_count;button.append(unread);} button.addEventListener('click',()=>openGroupConversation(item.project_id)); list.append(button); });
  const peopleLabel=document.createElement('p'); peopleLabel.className='eyebrow'; peopleLabel.textContent='DIRECT'; list.append(peopleLabel);
  conversations.filter((item) => !search || `${item.person_name} ${item.last_message || ''}`.toLowerCase().includes(search)).forEach((conversation) => { const button = document.createElement('button'); button.className = `conversation-item ${activeConversation?.id === conversation.id ? 'selected' : ''}`; const avatar = document.createElement('span'); avatar.className = 'avatar'; setAvatar(avatar,{name:conversation.person_name,avatar:conversation.person_avatar}); const content = document.createElement('span'); content.className = 'conversation-content'; const name = document.createElement('strong'); name.textContent = conversation.person_name; const last = document.createElement('small'); last.textContent = conversation.last_message || 'No messages yet'; const activity = document.createElement('small'); activity.className = 'conversation-activity'; activity.textContent = formatTimestamp(conversation.last_message_at || conversation.created_at); content.append(name, last, activity); button.append(avatar, content); if (conversation.unread_count) { const unread = document.createElement('span'); unread.className = 'unread-pill'; unread.textContent = conversation.unread_count; button.append(unread); } button.addEventListener('click', () => openConversation(conversation.id)); list.append(button); });
  if (!groups.length && !conversations.length) { const empty=document.createElement('p');empty.className='subtle-empty';empty.textContent='Your group and friend conversations will appear here.';list.append(empty); }
}

$('#conversation-search').addEventListener('input', renderConversations);

async function renderPeople() {
  const requests = await api('/api/friend-requests');
  const incoming = requests.filter((r) => r.direction === 'incoming' && r.status === 'pending');
  const outgoing = requests.filter((r) => r.direction === 'outgoing' && r.status === 'pending');
  const friends = requests.filter((r) => r.status === 'accepted');
  const blocked = requests.filter((r) => r.status === 'blocked');
  const paint = (selector, items, kind) => {
    const box = $(selector); box.replaceChildren();
    if (!items.length) { const empty=document.createElement('p');empty.className='subtle-empty';empty.textContent=kind==='incoming'?'No incoming requests.':kind==='outgoing'?'No pending requests.':kind==='friends'?'Friends you add will appear here.':kind==='blocked'?'No blocked classmates.':'Search by their unique username.';box.append(empty);return; }
    items.forEach((item) => { const row=document.createElement('article');row.className='person-card';const avatar=document.createElement('span');avatar.className='avatar';setAvatar(avatar,item);const info=document.createElement('span');info.className='person-copy';const name=document.createElement('strong');name.textContent=item.name;const handle=document.createElement('small');handle.textContent=`@${item.username}`;info.append(name,handle);row.append(avatar,info);
      const action=(label,fn,cls='secondary-button')=>{const button=document.createElement('button');button.className=cls;button.textContent=label;button.addEventListener('click',fn);row.append(button);};
      if(kind==='incoming'){action('Accept',async()=>{await post(`/api/friend-requests/${item.id}/accept`,{});await renderPeople();});action('Decline',async()=>{await post(`/api/friend-requests/${item.id}/decline`,{});await renderPeople();});action('Block',async()=>{if(confirm(`Block @${item.username}?`)){await post(`/api/friend-requests/${item.id}/block`,{});await renderPeople();}},'text-button');}
      if(kind==='outgoing')action('Cancel',async()=>{await api(`/api/friend-requests/${item.id}`,{method:'DELETE'});await renderPeople();});
      if(kind==='friends')action('Message',()=>openDirectConversation(item.direction==='outgoing'?item.recipient_id:item.requester_id),'primary-button');
      if(kind==='blocked'){const state=document.createElement('small');state.className='relationship-state';state.textContent='Blocked';row.append(state);}
      box.append(row);
    });
  };
  paint('#incoming-requests',incoming,'incoming');paint('#outgoing-requests',outgoing,'outgoing');paint('#friends-list',friends,'friends');paint('#blocked-list',blocked,'blocked');
}

$('#friend-search-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const username=new FormData(event.currentTarget).get('username').trim().replace(/^@/,'');const note=$('#friend-search-note');const results=$('#people-results');note.textContent='';results.replaceChildren();
  if(username.length<3){note.textContent='Enter at least 3 characters.';return;}
  try { const matches=await api(`/api/people/search?q=${encodeURIComponent(username)}`);const exact=matches.filter((p)=>p.username.toLowerCase()===username.toLowerCase());
    if(!exact.length){note.textContent='No classmate found. Check the username and try again.';return;}
    const person=exact[0];const row=document.createElement('article');row.className='person-card';const avatar=document.createElement('span');avatar.className='avatar';setAvatar(avatar,person);const info=document.createElement('span');info.className='person-copy';const name=document.createElement('strong');name.textContent=person.name;const handle=document.createElement('small');handle.textContent=`@${person.username} · ${person.relationship.replace('_',' ')}`;info.append(name,handle);row.append(avatar,info);const send=document.createElement('button');send.className='primary-button';send.textContent=['friends','group_classmate'].includes(person.relationship)?'Message':person.relationship==='request_sent'?'Request sent':person.relationship==='incoming_request'?'Accept request':'Add classmate';send.disabled=person.relationship==='request_sent';send.addEventListener('click',async()=>{try{let result;if(['friends','group_classmate'].includes(person.relationship)){await openDirectConversation(person.id);return;}if(person.relationship==='incoming_request'){const incoming=(await api('/api/friend-requests')).find(r=>r.direction==='incoming'&&r.status==='pending'&&r.username.toLowerCase()===person.username.toLowerCase());if(incoming)result=await post(`/api/friend-requests/${incoming.id}/accept`,{});}else result=await post('/api/friend-requests',{username:person.username});send.textContent=result?.status==='pending'?'Request sent':'Connected';send.disabled=true;await Promise.all([loadNotifications(),renderPeople()]);}catch(error){note.textContent=error.message;}});row.append(send);results.append(row);
  } catch(error){note.textContent=error.message;}
});

async function openGroupConversation(projectId) {
  const project = projects.find(item => item.id === projectId); if (!project) return;
  activeGroupChatId = projectId; activeConversation = null; localStorage.setItem('studypilot-chat', JSON.stringify({kind:'group',id:projectId})); stopPolling();
  const thread=$('#direct-thread');thread.replaceChildren();
  const header=document.createElement('div');header.className='thread-header';const title=document.createElement('h2');title.textContent=project.name;const controls=document.createElement('div');controls.className='thread-controls';const pinned=document.createElement('button');pinned.className='icon-button';pinned.textContent='▱';pinned.setAttribute('aria-label','Pinned messages');pinned.title='Pinned messages';pinned.addEventListener('click',()=>showPinnedMessages(projectId));const back=document.createElement('button');back.className='text-button mobile-back';back.textContent='← Conversations';back.addEventListener('click',()=>{$('.inbox').classList.remove('chat-open');});controls.append(pinned,back);header.append(title,controls);
  const stream=document.createElement('div');stream.id='direct-stream';stream.className='direct-stream';
  const form=document.createElement('form');form.className='chat-form direct-form';form.hidden=project.role==='viewer';const input=document.createElement('input');input.name='body';input.required=true;input.maxLength=2000;input.placeholder='Share an update…';input.setAttribute('aria-label','Group message');const send=document.createElement('button');send.className='primary-button';send.textContent='Send';form.append(input,send);
  form.addEventListener('submit',async(event)=>{event.preventDefault();try{await post(`/api/projects/${projectId}/messages`,{body:input.value});input.value='';await refreshGroupThread();await loadNotifications();}catch(error){showMessage(error.message);}});
  thread.append(header,stream,form);$('.inbox').classList.add('chat-open');await refreshGroupThread();
  pollTimer=setInterval(()=>{if(!document.hidden&&activeGroupChatId===projectId)refreshGroupThread().catch(()=>{});},5000);renderConversations();
}

async function refreshGroupThread() {
  if (!activeGroupChatId) return;
  const stream=$('#direct-stream');if(!stream)return;
  const nearBottom=stream.scrollHeight-stream.scrollTop-stream.clientHeight<80;const top=stream.scrollTop;
  const messages=await api(`/api/projects/${activeGroupChatId}/messages`);stream.replaceChildren();
  if(!messages.length){const empty=document.createElement('div');empty.className='thread-empty';empty.textContent='Start the conversation.';stream.append(empty);return;}
  messages.forEach(message=>appendChatMessage(stream,message,message.user_id===user.id));
  if(nearBottom)stream.scrollTop=stream.scrollHeight;else stream.scrollTop=top;
  lastGroupMessageId=Math.max(0,...messages.map(message=>message.id));
  groupThreads=await api('/api/group-conversations');updateUnreadCount();renderConversations();
}

async function openDirectConversation(personId) {
  try {
    const conversation = await post('/api/direct/conversations', { recipient_id: personId });
    pendingConversationId = conversation.id;
    if (routeFromHash().name !== 'messages') location.hash = '#/messages';
    else await renderRoute();
  } catch (error) { showMessage(error.message); }
}

async function openConversation(conversationId) {
  activeGroupChatId = null;
  activeConversation = conversations.find((item) => item.id === conversationId) || { id: conversationId };
  localStorage.setItem('studypilot-chat', JSON.stringify({kind:'direct',id:conversationId}));
  lastDirectMessageId = 0;
  const thread = $('#direct-thread'); thread.replaceChildren();
  const header = document.createElement('div'); header.className = 'thread-header'; const title = document.createElement('h2'); title.textContent = activeConversation.person_name || 'Private conversation'; const back=document.createElement('button');back.className='text-button mobile-back';back.textContent='← Conversations';back.addEventListener('click',()=>$('.inbox').classList.remove('chat-open'));header.append(title,back);
  const stream = document.createElement('div'); stream.id = 'direct-stream'; stream.className = 'direct-stream';
  const form = document.createElement('form'); form.className = 'chat-form direct-form'; const input = document.createElement('input'); input.name = 'body'; input.required = true; input.maxLength = 2000; input.placeholder = 'Write a message…'; input.setAttribute('aria-label', 'Private message'); const send = document.createElement('button'); send.className = 'primary-button'; send.textContent = 'Send'; form.append(input, send); form.addEventListener('submit', async (event) => { event.preventDefault(); try { await post(`/api/direct/conversations/${activeConversation.id}/messages`, { body: input.value }); input.value = ''; await loadDirectMessages(); await loadConversations(); renderConversations(); } catch (error) { showMessage(error.message); } });
  thread.append(header, stream, form);$('.inbox').classList.add('chat-open');
  try { await loadDirectMessages(); } catch (error) { showMessage(error.message); }
  stopPolling(); pollTimer = setInterval(() => { if (!document.hidden && activeConversation) { loadDirectMessages(true).then(loadConversations).then(renderConversations).catch(() => {}); } }, 4000);
  renderConversations();
}

async function loadDirectMessages(refreshAll = false) {
  if (!activeConversation) return;
  const stream = $('#direct-stream'); if (!stream) return;
  const nearBottom=stream.scrollHeight-stream.scrollTop-stream.clientHeight<80;const top=stream.scrollTop;
  const messages = await api(`/api/direct/conversations/${activeConversation.id}/messages${refreshAll?`?after_id=0`:`?after_id=${lastDirectMessageId}`}`);
  if ((lastDirectMessageId === 0 || refreshAll) && messages.length) stream.replaceChildren();
  if (refreshAll) lastDirectMessageId = 0;
  if (!messages.length && lastDirectMessageId === 0) stream.textContent = 'Say hello and get the conversation started.';
  messages.forEach((message) => { appendChatMessage(stream, message, message.sender_id === user.id); lastDirectMessageId = Math.max(lastDirectMessageId, message.id); });
  if (messages.length) { if(nearBottom)stream.scrollTop=stream.scrollHeight;else stream.scrollTop=top; }
}

$('#notification-button').addEventListener('click', async () => {
  try { await loadNotifications(); $('#notifications-dialog').showModal(); await api('/api/notifications/read', { method: 'POST' }); $('#notification-dot').hidden = true; }
  catch (error) { showMessage(error.message); }
});

async function loadNotifications() {
  const records = await api('/api/notifications');
  $('#notification-dot').hidden = !records.some((item) => !item.read_at);
  const panel = $('#notifications-list'); panel.replaceChildren();
  if (!records.length) { panel.textContent = 'You’re all caught up. New group updates will appear here.'; return; }
  records.forEach((record) => { const item = document.createElement('div'); item.className = `notification-item ${record.read_at ? '' : 'unread'}`; const text = document.createElement('p'); text.textContent = `${record.actor || 'A teammate'} ${record.detail}`; const time = document.createElement('small'); time.textContent = formatTimestamp(record.created_at); item.append(text, time); panel.append(item); });
}

$('#account-button').addEventListener('click', () => { $('#account-menu').hidden = !$('#account-menu').hidden; });
document.addEventListener('click', (event) => { if (!event.target.closest('.account-area')) $('#account-menu').hidden = true; });
$('#profile-open').addEventListener('click', () => { $('#account-menu').hidden = true; $('#profile-form').reset(); $('#profile-form').elements.name.value = user.name; $('#profile-form').elements.username.value = user.username; $('#profile-form').elements.bio.value=user.bio||'';$('#profile-form').elements.avatar.value=user.avatar||'violet';$('#profile-form').elements.theme.value=user.theme||'light'; $('#profile-email').value = user.email; $('#profile-error').textContent = ''; $('#profile-saved').textContent = ''; $('#profile-dialog').showModal(); });
$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); $('#profile-error').textContent = ''; $('#profile-saved').textContent = '';
  try { user = await patch('/api/profile', { name: data.name, username: data.username, bio:data.bio, avatar:data.avatar, theme:data.theme }); if (data.new_password) await api('/api/profile/password', { method: 'POST', body: JSON.stringify({ current_password: data.current_password, new_password: data.new_password }) }); $('#account-name').textContent = user.name; setAvatar($('#avatar'),user);setTheme(user.theme); $('#profile-saved').textContent = 'Your settings are saved.'; }
  catch (error) { $('#profile-error').textContent = error.message; }
});

$('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { stopPolling(); user = null; location.hash = '#/dashboard'; $('#app-screen').hidden = true; $('#auth-screen').hidden = false; authMode(false); } });
$$('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));

function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

boot();
