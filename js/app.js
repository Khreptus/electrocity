import { setLang, LANGS, detectLang, locale, tr } from './i18n.js';
import { ic, STATE_ICON } from './icons.js';
import { citySource, streetSource, houseSource, attachTypeahead, dtekAuto, hoeStreetQueue, FILE_ADDR, skel, isYasno, yasnoGroup, isPw, hoeIndex, hoeCity, pq } from './address.js';
import { API, API_READY } from './config.js';
import { alertsView, alertSettingsView, fetchAlerts, fetchTargets, lastSnap, citySheetHTML, fillCityList, cityFromHromada, cityKey, guessCity, cityStatus, hms, playSiren, mountMap, mapSettingsChanged, selectTarget, startPick, toggleDrawer } from './alerts.js';
import { REGIONS, region, queueList, kyivNow, addDays, loadSchedule, clearScheduleCache, segmentsFor, stateAt, nextChange, upcomingEvents, isLive, moeAddr, freeDay } from './data.js';

// ---------- Стан ----------
const KEY = 'svitlo.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
let S = Object.assign({ addresses: [], primaryId: null, currentId: null, theme: 'system', notify: { before: 30, enabled: false } }, load());
S.alerts = Object.assign({ city: null, push: false, siren: true, targets: true, threat: true, mode: 'raions' }, S.alerts);
S.lang ||= detectLang(); setLang(S.lang);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
const uid = () => Math.random().toString(36).slice(2, 9);
const cur = () => S.addresses.find(a => a.id === S.currentId) || S.addresses.find(a => a.id === S.primaryId) || S.addresses[0];

let view = location.hash === '#alerts' ? 'alerts' : S.addresses.length ? 'home' : 'welcome';
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

// Версія застосунку = версія service worker (видно, чи телефон уже оновився)
let APPVER = '';
if ('caches' in window) caches.keys().then(k => { const v = k.find(x => x.startsWith('shell-'))?.slice(6); if (v) { APPVER = v; const el = document.getElementById('appver'); if (el) el.textContent = v; } }).catch(() => {});

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
  const tabs = ['home', 'addresses', 'alerts', 'settings'].includes(view);
  let html = '';
  if (view === 'welcome') html = welcome();
  else if (view.startsWith('ob-')) html = onboarding();
  else if (view === 'home') html = await home();
  else if (view === 'detail') html = await detail();
  else if (view === 'addresses') html = await addresses();
  else if (view === 'edit') html = edit();
  else if (view === 'settings') html = settings();
  else if (view === 'alerts') html = await alertsTab();
  else if (view === 'alert-settings') html = alertSettingsView(S);
  const side = tabs || view === 'detail' || view === 'alert-settings' ? await sidebar() : '';
  $app.innerHTML = side + `<div class="desk-wrap"><main class="view ${tabs ? '' : 'no-tabs'}">${html}</main></div>` + (tabs ? tabbar() : '');
  if (view === 'alerts') mountMap(S);
  if (view === 'ob-city') initCity();
  if (view === 'ob-address') initAddress();
  if ((view === 'home' || view === 'detail') && cur()) addrStatus(cur());
  if (['home', 'detail', 'addresses'].includes(view) || matchMedia('(min-width:1024px)').matches) refreshAddrs();
  if (view === 'alerts' && !lastSnap() && Date.now() - alertTry > 10000) { alertTry = Date.now(); fetchAlerts().then(x => x && view === 'alerts' && render()); }
  document.title = view === 'alerts' ? 'Тривоги · Electrocity' : view === 'home' && cur() ? `${cur().name} · Electrocity` : 'Electrocity — графік відключень';
}

// ---------- Стан за конкретною адресою: аварійні й планові відключення ----------
const ADDR_OPS = new Set(['poe-poltava', 'chernoe', 'choe', 'hoe', 'dtek-oem', 'moe', 'loe', 'dtek-dnem', 'dtek-kem', 'dtek-krem', 'dtek-dem']);
const addrCache = {};
const isoHM = iso => iso ? iso.slice(11, 16) : '…';
const isoDM = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '';
function whenTxt(it) {
  const { date } = kyivNow(); const d = x => (x && x.slice(0, 10) !== date ? isoDM(x) + ' ' : '');
  if (it.start && it.end) return `${d(it.start)}${isoHM(it.start)} – ${d(it.end)}${isoHM(it.end)}`;
  if (it.end) return `орієнтовно до ${d(it.end)}${isoHM(it.end)}`;
  return it.start ? `з ${d(it.start)}${isoHM(it.start)}` : '';
}
// Аварії / планові роботи за адресою — поверх добової шкали та списку подій
const isoMin = iso => +iso.slice(11, 13) * 60 + +iso.slice(14, 16);
function overlaySegs(segs, items, d) {
  let out = (segs || [[0, 1440, 'unknown']]).map(s => [s[0], s[1], s[2]]); let hit = false;
  for (const it of items) {
    const sd = it.start ? it.start.slice(0, 10) : null, ed = it.end ? it.end.slice(0, 10) : null;
    if ((sd && sd > d) || (ed && ed < d)) continue;
    const a = !sd || sd < d ? 0 : isoMin(it.start), b = !ed || ed > d ? 1440 : isoMin(it.end);
    if (a >= b) continue; hit = true;
    const st = it.kind === 'emergency' ? 'emergency' : 'off', next = [];
    for (const s of out) { if (s[0] < a) next.push([s[0], Math.min(s[1], a), s[2]]); if (s[1] > b) next.push([Math.max(s[0], b), s[1], s[2]]); }
    next.push([a, b, st]); out = next.filter(s => s[1] > s[0]).sort((x, y) => x[0] - y[0]);
  }
  if (!hit) return null;
  return out.reduce((m, s) => { const l = m[m.length - 1]; if (l && l[2] === s[2] && l[1] === s[0]) l[1] = s[1]; else m.push(s); return m; }, []);
}
// Дані за адресою з кешу (синхронно) — щоб шкала одразу малювалась з аваріями, без мигання
const addrKey = a => [region(a.regionId)?.op, a.city, a.street, a.house].join('|');
const addrItemsCached = a => (addrCache[addrKey(a)]?.j?.items || []).filter(it => it.kind !== 'schedule');
// Перевірка адреси на сайті обленерго пройшла і нічого не знайшла (будинок знайдено, подій немає)
const addrClear = a => { const j = addrCache[addrKey(a)]?.j; return !!(j?.ok && j.supported && !j.pending && j.found !== false && !(j.items || []).some(it => it.kind !== 'schedule')); };
// Графіка на сьогодні немає, а за адресою подій не зареєстровано — вважаємо, що світло є
const withAddr = (a, segs, d) => {
  if (!segs && d === kyivNow().date && addrClear(a)) { const s = [[0, 1440, 'on']]; s.none = true; s.byAddr = true; return s; }
  return overlaySegs(segs, addrItemsCached(a), d) || segs;
};
const addrInflight = {};
// Завантажити стан адреси (кеш 2 хв); повертає true, якщо дані змінилися
let freshAddr = false; // наступні запити адрес — зі свіжим кешем (1 хв) на сервері
function fetchAddr(a) {
  const op = region(a.regionId)?.op;
  if (!API_READY || !ADDR_OPS.has(op) || !a.street || !a.house) return Promise.resolve(false);
  const key = addrKey(a), r = addrCache[key];
  if (r && Date.now() - r.t < 120e3) return Promise.resolve(false);
  return addrInflight[key] ||= (async () => {
    try {
      const q = new URLSearchParams({ op, city: a.city, street: a.street, house: a.house, ...(a.cid ? { cid: a.cid } : {}), ...(freshAddr ? { fresh: '1' } : {}) });
      const j = op === 'poe-poltava' ? await (await import('./address.js')).poeClient('outage', Object.fromEntries(q)) : await (await fetch(`${API}api/outage?${q}`)).json();
      const changed = !r || JSON.stringify(r.j?.items || []) !== JSON.stringify(j?.items || []);
      addrCache[key] = { t: Date.now(), j }; return changed;
    } catch { return false; } finally { delete addrInflight[key]; }
  })();
}
// Перевірити всі адреси у фоні й перемалювати, якщо щось змінилося
let addrBusy = false;
async function refreshAddrs() {
  if (addrBusy) return; addrBusy = true;
  try { const ch = await Promise.all(S.addresses.map(fetchAddr)); if (ch.some(Boolean) && !document.querySelector('.bsheet')) render(); }
  finally { addrBusy = false; freshAddr = false; }
}
async function addrStatus(a) {
  const box = document.getElementById('addr-status'); if (!box) return;
  const op = region(a.regionId)?.op;
  if (!API_READY || !ADDR_OPS.has(op) || !a.street || !a.house) return;
  const r = addrCache[addrKey(a)]; if (!r) return;
  const j = r.j; if (!j?.ok || !j.supported || !document.contains(box)) return;
  if (j.pending) { box.innerHTML = `<div class="addr-ok">${ic('refresh')}<span>Перевіряємо вашу адресу на сайті ${esc(j.source || 'оператора')} — результат з’явиться протягом 15 хв</span></div>`; return; }
  const { date, min } = kyivNow(); const nowIso = `${date}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const items = (j.items || []).filter(it => it.kind !== 'schedule');
  const active = items.filter(it => (!it.start || it.start <= nowIso) && (!it.end || it.end > nowIso));
  const scopeTxt = it => it.scope === 'house' ? 'ваш будинок' : it.scope === 'street' ? 'уся вулиця' : 'увесь населений пункт';
  const checked = j.checkedAt ? new Date(j.checkedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
  const src = `<div class="cap" style="margin-top:6px">${esc(j.source)} · перевірено о ${checked} · <a href="${j.url}" target="_blank" rel="noopener">джерело</a></div>`;
  // Активна аварія за адресою важливіша за графік — показуємо її у верхньому статусі
  const em = active.find(it => it.kind === 'emergency') || active[0];
  const stg = document.querySelector('.stage'), hero = stg?.querySelector('.hero');
  if (em && hero) {
    const isEm = em.kind === 'emergency';
    stg.dataset.state = 'emergency'; hero.className = 'hero st-emergency';
    hero.querySelector('.src').innerHTML = `<span class="badge" style="background:var(--emergency)">${ic('alert')}</span>За даними оператора для вашої адреси`;
    hero.querySelector('h1').textContent = isEm ? 'Аварійне відключення' : 'Планові роботи';
    const sub = hero.querySelector('.sub'); if (sub) sub.textContent = `${whenTxt(em)} · ${scopeTxt(em)}`;
    const tm = hero.querySelector('.timer, .note');
    if (tm) tm.outerHTML = `<div class="note">${ic('clock')}${em.end ? `Орієнтовне відновлення о ${isoHM(em.end)}${em.end.slice(0, 10) !== date ? ' (' + isoDM(em.end) + ')' : ''}` : 'Час відновлення невідомий'}</div>`;
  }
  if (!items.length) { box.innerHTML = `<div class="addr-ok">${ic('shield')}<span>За вашою адресою аварій і планових робіт не зареєстровано<span class="t"> | ${checked}</span></span></div>`; return; }
  box.innerHTML = items.slice(0, view === 'detail' ? 20 : 3).map(it => {
    const now = active.includes(it); const em = it.kind === 'emergency';
    const title = em ? (now ? 'Аварійне відключення за вашою адресою' : 'Аварійне відключення') : (now ? 'Планові роботи зараз' : 'Планові роботи за вашою адресою');
    return `<div class="banner ${em ? 'err' : 'warn'}">${ic('alert')}<div><div class="bt">${title}</div><div class="bb">${esc(whenTxt(it))} · ${scopeTxt(it)}${it.reason && !/^(Планові|Аварійні)$/i.test(it.reason.trim()) ? `<br>${esc(it.reason)}` : ''}</div>${src}</div></div>`;
  }).join('');
}

function tabbar() {
  const t = (v, i, l) => `<button data-go="${v}" ${view === v ? 'aria-current="page"' : ''}>${ic(i)}${l}</button>`;
  return `<nav class="tabs">${t('home', 'zap', 'Світло')}${t('addresses', 'map-pin', 'Адреси')}${t('alerts', 'siren', 'Тривоги')}${t('settings', 'settings', 'Налаштування')}</nav>`;
}
async function sidebar() {
  const cards = await Promise.all(S.addresses.map(a => addrCard(a, true)));
  const n = (v, i, l) => `<button data-go="${v}" ${view === v ? 'aria-current="page"' : ''}>${ic(i)}${l}</button>`;
  return `<aside class="side"><div class="brand"><img src="icons/icon-192.png" alt="" width="36" height="36" style="border-radius:10px">Electrocity</div>
  <nav>${n('home', 'zap', 'Графік')}${n('addresses', 'map-pin', 'Мої адреси')}${n('alerts', 'siren', 'Тривоги')}${n('settings', 'settings', 'Налаштування')}</nav>
  ${S.addresses.length ? '<div class="over" style="color:var(--stage-text-3)">Мої адреси</div>' : ''}${cards.join('')}</aside>`;
}

// ----- Головна -----
function heroInfo(data, a) {
  const { date, min } = kyivNow();
  const raw = segmentsFor(data, date, a.queue);
  const segs = raw || withAddr(a, raw, date);
  const s = stateAt(segs, min);
  if (!s) return { state: 'unknown', title: 'Статус невідомий', sub: 'Немає даних для черги ' + a.queue + ' на сьогодні', note: 'Час наступної зміни невідомий' };
  const st = s[2];
  const nc = nextChange(data, date, a.queue, min);
  const q = 'Черга ' + a.queue;
  const base = { state: st, nc, min };
  if (segs.byAddr) {
    const at = addrCache[addrKey(a)]?.j?.checkedAt; const t2 = at ? new Date(at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
    return { ...base, nc: null, title: 'Світло є', sub: `${q} · графік не опубліковано`, note: `Аварій і планових робіт за адресою немає${t2 ? ` · перевірено о ${t2}` : ''}`, srcTxt: 'За даними обленерго для вашої адреси' };
  }
  if (st === 'on' && freeDay(segs)) {
    const sub = `${q} · ${segs.none ? 'графіків відключень не застосовують' : 'на сьогодні відключень не заплановано'}`;
    const note = nc ? `Наступне відключення — завтра о ${hm(nc.at - 1440)}` : 'Світло за графіком до кінця доби';
    return { ...base, nc: null, title: 'Відключень немає', sub, note, srcTxt: segs.none ? 'За даними обленерго' : null };
  }
  // графік на сьогодні до 24:00, а на завтра ще не опублікований — рахуємо до кінця доби
  if (!nc && s[1] === 1440 && ['on', 'off', 'possible'].includes(st) && !segmentsFor(data, addDays(date, 1), a.queue)) { base.nc = { at: 1440, state: 'unknown' }; base.eod = true; }
  const eod = base.eod ? { tl: 'До кінця доби', nl: 'Графік на завтра', nxTxt: 'ще не опубліковано' } : {};
  if (st === 'on') return { ...base, title: 'Світло є', sub: `${q} · з ${hm(s[0])} до ${hmEnd(s[1])}`, tl: 'До відключення', nl: 'Відключення о', ...eod };
  if (st === 'off') return { ...base, title: 'Світла немає', sub: `Планове відключення · ${q}`, tl: 'До відновлення', nl: 'Відновлення о', ...eod };
  if (st === 'possible') return { ...base, title: 'Можливе відключення', sub: `${q} · ${hm(s[0])}–${hmEnd(s[1])} · попередньо`, tl: 'До відключення', nl: 'Відключення о', ...eod };
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
    const timer = h.nc ? `<div class="timer"><div><div class="lbl">${h.tl}</div><div class="big" data-countdown="${h.nc.at}">${cd(h.nc.at - h.min)}</div></div><div><div class="lbl" style="text-align:right">${h.nl}</div><div class="nx${h.nxTxt ? ' txt' : ''}">${h.nxTxt || hm(h.nc.at)}</div></div></div>`
      : `<div class="note">${ic('clock')}${h.note || 'Час наступної зміни невідомий'}</div>`;
    body = `<div class="hero st-${h.state}"><div class="src"><span class="badge" style="background:${badgeBg}">${ic(STATE_ICON[h.state] || 'help')}</span>${h.srcTxt || 'За опублікованим графіком'}</div><h1>${h.title}</h1><div class="sub">${esc(h.sub)}</div>${timer}</div>`;
  }
  return `<section class="stage" data-state="${lampState}"><div class="glow"></div><img class="lamp off" src="assets/lamp-off.webp" alt=""><img class="lamp on" src="assets/lamp-on.webp" alt=""><div class="beam" aria-hidden="true"><i></i></div>
   <button class="loc" data-act="switcher"><span class="tile">${ic(NAMES.find(n => n[1] === a.name)?.[0] || 'home')}</span><span class="txt"><span class="name">${esc(a.name)} ${ic('chevron-down')}</span><span class="addr">${esc(a.street ? `${a.street}${a.house ? ', ' + a.house : ''}` : (a.city || region(a.regionId)?.name))}</span></span><span class="tile round" data-act="notif" role="button" aria-label="Сповіщення">${ic('bell')}</span></button>
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
  const title = st === 'on' && s[0] === 0 && s[1] === 1440 ? 'Без відключень' : { on: 'Світло є', off: 'Відключення', possible: 'Можливе відключення', unknown: 'Немає даних', emergency: 'Аварійне відключення' }[st];
  const now = isToday && min >= s[0] && min < s[1];
  const rel = !isToday ? '' : now ? `ще ${dur(s[1] - min)}` : s[0] > min ? `через ${dur(s[0] - min)}` : '';
  return `<div class="ev ${isToday && s[1] <= min ? 'past' : ''}"><span class="t">${hm(s[0])}</span><span class="b ${st}">${ic(STATE_ICON[st])}</span><span class="tx"><span class="tt">${title}${now ? ' · зараз' : ''}</span><br><span class="d">${hm(s[0])} – ${hmEnd(s[1])} · ${dur(s[1] - s[0])}</span></span><span class="r">${rel}</span></div>`;
}
function sourceLine(data, a) {
  if (data.demo) return `<div class="source warn">${ic('info')}Демо-дані · джерело ${esc(region(a.regionId)?.opName)} ще не підключене</div>`;
  const t = data.updatedAt ? new Date(data.updatedAt).toLocaleString(locale(), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
  const when = data.live ? 'дані в реальному часі' : data.publishedAt ? `опубліковано ${esc(data.publishedAt)}` : t ? `оновлено ${t}` : '';
  const via = data.source?.kind === 'aggregator' ? ` · через відкритий збирач ${esc(data.source.via || '')}` : '';
  return `<a class="source ok" href="${esc(data.source?.url || '#')}" target="_blank" rel="noopener">${ic('shield')}${esc(data.name || region(a.regionId)?.opName)} · ${when}${via} ${ic('external')}</a>`;
}
function banners(data) {
  let b = ''; const a = cur();
  if (a?.qChange) b += `<div class="banner warn">${ic('refresh')}<div><div class="bt">Черга змінилася: ${esc(a.qChange.from)} → ${esc(a.qChange.to)}</div><div class="bb">За свіжими даними ${esc(region(a.regionId).opName)} ваш будинок тепер у черзі ${esc(a.qChange.to)}. Графік уже показано для нової черги.</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm" data-act="q-ok">Зрозуміло</button><button class="btn sm ghost" data-act="q-undo">Повернути ${esc(a.qChange.from)}</button></div></div></div>`;
  if (a?.qSuggest) b += `<div class="banner warn">${ic('alert')}<div><div class="bt">Оператор вказує іншу чергу: ${esc(a.qSuggest)}</div><div class="bb">У застосунку для «${esc(a.name)}» обрано ${esc(a.queue)}, а за даними ${esc(region(a.regionId).opName)} адреса ${esc(a.street)}, ${esc(a.house)} — у черзі ${esc(a.qSuggest)}.</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm" data-act="q-accept">Перейти на ${esc(a.qSuggest)}</button><button class="btn sm ghost" data-act="q-keep">Залишити ${esc(a.queue)}</button></div></div></div>`;
  if (data?.notice) b += `<div class="banner warn">${ic('alert')}<div><div class="bt">Оголошення оператора</div><div class="bb">${esc(data.notice)}</div></div></div>`;
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
  const segs = withAddr(a, segmentsFor(data, d, a.queue), d);
  const isToday = day === 0;
  const tmr = segmentsFor(data, addDays(date, 1), a.queue);
  const evs = isToday ? upcomingEvents(segs, min).slice(0, 3) : (segs || []);
  const scaleBlock = segs ? scaleHTML(segs, isToday ? min : null) :
    `<div class="empty-day">${ic('calendar')}<div class="h-s" style="font-size:16px">Графік на ${isToday ? 'сьогодні' : 'завтра'} ще не опубліковано</div><div class="body-s">Зазвичай оператор публікує його ввечері.</div></div><button class="btn secondary recheck" data-act="recheck">${ic('refresh')}Перевірити</button>`;
  return stage(a, h) + `<section class="sheet">${banners(data)}
   <div class="card"><div class="row-head"><div class="h-s">Графік на ${isToday ? 'сьогодні' : 'завтра'}</div><button class="link" data-go="detail">Детальніше ${ic('chevron-right')}</button></div>
   <div class="seg" role="group"><button data-day="0" aria-pressed="${isToday}">Сьогодні</button><button data-day="1" aria-pressed="${!isToday}" ${tmr ? '' : ''}>Завтра</button></div>
   <div id="addr-status"></div>${scaleBlock}${evs.map(s => evRow(s, min, isToday)).join('')}${sourceLine(data, a)}</div></section>`;
}
async function detail() {
  const a = cur(); const data = await loadSchedule(region(a.regionId).op);
  const { date, min } = kyivNow(); const d = addDays(date, day); const isToday = day === 0;
  const segs = withAddr(a, segmentsFor(data, d, a.queue), d);
  const sum = st => (segs || []).filter(s => st.includes(s[2])).reduce((t, s) => t + s[1] - s[0], 0);
  const tile = (l, v, c) => `<div class="card" style="flex:1;gap:2px;padding:12px;border-radius:16px"><span class="cap">${l}</span><span class="h-s" style="color:var(--${c}-ink)">${v}</span></div>`;
  return `${band(`Графік · Черга ${esc(a.queue)}`, true)}<section class="sheet r32">
   <div class="seg"><button data-day="0" aria-pressed="${isToday}">Сьогодні</button><button data-day="1" aria-pressed="${!isToday}">Завтра</button></div>
   <div id="addr-status"></div>${segs ? `<div class="card">${scaleHTML(segs, isToday ? min : null)}</div><div style="display:flex;gap:8px">${tile('Зі світлом', dur(sum(['on'])), 'on')}${tile('Без світла', dur(sum(['off', 'emergency'])), 'off')}${tile('Можливо', dur(sum(['possible'])), 'possible')}</div>
   <div class="card" style="gap:0;padding:4px 16px">${segs.map(s => evRow(s, min, isToday)).join('')}</div>` : `<div class="empty-day">${ic('calendar')}<div>Графік ще не опубліковано</div></div><button class="btn secondary recheck" data-act="recheck">${ic('refresh')}Перевірити</button>`}
   <div class="card" style="gap:10px">${sourceLine(data, a)}<div class="cap">Графік може змінюватися протягом дня. Статус — за опублікованим графіком, а не фактична наявність світла.</div></div></section>`;
}

// ----- Адреси -----
async function addrCard(a, compact) {
  const data = await loadSchedule(region(a.regionId).op);
  const { date, min } = kyivNow();
  const base = segmentsFor(data, date, a.queue), segs = withAddr(a, base, date); const s = stateAt(segs, min); const st = s ? s[2] : 'unknown';
  let nc = nextChange(data, date, a.queue, min);
  if (segs !== base && s) { const off = x => ['off', 'emergency'].includes(x); const i = segs.indexOf(s); const n = segs.slice(i + 1).find(x => off(x[2]) !== off(st)); nc = n ? { at: n[0], state: n[2] } : null; }
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
    <button class="li" data-act="addr-notify"><span class="lt">${ic('bell')}</span><span class="tx"><span class="tt">Сповіщення для цієї адреси</span><br><span class="st">${!S.notify.enabled ? 'Спершу увімкніть сповіщення в Налаштуваннях' : a.notify === false ? 'Вимкнено — інші адреси не зачіпає' : 'Графік, зміни й аварії за адресою'}</span></span><span class="toggle" role="switch" aria-checked="${a.notify !== false}"></span></button>
   </div>
   <button class="btn danger" data-act="delete">${ic('trash')} Видалити адресу</button></section>`;
}

// ----- Тривоги -----
// Моє місто за замовчуванням — місто основної адреси (можна змінити в налаштуваннях карти)
async function alertsTab() {
  if (!S.alerts.city && !S.alerts.cityTried) { S.alerts.cityTried = true; const a = S.addresses.find(x => x.id === S.primaryId) || S.addresses[0];
    if (a) { const r = region(a.regionId); S.alerts.city = await guessCity(a.city || r.center, r.id === 'kyiv-city' ? 'м. Київ' : r.name).catch(() => null); }
    save(); }
  return alertsView(S);
}
let sirenWas = false, alertTry = 0;
function checkSiren() { // сирена в застосунку — коли загроза для мого міста щойно стала високою
  const s = lastSnap(); if (!s || !S.alerts.city) return;
  const high = cityStatus(s, S.alerts.city).high && cityStatus(s, S.alerts.city).on;
  if (high && !sirenWas && S.alerts.siren !== false && !document.hidden) { playSiren(); toast('Висока загроза для вашого міста'); }
  sirenWas = high;
}
function alertPayload() { const c = S.alerts.city; if (!S.alerts.push || !c) return null;
  return { on: true, siren: S.alerts.siren !== false, n: c.label, k: cityKey(c), r: c.raion, o: c.oblast, la: c.lat, lo: c.lon }; }

// ----- Налаштування -----
function settings() {
  const th = { system: 'Системна', light: 'Світла', dark: 'Темна' }[S.theme];
  const li = (act, i, t, st, val, tail = ic('chevron-right', 'chev')) => `<button class="li" data-act="${act}"><span class="lt">${ic(i)}</span><span class="tx"><span class="tt">${t}</span>${st ? `<br><span class="st">${st}</span>` : ''}</span>${val ? `<span class="val">${val}</span>` : ''}${tail}</button>`;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `<div class="band"><span class="h-l">Налаштування</span></div><section class="sheet r32">
   <div class="over">Основне</div><div class="list">${li('notif', 'bell', 'Сповіщення', S.notify.enabled ? 'Увімкнено' : perm === 'denied' ? 'Заборонено в системі' : 'Вимкнено', '')}</div>
   <div class="over">Вигляд</div><div class="list">${li('theme', 'moon', 'Тема', null, th)}${li('lang', 'globe', 'Мова', null, `<span data-noi18n>${LANGS[S.lang]}</span>`)}</div>
   <div class="over">Віджет</div><div class="list"><a class="li" href="widget/"><span class="lt">${ic('grid')}</span><span class="tx"><span class="tt">Віджет для iPhone</span><br><span class="st">Статус і таймер на головному екрані</span></span>${ic('chevron-right', 'chev')}</a></div>
   <div class="over">Дані</div><div class="list">${li('sources', 'shield', 'Джерела даних', 'Офіційні оператори')}${li('clearcache', 'database', 'Оновити графіки', 'Скинути збережені дані графіків', '', '')}</div>
   <div class="over">Про застосунок</div><div class="list">${li('noop', 'lock', 'Конфіденційність', 'Без акаунта. Адреси зберігаються лише на цьому пристрої', '', '')}${li('noop', 'info', 'Версія', null, `<span id="appver">${APPVER || '…'}</span>`, '')}</div></section>`;
}
function band(title, back, backTo = 'home') {
  return `<div class="band"><div class="bar">${back ? `<button class="btn-ic" data-go="${backTo}" aria-label="Назад">${ic('chevron-left')}</button>` : '<span></span>'}<span class="ttl">${title}</span><span style="width:40px"></span></div></div>`;
}

// ----- Онбординг -----
function welcome() {
  const sample = [[0, 180, 'on'], [180, 390, 'off'], [390, 600, 'on'], [600, 810, 'off'], [810, 1140, 'on'], [1140, 1350, 'off'], [1350, 1410, 'possible'], [1410, 1440, 'on']];
  return `<section class="stage" data-state="on" style="padding-bottom:80px"><div class="glow"></div><img class="lamp off" src="assets/lamp-off.webp" alt=""><img class="lamp on" src="assets/lamp-on.webp" alt=""><div class="beam" aria-hidden="true"><i></i></div>
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
// Де оператор показує чергу за адресою (якщо автоматично визначити не вдалося)
const QUEUE_LOOKUP = {
  hoe: 'https://hoe.com.ua/shutdown/queue',
  loe: 'https://poweron.loe.lviv.ua/',
  moe: 'https://off.energy.mk.ua/',
  zhoe: 'https://www.ztoe.com.ua/unhooking-search.php',
  choe: 'https://www.cherkasyoblenergo.com/off',
  roe: 'https://www.roe.vsei.ua/disconnections',
  soe: 'https://www.soe.com.ua/consumers/shutdowns',
  chernoe: 'https://oblenergo.cv.ua/shutdowns-search/',
  koe: 'https://kiroe.com.ua/electricity-blackout',
  'voe-volyn': 'https://energy.volyn.ua/spozhyvacham/perervy-u-elektropostachanni/hrafik-vidkliuchen/',
  'poe-poltava': 'https://www.poe.pl.ua/',
  khoe: 'https://www.oblenergo.kharkov.ua/',
  toe: 'https://www.toe.com.ua/',
  'dtek-krem': 'https://www.dtek-krem.com.ua/ua/shutdowns', 'dtek-dem': 'https://www.dtek-dem.com.ua/ua/shutdowns',
  'dtek-dnem': 'https://www.dtek-dnem.com.ua/ua/shutdowns', 'dtek-oem': 'https://www.dtek-oem.com.ua/ua/shutdowns', 'dtek-kem': 'https://www.dtek-kem.com.ua/ua/shutdowns',
};
function manualReason(r) {
  if (r.op === 'zhoe') return 'Житомиробленерго показує лише частину будинків вулиці за один запит — якщо вашого будинку немає в підказках, дізнайтеся чергу на сайті обленерго.';
  if (r.op === 'choe') return 'Черкасиобленерго не публікує чергу за адресою (лише за особовим рахунком), тож оберіть її вручну. Аварійні, планові відключення й фактичні відключення за графіком для вашого будинку застосунок показуватиме автоматично.';
  if (r.op === 'chernoe') return 'Група визначається за офіційними списками адрес Чернівціобленерго — оберіть населений пункт, вулицю й будинок зі списку підказок.';
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
  if (view === 'ob-address') { const auto = (r.addressLookup === 'moe' && draft.nsId) || dtekAuto(r) || isYasno(r) || (isPw(r) && draft.pwCity) || (FILE_ADDR.has(r.op) && draft.hoeId); return bk('ob-method') + `<section class="sheet r32">${steps(4)}<div class="cap">${esc(draft.city)} · ${esc(r.opName)}</div>
    <label class="field">${ic('search')}<input id="street" placeholder="Вулиця — почніть вводити" value="${esc(draft.street || '')}" autocomplete="off" enterkeyhint="next"></label>
    <label class="field">${ic('home')}<input id="house" placeholder="Номер будинку" value="${esc(draft.house || '')}" autocomplete="off" enterkeyhint="done"></label>
    <div id="addr-res"></div>
    ${auto ? '' : `<div class="banner warn">${ic('alert')}<div><div class="bt">Чергу доведеться обрати вручну</div><div class="bb">${manualReason(r)}</div></div></div>`}
    <div style="flex:1"></div><button class="btn primary" id="addr-next" data-act="address-next">${auto ? 'Обрати чергу вручну' : 'Обрати чергу'}</button></section>`; }
  if (view === 'ob-queue') { const ql = queueList(r.queues); return bk(draft.method === 'address' ? 'ob-address' : 'ob-method') + `<section class="sheet r32">${steps(4)}<div class="h-l">Оберіть чергу</div>${draft.method === 'address' && !draft.autoQueue && !draft.editOf ? `<div class="banner warn">${ic('alert')}<div><div class="bt">Не вдалося визначити чергу автоматично</div><div class="bb">Оберіть її вручну. ${esc(manualReason(r))}</div></div></div>${QUEUE_LOOKUP[r.op] ? `<a class="btn" href="${QUEUE_LOOKUP[r.op]}" target="_blank" rel="noopener">${ic('external')}Дізнатися чергу на сайті ${esc(r.opName)}</a>` : ''}` : ''}<div class="body-s">Черги ${esc(r.opName)}</div>
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
// Примусова перевірка: просимо сервер зібрати графіки заново (не частіше разу на хвилину), потім перечитуємо все
let refreshing = false;
async function refreshNow() {
  if (refreshing) return false; refreshing = true;
  try {
    if (API_READY) await fetch(`${API}api/tick`, { cache: 'no-store' }).catch(() => {});
    clearScheduleCache(); for (const k of Object.keys(addrCache)) delete addrCache[k];
    await render(); await refreshAddrs(); return true;
  } finally { refreshing = false; }
}
// ---------- Щотижнева перевірка черг за адресою ----------
// Оператори іноді переносять будинки в інші черги. Раз на тиждень для кожної адреси з вулицею й будинком питаємо чергу
// в того самого джерела, що й під час додавання. Якщо черга визначалась автоматично — оновлюємо й показуємо банер
// «Черга змінилася» (з можливістю повернути). Якщо її обрали вручну — лише пропонуємо («Оператор вказує іншу чергу»).
const hk = x => String(x || '').toLowerCase().replace(/[\s-]+/g, '').replace(/[’'ʼ]/g, '');
async function lookupQueue(a) {
  const r = region(a.regionId); if (!r || !a.street || !a.house) return null; const s = a.src || {};
  const ok = new Set(queueList(r.queues)); const one = qs => { const u = [...new Set((qs || []).map(x => String(x).trim()).filter(x => ok.has(x)))]; return u.length === 1 ? u[0] : null; };
  if (r.op === 'hoe' && API_READY) { const x = await pq('queue', { op: 'hoe', city: a.city, street: a.street, house: a.house }).catch(() => null);
    if (x?.queues?.length) return x.queues.includes(a.queue) ? a.queue : one(x.queues);
    if (x?.found) return null; } // сайт знає будинок, але черги зараз не видно — застарілий файл не пропонуємо
  if (FILE_ADDR.has(r.op)) {
    let ids = s.hoeId ? [s.hoeId] : ((await hoeIndex(r.op))?.items || []).filter(([c]) => skel(c) === skel(a.city)).map(x => x[2]);
    for (const id of ids) { const hs = (await hoeCity(r.op, id))[a.street]; if (!hs) continue;
      const h = hs.find(x => hk(x[0]) === hk(a.house)) || (hs.length === 1 && hs[0][0] === '*' ? hs[0] : null); return h ? one(h[1].split(',')) : null; }
    return null;
  }
  if (isYasno(r)) return s.streetId && s.yasnoHouse ? (await yasnoGroup(r.op, s.streetId, s.yasnoHouse, s.yasnoCity)) || null : null;
  if (isPw(r) && r.op !== 'choe') {
    const cid = a.cid || ((await pq('cities', { op: r.op })).find(c => skel(c.label) === skel(a.city)) || {}).id; if (!cid) return null;
    const sid = s.streetId || ((await pq('streets', { op: r.op, cityId: cid })).find(x => skel(x.label) === skel(a.street)) || {}).id; if (!sid) return null;
    if (r.op === 'poe-poltava') return (await pq('queue', { op: r.op, cityId: cid, streetId: sid, house: a.house })).queue || null;
    const h = (await pq('houses', { op: r.op, cityId: cid, streetId: sid })).find(x => hk(x.label) === hk(a.house)); return h?.queues ? one(h.queues) : null;
  }
  if (s.moeId && r.addressLookup === 'moe') { const q = await moeAddr.queue(s.moeId); const g = q.find(x => x.outageType?.name === 'ГПВ') || q[0]; return g?.outage?.name || null; }
  return null;
}
const QFRESH = Date.parse('2026-11-20T17:55:00Z');
let qChecking = false;
async function recheckQueues(force) {
  if (qChecking || !navigator.onLine) return; qChecking = true; let any = false;
  try {
    for (const a of S.addresses) {
      // QFRESH — час, коли з'явилося нове джерело черг; давніші перевірки вважаємо застарілими
      if (!a.street || !a.house || (!force && Date.now() - (a.qAt || 0) < 7 * 864e5 && (a.qAt || 0) > QFRESH)) continue;
      let q = null; try { q = await lookupQueue(a); } catch { continue; } // джерело недоступне — спробуємо наступного разу
      a.qAt = Date.now(); any = true;
      if (!q || q === a.queue) { delete a.qSuggest; continue; }
      // автоматична черга (або давня адреса, де спосіб вибору не записано) — оновлюємо з банером і кнопкою «Повернути»
      if (a.auto || a.auto === undefined) { a.qChange = { from: a.queue, to: q, at: Date.now() }; a.queue = q; a.auto = true; }
      else if (a.qKeep !== q) a.qSuggest = q;
    }
  } finally { qChecking = false; }
  if (any) { save(); syncPush(); if (view === 'home') render(); }
}
setTimeout(() => recheckQueues(), 4000);

function toast(t) { document.querySelector('.toast')?.remove(); const d = document.createElement('div'); d.className = 'toast'; d.innerHTML = ic('check') + esc(t); document.body.append(d); setTimeout(() => d.remove(), 3500); }

async function segSheet(i) {
  const a = cur(); const data = await loadSchedule(region(a.regionId).op); const { date } = kyivNow();
  const d = addDays(date, day);
  const list = withAddr(a, segmentsFor(data, d, a.queue), d);
  const s = list?.[i]; if (!s) return; const st = s[2];
  const title = st === 'on' && s[0] === 0 && s[1] === 1440 ? 'Без відключень' : { on: 'Світло є', off: 'Планове відключення', possible: 'Можливе відключення', unknown: 'Немає даних', emergency: 'Аварійне відключення' }[s[2]];
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
    <button class="li" data-act="npush" style="background:var(--surface-2);border-radius:16px"><span class="lt">${ic('bell')}</span><span class="tx"><span class="tt">Надсилати сповіщення</span><br><span class="st">${(() => { const on = S.addresses.filter(a => a.notify !== false).length; return on === S.addresses.length ? `Для всіх ваших адрес (${on})` : `Для ${on} з ${S.addresses.length} адрес · змінюється в картці адреси`; })()}</span></span><span class="toggle" role="switch" aria-checked="${!!N.enabled}"></span></button>
    ${N.enabled ? `<div class="cap">Попереджати за</div><div class="seg">${[15, 30, 60].map(m => `<button data-act="nlead" data-v="${m}" aria-pressed="${N.lead === m}">${m === 60 ? '1 год' : m + ' хв'}</button>`).join('')}</div>
    <div class="list" style="background:var(--surface-2)">${tg('before', 'Перед відключенням')}${tg('restore', 'Перед відновленням')}${tg('change', 'Графік змінено', 'Що саме змінилось: було → стало')}${tg('tomorrow', 'Опубліковано графік на завтра')}${tg('address', 'Аварії та роботи за адресою', 'Хмельницька й Одеська області')}</div>
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
    await fetch(`${API}api/push/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), lead: S.notify.lead, types: S.notify.types, lang: S.lang, alert: alertPayload(), addrs: S.addresses.filter(a => a.notify !== false).map(a => ({ op: region(a.regionId).op, queue: a.queue, name: a.name, city: a.city, street: a.street, house: a.house })) }) });
  } catch {}
}

// ---------- Події ----------
document.addEventListener('click', async e => {
  const ts = e.target.closest('[data-tsel]'); if (ts) return selectTarget(ts.dataset.tsel);
  const t = e.target.closest('[data-act],[data-go],[data-day],[data-ob]');
  if (!t) return;
  const act = t.dataset.act;
  if (t.dataset.go) { closeSheet(); view = t.dataset.go; if (view !== 'detail') day = day; return render(); }
  if (t.dataset.day) { day = +t.dataset.day; return render(); }
  if (t.dataset.ob) { if (t.dataset.ob === 'back-addresses') { view = 'addresses'; draft = null; } else view = t.dataset.ob; return render(); }
  switch (act) {
    case 'q-ok': { const a = cur(); delete a.qChange; save(); syncPush(); render(); break; }
    case 'q-undo': { const a = cur(); a.queue = a.qChange.from; a.auto = false; delete a.qChange; save(); syncPush(); render(); toast(`Залишено чергу ${a.queue}`); break; }
    case 'q-accept': { const a = cur(); a.queue = a.qSuggest; a.auto = true; delete a.qSuggest; a.qKeep = null; save(); syncPush(); render(); toast(`Чергу змінено на ${a.queue}`); break; }
    case 'q-keep': { const a = cur(); a.qKeep = a.qSuggest; delete a.qSuggest; save(); syncPush(); render(); break; }
    case 'close': closeSheet(); break;
    case 'start': case 'add': closeSheet(); draft = { method: 'address', name: S.addresses.some(a => a.name === 'Дім') ? 'Робота' : 'Дім' }; view = 'ob-region'; render(); break;
    case 'region': draft.regionId = t.dataset.id; draft.city = ''; draft.queue = null; view = 'ob-city'; render(); break;
    case 'city-next': { const v = document.getElementById('city').value.trim(); if (!v) { document.getElementById('city').focus(); break; } if (v !== draft.city) { draft.nsId = null; } draft.city = v; draft.street = draft.street || ''; view = 'ob-method'; render(); break; }
    // натиск на картку способу одразу веде далі — кнопка «Продовжити» не обов'язкова
    case 'method': draft.method = t.dataset.v; view = view === 'ob-method' ? (draft.method === 'address' ? 'ob-address' : 'ob-queue') : view === 'ob-address' ? 'ob-queue' : view; render(); break;
    case 'method-next': view = draft.method === 'address' ? 'ob-address' : 'ob-queue'; render(); break;
    case 'address-next': draft.street = document.getElementById('street').value.trim(); draft.house = document.getElementById('house').value.trim(); view = draft.autoQueue ? 'ob-confirm' : 'ob-queue'; render(); break;
    case 'queue': draft.queue = t.dataset.v; render(); break;
    case 'queue-next': if (draft.editOf) { const a = S.addresses.find(x => x.id === draft.editOf); a.queue = draft.queue; save(); syncPush(); draft = null; view = 'edit'; toast('Чергу змінено'); } else view = 'ob-confirm'; render(); break;
    case 'dname': draft.name = t.dataset.v; render(); break;
    case 'save': { const a = { id: uid(), name: draft.name, regionId: draft.regionId, city: draft.city, street: draft.street || '', house: draft.house || '', queue: draft.queue, ...(draft.pwCity ? { cid: draft.pwCity } : {}),
        // звідки черга: для щотижневої перевірки (оператори іноді переносять будинки в інші черги)
        auto: !!(draft.method === 'address' && draft.autoQueue), src: { hoeId: draft.hoeId || null, streetId: draft.streetId || null, yasnoCity: draft.yasnoCity || null, yasnoHouse: draft.yasnoHouse || null, moeId: draft.moeId || null }, qAt: Date.now() };
      S.addresses.push(a); if (!S.primaryId) S.primaryId = a.id; S.currentId = a.id; save(); syncPush(); draft = null; view = 'home'; day = 0; await render(); toast(`Адресу «${a.name}» збережено`); break; }
    case 'switcher': if (e.target.closest('[data-act=notif]')) { notifSheet(); break; } switcherSheet(); break;
    case 'notif': notifSheet(); break;
    case 'pick': if (e.target.closest('[data-act=edit]')) break; S.currentId = t.dataset.id; save(); closeSheet(); view = 'home'; day = 0; render(); break;
    case 'edit': editId = t.dataset.id; view = 'edit'; render(); break;
    case 'rename': { const a = S.addresses.find(x => x.id === editId); a.name = t.dataset.v; save(); syncPush(); render(); break; }
    case 'primary': S.primaryId = editId; save(); render(); break;
    case 'addr-notify': { const a = S.addresses.find(x => x.id === editId); a.notify = a.notify === false; save(); syncPush(); render(); toast(a.notify ? `Сповіщення для «${a.name}» увімкнено` : `Сповіщення для «${a.name}» вимкнено`); break; }
    case 'requeue': { const a = S.addresses.find(x => x.id === editId); draft = { regionId: a.regionId, queue: a.queue, editOf: a.id, method: 'queue' }; view = 'ob-queue'; render(); break; }
    case 'delete': { const a = S.addresses.find(x => x.id === editId); if (!confirm(tr(`Видалити «${a.name}»? Адресу буде видалено з цього пристрою.`))) break;
      S.addresses = S.addresses.filter(x => x.id !== editId); if (S.primaryId === editId) S.primaryId = S.addresses[0]?.id || null; if (S.currentId === editId) S.currentId = S.primaryId; save(); syncPush(); view = S.addresses.length ? 'addresses' : 'welcome'; render(); toast('Адресу видалено'); break; }
    case 'seg': segSheet(+t.dataset.i); break;
    case 'theme': themeSheet(); break;
    case 'lang': openSheet(`<div class="h-s" style="font-size:22px">Мова</div><div class="list" style="background:var(--surface-2)" data-noi18n>${Object.entries(LANGS).map(([k, l]) => `<button class="li" data-act="setlang" data-v="${k}"><span class="tx"><span class="tt">${l}</span></span>${S.lang === k ? ic('check', '" style="color:var(--accent)') : ''}</button>`).join('')}</div>`); break;
    case 'setlang': S.lang = t.dataset.v; save(); setLang(S.lang); closeSheet(); render(); syncPush(); break;
    case 'settheme': S.theme = t.dataset.v; save(); closeSheet(); render(); break;
    case 'sources': sourcesSheet(); break;
    case 'recheck': {
      const b = e.target.closest('[data-act]'); b.disabled = true; b.classList.add('busy'); b.lastChild.textContent = 'Перевіряю…';
      const d = addDays(kyivNow().date, day), a = cur();
      await refreshNow();
      const data = a && await loadSchedule(region(a.regionId).op);
      toast(a && segmentsFor(data, d, a.queue) ? 'Графік оновлено' : `Графік на ${day ? 'завтра' : 'сьогодні'} ще не опубліковано`); break; }
    case 'clearcache': clearScheduleCache(); if ('caches' in window) { const k = await caches.keys(); await Promise.all(k.filter(x => x.includes('data')).map(x => caches.delete(x))); } toast('Графіки оновлено'); render(); break;
    case 'npush': try {
        if (!S.notify.enabled) { const p = await Notification.requestPermission(); if (p !== 'granted') { notifSheet(); break; } await pushSub(true); S.notify.enabled = true; save(); await syncPush(); toast('Сповіщення увімкнено'); }
        else { const sub = await pushSub(false); if (sub) { await fetch(`${API}api/push/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe(); } S.notify.enabled = false; save(); toast('Сповіщення вимкнено'); }
      } catch (err) { const m = String(err.message || err);
        // «Registration failed - push service error»: на телефоні не працює служба push від Google (браузер Brave, Huawei без Google, вимкнені Google Play Services, VPN/блокувальник)
        toast(/push service|registration failed/i.test(m) ? 'Телефон не зміг підключитися до служби сповіщень Google. Відкрийте застосунок через Chrome і перевірте, що Google Play Services увімкнені' : 'Не вдалося: ' + m); } notifSheet(); render(); break;
    case 'nlead': S.notify.lead = +t.dataset.v; save(); syncPush(); notifSheet(); break;
    case 'ntype': S.notify.types[t.dataset.k] = S.notify.types[t.dataset.k] === false; save(); syncPush(); notifSheet(); break;
    case 'ntest': { const sub = await pushSub(false); if (!sub) break; const r = await fetch(`${API}api/push/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).then(r => r.json()).catch(() => ({})); toast(r.ok ? 'Надіслано — перевірте сповіщення' : 'Не вдалося надіслати'); break; }
    case 'acity': openSheet(citySheetHTML() + `<button class="btn ghost" data-act="close">Закрити</button>`); await fillCityList(''); { const q = document.getElementById('acityq'); q.addEventListener('input', () => fillCityList(q.value)); } break;
    case 'acitypick': { const h = document.getElementById('acitylist')._res?.[+t.dataset.i]; if (!h) break; S.alerts.city = cityFromHromada(h); save(); syncPush(); closeSheet(); mapSettingsChanged(); render(); toast(`Місто: ${S.alerts.city.label}`); break; }
    case 'apush': if (!S.alerts.push || !S.notify.enabled) { // увімкнути: потрібен дозвіл на сповіщення
        try { if (!S.notify.enabled) { const p = await Notification.requestPermission(); if (p !== 'granted') { notifSheet(); break; } await pushSub(true); S.notify.enabled = true; }
          S.alerts.push = true; save(); await syncPush(); toast('Сповіщення про тривогу увімкнено'); } catch (err) { notifSheet(); break; } }
      else { S.alerts.push = false; save(); syncPush(); toast('Сповіщення про тривогу вимкнено'); } render(); break;
    case 'asiren': S.alerts.siren = S.alerts.siren === false; save(); syncPush(); if (S.alerts.siren) playSiren(); render(); break;
    case 'atargets': S.alerts.targets = S.alerts.targets === false; save(); mapSettingsChanged(); render(); break;
    case 'athreat': S.alerts.threat = S.alerts.threat === false; save(); mapSettingsChanged(); render(); break;
    case 'apick': view = 'alerts'; await render(); startPick(c => { S.alerts.city = c; save(); syncPush(); mapSettingsChanged(); render(); toast(`Ваша точка: ${c.label}`); }); document.querySelector('.astage')?.scrollIntoView({ behavior: 'smooth' }); break;
    case 'asheet': toggleDrawer(); break; // без перемальовування — плавна анімація
    case 'amode': S.alerts.mode = t.dataset.v; save(); mapSettingsChanged(); render(); break;
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
// Тривоги: оновлюємо раз на 20 с лише коли вкладка відкрита й видима (економія ліміту й батареї)
setInterval(async () => { if (document.hidden || !['alerts', 'alert-settings'].includes(view)) return; await fetchAlerts(true); checkSiren(); if (!document.querySelector('.bsheet')) render(); }, 20000);
// цілі — частіше (раз на 10 с); між оновленнями вони рухаються на карті щосекунди своїм курсом
setInterval(() => { if (!document.hidden && view === 'alerts' && lastSnap()) fetchTargets(); }, 10000);
// Масштаб усього застосунку пальцями вимкнено — наближується лише карта
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (e.touches.length > 1 && !e.target.closest('.amapc')) e.preventDefault(); }, { passive: false });
// Відкрили застосунок (або повернулися до нього) — тихо просимо сервер перевірити сайти обленерго, щоб не чекати
// планового збору (раз на 15 хв). Не частіше ніж раз на 3 хв з одного пристрою.
let lastAutoTick = 0;
// Щоразу при відкритті застосунку (і поверненні до нього) — свіжа перевірка адрес на сайтах обленерго: аварійні відключення
function autoRefresh() {
  if (view === 'alerts') return fetchAlerts(true).then(() => { checkSiren(); render(); });
  if (!S.addresses.length) return render();
  freshAddr = true;
  if (API_READY && Date.now() - lastAutoTick > 180000) { lastAutoTick = Date.now(); refreshNow(); }
  else { for (const k of Object.keys(addrCache)) delete addrCache[k]; render().then(() => refreshAddrs()); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) autoRefresh(); });
setTimeout(autoRefresh, 1500);

if ('serviceWorker' in navigator) {
  // Нова версія: щойно новий SW бере керування — один раз перезавантажуємо, щоб одразу показати зміни.
  const hadSW = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadSW && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => {
    r.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') r.update().catch(() => {}); });
  }).catch(() => {});
}

// Потягнути вниз на головному екрані — оновити
(() => {
  let y0 = null, dy = 0; const TH = 72;
  const ind = document.createElement('div'); ind.className = 'ptr'; ind.innerHTML = ic('refresh'); document.body.append(ind);
  const atTop = () => (document.scrollingElement || document.documentElement).scrollTop <= 0;
  document.addEventListener('touchstart', e => { y0 = view === 'home' && !document.querySelector('.bsheet') && atTop() && e.touches.length === 1 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (y0 == null || refreshing) return;
    dy = e.touches[0].clientY - y0; if (dy <= 0) { ind.style.cssText = ''; return; }
    if (e.cancelable) e.preventDefault();
    const p = Math.min(dy / TH, 1.4);
    ind.style.cssText = `opacity:${Math.min(p, 1)};transform:translate(-50%,${Math.min(dy * .55, 90)}px) rotate(${p * 270}deg)`; ind.classList.toggle('ready', p >= 1);
  }, { passive: false });
  document.addEventListener('touchend', async () => {
    if (y0 == null) return; y0 = null;
    if (dy < TH || refreshing) { ind.style.cssText = ''; ind.classList.remove('ready'); return; }
    ind.classList.add('spin'); ind.style.cssText = 'opacity:1;transform:translate(-50%,56px)';
    try { await refreshNow(); toast('Оновлено'); } finally { ind.classList.remove('spin', 'ready'); ind.style.cssText = ''; }
  });
})();
// Таймер із секундами — оновлюється щосекунди без перерендеру
setInterval(() => { const el = document.querySelector('[data-asince]'); if (el) el.textContent = hms(Date.now() - +el.dataset.asince); }, 1000);
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
  setTimeout(() => { pre.classList.add('hide'); setTimeout(() => pre.remove(), 500); }, Math.max(0, 4300 - performance.now()));
});

// ---------- Підказки адреси ----------
function initCity() {
  const r = region(draft.regionId), inp = document.getElementById('city');
  attachTypeahead(inp, citySource(r), it => { draft.city = it.label; draft.nsId = it.id || null; draft.hoeId = it.hoe || null; draft.yasnoCity = it.yasnoCity || null; draft.pwCity = it.pwCity || null; draft.street = ''; draft.streetId = null; draft.house = ''; view = 'ob-method'; render(); }, { minChars: 0 });
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
    res.innerHTML = `<div class="card" style="background:var(--on-soft);box-shadow:none;gap:8px"><div style="display:flex;gap:10px;align-items:center;font-weight:600;color:var(--on-ink)">${ic('check')}Вашу адресу знайдено</div><div style="display:flex;gap:8px;align-items:baseline"><span class="body-s">Черга</span><span class="mono" style="font-size:20px;font-weight:600">${esc(q)}</span></div><div class="source ok">${ic('shield')}Визначено за даними ${esc(by)}</div>
      <div class="bb" style="margin-top:4px">${ic('alert')} Обленерго могло змінити вашу чергу. Перевірте її${QUEUE_LOOKUP[r.op] ? ` <a href="${QUEUE_LOOKUP[r.op]}" target="_blank" rel="noopener">на сайті ${esc(r.opName)}</a>` : ' на сайті обленерго'} і підтвердьте. Якщо черга інша — змініть її вручну.</div>
      <button class="btn sm ghost" data-ob="ob-queue" style="margin-top:4px">Змінити вручну</button></div>`;
    next.textContent = `Підтвердити чергу ${q}`; };
  const notFound = why => { draft.autoQueue = false; res.innerHTML = `<div class="banner warn">${ic('alert')}<div><div class="bt">Чергу не вдалося визначити автоматично</div><div class="bb">${why} Оберіть чергу вручну на наступному кроці.</div></div></div>`; next.textContent = 'Обрати чергу вручну'; };
  let houseSrc = null;
  const setupHouse = () => { houseSrc = houseSource(r, draft);
    if (houseSrc && !houseTA) houseTA = attachTypeahead(hs, q => houseSrc ? houseSrc(q) : Promise.resolve([]), it => {
      draft.house = it.label;
      draft.yasnoHouse = it.yasnoHouse || null; draft.moeId = it.id || null;
      if (it.yasnoHouse) { res.innerHTML = `<div class="banner info">${ic('refresh')}<div class="bt">Шукаємо чергу для адреси…</div></div>`;
        return yasnoGroup(r.op, draft.streetId, it.yasnoHouse, draft.yasnoCity).then(q => q ? found(q, 'YASNO') : notFound('YASNO не повернув групу для цього будинку.')).catch(() => notFound('Сервіс YASNO зараз не відповідає.')); }
      // черга будинку на сервері оператора (Полтаваобленерго): питаємо при виборі будинку
      if (it.remote) { res.innerHTML = `<div class="banner info">${ic('refresh')}<div class="bt">Шукаємо чергу для адреси…</div></div>`;
        return import('./address.js').then(m => m.pq('queue', { op: r.op, cityId: draft.pwCity, streetId: draft.streetId, house: it.label }))
          .then(x => x.queue ? found(x.queue, r.opName) : notFound(x.multi ? 'За цією адресою кілька підключень (багатоквартирний будинок) — оператор не називає одну чергу. Оберіть свою вручну.' : 'Оператор не вказав чергу для цього будинку.'))
          .catch(() => notFound('Сайт оператора зараз не відповідає.')); }
      if (it.id) return lookup(it.id);
      const useQueues = (list, by) => { const qok = new Set(queueList(r.queues)); const qs = [...new Set(list.map(x => String(x).trim()).filter(x => qok.has(x)))];
        if (!qs.length) return notFound('Оператор не вказав чергу для цього будинку.');
        if (qs.length === 1) return found(qs[0], by || r.opName);
        draft.autoQueue = false; next.textContent = 'Обрати чергу вручну';
        res.innerHTML = `<div class="banner warn">${ic('alert')}<div><div class="bt">Будинок у кількох чергах</div><div class="bb">За даними ${esc(r.opName)} різні під’їзди чи лінії цього будинку мають різні черги. Свою чергу можна дізнатися в рахунку або особовому кабінеті. Оберіть її:</div></div></div><div class="qgrid c3">${qs.map(q => `<button class="qcell" data-mq="${q}">${q}</button>`).join('')}</div>`;
        res.querySelectorAll('[data-mq]').forEach(b => b.onclick = () => found(b.dataset.mq, r.opName)); };
      // Хмельницька: спершу свіжа черга з пошуку «Відключення за адресою» на сайті обленерго, файли черг (від 09.10) — запасний варіант
      if (r.op === 'hoe' && API_READY) { res.innerHTML = `<div class="banner info">${ic('refresh')}<div class="bt">Перевіряємо чергу на сайті обленерго…</div></div>`;
        return pq('queue', { op: 'hoe', city: draft.city, street: draft.street, house: it.label })
          .then(x => {
            if (x.queues?.length) return useQueues(x.queues, x.memory ? 'сайтом Хмельницькобленерго (за останнім відключенням)' : 'сайтом Хмельницькобленерго');
            // на сайті зараз немає відключень за адресою — черги не видно; файл обленерго (від 09.10) може бути застарілим
            const fq = [...new Set((it.queues || []).map(q => q.trim()))];
            draft.autoQueue = false; next.textContent = 'Обрати чергу вручну';
            res.innerHTML = `<div class="banner warn">${ic('alert')}<div><div class="bt">Чергу не підтверджено сайтом обленерго</div><div class="bb">Зараз за цією адресою немає відключень, тож сайт не показує чергу.${fq.length ? ` У файлі обленерго від 09.10 — ${fq.map(esc).join(' або ')}, але її могли змінити.` : ''} Перевірте свою чергу на сайті й оберіть її.</div><div class="mq">${fq.map(q => `<button class="btn sm" data-mq="${esc(q)}">${esc(q)} (з файлу)</button>`).join('')}<a class="btn sm ghost" href="https://hoe.com.ua/shutdown/queue" target="_blank" rel="noopener">${ic('external')}Перевірити чергу</a></div></div></div>`;
            res.querySelectorAll('[data-mq]').forEach(b => b.onclick = () => { found(b.dataset.mq, 'файлом черг Хмельницькобленерго'); draft.autoQueue = false; });
          })
          .catch(() => it.queues ? useQueues(it.queues, 'файлом черг Хмельницькобленерго') : notFound('Сайт оператора зараз не відповідає.')); }
      if (it.queues) return useQueues(it.queues);
    }, { minChars: 0, emptyText: 'Такого номера немає в довіднику оператора' }); };
  attachTypeahead(st, streetSource(r, draft), it => { draft.street = it.label; draft.streetId = it.id || null; draft.house = ''; hs.value = ''; res.innerHTML = ''; draft.autoQueue = false; setupHouse(); hs.focus();
    if (dtekAuto(r)) import('./address.js').then(m => m.dtekHouses(r.op, draft.city, draft.street)).catch(() => notFound('Сервіс ДТЕК зараз не відповідає.'));
    if (FILE_ADDR.has(r.op) && draft.hoeId) hoeStreetQueue(r.op, draft).then(qs => { if (qs?.length) found(qs[0], r.opName); }).catch(() => {}); }, { minChars: draft.nsId ? 0 : 1 });
  st.addEventListener('input', () => { draft.streetId = null; draft.autoQueue = false; res.innerHTML = ''; });
  setupHouse();
  if (!draft.street) st.focus();
}
