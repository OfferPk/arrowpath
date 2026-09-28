# ArrowPath — Security Review Report

| Field | Value |
|-------|--------|
| **Project** | ArrowPath (`proj_arrowpath_001`) |
| **Path** | `/workspace/factory/projects/arrowpath` |
| **HEAD** | `340d6705309cd22fd68e3b888899dbab95783e2d` |
| **MVP feat** | `82a84cc96e412871639a21baf0e75b0f0e851c68` |
| **Review date** | 2026-09-28 17:21 PKT (Asia/Karachi) |
| **Reviewer** | Security Reviewer (factory) |
| **Gate** | `/workspace/factory/shared/security/RELEASE_GATE.md` |
| **Verdict** | **PASS_WITH_NOTES** |

No product code was edited. No git push was performed.

---

## Verdict summary

Offline-only Canvas PWA with first-party `levels.json`, localStorage progress, and ads/IAP **stubs**. No accounts, no backend, no third-party SDKs, no secrets in tree. XSS surface is minimal (`textContent` / Canvas; `innerHTML` used only to clear). Production `npm audit --omit=dev` is clean.

**Ship blockers:** none.

Notes are hardening items (schema validation depth, `.gitignore` for future env secrets, dev-only Vitest advisory) — not RELEASE_GATE publish blockers for this MVP.

---

## Ship blockers

*(none)*

---

## Findings

### F1 — Level loader schema validation is thin (Note / Medium hardening)

| | |
|--|--|
| **Severity** | Note (not a ship blocker for first-party shipped pack) |
| **Evidence** | `src/game/levels.ts:11–20` |
| **Detail** | `loadLevels()` uses `fetch('/levels.json')` + `res.json()`, then only checks `pack.levels` exists and `length >= 1`. No checks for: integer `id`/`w`/`h`, cell shape, `t ∈ {arrow,wall}`, `d ∈ {N,E,S,W}`, grid bounds, max dimensions/cell count, or rejection of unexpected/`__proto__` keys. |
| **Mitigating** | Shipped `public/levels.json` spot-checked: 50 levels, keys only `id/w/h/cells` + `x/y/t/d`, max 7×7 / 19 cells, no HTML/script/`__proto__` strings. Engine `levelToBoard` (`src/game/engine.ts:18–31`) skips OOB cells and only materializes `wall` / `arrow` with truthy `d`. Canvas never injects level strings into HTML. |
| **Risk if ignored** | Tampered or future remote levels could throw (e.g. invalid `dir` → `DIR_DELTA[dir]` undefined in `traceFire` / `drawArrow`) or inflate memory — availability / UX, not XSS today. |
| **Fix (when hardening)** | Validate each level after parse: bounds caps, typed cells, allowlist keys, reject `__proto__`/`constructor`; fail closed before `Engine` construction. |

### F2 — `.gitignore` does not explicitly ignore `.env` (Note / Low)

| | |
|--|--|
| **Severity** | Note |
| **Evidence** | `.gitignore` (lines 1–12): ignores `node_modules`, `dist`, `*.local`, etc.; **no** `.env` / `.env.*` |
| **Detail** | MVP has no env secrets (stubs only). Before AdMob / IAP keys land, missing ignore raises accidental-commit risk. |
| **Fix** | Add `.env`, `.env.*`, `!.env.example` when secrets are introduced; keep placeholders only in `.env.example`. |

### F3 — localStorage merge via object spread (Note / Low)

| | |
|--|--|
| **Severity** | Note |
| **Evidence** | `src/game/persist.ts:18–25` — `return { ...fallback, ...JSON.parse(raw) }` |
| **Detail** | Progress/settings are same-origin localStorage. A crafted `__proto__` / polluted object is a theoretical concern if an attacker already controls storage on this origin (typically after XSS). `getProgress()` does coerce `unlocked` and `cleared`. |
| **Fix** | Prefer explicit field picks (`unlocked`, `cleared`, `muted`, `adsRemoved`) over blind merge. |

### F4 — DevDependency Vitest advisory (Note / Accepted for prod ship)

| | |
|--|--|
| **Severity** | Note (dev-only) |
| **Evidence** | `npm audit` (full): 2× moderate in `vitest` / `@vitest/mocker` (GHSA-82fw-gwwq-j7x9). `npm audit --omit=dev`: **0 vulnerabilities**. |
| **Detail** | Vitest is not shipped in the Vite production bundle. Path-traversal mock issue is a CI/dev concern, not runtime PWA exposure. |
| **Acceptance** | Documented for Olivia: acceptable for MVP publish; bump Vitest when convenient (may be breaking → 5.x). |

### F5 — `innerHTML` clear-only (Info / Safe)

| | |
|--|--|
| **Severity** | Info |
| **Evidence** | `src/main.ts:231` — `grid.innerHTML = ''`; buttons built with `createElement` + `textContent = String(level.id)` (`:234–237`) |
| **Detail** | No string→HTML concatenation of level or user data. All HUD/fail/reward strings use `textContent` with fixed literals or numeric `String(...)`. |

---

## Master focus checklist

| # | Focus | Result |
|---|--------|--------|
| 1 | **XSS (UI / string→DOM)** | **PASS** — No `eval`/`Function`/`document.write`/`insertAdjacentHTML`/`outerHTML`. Sole `innerHTML` clears the level grid. Dynamic UI uses `textContent` / `createElement`. Fail reason mapped from enum → fixed English strings (`main.ts:127`). |
| 2 | **No secrets (AdMob/IAP keys)** | **PASS** — `src/ads/stubs.ts` is log + `Promise.resolve` only; `purchaseRemoveAds` sets localStorage flag. No `ca-app-pub`, API keys, or private material in source/lockfile/git-tracked files. GUIDE “Password” table is empty placeholders stating no login. |
| 3 | **PWA / service worker hygiene** | **PASS** — `vite.config.ts`: `registerType: 'autoUpdate'`, `manifest: false` (static `public/manifest.webmanifest`), workbox `globPatterns` for static assets including `json`. Built `dist/sw.js`: precache (incl. `levels.json`) + `NavigationRoute` → `index.html` + `cleanupOutdatedCaches` / `clientsClaim`. No Workbox Google Analytics module wired (transitive `workbox-google-analytics` in lockfile is unused). |
| 4 | **Dependency audit** | **PASS_WITH_NOTES** — Prod audit clean. Dev Vitest moderate advisories only (F4). Runtime deps: none (Vite/TS/PWA/Vitest are all `devDependencies`). |
| 5 | **Offline-only / no unexpected telemetry** | **PASS** — Application `fetch` only to same-origin `/levels.json` (`levels.ts:13`). No `sendBeacon`, gtag, AdMob, analytics SDKs, WebSockets, or third-party hosts in `src/` or built app JS. SW `fetch` is cache/network for same-origin precache only. |
| 6 | **Level JSON safety** | **PASS_WITH_NOTES** — Shipped pack clean (no script/HTML/`__proto__`; shapes sane). Loader uses `JSON.parse` path via `res.json()` only (no eval). Validation is minimal (F1); engine + Canvas provide soft containment for malformed cells. **Do not treat as safe for untrusted remote packs without F1 hardening.** |

### RELEASE_GATE checklist

| # | Item | Status |
|---|------|--------|
| 1 | Authn / sessions / tokens | N/A (no accounts) |
| 2 | Authz / IDOR | N/A (local unlock via localStorage; client-side only) |
| 3 | Secrets & config | PASS (stubs; note F2 for future `.env`) |
| 4 | API surface & rate limits | N/A (no server API) |
| 5 | Injection (XSS / etc.) | PASS (Canvas + textContent) |
| 6 | Uploads & file access | N/A |
| 7 | Dependencies & supply chain | PASS_WITH_NOTES (F4) |
| 8 | Logging / error leakage | PASS (ad stub in-memory log; no PII to network) |
| 9 | Transport | Deploy concern (serve over HTTPS); app itself has no insecure cookie/auth |
| 10 | Admin / debug surfaces | PASS (no debug endpoints; type export only) |

---

## Evidence bullets (tests / tools)

- **HEAD verified:** `340d6705309cd22fd68e3b888899dbab95783e2d`
- **Grep:** `innerHTML` only clear; no `eval`/`Function(`/`document.write`/`sendBeacon`/`gtag`/`admob` SDK usage in `src/`
- **Canvas:** `src/ui/canvas.ts` draws via Canvas 2D; glyphs from fixed `ARROW_GLYPH` map; no HTML from level data
- **levels.json:** 53328 bytes, version 1, theme `neon-metro`, ids 1–50, weirdCount 0, no script/proto markers
- **Ads:** `src/ads/stubs.ts` — interstitial/rewarded/IAP stubs; tests `tests/ads.test.ts` pass
- **`npm test`:** 18/18 passed
- **`npm audit --omit=dev`:** 0 vulnerabilities
- **`npm audit` (all):** 2 moderate (vitest / @vitest/mocker, dev)
- **dist SW:** precache list is first-party assets only; register via `dist/registerSW.js` → `/sw.js`

---

## Notes for engineering (non-blocking)

1. Before any **user-generated or CDN-mutable** level pack: implement F1 schema validation + size caps.
2. When wiring **real AdMob / IAP**: secrets via env only; extend `.gitignore` (F2); keep stubs until SDKs are reviewed again.
3. Prefer continuing **`textContent` / Canvas** patterns; avoid introducing `innerHTML` with interpolated data.
4. Optional: bump Vitest when tooling allows to clear F4.

---

## Sign-off

| | |
|--|--|
| **Verdict** | **PASS_WITH_NOTES** |
| **May publish / deploy (per gate)?** | **Yes** — no RELEASE_GATE blockers. Address notes on a follow-up hardening pass, especially before untrusted level sources or real monetization SDKs. |
| **Signed** | Security Reviewer — 2026-09-28 17:21 PKT |
| **Constraints honored** | No product code edits; no git push |

