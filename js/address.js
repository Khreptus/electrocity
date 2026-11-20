// Підказки адреси за першими літерами.
// Джерела: довідник оператора (ДТЕК — міста/вулиці, Миколаїв — міста/вулиці/будинки + черга),
// для решти — OpenStreetMap через Photon (komoot), українською.
import { moeAddr } from './data.js';
import { API, API_READY } from './config.js';

const norm = s => String(s || '').toLowerCase().replace(/[’'ʼ`]/g, '’').replace(/ё/g, 'е').trim();
// прибираємо «вул.», «м.», «с.» тощо, щоб «шев» знаходило «вул. Шевченка»
const core = s => norm(s).replace(/^(м|с|смт|с-ще|селище|сел|вул|пров|просп|пр|пл|бул|туп|узвіз|шосе|наб|мкр|проїзд|в’їзд|майдан|дорога|ул|улица|пер|переулок|проспект|пр-т|бульвар|площадь|г|город|пгт|пос|поселок|посёлок|село|деревня)\.?\s+/i, '');
// «Скелет» слова для пошуку російською: голосні → *, без ь/ъ/апострофів, подвоєні літери — одна.
// «Хмельницкий» ≈ «Хмельницький», «Кривой Рог» ≈ «Кривий Ріг», «Одесса» ≈ «Одеса», «Киев» ≈ «Київ».
export const skel = s => norm(s).replace(/[’ʼ`ъь]/g, '').replace(/ґ/g, 'г').replace(/[аеєёэиіїйоуыюя]+/g, '*').replace(/(.)\1+/g, '$1');
const ruAlias = q => q.replace(/^никола/, 'микола');
export function rank(items, q, key = x => x.label) {
  const nq = norm(q).replace(/[,\s]+\d+[а-яіїєa-z]?\s*$/i, '').trim(); if (!nq) return items.slice(0, 30); // «Хрещатик 22» → «Хрещатик»
  const sq = skel(ruAlias(core(nq))); const useSk = sq.replace(/\*/g, '').length >= 2;
  const out = [];
  for (const it of items) {
    const l = norm(key(it)), c = core(key(it));
    let i = c.startsWith(nq) ? 0 : l.startsWith(nq) ? 1 : c.split(/[\s-]/).some(w => w.startsWith(nq)) ? 2 : l.includes(nq) ? 3 : -1;
    if (i < 0 && useSk) { const sc = skel(c); i = sc.startsWith(sq) ? 4 : sc.split(/[\s-]/).some(w => w.startsWith(sq)) ? 5 : -1; }
    // усі слова запиту є на початку слів назви, у будь-якому порядку: «Лесі Українки» → «бул. Українки Лесі»
    if (i < 0) { const qw = core(nq).split(/[\s,.\-]+/).filter(w => w && !/^\d/.test(w)); const lw = l.split(/[\s,.\-()]+/); if (qw.length && qw.every(w => lw.some(x => x.startsWith(w) || (useSk && skel(x).startsWith(skel(w)))))) i = 6; }
    if (i >= 0) out.push([i, it]);
  }
  return out.sort((a, b) => a[0] - b[0] || key(a[1]).localeCompare(key(b[1]), 'uk')).slice(0, 30).map(x => x[1]);
}

// ---------- ДТЕК: довідник «місто → вулиці» ----------
const dtekCache = {};
async function dtekDir(op) {
  if (!dtekCache[op]) dtekCache[op] = fetch(`data/addr/${op}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
  return dtekCache[op];
}

// ---------- Миколаїв: усі населені пункти з дільниць ----------
let moeNs = null;
async function moeSettlements() {
  if (!moeNs) moeNs = (async () => {
    const fil = await moeAddr.filii();
    const parts = await Promise.all(fil.map(f => moeAddr.ns(f.idfilial).then(ns => ns.map(n => ({ label: n.naznaspunkt, sub: f.fullname, id: n.idnaspunkt }))).catch(() => [])));
    return parts.flat();
  })();
  return moeNs;
}

// ---------- Довідники «адреса → черга» з файлів (scripts/hoe-addr.mjs, scripts/cv-addr.mjs) ----------
// Хмельницькобленерго — офіційні xlsx; Чернівціобленерго — сторінки пошуку групи. Формат однаковий:
// index.json { items: [[населений пункт, РЕМ/дільниця, id]] }, <id>.json { вулиця: [[будинок, "1.1,2.2"], …] }
export const FILE_ADDR = new Set(['hoe', 'chernoe']);
const fileIdx = {}; const fileCity = {};
export const hoeIndex = op => fileIdx[op] ||= fetch(`data/addr/${op}/index.json`).then(r => r.ok ? r.json() : null).catch(() => null);
export const hoeCity = (op, id) => fileCity[op + id] ||= fetch(`data/addr/${op}/${id}.json`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(e => { delete fileCity[op + id]; throw e; });
// Черга для всієї вулиці (у файлі будинки не перелічені)
export async function hoeStreetQueue(op, draft) {
  if (!draft.hoeId || !draft.street) return null;
  const hs = (await hoeCity(op, draft.hoeId))[draft.street];
  const all = hs?.find(h => h[0] === '*');
  return all && hs.length === 1 ? all[1].split(',') : null;
}

// ---------- OpenStreetMap (Photon) ----------
let ctl = null;
async function photon(q, extra) {
  ctl?.abort(); ctl = new AbortController();
  const r = await fetch(`https://photon.komoot.io/api/?lang=default&limit=20&bbox=22.1,44.3,40.3,52.4&q=${encodeURIComponent(q)}${extra}`, { signal: ctl.signal });
  return (await r.json()).features.map(f => f.properties);
}
const uniq = (arr, k) => { const s = new Set(); return arr.filter(x => { const v = k(x); if (s.has(v)) return false; s.add(v); return true; }); };

// ---------- YASNO (ДТЕК): Київ і Дніпропетровщина — довідник адрес і група за адресою ----------
export const YASNO_OPS = new Set(['dtek-kem', 'dtek-dnem']);
export const isYasno = region => YASNO_OPS.has(region.op) && API_READY;
const yq = (kind, params) => fetch(`${API}api/yasno/${kind}?${new URLSearchParams(params)}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
// Львівобленерго: довідник «Чому немає світла?» з чергою кожного будинку
export const PW_OPS = new Set(['loe', 'zhoe', 'choe', 'poe-poltava']); // довідники через наш сервер: Львівобленерго (API), Житомиробленерго (форма пошуку)
export const isPw = region => PW_OPS.has(region.op) && (API_READY || region.op === 'poe-poltava');
export const pq = (kind, params) => params.op === 'poe-poltava' ? poeClient(kind, params) : fetch(`${API}api/pw/${kind}?${new URLSearchParams(kind === 'queue' ? { ...params, _: Date.now() } : params)}`, kind === 'queue' ? { cache: 'no-store' } : {}).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

// ---------- Полтаваобленерго: напряму з браузера користувача ----------
// Сайт poe.pl.ua не відповідає серверам Cloudflare (522), але дозволяє запити з інших сайтів (CORS) — тож довідник адрес,
// черга будинку й відключення за адресою беруться з відкритого пошуку «Інформація про перерви в електропостачанні» прямо з телефона.
const POE = 'https://www.poe.pl.ua/customs/';
const POE_FIL = [['102', 'Великокохнівська'], ['103', 'Гадяцька'], ['104', 'Глобинська'], ['112', 'Горішньоплавнівська'], ['105', 'Гребінківська'], ['106', 'Диканська'], ['108', 'Зінківська'], ['109', 'Карлівська'], ['110', 'Кобеляцька'], ['111', 'Козельщинська'], ['113', 'Котелевська'], ['114', 'Красногорівська'], ['115', 'Кременчуцька'], ['116', 'Лохвицька'], ['117', 'Лубенська'], ['118', 'Машівська'], ['119', 'Миргородська'], ['120', 'Новосанжарська'], ['121', 'Оржицька'], ['122', 'Пирятинська'], ['131', 'Полтавська (райони)'], ['123', 'Полтавська'], ['124', 'Решетилівська'], ['125', 'Семенівська'], ['126', 'Хорольська'], ['127', 'Чорнухинська'], ['128', 'Чутівська'], ['129', 'Шишацька']];
const poePost = (file, obj) => fetch(POE + file, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: 'disconn=' + encodeURIComponent(JSON.stringify(obj)) }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
const poeName = s => String(s || '').replace(/^місто\s+/i, 'м. ').replace(/^село\s+/i, 'с. ').replace(/^селище міського типу\s+/i, 'смт ').replace(/^селище\s+/i, 'с-ще ').trim();
const poeMem = {};
function poeCached(key, ttlMs, load) {
  if (poeMem[key]) return poeMem[key];
  try { const c = JSON.parse(localStorage.getItem('ec.poe.' + key) || 'null'); if (c && Date.now() - c.t < ttlMs) return (poeMem[key] = Promise.resolve(c.v)); } catch {}
  return (poeMem[key] = load().then(v => { try { localStorage.setItem('ec.poe.' + key, JSON.stringify({ t: Date.now(), v })); } catch {} return v; }).catch(e => { delete poeMem[key]; throw e; }));
}
const poeTime = s => { const m = String(s || '').match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, '0')}:${m[5]}` : null; };
const poeStrip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const poeInfo = (cid, sid, house) => poePost('disconnectinforesult-cabinet.php', { cityid: cid.split('-')[1], streerid: String(sid), house: String(house) }).then(a => (a || [])[0] || null);
function poeItems(info) {
  const items = [];
  if (info && +info.message_type && info.fn_accident_message) {
    const t = poeStrip(info.fn_accident_message); const kind = /аварі/i.test(t) ? 'emergency' : 'planned';
    items.push({ kind, reason: /ГПВ|погодинн/i.test(t) ? 'Графік погодинних відключень' : kind === 'emergency' ? 'Аварійне відключення' : 'Планові роботи', start: poeTime(info.accident_str), end: null, scope: 'house', source: 'Полтаваобленерго' });
  }
  if (info?.planned_message) { const t = poeStrip(info.planned_message); const ts = [...t.matchAll(/(\d{2}\.\d{2}\.\d{4})\D{0,12}(\d{1,2}:\d{2})/g)].map(m => poeTime(`${m[1]} ${m[2]}`));
    if (t) items.push({ kind: 'planned', reason: 'Планові роботи', start: ts[0] || null, end: ts[1] || null, scope: 'house', source: 'Полтаваобленерго' }); }
  return items;
}
const pk = s => String(s || '').toLowerCase().replace(/[’'ʼ`]/g, '').replace(/\(.*?\)/g, '').replace(/^(м|с|смт|с-ще|селище|село|місто)\.?\s+/, '').replace(/\s+/g, ' ').trim();
const sk = s => String(s || '').toLowerCase().replace(/[’'ʼ`.]/g, '').replace(/^(вул|вулиця|пров|провулок|просп|проспект|пр|пл|площа|бул|бульвар|туп|тупик|узвіз|шосе|наб|набережна|мкр|мікрорайон|проїзд|майдан)\s+/, '').replace(/\s+/g, ' ').trim();
export async function poeClient(kind, p) {
  if (kind === 'cities') return poeCached('cities', 7 * 864e5, async () => (await Promise.all(POE_FIL.map(async ([f, name]) =>
    ((await poePost('search-disconnection-cabinet.php', { operation_type: 'city', filial_id: f, city_id: '', street_id: '' }).catch(() => [])) || [])
      .filter(c => !/_$/.test(c.instance_name)).map(c => ({ id: `${f}-${c.instance_id}`, label: poeName(c.instance_name), sub: `${name} дільниця` }))))).flat());
  const cid = String(p.cityId || p.cid || ''); const [f, c] = cid.split('-');
  if (kind === 'streets') return poeCached('st' + cid, 7 * 864e5, async () => ((await poePost('search-disconnection-cabinet.php', { operation_type: 'street', filial_id: f, city_id: +c, street_id: '' })) || []).map(x => ({ id: String(x.instance_id), label: String(x.instance_name).trim() })));
  if (kind === 'houses') return ((await poePost('search-disconnection-cabinet.php', { operation_type: 'building', filial_id: f, city_id: +c, street_id: +p.streetId })) || []).map(x => ({ label: String(x.instance_name).trim(), remote: true }));
  if (kind === 'queue') { const i = await poeInfo(cid, p.streetId, p.house); const q = i && /^\d+$/.test(i.gp_qnum_1 || '') && /^\d+$/.test(i.gp_qnum_2 || '') ? `${i.gp_qnum_1}.${i.gp_qnum_2}` : null;
    return { queue: q, multi: !!(i && +i.message_type === 0 && /декілька/i.test(i.fn_accident_message || '')) }; }
  if (kind === 'outage') { // { city, street, house, cid } → той самий формат, що й /api/outage
    let id = /^\d+-\d+$/.test(cid) ? cid : ((await poeClient('cities', {})).find(x => pk(x.label) === pk(p.city)) || {}).id;
    const base = { ok: true, supported: true, source: 'Полтаваобленерго', url: 'https://www.poe.pl.ua/disconnection/power-outages/', checkedAt: new Date().toISOString() };
    if (!id) return { ...base, found: false, items: [] };
    const st = (await poeClient('streets', { cityId: id })).find(x => sk(x.label) === sk(p.street)); if (!st) return { ...base, found: false, items: [] };
    const info = await poeInfo(id, st.id, p.house);
    if (info && +info.message_type === 0 && /декілька/i.test(info.fn_accident_message || '')) return { ...base, found: false, items: [] };
    return { ...base, found: true, items: poeItems(info) };
  }
  throw new Error('невідомий запит');
}
const pwCities = {};
export const yasnoGroup = (op, streetId, houseId, cityId) => yq('group', { op, streetId, houseId, ...(cityId ? { cityId } : {}) }).then(j => j.queue);

// ---------- Публічні джерела для онбордингу ----------
export function citySource(region) {
  if (isPw(region)) return async q => { if (norm(q).length < 2) return []; pwCities[region.op] ||= pq('cities', { op: region.op }); return rank((await pwCities[region.op]).map(c => ({ label: c.label, sub: c.sub, pwCity: c.id })), q).slice(0, 20); };
  if (isYasno(region)) return async q => {
    if (region.op === 'dtek-kem') return [{ label: 'м. Київ' }]; // у Києві вулиці шукаються без вибору міста
    if (norm(q).length < 2) return [];
    return rank((await yq('cities', { op: region.op, q })).map(c => ({ label: c.label, yasnoCity: c.id })), q);
  };
  if (region.op.startsWith('dtek-')) return async q => {
    const d = await dtekDir(region.op);
    if (d) return rank(Object.keys(d).map(label => ({ label })), q);
    return osmCities(region, q);
  };
  if (region.addressLookup === 'moe') return async q => rank(await moeSettlements(), q);
  if (FILE_ADDR.has(region.op)) return async q => {
    const d = await hoeIndex(region.op);
    if (d?.items?.length) return rank(d.items.map(([label, sub, id]) => ({ label, sub, hoe: id })), q);
    return osmCities(region, q);
  };
  return q => osmCities(region, q);
}
async function osmCities(region, q) {
  if (norm(q).length < 2) return (region.cities || [region.center]).map(label => ({ label }));
  const stateName = region.id === 'kyiv-city' ? 'Київ' : region.name + ' область';
  const res = await photon(q, '&osm_tag=place:city&osm_tag=place:town&osm_tag=place:village&osm_tag=place:hamlet');
  return uniq(res.filter(p => (p.state || '').startsWith(stateName) || (region.id === 'kyiv-city' && p.name === 'Київ'))
    .map(p => ({ label: p.name, sub: [p.county, p.state].filter(Boolean).join(' · ') })), x => x.label + x.sub).slice(0, 15);
}

export function streetSource(region, draft) {
  if (isPw(region) && draft.pwCity) { let c = null; return async q => { c ||= pq('streets', { op: region.op, cityId: draft.pwCity }); return rank((await c).map(x => ({ label: x.label, id: x.id })), q).slice(0, 20); }; }
  if (isYasno(region)) return async q => {
    if (norm(q).length < 2) return [];
    const p = { op: region.op, q }; if (draft.yasnoCity) p.cityId = draft.yasnoCity;
    return rank((await yq('streets', p)).map(x => ({ label: x.label, id: x.id })), q).slice(0, 20);
  };
  if (region.op.startsWith('dtek-')) return async q => {
    const d = await dtekDir(region.op);
    const list = d?.[draft.city];
    if (list) return rank(list.map(label => ({ label })), q);
    return osmStreets(draft, q);
  };
  if (region.addressLookup === 'moe' && draft.nsId) {
    let cache = null;
    return async q => { cache ||= (await moeAddr.streets(draft.nsId)).map(s => ({ label: s.nazstreet, id: s.idstreet })); return rank(cache, q); };
  }
  if (FILE_ADDR.has(region.op) && draft.hoeId) return async q => rank(Object.keys(await hoeCity(region.op, draft.hoeId)).map(label => ({ label })), q);
  return q => osmStreets(draft, q);
}
async function osmStreets(draft, q) {
  if (norm(q).length < 2) return [];
  const city = String(draft.city || '').replace(/^(м|с|смт|с-ще)\.\s*/, '');
  const res = await photon(`${q} ${city}`, '&osm_tag=highway');
  const nc = norm(city);
  return uniq(res.filter(p => !nc || norm(p.city || '').includes(nc)).map(p => ({ label: p.name })), x => x.label).slice(0, 15);
}

// ДТЕК: будинки вулиці й черга кожного будинку (через наш сервер)
const dtekHouseCache = {};
export async function dtekHouses(op, city, street) {
  const k = `${op}|${city}|${street}`;
  dtekHouseCache[k] ||= fetch(`${API}api/dtek/houses?op=${encodeURIComponent(op)}&city=${encodeURIComponent(city)}&street=${encodeURIComponent(street)}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(e => { delete dtekHouseCache[k]; throw e; });
  return dtekHouseCache[k];
}
export const dtekAuto = region => region.op.startsWith('dtek-') && !YASNO_OPS.has(region.op) && API_READY;

export function houseSource(region, draft) {
  if (isPw(region) && draft.pwCity && draft.streetId) { let c = null; return async q => { c ||= pq('houses', { op: region.op, cityId: draft.pwCity, streetId: draft.streetId }); return rank(await c, q).slice(0, 40); }; }
  if (isYasno(region) && draft.streetId) return async q => rank((await yq('houses', { op: region.op, streetId: draft.streetId, q, ...(draft.yasnoCity ? { cityId: draft.yasnoCity } : {}) })).map(x => ({ label: x.label, yasnoHouse: x.id })), q).slice(0, 40);
  if (dtekAuto(region) && draft.street) return async q => {
    const d = await dtekHouses(region.op, draft.city, draft.street);
    return rank(Object.entries(d.houses).map(([label, qs]) => ({ label, queues: qs })), q).slice(0, 40);
  };
  if (region.addressLookup === 'moe' && draft.streetId) {
    let cache = null;
    return async q => { cache ||= (await moeAddr.houses(draft.streetId)).map(d => ({ label: d.nazdom, id: d.iddom })); return rank(cache, q).slice(0, 40); };
  }
  if (FILE_ADDR.has(region.op) && draft.hoeId && draft.street) return async q => {
    const hs = (await hoeCity(region.op, draft.hoeId))[draft.street] || [];
    return rank(hs.filter(h => h[0] !== '*').map(([label, qs]) => ({ label, queues: qs.split(',') })), q).slice(0, 40);
  };
  return null; // вводиться вручну
}

// ---------- UI: поле з підказками ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function hl(label, q) {
  const l = String(label), i = norm(l).indexOf(norm(q));
  if (!q || i < 0) return esc(l);
  return esc(l.slice(0, i)) + '<b>' + esc(l.slice(i, i + q.length)) + '</b>' + esc(l.slice(i + q.length));
}
export function attachTypeahead(input, source, onPick, { minChars = 1, emptyText = 'Нічого не знайдено' } = {}) {
  const box = document.createElement('div'); box.className = 'sugg'; box.setAttribute('role', 'listbox'); box.hidden = true;
  input.closest('.field').after(box);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  let items = [], active = -1, timer = null, seq = 0, picked = false;
  const draw = () => {
    box.innerHTML = items.length ? items.map((it, i) => `<button type="button" role="option" class="${i === active ? 'on' : ''}" data-i="${i}"><span>${hl(it.label, input.value.trim())}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('')
      : `<div class="none">${emptyText}</div>`;
    box.hidden = false;
  };
  const run = async () => {
    const q = input.value.trim(); const my = ++seq;
    if (q.length < minChars && minChars > 0) { box.hidden = true; return; }
    box.hidden = false; box.innerHTML = '<div class="none">Шукаємо…</div>';
    try { const r = await source(q); if (my !== seq) return; items = r; active = -1; draw(); }
    catch (e) { if (e.name !== 'AbortError' && my === seq) { box.innerHTML = '<div class="none">Не вдалося завантажити підказки. Введіть вручну.</div>'; } }
  };
  input.addEventListener('input', () => { picked = false; clearTimeout(timer); timer = setTimeout(run, 180); });
  input.addEventListener('focus', () => { if (!picked && (minChars === 0 || input.value.trim())) run(); });
  input.addEventListener('keydown', e => {
    if (box.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && active >= 0) { pick(items[active]); e.preventDefault(); }
    if (e.key === 'Escape') box.hidden = true;
  });
  const pick = it => { clearTimeout(timer); seq++; picked = true; input.value = it.label; box.hidden = true; box.innerHTML = ''; onPick(it); };
  box.addEventListener('mousedown', e => e.preventDefault());
  box.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(items[+b.dataset.i]); });
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  return { run };
}
