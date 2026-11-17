// Довідник адрес Чернівціобленерго: «населений пункт → вулиця → будинок → група (1–12)».
// Джерело — сторінки пошуку групи oblenergo.cv.ua/shutdowns-search/<дільниця>/: сервер віддає весь список адрес дільниці
// рядками <div><s>м. ВИЖНИЦЯ</s><p>вул. Буковинська</p><b>буд. 12</b><u>1</u></div> (для Чернівців <s> немає).
// Запуск: node scripts/cv-addr.mjs  →  data/addr/chernoe/index.json + data/addr/chernoe/<id>.json (той самий формат, що й hoe)
import { mkdir, writeFile, rm } from 'node:fs/promises';

const BASE = 'https://oblenergo.cv.ua/shutdowns-search/';
const OUT = new URL('../data/addr/chernoe/', import.meta.url);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
// Дільниці (на випадок, якщо головна сторінка пошуку не віддала список)
const DISTS = [['1', 'ЧЕРНІВЦІ'], ['2', 'Вижницька'], ['3', 'Герцаївська'], ['4', 'Глибоцька'], ['5', 'Заставнівська'], ['6', 'Кіцманська'], ['7', 'Кельменецька'], ['8', 'Новоселицька'], ['9', 'Путильська'], ['10', 'Сокирянська'], ['11', 'Сторожинецька'], ['12', 'Хотинська']];
const get = async u => { const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'uk-UA,uk;q=0.9', Accept: 'text/html' } }); const t = await r.text(); if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`); return t; };
const ent = s => s.replace(/&#039;|&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// «м. ВИЖНИЦЯ» → «м. Вижниця», «с. НОВОСЕЛИЦЯ-НОВА» → «с. Новоселиця-Нова»
const title = s => s.replace(/[А-ЯІЇЄҐ’'][А-ЯІЇЄҐ’'-]*/g, w => w.length > 1 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w);
const houseLabel = s => ent(s).replace(/^буд\.?\s*/i, '');

export function parseDistrict(html, defCity) {
  const db = {};
  for (const m of html.matchAll(/<div>(?:<s>([^<]*)<\/s>)?<p>([^<]*)<\/p><b>([^<]*)<\/b><u>([^<]*)<\/u><\/div>/g)) {
    const city = title(ent(m[1] || defCity)); const street = title(ent(m[2])) || '—'; const house = houseLabel(m[3]); const g = ent(m[4]);
    if (!/^\d{1,2}$/.test(g)) continue;
    const hs = (db[city] ??= {})[street] ??= {};
    const k = house.toLowerCase().replace(/[\s-]+/g, '') || '*';
    const cur = hs[k] ??= { l: house || '*', q: [] };
    if (!cur.q.includes(g)) cur.q.push(g);
  }
  return db;
}

async function main() {
  const home = await get(BASE).catch(e => { console.warn(e.message); return ''; });
  let dists = [...home.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/g)].map(m => [m[1], ent(m[2])]).filter(d => d[0] !== '0');
  if (!dists.length) { console.warn(`список дільниць не знайдено (сторінка ${home.length} байт) — беру відомий`); dists = DISTS; }
  const all = []; let n = 0;
  const files = [];
  for (const [id, name] of dists) {
    const html = await get(`${BASE}${id}/`);
    const db = parseDistrict(html, id === '1' ? 'м. Чернівці' : '');
    const rem = /^[А-ЯІЇЄ]+$/.test(name) ? title(name) : `${name} дільниця`;
    for (const [city, streets] of Object.entries(db)) {
      if (!city) continue;
      const fid = (++n).toString(36);
      files.push([fid, Object.fromEntries(Object.entries(streets).map(([s, hs]) => [s, Object.values(hs).map(h => [h.l, h.q.join(',')])]))]);
      all.push([city, rem, fid]);
    }
    console.log(`✓ ${name}: ${Object.keys(db).length} населених пунктів`);
  }
  if (all.length < 50) throw new Error(`замало населених пунктів (${all.length}) — формат змінився?`);
  await rm(OUT, { recursive: true, force: true }); await mkdir(OUT, { recursive: true });
  for (const [fid, data] of files) await writeFile(new URL(`${fid}.json`, OUT), JSON.stringify(data));
  await writeFile(new URL('index.json', OUT), JSON.stringify({ source: BASE, builtAt: new Date().toISOString(), items: all }));
  console.log(`Разом: ${all.length} населених пунктів`);
}
if (process.argv[1]?.endsWith('cv-addr.mjs')) await main();
