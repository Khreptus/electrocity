// Стан електропостачання за конкретною адресою (аварійні й планові відключення).
// Тільки офіційні джерела без капчі:
//  • Хмельницькобленерго — сторінка «Актуальні відключення» (hoe.com.ua/shutdown/all):
//    аварійні та планові відключення на сьогодні + 5 днів, з вулицями й будинками;
//  • ДТЕК — відповідь getHomeNum для будинку (поточне відключення, причина, орієнтовний час).

// Кеш запитів до сайтів обленерго: звичайно 5–10 хв; коли користувач щойно відкрив застосунок (fresh=1) — 1 хв,
// щоб аварійні відключення за адресою були свіжими, але сайти обленерго не отримували зайвих запитів.
let freshMode = false;
const bucket = sec => Math.floor(Date.now() / ((freshMode ? 60 : sec) * 1e3));
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

// ---------- Платформа «Чому немає світла?» (Львівобленерго) ----------
// Відкритий API: pw_cities → pw_streets → pw_accidents (аварії) / pw_accident_planeds (планові), фільтр за city.id і street.id.
export const PW = {
  loe: { api: 'https://power-api.loe.lviv.ua/api', name: 'Львівобленерго', url: 'https://poweron.loe.lviv.ua/' },
};
const pwGet = (base, path) => fetch(`${base}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
async function pwCached(key, ttl, ctx, load) {
  const ck = new Request(`https://cache.electrocity/pw/${key}`);
  const hit = await caches.default.match(ck); if (hit) return hit.json();
  const data = await load();
  const put = caches.default.put(ck, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` } }));
  ctx?.waitUntil ? ctx.waitUntil(put) : await put;
  return data;
}
// «2-Г, 6, 7» або «1-15» → чи входить будинок
function houseIn(list, house) {
  const hk = houseKey(house); if (!hk) return false;
  const n = parseInt(hk, 10);
  return String(list).split(/[,;]/).map(x => x.trim()).filter(Boolean).some(x => {
    if (houseKey(x) === hk) return true;
    const r = x.match(/^(\d+)\s*[-–]\s*(\d+)$/); // діапазон лише з чистих чисел
    return r && +r[2] > +r[1] && String(n) === hk && n >= +r[1] && n <= +r[2];
  });
}
const pwIso = s => (s ? String(s).slice(0, 16) : null); // «2026-11-17T17:00:00+02:00» — уже київський час
export async function pwAddress(op, { city, street, house }, nowIso, ctx) {
  const P = PW[op]; const pk = placeKey(city), sk = streetKey(street);
  const cities = await pwCached(`${op}/cities`, 7 * 86400, ctx, async () => (await pwGet(P.api, '/pw_cities?pagination=false')).map(c => [c.id, c.name]));
  for (const [cid] of cities.filter(([, n]) => placeKey(n) === pk)) {
    const streets = await pwCached(`${op}/st/${cid}`, 86400, ctx, async () => (await pwGet(P.api, `/pw_streets?pagination=false&city.id=${cid}`)).map(x => [x.id, x.name]));
    const st = streets.find(([, n]) => streetKey(n) === sk); if (!st) continue;
    const q = `?pagination=false&city.id=${cid}&street.id=${st[0]}`;
    const ev = await pwCached(`${op}/ev2/${cid}/${st[0]}/${bucket(300)}`, 300, ctx, async () => {
      const [a, p] = await Promise.all([pwGet(P.api, `/pw_accidents${q}`), pwGet(P.api, `/pw_accident_planeds${q}`)]);
      // у коментарях бувають ПІБ заявників і номери їхніх ТУ — коментар не зберігаємо й не показуємо взагалі
      return [...a.map(e => ['emergency', e.dateEvent, e.datePlanIn, e.buildingNames || '']), ...p.map(e => ['planned', e.dateEvent, e.datePlanIn, e.buildingNames || ''])];
    });
    const items = [];
    for (const [kind, s0, e0, bn] of ev) {
      const end = pwIso(e0); if (end && nowIso && end < nowIso) continue;
      const scope = !String(bn).trim() ? 'street' : houseIn(bn, house) ? 'house' : null; if (!scope) continue;
      items.push({ kind, reason: kind === 'emergency' ? 'Аварійне відключення' : 'Планові роботи', start: pwIso(s0), end, scope, source: P.name });
    }
    return { found: true, at: new Date().toISOString(), items: items.sort((a, b) => (a.start || '').localeCompare(b.start || '')) };
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


// ---------- ДТЕК через GitHub Actions (сайти, що не пускають Cloudflare) ----------
// Застосунок питає адресу → вулиця стає в чергу (KV dtekq) → раз на 15 хв GitHub Actions бере чергу
// (з секретом DTEK_KEY), робить getHomeNum на сайті ДТЕК і повертає результат (KV dtekres) → відповідаємо з нього.
export const DTEK_RUNNER = new Set(['dtek-dnem', 'dtek-kem', 'dtek-krem', 'dtek-dem']);
const RES_TTL = 45 * 60e3;
let resMemo = null;
async function dtekRes(env) { if (!resMemo || Date.now() - resMemo.t > 60e3) resMemo = { t: Date.now(), v: JSON.parse(await env.KV.get('dtekres') || '{}') }; return resMemo.v; }
export async function dtekViaRunner(env, op, city, street) {
  const key = `${op}|${city}|${street}`;
  const r = (await dtekRes(env))[key];
  if (r && Date.now() - Date.parse(r.at) < RES_TTL) return r;
  // ставимо в чергу (запис у KV — лише коли вулиці ще немає або позначка застаріла, щоб не витрачати ліміт записів)
  const q = JSON.parse(await env.KV.get('dtekq') || '{}'); const last = q[key] ? Date.parse(q[key]) : 0;
  if (Date.now() - last > 6 * 3600e3) {
    q[key] = new Date().toISOString();
    for (const [k, t] of Object.entries(q)) if (Date.now() - Date.parse(t) > 3 * 86400e3) delete q[k];
    await env.KV.put('dtekq', JSON.stringify(q));
  }
  return r || null; // застарілий результат краще, ніж нічого (позначимо в checkedAt)
}
export async function dtekQueue(env) {
  const q = JSON.parse(await env.KV.get('dtekq') || '{}');
  const keys = new Set(Object.keys(q));
  const subs = JSON.parse(await env.KV.get('subs') || '{}');
  for (const s of Object.values(subs)) for (const a of s.addrs || []) if (DTEK_RUNNER.has(a.op) && a.city && a.street) keys.add(`${a.op}|${a.city}|${a.street}`);
  return [...keys].slice(0, 400).map(k => k.split('|'));
}
export async function dtekStore(env, results) {
  const cur = JSON.parse(await env.KV.get('dtekres') || '{}'); const at = new Date().toISOString();
  for (const r of results || []) if (r && r.op && r.city && r.street && r.data) cur[`${r.op}|${r.city}|${r.street}`] = { data: r.data, updated: r.updated || null, at };
  for (const [k, v] of Object.entries(cur)) if (Date.now() - Date.parse(v.at) > 2 * 86400e3) delete cur[k];
  await env.KV.put('dtekres', JSON.stringify(cur)); resMemo = null;
  return Object.keys(cur).length;
}

// ---------- єдиний запит для застосунку ----------

// ---------- Черкасиобленерго: відключення за адресою без особових рахунків ----------
// cabinet.cherkasyoblenergo.com/api_new/disconn.php — відкритий пошук сайту «По філії»:
// disconn_by_dept (disconn_selector 0 — планові, 1 — аварійні, 2 — ГПВ) повертає події з адресами
// «<strong>м. Черкаси</strong><br>вул. Хрещатик 10, 11, 12<br>…». Шукаємо свій будинок у цих списках.
// Запити за особовими рахунками (ls_list_by_addr, disconn_by_ls) НЕ використовуємо.
export const CHOE = 'https://cabinet.cherkasyoblenergo.com/api_new/disconn.php';
export const CHOE_DEPTS = [['1', 'Черкаські міські енергетичні мережі'], ['2', 'Смілянські енергетичні мережі'], ['3', 'Уманські енергетичні мережі'], ['4', 'Городищенська філія'], ['5', 'Драбівська філія'], ['6', 'Жашківська філія'], ['7', 'Звенигородські енергетичні мережі'], ['8', 'Золотоніські енергетичні мережі'], ['9', "Кам'янська філія"], ['10', 'Канівська філія'], ['11', 'Калинопільська філія'], ['12', 'Корсунь-Шевченківська філія'], ['13', 'Лисянська філія'], ['14', 'Маньківська філія'], ['15', 'Монастирищенська філія'], ['16', 'Смілянське відділення'], ['17', 'Тальнівська філія'], ['18', 'Христинівська філія'], ['19', 'Черкаські районні енергетичні мережі'], ['20', 'Чигиринська філія'], ['21', 'Чорнобаївська філія'], ['22', 'Шполянська філія']];
export async function choeGet(q) {
  const r = await fetch(`${CHOE}?${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Черкасиобленерго: HTTP ${r.status}`); return r.json();
}
export const choeCities = ctx => pwCached('choe/cities', 7 * 86400, ctx, async () =>
  (await Promise.all(CHOE_DEPTS.map(async ([d, name]) => (await choeGet(`op=city_list&dept_id=${d}`).catch(() => [])).map(c => [`${d}-${c.ID}`, String(c.NAME).trim(), name])))).flat());
const choeTime = s => { const m = String(s || '').match(/(\d{1,2}):(\d{2})\s+(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[5]}-${m[4]}-${m[3]}T${m[1].padStart(2, '0')}:${m[2]}` : null; };
// Розбір поля ADDRESS: блоки «<strong>нас. пункт</strong><br>вулиця будинки<br>…»
export function choeAddrBlocks(html) {
  const out = []; let place = '';
  for (const part of String(html || '').split(/<br\s*\/?>/i)) {
    const pm = part.match(/<strong>([^<]*)<\/strong>/i); if (pm) { place = pm[1].trim(); continue; }
    const t = part.replace(/<[^>]+>/g, '').trim(); if (!t) continue;
    const m = t.match(/^(.*?[^\d\s,])\s+(\d[\s\S]*)$/); // «вул. В. Симоненка 1, 11, 13» → вулиця + будинки
    out.push({ place, street: m ? m[1].trim() : t, houses: m ? m[2].trim() : '' });
  }
  return out;
}
const CHOE_KIND = { 0: ['planned', 'Планові роботи'], 1: ['emergency', 'Аварійне відключення'], 2: ['planned', 'Графік погодинних відключень'] };
export async function choeAddress({ city, street, house, cid }, nowIso, ctx) {
  const pk = placeKey(city), sk = streetKey(street);
  // філія відома з ідентифікатора населеного пункту («1-1» = філія 1, місто 1); інакше шукаємо в довіднику (≤ 2 філії, ліміт запитів)
  const depts = /^\d+-\d+$/.test(cid || '') ? [cid.split('-')[0]] : [...new Set((await choeCities(ctx)).filter(([, n]) => placeKey(n) === pk).map(([id]) => id.split('-')[0]))].slice(0, 2);
  if (!depts.length) return { found: false, at: new Date().toISOString(), items: [] };
  const d0 = (nowIso || new Date().toISOString()).slice(0, 10); const dd = s => s.split('-').reverse().join('.');
  const d1 = new Date(Date.parse(d0) + 864e5).toISOString().slice(0, 10);
  const items = [];
  for (const d of depts) for (const sel of [0, 1, 2]) {
    const ev = await pwCached(`choe/ev/${d}/${sel}/${d0}/${bucket(600)}`, 600, ctx, async () =>
      ((await choeGet(`op=disconn_by_dept&disconn_selector=${sel}&n_date=${dd(d0)}&k_date=${dd(d1)}&dept_id=${d}`)).DISCONNECTIONS || [])
        .filter(e => !/відмін|заверш/i.test(e.STATE_CHAR || '')).map(e => [choeTime(e.DATE_START), choeTime(e.DATE_STOP), e.ADDRESS]));
    for (const [start, end, addr] of ev) {
      if (end && nowIso && end < nowIso) continue;
      const hit = choeAddrBlocks(addr).find(b => placeKey(b.place) === pk && streetKey(b.street) === sk && (!b.houses || houseIn(b.houses, house)));
      if (!hit) continue;
      const [kind, reason] = CHOE_KIND[sel];
      items.push({ kind, reason, start, end, scope: hit.houses ? 'house' : 'street', source: 'Черкасиобленерго' });
    }
  }
  return { found: true, at: new Date().toISOString(), items: items.sort((a, b) => (a.start || '').localeCompare(b.start || '')) };
}


// ---------- Чернівціобленерго: аварійні й планові відключення за адресою ----------
// oblenergo.cv.ua/shutdowns/planovi_avarijni_result.php — відкрита форма сайту (POST v_type 0 — аварійні, 1 — планові;
// v_diln — дільниця; v_city, v_street — частина назви ≥ 3 літер; v_date). Відповідь — рядки
// <td>опубліковано</td><td>дільниця</td><td>м. Чернівці</td><td>вул. ГАЙСИНСЬКА,<br><span>буд. 5, буд. 15</span></td><td>початок</td><td>кінець</td>
const CVR = 'https://oblenergo.cv.ua/shutdowns/planovi_avarijni_result.php';
const cvPlace = s => String(s || '').toLowerCase().replace(/['"ʼ`]/g, '’').replace(/\(.*?\)/g, '').replace(/^(м|с|смт|с-ще|селище|село|місто)\.?\s+/, '').replace(/\s+/g, ' ').trim();
export function cvRows(html) {
  return [...String(html || '').matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1])).filter(c => c.length === 6)
    .map(c => { const [st, hs] = c[3].split(/<br\s*\/?>/i); const t = x => String(x || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return { place: t(c[2]), street: t(st).replace(/,$/, ''), houses: t(hs).replace(/буд\.\s*/gi, ''), start: t(c[4]).slice(0, 16).replace(' ', 'T'), end: t(c[5]).slice(0, 16).replace(' ', 'T') }; });
}
export async function cvAddress({ city, street, house }, nowIso, ctx) {
  const { CV_DIST } = await import('./cv-dist.js');
  const pk = cvPlace(city); const d = CV_DIST[pk]; const dists = d ? d.split('.') : pk === 'чернівці' ? ['1'] : null;
  const sk = streetKey(street); const word = sk.split(/[\s-]+/).filter(w => w.length >= 3).sort((a, b) => b.length - a.length)[0];
  if (!dists || !word) return { found: false, at: new Date().toISOString(), items: [] };
  const d0 = (nowIso || new Date().toISOString()).slice(0, 10), d1 = new Date(Date.parse(d0) + 864e5).toISOString().slice(0, 10);
  const dd = x => x.split('-').reverse().join('.');
  const jobs = []; for (const di of dists.slice(0, 3)) for (const [type, date] of [[0, d0], [1, d0], [1, d1]]) jobs.push([di, type, date]);
  const items = [];
  await Promise.all(jobs.map(async ([di, type, date]) => {
    const rows = await pwCached(`cv/${di}/${type}/${date}/${pk}/${word}/${bucket(600)}`, 600, ctx, async () => {
      const r = await fetch(CVR, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams({ v_type: String(type), v_diln: di, v_city: pk.slice(0, 40), v_street: word, v_house: '', v_date: dd(date), v_sort_field: '4', v_sort_type: '0', v_page: '1' }) });
      if (!r.ok) throw new Error(`Чернівціобленерго: HTTP ${r.status}`);
      return cvRows((await r.json()).data);
    });
    for (const e of rows) {
      if (cvPlace(e.place) !== pk || streetKey(e.street) !== sk) continue;
      if (e.end && nowIso && e.end < nowIso) continue;
      const scope = !e.houses ? 'street' : houseIn(e.houses, house) ? 'house' : null; if (!scope) continue;
      items.push({ kind: type === 0 ? 'emergency' : 'planned', reason: type === 0 ? 'Аварійне відключення' : 'Планові роботи', start: e.start, end: e.end, scope, source: 'Чернівціобленерго' });
    }
  }));
  const seen = new Set(); const uniq = items.filter(i => { const k = i.kind + i.start + i.end; return !seen.has(k) && seen.add(k); });
  return { found: true, at: new Date().toISOString(), items: uniq.sort((a, b) => (a.start || '').localeCompare(b.start || '')) };
}


// ---------- Полтаваобленерго: черга й відключення за адресою ----------
// poe.pl.ua/customs/search-disconnection-cabinet.php (POST disconn={operation_type: city|street|building, filial_id, city_id, street_id})
// і disconnectinforesult-cabinet.php (disconn={cityid, streerid, house}) → [{ fn_accident_message, message_type, accident_str,
// gav_message, gp_qnum_1, gp_qnum_2, planned_message }]. Це відкритий пошук сайту «Інформація про перерви в електропостачанні».
const POE = 'https://www.poe.pl.ua/customs/';
export const POE_FIL = [['102', 'Великокохнівська'], ['103', 'Гадяцька'], ['104', 'Глобинська'], ['112', 'Горішньоплавнівська'], ['105', 'Гребінківська'], ['106', 'Диканська'], ['108', 'Зінківська'], ['109', 'Карлівська'], ['110', 'Кобеляцька'], ['111', 'Козельщинська'], ['113', 'Котелевська'], ['114', 'Красногорівська'], ['115', 'Кременчуцька'], ['116', 'Лохвицька'], ['117', 'Лубенська'], ['118', 'Машівська'], ['119', 'Миргородська'], ['120', 'Новосанжарська'], ['121', 'Оржицька'], ['122', 'Пирятинська'], ['131', 'Полтавська (райони)'], ['123', 'Полтавська'], ['124', 'Решетилівська'], ['125', 'Семенівська'], ['126', 'Хорольська'], ['127', 'Чорнухинська'], ['128', 'Чутівська'], ['129', 'Шишацька']];
export async function poePost(file, obj) {
  const r = await fetch(POE + file, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body: new URLSearchParams({ disconn: JSON.stringify(obj) }) });
  if (!r.ok) throw new Error(`Полтаваобленерго: HTTP ${r.status}`); return r.json();
}
const poeName = s => String(s || '').replace(/^місто\s+/i, 'м. ').replace(/^село\s+/i, 'с. ').replace(/^селище міського типу\s+/i, 'смт ').replace(/^селище\s+/i, 'с-ще ').trim();
export const poeCities = ctx => pwCached('poe/cities', 7 * 86400, ctx, async () =>
  (await Promise.all(POE_FIL.map(async ([f, name]) => ((await poePost('search-disconnection-cabinet.php', { operation_type: 'city', filial_id: f, city_id: '', street_id: '' }).catch(() => [])) || [])
    .filter(c => !/_$/.test(c.instance_name)).map(c => [`${f}-${c.instance_id}`, poeName(c.instance_name), name])))).flat());
export const poeStreets = (cid, ctx) => { const [f, c] = cid.split('-'); return pwCached(`poe/st/${cid}`, 7 * 86400, ctx, async () =>
  (await poePost('search-disconnection-cabinet.php', { operation_type: 'street', filial_id: f, city_id: +c, street_id: '' }) || []).map(x => [String(x.instance_id), String(x.instance_name).trim()])); };
export const poeHouses = (cid, sid, ctx) => { const [f, c] = cid.split('-'); return pwCached(`poe/h/${cid}/${sid}`, 86400, ctx, async () =>
  (await poePost('search-disconnection-cabinet.php', { operation_type: 'building', filial_id: f, city_id: +c, street_id: +sid }) || []).map(x => String(x.instance_name).trim())); };
export const poeInfo = (cid, sid, house, ctx) => pwCached(`poe/i/${cid}/${sid}/${house}/${bucket(300)}`, 300, ctx, async () =>
  ((await poePost('disconnectinforesult-cabinet.php', { cityid: cid.split('-')[1], streerid: String(sid), house: String(house) })) || [])[0] || null);
export const poeQueue = info => (info && /^\d+$/.test(info.gp_qnum_1 || '') && /^\d+$/.test(info.gp_qnum_2 || '')) ? `${info.gp_qnum_1}.${info.gp_qnum_2}` : null;
const poeTime = s => { const m = String(s || '').match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, '0')}:${m[5]}` : null; };
const poeStrip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
export function poeItems(info) {
  const items = [];
  if (info && info.message_type && +info.message_type !== 0 && info.fn_accident_message) {
    const t = poeStrip(info.fn_accident_message);
    const kind = /аварі/i.test(t) ? 'emergency' : 'planned';
    const reason = /ГПВ|погодинн/i.test(t) ? 'Графік погодинних відключень' : /ГАВ|аварійн[а-я]* відключ/i.test(t) && !/аварі[яї] /i.test(t) ? 'Графік аварійних відключень' : kind === 'emergency' ? 'Аварійне відключення' : 'Планові роботи';
    items.push({ kind, reason, start: poeTime(info.accident_str), end: null, scope: 'house', source: 'Полтаваобленерго' });
  }
  if (info?.planned_message) { const t = poeStrip(info.planned_message); const ts = [...t.matchAll(/(\d{2}\.\d{2}\.\d{4})\D{0,12}(\d{1,2}:\d{2})/g)].map(m => poeTime(`${m[1]} ${m[2]}`));
    if (t) items.push({ kind: 'planned', reason: 'Планові роботи', start: ts[0] || null, end: ts[1] || null, scope: 'house', source: 'Полтаваобленерго' }); }
  return items;
}
export async function poeAddress({ city, street, house, cid }, nowIso, ctx) {
  const pk = placeKey(city), sk = streetKey(street);
  const cids = /^\d+-\d+$/.test(cid || '') ? [cid] : (await poeCities(ctx)).filter(([, n]) => placeKey(n) === pk).map(([id]) => id).slice(0, 2);
  for (const c of cids) {
    const st = (await poeStreets(c, ctx)).find(([, n]) => streetKey(n) === sk); if (!st) continue;
    const info = await poeInfo(c, st[0], house, ctx);
    if (info && +info.message_type === 0 && /декілька підключень/i.test(info.fn_accident_message || '')) return { found: false, multi: true, at: new Date().toISOString(), items: [] };
    return { found: true, at: new Date().toISOString(), items: poeItems(info).filter(i => !i.end || !nowIso || i.end > nowIso) };
  }
  return { found: false, at: new Date().toISOString(), items: [] };
}


// ---------- Хмельницькобленерго: «Відключення за адресою» (hoe.com.ua/shutdown/new) ----------
// Відкритий пошук без капчі: GET /settlements?term= → [{id, text}], GET /streets/<id>?term= → [{id, text}], GET /houses/<streetId> → ["1", …],
// POST /shutdown-events {streetId, house} → таблиця «Вид робіт | Тип | Черга (ГПВ) | Черга (ГАВ) | Початок | Кінець».
// Черга будинку видно в рядках ГПВ — це свіжіше за файли черг (вони від 09.10.2026).
const HOE = 'https://hoe.com.ua';
// streetId:будинок → черга, перевірена власником вручну на сайті обленерго (20.11.2026)
const HOE_KNOWN = { '281090:20/7': { q: ['2.1'], at: '2026-11-20T17:40:00Z' } };
const hoeGet = (path, form) => fetch(HOE + path, { method: form ? 'POST' : 'GET', headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, ...(form ? { body: new URLSearchParams(form) } : {}) })
  .then(r => { if (!r.ok) throw new Error(`Хмельницькобленерго: HTTP ${r.status}`); return form ? r.text() : r.json(); });
const hoeT = s => { const m = String(s || '').match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, '0')}:${m[5]}` : null; };
export function hoeEventRows(html) {
  return [...String(html || '').matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()))
    .filter(c => c.length >= 6).map(([work, type, gpv, gav, start, end]) => ({ work, type, gpv: [...new Set(gpv.match(/\d\.\d/g) || [])], start: hoeT(start), end: hoeT(end) }));
}
// найчастіша черга ГПВ у подіях будинку (будинок може мати кілька приєднань — тоді кілька черг)
export function hoeQueueFrom(rows) {
  const n = {}; for (const r of rows) if (/погодинн/i.test(r.work)) for (const q of r.gpv) n[q] = (n[q] || 0) + 1;
  return Object.keys(n).sort((a, b) => n[b] - n[a]);
}
export async function hoeLive({ city, street, house }, ctx, env) {
  const pk = placeKey(city), sk = streetKey(street);
  const key = `hoe/live2/${pk}/${sk}/${houseKey(house)}/${bucket(300)}`;
  return pwCached(key, 300, ctx, async () => {
    const term = pk.split(/[\s-]/).sort((a, b) => b.length - a.length)[0] || pk;
    const set = (await hoeGet(`/settlements?term=${encodeURIComponent(term)}`)).find(x => placeKey(String(x.text).replace(/\(.*?\)/g, '')) === pk);
    if (!set) return null;
    const sw = sk.split(/[\s-]/).filter(w => w.length >= 3).sort((a, b) => b.length - a.length)[0] || sk;
    const st = (await hoeGet(`/streets/${set.id}?term=${encodeURIComponent(sw)}`)).find(x => streetKey(String(x.text).trim()) === sk);
    if (!st) return null;
    const hs = await hoeGet(`/houses/${st.id}`); const h = (hs || []).find(x => houseKey(x) === houseKey(house));
    if (!h) return { found: false };
    const rows = hoeEventRows(await hoeGet('/shutdown-events', { streetId: st.id, house: h }));
    // Черга видно лише в подіях. Запам'ятовуємо останню побачену (KV, пишемо лише при зміні), щоб знати її й тоді,
    // коли відключень за адресою зараз немає.
    let queues = hoeQueueFrom(rows), queuesAt = queues.length ? new Date().toISOString() : null, memory = false;
    // Черги, підтверджені вручну (користувач перевірив на сайті обленерго), — поки сайт не покаже свіжішу
    const known = HOE_KNOWN[`${st.id}:${houseKey(h)}`];
    const mk = `hoeq:${st.id}:${houseKey(h)}`;
    if (env?.KV) {
      const prev = await env.KV.get(mk, 'json').catch(() => null);
      if (queues.length) { if (!prev || prev.q.join() !== queues.join()) await env.KV.put(mk, JSON.stringify({ q: queues, at: queuesAt })).catch(() => {}); }
      else if (prev?.q?.length) { queues = prev.q; queuesAt = prev.at; memory = true; }
    }
    if (!queues.length && known) { queues = known.q; queuesAt = known.at; memory = true; }
    return { found: true, rows, queues, queuesAt, memory };
  });
}

export async function addressStatus(env, params, ctx, nowIso) {
  freshMode = params.get('fresh') === '1';
  const op = params.get('op'), city = params.get('city') || '', street = params.get('street') || '', house = params.get('house') || '';
  if (op === 'hoe') {
    // спершу пошук за адресою на сайті (точно по будинку), інакше — події за РЕМ
    const live = await hoeLive({ city, street, house }, ctx, env).catch(() => null);
    if (live?.found) {
      const items = live.rows.filter(r => !r.end || !nowIso || r.end > nowIso).map(r => ({
        // рядки погодинних відключень (ГПВ) — це сам графік черги, він уже на шкалі; обленерго позначає їх типом «Аварійне»,
        // але показувати їх як аварію не можна. Аварійні — лише справжні аварійні роботи / ГАВ поза графіком.
        kind: /погодинн|\bГПВ\b/i.test(r.work) ? 'schedule' : /аварі/i.test(r.type) ? 'emergency' : 'planned',
        reason: r.work, start: r.start, end: r.end, scope: 'house', source: 'Хмельницькобленерго', queue: r.gpv.join(', ') }));
      return { ok: true, supported: true, found: true, checkedAt: new Date().toISOString(), items, queue: live.queues, source: 'Хмельницькобленерго', url: 'https://hoe.com.ua/shutdown/new' };
    }
    const r = await hoeAddress(env, { city, street, house }, nowIso, ctx);
    return { ok: true, supported: true, checkedAt: r.at, items: r.items, source: 'Хмельницькобленерго', url: 'https://hoe.com.ua/shutdown/all' };
  }
  if (op in PW) {
    const r = await pwAddress(op, { city, street, house }, nowIso, ctx);
    return { ok: true, supported: true, found: r.found, checkedAt: r.at, items: r.items, source: PW[op].name, url: PW[op].url };
  }
  if (op === 'poe-poltava') {
    const r = await poeAddress({ city, street, house, cid: params.get('cid') || '' }, nowIso, ctx);
    return { ok: true, supported: true, found: r.found, checkedAt: r.at, items: r.items, source: 'Полтаваобленерго', url: 'https://www.poe.pl.ua/disconnection/power-outages/' };
  }
  if (op === 'chernoe') {
    const r = await cvAddress({ city, street, house }, nowIso, ctx);
    return { ok: true, supported: true, found: r.found, checkedAt: r.at, items: r.items, source: 'Чернівціобленерго', url: 'https://oblenergo.cv.ua/shutdowns/' };
  }
  if (op === 'choe') {
    const r = await choeAddress({ city, street, house, cid: params.get('cid') || '' }, nowIso, ctx);
    return { ok: true, supported: true, found: r.found, checkedAt: r.at, items: r.items, source: 'Черкасиобленерго', url: 'https://www.cherkasyoblenergo.com/off' };
  }
  if (op === 'moe') {
    const r = await moeAddress({ city, street, house }, nowIso, ctx);
    return { ok: true, supported: true, found: r.found, checkedAt: r.at, items: r.items, source: 'Миколаївобленерго', url: 'https://www.energy.mk.ua/vidklyuchennya/' };
  }
  if (DTEK_RUNNER.has(op)) {
    if (!env.DTEK_KEY) return { ok: true, supported: false, items: [] }; // перевірка через GitHub ще не налаштована
    if (!street) return { ok: true, supported: true, items: [] };
    const raw = await dtekViaRunner(env, op, city, street);
    if (!raw) return { ok: true, supported: true, pending: true, items: [], source: DTEK_NAME[op], url: `${DTEK_HOST[op]}/ua/shutdowns` };
    const s = dtekHouseStatus(raw, op, house);
    return { ok: true, supported: true, found: s.found, checkedAt: raw.at, items: s.items, source: DTEK_NAME[op], url: `${DTEK_HOST[op]}/ua/shutdowns` };
  }
  if (op in DTEK_HOST) {
    const raw = await dtekStreet(op, city, street, ctx);
    const s = dtekHouseStatus(raw, op, house);
    return { ok: true, supported: true, found: s.found, checkedAt: raw.at, items: s.items, source: DTEK_NAME[op], url: `${DTEK_HOST[op]}/ua/shutdowns` };
  }
  return { ok: true, supported: false, items: [] };
}
