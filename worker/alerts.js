// Повітряні тривоги — та сама логіка, що в нашому віджеті «Тривоги» (ua-alert-widget, Shared/Sources.swift):
//  • тривоги — лише ukrainealarm (офіційні); 3 = тривога (червона), 2 = загроза (жовта, рахується як тривога);
//  • повітряні цілі — dimap (еталон); ukrainealarm і neptun лише уточнюють курс і модель;
//    якщо dimap мовчить — лише цілі, підтверджені обома іншими; старші 5 хв зникають.
// Один спільний знімок на всіх користувачів: кеш Cloudflare на 20 с, телефони джерела не смикають.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
const FRESH = 20, KEEP = 1800; // с: свіжий знімок / запасний, якщо всі джерела впали
const CK = 'https://cache.electrocity/alerts-v1', CK_LAST = 'https://cache.electrocity/alerts-last-v1';

async function getJSON(url, site) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'uk-UA,uk;q=0.9', Referer: site + '/', Origin: site }, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const t = await r.text(); if (t.length > 8e6) throw new Error('too big');
  return JSON.parse(t);
}
const str = (o, ...k) => { for (const x of k) if (typeof o?.[x] === 'string' && o[x]) return o[x]; return null; };
const num = (o, ...k) => { for (const x of k) { const v = o?.[x]; if (typeof v === 'number') return v; if (typeof v === 'string' && v.trim() && !isNaN(+v)) return +v; } return null; };
const time = (o, ...k) => { for (const x of k) { const v = o?.[x]; if (typeof v === 'string') { const d = Date.parse(v); if (!isNaN(d)) return d; } if (typeof v === 'number') return v > 1e12 ? v : v * 1000; } return null; };

// [рівень, початок у мс] — сильніший рівень перемагає, за рівних — раніший початок
const merge = (a, b) => { if (!a) return b; if (!b) return a; if (b[0] > a[0]) return b; if (b[0] < a[0]) return a; const s = [a[1], b[1]].filter(Boolean); return [a[0], s.length ? Math.min(...s) : 0]; };
const put = (m, k, v) => { m[k] = merge(m[k], v); };

// Класи цілей — як у віджеті (TargetKind.from)
export function kindOf(raw) {
  const s = String(raw || '').toLowerCase(); const has = (...a) => a.some(x => s.includes(x));
  if (has('geran5', 'geran-5', 'geran_5', 'герань-5', 'герань 5')) return 'geran5';
  if (has('reactive', 'jet', 'реактив', 'geran3', 'geran4', 'geran-3', 'geran-4', 'герань-3', 'герань-4', 'shahed238', 'shahed-238')) return 'jetShahed';
  if (has('fpv')) return 'fpv';
  if (has('ballist', 'баліст', 'iskanderm', 'iskander-m', 'іскандер-м', 'kn23', 'kn-23', 'kingal', 'kinzhal', 'кинджал', 's300', 'с-300', 'oreshnik', 'орешнік', 'curkon', 'zircon', 'циркон')) return 'ballistic';
  if (has('kab', 'каб', 'ympk', 'умпк', 'ympd', 'умпб', 'bomb', 'бомб')) return 'kab';
  if (has('kalibr', 'калібр', 'x101', 'х-101', 'x555', 'х-555', 'x55', 'х-55', 'x59', 'х-59', 'x69', 'х-69', 'x22', 'х-22', 'x31', 'х-31', 'oniks', 'онікс', 'p800', 'iskanderk', 'іскандер-к', 'rocket', 'missile', 'cruise', 'ракет', 'крилат')) return 'cruise';
  if (has('vertolit', 'heli', 'гелікоптер', 'вертол', 'rotor')) return 'helicopter';
  if (has('orlan', 'орлан', 'zala', 'supercam', 'scout', 'розвід', 'molnia', 'молнія', 'lancet', 'ланцет', 'recon')) return 'recon';
  if (has('su34', 'su35', 'su-', 'су-', 'avia', 'авіа', 'plane', 'aircraft', 'mig', 'міг', 'tu-', 'ту-')) return 'aircraft';
  if (has('shahed', 'shakhed', 'шахед', 'geran', 'герань', 'dron', 'drone', 'uav', 'бпла', 'bpla')) return 'shahed';
  return 'unknown';
}
const MODELS = { geran1_shahed131: '«Герань-1»', geran2_shahed136: '«Герань-2»', geran3: '«Герань-3»', geran4: '«Герань-4»', geran5: '«Герань-5»',
  kalibr: '«Калібр»', x101: 'Х-101', x555: 'Х-555', x55: 'Х-55', x59: 'Х-59', x69: 'Х-69', x22: 'Х-22', x31: 'Х-31',
  p800_oniks: '«Онікс»', curkon: '«Циркон»', iskanderm: '«Іскандер-М»', iskanderk: '«Іскандер-К»', kn23: 'KN-23',
  kingal: '«Кинджал»', s300: 'С-300', oreshnik: '«Орешнік»', kab_ympk: 'КАБ з УМПК', ympd_d30cn: 'УМПБ Д-30СН',
  su34: 'Су-34', su35: 'Су-35', orlan10: '«Орлан-10»', orlan30: '«Орлан-30»', zala: 'ZALA', supercam: 'Supercam',
  lancet1: '«Ланцет-1»', lancet3: '«Ланцет-3»', molnia1: '«Молнія-1»', molnia2: '«Молнія-2»', bm35_italmas: 'БМ-35' };
const modelName = id => id ? MODELS[String(id).toLowerCase()] || null : null;

export function parseUkraineAlarm(root) {
  const out = { raions: {}, oblasts: {}, cities: {}, targets: [] };
  for (const a of root?.alerts || []) {
    const name = str(a, 'regionName'); const active = a.activeAlerts || [];
    if (!name || !active.length) continue;
    const ts = active.map(x => time(x, 'lastUpdate')).filter(Boolean);
    const since = ts.length ? Math.min(...ts) : time(a, 'lastUpdate');
    let level = 0;
    for (const al of active) {
      const lv = al.activeAlertLevels || [];
      if (!lv.length) level = 3;
      for (const l of lv) level = /yellow|orange/i.test(str(l, 'alertLevel') || 'red') ? Math.max(level, 2) : 3;
    }
    if (!level) continue;
    const st = [level, since || 0];
    const type = str(a, 'regionType') || '';
    if (type === 'State') put(name.startsWith('м.') ? out.cities : out.oblasts, name, st);
    else if (type === 'District') put(out.raions, name, st);
    else if (type === 'Community') put(out.hromadas ||= {}, name.toLowerCase().replace(/’/g, "'").split(' ')[0], st);
  }
  const loc = root?.locations || {};
  let i = 0;
  for (const list of [loc.targets || [], loc.targetsPoints || []]) for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const p = t.point || t.location || t; const la = num(p, 'lat', 'latitude'), lo = num(p, 'lng', 'lon', 'longitude');
    if (la == null || lo == null) continue; i++;
    out.targets.push({ id: 'ua-' + (str(t, 'id', 'targetId') || i), k: kindOf(str(t, 'type', 'targetType', 'kind')), la, lo, b: num(t, 'direction', 'course', 'bearing', 'azimuth', 'heading'), s: num(t, 'speed', 'speedKmh'), ts: time(t, 'lastUpdate', 'updatedAt', 'time', 'timestamp') || Date.now(), src: ['ukrainealarm'] });
  }
  return out;
}
export function parseDimapTargets(root) {
  const list = Array.isArray(root) ? root : root?.targets || [];
  return list.map(t => { const la = num(t, 'lat', 'latitude'), lo = num(t, 'lng', 'lon', 'longitude'); if (la == null || lo == null) return null;
    const type = str(t, 'type', 'kind'); const tr = num(t, '_turn', 'turn');
    return { id: 'dm-' + (str(t, 'id') || `${la},${lo}`), k: kindOf(type), m: modelName(type), la, lo, b: num(t, 'bearing', 'course', 'direction'), s: num(t, 'speed'), tr: tr ?? 0, tk: tr != null, alt: num(t, 'altitude'), c: Math.max(1, Math.round(num(t, 'count') ?? 1)), ts: time(t, 'lastSeen', 'updatedAt') || Date.now(), src: ['dimap'] }; }).filter(Boolean);
}
export function parseNeptun(root) {
  return (root?.threats || []).map(t => {
    if ((str(t, 'status') || 'active') !== 'active') return null;
    const la = num(t, 'lat', 'latitude'), lo = num(t, 'lon', 'lng', 'longitude'); if (la == null || lo == null) return null;
    const title = str(t, 'title'); let k = kindOf(str(t, 'type')); if (k === 'unknown') k = kindOf(title);
    return { id: 'np-' + (str(t, 'id') || `${la},${lo}`), k, m: title && kindOf(title) !== 'unknown' && title.length > 4 && title !== 'БпЛА' ? title : null, la, lo, b: num(t, 'heading', 'course', 'bearing'), s: num(t, 'speed', 'speedKmh'), c: Math.max(1, Math.round(num(t, 'count') ?? 1)), ts: time(t, 'updatedAt', 'lastSeenAt') || Date.now(), src: ['neptun'] };
  }).filter(Boolean);
}
export function distKm(la1, lo1, la2, lo2) {
  const r = 6371, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function bearing(la1, lo1, la2, lo2) {
  const f1 = la1 * Math.PI / 180, f2 = la2 * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
  return (Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) * 180 / Math.PI + 360) % 360;
}
export const angleDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export function mergeTargets(a, b, { radius = 10, add = true, now = Date.now() } = {}) {
  const out = a.filter(t => now - t.ts < 300000).map(t => ({ ...t }));
  for (const t of b) {
    if (now - t.ts >= 300000) continue;
    const o = out.find(o => distKm(o.la, o.lo, t.la, t.lo) < radius && (o.b == null || t.b == null || angleDiff(o.b, t.b) < 30));
    if (o) { o.src = [...new Set([...o.src, ...t.src])].sort(); if (o.b == null) o.b = t.b; if (!o.m) o.m = t.m; if (o.k === 'unknown') o.k = t.k; if (t.ts > o.ts) o.ts = t.ts; }
    else if (add) out.push({ ...t });
  }
  return out;
}
// Цілі, як у віджеті: dimap — еталон (лише його цілі; інші сервіси додають курс і модель).
// Якщо dimap не відповідає — лише цілі, які підтвердили обидва інші сервіси. FPV, «Ланцети», «Молнії» — шум для міста.
export function pickTargets(dm, ua, np) {
  let t = dm ? mergeTargets(mergeTargets(dm, ua || [], { add: false }), np || [], { radius: 15, add: false })
    : mergeTargets(ua || [], np || [], { radius: 15, add: false }).filter(x => x.src.length >= 2);
  return t.filter(x => x.k !== 'fpv' && !/Ланцет|Молнія/.test(x.m || ''));
}

// Тривоги — лише ukrainealarm (офіційні), як у віджеті
export function combine({ ua, dmT, np }) {
  return { raions: { ...(ua?.raions || {}) }, oblasts: { ...(ua?.oblasts || {}) }, cities: { ...(ua?.cities || {}) }, hromadas: { ...(ua?.hromadas || {}) }, targets: pickTargets(dmT, ua?.targets, np) };
}

const AUX = 'https://cache.electrocity/alerts-aux-v2';
async function collect() {
  const run = async (fn) => { try { return [await fn(), 'OK']; } catch (e) { return [null, String(e.message || e).slice(0, 60)]; } };
  const [ua, dmT, np] = await Promise.all([
    run(async () => parseUkraineAlarm(await getJSON('https://map.ukrainealarm.com/api/v2/data/mapUpdate', 'https://map.ukrainealarm.com'))),
    run(async () => parseDimapTargets(await getJSON('https://api.dimap.live/api/targets?_refresh=' + Date.now(), 'https://dimap.live'))),
    run(async () => parseNeptun(await getJSON('https://neptun.in.ua/api/v1/threats', 'https://neptun.in.ua'))),
  ]);
  const snap = combine({ ua: ua[0], dmT: dmT[0], np: np[0] });
  snap.sources = [
    { n: 'ukrainealarm', ok: !!ua[0], d: ua[1], what: 'Тривоги (офіційні) · уточнення цілей' },
    { n: 'dimap', ok: !!dmT[0], d: dmT[1], what: 'Повітряні цілі (основне джерело)' },
    { n: 'neptun', ok: !!np[0], d: np[1], what: 'Уточнення цілей: модель, курс' },
  ];
  snap.ok = !!ua[0];
  snap.at = new Date().toISOString();
  // для швидкого оновлення цілей: останні цілі інших сервісів
  aux = { ua: ua[0]?.targets || aux?.ua || [], np: np[0] || aux?.np || [] };
  await caches.default.put(AUX, new Response(JSON.stringify(aux), { headers: { 'Cache-Control': 'max-age=600' } })).catch(() => {});
  return snap;
}
let aux = null;

// Швидкий шлях: лише цілі (dimap кожні кілька секунд), уточнені останніми даними інших сервісів
const CKT = 'https://cache.electrocity/targets-v2'; let tmem = null;
export async function getTargets() {
  const now = Date.now(); if (tmem && now - tmem.t < 5000) return tmem.s;
  const c = caches.default; const hit = await c.match(CKT);
  if (hit) { const s = await hit.json(); tmem = { t: Date.parse(s.at) || now, s }; return s; }
  if (!aux) { const a = await c.match(AUX); aux = a ? await a.json() : { ua: [], np: [] }; }
  let dm = null; try { dm = parseDimapTargets(await getJSON('https://api.dimap.live/api/targets?_refresh=' + now, 'https://dimap.live')); } catch {}
  const s = { at: new Date().toISOString(), ok: !!dm, targets: dm ? pickTargets(dm, aux.ua, aux.np) : null };
  if (dm) await c.put(CKT, new Response(JSON.stringify(s), { headers: { 'Cache-Control': 'max-age=5' } })).catch(() => {});
  tmem = { t: now, s }; return s;
}

let mem = null; // у межах одного екземпляра Worker
export async function getAlerts(force = false) {
  const now = Date.now();
  if (!force && mem && now - mem.t < FRESH * 1000) return mem.s;
  const c = caches.default;
  if (!force) { const hit = await c.match(CK); if (hit) { const s = await hit.json(); mem = { t: Date.parse(s.at) || now, s }; return s; } }
  let s = await collect();
  if (s.ok) await Promise.all([
    c.put(CK, new Response(JSON.stringify(s), { headers: { 'Cache-Control': `max-age=${FRESH}` } })),
    c.put(CK_LAST, new Response(JSON.stringify(s), { headers: { 'Cache-Control': `max-age=${KEEP}` } })),
  ]).catch(() => {});
  else { const last = await c.match(CK_LAST); if (last) { const prev = await last.json(); s = { ...prev, sources: s.sources, stale: true }; } }
  mem = { t: now, s };
  return s;
}

// ---------- Стан мого міста (як у віджеті: місто + район + область; жовта = тривога) ----------
export function cityStatus(snap, c) {
  let st = null;
  if (c.k) st = merge(st, snap.cities?.[c.k]);
  if (c.r) st = merge(st, snap.raions?.[c.r]);
  if (c.o) st = merge(st, snap.oblasts?.[c.o]);
  let high = false, nearest = null;
  // Небезпека для міста — ціль ближче ~35 км (лише курсу замало: забагато хибних тривог)
  for (const t of snap.targets || []) {
    const d = distKm(t.la, t.lo, c.la, c.lo);
    if (!nearest || d < nearest.d) nearest = { d, k: t.k };
    if (d <= 35) high = true;
  }
  return { level: st ? st[0] : 0, since: st ? st[1] : 0, high, nearest };
}

const KIND_UA = { shahed: 'Шахед', jetShahed: 'Реактивний шахед', geran5: 'Герань-5', cruise: 'Крилата ракета', ballistic: 'Балістика', kab: 'КАБ', aircraft: 'Авіація', helicopter: 'Гелікоптер', recon: 'Розвідувальний БпЛА', fpv: 'FPV', unknown: 'Ціль' };
const mins = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} хв` : `${Math.floor(m / 60)} год${m % 60 ? ' ' + (m % 60) + ' хв' : ''}`; };

// Раз на хвилину: тривога / відбій / висока загроза для міста кожного підписника.
// Стан міст — у KV, але пишемо лише коли щось змінилось (ліміт записів KV).
export async function alertTick(env, getSubs, sendPush, localize) {
  const r = await alertTickRun(env, getSubs, sendPush, localize).catch(e => ({ error: String(e?.message || e) }));
  // відмітка «щохвилинна перевірка тривог працює» (Cache API, без витрати ліміту KV)
  await caches.default.put(new Request('https://cache.electrocity/lastalerttick'), new Response(JSON.stringify({ at: new Date().toISOString(), ...r }), { headers: { 'Cache-Control': 'max-age=86400' } })).catch(() => {});
  return r;
}
async function alertTickRun(env, getSubs, sendPush, localize) {
  const subs = await getSubs(env); const ids = Object.keys(subs).filter(id => subs[id].alert?.on);
  if (!ids.length) return { subs: 0 };
  const snap = await getAlerts(true);
  if (!snap.ok || snap.stale) return { skipped: 'sources down' }; // не шлемо хибний «відбій», коли джерела мовчать
  const prev = JSON.parse(await env.KV.get('alertstate') || '{}'); const next = {}; const now = Date.now();
  const cities = new Map(); for (const id of ids) { const c = subs[id].alert; cities.set(`${c.k}|${c.r}`, c); }
  const events = {};
  for (const [key, c] of cities) {
    const s = cityStatus(snap, c), was = prev[key];
    const on = s.level >= 2 ? 1 : 0;
    const cur = { a: on, s: on ? (was?.a ? was.s : (s.since || now)) : 0, h: was?.h || 0 };
    const ev = [];
    if (was) {
      if (on && !was.a) ev.push({ kind: 'start', title: `🔴 Повітряна тривога · ${c.n}`, body: `${c.r || c.o}. Пройдіть до укриття.` });
      if (!on && was.a) ev.push({ kind: 'end', title: `🟢 Відбій тривоги · ${c.n}`, body: was.s ? `Тривога тривала ${mins(now - was.s)}.` : 'Тривогу скасовано.' });
      if (on && s.high && now - (was.h || 0) > 10 * 60000) { cur.h = now; ev.push({ kind: 'high', title: `⚠ Висока загроза · ${c.n}`, body: s.nearest ? `${KIND_UA[s.nearest.k] || 'Ціль'} ~${Math.round(s.nearest.d)} км від міста. Будьте в укритті.` : 'Ціль поруч із містом. Будьте в укритті.' }); }
    }
    next[key] = cur; events[key] = ev;
  }
  const outbox = [];
  for (const id of ids) { const c = subs[id].alert;
    for (const e of events[`${c.k}|${c.r}`] || []) if (e.kind !== 'high' || c.siren) outbox.push({ id, msg: { title: e.title, body: e.body, tag: `alert-${c.k}`, url: './#alerts' } }); }
  const sent = []; let dead = false;
  for (const o of outbox.slice(0, 40)) { // ліміт запитів на запуск
    const r = await sendPush(env, subs[o.id].sub, localize(o.msg, subs[o.id].lang), 900).catch(e => ({ status: 0, err: String(e?.message || e) }));
    sent.push({ title: o.msg.title, status: r.status });
    if (r.status === 404 || r.status === 410) { delete subs[o.id]; dead = true; }
  }
  const sig = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k].a, o[k].s, o[k].h]));
  if (sig(prev) !== sig(next)) await env.KV.put('alertstate', JSON.stringify(next)).catch(() => {});
  if (dead) await env.KV.put('subs', JSON.stringify(subs));
  if (outbox.length) await env.KV.put('lastpush-alert', JSON.stringify({ at: new Date().toISOString(), sent })).catch(() => {});
  return { subs: ids.length, cities: cities.size, sent: sent.length };
}
