// Electrocity — сервер на Cloudflare Workers (безкоштовний тариф).
// • щохвилини збирає графіки з офіційних джерел → KV
// • відправляє Web Push: зміни графіка, графік на завтра, нагадування перед відключенням/відновленням
// • проксі пошуку черги за адресою для ДТЕК (потрібні CSRF + cookie сайту)
// • усе інше — статичні файли застосунку (ASSETS)
import { parseDtek, parseHoe, parseMoe, SOURCES } from './sources.js';
import { sendPush, vapidKeys } from './push.js';

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
      if (p === '/api/push/test' && req.method === 'POST') {
        const { endpoint } = await req.json(); const subs = await getSubs(env); const s = subs[await idOf(endpoint)];
        if (!s) return json({ ok: false, error: 'not subscribed' }, 404);
        const r = await sendPush(env, s.sub, { title: 'Electrocity', body: 'Сповіщення працюють ✓', tag: 'test' });
        return json({ ok: r.ok, status: r.status });
      }
      if (p === '/api/dtek/houses') return json(await dtekHouses(url.searchParams, ctx), 200, { 'Cache-Control': 'public, max-age=3600' });
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
      if (p.startsWith('/api/')) return json({ error: 'not found' }, 404);
    } catch (e) { return json({ error: String(e.message || e) }, 500); }
    return env.ASSETS.fetch(req);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
};

// ---------- збір + сповіщення (щохвилини) ----------
async function tick(env) {
  const now = kyiv();
  const status = {};
  const changes = [];
  const data = {};
  await Promise.all(SOURCES.map(async src => {
    let prevTxt = await env.KV.get('sched:' + src.op);
    const prev = prevTxt ? JSON.parse(prevTxt) : null;
    data[src.op] = prev;
    try {
      const fresh = await src.fetch(fetchText);
      const days = Object.fromEntries(Object.entries(fresh.days).filter(([d]) => d >= now.date).sort());
      if (!Object.keys(days).length) throw new Error('немає днів');
      const same = prev && JSON.stringify(prev.days) === JSON.stringify(days) && prev.publishedAt === fresh.publishedAt;
      if (!same) {
        const next = { ...fresh, days, updatedAt: new Date().toISOString() };
        await env.KV.put('sched:' + src.op, JSON.stringify(next));
        data[src.op] = next;
        if (prev) changes.push(...diff(src.op, prev.days, days, now));
      }
      status[src.op] = { ok: true, at: new Date().toISOString() };
    } catch (e) { status[src.op] = { ok: false, error: String(e.message || e).slice(0, 120), at: new Date().toISOString() }; }
  }));
  // статус пишемо рідко (ліміт записів KV): раз на 30 хв або при помилці
  if (now.min % 30 === 0 || Object.values(status).some(s => !s.ok)) await env.KV.put('status', JSON.stringify(status)).catch(() => {});

  const subs = await getSubs(env);
  const ids = Object.keys(subs);
  if (!ids.length) return;
  const outbox = [];
  for (const id of ids) {
    const s = subs[id];
    for (const a of s.addrs || []) {
      const t = s.types || {};
      for (const c of changes) if (c.op === a.op && c.queue === a.queue && t[c.kind] !== false)
        outbox.push({ id, msg: { title: `${a.name} · ${c.title}`, body: c.body, tag: `${c.kind}-${a.op}-${a.queue}-${c.date}` } });
      const r = reminder(data[a.op], a, s.lead ?? 30, now, t);
      if (r) outbox.push({ id, msg: r });
    }
  }
  let dead = false;
  await Promise.all(outbox.map(async o => {
    const r = await sendPush(env, subs[o.id].sub, o.msg).catch(() => ({ status: 0 }));
    if (r.status === 404 || r.status === 410) { delete subs[o.id]; dead = true; }
  }));
  if (dead) await env.KV.put('subs', JSON.stringify(subs));
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
      if (left !== lead) return null;
      if (!curOff && t.before !== false) { const end = all.slice(k).find(s => !isOff(s[2])); return { title: `${a.name} · відключення через ${lead} хв`, body: `За графіком ${hm(all[k][0])}–${end ? hm(end[0]) : '…'} · черга ${a.queue}`, tag: `before-${a.op}-${a.queue}` }; }
      if (curOff && t.restore !== false) return { title: `${a.name} · світло через ${lead} хв`, body: `За графіком відновлення о ${hm(all[k][0])} · черга ${a.queue}`, tag: `restore-${a.op}-${a.queue}` };
      return null;
    }
  }
  return null;
}

// ---------- підписки ----------
async function idOf(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function getSubs(env) { return JSON.parse(await env.KV.get('subs') || '{}'); }
async function subscribe(env, body) {
  const { subscription, addrs, lead, types } = body || {};
  if (!subscription?.endpoint || !subscription?.keys?.p256dh) throw new Error('bad subscription');
  const clean = (addrs || []).slice(0, 10).map(a => ({ op: String(a.op).slice(0, 20), queue: String(a.queue).slice(0, 8), name: String(a.name || 'Адреса').slice(0, 20) }));
  const subs = await getSubs(env);
  const id = await idOf(subscription.endpoint);
  const next = { sub: { endpoint: subscription.endpoint, keys: subscription.keys }, addrs: clean, lead: [15, 30, 60].includes(+lead) ? +lead : 30, types: types || {} };
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
async function dtekHouses(params, ctx) {
  const op = params.get('op'), city = params.get('city'), street = params.get('street');
  const host = DTEK_HOST[op]; if (!host || !city || !street) throw new Error('потрібні op, city, street');
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
