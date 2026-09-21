# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ANOMA WIKI — a fan site for the game ANOMA (MMORPG, STALKER-like setting), plus an
artillery calculator tool for the game's mortar/gun mechanics. It is a **plain static
site**: no framework, no bundler, no `package.json`. Every page is a single self-contained
HTML file with inline or linked CSS/JS, served as-is by nginx.

There is no build step, no linter, and no test suite in this repo — don't invent commands
for them.

## Files

- `index.html` — landing page (hero, playtest calendar). Links to `styles.css`. The
  playtest calendar is hardcoded as a `PLAYTESTS` array inline in a `<script>` at the
  bottom of the file — add new playtests by editing that array directly, no CMS/data file.
- `artillery_calculator.html` — the calculator itself. Fully self-contained (its own
  `<style>` and `<script>`, no external deps). Served at the friendly URL `/art-calc` in
  production (nginx rewrite; the file itself is not renamed).
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
- `artillery_calculator.html` has an inline countdown/gate script (top of file, around the
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

To deploy manually, push to `master` (there is no staging environment).

## Local preview

Since pages are static and the calculator's early-access WebCrypto path needs HTTPS, the
simplest local check is `python3 -m http.server` from the repo root and opening
`http://localhost:8000/` — good enough for layout/JS checks, but the WebCrypto early-access
key path in `artillery_calculator.html` won't work outside HTTPS/production.
