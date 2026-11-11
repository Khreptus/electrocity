// Джерела графіків (той самий формат, що й scripts/fetch-schedules.mjs)
const SUBQ = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];
const kyivDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function merge(segs) { const out = []; for (const s of segs) { const p = out[out.length - 1]; if (p && p[2] === s[2] && p[1] === s[0]) p[1] = s[1]; else out.push([...s]); } return out; }
const slotsToSegs = sl => merge(sl.map((st, i) => [i * 30, i * 30 + 30, st]));
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };

// Витягуємо лише потрібний JSON-об'єкт без розбору всієї сторінки (економія CPU)
export function extractJSON(src, marker) {
  const i = src.indexOf(marker); if (i < 0) return null;
  const j = src.indexOf('{', i); let depth = 0, inStr = false, esc = false;
  for (let k = j; k < src.length; k++) {
    const c = src.charCodeAt(k);
    if (inStr) { if (esc) esc = false; else if (c === 92) esc = true; else if (c === 34) inStr = false; continue; }
    if (c === 34) inStr = true; else if (c === 123) depth++; else if (c === 125 && --depth === 0) return JSON.parse(src.slice(j, k + 1));
  }
  return null;
}

const HALF = { yes: ['on', 'on'], no: ['off', 'off'], first: ['off', 'on'], second: ['on', 'off'], maybe: ['possible', 'possible'], mfirst: ['possible', 'on'], msecond: ['on', 'possible'] };
export function parseDtek(html) {
  const fact = extractJSON(html, 'DisconSchedule.fact');
  if (!fact?.data) throw new Error('ДТЕК: немає DisconSchedule.fact (можливо, захист від ботів)');
  const days = {};
  for (const [ts, groups] of Object.entries(fact.data)) {
    const date = kyivDate(new Date(+ts * 1000 + 3 * 3600e3)); const day = {};
    for (const [g, hours] of Object.entries(groups)) { const sl = []; for (let h = 1; h <= 24; h++) sl.push(...(HALF[hours[h]] || ['unknown', 'unknown'])); day[g.replace(/^GPV/, '')] = slotsToSegs(sl); }
    days[date] = day;
  }
  return { days, publishedAt: fact.update || null };
}

const MONTHS = { 'січня': 1, 'лютого': 2, 'березня': 3, 'квітня': 4, 'травня': 5, 'червня': 6, 'липня': 7, 'серпня': 8, 'вересня': 9, 'жовтня': 10, 'листопада': 11, 'грудня': 12 };
const htmlToText = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&ndash;|&#8211;/g, '–').replace(/&mdash;|&#8212;/g, '—').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');
export function parseHoe(html) {
  // беремо лише фрагмент з графіками — менше роботи для CPU
  const a = html.indexOf('За розпорядженням'); if (a < 0) throw new Error('Хмельницькобленерго: графіків на сторінці немає');
  const text = htmlToText(html.slice(a, a + 20000));
  const today = kyivDate(new Date()); const year = +today.slice(0, 4), curMon = +today.slice(5, 7);
  const days = {};
  for (const part of text.split(/(?=За розпорядженням)/)) {
    const m = part.match(/(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)/); if (!m) continue;
    const mon = MONTHS[m[2]]; let y = year; if (mon === 1 && curMon === 12) y++; else if (mon === 12 && curMon === 1) y--;
    const date = `${y}-${String(mon).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; if (days[date]) continue;
    const lines = [...part.matchAll(/Підчерга\s+(\d\.\d)\s*[–—-]\s*([^\n]+)/g)];
    const notApplied = /не\s+(будуть\s+)?застосов/i.test(part) && !lines.length;
    if (!lines.length && !notApplied) continue;
    const day = Object.fromEntries(SUBQ.map(q => [q, [[0, 1440, 'on']]]));
    for (const [, q, ranges] of lines) {
      const sl = Array(48).fill('on');
      for (const r of ranges.matchAll(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/g)) { const s = toMin(r[1]), e = toMin(r[2]) || 1440; for (let t = s; t < (e > s ? e : 1440); t += 30) sl[Math.floor(t / 30)] = 'off'; }
      day[q] = slotsToSegs(sl);
    }
    days[date] = day;
  }
  if (!Object.keys(days).length) throw new Error('Хмельницькобленерго: не розпізнано');
  return { days };
}

export function parseMoe(ts, queues, active) {
  const slotOf = Object.fromEntries(ts.map(t => [t.id, Math.round(toMin(t.start.slice(0, 5)) / 30)]));
  const qName = Object.fromEntries(queues.map(q => [q.id, q.name]));
  const days = {};
  for (const sch of active) {
    const date = kyivDate(new Date(new Date(sch.from).getTime() + 2 * 3600e3));
    const grid = Object.fromEntries(queues.map(q => [q.name, Array(48).fill('on')]));
    for (const s of sch.series) { const q = qName[s.outage_queue_id], i = slotOf[s.time_series_id]; if (q && i != null) grid[q][i] = s.type === 'OFF' ? 'off' : s.type === 'PROBABLY_OFF' ? 'possible' : grid[q][i]; }
    days[date] = Object.fromEntries(Object.entries(grid).map(([q, sl]) => [q, slotsToSegs(sl)]));
  }
  return { days };
}

const MOE = 'https://off.energy.mk.ua/api';
export const SOURCES = [
  { op: 'dtek-oem', fetch: async get => ({ operator: 'dtek-oem', name: 'ДТЕК Одеські електромережі', source: { url: 'https://www.dtek-oem.com.ua/ua/shutdowns', kind: 'official' }, ...parseDtek(await get('https://www.dtek-oem.com.ua/ua/shutdowns')) }) },
  { op: 'dtek-dnem', fetch: async get => ({ operator: 'dtek-dnem', name: 'ДТЕК Дніпровські електромережі', source: { url: 'https://www.dtek-dnem.com.ua/ua/shutdowns', kind: 'official' }, ...parseDtek(await get('https://www.dtek-dnem.com.ua/ua/shutdowns')) }) },
  { op: 'hoe', fetch: async get => ({ operator: 'hoe', name: 'Хмельницькобленерго', source: { url: 'https://hoe.com.ua/page/pogodinni-vidkljuchennja', kind: 'official' }, ...parseHoe(await get('https://hoe.com.ua/page/pogodinni-vidkljuchennja')) }) },
  { op: 'moe', fetch: async get => { const [a, b, c] = await Promise.all([get(`${MOE}/schedule/time-series`), get(`${MOE}/outage-queue/by-type/3`), get(`${MOE}/v2/schedule/active`)]);
    return { operator: 'moe', name: 'Миколаївобленерго', source: { url: 'https://off.energy.mk.ua/', kind: 'official' }, ...parseMoe(JSON.parse(a), JSON.parse(b), JSON.parse(c)) }; } },
];
