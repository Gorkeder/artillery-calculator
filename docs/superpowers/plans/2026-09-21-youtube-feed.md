# Youtuber Video Feed Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a slide-out video panel to `index.html` that shows the 2 newest and up to 8 most-viewed-in-the-last-month videos from a fixed set of YouTube channels, fed by a static `videos.json` produced hourly by a Node script running on the VPS.

**Architecture:** A dependency-free Node CLI (`tools/youtube-feed-fetcher.js`, built on a pure-logic module `tools/youtube-feed-lib.js`) polls the YouTube Data API v3 and writes `/var/www/anoma/videos.json` atomically via cron. `index.html` gains a fixed-position drawer (collapsed to a vertical tab on desktop, a nav button on mobile) whose inline script does one same-origin `fetch('/videos.json')` and renders cards, degrading silently (hides its own triggers) if the fetch fails.

**Tech Stack:** Plain Node.js (CommonJS, built-in `fetch`, `fs`, `node:test`/`node:assert` for tests — no npm dependencies, matching the rest of `tools/`); vanilla HTML/CSS/JS matching the existing `index.html` inline-script style.

**Spec:** `docs/superpowers/specs/2026-09-21-youtube-feed-design.md`

## Global Constraints

- Repo has no `package.json`, no bundler, no build step — every file here must run as-is with plain `node <file>.js` (see `CLAUDE.md`).
- No test suite exists in the repo yet; use Node's built-in `node:test` (Node 18+) for the new pure-logic modules — no test framework dependency is added.
- The frontend must never call the YouTube API directly (CORS + API-key exposure) — only same-origin `fetch('/videos.json')`.
- Channel list and `YOUTUBE_API_KEY` live in VPS environment/config, never committed to the repo.
- No embedded YouTube player — every video card is a plain link that opens `https://www.youtube.com/watch?v=<id>` in a new tab.
- No pagination/infinite scroll — exactly 2 "newest" videos and up to 8 "popular" (by views, published within the last 30 days).
- The panel is added to `index.html` only, not `art-calc.html`.
- `tools/` is excluded from `.github/workflows/deploy.yml`'s rsync (per `CLAUDE.md`), so the fetcher script reaches the VPS by a manual copy, not the normal deploy pipeline.

---

## File Structure

- Create: `tools/youtube-feed-lib.js` — pure functions: pick newest/popular videos, parse the channel-list config string. No I/O, fully unit-testable.
- Create: `tools/youtube-feed-lib.test.js` — `node:test` tests for the above.
- Create: `tools/youtube-feed-fetcher.js` — CLI: calls the YouTube Data API (via injectable `fetchImpl` for testability), assembles the feed using `youtube-feed-lib.js`, writes `videos.json` atomically, never overwrites on error.
- Create: `tools/youtube-feed-fetcher.test.js` — `node:test` tests for the orchestration logic, using a fake `fetchImpl` (no real network calls).
- Create: `tools/fixtures/videos.sample.json` — a hand-written sample feed used only for local manual frontend testing (not deployed, not read by any script).
- Modify: `.gitignore` — ignore a locally-copied `videos.json` at the repo root (used only for local preview, never committed).
- Modify: `RELEASE.md` — add an ops section documenting env vars, manual first run, and the cron line for the VPS.
- Modify: `styles.css` — add the drawer/tab/overlay/card styles (append at end of file, following existing token-based style).
- Modify: `index.html` — add the drawer markup, the desktop tab, the mobile nav button, and the fetch/render logic (appended into the existing inline `<script>` IIFE, reusing its `esc()` helper).

---

### Task 1: Pure feed-selection logic (`youtube-feed-lib.js`)

**Files:**
- Create: `tools/youtube-feed-lib.js`
- Create: `tools/youtube-feed-lib.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `pickNewest(videos: Array<{publishedAt: string}>, n: number): Array` — sorted by `publishedAt` descending, sliced to `n`.
- Produces: `pickPopular(videos: Array<{publishedAt: string, views: number}>, opts: {sinceMs: number, limit: number}, nowMs: number): Array` — filters to videos published within `sinceMs` of `nowMs`, sorted by `views` descending, sliced to `opts.limit`.
- Produces: `parseChannelsConfig(raw: string): Array<{id: string, name: string}>` — parses a comma-separated `id:Name` list; throws `Error` on a malformed entry; returns `[]` for empty/undefined input.

- [ ] **Step 1: Write the failing tests**

Create `tools/youtube-feed-lib.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pickNewest, pickPopular, parseChannelsConfig } = require('./youtube-feed-lib');

test('pickNewest returns N most recently published videos, newest first', () => {
  const videos = [
    { id: 'a', publishedAt: '2026-09-01T00:00:00Z' },
    { id: 'b', publishedAt: '2026-09-10T00:00:00Z' },
    { id: 'c', publishedAt: '2026-09-05T00:00:00Z' },
  ];
  const result = pickNewest(videos, 2);
  assert.deepEqual(result.map((v) => v.id), ['b', 'c']);
});

test('pickPopular sorts by views desc and excludes videos older than sinceMs', () => {
  const now = new Date('2026-09-21T00:00:00Z').getTime();
  const videos = [
    { id: 'old-hit', publishedAt: '2026-06-01T00:00:00Z', views: 1000000 },
    { id: 'new-a', publishedAt: '2026-09-15T00:00:00Z', views: 500 },
    { id: 'new-b', publishedAt: '2026-09-18T00:00:00Z', views: 5000 },
  ];
  const result = pickPopular(videos, { sinceMs: 30 * 24 * 60 * 60 * 1000, limit: 8 }, now);
  assert.deepEqual(result.map((v) => v.id), ['new-b', 'new-a']);
});

test('pickPopular respects the limit', () => {
  const now = new Date('2026-09-21T00:00:00Z').getTime();
  const videos = Array.from({ length: 10 }, (_, i) => ({
    id: 'v' + i,
    publishedAt: '2026-09-20T00:00:00Z',
    views: i,
  }));
  const result = pickPopular(videos, { sinceMs: 30 * 24 * 60 * 60 * 1000, limit: 3 }, now);
  assert.deepEqual(result.map((v) => v.id), ['v9', 'v8', 'v7']);
});

test('parseChannelsConfig parses "id:Name" pairs separated by commas', () => {
  const result = parseChannelsConfig('UCabc:Канал Раз, UCxyz:Канал Два');
  assert.deepEqual(result, [
    { id: 'UCabc', name: 'Канал Раз' },
    { id: 'UCxyz', name: 'Канал Два' },
  ]);
});

test('parseChannelsConfig throws on a malformed entry', () => {
  assert.throws(() => parseChannelsConfig('no-colon-here'), /Некорректная запись/);
});

test('parseChannelsConfig returns an empty array for empty/undefined input', () => {
  assert.deepEqual(parseChannelsConfig(''), []);
  assert.deepEqual(parseChannelsConfig(undefined), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/youtube-feed-lib.test.js`
Expected: FAIL — `Cannot find module './youtube-feed-lib'`.

- [ ] **Step 3: Write the implementation**

Create `tools/youtube-feed-lib.js`:

```js
'use strict';

function pickNewest(videos, n) {
  return videos
    .slice()
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, n);
}

function pickPopular(videos, { sinceMs, limit }, nowMs) {
  const cutoff = nowMs - sinceMs;
  return videos
    .filter((v) => new Date(v.publishedAt).getTime() >= cutoff)
    .slice()
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

function parseChannelsConfig(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(':');
      if (idx === -1) {
        throw new Error('Некорректная запись канала (нужен формат id:Имя): ' + entry);
      }
      return { id: entry.slice(0, idx).trim(), name: entry.slice(idx + 1).trim() };
    });
}

module.exports = { pickNewest, pickPopular, parseChannelsConfig };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/youtube-feed-lib.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Ignore the local preview copy of videos.json**

Modify `.gitignore`, append:

```
# Локальная копия для ручного превью ленты видео — генерируется на VPS, не коммитим.
videos.json
```

- [ ] **Step 6: Commit**

```bash
git add tools/youtube-feed-lib.js tools/youtube-feed-lib.test.js .gitignore
git commit -m "Add pure video-feed selection logic with tests"
```

---

### Task 2: YouTube API fetcher CLI (`youtube-feed-fetcher.js`)

**Files:**
- Create: `tools/youtube-feed-fetcher.js`
- Create: `tools/youtube-feed-fetcher.test.js`

**Interfaces:**
- Consumes: `pickNewest`, `pickPopular`, `parseChannelsConfig` from `tools/youtube-feed-lib.js` (Task 1).
- Produces: `fetchFeed(channels: Array<{id, name}>, opts: {fetchImpl?: Function, apiKey: string, now?: () => Date}): Promise<{generatedAt: string, newest: Array, popular: Array}>`.
- Produces: `writeAtomic(outputPath: string, data: object): void`.
- Produces a CLI entry point (`main()`, run automatically when the file is executed directly) reading `YOUTUBE_API_KEY`, `YOUTUBE_CHANNELS`, and optional `OUTPUT_PATH` from `process.env`.

- [ ] **Step 1: Write the failing tests**

Create `tools/youtube-feed-fetcher.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchFeed } = require('./youtube-feed-fetcher');

function fakeFetch(responses) {
  return async (url) => {
    for (const [matcher, body] of responses) {
      if (url.includes(matcher)) {
        return { ok: true, status: 200, json: async () => body };
      }
    }
    throw new Error('Нет заглушки для URL: ' + url);
  };
}

test('fetchFeed assembles newest and popular videos from one channel', async () => {
  const channel = { id: 'UCabc', name: 'Тестовый канал' };
  const fetchImpl = fakeFetch([
    ['/channels?', { items: [{ contentDetails: { relatedPlaylists: { uploads: 'PLxyz' } } }] }],
    ['/playlistItems?', {
      items: [
        { snippet: { resourceId: { videoId: 'vid1' } } },
        { snippet: { resourceId: { videoId: 'vid2' } } },
      ],
    }],
    ['/videos?', {
      items: [
        {
          id: 'vid1',
          snippet: {
            title: 'Видео 1',
            publishedAt: '2026-09-20T00:00:00Z',
            thumbnails: { medium: { url: 'https://x/1.jpg' } },
          },
          statistics: { viewCount: '100' },
        },
        {
          id: 'vid2',
          snippet: {
            title: 'Видео 2',
            publishedAt: '2026-09-10T00:00:00Z',
            thumbnails: { medium: { url: 'https://x/2.jpg' } },
          },
          statistics: { viewCount: '9000' },
        },
      ],
    }],
  ]);

  const feed = await fetchFeed([channel], {
    fetchImpl,
    apiKey: 'test-key',
    now: () => new Date('2026-09-21T00:00:00Z'),
  });

  assert.equal(feed.newest.length, 2);
  assert.equal(feed.newest[0].id, 'vid1');
  assert.equal(feed.popular[0].id, 'vid2');
  assert.equal(feed.popular[0].views, 9000);
  assert.equal(feed.popular[0].channel, 'Тестовый канал');
});

test('fetchFeed rejects when a channel has no uploads playlist', async () => {
  const channel = { id: 'UCbad', name: 'Битый канал' };
  const fetchImpl = fakeFetch([
    ['/channels?', { items: [] }],
  ]);
  await assert.rejects(
    () => fetchFeed([channel], { fetchImpl, apiKey: 'test-key' }),
    /Не найден uploads-плейлист/
  );
});

test('fetchFeed rejects when the API returns a non-OK status', async () => {
  const channel = { id: 'UCabc', name: 'Тестовый канал' };
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(
    () => fetchFeed([channel], { fetchImpl, apiKey: 'test-key' }),
    /YouTube API вернул 403/
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/youtube-feed-fetcher.test.js`
Expected: FAIL — `Cannot find module './youtube-feed-fetcher'`.

- [ ] **Step 3: Write the implementation**

Create `tools/youtube-feed-fetcher.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { pickNewest, pickPopular, parseChannelsConfig } = require('./youtube-feed-lib');

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const POPULAR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const POPULAR_LIMIT = 8;
const NEWEST_LIMIT = 2;
const ITEMS_PER_CHANNEL = 20;

async function fetchJson(fetchImpl, url) {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error('YouTube API вернул ' + res.status + ' для ' + url);
  }
  return res.json();
}

async function fetchChannelVideos(fetchImpl, apiKey, channel) {
  const channelsUrl = API_BASE + '/channels?part=contentDetails&id=' + channel.id + '&key=' + apiKey;
  const channelsData = await fetchJson(fetchImpl, channelsUrl);
  const uploadsPlaylistId = channelsData.items &&
    channelsData.items[0] &&
    channelsData.items[0].contentDetails.relatedPlaylists.uploads;
  if (!uploadsPlaylistId) {
    throw new Error('Не найден uploads-плейлист для канала ' + channel.id);
  }

  const playlistUrl = API_BASE + '/playlistItems?part=snippet&maxResults=' + ITEMS_PER_CHANNEL +
    '&playlistId=' + uploadsPlaylistId + '&key=' + apiKey;
  const playlistData = await fetchJson(fetchImpl, playlistUrl);
  const videoIds = (playlistData.items || [])
    .map((item) => item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId)
    .filter(Boolean);
  if (videoIds.length === 0) return [];

  const videosUrl = API_BASE + '/videos?part=snippet,statistics&id=' + videoIds.join(',') + '&key=' + apiKey;
  const videosData = await fetchJson(fetchImpl, videosUrl);
  return (videosData.items || []).map((item) => ({
    id: item.id,
    title: item.snippet.title,
    channel: channel.name,
    thumbnail: item.snippet.thumbnails && item.snippet.thumbnails.medium && item.snippet.thumbnails.medium.url,
    publishedAt: item.snippet.publishedAt,
    views: Number((item.statistics && item.statistics.viewCount) || 0),
  }));
}

async function fetchFeed(channels, { fetchImpl = fetch, apiKey, now = () => new Date() } = {}) {
  const allVideos = [];
  for (const channel of channels) {
    const videos = await fetchChannelVideos(fetchImpl, apiKey, channel);
    allVideos.push(...videos);
  }
  const nowMs = now().getTime();
  return {
    generatedAt: new Date(nowMs).toISOString(),
    newest: pickNewest(allVideos, NEWEST_LIMIT),
    popular: pickPopular(allVideos, { sinceMs: POPULAR_WINDOW_MS, limit: POPULAR_LIMIT }, nowMs),
  };
}

function writeAtomic(outputPath, data) {
  const tmpPath = outputPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, outputPath);
}

async function main() {
  const apiKey = (process.env.YOUTUBE_API_KEY || '').trim();
  if (!apiKey) {
    console.error('YOUTUBE_API_KEY не задан');
    process.exit(1);
    return;
  }

  let channels;
  try {
    channels = parseChannelsConfig(process.env.YOUTUBE_CHANNELS);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
    return;
  }
  if (channels.length === 0) {
    console.error('YOUTUBE_CHANNELS пуст — нечего обновлять');
    process.exit(1);
    return;
  }

  const outputPath = process.env.OUTPUT_PATH || path.join(process.cwd(), 'videos.json');

  try {
    const feed = await fetchFeed(channels, { apiKey });
    writeAtomic(outputPath, feed);
    console.error('videos.json обновлён:', feed.newest.length, 'новых,', feed.popular.length, 'популярных');
  } catch (err) {
    console.error('Ошибка обновления videos.json, файл не тронут:', err.message);
    process.exit(1);
  }
}

module.exports = { fetchFeed, fetchChannelVideos, writeAtomic };

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/youtube-feed-fetcher.test.js`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add tools/youtube-feed-fetcher.js tools/youtube-feed-fetcher.test.js
git commit -m "Add YouTube feed fetcher CLI with mocked-fetch tests"
```

---

### Task 3: Ops docs for the VPS cron job

**Files:**
- Modify: `RELEASE.md`

**Interfaces:**
- Consumes: `tools/youtube-feed-fetcher.js`'s env vars (`YOUTUBE_API_KEY`, `YOUTUBE_CHANNELS`, `OUTPUT_PATH`) from Task 2 — documents them, does not change them.

- [ ] **Step 1: Append an ops section to RELEASE.md**

Modify `RELEASE.md`, add at the end of the file:

```markdown

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
   OUTPUT_PATH=/var/www/anoma/videos.json
   ```

3. Проверить вручную:
   ```
   set -a; source /opt/anoma-tools/.env; set +a
   node /opt/anoma-tools/youtube-feed-fetcher.js
   cat /var/www/anoma/videos.json
   ```

4. Добавить в crontab пользователя, от которого можно писать в
   `/var/www/anoma` (запуск раз в час):
   ```
   0 * * * * . /opt/anoma-tools/.env && /usr/bin/node /opt/anoma-tools/youtube-feed-fetcher.js >> /var/log/anoma-video-feed.log 2>&1
   ```

Обновить список каналов — отредактировать `YOUTUBE_CHANNELS` в
`/opt/anoma-tools/.env` на сервере и один раз прогнать скрипт вручную
(шаг 3), в репозиторий список каналов не попадает.
```

- [ ] **Step 2: Commit**

```bash
git add RELEASE.md
git commit -m "Document VPS cron setup for the video feed fetcher"
```

---

### Task 4: Drawer markup and styles (static shell)

**Files:**
- Modify: `index.html:22-33` (insert drawer markup after `</header>`; add the mobile nav button inside `.site-nav`)
- Modify: `styles.css` (append new rules at the end of the file)

**Interfaces:**
- Produces DOM ids consumed by Task 5: `video-feed-tab`, `video-feed-nav-btn`, `video-feed-panel`, `video-feed-close`, `video-feed-overlay`, `video-feed-newest`, `video-feed-popular`.
- Produces CSS classes consumed by Task 5: `.video-feed-panel.is-open` (open state), `.vf-card` (a rendered video card's root element).

- [ ] **Step 1: Add the mobile nav button and drawer markup to `index.html`**

Modify `index.html`, inside `<nav class="site-nav">` (around line 28-32), add the button right before the closing `</nav>`:

```html
  <nav class="site-nav">
    <a href="#home">Главная</a>
    <a href="#playtests">Календарь плейтестов</a>
    <a class="cta" href="/art-calc">Калькулятор &rarr;</a>
    <button type="button" class="video-feed-nav-btn" id="video-feed-nav-btn"
      aria-expanded="false" aria-controls="video-feed-panel" aria-label="Видео ютуберов">
      <span aria-hidden="true">&#9654;</span>
    </button>
  </nav>
```

Right after the closing `</header>` (line 33) and before `<main>` (line 35), insert:

```html

<button type="button" class="video-feed-tab" id="video-feed-tab"
  aria-expanded="false" aria-controls="video-feed-panel">
  <span class="vft-icon" aria-hidden="true">&#9654;</span>
  <span class="vft-label">Видео</span>
</button>

<aside class="video-feed-panel" id="video-feed-panel">
  <div class="vfp-head">
    <span class="vfp-title">Видео ютуберов</span>
    <button type="button" class="vfp-close" id="video-feed-close" aria-label="Закрыть">&#10005;</button>
  </div>
  <div class="vfp-body">
    <section class="vfp-section">
      <h3 class="vfp-h">Новинки</h3>
      <ul class="vfp-list" id="video-feed-newest"></ul>
    </section>
    <section class="vfp-section">
      <h3 class="vfp-h">Популярное</h3>
      <ul class="vfp-list" id="video-feed-popular"></ul>
    </section>
  </div>
</aside>
<div class="video-feed-overlay" id="video-feed-overlay" hidden></div>
```

- [ ] **Step 2: Add the drawer styles to `styles.css`**

Modify `styles.css`, append at the end of the file (after the existing `@media (max-width: 560px) { ... }` block):

```css

.video-feed-tab {
  position: fixed;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 8px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: none;
  border-radius: 0 10px 10px 0;
  color: var(--accent);
  cursor: pointer;
}

.video-feed-tab:hover { background: var(--panel-2); }

.video-feed-tab .vft-label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.video-feed-tab .vft-icon { font-size: 16px; }

.video-feed-panel {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(360px, 88vw);
  background: var(--panel);
  border-right: 1px solid var(--border);
  z-index: 70;
  transform: translateX(-100%);
  transition: transform 0.25s ease;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.video-feed-panel.is-open { transform: translateX(0); }

.vfp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}

.vfp-title {
  font-weight: 700;
  font-size: 16px;
}

.vfp-close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
}

.vfp-close:hover { color: var(--text); }

.vfp-body {
  overflow-y: auto;
  padding: 16px 18px 28px;
}

.vfp-section + .vfp-section { margin-top: 22px; }

.vfp-h {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: var(--accent-dim);
  margin: 0 0 10px;
}

.vfp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vf-card {
  display: flex;
  gap: 10px;
  text-decoration: none;
  color: var(--text);
  border-radius: 8px;
  padding: 6px;
}

.vf-card:hover { background: var(--panel-2); }

.vf-card img {
  width: 100px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 6px;
  flex: 0 0 auto;
  background: var(--panel-2);
}

.vf-card-body { min-width: 0; }

.vf-card-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.vf-card-meta {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}

.video-feed-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 65;
}

.video-feed-overlay[hidden] { display: none; }

.video-feed-nav-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 15px;
}

.video-feed-nav-btn:hover {
  color: var(--text);
  background: var(--panel-2);
}

@media (max-width: 720px) {
  .video-feed-tab { display: none; }
  .video-feed-nav-btn { display: inline-flex; }
}
```

- [ ] **Step 3: Manually verify the static shell**

Run: `python3 -m http.server` from the repo root, open `http://localhost:8000/`.

Expected:
- A narrow vertical tab with rotated "Видео" text sits at the left edge, vertically centered.
- Resizing the browser to ≤720px width hides the tab and shows a small icon button in the header nav instead.
- In devtools console, running `document.getElementById('video-feed-panel').classList.add('is-open')` slides the panel in from the left over the page content; `document.getElementById('video-feed-overlay').hidden = false` dims the background.
- Running `.classList.remove('is-open')` and `.hidden = true` again reverses both.

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "Add static video feed drawer shell (markup + styles)"
```

---

### Task 5: Wire fetch + render + open/close behavior

**Files:**
- Modify: `index.html` (inline `<script>` block, currently lines 79-277)
- Create: `tools/fixtures/videos.sample.json`

**Interfaces:**
- Consumes: DOM ids and CSS classes from Task 4 (`video-feed-tab`, `video-feed-nav-btn`, `video-feed-panel`, `video-feed-close`, `video-feed-overlay`, `video-feed-newest`, `video-feed-popular`, `.is-open`).
- Consumes: the `esc()` helper already defined in the existing inline script (`index.html:186-190`).
- Consumes: the `videos.json` schema from the spec (`generatedAt`, `newest: Array<{id,title,channel,thumbnail,publishedAt,views}>`, `popular: Array<same shape>`).

- [ ] **Step 1: Create a sample feed fixture for manual testing**

Create `tools/fixtures/videos.sample.json`:

```json
{
  "generatedAt": "2026-09-21T12:00:00Z",
  "newest": [
    {
      "id": "dQw4w9WgXcQ",
      "title": "Новый обзор оружия в ANOMA",
      "channel": "Тестовый Летсплейщик",
      "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      "publishedAt": "2026-09-21T09:00:00Z",
      "views": 4300
    },
    {
      "id": "9bZkp7q19f0",
      "title": "Плейтест №3: разбор фракций",
      "channel": "Игровой Канал",
      "thumbnail": "https://i.ytimg.com/vi/9bZkp7q19f0/mqdefault.jpg",
      "publishedAt": "2026-09-19T15:00:00Z",
      "views": 12000
    }
  ],
  "popular": [
    {
      "id": "3JZ_D3ELwOQ",
      "title": "ANOMA — лучшие моменты плейтеста",
      "channel": "Игровой Канал",
      "thumbnail": "https://i.ytimg.com/vi/3JZ_D3ELwOQ/mqdefault.jpg",
      "publishedAt": "2026-09-05T10:00:00Z",
      "views": 210000
    },
    {
      "id": "L_jWHffIx5E",
      "title": "Гайд по аномалиям для новичков",
      "channel": "Тестовый Летсплейщик",
      "thumbnail": "https://i.ytimg.com/vi/L_jWHffIx5E/mqdefault.jpg",
      "publishedAt": "2026-08-30T18:00:00Z",
      "views": 87000
    }
  ]
}
```

- [ ] **Step 2: Add the render/open/close logic to the inline script**

Modify `index.html`, inside the existing IIFE, immediately before the closing `var now = new Date();` block (currently `index.html:272`), insert:

```js
  function formatViews(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + ' млн просмотров';
    if (n >= 1000) return Math.round(n / 1000) + ' тыс. просмотров';
    return n + ' просмотров';
  }

  function videoCardHtml(v) {
    return '<li>' +
      '<a class="vf-card" href="https://www.youtube.com/watch?v=' + esc(v.id) + '" target="_blank" rel="noopener">' +
        '<img src="' + esc(v.thumbnail) + '" alt="" loading="lazy">' +
        '<div class="vf-card-body">' +
          '<div class="vf-card-title">' + esc(v.title) + '</div>' +
          '<div class="vf-card-meta">' + esc(v.channel) + ' &middot; ' + formatViews(v.views) + '</div>' +
        '</div>' +
      '</a>' +
    '</li>';
  }

  function openVideoFeed() {
    document.getElementById('video-feed-panel').classList.add('is-open');
    document.getElementById('video-feed-overlay').hidden = false;
    document.getElementById('video-feed-tab').setAttribute('aria-expanded', 'true');
    document.getElementById('video-feed-nav-btn').setAttribute('aria-expanded', 'true');
  }

  function closeVideoFeed() {
    document.getElementById('video-feed-panel').classList.remove('is-open');
    document.getElementById('video-feed-overlay').hidden = true;
    document.getElementById('video-feed-tab').setAttribute('aria-expanded', 'false');
    document.getElementById('video-feed-nav-btn').setAttribute('aria-expanded', 'false');
  }

  function hideVideoFeedTriggers() {
    document.getElementById('video-feed-tab').hidden = true;
    document.getElementById('video-feed-nav-btn').hidden = true;
  }

  function initVideoFeed() {
    var tab = document.getElementById('video-feed-tab');
    var navBtn = document.getElementById('video-feed-nav-btn');
    var closeBtn = document.getElementById('video-feed-close');
    var overlay = document.getElementById('video-feed-overlay');

    tab.addEventListener('click', openVideoFeed);
    navBtn.addEventListener('click', openVideoFeed);
    closeBtn.addEventListener('click', closeVideoFeed);
    overlay.addEventListener('click', closeVideoFeed);

    fetch('/videos.json')
      .then(function (res) {
        if (!res.ok) throw new Error('videos.json недоступен');
        return res.json();
      })
      .then(function (data) {
        if (!data.newest || !data.newest.length) {
          hideVideoFeedTriggers();
          return;
        }
        document.getElementById('video-feed-newest').innerHTML = data.newest.map(videoCardHtml).join('');
        document.getElementById('video-feed-popular').innerHTML = (data.popular || []).map(videoCardHtml).join('');
      })
      .catch(function () {
        hideVideoFeedTriggers();
      });
  }

```

Then, right after the existing `renderList(entries);` call (currently `index.html:275`), add:

```js
  initVideoFeed();
```

- [ ] **Step 3: Manually verify the happy path**

```bash
cp tools/fixtures/videos.sample.json videos.json
python3 -m http.server
```

Open `http://localhost:8000/`. Expected:
- Clicking the vertical tab (or, at ≤720px width, the header icon button) slides the panel in with a dimmed overlay.
- "Новинки" shows the 2 sample videos; "Популярное" shows the 2 sample videos, each a clickable card linking to `https://www.youtube.com/watch?v=<id>` in a new tab.
- Clicking the ✕ button or the dimmed overlay closes the panel.

Remove the local copy afterwards (it must not be committed):

```bash
rm videos.json
```

- [ ] **Step 4: Manually verify graceful degradation**

With no `videos.json` present at the repo root, reload `http://localhost:8000/`.

Expected: no visible tab and no header icon button (both hidden), no JavaScript errors in the devtools console (the `fetch` rejection is caught silently).

- [ ] **Step 5: Commit**

```bash
git add index.html tools/fixtures/videos.sample.json
git commit -m "Wire video feed fetch, render, and open/close behavior"
```

---

## Self-Review Notes

- Spec coverage: hourly VPS cron fetch (Task 2+3), 2 newest + up to 8 popular within 30 days (Task 1), drawer that slides over content with an always-visible desktop tab (Task 4), mobile header button (Task 4), plain YouTube links (Task 5), silent degradation on fetch failure (Task 5), index.html-only scope (all frontend tasks touch only `index.html`/`styles.css`) — all covered.
- No placeholders remain; every step has runnable code and exact commands.
- Type/name consistency checked: `pickNewest`/`pickPopular`/`parseChannelsConfig` signatures match between Task 1's implementation and Task 2's usage; DOM ids match between Task 4's markup and Task 5's `getElementById` calls; the `videos.json` field names (`id`, `title`, `channel`, `thumbnail`, `publishedAt`, `views`) match across Task 2's `fetchChannelVideos` mapping, Task 5's fixture, and Task 5's `videoCardHtml`.
