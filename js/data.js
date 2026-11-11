// Регіони, оператори та завантаження графіків.
// УВАГА: назви операторів і системи черг — попередні, перевіряються на етапі підключення джерел.

const Q6x2 = { type: 'sub', groups: 6, subs: 2 };   // 1.1 … 6.2
const Q6 = { type: 'plain', groups: 6 };             // 1 … 6

export const REGIONS = [
  { id: 'kyiv-city', name: 'м. Київ', center: 'Київ', op: 'dtek-kem', opName: 'ДТЕК Київські електромережі', queues: Q6x2 },
  { id: 'kyiv', name: 'Київська', center: 'Біла Церква', op: 'dtek-krem', opName: 'ДТЕК Київські регіональні електромережі', queues: Q6x2 },
  { id: 'vinnytsia', name: 'Вінницька', center: 'Вінниця', op: 'voe', opName: 'Вінницяобленерго', queues: Q6x2 },
  { id: 'volyn', name: 'Волинська', center: 'Луцьк', op: 'voe-volyn', opName: 'Волиньобленерго', queues: Q6x2 },
  { id: 'dnipro', name: 'Дніпропетровська', center: 'Дніпро', cities: ['Дніпро', 'Кривий Ріг', 'Кам’янське', 'Нікополь', 'Павлоград', 'Новомосковськ'], op: 'dtek-dnem', opName: 'ДТЕК Дніпровські електромережі', queues: Q6x2 },
  { id: 'donetsk', name: 'Донецька', center: 'Краматорськ', op: 'dtek-dem', opName: 'ДТЕК Донецькі електромережі', queues: Q6x2 },
  { id: 'zhytomyr', name: 'Житомирська', center: 'Житомир', op: 'zhoe', opName: 'Житомиробленерго', queues: Q6x2 },
  { id: 'zakarpattia', name: 'Закарпатська', center: 'Ужгород', op: 'zakoe', opName: 'Закарпаттяобленерго', queues: Q6x2 },
  { id: 'zaporizhzhia', name: 'Запорізька', center: 'Запоріжжя', op: 'zoe', opName: 'Запоріжжяобленерго', queues: Q6x2 },
  { id: 'ivano-frankivsk', name: 'Івано-Франківська', center: 'Івано-Франківськ', op: 'poe', opName: 'Прикарпаттяобленерго', queues: Q6x2 },
  { id: 'kirovohrad', name: 'Кіровоградська', center: 'Кропивницький', op: 'koe', opName: 'Кіровоградобленерго', queues: Q6x2 },
  { id: 'luhansk', name: 'Луганська', center: 'Сєвєродонецьк', op: 'leo', opName: 'Луганське енергетичне об’єднання', queues: Q6 },
  { id: 'lviv', name: 'Львівська', center: 'Львів', op: 'loe', opName: 'Львівобленерго', queues: Q6x2 },
  { id: 'mykolaiv', name: 'Миколаївська', center: 'Миколаїв', addressLookup: 'moe', op: 'moe', opName: 'Миколаївобленерго', queues: Q6x2 },
  { id: 'odesa', name: 'Одеська', center: 'Одеса', cities: ['Одеса', 'Ізмаїл', 'Чорноморськ', 'Білгород-Дністровський', 'Подільськ', 'Южне'], op: 'dtek-oem', opName: 'ДТЕК Одеські електромережі', queues: Q6x2 },
  { id: 'poltava', name: 'Полтавська', center: 'Полтава', op: 'poe-poltava', opName: 'Полтаваобленерго', queues: Q6x2 },
  { id: 'rivne', name: 'Рівненська', center: 'Рівне', op: 'roe', opName: 'Рівнеобленерго', queues: Q6x2 },
  { id: 'sumy', name: 'Сумська', center: 'Суми', op: 'soe', opName: 'Сумиобленерго', queues: Q6x2 },
  { id: 'ternopil', name: 'Тернопільська', center: 'Тернопіль', op: 'toe', opName: 'Тернопільобленерго', queues: Q6x2 },
  { id: 'kharkiv', name: 'Харківська', center: 'Харків', op: 'khoe', opName: 'Харківобленерго', queues: Q6x2 },
  { id: 'kherson', name: 'Херсонська', center: 'Херсон', op: 'khe', opName: 'Херсонобленерго', queues: Q6x2 },
  { id: 'khmelnytskyi', name: 'Хмельницька', center: 'Хмельницький', cities: ['Хмельницький', 'Кам’янець-Подільський', 'Шепетівка', 'Нетішин', 'Старокостянтинів', 'Славута'], op: 'hoe', opName: 'Хмельницькобленерго', queues: Q6x2 },
  { id: 'cherkasy', name: 'Черкаська', center: 'Черкаси', op: 'choe', opName: 'Черкасиобленерго', queues: Q6x2 },
  { id: 'chernivtsi', name: 'Чернівецька', center: 'Чернівці', op: 'chernoe', opName: 'Чернівціобленерго', queues: Q6x2 },
  { id: 'chernihiv', name: 'Чернігівська', center: 'Чернігів', op: 'cheroe', opName: 'Чернігівобленерго', queues: Q6x2 },
];

export const region = id => REGIONS.find(r => r.id === id);

export function queueList(q) {
  const out = [];
  for (let g = 1; g <= q.groups; g++) {
    if (q.type === 'sub') for (let s = 1; s <= q.subs; s++) out.push(`${g}.${s}`);
    else out.push(String(g));
  }
  return out;
}

// ---------- Час за Києвом ----------
export function kyivNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute + +p.second / 60 };
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Оператори з підключеними офіційними джерелами
export const LIVE_OPS = new Set(['dtek-oem', 'dtek-dnem', 'hoe', 'moe']);
export const isLive = op => LIVE_OPS.has(op);

// ---------- Завантаження графіка ----------
// Формат data/schedules/<op>.json:
// { operator, name, source:{url, kind:'official'|'unofficial'}, updatedAt, days:{ 'YYYY-MM-DD': { '3.2': [[startMin,endMin,'on'|'off'|'possible'|'unknown'|'emergency'], …] } } }
const cache = new Map();
export async function loadSchedule(op) {
  if (cache.has(op)) return cache.get(op);
  let data = null;
  if (op === 'moe') { try { data = await moeLive(); } catch { /* резерв — файл */ } }
  if (!data) try {
    const r = await fetch(`data/schedules/${op}.json`, { cache: 'no-cache' });
    if (r.ok) data = await r.json();
  } catch { /* офлайн або немає файлу */ }
  if (!data || !data.days || !Object.keys(data.days).length) data = isLive(op) && data ? data : demoSchedule(op);
  cache.set(op, data);
  return data;
}
export function clearScheduleCache() { cache.clear(); }

// Демо-дані: детермінований шаблон, щоб інтерфейс можна було перевірити до підключення джерел.
function demoSchedule(op) {
  const today = kyivNow().date;
  const days = {};
  for (const off of [0, 1]) {
    const date = addDays(today, off);
    const seed = [...date].reduce((a, c) => a + c.charCodeAt(0), 0);
    const day = {};
    for (let g = 1; g <= 6; g++) for (const s of [1, 2, null]) {
      const key = s ? `${g}.${s}` : String(g);
      const shift = ((g - 1) * 2 + (s === 2 ? 1 : 0) + seed) % 6;
      const segs = [];
      let t = 0;
      const blocks = [[0, 3], [3, 6.5], [6.5, 10], [10, 13.5], [13.5, 17], [17, 20.5], [20.5, 24]];
      blocks.forEach(([a, b], i) => {
        const st = (i + shift) % 3 === 0 ? 'off' : 'on';
        segs.push([a * 60, b * 60, st]);
      });
      if (off === 1) { const last = segs[segs.length - 1]; if (last[2] === 'on') last[2] = 'possible'; }
      day[key] = merge(segs);
      t++;
    }
    days[date] = day;
  }
  return { operator: op, demo: true, source: { url: null, kind: 'demo' }, updatedAt: new Date().toISOString(), days };
}
function merge(segs) {
  const out = [];
  for (const s of segs) {
    const p = out[out.length - 1];
    if (p && p[2] === s[2] && p[1] === s[0]) p[1] = s[1]; else out.push([...s]);
  }
  return out;
}

// ---------- Аналіз ----------
export function segmentsFor(data, date, queue) {
  return data?.days?.[date]?.[queue] || null;
}
export function stateAt(segs, min) {
  if (!segs) return null;
  return segs.find(s => min >= s[0] && min < s[1]) || null;
}
const isOff = st => st === 'off' || st === 'emergency';

// Наступна зміна «є світло ↔ немає», з урахуванням завтрашнього дня
export function nextChange(data, date, queue, min) {
  const today = segmentsFor(data, date, queue);
  const tomorrow = segmentsFor(data, addDays(date, 1), queue);
  const cur = stateAt(today, min);
  if (!cur || cur[2] === 'unknown') return null;
  const all = [...(today || []).map(s => [s[0], s[1], s[2]]), ...(tomorrow || []).map(s => [s[0] + 1440, s[1] + 1440, s[2]])];
  const idx = all.findIndex(s => min >= s[0] && min < s[1]);
  const curOff = isOff(cur[2]);
  for (let i = idx + 1; i < all.length; i++) {
    if (all[i][2] === 'unknown') return null;
    if (isOff(all[i][2]) !== curOff) return { at: all[i][0], state: all[i][2], from: all[idx][0] };
  }
  return null;
}
export function upcomingEvents(segs, min) {
  return (segs || []).filter(s => s[1] > min);
}

// ---------- Миколаївобленерго: відкритий API з CORS (живі дані прямо в браузері) ----------
const MOE = 'https://off.energy.mk.ua/api';
const j = u => fetch(u).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
const kyivDateOf = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
async function moeLive() {
  const [ts, queues, active] = await Promise.all([j(`${MOE}/schedule/time-series`), j(`${MOE}/outage-queue/by-type/3`), j(`${MOE}/v2/schedule/active`)]);
  const slotOf = Object.fromEntries(ts.map(t => { const [h, m] = t.start.split(':').map(Number); return [t.id, (h * 60 + m) / 30]; }));
  const qName = Object.fromEntries(queues.map(q => [q.id, q.name]));
  const days = {};
  for (const sch of active) {
    const date = kyivDateOf(new Date(new Date(sch.from).getTime() + 2 * 3600e3));
    const grid = Object.fromEntries(queues.map(q => [q.name, Array(48).fill('on')]));
    for (const s of sch.series) { const q = qName[s.outage_queue_id], i = slotOf[s.time_series_id]; if (q && i != null) grid[q][i] = s.type === 'OFF' ? 'off' : s.type === 'PROBABLY_OFF' ? 'possible' : grid[q][i]; }
    days[date] = Object.fromEntries(Object.entries(grid).map(([q, sl]) => [q, merge(sl.map((st, i) => [i * 30, i * 30 + 30, st]))]));
  }
  return { operator: 'moe', name: 'Миколаївобленерго', live: true, source: { url: 'https://off.energy.mk.ua/', kind: 'official' }, updatedAt: new Date().toISOString(), days };
}
// Пошук черги за адресою (Миколаївська обл.)
export const moeAddr = {
  filii: () => j(`${MOE}/addr/filii`),
  ns: id => j(`${MOE}/addr/filii/${id}/ns`),
  streets: id => j(`${MOE}/addr/ns/${id}/street`),
  houses: id => j(`${MOE}/addr/street/${id}/dom`),
  queue: id => j(`${MOE}/addr/dom/${id}/outage-queue`),
};
