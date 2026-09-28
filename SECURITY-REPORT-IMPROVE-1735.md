# ArrowPath — Security Review Report (IMPROVE / Unreleased)

| Field | Value |
|-------|--------|
| **Project** | ArrowPath (`proj_arrowpath_001`) |
| **Path** | `/workspace/factory/projects/arrowpath` |
| **HEAD** | `84b072f15c1358247fd8590a14fca13a91d73068` |
| **Feature pack** | `b8938d82bfaac6d18a8ea3193d7930ccb48260e0` (Unreleased daily PKT + share + Continue) |
| **Pages base chore** | `6a20eb3` |
| **Base release** | `340d670` — prior Security **PASS_WITH_NOTES** (`SECURITY-REPORT.md`) |
| **Review date** | 2026-09-28 17:35 PKT (Asia/Karachi) |
| **Reviewer** | Security Reviewer (factory) |
| **Gate** | `/workspace/factory/shared/security/RELEASE_GATE.md` |
| **Verdict** | **PASS_WITH_NOTES** |

No product code was edited. No git push was performed.

---

## Verdict summary

Unreleased IMPROVE (Daily Challenge PKT, Win Share/clipboard, Continue label, `/arrowpath/` docs) does **not** regress MVP controls. Daily progress is isolated under `arrowpath:v1:daily:{key}` and does not call `markLevelCleared`. Share text is fixed-template + code-generated date/number; toast/DOM use `textContent`. App `fetch` remains same-origin via `BASE_URL`; ads remain stubs; Vite `base: '/arrowpath/'` + relative manifest scope; prod `npm audit --omit=dev` clean; `npm test` 26/26.

**Ship blockers:** none.

Notes are hardening / carried MVP items — not RELEASE_GATE publish blockers for this offline PWA.

---

## Ship blockers

*(none)*

---

## Master focus checklist (IMPROVE)

| # | Focus | Result |
|---|--------|--------|
| 1 | **Daily persist isolation** | **PASS** — Key `PREFIX + \`daily:${dailyKey}\`` → `arrowpath:v1:daily:{YYYY-MM-DD}` (`persist.ts:1,76–101`). `onWin` daily branch only `saveDailyRecord`; campaign-only `markLevelCleared` (`main.ts:205–216`). Parse: `levelId` must be `typeof === 'number'` else null; `completed` coerced `Boolean` (`persist.ts:80–86`). Key producers: `dailyKeyKarachi()` always `YYYY-MM-DD` (`daily.ts:24–31`). App never passes user-typed keys into daily helpers. |
| 2 | **Share API / XSS** | **PASS** — `shareWin` builds plain text from literals + `dailyKey` (code) + `currentId` (number); `navigator.share({ title: 'ArrowPath', text })` — **no `url`** (`main.ts:225–236`). Clipboard: `writeText` / legacy `textarea.value` (not HTML) (`:239–264`). Toast: `textContent` with fixed `'Copied share text'` (`:65–66,240`). Home daily meta / win meta / Continue label: `textContent` only (`:78–90,82–83,146–153`). Sole `innerHTML` remains clear-only (`:356`). |
| 3 | **No new network secrets** | **PASS** — `src/ads/stubs.ts` unchanged stubs (log + `Promise.resolve`; IAP sets localStorage flag). No `ca-app-pub` / API keys / telemetry / `sendBeacon` / gtag in `src/`. Levels: `fetch(\`${import.meta.env.BASE_URL}levels.json\`)` (`levels.ts:13`); built bundle fetches `/arrowpath/levels.json`. |
| 4 | **PWA base path safe** | **PASS** — `vite.config.ts:6` `base: '/arrowpath/'`. Manifest `start_url`/`scope` `"./"` resolve under `/arrowpath/` (`public/manifest.webmanifest:5–6`). Built `dist/sw.js`: precache includes `levels.json` + assets; `NavigationRoute` → `index.html`; `clientsClaim` / `cleanupOutdatedCaches`. Base is a compile-time constant — **no open redirect**. |
| — | **Continue label** | **OK (UI-only)** — `playBtn.textContent = unlocked > 1 \|\| cleared.length ? 'Continue' : 'Play'` (`main.ts:81–83`); no authz/persist side effects. |

---

## Delta findings (vs base `340d670`)

### I1 — Daily key param not format-allowlisted at persist boundary (Note / Low hardening)

| | |
|--|--|
| **Severity** | Note (not a ship blocker) |
| **Evidence** | `src/game/persist.ts:76–101` — `getDailyRecord`/`saveDailyRecord` concatenate any `dailyKey` string into `arrowpath:v1:daily:${dailyKey}` |
| **Detail** | No `/^\d{4}-\d{2}-\d{2}$/` check at the storage boundary. Call sites only pass `dailyKeyKarachi()` (`main.ts:85,183,207`). localStorage keys are opaque literals (no path traversal into `progress`/`settings`). |
| **Mitigating** | Producer always emits zero-padded calendar date; display paths use that same producer key via `textContent`. |
| **Fix (when hardening)** | Reject non-matching keys in get/save; optionally `typeof finishedAt === 'string'` before persist. |

### I2 — `finishedAt` type not narrowed on read (Note / Info)

| | |
|--|--|
| **Severity** | Info |
| **Evidence** | `persist.ts:85` — `finishedAt: parsed.finishedAt` without `typeof === 'string'` |
| **Detail** | Poisoned same-origin storage could yield a non-string. **Not rendered** into DOM in current `main.ts` (only `completed` / generated `key` / numeric `levelId` surface). |
| **Fix** | Coerce or drop non-string `finishedAt` on read. |

### Carried from MVP (unchanged risk; do not regress)

| ID | Topic | Status |
|----|--------|--------|
| F1 | Thin `levels.json` schema validation (`levels.ts:11–20`) | Still Note — first-party pack only |
| F2 | `.gitignore` lacks `.env` / `.env.*` | Still Note — no secrets yet |
| F3 | Progress/settings merge via object spread (`persist.ts:25–29`) | Still Note |
| F4 | Dev Vitest moderate GHSA-82fw-gwwq-j7x9 | Still accepted for prod ship |

---

## MVP regression — Still OK

| Control | Evidence |
|---------|----------|
| Canvas XSS | `src/ui/canvas.ts` Canvas 2D only; no HTML from level strings |
| Ads stubs | `src/ads/stubs.ts` — no SDK; tests `tests/ads.test.ts` |
| levels.json | Same-origin `BASE_URL` fetch; no eval |
| Offline-only | No new network clients; SW same-origin precache |
| `innerHTML` | Clear-only at `main.ts:356`; buttons via `createElement` + `textContent` |
| Campaign unlock | Daily mode skips unlock gate intentionally (`main.ts:165–168`) but **does not** write campaign progress on win |

---

## RELEASE_GATE checklist

| # | Item | Status |
|---|------|--------|
| 1 | Authn / sessions / tokens | N/A |
| 2 | Authz / IDOR | N/A (local unlock; daily isolated) |
| 3 | Secrets & config | PASS (stubs; F2 future) |
| 4 | API surface & rate limits | N/A |
| 5 | Injection (XSS / etc.) | PASS (textContent / share plain text) |
| 6 | Uploads & file access | N/A |
| 7 | Dependencies & supply chain | PASS_WITH_NOTES (F4 dev-only) |
| 8 | Logging / error leakage | PASS |
| 9 | Transport | Deploy HTTPS (host) |
| 10 | Admin / debug surfaces | PASS |

---

## Evidence bullets

- **HEAD:** `84b072f15c1358247fd8590a14fca13a91d73068` (docs tip); feature `b8938d8`
- **CHANGELOG Unreleased:** Daily PKT + share/Continue + `/arrowpath/` docs
- **Isolation:** `onWin` daily → `saveDailyRecord` only (`main.ts:207–212`); campaign → `markLevelCleared` (`:213–215`)
- **Key format producer:** `daily.ts:24–31` → `` `${y}-${m}-${day}` ``
- **Share:** `main.ts:225–264` — no share `url`; clipboard safe; toast `textContent`
- **Fetch:** `levels.ts:13` + built `/arrowpath/levels.json`
- **Vite/PWA:** `vite.config.ts` base `/arrowpath/`; `dist/sw.js` precache + NavigationRoute
- **Secrets grep (`src/`, `public/`):** no api_key / ca-app-pub / Bearer hits
- **`npm test`:** **26/26** passed (engine 15 + ads 3 + daily PKT 8)
- **`npm audit --omit=dev`:** **0** vulnerabilities
- **`npm audit` (all):** 2 moderate (vitest / @vitest/mocker, dev-only — F4)

---

## Notes for engineering (non-blocking)

1. Optional: allowlist `dailyKey` as `YYYY-MM-DD` inside `getDailyRecord` / `saveDailyRecord` (I1); narrow `finishedAt` (I2).
2. Keep share payloads as plain `text` without attacker-controlled `url`.
3. Before untrusted/remote level packs or real AdMob/IAP: address carried F1/F2 and re-review.
4. Prefer `textContent` / Canvas; do not introduce `innerHTML` with interpolated data.

---

## Sign-off

| | |
|--|--|
| **Verdict** | **PASS_WITH_NOTES** |
| **May publish / deploy (per gate)?** | **Yes** — no RELEASE_GATE ship blockers. IMPROVE does not regress MVP. Address notes on a follow-up hardening pass. |
| **Signed** | Security Reviewer — 2026-09-28 17:35 PKT |
| **Constraints honored** | No product code edits; no git push |
