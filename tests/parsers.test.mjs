// Тести розбору графіків: кожен відомий і ймовірний формат має розпізнаватися.
// Запуск: node --test tests/  (у GitHub Actions — на кожен push; деплой з помилкою не пройде перевірку)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHoe, hoeDate, parseFact, parseYasno, parseCv } from '../worker/sources.js';

const Y = new Date().getFullYear();
const off = (segs) => segs.filter(s => s[2] === 'off').map(s => [s[0], s[1]]);
const H = (...p) => '<div class="post">' + p.map(x => `<p>${x}</p>`).join('') + '</div>';

test('ХОЕ: новий формат дати 18.11.2026', () => {
  const r = parseHoe(H('За розпорядженням НЕК «Укренерго» 18.11.2026 р. на Хмельниччині будуть застосовані графіки погодинних відключень (ГПВ).', 'Години відсутності електроенергії:', 'Підчерга 1.1 – 06:00-10:00; 14:00-18:00.<br>Підчерга 1.2 – 14:00-18:00.', 'Підчерга 2.1 – 22:00-24:00.'));
  assert.deepEqual(off(r.days['2026-11-18']['1.1']), [[360, 600], [840, 1080]]);
  assert.deepEqual(off(r.days['2026-11-18']['2.1']), [[1320, 1440]]);
  assert.deepEqual(off(r.days['2026-11-18']['3.1']), []); // черги, яких немає в тексті, — без відключень
});
test('ХОЕ: старий формат дати «18 листопада»', () => {
  const r = parseHoe(H('За розпорядженням НЕК «Укренерго» 18 листопада на Хмельниччині будуть застосовані ГПВ.', 'Підчерга 3.2 – 18:00-22:00.'));
  assert.deepEqual(off(r.days[`${Y}-11-18`]['3.2']), [[1080, 1320]]);
});
test('ХОЕ: дата словами з роком, тире різних видів, крапка в часі', () => {
  const r = parseHoe(H('За розпорядженням НЕК «Укренерго» 5 грудня 2026 року застосовуються ГПВ', 'Підчерга 4.1 — 06.00–10.00', 'Підчерга 4.2 − 8:00 — 9:30'));
  assert.deepEqual(off(r.days['2026-12-05']['4.1']), [[360, 600]]);
  assert.deepEqual(off(r.days['2026-12-05']['4.2']), [[480, 570]]);
});
test('ХОЕ: «з … до …», «черга», без слова «Підчерга», 00:00 як кінець доби', () => {
  const r = parseHoe(H('За розпорядженням НЕК «Укренерго» 19.11.26 р. застосовуються ГПВ', 'черга 5.1: з 20:00 до 00:00', '6.2 – 10:00-14:00'));
  assert.deepEqual(off(r.days['2026-11-19']['5.1']), [[1200, 1440]]);
  assert.deepEqual(off(r.days['2026-11-19']['6.2']), [[600, 840]]);
});
test('ХОЕ: кілька черг в одному абзаці', () => {
  const r = parseHoe(H('За розпорядженням НЕК «Укренерго» 20.11.2026 р. застосовуються ГПВ. Підчерга 1.1 – 06:00-10:00. Підчерга 1.2 – 14:00-18:00. Підчерга 2.1 – 22:00-24:00.'));
  assert.deepEqual(off(r.days['2026-11-20']['1.1']), [[360, 600]]);
  assert.deepEqual(off(r.days['2026-11-20']['1.2']), [[840, 1080]]);
  assert.deepEqual(off(r.days['2026-11-20']['2.1']), [[1320, 1440]]);
});
test('ХОЕ: два дні на сторінці, новіший першим', () => {
  const r = parseHoe(H('За розпорядженням НЕК «Укренерго» 18.11.2026 р. ГПВ', 'Підчерга 1.1 – 06:00-10:00.', 'За розпорядженням НЕК «Укренерго» 17.11.2026 р. ГПВ', 'Підчерга 1.1 – 14:00-18:00; 22:00-24:00.'));
  assert.deepEqual(Object.keys(r.days).sort(), ['2026-11-17', '2026-11-18']);
  assert.deepEqual(off(r.days['2026-11-17']['1.1']), [[840, 1080], [1320, 1440]]);
});
test('ХОЕ: графіки не застосовуються', () => {
  const r = parseHoe(H('За розпорядженням НЕК «Укренерго» 21.11.2026 р. графіки погодинних відключень не застосовуватимуться.'));
  assert.deepEqual(off(r.days['2026-11-21']['1.1']), []);
});
test('ХОЕ: незнайомий формат черг — помилка, а не порожній графік', () => {
  assert.throws(() => parseHoe(H('За розпорядженням НЕК «Укренерго» 22.11.2026 р. ГПВ', 'Група А: 06:00-10:00')), /формат змінився|не розпізнано/);
});
test('ХОЕ: дата без року не плутається з часом', () => {
  assert.equal(hoeDate('За розпорядженням 18.11 застосовуються ГПВ', `${Y}-11-10`), `${Y}-11-18`);
  assert.equal(hoeDate('За розпорядженням НЕК 18.11.2026 р.', '2026-11-10'), '2026-11-18');
});
test('ДТЕК fact: yes/no/first/second/maybe', () => {
  const ts = Math.floor(Date.UTC(2026, 10, 17, -2) / 1000); // 00:00 за Києвом
  const hours = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i + 1, 'yes'])); hours[7] = 'no'; hours[8] = 'first'; hours[9] = 'maybe';
  const r = parseFact({ data: { [ts]: { 'GPV1.1': hours } } });
  const segs = r.days['2026-11-17']['1.1'];
  assert.deepEqual(off(segs), [[360, 450]]);
  assert.ok(segs.some(s => s[2] === 'possible' && s[0] === 480));
});
test('YASNO: слоти, «очікуємо графік» пропускається', () => {
  const r = parseYasno({ '1.1': { today: { date: '2026-11-17T00:00:00+02:00', status: 'ScheduleApplies', slots: [{ start: 0, end: 240, type: 'NotPlanned' }, { start: 240, end: 510, type: 'Definite' }, { start: 510, end: 1440, type: 'NotPlanned' }] }, tomorrow: { date: '2026-11-18T00:00:00+02:00', status: 'WaitingForSchedule', slots: [] } } });
  assert.deepEqual(off(r.days['2026-11-17']['1.1']), [[240, 510]]);
  assert.equal(r.days['2026-11-18'], undefined);
});

const CVH = (date, rows) => `<div id="gsv" highlight="0"><ul><p>${date} </p><li id="grp1" data-id="1">Група<b>1</b></li></ul><div><p><u class="active"><b>22<em>:00</em></b></u></p>` + rows.map((r, i) => `<div id="inf${i + 1}" data-id="${i + 1}">${r.map(c => `<u>${c}</u>`).join('')}</div>`).join('') + '</div></div>';
test('Чернівці: завтра, вся доба, В/З/МЗ', () => {
  const row = Array(48).fill('з'); row[12] = row[13] = 'в'; row[14] = 'мз';
  const r = parseCv(CVH('18.11.2026', [row, Array(48).fill('з')]));
  assert.equal(r.date, '2026-11-18');
  assert.deepEqual(off(r.day['1']), [[360, 420]]);
  assert.ok(r.day['1'].some(s => s[2] === 'possible' && s[0] === 420));
  assert.deepEqual(off(r.day['2']), []);
});
test('Чернівці: сьогодні — лише залишок доби, минуле зі збереженого', () => {
  const prev = { '2026-11-17': { '1': [[0, 120, 'off'], [120, 1440, 'on']] } };
  const r = parseCv(CVH('17.11.2026', [['з', 'з', 'в', 'в']]), prev);
  assert.deepEqual(off(r.day['1']), [[0, 120], [1380, 1440]]);
});
test('Чернівці: незнайома сторінка — помилка', () => {
  assert.throws(() => parseCv('<html>нічого</html>'), /формат змінився/);
});

import { yasnoVariants } from '../worker/index.js';
test('Пошук адреси: російська розкладка й «вул.» не заважають', () => {
  assert.ok(yasnoVariants('Лесы Украинки').includes('Лесі'));
  assert.ok(yasnoVariants('вул Хрещатик 22').includes('Хрещатик'));
  assert.ok(yasnoVariants('Сыкорского').some(v => v.startsWith('Сікор')));
  assert.deepEqual(yasnoVariants('Хр'), []);
});

import { parseSoe } from '../scripts/fetch-schedules.mjs';
test('Суми: черги з браузера, дата з «Оновлено»', () => {
  const now = new Date('2026-11-17T20:00:00Z');
  const L = upd => [{ cherga_n: '1.1', no_data: false, last_update: upd, lst_time_disc: [{ start_time: '08:00', end_time: '12:00' }, { start_time: '22:00', end_time: '00:00' }] }, { cherga_n: '1.2', no_data: false, last_update: upd, lst_time_disc: [] }];
  const r = parseSoe(L('Оновлено: 17.11.2026 01:39'), now);
  assert.deepEqual(off(r['2026-11-17']['1.1']), [[480, 720], [1320, 1440]]);
  assert.deepEqual(off(r['2026-11-17']['1.2']), []);
  assert.ok(parseSoe(L('Оновлено: 16.11.2026 21:10'), now)['2026-11-17'], 'вчора ввечері — графік на сьогодні');
  assert.deepEqual(parseSoe(L('Оновлено: 16.11.2026 09:00'), now), {}, 'старий графік не беремо');
  assert.throws(() => parseSoe([{ foo: 1 }], now), /формат змінився/);
});

import { parseDistrict } from '../scripts/cv-addr.mjs';
test('Чернівці: довідник адрес дільниці', () => {
  const db = parseDistrict('<div><s>м. ВИЖНИЦЯ</s><p>вул. Буковинська</p><b>буд. 12</b><u>1</u></div><div><s>м. ВИЖНИЦЯ</s><p>вул. Буковинська</p><b>буд. 12</b><u>3</u></div><div><p>вул. ГОЛОВНА</p><b>буд. 10</b><u>8</u></div>', 'м. Чернівці');
  assert.deepEqual(db['м. Вижниця']['вул. Буковинська']['12'].q, ['1', '3']);
  assert.equal(db['м. Чернівці']['вул. Головна']['10'].q[0], '8');
});
