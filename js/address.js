// Підказки адреси за першими літерами.
// Джерела: довідник оператора (ДТЕК — міста/вулиці, Миколаїв — міста/вулиці/будинки + черга),
// для решти — OpenStreetMap через Photon (komoot), українською.
import { moeAddr } from './data.js';

const norm = s => String(s || '').toLowerCase().replace(/[’'ʼ`]/g, '’').replace(/ё/g, 'е').trim();
// прибираємо «вул.», «м.», «с.» тощо, щоб «шев» знаходило «вул. Шевченка»
const core = s => norm(s).replace(/^(м|с|смт|с-ще|селище|сел|вул|пров|просп|пр|пл|бул|туп|узвіз|шосе|наб|мкр|проїзд|в’їзд|майдан|дорога)\.?\s+/i, '');
export function rank(items, q, key = x => x.label) {
  const nq = norm(q); if (!nq) return items.slice(0, 30);
  const out = [];
  for (const it of items) {
    const l = norm(key(it)), c = core(key(it));
    const i = c.startsWith(nq) ? 0 : l.startsWith(nq) ? 1 : c.split(/[\s-]/).some(w => w.startsWith(nq)) ? 2 : l.includes(nq) ? 3 : -1;
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

// ---------- OpenStreetMap (Photon) ----------
let ctl = null;
async function photon(q, extra) {
  ctl?.abort(); ctl = new AbortController();
  const r = await fetch(`https://photon.komoot.io/api/?lang=default&limit=20&bbox=22.1,44.3,40.3,52.4&q=${encodeURIComponent(q)}${extra}`, { signal: ctl.signal });
  return (await r.json()).features.map(f => f.properties);
}
const uniq = (arr, k) => { const s = new Set(); return arr.filter(x => { const v = k(x); if (s.has(v)) return false; s.add(v); return true; }); };

// ---------- Публічні джерела для онбордингу ----------
export function citySource(region) {
  if (region.op.startsWith('dtek-')) return async q => {
    const d = await dtekDir(region.op);
    if (d) return rank(Object.keys(d).map(label => ({ label })), q);
    return osmCities(region, q);
  };
  if (region.addressLookup === 'moe') return async q => rank(await moeSettlements(), q);
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
  return q => osmStreets(draft, q);
}
async function osmStreets(draft, q) {
  if (norm(q).length < 2) return [];
  const city = String(draft.city || '').replace(/^(м|с|смт|с-ще)\.\s*/, '');
  const res = await photon(`${q} ${city}`, '&osm_tag=highway');
  const nc = norm(city);
  return uniq(res.filter(p => !nc || norm(p.city || '').includes(nc)).map(p => ({ label: p.name })), x => x.label).slice(0, 15);
}

export function houseSource(region, draft) {
  if (region.addressLookup === 'moe' && draft.streetId) {
    let cache = null;
    return async q => { cache ||= (await moeAddr.houses(draft.streetId)).map(d => ({ label: d.nazdom, id: d.iddom })); return rank(cache, q).slice(0, 40); };
  }
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
  let items = [], active = -1, timer = null, seq = 0;
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
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
  input.addEventListener('focus', () => { if (minChars === 0 || input.value.trim()) run(); });
  input.addEventListener('keydown', e => {
    if (box.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && active >= 0) { pick(items[active]); e.preventDefault(); }
    if (e.key === 'Escape') box.hidden = true;
  });
  const pick = it => { input.value = it.label; box.hidden = true; onPick(it); };
  box.addEventListener('mousedown', e => e.preventDefault());
  box.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(items[+b.dataset.i]); });
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  return { run };
}
