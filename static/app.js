const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const appMessage = $('#app-message');
let appMessageTimer = null;
let appMessageVersion = 0;
const taskForm = $('#task-form');
let user = null;
let tasks = [];
let groupBoardItems = [];
let projects = [];
let people = [];
let conversations = [];
let groupThreads = [];
let conversationScope = 'groups';
let archivedView = false;
let renamingConversationId = null;
let replyingTo = null;
let calendarMilestones = [];
let activeProject = null;
let activeConversation = null;
let pendingConversationId = null;
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarScope = 'all';
let calendarClickTimer = null;
let calendarSuppressClickUntil = 0;
let pollTimer = null;
let lastGroupMessageId = 0;
let lastDirectMessageId = 0;
let activeGroupChatId = null;
let activeUnreadMarkerId = null;
const dismissedUnreadMarkers = new Set();
let syncInProgress = false;
let notificationFilter='all';
const selectedNotificationIds=new Set();
let showFullArchive = false;
let boardMetric = '';
let activeStatus = 'all';
let expandedPeopleList = '';
let pendingProfilePhotoBlob = null;
let pendingProfilePhotoUrl = '';
let removeProfilePhotoDraft = false;
let photoCropImage = null;
let photoCropSourceUrl = '';
let photoCropOffsetX = 0;
let photoCropOffsetY = 0;
let photoCropDrag = null;

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
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  archive: '<path d="M3 4h18v4H3zM5 8v12h14V8M9 12h6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  rotate: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3"/>',
  pin: '<path d="M8 3h8l-1 5 3 3v2h-5l-.8 7.5L11 22l-1.2-1.5L9 13H4v-2l3-3-1-5Z"/><path d="M7 11h10"/>',
  wave: '<path d="M3 8c2.4 0 2.4-2 4.8-2s2.4 2 4.8 2 2.4-2 4.8-2S19.8 8 22 8M3 13c2.4 0 2.4-2 4.8-2s2.4 2 4.8 2 2.4-2 4.8-2 2.4 2 4.6 2M3 18c2.4 0 2.4-2 4.8-2s2.4 2 4.8 2 2.4-2 4.8-2 2.4 2 4.6 2"/>',
  leaf: '<path d="M20.5 3.5C11 3.7 5.2 5.5 4 11c-.8 3.6 1.3 6 4.5 6.3 5.9.6 10.7-5.4 12-13.8Z"/><path d="M3 21c3.3-5.7 7.3-9.3 13-12"/>',
  flower: '<path d="M12 12c-4-2-4-7 0-7s4 5 0 7Zm0 0c2-4 7-4 7 0s-5 4-7 0Zm0 0c4 2 4 7 0 7s-4-5 0-7Zm0 0c-2 4-7 4-7 0s5-4 7 0Z"/><circle cx="12" cy="12" r="2"/>',
  stars: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 12 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>',
  settings: '<path d="m9 3-.5 2-1.8 1-2-.5-2 3.5L4 11v2l-1.3 2 2 3.5 2-.5 1.8 1 .5 2h6l.5-2 1.8-1 2 .5 2-3.5L20 13v-2l1.3-2-2-3.5-2 .5-1.8-1-.5-2Z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5M16 8l4 4-4 4M8 12h12"/>',
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
  clearTimeout(appMessageTimer);
  appMessageTimer = null;
  const version = ++appMessageVersion;
  appMessage.textContent = message;
  appMessage.className = `app-message ${type}`;
  appMessage.hidden = !message;
  if (message) {
    appMessageTimer = setTimeout(() => {
      if (version !== appMessageVersion) return;
      appMessage.hidden = true;
      appMessage.textContent = '';
      appMessageTimer = null;
    }, type === 'success' ? 3000 : 8000);
  }
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
[['profile-open','profile'],['settings-open','settings'],['logout-button','logout']].forEach(([id,icon])=>{const b=$(`#${id}`);if(b){const label=b.textContent.trim();b.replaceChildren();const glyph=document.createElement('span');glyph.className='menu-icon';glyph.innerHTML=iconMarkup(icon);const text=document.createElement('span');text.textContent=label;b.append(glyph,text);}});
if($('#delete-task'))setIcon($('#delete-task'),'trash');
if($('#month-prev'))setIcon($('#month-prev'),'chevronLeft');
if($('#month-next'))setIcon($('#month-next'),'chevronRight');
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
  if(route.name!=='people')hidePeopleSearchResults();
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
      if (route.id) { await renderProject(route.id); if(route.query.get('requests')==='1'&&['owner','admin'].includes(activeProject?.role)){await loadJoinRequests(route.id);$('#join-requests-dialog').showModal();} }
    }
    if (route.name === 'calendar') {
      tasks = await api('/api/tasks?scope=all');
      await loadProjects();
      await loadCalendarMilestones();
      renderCalendar();
    }
    if (route.name === 'messages') await renderInbox();
    if (route.name === 'people') await renderPeople();
  } catch (error) { showMessage(error.message); }
  startInboxPolling();
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
  const categories=[['done','Done',done],['doing','Doing',activeDoing],['todo','To do',activeTodo],['overdue','Overdue',overdueCount]];const remainder=tasks.length?100-categories.reduce((sum,entry)=>sum+Math.floor(entry[2]/tasks.length*100),0):0;const fractions=categories.map((entry,index)=>({index,fraction:tasks.length?(entry[2]/tasks.length*100)%1:0})).sort((a,b)=>b.fraction-a.fraction);const percents=categories.map(entry=>tasks.length?Math.floor(entry[2]/tasks.length*100):0);fractions.slice(0,remainder).forEach(entry=>percents[entry.index]++);const bar=$('#completion-bar');bar.replaceChildren();bar.setAttribute('aria-label',`${rate}% complete. ${tasks.length} assignments total.`);categories.forEach(([kind,label,count],index)=>{if(!count||!tasks.length)return;const segment=document.createElement('span');segment.className=`progress-segment progress-${kind}`;segment.style.width=`${count/tasks.length*100}%`;segment.setAttribute('aria-label',`${count} ${label.toLowerCase()}, ${percents[index]}%`);bar.append(segment);});const legend=$('#progress-legend');legend.replaceChildren();categories.forEach(([kind,label],index)=>{const item=document.createElement('span');item.className=`progress-legend-item progress-${kind}`;const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');const text=document.createElement('span');text.textContent=`${label} ${percents[index]}%`;item.append(dot,text);legend.append(item);});
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
    const content = document.createElement('div'); content.className = 'lane-cards'; content.tabIndex=0; content.setAttribute('role','region'); content.setAttribute('aria-label',`${statusNames[status]} assignments`);
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
  context.hidden=!context.childElementCount;
  const badges=document.createElement('div');badges.className='task-badges-row';
  if(task.priority)badges.append(makeTag(`${task.priority} priority`,`priority-tag ${task.priority}`));
  const groupAssignment=task.project_id!=null;badges.append(makeTag(groupAssignment?'Group':'Personal',`scope-tag ${groupAssignment?'group':'personal'}`));
  const deadline = document.createElement('p'); deadline.className = `task-deadline ${isOverdue(task) ? 'overdue' : ''}`;
  deadline.textContent = `${isOverdue(task) ? 'Overdue · ' : 'Due · '}${formatDate(task.due_date, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  if(isOverdue(task)){const actual=document.createElement('small');actual.className='underlying-status';actual.textContent=statusNames[task.status];deadline.append(' · ',actual);}
  const description=document.createElement('p');description.className='task-description-preview';description.textContent=task.description||'';description.hidden=!task.description;
  const assignees=document.createElement('div');assignees.className='task-assignees';(task.assignees||[]).slice(0,4).forEach(person=>{const avatar=document.createElement('span');avatar.className='avatar task-assignee-avatar';setAvatar(avatar,person);avatar.title=person.name;avatar.setAttribute('aria-label',person.name);assignees.append(avatar);});if(!(task.assignees||[]).length){const me=document.createElement('span');me.textContent=project?'Unassigned':'You';assignees.append(me);}
  badges.append(assignees);
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
  card.append(titleLine, context, badges, description, deadline, actions);
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

function openNewTask(project, dueDate = null) {
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
  $('#due-date').value = dueDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
  taskForm.dataset.originalTitle = task.title;
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
  if (id && payload.title === taskForm.dataset.originalTitle && payload.title.length > 80) delete payload.title;
  if ($('#assignment-scope').value === 'group' && !id) {
    if (!projectId) { $('#form-error').textContent='Choose a study group.'; return; }
    payload.project_id = Number(projectId);
  }
  if(projectId) payload.assignee_ids = $$('#assignees input:checked').map((input) => Number(input.value));
  $('#form-error').textContent = '';
  try {
    await api(id ? `/api/tasks/${id}` : '/api/tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    $('#task-dialog').close();
    if (routeFromHash().name === 'calendar') tasks = await api('/api/tasks?scope=all'); else await loadTasks();
    if (routeFromHash().name === 'calendar') renderCalendar();
    else if (routeFromHash().name === 'groups' && routeFromHash().id) await renderProject(routeFromHash().id);
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
    if (routeFromHash().name === 'calendar') tasks = await api('/api/tasks?scope=all'); else await loadTasks();
    if (routeFromHash().name === 'calendar') renderCalendar();
    else if (routeFromHash().name === 'groups' && routeFromHash().id) await renderProject(routeFromHash().id);
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
    if(Number(comment.user_id)===Number(user?.id)&&project?.role!=='viewer'&&!project?.legacy_readonly){const actions=document.createElement('div');actions.className='comment-actions';const edit=document.createElement('button');edit.type='button';edit.className='icon-button';setIcon(edit,'edit');edit.title='Edit comment';edit.setAttribute('aria-label','Edit comment');edit.addEventListener('click',()=>{const input=document.createElement('textarea');input.className='comment-edit-input';input.value=comment.body;input.maxLength=2000;const controls=document.createElement('div');controls.className='comment-edit-controls';const save=document.createElement('button');save.type='button';save.className='icon-button';setIcon(save,'check');save.title='Save comment';save.setAttribute('aria-label','Save comment');const cancel=document.createElement('button');cancel.type='button';cancel.className='icon-button';setIcon(cancel,'close');cancel.title='Cancel edit';cancel.setAttribute('aria-label','Cancel edit');copy.replaceChildren(meta,input,controls);controls.append(cancel,save);cancel.addEventListener('click',()=>renderCommentPanel(panel,task,project).catch(error=>showMessage(error.message)));save.addEventListener('click',async()=>{save.disabled=true;try{await patch(`/api/tasks/${task.id}/comments/${comment.id}`,{body:input.value});await renderCommentPanel(panel,task,project);}catch(error){save.disabled=false;showMessage(error.message);}});input.focus();});const remove=document.createElement('button');remove.type='button';remove.className='icon-button comment-delete';setIcon(remove,'trash');remove.title='Delete comment';remove.setAttribute('aria-label','Delete comment');remove.addEventListener('click',async()=>{if(!await requestConfirmation({title:'Delete comment?',message:'This comment will be removed.',confirmLabel:'Delete comment',danger:true}))return;try{await api(`/api/tasks/${task.id}/comments/${comment.id}`,{method:'DELETE'});await renderCommentPanel(panel,task,project);}catch(error){showMessage(error.message);}});actions.append(edit,remove);row.append(actions);}
    stream.append(row);
  });
  panel.append(stream);
  if(project?.role!=='viewer'&&!project?.legacy_readonly){const form=document.createElement('form');form.className='comment-form';const input=document.createElement('textarea');input.name='body';input.maxLength=2000;input.required=true;input.placeholder='Write a comment…';input.setAttribute('aria-label','Comment');const controls=document.createElement('div');controls.className='comment-form-controls';const send=document.createElement('button');send.className='primary-button';send.textContent='Send';controls.append(send);form.append(input,controls);form.addEventListener('submit',async event=>{event.preventDefault();send.disabled=true;try{await post(`/api/tasks/${task.id}/comments`,{body:input.value});await renderCommentPanel(panel,task,project);}catch(error){send.disabled=false;showMessage(error.message);}});panel.append(form);}
}

function renderProjects() {
  const grid = $('#projects-grid'); grid.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement('div'); empty.className = 'group-empty';
    const icon = document.createElement('img'); icon.className = 'group-study-illustration'; icon.src='/static/studypilot-group-study-clay.webp'; icon.alt=''; icon.width=768; icon.height=512; icon.loading='lazy';
    const heading = document.createElement('h2'); heading.textContent = 'No study groups yet';
    empty.append(icon, heading); grid.append(empty); return;
  }
  projects.forEach((project) => {
    const card = document.createElement('article'); card.className = 'project-card'; card.setAttribute('role','link'); card.tabIndex=0; card.setAttribute('aria-label',project.name); card.addEventListener('keydown',event=>{if(event.target===card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();location.hash=`#/groups/${project.id}`;}});
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
    if(Number(project.pending_join_request_count)>0){const requests=document.createElement('button');requests.type='button';requests.className='project-request-badge';requests.innerHTML=`${iconMarkup('group')}<span>${project.pending_join_request_count} join request${Number(project.pending_join_request_count)===1?'':'s'}</span>`;requests.setAttribute('aria-label',`${project.pending_join_request_count} pending join requests for ${project.name}`);requests.addEventListener('click',event=>{event.stopPropagation();location.hash=`#/groups/${project.id}?requests=1`;});card.append(requests);}
    const more=document.createElement('button');more.type='button';more.className='text-button group-description-toggle';more.textContent='Read more';more.hidden=true;more.setAttribute('aria-haspopup','dialog');more.addEventListener('click',event=>{event.stopPropagation();showGroupDescription(project.name,project.description);});copy.append(icon,title,description,more);card.append(copy,metrics);observeDescription(description,more); card.addEventListener('click', () => { location.hash = `#/groups/${project.id}`; }); grid.append(card);
  });
}

$('#new-project').addEventListener('click', () => { $('#project-form').reset(); selectAvatar($('.avatar-picker[data-picker="group"]'),'violet'); $('#project-form').dataset.id=''; $('#project-dialog-title').textContent='Start a study group'; $('#save-group').textContent='Create group'; $('.dialog-danger-zone').hidden=true; $('#project-error').textContent = ''; refreshCharacterCounters($('#project-form')); $('#project-dialog').showModal(); });
$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name=event.currentTarget.elements.name.value.trim();
  if(name.length>50){$('#project-error').textContent='Group name must be 50 characters or fewer.';event.currentTarget.elements.name.focus();return;}
  try { const id=event.currentTarget.dataset.id;const payload=Object.fromEntries(new FormData(event.currentTarget));payload.name=name;if((payload.description||'').length>400){$('#project-error').textContent='Description must be 400 characters or fewer.';event.currentTarget.elements.description.focus();return;}const project=id?await patch(`/api/projects/${id}`,payload):await post('/api/projects',payload); $('#project-dialog').close(); await loadProjects(); if(id&&routeFromHash().name==='groups'&&Number(routeFromHash().id)===Number(project.id)){await renderProject(project.id);if(activeGroupChatId===project.id){const header=$('.thread-header h2');if(header)header.textContent=project.name;await loadConversations();renderConversations();}}else location.hash = `#/groups/${project.id}`; }
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
  try { const requests=await api(`/api/projects/${projectId}/join-requests`); activeProject.pending_join_request_count=requests.length;const requestButton=$('.group-requests-button');if(requestButton)requestButton.textContent=requests.length?`Join requests · ${requests.length}`:'Join requests';$('#join-requests-title').textContent=`Join requests · ${activeProject.name}`; if(!requests.length){box.textContent='No pending requests.';return;}
    requests.forEach((item)=>{const row=document.createElement('article');row.className='person-card join-request-card';const avatar=document.createElement('span');avatar.className='avatar';setAvatar(avatar,{id:item.user_id,name:item.name,avatar:item.avatar,profile_photo:item.profile_photo});const info=document.createElement('span');info.className='person-copy';const name=document.createElement('strong');name.textContent=item.name;const handle=document.createElement('small');handle.textContent=`@${item.username} · ${formatTimestamp(item.created_at)}`;info.append(name,handle);row.append(avatar,info);['approve','reject'].forEach((action)=>{const b=document.createElement('button');b.className=action==='approve'?'primary-button':'secondary-button';b.textContent=action==='approve'?'Accept':'Decline';b.addEventListener('click',async()=>{b.disabled=true;try{await post(`/api/projects/${projectId}/join-requests/${item.id}/${action}`,{});await loadJoinRequests(projectId);await loadProjects();await loadNotifications();}catch(error){b.disabled=false;showMessage(error.message);}});row.append(b);});box.append(row);});
  } catch(error){box.textContent=error.message;}
}

async function loadMyJoinRequests(){
  const box=$('#my-join-requests');box.replaceChildren();
  try{const rows=await api('/api/my/group-join-requests');if(!rows.length){box.textContent='You have not requested to join any groups.';return;}
    rows.forEach(item=>{const row=document.createElement('article');row.className='person-card my-join-request-card';const icon=document.createElement('span');icon.className=`project-icon group-avatar-${item.project_avatar||'violet'}`;icon.innerHTML=avatarMarkup(item.project_avatar||'violet','group');const info=document.createElement('span');info.className='person-copy';const title=document.createElement('strong');title.textContent=item.project_name;const meta=document.createElement('small');meta.textContent=`Requested ${formatTimestamp(item.created_at)}`;info.append(title,meta);const status=document.createElement('span');status.className=`join-request-status ${item.status}`;status.textContent=({pending:'Pending',accepted:'Accepted',declined:'Rejected',cancelled:'Cancelled'})[item.status]||item.status;row.append(icon,info,status);if(item.status==='pending'){const cancel=document.createElement('button');cancel.type='button';cancel.className='text-button';cancel.textContent='Withdraw';cancel.addEventListener('click',async()=>{if(!await requestConfirmation({title:'Withdraw join request?',message:`Cancel your request to join “${item.project_name}”?`,confirmLabel:'Withdraw',danger:true}))return;cancel.disabled=true;try{await api(`/api/my/group-join-requests/${item.id}`,{method:'DELETE'});showMessage(`Request to join “${item.project_name}” withdrawn.`,'success');await loadMyJoinRequests();}catch(error){cancel.disabled=false;showMessage(error.message);}});row.append(cancel);}box.append(row);});
  }catch(error){box.textContent=error.message;}
}

$('#my-join-requests-open').addEventListener('click',async()=>{await loadMyJoinRequests();$('#my-join-requests-dialog').showModal();});

// Overflow is measured from rendered text, including responsive width changes.
const observedDescriptions=new Set();
const descriptionObserver=new ResizeObserver(entries=>{for(const {target} of entries){const toggle=target.nextElementSibling;if(toggle?.classList.contains('group-description-toggle'))toggle.hidden=target.scrollHeight<=target.clientHeight+1;}});
function observeDescription(description,toggle){
  requestAnimationFrame(()=>{for(const node of observedDescriptions){if(!node.isConnected){descriptionObserver.unobserve(node);observedDescriptions.delete(node);}}observedDescriptions.add(description);descriptionObserver.observe(description);toggle.hidden=description.scrollHeight<=description.clientHeight+1;});
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
  const descriptionToggle=document.createElement('button');descriptionToggle.type='button';descriptionToggle.className='text-button group-description-toggle';descriptionToggle.textContent='Read more';descriptionToggle.hidden=true;observeDescription(description,descriptionToggle);descriptionToggle.setAttribute('aria-haspopup','dialog');descriptionToggle.addEventListener('click',()=>showGroupDescription(activeProject.name,activeProject.description));
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
  const invite = document.createElement('button'); invite.type='button';invite.textContent='Invite members';invite.hidden = !['owner','admin'].includes(activeProject.role); invite.addEventListener('click', async () => { menu.open=false;$('#group-join-code').textContent = activeProject.join_code; $('#invite-dialog').showModal(); });
  const leave=document.createElement('button');leave.type='button';leave.textContent='Leave group';leave.addEventListener('click',async()=>{menu.open=false;const owner=activeProject.role==='owner';if(owner&&activeProject.members.length>1){showMessage('Transfer ownership before leaving this group.');return;}const prompt=owner?`Delete “${activeProject.name}”? As the only member, leaving will delete this group and its shared work.`:`Leave “${activeProject.name}”?`;if(!await requestConfirmation({title:owner?'Delete study group?':'Leave study group?',message:prompt,confirmLabel:owner?'Delete group':'Leave group',danger:true}))return;try{await api(`/api/projects/${activeProject.id}/leave`,{method:'POST'});activeProject=null;location.hash='#/groups';await loadProjects();}catch(error){showMessage(error.message);}});
  const remove=document.createElement('button');remove.type='button';remove.className='menu-danger';remove.textContent='Delete group';remove.hidden=activeProject.role!=='owner';remove.addEventListener('click',async()=>{menu.open=false;if(!await requestConfirmation({title:'Delete study group?',message:`“${activeProject.name}” and all its shared assignments, messages, and history will be removed.`,confirmLabel:'Delete group',danger:true}))return;try{await api(`/api/projects/${activeProject.id}`,{method:'DELETE'});activeProject=null;location.hash='#/groups';await loadProjects();}catch(error){showMessage(error.message);}});
  menuItems.append(editGroup,invite,leave,remove);menu.append(trigger,menuItems);actions.append(addTask,openChat,menu);hero.append(heroMain,actions);head.append(hero);pane.append(head);
  if(['owner','admin'].includes(activeProject.role)){const requestsButton=document.createElement('button');requestsButton.type='button';requestsButton.className='secondary-button group-requests-button';const count=Number(activeProject.pending_join_request_count)||0;requestsButton.textContent=count?`Join requests · ${count}`:'Join requests';requestsButton.addEventListener('click',async()=>{await loadJoinRequests(activeProject.id);$('#join-requests-dialog').showModal();});pane.append(requestsButton);}
  const layout = document.createElement('div'); layout.className = 'group-workspace-grid';
  const plan = document.createElement('section'); plan.className = 'group-plan';
  const taskHeading = document.createElement('div'); taskHeading.className = 'subsection-heading'; const taskTitle = document.createElement('h3'); taskTitle.textContent = 'Shared assignments'; taskHeading.append(taskTitle); plan.append(taskHeading);
  const boardTools=document.createElement('div');boardTools.className='board-tools group-board-tools';
  const searchLabel=document.createElement('label');searchLabel.className='search-box';const search=document.createElement('input');search.id='group-task-search';search.type='search';search.placeholder='Search assignments';search.setAttribute('aria-label','Search group assignments');searchLabel.append(search);
  const courseLabel=document.createElement('label');courseLabel.className='course-filter';const course=document.createElement('select');course.id='group-course-filter';course.setAttribute('aria-label','Filter group assignments by course');courseLabel.append(course);
  boardTools.append(searchLabel,courseLabel);plan.append(boardTools);
  const groupBoard = document.createElement('div'); groupBoard.id = 'group-task-board';groupBoard.dataset.focusStatus='all'; plan.append(groupBoard);
  search.addEventListener('input',()=>renderFilteredGroupBoard(activeProject));course.addEventListener('change',()=>renderFilteredGroupBoard(activeProject));
  const sidebar = document.createElement('aside'); sidebar.className = 'group-sidebar';
  const memberPanel = document.createElement('section'); memberPanel.className = 'group-panel'; const memberHead=document.createElement('div');memberHead.className='group-panel-heading';const memberTitle=document.createElement('h3');memberTitle.textContent='Your team';const memberCountBadge=document.createElement('span');memberCountBadge.className='panel-count';memberCountBadge.textContent=String(activeProject.members.length);memberHead.append(memberTitle,memberCountBadge);memberPanel.append(memberHead);
  const memberList=document.createElement('div');memberList.className='member-list';memberList.tabIndex=0;memberList.setAttribute('aria-label','Team members');memberPanel.append(memberList);memberList.addEventListener('scroll',()=>memberList.querySelectorAll('details[open]').forEach(menu=>{menu.open=false;}));
  activeProject.members.forEach((member) => {
    const row=document.createElement('div');row.className='member-row';
    const avatar=document.createElement(member.id===user.id?'span':'button');if(avatar.tagName==='BUTTON')avatar.type='button';avatar.className=`avatar small-avatar${member.id===user.id?'':' profile-trigger'}`;setAvatar(avatar,member);if(member.id!==user.id)avatar.addEventListener('click',()=>openClassmateProfile(member.id));
    const copy=document.createElement('div');copy.className='member-copy';const name=document.createElement(member.id===user.id?'strong':'button');if(name.tagName==='BUTTON'){name.type='button';name.className='member-profile-trigger';name.addEventListener('click',()=>openClassmateProfile(member.id));}name.classList.add('member-name');name.textContent=member.name+(member.id===user.id?' · You':'');
    const role=document.createElement('span');role.className=`member-role role-${member.role||'student'}`;role.textContent=member.legacy_readonly?'Student · read only':({owner:'Owner',admin:'Admin',student:'Student'})[member.role]||'Student';copy.append(name,role);row.append(avatar,copy);
    if(member.id!==user.id){const menu=document.createElement('details');menu.className='member-actions-menu';const trigger=document.createElement('summary');setIcon(trigger,'more');trigger.setAttribute('aria-label',`Actions for ${member.name}`);trigger.title=`Actions for ${member.name}`;const menuItems=document.createElement('div');menuItems.className='member-menu-items';
      const message=document.createElement('button');message.type='button';message.textContent='Message';message.addEventListener('click',()=>{menu.open=false;openDirectConversation(member.id);});menuItems.append(message);
      if(activeProject.role==='owner'&&member.role!=='owner'){
        const change=document.createElement('button');change.type='button';change.textContent=member.role==='admin'?'Make student':'Make admin';change.addEventListener('click',async()=>{menu.open=false;try{await patch(`/api/projects/${activeProject.id}/members/${member.id}`,{role:member.role==='admin'?'student':'admin'});await renderProject(activeProject.id);}catch(error){showMessage(error.message);}});
        const transfer=document.createElement('button');transfer.type='button';transfer.textContent='Transfer ownership';transfer.addEventListener('click',async()=>{menu.open=false;if(!await requestConfirmation({title:'Transfer ownership?',message:`${member.name} will become the group owner. You will become an admin.`,confirmLabel:'Transfer ownership'}))return;try{await post(`/api/projects/${activeProject.id}/transfer-owner`,{user_id:member.id});await renderProject(activeProject.id);}catch(error){showMessage(error.message);}});
        const remove=document.createElement('button');remove.type='button';remove.className='menu-danger';remove.textContent='Remove from group';remove.addEventListener('click',async()=>{menu.open=false;if(!await requestConfirmation({title:'Remove member?',message:`${member.name} will lose access to this group.`,confirmLabel:'Remove member',danger:true}))return;try{await api(`/api/projects/${activeProject.id}/members/${member.id}`,{method:'DELETE'});await renderProject(activeProject.id);}catch(error){showMessage(error.message);}});menuItems.append(change,transfer,remove);
      }
      menu.append(trigger,menuItems);row.append(menu);
    }
    memberList.append(row);
  });
  const milestonePanel = document.createElement('section'); milestonePanel.className = 'group-panel milestones-panel'; const milestoneHead = document.createElement('div'); milestoneHead.className = 'subsection-heading'; const milestoneTitle = document.createElement('h3'); milestoneTitle.textContent = 'Milestones'; milestoneHead.append(milestoneTitle); const milestoneAdd = document.createElement('button'); milestoneAdd.className = 'text-button'; milestoneAdd.textContent = '＋ Add'; milestoneAdd.hidden = activeProject.role === 'viewer'; milestoneAdd.addEventListener('click', () => { $('#milestone-form').reset(); $('#milestone-error').textContent = ''; $('#milestone-dialog').showModal(); }); milestoneHead.append(milestoneAdd); milestonePanel.append(milestoneHead); const milestoneList = document.createElement('div'); milestoneList.id = 'milestone-list';milestoneList.tabIndex=0;milestoneList.setAttribute('aria-label','Milestones'); milestonePanel.append(milestoneList);
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
  const course=$('#group-course-filter')?.value||'';
  const filtered=groupBoardItems.filter(task=>(!query||`${task.title} ${task.course||''}`.toLocaleLowerCase().includes(query))&&(!course||task.course===course));
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
  if(activeUnreadMarkerId===Number(message.id)&&!dismissedUnreadMarkers.has(unreadMarkerKey())){const divider=document.createElement('div');divider.className='new-messages-divider';divider.dataset.unreadDivider='true';divider.innerHTML='<span></span><strong>New messages</strong><span></span>';stream.append(divider);}
  const article=document.createElement('article');article.className=`message-row ${mine?'mine':'incoming'} ${last&&last.dataset.sender===String(message.user_id||message.sender_id)&&last.dataset.day===day?'grouped':''} ${message.pinned_at?'is-pinned':''}`;article.dataset.messageId=message.id;article.dataset.sender=message.user_id||message.sender_id;article.dataset.day=day;
  const sender={id:message.user_id||message.sender_id,name:message.name||message.sender_name,avatar:message.avatar,profile_photo:message.profile_photo};const avatar=document.createElement(mine?'span':'button');if(!mine)avatar.type='button';avatar.className=`avatar message-avatar${mine?'':' profile-trigger'}`;setAvatar(avatar,mine?user:sender);if(!mine)avatar.addEventListener('click',()=>openClassmateProfile(sender.id));
  const box=document.createElement('div');box.className='message-content';const meta=document.createElement('div');meta.className='message-meta';if(!mine){const author=document.createElement('button');author.type='button';author.className='message-author-trigger';author.textContent=sender.name||'Classmate';author.addEventListener('click',()=>openClassmateProfile(sender.id));meta.append(author,' · ');}else meta.append(document.createTextNode('You · '));meta.append(document.createTextNode(`${time?time.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'Time unavailable'}${message.edited_at?' · edited':''}`));
  if(message.reply_to_id){const quote=document.createElement('button');quote.type='button';quote.className='message-reply-quote';quote.textContent=message.reply_deleted_at?'Original message deleted':(message.reply_body||'Original message unavailable').slice(0,180);quote.setAttribute('aria-label','Jump to replied message');quote.addEventListener('click',()=>jumpToMessage(message.reply_to_id));box.append(quote);}
  const bubble=document.createElement('p');bubble.className='message-bubble';bubble.textContent=message.deleted_at?'Message deleted':message.body||'';if(message.deleted_at)bubble.classList.add('deleted-message');const bubbleRow=document.createElement('div');bubbleRow.className='message-bubble-row';bubbleRow.append(bubble);box.append(meta,bubbleRow);
  if(message.pinned_at){const canUnpin=Boolean(activeConversation)||(activeGroupChatId&&projects.find(p=>Number(p.id)===Number(activeGroupChatId))?.role==='owner');const pin=document.createElement(canUnpin?'button':'span');pin.className='pinned-marker';if(canUnpin){pin.type='button';pin.setAttribute('aria-label','Unpin message');pin.title='Unpin message';pin.addEventListener('click',async event=>{event.stopPropagation();dismissUnreadDivider();try{const path=activeGroupChatId?`/api/projects/${activeGroupChatId}/messages/${message.id}/pin`:`/api/direct/conversations/${activeConversation.id}/messages/${message.id}/pin`;await api(path,{method:'DELETE'});if(activeGroupChatId)await refreshGroupThread(true);else await loadDirectMessages(true);}catch(error){showMessage(error.message);}});}setIcon(pin,'pin');bubbleRow.append(pin);}
  if((activeGroupChatId||activeConversation)&&!message.deleted_at){const details=document.createElement('details');details.className='message-menu';const summary=document.createElement('summary');setIcon(summary,'more');summary.setAttribute('aria-label','Message actions');summary.title='Message actions';const menu=document.createElement('div');menu.className='message-menu-items';const add=(label,icon,fn,danger=false)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',label);if(danger)b.className='menu-danger';const glyph=document.createElement('span');glyph.className='menu-icon';glyph.innerHTML=iconMarkup(icon);const text=document.createElement('span');text.textContent=label;b.append(glyph,text);b.addEventListener('click',async()=>{details.open=false;dismissUnreadDivider();await fn();});menu.append(b);};
    add('Copy message','copy',async()=>{try{await navigator.clipboard.writeText(message.body);}catch{showMessage('Copy is unavailable in this browser.');}});
    add('Reply','comment',async()=>{setReplyTarget(message);});
    if(mine)add('Edit message','edit',async()=>{const next=await requestTextInput({title:'Edit message',message:'Update the message text.',value:message.body,confirmLabel:'Save'});if(next===null)return;try{if(activeGroupChatId){await patch(`/api/projects/${activeGroupChatId}/messages/${message.id}`,{body:next.trim()});await refreshGroupThread();}else{await patch(`/api/direct/conversations/${activeConversation.id}/messages/${message.id}`,{body:next.trim()});lastDirectMessageId=0;await loadDirectMessages();}}catch(error){showMessage(error.message);}});
    if(mine)add('Delete message','trash',async()=>{if(!await requestConfirmation({title:'Delete message?',message:'The message will be replaced with a deleted marker.',confirmLabel:'Delete message',danger:true}))return;try{if(activeGroupChatId){await api(`/api/projects/${activeGroupChatId}/messages/${message.id}`,{method:'DELETE'});await refreshGroupThread();}else{await api(`/api/direct/conversations/${activeConversation.id}/messages/${message.id}`,{method:'DELETE'});lastDirectMessageId=0;await loadDirectMessages();}}catch(error){showMessage(error.message);}},true);
    if(activeGroupChatId && projects.find(p=>p.id===activeGroupChatId)?.role==='owner')add(message.pinned_at?'Unpin message':'Pin message','pin',async()=>{try{await api(`/api/projects/${activeGroupChatId}/messages/${message.id}/pin`,{method:message.pinned_at?'DELETE':'POST'});await refreshGroupThread(true);}catch(error){showMessage(error.message);}});
    if(activeConversation)add(message.pinned_at?'Unpin message':'Pin message','pin',async()=>{try{await api(`/api/direct/conversations/${activeConversation.id}/messages/${message.id}/pin`,{method:message.pinned_at?'DELETE':'POST'});await loadDirectMessages(true);}catch(error){showMessage(error.message);}});
    details.addEventListener('toggle',()=>{if(details.open){positionMessageMenu(details,mine);closeOtherMenus(details);}});details.append(summary,menu);bubbleRow.append(details);
  }
  if(!mine)article.append(avatar);article.append(box);stream.append(article);
}

function setReplyTarget(message){replyingTo={id:message.id,body:message.deleted_at?'Message deleted':message.body||'',deleted:Boolean(message.deleted_at)};const form=$('.direct-form');if(!form)return;let preview=$('.reply-preview',form);if(!preview){preview=document.createElement('div');preview.className='reply-preview';preview.setAttribute('role','status');form.prepend(preview);}preview.replaceChildren();const label=document.createElement('span');label.textContent=`Replying to ${message.name||message.sender_name||'message'}`;const text=document.createElement('small');text.textContent=replyingTo.deleted?'Original message deleted':replyingTo.body.slice(0,180);const cancel=document.createElement('button');cancel.type='button';cancel.className='icon-button';cancel.setAttribute('aria-label','Cancel reply');setIcon(cancel,'close');cancel.addEventListener('click',clearReplyTarget);preview.append(label,text,cancel);preview.hidden=false;$('.direct-form input')?.focus();}
function clearReplyTarget(){replyingTo=null;const preview=$('.reply-preview');if(preview){preview.hidden=true;preview.replaceChildren();}}
async function jumpToMessage(messageId){let target=$(`[data-message-id="${messageId}"]`);if(!target){try{const path=activeGroupChatId?`/api/projects/${activeGroupChatId}/messages/${messageId}`:`/api/direct/conversations/${activeConversation?.id}/messages/${messageId}`;const message=await api(path);const stream=$('#direct-stream');if(stream)appendChatMessage(stream,message,(message.user_id||message.sender_id)===user.id);target=$(`[data-message-id="${messageId}"]`);}catch(error){showMessage(error.message.includes('404')?'That original message is no longer available.':error.message);return;}}target?.scrollIntoView({behavior:'smooth',block:'center'});target?.classList.add('message-highlight');setTimeout(()=>target?.classList.remove('message-highlight'),1800);}

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
  const heading = $('#calendar-month');
  heading.textContent = calendarCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $$('[data-calendar-scope]').forEach(button => { const selected=button.dataset.calendarScope===calendarScope;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected)); });
  const scopedTasks = tasks.filter(task => calendarScope === 'all' || (calendarScope === 'personal' ? !task.project_id : Boolean(task.project_id)));
  const scopedMilestones = calendarScope === 'personal' ? [] : calendarMilestones;
  const grid = $('#calendar-grid'); grid.replaceChildren();
  const first = new Date(year, month, 1); const offset = (first.getDay() + 6) % 7; const start = new Date(year, month, 1 - offset);
  for (let i = 0; i < 42; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const cell = document.createElement('div'); cell.className = `calendar-day ${date.getMonth() !== month ? 'outside' : ''} ${date.toDateString() === todayLocal().toDateString() ? 'today' : ''}`;cell.dataset.date=dateKey;cell.setAttribute('aria-label',date.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}));
    const number = document.createElement('span'); number.className = 'day-number'; number.textContent = date.getDate(); cell.append(number);
    const matching = scopedTasks.filter((task) => task.due_date === dateKey);
    const milestones = scopedMilestones.filter((milestone) => milestone.due_date === dateKey);
    const events = [...matching.map((task) => ({ kind: 'task', value: task })), ...milestones.map((milestone) => ({ kind: 'milestone', value: milestone }))];
    events.slice(0, 3).forEach(({ kind, value }) => {
      const event = document.createElement('div');
      const overdue = kind==='task' && isOverdue(value);
      event.className = kind === 'task' ? `calendar-event ${value.status}${overdue?' overdue':''}` : 'calendar-event milestone-event';
      const openEvent=document.createElement('button');openEvent.type='button';openEvent.className='calendar-event-main';
      openEvent.textContent = kind === 'task' ? value.title : `◆ ${value.title}`;
      openEvent.title = kind === 'task' ? `${value.title} · ${overdue?'Overdue':statusNames[value.status]}` : `${value.project_name} · milestone`;
      openEvent.setAttribute('aria-label',kind==='task'?`${value.title}, ${overdue?'overdue':statusNames[value.status]}. Click to view, double-click to edit.`:`${value.project_name}: ${value.title}, milestone`);
      if(kind==='task'){
        const editable=calendarCanEdit(value);event.draggable=editable;if(editable)event.dataset.draggable='true';
        openEvent.addEventListener('click',()=>{if(Date.now()<calendarSuppressClickUntil)return;if(calendarClickTimer)clearTimeout(calendarClickTimer);calendarClickTimer=setTimeout(()=>{calendarClickTimer=null;showCalendarTask(value);},240);});
        openEvent.addEventListener('dblclick',event=>{event.preventDefault();if(Date.now()<calendarSuppressClickUntil)return;if(calendarClickTimer)clearTimeout(calendarClickTimer);calendarClickTimer=null;if(calendarCanEdit(value))openEditTask(value,calendarProject(value));else showCalendarTask(value);});
        event.addEventListener('dragstart',event=>{if(!editable){event.preventDefault();return;}calendarSuppressClickUntil=Date.now()+700;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(value.id));requestAnimationFrame(()=>event.currentTarget.classList.add('dragging'));});
        event.addEventListener('dragend',()=>{event.classList.remove('dragging');calendarSuppressClickUntil=Date.now()+700;});
        if(editable){
          const remove=document.createElement('button');remove.type='button';remove.className='calendar-event-delete';remove.setAttribute('aria-label',`Delete ${value.title}`);remove.title='Delete assignment';remove.innerHTML=iconMarkup('trash');
          const stopChipAction=event=>{event.stopPropagation();};
          ['pointerdown','mousedown','touchstart','click','dblclick','dragstart'].forEach(type=>remove.addEventListener(type,stopChipAction));
          remove.addEventListener('click',async()=>{if(!await requestConfirmation({title:'Delete assignment?',message:'This assignment and its comments will be removed.',confirmLabel:'Delete assignment',danger:true}))return;try{await api(`/api/tasks/${value.id}`,{method:'DELETE'});tasks=await api('/api/tasks?scope=all');renderCalendar();}catch(error){showMessage(error.message);}});
          event.append(openEvent,remove);
        }else event.append(openEvent);
      } else {openEvent.addEventListener('click',()=>{if(calendarClickTimer)clearTimeout(calendarClickTimer);location.hash=`#/groups/${value.project_id}`;});event.append(openEvent);}
      cell.append(event);
    });
    if (events.length > 3) { const more = document.createElement('button');more.type='button';more.className='calendar-more';more.textContent = `+${events.length - 3} more`;more.setAttribute('aria-label',`Show ${events.length-3} more items for ${date.toLocaleDateString(undefined,{month:'long',day:'numeric'})}`);more.addEventListener('click',event=>{event.stopPropagation();showCalendarOverflow(date,events.slice(3));});cell.append(more); }
    cell.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('text/plain')){event.preventDefault();event.dataTransfer.dropEffect='move';cell.classList.add('drop-target');}});
    cell.addEventListener('dragleave',event=>{if(!cell.contains(event.relatedTarget))cell.classList.remove('drop-target');});
    cell.addEventListener('drop',async event=>{event.preventDefault();cell.classList.remove('drop-target');const id=Number(event.dataTransfer.getData('text/plain'));const task=tasks.find(item=>Number(item.id)===id);if(!task||!calendarCanEdit(task)||task.due_date===dateKey)return;calendarSuppressClickUntil=Date.now()+800;await rescheduleCalendarTask(task,dateKey);});
    cell.addEventListener('click',event=>{if(event.target.closest('button,.calendar-more,.calendar-event'))return;openNewTask(null,dateKey);});
    grid.append(cell);
  }
}

$('#month-prev').addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1); renderCalendar(); });
$('#month-next').addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1); renderCalendar(); });
$('#calendar-today').addEventListener('click',()=>{calendarCursor=new Date(todayLocal().getFullYear(),todayLocal().getMonth(),1);renderCalendar();});

function calendarProject(task){return task.project_id?projects.find(project=>Number(project.id)===Number(task.project_id))||null:null;}
function calendarCanEdit(task){if(!task.project_id)return Number(task.owner_id)===Number(user?.id);const project=calendarProject(task);return Boolean(project&&project.role!=='viewer'&&!project.legacy_readonly);}
function showCalendarTask(task){let dialog=$('#calendar-view-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='calendar-view-dialog';document.body.append(dialog);}const project=calendarProject(task);dialog.replaceChildren();const panel=document.createElement('section');panel.className='calendar-view-panel';const head=document.createElement('div');head.className='dialog-head';const title=document.createElement('h2');title.textContent=task.title;const close=document.createElement('button');close.type='button';close.className='icon-button';close.setAttribute('aria-label','Close assignment details');setIcon(close,'close');close.addEventListener('click',()=>dialog.close());head.append(title,close);panel.append(head);const details=document.createElement('dl');details.className='calendar-task-details';[['Course',task.course||'—'],['Due date',formatDate(task.due_date)],['Status',statusNames[task.status]||task.status],['Priority',task.priority],...(project?[['Study group',project.name]]:[])].forEach(([label,value])=>{const row=document.createElement('div');const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value;row.append(dt,dd);details.append(row);});panel.append(details);if(task.description){const notes=document.createElement('p');notes.className='calendar-task-notes';notes.textContent=task.description;panel.append(notes);}const actions=document.createElement('div');actions.className='dialog-actions';const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='secondary-button';dismiss.textContent='Close';dismiss.addEventListener('click',()=>dialog.close());actions.append(dismiss);if(calendarCanEdit(task)){const reschedule=document.createElement('button');reschedule.type='button';reschedule.className='secondary-button';reschedule.textContent='Reschedule';reschedule.addEventListener('click',()=>{const form=document.createElement('form');form.className='calendar-reschedule';const label=document.createElement('label');label.className='field';label.textContent='New due date';const date=document.createElement('input');date.type='date';date.required=true;date.value=task.due_date;label.append(date);const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary-button';cancel.textContent='Cancel';const save=document.createElement('button');save.type='submit';save.className='primary-button';save.textContent='Review change';form.append(label,cancel,save);cancel.addEventListener('click',()=>form.remove());form.addEventListener('submit',async event=>{event.preventDefault();await rescheduleCalendarTask(task,date.value);});actions.replaceChildren(dismiss);panel.append(form);date.focus();});actions.append(reschedule);}panel.append(actions);dialog.append(panel);dialog.showModal();}
async function rescheduleCalendarTask(task,dateKey){if(!calendarCanEdit(task))return;if(!await requestConfirmation({title:'Reschedule assignment?',message:`Move “${task.title}” from ${formatDate(task.due_date)} to ${formatDate(dateKey)}?`,confirmLabel:'Reschedule'}))return;try{await patch(`/api/tasks/${task.id}`,{due_date:dateKey});if($('#calendar-view-dialog')?.open)$('#calendar-view-dialog').close();tasks=await api('/api/tasks?scope=all');renderCalendar();showMessage('Assignment rescheduled.','success');}catch(error){showMessage(error.message);}}
function showCalendarOverflow(date,items){let dialog=$('#calendar-overflow-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='calendar-overflow-dialog';document.body.append(dialog);}dialog.replaceChildren();const panel=document.createElement('section');panel.className='calendar-overflow-panel';const head=document.createElement('div');head.className='dialog-head';const title=document.createElement('h2');title.textContent=date.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});const close=document.createElement('button');close.type='button';close.className='icon-button';close.setAttribute('aria-label','Close day assignments');setIcon(close,'close');close.addEventListener('click',()=>dialog.close());head.append(title,close);const list=document.createElement('div');list.className='calendar-overflow-list';items.forEach(({kind,value})=>{const button=document.createElement('button');button.type='button';button.className=`calendar-overflow-item ${kind==='task'?(isOverdue(value)?'overdue':value.status):'milestone-event'}`;const name=document.createElement('strong');name.textContent=kind==='task'?value.title:`◆ ${value.title}`;const meta=document.createElement('small');meta.textContent=kind==='task'?`${value.course||'Assignment'} · ${isOverdue(value)?'Overdue':statusNames[value.status]||value.status}`:`${value.project_name} · Milestone`;button.append(name,meta);button.addEventListener('click',()=>{dialog.close();if(kind==='task')showCalendarTask(value);else location.hash=`#/groups/${value.project_id}`;});list.append(button);});panel.append(head,list);dialog.append(panel);dialog.showModal();}
function normalizeCalendarYear(value,fallback=calendarCursor.getFullYear()){if(String(value).trim()==='')return Math.max(1900,Math.min(2100,fallback));const numeric=Number(value);if(!Number.isFinite(numeric))return Math.max(1900,Math.min(2100,fallback));return Math.max(1900,Math.min(2100,Math.trunc(numeric)));}
function openCalendarMonthPicker(){
  const picker=$('#calendar-month-picker');
  if(!picker.hidden){picker.hidden=true;$('#calendar-month').setAttribute('aria-expanded','false');return;}
  picker.replaceChildren();
  const yearRow=document.createElement('div');yearRow.className='calendar-year-row';
  const year=document.createElement('input');year.id='calendar-year-input';year.type='number';year.min='1900';year.max='2100';year.step='1';year.value=String(calendarCursor.getFullYear());year.setAttribute('aria-label','Calendar year');
  const previousYear=document.createElement('button');previousYear.type='button';previousYear.className='icon-button calendar-year-arrow';previousYear.setAttribute('aria-label','Previous year');setIcon(previousYear,'chevronLeft');
  const nextYear=document.createElement('button');nextYear.type='button';nextYear.className='icon-button calendar-year-arrow';nextYear.setAttribute('aria-label','Next year');setIcon(nextYear,'chevronRight');
  const syncYearControls=()=>{const selected=normalizeCalendarYear(year.value);previousYear.disabled=selected<=1900;nextYear.disabled=selected>=2100;};
  const applyYear=()=>{const next=normalizeCalendarYear(year.value);year.value=String(next);calendarCursor=new Date(next,calendarCursor.getMonth(),1);syncYearControls();renderCalendar();};
  const changeYear=amount=>{const next=Math.max(1900,Math.min(2100,normalizeCalendarYear(year.value)+amount));year.value=String(next);applyYear();};
  previousYear.addEventListener('click',()=>changeYear(-1));nextYear.addEventListener('click',()=>changeYear(1));
  const months=document.createElement('div');months.className='calendar-month-options';
  const monthNames=Array.from({length:12},(_,index)=>new Date(2024,index,1).toLocaleDateString(undefined,{month:'short'}));
  monthNames.forEach((name,index)=>{const button=document.createElement('button');button.type='button';button.textContent=name;button.className=index===calendarCursor.getMonth()?'selected':'';button.addEventListener('click',()=>{const next=normalizeCalendarYear(year.value);calendarCursor=new Date(next,index,1);picker.hidden=true;$('#calendar-month').setAttribute('aria-expanded','false');renderCalendar();});months.append(button);});
  year.addEventListener('change',applyYear);year.addEventListener('blur',()=>{if(year.value==='')year.value=String(calendarCursor.getFullYear());else applyYear();});year.addEventListener('pointerdown',()=>year.dataset.pointerFocus='true');year.addEventListener('keydown',()=>delete year.dataset.pointerFocus);
  year.addEventListener('wheel',event=>{event.preventDefault();if(!event.deltaY)return;const current=normalizeCalendarYear(year.value);const next=Math.max(1900,Math.min(2100,current+(event.deltaY<0?1:-1)));if(next===current)return;year.value=String(next);applyYear();},{passive:false});
  syncYearControls();yearRow.append(previousYear,year,nextYear);picker.append(yearRow,months);picker.hidden=false;$('#calendar-month').setAttribute('aria-expanded','true');
}
$('#calendar-month').addEventListener('click',openCalendarMonthPicker);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#calendar-month-picker').hidden){$('#calendar-month-picker').hidden=true;$('#calendar-month').setAttribute('aria-expanded','false');$('#calendar-month').focus();}});
document.addEventListener('click',event=>{const picker=$('#calendar-month-picker');if(!picker.hidden&&!event.target.closest('.calendar-month-wrap')){picker.hidden=true;$('#calendar-month').setAttribute('aria-expanded','false');}});
$$('[data-calendar-scope]').forEach(button=>button.addEventListener('click',()=>{calendarScope=button.dataset.calendarScope;renderCalendar();}));

async function renderInbox() {
  await Promise.all([loadProjects(), loadConversations()]);
  groupThreads = await api(`/api/group-conversations${archivedView?'?archived=true':''}`);
  renderConversations();
  const targetId = pendingConversationId;
  pendingConversationId = null;
  const groupId = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('group'));
  const saved = (() => { try { return JSON.parse(localStorage.getItem('studypilot-chat') || 'null'); } catch { return null; } })();
  if (groupId && projects.some((item) => item.id === groupId)) await openGroupConversation(groupId);
  else if (targetId && conversations.some((item) => item.id === targetId)) await openConversation(targetId);
  else if (saved?.kind === 'group' && projects.some((item) => item.id === saved.id)) await openGroupConversation(saved.id);
  else if (saved?.kind === 'direct' && conversations.some((item) => item.id === saved.id)) await openConversation(saved.id);
  else if (!activeConversation && !activeGroupChatId) {
    $('#direct-thread').innerHTML = '<div class="thread-empty"><span class="empty-check">↗</span><h2>Choose a conversation</h2><p>Select a classmate or a study group on the left.</p></div>';
    stopPolling();
  }
}

async function loadConversations() { conversations = await api(`/api/direct/conversations${archivedView?'?archived=true':''}`); updateUnreadCount(); }

function updateUnreadCount() {
  const unread = conversations.reduce((total, conversation) => total + conversation.unread_count, 0) + groupThreads.reduce((total, conversation) => total + conversation.unread_count, 0);
  const badge = $('#message-count'); badge.hidden = unread === 0; badge.textContent = unread > 99 ? '99+' : unread;
}

function startInboxPolling(){stopPolling();if(!user)return;pollTimer=setInterval(async()=>{if(document.hidden||syncInProgress||!user)return;syncInProgress=true;try{const [direct,groups,notifications]=await Promise.all([api(`/api/direct/conversations${archivedView?'?archived=true':''}`),api(`/api/group-conversations${archivedView?'?archived=true':''}`),api('/api/notifications')]);conversations=direct;groupThreads=groups;updateUnreadCount();$('#notification-dot').hidden=!notifications.some(item=>!item.read_at);if(routeFromHash().name==='messages'&&!$('.conversation-actions-menu[open]'))renderConversations();if(activeConversation&&routeFromHash().name==='messages'){activeUnreadMarkerId=Number(conversations.find(item=>Number(item.id)===Number(activeConversation.id))?.first_unread_message_id)||null;await loadDirectMessages(false,lastMessageFullyVisible($('#direct-stream')));}else if(activeGroupChatId&&routeFromHash().name==='messages'){activeUnreadMarkerId=Number(groupThreads.find(item=>Number(item.project_id)===Number(activeGroupChatId))?.first_unread_message_id)||null;await refreshGroupThread();}}catch{/* Keep existing messages visible during temporary network failures. */}finally{syncInProgress=false;}},4000);}

function renderConversations() {
  if($('.conversation-actions-menu[open]'))return;
  const list=$('#conversation-list');list.replaceChildren();
  const search=($('#conversation-search')?.value||'').trim().toLowerCase();
  const groups=groupThreads.filter(item=>!search||`${item.name} ${item.last_message||''}`.toLowerCase().includes(search));
  const directs=conversations.filter(item=>!search||`${item.display_name||item.person_name} ${item.person_name} ${item.last_message||''}`.toLowerCase().includes(search));
  const tabs=$('#conversation-tabs');tabs.replaceChildren();
  [['groups','Groups',groupThreads,groups],['direct','Direct',conversations,directs]].forEach(([kind,label,all,filtered])=>{const tab=document.createElement('button');tab.type='button';tab.className=`conversation-tab ${conversationScope===kind?'active':''}`;tab.id=`conversation-tab-${kind}`;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(conversationScope===kind));tab.setAttribute('aria-controls','conversation-list');tab.tabIndex=conversationScope===kind?0:-1;const title=document.createElement('span');title.textContent=label;const count=document.createElement('strong');count.textContent=String(all.length);tab.append(title,count);const unreadTotal=all.reduce((sum,item)=>sum+(Number(item.unread_count)||0),0);if(unreadTotal){const unread=document.createElement('small');unread.className='tab-unread';unread.textContent=`${unreadTotal} unread`;tab.append(unread);}tab.addEventListener('click',()=>{conversationScope=kind;renderConversations();});tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();conversationScope=kind==='groups'?'direct':'groups';renderConversations();$(`#conversation-tab-${conversationScope}`).focus();});tabs.append(tab);});
  const toggle=$('#archived-conversations-toggle');if(toggle){toggle.textContent=archivedView?'Back to conversations':'View archived';toggle.setAttribute('aria-pressed',String(archivedView));}
  const isGroups=conversationScope==='groups';const activeItems=isGroups?groups:directs;
  const refreshLists=async()=>{const [nextGroups,nextDirects]=await Promise.all([api(`/api/group-conversations${archivedView?'?archived=true':''}`),api(`/api/direct/conversations${archivedView?'?archived=true':''}`)]);groupThreads=nextGroups;conversations=nextDirects;updateUnreadCount();renderConversations();};
  const action=async(kind,item,verb)=>{const id=isGroups?item.project_id:item.id;const path=`/api/${kind}-conversations/${id}/state`;if(verb==='clear'&&!await requestConfirmation({title:'Clear chat for me?',message:'This hides the conversation history only for your account. New messages will still appear.',confirmLabel:'Clear chat',danger:true}))return;try{await patch(path,{action:verb});await refreshLists();if(verb==='clear'&&((kind==='group'&&Number(activeGroupChatId)===Number(id))||(kind==='direct'&&Number(activeConversation?.id)===Number(id)))){activeUnreadMarkerId=null;if(kind==='group')await refreshGroupThread(true);else await loadDirectMessages(true,false);}}catch(error){showMessage(error.message);}};
  const makeMenu=(kind,item)=>{const details=document.createElement('details');details.className='conversation-actions-menu';const summary=document.createElement('summary');summary.setAttribute('aria-label',`Conversation actions for ${kind==='group'?item.name:(item.display_name||item.person_name)}`);summary.title='Conversation actions';const popup=document.createElement('div');popup.className='conversation-action-list';const entries=[['pin',item.pinned?'Unpin conversation':'Pin conversation','pin'],[Number(item.unread_count)>0?'read':'unread',Number(item.unread_count)>0?'Mark as read':'Mark as unread','eye'],[archivedView?'unarchive':'archive',archivedView?'Unarchive conversation':'Archive conversation','archive']];if(kind==='direct')entries.push(['nickname','Rename chat','edit']);entries.push(['clear','Clear chat for me','trash']);entries.forEach(([verb,label,icon])=>{const button=document.createElement('button');button.type='button';if(verb==='clear')button.className='menu-danger';button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[icon]||iconPaths.copy}</svg><span></span>`;button.querySelector('span').textContent=label;button.addEventListener('click',async event=>{event.stopPropagation();if(verb==='nickname'){details.open=false;openConversationNickname(item);return;}await action(kind,item,verb);details.open=false;renderConversations();});popup.append(button);});details.append(summary,popup);return details;};
  activeItems.forEach(item=>{const kind=isGroups?'group':'direct',id=isGroups?item.project_id:item.id;const row=document.createElement('div');row.className=`conversation-row${item.archived?' is-archived':''}`;const button=document.createElement('button');button.type='button';button.className=`conversation-item ${(isGroups?activeGroupChatId===id:activeConversation?.id===id)?'selected':''}`;const avatar=document.createElement('span');if(isGroups){avatar.className=`avatar group-avatar group-avatar-${item.avatar||'violet'}`;avatar.innerHTML=avatarMarkup(item.avatar||'violet','group');}else{avatar.className='avatar';setAvatar(avatar,{id:item.person_id,name:item.person_name,avatar:item.person_avatar,profile_photo:item.person_profile_photo});}avatar.setAttribute('aria-hidden','true');const content=document.createElement('span');content.className='conversation-content';const name=document.createElement('strong');name.textContent=isGroups?item.name:(item.display_name||item.person_name);const last=document.createElement('small');last.textContent=item.last_message?(isGroups?`${Number(item.last_message_sender_id)===Number(user.id)?'You':item.last_message_sender_name||'Classmate'}: ${item.last_message}`:Number(item.last_message_sender_id)===Number(user.id)?`You: ${item.last_message}`:item.last_message):'No messages yet';const activity=document.createElement('small');activity.className='conversation-activity';activity.textContent=formatTimestamp(item.last_message_at||item.created_at);content.append(name,last,activity);button.append(avatar,content);if(item.unread_count){const unread=document.createElement('span');unread.className='unread-pill';unread.textContent=item.unread_count;button.append(unread);}button.addEventListener('click',()=>isGroups?openGroupConversation(id):openConversation(id));row.append(button,makeMenu(kind,item));list.append(row);});
  if(!activeItems.length){const empty=document.createElement('p');empty.className='subtle-empty';empty.textContent=search?`No ${isGroups?'groups':'direct conversations'} match your search.`:archivedView?'No archived conversations.':isGroups?'Your group conversations will appear here.':'Your direct conversations will appear here.';list.append(empty);}
}

async function openConversationNickname(conversation){renamingConversationId=Number(conversation.id);const dialog=$('#rename-conversation-dialog'),input=$('#conversation-nickname');input.value=conversation.display_name===conversation.person_name?'':(conversation.display_name||'');$('#rename-conversation-error').textContent='';dialog.showModal();input.focus();input.select();}
$('#rename-conversation-form').addEventListener('submit',async event=>{event.preventDefault();if(!renamingConversationId)return;const nickname=$('#conversation-nickname').value.trim();try{await patch(`/api/direct-conversations/${renamingConversationId}/state`,{action:'nickname',nickname});$('#rename-conversation-dialog').close();await loadConversations();renderConversations();if(Number(activeConversation?.id)===renamingConversationId){activeConversation=conversations.find(item=>Number(item.id)===renamingConversationId);const heading=$('.thread-header h2');if(heading)heading.textContent=activeConversation.display_name||activeConversation.person_name;}}catch(error){$('#rename-conversation-error').textContent=error.message;}});

$('#archived-conversations-toggle').addEventListener('click',async()=>{archivedView=!archivedView;try{const [groups,directs]=await Promise.all([api(`/api/group-conversations${archivedView?'?archived=true':''}`),api(`/api/direct/conversations${archivedView?'?archived=true':''}`)]);groupThreads=groups;conversations=directs;updateUnreadCount();renderConversations();}catch(error){archivedView=!archivedView;showMessage(error.message);}});

$('#conversation-search').addEventListener('input', renderConversations);

async function openClassmateProfile(personId){
  try{
    const person=await api(`/api/people/${personId}`),content=$('#classmate-profile-content');content.replaceChildren();
    const top=document.createElement('div');top.className='classmate-profile-identity';const avatar=document.createElement('button');avatar.type='button';avatar.className='avatar classmate-profile-avatar';setAvatar(avatar,person);avatar.setAttribute('aria-label',`View ${person.name}'s profile photo`);avatar.addEventListener('click',()=>{const image=$('#profile-photo-large');image.src=person.profile_photo?`/api/people/${person.id}/photo?v=${person.id}`:`data:image/svg+xml,${encodeURIComponent(avatarMarkup(person.avatar||'violet','person'))}`;$('#profile-photo-viewer').showModal();});const identity=document.createElement('div');identity.className='classmate-profile-copy';const name=document.createElement('h3');name.textContent=person.name;const handle=document.createElement('p');handle.textContent=`@${person.username}`;const relation=document.createElement('span');relation.className='relationship-state';relation.textContent=person.relationship==='friends'?'Classmate':'Study group classmate';identity.append(name,handle,relation);top.append(avatar,identity);content.append(top);
    const bio=document.createElement('section');bio.className='classmate-profile-bio';const label=document.createElement('strong');label.textContent='About';const copy=document.createElement('p');copy.textContent=person.bio||'No bio added yet.';bio.append(label,copy);content.append(bio);
    const actions=document.createElement('div');actions.className='classmate-profile-actions';if(person.can_message){const message=document.createElement('button');message.type='button';message.className='primary-button';message.innerHTML=`${iconMarkup('chat')}<span>Message</span>`;message.addEventListener('click',()=>{const dialog=$('#classmate-profile-dialog');dialog.close();openDirectConversation(person.id);});actions.append(message);}const menu=document.createElement('details');menu.className='classmate-profile-menu';const summary=document.createElement('summary');summary.setAttribute('aria-label',`More actions for ${person.name}`);summary.innerHTML=iconMarkup('more');const block=document.createElement('button');block.type='button';block.className='menu-danger';block.innerHTML=`${iconMarkup('trash')}<span>Block classmate</span>`;block.addEventListener('click',async()=>{menu.open=false;if(!await requestConfirmation({title:'Block classmate?',message:`@${person.username} will no longer be able to message you or send classmate requests.`,confirmLabel:'Block',danger:true}))return;try{await api(`/api/people/${person.id}/block`,{method:'POST'});$('#classmate-profile-dialog').close();if(routeFromHash().name==='people')await renderPeople();showMessage(`@${person.username} blocked.`,'success');}catch(error){showMessage(error.message);}});const popup=document.createElement('div');popup.className='classmate-profile-menu-list';popup.append(block);menu.append(summary,popup);actions.append(menu);content.append(actions);$('#classmate-profile-dialog').showModal();
  }catch(error){showMessage(error.message);}
}

async function renderPeople() {
  hidePeopleSearchResults();
  const requests = await api('/api/friend-requests');
  const incoming = requests.filter((r) => r.direction === 'incoming' && r.status === 'pending');
  const outgoing = requests.filter((r) => r.direction === 'outgoing' && r.status === 'pending');
  const friends = requests.filter((r) => r.status === 'accepted');
  const blocked = requests.filter((r) => r.status === 'blocked' && r.blocked_by_me);
  const groups=[['incoming','Incoming',incoming],['outgoing','Outgoing',outgoing],['friends','Friends',friends],['blocked','Blocked',blocked]];
  const tabs=$('#people-tabs');tabs.replaceChildren();
  groups.forEach(([kind,label,items])=>{const button=document.createElement('button');button.type='button';button.className=`people-tab ${expandedPeopleList===kind?'active':''}`;button.setAttribute('aria-expanded',String(expandedPeopleList===kind));const text=document.createElement('span');text.textContent=label;const count=document.createElement('strong');count.textContent=items.length;button.append(text,count);button.addEventListener('click',()=>{hidePeopleSearchResults();expandedPeopleList=expandedPeopleList===kind?'':kind;renderPeople();});tabs.append(button);});
  const panel=$('#people-panel');const list=$('#people-panel-list');const current=groups.find(([kind])=>kind===expandedPeopleList);panel.hidden=!current;list.replaceChildren();
  if(!current)return;
  const [kind,label,items]=current;$('#people-panel-title').textContent=label;
  if(!items.length){const empty=document.createElement('p');empty.className='subtle-empty';empty.textContent=kind==='incoming'?'No incoming requests.':kind==='outgoing'?'No pending requests.':kind==='friends'?'No classmates added yet.':'No blocked classmates.';list.append(empty);return;}
  items.forEach(item=>{const personId=Number(item.direction==='incoming'?item.requester_id:item.recipient_id);const row=document.createElement('article');row.className='person-card';const avatar=document.createElement('button');avatar.type='button';avatar.className='avatar profile-trigger';setAvatar(avatar,{...item,id:personId});avatar.addEventListener('click',()=>openClassmateProfile(personId));const info=document.createElement('span');info.className='person-copy';const name=document.createElement('button');name.type='button';name.className='profile-name-trigger';name.textContent=item.name;name.addEventListener('click',()=>openClassmateProfile(personId));const handle=document.createElement('small');handle.textContent=`@${item.username}`;info.append(name,handle);row.append(avatar,info);
    const action=(label,fn,cls='secondary-button')=>{const button=document.createElement('button');button.className=cls;button.textContent=label;button.addEventListener('click',async()=>{button.disabled=true;try{await fn();}catch(error){button.disabled=false;showMessage(error.message);}});row.append(button);};
    if(kind==='incoming'){action('Accept',async()=>{await post(`/api/friend-requests/${item.id}/accept`,{});await renderPeople();});action('Decline',async()=>{await post(`/api/friend-requests/${item.id}/decline`,{});await renderPeople();});action('Block',async()=>{if(await requestConfirmation({title:'Block classmate?',message:`@${item.username} will no longer be able to contact you.`,confirmLabel:'Block',danger:true})){await api(`/api/people/${personId}/block`,{method:'POST'});await renderPeople();}},'text-button');}
    if(kind==='outgoing')action('Cancel request',async()=>{await api(`/api/friend-requests/${item.id}`,{method:'DELETE'});showMessage(`Request to @${item.username} cancelled.`,'success');await renderPeople();});
    if(kind==='friends'){action('Message',()=>openDirectConversation(personId),'primary-button');action('Block',async()=>{if(await requestConfirmation({title:'Block classmate?',message:`@${item.username} will no longer be able to message you or send classmate requests.`,confirmLabel:'Block',danger:true})){await api(`/api/people/${personId}/block`,{method:'POST'});await renderPeople();}},'text-button');}
    if(kind==='blocked'){const state=document.createElement('small');state.className='relationship-state';state.textContent='Blocked';row.append(state);action('Unblock',async()=>{await api(`/api/people/${personId}/block`,{method:'DELETE'});await renderPeople();});}
    list.append(row);
  });
}

let peopleSearchGeneration=0;
function hidePeopleSearchResults(message=''){peopleSearchGeneration++;const note=$('#friend-search-note'),results=$('#people-results');if(!note||!results)return;results.replaceChildren();note.textContent=message;note.classList.toggle('success-note',Boolean(message));}
document.addEventListener('pointerdown',event=>{if(routeFromHash().name==='people'&&!event.target.closest('.people-search-panel'))hidePeopleSearchResults();});

async function renderPeopleSearch(username) {
  const generation=++peopleSearchGeneration,note=$('#friend-search-note'),results=$('#people-results');note.textContent='';note.classList.remove('success-note');results.replaceChildren();if(username.length<3)return;
  try{const matches=await api(`/api/people/search?q=${encodeURIComponent(username)}`);if(generation!==peopleSearchGeneration||routeFromHash().name!=='people')return;const person=matches.find(p=>p.username.toLowerCase()===username.toLowerCase());if(!person){const empty=document.createElement('section');empty.className='people-search-empty';empty.setAttribute('role','status');empty.innerHTML=`<span class="people-search-empty-icon" aria-hidden="true">⌕</span><strong>No classmate found</strong><small>Check the username and try again.</small>`;results.append(empty);return;}
    const row=document.createElement('article');row.className='person-card';const avatar=document.createElement('button');avatar.type='button';avatar.className='avatar profile-trigger';setAvatar(avatar,person);avatar.addEventListener('click',()=>openClassmateProfile(person.id));const info=document.createElement('span');info.className='person-copy';const name=document.createElement('button');name.type='button';name.className='profile-name-trigger';name.textContent=person.name;name.addEventListener('click',()=>openClassmateProfile(person.id));const handle=document.createElement('small');handle.textContent=`@${person.username} · ${person.relationship.replace('_',' ')}`;info.append(name,handle);row.append(avatar,info);
    const action=document.createElement('button');action.className=person.relationship==='request_sent'?'secondary-button':'primary-button';
    if(['friends','group_classmate'].includes(person.relationship)){action.textContent='Message';action.addEventListener('click',()=>{hidePeopleSearchResults();openDirectConversation(person.id);});}
    else if(person.relationship==='request_sent'){action.textContent='Cancel request';action.addEventListener('click',async()=>{action.disabled=true;try{const pending=(await api('/api/friend-requests')).find(r=>r.direction==='outgoing'&&r.status==='pending'&&r.username.toLowerCase()===person.username.toLowerCase());if(pending)await api(`/api/friend-requests/${pending.id}`,{method:'DELETE'});await renderPeople();hidePeopleSearchResults(`Request to @${person.username} cancelled.`);}catch(error){action.disabled=false;note.textContent=error.message;}});}
    else if(person.relationship==='incoming_request'){action.textContent='Accept request';action.addEventListener('click',async()=>{try{const incoming=(await api('/api/friend-requests')).find(r=>r.direction==='incoming'&&r.status==='pending'&&r.username.toLowerCase()===person.username.toLowerCase());if(incoming)await post(`/api/friend-requests/${incoming.id}/accept`,{});await renderPeople();hidePeopleSearchResults(`Connected with @${person.username}.`);}catch(error){note.textContent=error.message;}});}
    else {action.textContent='Add classmate';action.addEventListener('click',async()=>{action.disabled=true;try{await post('/api/friend-requests',{username:person.username});await loadNotifications();await renderPeople();hidePeopleSearchResults(`Request sent to @${person.username}.`);}catch(error){action.disabled=false;note.textContent=error.message;}});}
    row.append(action);results.append(row);
  }catch(error){note.textContent=error.message;}
}

$('#friend-search-form').elements.username.addEventListener('input',()=>hidePeopleSearchResults());
$('#friend-search-form').addEventListener('submit',async event=>{event.preventDefault();const username=new FormData(event.currentTarget).get('username').trim().replace(/^@/,'');if(username.length<3){hidePeopleSearchResults('Enter at least 3 characters.');return;}await renderPeopleSearch(username);});

async function openGroupConversation(projectId) {
  const project = projects.find(item => item.id === projectId); if (!project) return;
  activeGroupChatId = projectId; activeConversation = null; replyingTo=null;lastGroupMessageId=0;activeUnreadMarkerId=Number(groupThreads.find(item=>Number(item.project_id)===Number(projectId))?.first_unread_message_id)||null; localStorage.setItem('studypilot-chat', JSON.stringify({kind:'group',id:projectId}));
  const thread=$('#direct-thread');thread.replaceChildren();
  const header=document.createElement('div');header.className='thread-header';const title=document.createElement('h2');title.textContent=project.name;const controls=document.createElement('div');controls.className='thread-controls';const pinned=document.createElement('button');pinned.className='icon-button';setIcon(pinned,'pin');pinned.setAttribute('aria-label','Pinned messages');pinned.title='Pinned messages';pinned.addEventListener('click',()=>showPinnedMessages(projectId));const back=document.createElement('button');back.className='text-button mobile-back';back.textContent='← Conversations';back.addEventListener('click',()=>{$('.inbox').classList.remove('chat-open');});controls.append(pinned,back);header.append(title,controls);
  const stream=document.createElement('div');stream.id='direct-stream';stream.className='direct-stream';
  const form=document.createElement('form');form.className='chat-form direct-form';form.autocomplete='off';form.hidden=project.role==='viewer';const input=document.createElement('input');input.name='message-body';input.type='text';input.required=true;input.maxLength=2000;input.placeholder='Share an update…';input.autocomplete='off';input.setAttribute('aria-label','Group message');const send=document.createElement('button');send.className='primary-button';send.textContent='Send';form.append(input,send);
  input.addEventListener('input',dismissUnreadDivider);form.addEventListener('submit',async(event)=>{event.preventDefault();dismissUnreadDivider();try{const payload={body:input.value};if(replyingTo)payload.reply_to_id=replyingTo.id;await post(`/api/projects/${projectId}/messages`,payload);input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));clearReplyTarget();await refreshGroupThread(true);await loadNotifications();}catch(error){showMessage(error.message);}});
  thread.append(header,stream,form);$('.inbox').classList.add('chat-open');await refreshGroupThread();startInboxPolling();renderConversations();
}

async function refreshGroupThread(full=false) {
  if (!activeGroupChatId) return;
  const stream=$('#direct-stream');if(!stream)return;
  const wasLatest=lastMessageFullyVisible(stream);const top=stream.scrollTop;const priorRows=stream.querySelectorAll('.message-row').length;const initialLoad=lastGroupMessageId===0;
  if(full)lastGroupMessageId=0;
  const marker=Number(groupThreads.find(item=>Number(item.project_id)===Number(activeGroupChatId))?.first_unread_message_id)||null;
  if(marker&&marker!==activeUnreadMarkerId){activeUnreadMarkerId=marker;}
  const readNow=wasLatest&&!document.hidden&&!initialLoad;
  const messages=await api(`/api/projects/${activeGroupChatId}/messages?after_id=${full?0:lastGroupMessageId}&mark_read=${readNow}`);
  if(full||lastGroupMessageId===0){stream.replaceChildren();}
  if(!messages.length&&lastGroupMessageId===0){const empty=document.createElement('div');empty.className='thread-empty';empty.textContent='Start the conversation.';stream.append(empty);}
  messages.forEach(message=>{appendChatMessage(stream,message,message.user_id===user.id);lastGroupMessageId=Math.max(lastGroupMessageId,Number(message.id));});
  if(messages.length&&wasLatest){stream.scrollTop=stream.scrollHeight;}else if(messages.length){stream.scrollTop=top;}
  if(priorRows===0&&activeUnreadMarkerId){positionAtUnreadDivider(stream);if(lastMessageFullyVisible(stream)&&!document.hidden)await api(`/api/projects/${activeGroupChatId}/messages?after_id=${lastGroupMessageId}&mark_read=true`);}
  updateJumpLatest(stream);
  const [updatedGroups,updatedDirects]=await Promise.all([api(`/api/group-conversations${archivedView?'?archived=true':''}`),api(`/api/direct/conversations${archivedView?'?archived=true':''}`)]);groupThreads=updatedGroups;conversations=updatedDirects;updateUnreadCount();if(!$('.conversation-actions-menu[open]'))renderConversations();
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
  replyingTo=null;activeUnreadMarkerId=Number(activeConversation.first_unread_message_id)||null;
  localStorage.setItem('studypilot-chat', JSON.stringify({kind:'direct',id:conversationId}));
  lastDirectMessageId = 0;
  const thread = $('#direct-thread'); thread.replaceChildren();
  const header = document.createElement('div'); header.className = 'thread-header'; const title = document.createElement('button');title.type='button';title.className='thread-profile-trigger'; title.textContent = activeConversation.display_name || activeConversation.person_name || 'Private conversation';title.setAttribute('aria-label',`View ${activeConversation.person_name||'classmate'} profile`);title.addEventListener('click',()=>openClassmateProfile(activeConversation.person_id)); const controls=document.createElement('div');controls.className='thread-controls';const pinned=document.createElement('button');pinned.className='icon-button';setIcon(pinned,'pin');pinned.setAttribute('aria-label','Pinned messages');pinned.title='Pinned messages';pinned.addEventListener('click',()=>showDirectPinnedMessages(conversationId));const back=document.createElement('button');back.className='text-button mobile-back';back.textContent='← Conversations';back.addEventListener('click',()=>$('.inbox').classList.remove('chat-open'));controls.append(pinned,back);header.append(title,controls);
  const stream = document.createElement('div'); stream.id = 'direct-stream'; stream.className = 'direct-stream';
  const form = document.createElement('form'); form.className = 'chat-form direct-form'; form.autocomplete='off';const input = document.createElement('input'); input.name = 'message-body';input.type='text'; input.required = true; input.maxLength = 2000; input.placeholder = 'Write a message…';input.autocomplete='off'; input.setAttribute('aria-label', 'Private message'); const send = document.createElement('button'); send.className = 'primary-button'; send.textContent = 'Send'; form.append(input, send);input.addEventListener('input',dismissUnreadDivider); form.addEventListener('submit', async (event) => { event.preventDefault();dismissUnreadDivider(); try {const payload={body:input.value};if(replyingTo)payload.reply_to_id=replyingTo.id;await post(`/api/direct/conversations/${activeConversation.id}/messages`,payload);input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));clearReplyTarget();await loadDirectMessages(true,true);await loadConversations();renderConversations();} catch (error) { showMessage(error.message); } });
  thread.append(header, stream, form);$('.inbox').classList.add('chat-open');
  try { await loadDirectMessages(false,!activeUnreadMarkerId); await loadConversations();if(activeUnreadMarkerId){positionAtUnreadDivider(stream);if(lastMessageFullyVisible(stream))await loadDirectMessages(false,true);} renderConversations(); } catch (error) { showMessage(error.message); }
  startInboxPolling();
  renderConversations();
}

async function loadDirectMessages(refreshAll = false, markRead = false) {
  if (!activeConversation) return;
  const stream = $('#direct-stream'); if (!stream) return;
  const wasLatest=lastMessageFullyVisible(stream);const top=stream.scrollTop;
  const readNow=Boolean(markRead||(wasLatest&&!document.hidden&&!activeUnreadMarkerId));
  const messages = await api(`/api/direct/conversations/${activeConversation.id}/messages?after_id=${refreshAll?0:lastDirectMessageId}&mark_read=${readNow}`);
  if ((lastDirectMessageId === 0 || refreshAll) && messages.length) stream.replaceChildren();
  if (refreshAll) lastDirectMessageId = 0;
  if (!messages.length && lastDirectMessageId === 0) stream.textContent = 'Say hello and get the conversation started.';
  messages.forEach((message) => { appendChatMessage(stream, message, message.sender_id === user.id); lastDirectMessageId = Math.max(lastDirectMessageId, message.id); });
  if (messages.length) { if(wasLatest)stream.scrollTop=stream.scrollHeight;else stream.scrollTop=top; }
  if(lastDirectMessageId&&activeUnreadMarkerId&&stream.querySelectorAll('.message-row').length===messages.length)positionAtUnreadDivider(stream);
  updateJumpLatest(stream);
}

function lastMessageFullyVisible(stream){const last=stream?.querySelector('.message-row:last-of-type');if(!last)return true;const s=stream.getBoundingClientRect(),m=last.getBoundingClientRect();return m.top>=s.top&&m.bottom<=s.bottom;}
function updateJumpLatest(stream){if(!stream)return;let button=$('.jump-latest',stream);const latestVisible=lastMessageFullyVisible(stream);if(latestVisible){button?.remove();return;}if(!button){button=document.createElement('button');button.type='button';button.className='jump-latest';button.textContent='↓ Latest message';button.setAttribute('aria-label','Jump to latest message');button.addEventListener('click',()=>{stream.scrollTop=stream.scrollHeight;updateJumpLatest(stream);});stream.append(button);}}
function unreadMarkerKey(){return activeGroupChatId?`g:${activeGroupChatId}:${activeUnreadMarkerId}`:`d:${activeConversation?.id}:${activeUnreadMarkerId}`;}
function dismissUnreadDivider(){const key=unreadMarkerKey();if(activeUnreadMarkerId)dismissedUnreadMarkers.add(key);$('.new-messages-divider',$('#direct-stream'))?.remove();}
function positionAtUnreadDivider(stream){const divider=stream.querySelector('.new-messages-divider');if(!divider)return;const preceding=[...stream.querySelectorAll('.message-row')].filter(row=>row.compareDocumentPosition(divider)&Node.DOCUMENT_POSITION_FOLLOWING);const visibleRows=Math.min(3,preceding.length);const offset=visibleRows?preceding.slice(-visibleRows).reduce((height,row)=>height+row.getBoundingClientRect().height,0):0;stream.scrollTop=Math.max(0,divider.offsetTop-offset-stream.offsetTop);}
document.addEventListener('scroll',event=>{const stream=event.target;if(!(stream instanceof HTMLElement)||!stream.classList.contains('direct-stream'))return;updateJumpLatest(stream);},{passive:true,capture:true});

$('#notification-button').addEventListener('click', async () => {
  try { await loadNotifications(); $('#notifications-dialog').showModal(); }
  catch (error) { showMessage(error.message); }
});

function notificationMessage(record) {
  const actor = record.actor || 'A classmate';
  const group = record.project_name || 'your group';
  switch (record.kind) {
    case 'friend_request': return `You received a classmate request from ${actor}.`;
    case 'friend_request_accepted': return `${actor} accepted your classmate request.`;
    case 'friend_request_declined': return `${actor} declined your classmate request.`;
    case 'friend_request_cancelled': return `${actor} cancelled their classmate request.`;
    case 'group_join_request': return `${actor} requested to join your group "${group}".`;
    case 'group_invitation':
    case 'group_invite': return `You received a group invitation from ${actor} to join "${group}".`;
    case 'project_created': return `${actor} created the group "${group}".`;
    case 'project_updated': return `${actor} updated the details for "${group}".`;
    case 'join_code_rotated': return `${actor} changed the join code for "${group}".`;
    case 'member_joined': return `${actor} approved a classmate to join "${group}".`;
    case 'group_join_response': {
      const detail = record.detail || '';
      const accepted = /approved|accept/i.test(detail) && !/not approved|declined|rejected/i.test(detail);
      return `${actor} ${accepted ? 'approved' : 'declined'} your request to join "${group}".`;
    }
    case 'direct_message': return `You received a new message from ${actor}.`;
    case 'group_message': return `You received a new message from ${actor} in "${group}".`;
    case 'message_sent': return `${actor} posted a new message in "${group}".`;
    case 'message_edited': return `${actor} edited a message in "${group}".`;
    case 'message_deleted': return `${actor} deleted a message in "${group}".`;
    case 'message_pinned': return `${actor} pinned a message in "${group}".`;
    case 'message_unpinned': return `${actor} unpinned a message in "${group}".`;
    case 'milestone_created': return `${actor} added a milestone to "${group}".`;
    case 'milestone_updated': return `${actor} updated a milestone in "${group}".`;
    case 'milestone_deleted': return `${actor} deleted a milestone from "${group}".`;
    case 'assignment_created': return `${actor} added an assignment to "${group}".`;
    case 'assignment_updated': return `${actor} updated an assignment in "${group}".`;
    case 'assignment_deleted': return `${actor} deleted an assignment from "${group}".`;
    case 'comment_added': return `${actor} commented on an assignment in "${group}".`;
    default: {
      const detail = (record.detail || '').trim();
      const cleaned = detail.replace(/^[^:]{1,80}:\s*/, '');
      return cleaned ? `${actor} ${cleaned.replace(/[.?!]+$/, '')}.` : `${actor} sent you a notification.`;
    }
  }
}

async function loadNotifications() {
  const records = await api('/api/notifications');
  $('#notification-dot').hidden = !records.some((item) => !item.read_at);
  const known=new Set(records.map(record=>String(record.id)));for(const id of selectedNotificationIds)if(!known.has(id))selectedNotificationIds.delete(id);
  const isMessage=record=>String(record.kind||'').includes('message');
  const groups=[['all','All',records],['messages','Messages',records.filter(isMessage)],['other','Other',records.filter(record=>!isMessage(record))]];
  const tabs=$('#notification-tabs');tabs.replaceChildren();
  groups.forEach(([key,label,items])=>{const button=document.createElement('button');button.type='button';button.className=`notification-tab ${notificationFilter===key?'active':''}`;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(notificationFilter===key));button.textContent=`${label} ${items.length}`;button.addEventListener('click',()=>{notificationFilter=key;loadNotifications();});tabs.append(button);});
  const visible=groups.find(([key])=>key===notificationFilter)?.[2]||records;
  const panel = $('#notifications-list'); panel.replaceChildren();
  if (!visible.length) { panel.textContent = records.length?'No notifications in this tab.':'You’re all caught up.'; syncNotificationSelection(visible); return; }
  visible.forEach((record) => {
    const item = document.createElement('article'); item.className = `notification-item ${record.read_at ? '' : 'unread'}`;
    const check=document.createElement('input');check.type='checkbox';check.className='notification-check';check.value=record.id;check.checked=selectedNotificationIds.has(String(record.id));check.setAttribute('aria-label',`Select notification from ${record.actor||'StudyPilot'}`);
    check.addEventListener('change',()=>{if(check.checked)selectedNotificationIds.add(String(record.id));else selectedNotificationIds.delete(String(record.id));syncNotificationSelection(visible);});
    const content=document.createElement('div');content.className='notification-copy';
    const text = document.createElement('p');text.textContent=notificationMessage(record);
    const time = document.createElement('small');time.className='notification-time';time.textContent=formatTimestamp(record.created_at);content.append(text,time);
    if(record.kind==='group_join_request'&&record.project_id&&record.project_name){const link=document.createElement('a');link.className='notification-link';link.href=`#/groups/${record.project_id}?requests=1`;link.textContent=`Manage requests · ${record.project_name}`;link.addEventListener('click',()=>patch('/api/notifications',{action:'read',ids:[record.id]}).catch(()=>{}));content.append(link);}
    const read=document.createElement('button');read.type='button';read.className='text-button notification-read';read.textContent=record.read_at?'Mark unread':'Mark read';read.addEventListener('click',async()=>{await patch('/api/notifications',{action:record.read_at?'unread':'read',ids:[record.id]});await loadNotifications();});
    item.append(check,content,read);panel.append(item);
  });
  syncNotificationSelection(visible);
}

function syncNotificationSelection(visibleRecords) {
  const visible = visibleRecords || [...$$('.notification-check')].map(box=>({id:box.value}));
  const ids=visible.map(record=>String(record.id));
  const selected=ids.filter(id=>selectedNotificationIds.has(id)).length;
  const total=ids.length;
  $('#notification-selection-count').textContent=`${selected} selected`;
  $('#notification-delete-selected').disabled=!selected;
  $('#notification-clear-all').disabled=!total;
  $('#notification-select-all').disabled=!total;
  const all=$('#notification-select-all');all.checked=total>0&&selected===total;all.indeterminate=selected>0&&selected<total;
}

$('#notification-select-all').addEventListener('change',event=>{$$('.notification-check').forEach(box=>{box.checked=event.currentTarget.checked;if(box.checked)selectedNotificationIds.add(String(box.value));else selectedNotificationIds.delete(String(box.value));});syncNotificationSelection();});
$('#notification-delete-selected').addEventListener('click',async()=>{const visibleIds=[...$$('.notification-check')].map(box=>String(box.value));const ids=[...selectedNotificationIds].filter(id=>visibleIds.includes(id)).map(Number);if(!ids.length)return;if(!await requestConfirmation({title:'Delete selected notifications?',message:`Delete ${ids.length} selected notification${ids.length===1?'':'s'}? This cannot be undone.`,confirmLabel:`Delete ${ids.length}`,danger:true}))return;try{await patch('/api/notifications',{action:'delete',ids,scope:notificationFilter});ids.forEach(id=>selectedNotificationIds.delete(String(id)));await loadNotifications();}catch(error){showMessage(error.message);}});
$('#notification-clear-all').addEventListener('click',async()=>{const ids=[...$$('.notification-check')].map(box=>Number(box.value));const count=ids.length;if(!count)return;const scope=notificationFilter;const label=scope==='all'?'notifications':scope==='messages'?'message notifications':'other notifications';if(!await requestConfirmation({title:'Clear notifications?',message:`Delete all ${count} ${label}? This cannot be undone.`,confirmLabel:`Clear ${count}`,danger:true}))return;try{await patch('/api/notifications',{action:'delete',ids,scope});ids.forEach(id=>selectedNotificationIds.delete(String(id)));await loadNotifications();}catch(error){showMessage(error.message);}});

$('#account-button').addEventListener('click', () => { closeOtherMenus(null);$('#account-menu').hidden = !$('#account-menu').hidden; });
document.addEventListener('click', (event) => { if (!event.target.closest('.account-area')) $('#account-menu').hidden = true; });
function profilePhotoSource(){return pendingProfilePhotoUrl||(user?.profile_photo?`/api/profile/photo?v=${user.id}&t=${Date.now()}`:'');}
function updateProfilePhotoPreview(){const preview=$('#profile-avatar-preview');setAvatar(preview,user);const source=removeProfilePhotoDraft?'':profilePhotoSource();preview.style.backgroundImage=source?`url("${source}")`:'';$('#profile-photo-remove').hidden=!(user?.profile_photo||pendingProfilePhotoBlob)&&!removeProfilePhotoDraft;$('#profile-photo-remove').textContent=removeProfilePhotoDraft?'Photo will be removed':'Remove photo';}
function resetProfilePhotoDraft(){if(pendingProfilePhotoUrl)URL.revokeObjectURL(pendingProfilePhotoUrl);if(photoCropSourceUrl.startsWith('blob:'))URL.revokeObjectURL(photoCropSourceUrl);pendingProfilePhotoBlob=null;pendingProfilePhotoUrl='';removeProfilePhotoDraft=false;photoCropImage=null;photoCropSourceUrl='';$('#profile-photo').value='';}
function showProfilePhotoViewer(){const source=profilePhotoSource();$('#profile-photo-large').src=source||`data:image/svg+xml,${encodeURIComponent(avatarMarkup(user?.avatar||'violet','person'))}`;$('#profile-photo-viewer').showModal();}
function drawPhotoCrop(){if(!photoCropImage)return;const canvas=$('#photo-crop-canvas'),ctx=canvas.getContext('2d'),size=canvas.width,zoom=Number($('#photo-zoom').value)||1;ctx.clearRect(0,0,size,size);const scale=Math.max(size/photoCropImage.naturalWidth,size/photoCropImage.naturalHeight)*zoom,w=photoCropImage.naturalWidth*scale,h=photoCropImage.naturalHeight*scale;photoCropOffsetX=Math.max(size-w/2,Math.min(w/2,photoCropOffsetX));photoCropOffsetY=Math.max(size-h/2,Math.min(h/2,photoCropOffsetY));ctx.save();ctx.beginPath();ctx.rect(0,0,size,size);ctx.clip();ctx.drawImage(photoCropImage,size/2+photoCropOffsetX-w/2,size/2+photoCropOffsetY-h/2,w,h);ctx.restore();}
function releasePhotoCropSource(){if(photoCropSourceUrl.startsWith('blob:'))URL.revokeObjectURL(photoCropSourceUrl);photoCropSourceUrl='';photoCropImage=null;photoCropDrag=null;}
function openPhotoCrop(source,sourceUrl=''){$('#photo-edit-error').textContent='';const img=new Image();img.onload=()=>{photoCropImage=img;photoCropSourceUrl=sourceUrl;photoCropOffsetX=0;photoCropOffsetY=0;$('#photo-zoom').value='1';drawPhotoCrop();$('#profile-photo-editor').showModal();};img.onerror=()=>{if(sourceUrl.startsWith('blob:'))URL.revokeObjectURL(sourceUrl);$('#profile-photo').value='';$('#photo-edit-error').textContent='This image could not be opened. Choose a JPG, PNG, or WebP image.';};img.src=source;}
function editCurrentProfilePhoto(){if(pendingProfilePhotoUrl){openPhotoCrop(pendingProfilePhotoUrl);return;}if(user?.profile_photo){openPhotoCrop(`/api/profile/photo?v=${user.id}&t=${Date.now()}`);return;}$('#profile-photo').click();}
function openProfileDialog(){resetProfilePhotoDraft();$('#account-menu').hidden=true;$('#profile-form').reset();$('#profile-form').elements.name.value=user.name;$('#profile-form').elements.username.value=user.username;$('#profile-form').elements.bio.value=user.bio||'';$('#profile-email').value=user.email;$('#profile-error').textContent='';$('#profile-saved').textContent='';updateProfilePhotoPreview();$('#profile-dialog').showModal();}
$('#profile-open').addEventListener('click',openProfileDialog);
let profileAvatarClickTimer=null;
$('#profile-avatar-preview').addEventListener('click',()=>{clearTimeout(profileAvatarClickTimer);profileAvatarClickTimer=setTimeout(showProfilePhotoViewer,230);});
$('#profile-avatar-preview').addEventListener('dblclick',event=>{event.preventDefault();clearTimeout(profileAvatarClickTimer);editCurrentProfilePhoto();});
$('#profile-photo-view').addEventListener('click',showProfilePhotoViewer);
$('#profile-photo-edit').addEventListener('click',editCurrentProfilePhoto);
$('#profile-photo-upload').addEventListener('click',()=>$('#profile-photo').click());
$('#profile-photo-remove').addEventListener('click',()=>{if(pendingProfilePhotoUrl)URL.revokeObjectURL(pendingProfilePhotoUrl);pendingProfilePhotoUrl='';pendingProfilePhotoBlob=null;removeProfilePhotoDraft=true;$('#profile-photo').value='';updateProfilePhotoPreview();$('#profile-saved').textContent='Save your profile to apply this change.';});
$('#profile-photo').addEventListener('change',event=>{const file=event.currentTarget.files[0];if(!file)return;if(file.size>5*1024*1024){$('#profile-error').textContent='Photo must be 5 MB or smaller.';event.currentTarget.value='';return;}if(!['image/jpeg','image/png','image/webp'].includes(file.type)){ $('#profile-error').textContent='Choose a JPG, PNG, or WebP image.';event.currentTarget.value='';return;}$('#profile-error').textContent='';const sourceUrl=URL.createObjectURL(file);openPhotoCrop(sourceUrl,sourceUrl);});
$('#photo-zoom').addEventListener('input',drawPhotoCrop);
$('#photo-crop-canvas').addEventListener('pointerdown',event=>{if(!photoCropImage)return;event.currentTarget.setPointerCapture(event.pointerId);photoCropDrag={x:event.clientX,y:event.clientY,ox:photoCropOffsetX,oy:photoCropOffsetY};});
$('#photo-crop-canvas').addEventListener('pointermove',event=>{if(!photoCropDrag)return;const rect=event.currentTarget.getBoundingClientRect();photoCropOffsetX=photoCropDrag.ox+(event.clientX-photoCropDrag.x)*512/rect.width;photoCropOffsetY=photoCropDrag.oy+(event.clientY-photoCropDrag.y)*512/rect.height;drawPhotoCrop();});
$('#photo-crop-canvas').addEventListener('pointerup',()=>{photoCropDrag=null;});
$('#photo-crop-canvas').addEventListener('pointercancel',()=>{photoCropDrag=null;});
$('#photo-crop-confirm').addEventListener('click',()=>{const button=$('#photo-crop-confirm');button.disabled=true;$('#photo-edit-error').textContent='';$('#photo-crop-canvas').toBlob(blob=>{button.disabled=false;if(!blob){$('#photo-edit-error').textContent='Could not create the cropped image. Please try again.';return;}if(pendingProfilePhotoUrl)URL.revokeObjectURL(pendingProfilePhotoUrl);pendingProfilePhotoBlob=blob;pendingProfilePhotoUrl=URL.createObjectURL(blob);removeProfilePhotoDraft=false;releasePhotoCropSource();updateProfilePhotoPreview();$('#profile-photo-editor').close();$('#profile-saved').textContent='Save your profile to apply this photo.';},'image/webp',.92);});
$('#profile-photo-editor').addEventListener('close',()=>{releasePhotoCropSource();$('#profile-photo').value='';});
$('#profile-photo-viewer').addEventListener('close',()=>{$('#profile-photo-large').removeAttribute('src');});
$('.profile-photo-close').addEventListener('click',()=>$('#profile-photo-viewer').close());
$('#profile-dialog').addEventListener('close',()=>{clearTimeout(profileAvatarClickTimer);resetProfilePhotoDraft();});
$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); $('#profile-error').textContent = ''; $('#profile-saved').textContent = '';
  try { user = await patch('/api/profile', { name: data.name, username: data.username, bio:data.bio });if(removeProfilePhotoDraft){await api('/api/profile/photo',{method:'DELETE'});user.profile_photo=false;}else if(pendingProfilePhotoBlob){const form=new FormData();form.append('photo',pendingProfilePhotoBlob,'profile-photo.webp');const response=await fetch('/api/profile/photo',{method:'POST',credentials:'same-origin',body:form});if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.detail||'Photo upload failed.');}user.profile_photo=true;}$('#account-button').setAttribute('aria-label',`Open account menu for ${user.name}`);setAvatar($('#avatar'),user);resetProfilePhotoDraft();updateProfilePhotoPreview();$('#profile-saved').textContent='Your profile is saved.'; }
  catch (error) { $('#profile-error').textContent = error.message; }
});

$('#settings-open').addEventListener('click',()=>{$('#account-menu').hidden=true;$('#settings-form').reset();selectAvatar($('.avatar-picker[data-picker="person"]'),user.avatar||'violet');$('#settings-form').elements.theme.value=user.theme||'light';$('#settings-error').textContent='';$('#settings-saved').textContent='';$('#settings-dialog').showModal();});
$('#settings-form').addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));$('#settings-error').textContent='';$('#settings-saved').textContent='';try{if(data.new_password){await api('/api/profile/password',{method:'POST',body:JSON.stringify({current_password:data.current_password,new_password:data.new_password})});}user=await patch('/api/profile',{name:user.name,avatar:data.avatar,theme:data.theme});setAvatar($('#avatar'),user);setTheme(user.theme);$('#settings-saved').textContent='Your settings are saved.';}catch(error){$('#settings-error').textContent=error.message;}});

$('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { stopPolling(); user = null; location.hash = '#/dashboard'; $('#app-screen').hidden = true; $('#auth-screen').hidden = false; authMode(false); } });
$$('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));

function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

boot();


document.addEventListener('pointerdown',event=>{const open=$$('details[open]');open.forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});if(!$('#account-menu').contains(event.target)&&!$('#account-button').contains(event.target))$('#account-menu').hidden=true;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const opened=$('.conversation-actions-menu[open]');const trigger=opened?.querySelector('summary');closeOtherMenus(null);if(trigger)trigger.focus();$('#account-menu').hidden=true;}});
document.addEventListener('click',event=>{if(!event.target.closest('.conversation-actions-menu'))closeOtherMenus(null);});
document.addEventListener('toggle',event=>{const menu=event.target;if(!(menu instanceof HTMLDetailsElement))return;const conversationPopup=menu.querySelector('.conversation-action-list');if(!menu.open){if(conversationPopup)conversationPopup.removeAttribute('style');return;}closeOtherMenus(menu);$('#account-menu').hidden=true;const popup=menu.querySelector('.message-menu-items,.comment-menu-items,.member-menu-items,.group-menu-items,.task-move-menu,.conversation-action-list');if(!popup)return;if(!popup.classList.contains('conversation-action-list'))enhanceContextMenu(popup);requestAnimationFrame(()=>{menu.classList.remove('opens-up','opens-left');if(popup.classList.contains('conversation-action-list')){const anchor=menu.querySelector('summary').getBoundingClientRect();popup.style.position='fixed';popup.style.maxHeight=`${Math.max(120,innerHeight-24)}px`;popup.style.overflowY='auto';popup.style.maxWidth=`calc(100vw - 24px)`;const width=Math.min(popup.offsetWidth,innerWidth-24);const left=Math.max(12,Math.min(anchor.right-width,innerWidth-width-12));popup.style.left=`${left}px`;popup.style.right='auto';const top=anchor.bottom+4;popup.style.top=`${top+popup.offsetHeight>innerHeight-8?Math.max(8,anchor.top-popup.offsetHeight-4):top}px`;popup.style.bottom='auto';return;}const memberList=menu.closest('.member-list');if(memberList){const list=memberList.getBoundingClientRect(),anchor=menu.getBoundingClientRect();popup.style.maxHeight=`${Math.max(80,list.height-8)}px`;popup.style.overflowY='auto';popup.style.bottom='auto';popup.style.top=`${Math.max(list.top+4,Math.min(anchor.bottom+4,list.bottom-popup.offsetHeight-4))-anchor.top}px`;return;}const bounds=popup.getBoundingClientRect();if(bounds.bottom>innerHeight-8)menu.classList.add('opens-up');if(bounds.right>innerWidth-8)menu.classList.add('opens-left');});},true);
document.addEventListener('focusin',event=>{const open=$$('details[open]');open.forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});if(!$('#account-menu').contains(event.target)&&event.target!==$('#account-button'))$('#account-menu').hidden=true;});
window.addEventListener('resize',()=>$$('.message-menu[open]').forEach(menu=>positionMessageMenu(menu,menu.closest('.message-row')?.classList.contains('mine'))));
window.addEventListener('scroll',()=>$$('.message-menu[open]').forEach(menu=>positionMessageMenu(menu,menu.closest('.message-row')?.classList.contains('mine'))),true);
