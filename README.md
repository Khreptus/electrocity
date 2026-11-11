# Electrocity — графік відключень

PWA для перегляду графіків відключень електроенергії в Україні: статус «за опублікованим графіком», таймер до наступної зміни, шкала доби, кілька адрес, світла й темна тема.

- Дизайн: Figma «Map air UA» → сторінка Electro city
- Застосунок: https://khreptus.github.io/electrocity/ (GitHub Pages, безкоштовно)
- Дані: `data/schedules/<оператор>.json` (збиратимуться GitHub Actions). Поки джерела не підключені — показуються **демо-дані** з явною позначкою.

## Локальний запуск
```
python3 -m http.server 8000
```
Відкрийте http://localhost:8000

## Встановлення
Сторінка встановлення: https://khreptus.github.io/electrocity/install/

- iPhone: Safari → «Поділитися» → «На початковий екран»
- Android: Chrome → «Встановити застосунок»
- macOS: Safari → «Файл» → «Додати в Dock» або Chrome → «Встановити»
