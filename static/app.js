const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const list = $('#task-list');
const dialog = $('#task-dialog');
const form = $('#task-form');
let user = null, tasks = [], projects = [], activeStatus = 'all', activeProject = null, chatTimer = null;
const api = async (url, options = {}) => {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (response.status === 401) { showAuth(); throw new Error('Please sign in to continue.'); }
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail || 'Something went wrong. Please try again.'); }
  return response.status === 204 ? null : response.json();
};
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });
const patch = (url, body) => api(url, { method: 'PATCH', body: JSON.stringify(body) });
const prettyDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const isOverdue = (task) => task.status !== 'done' && new Date(`${task.due_date}T00:00:00`) < new Date(new Date().toDateString());
const escapeText = (value) => String(value ?? '');
function showAuth() { $('#app-screen').hidden = true; $('#auth-screen').hidden = false; }
function showApp() { $('#auth-screen').hidden = true; $('#app-screen').hidden = false; }
function setAuthMode(register) {
  $('#auth-form').dataset.register = String(register);
  $('#name-field').hidden = !register;
  $('[name="name"]', $('#auth-form')).required = register;
  $('#auth-title').textContent = register ? 'Start your account.' : 'Welcome back.';
  $('#auth-submit').innerHTML = register ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
  $('#auth-switch').textContent = register ? 'Already have an account? Sign in' : 'New to StudyPilot? Create an account';
  const password = $('[name="password"]', $('#auth-form'));
  password.autocomplete = register ? 'new-password' : 'current-password';
  password.minLength = register ? 10 : 1;
}
$('#auth-switch').addEventListener('click', () => setAuthMode($('#auth-form').dataset.register !== 'true'));
$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const registering = event.currentTarget.dataset.register === 'true';
  $('#auth-error').textContent = '';
  try {
    user = await post(registering ? '/api/auth/register' : '/api/auth/login', data);
    await startApp();
    const inviteToken = new URLSearchParams(location.search).get('invite');
    if (inviteToken) { const joined = await post(`/api/invitations/${encodeURIComponent(inviteToken)}/accept`, {}); history.replaceState(null, '', '/'); await loadProjects(); openProject(joined.id); }
  } catch (error) { $('#auth-error').textContent = error.message; }
});
async function startApp() { showApp(); $('#account-name').textContent = user.name; $('#avatar').textContent = user.name.trim().slice(0, 1).toUpperCase(); await Promise.all([loadProjects(), loadTasks(), loadActivity(), loadNotifications()]); }
async function boot() {
  setAuthMode(false);
  try { user = await api('/api/auth/me'); await startApp(); }
  catch { showAuth(); const token = new URLSearchParams(location.search).get('invite'); if (token) { $('#auth-error').textContent = 'Sign in or create an account using the email address on the invitation.'; setAuthMode(false); } }
}
function visibleTasks() {
  const course = $('#course-filter').value;
  return tasks.filter((task) => (activeStatus === 'all' || task.status === activeStatus) && (!course || task.course === course));
}
function renderTasks() {
  const shown = visibleTasks();
  $('#count-all').textContent = tasks.length; $('#in-progress').textContent = tasks.filter((task) => task.status === 'in_progress').length; $('#completed').textContent = tasks.filter((task) => task.status === 'done').length;
  const next = tasks.filter((task) => task.status !== 'done').sort((a, b) => a.due_date.localeCompare(b.due_date))[0]; $('#up-next').textContent = next ? prettyDate(next.due_date) : 'All clear';
  $('#assignment-heading').textContent = activeProject ? activeProject.name : 'Assignments';
  $('#assignment-subtitle').textContent = activeProject ? 'Shared work, moving forward together.' : 'Your personal plan, all in one place.';
  list.replaceChildren(); $('#empty-state').classList.toggle('show', shown.length === 0);
  $('#empty-state h3').textContent = activeProject ? 'Start with one small step' : 'A fresh page';
  $('#empty-state p').textContent = activeProject ? 'Add the first assignment for your group.' : 'Add your next assignment and we’ll help you keep it in view.';
  if (activeProject?.role === 'viewer') { $('#new-task').hidden = true; $('#empty-add').hidden = true; } else { $('#new-task').hidden = false; $('#empty-add').hidden = false; }
  if (!shown.length) return;
  for (const task of shown) {
    const card = document.createElement('article'); card.className = 'task-card';
    const top = document.createElement('div'); top.className = 'task-card-top';
    const check = document.createElement('button'); check.className = `check-button ${task.status === 'done' ? 'checked' : ''}`; check.setAttribute('aria-label', task.status === 'done' ? 'Mark as not done' : 'Mark as done'); check.textContent = task.status === 'done' ? '✓' : ''; check.addEventListener('click', () => updateTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' }));
    const titleWrap = document.createElement('div'); titleWrap.className = 'task-main'; const title = document.createElement('button'); title.className = `task-title ${task.status === 'done' ? 'is-done' : ''}`; title.textContent = task.title; title.addEventListener('click', () => openEdit(task)); titleWrap.append(title);
    const badges = document.createElement('div'); badges.className = 'task-badges'; const priority = document.createElement('span'); priority.className = `priority-pill priority-${task.priority}`; priority.textContent = `${task.priority} priority`; const status = document.createElement('span'); status.className = `status-pill ${task.status}`; status.textContent = task.status.replace('_', ' '); badges.append(priority, status); top.append(check, titleWrap, badges);
    const meta = document.createElement('div'); meta.className = 'task-meta'; if (task.course) { const course = document.createElement('span'); course.className = 'task-course'; course.textContent = task.course; meta.append(course); }
    const due = document.createElement('span'); due.className = `date-pill ${isOverdue(task) ? 'overdue' : ''}`; due.textContent = `${isOverdue(task) ? 'Overdue · ' : 'Due · '}${prettyDate(task.due_date)}`; meta.append(due);
    const people = document.createElement('span'); people.className = 'assignee-list'; people.textContent = task.assignees?.map((person) => person.name).join(', ') || (task.project_id ? 'Group assignment' : 'Just you'); meta.append(people);
    const actions = document.createElement('div'); actions.className = 'task-actions'; const discuss = document.createElement('button'); discuss.className = 'text-button'; discuss.textContent = 'Comments'; discuss.addEventListener('click', () => toggleComments(card, task)); const edit = document.createElement('button'); edit.className = 'row-menu'; edit.textContent = '···'; edit.setAttribute('aria-label', `Edit ${task.title}`); edit.addEventListener('click', () => openEdit(task)); actions.append(discuss, edit);
    card.append(top, meta, actions); list.append(card);
  }
}
async function loadTasks() {
  const url = activeProject ? `/api/tasks?project_id=${activeProject.id}` : '/api/tasks';
  tasks = await api(url); const courses = [...new Set(tasks.map((task) => task.course).filter(Boolean))].sort(); const select = $('#course-filter'); const selected = select.value;
  select.replaceChildren(new Option('All courses', ''), ...courses.map((course) => new Option(course, course))); select.value = courses.includes(selected) ? selected : ''; renderTasks();
}
async function updateTask(id, changes) { try { await patch(`/api/tasks/${id}`, changes); await loadTasks(); } catch (error) { alert(error.message); } }
function openNew() {
  form.reset(); $('#task-id').value = ''; $('#dialog-title').textContent = 'New assignment'; $('#status-wrap').hidden = true; $('#delete-task').hidden = true; $('#form-error').textContent = '';
  $('#assignee-wrap').hidden = !activeProject; $('#assignees').replaceChildren();
  if (activeProject) activeProject.members.forEach((member) => { const option = new Option(member.name, member.id, false, member.id === user.id); if (member.id === user.id) option.disabled = true; $('#assignees').add(option); });
  const today = new Date(); $('#due-date').value = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10); dialog.showModal(); $('#title').focus();
}
function openEdit(task) {
  form.reset(); $('#task-id').value = task.id; $('#dialog-title').textContent = 'Edit assignment'; $('#status-wrap').hidden = false; $('#delete-task').hidden = false; $('#assignee-wrap').hidden = !activeProject; $('#form-error').textContent = '';
  for (const key of ['title', 'course', 'due_date', 'priority', 'status', 'description']) $(`#${key.replace('_', '-')}`).value = task[key] ?? '';
  $('#assignees').replaceChildren(); if (activeProject) activeProject.members.forEach((member) => { const option = new Option(member.name, member.id, false, task.assignees?.some((item) => item.id === member.id)); if (member.id === user.id) option.disabled = true; $('#assignees').add(option); });
  dialog.showModal();
}
form.addEventListener('submit', async (event) => {
  event.preventDefault(); const id = $('#task-id').value; const payload = Object.fromEntries(new FormData(form).entries()); delete payload.status;
  if (id) payload.status = $('#status').value; if (activeProject) { if (!id) payload.project_id = activeProject.id; payload.assignee_ids = $$('#assignees option:checked').map((option) => Number(option.value)); }
  $('#form-error').textContent = '';
  try { await api(id ? `/api/tasks/${id}` : '/api/tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); dialog.close(); await loadTasks(); await loadActivity(); }
  catch (error) { $('#form-error').textContent = error.message; }
});
$('#new-task').addEventListener('click', openNew); $('#empty-add').addEventListener('click', openNew);
$('#delete-task').addEventListener('click', async () => { const id = $('#task-id').value; if (!id || !confirm('Delete this assignment? This cannot be undone.')) return; try { await api(`/api/tasks/${id}`, { method: 'DELETE' }); dialog.close(); await loadTasks(); } catch (error) { $('#form-error').textContent = error.message; } });
$('#course-filter').addEventListener('change', renderTasks);
$$('.filter').forEach((button) => button.addEventListener('click', () => { $('.filter.active').classList.remove('active'); button.classList.add('active'); activeStatus = button.dataset.filter; renderTasks(); }));
$$('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
async function toggleComments(card, task) {
  let panel = $('.comments-panel', card); if (panel) { panel.remove(); return; }
  panel = document.createElement('section'); panel.className = 'comments-panel'; panel.innerHTML = '<p class="comment-loading">Loading conversation…</p>'; card.append(panel);
  try { const comments = await api(`/api/tasks/${task.id}/comments`); panel.replaceChildren(); const heading = document.createElement('h4'); heading.textContent = 'Assignment comments'; panel.append(heading); const stream = document.createElement('div'); stream.className = 'comment-stream';
    comments.forEach((comment) => { const item = document.createElement('p'); item.className = 'comment-item'; const name = document.createElement('strong'); name.textContent = comment.name; const text = document.createElement('span'); text.textContent = comment.body; item.append(name, text); stream.append(item); }); if (!comments.length) stream.textContent = 'No comments yet. Be the first to share a thought.'; panel.append(stream);
    const commentForm = document.createElement('form'); commentForm.className = 'comment-form'; const input = document.createElement('input'); input.name = 'body'; input.maxLength = 2000; input.placeholder = 'Add a helpful note…'; input.required = true; const send = document.createElement('button'); send.className = 'secondary-button'; send.textContent = 'Send'; commentForm.append(input, send); commentForm.addEventListener('submit', async (event) => { event.preventDefault(); try { await post(`/api/tasks/${task.id}/comments`, { body: input.value }); toggleComments(card, task); setTimeout(() => toggleComments(card, task), 30); await loadActivity(); } catch (error) { alert(error.message); } }); panel.append(commentForm);
  } catch (error) { panel.textContent = error.message; }
}
async function loadProjects() {
  projects = await api('/api/projects'); $('#project-count').textContent = projects.length; renderProjects();
}
function renderProjects() {
  const grid = $('#projects-grid'); grid.replaceChildren();
  if (!projects.length) { const empty = document.createElement('div'); empty.className = 'group-empty'; empty.innerHTML = '<span class="empty-check">✦</span><h2>Your first study group starts here.</h2><p>Bring classmates together to share assignments, chat, and keep a project moving.</p><button class="primary-button" id="empty-project">＋ Start a group</button>'; grid.append(empty); $('#empty-project').addEventListener('click', () => $('#project-dialog').showModal()); return; }
  projects.forEach((project) => { const card = document.createElement('button'); card.className = 'project-card'; const icon = document.createElement('span'); icon.className = 'project-icon'; icon.textContent = project.name.trim().slice(0, 1).toUpperCase(); const title = document.createElement('strong'); title.textContent = project.name; const description = document.createElement('p'); description.textContent = project.description || 'A shared space for your next big idea.'; const foot = document.createElement('span'); foot.className = 'project-foot'; foot.textContent = `${project.member_count} ${project.member_count === 1 ? 'member' : 'members'} · ${project.task_count} assignments`; card.append(icon, title, description, foot); card.addEventListener('click', () => openProject(project.id)); grid.append(card); });
}
$('#new-project').addEventListener('click', () => { $('#project-form').reset(); $('#project-error').textContent = ''; $('#project-dialog').showModal(); });
$('#project-form').addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { const project = await post('/api/projects', data); $('#project-dialog').close(); await loadProjects(); await openProject(project.id); } catch (error) { $('#project-error').textContent = error.message; } });
async function openProject(id) {
  try { activeProject = await api(`/api/projects/${id}`); $('#project-detail').hidden = false; const pane = $('#project-detail'); pane.replaceChildren();
    lastMessage = 0;
    const head = document.createElement('div'); head.className = 'project-detail-head'; const back = document.createElement('button'); back.className = 'text-button'; back.textContent = '← All study groups'; back.addEventListener('click', () => { if (chatTimer) clearInterval(chatTimer); activeProject = null; pane.hidden = true; }); const title = document.createElement('h2'); title.textContent = activeProject.name; const desc = document.createElement('p'); desc.textContent = activeProject.description || 'A shared space for your next big idea.'; const invite = document.createElement('button'); invite.className = 'secondary-button'; invite.textContent = '＋ Invite classmate'; invite.hidden = activeProject.role !== 'owner'; invite.addEventListener('click', () => { $('#invite-form').reset(); $('#invite-error').textContent = ''; $('#invite-result').hidden = true; $('#invite-submit').hidden = false; $('#invite-dialog').showModal(); }); head.append(back, title, desc, invite); pane.append(head);
    const layout = document.createElement('div'); layout.className = 'project-layout'; const group = document.createElement('section'); group.className = 'group-panel'; group.innerHTML = '<p class="eyebrow">THE PLAN</p><h3>Shared assignments</h3>'; const taskButton = document.createElement('button'); taskButton.className = 'primary-button'; taskButton.textContent = '＋ Add assignment'; taskButton.hidden = activeProject.role === 'viewer'; taskButton.addEventListener('click', () => { switchView('assignments'); loadTasks().then(openNew); }); group.append(taskButton); const memberBox = document.createElement('div'); memberBox.className = 'members-box'; const label = document.createElement('p'); label.className = 'eyebrow'; label.textContent = 'YOUR TEAM'; memberBox.append(label); activeProject.members.forEach((member) => { const row = document.createElement('div'); row.className = 'member-row'; const avatar = document.createElement('span'); avatar.className = 'avatar small-avatar'; avatar.textContent = member.name.slice(0, 1).toUpperCase(); const text = document.createElement('span'); text.textContent = member.name; const role = document.createElement('small'); role.textContent = member.role; row.append(avatar, text, role); memberBox.append(row); }); group.append(memberBox);
    const chat = document.createElement('section'); chat.className = 'chat-panel'; const chatTitle = document.createElement('div'); chatTitle.className = 'chat-title'; chatTitle.innerHTML = '<div><p class="eyebrow">THE GROUP CHAT</p><h3>Ideas in progress</h3></div><span class="polling-label"><i></i> Updates automatically</span>'; const stream = document.createElement('div'); stream.id = 'chat-stream'; stream.className = 'chat-stream'; const chatForm = document.createElement('form'); chatForm.className = 'chat-form'; const input = document.createElement('input'); input.name = 'body'; input.maxLength = 2000; input.required = true; input.placeholder = 'Share an update or ask a question…'; const send = document.createElement('button'); send.className = 'primary-button'; send.textContent = 'Send'; chatForm.append(input, send); chatForm.hidden = activeProject.role === 'viewer'; chatForm.addEventListener('submit', async (event) => { event.preventDefault(); try { await post(`/api/projects/${activeProject.id}/messages`, { body: input.value }); input.value = ''; await loadMessages(); await loadNotifications(); } catch (error) { alert(error.message); } }); chat.append(chatTitle, stream, chatForm); layout.append(group, chat); pane.append(layout); switchView('projects'); await loadTasks(); await loadMessages(); if (chatTimer) clearInterval(chatTimer); chatTimer = setInterval(() => { if (!document.hidden && activeProject) { loadMessages(); loadNotifications(); } }, 4000);
  } catch (error) { alert(error.message); }
}
let lastMessage = 0;
async function loadMessages() {
  if (!activeProject) return; const messages = await api(`/api/projects/${activeProject.id}/messages?after_id=${lastMessage}`); const stream = $('#chat-stream'); if (!stream) return;
  if (!lastMessage && !messages.length) { stream.textContent = 'Your group chat starts here. Share a question, a win, or what you’re working on.'; return; }
  if (stream.textContent.startsWith('Your group chat')) stream.replaceChildren();
  messages.forEach((message) => { const item = document.createElement('article'); item.className = `chat-message ${message.user_id === user.id ? 'mine' : ''}`; const byline = document.createElement('div'); byline.className = 'message-byline'; byline.textContent = `${message.name} · ${new Date(`${message.created_at}Z`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; const body = document.createElement('p'); body.textContent = message.body; item.append(byline, body); stream.append(item); lastMessage = Math.max(lastMessage, message.id); }); stream.scrollTop = stream.scrollHeight;
}
$('#invite-form').addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { const result = await post(`/api/projects/${activeProject.id}/invites`, data); const target = `${location.origin}/?invite=${encodeURIComponent(result.token)}`; const box = $('#invite-result'); box.hidden = false; box.replaceChildren(); const label = document.createElement('p'); label.textContent = `Invite for ${result.email} · ${result.role} access · expires in 7 days`; const link = document.createElement('input'); link.readOnly = true; link.value = target; const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'secondary-button'; copy.textContent = 'Copy invite link'; copy.addEventListener('click', async () => { await navigator.clipboard.writeText(target); copy.textContent = 'Copied!'; }); box.append(label, link, copy); $('#invite-error').textContent = ''; $('#invite-submit').hidden = true; } catch (error) { $('#invite-error').textContent = error.message; } });
function switchView(name) { $$('.view').forEach((view) => view.classList.remove('active-view')); $(`#view-${name}`).classList.add('active-view'); $$('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === name)); }
$$('.nav-button').forEach((button) => button.addEventListener('click', async () => { switchView(button.dataset.view); if (button.dataset.view === 'activity') await loadActivity(); if (button.dataset.view === 'projects') { activeProject = null; $('#project-detail').hidden = true; if (chatTimer) clearInterval(chatTimer); await loadProjects(); } if (button.dataset.view === 'assignments') { activeProject = null; if (chatTimer) clearInterval(chatTimer); await loadTasks(); } }));
async function loadActivity() {
  const records = await api('/api/activity'); const panel = $('#activity-list'); panel.replaceChildren();
  if (!records.length) { panel.innerHTML = '<div class="activity-empty"><span class="empty-check">✦</span><h2>Good things are just getting started.</h2><p>Your recent assignment and group updates will show up here.</p></div>'; return; }
  records.forEach((record) => { const item = document.createElement('article'); item.className = 'activity-item'; const icon = document.createElement('span'); icon.className = 'activity-icon'; icon.textContent = record.kind === 'comment_added' ? '☷' : record.kind === 'message_sent' ? '↗' : '✦'; const text = document.createElement('div'); text.className = 'activity-copy'; const line = document.createElement('p'); line.textContent = `${record.actor} ${record.detail}`; const when = document.createElement('small'); when.textContent = new Date(`${record.created_at}Z`).toLocaleString(); text.append(line, when); item.append(icon, text); panel.append(item); });
}
async function loadNotifications() {
  const records = await api('/api/notifications'); $('#notification-dot').hidden = !records.some((item) => !item.read_at); const panel = $('#notifications-list'); panel.replaceChildren();
  if (!records.length) { panel.textContent = 'You’re all caught up. New group updates will appear here.'; return; }
  records.forEach((record) => { const item = document.createElement('div'); item.className = `notification-item ${record.read_at ? '' : 'unread'}`; const text = document.createElement('p'); text.textContent = `${record.actor || 'A teammate'} ${record.detail}`; const time = document.createElement('small'); time.textContent = new Date(`${record.created_at}Z`).toLocaleString(); item.append(text, time); panel.append(item); });
}
$('#notification-button').addEventListener('click', async () => { await loadNotifications(); $('#notifications-dialog').showModal(); try { await api('/api/notifications/read', { method: 'POST' }); $('#notification-dot').hidden = true; } catch {} });
$('#account-button').addEventListener('click', () => { $('#account-menu').hidden = !$('#account-menu').hidden; });
document.addEventListener('click', (event) => { if (!event.target.closest('.account-area')) $('#account-menu').hidden = true; });
$('#profile-open').addEventListener('click', () => { $('#account-menu').hidden = true; $('#profile-form').reset(); $('#profile-form').elements.name.value = user.name; $('#profile-email').value = user.email; $('#profile-error').textContent = ''; $('#profile-saved').textContent = ''; $('#profile-dialog').showModal(); });
$('#profile-form').addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); $('#profile-error').textContent = ''; $('#profile-saved').textContent = ''; try { const name = data.name; user = await patch('/api/profile', { name }); if (data.new_password) await api('/api/profile/password', { method: 'POST', body: JSON.stringify({ current_password: data.current_password, new_password: data.new_password }) }); $('#account-name').textContent = user.name; $('#avatar').textContent = user.name.slice(0, 1).toUpperCase(); $('#profile-saved').textContent = 'Your settings are saved.'; } catch (error) { $('#profile-error').textContent = error.message; } });
$('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { if (chatTimer) clearInterval(chatTimer); user = null; showAuth(); setAuthMode(false); } });
boot();
