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

    IFS= read -rs ANOMA_PASSWORD && export ANOMA_PASSWORD
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

## Личные метки (этап C)

Спек: `docs/superpowers/specs/2026-10-11-personal-marks-design.md`. Код: `server/routes/marks.js`,
`map-marks.js`, `map-marks-editor.js`.

- Миграция 3 (`user_marks`) выполняется сама при старте `anoma-api`. **Перед деплоем сделать бэкап БД**
  (как для миграции 2); пуш в `master` выкладывает и статику, и `server/`.
- Метки видны только владельцу; публичные `GET /api/maps*` их не содержат. Удаление пользователя или карты
  удаляет метки каскадом.
- Лимиты: 300 меток на пользователя, 100 вершин у полигона/линии, 120 запросов записи за 10 минут на
  пользователя (`marksWrite` в `server/app.js`).
- Проверка после деплоя: зарегистрировать тестового пользователя, подтвердить почту (сессии после перехода
  по ссылке нет, вход вручную), поставить метку, перезагрузить страницу, убедиться, что из второго аккаунта
  метка не видна.
- Откат: вернуть предыдущий коммит и пушнуть. Таблица `user_marks` останется в БД и старому коду не мешает.

## Аккаунты пользователей и почта

Спек: `docs/superpowers/specs/2026-10-11-user-accounts-design.md`. Код: `server/routes/account.js`,
`server/mailer.js`, `server/tokens.js`; страницы `/account` и `/privacy`. Файлы из `server/deploy/`
деплоем **не выкладываются** — на VPS их нужно обновить руками (шаг 3).

**Что нужно подготовить один раз (владелец сайта):**

1. Почта: настроить отправку по разделу «Локальный Postfix и OpenDKIM (рекомендуемый путь)» ниже. Ящик
   `noreply@anoma-wiki.ru` в панели Beget существует, но для отправки больше не используется; DNS и MX
   домена остаются у Beget (серверы имён ns1/ns2.beget.com).
2. Перед первым деплоем с миграцией: проверить, что в боевой БД нет логинов, различающихся только регистром
   (запрос только читает):

       sudo sqlite3 /var/lib/anoma/db/anoma.db "SELECT lower(login), COUNT(*) FROM users GROUP BY lower(login) HAVING COUNT(*) > 1;"

   Вывод должен быть **пустым**. Если строки есть — уникальный индекс миграции v2 не создастся и сервис не
   запустится; сначала переименовать дубликаты. Затем снять бэкап БД: `sudo /usr/local/bin/anoma-backup.sh`.
3. Обновить на VPS юнит и nginx из `server/deploy/`: `anoma-api.service` -> `/etc/systemd/system/`,
   `nginx-limits.conf` -> `/etc/nginx/conf.d/anoma-limits.conf`, блоки из `nginx-map.conf` (`/account`,
   `/privacy`, regex-`location` для `register|forgot-password|resend-verification`) -> в HTTPS `server{}`
   перед `location /api/`. Затем:

       sudo systemctl daemon-reload && sudo nginx -t && sudo systemctl reload nginx && sudo systemctl restart anoma-api

   Регулярное `location ~ ^/api/(register|forgot-password|resend-verification)$` приоритетнее обычного
   префикса `location /api/`, а точный `location = /api/login` обрабатывается раньше обоих.
4. Выкладка кода: пуш в `master` (статика `account.html`, `account.js`, `account.css`, `account-nav.js`,
   `privacy.html` + `server/`). Миграция БД выполняется сама при старте сервиса.

**Проверка на проде:** зарегистрироваться тестовым аккаунтом, убедиться, что письмо пришло (во «Входящие»
или, у Gmail на первых порах, в «Спам» — см. ниже), перейти по ссылке, войти, выйти, пройти «Забыли пароль?».
В заголовках письма (Gmail: «Показать оригинал») должно быть `dkim=pass header.s=mail header.i=@anoma-wiki.ru`,
`spf=pass`, `dmarc=pass`.

### Локальный Postfix и OpenDKIM (рекомендуемый путь)

С 2026-10-11 письма аккаунтов отправляет **локальный Postfix только на отправку** на VPS, подпись DKIM
ставит **OpenDKIM**. Приложение работает в режиме relay (см. следующий раздел). Проверено на проде:
реальное письмо в Gmail показывает `dkim=pass header.s=mail header.i=@anoma-wiki.ru`, `spf=pass`, `dmarc=pass`.

**Почему не Beget.** У аккаунта Beget нет хостинга (виртуального сервера), поэтому Beget ограничивает
исходящий SMTP и не даёт DKIM; первые письма ушли в «Спам». Ящик `noreply@anoma-wiki.ru` в Beget остаётся, но
для отправки не используется.

**Установка (Ubuntu 24.04).** Пакеты: `postfix` (3.8.x), `opendkim`, `opendkim-tools`. Сначала
`sudo apt-get update` (устаревший индекс даёт 404). Службы при установке были заблокированы от запуска
(`policy-rc.d`), пока не настроены, и затем включены. Все службы (nginx, anoma-api, postfix, opendkim,
fail2ban, ufw) включены в автозапуск.

**Postfix** (`sudo postconf -n`):

    myhostname = anoma-wiki.ru
    mydomain = anoma-wiki.ru
    myorigin = anoma-wiki.ru
    inet_interfaces = loopback-only
    inet_protocols = ipv4
    mydestination =
    mynetworks = 127.0.0.0/8
    relayhost =
    smtp_tls_security_level = may
    maximal_queue_lifetime = 1d
    bounce_queue_lifetime = 1d
    smtpd_milters = inet:127.0.0.1:8891
    non_smtpd_milters = inet:127.0.0.1:8891
    milter_default_action = accept

Слушает только `127.0.0.1:25`, входящую почту не принимает (порт наружу не открыт: ufw пропускает только
22/80/443/8899). Postfix **намеренно только IPv4**: у VPS есть IPv6-адрес (`2a0c:5d00:3012::da8e:4b21`), но
без PTR; не включать отправку по IPv6, пока для него не задан PTR.

**OpenDKIM** (`/etc/opendkim.conf`): `Mode s`, `Canonicalization relaxed/simple`, `Domain anoma-wiki.ru`,
`Selector mail`, `KeyFile /etc/opendkim/keys/anoma-wiki.ru/mail.private` (RSA 2048),
`Socket inet:8891@127.0.0.1`. Публичная часть ключа для DNS лежит в
`/etc/opendkim/keys/anoma-wiki.ru/mail.txt`.

**DNS** (панель Beget, раздел «DNS», форма быстрого добавления; имена полные):

| Тип | Имя | Значение |
|---|---|---|
| TXT | `anoma-wiki.ru` (корень) | `v=spf1 ip4:104.128.130.39 ~all` — **ровно одна** SPF-запись |
| TXT | `mail._domainkey.anoma-wiki.ru` | `v=DKIM1; h=sha256; k=rsa; p=<публичный ключ из mail.txt>` |
| TXT | `_dmarc.anoma-wiki.ru` | `v=DMARC1; p=none; rua=mailto:<адрес владельца>` |

Если в корне раньше была SPF-запись Beget (`redirect=beget.com`), она должна быть заменена, иначе
SPF-записей станет две и проверка сломается.

**PTR:** `104.128.130.39 -> anoma-wiki.ru`, задаётся в панели Virtualizor (Settings -> Reverse DNS; API
`act=rdns`, поля `rdns_ip` / `rdns_domain`). Прямая A-запись `anoma-wiki.ru` указывает на тот же IP
(forward-confirmed).

**`/etc/anoma/api.env`** (`root:root`, `0600`): `MAIL_MODE=smtp`, `SMTP_HOST=127.0.0.1`, `SMTP_PORT=25`,
`SMTP_SECURE=0`, `MAIL_FROM=noreply@anoma-wiki.ru`, без `SMTP_USER` / `SMTP_PASS`. Прежняя конфигурация Beget
сохранена в `/etc/anoma/api.env.beget.bak`. После правки: `sudo systemctl restart anoma-api`.

**Полезные команды (на VPS):**

    sudo tail -n 50 /var/log/mail.log        # искать status=sent (250 ...) и DKIM-Signature field added
    mailq                                    # очередь
    sudo postqueue -f                        # протолкнуть очередь
    sudo journalctl -u opendkim -n 30
    sudo systemctl status postfix opendkim
    sudo postconf -n

**Разбор проблем:**
- *Письмо в «Спаме» у Gmail.* Подписи и записи в порядке (`dkim/spf/dmarc=pass`), но у нового IP и домена
  пока нет репутации: пометить письмо «Не спам» и подождать; Mail.ru и Яндекс могут вести себя иначе.
  Следить за репутацией (DMARC-отчёты на адрес из `rua`).
- *`status=deferred` в `mail.log`.* Причина — в той же строке: временный отказ получателя (Postfix повторит
  сам), отказ по репутации или PTR, недоступность сервера получателя. Очередь живёт 1 сутки
  (`maximal_queue_lifetime=1d`), потом отправитель получает bounce.
- *Исходящий порт 25 заблокирован* (`Connection timed out` на MX получателя): проверить
  `nc -vz gmail-smtp-in.l.google.com 25` с VPS; если порт закрыт хостером — писать в поддержку FirstByte
  или вернуться на SMTP Beget (откат ниже).
- *IPv6.* Если в логе видны попытки по IPv6, проверить `inet_protocols = ipv4`; без PTR для IPv6 получатели
  отклоняют такие письма.
- *Нет строки `DKIM-Signature field added`.* `sudo systemctl status opendkim`, порт 8891 слушает,
  `smtpd_milters` / `non_smtpd_milters` указывают на него (`milter_default_action=accept` пропустит письмо
  без подписи, поэтому проверять заголовки).

**Откат на SMTP Beget:**

    sudo cp -a /etc/anoma/api.env.beget.bak /etc/anoma/api.env && sudo systemctl restart anoma-api

Старый файл использует `SMTP_HOST=smtp.beget.com`, порт 465, логин и пароль (клиент сам выбирает `AUTH PLAIN`
или `AUTH LOGIN`); учтите, что Beget ограничивает исходящий SMTP без хостинга. Полностью выключить почту:
убрать `MAIL_MODE` из `api.env` и перезапустить сервис (регистрация ответит 503).

**Ротация ключа DKIM.** Сгенерировать новый ключ:
`opendkim-genkey -b 2048 -d anoma-wiki.ru -D /etc/opendkim/keys/anoma-wiki.ru -s <новый_селектор>`,
опубликовать TXT `<новый_селектор>._domainkey`, поменять `Selector` и `KeyFile` в `/etc/opendkim.conf`,
перезапустить opendkim, старую запись удалить через неделю.

**Резервные копии прежних конфигов:** `/etc/nginx/sites-available/anoma.bak5`,
`anoma-limits.conf.bak5`, `anoma-api.service.bak5`. Конфигов Postfix и OpenDKIM раньше не было (чистая
установка); копии `*.pre-anoma` появляются только если конфиг уже существовал.

### Локальный Postfix (режим relay)

Если на том же сервере работает свой Postfix, API может отдавать ему почту по `127.0.0.1:25` без TLS и
без авторизации. `/etc/anoma/api.env`:

    MAIL_MODE=smtp
    SMTP_HOST=127.0.0.1
    SMTP_PORT=25
    SMTP_SECURE=0
    MAIL_FROM=noreply@anoma-wiki.ru

`SMTP_USER` и `SMTP_PASS` не задаются (шаг AUTH пропускается). Нужны только `SMTP_HOST` и `MAIL_FROM`;
`SMTP_PORT` по умолчанию 25 при `SMTP_SECURE=0` и 465 иначе. Если `SMTP_USER` задан, авторизация
выполняется как обычно, и тогда `SMTP_PASS` обязателен (без него сервис стартует с отключённой почтой);
`SMTP_PASS` без `SMTP_USER` игнорируется с предупреждением в журнале. Отключает TLS только значение
`SMTP_SECURE` ровно `0`; любое другое значение (`false`, `no`, пусто) оставляет TLS.

Правила безопасности (проверяются при старте; при нарушении почта отключается, причина в журнале):

1. `SMTP_SECURE=0` (SMTP без шифрования) допустим **только** для loopback-хоста: `127.0.0.1`, `::1`
   или `localhost`. Иначе одноразовые ссылки входа уходили бы по сети открытым текстом.
2. Пустой `SMTP_USER` (без AUTH) допустим **только** вместе с loopback-хостом, чтобы не получить
   неавторизованный релей на внешний сервер.

Установка и настройка Postfix и OpenDKIM описана в разделе выше.

### Запасной вариант: SMTP Beget

Работает без своего Postfix, но у аккаунта без хостинга Beget ограничивает исходящий SMTP и не даёт DKIM,
поэтому письма могут уходить в «Спам». Используется как откат (см. выше `api.env.beget.bak`).

1. DNS домена и MX (mx1/mx2.beget.com) остаются у Beget. Ящик `noreply@anoma-wiki.ru` создаётся в панели
   Beget (раздел «Почта»); проверить, что для домена включена DKIM-подпись (на аккаунте без хостинга
   может быть недоступна), после первой отправки проверить в заголовках `spf=pass` и `dkim=pass`.
   Напрямую с VPS без своего Postfix, PTR и DKIM отправлять нельзя. Исходящие порты 465 к `smtp.beget.com`
   и 25 с VPS были открыты (проверено 2026-10-11).
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
   владелец `root:root`, и заменяет его атомарно; при пустом пароле команда завершается с сообщением и ничего не создаёт. Кавычки и обратные слэши в пароле экранируются под
   разбор `EnvironmentFile` в systemd. Команда — **одна строка**, копировать целиком; значения из
   `/etc/anoma/api.env` перекрывают строки `Environment=` юнита независимо от порядка строк в юните:

       sudo bash -c 'set -eu; umask 077; f=/etc/anoma/api.env; IFS= read -rsp "SMTP password: " P; echo; if [ -z "$P" ]; then echo "Пустой пароль, ничего не записано" >&2; exit 1; fi; mkdir -p /etc/anoma; bs=$(printf "\\\\"); q="\""; P=${P//"$bs"/"$bs$bs"}; P=${P//"$q"/"$bs$q"}; rm -f "$f.new"; printf "MAIL_MODE=smtp\nSMTP_HOST=smtp.beget.com\nSMTP_PORT=465\nSMTP_USER=noreply@anoma-wiki.ru\nMAIL_FROM=noreply@anoma-wiki.ru\n" > "$f.new"; printf "SMTP_PASS=\"%s\"\n" "$P" >> "$f.new"; chown root:root "$f.new"; chmod 600 "$f.new"; mv "$f.new" "$f"'

   Проверить без показа пароля: `sudo ls -l /etc/anoma/api.env` (ожидается `-rw------- root root`)
   и `sudo cut -d= -f1 /etc/anoma/api.env` (только имена переменных).


### Общее: отключённая почта, пароль админа, диагностика

**Пока почта не настроена:** `MAIL_MODE` не задан, регистрация, повторная отправка и сброс пароля отвечают 503,
вход админа и карта работают как раньше. Если `MAIL_MODE=smtp` задан без нужных переменных или значение
`MAIL_MODE` неизвестно, сервис всё равно стартует с отключённой почтой (503) и пишет причину в журнал
(`anoma-api: mail disabled — …` / `unknown MAIL_MODE`).

**Смена пароля админа** (закрывает все сессии этого пользователя, аннулирует его неиспользованные ссылки
подтверждения и сброса, помечает почту подтверждённой; пароль не попадает в историю команд):

    IFS= read -rs ANOMA_PASSWORD && export ANOMA_PASSWORD
    sudo -u anoma --preserve-env=ANOMA_PASSWORD env ANOMA_DB=/var/lib/anoma/db/anoma.db       ANOMA_UPLOADS=/var/lib/anoma/uploads node /opt/anoma-api/cli.js set-password admin
    unset ANOMA_PASSWORD

**Локально:** `MAIL_MODE=log PUBLIC_URL=http://localhost:3000` — письма печатаются в консоль сервера.

**Если письма не уходят:** `journalctl -u anoma-api -n 50` (токены и тела писем в лог не пишутся). Клиент сам
выбирает `AUTH PLAIN` или `AUTH LOGIN` по ответу на EHLO (и переходит на `AUTH LOGIN` после 504). Ошибка отправки не ломает регистрацию — пользователь может нажать «Выслать ещё раз».

**Известные ограничения (приняты):**
- Блокировка входа: лимитер по аккаунту считает **все** попытки входа (10 за 10 минут на идентификатор —
  логин или почту), включая успешные; после десятой вход в этот аккаунт закрыт до конца окна, в том числе с
  чужого IP. Так задумано спеком.
- Остаточная двухшаговая проверка существования почты: зарегистрировать свежий логин с почтой X, затем тот же
  логин с другой почтой — `409 login_taken` ответит, только если X была свободна или принадлежала
  неподтверждённому аккаунту. Ограничена лимитами
  регистрации; полноценное исправление требует отложенного создания аккаунта.
- Захват чужой почты при регистрации: можно зарегистрировать аккаунт с чужим адресом; владелец адреса получает
  ссылку подтверждения аккаунта, который он не создавал. С этапа C подтверждение **не открывает сессию**
  (страница `/account` просит войти по логину и паролю), поэтому жертва не окажется внутри чужого аккаунта.
  Дополнительно, если адрес занят старым **неподтверждённым** аккаунтом с другим логином, такая запись
  удаляется, и создаётся новый аккаунт с паролем того, кто регистрируется сейчас.
- Доставляемость: письма подписаны (`dkim/spf/dmarc=pass`, есть PTR), но Gmail пока складывает первые
  письма в «Спам», пока у нового IP и домена нет репутации (пометить «Не спам», ждать; Mail.ru и Яндекс
  могут отличаться). SMTP Beget без хостинга ограничен самим Beget и DKIM не даёт — только запасной
  вариант. Адреса с не-ASCII символами SMTP-клиент не поддерживает (нет SMTPUTF8) —
  такие адреса, скорее всего, будут отклонены на `RCPT`.
- Правило ufw для `8899/tcp` не объяснено — владельцу проверить, нужно ли оно.
- `MAIL_MODE=log` печатает одноразовые ссылки в журнал — **никогда** не использовать на проде.
- Страница `/privacy` — заготовка для владельца и юриста, не готовый юридический текст.
- Браузерные сценарии (вёрстка на 375 px, стирание фрагмента с токеном, возврат по `?next=`) автоматикой
  кликами не проверялись — до анонса нужно один раз пройти их руками на телефоне и ПК.

**Откат.** Убрать `MAIL_MODE` из `/etc/anoma/api.env` и перезапустить сервис — регистрация отключится.
Миграция БД обратима только из бэкапа; новые колонки старый код игнорирует.