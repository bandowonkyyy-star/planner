'use strict';

// ---------- Constants ----------
// UI language: Russian (user request, 2026-10-28)
const PROJECTS = { inbox: 'Входящие', tasks: 'Задачи', tiktok: 'TikTok', motion: 'Моушн', study: 'Учёба' };
const STAGES = ['idea', 'script', 'shoot', 'edit', 'published'];
const STAGE_LABEL = { idea: 'Идея', script: 'Сценарий', shoot: 'Съёмка', edit: 'Монтаж', published: 'Опубликовано' };
const REPEAT_LABEL = { daily: 'Каждый день', weekdays: 'По будням', weekly: 'Каждую неделю', monthly: 'Каждый месяц' };
const VIEW_TITLE = { today: 'Сегодня', upcoming: 'Скоро', inbox: 'Входящие', projects: 'Проекты', tiktok: 'TikTok' };
const LS = { data: 'planner.data', cfg: 'planner.cfg', dirty: 'planner.dirty', ui: 'planner.ui' };
const TOMBSTONE_DAYS = 30;

// Quick-add keywords (input may be typed in English or Russian)
const PROJECT_ALIAS = {
  inbox: 'inbox', 'входящие': 'inbox',
  tasks: 'tasks', task: 'tasks', 'задачи': 'tasks', 'дела': 'tasks',
  tiktok: 'tiktok', tt: 'tiktok', 'тикток': 'tiktok', 'тт': 'tiktok',
  motion: 'motion', mo: 'motion', 'моушн': 'motion', 'моушен': 'motion',
  study: 'study', 'учеба': 'study', 'учёба': 'study'
};
const WEEKDAY = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  'вс': 0, 'воскресенье': 0, 'пн': 1, 'понедельник': 1, 'вт': 2, 'вторник': 2,
  'ср': 3, 'среда': 3, 'среду': 3, 'чт': 4, 'четверг': 4, 'пт': 5, 'пятница': 5, 'пятницу': 5,
  'сб': 6, 'суббота': 6, 'субботу': 6
};
const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// iOS Safari's floating toolbar covers the bottom of the page; the home-screen app has none
if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator.standalone || matchMedia('(display-mode: standalone)').matches)) {
  document.documentElement.classList.add('ios-browser');
}

// ---------- Storage ----------
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
}

let data = lsGet(LS.data, { version: 1, tasks: [] });
let cfg = lsGet(LS.cfg, { owner: '', repo: 'planner-data', path: 'tasks.json', token: '' });
let dirty = lsGet(LS.dirty, false);
let ui = lsGet(LS.ui, { view: 'today', project: 'tasks', showDone: false });

// ---------- Dates ----------
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
function nextWeekday(wd, from) {
  const d = parseYmd(from || today());
  const diff = (wd - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return ymd(d);
}
function dateLabel(s) {
  const t = today();
  if (s === t) return 'Сегодня';
  if (s === addDays(t, 1)) return 'Завтра';
  if (s === addDays(t, -1)) return 'Вчера';
  const d = parseYmd(s);
  const diff = Math.round((d - parseYmd(t)) / 864e5);
  if (diff > 1 && diff < 7) return WD_SHORT[d.getDay()];
  return `${WD_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// Repeat format: daily | weekdays | weekly:N (0=Sun) | monthly
function stepRepeat(due, repeat) {
  if (repeat === 'daily') return addDays(due, 1);
  if (repeat === 'weekdays') {
    let n = addDays(due, 1);
    while ([0, 6].includes(parseYmd(n).getDay())) n = addDays(n, 1);
    return n;
  }
  if (repeat && repeat.startsWith('weekly')) {
    const wd = repeat.includes(':') ? Number(repeat.split(':')[1]) : parseYmd(due).getDay();
    return nextWeekday(wd, due);
  }
  if (repeat === 'monthly') {
    const d = parseYmd(due);
    const day = d.getDate();
    const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const last = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    n.setDate(Math.min(day, last));
    return ymd(n);
  }
  return due;
}
function nextDue(due, repeat) {
  const t = today();
  let n = stepRepeat(due || t, repeat);
  while (n < t) n = stepRepeat(n, repeat);
  return n;
}
function repeatLabel(r) {
  if (!r) return '';
  if (r.startsWith('weekly:')) return 'Каждый ' + WD_SHORT[Number(r.split(':')[1])].toLowerCase();
  return REPEAT_LABEL[r] || r;
}

// ---------- Quick-add parser ----------
function parseQuick(text, defaults) {
  const out = Object.assign({ priority: 4, due: null, time: null, project: 'inbox', repeat: null }, defaults || {});
  const timeRe = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const words = text.trim().split(/\s+/);
  const keep = [];
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    let m;
    // Priority glued to a word: "деньги!1"
    if ((m = w.match(/^(.+?)!([1-3])$/))) { out.priority = Number(m[2]); w = m[1]; }
    const lw = w.toLowerCase().replace(/[.,]$/, '');
    const nx = (words[i + 1] || '').toLowerCase();
    if ((m = lw.match(/^(?:!|p|р|п)([1-3])$/) || lw.match(/^([1-3])!$/))) { out.priority = Number(m[1]); continue; }
    if (lw === '!' && /^[1-3]$/.test(nx)) { out.priority = Number(nx); i += 1; continue; }
    if ((m = lw.match(timeRe))) { out.time = `${pad(m[1])}:${m[2]}`; continue; }
    if ((lw === 'в' || lw === 'at') && (m = nx.replace(/[.,]$/, '').match(timeRe))) { out.time = `${pad(m[1])}:${m[2]}`; i += 1; continue; }
    if ((m = lw.match(/^#(.+)$/)) && PROJECT_ALIAS[m[1]]) { out.project = PROJECT_ALIAS[m[1]]; continue; }
    if (lw === 'today' || lw === 'сегодня') { out.due = today(); continue; }
    if (lw === 'tomorrow' || lw === 'завтра') { out.due = addDays(today(), 1); continue; }
    if (lw === 'послезавтра') { out.due = addDays(today(), 2); continue; }
    if ((lw === 'in' || lw === 'через') && /^\d+$/.test(nx)) {
      out.due = addDays(today(), Number(nx)); i += 1;
      if (/^(days?|дн|дня|дней|день)$/.test((words[i + 1] || '').toLowerCase())) i += 1;
      continue;
    }
    if (['every', 'каждый', 'каждую', 'каждое', 'каждые'].includes(lw) && nx) {
      if (['day', 'день', 'дня'].includes(nx)) { out.repeat = 'daily'; i += 1; continue; }
      if (['week', 'неделю'].includes(nx)) { out.repeat = 'weekly'; i += 1; continue; }
      if (['month', 'месяц'].includes(nx)) { out.repeat = 'monthly'; i += 1; continue; }
      if (WEEKDAY[nx] !== undefined) { out.repeat = 'weekly:' + WEEKDAY[nx]; i += 1; continue; }
    }
    if (lw === 'weekdays' || (lw === 'по' && nx === 'будням')) { out.repeat = 'weekdays'; if (lw === 'по') i += 1; continue; }
    if (lw === 'daily' || lw === 'ежедневно') { out.repeat = 'daily'; continue; }
    if (WEEKDAY[lw] !== undefined && lw.length >= 2) { out.due = nextWeekday(WEEKDAY[lw]); continue; }
    if ((m = lw.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/))) {
      const t = parseYmd(today());
      let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : t.getFullYear();
      let d = new Date(y, Number(m[2]) - 1, Number(m[1]));
      if (!m[3] && d < t) d = new Date(y + 1, Number(m[2]) - 1, Number(m[1]));
      out.due = ymd(d); continue;
    }
    keep.push(w);
  }
  if (out.time && !out.due) out.due = today();
  if (out.repeat && !out.due) {
    out.due = out.repeat.startsWith('weekly:') ? nextWeekday(Number(out.repeat.split(':')[1]), addDays(today(), -1)) : today();
  }
  // Drop a dangling preposition left after a parsed date/time: "цветы в пт 9:00" -> "цветы"
  while (keep.length > 1 && /^(в|во|на|к|ко|до|at|on|by)$/i.test(keep[keep.length - 1])) keep.pop();
  out.title = keep.join(' ');
  return out;
}

// ---------- Model ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function newTask(fields) {
  const now = Date.now();
  return Object.assign({
    id: uid(), title: '', notes: '', project: 'inbox', stage: null, priority: 4,
    due: null, time: null, repeat: null, done: false, doneAt: null, subtasks: [],
    created: now, modified: now, deleted: false
  }, fields);
}
const alive = () => data.tasks.filter(t => !t.deleted);
const byId = id => data.tasks.find(t => t.id === id);
// Always newer than the version this device saw, even if another device's clock runs ahead
function touch(t) { t.modified = Math.max(Date.now(), (t.modified || 0) + 1); }

let changeSeq = 0;
function commit() {
  changeSeq++;
  data.updated = new Date().toISOString();
  lsSet(LS.data, data);
  dirty = true; lsSet(LS.dirty, true);
  render();
  scheduleSync();
}

function toggleDone(t) {
  const before = JSON.stringify(t);
  if (!t.done && t.repeat) {
    t.due = nextDue(t.due, t.repeat);
    t.subtasks.forEach(s => { s.done = false; });
    touch(t); commit();
    toast(`Следующий раз: ${dateLabel(t.due)}`, before);
    return;
  }
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  if (t.done && t.project === 'tiktok' && t.stage !== 'published') t.stage = 'published';
  touch(t); commit();
  if (t.done) toast('Выполнено', before);
}
function removeTask(t) {
  const before = JSON.stringify(t);
  t.deleted = true; touch(t); commit();
  toast('Удалено', before);
}
function postpone(t) {
  const before = JSON.stringify(t);
  t.due = addDays(today(), 1); touch(t); commit();
  toast('Перенесено на завтра', before);
}

// ---------- Sync (GitHub Contents API) ----------
const configured = () => cfg.owner && cfg.repo && cfg.token;
let syncTimer = null, retryTimer = null, syncing = false, syncAgain = false;

function b64e(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64d(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function mergeTasks(a, b) {
  const map = new Map();
  [...a, ...b].forEach(t => {
    const cur = map.get(t.id);
    if (!cur || (t.modified || 0) > (cur.modified || 0)) map.set(t.id, t);
  });
  const cutoff = Date.now() - TOMBSTONE_DAYS * 864e5;
  return [...map.values()]
    .filter(t => !(t.deleted && t.modified < cutoff))
    .sort((x, y) => (x.created - y.created) || (x.id < y.id ? -1 : 1));
}

function setStatus(kind, text) {
  document.getElementById('syncDot').className = 'dot ' + kind;
  document.getElementById('syncText').textContent = text;
}

async function api(method, body) {
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(method === 'GET' ? url + '?t=' + Date.now() : url, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res;
}

async function sync() {
  if (!configured()) { setStatus('', 'Локально'); return; }
  if (!navigator.onLine) { setStatus('err', 'Нет сети'); return; }
  if (syncing) { syncAgain = true; return; }
  clearTimeout(retryTimer);
  syncing = true;
  setStatus('busy', 'Синхр…');
  const seqAtStart = changeSeq;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await api('GET');
      let remote = { version: 1, tasks: [] }, sha;
      if (res.status === 200) {
        const j = await res.json();
        sha = j.sha;
        remote = JSON.parse(b64d(j.content));
      } else if (res.status !== 404) {
        throw new Error(res.status === 401 ? 'Неверный токен' : res.status === 404 ? 'Нет репо' : 'GitHub ' + res.status);
      }
      // Deep copy of local state: taps during the network calls must not leak into this snapshot
      const merged = { version: 1, updated: new Date().toISOString(), tasks: mergeTasks(JSON.parse(JSON.stringify(data.tasks)), remote.tasks || []) };
      const same = JSON.stringify(merged.tasks) === JSON.stringify(remote.tasks || []);
      if (!same) {
        const put = await api('PUT', {
          message: 'planner: update from app',
          content: b64e(JSON.stringify(merged, null, 2) + '\n'),
          ...(sha ? { sha } : {})
        });
        if (put.status === 409 || put.status === 422) continue;
        if (!put.ok) throw new Error('GitHub ' + put.status);
      }
      // Keep anything changed on this device while we were talking to GitHub
      data = { ...merged, tasks: mergeTasks(data.tasks, merged.tasks) };
      lsSet(LS.data, data);
      if (changeSeq === seqAtStart) { dirty = false; lsSet(LS.dirty, false); } else { syncAgain = true; }
      const hh = new Date();
      setStatus('ok', `${pad(hh.getHours())}:${pad(hh.getMinutes())}`);
      render();
      break;
    }
  } catch (e) {
    // fetch() network failures are TypeErrors ("Load failed" on iOS)
    const offline = e instanceof TypeError;
    setStatus('err', offline ? 'Нет сети' : e.message && e.message.length < 18 ? e.message : 'Ошибка синхр.');
    retryTimer = setTimeout(sync, offline ? 5000 : 30000);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}
function scheduleSync(ms) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, ms == null ? 1200 : ms);
}

// ---------- Rendering ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byPrio = (a, b) => (a.priority - b.priority) || ((a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : 0) || (a.created - b.created);
// Within one day: timed tasks first, in time order, then by priority
const byDay = (a, b) => ((a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : 0) || byPrio(a, b);

function rowHtml(t, opts) {
  const o = opts || {};
  const t0 = today();
  const meta = [];
  if (t.priority < 4) meta.push(`<span class="prio p${t.priority}">P${t.priority}</span>`);
  if (t.due && !o.hideDate) {
    const cls = !t.done && t.due < t0 ? 'late' : t.due === t0 ? 'today' : '';
    meta.push(`<span class="${cls}">${dateLabel(t.due)}${t.time ? ', ' + t.time : ''}</span>`);
  } else if (t.time) {
    meta.push(`<span class="today">&#9719; ${t.time}</span>`);
  }
  if (t.repeat) meta.push(`<span>&#8635; ${repeatLabel(t.repeat)}</span>`);
  if (t.subtasks.length) meta.push(`<span>${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}</span>`);
  if (t.project === 'tiktok' && t.stage) meta.push(`<span>${STAGE_LABEL[t.stage]}</span>`);
  if (!o.hideProject && t.project !== 'inbox') meta.push(`<span class="chip">${PROJECTS[t.project]}</span>`);
  if (t.notes) meta.push('<span>&#9998;</span>');
  return `<div class="row${t.done ? ' done' : ''}" data-id="${t.id}">
    <div class="row-bg">${t.done ? '<span class="l del">&#10005; Удалить</span><span></span>' : '<span class="l">&#10003; Готово</span><span class="r">На завтра &#8594;</span>'}</div>
    <div class="row-in${t.priority < 4 && !t.done ? ' pr' + t.priority : ''}">
      <button class="check p${t.priority}${t.done ? ' on' : ''}" data-act="check" aria-label="Выполнить"></button>
      <div class="body" data-act="open"><div class="title">${esc(t.title)}</div>${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}</div>
    </div></div>`;
}
const list = (tasks, opts) => tasks.map(t => rowHtml(t, opts)).join('');
const empty = msg => `<div class="empty">${msg}</div>`;

function viewToday() {
  const t0 = today();
  const open = alive().filter(t => !t.done && t.due);
  const late = open.filter(t => t.due < t0).sort(byPrio);
  const now = open.filter(t => t.due === t0).sort(byDay);
  const doneToday = alive().filter(t => t.done && t.doneAt && ymd(new Date(t.doneAt)) === t0);
  let h = '';
  if (late.length) h += `<div class="group-h red">Просрочено &middot; ${late.length}</div>` + list(late);
  h += `<div class="group-h">${dateLabel(t0)} &middot; ${WD_SHORT[new Date().getDay()]} ${new Date().getDate()} ${MONTHS[new Date().getMonth()]}</div>`;
  h += now.length ? list(now, { hideDate: true }) : empty('На сегодня ничего нет.<br>Нажми +, чтобы добавить задачу.');
  if (doneToday.length) h += `<div class="group-h">Сделано сегодня &middot; ${doneToday.length}</div>` + list(doneToday, { hideDate: true });
  return h;
}
function viewUpcoming() {
  const t0 = today();
  const open = alive().filter(t => !t.done && t.due && t.due > t0);
  let h = '';
  for (let i = 1; i <= 14; i++) {
    const d = addDays(t0, i);
    const items = open.filter(t => t.due === d).sort(byDay);
    if (items.length) h += `<div class="group-h">${dateLabel(d)}${i < 7 ? '' : ''} &middot; ${parseYmd(d).getDate()} ${MONTHS[parseYmd(d).getMonth()]}</div>` + list(items, { hideDate: true });
  }
  const later = open.filter(t => t.due > addDays(t0, 14)).sort((a, b) => a.due < b.due ? -1 : 1);
  if (later.length) h += '<div class="group-h">Позже</div>' + list(later);
  return h || empty('На ближайшие две недели задач нет.');
}
function viewInbox() {
  const items = alive().filter(t => t.project === 'inbox' && !t.done).sort(byPrio);
  return items.length ? '<div class="hint" style="margin:6px 4px">Нажми на задачу, чтобы выбрать проект, дату и приоритет.</div>' + list(items, { hideProject: true })
    : empty('Во входящих пусто.<br>Всё разобрано.');
}
function viewProjects() {
  const keys = ['tasks', 'motion', 'study'];
  let h = `<div class="seg">${keys.map(k => `<button data-proj="${k}" class="${ui.project === k ? 'on' : ''}">${PROJECTS[k]}</button>`).join('')}</div>`;
  const all = alive().filter(t => t.project === ui.project);
  const open = all.filter(t => !t.done).sort((a, b) => ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) || byPrio(a, b));
  h += open.length ? list(open, { hideProject: true }) : empty(`В разделе «${PROJECTS[ui.project]}» открытых задач нет.`);
  const done = all.filter(t => t.done).sort((a, b) => b.doneAt - a.doneAt);
  if (done.length) {
    h += `<button class="toggle-done" data-act="toggle-done">${ui.showDone ? 'Скрыть' : 'Показать'} выполненные (${done.length})</button>`;
    if (ui.showDone) h += list(done.slice(0, 50), { hideProject: true });
  }
  return h;
}
function viewTiktok() {
  const items = alive().filter(t => t.project === 'tiktok');
  const t0 = today();
  return `<div class="board">${STAGES.map((s, si) => {
    const col = items.filter(t => (t.stage || 'idea') === s && (s === 'published' || !t.done))
      .sort(s === 'published' ? (a, b) => (b.doneAt || b.modified) - (a.doneAt || a.modified) : byPrio)
      .slice(0, s === 'published' ? 20 : 999);
    return `<section class="col"><div class="col-h">${STAGE_LABEL[s]} <span>${col.length}</span></div>
      ${col.map(t => `<div class="card" data-id="${t.id}">
        <div class="title" data-act="open">${esc(t.title)}</div>
        <div class="meta">${t.due ? `<span class="${t.due < t0 && s !== 'published' ? 'late' : ''}">${dateLabel(t.due)}${t.time ? ', ' + t.time : ''}</span>` : ''}${t.priority < 4 ? `<span>P${t.priority}</span>` : ''}</div>
        <div class="card-act">
          <button data-act="stage-prev" ${si === 0 ? 'disabled' : ''}>&#8592; ${si > 0 ? STAGE_LABEL[STAGES[si - 1]] : ''}</button>
          <button data-act="stage-next" ${si === STAGES.length - 1 ? 'disabled' : ''}>${si < STAGES.length - 1 ? STAGE_LABEL[STAGES[si + 1]] : ''} &#8594;</button>
        </div></div>`).join('') || '<div class="hint" style="padding:4px">Пусто</div>'}
    </section>`;
  }).join('')}</div>`;
}

function render() {
  const fn = { today: viewToday, upcoming: viewUpcoming, inbox: viewInbox, projects: viewProjects, tiktok: viewTiktok }[ui.view] || viewToday;
  $('#viewTitle').textContent = VIEW_TITLE[ui.view];
  $('#view').innerHTML = fn();
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === ui.view));
  const inboxCount = alive().filter(t => t.project === 'inbox' && !t.done).length;
  document.querySelector('.tabs [data-view="inbox"]').lastChild.textContent = inboxCount ? `Входящие ${inboxCount}` : 'Входящие';
}

// ---------- Sheets ----------
function openSheet(html, onMount) {
  // Fresh element each time: listeners from a previously opened sheet must not survive
  const old = $('#sheetBody');
  const el = old.cloneNode(false);
  old.replaceWith(el);
  el.innerHTML = html;
  $('#sheet').hidden = false;
  if (onMount) onMount(el);
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetBody').innerHTML = ''; }

function quickDefaults() {
  if (ui.view === 'today') return { due: today() };
  if (ui.view === 'projects') return { project: ui.project };
  if (ui.view === 'tiktok') return { project: 'tiktok' };
  return {};
}
function openQuickAdd() {
  openSheet(`<h2>Новая задача</h2>
    <input class="inp" id="qa" placeholder="Смонтировать ролик завтра !1 #тикток" autocomplete="off" enterkeyhint="done">
    <div class="chips" id="qaPreview"></div>
    <div class="hint">Приоритет: !1 !2 !3 &middot; Раздел: #тикток #моушн #учеба #задачи &middot; Дата: сегодня, завтра, пт, 12.11, через 3 дня &middot; Время: 17:30, в 9:00 &middot; Повтор: каждый день, каждый пн, по будням</div>
    <div class="btns"><button class="btn" data-act="close">Отмена</button><button class="btn main" id="qaAdd">Добавить</button></div>`, el => {
    const inp = el.querySelector('#qa');
    const preview = () => {
      const p = parseQuick(inp.value, quickDefaults());
      const chips = [`<span>${PROJECTS[p.project]}</span>`];
      if (p.due) chips.push(`<span>${dateLabel(p.due)}${p.time ? ', ' + p.time : ''}</span>`);
      if (p.priority < 4) chips.push(`<span>P${p.priority}</span>`);
      if (p.repeat) chips.push(`<span>&#8635; ${repeatLabel(p.repeat)}</span>`);
      el.querySelector('#qaPreview').innerHTML = chips.join('');
    };
    const add = () => {
      const p = parseQuick(inp.value, quickDefaults());
      if (!p.title) { inp.focus(); return; }
      data.tasks.push(newTask({ title: p.title, project: p.project, priority: p.priority, due: p.due, time: p.time, repeat: p.repeat, stage: p.project === 'tiktok' ? 'idea' : null }));
      commit();
      inp.value = ''; preview(); inp.focus();
      toast('Добавлено');
    };
    inp.addEventListener('input', preview);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    el.querySelector('#qaAdd').addEventListener('click', add);
    preview();
    inp.focus(); // synchronous inside the tap, so iOS opens the keyboard
  });
}

function openEditor(id) {
  const t = byId(id);
  if (!t) return;
  const draft = JSON.parse(JSON.stringify(t));
  const t0 = today();
  const repeatOpts = [['', 'Без повтора'], ['daily', 'Каждый день'], ['weekdays', 'По будням'], ['weekly', 'Каждую неделю (в тот же день)'], ['monthly', 'Каждый месяц']];
  const draw = el => {
    el.innerHTML = `<h2>Задача</h2>
      <div class="field"><input class="inp" id="eTitle" value="${esc(draft.title)}"></div>
      <div class="field"><label>Приоритет</label><div class="chips">${[1, 2, 3, 4].map(p => `<button data-prio="${p}" class="${draft.priority === p ? 'on' : ''}">${p < 4 ? 'P' + p : 'Нет'}</button>`).join('')}</div></div>
      <div class="field"><label>Дата</label><input class="inp" type="date" id="eDue" value="${draft.due || ''}">
        <div class="chips"><button data-due="${t0}">Сегодня</button><button data-due="${addDays(t0, 1)}">Завтра</button><button data-due="${nextWeekday(1)}">След. пн</button><button data-due="">Без даты</button></div></div>
      <div class="field"><label>Время</label><input class="inp" type="time" id="eTime" value="${draft.time || ''}">
        ${draft.time ? '<div class="chips"><button data-notime="1">Без времени</button></div>' : ''}</div>
      <div class="field"><label>Повтор</label><select class="inp" id="eRepeat">${repeatOpts.map(([v, l]) => `<option value="${v}" ${((draft.repeat || '').split(':')[0]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Раздел</label><select class="inp" id="eProject">${Object.keys(PROJECTS).map(k => `<option value="${k}" ${draft.project === k ? 'selected' : ''}>${PROJECTS[k]}</option>`).join('')}</select></div>
      ${draft.project === 'tiktok' ? `<div class="field"><label>Этап</label><select class="inp" id="eStage">${STAGES.map(s => `<option value="${s}" ${(draft.stage || 'idea') === s ? 'selected' : ''}>${STAGE_LABEL[s]}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label>Подзадачи</label>
        ${draft.subtasks.map((s, i) => `<div class="sub"><button class="check${s.done ? ' on' : ''}" data-sub="${i}"></button><span class="t">${esc(s.title)}</span><button class="x" data-subdel="${i}" aria-label="Убрать">&#10005;</button></div>`).join('')}
        <input class="inp" id="eSub" placeholder="Добавить подзадачу" enterkeyhint="done"></div>
      <div class="field"><label>Заметки</label><textarea class="inp" id="eNotes">${esc(draft.notes)}</textarea></div>
      <div class="btns"><button class="btn danger" id="eDel">Удалить</button><button class="btn" data-act="close">Отмена</button><button class="btn main" id="eSave">Сохранить</button></div>`;
  };
  const readInputs = el => {
    draft.title = el.querySelector('#eTitle').value.trim() || draft.title;
    draft.due = el.querySelector('#eDue').value || null;
    draft.time = el.querySelector('#eTime').value || null;
    if (draft.time && !draft.due) draft.due = t0;
    const r = el.querySelector('#eRepeat').value;
    draft.repeat = r === 'weekly' ? 'weekly:' + parseYmd(draft.due || t0).getDay() : (r || null);
    if (draft.repeat && !draft.due) draft.due = t0;
    draft.project = el.querySelector('#eProject').value;
    const st = el.querySelector('#eStage');
    draft.stage = draft.project === 'tiktok' ? (st ? st.value : 'idea') : null;
    draft.notes = el.querySelector('#eNotes').value;
  };
  openSheet('', el => {
    draw(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.prio) { readInputs(el); draft.priority = Number(b.dataset.prio); draw(el); }
      else if (b.dataset.due !== undefined) { readInputs(el); draft.due = b.dataset.due || null; if (!draft.due) { draft.repeat = null; draft.time = null; } draw(el); }
      else if (b.dataset.notime) { readInputs(el); draft.time = null; draw(el); }
      else if (b.dataset.sub !== undefined) { readInputs(el); const s = draft.subtasks[Number(b.dataset.sub)]; s.done = !s.done; draw(el); }
      else if (b.dataset.subdel !== undefined) { readInputs(el); draft.subtasks.splice(Number(b.dataset.subdel), 1); draw(el); }
      // Look the task up again: a sync while the sheet was open may have replaced the object
      else if (b.id === 'eSave') { readInputs(el); const cur = byId(id) || t; const keepMod = cur.modified; Object.assign(cur, draft); cur.modified = keepMod; touch(cur); commit(); closeSheet(); }
      else if (b.id === 'eDel') { const cur = byId(id) || t; const before = JSON.stringify(cur); cur.deleted = true; touch(cur); commit(); closeSheet(); toast('Удалено', before); }
    });
    el.addEventListener('change', e => { if (e.target.id === 'eProject') { readInputs(el); draw(el); } });
    el.addEventListener('keydown', e => {
      if (e.target.id === 'eSub' && e.key === 'Enter' && e.target.value.trim()) {
        e.preventDefault(); readInputs(el);
        draft.subtasks.push({ id: uid(), title: e.target.value.trim(), done: false });
        draw(el); el.querySelector('#eSub').focus();
      }
    });
  });
}

function openSettings() {
  openSheet(`<h2>Синхронизация</h2>
    <div class="hint">Задачи синхронизируются с файлом tasks.json в твоём приватном репозитории GitHub. Токен хранится только на этом устройстве.</div>
    <div class="field"><label>Ник на GitHub</label><input class="inp" id="sOwner" value="${esc(cfg.owner)}" autocapitalize="off" autocorrect="off"></div>
    <div class="field"><label>Репозиторий с данными</label><input class="inp" id="sRepo" value="${esc(cfg.repo)}" autocapitalize="off" autocorrect="off"></div>
    <div class="field"><label>Файл</label><input class="inp" id="sPath" value="${esc(cfg.path)}" autocapitalize="off" autocorrect="off"></div>
    <div class="field"><label>Токен доступа</label><input class="inp" id="sToken" type="password" value="${esc(cfg.token)}" placeholder="github_pat_..." autocomplete="off"></div>
    <div class="btns"><button class="btn" data-act="close">Отмена</button><button class="btn main" id="sSave">Сохранить</button></div>
    <div class="hint" style="margin-top:16px">Задач на устройстве: ${alive().length}</div>`, el => {
    el.querySelector('#sSave').addEventListener('click', () => {
      cfg = {
        owner: el.querySelector('#sOwner').value.trim(),
        repo: el.querySelector('#sRepo').value.trim(),
        path: el.querySelector('#sPath').value.trim() || 'tasks.json',
        token: el.querySelector('#sToken').value.trim()
      };
      lsSet(LS.cfg, cfg);
      closeSheet();
      sync();
    });
  });
}

// ---------- Toast with undo ----------
let toastTimer = null;
function toast(msg, beforeJson) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${beforeJson ? '<button id="undo">Вернуть</button>' : ''}`;
  el.hidden = false;
  if (beforeJson) {
    el.querySelector('#undo').addEventListener('click', () => {
      const prev = JSON.parse(beforeJson);
      const t = byId(prev.id);
      if (t) { Object.assign(t, prev); touch(t); commit(); }
      el.hidden = true;
    });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- Events ----------
$('#view').addEventListener('click', e => {
  const b = e.target.closest('[data-act], [data-proj]');
  if (!b) return;
  if (b.dataset.proj) { ui.project = b.dataset.proj; lsSet(LS.ui, ui); render(); return; }
  const holder = b.closest('[data-id]');
  const t = holder && byId(holder.dataset.id);
  const act = b.dataset.act;
  if (act === 'toggle-done') { ui.showDone = !ui.showDone; lsSet(LS.ui, ui); render(); return; }
  if (!t) return;
  if (act === 'check') toggleDone(t);
  else if (act === 'open') openEditor(t.id);
  else if (act === 'stage-next' || act === 'stage-prev') {
    const i = STAGES.indexOf(t.stage || 'idea') + (act === 'stage-next' ? 1 : -1);
    t.stage = STAGES[Math.max(0, Math.min(STAGES.length - 1, i))];
    if (t.stage === 'published') { t.done = true; t.doneAt = Date.now(); } else { t.done = false; t.doneAt = null; }
    touch(t); commit();
  }
});

// Swipe right = done, swipe left = tomorrow
let sw = null;
$('#view').addEventListener('touchstart', e => {
  const inner = e.target.closest('.row-in');
  if (!inner) return;
  const p = e.touches[0];
  sw = { inner, x: p.clientX, y: p.clientY, dx: 0, lock: null };
}, { passive: true });
$('#view').addEventListener('touchmove', e => {
  if (!sw) return;
  const p = e.touches[0];
  const dx = p.clientX - sw.x, dy = p.clientY - sw.y;
  if (sw.lock === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) sw.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  if (sw.lock !== 'x') return;
  e.preventDefault();
  sw.dx = dx;
  sw.inner.classList.add('drag');
  sw.inner.style.transform = `translateX(${dx}px)`;
}, { passive: false });
$('#view').addEventListener('touchend', () => {
  if (!sw) return;
  const { inner, dx, lock } = sw;
  sw = null;
  inner.classList.remove('drag');
  inner.style.transform = '';
  if (lock !== 'x') return;
  const t = byId(inner.closest('.row').dataset.id);
  if (!t) return;
  // Done task: swipe right removes it; open task: right = done, left = tomorrow
  if (dx > 90) t.done ? removeTask(t) : toggleDone(t);
  else if (dx < -90 && !t.done) postpone(t);
});

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  ui.view = b.dataset.view; lsSet(LS.ui, ui); render(); window.scrollTo(0, 0);
}));
$('#fab').addEventListener('click', openQuickAdd);
$('#settingsBtn').addEventListener('click', openSettings);
$('#syncBtn').addEventListener('click', () => configured() ? sync() : openSettings());
$('#sheet').addEventListener('click', e => {
  if (e.target.classList.contains('sheet-bg') || e.target.closest('[data-act="close"]')) closeSheet();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); sync(); } });
window.addEventListener('online', () => sync());
setInterval(() => { if (!document.hidden) sync(); }, 60000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  // A new version took over: reload once to show it
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
}

render();
sync();
