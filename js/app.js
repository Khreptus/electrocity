import { setLang, LANGS, detectLang, locale, tr } from './i18n.js';
import { ic, STATE_ICON } from './icons.js';
import { citySource, streetSource, houseSource, attachTypeahead, dtekAuto, hoeStreetQueue, skel } from './address.js';
import { API, API_READY } from './config.js';
import { REGIONS, region, queueList, kyivNow, addDays, loadSchedule, clearScheduleCache, segmentsFor, stateAt, nextChange, upcomingEvents, isLive, moeAddr } from './data.js';

// ---------- Стан ----------
const KEY = 'svitlo.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
let S = Object.assign({ addresses: [], primaryId: null, currentId: null, theme: 'system', notify: { before: 30, enabled: false } }, load());
S.lang ||= detectLang(); setLang(S.lang);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
const uid = () => Math.random().toString(36).slice(2, 9);
const cur = () => S.addresses.find(a => a.id === S.currentId) || S.addresses.find(a => a.id === S.primaryId) || S.addresses[0];

let view = S.addresses.length ? 'home' : 'welcome';
let day = 0;               // 0 сьогодні, 1 завтра
let draft = null;          // чернетка адреси в онбордингу / додаванні
let editId = null;

const NAMES = [['home', 'Дім'], ['briefcase', 'Робота'], ['users', 'Батьки'], ['tree', 'Дача'], ['edit', 'Інше']];
const STATE_TEXT = { on: 'Світло є', off: 'Відключення', possible: 'Можливе', unknown: 'Невідомо', emergency: 'Аварія' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const hmEnd = m => (m >= 1440 ? '24:00' : hm(m));
const dur = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h} год ${r} хв` : h ? `${h} год` : `${r} хв`; };
const cd = m => { const t = Math.max(0, Math.floor(m * 60)); const h = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = t % 60; return [h, mm, ss].map(x => String(x).padStart(2, '0')).join(':'); };
const addrLine = a => [a.city, a.street && `${a.street}${a.house ? ', ' + a.house : ''}`].filter(Boolean).join(' · ');

// ---------- Тема ----------
function applyTheme() {
  const dark = S.theme === 'dark' || (S.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- Рендер ----------
const $app = document.getElementById('app');
async function render() {
  applyTheme();
  const tabs = ['home', 'addresses', 'settings'].includes(view);
  let html = '';
  if (view === 'welcome') html = welcome();
  else if (view.startsWith('ob-')) html = onboarding();
  else if (view === 'home') html = await home();
  else if (view === 'detail') html = await detail();
  else if (view === 'addresses') html = await addresses();
  else if (view === 'edit') html = edit();
  else if (view === 'settings') html = settings();
  const side = tabs || view === 'detail' ? await sidebar() : '';
  $app.innerHTML = side + `<div class="desk-wrap"><main class="view ${tabs ? '' : 'no-tabs'}">${html}</main></div>` + (tabs ? tabbar() : '');
  if (view === 'ob-city') initCity();
  if (view === 'ob-address') initAddress();
  document.title = view === 'home' && cur() ? `${cur().name} · Electrocity` : 'Electrocity — графік відключень';
}

function tabbar() {
  const t = (v, i, l) => `<button data-go="${v}" ${view === v ? 'aria-current="page"' : ''}>${ic(i)}${l}</button>`;
  return `<nav class="tabs">${t('home', 'zap', 'Світло')}${t('addresses', 'map-pin', 'Адреси')}${t('settings', 'settings', 'Налаштування')}</nav>`;
}
async function sidebar() {
  const cards = await Promise.all(S.addresses.map(a => addrCard(a, true)));
  const n = (v, i, l) => `<button data-go="${v}" ${view === v ? 'aria-current="page"' : ''}>${ic(i)}${l}</button>`;
  return `<aside class="side"><div class="brand"><img src="icons/icon-192.png" alt="" width="36" height="36" style="border-radius:10px">Electrocity</div>
  <nav>${n('home', 'zap', 'Графік')}${n('addresses', 'map-pin', 'Мої адреси')}${n('settings', 'settings', 'Налаштування')}</nav>
  ${S.addresses.length ? '<div class="over" style="color:var(--stage-text-3)">Мої адреси</div>' : ''}${cards.join('')}</aside>`;
}

// ----- Головна -----
function heroInfo(data, a) {
  const { date, min } = kyivNow();
  const segs = segmentsFor(data, date, a.queue);
  const s = stateAt(segs, min);
  if (!s) return { state: 'unknown', title: 'Статус невідомий', sub: 'Немає даних для черги ' + a.queue + ' на сьогодні', note: 'Час наступної зміни невідомий' };
  const st = s[2];
  const nc = nextChange(data, date, a.queue, min);
  const q = 'Черга ' + a.queue;
  const base = { state: st, nc, min };
  if (st === 'on') return { ...base, title: 'Світло є', sub: `${q} · з ${hm(s[0])} до ${hmEnd(s[1])}`, tl: 'До відключення', nl: 'Відключення о' };
  if (st === 'off') return { ...base, title: 'Світла немає', sub: `Планове відключення · ${q}`, tl: 'До відновлення', nl: 'Відновлення о' };
  if (st === 'possible') return { ...base, title: 'Можливе відключення', sub: `${q} · ${hm(s[0])}–${hmEnd(s[1])} · попередньо`, tl: 'До відключення', nl: 'Відключення о' };
  if (st === 'emergency') return { ...base, title: 'Аварійне відключення', sub: 'Оператор повідомив про аварію', note: 'Час відновлення невідомий' };
  return { ...base, title: 'Статус невідомий', sub: 'Немає достовірних даних на цей час', note: 'Час наступної зміни невідомий' };
}
function stage(a, h, loading) {
  const st = loading ? 'loading' : h.state;
  const lampState = st === 'on' ? 'on' : st;
  const badgeBg = { on: 'var(--on)', off: 'var(--off)', possible: 'var(--possible)', emergency: 'var(--emergency)', unknown: 'var(--unknown)', loading: 'var(--unknown)' }[st];
  let body;
  if (loading) body = `<div class="hero"><div class="src"><span class="badge" style="background:${badgeBg}">${ic('refresh')}</span>За опублікованим графіком</div><h1 style="color:var(--stage-text)">Графік оновлюється</h1><div class="sub" style="color:var(--stage-text-2)">Перевіряємо джерела…</div><div style="display:grid;gap:8px;margin-top:16px"><div class="skel" style="width:180px"></div><div class="skel" style="width:120px"></div></div></div>`;
  else {
    const timer = h.nc ? `<div class="timer"><div><div class="lbl">${h.tl}</div><div class="big" data-countdown="${h.nc.at}">${cd(h.nc.at - h.min)}</div></div><div><div class="lbl" style="text-align:right">${h.nl}</div><div class="nx">${hm(h.nc.at)}</div></div></div>`
      : `<div class="note">${ic('clock')}${h.note || 'Час наступної зміни невідомий'}</div>`;
    body = `<div class="hero st-${h.state}"><div class="src"><span class="badge" style="background:${badgeBg}">${ic(STATE_ICON[h.state] || 'help')}</span>За опублікованим графіком</div><h1>${h.title}</h1><div class="sub">${esc(h.sub)}</div>${timer}</div>`;
  }
  return `<section class="stage" data-state="${lampState}"><div class="glow"></div><img class="lamp off" src="assets/lamp-off.webp" alt=""><img class="lamp on" src="assets/lamp-on.webp" alt="">
   <button class="loc" data-act="switcher"><span class="tile">${ic(NAMES.find(n => n[1] === a.name)?.[0] || 'home')}</span><span class="txt"><span class="name">${esc(a.name)} ${ic('chevron-down')}</span><span class="addr">${esc(addrLine(a) || region(a.regionId)?.name)}</span></span><span class="tile round" data-act="notif" role="button" aria-label="Сповіщення">${ic('bell')}</span></button>
   <div class="lamp-space"></div>${body}</section>`;
}

function scaleHTML(segs, nowMin, opts = {}) {
  if (!segs) return '';
  const pct = m => (m / 1440 * 100).toFixed(3) + '%';
  let h = `<div class="scale ${opts.compact ? 'compact' : ''}" role="img" aria-label="Графік на добу"><div class="track">`;
  segs.forEach((s, i) => {
    const w = (s[1] - s[0]) / 1440 * 100;
    const gap = i < segs.length - 1 ? 2 : 0;
    h += `<button class="s ${s[2]}" style="left:${pct(s[0])};width:calc(${w.toFixed(3)}% - ${gap}px)" data-act="seg" data-i="${i}" aria-label="${STATE_TEXT[s[2]]} ${hm(s[0])}–${hmEnd(s[1])}">${!opts.compact && w > 6 ? ic(STATE_ICON[s[2]]) : ''}</button>`;
  });
  if (nowMin != null) h += `<div class="past" style="width:${pct(nowMin)}"></div>`;
  h += '</div>';
  if (nowMin != null) h += `<div class="nowline" style="left:${pct(nowMin)}"></div><div class="nowdot" style="left:${pct(nowMin)}"></div>` + (opts.compact ? '' : `<div class="pill" style="left:clamp(22px,${pct(nowMin)},calc(100% - 22px))">${hm(nowMin)}</div>`);
  if (!opts.compact) {
    for (let i = 1; i < 24; i++) h += `<i class="tick ${i % 3 ? '' : 'b'}" style="left:${pct(i * 60)}"></i>`;
    for (let i = 0; i <= 24; i += 3) h += `<span class="lab" style="left:${pct(i * 60)};${i === 24 ? 'transform:translateX(-100%)' : i === 0 ? 'transform:none' : ''}">${String(i).padStart(2, '0')}</span>`;
  }
  return h + '</div>';
}
function evRow(s, min, isToday) {
  const st = s[2];
  const title = { on: 'Світло є', off: 'Відключення', possible: 'Можливе відключення', unknown: 'Немає даних', emergency: 'Аварійне відключення' }[st];
  const now = isToday && min >= s[0] && min < s[1];
  const rel = !isToday ? '' : now ? `ще ${dur(s[1] - min)}` : s[0] > min ? `через ${dur(s[0] - min)}` : '';
  return `<div class="ev ${isToday && s[1] <= min ? 'past' : ''}"><span class="t">${hm(s[0])}</span><span class="b ${st}">${ic(STATE_ICON[st])}</span><span class="tx"><span class="tt">${title}${now ? ' · зараз' : ''}</span><br><span class="d">${hm(s[0])} – ${hmEnd(s[1])} · ${dur(s[1] - s[0])}</span></span><span class="r">${rel}</span></div>`;
}
function sourceLine(data, a) {
  if (data.demo) return `<div class="source warn">${ic('info')}Демо-дані · джерело ${esc(region(a.regionId)?.opName)} ще не підключене</div>`;
  const t = data.updatedAt ? new Date(data.updatedAt).toLocaleString(locale(), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
  const when = data.live ? 'дані в реальному часі' : data.publishedAt ? `опубліковано ${esc(data.publishedAt)}` : t ? `оновлено ${t}` : '';
  return `<a class="source ok" href="${esc(data.source?.url || '#')}" target="_blank" rel="noopener">${ic('shield')}${esc(data.name || region(a.regionId)?.opName)} · ${when} ${ic('external')}</a>`;
}
function banners(data) {
  let b = '';
  if (!navigator.onLine) b += `<div class="banner warn">${ic('wifi-off')}<div><div class="bt">Немає з’єднання</div><div class="bb">Показуємо збережений графік.</div></div></div>`;
  if (data.demo) b += `<div class="banner demo">${ic('info')}<div><div class="bt">Це демо-графік</div><div class="bb">Реальні дані оператора підключимо найближчим часом. Не орієнтуйтеся на ці інтервали.</div></div></div>`;
  return b;
}
async function home() {
  const a = cur();
  if (!a) { view = 'welcome'; return welcome(); }
  const data = await loadSchedule(region(a.regionId).op);
  const h = heroInfo(data, a);
  const { date, min } = kyivNow();
  const d = addDays(date, day);
  const segs = segmentsFor(data, d, a.queue);
  const isToday = day === 0;
  const tmr = segmentsFor(data, addDays(date, 1), a.queue);
  const evs = isToday ? upcomingEvents(segs, min).slice(0, 3) : (segs || []);
  const scaleBlock = segs ? scaleHTML(segs, isToday ? min : null) :
    `<div class="empty-day">${ic('calendar')}<div class="h-s" style="font-size:16px">Графік на ${isToday ? 'сьогодні' : 'завтра'} ще не опубліковано</div><div class="body-s">Зазвичай оператор публікує його ввечері.</div></div>`;
  return stage(a, h) + `<section class="sheet">${banners(data)}
   <div class="card"><div class="row-head"><div class="h-s">Графік на ${isToday ? 'сьогодні' : 'завтра'}</div><button class="link" data-go="detail">Детальніше ${ic('chevron-right')}</button></div>
   <div class="seg" role="group"><button data-day="0" aria-pressed="${isToday}">Сьогодні</button><button data-day="1" aria-pressed="${!isToday}" ${tmr ? '' : ''}>Завтра</button></div>
   ${scaleBlock}${evs.map(s => evRow(s, min, isToday)).join('')}${sourceLine(data, a)}</div></section>`;
}
async function detail() {
  const a = cur(); const data = await loadSchedule(region(a.regionId).op);
  const { date, min } = kyivNow(); const d = addDays(date, day); const isToday = day === 0;
  const segs = segmentsFor(data, d, a.queue);
  const sum = st => (segs || []).filter(s => st.includes(s[2])).reduce((t, s) => t + s[1] - s[0], 0);
  const tile = (l, v, c) => `<div class="card" style="flex:1;gap:2px;padding:12px;border-radius:16px"><span class="cap">${l}</span><span class="h-s" style="color:var(--${c}-ink)">${v}</span></div>`;
  return `${band(`Графік · Черга ${esc(a.queue)}`, true)}<section class="sheet r32">
   <div class="seg"><button data-day="0" aria-pressed="${isToday}">Сьогодні</button><button data-day="1" aria-pressed="${!isToday}">Завтра</button></div>
   ${segs ? `<div class="card">${scaleHTML(segs, isToday ? min : null)}</div><div style="display:flex;gap:8px">${tile('Зі світлом', dur(sum(['on'])), 'on')}${tile('Без світла', dur(sum(['off', 'emergency'])), 'off')}${tile('Можливо', dur(sum(['possible'])), 'possible')}</div>
   <div class="card" style="gap:0;padding:4px 16px">${segs.map(s => evRow(s, min, isToday)).join('')}</div>` : `<div class="empty-day">${ic('calendar')}<div>Графік ще не опубліковано</div></div>`}
   <div class="card" style="gap:10px">${sourceLine(data, a)}<div class="cap">Графік може змінюватися протягом дня. Статус — за опублікованим графіком, а не фактична наявність світла.</div></div></section>`;
}

// ----- Адреси -----
async function addrCard(a, compact) {
  const data = await loadSchedule(region(a.regionId).op);
  const { date, min } = kyivNow();
  const segs = segmentsFor(data, date, a.queue); const s = stateAt(segs, min); const st = s ? s[2] : 'unknown';
  const nc = nextChange(data, date, a.queue, min);
  const next = nc ? `${['off', 'emergency'].includes(nc.state) ? 'Відключення' : 'Відновлення'} о ${hm(nc.at)}` : '';
  const icn = NAMES.find(n => n[1] === a.name)?.[0] || 'map-pin';
  return `<div class="acard ${a.id === cur()?.id ? 'sel' : ''}" data-act="pick" data-id="${a.id}" role="button" tabindex="0">
   <div class="hd"><span class="at">${ic(icn)}</span><span style="flex:1;min-width:0"><span class="nm">${esc(a.name)}${a.id === S.primaryId ? ic('star', '" style="width:14px;height:14px;color:var(--possible)') : ''}</span><span class="ad" style="display:block">${esc(addrLine(a) || region(a.regionId).name)}</span></span>${compact ? '' : `<button data-act="edit" data-id="${a.id}" aria-label="Змінити">${ic('more')}</button>`}</div>
   <div class="ft"><span class="pill ${st}"><i></i>${STATE_TEXT[st]}</span><span class="chip">${ic('grid')}Черга ${esc(a.queue)}</span></div>
   <div class="ft" style="justify-content:space-between;flex-wrap:nowrap"><div style="width:140px">${scaleHTML(segs, min, { compact: true })}</div><span class="cap">${next}</span></div></div>`;
}
async function addresses() {
  const cards = await Promise.all(S.addresses.map(a => addrCard(a)));
  return `<div class="band"><div class="bar"><span class="h-l">Мої адреси</span><button class="btn-ic" data-act="add" aria-label="Додати адресу">${ic('plus')}</button></div><div class="body-s">Основна адреса (зірочка) відкривається при запуску.</div></div>
   <section class="sheet r32">${cards.join('')}<button class="btn secondary" data-act="add">${ic('plus')} Додати адресу</button></section>`;
}
function edit() {
  const a = S.addresses.find(x => x.id === editId); if (!a) { view = 'addresses'; return ''; }
  const r = region(a.regionId);
  return `${band('Редагування', true, 'addresses')}<section class="sheet r32">
   <div class="cap">Назва</div><div class="namechips">${NAMES.map(([i, l]) => `<button data-act="rename" data-v="${l}" aria-pressed="${a.name === l}">${ic(i)}${l}</button>`).join('')}</div>
   <div class="list">
    <div class="li"><span class="lt">${ic('globe')}</span><span class="tx"><span class="tt">${esc(r.name)}</span><br><span class="st">${esc(r.opName)}</span></span></div>
    <div class="li"><span class="lt">${ic('map-pin')}</span><span class="tx"><span class="tt">${esc(addrLine(a) || 'Адресу не вказано')}</span></span></div>
    <button class="li" data-act="requeue"><span class="lt">${ic('grid')}</span><span class="tx"><span class="tt">Черга ${esc(a.queue)}</span><br><span class="st">Змінити чергу</span></span>${ic('chevron-right', 'chev')}</button>
    <button class="li" data-act="primary"><span class="lt">${ic('star')}</span><span class="tx"><span class="tt">Основна адреса</span></span><span class="toggle" role="switch" aria-checked="${S.primaryId === a.id}"></span></button>
   </div>
   <button class="btn danger" data-act="delete">${ic('trash')} Видалити адресу</button></section>`;
}

// ----- Налаштування -----
function settings() {
  const th = { system: 'Системна', light: 'Світла', dark: 'Темна' }[S.theme];
  const li = (act, i, t, st, val, tail = ic('chevron-right', 'chev')) => `<button class="li" data-act="${act}"><span class="lt">${ic(i)}</span><span class="tx"><span class="tt">${t}</span>${st ? `<br><span class="st">${st}</span>` : ''}</span>${val ? `<span class="val">${val}</span>` : ''}${tail}</button>`;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `<div class="band"><span class="h-l">Налаштування</span></div><section class="sheet r32">
   <div class="over">Основне</div><div class="list">${li('notif', 'bell', 'Сповіщення', S.notify.enabled ? 'Увімкнено' : perm === 'denied' ? 'Заборонено в системі' : 'Вимкнено', '')}</div>
   <div class="over">Вигляд</div><div class="list">${li('theme', 'moon', 'Тема', null, th)}${li('lang', 'globe', 'Мова', null, `<span data-noi18n>${LANGS[S.lang]}</span>`)}</div>
   <div class="over">Поділитися</div><div class="list"><a class="li" href="install/"><span class="lt">${ic('share')}</span><span class="tx"><span class="tt">Сторінка встановлення</span><br><span class="st">Надішліть друзям — iPhone, Android, Mac</span></span>${ic('chevron-right', 'chev')}</a></div>
   <div class="over">Віджет</div><div class="list"><a class="li" href="widget/"><span class="lt">${ic('grid')}</span><span class="tx"><span class="tt">Віджет для iPhone</span><br><span class="st">Статус і таймер на головному екрані</span></span>${ic('chevron-right', 'chev')}</a></div>
   <div class="over">Дані</div><div class="list">${li('sources', 'shield', 'Джерела даних', 'Офіційні оператори')}${li('clearcache', 'database', 'Оновити графіки', 'Скинути збережені дані графіків', '', '')}</div>
   <div class="over">Про застосунок</div><div class="list">${li('noop', 'lock', 'Конфіденційність', 'Без акаунта. Адреси зберігаються лише на цьому пристрої', '', '')}${li('noop', 'info', 'Версія', null, '0.1 (бета)', '')}</div></section>`;
}
function band(title, back, backTo = 'home') {
  return `<div class="band"><div class="bar">${back ? `<button class="btn-ic" data-go="${backTo}" aria-label="Назад">${ic('chevron-left')}</button>` : '<span></span>'}<span class="ttl">${title}</span><span style="width:40px"></span></div></div>`;
}

// ----- Онбординг -----
function welcome() {
  const sample = [[0, 180, 'on'], [180, 390, 'off'], [390, 600, 'on'], [600, 810, 'off'], [810, 1140, 'on'], [1140, 1350, 'off'], [1350, 1410, 'possible'], [1410, 1440, 'on']];
  return `<section class="stage" data-state="on" style="padding-bottom:80px"><div class="glow"></div><img class="lamp off" src="assets/lamp-off.webp" alt=""><img class="lamp on" src="assets/lamp-on.webp" alt="">
   <div style="height:230px"></div><h1 style="font-size:28px;line-height:34px;font-weight:600;letter-spacing:-.01em">Знайте, коли буде <span style="color:var(--light)">світло</span></h1>
   <p style="color:var(--stage-text-2);margin-top:12px;font-size:16px;line-height:22px">Графік відключень для вашої адреси по всій Україні. Дані — з офіційних джерел операторів.</p></section>
   <section class="sheet" style="gap:24px;padding-top:24px">
    <div class="card" aria-hidden="true"><div class="row-head"><span class="pill on"><i></i>Світло є</span><span class="mono" style="font-size:15px;font-weight:500">До відключення 02:37</span></div>${scaleHTML(sample, 16 * 60 + 23)}</div>
    ${[['map-pin', 'Черга за адресою — без пошуку в таблицях'], ['bell', 'Попередження перед відключенням']].map(([i, t]) => `<div style="display:flex;gap:12px;align-items:center"><span style="width:32px;height:32px;border-radius:10px;background:var(--surface);display:grid;place-items:center;flex:none">${ic(i)}</span><span style="font-size:14px">${t}</span></div>`).join('')}
    <div style="flex:1"></div><div style="display:flex;flex-direction:column;gap:10px"><button class="btn primary" data-act="start">Налаштувати адресу</button><div class="cap3" style="text-align:center">Без реєстрації та номера телефону</div></div></section>`;
}
// Пошук області: за назвою, містом або оператором; «хмельницький» знаходить «Хмельницька»
const rnorm = t => String(t || '').toLowerCase().replace(/[’'ʼ`]/g, '').replace(/[^a-zа-яіїєґ0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function regionMatch(x, q) {
  q = rnorm(q); if (!q) return true;
  const hay = rnorm([x.name, x.opName, x.center, ...(x.cities || [])].join(' '));
  if (hay.includes(q)) return true;
  const stem = q.length >= 5 ? q.slice(0, -2) : null; // відкидаємо закінчення
  if (stem && hay.split(' ').some(w => w.startsWith(stem))) return true;
  // російською: «Николаев», «Кривой Рог», «Хмельницкий»
  const sq = skel(q.replace(/^никола/, 'микола')); if (sq.replace(/\*/g, '').length < 2) return false;
  return (' ' + skel(hay)).includes(' ' + sq); // з початку слова, можна кілька слів («Кривой Рог»)
}
function manualReason(r) {
  if (r.op === 'hoe') return 'Черга визначається за офіційними списками адрес Хмельницькобленерго — оберіть населений пункт, вулицю й будинок зі списку підказок. Якщо адреси там немає, перевірте чергу на hoe.com.ua → «Перевірити чергу» і оберіть її тут.';
  if (r.op.startsWith('dtek-')) return 'Автовизначення черги для ДТЕК з’явиться після підключення сервера (вже в плані). Поки що черга вказана на сайті ДТЕК у розділі «Відключення» за вашою адресою.';
  if (r.addressLookup === 'moe') return 'Оберіть населений пункт, вулицю й будинок зі списку підказок — тоді черга визначиться автоматично.';
  return 'Для цього оператора автоматичне визначення черги поки недоступне. Черга вказана в особовому кабінеті оператора або в рахунку.';
}
function steps(n) { return `<div class="steps">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? 'a' : ''}"></i>`).join('')}</div><div class="cap3">Крок ${n} з 4</div>`; }
function onboarding() {
  const back = S.addresses.length && view === 'ob-region' ? 'addresses' : null;
  const bk = (to) => `<div class="band"><div class="bar"><button class="btn-ic" data-ob="${to}" aria-label="Назад">${ic('chevron-left')}</button><span class="ttl">${{ 'ob-region': 'Область', 'ob-city': 'Населений пункт', 'ob-method': 'Спосіб', 'ob-address': 'Адреса', 'ob-queue': 'Черга', 'ob-confirm': 'Підтвердження' }[view]}</span><span style="width:40px"></span></div></div>`;
  const r = draft.regionId && region(draft.regionId);
  if (view === 'ob-region') return bk(back ? 'back-addresses' : 'welcome') + `<section class="sheet r32">${steps(1)}
    <label class="field">${ic('search')}<input id="q" placeholder="Пошук області" autocomplete="off" value="${esc(draft.q || '')}"></label>
    <div class="list" id="rlist">${REGIONS.filter(x => regionMatch(x, draft.q)).map(x => `<button class="li" data-act="region" data-id="${x.id}"><span class="tx"><span class="tt">${x.name}</span><br><span class="st">${x.opName}</span></span>${ic('chevron-right', 'chev')}</button>`).join('')}</div><div class="cap3" id="rnone" style="text-align:center;padding:16px" ${REGIONS.some(x => regionMatch(x, draft.q)) ? 'hidden' : ''}>Область не знайдено. Спробуйте назву міста, наприклад «Кривий Ріг».</div></section>`;
  if (view === 'ob-city') return bk('ob-region') + `<section class="sheet r32">${steps(2)}<div class="cap">${esc(r.name)} · ${esc(r.opName)}</div>
    <label class="field">${ic('search')}<input id="city" placeholder="Почніть вводити назву" value="${esc(draft.city || '')}" autocomplete="off" autocapitalize="words" enterkeyhint="next"></label>
    <div class="body-s">Оберіть зі списку або введіть назву повністю.</div>
    <div style="flex:1"></div><button class="btn primary" data-act="city-next">Продовжити</button></section>`;
  if (view === 'ob-method') return bk('ob-city') + `<section class="sheet r32">${steps(3)}<div class="h-l">Як визначити ваш графік?</div>
    <button class="opt" data-act="method" data-v="address" aria-pressed="${draft.method === 'address'}"><span class="ot">${ic('map-pin')}</span><span><span class="h-s">За адресою</span><br><span class="body-s">Вкажіть вулицю й будинок — чергу визначимо автоматично, щойно оператор це підтримає</span></span></button>
    <button class="opt" data-act="method" data-v="queue" aria-pressed="${draft.method === 'queue'}"><span class="ot">${ic('grid')}</span><span><span class="h-s">Я знаю свою чергу</span><br><span class="body-s">Оберіть чергу або підчергу зі списку оператора</span></span></button>
    <div style="flex:1"></div><button class="btn primary" data-act="method-next">Продовжити</button></section>`;
  if (view === 'ob-address') { const auto = (r.addressLookup === 'moe' && draft.nsId) || dtekAuto(r) || (r.op === 'hoe' && draft.hoeId); return bk('ob-method') + `<section class="sheet r32">${steps(4)}<div class="cap">${esc(draft.city)} · ${esc(r.opName)}</div>
    <label class="field">${ic('search')}<input id="street" placeholder="Вулиця — почніть вводити" value="${esc(draft.street || '')}" autocomplete="off" enterkeyhint="next"></label>
    <label class="field">${ic('home')}<input id="house" placeholder="Номер будинку" value="${esc(draft.house || '')}" autocomplete="off" enterkeyhint="done"></label>
    <div id="addr-res"></div>
    ${auto ? '' : `<div class="banner warn">${ic('alert')}<div><div class="bt">Чергу доведеться обрати вручну</div><div class="bb">${manualReason(r)}</div></div></div>`}
    <div style="flex:1"></div><button class="btn primary" id="addr-next" data-act="address-next">${auto ? 'Обрати чергу вручну' : 'Обрати чергу'}</button></section>`; }
  if (view === 'ob-queue') { const ql = queueList(r.queues); return bk(draft.method === 'address' ? 'ob-address' : 'ob-method') + `<section class="sheet r32">${steps(4)}<div class="h-l">Оберіть чергу</div>${draft.method === 'address' && !draft.autoQueue && !draft.editOf ? `<div class="banner warn">${ic('alert')}<div><div class="bt">Не вдалося визначити чергу автоматично</div><div class="bb">Оберіть її вручну. ${esc(manualReason(r))}</div></div></div>${r.op === 'hoe' ? `<a class="btn" href="https://hoe.com.ua/shutdown/queue" target="_blank" rel="noopener">${ic('external')}Перевірити на сайті обленерго</a>` : ''}` : ''}<div class="body-s">Черги ${esc(r.opName)}</div>
    <div class="qgrid ${r.queues.type === 'plain' ? 'c3' : ''}">${ql.map(q => `<button class="qcell" data-act="queue" data-v="${q}" aria-pressed="${draft.queue === q}">${q}</button>`).join('')}</div>
    <div style="flex:1"></div><button class="btn primary" data-act="queue-next" ${draft.queue ? '' : 'disabled'}>${draft.queue ? 'Обрати ' + draft.queue : 'Оберіть чергу'}</button></section>`; }
  if (view === 'ob-confirm') return bk('ob-queue') + `<section class="sheet r32"><div class="h-l">Все готово</div>
    <div class="card">${[['Населений пункт', `${draft.city}, ${r.name}`], ['Адреса', [draft.street, draft.house].filter(Boolean).join(', ') || '—'], ['Оператор', r.opName]].map(([k, v]) => `<div><div class="cap3">${k}</div><div style="font-weight:500">${esc(v)}</div></div>`).join('')}<div><span class="chip">${ic('grid')}Черга ${esc(draft.queue)}</span></div></div>
    <div class="cap">Назва адреси</div><div class="namechips">${NAMES.map(([i, l]) => `<button data-act="dname" data-v="${l}" aria-pressed="${draft.name === l}">${ic(i)}${l}</button>`).join('')}</div>
    <div style="flex:1"></div><button class="btn primary" data-act="save">Перейти до графіка</button></section>`;
  return '';
}

// ---------- Листи ----------
function openSheet(html, cls = '') {
  closeSheet();
  const o = document.createElement('div'); o.className = 'overlay'; o.dataset.act = 'close';
  const s = document.createElement('div'); s.className = 'bsheet ' + cls; s.setAttribute('role', 'dialog'); s.innerHTML = '<div class="grab"></div>' + html;
  document.body.append(o, s);
}
function closeSheet() { document.querySelectorAll('.overlay,.bsheet').forEach(n => n.remove()); }
function toast(t) { document.querySelector('.toast')?.remove(); const d = document.createElement('div'); d.className = 'toast'; d.innerHTML = ic('check') + esc(t); document.body.append(d); setTimeout(() => d.remove(), 3500); }

async function segSheet(i) {
  const a = cur(); const data = await loadSchedule(region(a.regionId).op); const { date } = kyivNow();
  const s = segmentsFor(data, addDays(date, day), a.queue)[i]; if (!s) return;
  const title = { on: 'Світло є', off: 'Планове відключення', possible: 'Можливе відключення', unknown: 'Немає даних', emergency: 'Аварійне відключення' }[s[2]];
  openSheet(`<div style="display:flex;gap:12px;align-items:center"><span class="b ${s[2]}" style="width:44px;height:44px;border-radius:14px;display:grid;place-items:center">${ic(STATE_ICON[s[2]])}</span><div><div class="h-s" style="font-size:22px">${title}</div><div class="cap">${day ? 'Завтра' : 'Сьогодні'} · Черга ${esc(a.queue)}</div></div></div>
   <div class="times"><div><div class="cap3">Початок</div><div class="mono" style="font-size:20px;font-weight:600">${hm(s[0])}</div></div><div><div class="cap3">Кінець</div><div class="mono" style="font-size:20px;font-weight:600">${hmEnd(s[1])}</div></div><div><div class="cap3">Тривалість</div><div style="font-weight:500;margin-top:2px">${dur(s[1] - s[0])}</div></div></div>
   ${sourceLine(data, a)}<button class="btn secondary" data-act="close">Закрити</button>`);
}
async function switcherSheet() {
  const cards = await Promise.all(S.addresses.map(a => addrCard(a, true)));
  openSheet(`<div class="row-head"><div class="h-s" style="font-size:22px">Мої адреси</div><button class="link" data-go="addresses" data-act="close">Керувати</button></div>${cards.join('')}<button class="btn secondary" data-act="add">${ic('plus')} Додати адресу</button>`, 'bg');
}
function themeSheet() {
  openSheet(`<div class="h-s" style="font-size:22px">Тема</div><div class="list" style="background:var(--surface-2)">${[['system', 'Системна'], ['light', 'Світла'], ['dark', 'Темна']].map(([k, l]) => `<button class="li" data-act="settheme" data-v="${k}"><span class="tx"><span class="tt">${l}</span></span>${S.theme === k ? ic('check', '" style="color:var(--accent)') : ''}</button>`).join('')}</div>`);
}
function sourcesSheet() {
  const ops = [...new Set(S.addresses.map(a => a.regionId))].map(region);
  openSheet(`<div class="h-s" style="font-size:22px">Джерела даних</div><div class="body-s">Пріоритет — офіційні дані операторів. Неофіційні повідомлення ніколи не змішуються з графіком без позначки.</div>
   ${ops.map(r => `<div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="h-s">${esc(r.opName)}</div><div class="source ${isLive(r.op) ? 'ok' : 'warn'}">${ic(isLive(r.op) ? 'shield' : 'info')}${isLive(r.op) ? 'Офіційне джерело підключено' : 'Джерело ще не підключене — показуємо демо-дані'}</div></div>`).join('') || '<div class="body-s">Додайте адресу, щоб побачити джерела.</div>'}`);
}
async function notifSheet() {
  const sup = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const N = S.notify; N.types ||= { before: true, restore: true, change: true, tomorrow: true }; N.lead ||= 30;
  let body;
  if (ios && !standalone) body = `<div class="h-s" style="font-size:22px">Додайте на початковий екран</div><div class="body-s">На iPhone сповіщення працюють лише для застосунку, встановленого на початковий екран (iOS 16.4+).</div>
    <div class="list" style="background:var(--surface-2)">${[['share', 'Натисніть «Поділитися» в Safari'], ['plus', 'Оберіть «На початковий екран»'], ['bell', 'Відкрийте Electrocity з екрана й увімкніть сповіщення']].map(([i, t], n) => `<div class="li"><span class="lt">${n + 1}</span><span class="tx"><span class="tt" style="font-size:14px">${t}</span></span>${ic(i)}</div>`).join('')}</div>`;
  else if (!sup) body = `<div class="h-s" style="font-size:22px">Сповіщення недоступні</div><div class="body-s">Цей браузер не підтримує веб-сповіщення.</div>`;
  else if (Notification.permission === 'denied') body = `<div class="h-s" style="font-size:22px">Сповіщення вимкнено в системі</div><div class="body-s">Дозвольте сповіщення для цього сайту в налаштуваннях браузера або системи, потім поверніться сюди.</div>`;
  else if (!API_READY) body = `<div class="h-s" style="font-size:22px">Сервер сповіщень підключається</div><div class="body-s">Спробуйте трохи згодом.</div>`;
  else {
    const tg = (k, t, st) => `<button class="li" data-act="ntype" data-k="${k}"><span class="tx"><span class="tt">${t}</span>${st ? `<br><span class="st">${st}</span>` : ''}</span><span class="toggle" role="switch" aria-checked="${N.types[k] !== false}"></span></button>`;
    body = `<div class="h-s" style="font-size:22px">Сповіщення</div>
    <button class="li" data-act="npush" style="background:var(--surface-2);border-radius:16px"><span class="lt">${ic('bell')}</span><span class="tx"><span class="tt">Надсилати сповіщення</span><br><span class="st">Для всіх ваших адрес (${S.addresses.length})</span></span><span class="toggle" role="switch" aria-checked="${!!N.enabled}"></span></button>
    ${N.enabled ? `<div class="cap">Попереджати за</div><div class="seg">${[15, 30, 60].map(m => `<button data-act="nlead" data-v="${m}" aria-pressed="${N.lead === m}">${m === 60 ? '1 год' : m + ' хв'}</button>`).join('')}</div>
    <div class="list" style="background:var(--surface-2)">${tg('before', 'Перед відключенням')}${tg('restore', 'Перед відновленням')}${tg('change', 'Графік змінено', 'Що саме змінилось: було → стало')}${tg('tomorrow', 'Опубліковано графік на завтра')}</div>
    <button class="btn secondary" data-act="ntest">Надіслати тестове сповіщення</button>` : `<div class="body-s">Попередимо перед відключенням і відновленням, повідомимо про зміни графіка й публікацію графіка на завтра.</div>`}`;
  }
  openSheet(body + `<button class="btn ghost" data-act="close">Закрити</button>`);
}
async function pushSub(create) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) { const { key } = await (await fetch(`${API}api/vapid`)).json(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: (k => { k = k.replace(/-/g, '+').replace(/_/g, '/'); while (k.length % 4) k += '='; return Uint8Array.from(atob(k), c => c.charCodeAt(0)); })(key) }); }
  return sub;
}
async function syncPush() {
  if (!S.notify.enabled || !API_READY) return;
  try { const sub = await pushSub(false); if (!sub) return;
    await fetch(`${API}api/push/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), lead: S.notify.lead, types: S.notify.types, lang: S.lang, addrs: S.addresses.map(a => ({ op: region(a.regionId).op, queue: a.queue, name: a.name })) }) });
  } catch {}
}

// ---------- Події ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act],[data-go],[data-day],[data-ob]');
  if (!t) return;
  const act = t.dataset.act;
  if (t.dataset.go) { closeSheet(); view = t.dataset.go; if (view !== 'detail') day = day; return render(); }
  if (t.dataset.day) { day = +t.dataset.day; return render(); }
  if (t.dataset.ob) { if (t.dataset.ob === 'back-addresses') { view = 'addresses'; draft = null; } else view = t.dataset.ob; return render(); }
  switch (act) {
    case 'close': closeSheet(); break;
    case 'start': case 'add': closeSheet(); draft = { method: 'address', name: S.addresses.some(a => a.name === 'Дім') ? 'Робота' : 'Дім' }; view = 'ob-region'; render(); break;
    case 'region': draft.regionId = t.dataset.id; draft.city = ''; draft.queue = null; view = 'ob-city'; render(); break;
    case 'city-next': { const v = document.getElementById('city').value.trim(); if (!v) { document.getElementById('city').focus(); break; } if (v !== draft.city) { draft.nsId = null; } draft.city = v; draft.street = draft.street || ''; view = 'ob-method'; render(); break; }
    case 'method': draft.method = t.dataset.v; if (view === 'ob-address') view = 'ob-queue'; render(); break;
    case 'method-next': view = draft.method === 'address' ? 'ob-address' : 'ob-queue'; render(); break;
    case 'address-next': draft.street = document.getElementById('street').value.trim(); draft.house = document.getElementById('house').value.trim(); view = draft.autoQueue ? 'ob-confirm' : 'ob-queue'; render(); break;
    case 'queue': draft.queue = t.dataset.v; render(); break;
    case 'queue-next': if (draft.editOf) { const a = S.addresses.find(x => x.id === draft.editOf); a.queue = draft.queue; save(); syncPush(); draft = null; view = 'edit'; toast('Чергу змінено'); } else view = 'ob-confirm'; render(); break;
    case 'dname': draft.name = t.dataset.v; render(); break;
    case 'save': { const a = { id: uid(), name: draft.name, regionId: draft.regionId, city: draft.city, street: draft.street || '', house: draft.house || '', queue: draft.queue };
      S.addresses.push(a); if (!S.primaryId) S.primaryId = a.id; S.currentId = a.id; save(); syncPush(); draft = null; view = 'home'; day = 0; await render(); toast(`Адресу «${a.name}» збережено`); break; }
    case 'switcher': if (e.target.closest('[data-act=notif]')) { notifSheet(); break; } switcherSheet(); break;
    case 'notif': notifSheet(); break;
    case 'pick': if (e.target.closest('[data-act=edit]')) break; S.currentId = t.dataset.id; save(); closeSheet(); view = 'home'; day = 0; render(); break;
    case 'edit': editId = t.dataset.id; view = 'edit'; render(); break;
    case 'rename': { const a = S.addresses.find(x => x.id === editId); a.name = t.dataset.v; save(); syncPush(); render(); break; }
    case 'primary': S.primaryId = editId; save(); render(); break;
    case 'requeue': { const a = S.addresses.find(x => x.id === editId); draft = { regionId: a.regionId, queue: a.queue, editOf: a.id, method: 'queue' }; view = 'ob-queue'; render(); break; }
    case 'delete': { const a = S.addresses.find(x => x.id === editId); if (!confirm(tr(`Видалити «${a.name}»? Адресу буде видалено з цього пристрою.`))) break;
      S.addresses = S.addresses.filter(x => x.id !== editId); if (S.primaryId === editId) S.primaryId = S.addresses[0]?.id || null; if (S.currentId === editId) S.currentId = S.primaryId; save(); syncPush(); view = S.addresses.length ? 'addresses' : 'welcome'; render(); toast('Адресу видалено'); break; }
    case 'seg': segSheet(+t.dataset.i); break;
    case 'theme': themeSheet(); break;
    case 'lang': openSheet(`<div class="h-s" style="font-size:22px">Мова</div><div class="list" style="background:var(--surface-2)" data-noi18n>${Object.entries(LANGS).map(([k, l]) => `<button class="li" data-act="setlang" data-v="${k}"><span class="tx"><span class="tt">${l}</span></span>${S.lang === k ? ic('check', '" style="color:var(--accent)') : ''}</button>`).join('')}</div>`); break;
    case 'setlang': S.lang = t.dataset.v; save(); setLang(S.lang); closeSheet(); render(); syncPush(); break;
    case 'settheme': S.theme = t.dataset.v; save(); closeSheet(); render(); break;
    case 'sources': sourcesSheet(); break;
    case 'clearcache': clearScheduleCache(); if ('caches' in window) { const k = await caches.keys(); await Promise.all(k.filter(x => x.includes('data')).map(x => caches.delete(x))); } toast('Графіки оновлено'); render(); break;
    case 'npush': try {
        if (!S.notify.enabled) { const p = await Notification.requestPermission(); if (p !== 'granted') { notifSheet(); break; } await pushSub(true); S.notify.enabled = true; save(); await syncPush(); toast('Сповіщення увімкнено'); }
        else { const sub = await pushSub(false); if (sub) { await fetch(`${API}api/push/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe(); } S.notify.enabled = false; save(); toast('Сповіщення вимкнено'); }
      } catch (err) { toast('Не вдалося: ' + (err.message || err)); } notifSheet(); render(); break;
    case 'nlead': S.notify.lead = +t.dataset.v; save(); syncPush(); notifSheet(); break;
    case 'ntype': S.notify.types[t.dataset.k] = S.notify.types[t.dataset.k] === false; save(); syncPush(); notifSheet(); break;
    case 'ntest': { const sub = await pushSub(false); if (!sub) break; const r = await fetch(`${API}api/push/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).then(r => r.json()).catch(() => ({})); toast(r.ok ? 'Надіслано — перевірте сповіщення' : 'Не вдалося надіслати'); break; }
    case 'askperm': if (Notification.permission !== 'granted') { const p = await Notification.requestPermission(); S.notify.enabled = p === 'granted'; save(); } closeSheet(); render(); break;
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { draft.q = e.target.value; const list = document.getElementById('rlist'); let n = 0;
    list.querySelectorAll('.li').forEach(li => { const ok = regionMatch(REGIONS.find(x => x.id === li.dataset.id), draft.q); li.hidden = !ok; n += ok; });
    document.getElementById('rnone').hidden = n > 0; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); if (e.key === 'Enter' && e.target.matches('[role=button]')) e.target.click(); });
addEventListener('online', render); addEventListener('offline', render);

// Оновлення таймера й індикатора «зараз» щохвилини (раз на 20 с для точності)
setInterval(() => { if (['home', 'detail', 'addresses'].includes(view) && !document.querySelector('.bsheet')) render(); }, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// Таймер із секундами — оновлюється щосекунди без перерендеру
setInterval(() => {
  const el = document.querySelector('[data-countdown]'); if (!el) return;
  const left = +el.dataset.countdown - kyivNow().min;
  if (left <= 0) { render(); return; }
  el.textContent = cd(left);
}, 1000);

// Лічильник встановлень: перший запуск встановленого застосунку (на iOS немає події appinstalled)
try {
  if ((matchMedia('(display-mode: standalone)').matches || navigator.standalone) && !localStorage.getItem('ec.counted') && API_READY) {
    const ua = navigator.userAgent, platform = /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : /Macintosh/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : 'other';
    if (!localStorage.getItem('ec.installed')) fetch(`${API}api/stats/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform }) }).catch(() => {});
    localStorage.setItem('ec.counted', '1');
  }
} catch {}

// Прелоадер: анімація іконки 3 с, потім плавно зникає (застосунок рендериться під ним)
const pre = document.getElementById('pre');
render().finally(() => {
  if (!pre) return;
  setTimeout(() => { pre.classList.add('hide'); setTimeout(() => pre.remove(), 500); }, Math.max(0, 4000 - performance.now()));
});

// ---------- Підказки адреси ----------
function initCity() {
  const r = region(draft.regionId), inp = document.getElementById('city');
  attachTypeahead(inp, citySource(r), it => { draft.city = it.label; draft.nsId = it.id || null; draft.hoeId = it.hoe || null; draft.street = ''; draft.streetId = null; draft.house = ''; view = 'ob-method'; render(); }, { minChars: 0 });
  if (!draft.city) inp.focus();
}
function initAddress() {
  const r = region(draft.regionId), st = document.getElementById('street'), hs = document.getElementById('house'), res = document.getElementById('addr-res'), next = document.getElementById('addr-next');
  draft.autoQueue = false;
  const lookup = async id => {
    res.innerHTML = `<div class="banner info">${ic('refresh')}<div class="bt">Шукаємо чергу для адреси…</div></div>`;
    try { const q = await (await import('./data.js')).moeAddr.queue(id); const g = q.find(x => x.outageType?.name === 'ГПВ') || q[0];
      if (!g) { res.innerHTML = `<div class="banner warn">${ic('alert')}<div><div class="bt">Чергу не вдалося визначити</div><div class="bb">Оператор не повертає чергу для цієї адреси. Оберіть її вручну.</div></div></div>`; return; }
      draft.queue = g.outage.name; draft.autoQueue = true;
      res.innerHTML = `<div class="card" style="background:var(--on-soft);box-shadow:none;gap:8px"><div style="display:flex;gap:10px;align-items:center;font-weight:600;color:var(--on-ink)">${ic('check')}Вашу адресу знайдено</div><div style="display:flex;gap:8px;align-items:baseline"><span class="body-s">Черга</span><span class="mono" style="font-size:20px;font-weight:600">${esc(draft.queue)}</span></div><div class="source ok">${ic('shield')}Визначено за даними Миколаївобленерго</div></div>`;
      next.textContent = 'Продовжити';
    } catch { res.innerHTML = `<div class="banner err">${ic('alert')}<div><div class="bt">Сервіс оператора не відповідає</div><div class="bb">Оберіть чергу вручну.</div></div></div>`; }
  };
  let houseTA = null;
  const found = (q, by) => { draft.queue = q; draft.autoQueue = true;
    res.innerHTML = `<div class="card" style="background:var(--on-soft);box-shadow:none;gap:8px"><div style="display:flex;gap:10px;align-items:center;font-weight:600;color:var(--on-ink)">${ic('check')}Вашу адресу знайдено</div><div style="display:flex;gap:8px;align-items:baseline"><span class="body-s">Черга</span><span class="mono" style="font-size:20px;font-weight:600">${esc(q)}</span></div><div class="source ok">${ic('shield')}Визначено за даними ${esc(by)}</div></div>`;
    next.textContent = 'Продовжити'; };
  const notFound = why => { draft.autoQueue = false; res.innerHTML = `<div class="banner warn">${ic('alert')}<div><div class="bt">Чергу не вдалося визначити автоматично</div><div class="bb">${why} Оберіть чергу вручну на наступному кроці.</div></div></div>`; next.textContent = 'Обрати чергу вручну'; };
  let houseSrc = null;
  const setupHouse = () => { houseSrc = houseSource(r, draft);
    if (houseSrc && !houseTA) houseTA = attachTypeahead(hs, q => houseSrc ? houseSrc(q) : Promise.resolve([]), it => {
      draft.house = it.label;
      if (it.id) return lookup(it.id);
      if (it.queues) { const qs = [...new Set(it.queues.filter(x => /^\d\.\d$/.test(x)))];
        if (!qs.length) return notFound('Оператор не вказав чергу для цього будинку.');
        if (qs.length === 1) return found(qs[0], r.opName);
        draft.autoQueue = false; next.textContent = 'Обрати чергу вручну';
        res.innerHTML = `<div class="banner warn">${ic('alert')}<div><div class="bt">Будинок у кількох чергах</div><div class="bb">За даними ${esc(r.opName)} різні під’їзди чи лінії цього будинку мають різні черги. Свою чергу можна дізнатися в рахунку або особовому кабінеті. Оберіть її:</div></div></div><div class="qgrid c3">${qs.map(q => `<button class="qcell" data-mq="${q}">${q}</button>`).join('')}</div>`;
        res.querySelectorAll('[data-mq]').forEach(b => b.onclick = () => found(b.dataset.mq, r.opName)); return; }
    }, { minChars: 0, emptyText: 'Такого номера немає в довіднику оператора' }); };
  attachTypeahead(st, streetSource(r, draft), it => { draft.street = it.label; draft.streetId = it.id || null; draft.house = ''; hs.value = ''; res.innerHTML = ''; draft.autoQueue = false; setupHouse(); hs.focus();
    if (dtekAuto(r)) import('./address.js').then(m => m.dtekHouses(r.op, draft.city, draft.street)).catch(() => notFound('Сервіс ДТЕК зараз не відповідає.'));
    if (r.op === 'hoe' && draft.hoeId) hoeStreetQueue(draft).then(qs => { if (qs?.length) found(qs[0], r.opName); }).catch(() => {}); }, { minChars: draft.nsId ? 0 : 1 });
  st.addEventListener('input', () => { draft.streetId = null; draft.autoQueue = false; res.innerHTML = ''; });
  setupHouse();
  if (!draft.street) st.focus();
}
