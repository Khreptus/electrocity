// Вкладка «Тривоги»: карта районів, повітряні цілі, стан мого міста.
// Дані — один спільний знімок із сервера (/api/alerts): тривоги з ukrainealarm, dimap, radarua; цілі — лише dimap і ukrainealarm.
// Правило: жовта зона (загроза) рахується як тривога всюди; жовтим кольором — лише на карті.
import { API, API_READY } from './config.js';
import { ic } from './icons.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
export const hms = ms => { const t = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t % 3600 / 60))}:${pad(t % 60)}`; };
const hhmm = ms => new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });

// ---------- Геометрія (статичні файли, кешуються service worker) ----------
let GEO = null, HROM = null;
export async function loadGeo() {
  if (GEO) return GEO;
  const g = await (await fetch('assets/ua-geo.json')).json();
  const path = rings => rings.filter(r => r.length >= 6).map(r => { let d = `M${r[0]} ${r[1]}`; for (let i = 2; i + 1 < r.length; i += 2) d += `L${r[i]} ${r[i + 1]}`; return d + 'Z'; }).join('');
  GEO = { w: g.width, h: g.height, proj: g.proj,
    raions: g.raions.map(r => ({ name: r.name, oblast: r.oblast, rings: r.rings, d: path(r.rings) })),
    oblasts: g.oblasts.map(o => ({ name: o.name, d: path(o.rings) })) };
  GEO.borders = GEO.oblasts.map(o => o.d).join('');
  return GEO;
}
export async function loadHromady() {
  if (HROM) return HROM;
  HROM = (await (await fetch('assets/ua-hromady.json')).json()).map(([name, raion, oblast, lat, lon]) => ({ name, raion, oblast, lat, lon }));
  return HROM;
}
const project = (la, lo) => { const p = GEO.proj; return [(lo * p.k - p.minx) * p.scale, (-la - p.miny) * p.scale]; };
function inRing(x, y, r) { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
const raionAt = (la, lo) => { const [x, y] = project(la, lo); return GEO.raions.find(r => r.rings.some(g => inRing(x, y, g))); };

// ---------- Громади: моє місто ----------
const SUFFIX = [' міська територіальна громада', ' селищна територіальна громада', ' сільська територіальна громада', ' міська громада', ' селищна громада', ' сільська громада', ' територіальна громада'];
export const displayName = n => { for (const s of SUFFIX) if (n.endsWith(s)) return n.slice(0, -s.length) + ' громада'; return n; };
const isKyiv = h => h.raion === 'Київ' || h.name === 'Київ';
export const cityKey = h => isKyiv(h) ? 'м. Київ' : 'м. ' + displayName(h.name).replace(' громада', '');
export function cityFromHromada(h, label) { return { label: label || (isKyiv(h) ? 'Київ' : displayName(h.name)), name: h.name, raion: h.raion, oblast: h.oblast, lat: h.lat, lon: h.lon }; }
// Місто з основної адреси: «Ірпінь» → «Ірпінська міська громада» у тій самій області
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
const POPULAR = ['Київ', 'Харківська міська громада', 'Одеська міська громада', 'Дніпровська міська громада', 'Львівська міська громада', 'Запорізька міська громада', 'Ірпінська міська громада', 'Вінницька міська громада', 'Полтавська міська громада', 'Хмельницька міська громада', 'Миколаївська міська громада', 'Житомирська міська громада', 'Черкаська міська громада', 'Сумська міська громада', 'Чернігівська міська громада'];
export async function searchCity(q) {
  const hs = await loadHromady(); const s = q.trim().toLowerCase();
  if (!s) return POPULAR.map(n => hs.find(h => h.name === n)).filter(Boolean);
  const starts = [], cont = [];
  for (const h of hs) { const n = h.name.toLowerCase(); if (n.startsWith(s)) starts.push(h); else if (n.includes(s) || h.raion.toLowerCase().includes(s)) cont.push(h); if (starts.length >= 30) break; }
  return [...starts, ...cont].slice(0, 30);
}

// ---------- Знімок тривог ----------
let SNAP = null, snapAt = 0, inflight = null;
export const lastSnap = () => SNAP;
export async function fetchAlerts(force) {
  if (!force && SNAP && Date.now() - snapAt < 15000) return SNAP;
  if (inflight) return inflight;
  inflight = (async () => { try { const r = await fetch(`${API}api/alerts`, { cache: 'no-store' }); if (r.ok) { SNAP = await r.json(); snapAt = Date.now(); } } catch {} finally { inflight = null; } return SNAP; })();
  return inflight;
}
const mergeSt = (a, b) => { if (!a) return b; if (!b) return a; if (b[0] !== a[0]) return b[0] > a[0] ? b : a; const s = [a[1], b[1]].filter(Boolean); return [a[0], s.length ? Math.min(...s) : 0]; };
const raionLevel = (s, r) => mergeSt(s.raions?.[r.name], s.oblasts?.[r.oblast]);
const dist = (la1, lo1, la2, lo2) => { const R = 6371, a = (la2 - la1) * Math.PI / 180, b = (lo2 - lo1) * Math.PI / 180; const h = Math.sin(a / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(b / 2) ** 2; return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); };
const brg = (la1, lo1, la2, lo2) => { const f1 = la1 * Math.PI / 180, f2 = la2 * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180; return (Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) * 180 / Math.PI + 360) % 360; };
const adiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
export function cityStatus(s, c) {
  const h = { name: c.name, raion: c.raion };
  let st = mergeSt(s.cities?.[cityKey(h)], mergeSt(s.raions?.[c.raion], s.oblasts?.[c.oblast]));
  let high = false, nearest = null;
  for (const t of s.targets || []) {
    const d = dist(t.la, t.lo, c.lat, c.lon);
    if (!nearest || d < nearest.d) nearest = { d, k: t.k };
    if (d < 25) { high = true; continue; }
    if (d < 120 && t.b != null && adiff(t.b, brg(t.la, t.lo, c.lat, c.lon)) < 25) high = true;
    if (t.k === 'ballistic' && d < 400) high = true;
  }
  return { on: !!st && st[0] >= 2, since: st?.[1] || 0, high, nearest };
}

// ---------- Рендер ----------
const KIND = { drone: ['Шахед', 'Шахеди'], missile: ['Ракета', 'Ракети'], ballistic: ['Балістика', 'Балістика'], aircraft: ['Авіація', 'Авіація'], unknown: ['Ціль', 'Цілі'] };
const KCOL = { drone: '#FFFFFF', missile: 'var(--possible)', ballistic: 'var(--off)', aircraft: '#8FC3FF', unknown: '#C9CCD1' };
const COMPASS = ['Пн', 'ПнСх', 'Сх', 'ПдСх', 'Пд', 'ПдЗх', 'Зх', 'ПнЗх'];
const compass = b => COMPASS[Math.round(((b % 360) + 360) % 360 / 45) % 8];
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };
const ago = ts => { const m = Math.floor((Date.now() - ts) / 60000); return m < 1 ? 'щойно' : `${m} хв`; };
const IDLE = '#2C2C2C';

function mapSVG(s, o, city, cs) {
  const fill = lv => lv >= 3 ? 'var(--off)' : lv === 2 ? (o.threat !== false ? 'var(--possible)' : IDLE) : IDLE;
  let body = '';
  if (o.mode === 'oblasts') {
    const lv = {}; for (const r of GEO.raions) { const st = raionLevel(s, r); if (st) lv[r.oblast] = Math.max(lv[r.oblast] || 0, st[0]); }
    for (const ob of GEO.oblasts) { const st = s.oblasts?.[ob.name]; body += `<path d="${ob.d}" fill="${fill(Math.max(lv[ob.name] || 0, st?.[0] || 0))}"/>`; }
  } else {
    for (const r of GEO.raions) body += `<path d="${r.d}" fill="${fill(raionLevel(s, r)?.[0] || 0)}"/>`;
  }
  body = `<g stroke="#1B1B1B" stroke-width=".6" stroke-linejoin="round">${body}</g><path d="${GEO.borders}" fill="none" stroke="#000" stroke-opacity=".85" stroke-width=".9"/>`;
  // Київ — окрема точка міста
  const kv = s.cities?.['м. Київ']; const [kx, ky] = project(50.45, 30.52);
  body += `<circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="5" fill="${fill(kv?.[0] || 0)}" stroke="#1B1B1B" stroke-width="1"/>`;
  if (o.targets !== false) for (const t of s.targets || []) {
    const [x, y] = project(t.la, t.lo); const c = KCOL[t.k] || KCOL.unknown;
    body += t.b == null ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${c}" stroke="#000" stroke-opacity=".5"/>`
      : `<path d="M0 -10 L7 8 L0 4 L-7 8Z" fill="${c}" stroke="#000" stroke-opacity=".45" stroke-width="1" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${Math.round(t.b)})"/>`;
  }
  if (city) { const [x, y] = project(city.lat, city.lon); const hc = cs.on ? 'var(--off)' : 'var(--on)';
    body += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="${hc}" opacity=".3" class="apulse"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="#F3F4F1" stroke="${hc}" stroke-width="3"/>`; }
  return `<svg class="amap" viewBox="0 0 ${GEO.w} ${GEO.h}" role="img" aria-label="Карта тривог України">${body}</svg>`;
}

export async function alertsView(S) {
  const o = S.alerts; await loadGeo();
  const s = lastSnap();
  const city = o.city;
  const head = (meta) => `<section class="astage"><div class="atop"><span class="h-l">Тривоги</span><span class="live ${s && !s.stale ? '' : 'off'}"><i></i>${s && !s.stale ? 'Наживо' : s ? 'Затримка' : 'Завантаження'}</span><button class="btn-ic" data-go="alert-settings" aria-label="Налаштування карти">${ic('more')}</button></div><div class="ameta">${meta}</div>`;
  if (!s) return head('Збираємо дані з ukrainealarm, dimap і radarua…') + `<div class="amap skel-map"></div></section><section class="sheet"><div class="card"><div class="skel" style="width:60%"></div><div class="skel" style="width:40%"></div></div></section>`;
  const cs = city ? cityStatus(s, city) : { on: false };
  let n = 0; for (const r of GEO.raions) if ((raionLevel(s, r)?.[0] || 0) >= 2) n++;
  const nt = (s.targets || []).length;
  const meta = n ? `${n} ${plural(n, 'район', 'райони', 'районів')} у тривозі · ${nt} ${plural(nt, 'ціль', 'цілі', 'цілей')}` : `Тривог немає · ${nt} ${plural(nt, 'ціль', 'цілі', 'цілей')}`;
  const stageHtml = head(meta) + mapSVG(s, o, city, cs) + `<div class="acap">Тривоги: ukrainealarm · dimap · radarua · Цілі: dimap · ukrainealarm</div></section>`;

  // Моє місто
  let cityCard;
  if (!city) cityCard = `<button class="card acity" data-act="acity"><div class="arow"><span class="aic">${ic('map-pin')}</span><span class="tx"><span class="h-s">Оберіть своє місто</span><br><span class="cap3">Покажемо, чи є тривога саме у вас</span></span>${ic('chevron-right', 'chev')}</div></button>`;
  else {
    const pill = cs.on ? `<span class="apill on"><i></i>Тривога</span>` : `<span class="apill calm"><i></i>Спокійно</span>`;
    const timer = cs.on ? (cs.since ? `<div class="atimer"><div><div class="cap3">Триває</div><div class="big mono" data-asince="${cs.since}">${hms(Date.now() - cs.since)}</div></div><div style="text-align:right"><div class="cap3">Почалась о</div><div class="nx mono">${hhmm(cs.since)}</div></div></div>` : `<div class="body-s">Тривога триває</div>`)
      : `<div class="body-s">Тривоги немає${cs.nearest ? ` · найближча ціль ~${Math.round(cs.nearest.d)} км` : ''}</div>`;
    const high = cs.on && cs.high ? `<div class="banner err">${ic('alert')}<div><div class="bt">Висока загроза для міста</div><div class="bb">${cs.nearest ? `${KIND[cs.nearest.k]?.[0] || 'Ціль'} ~${Math.round(cs.nearest.d)} км. ` : ''}Будьте в укритті.</div></div></div>` : '';
    cityCard = `<div class="card acity ${cs.on ? 'is-on' : ''}"><div class="arow" data-act="acity" role="button" tabindex="0"><span class="aic ${cs.on ? 'on' : 'calm'}">${ic(cs.on ? 'siren' : 'shield')}</span><span class="tx"><span class="h-s">${esc(city.label)}</span><br><span class="cap3">${esc(city.raion === 'Київ' ? 'м. Київ' : `${city.raion.replace(' район', ' р-н')} · ${city.oblast.replace(' область', ' обл.')}`)}</span></span>${pill}</div>${timer}${high}</div>`;
  }

  const counters = `<div class="acount"><div class="card"><div class="n"><i style="background:var(--off)"></i><span class="mono">${n}</span></div><div class="cap3">${plural(n, 'район', 'райони', 'районів')} у тривозі</div></div><div class="card"><div class="n">${ic('send')}<span class="mono">${nt}</span></div><div class="cap3">${plural(nt, 'повітряна ціль', 'повітряні цілі', 'повітряних цілей')}</div></div></div>`;

  // Повітряні цілі — найближчі до мого міста
  const ref = city || { lat: 50.45, lon: 30.52 };
  const list = (s.targets || []).map(t => ({ ...t, d: dist(t.la, t.lo, ref.lat, ref.lon) })).sort((a, b) => a.d - b.d).slice(0, 6);
  const rows = list.map(t => { const r = raionAt(t.la, t.lo);
    const where = r ? `${r.name.replace(' район', ' р-н')}` : 'Поза межами карти';
    return `<div class="trow"><span class="tb" style="color:${KCOL[t.k] || KCOL.unknown}"><svg viewBox="-10 -12 20 22" width="16" height="16" aria-hidden="true">${t.b == null ? '<circle r="5" fill="currentColor"/>' : `<path d="M0 -10 L7 8 L0 4 L-7 8Z" fill="currentColor" transform="rotate(${Math.round(t.b)})"/>`}</svg></span><span class="tx"><span class="tt">${KIND[t.k]?.[0] || 'Ціль'}</span><br><span class="st">${esc(where)}${t.b != null ? ` · курс ${compass(t.b)}` : ''} · ${Math.round(t.d)} км</span></span><span class="r">${ago(t.ts)}</span></div>`; }).join('');
  const targets = o.targets === false ? '' : `<div class="card atargets"><div class="row-head"><div class="h-s">Повітряні цілі</div><span class="cap3">dimap · ukrainealarm</span></div>${rows || `<div class="body-s">Зараз повітряних цілей немає.</div>`}</div>`;
  const okAll = (s.sources || []).every(x => x.ok);
  const src = `<div class="source ${okAll && !s.stale ? 'ok' : 'warn'}">${ic(okAll && !s.stale ? 'shield' : 'info')}${s.stale ? 'Джерела не відповідають — показуємо останні дані' : okAll ? 'Усі джерела онлайн' : 'Частина джерел не відповідає'} · оновлено ${hhmm(Date.parse(s.at))}</div>`;
  return stageHtml + `<section class="sheet">${cityCard}${counters}${targets}${src}</section>`;
}

export function alertSettingsView(S) {
  const o = S.alerts, s = lastSnap();
  const tg = (act, i, t, st, on) => `<button class="li" data-act="${act}"><span class="lt">${ic(i)}</span><span class="tx"><span class="tt">${t}</span><br><span class="st">${st}</span></span><span class="toggle" role="switch" aria-checked="${!!on}"></span></button>`;
  const srcRows = (s?.sources || [{ n: 'ukrainealarm', what: 'Тривоги · повітряні цілі' }, { n: 'dimap', what: 'Тривоги · цілі (пріоритет)' }, { n: 'radarua', what: 'Тривоги' }])
    .map(x => `<div class="li"><span class="lt">${ic(x.n === 'dimap' ? 'globe' : x.n === 'radarua' ? 'refresh' : 'database')}</span><span class="tx"><span class="tt">${x.n}</span><br><span class="st">${x.what}</span></span><span class="val" style="color:${x.ok == null ? 'var(--text-3)' : x.ok ? 'var(--on-ink)' : 'var(--off-ink)'}">${x.ok == null ? '…' : x.ok ? 'Онлайн' : 'Немає зв’язку'}</span></div>`).join('');
  const notifOff = !S.notify.enabled;
  return `<div class="band"><div class="bar"><button class="btn-ic" data-go="alerts" aria-label="Назад">${ic('chevron-left')}</button><span class="ttl">Карта тривог</span><span style="width:40px"></span></div></div><section class="sheet r32">
   <div class="over">Мій город</div><div class="list"><button class="li" data-act="acity"><span class="lt">${ic('map-pin')}</span><span class="tx"><span class="tt">Місто</span><br><span class="st">${o.city ? esc(o.city.raion === 'Київ' ? 'м. Київ' : `${o.city.raion.replace(' район', ' р-н')} · ${o.city.oblast.replace(' область', ' обл.')}`) : 'Не обрано'}</span></span><span class="val">${esc(o.city?.label || 'Обрати')}</span>${ic('chevron-right', 'chev')}</button></div>
   <div class="over">Сповіщення</div><div class="list">${tg('apush', 'bell', 'Тривога в моєму місті', notifOff && o.push ? 'Увімкніть сповіщення в Налаштуваннях' : 'Початок і відбій', o.push && !notifOff)}${tg('asiren', 'siren', 'Сирена', 'При високій загрозі для міста', o.siren !== false)}</div>
   <div class="over">На карті</div><div class="list">${tg('atargets', 'send', 'Повітряні цілі', 'Шахеди й ракети на карті', o.targets !== false)}${tg('athreat', 'shield', 'Зони загрози', 'Жовті райони, рахуються як тривога', o.threat !== false)}
     <div class="li"><span class="lt">${ic('grid')}</span><span class="tx"><span class="tt">Поділ карти</span></span><div class="seg" style="width:170px">${[['raions', 'Райони'], ['oblasts', 'Області']].map(([k, l]) => `<button data-act="amode" data-v="${k}" aria-pressed="${(o.mode || 'raions') === k}">${l}</button>`).join('')}</div></div></div>
   <div class="over">Звідки дані</div><div class="list">${srcRows}</div>
   <div class="cap3" style="margin:0 4px">Тривоги збираються з усіх трьох сервісів. Повітряні цілі — лише з dimap і ukrainealarm. Цілі старші 5 хвилин зникають з карти.</div></section>`;
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

// Сирена (WebAudio, без важкого аудіофайлу): 6 с наростаючого виття
export function playSiren() {
  try { const A = window.AudioContext || window.webkitAudioContext; if (!A) return; const ctx = new A();
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.4);
    for (let i = 0; i < 3; i++) { o.frequency.setValueAtTime(420, t + i * 2); o.frequency.linearRampToValueAtTime(880, t + i * 2 + 1.4); o.frequency.linearRampToValueAtTime(420, t + i * 2 + 2); }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6); o.start(t); o.stop(t + 6.1); o.onended = () => ctx.close();
  } catch {}
}
export const alertsReady = API_READY;
