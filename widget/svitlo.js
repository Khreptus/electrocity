// Electrocity — віджет для iPhone (застосунок Scriptable, безкоштовний)
// Адресу вписує сторінка віджета з вашого застосунку Electrocity (PRESET нижче).
// Необов'язковий параметр віджета перекриває її: оператор|черга|назва, напр.:  hoe|1.1|Дім
// Статус — за графіком оператора; аварійні й планові відключення за адресою — з сайтів обленерго.

const BASE = 'https://electrocity.slv463991.workers.dev/';
const PRESET = null; // ← адреса з застосунку
const PARAM = (args.widgetParameter || '').trim();
const P = PARAM ? (([op, queue, name]) => ({ op, queue, name }))(PARAM.split('|').map(s => s.trim()))
  : (PRESET || { op: 'dtek-oem', queue: '3.2', name: 'Дім' });
const OP = P.op, QUEUE = P.queue, NAME = P.name || 'Дім';
const ADDR_OPS = ['hoe', 'dtek-oem', 'moe'];
const C = {
  bg: new Color('#1B1B1B'), text: new Color('#F3F4F1'), text2: new Color('#9A9B99'), text3: new Color('#6B7078'),
  light: new Color('#E7B77E'), dim: new Color('#8A8E95'), alert: new Color('#FF6B7A'),
  on: '#3CD685', off: '#FF5F64', possible: '#F6B73C', unknown: '#464B53', emergency: '#FF4F7B',
};

// ---------- час за Києвом ----------
function kyiv(d = new Date()) {
  const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach(x => p[x.type] = x.value);
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute + +p.second / 60 };
}
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hm = m => { m = Math.round(m) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const isOff = s => s === 'off' || s === 'emergency';

// ---------- дані ----------
async function load() {
  const fm = FileManager.local(); const cache = fm.joinPath(fm.cacheDirectory(), `svitlo-${OP}.json`);
  try {
    // свіжі графіки з сервера (оновлюються кожні 15 хв); запасний варіант — статичний файл
    let data = null;
    for (const u of [`${BASE}api/schedules/${OP}`, `${BASE}data/schedules/${OP}.json`]) {
      try { const r = new Request(`${u}${u.includes('?') ? '&' : '?'}m=${Math.floor(Date.now() / 60000)}`); r.timeoutInterval = 15; data = await r.loadJSON(); if (data?.days) break; } catch {}
    }
    if (!data?.days) throw new Error('no data');
    fm.writeString(cache, JSON.stringify(data)); return { data, cached: false };
  } catch (e) {
    if (fm.fileExists(cache)) return { data: JSON.parse(fm.readString(cache)), cached: true };
    return { data: null, cached: false };
  }
}
// аварійні й планові відключення саме за цією адресою
async function loadAddr() {
  if (PARAM || !P.street || !P.house || !ADDR_OPS.includes(OP)) return [];
  try {
    const q = Object.entries({ op: OP, city: P.city || '', street: P.street, house: P.house }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const r = new Request(`${BASE}api/outage?${q}`); r.timeoutInterval = 12; const j = await r.loadJSON();
    return (j?.items || []).filter(it => it.kind !== 'schedule');
  } catch { return []; }
}
const isoMin = iso => +iso.slice(11, 13) * 60 + +iso.slice(14, 16);
function overlay(segs, items, d) {
  if (!items.length) return segs;
  let out = (segs || [[0, 1440, 'unknown']]).map(x => [...x]); let hit = false;
  for (const it of items) {
    const sd = it.start ? it.start.slice(0, 10) : null, ed = it.end ? it.end.slice(0, 10) : null;
    if ((sd && sd > d) || (ed && ed < d)) continue;
    const a = !sd || sd < d ? 0 : isoMin(it.start), b = !ed || ed > d ? 1440 : isoMin(it.end); if (a >= b) continue; hit = true;
    const st = it.kind === 'emergency' ? 'emergency' : 'off', nx = [];
    for (const x of out) { if (x[0] < a) nx.push([x[0], Math.min(x[1], a), x[2]]); if (x[1] > b) nx.push([Math.max(x[0], b), x[1], x[2]]); }
    nx.push([a, b, st]); out = nx.filter(x => x[1] > x[0]).sort((x, y) => x[0] - y[0]);
  }
  return hit ? out : segs;
}

async function img(name) {
  const fm = FileManager.local(); const p = fm.joinPath(fm.cacheDirectory(), `svitlo-${name}.png`);
  if (fm.fileExists(p)) return fm.readImage(p);
  try { const i = await new Request(`${BASE}widget/${name}.png`).loadImage(); fm.writeImage(p, i); return i; } catch { return null; }
}

function analyse(data, items = []) {
  const now = kyiv(); const tm = addDays(now.date, 1);
  const today = overlay(data?.days?.[now.date]?.[QUEUE], items, now.date), tom = overlay(data?.days?.[tm]?.[QUEUE], items, tm);
  if (!today) return { state: 'unknown', now, today, tom };
  const cur = today.find(s => now.min >= s[0] && now.min < s[1]);
  if (!cur) return { state: 'unknown', now, today, tom };
  const all = [...today, ...(tom || []).map(s => [s[0] + 1440, s[1] + 1440, s[2]])];
  const i = all.findIndex(s => now.min >= s[0] && now.min < s[1]);
  let next = null;
  for (let k = i + 1; k < all.length; k++) { if (all[k][2] === 'unknown') break; if (isOff(all[k][2]) !== isOff(cur[2])) { next = all[k][0]; break; } }
  let eod = false; if (next == null && cur[1] === 1440 && !tom) { next = 1440; eod = true; } // графіка на завтра ще немає — до кінця доби
  const midnight = new Date(Date.now() - now.min * 60000);
  return { state: cur[2], now, today, tom, next, eod, nextDate: next != null ? new Date(midnight.getTime() + next * 60000) : null };
}

// ---------- шкала доби ----------
function scaleImage(segs, nowMin, w, h) {
  const dc = new DrawContext(); dc.size = new Size(w, h); dc.opaque = false; dc.respectScreenScale = true;
  const r = h / 2.6;
  (segs || [[0, 1440, 'unknown']]).forEach((s, i, a) => {
    const x = s[0] / 1440 * w, sw = (s[1] - s[0]) / 1440 * w - (i < a.length - 1 ? 1.5 : 0);
    const p = new Path(); p.addRoundedRect(new Rect(x, 0, Math.max(sw, 1), h), r, r); dc.addPath(p); dc.setFillColor(new Color(C[s[2]] || C.unknown)); dc.fillPath();
  });
  if (nowMin != null) {
    const nx = nowMin / 1440 * w;
    dc.setFillColor(new Color('#1B1B1B', 0.55)); dc.fillRect(new Rect(0, 0, nx, h));
    dc.setFillColor(C.text); dc.fillRect(new Rect(nx - 1, 0, 2, h));
  }
  return dc.getImage();
}

// ---------- віджет ----------
const TITLE = { on: 'Світло є', off: 'Світла немає', possible: 'Можливе відкл.', emergency: 'Аварія', unknown: 'Невідомо' };
async function build() {
  const [{ data, cached }, items] = await Promise.all([load(), loadAddr()]);
  const a = analyse(data, items);
  const fam = config.widgetFamily || 'medium';
  const w = new ListWidget(); w.backgroundColor = C.bg; w.url = BASE; w.setPadding(14, 14, 12, 14);
  const lamp = await img(a.state === 'on' ? 'lamp-on' : 'lamp-off');
  const titleColor = a.state === 'on' ? C.light : a.state === 'emergency' ? C.alert : C.dim;

  const top = w.addStack(); top.centerAlignContent();
  const col = top.addStack(); col.layoutVertically();
  const lbl = col.addText(`${NAME} · ${QUEUE}`); lbl.font = Font.mediumSystemFont(11); lbl.textColor = C.text2;
  col.addSpacer(2);
  const t = col.addText(data ? TITLE[a.state] : 'Немає даних'); t.font = Font.boldSystemFont(fam === 'small' ? 18 : 22); t.textColor = titleColor; t.minimumScaleFactor = 0.7; t.lineLimit = 1;
  col.addSpacer(4);
  if (a.nextDate) {
    const l = col.addText(a.eod ? 'до кінця доби' : isOff(a.state) ? 'до відновлення' : 'до відключення'); l.font = Font.mediumSystemFont(11); l.textColor = C.text3;
    const d = col.addDate(a.nextDate); d.applyTimerStyle(); d.font = Font.semiboldMonospacedSystemFont(fam === 'small' ? 20 : 24); d.textColor = C.text; d.lineLimit = 1; d.minimumScaleFactor = 0.6;
  } else {
    const l = col.addText(data ? 'час зміни невідомий' : 'відкрийте застосунок'); l.font = Font.mediumSystemFont(11); l.textColor = C.text3;
  }
  top.addSpacer();
  if (lamp && fam !== 'small') { const li = top.addImage(lamp); li.imageSize = new Size(64, 80); }

  w.addSpacer();
  if (a.today) { const si = w.addImage(scaleImage(a.today, a.now.min, fam === 'small' ? 130 : 300, 10)); si.imageSize = new Size(fam === 'small' ? 130 : 300, 10); si.cornerRadius = 4; }
  w.addSpacer(4);
  const ft = w.addStack();
  const f1 = ft.addText(a.eod ? 'завтра: графіка ще немає' : a.nextDate ? `${isOff(a.state) ? 'світло о' : 'відкл. о'} ${hm(a.next)}` : ''); f1.font = Font.mediumMonospacedSystemFont(10); f1.textColor = C.text2;
  ft.addSpacer();
  const f2 = ft.addText(a.state === 'emergency' ? 'за адресою' : data?.demo ? 'демо' : cached ? 'офлайн' : 'за графіком'); f2.font = Font.mediumSystemFont(10); f2.textColor = C.text3;

  // оновлення: на момент зміни статусу або через 15 хв
  const in15 = new Date(Date.now() + 15 * 60000);
  w.refreshAfterDate = a.nextDate && a.nextDate < in15 ? new Date(a.nextDate.getTime() + 30000) : in15;
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget); else await widget.presentMedium();
Script.complete();
