const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const appMessage = $('#app-message');
const taskForm = $('#task-form');
let user = null;
let tasks = [];
let groupBoardItems = [];
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
let activeStatus = 'all';
let expandedPeopleList = '';

const iconPaths = {
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 5h2a2 2 0 0 1 2 2v11M6 9H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plane: '<path d="m3 11 18-8-8 18-2-8-8-2Z"/><path d="m11 13 5-5"/>',
  group: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.6V20"/>',
  assignments: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h3M9 2h6"/>',
  milestones: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="m4 16-.8 4.8L8 20l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  chat: '<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8 8 0 0 1-3.5-.8L4 20l1.2-3.8A7.2 7.2 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3M8 17h7"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z"/><path d="M4 17a2.5 2.5 0 0 1 2.5-2.5H20M8 7h8"/>',
  move: '<path d="M7 7h13M20 7l-4-4M20 7l-4 4M17 17H4m0 0 4-4m-4 4 4 4"/>',
  comment: '<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8 8 0 0 1-3.5-.8L4 20l1.2-3.8A7.2 7.2 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M4 4v4h4"/>',
  grip: '<circle cx="8" cy="5" r="1"/><circle cx="16" cy="5" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/>',
  moon: '<path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.7 8.7 0 1 0 20.5 15.2Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  trash: '<path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"/>',
  rotate: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3"/>',
  pin: '<path d="m16 3 5 5-4 1-4 5 1 4-2 2-3-6-5-5 2-2 4 1 5-4 1-4Z"/>',
  wave: '<path d="M3 8c2.4 0 2.4-2 4.8-2s2.4 2 4.8 2 2.4-2 4.8-2S19.8 8 22 8M3 13c2.4 0 2.4-2 4.8-2s2.4 2 4.8 2 2.4-2 4.8-2 2.4 2 4.6 2M3 18c2.4 0 2.4-2 4.8-2s2.4 2 4.8 2 2.4-2 4.8-2 2.4 2 4.6 2"/>',
  leaf: '<path d="M20.5 3.5C11 3.7 5.2 5.5 4 11c-.8 3.6 1.3 6 4.5 6.3 5.9.6 10.7-5.4 12-13.8Z"/><path d="M3 21c3.3-5.7 7.3-9.3 13-12"/>',
  flower: '<path d="M12 12c-4-2-4-7 0-7s4 5 0 7Zm0 0c2-4 7-4 7 0s-5 4-7 0Zm0 0c4 2 4 7 0 7s-4-5 0-7Zm0 0c-2 4-7 4-7 0s5-4 7 0Z"/><circle cx="12" cy="12" r="2"/>',
  stars: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 12 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/>',
  person1: '<circle cx="12" cy="8" r="4" fill="#8f573b" stroke="none"/><path d="M4 21c.5-4.4 3.3-7 8-7s7.5 2.6 8 7" fill="#6a5bd7" stroke="none"/><path d="M8 7c0-3 1.8-5 4.5-5 2.2 0 3.5 1.4 3.5 3.7" stroke="#342846" stroke-width="2.5"/>',
  person2: '<circle cx="12" cy="8" r="4" fill="#d59a70" stroke="none"/><path d="M4 21c.5-4.4 3.3-7 8-7s7.5 2.6 8 7" fill="#368f84" stroke="none"/><path d="M7.5 8c-.5-3.2 1.3-5.8 4.7-5.8S17 4.7 16.5 8" stroke="#573b2d" stroke-width="2.8"/>',
  person3: '<circle cx="12" cy="8" r="4" fill="#70452f" stroke="none"/><path d="M4 21c.5-4.4 3.3-7 8-7s7.5 2.6 8 7" fill="#d26e70" stroke="none"/><path d="M7.5 7.5a4.5 4.5 0 0 1 9 0" stroke="#201e2b" stroke-width="3"/>',
  person4: '<circle cx="12" cy="8" r="4" fill="#efc49d" stroke="none"/><path d="M4 21c.5-4.4 3.3-7 8-7s7.5 2.6 8 7" fill="#d99f38" stroke="none"/><path d="M8 6.5c.5-2.6 2-4 4.4-4 2.3 0 3.7 1.2 4.1 3.7" stroke="#a95f42" stroke-width="2.5"/>',
  person5: '<circle cx="12" cy="8" r="4" fill="#c78962" stroke="none"/><path d="M4 21c.5-4.4 3.3-7 8-7s7.5 2.6 8 7" fill="#557fae" stroke="none"/><path d="M7.5 7c0-2.8 1.8-4.8 4.5-4.8s4.5 2 4.5 4.8" stroke="#32263c" stroke-width="2.7"/>',
};
const avatarArt = {violet:'stars',ocean:'wave',mint:'leaf',coral:'flower',sun:'sun',person1:'person1',person2:'person2',person3:'person3',person4:'person4',person5:'person5'};
function avatarMarkup(name, kind='person') { return iconMarkup(kind==='group' ? ({violet:'stars',ocean:'wave',mint:'leaf',coral:'flower',sun:'sun'}[name]||'stars') : (avatarArt[name]||'person1')); }
function iconMarkup(name) { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name]||iconPaths.book}</svg>`; }
function setIcon(button, name) { button.innerHTML = iconMarkup(name); }

function attachCharacterCounter(input) {
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) || input.maxLength < 0 || input.type === 'file' || input.dataset.limitCounter) return;
  input.dataset.limitCounter = 'true';
  const counter = document.createElement('small');
  counter.className = 'character-counter';
  counter.id = `limit-${Math.random().toString(36).slice(2)}`;
  counter.setAttribute('aria-live', 'polite');
  const describedBy = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  input.setAttribute('aria-describedby', [...describedBy, counter.id].join(' '));
  input.insertAdjacentElement('afterend', counter);
  const update = () => {
    const remaining = Math.max(0, input.maxLength - input.value.length);
    counter.textContent = `${input.value.length}/${input.maxLength}${remaining === 0 ? ' · Limit reached' : ''}`;
    counter.classList.toggle('is-at-limit', remaining === 0);
  };
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  input.addEventListener('reset', () => requestAnimationFrame(update));
  update();
}
function refreshCharacterCounters(root = document) { $$('[maxlength]', root).forEach(attachCharacterCounter); $$('.character-counter', root).forEach(counter => { const input = counter.previousElementSibling; if (input) input.dispatchEvent(new Event('change')); }); }
refreshCharacterCounters();
document.addEventListener('reset', event => requestAnimationFrame(() => refreshCharacterCounters(event.target)));
new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => { if (node.nodeType === Node.ELEMENT_NODE) { if(node.matches('[maxlength]'))attachCharacterCounter(node);refreshCharacterCounters(node); } }))).observe(document.body, { childList: true, subtree: true });

function showMessage(message, type = 'error') {
  appMessage.textContent = message;
  appMessage.className = `app-message ${type}`;
  appMessage.hidden = !message;
}

function requestConfirmation({title='Are you sure?',message,confirmLabel='Continue',danger=false}) {
  return new Promise(resolve=>{
    let dialog=$('#action-confirm-dialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='action-confirm-dialog';dialog.innerHTML='<form method="dialog" class="confirm-panel"><div class="dialog-head"><h2></h2><button type="button" class="icon-button" aria-label="Close">×</button></div><p class="confirm-message"></p><div class="dialog-actions"><button value="cancel" class="secondary-button">Cancel</button><button value="confirm" class="primary-button"></button></div></form>';document.body.append(dialog);dialog.addEventListener('close',()=>{const done=dialog._finish;dialog._finish=null;done?.(dialog.returnValue==='confirm');});$('.icon-button',dialog).addEventListener('click',()=>dialog.close('cancel'));}
    $('h2',dialog).textContent=title;$('.confirm-message',dialog).textContent=message;const yes=$('button[value="confirm"]',dialog);yes.textContent=confirmLabel;yes.classList.toggle('danger-button',danger);yes.classList.toggle('primary-button',!danger);dialog._finish=resolve;dialog.returnValue='';dialog.showModal();$('button[value="cancel"]',dialog).focus();
  });
}
function requestTextInput({title,message,value='',confirmLabel='Save',maxLength=2000}) {
  return new Promise(resolve=>{let dialog=$('#text-input-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='text-input-dialog';dialog.innerHTML='<form class="confirm-panel"><div class="dialog-head"><h2></h2><button type="button" class="icon-button" aria-label="Close">×</button></div><p class="confirm-message"></p><label class="field"><textarea maxlength="2000" rows="4"></textarea></label><div class="dialog-actions"><button type="button" class="secondary-button" data-cancel>Cancel</button><button class="primary-button" type="submit"></button></div></form>';document.body.append(dialog);const form=$('form',dialog);$('.icon-button',dialog).addEventListener('click',()=>dialog.close());$('[data-cancel]',dialog).addEventListener('click',()=>dialog.close());form.addEventListener('submit',event=>{event.preventDefault();dialog.close('save');});dialog.addEventListener('close',()=>{const done=dialog._finish;dialog._finish=null;done?.(dialog.returnValue==='save'?$('textarea',dialog).value:null);});}
    $('h2',dialog).textContent=title;$('.confirm-message',dialog).textContent=message;$('textarea',dialog).value=value;$('textarea',dialog).maxLength=maxLength;$('button[type=submit]',dialog).textContent=confirmLabel;dialog._finish=resolve;dialog.returnValue='';dialog.showModal();$('textarea',dialog).focus();
  });
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
  setIcon($('#theme-toggle'), dark ? 'sun' : 'moon');
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  document.querySelector('meta[name="theme-color"]').content = dark ? '#171923' : '#f6f7fb';
}
$('#notification-button').innerHTML=`${iconMarkup('bell')}<span id="notification-dot" hidden></span>`;
$$('button.icon-button[data-close],.profile-photo-close').forEach(button=>setIcon(button,'close'));
[['profile-open','person1'],['settings-open','sun'],['logout-button','close']].forEach(([id,icon])=>{const b=$(`#${id}`);if(b){const label=b.textContent.trim();b.replaceChildren();const glyph=document.createElement('span');glyph.innerHTML=iconMarkup(icon);const text=document.createElement('span');text.textContent=label;b.append(glyph,text);}});
if($('#delete-task'))setIcon($('#delete-task'),'trash');
if($('#rotate-join-code'))setIcon($('#rotate-join-code'),'rotate');
['new-task','board-new-task'].forEach(id=>{const button=$(`#${id}`);if(button)button.innerHTML=`${iconMarkup('add')}<span>New assignment</span>`;button.setAttribute('aria-label','New assignment');});
$$('.stat-icon').forEach((node,index)=>{const icons=['calendar','history','check','milestones'];node.innerHTML=iconMarkup(icons[index]||'book');});

function avatarLabel(profile) { return [...((profile?.name || 'S').trim())][0].toLocaleUpperCase(); }
function buildAvatarPickers() {
  const groupLabels={violet:'Constellation',ocean:'Ocean',mint:'Leaf',coral:'Bloom',sun:'Sunrise'};const peopleLabels={violet:'Avery',ocean:'Jordan',mint:'Sam',coral:'Riley',sun:'Casey'};
  $$('.avatar-picker').forEach(grid=>{const kind=grid.dataset.picker;const labels=kind==='group'?groupLabels:peopleLabels;const hidden=grid.parentElement.querySelector('input[type=hidden][name=avatar]');grid.replaceChildren();let preview=grid.parentElement.querySelector('.avatar-choice-preview');if(!preview){preview=document.createElement('span');preview.className='avatar-choice-preview';grid.insertAdjacentElement('beforebegin',preview);}Object.entries(labels).forEach(([value,label])=>{const button=document.createElement('button');button.type='button';button.className=`avatar-choice ${kind==='group'?'group-avatar-'+value:''}`;button.setAttribute('role','radio');button.setAttribute('aria-checked',String(hidden.value===value));button.setAttribute('aria-label',label);button.title=label;button.innerHTML=avatarMarkup(value,kind);button.addEventListener('click',async()=>{hidden.value=value;$$('.avatar-choice',grid).forEach(choice=>{const selected=choice===button;choice.setAttribute('aria-checked',String(selected));choice.classList.toggle('selected',selected);});grid.dispatchEvent(new Event('change',{bubbles:true}));const livePreview=grid.parentElement.querySelector('.avatar-choice-preview');if(livePreview){livePreview.className=`avatar-choice-preview ${kind==='group'?'group-avatar-'+value:''}`;livePreview.innerHTML=avatarMarkup(value,kind);}if(kind==='person'&&user){try{user=await patch('/api/profile',{name:user.name,avatar:value});setAvatar($('#avatar'),user);setAvatar($('#profile-avatar-preview'),user);}catch(error){showMessage(error.message);}}});button.classList.toggle('selected',hidden.value===value);grid.append(button);});const active=grid.querySelector('.avatar-choice.selected');if(preview&&active){preview.className=`avatar-choice-preview ${kind==='group'?'group-avatar-'+hidden.value:''}`;preview.innerHTML=avatarMarkup(hidden.value,kind);}});
}
buildAvatarPickers();
document.addEventListener('keydown',event=>{const choice=event.target.closest?.('.avatar-choice');if(!choice||!['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(event.key))return;const choices=$$('.avatar-choice',choice.parentElement);const direction=['ArrowRight','ArrowDown'].includes(event.key)?1:-1;const next=choices[(choices.indexOf(choice)+direction+choices.length)%choices.length];event.preventDefault();next.focus();next.click();});
function selectAvatar(grid,value){const hidden=grid?.parentElement.querySelector('input[type=hidden][name=avatar]');if(!hidden)return;hidden.value=value;$$('.avatar-choice',grid).forEach(choice=>{const selected=choice.getAttribute('aria-label')===((grid.dataset.picker==='group'?{violet:'Constellation',ocean:'Ocean',mint:'Leaf',coral:'Bloom',sun:'Sunrise'}:{violet:'Avery',ocean:'Jordan',mint:'Sam',coral:'Riley',sun:'Casey'})[value]);choice.setAttribute('aria-checked',String(selected));choice.classList.toggle('selected',selected);});}
function setAvatar(node, profile) { const preset=profile?.avatar||'violet';node.dataset.avatar=preset;const imageUrl=profile?.profile_photo?(Number(profile.id)===Number(user?.id)?'/api/profile/photo':`/api/people/${profile.id}/photo`):'';node.style.backgroundImage=imageUrl?`url("${imageUrl}?v=${profile.id}")`:'';node.innerHTML=imageUrl?'':avatarMarkup(preset,'person');node.setAttribute('aria-label',profile?.name||'Student avatar'); }

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
    await renderRoute();
  } catch (error) { $('#auth-error').textContent = error.message; }
});

async function boot() {
  try {
    user = await api('/api/auth/me');
    $('#auth-screen').hidden = true;
    $('#app-screen').hidden = false;
    await startApp();
  } catch {
    $('#auth-screen').hidden = false;
    $('#app-screen').hidden = true;
    authMode(false);
  }
  await renderRoute();
}

async function startApp() {
  setAvatar($('#avatar'), user);
  setTheme(user.theme || localStorage.getItem('studypilot-theme') || 'light');
  showMessage('');
  try { await Promise.all([loadProjects(), loadTasks(), loadNotifications(), loadPeople(), loadConversations()]); }
  catch (error) { showMessage(error.message); }
}

function routeFromHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] || 'dashboard', id: parts[0] === 'groups' && parts[1] ? Number(parts[1]) : null, query: new URLSearchParams(query) };
}

async function renderRoute() {
  closeOtherMenus(null);$('#account-menu').hidden=true;const route = routeFromHash();
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
      if (route.id) { await renderProject(route.id); if(route.query.get('requests')==='1'&&['owner','admin'].includes(activeProject?.role)){await loadJoinRequests(route.id);$('#invite-dialog').showModal();} }
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
  tasks = await api(projectId ? `/api/tasks?project_id=${projectId}` : `/api/tasks?scope=${encodeURIComponent($('#scope-filter')?.value || 'all')}`);
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
  const overdueCount=tasks.filter(task=>task.status!=='done'&&isOverdue(task)).length;const activeDoing=tasks.filter(task=>task.status==='in_progress'&&!isOverdue(task)).length;const activeTodo=tasks.filter(task=>task.status==='todo'&&!isOverdue(task)).length;
  const categories=[['done','Done',done],['overdue','Overdue',overdueCount],['doing','Doing',activeDoing],['todo','To do',activeTodo]];const remainder=tasks.length?100-categories.reduce((sum,entry)=>sum+Math.floor(entry[2]/tasks.length*100),0):0;const fractions=categories.map((entry,index)=>({index,fraction:tasks.length?(entry[2]/tasks.length*100)%1:0})).sort((a,b)=>b.fraction-a.fraction);const percents=categories.map(entry=>tasks.length?Math.floor(entry[2]/tasks.length*100):0);fractions.slice(0,remainder).forEach(entry=>percents[entry.index]++);const bar=$('#completion-bar');bar.replaceChildren();bar.setAttribute('aria-label',`${rate}% complete. ${tasks.length} assignments total.`);categories.forEach(([kind,label,count],index)=>{if(!count||!tasks.length)return;const segment=document.createElement('span');segment.className=`progress-segment progress-${kind}`;segment.style.width=`${count/tasks.length*100}%`;segment.setAttribute('aria-label',`${count} ${label.toLowerCase()}, ${percents[index]}%`);bar.append(segment);});const legend=$('#progress-legend');legend.replaceChildren();categories.forEach(([kind,label],index)=>{const item=document.createElement('span');item.className=`progress-legend-item progress-${kind}`;const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');const text=document.createElement('span');text.textContent=`${label} ${percents[index]}%`;item.append(dot,text);legend.append(item);});
  $('#group-summary').textContent = `${projects.length} study groups · ${projects.reduce((sum, project) => sum + Number(project.member_count || 0), 0)} group memberships`;
  const preview = $('#todo-preview'); preview.replaceChildren();
  const focus = tasks.filter((task) => task.status !== 'done').sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || ({high:0,medium:1,low:2}[a.priority] - {high:0,medium:1,low:2}[b.priority]) || a.due_date.localeCompare(b.due_date)).slice(0, 5);
  focus.forEach((task) => { const row = document.createElement('button'); row.className = 'todo-preview-row'; const title = document.createElement('strong'); title.textContent = task.title; const meta = document.createElement('small'); meta.textContent = `${isOverdue(task) ? 'Overdue' : `Due ${formatDate(task.due_date)}`} · ${task.priority} priority`; row.append(title, meta); row.addEventListener('click', () => openTaskDetails(task, projects.find(project=>Number(project.id)===Number(task.project_id))||null)); row.addEventListener('dblclick',()=>openTaskDetails(task, projects.find(project=>Number(project.id)===Number(task.project_id))||null)); preview.append(row); });
}

function filterTasks(items) {
  const query = $('#task-search').value.trim().toLocaleLowerCase();
  const course = $('#course-filter').value;
  const scope = $('#scope-filter')?.value || 'all';
  return items.filter((task) => {
    return (!course || task.course === course) && (scope === 'all' || (scope === 'mine' ? !task.project_id : Boolean(task.project_id))) && (!query || `${task.title} ${task.course} ${task.project_name || ''}`.toLocaleLowerCase().includes(query));
  });
}

function updateDashboardBoard() {
  const filtered = filterTasks(tasks);
  const displayed = activeStatus === 'all' ? filtered : activeStatus === 'overdue' ? filtered.filter(isOverdue) : filtered.filter(task => task.status === activeStatus);
  const hasMatches = displayed.length > 0;
  renderBoard($('#task-board'), displayed, null, activeStatus, filtered);
  $('#board-focus-title').textContent = ({all:'All',todo:'To Do',in_progress:'Doing',done:'Done',overdue:'Overdue'})[activeStatus] || 'All';
  $('#task-board').hidden = false;
  $('#task-empty').hidden = hasMatches;
  const searching = $('#task-search').value.trim() || $('#course-filter').value || $('#scope-filter').value !== 'all';
  $('#task-empty h3').textContent = tasks.length && (searching || boardMetric) ? 'No matching assignments' : 'No assignments here yet';
  $('#task-empty p').textContent = tasks.length && (searching || boardMetric) ? 'Try another search or choose a different status.' : 'Add an assignment to get started.';
  $('#empty-add').textContent = tasks.length && (searching || boardMetric) ? 'Clear search and filters' : '＋ Add assignment';
  const note = $('#archive-note'); if (note) note.hidden = true;
}

$('#task-search').addEventListener('input', updateDashboardBoard);
$('#course-filter').addEventListener('change', updateDashboardBoard);
$('#scope-filter').addEventListener('change', async () => { try { await loadTasks(); updateDashboardBoard(); } catch(error) { showMessage(error.message); } });
$('#new-task').addEventListener('click', () => openNewTask(null));
$('#board-new-task').addEventListener('click', () => openNewTask(null));
$$('.metric-card').forEach((card) => card.addEventListener('click', () => { const filter=card.dataset.metric === 'in_progress' ? 'doing' : card.dataset.metric; location.hash = `#/board?filter=${filter}`; }));

function renderBoardView() {
  const courses = [...new Set(tasks.map((task) => task.course).filter(Boolean))].sort();
  const filter = $('#course-filter'); const chosen = filter.value;
  filter.replaceChildren(new Option('All courses', ''), ...courses.map((course) => new Option(course, course)));
  filter.value = courses.includes(chosen) ? chosen : '';
  const routeFilter = new URLSearchParams(location.hash.split('?')[1] || '').get('filter') || '';
  activeStatus = ({'doing':'in_progress','in_progress':'in_progress','done':'done','overdue':'overdue','up-next':'todo','todo':'todo','all':'all'})[routeFilter] || 'all';
  updateDashboardBoard();
}
$('#empty-add').addEventListener('click', () => {
  if (tasks.length && ($('#task-search').value.trim() || $('#course-filter').value)) {
    $('#task-search').value = ''; $('#course-filter').value = ''; updateDashboardBoard();
  } else openNewTask(null);
});

const statusNames = { todo: 'To Do', in_progress: 'Doing', done: 'Done', overdue: 'Overdue' };
function renderBoard(board, items, project, onlyStatus = 'all', countItems = items) {
  board.replaceChildren();
  board.className = `task-board board-layout${board.id === 'task-board' ? ' main-board-layout' : ''}`;
  const isMainBoard = board.id === 'task-board';
  const focused = onlyStatus || 'all';
  const counts = {todo:countItems.filter(task=>task.status==='todo').length,in_progress:countItems.filter(task=>task.status==='in_progress').length,done:countItems.filter(task=>task.status==='done').length,overdue:countItems.filter(isOverdue).length};
  const rail = document.createElement('nav'); rail.className='board-status-rail'; rail.setAttribute('aria-label','Assignment status');
  for (const [key,label] of [['all','All'],['todo','To Do'],['in_progress','Doing'],['done','Done'],['overdue','Overdue']]) {
    const button=document.createElement('button');button.type='button';button.className=`board-status-target ${key===focused?'active':''}`;button.dataset.status=key;button.setAttribute('aria-pressed',String(key===focused));
    const name=document.createElement('span');name.textContent=label;const count=document.createElement('strong');count.textContent=key==='all'?countItems.length:counts[key];button.append(name,count);
    button.addEventListener('click',()=>{if(isMainBoard){activeStatus=key;boardMetric='';updateDashboardBoard();}else{board.dataset.focusStatus=key;renderBoard(board,items,project,key,countItems);}});
    button.addEventListener('dragover',event=>{if(key!=='all'&&key!=='overdue'&&project?.role!=='viewer'&&!project?.legacy_readonly){event.preventDefault();button.classList.add('drop-target');}});
    button.addEventListener('dragleave',()=>button.classList.remove('drop-target'));
    button.addEventListener('drop',async event=>{event.preventDefault();button.classList.remove('drop-target');if(key==='all'||key==='overdue')return;const id=Number(event.dataTransfer.getData('text/plain'));const task=items.find(item=>item.id===id);if(task&&task.status!==key)await changeTaskStatus(task,key,project);});
    rail.append(button);
  }
  board.append(rail);
  const lanes = document.createElement('div');lanes.className=`board-lanes${focused==='all'?'':' is-focused'}`;
  const statuses = focused==='all' ? ['todo','in_progress','done','overdue'] : [focused];
  for (const status of statuses) {
    const lane = document.createElement('section');
    lane.className = `kanban-lane lane-${status}`;
    lane.dataset.status = status;
    const heading = document.createElement('div');
    heading.className = 'lane-heading';
    const label = document.createElement('h3'); label.textContent = statusNames[status];
    const count = document.createElement('span'); count.className = 'lane-count';
    const cards = status==='overdue' ? items.filter(isOverdue) : items.filter(task => task.status === status);
    count.textContent = cards.length;
    heading.append(label, count);
    const content = document.createElement('div'); content.className = 'lane-cards';
    cards.forEach((task) => content.append(makeTaskCard(task, project)));
    lane.append(heading, content);
    lane.addEventListener('dragover', (event) => { if ((!project || !['viewer'].includes(project.role)) && !project?.legacy_readonly && status!=='overdue') { event.preventDefault(); lane.classList.add('drop-target'); } });
    lane.addEventListener('dragleave', () => lane.classList.remove('drop-target'));
    lane.addEventListener('drop', async (event) => {
      event.preventDefault(); lane.classList.remove('drop-target');
      const id = Number(event.dataTransfer.getData('text/plain'));
      const task = items.find((item) => item.id === id);
      if (task && status!=='overdue' && task.status !== status) await changeTaskStatus(task, status, project);
    });
    lanes.append(lane);
  }
  board.append(lanes);
}

function makeTaskCard(task, project) {
  const card = document.createElement('article');
  card.className = `task-card priority-card-${task.priority}`;
  const canEdit = project?.role !== 'viewer' && !project?.legacy_readonly;
  card.draggable = false;
  card.tabIndex = canEdit ? 0 : -1;
  if (canEdit) card.setAttribute('aria-keyshortcuts','Enter ArrowLeft ArrowRight');
  card.addEventListener('keydown', (event) => { if (event.target !== card) return; if(event.key==='Enter'){event.preventDefault();openTaskDetails(task,project);return;} if (!canEdit || !['ArrowLeft','ArrowRight'].includes(event.key)) return; event.preventDefault(); const order=['todo','in_progress','done'];const pos=order.indexOf(task.status);const next=order[Math.max(0,Math.min(order.length-1,pos+(event.key==='ArrowRight'?1:-1)))];if(next!==task.status)changeTaskStatus(task,next,project); });
  card.addEventListener('dblclick',event=>{if(canEdit&&!event.target.closest('button,a,input,textarea,select'))openEditTask(task,project);});
  const titleLine = document.createElement('div'); titleLine.className = 'task-card-title';
  const title = document.createElement('button'); title.className = 'task-title'; title.textContent = task.title; title.type='button'; title.setAttribute('aria-label',`View ${task.title}`);let titleClickTimer;title.addEventListener('click', () => {clearTimeout(titleClickTimer);titleClickTimer=setTimeout(()=>openTaskDetails(task, project),230);});title.addEventListener('dblclick',event=>{event.preventDefault();clearTimeout(titleClickTimer);if(canEdit)openEditTask(task,project);});
  const topActions=document.createElement('div');topActions.className='task-top-actions';
  const edit = document.createElement('button');edit.type='button';edit.className='icon-button task-edit';setIcon(edit,'edit');edit.title='Edit assignment';edit.setAttribute('aria-label',`Edit ${task.title}`);edit.hidden=!canEdit;edit.addEventListener('click',()=>openEditTask(task,project));
  const drag = document.createElement('button');drag.type='button';drag.className='icon-button task-drag';setIcon(drag,'grip');drag.title='Drag to move';drag.setAttribute('aria-label',`Drag ${task.title} to another status`);drag.hidden=!canEdit;drag.draggable=canEdit;drag.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',String(task.id));event.dataTransfer.effectAllowed='move';});
  topActions.append(edit,drag);
  titleLine.append(title, topActions);
  const context = document.createElement('div'); context.className = 'task-context';
  if (task.project_name && !project) context.append(makeTag(task.project_name, 'project-tag'));
  if (task.course) context.append(makeTag(task.course, 'course-tag'));
  if (task.priority) context.append(makeTag(`${task.priority} priority`, `priority-tag ${task.priority}`));
  const deadline = document.createElement('p'); deadline.className = `task-deadline ${isOverdue(task) ? 'overdue' : ''}`;
  deadline.textContent = `${isOverdue(task) ? 'Overdue · ' : 'Due · '}${formatDate(task.due_date, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  if(isOverdue(task)){const actual=document.createElement('small');actual.className='underlying-status';actual.textContent=statusNames[task.status];deadline.append(' · ',actual);}
  const description=document.createElement('p');description.className='task-description-preview';description.textContent=task.description||'';description.hidden=!task.description;
  const assignees=document.createElement('div');assignees.className='task-assignees';(task.assignees||[]).slice(0,4).forEach(person=>{const avatar=document.createElement('span');avatar.className='avatar task-assignee-avatar';setAvatar(avatar,person);avatar.title=person.name;avatar.setAttribute('aria-label',person.name);assignees.append(avatar);});if(!(task.assignees||[]).length){const me=document.createElement('span');me.textContent=project?'Unassigned':'You';assignees.append(me);}
  const actions = document.createElement('div'); actions.className = 'task-card-actions';
  const moveButton=document.createElement('button');moveButton.type='button';moveButton.className='task-move-trigger icon-button';setIcon(moveButton,'move');moveButton.title='Move assignment';moveButton.setAttribute('aria-label',`Move ${task.title}`);moveButton.hidden=!canEdit;
  const moveMenu=document.createElement('div');moveMenu.className='task-move-popover';moveMenu.setAttribute('popover','auto');moveMenu.setAttribute('aria-label',`Move ${task.title} to a status`);
  Object.entries(statusNames).filter(([value])=>value!=='overdue').forEach(([value,name])=>{if(value===task.status)return;const option=document.createElement('button');option.type='button';option.textContent=`Move to ${name}`;option.addEventListener('click',()=>{moveMenu.hidePopover();moveButton.setAttribute('aria-expanded','false');changeTaskStatus(task,value,project);});moveMenu.append(option);});
  moveButton.setAttribute('aria-haspopup','menu');moveButton.setAttribute('aria-expanded','false');
  moveButton.addEventListener('click',()=>{if(moveMenu.matches(':popover-open')){moveMenu.hidePopover();moveButton.setAttribute('aria-expanded','false');return;}moveMenu.showPopover();moveButton.setAttribute('aria-expanded','true');const rect=moveButton.getBoundingClientRect();const width=moveMenu.offsetWidth;const height=moveMenu.offsetHeight;const left=Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8));const top=rect.bottom+height+8<=window.innerHeight?rect.bottom+6:Math.max(8,rect.top-height-6);moveMenu.style.left=`${left}px`;moveMenu.style.top=`${top}px`;});
  moveMenu.addEventListener('toggle',event=>{if(event.newState==='closed')moveButton.setAttribute('aria-expanded','false');});
  const comment = document.createElement('button'); comment.type='button';comment.className='icon-button';setIcon(comment,'comment');comment.title='Comments';comment.setAttribute('aria-label',`Comments for ${task.title}`);comment.addEventListener('click', () => toggleComments(card, task, project));
  const historyButton=document.createElement('button');historyButton.type='button';historyButton.className='icon-button';setIcon(historyButton,'history');historyButton.title='History';historyButton.setAttribute('aria-label',`History for ${task.title}`);historyButton.addEventListener('click',()=>toggleTaskHistory(card,task));
  actions.append(moveButton, moveMenu, comment, historyButton);
  card.append(titleLine, context, description, deadline, assignees, actions);
  return card;
}

async function toggleTaskHistory(card, task) {
  const existing=$('.task-history',card);if(existing){existing.remove();return;}
  const panel=document.createElement('div');panel.className='task-history';panel.textContent='Loading history…';card.append(panel);
  try{const rows=await api(`/api/tasks/${task.id}/history`);panel.replaceChildren();if(!rows.length){panel.textContent='No status changes recorded yet.';return;}rows.forEach(row=>{const item=document.createElement('p');item.textContent=`${row.changed_by||'A teammate'} moved ${row.from_status||'new'} → ${row.to_status} · ${formatTimestamp(row.changed_at)}`;panel.append(item);});}catch(error){panel.textContent=error.message;}
}

function makeTag(text, className) { const tag = document.createElement('span'); tag.className = className; tag.textContent = text; return tag; }

async function openTaskDetails(task, project) {
  let dialog=$('#task-details-dialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='task-details-dialog';dialog.className='task-details-dialog';dialog.innerHTML='<section class="task-details-panel"><div class="dialog-head"><div><h2></h2></div><button type="button" class="icon-button" aria-label="Close">×</button></div><div class="task-details-body"></div></section>';document.body.append(dialog);$('.icon-button',dialog).addEventListener('click',()=>dialog.close());}
  const panel=$('.task-details-panel',dialog);$('h2',panel).textContent=task.title;const body=$('.task-details-body',panel);body.replaceChildren();
  const info=document.createElement('div');info.className='task-detail-meta';info.append(makeTag(`${statusNames[task.status]}${isOverdue(task)?' · Overdue':''}`,'status-tag'),makeTag(`${task.priority} priority`,`priority-tag ${task.priority}`),makeTag(`Due ${formatDate(task.due_date,{month:'short',day:'numeric',year:'numeric'})}`,'date-tag'));body.append(info);
  if(task.description){const description=document.createElement('p');description.className='task-detail-description';description.textContent=task.description;body.append(description);}
  const assignees=document.createElement('div');assignees.className='task-detail-assignees';(task.assignees||[]).forEach(person=>{const item=document.createElement('span');item.className='task-detail-person';const avatar=document.createElement('span');avatar.className='avatar task-assignee-avatar';setAvatar(avatar,person);const name=document.createElement('span');name.textContent=person.name;item.append(avatar,name);assignees.append(item);});if(assignees.childElementCount)body.append(assignees);
  const history=document.createElement('section');history.className='task-detail-section';const historyTitle=document.createElement('h3');historyTitle.textContent='History';history.append(historyTitle);const comments=document.createElement('section');comments.className='task-detail-section';const commentsTitle=document.createElement('h3');commentsTitle.textContent='Comments';comments.append(commentsTitle);body.append(history,comments);dialog.showModal();
  try{const [rows,notes]=await Promise.all([api(`/api/tasks/${task.id}/history`),api(`/api/tasks/${task.id}/comments`)]);if(!rows.length){const empty=document.createElement('p');empty.textContent='No history';history.append(empty);}rows.forEach(row=>{const line=document.createElement('p');line.textContent=`${row.changed_by||'A teammate'} · ${statusNames[row.from_status]||'Created'} → ${statusNames[row.to_status]||row.to_status} · ${formatTimestamp(row.changed_at)}`;history.append(line);});if(!notes.length){const empty=document.createElement('p');empty.textContent='No comments';comments.append(empty);}notes.forEach(note=>{const item=document.createElement('p');item.textContent=`${note.name} · ${formatTimestamp(note.created_at)}: ${note.body}`;comments.append(item);});}catch(error){const err=document.createElement('p');err.textContent=error.message;body.append(err);}
}

async function changeTaskStatus(task, status, project) {
  const previous = { status: task.status, started_at: task.started_at, completed_at: task.completed_at };
  const board = project ? $('#group-task-board') : $('#task-board');
  const oldFocus = project ? (board?.dataset.focusStatus || 'all') : activeStatus;
  const wasOverdue = isOverdue(task);
  task.status = status;
  if (status === 'in_progress' && !task.started_at) task.started_at = new Date().toISOString();
  if (status === 'done') task.completed_at = new Date().toISOString();
  else task.completed_at = null;
  const newFocus = oldFocus === 'all' ? 'all' : (oldFocus === previous.status || (oldFocus === 'overdue' && wasOverdue) ? status : oldFocus);
  if (project) board.dataset.focusStatus = newFocus;
  else activeStatus = newFocus;
  if (project) renderBoard(board, tasks, project, newFocus, tasks);
  else updateDashboardBoard();
  try {
    await patch(`/api/tasks/${task.id}`, { status });
    showMessage('');
    await loadTasks(project?.id || null);
    if (project) await loadProjectBoard(project);
    else updateDashboardBoard();
  } catch (error) {
    Object.assign(task, previous);
    if (project) { board.dataset.focusStatus = oldFocus; renderBoard(board, tasks, project, oldFocus, tasks); }
    else { activeStatus = oldFocus; updateDashboardBoard(); }
    showMessage(error.message);
  }
}

function openNewTask(project) {
  taskForm.reset();
  $('#task-id').value = '';
  $('#task-dialog-title').textContent = project ? `New assignment · ${project.name}` : 'New assignment';
  $('#delete-task').hidden = true;
  $('#form-error').textContent = '';
  $('#scope-wrap').hidden = Boolean(project);
  $('#assignment-scope').value = project ? 'group' : 'personal';
  const groupSelect=$('#assignment-group');groupSelect.replaceChildren(...projects.filter(item=>item.role!=='viewer').map(item=>new Option(item.name,item.id)));
  $('#assignment-group-wrap').hidden = !project;
  if(project)groupSelect.value=String(project.id);
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
    const label=document.createElement('label');label.className='assignee-option';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=member.id;checkbox.checked=selected.includes(member.id);checkbox.disabled=member.id===user.id;checkbox.name='assignee_ids';
    const avatar=document.createElement('span');avatar.className='avatar small-avatar';setAvatar(avatar,member);const name=document.createElement('span');name.className='assignee-name';name.textContent=member.name+(member.id===user.id?' · You':'');label.append(checkbox,avatar,name);select.append(label);
  });
}

function openEditTask(task, project) {
  taskForm.reset();
  $('#task-id').value = task.id;
  $('#task-dialog-title').textContent = 'Edit assignment';
  $('#scope-wrap').hidden = true;
  $('#assignment-group-wrap').hidden = true;
  $('#delete-task').hidden = false;
  $('#assignee-wrap').hidden = !project;
  $('#form-error').textContent = '';
  for (const key of ['title', 'course', 'due_date', 'priority', 'description']) $(`#${key.replace('_', '-')}`).value = task[key] ?? '';
  $('#assignee-wrap').hidden = !project;
  populateAssignees(project, task.assignees?.map((person) => person.id) || []);
  taskForm.dataset.projectId = project?.id || task.project_id || '';
  $('#task-dialog').showModal();
}

$('#assignment-scope').addEventListener('change', async()=>{
  const isGroup=$('#assignment-scope').value==='group';$('#assignment-group-wrap').hidden=!isGroup;$('#assignee-wrap').hidden=!isGroup;
  if(!isGroup){taskForm.dataset.projectId='';return;}
  const id=Number($('#assignment-group').value);const selected=projects.find(item=>item.id===id);if(!selected)return;
  try{const project=await api(`/api/projects/${id}`);taskForm.dataset.projectId=String(id);populateAssignees(project,[]);}catch(error){showMessage(error.message);}
});
$('#assignment-group').addEventListener('change',async()=>{const id=Number($('#assignment-group').value);if(!id)return;try{const project=await api(`/api/projects/${id}`);taskForm.dataset.projectId=String(id);populateAssignees(project,[]);}catch(error){showMessage(error.message);}});

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('#task-id').value;
  const projectId = taskForm.dataset.projectId;
  const payload = Object.fromEntries(new FormData(taskForm).entries());
  delete payload.assignment_scope;
  if ($('#assignment-scope').value === 'group' && !id) {
    if (!projectId) { $('#form-error').textContent='Choose a study group.'; return; }
    payload.project_id = Number(projectId);
  }
  if(projectId) payload.assignee_ids = $$('#assignees input:checked').map((input) => Number(input.value));
  $('#form-error').textContent = '';
  try {
    await api(id ? `/api/tasks/${id}` : '/api/tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    $('#task-dialog').close();
    await loadTasks();
    if (routeFromHash().name === 'groups' && routeFromHash().id) await renderProject(routeFromHash().id);
    else if (routeFromHash().name === 'board') renderBoardView();
    else renderDashboard();
  } catch (error) { $('#form-error').textContent = error.message; }
});

$('#delete-task').addEventListener('click', async () => {
  const id = $('#task-id').value;
  if (!id) return;
  if (!await requestConfirmation({title:'Delete assignment?',message:'This assignment and its comments will be removed.',confirmLabel:'Delete assignment',danger:true})) return;
  $('#form-error').textContent = '';
  try {
    await api(`/api/tasks/${id}`, { method: 'DELETE' });
    $('#task-dialog').close();
    await loadTasks();
    if (routeFromHash().name === 'groups' && routeFromHash().id) await renderProject(routeFromHash().id);
    else if (routeFromHash().name === 'board') renderBoardView();
    else renderDashboard();
  } catch (error) { $('#form-error').textContent = error.message; }
});

async function toggleComments(card, task, project) {
  let dialog=$('#task-comments-dialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='task-comments-dialog';const panel=document.createElement('section');panel.className='comments-panel';panel.setAttribute('aria-label','Assignment comments');dialog.append(panel);document.body.append(dialog);}
  if(dialog.open&&Number(dialog.dataset.taskId)===Number(task.id)){dialog.close();return;}
  dialog.dataset.taskId=String(task.id);const panel=$('.comments-panel',dialog);panel.textContent='Loading comments…';dialog.showModal();
  try {
    await renderCommentPanel(panel, task, project);
  } catch (error) { panel.textContent = error.message; }
}

async function renderCommentPanel(panel, task, project) {
  const comments=await api(`/api/tasks/${task.id}/comments`);panel.replaceChildren();
  const head=document.createElement('div');head.className='comments-dialog-head';const title=document.createElement('h2');title.textContent=task.title;const close=document.createElement('button');close.type='button';close.className='icon-button';close.textContent='×';close.setAttribute('aria-label','Close comments');close.addEventListener('click',()=>panel.closest('dialog').close());head.append(title,close);panel.append(head);
  const stream=document.createElement('div');stream.className='comment-stream';
  if(!comments.length){const empty=document.createElement('p');empty.className='comment-empty';empty.textContent='No comments yet.';stream.append(empty);}
  comments.forEach(comment=>{
    const row=document.createElement('article');row.className='comment-item';const copy=document.createElement('div');copy.className='comment-copy';const meta=document.createElement('div');meta.className='comment-meta';const by=document.createElement('strong');by.textContent=comment.name;const when=document.createElement('small');when.textContent=`${formatTimestamp(comment.created_at)}${comment.edited_at?' · edited':''}`;meta.append(by,when);const body=document.createElement('p');body.textContent=comment.body;copy.append(meta,body);row.append(copy);
    if(Number(comment.user_id)===Number(user?.id)&&project?.role!=='viewer'&&!project?.legacy_readonly){const actions=document.createElement('details');actions.className='comment-menu';const trigger=document.createElement('summary');setIcon(trigger,'more');trigger.setAttribute('aria-label','Comment actions');const menu=document.createElement('div');menu.className='comment-menu-items';const edit=document.createElement('button');edit.type='button';edit.textContent='Edit';edit.addEventListener('click',async()=>{actions.open=false;const input=document.createElement('textarea');input.className='comment-edit-input';input.value=comment.body;input.maxLength=2000;const save=document.createElement('button');save.type='button';save.className='secondary-button';save.textContent='Save';const cancel=document.createElement('button');cancel.type='button';cancel.className='text-button';cancel.textContent='Cancel';copy.replaceChildren(meta,input);row.append(save,cancel);cancel.addEventListener('click',()=>renderCommentPanel(panel,task,project).catch(error=>showMessage(error.message)));save.addEventListener('click',async()=>{try{await patch(`/api/tasks/${task.id}/comments/${comment.id}`,{body:input.value});await renderCommentPanel(panel,task,project);}catch(error){showMessage(error.message);}});});const remove=document.createElement('button');remove.type='button';remove.textContent='Delete';remove.addEventListener('click',async()=>{actions.open=false;if(!await requestConfirmation({title:'Delete comment?',message:'This comment will be removed.',confirmLabel:'Delete comment',danger:true}))return;try{await api(`/api/tasks/${task.id}/comments/${comment.id}`,{method:'DELETE'});await renderCommentPanel(panel,task,project);}catch(error){showMessage(error.message);}});menu.append(edit,remove);actions.append(trigger,menu);row.append(actions);}
    stream.append(row);
  });
  panel.append(stream);
  if(project?.role!=='viewer'&&!project?.legacy_readonly){const form=document.createElement('form');form.className='comment-form';const input=document.createElement('textarea');input.name='body';input.maxLength=2000;input.required=true;input.placeholder='Write a comment…';input.setAttribute('aria-label','Comment');const controls=document.createElement('div');controls.className='comment-form-controls';const send=document.createElement('button');send.className='primary-button';send.textContent='Send';controls.append(send);form.append(input,controls);form.addEventListener('submit',async event=>{event.preventDefault();send.disabled=true;try{await post(`/api/tasks/${task.id}/comments`,{body:input.value});await renderCommentPanel(panel,task,project);}catch(error){send.disabled=false;showMessage(error.message);}});panel.append(form);}
}

function renderProjects() {
  const grid = $('#projects-grid'); grid.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement('div'); empty.className = 'group-empty';
    const icon = document.createElement('img'); icon.className = 'study-illustration'; icon.src='/static/studypilot-study-illustration.png'; icon.alt=''; icon.width=220; icon.height=190; icon.loading='lazy';
    const heading = document.createElement('h2'); heading.textContent = 'No study groups yet';
    empty.append(icon, heading); grid.append(empty); return;
  }
  projects.forEach((project) => {
    const card = document.createElement('button'); card.className = 'project-card';
    const copy = document.createElement('span'); copy.className='project-card-copy';
    const icon = document.createElement('span'); icon.className = `project-icon group-avatar-${project.avatar || 'violet'}`; icon.setAttribute('aria-hidden','true'); icon.innerHTML = avatarMarkup(project.avatar||'violet','group');
    const title = document.createElement('strong'); title.textContent = project.name;
    const description = document.createElement('p'); description.className='project-card-description'; description.textContent = project.description || '';
    const metrics = document.createElement('span'); metrics.className = 'project-metrics';
    const members = document.createElement('span'); members.className = 'project-metric'; const memberIcon=document.createElement('b'); memberIcon.setAttribute('aria-hidden','true'); memberIcon.innerHTML=iconMarkup('group');
    const memberCount = document.createElement('strong'); memberCount.textContent = project.member_count; const memberLabel = document.createElement('small'); memberLabel.textContent = 'members'; members.append(memberIcon,memberCount,memberLabel);
    const assignments = document.createElement('span'); assignments.className = 'project-metric'; const taskIcon=document.createElement('b'); taskIcon.setAttribute('aria-hidden','true'); taskIcon.innerHTML=iconMarkup('assignments');
    const taskCount = document.createElement('strong'); taskCount.textContent = project.task_count; const taskLabel = document.createElement('small'); taskLabel.textContent = 'assignments'; assignments.append(taskIcon,taskCount,taskLabel);
    const milestones=document.createElement('span');milestones.className='project-metric';const milestoneIcon=document.createElement('b');milestoneIcon.setAttribute('aria-hidden','true');milestoneIcon.innerHTML=iconMarkup('milestones');const milestoneCount=document.createElement('strong');milestoneCount.textContent=project.milestone_count??0;const milestoneLabel=document.createElement('small');milestoneLabel.textContent='milestones';milestones.append(milestoneIcon,milestoneCount,milestoneLabel);
    metrics.append(members,assignments,milestones);
    copy.append(icon,title,description);card.append(copy,metrics); card.addEventListener('click', () => { location.hash = `#/groups/${project.id}`; }); grid.append(card);
  });
}

$('#new-project').addEventListener('click', () => { $('#project-form').reset(); selectAvatar($('.avatar-picker[data-picker="group"]'),'violet'); $('#project-form').dataset.id=''; $('#project-dialog-title').textContent='Start a study group'; $('#save-group').textContent='Create group'; $('.dialog-danger-zone').hidden=true; $('#project-error').textContent = ''; refreshCharacterCounters($('#project-form')); $('#project-dialog').showModal(); });
$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name=event.currentTarget.elements.name.value.trim();
  if(name.split(/\s+/).filter(Boolean).length>4){$('#project-error').textContent='Use up to 4 words in the group name.';event.currentTarget.elements.name.focus();return;}
  try { const id=event.currentTarget.dataset.id;const payload=Object.fromEntries(new FormData(event.currentTarget));payload.name=name;if((payload.description||'').length>200){$('#project-error').textContent='Description must be 200 characters or fewer.';event.currentTarget.elements.description.focus();return;}const project=id?await patch(`/api/projects/${id}`,payload):await post('/api/projects',payload); $('#project-dialog').close(); await loadProjects(); if(id&&routeFromHash().name==='groups'&&Number(routeFromHash().id)===Number(project.id)){await renderProject(project.id);if(activeGroupChatId===project.id){const header=$('.thread-header h2');if(header)header.textContent=project.name;await loadConversations();renderConversations();}}else location.hash = `#/groups/${project.id}`; }
  catch (error) { $('#project-error').textContent = error.message; }
});
$('#delete-group').addEventListener('click',async()=>{if(!activeProject||!await requestConfirmation({title:'Delete study group?',message:`“${activeProject.name}” and its shared assignments, messages, and history will be removed.`,confirmLabel:'Delete group',danger:true}))return;try{await api(`/api/projects/${activeProject.id}`,{method:'DELETE'});$('#project-dialog').close();location.hash='#/groups';await loadProjects();}catch(error){$('#project-error').textContent=error.message;}});

$('#join-group-open').addEventListener('click', () => { $('#join-form').reset(); $('#join-error').textContent = ''; $('#join-dialog').showModal(); });
$('#join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = new FormData(event.currentTarget).get('code').trim().toUpperCase();
  try { const result = await post('/api/projects/join-requests', { code }); $('#join-dialog').close(); event.currentTarget.reset(); showMessage(result.status === 'already_member' ? 'You are already in this group.' : 'Request sent. You can open the group after its owner approves you.', 'success'); await loadNotifications(); }
  catch (error) { $('#join-error').textContent = error.message; }
});

async function loadJoinRequests(projectId) {
  const box=$('#group-join-requests'); box.replaceChildren();
  if(!['owner','admin'].includes(activeProject?.role)){box.textContent='Only group admins can review access requests.';return;}
  try { const requests=await api(`/api/projects/${projectId}/join-requests`); if(!requests.length){box.textContent='No pending requests.';return;}
    requests.forEach((item)=>{const row=document.createElement('article');row.className='person-card';const info=document.createElement('span');info.className='person-copy';const name=document.createElement('strong');name.textContent=item.name;const handle=document.createElement('small');handle.textContent=`@${item.username} · ${formatTimestamp(item.created_at)}`;info.append(name,handle);row.append(info);['approve','reject','block'].forEach((action)=>{const b=document.createElement('button');b.className=action==='approve'?'primary-button':'secondary-button';b.textContent=action[0].toUpperCase()+action.slice(1);b.addEventListener('click',async()=>{try{await post(`/api/projects/${projectId}/join-requests/${item.id}/${action}`,{});await loadJoinRequests(projectId);await loadProjects();await loadNotifications();}catch(error){showMessage(error.message);}});row.append(b);});box.append(row);});
  } catch(error){box.textContent=error.message;}
}

function showGroupDescription(name,text) {
  let dialog=$('#group-description-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='group-description-dialog';dialog.className='group-description-dialog';dialog.innerHTML='<section class="group-description-panel"><div class="dialog-head"><h2></h2><button type="button" class="icon-button" aria-label="Close">×</button></div><p></p></section>';document.body.append(dialog);$('.icon-button',dialog).addEventListener('click',()=>dialog.close());}
  $('h2',dialog).textContent=name;$('p',dialog).textContent=text||'';dialog.showModal();
}

let copyFeedbackTimer;
$('#copy-join-code').addEventListener('click', async()=>{const button=$('#copy-join-code');const code=$('#group-join-code').textContent;try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(code);else{const fallback=document.createElement('textarea');fallback.value=code;fallback.setAttribute('readonly','');fallback.style.position='fixed';fallback.style.opacity='0';document.body.append(fallback);fallback.select();const copied=document.execCommand('copy');fallback.remove();if(!copied)throw new Error('Copy unavailable');}clearTimeout(copyFeedbackTimer);button.classList.add('is-copied');setIcon(button,'check');button.setAttribute('aria-label','Join code copied');button.title='Join code copied';$('#copy-feedback').textContent='Join code copied';copyFeedbackTimer=setTimeout(()=>{button.classList.remove('is-copied');setIcon(button,'copy');button.setAttribute('aria-label','Copy join code');button.title='Copy join code';$('#copy-feedback').textContent='';},1400);}catch{showMessage('Copy is unavailable in this browser. Select the code to copy it.');}});
$('#rotate-join-code').addEventListener('click', async()=>{if(!activeProject||!await requestConfirmation({title:'Replace join code?',message:'The current code will stop working immediately.',confirmLabel:'Replace code',danger:true}))return;try{const result=await post(`/api/projects/${activeProject.id}/join-code/rotate`,{});activeProject.join_code=result.code;$('#group-join-code').textContent=result.code;await loadProjects();}catch(error){showMessage(error.message);}});

async function renderProject(projectId) {
  activeProject = await api(`/api/projects/${projectId}`);
  const pane = $('#project-detail'); pane.hidden = false; pane.replaceChildren();
  const head = document.createElement('div'); head.className = 'project-detail-head';
  const hero = document.createElement('section'); hero.className='group-hero';
  const heroMain=document.createElement('div');heroMain.className='group-hero-main';
  const titlebox = document.createElement('div');titlebox.className='group-hero-copy';
  const heroAvatar=document.createElement('span');heroAvatar.className=`group-hero-avatar group-avatar-${activeProject.avatar||'violet'}`;heroAvatar.setAttribute('aria-hidden','true');heroAvatar.innerHTML=avatarMarkup(activeProject.avatar||'violet','group');
  const title = document.createElement('h2'); title.textContent = activeProject.name;
  const description = document.createElement('p');description.className='group-description';description.textContent=activeProject.description||'';
  const descriptionToggle=document.createElement('button');descriptionToggle.type='button';descriptionToggle.className='text-button group-description-toggle';descriptionToggle.textContent='Read more';descriptionToggle.hidden=!(activeProject.description||'').trim();descriptionToggle.setAttribute('aria-haspopup','dialog');descriptionToggle.addEventListener('click',()=>showGroupDescription(activeProject.name,activeProject.description));
  const stats=document.createElement('div');stats.className='group-hero-stats';
  const memberStat=document.createElement('span');memberStat.className='group-stat';memberStat.innerHTML=`<b aria-hidden="true">${iconMarkup('group')}</b><strong></strong><span>members</span>`;memberStat.querySelector('strong').textContent=String(activeProject.members.length);
  const assignmentStat=document.createElement('span');assignmentStat.className='group-stat';assignmentStat.innerHTML=`<b aria-hidden="true">${iconMarkup('assignments')}</b><strong id="group-assignments-count">…</strong><span>assignments</span>`;
  const milestoneStat=document.createElement('span');milestoneStat.className='group-stat';milestoneStat.innerHTML=`<b aria-hidden="true">${iconMarkup('milestones')}</b><strong id="group-milestones-count">…</strong><span>milestones</span>`;
  stats.append(memberStat,assignmentStat,milestoneStat);titlebox.append(heroAvatar,title,description,descriptionToggle);heroMain.append(titlebox,stats);
  const actions = document.createElement('div'); actions.className = 'group-hero-actions';
  const addTask = document.createElement('button'); addTask.className = 'primary-button'; addTask.innerHTML = `${iconMarkup('add')}<span>Assignment</span>`; addTask.hidden = activeProject.role === 'viewer'; addTask.addEventListener('click', () => openNewTask(activeProject));
  const openChat = document.createElement('a'); openChat.className = 'primary-button'; openChat.href = `#/messages?group=${activeProject.id}`; openChat.innerHTML = `${iconMarkup('chat')}<span>Chat</span>`;
  const menu=document.createElement('details');menu.className='group-actions-menu';
  const trigger=document.createElement('summary');trigger.setAttribute('aria-label','More group actions');trigger.title='More group actions';trigger.innerHTML=iconMarkup('more');
  const menuItems=document.createElement('div');menuItems.className='group-menu-items';
  const editGroup=document.createElement('button');editGroup.type='button';editGroup.textContent='Edit group';editGroup.hidden=!['owner','admin'].includes(activeProject.role);editGroup.addEventListener('click',()=>{menu.open=false;const form=$('#project-form');form.reset();form.dataset.id=String(activeProject.id);form.elements.name.value=activeProject.name;form.elements.description.value=activeProject.description||'';selectAvatar($('.avatar-picker[data-picker="group"]'),activeProject.avatar||'violet');$('#project-dialog-title').textContent='Edit group';$('#save-group').textContent='Save changes';$('.dialog-danger-zone').hidden=true;$('#project-error').textContent='';refreshCharacterCounters(form);$('#project-dialog').showModal();});
  const invite = document.createElement('button'); invite.type='button';invite.textContent='Invite members';invite.hidden = !['owner','admin'].includes(activeProject.role); invite.addEventListener('click', async () => { menu.open=false;$('#group-join-code').textContent = activeProject.join_code; await loadJoinRequests(activeProject.id); $('#invite-dialog').showModal(); });
  const leave=document.createElement('button');leave.type='button';leave.textContent='Leave group';leave.addEventListener('click',async()=>{menu.open=false;const owner=activeProject.role==='owner';if(owner&&activeProject.members.length>1){showMessage('Transfer ownership before leaving this group.');return;}const prompt=owner?`Delete “${activeProject.name}”? As the only member, leaving will delete this group and its shared work.`:`Leave “${activeProject.name}”?`;if(!await requestConfirmation({title:owner?'Delete study group?':'Leave study group?',message:prompt,confirmLabel:owner?'Delete group':'Leave group',danger:true}))return;try{await api(`/api/projects/${activeProject.id}/leave`,{method:'POST'});activeProject=null;location.hash='#/groups';await loadProjects();}catch(error){showMessage(error.message);}});
  const remove=document.createElement('button');remove.type='button';remove.className='menu-danger';remove.textContent='Delete group';remove.hidden=activeProject.role!=='owner';remove.addEventListener('click',async()=>{menu.open=false;if(!await requestConfirmation({title:'Delete study group?',message:`“${activeProject.name}” and all its shared assignments, messages, and history will be removed.`,confirmLabel:'Delete group',danger:true}))return;try{await api(`/api/projects/${activeProject.id}`,{method:'DELETE'});activeProject=null;location.hash='#/groups';await loadProjects();}catch(error){showMessage(error.message);}});
  menuItems.append(editGroup,invite,leave,remove);menu.append(trigger,menuItems);actions.append(addTask,openChat,menu);hero.append(heroMain,actions);head.append(hero);pane.append(head);
  const layout = document.createElement('div'); layout.className = 'group-workspace-grid';
  const plan = document.createElement('section'); plan.className = 'group-plan';
  const taskHeading = document.createElement('div'); taskHeading.className = 'subsection-heading'; const taskTitle = document.createElement('h3'); taskTitle.textContent = 'Shared assignments'; taskHeading.append(taskTitle); plan.append(taskHeading);
  const boardTools=document.createElement('div');boardTools.className='board-tools group-board-tools';
  const searchLabel=document.createElement('label');searchLabel.className='search-box';const search=document.createElement('input');search.id='group-task-search';search.type='search';search.placeholder='Search assignments';search.setAttribute('aria-label','Search group assignments');searchLabel.append(search);
  const courseLabel=document.createElement('label');courseLabel.className='course-filter';const course=document.createElement('select');course.id='group-course-filter';course.setAttribute('aria-label','Filter group assignments by course');courseLabel.append(course);
  const scopeLabel=document.createElement('label');scopeLabel.className='course-filter';const scope=document.createElement('select');scope.id='group-scope-filter';scope.setAttribute('aria-label','Filter group assignments');scope.replaceChildren(new Option('All assignments','all'),new Option('Mine','mine'),new Option('Group','group'));scopeLabel.append(scope);
  boardTools.append(searchLabel,courseLabel,scopeLabel);plan.append(boardTools);
  const groupBoard = document.createElement('div'); groupBoard.id = 'group-task-board';groupBoard.dataset.focusStatus='all'; plan.append(groupBoard);
  search.addEventListener('input',()=>renderFilteredGroupBoard(activeProject));course.addEventListener('change',()=>renderFilteredGroupBoard(activeProject));scope.addEventListener('change',()=>renderFilteredGroupBoard(activeProject));
  const sidebar = document.createElement('aside'); sidebar.className = 'group-sidebar';
  const memberPanel = document.createElement('section'); memberPanel.className = 'group-panel'; const memberHead=document.createElement('div');memberHead.className='group-panel-heading';const memberTitle=document.createElement('h3');memberTitle.textContent='Your team';const memberCountBadge=document.createElement('span');memberCountBadge.className='panel-count';memberCountBadge.textContent=String(activeProject.members.length);memberHead.append(memberTitle,memberCountBadge);memberPanel.append(memberHead);
  activeProject.members.forEach((member) => {
    const row=document.createElement('div');row.className='member-row';
    const avatar=document.createElement('span');avatar.className='avatar small-avatar';setAvatar(avatar,member);
    const copy=document.createElement('div');copy.className='member-copy';const name=document.createElement('strong');name.className='member-name';name.textContent=member.name+(member.id===user.id?' · You':'');
    const role=document.createElement('span');role.className=`member-role role-${member.role||'student'}`;role.textContent=member.legacy_readonly?'Student · read only':({owner:'Owner',admin:'Admin',student:'Student'})[member.role]||'Student';copy.append(name,role);row.append(avatar,copy);
    if(member.id!==user.id){const menu=document.createElement('details');menu.className='member-actions-menu';const trigger=document.createElement('summary');setIcon(trigger,'more');trigger.setAttribute('aria-label',`Actions for ${member.name}`);trigger.title=`Actions for ${member.name}`;const menuItems=document.createElement('div');menuItems.className='member-menu-items';
      const message=document.createElement('button');message.type='button';message.textContent='Message';message.addEventListener('click',()=>{menu.open=false;openDirectConversation(member.id);});menuItems.append(message);
      if(activeProject.role==='owner'&&member.role!=='owner'){
        const change=document.createElement('button');change.type='button';change.textContent=member.role==='admin'?'Make student':'Make admin';change.addEventListener('click',async()=>{menu.open=false;try{await patch(`/api/projects/${activeProject.id}/members/${member.id}`,{role:member.role==='admin'?'student':'admin'});await renderProject(activeProject.id);}catch(error){showMessage(error.message);}});
        const transfer=document.createElement('button');transfer.type='button';transfer.textContent='Transfer ownership';transfer.addEventListener('click',async()=>{menu.open=false;if(!await requestConfirmation({title:'Transfer ownership?',message:`${member.name} will become the group owner. You will become an admin.`,confirmLabel:'Transfer ownership'}))return;try{await post(`/api/projects/${activeProject.id}/transfer-owner`,{user_id:member.id});await renderProject(activeProject.id);}catch(error){showMessage(error.message);}});
        const remove=document.createElement('button');remove.type='button';remove.className='menu-danger';remove.textContent='Remove from group';remove.addEventListener('click',async()=>{menu.open=false;if(!await requestConfirmation({title:'Remove member?',message:`${member.name} will lose access to this group.`,confirmLabel:'Remove member',danger:true}))return;try{await api(`/api/projects/${activeProject.id}/members/${member.id}`,{method:'DELETE'});await renderProject(activeProject.id);}catch(error){showMessage(error.message);}});menuItems.append(change,transfer,remove);
      }
      menu.append(trigger,menuItems);menu.addEventListener('toggle',()=>{if(!menu.open)return;requestAnimationFrame(()=>{const popup=menu.querySelector('.member-menu-items');const bounds=popup.getBoundingClientRect();menu.classList.toggle('opens-up',bounds.bottom>window.innerHeight-12);});});row.append(menu);
    }
    memberPanel.append(row);
  });
  const milestonePanel = document.createElement('section'); milestonePanel.className = 'group-panel milestones-panel'; const milestoneHead = document.createElement('div'); milestoneHead.className = 'subsection-heading'; const milestoneTitle = document.createElement('h3'); milestoneTitle.textContent = 'Milestones'; milestoneHead.append(milestoneTitle); const milestoneAdd = document.createElement('button'); milestoneAdd.className = 'text-button'; milestoneAdd.textContent = '＋ Add'; milestoneAdd.hidden = activeProject.role === 'viewer'; milestoneAdd.addEventListener('click', () => { $('#milestone-form').reset(); $('#milestone-error').textContent = ''; $('#milestone-dialog').showModal(); }); milestoneHead.append(milestoneAdd); milestonePanel.append(milestoneHead); const milestoneList = document.createElement('div'); milestoneList.id = 'milestone-list'; milestonePanel.append(milestoneList);
  sidebar.append(memberPanel, milestonePanel);
  layout.append(plan, sidebar); pane.append(layout);
  await Promise.all([loadProjectBoard(activeProject), loadMilestones(activeProject.id)]);
}

async function loadProjectBoard(project) {
  if (!project) return;
  const items = await loadTasks(project.id);
  groupBoardItems = items;
  const course=$('#group-course-filter');
  if(course){const chosen=course.value;const courses=[...new Set(items.map(task=>task.course).filter(Boolean))].sort();course.replaceChildren(new Option('All courses',''),...courses.map(value=>new Option(value,value)));course.value=courses.includes(chosen)?chosen:'';}
  renderFilteredGroupBoard(project);
  const count=$('#group-assignments-count');if(count&&activeProject&&Number(activeProject.id)===Number(project.id))count.textContent=String(items.length);
}

function renderFilteredGroupBoard(project) {
  const board=$('#group-task-board');if(!board||!project)return;
  const query=($('#group-task-search')?.value||'').trim().toLocaleLowerCase();
  const course=$('#group-course-filter')?.value||'';const scope=$('#group-scope-filter')?.value||'all';
  const filtered=groupBoardItems.filter(task=>{const mine=(task.assignees||[]).some(person=>Number(person.id)===Number(user.id));return(!query||`${task.title} ${task.course||''}`.toLocaleLowerCase().includes(query))&&(!course||task.course===course)&&(scope==='all'||scope==='group'||mine);});
  renderBoard(board,filtered,project,board.dataset.focusStatus||'all',groupBoardItems);
}

async function loadMilestones(projectId) {
  const milestones = await api(`/api/projects/${projectId}/milestones`);
  const list = $('#milestone-list'); if (!list) return;
  list.replaceChildren();
  const milestoneCount=$('#group-milestones-count');if(milestoneCount&&activeProject&&Number(activeProject.id)===Number(projectId))milestoneCount.textContent=String(milestones.length);
  milestones.forEach((milestone) => { const row=document.createElement('div');row.className=`milestone-row ${milestone.status}`;const toggle=document.createElement('button');toggle.type='button';toggle.className='milestone-toggle';toggle.textContent=milestone.status==='done'?'✓':'';toggle.setAttribute('role','checkbox');toggle.setAttribute('aria-checked',String(milestone.status==='done'));toggle.setAttribute('aria-label',`${milestone.status==='done'?'Reopen':'Complete'} ${milestone.title}`);toggle.disabled=activeProject.role==='viewer'||activeProject.legacy_readonly;toggle.addEventListener('click',async()=>{try{await patch(`/api/projects/${projectId}/milestones/${milestone.id}`,{status:milestone.status==='done'?'open':'done'});await loadMilestones(projectId);}catch(error){showMessage(error.message);}});const text=document.createElement('span');text.textContent=milestone.title;text.title=milestone.title;const due=document.createElement('small');due.textContent=milestone.due_date?formatDate(milestone.due_date):'';row.append(toggle,text,due);if(['owner','admin'].includes(activeProject.role)&&!activeProject.legacy_readonly){const actions=document.createElement('div');actions.className='milestone-actions';const edit=document.createElement('button');edit.type='button';edit.className='icon-button';setIcon(edit,'edit');edit.title='Edit milestone';edit.setAttribute('aria-label',`Edit ${milestone.title}`);edit.addEventListener('click',()=>{const form=$('#milestone-form');form.dataset.id=milestone.id;form.elements.title.value=milestone.title;form.elements.due_date.value=milestone.due_date||'';$('#milestone-dialog h2').textContent='Edit milestone';$('#milestone-error').textContent='';$('#milestone-dialog').showModal();});const remove=document.createElement('button');remove.type='button';remove.className='icon-button milestone-delete';setIcon(remove,'trash');remove.title='Delete milestone';remove.setAttribute('aria-label',`Delete ${milestone.title}`);remove.addEventListener('click',async()=>{if(!await requestConfirmation({title:'Delete milestone?',message:`“${milestone.title}” will be removed from this group.`,confirmLabel:'Delete milestone',danger:true}))return;try{await api(`/api/projects/${projectId}/milestones/${milestone.id}`,{method:'DELETE'});await loadMilestones(projectId);}catch(error){showMessage(error.message);}});actions.append(edit,remove);row.append(actions);}list.append(row); });
}

$('#milestone-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { const payload=Object.fromEntries(new FormData(event.currentTarget));if(!payload.due_date)delete payload.due_date;await post(`/api/projects/${activeProject.id}/milestones`,payload); $('#milestone-dialog').close(); await loadMilestones(activeProject.id); }
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
  const avatar=document.createElement('span');avatar.className='avatar message-avatar';setAvatar(avatar,mine?user:{id:message.user_id||message.sender_id,name:message.name||message.sender_name,avatar:message.avatar,profile_photo:message.profile_photo});
  const box=document.createElement('div');box.className='message-content';const meta=document.createElement('div');meta.className='message-meta';meta.textContent=`${message.name||message.sender_name||'Classmate'} · ${time?time.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'Time unavailable'}${message.edited_at?' · edited':''}`;
  const bubble=document.createElement('p');bubble.className='message-bubble';bubble.textContent=message.deleted_at?'Message deleted':message.body||'';if(message.deleted_at)bubble.classList.add('deleted-message');const bubbleRow=document.createElement('div');bubbleRow.className='message-bubble-row';bubbleRow.append(bubble);box.append(meta,bubbleRow);
  if((activeGroupChatId||activeConversation)&&!message.deleted_at){const details=document.createElement('details');details.className='message-menu';const summary=document.createElement('summary');setIcon(summary,'more');summary.setAttribute('aria-label','Message actions');summary.title='Message actions';const menu=document.createElement('div');menu.className='message-menu-items';const add=(label,icon,fn,danger=false)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',label);if(danger)b.className='menu-danger';const glyph=document.createElement('span');glyph.className='menu-icon';glyph.innerHTML=iconMarkup(icon);const text=document.createElement('span');text.textContent=label;b.append(glyph,text);b.addEventListener('click',async()=>{details.open=false;await fn();});menu.append(b);};
    add('Copy message','copy',async()=>{try{await navigator.clipboard.writeText(message.body);}catch{showMessage('Copy is unavailable in this browser.');}});
    if(mine)add('Edit message','edit',async()=>{const next=await requestTextInput({title:'Edit message',message:'Update the message text.',value:message.body,confirmLabel:'Save'});if(next===null)return;try{if(activeGroupChatId){await patch(`/api/projects/${activeGroupChatId}/messages/${message.id}`,{body:next.trim()});await refreshGroupThread();}else{await patch(`/api/direct/conversations/${activeConversation.id}/messages/${message.id}`,{body:next.trim()});lastDirectMessageId=0;await loadDirectMessages();}}catch(error){showMessage(error.message);}});
    if(mine)add('Delete message','trash',async()=>{if(!await requestConfirmation({title:'Delete message?',message:'The message will be replaced with a deleted marker.',confirmLabel:'Delete message',danger:true}))return;try{if(activeGroupChatId){await api(`/api/projects/${activeGroupChatId}/messages/${message.id}`,{method:'DELETE'});await refreshGroupThread();}else{await api(`/api/direct/conversations/${activeConversation.id}/messages/${message.id}`,{method:'DELETE'});lastDirectMessageId=0;await loadDirectMessages();}}catch(error){showMessage(error.message);}},true);
    if(activeGroupChatId && projects.find(p=>p.id===activeGroupChatId)?.role==='owner')add(message.pinned_at?'Unpin message':'Pin message','pin',async()=>{try{await api(`/api/projects/${activeGroupChatId}/messages/${message.id}/pin`,{method:message.pinned_at?'DELETE':'POST'});await refreshGroupThread();}catch(error){showMessage(error.message);}});
    if(activeConversation)add(message.pinned_at?'Unpin message':'Pin message','pin',async()=>{try{await api(`/api/direct/conversations/${activeConversation.id}/messages/${message.id}/pin`,{method:message.pinned_at?'DELETE':'POST'});await loadDirectMessages(true);}catch(error){showMessage(error.message);}});
    details.addEventListener('toggle',()=>{if(details.open){positionMessageMenu(details,mine);closeOtherMenus(details);}});details.append(summary,menu);bubbleRow.append(details);
  }
  if(message.pinned_at){const marker=document.createElement('span');marker.className='pinned-marker';marker.textContent='Pinned';box.append(marker);}
  if(!mine&&!article.classList.contains('grouped'))article.append(avatar);article.append(box);stream.append(article);
}

function ensurePinnedDialog() {
  let dialog=$('#pinned-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='pinned-dialog';dialog.innerHTML='<section class="pinned-panel"><div class="dialog-head"><div class="pinned-heading"><span class="pinned-heading-icon"></span><h2>Pinned messages</h2><span class="pinned-count"></span></div><button type="button" class="icon-button" aria-label="Close pinned messages">×</button></div><div id="pinned-list" class="pinned-list"></div></section>';document.body.append(dialog);$('.pinned-heading-icon',dialog).innerHTML=iconMarkup('pin');$('.icon-button',dialog).addEventListener('click',()=>dialog.close());}return dialog;
}
async function renderPinnedMessages({url,kind,id,canUnpin=true}) {
  const dialog=ensurePinnedDialog();const list=$('#pinned-list',dialog);list.replaceChildren();const pins=await api(url);$('.pinned-count',dialog).textContent=String(pins.length);if(!pins.length){const empty=document.createElement('p');empty.className='pinned-empty';empty.textContent='No pinned messages yet.';list.append(empty);}
  pins.forEach(item=>{const row=document.createElement('article');row.className='pinned-item';row.dataset.pinId=item.id;const content=document.createElement('p');content.className='pinned-content';content.textContent=item.deleted_at?'Message deleted':item.body;const meta=document.createElement('small');meta.className='pinned-meta';meta.textContent=`${item.name||item.sender_name} · ${formatTimestamp(item.created_at)}`;const actions=document.createElement('div');actions.className='pinned-actions';const jump=document.createElement('button');jump.type='button';jump.className='secondary-button';jump.innerHTML=`${iconMarkup('move')}<span>Jump</span>`;jump.addEventListener('click',async()=>{try{let target=$(`[data-message-id="${item.id}"]`);const stream=$('#direct-stream')||$('#chat-stream');if(!target){const path=kind==='group'?`/api/projects/${id}/messages/${item.id}`:`/api/direct/conversations/${id}/messages/${item.id}`;const message=await api(path);appendChatMessage(stream,message,(message.user_id||message.sender_id)===user.id);target=$(`[data-message-id="${item.id}"]`);}dialog.close();target?.scrollIntoView({behavior:'smooth',block:'center'});target?.classList.add('message-highlight');setTimeout(()=>target?.classList.remove('message-highlight'),1800);}catch(error){showMessage(error.message);}});actions.append(jump);if(canUnpin){const unpin=document.createElement('button');unpin.type='button';unpin.className='text-button pinned-unpin';unpin.innerHTML=`${iconMarkup('pin')}<span>Unpin</span>`;unpin.addEventListener('click',async()=>{try{const path=kind==='group'?`/api/projects/${id}/messages/${item.id}/pin`:`/api/direct/conversations/${id}/messages/${item.id}/pin`;await api(path,{method:'DELETE'});row.remove();$('.pinned-count',dialog).textContent=String(Math.max(0,Number($('.pinned-count',dialog).textContent)-1));if(!list.children.length){const empty=document.createElement('p');empty.className='pinned-empty';empty.textContent='No pinned messages yet.';list.append(empty);}}catch(error){showMessage(error.message);}});actions.append(unpin);}row.append(meta,content,actions);list.append(row);});dialog.showModal();
}
async function showPinnedMessages(projectId){return renderPinnedMessages({url:`/api/projects/${projectId}/pinned-messages`,kind:'group',id:projectId,canUnpin:projects.find(p=>Number(p.id)===Number(projectId))?.role==='owner'});}
async function showDirectPinnedMessages(conversationId){return renderPinnedMessages({url:`/api/direct/conversations/${conversationId}/pinned-messages`,kind:'direct',id:conversationId,canUnpin:true});}
function positionMessageMenu(details,mine){const popup=$('.message-menu-items',details);const trigger=$('summary',details);if(!popup||!trigger)return;popup.style.position='fixed';popup.style.visibility='hidden';popup.style.left='0px';popup.style.top='0px';const t=trigger.getBoundingClientRect();const p=popup.getBoundingClientRect();let left=mine?t.left-p.width-10:t.right+10;if(left<8)left=t.right+10;if(left+p.width>innerWidth-8)left=t.left-p.width-10;left=Math.max(8,Math.min(left,innerWidth-p.width-8));let top=Math.min(Math.max(8,t.bottom+4),innerHeight-p.height-8);popup.style.left=`${left}px`;popup.style.top=`${top}px`;popup.style.visibility='visible';}
function enhanceContextMenu(menu){$$('button',menu).forEach(button=>{if(button.querySelector('.menu-icon'))return;const label=button.textContent.trim();if(!label)return;const icon=/delete|remove|clear/i.test(label)?'trash':/edit/i.test(label)?'edit':/pin/i.test(label)?'pin':/copy/i.test(label)?'copy':/message|chat/i.test(label)?'chat':/invite/i.test(label)?'group':/transfer/i.test(label)?'move':/leave/i.test(label)?'close':'more';const glyph=document.createElement('span');glyph.className='menu-icon';glyph.innerHTML=iconMarkup(icon);button.insertBefore(glyph,button.firstChild);if(/delete|remove|block|clear/i.test(label)&&!/sign out/i.test(label))button.classList.add('menu-danger');});}
function closeOtherMenus(keep){$$('details[open]').forEach(menu=>{if(menu!==keep)menu.open=false;});}

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
  groups.forEach((item) => { const button=document.createElement('button'); button.className=`conversation-item ${activeGroupChatId===item.project_id?'selected':''}`; const avatar=document.createElement('span'); avatar.className='avatar group-avatar'; avatar.innerHTML=iconMarkup('book'); avatar.setAttribute('aria-hidden','true'); const content=document.createElement('span'); content.className='conversation-content'; const name=document.createElement('strong'); name.textContent=item.name; const last=document.createElement('small'); last.textContent=item.last_message || 'No messages yet'; const activity=document.createElement('small'); activity.className='conversation-activity'; activity.textContent=formatTimestamp(item.last_message_at || item.created_at); content.append(name,last,activity); button.append(avatar,content); if(item.unread_count){const unread=document.createElement('span');unread.className='unread-pill';unread.textContent=item.unread_count;button.append(unread);} button.addEventListener('click',()=>openGroupConversation(item.project_id)); list.append(button); });
  const peopleLabel=document.createElement('p'); peopleLabel.className='eyebrow'; peopleLabel.textContent='DIRECT'; list.append(peopleLabel);
  conversations.filter((item) => !search || `${item.person_name} ${item.last_message || ''}`.toLowerCase().includes(search)).forEach((conversation) => { const button = document.createElement('button'); button.className = `conversation-item ${activeConversation?.id === conversation.id ? 'selected' : ''}`; const avatar = document.createElement('span'); avatar.className = 'avatar'; setAvatar(avatar,{id:conversation.person_id,name:conversation.person_name,avatar:conversation.person_avatar,profile_photo:conversation.person_profile_photo}); const content = document.createElement('span'); content.className = 'conversation-content'; const name = document.createElement('strong'); name.textContent = conversation.person_name; const last = document.createElement('small'); last.textContent = conversation.last_message || 'No messages yet'; const activity = document.createElement('small'); activity.className = 'conversation-activity'; activity.textContent = formatTimestamp(conversation.last_message_at || conversation.created_at); content.append(name, last, activity); button.append(avatar, content); if (conversation.unread_count) { const unread = document.createElement('span'); unread.className = 'unread-pill'; unread.textContent = conversation.unread_count; button.append(unread); } button.addEventListener('click', () => openConversation(conversation.id)); list.append(button); });
  if (!groups.length && !conversations.length) { const empty=document.createElement('p');empty.className='subtle-empty';empty.textContent='Your group and friend conversations will appear here.';list.append(empty); }
}

$('#conversation-search').addEventListener('input', renderConversations);

async function renderPeople() {
  const requests = await api('/api/friend-requests');
  const incoming = requests.filter((r) => r.direction === 'incoming' && r.status === 'pending');
  const outgoing = requests.filter((r) => r.direction === 'outgoing' && r.status === 'pending');
  const friends = requests.filter((r) => r.status === 'accepted');
  const blocked = requests.filter((r) => r.status === 'blocked');
  const groups=[['incoming','Incoming',incoming],['outgoing','Outgoing',outgoing],['friends','Friends',friends],['blocked','Blocked',blocked]];
  const tabs=$('#people-tabs');tabs.replaceChildren();
  groups.forEach(([kind,label,items])=>{const button=document.createElement('button');button.type='button';button.className=`people-tab ${expandedPeopleList===kind?'active':''}`;button.setAttribute('aria-expanded',String(expandedPeopleList===kind));const text=document.createElement('span');text.textContent=label;const count=document.createElement('strong');count.textContent=items.length;button.append(text,count);button.addEventListener('click',()=>{expandedPeopleList=expandedPeopleList===kind?'':kind;renderPeople();});tabs.append(button);});
  const panel=$('#people-panel');const list=$('#people-panel-list');const current=groups.find(([kind])=>kind===expandedPeopleList);panel.hidden=!current;list.replaceChildren();
  if(!current)return;
  const [kind,label,items]=current;$('#people-panel-title').textContent=label;
  if(!items.length){const empty=document.createElement('p');empty.className='subtle-empty';empty.textContent=kind==='incoming'?'No incoming requests.':kind==='outgoing'?'No pending requests.':kind==='friends'?'No classmates added yet.':'No blocked classmates.';list.append(empty);return;}
  items.forEach(item=>{const row=document.createElement('article');row.className='person-card';const avatar=document.createElement('span');avatar.className='avatar';setAvatar(avatar,{...item,id:item.direction==='incoming'?item.requester_id:item.recipient_id});const info=document.createElement('span');info.className='person-copy';const name=document.createElement('strong');name.textContent=item.name;const handle=document.createElement('small');handle.textContent=`@${item.username}`;info.append(name,handle);row.append(avatar,info);
    const action=(label,fn,cls='secondary-button')=>{const button=document.createElement('button');button.className=cls;button.textContent=label;button.addEventListener('click',async()=>{button.disabled=true;try{await fn();}catch(error){button.disabled=false;showMessage(error.message);}});row.append(button);};
    if(kind==='incoming'){action('Accept',async()=>{await post(`/api/friend-requests/${item.id}/accept`,{});await renderPeople();});action('Decline',async()=>{await post(`/api/friend-requests/${item.id}/decline`,{});await renderPeople();});action('Block',async()=>{if(await requestConfirmation({title:'Block classmate?',message:`@${item.username} will no longer be able to contact you.`,confirmLabel:'Block',danger:true})){await post(`/api/friend-requests/${item.id}/block`,{});await renderPeople();}},'text-button');}
    if(kind==='outgoing')action('Cancel request',async()=>{await api(`/api/friend-requests/${item.id}`,{method:'DELETE'});showMessage(`Request to @${item.username} cancelled.`,'success');await renderPeople();});
    if(kind==='friends')action('Message',()=>openDirectConversation(item.direction==='outgoing'?item.recipient_id:item.requester_id),'primary-button');
    if(kind==='blocked'){const state=document.createElement('small');state.className='relationship-state';state.textContent='Blocked';row.append(state);}
    list.append(row);
  });
}

async function renderPeopleSearch(username, feedback='') {
  const note=$('#friend-search-note'),results=$('#people-results');note.textContent=feedback;note.classList.toggle('success-note',Boolean(feedback));results.replaceChildren();if(username.length<3)return;
  try{const matches=await api(`/api/people/search?q=${encodeURIComponent(username)}`);const person=matches.find(p=>p.username.toLowerCase()===username.toLowerCase());if(!person){if(!feedback)note.textContent='No classmate found. Check the username and try again.';return;}
    const row=document.createElement('article');row.className='person-card';const avatar=document.createElement('span');avatar.className='avatar';setAvatar(avatar,person);const info=document.createElement('span');info.className='person-copy';const name=document.createElement('strong');name.textContent=person.name;const handle=document.createElement('small');handle.textContent=`@${person.username} · ${person.relationship.replace('_',' ')}`;info.append(name,handle);row.append(avatar,info);
    const action=document.createElement('button');action.className=person.relationship==='request_sent'?'secondary-button':'primary-button';
    if(['friends','group_classmate'].includes(person.relationship)){action.textContent='Message';action.addEventListener('click',()=>openDirectConversation(person.id));}
    else if(person.relationship==='request_sent'){action.textContent='Cancel request';action.addEventListener('click',async()=>{action.disabled=true;try{const pending=(await api('/api/friend-requests')).find(r=>r.direction==='outgoing'&&r.status==='pending'&&r.username.toLowerCase()===person.username.toLowerCase());if(pending)await api(`/api/friend-requests/${pending.id}`,{method:'DELETE'});await Promise.all([renderPeople(),renderPeopleSearch(username,`Request to @${person.username} cancelled.`)]);}catch(error){action.disabled=false;note.textContent=error.message;}});}
    else if(person.relationship==='incoming_request'){action.textContent='Accept request';action.addEventListener('click',async()=>{try{const incoming=(await api('/api/friend-requests')).find(r=>r.direction==='incoming'&&r.status==='pending'&&r.username.toLowerCase()===person.username.toLowerCase());if(incoming)await post(`/api/friend-requests/${incoming.id}/accept`,{});await Promise.all([renderPeople(),renderPeopleSearch(username,`Connected with @${person.username}.`)]);}catch(error){note.textContent=error.message;}});}
    else {action.textContent='Add classmate';action.addEventListener('click',async()=>{action.disabled=true;try{await post('/api/friend-requests',{username:person.username});await Promise.all([loadNotifications(),renderPeople(),renderPeopleSearch(username,`Request sent to @${person.username}.`)]);}catch(error){action.disabled=false;note.textContent=error.message;}});}
    row.append(action);results.append(row);
  }catch(error){note.textContent=error.message;}
}

$('#friend-search-form').addEventListener('submit',async event=>{event.preventDefault();const username=new FormData(event.currentTarget).get('username').trim().replace(/^@/,'');if(username.length<3){$('#friend-search-note').textContent='Enter at least 3 characters.';$('#people-results').replaceChildren();return;}await renderPeopleSearch(username);});

async function openGroupConversation(projectId) {
  const project = projects.find(item => item.id === projectId); if (!project) return;
  activeGroupChatId = projectId; activeConversation = null; localStorage.setItem('studypilot-chat', JSON.stringify({kind:'group',id:projectId})); stopPolling();
  const thread=$('#direct-thread');thread.replaceChildren();
  const header=document.createElement('div');header.className='thread-header';const title=document.createElement('h2');title.textContent=project.name;const controls=document.createElement('div');controls.className='thread-controls';const pinned=document.createElement('button');pinned.className='icon-button';setIcon(pinned,'pin');pinned.setAttribute('aria-label','Pinned messages');pinned.title='Pinned messages';pinned.addEventListener('click',()=>showPinnedMessages(projectId));const back=document.createElement('button');back.className='text-button mobile-back';back.textContent='← Conversations';back.addEventListener('click',()=>{$('.inbox').classList.remove('chat-open');});controls.append(pinned,back);header.append(title,controls);
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
  const header = document.createElement('div'); header.className = 'thread-header'; const title = document.createElement('h2'); title.textContent = activeConversation.person_name || 'Private conversation'; const controls=document.createElement('div');controls.className='thread-controls';const pinned=document.createElement('button');pinned.className='icon-button';setIcon(pinned,'pin');pinned.setAttribute('aria-label','Pinned messages');pinned.title='Pinned messages';pinned.addEventListener('click',()=>showDirectPinnedMessages(conversationId));const back=document.createElement('button');back.className='text-button mobile-back';back.textContent='← Conversations';back.addEventListener('click',()=>$('.inbox').classList.remove('chat-open'));controls.append(pinned,back);header.append(title,controls);
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
  try { await loadNotifications(); $('#notifications-dialog').showModal(); }
  catch (error) { showMessage(error.message); }
});

async function loadNotifications() {
  const records = await api('/api/notifications');
  $('#notification-dot').hidden = !records.some((item) => !item.read_at);
  const panel = $('#notifications-list'); panel.replaceChildren();
  if (!records.length) { panel.textContent = 'You’re all caught up.'; syncNotificationSelection(0); return; }
  records.forEach((record) => { const item = document.createElement('article'); item.className = `notification-item ${record.read_at ? '' : 'unread'}`; const check=document.createElement('input');check.type='checkbox';check.className='notification-check';check.value=record.id;check.setAttribute('aria-label',`Select notification from ${record.actor||'StudyPilot'}`);check.addEventListener('change',()=>syncNotificationSelection(records.length));const content=document.createElement('div');content.className='notification-copy'; const text = document.createElement('p'); text.textContent = `${record.actor || 'A teammate'} ${record.detail}`; const time = document.createElement('small'); time.textContent = formatTimestamp(record.created_at);content.append(text,time);if(record.kind==='group_join_request'&&record.project_id&&record.project_name){const link=document.createElement('a');link.className='notification-link';link.href=`#/groups/${record.project_id}?requests=1`;link.textContent=`Manage requests · ${record.project_name}`;link.addEventListener('click',()=>patch('/api/notifications',{action:'read',ids:[record.id]}).catch(()=>{}));content.append(link);}const read=document.createElement('button');read.type='button';read.className='text-button notification-read';read.textContent=record.read_at?'Mark unread':'Mark read';read.addEventListener('click',async()=>{await patch('/api/notifications',{action:record.read_at?'unread':'read',ids:[record.id]});await loadNotifications();});item.append(check,content,read); panel.append(item); });
  syncNotificationSelection(records.length);
}

function syncNotificationSelection(total) {
  const selected=$$('.notification-check:checked').length;$('#notification-selection-count').textContent=`${selected} selected`;
  $('#notification-delete-selected').disabled=!selected;
  const all=$('#notification-select-all');all.checked=total>0&&selected===total;all.indeterminate=selected>0&&selected<total;
}

$('#notification-select-all').addEventListener('change',event=>{$$('.notification-check').forEach(box=>box.checked=event.currentTarget.checked);syncNotificationSelection($$('.notification-check').length);});
$('#notification-delete-selected').addEventListener('click',async()=>{const ids=$$('.notification-check:checked').map(box=>Number(box.value));if(!ids.length)return;try{await patch('/api/notifications',{action:'delete',ids});await loadNotifications();}catch(error){showMessage(error.message);}});
$('#notification-clear-all').addEventListener('click',async()=>{if(!await requestConfirmation({title:'Clear notifications?',message:'All notifications will be removed.',confirmLabel:'Clear all',danger:true}))return;try{await api('/api/notifications',{method:'DELETE'});await loadNotifications();}catch(error){showMessage(error.message);}});

$('#account-button').addEventListener('click', () => { closeOtherMenus(null);$('#account-menu').hidden = !$('#account-menu').hidden; });
document.addEventListener('click', (event) => { if (!event.target.closest('.account-area')) $('#account-menu').hidden = true; });
$('#profile-open').addEventListener('click', () => { $('#account-menu').hidden = true; $('#profile-form').reset(); $('#profile-form').elements.name.value = user.name; $('#profile-form').elements.username.value = user.username; $('#profile-form').elements.bio.value=user.bio||''; $('#profile-email').value = user.email; $('#profile-error').textContent = ''; $('#profile-saved').textContent = ''; setAvatar($('#profile-avatar-preview'),user); $('#profile-avatar-preview').style.backgroundImage=user.profile_photo?`url("/api/profile/photo?v=${user.id}")`:''; $('#profile-dialog').showModal(); });
let profilePreviewUrl='';
$('#profile-photo').addEventListener('change',event=>{const file=event.currentTarget.files[0];if(!file)return;if(profilePreviewUrl)URL.revokeObjectURL(profilePreviewUrl);profilePreviewUrl=URL.createObjectURL(file);$('#profile-avatar-preview').style.backgroundImage=`url("${profilePreviewUrl}")`;});
$('#profile-avatar-preview').addEventListener('click',()=>{const source=profilePreviewUrl||(user.profile_photo?`/api/profile/photo?v=${user.id}`:'');if(!source)return;$('#profile-photo-large').src=source;$('#profile-photo-viewer').showModal();});
$('.profile-photo-close').addEventListener('click',()=>$('#profile-photo-viewer').close());
$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); $('#profile-error').textContent = ''; $('#profile-saved').textContent = '';
  try { const file=$('#profile-photo').files[0];if(file){const form=new FormData();form.append('photo',file);const response=await fetch('/api/profile/photo',{method:'POST',credentials:'same-origin',body:form});if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.detail||'Photo upload failed.');}user.profile_photo=true;} user = await patch('/api/profile', { name: data.name, username: data.username, bio:data.bio }); $('#account-button').setAttribute('aria-label',`Open account menu for ${user.name}`); setAvatar($('#avatar'),user);setAvatar($('#profile-avatar-preview'),user);$('#profile-avatar-preview').style.backgroundImage=user.profile_photo?`url("/api/profile/photo?v=${user.id}&t=${Date.now()}")`:''; $('#profile-saved').textContent = 'Your profile is saved.'; }
  catch (error) { $('#profile-error').textContent = error.message; }
});

$('#settings-open').addEventListener('click',()=>{$('#account-menu').hidden=true;$('#settings-form').reset();selectAvatar($('.avatar-picker[data-picker="person"]'),user.avatar||'violet');$('#settings-form').elements.theme.value=user.theme||'light';$('#settings-error').textContent='';$('#settings-saved').textContent='';$('#settings-dialog').showModal();});
$('#settings-form').addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));$('#settings-error').textContent='';$('#settings-saved').textContent='';try{if(data.new_password){await api('/api/profile/password',{method:'POST',body:JSON.stringify({current_password:data.current_password,new_password:data.new_password})});}user=await patch('/api/profile',{name:user.name,avatar:data.avatar,theme:data.theme});setAvatar($('#avatar'),user);setTheme(user.theme);$('#settings-saved').textContent='Your settings are saved.';}catch(error){$('#settings-error').textContent=error.message;}});

$('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { stopPolling(); user = null; location.hash = '#/dashboard'; $('#app-screen').hidden = true; $('#auth-screen').hidden = false; authMode(false); } });
$$('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));

function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

boot();


document.addEventListener('pointerdown',event=>{const open=$$('details[open]');open.forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});if(!$('#account-menu').contains(event.target)&&!$('#account-button').contains(event.target))$('#account-menu').hidden=true;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeOtherMenus(null);$('#account-menu').hidden=true;}});
document.addEventListener('toggle',event=>{const menu=event.target;if(!(menu instanceof HTMLDetailsElement)||!menu.open)return;closeOtherMenus(menu);$('#account-menu').hidden=true;const popup=menu.querySelector('.message-menu-items,.comment-menu-items,.member-menu-items,.group-menu-items,.task-move-menu');if(!popup)return;enhanceContextMenu(popup);requestAnimationFrame(()=>{menu.classList.remove('opens-up','opens-left');const bounds=popup.getBoundingClientRect();if(bounds.bottom>innerHeight-8)menu.classList.add('opens-up');if(bounds.right>innerWidth-8)menu.classList.add('opens-left');});},true);
document.addEventListener('focusin',event=>{const open=$$('details[open]');open.forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});if(!$('#account-menu').contains(event.target)&&event.target!==$('#account-button'))$('#account-menu').hidden=true;});
window.addEventListener('resize',()=>$$('.message-menu[open]').forEach(menu=>positionMessageMenu(menu,menu.closest('.message-row')?.classList.contains('mine'))));
window.addEventListener('scroll',()=>$$('.message-menu[open]').forEach(menu=>positionMessageMenu(menu,menu.closest('.message-row')?.classList.contains('mine'))),true);
