// Electrocity — сервер на Cloudflare Workers (безкоштовний тариф).
// • раз на 15 хв збирає графіки з офіційних джерел → KV
// • відправляє Web Push: зміни графіка, графік на завтра, нагадування перед відключенням/відновленням
// • проксі пошуку черги за адресою для ДТЕК (потрібні CSRF + cookie сайту)
// • усе інше — статичні файли застосунку (ASSETS)
import { parseDtek, parseHoe, parseMoe, SOURCES } from './sources.js';
import { sendPush, vapidKeys } from './push.js';
import { hoeAddress, moeAddress, dtekStreet, dtekHouseStatus, addressStatus, DTEK_NAME, DTEK_RUNNER, dtekViaRunner, dtekQueue, dtekStore, PW, pwAddress, choeCities, choeGet, poeCities, poeStreets, poeHouses, poeInfo, poeQueue, hoeLive, hoeQueueFrom } from './outages.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...h } });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// ---------- час за Києвом ----------
function kyiv(d = new Date()) {
  const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach(x => p[x.type] = x.value);
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hm = m => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const hmEnd = m => (m >= 1440 ? '24:00' : hm(m));
const dur = m => { const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h} год ${r} хв` : h ? `${h} год` : `${r} хв`; };
const isOff = s => s === 'off' || s === 'emergency';
const offs = segs => (segs || []).filter(s => isOff(s[2]) || s[2] === 'possible');
const fmtOffs = segs => offs(segs).map(s => `${hm(s[0])}–${hmEnd(s[1])}${s[2] === 'possible' ? ' (можливо)' : ''}`).join(', ') || 'без відключень';

// ---------- HTTP ----------
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const p = url.pathname.replace(/^\/electrocity/, '');
    try {
      if (p.startsWith('/api/schedules/')) {
        const op = p.split('/').pop().replace('.json', '');
        const d = await env.KV.get('sched:' + op);
        return d ? new Response(d, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30', ...CORS } }) : json({ error: 'not found' }, 404);
      }
      if (p === '/api/vapid') return json({ key: (await vapidKeys(env)).publicB64 });
      if (p === '/api/push/subscribe' && req.method === 'POST') return json(await subscribe(env, await req.json()));
      if (p === '/api/push/unsubscribe' && req.method === 'POST') return json(await unsubscribe(env, (await req.json()).endpoint));
      // діагностика підписок (без ендпоінтів і ключів), лише з секретом
      if (p === '/api/internal/push-state') {
        if (!env.DTEK_KEY || req.headers.get('X-Key') !== env.DTEK_KEY) return json({ error: 'forbidden' }, 403);
        const subs = await getSubs(env);
        return json({ lastpush: await env.KV.get('lastpush', 'json'), lasttick: await (await caches.default.match(new Request('https://cache.electrocity/lasttick')))?.json().catch(() => null), count: Object.keys(subs).length, subs: Object.values(subs).map(x => ({ host: new URL(x.sub.endpoint).host, lead: x.lead, types: x.types, addrs: (x.addrs || []).map(a => `${a.op} ${a.queue} ${a.name}`), seen: (x.seen || []).length })) });
      }
      if (p === '/api/internal/push-run') { // запустити розсилку зараз і показати, що надіслано
        if (!env.DTEK_KEY || req.headers.get('X-Key') !== env.DTEK_KEY) return json({ error: 'forbidden' }, 403);
        await tick(env, false); return json({ lastPush, stored: await env.KV.get('lastpush', 'json') });
      }
      if (p === '/api/push/test' && req.method === 'POST') {
        const { endpoint } = await req.json(); const subs = await getSubs(env); const s = subs[await idOf(endpoint)];
        if (!s) return json({ ok: false, error: 'not subscribed' }, 404);
        const r = await sendPush(env, s.sub, localize({ title: 'Electrocity', body: 'Сповіщення працюють ✓', tag: 'test' }, s.lang));
        return json({ ok: r.ok, status: r.status });
      }
      if (p === '/api/outage') { const n = kyiv(); return json(await addressStatus(env, url.searchParams, ctx, `${n.date}T${String(Math.floor(n.min / 60)).padStart(2, '0')}:${String(n.min % 60).padStart(2, '0')}`), 200, { 'Cache-Control': 'public, max-age=120' }); }
      // YASNO (ДТЕК): довідник адрес і група за адресою — Київ (25/902) і Дніпропетровщина (3/301)
      // Львівобленерго: довідник адрес і черга кожного будинку (power-api.loe.lviv.ua)
      if (p.startsWith('/api/pw/')) { const k = p.slice(8); return json(await pwDir(k, url.searchParams, ctx, env), 200, { 'Cache-Control': k === 'queue' ? 'no-store' : 'public, max-age=3600' }); }
      if (p.startsWith('/api/yasno/')) return json(await yasnoAddr(p.slice(11), url.searchParams, ctx), 200, { 'Cache-Control': 'public, max-age=3600' });
      if (p === '/api/dtek/houses') { const r = await dtekHouses(url.searchParams, ctx, env); return json(r, 200, { 'Cache-Control': r.pending ? 'no-store' : 'public, max-age=3600' }); }
      // службові маршрути для GitHub Actions (секрет DTEK_KEY)
      if (p.startsWith('/api/internal/')) {
        if (!env.DTEK_KEY || req.headers.get('X-Key') !== env.DTEK_KEY) return json({ error: 'forbidden' }, 403);
        if (p === '/api/internal/dtek-queue') return json({ items: await dtekQueue(env) });
        if (p === '/api/internal/dtek-result' && req.method === 'POST') return json({ ok: true, stored: await dtekStore(env, (await req.json()).results) });
      }
      if (p === '/api/stats/install' && req.method === 'POST') {
        const { platform } = await req.json().catch(() => ({}));
        const st = JSON.parse(await env.KV.get('stats') || '{"installs":0,"by":{}}');
        const pl = ['ios', 'android', 'mac', 'windows', 'other'].includes(platform) ? platform : 'other';
        st.installs++; st.by[pl] = (st.by[pl] || 0) + 1;
        await env.KV.put('stats', JSON.stringify(st));
        return json({ ok: true });
      }
      if (p === '/api/stats') return json(JSON.parse(await env.KV.get('stats') || '{"installs":0,"by":{}}'));
      if (p === '/api/badge/installs') { const st = JSON.parse(await env.KV.get('stats') || '{"installs":0}');
        return json({ schemaVersion: 1, label: 'встановлень', message: String(st.installs), color: 'E39A0B', labelColor: '1B1B1B' }, 200, { 'Cache-Control': 'max-age=300' }); }
      if (p === '/api/status') return json({ ok: true, ...(JSON.parse(await env.KV.get('status') || '{}')) });
      if (p === '/api/tick') { // ручний запуск збору (кнопка «Перевірити», відкриття застосунку), не частіше разу на 2 хв
        const lockKey = new Request('https://lock.local/tick'); const c = caches.default;
        if (await c.match(lockKey)) return json({ error: 'too soon' }, 429);
        await c.put(lockKey, new Response('1', { headers: { 'Cache-Control': 'max-age=120' } }));
        const t0 = Date.now(); const st = await tick(env, true); return json({ ms: Date.now() - t0, status: st });
      }
      if (p.startsWith('/api/')) return json({ error: 'not found' }, 404);
    } catch (e) { return json({ error: String(e.message || e) }, 500); }
    return env.ASSETS.fetch(req);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
};

let lastPush = null;
// ---------- збір + сповіщення (раз на 15 хв) ----------
async function tick(env, manual = false) {
  const now = kyiv();
  const status = {};
  const prevStatus = JSON.parse(await env.KV.get('status') || '{}');
  const changes = [];
  const data = {};
  await Promise.all(SOURCES.map(async src => {
    let prevTxt = await env.KV.get('sched:' + src.op);
    const prev = prevTxt ? JSON.parse(prevTxt) : null;
    data[src.op] = prev;
    try {
      const fresh = await src.fetch(fetchText, prev);
      const days = Object.fromEntries(Object.entries(fresh.days).filter(([d]) => d >= now.date).sort());
      if (!Object.keys(days).length) {
        // джерело працює, але чинного графіка немає — зберігаємо порожній запис (раз), щоб застосунок не показував демо
        // ніколи не затираємо чинний графік: порожній запис — лише якщо збереженого графіка на сьогодні/завтра теж немає
        if (!prev || (!prev.empty && !Object.keys(prev.days || {}).some(d => d >= now.date))) {
          const next = { operator: fresh.operator, name: fresh.name, source: fresh.source, days: {}, empty: true, publishedAt: fresh.publishedAt || null, updatedAt: prev?.updatedAt || new Date(0).toISOString() };
          await env.KV.put('sched:' + src.op, JSON.stringify(next)); data[src.op] = next;
        }
        status[src.op] = { ok: true, empty: true, at: new Date().toISOString() }; return;
      }
      const same = prev && JSON.stringify(prev.days) === JSON.stringify(days) && prev.publishedAt === fresh.publishedAt && (prev.notice || null) === (fresh.notice || null);
      if (!same) {
        const next = { ...fresh, days, updatedAt: new Date().toISOString() };
        await env.KV.put('sched:' + src.op, JSON.stringify(next));
        data[src.op] = next;
        if (prev) changes.push(...diff(src.op, prev.days, days, now));
      }
      status[src.op] = { ok: true, at: new Date().toISOString(), ...(fresh.problems?.length ? { warn: `частину днів не розпізнано: ${fresh.problems.join(', ')}` } : {}) };
    } catch (e) {
      const ps = prevStatus[src.op]; const at = new Date().toISOString();
      // since — з якого часу джерело не читається (для моніторингу: лист, якщо довше 2 год)
      status[src.op] = { ok: false, error: String(e.message || e).slice(0, 160), at, since: ps && ps.ok === false ? (ps.since || ps.at) : at };
    }
  }));
  // статус пишемо рідко (ліміт записів KV): раз на 30 хв або при помилці
  // …і лише якщо щось змінилось (окрім часу перевірки), щоб часті ручні перевірки не з'їли ліміт
  const sig = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]?.ok, o[k]?.error, o[k]?.warn, o[k]?.empty]));
  const changed = sig(status) !== sig(prevStatus);
  if ((now.min % 30 === 0 && !manual) || changed) await env.KV.put('status', JSON.stringify(status)).catch(() => {});

  // Ручна перевірка (кнопка «Перевірити», відкриття застосунку) теж може першою побачити новий/змінений графік.
  // Тоді сповіщення про зміни надсилаємо одразу тут — інакше плановий запуск уже не побачить різниці й нічого не надішле.
  // Нагадування перед відключенням і аварії за адресою — лише в плановому запуску (щоб не дублювати).
  if (manual && !changes.length) return status;
  const subs = await getSubs(env);
  const ids = Object.keys(subs);
  if (!ids.length) return status;
  // Хмельницька: раз на годину дивимось події підписаних адрес — так запам'ятовуємо їхню свіжу чергу (видно лише в подіях)
  if (!manual && now.min % 60 < 15) { const seenA = new Set(); for (const s of Object.values(subs)) for (const a of s.addrs || []) {
    if (a.op !== 'hoe' || !a.street || !a.house) continue; const k = `${a.city}|${a.street}|${a.house}`; if (seenA.has(k) || seenA.size >= 10) continue; seenA.add(k);
    await hoeLive({ city: a.city, street: a.street, house: a.house }, { waitUntil: () => {} }, env).catch(() => null); } }
  const outbox = []; let seenChanged = false;
  for (const id of ids) {
    const s = subs[id];
    for (const a of s.addrs || []) {
      const t = s.types || {};
      for (const c of changes) if (c.op === a.op && c.queue === a.queue && t[c.kind] !== false)
        outbox.push({ id, msg: { title: `${a.name} · ${c.title}`, body: c.body, tag: `${c.kind}-${a.op}-${a.queue}-${c.date}` } });
      const r = manual ? null : reminder(data[a.op], a, s.lead ?? 30, now, t);
      if (r) outbox.push({ id, msg: r });
      // аварія / планові роботи саме за адресою
      if (!manual && t.address !== false && a.street && a.house) {
        const items = await addrItems(env, a, now).catch(() => []);
        for (const it of items) {
          if (it.kind === 'schedule') continue;
          const key = `${a.op}|${a.city}|${a.street}|${a.house}|${it.kind}|${it.start}|${it.end}`;
          s.seen ||= [];
          if (s.seen.includes(key)) continue;
          s.seen.push(key); s.seen = s.seen.slice(-40); seenChanged = true;
          outbox.push({ id, msg: addrMsg(a, it) });
        }
      }
    }
  }
  let dead = false; const sent = [];
  await Promise.all(outbox.map(async o => {
    const r = await sendPush(env, subs[o.id].sub, localize(o.msg, subs[o.id].lang)).catch(e => ({ status: 0, err: String(e?.message || e) }));
    sent.push({ title: o.msg.title, status: r.status, err: r.err });
    if (r.status === 404 || r.status === 410) { delete subs[o.id]; dead = true; }
  }));
  lastPush = { at: new Date().toISOString(), now: now.min, subs: ids.length, outbox: outbox.length, sent };
  if (outbox.length) await env.KV.put('lastpush', JSON.stringify(lastPush)).catch(() => {}); // останнє надсилання — для діагностики
  if (dead || seenChanged) await env.KV.put('subs', JSON.stringify(subs));
  // відмітка «плановий запуск дійшов до кінця» (Cache API, не витрачає ліміт KV)
  if (!manual) await caches.default.put(new Request('https://cache.electrocity/lasttick'), new Response(JSON.stringify({ at: new Date().toISOString(), min: now.min, outbox: outbox.length }), { headers: { 'Cache-Control': 'max-age=86400' } })).catch(() => {});
  return status;
}

const hhmm = iso => iso ? iso.slice(11, 16) : '…';
const dm = iso => iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : '';
async function addrItems(env, a, now) {
  const nowIso = `${now.date}T${String(Math.floor(now.min / 60)).padStart(2, '0')}:${String(now.min % 60).padStart(2, '0')}`;
  if (a.op === 'hoe') return (await hoeAddress(env, a, nowIso)).items;
  if (a.op === 'moe') return (await moeAddress(a, nowIso)).items.filter(it => it.kind !== 'schedule');
  if (a.op in PW) return (await pwAddress(a.op, a, nowIso)).items;
  if (DTEK_RUNNER.has(a.op)) { if (!env.DTEK_KEY) return []; const raw = await dtekViaRunner(env, a.op, a.city, a.street); return raw ? dtekHouseStatus(raw, a.op, a.house).items : []; }
  if (DTEK_NAME[a.op]) return dtekHouseStatus(await dtekStreet(a.op, a.city, a.street), a.op, a.house).items;
  return [];
}
function addrMsg(a, it) {
  const when = it.start && it.end && it.start.slice(0, 10) === it.end.slice(0, 10) ? `${dm(it.start)} ${hhmm(it.start)}–${hhmm(it.end)}` : `${dm(it.start)} ${hhmm(it.start)} – ${dm(it.end)} ${hhmm(it.end)}`;
  return it.kind === 'emergency'
    ? { title: `⚠ ${a.name} · аварійне відключення`, body: `За адресою ${a.street}, ${a.house}: ${when}. ${it.reason || ''}`.trim(), tag: `addr-${a.op}-${a.street}-${a.house}` }
    : { title: `${a.name} · планові роботи`, body: `За адресою ${a.street}, ${a.house}: ${when}. ${it.reason || ''}`.trim(), tag: `addr-plan-${a.op}-${a.street}-${a.house}-${it.start}` };
}

async function fetchText(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, 'Accept-Language': 'uk-UA,uk;q=0.9', ...(init.headers || {}) }, cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// Що змінилось для кожної черги
function diff(op, oldDays, newDays, now) {
  const out = [];
  for (const [date, queues] of Object.entries(newDays)) {
    const label = date === now.date ? 'сьогодні' : date === addDays(now.date, 1) ? 'завтра' : date.split('-').reverse().slice(0, 2).join('.');
    for (const [q, segs] of Object.entries(queues)) {
      const old = oldDays?.[date]?.[q];
      if (!old) {
        if (date > now.date) { const o = offs(segs).filter(s => isOff(s[2])); const total = o.reduce((t, s) => t + s[1] - s[0], 0);
          out.push({ op, queue: q, date, kind: 'tomorrow', title: `графік на ${label}`, body: o.length ? `Відключення: ${fmtOffs(segs)} · разом ${dur(total)}` : 'Відключень не заплановано' }); }
        continue;
      }
      if (JSON.stringify(offs(old)) !== JSON.stringify(offs(segs)))
        out.push({ op, queue: q, date, kind: 'change', title: `графік на ${label} змінено`, body: `Тепер: ${fmtOffs(segs)}. Було: ${fmtOffs(old)}` });
    }
  }
  return out;
}

// Нагадування за N хв до відключення / відновлення
function reminder(data, a, lead, now, t) {
  if (!data?.days) return null;
  const today = data.days[now.date]?.[a.queue]; if (!today) return null;
  const tom = data.days[addDays(now.date, 1)]?.[a.queue] || [];
  const all = [...today, ...tom.map(s => [s[0] + 1440, s[1] + 1440, s[2]])];
  const i = all.findIndex(s => now.min >= s[0] && now.min < s[1]); if (i < 0) return null;
  const curOff = isOff(all[i][2]);
  for (let k = i + 1; k < all.length; k++) {
    if (all[k][2] === 'unknown') return null;
    if (isOff(all[k][2]) !== curOff) {
      const left = all[k][0] - now.min;
      if (left > lead || left <= lead - 15) return null; // збір раз на 15 хв — вікно 15 хв
      if (!curOff && t.before !== false) { const end = all.slice(k).find(s => !isOff(s[2])); return { title: `${a.name} · відключення через ${left} хв`, body: `За графіком ${hm(all[k][0])}–${end ? hm(end[0]) : '…'} · черга ${a.queue}`, tag: `before-${a.op}-${a.queue}` }; }
      if (curOff && t.restore !== false) return { title: `${a.name} · світло через ${left} хв`, body: `За графіком відновлення о ${hm(all[k][0])} · черга ${a.queue}`, tag: `restore-${a.op}-${a.queue}` };
      return null;
    }
  }
  return null;
}

// ---------- переклад сповіщень (en/de) ----------
const L10N = {
  en: [[/аварійне відключення/, 'emergency outage'], [/планові роботи/, 'planned works'], [/^За адресою /, 'At '], [/Сповіщення працюють ✓/, 'Notifications work ✓'], [/графік на сьогодні змінено/, 'today’s schedule changed'], [/графік на завтра змінено/, 'tomorrow’s schedule changed'],
    [/графік на (\S+) змінено/, 'schedule for $1 changed'], [/графік на сьогодні/, 'schedule for today'], [/графік на завтра/, 'schedule for tomorrow'], [/графік на (\S+)/, 'schedule for $1'],
    [/Відключень не заплановано/, 'No outages planned'], [/Відключення: /, 'Outages: '], [/ · разом /, ' · total '], [/Тепер: /, 'Now: '], [/\. Було: /, '. Before: '],
    [/відключення через (\d+) хв/, 'outage in $1 min'], [/світло через (\d+) хв/, 'power back in $1 min'], [/За графіком відновлення о /, 'Scheduled to return at '],
    [/За графіком /, 'Scheduled '], [/ · черга /, ' · queue '], [/(\d+) год/g, '$1 h'], [/(\d+) хв/g, '$1 min'],
    [/^Дім/, 'Home'], [/^Робота/, 'Work'], [/^Батьки/, 'Parents'], [/^Дача/, 'Cottage'], [/^Інше/, 'Other'], [/^Адреса/, 'Address']],
  de: [[/аварійне відключення/, 'Notabschaltung'], [/планові роботи/, 'geplante Arbeiten'], [/^За адресою /, 'Adresse '], [/Сповіщення працюють ✓/, 'Benachrichtigungen funktionieren ✓'], [/графік на сьогодні змінено/, 'Plan für heute geändert'], [/графік на завтра змінено/, 'Plan für morgen geändert'],
    [/графік на (\S+) змінено/, 'Plan für $1 geändert'], [/графік на сьогодні/, 'Plan für heute'], [/графік на завтра/, 'Plan für morgen'], [/графік на (\S+)/, 'Plan für $1'],
    [/Відключень не заплановано/, 'Keine Abschaltungen geplant'], [/Відключення: /, 'Abschaltungen: '], [/ · разом /, ' · gesamt '], [/Тепер: /, 'Jetzt: '], [/\. Було: /, '. Vorher: '],
    [/відключення через (\d+) хв/, 'Abschaltung in $1 Min.'], [/світло через (\d+) хв/, 'Strom zurück in $1 Min.'], [/За графіком відновлення о /, 'Laut Plan zurück um '],
    [/За графіком /, 'Laut Plan '], [/ · черга /, ' · Gruppe '], [/(\d+) год/g, '$1 Std.'], [/(\d+) хв/g, '$1 Min.'],
    [/^Дім/, 'Zuhause'], [/^Робота/, 'Arbeit'], [/^Батьки/, 'Eltern'], [/^Дача/, 'Datscha'], [/^Інше/, 'Andere'], [/^Адреса/, 'Adresse']],
};
function localize(msg, lang) {
  const rules = L10N[lang]; if (!rules) return msg;
  const t = x => rules.reduce((a, [re, to]) => a.replace(re, to), String(x || ''));
  return { ...msg, title: t(msg.title), body: t(msg.body) };
}

// ---------- підписки ----------
async function idOf(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function getSubs(env) { return JSON.parse(await env.KV.get('subs') || '{}'); }
async function subscribe(env, body) {
  const { subscription, addrs, lead, types, lang } = body || {};
  if (!subscription?.endpoint || !subscription?.keys?.p256dh) throw new Error('bad subscription');
  const clean = (addrs || []).slice(0, 10).map(a => ({ op: String(a.op).slice(0, 20), queue: String(a.queue).slice(0, 8), name: String(a.name || 'Адреса').slice(0, 20), city: String(a.city || '').slice(0, 60), street: String(a.street || '').slice(0, 80), house: String(a.house || '').slice(0, 12) }));
  const subs = await getSubs(env);
  const id = await idOf(subscription.endpoint);
  const next = { sub: { endpoint: subscription.endpoint, keys: subscription.keys }, addrs: clean, seen: subs[id]?.seen || [], lead: [15, 30, 60].includes(+lead) ? +lead : 30, types: types || {}, lang: ['en', 'de'].includes(lang) ? lang : 'uk' };
  if (JSON.stringify(subs[id]) === JSON.stringify(next)) return { ok: true, id, unchanged: true };
  subs[id] = next;
  await env.KV.put('subs', JSON.stringify(subs));
  return { ok: true, id };
}
async function unsubscribe(env, endpoint) {
  const subs = await getSubs(env); const id = await idOf(endpoint || '');
  if (subs[id]) { delete subs[id]; await env.KV.put('subs', JSON.stringify(subs)); }
  return { ok: true };
}

// ---------- ДТЕК: будинки й черги для вулиці ----------
const DTEK_HOST = { 'dtek-oem': 'https://www.dtek-oem.com.ua', 'dtek-dnem': 'https://www.dtek-dnem.com.ua', 'dtek-kem': 'https://www.dtek-kem.com.ua', 'dtek-krem': 'https://www.dtek-krem.com.ua', 'dtek-dem': 'https://www.dtek-dem.com.ua' };
async function dtekHouses(params, ctx, env) {
  const op = params.get('op'), city = params.get('city'), street = params.get('street');
  const host = DTEK_HOST[op]; if (!host || !city || !street) throw new Error('потрібні op, city, street');
  if (DTEK_RUNNER.has(op) && env.DTEK_KEY) {
    const raw = await dtekViaRunner(env, op, city, street);
    if (!raw) return { op, city, street, pending: true, houses: {} };
    return { op, city, street, houses: Object.fromEntries(Object.entries(raw.data).map(([h, v]) => [h, (v.sub_type_reason || []).map(g => g.replace(/^GPV/, ''))])) };
  }
  const cacheKey = new Request(`https://cache.electrocity/dtek/${op}/${encodeURIComponent(city)}/${encodeURIComponent(street)}`);
  const cached = await caches.default.match(cacheKey); if (cached) return cached.json();
  const page = await fetch(`${host}/ua/shutdowns`, { headers: { 'User-Agent': UA, 'Accept-Language': 'uk-UA' } });
  const html = await page.text();
  const token = html.match(/<meta name="csrf-token" content="([^"]+)"/)?.[1];
  if (!token) throw new Error('ДТЕК не віддав токен (захист сайту)');
  const cookies = (page.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const body = new URLSearchParams();
  body.append('method', 'getHomeNum');
  body.append('data[0][name]', 'city'); body.append('data[0][value]', city);
  body.append('data[1][name]', 'street'); body.append('data[1][value]', street);
  const r = await fetch(`${host}/ua/ajax`, { method: 'POST', headers: { 'User-Agent': UA, 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: cookies, Referer: `${host}/ua/shutdowns` }, body });
  const j = await r.json();
  if (!j?.data) throw new Error('ДТЕК не повернув будинки');
  const houses = Object.fromEntries(Object.entries(j.data).map(([h, v]) => [h, (v.sub_type_reason || []).map(g => g.replace(/^GPV/, ''))]));
  const res = { op, city, street, houses };
  ctx.waitUntil(caches.default.put(cacheKey, new Response(JSON.stringify(res), { headers: { 'Cache-Control': 'max-age=21600' } })));
  return res;
}

const YASNO_IDS = { 'dtek-kem': [25, 902], 'dtek-dnem': [3, 301] };

// Варіанти запиту до YASNO: без «вул./просп./бульв.», окремі слова (≥3 літер), російські літери → українські
const ADDR_PREFIX = /^(вулиця|вул|улица|ул|проспект|просп|пр-т|пр|бульвар|бульв|бул|б-р|провулок|пров|переулок|пер|площа|площадь|пл|набережна|наб|шосе|узвіз|тупик|туп|майдан|місто|город|м|г|село|с|селище|смт|пгт)\.?\s+/i;
export function yasnoVariants(raw) {
  let q = String(raw || '').replace(/[«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) q = q.replace(ADDR_PREFIX, '');
  q = q.replace(/[,]+/g, ' ').replace(/\s+\d+[а-яіїєa-z]?$/i, '').trim(); // «Хрещатик 22» → «Хрещатик»
  // російська розкладка на українських словах: і→ы, ї→ъ, є→э («Лесы» = «Лесі»); російське написання: ы→и, э→е, ё→е
  const lay = s => s.replace(/ы/g, 'і').replace(/Ы/g, 'І').replace(/ъ/g, 'ї').replace(/Ъ/g, 'Ї').replace(/э/g, 'є').replace(/Э/g, 'Є').replace(/ё/g, 'е');
  const ru = s => s.replace(/ы/g, 'и').replace(/Ы/g, 'И').replace(/э/g, 'е').replace(/Э/g, 'Е').replace(/ё/g, 'е').replace(/ъ/g, '’');
  const out = [];
  const add = v => { v = v.trim(); if (v.length >= 3 && !out.includes(v)) out.push(v); };
  const hasRu = /[ыэъё]/i.test(q);
  add(q); if (hasRu) { add(lay(q)); add(ru(q)); }
  const words = q.split(/[\s.\-]+/).filter(w => w.length >= 3).sort((a, b) => b.length - a.length);
  for (const w of words.slice(0, 2)) { add(w); if (hasRu) { add(lay(w)); add(ru(w)); } else if (/и/i.test(w)) add(w.replace(/и/g, 'і')); }
  // на випадок помилки в кінці слова — початок довгого слова
  if (words[0]?.length > 5) add((hasRu ? lay(words[0]) : words[0]).slice(0, 5));
  return out.slice(0, 8);
}

async function yasnoAddr(kind, q, ctx) {
  const ids = YASNO_IDS[q.get('op')]; if (!ids) throw new Error('регіон не підтримується');
  const [region, dso] = ids; const B = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/addresses/v2';
  const P = new URLSearchParams({ regionId: region, dsoId: dso });
  if (kind === 'cities') P.set('query', q.get('q') || '');
  else if (kind === 'streets') { P.set('query', q.get('q') || ''); if (q.get('cityId')) P.set('cityId', q.get('cityId')); }
  else if (kind === 'houses') { if (q.get('cityId')) P.set('cityId', q.get('cityId')); P.set('streetId', q.get('streetId')); P.set('query', q.get('q') || ''); }
  else if (kind === 'group') { if (q.get('cityId')) P.set('cityId', q.get('cityId')); P.set('streetId', q.get('streetId')); P.set('houseId', q.get('houseId')); }
  else throw new Error('невідомий запит');
  // Пошук вулиць/міст: YASNO шукає підрядок і віддає ≤20 збігів, тож «вул Хрещатик», «Лесі Українки» (у YASNO — «Українки Лесі»)
  // чи російське «улица Победы» напряму не знаходяться. Робимо кілька запитів (ціла фраза без «вул.», кожне слово, українські
  // варіанти російських літер) і об'єднуємо — далі застосунок сам ранжує.
  if ((kind === 'streets' || kind === 'cities') && !q.get('raw')) {
    const variants = yasnoVariants(q.get('q') || '');
    if (!variants.length) return [];
    const lists = await Promise.all(variants.map(v => { const n = new URLSearchParams(q); n.set('q', v); n.set('raw', '1'); return yasnoAddr(kind, n, ctx).catch(() => []); }));
    const seen = new Set(); return lists.flat().filter(x => !seen.has(x.id) && seen.add(x.id)).slice(0, 60);
  }
  const u = `${B}/${kind}?${P}`; const ck = new Request(`https://cache.electrocity/yasno/${kind}?${P}`);
  const hit = await caches.default.match(ck); if (hit) return hit.json();
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); if (!r.ok) throw new Error(`YASNO ${r.status}`);
  const j = await r.json();
  const out = kind === 'group' ? { queue: j?.group ? `${j.group}.${j.subgroup || 1}` : null } : (j || []).map(x => ({ id: x.id, label: x.value }));
  ctx.waitUntil(caches.default.put(ck, new Response(JSON.stringify(out), { headers: { 'Cache-Control': `max-age=${kind === 'group' ? 21600 : 86400}` } })));
  return out;
}

// Житомиробленерго: звичайна форма ztoe.com.ua/unhooking-search.php (POST rem_id → naspunkt_id → vulica_id, кодування windows-1251).
// Відповідь — таблиця «РЕМ | Нас. пункт | Вулиця | Будинки | Черга | Підчерга | Примітка». Беремо побутових споживачів.
const ZT = 'https://www.ztoe.com.ua/unhooking-search.php';
const ztOpts = (html, name) => { const m = html.match(new RegExp(`<select[^>]*name=["']?${name}["']?[^>]*>([\\s\\S]*?)</select>`, 'i')); return m ? [...m[1].matchAll(/<option[^>]*value=["']?(\d+)["']?[^>]*>([^<]*)/gi)].filter(o => o[1] !== '0').map(o => ({ id: o[1], label: o[2].replace(/\s+/g, ' ').trim() })) : []; };
async function ztPost(form) {
  const r = await fetch(ZT, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  if (!r.ok) throw new Error(`Житомиробленерго: HTTP ${r.status}`);
  return new TextDecoder('windows-1251').decode(await r.arrayBuffer());
}
export function ztHouses(html) {
  // рядки результату — <tr> із 7 клітинками, остання «… споживачі». Сайт віддає лише ~10 рядків за запит,
  // тож список будинків вулиці може бути неповним — тоді застосунок пропонує обрати чергу вручну.
  const rows = html.split(/<tr[\s>]/i).slice(1).map(ch => [...ch.split(/<\/table/i)[0].matchAll(/<td[^>]*>([\s\S]*?)(?=<\/td>|<td|<\/tr|$)/gi)].map(c => c[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())).filter(c => c.length >= 7 && /споживач/i.test(c[6]));
  const home = rows.filter(c => /побут/i.test(c[6] || '') && !/непобут/i.test(c[6] || ''));
  const m = {};
  for (const c of (home.length ? home : rows)) {
    if (!/^\d+$/.test(c[4]) || !/^\d+$/.test(c[5])) continue; const q = `${c[4]}.${c[5]}`;
    for (const h of c[3].split(/,\s*/).map(x => x.trim()).filter(Boolean)) (m[h] ||= new Set()).add(q);
  }
  return Object.entries(m).map(([label, qs]) => ({ label, queues: [...qs] })).sort((a, b) => a.label.localeCompare(b.label, 'uk', { numeric: true }));
}
async function ztDir(kind, q, ctx) {
  const ck = new Request(`https://cache.electrocity/zt1/${kind}?${q.get('cityId') || ''}&${q.get('streetId') || ''}`);
  const hit = await caches.default.match(ck); if (hit) return hit.json();
  let out;
  if (kind === 'cities') {
    const home = new TextDecoder('windows-1251').decode(await (await fetch(ZT, { headers: { 'User-Agent': UA } })).arrayBuffer());
    const rems = ztOpts(home, 'rem_id'); if (!rems.length) throw new Error('Житомиробленерго: список РЕМ не знайдено (формат змінився)');
    const lists = await Promise.all(rems.map(async rm => ztOpts(await ztPost({ rem_id: rm.id }), 'naspunkt_id').map(c => ({ id: `${rm.id}-${c.id}`, label: c.label.replace(/^місто /, 'м. '), sub: `${rm.label} РЕМ` }))));
    out = lists.flat();
  } else {
    const [rem, ns] = String(q.get('cityId') || '').split('-');
    if (!/^\d+$/.test(rem || '') || !/^\d+$/.test(ns || '')) throw new Error('невідомий населений пункт');
    if (kind === 'streets') out = ztOpts(await ztPost({ rem_id: rem, naspunkt_id: ns }), 'vulica_id');
    else if (kind === 'houses') { if (!/^\d+$/.test(q.get('streetId') || '')) throw new Error('невідома вулиця'); out = ztHouses(await ztPost({ rem_id: rem, naspunkt_id: ns, vulica_id: q.get('streetId') })); }
    else throw new Error('невідомий запит');
  }
  ctx.waitUntil(caches.default.put(ck, new Response(JSON.stringify(out), { headers: { 'Cache-Control': `max-age=${kind === 'houses' ? 21600 : 604800}` } })));
  return out;
}

// Черкасиобленерго: відкритий довідник адрес пошуку «По адресі» (без особових рахунків)
async function choeDir(kind, q, ctx) {
  if (kind === 'cities') return (await choeCities(ctx)).map(([id, label, sub]) => ({ id, label, sub }));
  const ck = new Request(`https://cache.electrocity/choe1/${kind}?${q.get('cityId') || ''}&${q.get('streetId') || ''}`);
  const hit = await caches.default.match(ck); if (hit) return hit.json();
  let out;
  if (kind === 'streets') { const c = String(q.get('cityId') || '').split('-')[1]; if (!/^\d+$/.test(c || '')) throw new Error('невідомий населений пункт');
    out = (await choeGet(`op=street_list&city_id=${c}&search_name=`)).filter(x => !/^\*/.test(x.NAME)).map(x => ({ id: String(x.ID), label: String(x.NAME).trim() })); }
  else if (kind === 'houses') { if (!/^\d+$/.test(q.get('streetId') || '')) throw new Error('невідома вулиця');
    out = (await choeGet(`op=house_list&street_id=${q.get('streetId')}&search_name=`)).map(x => String(x.HOUSE).trim()).filter(h => h && h !== '0').map(label => ({ label })); }
  else throw new Error('невідомий запит');
  ctx.waitUntil(caches.default.put(ck, new Response(JSON.stringify(out), { headers: { 'Cache-Control': 'max-age=604800' } })));
  return out;
}

// Полтаваобленерго: довідник адрес і черга будинку з відкритого пошуку сайту
async function poeDir(kind, q, ctx) {
  if (kind === 'cities') return (await poeCities(ctx)).map(([id, label, sub]) => ({ id, label, sub: `${sub} дільниця` }));
  const cid = String(q.get('cityId') || ''); if (!/^\d+-\d+$/.test(cid)) throw new Error('невідомий населений пункт');
  if (kind === 'streets') return (await poeStreets(cid, ctx)).map(([id, label]) => ({ id, label }));
  const sid = String(q.get('streetId') || ''); if (!/^\d+$/.test(sid)) throw new Error('невідома вулиця');
  if (kind === 'houses') return (await poeHouses(cid, sid, ctx)).map(label => ({ label, remote: true }));
  if (kind === 'queue') { const info = await poeInfo(cid, sid, String(q.get('house') || ''), ctx); return { queue: poeQueue(info), multi: !!(info && +info.message_type === 0 && /декілька/i.test(info.fn_accident_message || '')) }; }
  throw new Error('невідомий запит');
}

// Хмельницькобленерго: черга будинку з пошуку «Відключення за адресою»
async function hoeQueueApi(q, ctx, env) {
  const live = await hoeLive({ city: q.get('city') || '', street: q.get('street') || '', house: q.get('house') || '' }, ctx, env);
  return { found: !!live?.found, queues: live?.queues || [], at: live?.queuesAt || null, memory: !!live?.memory };
}

async function pwDir(kind, q, ctx, env) {
  if (q.get('op') === 'hoe' && kind === 'queue') return hoeQueueApi(q, ctx, env);
  if (q.get('op') === 'poe-poltava') return poeDir(kind, q, ctx);
  if (q.get('op') === 'zhoe') return ztDir(kind, q, ctx);
  if (q.get('op') === 'choe') return choeDir(kind, q, ctx);
  const P = PW[q.get('op')]; if (!P) throw new Error('регіон не підтримується');
  const path = kind === 'cities' ? '/pw_cities?pagination=false'
    : kind === 'streets' ? `/pw_streets?pagination=false&city.id=${+q.get('cityId')}`
    : kind === 'houses' ? `/pw_accounts?pagination=false&city.id=${+q.get('cityId')}&street.id=${+q.get('streetId')}` : null;
  if (!path) throw new Error('невідомий запит');
  const ck = new Request(`https://cache.electrocity/pwdir2/${q.get('op')}${path}`);
  const hit = await caches.default.match(ck); if (hit) return hit.json();
  const r = await fetch(P.api + path, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json(); const list = Array.isArray(j) ? j : (j['hydra:member'] || []);
  const out = kind === 'cities' ? list.map(c => ({ id: c.id, label: c.name, sub: c.otg?.name ? `${c.otg.name} громада` : '' }))
    : kind === 'streets' ? list.map(s => ({ id: s.id, label: s.name }))
    : Object.entries(list.reduce((m, h) => { const k = String(h.buildingName || '').trim(); if (k) (m[k] ||= new Set()); if (k && h.chergGpv) m[k].add(String(h.chergGpv)); return m; }, {}))
        .map(([label, qs]) => ({ label, queues: [...qs] })); // рахунки одного будинку → один будинок (черги об'єднуємо)
  ctx.waitUntil(caches.default.put(ck, new Response(JSON.stringify(out), { headers: { 'Cache-Control': `max-age=${kind === 'houses' ? 21600 : 604800}` } })));
  return out;
}
