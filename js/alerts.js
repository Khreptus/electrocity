// Вкладка «Тривоги» — карта й функції з нашого віджета «Тривоги» (ua-alert-widget):
//  • підложка OpenFreeMap (стиль dark, векторні тайли, MapLibre) — вулиці й підписи українською;
//  • райони поверх: червоний — тривога, жовтий — загроза (рахується як тривога), при наближенні стають прозорими;
//  • повітряні цілі з силуетами за типом, курсом і кількістю; рух у реальному часі між оновленнями;
//  • при наближенні — конус курсу на 10 хв із мітками хвилин; лінія й час підльоту до мого міста;
//  • торкання цілі — картка: модель, швидкість, курс, поворот, висота, відстань і підліт до вас, джерела.
// Дані: /api/alerts (тривоги — ukrainealarm; цілі — dimap + уточнення ukrainealarm і neptun), /api/targets (лише цілі, частіше).
import { API } from './config.js';
import { ic } from './icons.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
export const hms = ms => { const t = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t % 3600 / 60))}:${pad(t % 60)}`; };
const hhmm = ms => new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };

// ---------- Геометрія Землі ----------
const R = 6371, rad = Math.PI / 180;
export const dist = (la1, lo1, la2, lo2) => { const a = (la2 - la1) * rad, b = (lo2 - lo1) * rad; const h = Math.sin(a / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(b / 2) ** 2; return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); };
const brg = (la1, lo1, la2, lo2) => { const f1 = la1 * rad, f2 = la2 * rad, dl = (lo2 - lo1) * rad; return (Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) / rad + 360) % 360; };
const sang = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
function dest(p, km, b) { const d = km / R, t = b * rad, f1 = p.lat * rad, l1 = p.lon * rad;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return { lat: f2 / rad, lon: l2 / rad }; }

// ---------- Цілі: класи, швидкості, конус курсу (як у віджеті й dimap) ----------
const KIND = { shahed: 'Шахед', jetShahed: 'Реактивний шахед', geran5: 'Герань-5', cruise: 'Крилата ракета', ballistic: 'Балістика', kab: 'КАБ', aircraft: 'Авіація', helicopter: 'Гелікоптер', recon: 'Розвідувальний БпЛА', fpv: 'FPV', unknown: 'Ціль' };
const SPEED = { shahed: 185, unknown: 185, jetShahed: 550, geran5: 600, cruise: 800, ballistic: 3000, kab: 400, aircraft: 800, helicopter: 220, recon: 120, fpv: 90 };
const KCOL = { shahed: '#F5F5F7', jetShahed: '#48CEFF', geran5: '#FF6A3D', cruise: '#FFD60A', ballistic: '#FF453A', kab: '#BF5AF2', aircraft: '#5EE6A8', helicopter: '#5EE6A8', recon: '#B4B4BC', fpv: '#30D158', unknown: '#E5E5EA' };
const coneCol = v => v < 250 ? '#FFD60A' : v < 600 ? '#FF9F0A' : '#FF453A';
const speedOf = t => (t.s || 0) > 0 ? t.s : SPEED[t.k] || 185;
const label = t => (t.m || KIND[t.k] || 'Ціль') + (t.c > 1 ? ` ×${t.c}` : '');
const heading = (t, m, hz) => { const mm = Math.min(m, hz); return (t.b || 0) + Math.max(-60, Math.min(60, (t.tr || 0) * mm * (1 - mm / (2 * hz)))); };
function cone(t, minutes = 10, width = 16) {
  if (t.b == null) return null; const n = 24, dt = minutes / n, v = speedOf(t);
  let l = { lat: t.la, lon: t.lo }, r = l, c = l; const L = [], Rr = [], C = [];
  for (let k = 1; k <= n; k++) { const tt = (k - 0.5) * dt, h = heading(t, tt, minutes), half = 6 + (width - 6) * Math.min(1, tt / minutes), step = v * dt / 60;
    l = dest(l, step, h - half); r = dest(r, step, h + half); c = dest(c, step, h); L.push(l); Rr.push(r); C.push(c); }
  return { L, R: Rr, C, minutes };
}
export function eta(t, lat, lon, radiusKm = 12, maxMin = 90) {
  const d0 = dist(t.la, t.lo, lat, lon); if (d0 <= radiusKm) return 0; if (t.b == null) return null;
  const v = speedOf(t); if (d0 / v * 60 > maxMin) return null;
  let c = { lat: t.la, lon: t.lo }, m = 0, best = d0;
  while (m < maxMin) { m += 0.25; c = dest(c, v * 0.25 / 60, heading(t, m, 10)); const d = dist(c.lat, c.lon, lat, lon); if (d <= radiusKm) return m; if (d > best + 30) return null; best = Math.min(best, d); }
  return null;
}
const fmtEta = m => m < 1 ? '<1 хв' : (m = Math.round(m)) < 60 ? `${m} хв` : `${Math.floor(m / 60)} год ${m % 60} хв`;

// Рух між оновленнями (TargetTracker + advanced у віджеті): ціль летить своїм курсом, стрибок до нової позиції згладжується
const track = { last: {}, shown: {} };
function trackUpdate(list) {
  const now = Date.now(), next = {}, out = [];
  for (const src of list || []) { const t = { ...src };
    const f = track.last[t.id];
    if (f) { const dtm = (now - f.time) / 60000, moved = dist(f.lat, f.lon, t.la, t.lo);
      if (t.b == null && moved > 1.5) t.b = brg(f.lat, f.lon, t.la, t.lo); // курс із фактичного руху
      if (t.b == null && f.b != null) t.b = f.b; // курс невідомий — лишаємо останній відомий
      let turn = f.turn; if (f.b != null && t.b != null && dtm > 0.05) turn = f.turn * 0.3 + Math.max(-20, Math.min(20, sang(f.b, t.b) / dtm)) * 0.7;
      if (!t.tk) t.tr = turn;
      next[t.id] = moved < 0.15 && dtm < 1 ? { ...f, turn } : { lat: t.la, lon: t.lo, b: t.b, time: now, turn };
    } else next[t.id] = { lat: t.la, lon: t.lo, b: t.b, time: now, turn: t.tr || 0 };
    const prev = track.shown[t.id];
    if (prev && Math.abs(prev.la - t.la) < 1e-6 && Math.abs(prev.lo - t.lo) < 1e-6 && prev.b === t.b) { t.fix = prev.fix; t.cla = prev.cla; t.clo = prev.clo; t.tr = prev.tr; }
    else { if (prev) { const was = advanced(prev, now); if (dist(was.la, was.lo, t.la, t.lo) < 15) { t.cla = was.la - t.la; t.clo = was.lo - t.lo; } } t.fix = now; }
    track.shown[t.id] = t; out.push(t); }
  for (const k of Object.keys(track.shown)) if (!next[k]) delete track.shown[k];
  track.last = next; return out;
}
function advanced(t, now = Date.now()) {
  if (t.b == null) return t; const secs = Math.max(0, (now - (t.fix || t.ts)) / 1000), m = Math.min(2, secs / 60);
  const o = { ...t }; let p = { lat: t.la, lon: t.lo };
  if (m > 0.002) { let done = 0; while (done < m) { const dt = Math.min(0.1, m - done); p = dest(p, speedOf(t) * dt / 60, heading(t, done + dt / 2, 10)); done += dt; }
    o.b = heading(t, m, 10); o.tr = (t.tr || 0) * Math.max(0, 1 - m / 10); }
  const k = Math.max(0, 1 - secs / 1.5); o.la = p.lat + (t.cla || 0) * k; o.lo = p.lon + (t.clo || 0) * k; return o;
}

// ---------- Громади: моє місто ----------
let HROM = null;
export async function loadHromady() {
  if (HROM) return HROM;
  HROM = (await (await fetch('assets/ua-hromady.json')).json()).map(([name, raion, oblast, lat, lon]) => ({ name, raion, oblast, lat, lon }));
  return HROM;
}
const SUFFIX = [' міська територіальна громада', ' селищна територіальна громада', ' сільська територіальна громада', ' міська громада', ' селищна громада', ' сільська громада', ' територіальна громада'];
export const displayName = n => { for (const s of SUFFIX) if (n.endsWith(s)) return n.slice(0, -s.length) + ' громада'; return n; };
const isKyiv = h => h.raion === 'Київ' || h.name === 'Київ';
export const cityKey = h => isKyiv(h) ? 'м. Київ' : 'м. ' + displayName(h.name).replace(' громада', '');
export function cityFromHromada(h, lbl) { return { label: lbl || (isKyiv(h) ? 'Київ' : displayName(h.name)), name: h.name, raion: h.raion, oblast: h.oblast, lat: h.lat, lon: h.lon }; }
export async function guessCity(city, oblastName) {
  const hs = await loadHromady();
  const c = String(city || '').toLowerCase().replace(/^(м\.|місто|смт|с\.)\s*/, '').trim();
  if (c === 'київ' || oblastName === 'м. Київ') return cityFromHromada(hs.find(isKyiv), 'Київ');
  if (c.length >= 3) {
    const stem = c.replace(/[’']/g, '').slice(0, Math.max(3, Math.min(c.length - 2, 7)));
    const obl = oblastName ? oblastName + ' область' : null;
    const cand = hs.filter(h => h.name.toLowerCase().replace(/[’']/g, '').startsWith(stem) && (!obl || h.oblast === obl));
    const best = cand.find(h => / міська /.test(h.name)) || cand[0];
    if (best) return cityFromHromada(best, city);
  }
  return cityFromHromada(hs.find(isKyiv), 'Київ');
}
const POPULAR = ['Київ', 'Харківська міська громада', 'Одеська міська громада', 'Дніпровська міська громада', 'Львівська міська громада', 'Запорізька міська громада', 'Ірпінська міська громада', 'Бучанська міська громада', 'Вінницька міська громада', 'Полтавська міська громада', 'Хмельницька міська громада', 'Миколаївська міська громада', 'Житомирська міська громада', 'Черкаська міська громада', 'Сумська міська громада', 'Чернігівська міська громада'];
export async function searchCity(q) {
  const hs = await loadHromady(); const s = q.trim().toLowerCase();
  if (!s) return POPULAR.map(n => hs.find(h => h.name === n)).filter(Boolean);
  const starts = [], cont = [];
  for (const h of hs) { const n = h.name.toLowerCase(); if (n.startsWith(s)) starts.push(h); else if (n.includes(s) || h.raion.toLowerCase().includes(s)) cont.push(h); if (starts.length >= 30) break; }
  return [...starts, ...cont].slice(0, 30);
}

// ---------- Дані ----------
let SNAP = null, snapAt = 0, inflight = null, TG = [], tgAt = 0;
export const lastSnap = () => SNAP;
export async function fetchAlerts(force) {
  if (!force && SNAP && Date.now() - snapAt < 15000) return SNAP;
  if (inflight) return inflight;
  inflight = (async () => { try { const r = await fetch(`${API}api/alerts`, { cache: 'no-store' }); if (r.ok) { const j = await r.json(); const dmOk = j.sources?.find(x => x.n === 'dimap')?.ok; if (!dmOk && SNAP && Date.now() - tgAt < 30000) j.targets = SNAP.targets; SNAP = j; snapAt = Date.now(); TG = trackUpdate(SNAP.targets); applySnap(); } } catch {} finally { inflight = null; } return SNAP; })();
  return inflight;
}
export async function fetchTargets() { // частіше, лише цілі
  try { const r = await fetch(`${API}api/targets`, { cache: 'no-store' }); if (!r.ok) return; const j = await r.json(); if (j.ok && j.targets && SNAP) { SNAP.targets = j.targets; tgAt = Date.now(); TG = trackUpdate(j.targets); } } catch {}
}
const mergeSt = (a, b) => { if (!a) return b; if (!b) return a; if (b[0] !== a[0]) return b[0] > a[0] ? b : a; const s = [a[1], b[1]].filter(Boolean); return [a[0], s.length ? Math.min(...s) : 0]; };
export function cityStatus(s, c) {
  const st = mergeSt(s.cities?.[cityKey(c)], mergeSt(s.raions?.[c.raion], s.oblasts?.[c.oblast]));
  let high = false, nearest = null, e = null, ek = null;
  for (const t of s.targets || []) {
    const d = dist(t.la, t.lo, c.lat, c.lon);
    if (!nearest || d < nearest.d) nearest = { d, k: t.k };
    if (d <= 35) high = true;
    const x = eta(t, c.lat, c.lon); if (x != null && (e == null || x < e)) { e = x; ek = t.k; }
  }
  return { on: !!st && st[0] >= 2, since: st?.[1] || 0, high, nearest, eta: e, etaKind: ek, attack: attackKind(s, c) };
}
function attackKind(s, c) { // як у віджеті: що за атака зараз
  const near = {}, all = {};
  for (const t of s.targets || []) { all[t.k] = (all[t.k] || 0) + (t.c || 1); if (dist(t.la, t.lo, c.lat, c.lon) < 400) near[t.k] = (near[t.k] || 0) + (t.c || 1); }
  const g = (o, ...k) => k.reduce((a, x) => a + (o[x] || 0), 0);
  const drones = g(all, 'shahed', 'jetShahed', 'geran5'), missiles = g(all, 'cruise', 'ballistic'), massive = drones >= 25 || missiles >= 5;
  if (near.ballistic) return massive ? 'Балістика · масована атака' : 'Балістика';
  if (massive) { const p = [drones ? 'дрони' : null, missiles ? 'ракети' : null].filter(Boolean); return 'Масована атака' + (p.length ? ' · ' + p.join(' + ') : ''); }
  const nd = g(near, 'shahed', 'jetShahed', 'geran5');
  if (near.cruise) return nd ? 'Ракети + дрони' : 'Крилаті ракети';
  if (near.kab) return 'КАБи'; if (nd) return nd === 1 ? 'Дрон поруч' : `Дрони · ${nd}`;
  if (g(near, 'aircraft', 'helicopter')) return 'Авіація';
  return null;
}

// ---------- Карта (MapLibre + OpenFreeMap) ----------
const UA_BOUNDS = [[22.1, 44.35], [40.25, 52.4]];
// кольори: тривога #E5484D (Figma); загроза — приглушений жовтий, щоб на ній було видно цілі
const COL = { alert: '#E5484D', threat: '#A8772E', idle: '#2C2C2F', border: '#141416', oblast: '#0B0B0D' };
const EMPTY = { type: 'FeatureCollection', features: [] };
let M = null, mapEl = null, ready = false, GEOJ = null, S0 = null, selected = null, loading = null, clickedTarget = false, homeZoom = 5;
function loadLib() {
  if (window.maplibregl) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((ok, no) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/vendor/maplibre-gl.css'; document.head.append(l);
    const s = document.createElement('script'); s.src = 'assets/vendor/maplibre-gl.js'; s.onload = ok; s.onerror = no; document.head.append(s); });
  return loading;
}
// Силуети цілей — ті самі контури, що у віджеті (TargetGlyph.path), носом угору
const SHAPES = {
  // «Шахед-136» / «Герань-2» зверху: тупий ніс, обрізане дельта-крило, кілі на кінцях крил, гвинт позаду
  shahed: [[0, -1], [0.06, -0.96], [0.1, -0.86], [0.1, -0.52], [0.74, 0.5], [0.75, 0.44], [0.82, 0.46], [0.82, 0.86], [0.74, 0.86], [0.72, 0.8], [0.12, 0.72], [0.1, 0.84], [0.22, 0.84], [0.22, 0.9], [0, 0.9]],
  // «Герань-3» (реактивний): гострий ніс, тонше дельта-крило з кілями, двигун-гондола зверху на хвості й сопло
  jetShahed: [[0, -1], [0.04, -0.93], [0.08, -0.8], [0.09, -0.5], [0.72, 0.5], [0.73, 0.44], [0.8, 0.46], [0.8, 0.84], [0.72, 0.84], [0.7, 0.78], [0.17, 0.7], [0.17, 0.86], [0.13, 0.9], [0, 0.9]],
  geran5: [[0, -1], [0.1, -0.78], [0.14, -0.4], [0.14, -0.2], [0.82, 0.34], [0.82, 0.46], [0.14, 0.24], [0.14, 0.66], [0.5, 0.98], [0.48, 1.04], [0.1, 0.9], [0, 0.9]],
  cruise: [[0, -1], [0.08, -0.86], [0.11, -0.62], [0.11, -0.06], [0.7, 0.08], [0.7, 0.2], [0.11, 0.14], [0.11, 0.72], [0.36, 0.98], [0.11, 0.94], [0.08, 1], [0, 1]],
  ballistic: [[0, -1], [0.12, -0.72], [0.2, -0.36], [0.2, 0.56], [0.52, 0.98], [0.52, 1.04], [0.18, 0.96], [0, 0.96]],
  kab: [[0, -0.92], [0.16, -0.82], [0.24, -0.56], [0.24, -0.12], [0.96, 0.02], [0.96, 0.14], [0.24, 0.12], [0.22, 0.62], [0.46, 0.96], [0.14, 0.86], [0, 0.86]],
  aircraft: [[0, -1], [0.12, -0.7], [0.14, -0.24], [1, 0.18], [1, 0.36], [0.14, 0.24], [0.12, 0.66], [0.42, 0.92], [0.42, 1], [0.08, 0.94], [0, 0.94]],
};
const symPts = pts => [...pts, ...[...pts].reverse().filter(q => q[0] !== 0).map(q => [-q[0], q[1]])];
function glyph(k, s) {
  const h = s / 2, p = new Path2D(), rr = (x, y, w, hh) => p.rect(x * h, y * h, w * h, hh * h);
  if (SHAPES[k]) { const pts = symPts(SHAPES[k]); p.moveTo(pts[0][0] * h, pts[0][1] * h); for (const q of pts.slice(1)) p.lineTo(q[0] * h, q[1] * h); p.closePath(); }
  else if (k === 'helicopter') { p.ellipse(0, -0.15 * h, 0.3 * h, 0.45 * h, 0, 0, 7); rr(-0.07, 0.2, 0.14, 0.75); rr(-0.3, 0.84, 0.6, 0.12);
    for (const a of [45, -45]) { const q = new Path2D(); q.rect(-h, -0.06 * h, 2 * h, 0.12 * h); p.addPath(q, new DOMMatrix().translate(0, 0.15 * h).rotate(a)); } }
  else if (k === 'recon') { rr(-0.1, -0.82, 0.2, 1.62); rr(-1, -0.34, 2, 0.22); rr(-0.42, 0.62, 0.84, 0.16); }
  else p.arc(0, 0, 0.55 * h, 0, 7);
  return p;
}
function glyphImage(k) {
  const px = 2, s = 30, W = 48, c = document.createElement('canvas'); c.width = c.height = W * px; const x = c.getContext('2d'); x.scale(px, px); x.translate(W / 2, W / 2);
  const col = KCOL[k] || KCOL.unknown, g = s * 0.78, gr = x.createRadialGradient(0, 0, 0, 0, 0, g); gr.addColorStop(0, col + '73'); gr.addColorStop(1, col + '00');
  x.fillStyle = gr; x.beginPath(); x.arc(0, 0, g, 0, 7); x.fill();
  const p = glyph(k, s); x.lineJoin = 'round'; x.lineWidth = Math.max(1.4, s * 0.12); x.strokeStyle = 'rgba(0,0,0,.9)'; x.stroke(p); x.fillStyle = col; x.fill(p);
  if (k === 'shahed' || k === 'jetShahed') { // об'єм: фюзеляж і лінія крила трохи темніші
    const h = s / 2; x.save(); x.clip(p); x.fillStyle = 'rgba(0,0,0,.16)';
    x.fillRect(-0.045 * h, -0.8 * h, 0.09 * h, 1.6 * h);
    x.restore(); }
  if (k === 'unknown') { x.fillStyle = '#000'; x.font = `800 ${s * 0.6}px system-ui`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', 0, 1); }
  if (['jetShahed', 'geran5', 'cruise', 'ballistic'].includes(k)) { const fy = (k === 'geran5' ? 0.9 : k === 'ballistic' ? 0.98 : k === 'jetShahed' ? 0.9 : 1) * s / 2; const fg = x.createLinearGradient(0, fy, 0, fy + s * 0.26); fg.addColorStop(0, '#FFE27A'); fg.addColorStop(1, 'rgba(255,106,0,0)'); x.fillStyle = fg; x.beginPath(); x.ellipse(0, fy + s * 0.13, s * 0.07, s * 0.13, 0, 0, 7); x.fill(); }
  return { width: c.width, height: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
}
const svgGlyph = k => { const pts = symPts(SHAPES[k] || SHAPES.shahed), h = 10; return 'M' + pts.map(q => `${(q[0] * h).toFixed(1)} ${(q[1] * h).toFixed(1)}`).join('L') + 'Z'; };
const COMPASS = ['Пн', 'ПнСх', 'Сх', 'ПдСх', 'Пд', 'ПдЗх', 'Зх', 'ПнЗх'];
const compass = b => COMPASS[Math.round(((b % 360) + 360) % 360 / 45) % 8];

function layers() {
  // пороги від початкового масштабу (як у віджеті: ×1.4–×3 — проступають вулиці, ×2.5–×4 — конуси курсу)
  const H = homeZoom, Z1 = H + 0.5, Z2 = H + 1.6, C1 = H + 1.3, C2 = H + 2;
  const m = M; const firstSym = m.getStyle().layers.find(l => l.type === 'symbol')?.id;
  // підписи підложки — українською і лише при наближенні (на загальному плані карта чиста, як у віджеті)
  const fadeIn = ['interpolate', ['linear'], ['zoom'], Z1, 0, Z2, 1];
  for (const l of m.getStyle().layers) if (l.type === 'symbol') {
    if (l.layout && l.layout['text-field'] !== undefined) m.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:uk'], ['get', 'name'], ['get', 'name_en']]);
    try { m.setPaintProperty(l.id, 'text-opacity', fadeIn); m.setPaintProperty(l.id, 'icon-opacity', fadeIn); } catch {}
  }
  m.addSource('ua', { type: 'geojson', data: GEOJ });
  const lv = ['coalesce', ['feature-state', 'lv'], 0];
  const fillCol = ['match', lv, 3, COL.alert, 2, COL.threat, COL.idle];
  // Наближення: райони стають прозорими, крізь них видно вулиці (як у віджеті)
  const fillOp = ['interpolate', ['linear'], ['zoom'], Z1, 1, Z2, ['case', ['>', lv, 0], 0.42, 0]];
  m.addLayer({ id: 'ua-fill', type: 'fill', source: 'ua', filter: ['==', ['get', 't'], 'r'], paint: { 'fill-color': fillCol, 'fill-opacity': fillOp } }, firstSym);
  m.addLayer({ id: 'ua-fill-o', type: 'fill', source: 'ua', filter: ['==', ['get', 't'], 'o'], layout: { visibility: 'none' }, paint: { 'fill-color': fillCol, 'fill-opacity': fillOp } }, firstSym);
  m.addLayer({ id: 'ua-city', type: 'fill', source: 'ua', filter: ['==', ['get', 't'], 'c'], paint: { 'fill-color': fillCol, 'fill-opacity': fillOp } }, firstSym);
  m.addLayer({ id: 'ua-line', type: 'line', source: 'ua', filter: ['in', ['get', 't'], ['literal', ['r', 'c']]], paint: { 'line-color': COL.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 1.4], 'line-opacity': ['interpolate', ['linear'], ['zoom'], Z1, 1, Z2, 0.4] } }, firstSym);
  // Усе поза Україною ховаємо під колір фону застосунку
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--stage-bg').trim() || '#1B1B1B';
  m.addLayer({ id: 'ua-mask', type: 'fill', source: 'ua', filter: ['==', ['get', 't'], 'mask'], paint: { 'fill-color': bg, 'fill-opacity': 1 } });
  m.addLayer({ id: 'ua-obl', type: 'line', source: 'ua', filter: ['==', ['get', 't'], 'o'], paint: { 'line-color': COL.oblast, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.1, 9, 2.6], 'line-opacity': ['interpolate', ['linear'], ['zoom'], Z1, 1, Z2, 0.65] } });
  m.addSource('kyiv', { type: 'geojson', data: { type: 'Feature', properties: { col: COL.idle }, geometry: { type: 'Point', coordinates: [30.52, 50.45] } } });
  m.addLayer({ id: 'kyiv', type: 'circle', source: 'kyiv', maxzoom: Z2, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, 3, 7, 6], 'circle-color': ['get', 'col'], 'circle-stroke-color': COL.oblast, 'circle-stroke-width': 1 } });
  // Конуси курсу й час підльоту: з'являються при наближенні; у вибраної цілі — завжди
  const coneOp = base => ['interpolate', ['linear'], ['zoom'], C1, ['case', ['==', ['get', 'sel'], 1], base, 0], C2, base];
  m.addSource('cone', { type: 'geojson', data: EMPTY });
  m.addLayer({ id: 'cone-fill', type: 'fill', source: 'cone', filter: ['==', ['get', 'p'], 'poly'], paint: { 'fill-color': ['get', 'col'], 'fill-opacity': coneOp(0.18) } });
  m.addLayer({ id: 'cone-edge', type: 'line', source: 'cone', filter: ['==', ['get', 'p'], 'edge'], paint: { 'line-color': ['get', 'col'], 'line-width': 1, 'line-dasharray': [4, 3], 'line-opacity': coneOp(0.8) } });
  m.addLayer({ id: 'cone-line', type: 'line', source: 'cone', filter: ['==', ['get', 'p'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'col'], 'line-width': 1.8, 'line-opacity': coneOp(1) } });
  m.addLayer({ id: 'eta-line', type: 'line', source: 'cone', filter: ['==', ['get', 'p'], 'eta'], paint: { 'line-color': '#FFFFFF', 'line-width': 1, 'line-dasharray': [5, 4], 'line-opacity': coneOp(0.45) } });
  m.addLayer({ id: 'cone-mark', type: 'circle', source: 'cone', filter: ['==', ['get', 'p'], 'mark'], paint: { 'circle-radius': 3.2, 'circle-color': ['get', 'col'], 'circle-stroke-color': '#000', 'circle-stroke-width': 1, 'circle-opacity': coneOp(1), 'circle-stroke-opacity': coneOp(0.8) } });
  m.addLayer({ id: 'cone-txt', type: 'symbol', source: 'cone', filter: ['in', ['get', 'p'], ['literal', ['mark', 'etatxt']]], layout: { 'text-field': ['get', 'txt'], 'text-font': ['Noto Sans Bold'], 'text-size': ['case', ['==', ['get', 'p'], 'mark'], 11, 10], 'text-offset': ['case', ['==', ['get', 'p'], 'mark'], ['literal', [1.6, -0.9]], ['literal', [0, 1.4]]], 'text-allow-overlap': true },
    paint: { 'text-color': ['case', ['==', ['get', 'p'], 'mark'], ['get', 'col'], '#FFFFFF'], 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.6, 'text-opacity': coneOp(1) } });
  // Цілі
  for (const k of Object.keys(KIND)) m.addImage('tg-' + k, glyphImage(k), { pixelRatio: 2 });
  m.addSource('tg', { type: 'geojson', data: EMPTY });
  m.addLayer({ id: 'tg-ic', type: 'symbol', source: 'tg', layout: { 'icon-image': ['concat', 'tg-', ['get', 'k']], 'icon-rotate': ['get', 'b'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 4.5, 0.62, 7, 0.85, 10, 1.15] } });
  m.addLayer({ id: 'tg-cnt', type: 'symbol', source: 'tg', filter: ['>', ['get', 'c'], 1], layout: { 'text-field': ['to-string', ['get', 'c']], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'text-offset': [0.9, -0.9], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 2.2 } });
  m.addLayer({ id: 'tg-lab', type: 'symbol', source: 'tg', minzoom: C1, layout: { 'text-field': ['get', 'lab'], 'text-font': ['Noto Sans Bold'], 'text-size': 9.5, 'text-offset': [0, 1.5] }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,.8)', 'text-halo-width': 1.6 } });
  m.addLayer({ id: 'tg-sel', type: 'circle', source: 'tg', filter: ['==', ['get', 'sel'], 1], paint: { 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
  // Моє місто
  m.addSource('pin', { type: 'geojson', data: EMPTY });
  m.addLayer({ id: 'pin-halo', type: 'circle', source: 'pin', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, 9, 9, 16], 'circle-color': ['get', 'col'], 'circle-opacity': 0.28 } });
  m.addLayer({ id: 'pin', type: 'circle', source: 'pin', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, 3.5, 9, 6], 'circle-color': '#fff', 'circle-stroke-color': ['get', 'col'], 'circle-stroke-width': 2.5 } });
  m.on('click', 'tg-ic', e => { const id = e.features?.[0]?.properties?.id; if (id) { selected = selected === id ? null : id; clickedTarget = true; frame(); } });
  m.on('click', e => { if (picking) { pickAt(e.lngLat); return; } if (clickedTarget) { clickedTarget = false; return; } if (selected) { selected = null; frame(); } });
  m.on('mouseenter', 'tg-ic', () => { m.getCanvas().style.cursor = 'pointer'; }); m.on('mouseleave', 'tg-ic', () => { m.getCanvas().style.cursor = ''; });
  m.on('moveend', resetBtn); m.on('zoom', zoomHint);
  m.on('movestart', e => { if (e.originalEvent) userMoved = true; });
  // наближення пальцями ховає панель; повернення до загального плану — відкриває
  m.on('zoom', e => { if (!e.originalEvent) return; const z = m.getZoom();
    if (!drawerCollapsed && z > homeZoom + 0.25) { autoCollapsed = true; setDrawer(true); }
    else if (drawerCollapsed && autoCollapsed && z <= homeZoom + 0.05) { autoCollapsed = false; setDrawer(false); } });
  ready = true; applySnap(); frame(); zoomHint();
}
function resetBtn() { const b = mapEl?.querySelector('.mreset'); if (b && M) b.hidden = M.getZoom() < homeZoom + 0.35; }
function zoomHint() { const h = mapEl?.querySelector('.mhint'); if (h && M) h.hidden = M.getZoom() >= homeZoom + 1.3 || !TG.length; }

// Стан районів → feature-state (без перезавантаження геометрії)
function applySnap() {
  if (!ready || !SNAP || !S0) return; const o = S0.alerts, threat = o.threat !== false;
  const shown = lv => (lv === 2 && !threat ? 0 : lv);
  const obl = {};
  for (const f of GEOJ.features) {
    const p = f.properties; let lv = 0;
    if (p.t === 'r') { lv = mergeSt(SNAP.raions?.[p.n], SNAP.oblasts?.[p.o])?.[0] || 0; obl[p.o] = Math.max(obl[p.o] || 0, lv); }
    else if (p.t === 'c') lv = SNAP.cities?.[p.n]?.[0] || 0;
    if (p.t === 'r' || p.t === 'c') M.setFeatureState({ source: 'ua', id: f.id }, { lv: shown(lv) });
  }
  for (const f of GEOJ.features) if (f.properties.t === 'o') M.setFeatureState({ source: 'ua', id: f.id }, { lv: shown(Math.max(obl[f.properties.n] || 0, SNAP.oblasts?.[f.properties.n]?.[0] || 0)) });
  const kv = shown(SNAP.cities?.['м. Київ']?.[0] || 0);
  M.getSource('kyiv').setData({ type: 'Feature', properties: { col: kv === 3 ? COL.alert : kv === 2 ? COL.threat : COL.idle }, geometry: { type: 'Point', coordinates: [30.52, 50.45] } });
  const ob = o.mode === 'oblasts';
  M.setLayoutProperty('ua-fill', 'visibility', ob ? 'none' : 'visible'); M.setLayoutProperty('ua-fill-o', 'visibility', ob ? 'visible' : 'none');
  M.setFilter('ua-line', ob ? ['==', ['get', 't'], 'c'] : ['in', ['get', 't'], ['literal', ['r', 'c']]]);
  for (const id of ['tg-ic', 'tg-cnt', 'tg-lab', 'tg-sel', 'cone-fill', 'cone-edge', 'cone-line', 'cone-mark', 'cone-txt', 'eta-line']) M.setLayoutProperty(id, 'visibility', o.targets === false ? 'none' : 'visible');
}

// Щосекундний кадр: цілі рухаються, конуси згинаються, підліт перераховується
function frame() {
  if (!ready || !S0) return; const now = Date.now(), city = S0.alerts.city, z = M.getZoom();
  const cs = city && SNAP ? cityStatus(SNAP, city) : null;
  M.getSource('pin').setData(city ? { type: 'Feature', properties: { col: cs?.on ? '#FF453A' : '#0A84FF' }, geometry: { type: 'Point', coordinates: [city.lon, city.lat] } } : EMPTY);
  if (S0.alerts.targets === false) { infoCard(null); return; }
  const ts = TG.map(t => advanced(t, now));
  M.getSource('tg').setData({ type: 'FeatureCollection', features: ts.map(t => ({ type: 'Feature', properties: { id: t.id, k: KIND[t.k] ? t.k : 'unknown', b: t.k === 'fpv' || t.k === 'unknown' ? 0 : Math.round(t.b || 0), c: t.c || 1, lab: t.m || KIND[t.k] || 'Ціль', sel: t.id === selected ? 1 : 0 }, geometry: { type: 'Point', coordinates: [t.lo, t.la] } })) });
  const feats = [];
  for (const t of ts) {
    if (t.b == null || (z < homeZoom + 1.2 && t.id !== selected)) continue;
    const v = speedOf(t), minutes = v > 1500 ? Math.min(10, 250 / v * 60) : 10, c = cone(t, minutes); if (!c) continue;
    const col = coneCol(v), sel = t.id === selected ? 1 : 0, start = [t.lo, t.la], P = q => [q.lon, q.lat];
    const tip = c.C.at(-1), le = c.L.at(-1), re = c.R.at(-1);
    const ctrl = { lat: 2 * tip.lat - (le.lat + re.lat) / 2, lon: 2 * tip.lon - (le.lon + re.lon) / 2 };
    const arc = []; for (let i = 1; i < 8; i++) { const u = i / 8; arc.push([(1 - u) ** 2 * le.lon + 2 * (1 - u) * u * ctrl.lon + u * u * re.lon, (1 - u) ** 2 * le.lat + 2 * (1 - u) * u * ctrl.lat + u * u * re.lat]); }
    const ring = [start, ...c.L.map(P), ...arc, ...[...c.R].reverse().map(P), start];
    feats.push({ type: 'Feature', properties: { p: 'poly', col, sel }, geometry: { type: 'Polygon', coordinates: [ring] } });
    feats.push({ type: 'Feature', properties: { p: 'edge', col, sel }, geometry: { type: 'LineString', coordinates: ring } });
    feats.push({ type: 'Feature', properties: { p: 'line', col, sel }, geometry: { type: 'LineString', coordinates: [start, ...c.C.map(P)] } });
    // мітки хвилин: щохвилини, або кожні 2 / 5 хв — щоб не злипались
    const pts = [{ lat: t.la, lon: t.lo }, ...c.C], dt = minutes / c.C.length;
    const at = m => { const f = Math.max(0, Math.min(pts.length - 1, m / dt)), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i; return { lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * u, lon: pts[i].lon + (pts[i + 1].lon - pts[i].lon) * u }; };
    const whole = Math.floor(minutes);
    if (whole >= 1) { const a = M.project(start), b = M.project(P(at(1))), gap = Math.hypot(b.x - a.x, b.y - a.y);
      const every = gap >= 22 ? 1 : gap * 2 >= 22 ? 2 : gap * 5 >= 22 ? 5 : 0;
      if (every) for (let m = every; m <= whole; m += every) feats.push({ type: 'Feature', properties: { p: 'mark', col, sel, txt: `${m} хв` }, geometry: { type: 'Point', coordinates: P(at(m)) } }); }
    if (city) { const e = eta(t, city.lat, city.lon); if (e != null && e > 0 && e <= 60) { const km = dist(t.la, t.lo, city.lat, city.lon).toFixed(1).replace('.', ',');
      feats.push({ type: 'Feature', properties: { p: 'eta', sel }, geometry: { type: 'LineString', coordinates: [start, [city.lon, city.lat]] } });
      feats.push({ type: 'Feature', properties: { p: 'etatxt', sel, txt: `${km} км · ≈${fmtEta(e)} (${hhmm(now + e * 60000)})` }, geometry: { type: 'Point', coordinates: P(tip) } }); } }
  }
  M.getSource('cone').setData({ type: 'FeatureCollection', features: feats });
  infoCard(ts.find(t => t.id === selected), city);
}
function infoCard(t, city) {
  const box = mapEl?.querySelector('.tcard'); if (!box) return;
  if (!t) { box.hidden = true; return; }
  const rows = [];
  if (t.c > 1) rows.push(['Кількість', t.c]);
  rows.push(['Швидкість', (t.s || 0) > 0 ? `${Math.round(t.s)} км/год` : `~${SPEED[t.k] || 185} км/год (типова)`]);
  if (t.b != null) rows.push(['Курс', `${Math.round(t.b)}° · ${compass(t.b)}`]);
  if (t.b != null && Math.abs(t.tr || 0) >= 0.5) rows.push(['Поворот', `${t.tr > 0 ? 'праворуч' : 'ліворуч'} ${Math.abs(t.tr).toFixed(0)}°/хв`]);
  if (t.alt > 0) rows.push(['Висота', t.alt >= 1000 ? `${(t.alt / 1000).toFixed(1)} км` : `${Math.round(t.alt)} м`]);
  if (city) { rows.push(['До вас', `${dist(t.la, t.lo, city.lat, city.lon).toFixed(1).replace('.', ',')} км`]); const e = eta(t, city.lat, city.lon); rows.push(['Підліт', e != null && e > 0 ? `≈${fmtEta(e)} (${hhmm(Date.now() + e * 60000)})` : 'не в бік вас']); }
  const ago = Math.max(0, Math.floor((Date.now() - t.ts) / 1000)); rows.push(['Оновлено', ago < 60 ? 'щойно' : `${Math.floor(ago / 60)} хв тому`]); rows.push(['Джерела', (t.src || []).join(', ')]);
  box.hidden = false;
  box.innerHTML = `<div class="th"><span class="ti" style="background:${KCOL[t.k] || KCOL.unknown}26"><svg viewBox="-12 -12 24 24" width="18" height="18"><path d="${svgGlyph(t.k)}" fill="${KCOL[t.k] || KCOL.unknown}" stroke="#000" stroke-width="1.6" transform="rotate(${Math.round(t.b || 0)})"/></svg></span><span class="tn"><b>${esc(t.m || KIND[t.k] || 'Ціль')}</b>${t.m ? `<small>${KIND[t.k]}</small>` : ''}</span><button class="tclose" data-tclose aria-label="Закрити">${ic('x')}</button></div>${rows.map(([a, b]) => `<div class="tr"><span>${a}</span><span>${esc(b)}</span></div>`).join('')}`;
  box.querySelector('[data-tclose]').onclick = e => { e.stopPropagation(); selected = null; frame(); };
}

// ---------- Точка на карті вручну (як LocationPicker у віджеті) ----------
let picking = null;
const inRingLL = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const inFeat = (f, x, y) => f.geometry.coordinates.some(poly => inRingLL(x, y, poly[0]));
// Найближчий населений пункт із самої підложки OpenFreeMap (шар place): справжня назва міста чи села
function nearestPlace(lat, lon) {
  try {
    const src = Object.entries(M.getStyle().sources).find(([, v]) => v.type === 'vector')?.[0]; if (!src) return null;
    let best = null;
    for (const f of M.querySourceFeatures(src, { sourceLayer: 'place' })) {
      const c = f.properties?.class; if (!['city', 'town', 'village', 'hamlet', 'suburb'].includes(c)) continue;
      const [x, y] = f.geometry.coordinates; const d = dist(lat, lon, y, x);
      const w = d / ({ city: 3, town: 2, village: 1, hamlet: 0.8, suburb: 0.8 }[c]); // місто «притягує» сильніше за село поруч
      if (!best || w < best.w) best = { w, d, name: f.properties['name:uk'] || f.properties.name, cls: c };
    }
    return best && best.d < 12 ? best : null;
  } catch { return null; }
}
export async function locatePoint(lat, lon) {
  const hs = await loadHromady();
  const kyiv = GEOJ?.features.find(f => f.properties.t === 'c' && f.properties.n === 'м. Київ');
  if (kyiv && inFeat(kyiv, lon, lat)) return { ...cityFromHromada(hs.find(isKyiv), 'Київ'), lat, lon, manual: true };
  const r = GEOJ?.features.find(f => f.properties.t === 'r' && inFeat(f, lon, lat));
  if (!r) return null; // поза Україною
  const pool = hs.filter(h => h.raion === r.properties.n); const cand = pool.length ? pool : hs;
  const place = nearestPlace(lat, lon);
  let h = null;
  if (place) { // громада за назвою населеного пункту: «Хмельницький» → «Хмельницька міська громада»
    const n = place.name.toLowerCase().replace(/[’']/g, ''), stem = n.slice(0, Math.max(3, Math.min(n.length - 2, 7)));
    const m = cand.filter(x => x.name.toLowerCase().replace(/[’']/g, '').startsWith(stem));
    h = m.find(x => / міська /.test(x.name)) || m[0] || null;
  }
  // інакше: міська громада, якщо її центр поруч (центри сільських громад навколо міста лежать ближче до околиць)
  if (!h) { const near = cand.filter(x => / міська /.test(x.name) && dist(x.lat, x.lon, lat, lon) < 20).sort((a, b) => dist(a.lat, a.lon, lat, lon) - dist(b.lat, b.lon, lat, lon)); h = near[0] || null; }
  if (!h) h = cand.reduce((a, b) => dist(a.lat, a.lon, lat, lon) < dist(b.lat, b.lon, lat, lon) ? a : b);
  return { ...cityFromHromada(h, place && place.d < 8 ? place.name : null), lat, lon, manual: true };
}
export function startPick(onDone) {
  picking = onDone; selected = null;
  const box = mapEl?.querySelector('.mpick'); if (box) box.hidden = false;
  if (M) M.getCanvas().style.cursor = 'crosshair';
}
function stopPick() { picking = null; const box = mapEl?.querySelector('.mpick'); if (box) box.hidden = true; if (M) M.getCanvas().style.cursor = ''; }
async function pickAt(ll) {
  // на загальному плані назви сіл і міст у підложці неповні — спершу наближаємось до точки
  if (M && M.getZoom() < 8.5) { const t = mapEl?.querySelector('.mpick .pt'); if (t) t.textContent = 'Уточнюємо місце…'; M.easeTo({ center: ll, zoom: 9, duration: 500 }); await new Promise(r => M.once('idle', r)); }
  const c = await locatePoint(ll.lat, ll.lng);
  const box = mapEl?.querySelector('.mpick .pt');
  if (!c) { if (box) box.textContent = 'Ця точка поза межами України — оберіть іншу'; return; }
  const done = picking; stopPick(); done?.(c);
}

// ---------- Висувна нижня панель (як у картографічних застосунках) ----------
// Карта займає весь екран до панелі вкладок; панель лежить поверх карти й плавно розкривається вгору.
// На старті панель відкрита, карта вписана над нею. Наближення карти ховає панель (карта стає більшою),
// повернення до всієї України — знову відкриває.
let drawerCollapsed = false, autoCollapsed = false, userMoved = false;
export const toggleDrawer = () => { autoCollapsed = false; setDrawer(!drawerCollapsed); };
export function setDrawer(collapsed) {
  drawerCollapsed = collapsed;
  const sh = document.querySelector('.asheet'); if (!sh) return;
  sh.classList.toggle('collapsed', collapsed);
  sh.querySelector('.ahandle')?.setAttribute('aria-expanded', String(!collapsed));
  if (!collapsed) sh.scrollTop = 0;
  // карту не рухали — вписуємо Україну в нову видиму частину
  if (ready && !userMoved) setTimeout(() => { if (!userMoved) fitHome(true); }, 120);
}
let drawerBound = new WeakSet();
function layoutDrawer() {
  const sh = document.querySelector('.asheet'), box = mapEl; if (!box) return;
  const tabs = document.querySelector('.tabs'); const tabsH = tabs && getComputedStyle(tabs).display !== 'none' ? tabs.offsetHeight : 0;
  document.documentElement.style.setProperty('--tabs-h', tabsH + 'px');
  const mobile = innerWidth < 1024;
  if (mobile) { const top = box.getBoundingClientRect().top + scrollY; box.style.height = Math.max(300, innerHeight - top - tabsH) + 'px'; }
  else box.style.height = '';
  // карта має знати новий розмір ДО вписування України у видиму частину над панеллю
  if (ready) { M.resize(); if (!userMoved) fitHome(); }
  if (!sh || drawerBound.has(sh)) return; drawerBound.add(sh);
  let y0 = null, t0 = 0;
  sh.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
  sh.addEventListener('touchend', e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null;
    const col = sh.classList.contains('collapsed');
    // свайп вгору розкриває; вниз — згортає (лише коли вміст прокручено до верху)
    if (dy < -35 && col) sh.querySelector('.ahandle')?.click();
    else if (dy > 35 && !col && sh.scrollTop <= 0 && Date.now() - t0 < 800) sh.querySelector('.ahandle')?.click(); }, { passive: true });
}
function peekH() { const sh = document.querySelector('.asheet'); if (!sh || innerWidth >= 1024) return 6; return Math.min(sh.offsetHeight + 8, innerHeight * 0.5); }
function fitHome(anim) { if (anim) userMoved = false; const H = M.getContainer().clientHeight, bottom = Math.min(drawerCollapsed ? 110 : peekH(), Math.max(0, H - 160));
  M.fitBounds(UA_BOUNDS, { padding: { top: 6, left: 6, right: 6, bottom }, duration: anim ? 500 : 0 }); if (!anim) homeZoom = M.getZoom(); }
addEventListener('resize', () => { if (mapEl?.isConnected) layoutDrawer(); });

// Карта живе поза перерендерами екрана: той самий елемент переставляється в новий слот
export async function mountMap(S) {
  S0 = S; const slot = document.getElementById('amap-slot'); if (!slot) return;
  if (!mapEl) {
    mapEl = document.createElement('div'); mapEl.className = 'amapbox';
    mapEl.innerHTML = `<div class="amapc"></div><div class="mhint" hidden>Наблизьте карту — з’являться курс і час підльоту цілей</div><button class="mreset" hidden aria-label="Уся Україна">${ic('locate')}</button><div class="tcard" hidden></div><div class="mpick" hidden><span class="pt">Торкніться карти, щоб поставити свою точку</span><button class="btn sm" data-pickcancel>Скасувати</button></div>`;
    mapEl.querySelector('[data-pickcancel]').onclick = e => { e.stopPropagation(); stopPick(); };
    slot.append(mapEl);
    try {
      await loadLib();
      if (!GEOJ) GEOJ = await (await fetch('assets/ua-map.json')).json();
      M = new maplibregl.Map({ container: mapEl.querySelector('.amapc'), style: 'https://tiles.openfreemap.org/styles/dark', bounds: UA_BOUNDS, fitBoundsOptions: { padding: 6 },
        minZoom: 3, maxZoom: 15, maxBounds: [[5, 30], [60, 65]], dragRotate: false, pitchWithRotate: false, touchPitch: false, renderWorldCopies: false, fadeDuration: 0,
        attributionControl: { compact: true, customAttribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>' } });
      M.touchZoomRotate.disableRotation(); M.scrollZoom.setWheelZoomRate(1 / 220); M.keyboard?.disableRotation?.();
      // розмір карти змінюється (плашка сховалась/розкрилась): якщо карту не наближали — знову вписати всю Україну
      new ResizeObserver(() => M.resize()).observe(mapEl);
      M.on('load', () => { M.resize(); fitHome(); try { layers(); } catch (e) { console.warn('map layers', e); } });
      M.on('error', e => console.warn('map', e?.error?.message || e));
      mapEl.querySelector('.mreset').onclick = () => { if (drawerCollapsed) { autoCollapsed = false; setDrawer(false); } setTimeout(() => fitHome(true), 60); };
    } catch { mapEl.querySelector('.amapc').innerHTML = '<div class="merr">Не вдалося завантажити карту. Перевірте з’єднання.</div>'; }
  } else { slot.append(mapEl); M?.resize(); }
  if (picking) { const box = mapEl.querySelector('.mpick'); if (box) box.hidden = false; }
  layoutDrawer();
  if (ready) { applySnap(); frame(); zoomHint(); }
}
export function mapSettingsChanged() { if (ready) { applySnap(); frame(); } }
setInterval(() => { if (ready && !document.hidden && mapEl?.isConnected) frame(); }, 1000);
export function selectTarget(id) { selected = id; const t = TG.find(x => x.id === id); if (t && M) M.easeTo({ center: [t.lo, t.la], zoom: Math.max(M.getZoom(), 8), duration: 600 }); frame(); document.querySelector('.astage')?.scrollIntoView({ behavior: 'smooth' }); }

// ---------- Екран ----------
export function alertsView(S) {
  const o = S.alerts, s = lastSnap(), city = o.city;
  const live = s && s.ok !== false && !s.stale;
  const head = meta => `<section class="astage"><div class="atop"><span class="h-l">Тривоги</span><span class="live ${live ? '' : 'off'}"><i></i>${live ? 'Наживо' : s ? 'Затримка' : 'Завантаження'}</span><button class="btn-ic" data-go="alert-settings" aria-label="Налаштування карти">${ic('more')}</button></div><div class="ameta">${meta}</div>`;
  const slot = `<div id="amap-slot" class="amapwrap"></div>`;
  if (!s) return head('Збираємо дані…') + slot + `</section><section class="sheet"><div class="card"><div class="skel" style="width:60%"></div><div class="skel" style="width:40%"></div></div></section>`;
  const cs = city ? cityStatus(s, city) : { on: false };
  let n = 0; const seen = new Set();
  for (const [k, v] of Object.entries(s.raions || {})) if (v[0] >= 2) { n++; seen.add(k); }
  if (GEOJ) for (const f of GEOJ.features) if (f.properties.t === 'r' && !seen.has(f.properties.n) && (s.oblasts?.[f.properties.o]?.[0] || 0) >= 2) n++;
  const nt = (s.targets || []).reduce((a, t) => a + (t.c || 1), 0);
  const meta = (n ? `${n} ${plural(n, 'район', 'райони', 'районів')} у тривозі` : 'Тривог немає') + ` · ${nt} ${plural(nt, 'ціль', 'цілі', 'цілей')}`;
  const stageHtml = head(meta) + slot + `</section>`; // джерела — у налаштуваннях карти

  let cityCard;
  if (!city) cityCard = `<button class="card acity" data-act="acity"><div class="arow"><span class="aic">${ic('map-pin')}</span><span class="tx"><span class="h-s">Оберіть своє місто</span><span class="cap3">Покажемо, чи є тривога саме у вас</span></span>${ic('chevron-right', 'chev')}</div></button>`;
  else {
    const pill = cs.on ? `<span class="apill on"><i></i>Тривога</span>` : `<span class="apill calm"><i></i>Спокійно</span>`;
    const timer = cs.on ? (cs.since ? `<div class="atimer"><div><div class="cap3">Триває</div><div class="big mono" data-asince="${cs.since}">${hms(Date.now() - cs.since)}</div></div><div style="text-align:right"><div class="cap3">Почалась о</div><div class="nx mono">${hhmm(cs.since)}</div></div></div>` : `<div class="body-s">Тривога триває</div>`)
      : `<div class="body-s">Тривоги немає${cs.nearest ? ` · найближча ціль ~${Math.round(cs.nearest.d)} км` : ''}</div>`;
    const info = [cs.attack, cs.eta != null && cs.eta > 0 ? `${KIND[cs.etaKind] || 'Ціль'} може долетіти за ≈${fmtEta(cs.eta)} (${hhmm(Date.now() + cs.eta * 60000)})` : null].filter(Boolean);
    const high = cs.high ? `<div class="banner err">${ic('alert')}<div><div class="bt">Небезпека для міста</div><div class="bb">${cs.nearest ? `${KIND[cs.nearest.k] || 'Ціль'} ~${Math.round(cs.nearest.d)} км від вас. ` : ''}Будьте в укритті.</div></div></div>`
      : info.length ? `<div class="ainfo">${ic('info')}<span>${esc(info.join(' · '))}</span></div>` : '';
    cityCard = `<div class="card acity${cs.on ? ' alarm' : ''}"><div class="arow" data-act="acity" role="button" tabindex="0"><span class="aic ${cs.on ? 'on' : 'calm'}">${ic(cs.on ? 'siren' : 'shield')}</span><span class="tx"><span class="h-s">${esc(city.label)}</span><span class="cap3">${esc(city.raion === 'Київ' ? 'м. Київ' : `${city.raion.replace(' район', ' р-н')} · ${city.oblast.replace(' область', ' обл.')}`)}</span></span>${pill}</div><div class="acol"><div class="acol-in">${timer}${cs.high ? '' : high}</div></div>${cs.high ? high : ''}</div>`;
  }
  const counters = `<div class="acount"><div class="card"><div class="n"><i style="background:var(--off)"></i><span class="mono">${n}</span></div><div class="cap3">${plural(n, 'район', 'райони', 'районів')} у тривозі</div></div><div class="card"><div class="n">${ic('send')}<span class="mono">${nt}</span></div><div class="cap3">${plural(nt, 'повітряна ціль', 'повітряні цілі', 'повітряних цілей')}</div></div></div>`;
  const ref = city || { lat: 50.45, lon: 30.52 };
  const list = (s.targets || []).map(t => ({ ...t, d: dist(t.la, t.lo, ref.lat, ref.lon) })).sort((a, b) => a.d - b.d).slice(0, 6);
  const rows = list.map(t => { const e = city ? eta(t, city.lat, city.lon) : null, age = Math.floor((Date.now() - t.ts) / 60000);
    return `<button class="trow" data-tsel="${esc(t.id)}"><span class="tb"><svg viewBox="-12 -12 24 24" width="18" height="18"><path d="${svgGlyph(t.k)}" fill="${KCOL[t.k] || KCOL.unknown}" stroke="#000" stroke-width="1.4" transform="rotate(${Math.round(t.b || 0)})"/></svg></span><span class="tx"><span class="tt">${esc(label(t))}</span><br><span class="st">${t.b != null ? `курс ${compass(t.b)} · ` : ''}${Math.round(t.d)} км${e != null && e > 0 && e <= 90 ? ` · підліт ≈${fmtEta(e)}` : ''}</span></span><span class="r">${age < 1 ? 'щойно' : age + ' хв'}</span></button>`; }).join('');
  const targets = o.targets === false ? '' : `<div class="card atargets"><div class="row-head"><div class="h-s">Найближчі цілі</div><span class="cap3">торкніться — на карті</span></div>${rows || `<div class="body-s">Зараз повітряних цілей немає.</div>`}</div>`;
  const okAll = (s.sources || []).every(x => x.ok);
  const src = `<div class="source ${okAll && live ? 'ok' : 'warn'}">${ic(okAll && live ? 'shield' : 'info')}${!live ? 'Офіційне джерело тривог не відповідає — показуємо останні дані' : okAll ? 'Усі джерела онлайн' : 'Частина джерел не відповідає'} · оновлено ${hhmm(Date.parse(s.at))}</div>`;
  // під час тривоги в моєму місті екран пульсує червоним по краях
  // нижня інформаційна частина ховається вниз — лишається плашка міста зі статусом, решта місця — карті
  const col = drawerCollapsed;
  return (cs.on ? '<div class="alarm-vignette" aria-hidden="true"></div>' : '') + stageHtml + `<section class="sheet asheet${col ? ' collapsed' : ''}"><button class="ahandle" data-act="asheet" aria-label="${col ? 'Показати деталі' : 'Сховати деталі'}" aria-expanded="${!col}"><i></i></button>${cityCard}<div class="acol amore"><div class="acol-in">${counters}${targets}${src}</div></div></section>`;
}

export function alertSettingsView(S) {
  const o = S.alerts, s = lastSnap();
  const tg = (act, i, t, st, on) => `<button class="li" data-act="${act}"><span class="lt">${ic(i)}</span><span class="tx"><span class="tt">${t}</span><br><span class="st">${st}</span></span><span class="toggle" role="switch" aria-checked="${!!on}"></span></button>`;
  const srcRows = (s?.sources || [{ n: 'ukrainealarm', what: 'Тривоги (офіційні) · уточнення цілей' }, { n: 'dimap', what: 'Повітряні цілі (основне джерело)' }, { n: 'neptun', what: 'Уточнення цілей: модель, курс' }])
    .map(x => `<div class="li"><span class="lt">${ic(x.n === 'dimap' ? 'send' : x.n === 'neptun' ? 'globe' : 'shield')}</span><span class="tx"><span class="tt">${x.n}</span><br><span class="st">${x.what}</span></span><span class="val" style="color:${x.ok == null ? 'var(--text-3)' : x.ok ? 'var(--on-ink)' : 'var(--off-ink)'}">${x.ok == null ? '…' : x.ok ? 'Онлайн' : 'Немає зв’язку'}</span></div>`).join('');
  const notifOff = !S.notify.enabled;
  return `<div class="band"><div class="bar"><button class="btn-ic" data-go="alerts" aria-label="Назад">${ic('chevron-left')}</button><span class="ttl">Карта тривог</span><span style="width:40px"></span></div></div><section class="sheet r32">
   <div class="over">Мій город</div><div class="list"><button class="li" data-act="acity"><span class="lt">${ic('map-pin')}</span><span class="tx"><span class="tt">Місто</span><br><span class="st">${o.city ? esc(o.city.raion === 'Київ' ? 'м. Київ' : `${o.city.raion.replace(' район', ' р-н')} · ${o.city.oblast.replace(' область', ' обл.')}`) : 'Не обрано'}</span></span><span class="val">${esc(o.city?.label || 'Обрати')}</span>${ic('chevron-right', 'chev')}</button><button class="li" data-act="apick"><span class="lt">${ic('locate')}</span><span class="tx"><span class="tt">Поставити точку на карті</span><br><span class="st">${o.city?.manual ? 'Зараз: ваша точка · ' + o.city.lat.toFixed(3) + ', ' + o.city.lon.toFixed(3) : 'Точне місце — для відстані й часу підльоту цілей'}</span></span>${ic('chevron-right', 'chev')}</button></div>
   <div class="over">Сповіщення</div><div class="list">${tg('apush', 'bell', 'Тривога в моєму місті', notifOff && o.push ? 'Увімкніть сповіщення в Налаштуваннях' : 'Початок, відбій і небезпека поруч', o.push && !notifOff)}${tg('asiren', 'siren', 'Сирена', 'Коли ціль ближче 35 км від міста', o.siren !== false)}</div>
   <div class="over">На карті</div><div class="list">${tg('atargets', 'send', 'Повітряні цілі', 'Курс, конус на 10 хв і час підльоту при наближенні', o.targets !== false)}${tg('athreat', 'shield', 'Зони загрози', 'Жовті райони, рахуються як тривога', o.threat !== false)}
     <div class="li"><span class="lt">${ic('grid')}</span><span class="tx"><span class="tt">Поділ карти</span></span><div class="seg" style="width:170px">${[['raions', 'Райони'], ['oblasts', 'Області']].map(([k, l]) => `<button data-act="amode" data-v="${k}" aria-pressed="${(o.mode || 'raions') === k}">${l}</button>`).join('')}</div></div></div>
   <div class="over">Звідки дані</div><div class="list">${srcRows}</div>
   <div class="cap3" style="margin:0 4px">Як у нашому віджеті «Тривоги»: тривоги — лише офіційні, з ukrainealarm. Повітряні цілі — з dimap; ukrainealarm і neptun лише уточнюють курс і модель. Якщо dimap не відповідає — показуємо тільки цілі, підтверджені обома іншими. Цілі старші 5 хвилин зникають. Карта — OpenFreeMap.</div></section>`;
}

export function citySheetHTML() {
  return `<div class="h-s" style="font-size:22px">Моє місто</div><div class="field"><input id="acityq" type="search" placeholder="Назва громади або району" autocomplete="off" enterkeyhint="search"></div><div class="list" id="acitylist" style="background:var(--surface-2);max-height:52vh;overflow:auto"></div>`;
}
export async function fillCityList(q) {
  const el = document.getElementById('acitylist'); if (!el) return;
  const res = await searchCity(q);
  el.innerHTML = res.map((h, i) => `<button class="li" data-act="acitypick" data-i="${i}"><span class="tx"><span class="tt">${esc(isKyiv(h) ? 'Київ' : displayName(h.name))}</span><br><span class="st">${esc(isKyiv(h) ? 'Столиця' : `${h.raion} · ${h.oblast}`)}</span></span></button>`).join('') || '<div class="li"><span class="tx"><span class="st">Нічого не знайдено</span></span></div>';
  el._res = res;
}

// Сирена (WebAudio): 6 с виття
export function playSiren() {
  try { const A = window.AudioContext || window.webkitAudioContext; if (!A) return; const ctx = new A();
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.4);
    for (let i = 0; i < 3; i++) { o.frequency.setValueAtTime(420, t + i * 2); o.frequency.linearRampToValueAtTime(880, t + i * 2 + 1.4); o.frequency.linearRampToValueAtTime(420, t + i * 2 + 2); }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6); o.start(t); o.stop(t + 6.1); o.onended = () => ctx.close();
  } catch {}
}
// попередній перегляд силуетів (для перевірки дизайну)
export function glyphPreview(k, bg = '#E39A0B') { const im = glyphImage(k), c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); const t = document.createElement('canvas'); t.width = im.width; t.height = im.height; t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(im.data), im.width, im.height), 0, 0); x.drawImage(t, 0, 0); return c.toDataURL(); }
export const mapInstance = () => M; // для діагностики
