# QA Report — ArrowPath Unreleased IMPROVE (post v0.1.0)

**Date:** 2026-09-28 17:35 PKT (Asia/Karachi)  
**Project:** `/workspace/factory/projects/arrowpath`  
**Feature pack:** `b8938d82bfaac6d18a8ea3193d7930ccb48260e0` (`b8938d8` — Unreleased daily PKT + share + Continue)  
**HEAD audited:** `84b072f15c1358247fd8590a14fca13a91d73068` (`84b072f` — docs: STATUS HEAD matches tip)  
**Base release:** `340d670` (v0.1.0 dual-cleared) · Pages base chore `6a20eb3`  
**Improve ticket:** `/workspace/factory/inbox/IMPROVE-arrowpath-20260928-1729.md`  
**Prior QA:** `QA-REPORT.md` (v0.1.0 **PASS**)  
**QA:** Independent pass (report only — no product code changes; no GitHub push; no agent messages)  
**Overall:** **PASS**

---

## Summary

All three Master IMPROVE verify items hold. Gates: **`npm test` 26/26**, **`npm run build` green** (tsc + Vite + PWA; `base: '/arrowpath/'`). Preview smoke under `/arrowpath/` green. No new P0/P1.

| Severity | Count |
|----------|------:|
| P0 / Critical | 0 |
| P1 / High | 0 |
| P2 / Medium | 0 |
| P3 / Low (residual) | 2 |

**CLEAR from QA (Unreleased IMPROVE pack):** **YES**

---

## Environment

| Item | Detail |
|------|--------|
| Runtime | `npm run preview -- --host 127.0.0.1 --port 4175` |
| Methods | IMPROVE ticket + STATUS/CHANGELOG/README/GUIDE; source review (`daily.ts`, `persist.ts`, `main.ts`, `index.html`, `vite.config.ts`); vitest; production build; HTTP smoke of `dist/` at `/arrowpath/`; 365-day daily levelId range probe |
| Zone | Asia/Karachi (UTC+5); times PKT |

---

## Automation

| Check | Result |
|-------|--------|
| `npm test` | **26/26 passed** — engine 15 + ads 3 + daily PKT 8; vitest 3.2.7 |
| `npm run build` | **green** — `tsc && vite build`; PWA generateSW, **13 precache entries** including `levels.json`; asset URLs prefixed `/arrowpath/` |

---

## Master IMPROVE checklist

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | PKT Daily Challenge (levels 1–50 reuse, isolated daily persist) | **PASS** | `src/game/daily.ts`: `dailyKeyKarachi` (UTC+5 calendar day), `dailyLevelId` → `(hash % N) + 1` for N=50. Home `#btn-daily` + `#home-daily-meta` (`Daily YYYY-MM-DD ready` / `✓ completed`). `persist.ts` `getDailyRecord`/`saveDailyRecord` → `arrowpath:v1:daily:{key}` `{completed, levelId, finishedAt?}`. `onWin` daily path only `saveDailyRecord` — does **not** call `markLevelCleared` (campaign unlock/cleared untouched). Re-entry when completed: toast “Daily already done — Continue campaign”; win CTA “Continue campaign”. Vitest `tests/daily.test.ts` 8/8 (same-day stability, UTC+5 midnight boundary, 1..N). Probe: 365 consecutive days → all levelIds in 1..50, **50 unique**. Today PKT `2026-09-28` → levelId **38**. |
| 2 | Win Share + Home Continue label | **PASS** | Win overlay `#btn-share` in `index.html` + dist. `shareWin()` text `ArrowPath — cleared level N (neon metro)` (daily variant includes date); `navigator.share` with clipboard / legacy copy + toast “Copied share text”. Home `#btn-play` label via `updateHome`: `Continue` when `unlocked > 1 \|\| cleared.length > 0`, else `Play`; still `startLevel(Math.min(unlocked, …), 'campaign')`. Built JS contains share string + Continue branches. |
| 3 | Docs STATUS + `/arrowpath/` base path | **PASS** | `vite.config.ts` `base: '/arrowpath/'`; `levels.ts` fetch `${import.meta.env.BASE_URL}levels.json` → dist fetch `/arrowpath/levels.json`. README + GUIDE-roman-urdu document `/arrowpath/` for dev/preview/Pages. CHANGELOG **Unreleased** covers daily/share/Continue/docs. STATUS lists feature pack `b8938d8`, base `340d670`, READY_FOR_QA, gates 26/26. Working-tree STATUS HEAD = tip `84b072f`; committed tip file still cites `646639e` (1-commit docs lag — residual P3, not a ship blocker; acceptance “≥340d670 or newer” met). |

---

## Smoke (preview `:4175`)

| URL | Result |
|-----|--------|
| `/arrowpath/` | **200** — title ArrowPath; `#btn-daily` Daily Challenge; `#btn-share`; `#home-daily-meta`; `#btn-play` |
| `/` | **302** (base-path host) |
| `/arrowpath/levels.json` | **200** JSON — theme `neon-metro`, **50** levels ids 1..50 (53328 bytes) |
| `/arrowpath/manifest.webmanifest` | **200** — name ArrowPath, display standalone, theme `#070b16` |
| `/arrowpath/sw.js` | **200** — `precacheAndRoute` includes `levels.json` + shell assets |
| `/arrowpath/assets/*.js`, `*.css`, `registerSW.js` | **200** |

---

## IMPROVE acceptance mapping

| Criterion | Result |
|-----------|--------|
| Home Daily + PKT meta ready/completed | **PASS** |
| Deterministic levelId 1..50 from date key | **PASS** (tests + 365-day probe) |
| Isolated `arrowpath:v1:daily:{key}` — no campaign advance | **PASS** (`onWin` branch) |
| Completed re-entry → completed state + campaign CTA | **PASS** |
| Vitest same day + UTC+5 midnight boundary | **PASS** (8/8) |
| Win Share navigator.share + clipboard toast | **PASS** |
| Home Play → Continue on progress | **PASS** |
| STATUS / README / GUIDE `/arrowpath/` | **PASS** (STATUS tip hash lag = residual) |
| `npm test` 26/26 + `npm run build` green | **PASS** |
| No new P0/P1 | **PASS** |

---

## Residuals (non-blocking)

1. **P3 — Committed STATUS HEAD one commit behind tip:** At audited HEAD `84b072f`, committed `STATUS.md` still lists Commit/HEAD `646639e`; working tree (unstaged) already has `84b072f`. Docs-only chicken-egg; does not affect Unreleased runtime. Optional: SE commit the pending STATUS sync before publish docs refresh.  
2. **P3 — No dedicated unit test for share/Continue UI or daily↔campaign isolation wiring:** Covered by source review + built bundle strings + daily unit suite; optional follow-up if regression risk rises. (Carry-forward from MVP: solvability suite still samples first-10 only; not re-probed this pass.)

---

## Blockers

**None (P0/P1).**

---

## CLEAR

**CLEAR from QA for Unreleased IMPROVE pack:** **YES**  
Master may refresh gh-pages / advance publish docs after any STATUS HEAD sync preferred. Report only — no product code changes, no GitHub push, no agent messages.
