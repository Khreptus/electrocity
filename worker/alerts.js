// Повітряні тривоги: збір з ukrainealarm, dimap і radarua (відкриті адреси, без ключів).
// Логіка — як у віджеті «Тривоги» (ua-alert-widget/Shared/Sources.swift):
//  • тривоги — з усіх трьох сервісів, рівень: 3 = тривога (червона), 2 = загроза (жовта);
//  • повітряні цілі — лише dimap і ukrainealarm; dimap у пріоритеті; цілі старші 5 хв зникають;
//    однакові цілі з двох джерел зливаються (≤10 км, курс ±30°).
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

export function kindOf(raw) {
  const s = String(raw || '').toLowerCase();
  if (/ballist|баліст/.test(s)) return 'ballistic';
  if (/shahed|drone|uav|bpla|шахед|бпла|geran/.test(s)) return 'drone';
  if (/missile|rocket|\bkr\b|ракет|kalibr|kh-|x-/.test(s)) return 'missile';
  if (/avia|plane|aircraft|jet|авіа|mig|tu-|su-/.test(s)) return 'aircraft';
  return 'unknown';
}

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
export function parseDimapAlerts(list) {
  const out = { raions: {}, cities: {} };
  for (const a of Array.isArray(list) ? list : []) {
    const region = str(a, 'region'); if (!region) continue;
    const c = (str(a, 'color') || '').toLowerCase(); const level = c === 'red' ? 3 : c === 'yellow' || c === 'orange' ? 2 : 0;
    if (!level) continue;
    put(region.startsWith('м.') ? out.cities : out.raions, region, [level, time(a, 'startedAt') || 0]);
  }
  return out;
}
export function parseDimapTargets(root) {
  const list = Array.isArray(root) ? root : root?.targets || [];
  return list.map(t => { const la = num(t, 'lat', 'latitude'), lo = num(t, 'lng', 'lon', 'longitude'); if (la == null || lo == null) return null;
    return { id: 'dm-' + (str(t, 'id') || `${la},${lo}`), k: kindOf(str(t, 'type', 'kind')), la, lo, b: num(t, 'bearing', 'course', 'direction'), s: num(t, 'speed'), ts: time(t, 'lastSeen', 'updatedAt') || Date.now(), src: ['dimap'] }; }).filter(Boolean);
}
export function parseRadar(root) {
  const out = { raions: {}, cities: {} };
  for (const [key, v] of Object.entries(root?.mapZoneStates || {})) {
    if (!v || typeof v !== 'object') continue;
    const lvl = String(v.level || '').toLowerCase(); const alerted = !!v.alerted;
    const level = (alerted && lvl !== 'yellow') || lvl === 'red' ? 3 : lvl === 'yellow' ? 2 : 0; if (!level) continue;
    const name = key.split('|')[0];
    put(name.startsWith('м.') ? out.cities : out.raions, name, [level, 0]);
  }
  return out;
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

export function mergeTargets(a, b, now = Date.now()) {
  const out = a.filter(t => now - t.ts < 300000).map(t => ({ ...t }));
  for (const t of b) {
    if (now - t.ts >= 300000) continue;
    const o = out.find(o => distKm(o.la, o.lo, t.la, t.lo) < 10 && (o.b == null || t.b == null || angleDiff(o.b, t.b) < 30));
    if (o) { o.src = [...new Set([...o.src, ...t.src])].sort(); if (o.b == null) o.b = t.b; if (t.ts > o.ts) o.ts = t.ts; }
    else out.push({ ...t });
  }
  return out;
}

export function combine({ ua, dmA, dmT, rr }) {
  const s = { raions: {}, oblasts: {}, cities: {}, targets: [] };
  if (ua) { Object.assign(s.raions, ua.raions); Object.assign(s.oblasts, ua.oblasts); Object.assign(s.cities, ua.cities); }
  if (dmA) { for (const [k, v] of Object.entries(dmA.raions)) put(s.raions, k, v); for (const [k, v] of Object.entries(dmA.cities)) put(s.cities, k, v); }
  if (rr) { // radarua — запасне джерело / додаткове підтвердження
    const down = !ua;
    for (const [k, v] of Object.entries(rr.raions)) if (down || v[0] === 2 || !s.raions[k]) put(s.raions, k, v);
    for (const [k, v] of Object.entries(rr.cities)) if (down || !s.cities[k]) put(s.cities, k, v);
  }
  s.targets = mergeTargets(dmT || [], ua?.targets || []);
  return s;
}

async function collect() {
  const run = async (fn) => { try { return [await fn(), 'OK']; } catch (e) { return [null, String(e.message || e).slice(0, 60)]; } };
  const [ua, dmA, dmT, rr] = await Promise.all([
    run(async () => parseUkraineAlarm(await getJSON('https://map.ukrainealarm.com/api/v2/data/mapUpdate', 'https://map.ukrainealarm.com'))),
    run(async () => parseDimapAlerts(await getJSON('https://api.dimap.live/api/alerts?_refresh=' + Date.now(), 'https://dimap.live'))),
    run(async () => parseDimapTargets(await getJSON('https://api.dimap.live/api/targets?_refresh=' + Date.now(), 'https://dimap.live'))),
    run(async () => parseRadar(await getJSON('https://radarua.com/api/alerts', 'https://radarua.com'))),
  ]);
  const snap = combine({ ua: ua[0], dmA: dmA[0], dmT: dmT[0], rr: rr[0] });
  snap.sources = [
    { n: 'ukrainealarm', ok: !!ua[0], d: ua[1], what: 'Тривоги · повітряні цілі' },
    { n: 'dimap', ok: !!(dmA[0] || dmT[0]), d: dmA[0] ? (dmT[0] ? 'OK' : 'без цілей') : dmA[1], what: 'Тривоги · цілі (пріоритет)' },
    { n: 'radarua', ok: !!rr[0], d: rr[1], what: 'Тривоги' },
  ];
  snap.ok = !!(ua[0] || dmA[0] || rr[0]);
  snap.at = new Date().toISOString();
  return snap;
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
  for (const t of snap.targets || []) {
    const d = distKm(t.la, t.lo, c.la, c.lo);
    if (!nearest || d < nearest.d) nearest = { d, k: t.k };
    if (d < 25) { high = true; continue; }
    if (d < 120 && t.b != null && angleDiff(t.b, bearing(t.la, t.lo, c.la, c.lo)) < 25) high = true;
    if (t.k === 'ballistic' && d < 400) high = true;
  }
  return { level: st ? st[0] : 0, since: st ? st[1] : 0, high, nearest };
}

const KIND_UA = { drone: 'Шахед', missile: 'Ракета', ballistic: 'Балістика', aircraft: 'Авіація', unknown: 'Ціль' };
const mins = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} хв` : `${Math.floor(m / 60)} год${m % 60 ? ' ' + (m % 60) + ' хв' : ''}`; };

// Раз на хвилину: тривога / відбій / висока загроза для міста кожного підписника.
// Стан міст — у KV, але пишемо лише коли щось змінилось (ліміт записів KV).
export async function alertTick(env, getSubs, sendPush, localize) {
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
      if (on && s.high && now - (was.h || 0) > 15 * 60000) { cur.h = now; ev.push({ kind: 'high', title: `⚠ Висока загроза · ${c.n}`, body: s.nearest ? `${KIND_UA[s.nearest.k] || 'Ціль'} ~${Math.round(s.nearest.d)} км від міста. Будьте в укритті.` : 'Ціль поруч із містом. Будьте в укритті.' }); }
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
