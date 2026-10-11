# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ANOMA WIKI — a fan site for the game ANOMA (MMORPG, STALKER-like setting), plus an
artillery calculator tool for the game's mortar/gun mechanics. It is a **plain static
site**: no framework, no bundler, no `package.json`. Every page is a single self-contained
HTML file with inline or linked CSS/JS, served as-is by nginx.

There is no build step and no linter for the static site; tests exist for the `server/` API and
`tools/` scripts: `node --test server/test/*.test.js tools/*.test.js`. Don't invent other commands
for them.

## Статус проекта (обновлено 2026-10-11)

Этот раздел поддерживается вручную: после каждой заметной работы обновляй «Сделано» / «Не сделано».

### Сделано
- Лендинг `/` (`index.html`): hero, календарь плейтестов (массив `PLAYTESTS`), ссылка на калькулятор.
- Калькулятор артиллерии `/art-calc` (`art-calc.html`), карта-подложка `map.js`.
- Деплой на VPS по пушу в `master` (rsync + SSH), HTTPS, Яндекс.Метрика (счётчик 112397124).
- **Интерактивная карта `/map` с редактором** (разработана в ветке `map-editor-spec`):
  - несколько карт, категории (название/цвет/иконка/тип), объекты: точки, полигоны, линии;
  - у объекта свой цвет, описание и до 10 фото; клик открывает карточку; поиск, фильтры, ссылки на объект;
  - редактор только для админа и только на ПК (рисование, правка вершин, менеджеры категорий и карт);
  - API `server/` (Node, SQLite, вход по паролю, сессии, лимиты), 88 автотестов;
  - уже развёрнуто на VPS: сервис `anoma-api`, nginx, бэкап БД и загрузок, первая карта `main`, админ `admin`.
- Подробности и обоснования: `docs/superpowers/specs/2026-10-11-interactive-map-editor-design.md` (спек),
  `docs/superpowers/plans/2026-10-11-interactive-map-editor.md` (план), эксплуатация — `RELEASE.md`.

### Не сделано / ждёт решения
- Ветка `map-editor-spec` **ещё не влита в `master`** (на проде API и статика карты уже работают; после merge
  деплой синхронизирует всё остальное). Решить: merge локально или PR.
- Пароль админа лежит в `C:\Users\Николай\anoma-admin-password.txt` — перенести в менеджер паролей и удалить файл.
  Команды смены пароля нет (создать нового админа: `cli.js create-admin`).
- На `index.html` нет ссылки на `/map` (страница доступна только по прямому адресу).
- Аккаунты обычных пользователей (регистрация, подтверждение почты, сброс пароля, предложения точек с модерацией).
  Задел есть: `server/permissions.js` `can()`, поля `author_id` и `status` у объектов.
- Не вошло в v1: отмена/повтор (Ctrl+Z), история изменений, импорт/экспорт, свои иконки, видео, массовое выделение.
- Баннер cookie (152-ФЗ) не сделан.

### Известные недочёты (минорные, из финального ревью)
- Параллельная загрузка во время удаления объекта может оставить файл-сироту или дать 500.
- После удаления последней открытой карты редактор остаётся в «залипшем» состоянии.
- После правки категории выбранный объект теряет подсветку и правку вершин.
- Рисование на карте без картинки бросает исключение.
- `loadMap` из списка/диалога без `.catch`; битая ссылка `?m=nope&f=999` падает на первую карту молча.
- На телефоне карточка закрывается только крестиком, не тапом по карте.
- Лимитер логина очищается целиком при >10 000 ключей.

### Как продолжить работу
- Тесты: `node --test server/test/*.test.js tools/*.test.js`.
- Локальный запуск карты (с API): см. `RELEASE.md` → «Локальная разработка», затем `http://localhost:3000/map`.
- Новые крупные фичи: сначала спек и план в `docs/superpowers/` (как сделано для карты).

## Files

- `map.html` — interactive map page (served at `/map`). Viewer for everyone; after an admin logs in
  on desktop it lazy-loads the editor. Scripts: `map-common.js` (API client + DOM helper),
  `map-geo.js` (pure geometry helpers, tested in `tools/map-geo.test.js`), `map-icons.js`,
  `map-app.js` (viewer), `map-editor.js` + `map-editor-dialogs.js` (editor), styles in `map-app.css`.
  Leaflet and Leaflet-Geoman are vendored in `vendor/` (no CDN). Geoman must load before `L.map()`.
- `server/` — Node 22+ API (`node:http` + `node:sqlite`, no npm deps) for maps, categories, features,
  photos and admin login. Deployed separately to `/opt/anoma-api`; **never published** by the static
  rsync. Data lives in `/var/lib/anoma/` on the VPS. See `RELEASE.md` ("Карта-редактор").
  All write permissions go through `server/permissions.js` `can()`; coordinates are stored as 0..1
  fractions of the map image.
- `index.html` — landing page (hero, playtest calendar). Links to `styles.css`. The
  playtest calendar is hardcoded as a `PLAYTESTS` array inline in a `<script>` at the
  bottom of the file — add new playtests by editing that array directly, no CMS/data file.
- `art-calc.html` — the calculator itself. Fully self-contained (its own
  `<style>` and `<script>`, no external deps). Served at the friendly URL `/art-calc` in
  production (nginx `location = /art-calc` maps it to `art-calc.html`).
- `styles.css` — styles for `index.html` only (the calculator has its own inline styles).
- `logo.png` — site logo.
- `map.js` / `map.enc` — the game map image used by the calculator. See "Map release-gate"
  below; do not edit `map.js` by hand once it's decrypted in the repo.
- `tools/encrypt-map.js`, `tools/decrypt-map.js` — Node scripts (built-in `crypto`/`fs`
  only, no deps) that convert between `map.js` and `map.enc`.
- `.github/workflows/deploy.yml` — deploys to the production VPS on every push to `master`.
- `.github/workflows/release-map.yml` — one-time scheduled/manual job that publishes the map.
- `RELEASE.md` — operational notes (in Russian) on the map release-gate mechanism above.

## Map release-gate mechanism

The map (`map.js`, ~2.7 MB, a base64 data-URI image assigned to `window.__ARTY_MAP__`) was
originally kept encrypted in the repo as `map.enc` (AES-256-GCM, format
`base64(iv(12) || authTag(16) || ciphertext)`) so it couldn't be pulled from dev tools
before a scheduled release. The 64-hex-char decryption key is `MAP_KEY`.

- `tools/decrypt-map.js`: `MAP_KEY=<64 hex chars> node tools/decrypt-map.js` → writes `map.js`.
- `tools/encrypt-map.js`: `MAP_KEY=<64 hex chars> node tools/encrypt-map.js` → writes `map.enc`
  (regenerate this if the map image changes).
- `art-calc.html` has an inline countdown/gate script (top of file, around the
  `release-gate` element) that only requests `map.js` once a hardcoded `UNLOCK` timestamp
  is reached, plus an "early access key" form that decrypts `map.enc` client-side via
  WebCrypto (`crypto.subtle`, requires HTTPS — does not work over `file://`) when given the
  same `MAP_KEY`.
- The release date has already passed and `map.js` is committed to the repo in plaintext,
  so in practice this gate is now inert (it unlocks immediately). Keep the mechanism intact
  rather than ripping it out unless asked — it's reused for any future timed content drops.

## Deployment

Production is a self-hosted VPS (nginx), **not** GitHub Pages, serving `anoma-wiki.ru` (and
alias domains) from `/var/www/anoma`. `.github/workflows/deploy.yml` rsyncs the repo to that
path over SSH on every push to `master` (`workflow_dispatch` also available for manual runs).

Requires repository secrets: `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`. The workflow excludes
`.git`, `.github`, `.gitignore`, `.gitattributes`, `tools`, and `RELEASE.md` from the sync —
only the actual site files (`*.html`, `styles.css`, `logo.png`, `map.js`, `map.enc`) go live.

The same workflow also rsyncs `server/` to `/opt/anoma-api/` and restarts the `anoma-api` systemd
service. nginx proxies `/api/` to it and serves `/uploads/` from `/var/lib/anoma/uploads/`.

To deploy manually, push to `master` (there is no staging environment).

## Local preview

Since pages are static and the calculator's early-access WebCrypto path needs HTTPS, the
simplest local check is `python3 -m http.server` from the repo root and opening
`http://localhost:8000/` — good enough for layout/JS checks, but the WebCrypto early-access
key path in `art-calc.html` won't work outside HTTPS/production.
