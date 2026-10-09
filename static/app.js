const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const appMessage = $('#app-message');
const taskForm = $('#task-form');
let user = null;
let tasks = [];
let projects = [];
let people = [];
let conversations = [];
let calendarMilestones = [];
let activeProject = null;
let activeConversation = null;
let pendingConversationId = null;
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let pollTimer = null;
let lastGroupMessageId = 0;
let lastDirectMessageId = 0;

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

$('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
setTheme(localStorage.getItem('studypilot-theme') === 'dark' ? 'dark' : 'light');

function authMode(register) {
  const form = $('#auth-form');
  form.dataset.register = String(register);
  $('#name-field').hidden = !register;
  $('[name="name"]', form).required = register;
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
    user = await post(registering ? '/api/auth/register' : '/api/auth/login', Object.fromEntries(new FormData(event.currentTarget)));
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
  $('#avatar').textContent = user.name.trim().slice(0, 1).toUpperCase();
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
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'dashboard', id: parts[0] === 'groups' && parts[1] ? Number(parts[1]) : null };
}

async function renderRoute() {
  const route = routeFromHash();
  const known = ['dashboard', 'groups', 'calendar', 'messages'];
  if (!known.includes(route.name)) { location.hash = '#/dashboard'; return; }
  $$('.view').forEach((view) => { view.hidden = true; view.classList.remove('active-view'); });
  $(`#view-${route.name}`).hidden = false;
  $(`#view-${route.name}`).classList.add('active-view');
  $$('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.route === route.name));
  activeProject = null;
  activeConversation = null;
  stopPolling();
  showMessage('');
  try {
    if (route.name === 'dashboard') await loadTasks().then(renderDashboard);
    if (route.name === 'groups') {
      await loadProjects();
      if (route.id) await renderProject(route.id);
      else $('#project-detail').hidden = true;
    }
    if (route.name === 'calendar') {
      await Promise.all([loadTasks(), loadProjects()]);
      await loadCalendarMilestones();
      renderCalendar();
    }
    if (route.name === 'messages') await renderInbox();
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
  const select = $('#new-message-person');
  const selected = select.value;
  select.replaceChildren(new Option('Choose a classmate', ''), ...people.map((person) => new Option(person.name, person.id)));
  select.value = people.some((person) => String(person.id) === selected) ? selected : '';
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
  const pending = tasks.filter((task) => task.status !== 'done').sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  $('#up-next').textContent = pending.length ? formatDate(pending[0].due_date) : 'All clear';
  $('#in-progress').textContent = tasks.filter((task) => task.status === 'in_progress').length;
  $('#completed').textContent = tasks.filter((task) => task.status === 'done').length;
  $('#overdue').textContent = tasks.filter(isOverdue).length;
  const courses = [...new Set(tasks.map((task) => task.course).filter(Boolean))].sort();
  const filter = $('#course-filter');
  const chosen = filter.value;
  filter.replaceChildren(new Option('All courses', ''), ...courses.map((course) => new Option(course, course)));
  filter.value = courses.includes(chosen) ? chosen : '';
  updateDashboardBoard();
  if (pending.length && dateOnly(pending[0].due_date) < today) $('#up-next').classList.add('overdue-text');
  else $('#up-next').classList.remove('overdue-text');
}

function filterTasks(items) {
  const query = $('#task-search').value.trim().toLocaleLowerCase();
  const course = $('#course-filter').value;
  return items.filter((task) => (!course || task.course === course) && (!query || `${task.title} ${task.course} ${task.project_name || ''}`.toLocaleLowerCase().includes(query)));
}

function updateDashboardBoard() {
  const filtered = filterTasks(tasks);
  const hasMatches = filtered.length > 0;
  renderBoard($('#task-board'), filtered, null);
  $('#task-board').hidden = !hasMatches;
  $('#task-empty').hidden = hasMatches;
  const searching = $('#task-search').value.trim() || $('#course-filter').value;
  $('#task-empty h3').textContent = tasks.length && searching ? 'No matching assignments' : 'No assignments here yet';
  $('#task-empty p').textContent = tasks.length && searching ? 'Try a different search or course filter.' : 'Add an assignment to get started.';
  $('#empty-add').textContent = tasks.length && searching ? 'Clear search and filters' : '＋ Add assignment';
}

$('#task-search').addEventListener('input', updateDashboardBoard);
$('#course-filter').addEventListener('change', updateDashboardBoard);
$('#new-task').addEventListener('click', () => openNewTask(null));
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
  actions.append(status, move, comment);
  card.append(titleLine, context, deadline, assignees, actions);
  return card;
}

function makeTag(text, className) { const tag = document.createElement('span'); tag.className = className; tag.textContent = text; return tag; }

async function changeTaskStatus(task, status, project) {
  try {
    await patch(`/api/tasks/${task.id}`, { status });
    showMessage('');
    await loadTasks(project?.id || null);
    if (project) await loadProjectBoard(project);
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
    else renderDashboard();
  } catch (error) { $('#form-error').textContent = error.message; }
});

$('#delete-task').addEventListener('click', async () => {
  const id = $('#task-id').value;
  if (!id) return;
  $('#form-error').textContent = '';
  try {
    await api(`/api/tasks/${id}`, { method: 'DELETE' });
    $('#task-dialog').close();
    const projectId = taskForm.dataset.projectId;
    await loadTasks(projectId || null);
    if (projectId) await loadProjectBoard(activeProject); else renderDashboard();
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
  const token = new FormData(event.currentTarget).get('token').trim();
  try { const project = await post('/api/invitations/accept', { token }); $('#join-dialog').close(); await loadProjects(); location.hash = `#/groups/${project.id}`; }
  catch (error) { $('#join-error').textContent = error.message; }
});

async function renderProject(projectId) {
  activeProject = await api(`/api/projects/${projectId}`);
  const pane = $('#project-detail'); pane.hidden = false; pane.replaceChildren();
  const head = document.createElement('div'); head.className = 'project-detail-head';
  const back = document.createElement('a'); back.className = 'text-button back-link'; back.href = '#/groups'; back.textContent = '← All study groups';
  const top = document.createElement('div'); top.className = 'project-heading-row';
  const titlebox = document.createElement('div'); const title = document.createElement('h2'); title.textContent = activeProject.name; const description = document.createElement('p'); description.textContent = activeProject.description || 'A shared space for your next big idea.'; titlebox.append(title, description);
  const actions = document.createElement('div'); actions.className = 'page-actions';
  const addTask = document.createElement('button'); addTask.className = 'primary-button'; addTask.textContent = '＋ Assignment'; addTask.hidden = activeProject.role === 'viewer'; addTask.addEventListener('click', () => openNewTask(activeProject));
  const invite = document.createElement('button'); invite.className = 'secondary-button'; invite.textContent = 'Invite classmate'; invite.hidden = activeProject.role !== 'owner'; invite.addEventListener('click', () => { $('#invite-form').reset(); $('#invite-error').textContent = ''; $('#invite-result').hidden = true; $('#invite-submit').hidden = false; $('#invite-dialog').showModal(); });
  actions.append(addTask, invite); top.append(titlebox, actions); head.append(back, top); pane.append(head);
  const layout = document.createElement('div'); layout.className = 'group-workspace-grid';
  const plan = document.createElement('section'); plan.className = 'group-plan';
  const taskHeading = document.createElement('div'); taskHeading.className = 'subsection-heading'; const taskTitle = document.createElement('h3'); taskTitle.textContent = 'Shared assignments'; taskHeading.append(taskTitle); plan.append(taskHeading);
  const groupBoard = document.createElement('div'); groupBoard.id = 'group-task-board'; plan.append(groupBoard);
  const sidebar = document.createElement('aside'); sidebar.className = 'group-sidebar';
  const memberPanel = document.createElement('section'); memberPanel.className = 'group-panel'; const memberTitle = document.createElement('h3'); memberTitle.textContent = `Your team · ${activeProject.members.length}`; memberPanel.append(memberTitle);
  activeProject.members.forEach((member) => { const row = document.createElement('div'); row.className = 'member-row'; const avatar = document.createElement('span'); avatar.className = 'avatar small-avatar'; avatar.textContent = member.name.slice(0, 1).toUpperCase(); const name = document.createElement('span'); name.className = 'member-name'; name.textContent = member.name + (member.id === user.id ? ' · You' : ''); const role = document.createElement('small'); role.textContent = member.role; row.append(avatar, name, role); if (member.id !== user.id) { const dm = document.createElement('button'); dm.className = 'text-button'; dm.textContent = 'Message'; dm.setAttribute('aria-label', `Message ${member.name}`); dm.addEventListener('click', () => openDirectConversation(member.id)); row.append(dm); } memberPanel.append(row); });
  const milestonePanel = document.createElement('section'); milestonePanel.className = 'group-panel milestones-panel'; const milestoneHead = document.createElement('div'); milestoneHead.className = 'subsection-heading'; const milestoneTitle = document.createElement('h3'); milestoneTitle.textContent = 'Milestones'; milestoneHead.append(milestoneTitle); const milestoneAdd = document.createElement('button'); milestoneAdd.className = 'text-button'; milestoneAdd.textContent = '＋ Add'; milestoneAdd.hidden = activeProject.role === 'viewer'; milestoneAdd.addEventListener('click', () => { $('#milestone-form').reset(); $('#milestone-error').textContent = ''; $('#milestone-dialog').showModal(); }); milestoneHead.append(milestoneAdd); milestonePanel.append(milestoneHead); const milestoneList = document.createElement('div'); milestoneList.id = 'milestone-list'; milestonePanel.append(milestoneList);
  sidebar.append(memberPanel, milestonePanel);
  const chatPanel = document.createElement('section'); chatPanel.className = 'group-panel project-chat';
  const chatHead = document.createElement('div'); chatHead.className = 'subsection-heading'; const chatTitle = document.createElement('h3'); chatTitle.textContent = 'Group chat'; const live = document.createElement('span'); live.className = 'live-label'; live.textContent = '● Live updates'; chatHead.append(chatTitle, live);
  const chatStream = document.createElement('div'); chatStream.id = 'chat-stream'; chatStream.className = 'chat-stream';
  const chatForm = document.createElement('form'); chatForm.className = 'chat-form'; chatForm.hidden = activeProject.role === 'viewer'; const chatInput = document.createElement('input'); chatInput.name = 'body'; chatInput.maxLength = 2000; chatInput.required = true; chatInput.placeholder = 'Share an update…'; chatInput.setAttribute('aria-label', 'Group message'); const chatSend = document.createElement('button'); chatSend.className = 'primary-button'; chatSend.textContent = 'Send'; chatForm.append(chatInput, chatSend); chatForm.addEventListener('submit', async (event) => { event.preventDefault(); try { await post(`/api/projects/${activeProject.id}/messages`, { body: chatInput.value }); chatInput.value = ''; await loadGroupMessages(); await loadNotifications(); } catch (error) { showMessage(error.message); } });
  chatPanel.append(chatHead, chatStream, chatForm); layout.append(plan, sidebar, chatPanel); pane.append(layout);
  await Promise.all([loadProjectBoard(activeProject), loadMilestones(activeProject.id), loadGroupMessages()]);
  pollTimer = setInterval(() => { if (!document.hidden && activeProject) { loadGroupMessages().catch(() => {}); loadNotifications().catch(() => {}); } }, 4000);
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
  if (stream.textContent.startsWith('Your group chat starts')) stream.replaceChildren();
  const article = document.createElement('article'); article.className = `chat-message ${mine ? 'mine' : ''}`;
  const byline = document.createElement('div'); byline.className = 'message-byline'; byline.textContent = `${message.name || message.sender_name || 'Classmate'} · ${formatTimestamp(message.created_at)}`;
  const body = document.createElement('p'); body.textContent = message.body; article.append(byline, body); stream.append(article);
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
    box.append(detail, codeLabel, linkLabel, copy); $('#invite-error').textContent = ''; $('#invite-submit').hidden = true;
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
  await Promise.all([loadPeople(), loadConversations()]);
  renderConversations();
  const targetId = pendingConversationId;
  pendingConversationId = null;
  if (targetId && conversations.some((item) => item.id === targetId)) await openConversation(targetId);
  if (!activeConversation) $('#direct-thread').innerHTML = '<div class="thread-empty"><span class="empty-check">↗</span><h2>Choose a conversation</h2><p>Select a classmate on the left or start a new one above.</p></div>';
}

async function loadConversations() { conversations = await api('/api/direct/conversations'); updateUnreadCount(); }

function updateUnreadCount() {
  const unread = conversations.reduce((total, conversation) => total + conversation.unread_count, 0);
  const badge = $('#message-count'); badge.hidden = unread === 0; badge.textContent = unread > 99 ? '99+' : unread;
}

function renderConversations() {
  const list = $('#conversation-list'); list.replaceChildren();
  if (!conversations.length) { const empty = document.createElement('p'); empty.className = 'subtle-empty'; empty.textContent = 'No conversations yet. Choose a classmate above to start one.'; list.append(empty); return; }
  conversations.forEach((conversation) => { const button = document.createElement('button'); button.className = `conversation-item ${activeConversation?.id === conversation.id ? 'selected' : ''}`; const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = conversation.person_name.slice(0, 1).toUpperCase(); const content = document.createElement('span'); content.className = 'conversation-content'; const name = document.createElement('strong'); name.textContent = conversation.person_name; const last = document.createElement('small'); last.textContent = conversation.last_message || 'Start your conversation'; content.append(name, last); button.append(avatar, content); if (conversation.unread_count) { const unread = document.createElement('span'); unread.className = 'unread-pill'; unread.textContent = conversation.unread_count; button.append(unread); } button.addEventListener('click', () => openConversation(conversation.id)); list.append(button); });
}

$('#new-message-person').addEventListener('change', async (event) => { if (!event.target.value) return; await openDirectConversation(Number(event.target.value)); event.target.value = ''; });

async function openDirectConversation(personId) {
  try {
    const conversation = await post('/api/direct/conversations', { recipient_id: personId });
    pendingConversationId = conversation.id;
    if (routeFromHash().name !== 'messages') location.hash = '#/messages';
    else await renderRoute();
  } catch (error) { showMessage(error.message); }
}

async function openConversation(conversationId) {
  activeConversation = conversations.find((item) => item.id === conversationId) || { id: conversationId };
  lastDirectMessageId = 0;
  const thread = $('#direct-thread'); thread.replaceChildren();
  const header = document.createElement('div'); header.className = 'thread-header'; const title = document.createElement('h2'); title.textContent = activeConversation.person_name || 'Private conversation'; const privacy = document.createElement('span'); privacy.textContent = 'Private · only you two can read this'; header.append(title, privacy);
  const stream = document.createElement('div'); stream.id = 'direct-stream'; stream.className = 'direct-stream';
  const form = document.createElement('form'); form.className = 'chat-form direct-form'; const input = document.createElement('input'); input.name = 'body'; input.required = true; input.maxLength = 2000; input.placeholder = 'Write a message…'; input.setAttribute('aria-label', 'Private message'); const send = document.createElement('button'); send.className = 'primary-button'; send.textContent = 'Send'; form.append(input, send); form.addEventListener('submit', async (event) => { event.preventDefault(); try { await post(`/api/direct/conversations/${activeConversation.id}/messages`, { body: input.value }); input.value = ''; await loadDirectMessages(); await loadConversations(); renderConversations(); } catch (error) { showMessage(error.message); } });
  thread.append(header, stream, form);
  try { await loadDirectMessages(); } catch (error) { showMessage(error.message); }
  stopPolling(); pollTimer = setInterval(() => { if (!document.hidden && activeConversation) { loadDirectMessages().then(loadConversations).then(renderConversations).catch(() => {}); } }, 4000);
  renderConversations();
}

async function loadDirectMessages() {
  if (!activeConversation) return;
  const stream = $('#direct-stream'); if (!stream) return;
  const messages = await api(`/api/direct/conversations/${activeConversation.id}/messages?after_id=${lastDirectMessageId}`);
  if (lastDirectMessageId === 0 && messages.length) stream.replaceChildren();
  if (!messages.length && lastDirectMessageId === 0) stream.textContent = 'Say hello and get the conversation started.';
  messages.forEach((message) => { appendChatMessage(stream, message, message.sender_id === user.id); lastDirectMessageId = Math.max(lastDirectMessageId, message.id); });
  if (messages.length) stream.scrollTop = stream.scrollHeight;
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
$('#profile-open').addEventListener('click', () => { $('#account-menu').hidden = true; $('#profile-form').reset(); $('#profile-form').elements.name.value = user.name; $('#profile-email').value = user.email; $('#profile-error').textContent = ''; $('#profile-saved').textContent = ''; $('#profile-dialog').showModal(); });
$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); $('#profile-error').textContent = ''; $('#profile-saved').textContent = '';
  try { user = await patch('/api/profile', { name: data.name }); if (data.new_password) await api('/api/profile/password', { method: 'POST', body: JSON.stringify({ current_password: data.current_password, new_password: data.new_password }) }); $('#account-name').textContent = user.name; $('#avatar').textContent = user.name.slice(0, 1).toUpperCase(); $('#profile-saved').textContent = 'Your settings are saved.'; }
  catch (error) { $('#profile-error').textContent = error.message; }
});

$('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { stopPolling(); user = null; location.hash = '#/dashboard'; $('#app-screen').hidden = true; $('#auth-screen').hidden = false; authMode(false); } });
$$('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));

function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

boot();
