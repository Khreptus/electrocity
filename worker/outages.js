// Стан електропостачання за конкретною адресою (аварійні й планові відключення).
// Тільки офіційні джерела без капчі:
//  • Хмельницькобленерго — сторінка «Актуальні відключення» (hoe.com.ua/shutdown/all):
//    аварійні та планові відключення на сьогодні + 5 днів, з вулицями й будинками;
//  • ДТЕК — відповідь getHomeNum для будинку (поточне відключення, причина, орієнтовний час).

const UA = 'Mozilla/5.0 (compatible; Electrocity/1.0; +https://electrocity.slv463991.workers.dev)';
const HOE_REMS = { 4: 'Городоцький РЕМ', 23: 'Кам.-Подільський РЕМ', 24: 'Летичівський РЕМ', 12: 'Старокостянтинівський РЕМ', 21: 'Хмельницький РЕМ', 17: 'Шепетівський РЕМ' };

// ---------- нормалізація адрес ----------
const low = s => String(s || '').toLowerCase().replace(/[’'ʼ`]/g, '').replace(/\s+/g, ' ').trim();
export const placeKey = s => low(s).replace(/\(.*?\)/g, '').replace(/^(м|с|смт|с-ще|селище|село|місто)\.?\s+/, '').trim();
export const streetKey = s => low(s).replace(/^(вул|вулиця|пров|провулок|просп|проспект|пр|пл|площа|бул|бульвар|туп|тупик|узвіз|шосе|наб|набережна|мкр|мікрорайон|проїзд|в’їзд|вїзд|майдан|дорога)\.?\s+/, '').replace(/\./g, '').trim();
export const houseKey = s => low(s).replace(/[\s-]+/g, '');

const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, ' ').replace(/&#039;|&apos;/g, '’').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// «12.11.2026 09:00» → «2026-11-12T09:00»
const isoKyiv = s => { const m = String(s).match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}` : null; };
const isoDtek = s => { const m = String(s).match(/(\d{2}):(\d{2})\s+(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[5]}-${m[4]}-${m[3]}T${m[1]}:${m[2]}` : null; };

// ---------- Хмельницькобленерго ----------
export function parseHoeEvents(html, kind, rem) {
  const rows = html.split(/<tr[\s>]/i).slice(1);
  const out = []; let cur = null;
  for (const r of rows) {
    const cells = r.split(/<td\b[^>]*>/i).slice(1);
    if (cells.length >= 5) { // рядок події
      const c = cells.map(x => strip(x));
      cur = { kind, rem, place: c[0].replace(/Показати вулиці/g, '').trim(), work: c[1], created: c[2], start: isoKyiv(c[3]), end: isoKyiv(c[4]), streets: {} };
      out.push(cur);
    } else if (cur && cells.length === 1) { // рядок з вулицями
      for (const m of r.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>\s*(?:<span[^>]*>([\s\S]*?)<\/span>)?/gi)) {
        const street = strip(m[1]); if (!street) continue;
        const hs = strip(m[2] || '').split(',').map(x => x.trim()).filter(Boolean);
        cur.streets[street] = (cur.streets[street] || []).concat(hs);
      }
      cur = null;
    }
  }
  return out;
}

const kyivDate = (d = new Date()) => new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
// РЕМ за назвою з довідника адрес (data/addr/hoe/index.json)
const REM_BY_STEM = [[/городоцьк/i, 4], [/кам/i, 23], [/летичів/i, 24], [/старокостянтин/i, 12], [/хмельницьк/i, 21], [/шепетів/i, 17]];
let hoeIndex = null;
async function remsFor(env, city) {
  hoeIndex ||= await env.ASSETS.fetch('https://assets.local/data/addr/hoe/index.json').then(r => r.json()).then(j => j.items).catch(() => null);
  const pk = placeKey(city);
  const rems = new Set((hoeIndex || []).filter(([c]) => placeKey(c) === pk).map(([, rem]) => REM_BY_STEM.find(([re]) => re.test(rem))?.[1]).filter(Boolean));
  return rems.size ? [...rems] : Object.keys(HOE_REMS).map(Number); // не знайшли — дивимось усі РЕМ
}
// Події одного РЕМ (аварійні + планові), кеш 5 хв
async function hoeRem(rem, ctx) {
  const cacheKey = new Request(`https://cache.electrocity/hoe-events/${rem}`);
  const cached = await caches.default.match(cacheKey); if (cached) return cached.json();
  const from = kyivDate(), to = kyivDate(new Date(Date.now() + 5 * 864e5));
  const events = [];
  for (const [type, kind] of [['1', 'emergency'], ['2', 'planned']]) {
    const r = await fetch('https://hoe.com.ua/shutdown/eventlist', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://hoe.com.ua/shutdown/all' }, body: new URLSearchParams({ TypeId: type, DateRange: `${from} - ${to}`, PageNumber: '1', RemId: String(rem) }) });
    if (!r.ok) throw new Error(`Хмельницькобленерго: HTTP ${r.status}`);
    events.push(...parseHoeEvents(await r.text(), kind, HOE_REMS[rem]));
  }
  const res = { at: new Date().toISOString(), events };
  const p = caches.default.put(cacheKey, new Response(JSON.stringify(res), { headers: { 'Cache-Control': 'max-age=300' } }));
  ctx?.waitUntil ? ctx.waitUntil(p) : await p;
  return res;
}
export async function hoeAddress(env, a, nowIso, ctx) {
  const rems = await remsFor(env, a.city);
  let at = null; const items = [];
  for (const rem of rems) { const r = await hoeRem(rem, ctx); at = r.at; items.push(...matchHoe(r.events, a, nowIso)); }
  return { at, items: items.sort((x, y) => (x.start || '').localeCompare(y.start || '')) };
}

// Події, що стосуються адреси (будинок / уся вулиця / весь населений пункт)
export function matchHoe(events, { city, street, house }, nowIso) {
  const pk = placeKey(city), sk = streetKey(street), hk = houseKey(house);
  const out = [];
  for (const e of events || []) {
    if (placeKey(e.place) !== pk) continue;
    if (e.end && nowIso && e.end < nowIso) continue; // уже завершилось
    const names = Object.keys(e.streets);
    let scope = null;
    if (!names.length) scope = 'place';
    else {
      const st = names.find(n => streetKey(n) === sk); if (!st) continue;
      const hs = e.streets[st];
      if (!hs.length) scope = 'street';
      else if (hk && hs.some(h => houseKey(h) === hk)) scope = 'house';
      else continue;
    }
    out.push({ kind: e.kind, reason: e.work, start: e.start, end: e.end, scope, source: 'Хмельницькобленерго' });
  }
  return out.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}

// ---------- Миколаївобленерго ----------
// Офіційний сервіс «Перерви електропостачання» (energy.mk.ua/vidklyuchennya), без капчі:
// довідник адрес (дільниця → нас. пункт → вулиця → будинок) і пошук подій за будинком.
const MOE_API = 'https://www.energy.mk.ua/outage/api/v1/';
const MOE_BRANCHES = Array.from({ length: 20 }, (_, i) => i + 2); // дільниці 2…21
const moeHeaders = { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json', Referer: 'https://www.energy.mk.ua/vidklyuchennya/' };
const vals = x => Array.isArray(x) ? x : Object.values(x || {});
async function cachedJson(key, ttl, ctx, load) {
  const ck = new Request(`https://cache.electrocity/moe/${key}`);
  const hit = await caches.default.match(ck); if (hit) return hit.json();
  const data = await load();
  const put = caches.default.put(ck, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` } }));
  ctx?.waitUntil ? ctx.waitUntil(put) : await put;
  return data;
}
const moeGet = u => fetch(MOE_API + u, { headers: moeHeaders }).then(r => { if (!r.ok) throw new Error(`MOE ${r.status}`); return r.json(); });
// Усі населені пункти області: [[назва, дільниця, id]] — кеш 7 днів
const moeCities = ctx => cachedJson('cities', 7 * 86400, ctx, async () => {
  const out = [];
  await Promise.all(MOE_BRANCHES.map(b => moeGet(`address/branch/${b}/city`).then(cs => vals(cs).forEach(c => out.push([c.name, b, c.id]))).catch(() => {})));
  if (!out.length) throw new Error('MOE: довідник порожній');
  return out;
});
// UTC «2026-11-12T01:12:00.000000Z» → київський «2026-11-12T03:12»
const kyivIso = s => {
  if (!s) return null; const d = new Date(s); if (isNaN(d)) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const MOE_KIND = { AVARIYA: 'emergency', PLAN: 'planned', GAO: 'schedule' };
export async function moeAddress({ city, street, house }, nowIso, ctx) {
  const pk = placeKey(city), sk = streetKey(street), hk = houseKey(house);
  const cands = (await moeCities(ctx)).filter(([n]) => placeKey(n) === pk);
  for (const [, branch, cityId] of cands) {
    const streets = vals(await cachedJson(`st/${cityId}`, 86400, ctx, () => moeGet(`address/city/${cityId}/street`)));
    const st = streets.find(x => streetKey(x.name) === sk); if (!st) continue;
    const houses = vals(await cachedJson(`h/${st.id}`, 86400, ctx, () => moeGet(`address/street/${st.id}/house`)));
    const h = houses.find(x => houseKey(x.name) === hk); if (!h) continue;
    const day = Math.floor(Date.now() / 1e3); const from = day - 86400, to = day + 3 * 86400;
    const r = await cachedJson(`ev/${branch}/${h.id}/${Math.floor(day / 300)}`, 300, ctx, () =>
      fetch(MOE_API + 'outage', { method: 'POST', headers: moeHeaders, body: JSON.stringify({ page: 1, perPage: 50, from, to, branch, house_id: h.id }) })
        .then(x => { if (!x.ok) throw new Error(`MOE ${x.status}`); return x.json(); }));
    const items = vals(r.data).map(e => ({ kind: MOE_KIND[e.type] || 'planned', reason: e.reason || '', start: kyivIso(e.start_at), end: kyivIso(e.finish_at), scope: 'house', source: 'Миколаївобленерго' }))
      .filter(it => !(it.end && nowIso && it.end < nowIso))
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    return { found: true, at: new Date().toISOString(), items };
  }
  return { found: false, at: new Date().toISOString(), items: [] };
}

// ---------- ДТЕК ----------
const DTEK_HOST = { 'dtek-oem': 'https://www.dtek-oem.com.ua', 'dtek-dnem': 'https://www.dtek-dnem.com.ua', 'dtek-kem': 'https://www.dtek-kem.com.ua', 'dtek-krem': 'https://www.dtek-krem.com.ua', 'dtek-dem': 'https://www.dtek-dem.com.ua' };
export const DTEK_NAME = { 'dtek-oem': 'ДТЕК Одеські електромережі', 'dtek-dnem': 'ДТЕК Дніпровські електромережі', 'dtek-kem': 'ДТЕК Київські електромережі', 'dtek-krem': 'ДТЕК Київські регіональні електромережі', 'dtek-dem': 'ДТЕК Донецькі електромережі' };
// Сирі дані будинків вулиці; кеш 5 хв, щоб не навантажувати сайт ДТЕК
export async function dtekStreet(op, city, street, ctx) {
  const host = DTEK_HOST[op]; if (!host || !city || !street) throw new Error('потрібні op, city, street');
  const cacheKey = new Request(`https://cache.electrocity/dtek-raw/${op}/${encodeURIComponent(city)}/${encodeURIComponent(street)}`);
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
  const res = { data: j.data, updated: j.updateTimestamp || null, at: new Date().toISOString() };
  const p = caches.default.put(cacheKey, new Response(JSON.stringify(res), { headers: { 'Cache-Control': 'max-age=300' } }));
  ctx?.waitUntil ? ctx.waitUntil(p) : await p;
  return res;
}
export function dtekHouseStatus(raw, op, house) {
  const hk = houseKey(house);
  const key = Object.keys(raw.data).find(h => houseKey(h) === hk);
  if (!key) return { found: false, items: [] };
  const v = raw.data[key];
  if (!v.sub_type && !v.start_date) return { found: true, items: [] };
  const reason = String(v.sub_type || '').trim();
  const kind = /авар|екстрен/i.test(reason) ? 'emergency' : /стабіліз|графік/i.test(reason) ? 'schedule' : /план/i.test(reason) ? 'planned' : 'emergency';
  return { found: true, items: [{ kind, reason, start: isoDtek(v.start_date), end: isoDtek(v.end_date), scope: 'house', source: DTEK_NAME[op] || 'ДТЕК' }] };
}

// ---------- єдиний запит для застосунку ----------
export async function addressStatus(env, params, ctx, nowIso) {
  const op = params.get('op'), city = params.get('city') || '', street = params.get('street') || '', house = params.get('house') || '';
  if (op === 'hoe') {
    const r = await hoeAddress(env, { city, street, house }, nowIso, ctx);
    return { ok: true, supported: true, checkedAt: r.at, items: r.items, source: 'Хмельницькобленерго', url: 'https://hoe.com.ua/shutdown/all' };
  }
  if (op === 'moe') {
    const r = await moeAddress({ city, street, house }, nowIso, ctx);
    return { ok: true, supported: true, found: r.found, checkedAt: r.at, items: r.items, source: 'Миколаївобленерго', url: 'https://www.energy.mk.ua/vidklyuchennya/' };
  }
  if (op in DTEK_HOST && op !== 'dtek-dnem') {
    const raw = await dtekStreet(op, city, street, ctx);
    const s = dtekHouseStatus(raw, op, house);
    return { ok: true, supported: true, found: s.found, checkedAt: raw.at, items: s.items, source: DTEK_NAME[op], url: `${DTEK_HOST[op]}/ua/shutdowns` };
  }
  return { ok: true, supported: false, items: [] };
}
