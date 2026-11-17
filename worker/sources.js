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
  return parseFact(fact);
}
// Об'єкт fact у форматі ДТЕК: { data: { <unix 00:00 за Києвом>: { GPV1.1: { 1..24: yes|no|first|second|maybe|mfirst|msecond } } }, update }
export function parseFact(fact) {
  if (!fact?.data) throw new Error('немає даних графіка');
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
// Хмельницькобленерго: текст «За розпорядженням … <дата> … Підчерга 1.1 – 06:00-10:00; 14:00-18:00.»
// Розбір терпимий до формату: дата словами чи цифрами (з роком чи без), різні тире, «з … до …», крапка/двокрапка в часі,
// «Підчерга»/«черга»/просто «1.1», «24:00». Якщо блок з датою містить години, але жодної черги не розпізнано — це помилка
// (застосунок збереже попередній графік, а моніторинг повідомить).
const DASH = '[-–—−‐‑]';
const TIME = String.raw`(\d{1,2})[:.](\d{2})`;
const RANGE = new RegExp(String.raw`(?:з\s*)?${TIME}\s*(?:${DASH}|до|по)\s*${TIME}`, 'gi');
const QLINE = new RegExp(String.raw`(?:^|\n|[;.]\s*)\s*(?:під)?(?:черга|черги)?\s*№?\s*(\d)\s*[.,]\s*(\d)\s*(?:${DASH}|:|—)?\s*([^\n]*)`, 'gi');
export function hoeDate(part, today) {
  const year = +today.slice(0, 4), curMon = +today.slice(5, 7);
  const head = part.slice(0, 400);
  const fix = (d, mon, y) => {
    if (!y) { y = year; if (mon === 1 && curMon === 12) y++; else if (mon === 12 && curMon === 1) y--; }
    if (y < 100) y += 2000;
    if (!(mon >= 1 && mon <= 12 && d >= 1 && d <= 31)) return null;
    return `${y}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  let m = head.match(/(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{2,4})/); if (m) return fix(+m[1], +m[2], +m[3]);
  m = head.match(/(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?:\s+(\d{4}))?/i); if (m) return fix(+m[1], MONTHS[m[2].toLowerCase()], m[3] ? +m[3] : 0);
  m = head.match(/(?:^|\D)(\d{1,2})\.(\d{2})(?!\s*[-–—:.]\s*\d)(?:\D|$)/); if (m) return fix(+m[1], +m[2], 0); // «18.11» без року (не час)
  return null;
}
export function parseHoe(html) {
  const a = html.search(/За\s+розпорядженням|графік[иі]?\s+погодинних|Підчерга\s+\d/i); if (a < 0) throw new Error('Хмельницькобленерго: графіків на сторінці немає');
  const text = htmlToText(html.slice(Math.max(0, a - 200), a + 30000));
  const today = kyivDate(new Date());
  const days = {}; const problems = [];
  for (const part of text.split(/(?=За\s+розпорядженням)/i)) {
    const date = hoeDate(part, today); if (!date || days[date]) continue;
    // хвіст рядка обрізаємо на початку наступної черги (кілька черг можуть бути в одному абзаці)
    const cut = r => r.split(/(?:під)?черга\s*№?\s*\d|(?:^|[\s;])\d\s*[.,]\s*\d\s*[-–—:]\s*(?=[\dз])/i)[0];
    // кожна черга — з нового рядка (навіть якщо на сайті вони в одному абзаці)
    const norm = part.replace(/(?=(?:під)?черга\s*№?\s*\d\s*[.,]\s*\d)/gi, '\n').replace(/([.;])\s+(?=\d\s*[.,]\s*\d\s*[-–—:]\s*[\dз])/gi, '$1\n');
    const lines = [...norm.matchAll(QLINE)].map(([, g, sub, rest]) => [`${g}.${sub}`, cut(rest)]).filter(([q]) => SUBQ.includes(q));
    const notApplied = /не\s+(будуть\s+)?застосов|скасован/i.test(part) && !lines.length;
    if (!lines.length) {
      if (notApplied) { days[date] = Object.fromEntries(SUBQ.map(q => [q, [[0, 1440, 'on']]])); continue; }
      if (RANGE.test(part)) problems.push(date); RANGE.lastIndex = 0; // години є, а черг не знайшли — формат змінився
      continue;
    }
    const day = Object.fromEntries(SUBQ.map(q => [q, [[0, 1440, 'on']]]));
    for (const [q, rest] of lines) {
      const sl = Array(48).fill('on'); let any = false;
      for (const r of rest.matchAll(RANGE)) {
        const s = +r[1] * 60 + +r[2], e0 = +r[3] * 60 + +r[4], e = e0 === 0 || e0 > 1440 ? 1440 : e0;
        if (s >= 1440) continue; any = true;
        for (let t = s; t < (e > s ? e : 1440); t += 30) sl[Math.floor(t / 30)] = 'off';
      }
      if (any || /немає|без\s+відключ/i.test(rest)) day[q] = slotsToSegs(sl);
    }
    days[date] = day;
  }
  if (problems.length && !Object.keys(days).length) throw new Error(`Хмельницькобленерго: формат змінився, не розпізнано (${problems.join(', ')})`);
  if (!Object.keys(days).length) throw new Error('Хмельницькобленерго: не розпізнано');
  return { days, problems };
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
const YASNO = 'https://app.yasno.ua/api/blackout-service/public/shutdowns';
// YASNO: { "1.1": { today: { date, status, slots: [{start,end,type}] }, tomorrow: {...}, updatedOn } }
const YTYPE = { NotPlanned: 'on', Definite: 'off', Possible: 'possible', Probable: 'possible' };
// Оголошення оператора з YASNO (напр. «у м. Дніпро діють екстрені відключення»)
export async function yasnoNotice(get, region, dso) {
  try {
    const j = JSON.parse(await get(`${YASNO}/regions/${region}/dsos/${dso}/settings`));
    const t = String(j?.startupModalMessage || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, '’').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return t || null;
  } catch { return null; }
}
export function parseYasno(j) {
  const days = {}; let upd = null;
  for (const [q, g] of Object.entries(j || {})) {
    if (g.updatedOn && (!upd || g.updatedOn > upd)) upd = g.updatedOn;
    for (const k of ['today', 'tomorrow']) {
      const d = g[k]; if (!d?.date || !Array.isArray(d.slots) || !d.slots.length || !/Applies/i.test(d.status || '')) continue;
      const date = d.date.slice(0, 10);
      (days[date] ||= {})[q] = merge(d.slots.map(x => [x.start, x.end, YTYPE[x.type] || 'unknown']));
    }
  }
  if (!Object.keys(days).length) throw new Error('YASNO: графіка ще немає');
  return { days, publishedAt: upd };
}
const RAW = 'https://raw.githubusercontent.com';
const Y29 = `${RAW}/yaroslav2901/OE_OUTAGE_DATA/main/data`;
export const AGG = [
  ['khoe', 'Харківобленерго', 'https://www.oblenergo.kharkov.ua/', `${Y29}/Kharkivoblenerho.json`],
  ['zoe', 'Запоріжжяобленерго', 'https://www.zoe.com.ua/', `${Y29}/Zaporizhzhiaoblenergo.json`],
  ['poe-poltava', 'Полтаваобленерго', 'https://www.poe.pl.ua/disconnection/power-outages/', `${Y29}/Poltavaoblenergo.json`],
  ['choe', 'Черкасиобленерго', 'https://www.cherkasyoblenergo.com/', `${Y29}/Cherkasyoblenergo.json`],
  ['cheroe', 'Чернігівобленерго', 'https://chernihivoblenergo.com.ua/', `${Y29}/Chernihivoblenergo.json`],
  ['zhoe', 'Житомиробленерго', 'https://www.ztoe.com.ua/unhooking-search.php', `${Y29}/Zhytomyroblenergo.json`],
  ['loe', 'Львівобленерго', 'https://poweron.loe.lviv.ua/', `${Y29}/Lvivoblenerho.json`],
  ['poe', 'Прикарпаттяобленерго', 'https://www.oe.if.ua/uk/shutdowns_table', `${Y29}/Prykarpattiaoblenerho.json`],
  ['roe', 'Рівнеобленерго', 'https://www.roe.vsei.ua/disconnections', `${Y29}/Rivneoblenergo.json`],
  ['toe', 'Тернопільобленерго', 'https://www.toe.com.ua/', `${Y29}/Ternopiloblenerho.json`],
  ['zakoe', 'Закарпаттяобленерго', 'https://zakarpat.energy/customers/break-in-electricity-supply/schedule/', `${Y29}/Zakarpattiaoblenerho.json`],
  ['voe', 'Вінницяобленерго', 'https://www.voe.com.ua/disconnection/detailed', `${RAW}/vn-progr/gpv-voe-vinnytsia/main/data/Vinnytsiaoblenerho.json`],
  ['dtek-krem', 'ДТЕК Київські регіональні електромережі', 'https://www.dtek-krem.com.ua/ua/shutdowns', `${RAW}/Baskerville42/outage-data-ua/main/data/kyiv-region.json`],
];

// Чернівціобленерго: oblenergo.cv.ua/shutdowns/ (сьогодні, лише години від поточної) і /shutdowns/?next (завтра, вся доба).
// Таблиця: <div id="gsv"><ul><p>17.11.2026</p>…</ul> … <div id="infN" data-id="N"><u>з</u><u>в</u><u>мз</u>…</div> — 48 півгодин.
// В — відключені, З — заживлені, МЗ — можливо заживлені. Групи 1…12.
const CV_CELL = { 'в': 'off', 'з': 'on', 'мз': 'possible', 'мв': 'possible' };
const segsToSlots = segs => { const sl = Array(48).fill('unknown'); for (const [a, b, st] of segs || []) for (let i = a / 30; i < b / 30; i++) sl[i] = st; return sl; };
export function parseCv(html, prevDays = {}) {
  const g = html.indexOf('id="gsv"'); if (g < 0) throw new Error('Чернівціобленерго: немає таблиці графіка (формат змінився)');
  const part = html.slice(g);
  const dm = part.match(/<p>\s*(\d{2})\.(\d{2})\.(\d{4})/); if (!dm) throw new Error('Чернівціобленерго: дата не розпізнана (формат змінився)');
  const date = `${dm[3]}-${dm[2]}-${dm[1]}`; const day = {}; let rows = 0;
  for (const m of part.matchAll(/<div id="inf(\d+)"[^>]*>([\s\S]*?)<\/div>/g)) {
    const cells = [...m[2].matchAll(/<u[^>]*>([^<]*)<\/u>/g)].map(c => CV_CELL[c[1].trim().toLowerCase()] || 'unknown');
    if (!cells.length || cells.length > 48) continue;
    // сторінка «сьогодні» показує лише півгодини від поточної до кінця доби — минуле беремо зі збереженого графіка
    const sl = segsToSlots(prevDays[date]?.[m[1]]); sl.splice(48 - cells.length, cells.length, ...cells);
    day[m[1]] = slotsToSegs(sl); rows++;
  }
  if (!rows) throw new Error('Чернівціобленерго: групи не розпізнано (формат змінився)');
  return { date, day };
}
const CV = 'https://oblenergo.cv.ua/shutdowns/';
async function fetchCv(get, prev) {
  const days = {}; const pd = prev?.days || {};
  const [a, b] = await Promise.allSettled([get(CV), get(CV + '?next')]);
  if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
  for (const r of [a, b]) if (r.status === 'fulfilled') { const { date, day } = parseCv(r.value, pd); days[date] = day; }
  return { operator: 'chernoe', name: 'Чернівціобленерго', source: { url: CV, kind: 'official' }, days };
}

export const SOURCES = [
  { op: 'dtek-oem', fetch: async get => ({ operator: 'dtek-oem', name: 'ДТЕК Одеські електромережі', source: { url: 'https://www.dtek-oem.com.ua/ua/shutdowns', kind: 'official' }, ...parseDtek(await get('https://www.dtek-oem.com.ua/ua/shutdowns')) }) },
  // Сайти ДТЕК (крім Одеси) закриті Incapsula для серверів Cloudflare. Графік з того ж офіційного сайту
  // збирає GitHub Actions (раз на 15 хв) у data/schedules/<op>.json — беремо готовий файл.
  ...[['dtek-dnem', 'ДТЕК Дніпровські електромережі', 'dnem'],
      ['dtek-dem', 'ДТЕК Донецькі електромережі', 'dem']].map(([op, name, h]) => ({ op, fetch: async get => {
    const meta = { operator: op, name, source: { url: `https://www.dtek-${h}.com.ua/ua/shutdowns`, kind: 'official' } };
    const notice = op === 'dtek-dnem' ? await yasnoNotice(get, 3, 301) : null; if (notice) meta.notice = notice;
    if (op === 'dtek-dnem') try { return { ...meta, source: { url: 'https://static.yasno.ua/dnipro/outages', kind: 'official' }, ...parseYasno(JSON.parse(await get(`${YASNO}/regions/3/dsos/301/planned-outages`))) }; } catch { /* резерв — файл GitHub */ }
    const j = JSON.parse(await get(`https://raw.githubusercontent.com/Khreptus/electrocity/main/data/schedules/${op}.json`));
    const age = Date.now() - Date.parse(j.checkedAt || j.updatedAt || 0);
    if (!(age < 6 * 3600e3)) throw new Error(`файл ${name} застарів`);
    return { ...meta, days: j.days, publishedAt: j.publishedAt };
  } })),
  // Київ — офіційний API YASNO (ДТЕК): 60 груп 1.1…60.1; запасний варіант — файл зі збирача GitHub
  { op: 'dtek-kem', fetch: async get => ({ operator: 'dtek-kem', name: 'ДТЕК Київські електромережі', source: { url: 'https://static.yasno.ua/kyiv/outages', kind: 'official' }, notice: await yasnoNotice(get, 25, 902), ...parseYasno(JSON.parse(await get(`${YASNO}/regions/25/dsos/902/planned-outages`))) }) },
  // Обленерго, чиї офіційні графіки збирають відкриті проєкти у форматі ДТЕК (оновлення кожні кілька хвилин)
  ...AGG.map(([op, name, url, file]) => ({ op, fetch: async get => {
    const j = JSON.parse(await get(file));
    return { operator: op, name, source: { url, kind: 'aggregator', via: file.replace('https://raw.githubusercontent.com/', 'github.com/').replace(/\/main\/.*$/, '') }, ...parseFact(j.fact) };
  } })),
  { op: 'chernoe', fetch: (get, prev) => fetchCv(get, prev) },
  { op: 'hoe', fetch: async get => ({ operator: 'hoe', name: 'Хмельницькобленерго', source: { url: 'https://hoe.com.ua/page/pogodinni-vidkljuchennja', kind: 'official' }, ...parseHoe(await get('https://hoe.com.ua/page/pogodinni-vidkljuchennja')) }) },
  { op: 'moe', fetch: async get => { const [a, b, c] = await Promise.all([get(`${MOE}/schedule/time-series`), get(`${MOE}/outage-queue/by-type/3`), get(`${MOE}/v2/schedule/active`)]);
    return { operator: 'moe', name: 'Миколаївобленерго', source: { url: 'https://off.energy.mk.ua/', kind: 'official' }, ...parseMoe(JSON.parse(a), JSON.parse(b), JSON.parse(c)) }; } },
];
