// Моніторинг джерел графіків: раз на годину (GitHub Actions «Перевірка джерел графіків»).
// Якщо джерело не читається довше 2 год або змінило формат — завершуємось з помилкою,
// і GitHub надсилає власнику лист «Run failed»; причина — у журналі цього кроку.
const API = process.env.ELECTROCITY_API || 'https://electrocity.slv463991.workers.dev';
const st = await (await fetch(`${API}/api/status`)).json();
const now = Date.now(); const bad = [];
for (const [op, s] of Object.entries(st)) {
  if (!s || typeof s !== 'object') continue;
  if (s.ok === false && now - Date.parse(s.since || s.at) > 2 * 3600e3) bad.push(`✗ ${op}: не читається з ${s.since || s.at} — ${s.error}`);
  if (s.ok === false && /формат змінився|не розпізнано/i.test(s.error || '')) bad.push(`✗ ${op}: ${s.error}`);
  if (s.warn) bad.push(`⚠ ${op}: ${s.warn}`);
}
const uniq = [...new Set(bad)];
if (uniq.length) { console.error('Проблеми з джерелами графіків:\n' + uniq.join('\n')); process.exit(1); }
console.log(`Усі джерела в порядку (${Object.keys(st).filter(k => typeof st[k] === 'object').length})`);
