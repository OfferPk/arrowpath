# QA Report — ArrowPath MVP v0.1.0

**Date:** 2026-09-28 17:21 PKT (Asia/Karachi)  
**Project:** `/workspace/factory/projects/arrowpath`  
**HEAD audited:** `340d6705309cd22fd68e3b888899dbab95783e2d` (`340d670` — docs: STATUS commit refs)  
**PRD:** `/workspace/factory/research/PRD-arrowpath.md`  
**QA:** Independent pass (report only — no product code changes; no GitHub push; no agent messages)  
**Overall:** **PASS**

---

## Summary

MVP holds. Master checklist items 1–8 verified with code + pack + automation + preview smoke. Gates: **`npm test` 18/18**, **`npm run build` green** (tsc + Vite + vite-plugin-pwa; SW precaches `levels.json` + shell). Extra solvability probe: **all 50 levels** solve under the engine solver (depth 48). No P0/P1 ship blockers found.

| Severity | Count |
|----------|------:|
| P0 / Critical | 0 |
| P1 / High | 0 |
| P2 / Medium | 0 |
| P3 / Low (residual) | 2 |

**CLEAR for publish from QA:** **YES** (sync STATUS HEAD hash before or with publish docs is residual only).

---

## Environment

| Item | Detail |
|------|--------|
| Runtime | `npm run preview -- --host 127.0.0.1 --port 4174` (4173 occupied by WordHunt; ArrowPath bound 4174) |
| Methods | PRD/STATUS/README/GUIDE read; source review (engine, canvas, ads, main, PWA); `npm test`; `npm run build`; vite-node solvability of 50 levels; HTTP smoke of `dist/` |
| Zone | Asia/Karachi (UTC+5); times PKT |

---

## Automation

| Check | Result |
|-------|--------|
| `npm test` | **18/18 passed** — `tests/engine.test.ts` (15) + `tests/ads.test.ts` (3); vitest 3.2.7 |
| `npm run build` | **green** — `tsc && vite build`; PWA generateSW, **13 precache entries** including `levels.json`, `index.html`, assets, icons, manifest |
| Extra solvability | **50/50** solvable via `solve()` + replay (QA script; not committed) |

---

## Master checklist

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | Neon metro theme | **PASS** | `public/levels.json` `theme: "neon-metro"`; CSS cyan/pink/dark (`#070b16`, `#2de2e6`, `#ff2a6d`); canvas arrows + metro wall hatch; copy “Neon metro”; README/PRODUCT/IP disclaimers — no competitor branding assets |
| 2 | 50 levels | **PASS** | Pack `levels.length === 50`, ids 1–50 continuous; test asserts exactly 50; home UI “1 / 50”; level select builds from pack |
| 3 | Walls | **PASS** | Engine `kind: 'wall'` fail path; 41/50 levels contain walls (first wall level **6**); 94 wall cells; tests cover wall fail + level 6 board placement |
| 4 | 3 undos | **PASS** | `FREE_UNDOS = 3` in `src/game/types.ts`; engine consumes free undos then `forceExtra` after rewarded; HUD default 3; tests undo consume + exhaust + fail recovery; UI rewarded stub for extra undo |
| 5 | Ads stubs | **PASS** | `src/ads/stubs.ts`: `showInterstitial`, `showRewarded`, `isAdsRemoved`, `purchaseRemoveAds`; wired from `main.ts` (fail/retry/level-complete, hint/undo, Settings remove-ads); 3/3 ads tests green |
| 6 | Canvas PWA | **PASS** | `#board` canvas + `src/ui/canvas.ts` 2D renderer; Vite + TS; `manifest.webmanifest` (standalone, theme `#070b16`); `vite-plugin-pwa` → `dist/sw.js` + `registerSW.js` |
| 7 | GUIDE-roman-urdu + README | **PASS** | Both present at project root; README links GUIDE; GUIDE covers install/run/play/undo/hint/PWA/troubleshooting in Roman Urdu |
| 8 | Offline play | **PASS** | SW `precacheAndRoute` includes `levels.json` + JS/CSS/HTML/icons/manifest; NavigationRoute → `index.html`; preview serves levels JSON 200 (`Content-Type: application/json`, 53328 bytes). Offline after first load is structurally satisfied (no live network-offline browser toggle this pass) |

---

## Smoke (preview)

| URL | Result |
|-----|--------|
| `/` | 200 — title ArrowPath, canvas, registerSW, neon copy |
| `/levels.json` | 200 JSON — theme `neon-metro`, 50 levels, 41 with walls |
| `/manifest.webmanifest` | 200 — name ArrowPath, display standalone |
| `/sw.js` | 200 — precache lists `levels.json` |
| `/assets/*.js`, `*.css` | 200 |

---

## PRD acceptance mapping

| Criterion | Result |
|-----------|--------|
| 50 playable levels; sequential unlock | **PASS** (pack + `progress.unlocked` lock in level select) |
| Collision + clear + undo | **PASS** (engine + tests) |
| PWA installable; offline after cache | **PASS** (manifest + SW precache; install prompt UI present) |
| Ad/remove-ads hooks call stubs | **PASS** |
| `npm test` + `npm run build` green | **PASS** |
| README + GUIDE; original theme | **PASS** |
| No TubeSort / GlowGrid mechanic drift | **PASS** (arrow path-clear only; drift mentioned only as non-goals in docs) |

---

## Residuals (non-blocking)

1. **P3 — STATUS.md HEAD stale:** File claims HEAD `a2f301c` / MVP `82a84cc`; audited tree HEAD is **`340d670`**. Docs-only; does not affect runtime MVP.  
2. **P3 — Unit suite covers solvability for levels 1–10 only:** CHANGELOG/STATUS claim broader solvability; QA confirmed **50/50** outside the committed suite. Optional follow-up: extend vitest to sample or all levels.

---

## Blockers

**None (P0/P1).**

---

## Verdict

| Question | Answer |
|----------|--------|
| Overall | **PASS** |
| CLEAR for publish from QA? | **YES** |

Report only — product sources untouched; no git push; no agent messages.
