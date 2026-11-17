// Перевірка адрес на сайтах ДТЕК, які не пускають сервери Cloudflare (Дніпро, Київ, Київщина, Донеччина).
// Запускається в GitHub Actions разом зі збором графіків (раз на 15 хв).
// 1) бере в сервера чергу вулиць (адреси користувачів), 2) робить getHomeNum на сайті ДТЕК,
// 3) повертає результат серверу. Обмін захищено секретом DTEK_KEY (є і в GitHub, і в Cloudflare).
// Адреси не зберігаються в репозиторії й не потрапляють у журнал.
import { appendFile } from 'node:fs/promises';

const API = process.env.ELECTROCITY_API || 'https://electrocity.slv463991.workers.dev';
const KEY = process.env.DTEK_KEY;
const HOST = { 'dtek-dnem': 'https://www.dtek-dnem.com.ua', 'dtek-kem': 'https://www.dtek-kem.com.ua', 'dtek-krem': 'https://www.dtek-krem.com.ua', 'dtek-dem': 'https://www.dtek-dem.com.ua' };
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const useBrowser = process.argv.includes('--browser');

if (!KEY) { console.log('DTEK_KEY не задано — перевірку адрес пропущено'); process.exit(0); }

const q = await fetch(`${API}/api/internal/dtek-queue`, { headers: { 'X-Key': KEY } });
if (!q.ok) { console.error(`черга: HTTP ${q.status}`); process.exit(1); }
const items = (await q.json()).items || [];
const byOp = {};
const only = (process.env.ONLY_OPS || '').split(/\s+/).filter(Boolean);
for (const [op, city, street] of items) if (HOST[op] && (!only.length || only.includes(op))) (byOp[op] ||= []).push([city, street]);
console.log(`вулиць у черзі: ${items.length}`);

const form = (city, street) => {
  const b = new URLSearchParams(); b.append('method', 'getHomeNum');
  b.append('data[0][name]', 'city'); b.append('data[0][value]', city);
  b.append('data[1][name]', 'street'); b.append('data[1][value]', street);
  return b.toString();
};

// Простий шлях: сторінка → csrf + cookie → POST /ua/ajax
async function plain(op, list) {
  const host = HOST[op];
  const page = await fetch(`${host}/ua/shutdowns`, { headers: { 'User-Agent': UA, 'Accept-Language': 'uk-UA,uk;q=0.9' } });
  const html = await page.text();
  const token = html.match(/<meta name="csrf-token" content="([^"]+)"/)?.[1];
  if (!token) throw new Error('NEED_BROWSER');
  const cookies = (page.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const out = [];
  for (const [city, street] of list) {
    try {
      const r = await fetch(`${host}/ua/ajax`, { method: 'POST', body: form(city, street), headers: { 'User-Agent': UA, 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: cookies, Referer: `${host}/ua/shutdowns` } });
      const j = await r.json();
      if (j?.data) out.push({ op, city, street, data: j.data, updated: j.updateTimestamp || null });
    } catch { /* одна вулиця не завадить іншим */ }
    await new Promise(r => setTimeout(r, 300)); // не навантажуємо сайт
  }
  return out;
}

// Запасний шлях: справжній браузер (Playwright), запити — зсередини сторінки ДТЕК
async function browser(op, list) {
  const { chromium } = await import('playwright');
  const b = await chromium.launch(); const ctx = await b.newContext({ userAgent: UA, locale: 'uk-UA' }); const p = await ctx.newPage();
  try {
    await p.goto(`${HOST[op]}/ua/shutdowns`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => document.querySelector('meta[name="csrf-token"]'), null, { timeout: 45000 });
    return await p.evaluate(async ({ op, list }) => {
      const token = document.querySelector('meta[name="csrf-token"]').content; const out = [];
      for (const [city, street] of list) {
        const b = new URLSearchParams(); b.append('method', 'getHomeNum');
        b.append('data[0][name]', 'city'); b.append('data[0][value]', city); b.append('data[1][name]', 'street'); b.append('data[1][value]', street);
        try { const r = await fetch('/ua/ajax', { method: 'POST', body: b, headers: { 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest' } }); const j = await r.json(); if (j?.data) out.push({ op, city, street, data: j.data, updated: j.updateTimestamp || null }); } catch {}
        await new Promise(r => setTimeout(r, 300));
      }
      return out;
    }, { op, list });
  } finally { await b.close(); }
}

const results = []; const needBrowser = [];
for (const [op, list] of Object.entries(byOp)) {
  try {
    const r = useBrowser ? await browser(op, list) : await plain(op, list);
    results.push(...r); console.log(`✓ ${op}: ${r.length}/${list.length}`);
  } catch (e) { if (e.message === 'NEED_BROWSER') needBrowser.push(op); console.error(`✗ ${op}: ${e.message}`); }
}
if (results.length) {
  const r = await fetch(`${API}/api/internal/dtek-result`, { method: 'POST', headers: { 'X-Key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) });
  console.log(`надіслано: ${results.length}, сервер: HTTP ${r.status}`);
}
if (needBrowser.length && process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `need_browser_addr=${needBrowser.join(' ')}\n`);
