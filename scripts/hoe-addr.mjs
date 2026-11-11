// Довідник адрес Хмельницькобленерго: «населений пункт → вулиця → будинок → підчерга».
// Джерело — офіційні файли «Черги ГПВ … РЕМ» (xlsx) зі сторінки погодинних відключень.
// Пошук за адресою на сайті закритий капчею, тому беремо саме ці публічні файли.
// Запуск: node scripts/hoe-addr.mjs  →  data/addr/hoe/index.json + data/addr/hoe/<id>.json
import { mkdir, writeFile, rm } from 'node:fs/promises';
import * as XLSX from 'xlsx';

const PAGE = 'https://hoe.com.ua/page/pogodinni-vidkljuchennja';
const OUT = new URL('../data/addr/hoe/', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; Electrocity/1.0; +https://electrocity.slv463991.workers.dev)';

// Нормалізація номера будинку: «65-А» → «65а», «2 б» → «2б»
export const houseKey = s => String(s).toLowerCase().replace(/[\s-]+/g, '').replace(/[’'ʼ]/g, '');
// Службові позначки (ТП-158, КТП-126 тощо) — не будинки
const isService = h => /^(з?к?тп|ртп|щ)/i.test(h);

export function parseSheet(rows) {
  const rem = String(rows[0]?.[0] || '').replace(/\s*\(.*\)\s*$/, '').trim();
  const head = rows.findIndex(r => /населений/i.test(String(r?.[0] || '')));
  const db = {};
  for (const r of rows.slice(head + 1)) {
    const [city, street, list, qRaw] = r.map(x => String(x ?? '').trim());
    if (!city) continue;
    const q = (qRaw.match(/\d\.\d/) || [])[0]; if (!q) continue;
    const st = street || '—';
    const houses = (db[city] ??= {})[st] ??= {};
    const hs = list.split(',').map(s => s.trim()).filter(h => h && !isService(h));
    for (const h of hs.length ? hs : ['*']) {
      const k = h === '*' ? '*' : houseKey(h);
      const cur = houses[k] ??= { l: h, q: [] };
      if (!cur.q.includes(q)) cur.q.push(q);
    }
  }
  return { rem, db };
}

async function main() {
  const html = await (await fetch(PAGE, { headers: { 'User-Agent': UA } })).text();
  const links = [...new Set([...html.matchAll(/href="([^"]+\/xls\/[^"]+\.xlsx)"/gi)].map(m => new URL(m[1].replace(/&amp;/g, '&'), PAGE).href))]
    .filter(u => !/непобут|%D0%BD%D0%B5%D0%BF%D0%BE%D0%B1%D1%83%D1%82/i.test(u));
  if (!links.length) throw new Error('не знайшов файлів черг на сторінці');
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const index = []; let n = 0;
  for (const u of links) {
    const buf = Buffer.from(await (await fetch(u, { headers: { 'User-Agent': UA } })).arrayBuffer());
    const wb = XLSX.read(buf);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const { rem, db } = parseSheet(rows);
    for (const [city, streets] of Object.entries(db)) {
      const id = (++n).toString(36);
      // компактно: вулиця → [[підпис будинку, "1.1,2.2"], …]
      const out = Object.fromEntries(Object.entries(streets).map(([s, hs]) => [s, Object.values(hs).map(h => [h.l, h.q.join(',')])]));
      await writeFile(new URL(`${id}.json`, OUT), JSON.stringify(out));
      index.push([city, rem, id]);
    }
    console.log(`✓ ${rem}: ${Object.keys(db).length} населених пунктів`);
  }
  const date = (links[0].match(/_(\d{8})\.xlsx/) || [])[1];
  await writeFile(new URL('index.json', OUT), JSON.stringify({ source: PAGE, fileDate: date, builtAt: new Date().toISOString(), items: index }));
  console.log(`Разом: ${index.length} населених пунктів`);
}

if (process.argv[1]?.endsWith('hoe-addr.mjs')) await main();
