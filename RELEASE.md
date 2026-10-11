# Как устроена блокировка до релиза

До **6 сентября, 16:00 МСК** сайт показывает только заставку с названием и
обратным отсчётом. Интерфейс калькулятора и карта скрыты.

Карту (`map.js`, ~2.7 МБ) **физически нельзя достать через dev tools** до релиза:
в репозитории лежит только зашифрованный `map.enc` (AES-256-GCM), а ключ в
репозиторий не попадает. Страница подгружает `map.js` только когда наступает
время И файл реально опубликован.

## Ранний доступ по ключу

На заставке есть поле «Ключ раннего доступа». Если ввести туда `MAP_KEY`
(те же 64 hex-символа), страница сама скачает `map.enc`, расшифрует карту
прямо в браузере (WebCrypto, AES-256-GCM) и откроет калькулятор, не дожидаясь
16:00. Неверный ключ не проходит проверку GCM — показывается ошибка.

Отдельный «пароль» нигде не хранится: код доступа и есть ключ шифрования,
поэтому раздавать его нужно только тем, кому реально можно видеть карту
до релиза. Всем остальным `map.enc` бесполезен. Работает только по https
(на GitHub Pages — да; локально по `file://` WebCrypto недоступен).

## Вариант A — автоматически (GitHub Action)

1. Один раз добавь секрет репозитория:
   `Settings → Secrets and variables → Actions → New repository secret`
   - Name: `MAP_KEY`
   - Secret: ключ из 64 hex-символов (сохранён отдельно, не в репозитории)

   Или через CLI:
   ```
   gh secret set MAP_KEY --repo Gorkeder/artillery-calculator
   ```

2. Ничего больше делать не нужно. Workflow `.github/workflows/release-map.yml`
   сам запустится 6 сентября в 13:00 UTC (16:00 МСК), расшифрует карту и
   закоммитит `map.js`. GitHub Pages пересоберётся за пару минут.

3. Хочешь открыть ровно в 16:00:00 — зайди в `Actions → Release map →
   Run workflow` и запусти вручную в нужную секунду.

## Вариант B — вручную

В момент релиза, находясь в папке репозитория с расшифрованным `map.js`:

```
git add -f map.js
git commit -m "Release: publish map"
git push
```

## Пересобрать map.enc (если карта поменялась)

```
export MAP_KEY=<64 hex-символа>
node tools/encrypt-map.js      # map.js -> map.enc
```

## Проверить расшифровку локально

```
export MAP_KEY=<64 hex-символа>
node tools/decrypt-map.js      # map.enc -> map.js
```

## Лента видео ютуберов (`videos.json`)

Панель с видео на главной читает статический `/var/www/anoma/videos.json`.
Файл генерирует `tools/youtube-feed-fetcher.js` — этот скрипт **не входит**
в обычный деплой (`tools/` исключена из `deploy.yml`), поэтому его нужно
один раз вручную скопировать на VPS и повесить на cron.

1. Скопировать на сервер (в любую рабочую папку, не обязательно в
   `/var/www/anoma`):
   ```
   scp tools/youtube-feed-lib.js tools/youtube-feed-fetcher.js deploy@<host>:/opt/anoma-tools/
   ```

2. На сервере создать файл окружения (например `/opt/anoma-tools/.env`,
   права `600`, не в git):
   ```
   YOUTUBE_API_KEY=<ключ из Google Cloud Console>
   YOUTUBE_CHANNELS=UCxxxxxxxx:Имя канала 1,UCyyyyyyyy:Имя канала 2
   YOUTUBE_OFFICIAL_CHANNEL_ID=UCxxxxxxxx
   OUTPUT_PATH=/var/www/anoma/videos.json
   ```
   Разбор `YOUTUBE_CHANNELS` наивный (просто split по запятой), поэтому имена
   каналов не должны содержать запятых.

   `YOUTUBE_OFFICIAL_CHANNEL_ID` — необязательный, id одного из каналов
   выше (должен совпадать один в один с частью до `:` в `YOUTUBE_CHANNELS`).
   Видео с этого канала помечаются на сайте золотой рамкой и бейджем
   «Официальный». Если не задать — выделения не будет, но лента продолжит
   работать как обычно.

   `/var/www/anoma` обычно принадлежит не тому пользователю, от которого
   идёт деплой (в нашем случае — `deploy`), поэтому для записи нужен ACL:
   ```
   sudo setfacl -m u:deploy:rwx,mask::rwx /var/www/anoma
   ```
   `rsync` в `deploy.yml` при каждом деплое трогает права `/var/www/anoma`
   и тем самым сбрасывает ACL-маску (даже если сами биты не менялись) —
   без маски `rwx`-запись для `deploy` просто перестаёт действовать, и
   cron начинает молча падать на `EACCES`. Поэтому `deploy.yml` сам
   переустанавливает эту ACL отдельным шагом после каждого `rsync` —
   вручную это нужно сделать только один раз, при первой настройке.

3. Проверить вручную:
   ```
   set -a; source /opt/anoma-tools/.env; set +a
   node /opt/anoma-tools/youtube-feed-fetcher.js
   cat /var/www/anoma/videos.json
   ```
   Файл пишется с правами по умолчанию (umask пользователя, от которого
   запущен cron), поэтому после первого прогона стоит убедиться, что nginx
   (обычно `www-data`) вообще может его прочитать:
   ```
   sudo -u www-data cat /var/www/anoma/videos.json
   # или
   ls -l /var/www/anoma/videos.json
   ```
   Если файл нечитаем — `chmod 644 /var/www/anoma/videos.json` или поправить
   umask пользователя cron. Иначе панель с видео на сайте просто молча
   исчезнет (неотличимо от «лента ещё не готова»).

4. Добавить в crontab пользователя, от которого можно писать в
   `/var/www/anoma` (запуск раз в час):
   ```
   0 * * * * set -a; . /opt/anoma-tools/.env; set +a; /usr/bin/node /opt/anoma-tools/youtube-feed-fetcher.js >> /opt/anoma-tools/anoma-video-feed.log 2>&1
   ```
   Два тонких места, из-за которых первая попытка тихо не срабатывает:
   - Просто `. /opt/anoma-tools/.env` (без `set -a`/`set +a`) не экспортирует
     переменные в окружение — `node` их не увидит и сразу упадёт с
     «YOUTUBE_API_KEY не задан».
   - `/var/log/` обычно недоступен для записи обычному пользователю
     (`drwxrwxr-x root:syslog`) — cron-строка с `>> /var/log/...` в этом
     случае молча не выполнится вообще (даже `node` не запустится), а
     ошибку перенаправления cron просто выбросит («No MTA installed,
     discarding output» в `journalctl -u cron`). Держите лог рядом со
     скриптом — `/opt/anoma-tools/`, куда у пользователя cron точно есть
     доступ на запись.

Обновить список каналов — отредактировать `YOUTUBE_CHANNELS` в
`/opt/anoma-tools/.env` на сервере и один раз прогнать скрипт вручную
(шаг 3), в репозиторий список каналов не попадает.

Если у одного из каналов упадёт запрос (канал удалён/переименован/стал
приватным), скрипт по задумке прерывает весь прогон и **не трогает**
`videos.json` — лента молча замораживается на последнем удачном снепшоте,
и никакого предупреждения на сайте не будет. Заметить это можно так:
проверить `tail /opt/anoma-tools/anoma-video-feed.log` на свежие ошибки, и/или
посмотреть поле `generatedAt` в `/var/www/anoma/videos.json` — если оно
сильно отстаёт от текущего времени, лента давно не обновлялась.


## Карта-редактор (`/map`) — API и данные

Страница `map.html` (`/map`) работает поверх маленького API (`server/`, Node 22+, без зависимостей).
Данные: SQLite `/var/lib/anoma/db/anoma.db` (каталог `db/` — 0700, владелец `anoma`, внутри хэши паролей),
фото и картинки карт — `/var/lib/anoma/uploads/` (их отдаёт nginx). Код — `/opt/anoma-api`,
сервис `anoma-api` (systemd), слушает `127.0.0.1:3000`, проксируется на `/api/`.

**Деплой.** Пуш в `master` выкладывает статику в `/var/www/anoma` и синхронизирует `server/` в
`/opt/anoma-api` с перезапуском сервиса. База и загрузки деплоем не затрагиваются.

**Первичная установка** (один раз, на VPS):

    sudo useradd --system --home /var/lib/anoma --shell /usr/sbin/nologin anoma
    sudo install -d -o anoma -g anoma -m 0755 /var/lib/anoma /var/lib/anoma/uploads
    sudo install -d -o anoma -g anoma -m 0700 /var/lib/anoma/db
    sudo install -d -o deploy -g deploy -m 0755 /opt/anoma-api
    # скопировать server/ в /opt/anoma-api, положить server/deploy/anoma-api.service
    # в /etc/systemd/system/, затем:
    sudo systemctl daemon-reload && sudo systemctl enable --now anoma-api
    # nginx: server/deploy/nginx-limits.conf -> /etc/nginx/conf.d/anoma-limits.conf,
    # server/deploy/nginx-map.conf -> внутрь HTTPS server{} перед `location /`; nginx -t && reload

**Создать администратора** (пароль не попадает в историю команд и репозиторий):

    read -rs ANOMA_PASSWORD && export ANOMA_PASSWORD
    sudo -u anoma --preserve-env=ANOMA_PASSWORD env ANOMA_DB=/var/lib/anoma/db/anoma.db \
      ANOMA_UPLOADS=/var/lib/anoma/uploads node /opt/anoma-api/cli.js create-admin <login>
    unset ANOMA_PASSWORD

**Первая карта из `map.js`:**

    sudo -u anoma env ANOMA_DB=/var/lib/anoma/db/anoma.db ANOMA_UPLOADS=/var/lib/anoma/uploads \
      node /opt/anoma-api/cli.js seed-map main "Основная карта" /var/www/anoma/map.js

**Бэкап.** Копировать нужно `/var/lib/anoma/db/anoma.db` (через `sqlite3 … ".backup …"`) и каталог
`/var/lib/anoma/uploads`. Ежедневный cron из сентябрьской настройки VPS должен указывать на новый путь БД.

**Локальная разработка:**

    export ANOMA_DB=.dev/db/anoma.db ANOMA_UPLOADS=.dev/uploads COOKIE_SECURE=0 DEV_STATIC=.
    export MAIL_MODE=log PUBLIC_URL=http://localhost:3000   # письма печатаются в консоль сервера
    ANOMA_PASSWORD=dev-password-1 node server/cli.js create-admin admin
    node server/cli.js seed-map main "Основная карта" map.js
    node server/index.js          # http://localhost:3000/map

**Тесты:** `node --test server/test/*.test.js tools/*.test.js`.

**Откат.** Сервис: вернуть предыдущий коммит и пушнуть (или `sudo systemctl stop anoma-api` — тогда
`/map` покажет «Не удалось загрузить карту», остальной сайт не затронут). Данные: восстановить
`anoma.db` из бэкапа при остановленном сервисе.

## Аккаунты пользователей и почта

Спек: `docs/superpowers/specs/2026-10-11-user-accounts-design.md`. Код: `server/routes/account.js`,
`server/mailer.js`, `server/tokens.js`; страницы `/account` и `/privacy`. Файлы из `server/deploy/`
деплоем **не выкладываются** — на VPS их нужно обновить руками (шаг 4).

**Что нужно подготовить один раз (владелец сайта):**

1. Почтовый ящик `noreply@anoma-wiki.ru` в панели Beget (раздел «Почта») — он уже создан. DNS домена и MX
   (mx1/mx2.beget.com, SPF `redirect=beget.com`) тоже у Beget. SPF и DKIM для почты Beget ведёт сам Beget:
   в панели проверить, что для домена включена DKIM-подпись, а после первой отправки открыть заголовки
   полученного письма и убедиться, что `spf=pass` и `dkim=pass`. Отправлять напрямую с VPS **нельзя**:
   у IP сервера нет PTR (проверено 2026-10-11), только через SMTP Beget. Исходящие порты 465 к
   `smtp.beget.com` и 25 с VPS открыты (проверено тем же пробным запуском 2026-10-11).
2. Создать на VPS `/etc/anoma/api.env` (владелец `root`, права `0600`) с содержимым:

       MAIL_MODE=smtp
       SMTP_HOST=smtp.beget.com
       SMTP_PORT=465
       SMTP_USER=noreply@anoma-wiki.ru
       SMTP_PASS=<пароль ящика>
       MAIL_FROM=noreply@anoma-wiki.ru

   `PUBLIC_URL=https://anoma-wiki.ru` уже прописан в юните. **Пароль вводит владелец сам на сервере**,
   не в чате и не в команде. Команда ниже спрашивает пароль скрытым вводом (в историю оболочки и в список
   процессов он не попадает: `read` и `printf` — встроенные команды), пишет весь файл с правами `0600`,
   владелец `root:root`, и заменяет его атомарно. Кавычки и обратные слэши в пароле экранируются под
   разбор `EnvironmentFile` в systemd:

       sudo bash -c 'set -eu; umask 077; f=/etc/anoma/api.env; mkdir -p /etc/anoma
       read -rsp "SMTP password: " P; echo
       bs=$(printf "\\\\"); q="\""
       P=${P//"$bs"/"$bs$bs"}; P=${P//"$q"/"$bs$q"}
       {
         printf "MAIL_MODE=smtp
SMTP_HOST=smtp.beget.com
SMTP_PORT=465
"
         printf "SMTP_USER=noreply@anoma-wiki.ru
MAIL_FROM=noreply@anoma-wiki.ru
"
         printf "SMTP_PASS=\"%s\"
" "$P"
       } > "$f.new"
       chown root:root "$f.new"; chmod 600 "$f.new"; mv "$f.new" "$f"'

   Проверить без показа пароля: `sudo ls -l /etc/anoma/api.env` (ожидается `-rw------- root root`)
   и `sudo cut -d= -f1 /etc/anoma/api.env` (только имена переменных).
3. Перед первым деплоем с миграцией снять бэкап БД: `sudo /usr/local/bin/anoma-backup.sh`.
4. Обновить на VPS юнит и nginx из `server/deploy/`: `anoma-api.service` -> `/etc/systemd/system/`,
   `nginx-limits.conf` -> `/etc/nginx/conf.d/anoma-limits.conf`, блоки из `nginx-map.conf` (`/account`,
   `/privacy`, regex-`location` для `register|forgot-password|resend-verification`) -> в HTTPS `server{}`
   перед `location /api/`. Затем:

       sudo systemctl daemon-reload && sudo nginx -t && sudo systemctl reload nginx && sudo systemctl restart anoma-api

   Регулярное `location ~ ^/api/(register|forgot-password|resend-verification)$` приоритетнее обычного
   префикса `location /api/`, а точный `location = /api/login` обрабатывается раньше обоих.
5. Выкладка кода: пуш в `master` (статика `account.html`, `account.js`, `account.css`, `account-nav.js`,
   `privacy.html` + `server/`). Миграция БД выполняется сама при старте сервиса.

**Проверка на проде:** зарегистрироваться тестовым аккаунтом, убедиться, что письмо пришло во «Входящие»
(не в «Спам»), перейти по ссылке, войти, выйти, пройти «Забыли пароль?». Посмотреть заголовки письма
(`spf=pass`, `dkim=pass`).

**Пока почта не настроена:** `MAIL_MODE` не задан, регистрация, повторная отправка и сброс пароля отвечают 503,
вход админа и карта работают как раньше.

**Смена пароля админа:** `ANOMA_PASSWORD=<новый> node /opt/anoma-api/cli.js set-password admin`
(закрывает все сессии этого пользователя; пароль вводить так же, как при `create-admin` — через `read -rs`).

**Локально:** `MAIL_MODE=log PUBLIC_URL=http://localhost:3000` — письма печатаются в консоль сервера.

**Если письма не уходят:** `journalctl -u anoma-api -n 50` (токены и тела писем в лог не пишутся). Если
Beget не принимает `AUTH PLAIN`, нужно добавить `AUTH LOGIN` в `server/mailer.js` (сейчас реализован только
`AUTH PLAIN`). Ошибка отправки не ломает регистрацию — пользователь может нажать «Выслать ещё раз».

**Известные ограничения (приняты):**
- Блокировка входа: ~10 неудачных попыток входа в один аккаунт за 10 минут (лимитер по аккаунту) закрывают
  вход в него на 10 минут, в том числе с чужого IP. Так задумано спеком.
- Остаточная двухшаговая проверка существования почты: зарегистрировать свежий логин с почтой X, затем тот же
  логин с другой почтой — `409 login_taken` ответит, только если X была свободна. Ограничена лимитами
  регистрации; полноценное исправление требует отложенного создания аккаунта.
- Команда `cli.js set-password` не аннулирует уже выданные токены сброса пароля.
- Страница `/privacy` — заготовка для владельца и юриста, не готовый юридический текст.
- Браузерные сценарии (вёрстка на 375 px, стирание фрагмента с токеном, возврат по `?next=`) автоматикой
  кликами не проверялись — до анонса нужно один раз пройти их руками на телефоне и ПК.

**Откат.** Убрать `MAIL_MODE` из `/etc/anoma/api.env` и перезапустить сервис — регистрация отключится.
Миграция БД обратима только из бэкапа; новые колонки старый код игнорирует.
