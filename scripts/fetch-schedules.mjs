// Збирач графіків відключень з офіційних джерел операторів.
// Запускається в GitHub Actions; пише data/schedules/<op>.json у форматі, який читає застосунок.
// Node 20+, без залежностей (Playwright — лише як запасний варіант для ДТЕК).
import { writeFile, readFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../data/schedules/', import.meta.url);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SUB_QUEUES = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];

// ---------- спільні утиліти ----------
const kyivDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const todayKyiv = () => kyivDate(new Date());
function merge(segs) {
  const out = [];
  for (const s of segs) { const p = out[out.length - 1]; if (p && p[2] === s[2] && p[1] === s[0]) p[1] = s[1]; else out.push([...s]); }
  return out;
}
// 48 півгодинних слотів → сегменти [startMin, endMin, state]
const slotsToSegs = slots => merge(slots.map((st, i) => [i * 30, i * 30 + 30, st]));
async function get(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, 'Accept-Language': 'uk-UA,uk;q=0.9', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return opts.json ? r.json() : r.text();
}
function extractJSON(src, marker) {
  const i = src.indexOf(marker); if (i < 0) return null;
  let j = src.indexOf('{', i), depth = 0, inStr = false, esc = false;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) return JSON.parse(src.slice(j, k + 1));
  }
  return null;
}
const keepRecent = days => Object.fromEntries(Object.entries(days).filter(([d]) => d >= todayKyiv()).sort());

// ---------- ДТЕК (Одеські, а також інші ДТЕК-сайти з тим самим форматом) ----------
const DTEK_HALF = { yes: ['on', 'on'], no: ['off', 'off'], first: ['off', 'on'], second: ['on', 'off'], maybe: ['possible', 'possible'], mfirst: ['possible', 'on'], msecond: ['on', 'possible'] };
async function dtekHtml(url) {
  try {
    const html = await get(url);
    if (html.includes('DisconSchedule.fact')) return html;
    console.warn('ДТЕК: сторінка без даних (можливо, захист від ботів) — пробую браузер');
  } catch (e) { console.warn('ДТЕК fetch:', e.message); }
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { throw new Error('NEED_BROWSER'); }
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ userAgent: UA, locale: 'uk-UA' });
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.DisconSchedule && window.DisconSchedule.fact, null, { timeout: 45000 });
    return await p.content();
  } finally { await b.close(); }
}
async function dtek({ op, name, url }) {
  const html = await dtekHtml(url);
  const fact = extractJSON(html, 'DisconSchedule.fact');
  if (!fact?.data) throw new Error('ДТЕК: не знайдено DisconSchedule.fact');
  const days = {};
  for (const [ts, groups] of Object.entries(fact.data)) {
    const date = kyivDate(new Date(+ts * 1000 + 3 * 3600e3)); // мітка = північ за Києвом
    const day = {};
    for (const [g, hours] of Object.entries(groups)) {
      const q = g.replace(/^GPV/, '');
      const slots = [];
      for (let h = 1; h <= 24; h++) slots.push(...(DTEK_HALF[hours[h]] || ['unknown', 'unknown']));
      day[q] = slotsToSegs(slots);
    }
    days[date] = day;
  }
  const streets = extractJSON(html, 'DisconSchedule.streets');
  if (streets && Object.keys(streets).length) await saveIfChanged(new URL(`../data/addr/${op}.json`, import.meta.url), streets);
  return { operator: op, name, source: { url, kind: 'official' }, publishedAt: fact.update || null, days };
}
async function saveIfChanged(file, obj) {
  const txt = JSON.stringify(obj);
  let prev = null; try { prev = await readFile(file, 'utf8'); } catch {}
  if (prev === txt) return;
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, txt);
  console.log(`  довідник адрес оновлено: ${file.pathname.split('/').pop()}`);
}

// ---------- Хмельницькобленерго: текстові повідомлення ----------
const MONTHS = { 'січня': 1, 'лютого': 2, 'березня': 3, 'квітня': 4, 'травня': 5, 'червня': 6, 'липня': 7, 'серпня': 8, 'вересня': 9, 'жовтня': 10, 'листопада': 11, 'грудня': 12 };
const htmlToText = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&ndash;|&#8211;/g, '–').replace(/&mdash;|&#8212;/g, '—').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n');
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
export function parseHoeText(text, now = new Date()) {
  const days = {};
  const parts = text.split(/(?=За розпорядженням)/);
  const year = +todayKyiv().slice(0, 4);
  for (const part of parts) {
    const m = part.match(/(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)/);
    if (!m || !/відключ|ГПВ/i.test(part)) continue;
    const mon = MONTHS[m[2]]; let y = year;
    const curMon = +todayKyiv().slice(5, 7);
    if (mon === 1 && curMon === 12) y++; else if (mon === 12 && curMon === 1) y--;
    const date = `${y}-${String(mon).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    if (days[date]) continue; // перший (найновіший) блок має пріоритет
    const lines = [...part.matchAll(/Підчерга\s+(\d\.\d)\s*[–—-]\s*([^\n]+)/g)];
    const notApplied = /не\s+(будуть\s+)?застосов/i.test(part) && !lines.length;
    if (!lines.length && !notApplied) continue;
    const day = {};
    for (const q of SUB_QUEUES) day[q] = [[0, 1440, 'on']];
    for (const [, q, ranges] of lines) {
      const slots = Array(48).fill('on');
      for (const r of ranges.matchAll(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/g)) {
        const a = toMin(r[1]), b = toMin(r[2]) || 1440;
        for (let t = a; t < (b > a ? b : 1440); t += 30) slots[Math.floor(t / 30)] = 'off';
      }
      day[q] = slotsToSegs(slots);
    }
    days[date] = day;
  }
  return days;
}
async function hoe({ op, name, url }) {
  const text = htmlToText(await get(url));
  const days = parseHoeText(text);
  if (!Object.keys(days).length) throw new Error('Хмельницькобленерго: не знайдено графіків у тексті');
  return { operator: op, name, source: { url, kind: 'official' }, days };
}

// ---------- Миколаївобленерго: відкритий API ----------
async function moe({ op, name, url }) {
  const base = 'https://off.energy.mk.ua/api';
  const [ts, queues, active] = await Promise.all([get(`${base}/schedule/time-series`, { json: 1 }), get(`${base}/outage-queue/by-type/3`, { json: 1 }), get(`${base}/v2/schedule/active`, { json: 1 })]);
  const slotOf = Object.fromEntries(ts.map(t => [t.id, Math.round(toMin(t.start.slice(0, 5)) / 30)]));
  const qName = Object.fromEntries(queues.map(q => [q.id, q.name]));
  const days = {};
  for (const sch of active) {
    const date = kyivDate(new Date(new Date(sch.from).getTime() + 2 * 3600e3));
    const grid = Object.fromEntries(queues.map(q => [q.name, Array(48).fill('on')]));
    for (const s of sch.series) {
      const q = qName[s.outage_queue_id]; const i = slotOf[s.time_series_id];
      if (!q || i == null) continue;
      grid[q][i] = s.type === 'OFF' ? 'off' : s.type === 'PROBABLY_OFF' ? 'possible' : grid[q][i];
    }
    days[date] = Object.fromEntries(Object.entries(grid).map(([q, sl]) => [q, slotsToSegs(sl)]));
  }
  return { operator: op, name, source: { url, kind: 'official' }, days };
}

// ---------- запуск ----------
const SOURCES = [
  { op: 'dtek-oem', name: 'ДТЕК Одеські електромережі', url: 'https://www.dtek-oem.com.ua/ua/shutdowns', run: dtek },
  { op: 'dtek-dnem', name: 'ДТЕК Дніпровські електромережі', url: 'https://www.dtek-dnem.com.ua/ua/shutdowns', run: dtek },
  { op: 'hoe', name: 'Хмельницькобленерго', url: 'https://hoe.com.ua/page/pogodinni-vidkljuchennja', run: hoe },
  { op: 'moe', name: 'Миколаївобленерго', url: 'https://off.energy.mk.ua/', run: moe },
];
if (process.argv[1]?.endsWith('fetch-schedules.mjs')) {
const only = process.argv[2];
await mkdir(OUT, { recursive: true });
let failed = 0; const needBrowser = [];
for (const src of SOURCES.filter(s => !only || s.op === only)) {
  try {
    const data = await src.run(src);
    data.days = keepRecent(data.days);
    const file = new URL(`${src.op}.json`, OUT);
    let prev = null; try { prev = JSON.parse(await readFile(file, 'utf8')); } catch {}
    // updatedAt змінюємо лише коли змінились самі дані — щоб не робити зайвих комітів
    const same = prev && JSON.stringify(prev.days) === JSON.stringify(data.days) && prev.publishedAt === data.publishedAt;
    data.updatedAt = same ? prev.updatedAt : new Date().toISOString();
    await writeFile(file, JSON.stringify(data));
    console.log(`✓ ${src.op}: ${Object.keys(data.days).join(', ') || 'немає днів'}${same ? ' (без змін)' : ''}`);
  } catch (e) { failed++; if (e.message === 'NEED_BROWSER') needBrowser.push(src.op); console.error(`✗ ${src.op}: ${e.message}`); }
}
if (needBrowser.length && process.env.GITHUB_OUTPUT) {
  const { appendFile } = await import('node:fs/promises');
  await appendFile(process.env.GITHUB_OUTPUT, `need_browser=${needBrowser.join(' ')}\n`);
}
process.exitCode = failed === SOURCES.length ? 1 : 0;
}
