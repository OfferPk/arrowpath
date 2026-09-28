# Changelog

## Unreleased

### Daily Challenge (PKT)
- Home **Daily Challenge** button + meta (`Daily YYYY-MM-DD ready` / `✓ completed`) using Asia/Karachi calendar day
- Deterministic levelId in 1..50 from date key; progress isolated in `arrowpath:v1:daily:{key}` (does not advance campaign unlock/cleared)
- Re-entry after complete shows completed state + CTA to campaign Continue

### Win share + Continue
- Win overlay **Share** — `ArrowPath — cleared level N (neon metro)` via `navigator.share` + clipboard fallback + toast
- Home primary label **Continue** when `unlocked > 1` or any cleared, else **Play**

### Docs
- STATUS HEAD sync; README + GUIDE document Vite `base` `/arrowpath/` for preview/GitHub Pages

## 0.1.0 — 2026-09-28

- Neon metro ArrowPath PWA scaffold (Vite + TS + Canvas + vite-plugin-pwa)
- Core engine: fire, clear off-board, collision/wall fail, win detect
- Undo stack (3 free undos per level) + rewarded stub for extra undo/hint
- 50 JSON levels in `public/levels.json` (handcrafted intro + validated generated pack)
- Screens: Home, Play, Level select, How to play, Settings
- Ads stubs wired to fail/retry/level-complete interstitial, hint/undo rewarded, remove-ads purchase flag
- Vitest: move/collision/undo/hint + solved fixture + first-10 solvability
- Docs: README, PRODUCT, GUIDE-roman-urdu, STATUS
- Pages base path `/arrowpath/` + BASE_URL levels fetch
