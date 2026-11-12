// Мови інтерфейсу: українська (основна), англійська, німецька.
// Інтерфейс пишеться українською, а цей модуль перекладає готовий DOM:
// точні рядки → словник, складені рядки → шаблони, «А · Б» → по частинах.
// Назви вулиць і населених пунктів не перекладаються (як в офіційних даних).

export const LANGS = { uk: 'Українська', en: 'English', de: 'Deutsch' };
let lang = 'uk';
export const getLang = () => lang;
export const locale = () => ({ uk: 'uk-UA', en: 'en-GB', de: 'de-DE' })[lang];

// [uk, en, de]
const T = [
  // статуси
  ['Світло є', 'Power on', 'Strom da'], ['Відключення', 'Outage', 'Abschaltung'], ['Можливе', 'Possible', 'Möglich'],
  ['Невідомо', 'Unknown', 'Unbekannt'], ['Аварія', 'Emergency', 'Störung'], ['Світла немає', 'No power', 'Kein Strom'],
  ['Можливе відключення', 'Possible outage', 'Mögliche Abschaltung'], ['Аварійне відключення', 'Emergency outage', 'Notabschaltung'],
  ['Планове відключення', 'Scheduled outage', 'Geplante Abschaltung'], ['Можливо', 'Possibly', 'Möglich'],
  ['Без світла', 'Without power', 'Ohne Strom'], ['Зі світлом', 'With power', 'Mit Strom'], ['Світло', 'Power', 'Strom'],
  ['Статус невідомий', 'Status unknown', 'Status unbekannt'], ['Немає даних', 'No data', 'Keine Daten'],
  ['Час наступної зміни невідомий', 'Next change time unknown', 'Zeitpunkt der nächsten Änderung unbekannt'],
  ['До відключення', 'Until outage', 'Bis zur Abschaltung'], ['До відновлення', 'Until power returns', 'Bis Strom zurück'],
  ['Оператор повідомив про аварію', 'The operator reported an emergency', 'Der Netzbetreiber meldet eine Störung'],
  ['Час відновлення невідомий', 'Restoration time unknown', 'Wiederherstellungszeit unbekannt'],
  ['Немає достовірних даних на цей час', 'No reliable data for this time', 'Keine verlässlichen Daten für diese Zeit'],
  ['За опублікованим графіком', 'According to the published schedule', 'Laut veröffentlichtem Plan'],
  ['Графік оновлюється', 'Schedule is updating', 'Plan wird aktualisiert'], ['Перевіряємо джерела…', 'Checking sources…', 'Quellen werden geprüft…'],
  ['дані в реальному часі', 'live data', 'Live-Daten'], ['Немає з’єднання', 'No connection', 'Keine Verbindung'],
  ['Показуємо збережений графік.', 'Showing the saved schedule.', 'Gespeicherter Plan wird angezeigt.'],
  ['Це демо-графік', 'This is a demo schedule', 'Das ist ein Demo-Plan'],
  ['Реальні дані оператора підключимо найближчим часом. Не орієнтуйтеся на ці інтервали.', 'Real operator data is coming soon. Do not rely on these intervals.', 'Echte Betreiberdaten folgen in Kürze. Verlassen Sie sich nicht auf diese Zeiten.'],
  ['ще не опубліковано', 'not published yet', 'noch nicht veröffentlicht'],
  ['Зазвичай оператор публікує його ввечері.', 'The operator usually publishes it in the evening.', 'Der Betreiber veröffentlicht ihn meist abends.'],
  ['Детальніше', 'Details', 'Details'], ['Сьогодні', 'Today', 'Heute'], ['Завтра', 'Tomorrow', 'Morgen'],
  ['сьогодні', 'today', 'heute'], ['завтра', 'tomorrow', 'morgen'], ['на сьогодні', 'for today', 'für heute'], ['на завтра', 'for tomorrow', 'für morgen'],
  ['Графік може змінюватися протягом дня. Статус — за опублікованим графіком, а не фактична наявність світла.', 'The schedule can change during the day. The status follows the published schedule, not the actual presence of power.', 'Der Plan kann sich im Laufe des Tages ändern. Der Status folgt dem veröffentlichten Plan, nicht der tatsächlichen Stromversorgung.'],
  ['Джерело ще не підключене — показуємо демо-дані', 'Source not connected yet — showing demo data', 'Quelle noch nicht verbunden — Demo-Daten'],
  ['Офіційне джерело підключено', 'Official source connected', 'Offizielle Quelle verbunden'],
  ['Графік', 'Schedule', 'Plan'], ['Графік змінено', 'Schedule changed', 'Plan geändert'],
  ['Опубліковано графік на завтра', 'Tomorrow’s schedule published', 'Plan für morgen veröffentlicht'],
  ['Що саме змінилось: було → стало', 'What changed: before → after', 'Was sich geändert hat: vorher → nachher'],
  // назви адрес
  ['Дім', 'Home', 'Zuhause'], ['Робота', 'Work', 'Arbeit'], ['Батьки', 'Parents', 'Eltern'], ['Дача', 'Cottage', 'Datscha'], ['Інше', 'Other', 'Andere'],
  // навігація, налаштування
  ['Мої адреси', 'My addresses', 'Meine Adressen'], ['Основна адреса (зірочка) відкривається при запуску.', 'The main address (star) opens on launch.', 'Die Hauptadresse (Stern) wird beim Start geöffnet.'],
  ['Додати адресу', 'Add address', 'Adresse hinzufügen'], ['Назва', 'Name', 'Name'], ['Змінити чергу', 'Change queue', 'Gruppe ändern'],
  ['Основна адреса', 'Main address', 'Hauptadresse'], ['Видалити адресу', 'Delete address', 'Adresse löschen'],
  ['Системна', 'System', 'System'], ['Світла', 'Light', 'Hell'], ['Темна', 'Dark', 'Dunkel'],
  ['Налаштування', 'Settings', 'Einstellungen'], ['Основне', 'General', 'Allgemein'], ['Вигляд', 'Appearance', 'Darstellung'],
  ['Поділитися', 'Share', 'Teilen'], ['Сторінка встановлення', 'Install page', 'Installationsseite'],
  ['Надішліть друзям — iPhone, Android, Mac', 'Send to friends — iPhone, Android, Mac', 'An Freunde senden — iPhone, Android, Mac'],
  ['Віджет', 'Widget', 'Widget'], ['Віджет для iPhone', 'iPhone widget', 'iPhone-Widget'],
  ['Статус і таймер на головному екрані', 'Status and timer on the home screen', 'Status und Timer auf dem Home-Bildschirm'],
  ['Дані', 'Data', 'Daten'], ['Про застосунок', 'About', 'Über die App'], ['Тема', 'Theme', 'Design'], ['Мова', 'Language', 'Sprache'],
  ['Джерела даних', 'Data sources', 'Datenquellen'], ['Керувати', 'Manage', 'Verwalten'], ['Закрити', 'Close', 'Schließen'],
  ['Версія', 'Version', 'Version'], ['Конфіденційність', 'Privacy', 'Datenschutz'], ['Оновити графіки', 'Refresh schedules', 'Pläne aktualisieren'],
  ['Скинути збережені дані графіків', 'Clear saved schedule data', 'Gespeicherte Plandaten löschen'],
  ['Без акаунта. Адреси зберігаються лише на цьому пристрої', 'No account. Addresses are stored only on this device', 'Kein Konto. Adressen werden nur auf diesem Gerät gespeichert'],
  ['Офіційні оператори', 'Official operators', 'Offizielle Betreiber'], ['Оператор', 'Operator', 'Betreiber'],
  ['Пріоритет — офіційні дані операторів. Неофіційні повідомлення ніколи не змішуються з графіком без позначки.', 'Official operator data comes first. Unofficial reports are never mixed into the schedule without a label.', 'Offizielle Betreiberdaten haben Vorrang. Inoffizielle Meldungen werden nie ohne Kennzeichnung in den Plan gemischt.'],
  ['Додайте адресу, щоб побачити джерела.', 'Add an address to see the sources.', 'Fügen Sie eine Adresse hinzu, um die Quellen zu sehen.'],
  ['Адреса', 'Address', 'Adresse'], ['Адреси', 'Addresses', 'Adressen'], ['Адресу не вказано', 'No address given', 'Keine Adresse angegeben'],
  ['Редагування', 'Editing', 'Bearbeiten'], ['Увімкнено', 'On', 'An'], ['Вимкнено', 'Off', 'Aus'], ['Заборонено в системі', 'Blocked in system', 'Im System blockiert'],
  ['0.1 (бета)', '0.1 (beta)', '0.1 (Beta)'],
  // вітання
  ['Знайте, коли буде', 'Know when there will be', 'Wissen, wann es'], ['світло', 'power', 'Strom gibt'],
  ['Графік відключень для вашої адреси по всій Україні. Дані — з офіційних джерел операторів.', 'Outage schedule for your address anywhere in Ukraine. Data from official operator sources.', 'Abschaltplan für Ihre Adresse in ganz Ukraine. Daten aus offiziellen Quellen der Netzbetreiber.'],
  ['Налаштувати адресу', 'Set up address', 'Adresse einrichten'], ['Без реєстрації та номера телефону', 'No sign-up, no phone number', 'Ohne Registrierung und Telefonnummer'],
  ['Черга за адресою — без пошуку в таблицях', 'Queue by address — no searching tables', 'Gruppe per Adresse — ohne Tabellensuche'],
  ['Попередження перед відключенням', 'Warning before an outage', 'Warnung vor einer Abschaltung'],
  // онбординг
  ['Область', 'Region', 'Region'], ['Населений пункт', 'Settlement', 'Ort'], ['Спосіб', 'Method', 'Methode'], ['Підтвердження', 'Confirmation', 'Bestätigung'],
  ['Пошук області', 'Search region', 'Region suchen'], ['Почніть вводити назву', 'Start typing a name', 'Namen eingeben'],
  ['Вулиця — почніть вводити', 'Street — start typing', 'Straße — tippen Sie los'], ['Номер будинку', 'House number', 'Hausnummer'],
  ['Область не знайдено. Спробуйте назву міста, наприклад «Кривий Ріг».', 'Region not found. Try a city name, e.g. “Kryvyi Rih”.', 'Region nicht gefunden. Versuchen Sie einen Stadtnamen, z. B. „Krywyj Rih“.'],
  ['Оберіть зі списку або введіть назву повністю.', 'Pick from the list or type the full name.', 'Aus der Liste wählen oder den vollen Namen eingeben.'],
  ['Продовжити', 'Continue', 'Weiter'], ['Як визначити ваш графік?', 'How should we find your schedule?', 'Wie ermitteln wir Ihren Plan?'],
  ['За адресою', 'By address', 'Per Adresse'], ['Я знаю свою чергу', 'I know my queue', 'Ich kenne meine Gruppe'],
  ['Вкажіть вулицю й будинок — чергу визначимо автоматично, щойно оператор це підтримає', 'Enter street and house — we will detect the queue automatically where the operator supports it', 'Straße und Haus angeben — die Gruppe wird automatisch ermittelt, sofern der Betreiber das unterstützt'],
  ['Оберіть чергу або підчергу зі списку оператора', 'Pick a queue or subqueue from the operator’s list', 'Gruppe oder Untergruppe aus der Liste des Betreibers wählen'],
  ['Оберіть чергу', 'Choose a queue', 'Gruppe wählen'], ['Обрати чергу', 'Choose queue', 'Gruppe wählen'], ['Обрати чергу вручну', 'Choose queue manually', 'Gruppe manuell wählen'],
  ['Не вдалося визначити чергу автоматично', 'Could not detect the queue automatically', 'Gruppe konnte nicht automatisch ermittelt werden'],
  ['Чергу не вдалося визначити автоматично', 'Could not detect the queue automatically', 'Gruppe konnte nicht automatisch ermittelt werden'],
  ['Чергу доведеться обрати вручну', 'You will need to choose the queue manually', 'Die Gruppe muss manuell gewählt werden'],
  ['Оберіть її вручну.', 'Choose it manually.', 'Wählen Sie sie manuell.'], ['Оберіть чергу вручну.', 'Choose the queue manually.', 'Wählen Sie die Gruppe manuell.'],
  ['Все готово', 'All set', 'Alles bereit'], ['Назва адреси', 'Address name', 'Name der Adresse'], ['Перейти до графіка', 'Go to schedule', 'Zum Plan'],
  ['Початок', 'Start', 'Beginn'], ['Кінець', 'End', 'Ende'], ['Тривалість', 'Duration', 'Dauer'],
  ['Шукаємо чергу для адреси…', 'Looking up the queue for this address…', 'Gruppe für die Adresse wird gesucht…'],
  ['Чергу не вдалося визначити', 'Could not detect the queue', 'Gruppe konnte nicht ermittelt werden'],
  ['Оператор не повертає чергу для цієї адреси. Оберіть її вручну.', 'The operator returns no queue for this address. Choose it manually.', 'Der Betreiber liefert keine Gruppe für diese Adresse. Wählen Sie sie manuell.'],
  ['Вашу адресу знайдено', 'Address found', 'Adresse gefunden'], ['Сервіс оператора не відповідає', 'The operator’s service is not responding', 'Der Dienst des Betreibers antwortet nicht'],
  ['Оператор не вказав чергу для цього будинку.', 'The operator lists no queue for this house.', 'Der Betreiber nennt keine Gruppe für dieses Haus.'],
  ['Будинок у кількох чергах', 'This house is in several queues', 'Das Haus gehört zu mehreren Gruppen'],
  ['Такого номера немає в довіднику оператора', 'This number is not in the operator’s directory', 'Diese Nummer fehlt im Verzeichnis des Betreibers'],
  ['Сервіс ДТЕК зараз не відповідає.', 'The DTEK service is not responding right now.', 'Der DTEK-Dienst antwortet gerade nicht.'],
  ['Нічого не знайдено', 'Nothing found', 'Nichts gefunden'], ['Шукаємо…', 'Searching…', 'Suche…'],
  ['Не вдалося завантажити підказки. Введіть вручну.', 'Could not load suggestions. Type it manually.', 'Vorschläge konnten nicht geladen werden. Bitte manuell eingeben.'],
  ['Перевірити на сайті обленерго', 'Check on the operator’s website', 'Auf der Website des Betreibers prüfen'],
  ['Оберіть населений пункт, вулицю й будинок зі списку підказок — тоді черга визначиться автоматично.', 'Pick the settlement, street and house from the suggestions — then the queue is detected automatically.', 'Wählen Sie Ort, Straße und Haus aus den Vorschlägen — dann wird die Gruppe automatisch ermittelt.'],
  ['Для цього оператора автоматичне визначення черги поки недоступне. Черга вказана в особовому кабінеті оператора або в рахунку.', 'Automatic queue detection is not available for this operator yet. Your queue is shown in the operator’s customer account or on your bill.', 'Für diesen Betreiber ist die automatische Ermittlung noch nicht verfügbar. Ihre Gruppe steht im Kundenkonto des Betreibers oder auf der Rechnung.'],
  ['Черга визначається за офіційними списками адрес Хмельницькобленерго — оберіть населений пункт, вулицю й будинок зі списку підказок. Якщо адреси там немає, перевірте чергу на hoe.com.ua → «Перевірити чергу» і оберіть її тут.', 'The queue is taken from Khmelnytskoblenergo’s official address lists — pick settlement, street and house from the suggestions. If your address is missing, check it at hoe.com.ua → “Перевірити чергу” and choose it here.', 'Die Gruppe stammt aus den offiziellen Adresslisten von Khmelnytskoblenergo — wählen Sie Ort, Straße und Haus aus den Vorschlägen. Fehlt Ihre Adresse, prüfen Sie sie auf hoe.com.ua → „Перевірити чергу“ und wählen Sie sie hier.'],
  ['Автовизначення черги для ДТЕК з’явиться після підключення сервера (вже в плані). Поки що черга вказана на сайті ДТЕК у розділі «Відключення» за вашою адресою.', 'Automatic queue detection for DTEK is unavailable here for now. Your queue is shown on the DTEK website under “Відключення” for your address.', 'Die automatische Ermittlung für DTEK ist hier vorerst nicht verfügbar. Ihre Gruppe steht auf der DTEK-Website unter „Відключення“ für Ihre Adresse.'],
  // сповіщення
  ['Сповіщення', 'Notifications', 'Benachrichtigungen'], ['Надсилати сповіщення', 'Send notifications', 'Benachrichtigungen senden'],
  ['Для всіх ваших адрес', 'For all your addresses', 'Für alle Ihre Adressen'], ['Попереджати за', 'Warn in advance', 'Vorwarnzeit'],
  ['Перед відключенням', 'Before an outage', 'Vor einer Abschaltung'], ['Перед відновленням', 'Before power returns', 'Vor der Rückkehr des Stroms'],
  ['Надіслати тестове сповіщення', 'Send a test notification', 'Testbenachrichtigung senden'],
  ['Попередимо перед відключенням і відновленням, повідомимо про зміни графіка й публікацію графіка на завтра.', 'We warn you before outages and restoration, and tell you about schedule changes and tomorrow’s schedule.', 'Wir warnen vor Abschaltungen und der Rückkehr des Stroms und melden Planänderungen sowie den Plan für morgen.'],
  ['Додайте на початковий екран', 'Add to the Home Screen', 'Zum Home-Bildschirm hinzufügen'],
  ['На iPhone сповіщення працюють лише для застосунку, встановленого на початковий екран (iOS 16.4+).', 'On iPhone, notifications only work for an app added to the Home Screen (iOS 16.4+).', 'Auf dem iPhone funktionieren Benachrichtigungen nur für eine App auf dem Home-Bildschirm (iOS 16.4+).'],
  ['Натисніть «Поділитися» в Safari', 'Tap “Share” in Safari', 'Tippen Sie in Safari auf „Teilen“'], ['Оберіть «На початковий екран»', 'Choose “Add to Home Screen”', 'Wählen Sie „Zum Home-Bildschirm“'],
  ['Відкрийте Electrocity з екрана й увімкніть сповіщення', 'Open Electrocity from the Home Screen and turn on notifications', 'Öffnen Sie Electrocity vom Home-Bildschirm und aktivieren Sie Benachrichtigungen'],
  ['Сповіщення недоступні', 'Notifications unavailable', 'Benachrichtigungen nicht verfügbar'],
  ['Цей браузер не підтримує веб-сповіщення.', 'This browser does not support web notifications.', 'Dieser Browser unterstützt keine Web-Benachrichtigungen.'],
  ['Сповіщення вимкнено в системі', 'Notifications are off in the system', 'Benachrichtigungen sind im System deaktiviert'],
  ['Дозвольте сповіщення для цього сайту в налаштуваннях браузера або системи, потім поверніться сюди.', 'Allow notifications for this site in your browser or system settings, then come back.', 'Erlauben Sie Benachrichtigungen für diese Seite in den Browser- oder Systemeinstellungen und kehren Sie dann zurück.'],
  ['Сервер сповіщень підключається', 'Notification server is connecting', 'Benachrichtigungsserver wird verbunden'], ['Спробуйте трохи згодом.', 'Try again a bit later.', 'Bitte später erneut versuchen.'],
  ['Сповіщення увімкнено', 'Notifications on', 'Benachrichtigungen an'], ['Сповіщення вимкнено', 'Notifications off', 'Benachrichtigungen aus'],
  ['Надіслано — перевірте сповіщення', 'Sent — check your notifications', 'Gesendet — prüfen Sie die Benachrichtigungen'],
  ['Не вдалося надіслати', 'Could not send', 'Senden fehlgeschlagen'], ['Не вдалося', 'Failed', 'Fehlgeschlagen'],
  ['Чергу змінено', 'Queue changed', 'Gruppe geändert'], ['Адресу видалено', 'Address deleted', 'Adresse gelöscht'], ['Графіки оновлено', 'Schedules refreshed', 'Pläne aktualisiert'],
  ['1 год', '1 h', '1 Std.'], ['Змінити', 'Edit', 'Bearbeiten'], ['Назад', 'Back', 'Zurück'], ['Обрати', 'Choose', 'Wählen'],
  ['Завантаження', 'Loading', 'Laden'], ['Скопіювати', 'Copy', 'Kopieren'], ['Скопійовано', 'Copied', 'Kopiert'],
  // сторінка встановлення
  ['Встановити Electrocity — графік відключень', 'Install Electrocity — outage schedule', 'Electrocity installieren — Abschaltplan'],
  ['. Графік відключень для вашої адреси — з офіційних джерел.', '. Outage schedule for your address — from official sources.', '. Abschaltplan für Ihre Adresse — aus offiziellen Quellen.'],
  ['Безкоштовно', 'Free', 'Kostenlos'], ['Без реєстрації', 'No sign-up', 'Ohne Registrierung'], ['Встановити', 'Install', 'Installieren'],
  ['Застосунок встановлено', 'App installed', 'App installiert'], ['Відкрити в браузері', 'Open in browser', 'Im Browser öffnen'], ['Як встановити', 'How to install', 'So installieren Sie'],
  ['Відкрийте цю сторінку в', 'Open this page in', 'Öffnen Sie diese Seite in'], ['Натисніть', 'Tap', 'Tippen Sie auf'], ['на панелі внизу', 'in the bottom bar', 'in der unteren Leiste'],
  ['Прокрутіть і оберіть', 'Scroll and choose', 'Scrollen und wählen Sie'], ['На початковий екран', 'Add to Home Screen', 'Zum Home-Bildschirm'], ['Додати', 'Add', 'Hinzufügen'],
  ['— іконка з’явиться на екрані «Додому»', '— the icon appears on your Home Screen', '— das Symbol erscheint auf dem Home-Bildschirm'],
  ['Відкрийте сторінку в', 'Open the page in', 'Öffnen Sie die Seite in'], ['і натисніть', 'and tap', 'und tippen Sie auf'], ['вище', 'above', 'oben'],
  ['Якщо кнопка не спрацювала: меню', 'If the button did not work: menu', 'Falls die Schaltfläche nicht funktioniert: Menü'], ['Встановити застосунок', 'Install app', 'App installieren'],
  ['або', 'or', 'oder'], ['Додати на головний екран', 'Add to Home screen', 'Zum Startbildschirm hinzufügen'],
  ['Підтвердьте — іконка з’явиться на робочому столі', 'Confirm — the icon appears on your home screen', 'Bestätigen — das Symbol erscheint auf dem Startbildschirm'],
  ['(macOS Sonoma і новіші): меню', '(macOS Sonoma and newer): menu', '(macOS Sonoma und neuer): Menü'], ['Файл', 'File', 'Ablage'], ['Додати в Dock', 'Add to Dock', 'Zum Dock hinzufügen'],
  [': натисніть', ': click', ': klicken Sie auf'], ['вище або значок установки в адресному рядку', 'above or the install icon in the address bar', 'oben oder das Installationssymbol in der Adressleiste'],
  ['Electrocity відкриватиметься окремим вікном, як звичайна програма', 'Electrocity opens in its own window, like a regular app', 'Electrocity öffnet sich in einem eigenen Fenster wie eine normale App'],
  ['Чому не одним натисканням?', 'Why not one tap?', 'Warum nicht mit einem Tipp?'],
  ['Apple не дозволяє сайтам самостійно додавати іконку на iPhone — потрібні два дотики в меню «Поділитися». Після встановлення працюють і сповіщення (iOS 16.4+).', 'Apple does not let websites add an icon to the iPhone themselves — it takes two taps in the “Share” menu. Once installed, notifications work too (iOS 16.4+).', 'Apple erlaubt Websites nicht, selbst ein Symbol auf dem iPhone anzulegen — es braucht zwei Tipps im Menü „Teilen“. Nach der Installation funktionieren auch Benachrichtigungen (iOS 16.4+).'],
  ['Статус і таймер до відключення', 'Status and countdown to outage', 'Status und Countdown bis zur Abschaltung'], ['Підказки адреси та черга', 'Address suggestions and queue', 'Adressvorschläge und Gruppe'],
  ['Кілька адрес: дім, робота', 'Several addresses: home, work', 'Mehrere Adressen: Zuhause, Arbeit'], ['Без акаунта, дані на пристрої', 'No account, data stays on device', 'Kein Konto, Daten bleiben auf dem Gerät'],
  ['Статус — за опублікованими графіками операторів, а не фактична наявність світла.', 'Status follows the operators’ published schedules, not the actual presence of power.', 'Der Status folgt den veröffentlichten Plänen der Betreiber, nicht der tatsächlichen Stromversorgung.'],
  ['Платформа', 'Platform', 'Plattform'], ['Відкрити Electrocity', 'Open Electrocity', 'Electrocity öffnen'],
  ['Electrocity вже встановлено на цьому пристрої', 'Electrocity is already installed on this device', 'Electrocity ist auf diesem Gerät bereits installiert'],
  ['Готово! Іконка Electrocity — на робочому столі', 'Done! The Electrocity icon is on your home screen', 'Fertig! Das Electrocity-Symbol ist auf dem Startbildschirm'],
  ['Натисніть «Поділитися» → «На початковий екран»', 'Tap “Share” → “Add to Home Screen”', 'Tippen Sie auf „Teilen“ → „Zum Home-Bildschirm“'],
  ['Меню «Файл» → «Додати в Dock»', 'Menu “File” → “Add to Dock”', 'Menü „Ablage“ → „Zum Dock hinzufügen“'],
  ['Меню браузера → «Встановити застосунок»', 'Browser menu → “Install app”', 'Browsermenü → „App installieren“'],
  ['внизу → «На початковий екран»', 'at the bottom → “Add to Home Screen”', 'unten → „Zum Home-Bildschirm“'],
  // регіони
  ['м. Київ', 'Kyiv city', 'Stadt Kyjiw'], ['Київська', 'Kyiv Oblast', 'Oblast Kyjiw'], ['Вінницька', 'Vinnytsia Oblast', 'Oblast Winnyzja'],
  ['Волинська', 'Volyn Oblast', 'Oblast Wolyn'], ['Дніпропетровська', 'Dnipropetrovsk Oblast', 'Oblast Dnipropetrowsk'], ['Донецька', 'Donetsk Oblast', 'Oblast Donezk'],
  ['Житомирська', 'Zhytomyr Oblast', 'Oblast Schytomyr'], ['Закарпатська', 'Zakarpattia Oblast', 'Oblast Transkarpatien'], ['Запорізька', 'Zaporizhzhia Oblast', 'Oblast Saporischschja'],
  ['Івано-Франківська', 'Ivano-Frankivsk Oblast', 'Oblast Iwano-Frankiwsk'], ['Кіровоградська', 'Kirovohrad Oblast', 'Oblast Kirowohrad'], ['Луганська', 'Luhansk Oblast', 'Oblast Luhansk'],
  ['Львівська', 'Lviv Oblast', 'Oblast Lwiw'], ['Миколаївська', 'Mykolaiv Oblast', 'Oblast Mykolajiw'], ['Одеська', 'Odesa Oblast', 'Oblast Odessa'],
  ['Полтавська', 'Poltava Oblast', 'Oblast Poltawa'], ['Рівненська', 'Rivne Oblast', 'Oblast Riwne'], ['Сумська', 'Sumy Oblast', 'Oblast Sumy'],
  ['Тернопільська', 'Ternopil Oblast', 'Oblast Ternopil'], ['Харківська', 'Kharkiv Oblast', 'Oblast Charkiw'], ['Херсонська', 'Kherson Oblast', 'Oblast Cherson'],
  ['Хмельницька', 'Khmelnytskyi Oblast', 'Oblast Chmelnyzkyj'], ['Черкаська', 'Cherkasy Oblast', 'Oblast Tscherkassy'], ['Чернівецька', 'Chernivtsi Oblast', 'Oblast Tscherniwzi'],
  ['Чернігівська', 'Chernihiv Oblast', 'Oblast Tschernihiw'],
  // оператори (власні назви — латиницею)
  ['ДТЕК Київські електромережі', 'DTEK Kyiv Grids', 'DTEK Kyiv Grids'], ['ДТЕК Київські регіональні електромережі', 'DTEK Kyiv Regional Grids', 'DTEK Kyiv Regional Grids'],
  ['ДТЕК Дніпровські електромережі', 'DTEK Dnipro Grids', 'DTEK Dnipro Grids'], ['ДТЕК Донецькі електромережі', 'DTEK Donetsk Grids', 'DTEK Donetsk Grids'],
  ['ДТЕК Одеські електромережі', 'DTEK Odesa Grids', 'DTEK Odesa Grids'], ['Вінницяобленерго', 'Vinnytsiaoblenergo', 'Vinnytsiaoblenergo'],
  ['Волиньобленерго', 'Volynoblenergo', 'Volynoblenergo'], ['Житомиробленерго', 'Zhytomyroblenergo', 'Zhytomyroblenergo'], ['Закарпаттяобленерго', 'Zakarpattiaoblenergo', 'Zakarpattiaoblenergo'],
  ['Запоріжжяобленерго', 'Zaporizhzhiaoblenergo', 'Zaporizhzhiaoblenergo'], ['Прикарпаттяобленерго', 'Prykarpattiaoblenergo', 'Prykarpattiaoblenergo'], ['Кіровоградобленерго', 'Kirovohradoblenergo', 'Kirovohradoblenergo'],
  ['Луганське енергетичне об’єднання', 'Luhansk Energy Association', 'Luhansk Energy Association'], ['Львівобленерго', 'Lvivoblenergo', 'Lvivoblenergo'], ['Миколаївобленерго', 'Mykolaivoblenergo', 'Mykolaivoblenergo'],
  ['Полтаваобленерго', 'Poltavaoblenergo', 'Poltavaoblenergo'], ['Рівнеобленерго', 'Rivneoblenergo', 'Rivneoblenergo'], ['Сумиобленерго', 'Sumyoblenergo', 'Sumyoblenergo'],
  ['Тернопільобленерго', 'Ternopiloblenergo', 'Ternopiloblenergo'], ['Харківобленерго', 'Kharkivoblenergo', 'Kharkivoblenergo'], ['Херсонобленерго', 'Khersonoblenergo', 'Khersonoblenergo'],
  ['Хмельницькобленерго', 'Khmelnytskoblenergo', 'Khmelnytskoblenergo'], ['Черкасиобленерго', 'Cherkasyoblenergo', 'Cherkasyoblenergo'], ['Чернівціобленерго', 'Chernivtsioblenergo', 'Chernivtsioblenergo'],
  ['Чернігівобленерго', 'Chernihivoblenergo', 'Chernihivoblenergo'],
  ['графік в один клік.', 'schedule in one click.', 'Plan mit einem Klick.'],
  ['Миттєво', 'Instantly', 'Sofort'], ['зараз', 'now', 'jetzt'], ['Відключення о', 'Outage at', 'Abschaltung um'], ['Відновлення о', 'Power returns at', 'Strom zurück um'],
  ['Графік на добу', 'Schedule for the day', 'Tagesplan'],
  ['Аварійне відключення за вашою адресою', 'Emergency outage at your address', 'Notabschaltung an Ihrer Adresse'], ['Планові роботи зараз', 'Planned works now', 'Geplante Arbeiten jetzt'],
  ['Планові роботи за вашою адресою', 'Planned works at your address', 'Geplante Arbeiten an Ihrer Adresse'],
  ['За вашою адресою аварій і планових робіт не зареєстровано', 'No emergencies or planned works registered at your address', 'Keine Störungen oder geplanten Arbeiten an Ihrer Adresse gemeldet'],
  ['Аварії та роботи за адресою', 'Emergencies and works at the address', 'Störungen und Arbeiten an der Adresse'], ['Хмельницька й Одеська області', 'Khmelnytskyi and Odesa oblasts', 'Oblaste Chmelnyzkyj und Odessa'],
  ['ваш будинок', 'your house', 'Ihr Haus'], ['уся вулиця', 'the whole street', 'die ganze Straße'], ['увесь населений пункт', 'the whole settlement', 'der ganze Ort'], ['джерело', 'source', 'Quelle'],
  ['Екстренні відключення (Аварійне без застосування графіку погодинних відключень)', 'Emergency outage (not part of the hourly schedule)', 'Notabschaltung (außerhalb des Stundenplans)'],
  ['Аварійні', 'Emergency', 'Notfall'], ['Планові', 'Planned', 'Geplant'], ['Черга', 'Queue', 'Gruppe'], ['Українська', 'Українська', 'Українська'], ['English', 'English', 'English'], ['Deutsch', 'Deutsch', 'Deutsch'],
];
const DICT = { en: new Map(), de: new Map() };
for (const [uk, en, de] of T) { DICT.en.set(uk, en); DICT.de.set(uk, de); }

const dur = { en: [' h', ' min'], de: [' Std.', ' Min.'] };
const D = s => s.replace(/(\d+) год/g, (_, n) => n + dur[lang][0]).replace(/(\d+) хв/g, (_, n) => n + dur[lang][1]);
const op = name => DICT[lang].get(name) || name;
// [регулярний вираз, en(…групи), de(…групи)]
const P = [
  [/^Орієнтовне відновлення о (\S+)(.*)$/, (t, r) => `Expected back at ${t}${r}`, (t, r) => `Voraussichtlich zurück um ${t}${r}`],
  [/^· перевірено о (.+)$/, t => `· checked at ${t}`, t => `· geprüft um ${t}`],
  [/^(.+) · перевірено о (\S+) ·$/, (o, t) => `${op(o)} · checked at ${t} ·`, (o, t) => `${op(o)} · geprüft um ${t} ·`],
  [/^орієнтовно до (.+)$/, t => `until about ${t}`, t => `voraussichtlich bis ${t}`],
  [/^Обрати (.+)$/, q => `Choose ${q}`, q => `${q} wählen`],
  [/^(Світло є|Відключення|Можливе|Невідомо|Аварія|Можливе відключення) (\d.*)$/, (a, b) => `${tr(a)} ${b}`, (a, b) => `${tr(a)} ${b}`],
  [/^Для всіх ваших адрес \((\d+)\)$/, n => `For all your addresses (${n})`, n => `Für alle Ihre Adressen (${n})`],
  [/^Черга (\S+)$/, q => `Queue ${q}`, q => `Gruppe ${q}`],
  [/^Черги (.+)$/, o => `Queues of ${op(o)}`, o => `Gruppen von ${op(o)}`],
  [/^Крок (\d) з (\d)$/, (a, b) => `Step ${a} of ${b}`, (a, b) => `Schritt ${a} von ${b}`],
  [/^через (.+)$/, d => `in ${D(d)}`, d => `in ${D(d)}`],
  [/^ще (.+)$/, d => `${D(d)} left`, d => `noch ${D(d)}`],
  [/^(\d+) (год|хв)(.*)$/, (...g) => D(g.slice(0, 3).join(' ').replace(/ (год|хв) ?/, ' $1 ')).trim(), (...g) => D(g.slice(0, 3).join(' ').replace(/ (год|хв) ?/, ' $1 ')).trim()],
  [/^Відключення о (.+)$/, t => `Outage at ${t}`, t => `Abschaltung um ${t}`],
  [/^Відновлення о (.+)$/, t => `Power returns at ${t}`, t => `Strom zurück um ${t}`],
  [/^з (\S+) до (\S+)$/, (a, b) => `from ${a} to ${b}`, (a, b) => `von ${a} bis ${b}`],
  [/^Графік на (сьогодні|завтра)$/, d => `Schedule for ${d === 'сьогодні' ? 'today' : 'tomorrow'}`, d => `Plan für ${d === 'сьогодні' ? 'heute' : 'morgen'}`],
  [/^Графік на (.+)$/, d => `Schedule for ${d}`, d => `Plan für ${d}`],
  [/^Немає даних для черги (.+)$/, q => `No data for queue ${q}`, q => `Keine Daten für Gruppe ${q}`],
  [/^опубліковано (.+)$/, t => `published ${t}`, t => `veröffentlicht ${t}`],
  [/^оновлено (.+)$/, t => `updated ${t}`, t => `aktualisiert ${t}`],
  [/^Демо-дані · джерело (.+) ще не підключене$/, o => `Demo data · source ${op(o)} not connected yet`, o => `Demo-Daten · Quelle ${op(o)} noch nicht verbunden`],
  [/^Визначено за даними (.+)$/, o => `Based on ${op(o)} data`, o => `Laut Daten von ${op(o)}`],
  [/^За даними (.+?) різні під’їзди чи лінії цього будинку мають різні черги\. Свою чергу можна дізнатися в рахунку або особовому кабінеті\. Оберіть її:$/,
    o => `According to ${op(o)}, different entrances or lines of this house are in different queues. Your queue is on your bill or in your customer account. Choose it:`,
    o => `Laut ${op(o)} gehören Eingänge oder Leitungen dieses Hauses zu verschiedenen Gruppen. Ihre Gruppe steht auf der Rechnung oder im Kundenkonto. Wählen Sie sie:`],
  [/^(.+) Оберіть чергу вручну на наступному кроці\.$/, w => `${tr(w)} Choose the queue manually in the next step.`, w => `${tr(w)} Wählen Sie die Gruppe im nächsten Schritt manuell.`],
  [/^Оберіть її вручну\. (.+)$/, w => `Choose it manually. ${tr(w)}`, w => `Wählen Sie sie manuell. ${tr(w)}`],
  [/^Адресу «(.+)» збережено$/, n => `Address “${tr(n)}” saved`, n => `Adresse „${tr(n)}“ gespeichert`],
  [/^Видалити «(.+)»\? Адресу буде видалено з цього пристрою\.$/, n => `Delete “${tr(n)}”? The address will be removed from this device.`, n => `„${tr(n)}“ löschen? Die Adresse wird von diesem Gerät entfernt.`],
  [/^Не вдалося: (.+)$/, e => `Failed: ${e}`, e => `Fehlgeschlagen: ${e}`],
  [/^Планове відключення · (.+)$/, s => `Scheduled outage · ${tr(s)}`, s => `Geplante Abschaltung · ${tr(s)}`],
  [/^За (\d+) хв$/, n => `${n} min before`, n => `${n} Min. vorher`],
  [/^(\d+) хв$/, n => `${n} min`, n => `${n} Min.`],
  [/^(.+) · Electrocity$/, n => `${tr(n)} · Electrocity`, n => `${tr(n)} · Electrocity`],
  [/^Electrocity — графік відключень$/, () => 'Electrocity — outage schedule', () => 'Electrocity — Abschaltplan'],
];

export function tr(s) {
  if (lang === 'uk' || !s || !/[А-Яа-яІіЇїЄєҐґ]/.test(s)) return s;
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/); const core = m[2];
  const d = DICT[lang].get(core); if (d != null) return m[1] + d + m[3];
  for (const [re, en, de] of P) { const g = core.match(re); if (g) return m[1] + (lang === 'en' ? en : de)(...g.slice(1)) + m[3]; }
  if (core.includes(' · ')) { const parts = core.split(' · '); const t = parts.map(tr); if (t.some((x, i) => x !== parts[i])) return m[1] + t.join(' · ') + m[3]; }
  if (core.includes(', ')) { const parts = core.split(', '); const t = parts.map(tr); if (t.some((x, i) => x !== parts[i])) return m[1] + t.join(', ') + m[3]; }
  if (/\d+ (год|хв)/.test(core)) return m[1] + D(core) + m[3];
  return s;
}

const ATTRS = ['placeholder', 'aria-label', 'title'];
const done = new WeakMap();
function trNode(n) {
  if (n.nodeType === 3) { if (done.get(n) === n.data) return; const t = tr(n.data); if (t !== n.data) n.data = t; done.set(n, n.data); return; }
  if (n.nodeType !== 1 || n.closest?.('[data-noi18n]')) return;
  for (const a of ATTRS) if (n.hasAttribute(a)) { const v = n.getAttribute(a), t = tr(v); if (t !== v) n.setAttribute(a, t); }
  if (n.tagName === 'INPUT' && n.type === 'button') { const t = tr(n.value); if (t !== n.value) n.value = t; }
  const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let c = w.nextNode(); c; c = w.nextNode()) {
    if (c.nodeType === 1) { if (c.closest('[data-noi18n]')) continue; for (const a of ATTRS) if (c.hasAttribute(a)) { const v = c.getAttribute(a), t = tr(v); if (t !== v) c.setAttribute(a, t); } }
    else if (!c.parentElement?.closest('[data-noi18n],script,style')) { const t = tr(c.data); if (t !== c.data) c.data = t; }
  }
}
let obs = null;
export function setLang(l) {
  lang = LANGS[l] ? l : 'uk';
  document.documentElement.lang = lang;
  obs?.disconnect(); obs = null;
  if (lang === 'uk') return;
  trNode(document.body);
  const tt = tr(document.title); if (tt !== document.title) document.title = tt;
  obs = new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'characterData') trNode(m.target);
      else if (m.type === 'attributes') trNode(m.target);
      else m.addedNodes.forEach(trNode);
    }
    const t = tr(document.title); if (t !== document.title) document.title = t;
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
// Мова за замовчуванням — українська; англійська й німецька лише за вибором у налаштуваннях
export function detectLang() { return 'uk'; }
