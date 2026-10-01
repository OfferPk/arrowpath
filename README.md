# ArrowPath

**Neon metro arrow path-clear puzzle PWA** — tap glowing transit arrows so they fly off the grid without colliding. Offline-capable, 50 levels, no accounts.

> Roman Urdu guide: **[GUIDE-roman-urdu.md](./GUIDE-roman-urdu.md)**

## Stack

- Vite + TypeScript
- HTML Canvas 2D
- vite-plugin-pwa (service worker + manifest)
- localStorage progress
- Vitest unit tests

## Quick start

```bash
cd /workspace/factory/projects/arrowpath
npm install
npm run dev
```

Dev server prints a local URL. With Vite `base: '/arrowpath/'`, open the **`/arrowpath/`** path (e.g. `http://localhost:5173/arrowpath/`).

```bash
npm test          # vitest
npm run test:movement # Level 10 tap/slide/undo/retry browser regressions
npm run test:share # mocked Win share/copy success, cancel, and fallback regressions
npm run test:a11y # axe browser scan; requires Chromium (or set CHROMIUM_PATH)
npm run test:daily-pointer # native rapid double-click through the Daily screen transition
npm run test:pwa  # production worker-update and safe-handoff browser test
npm run build     # tsc + vite build → dist/
npm run preview   # serve production build at /arrowpath/
```

When a service-worker update is ready, ArrowPath waits for a user action instead of reloading automatically. An unfinished puzzle gets an explicit restart confirmation, and activating an update in one tab does not reload other open game tabs.

**GitHub Pages / static host:** app is served under **`/arrowpath/`** (not site root). Asset fetches use `import.meta.env.BASE_URL`.

## Publish to GitHub Pages

Pages is configured for legacy publishing from the **root of `gh-pages`**. From a clean, up-to-date `main`, first preview the operation with:

```bash
npm run publish:pages -- --dry-run
```

When the preview is clear, publish with `npm run publish:pages`. The command checks the live Pages source through GitHub's API, installs the locked dependencies, runs the test suite and production build, and validates the `/arrowpath/` asset paths. It stages `dist/` in a temporary worktree based on the fetched `gh-pages` tip, preserves `.nojekyll`, any `CNAME`, and other hidden root entries, and refuses unknown root files rather than deleting them. It stops if `main` is dirty or not exactly in sync with `origin/main`, if the Pages source differs, or if the Pages branch changes while it is preparing the deployment. The final push is a regular fast-forward-only push; it never force-pushes.

Authenticate the GitHub CLI or set `GH_TOKEN` / `GITHUB_TOKEN` for the command. The credential must be able to read this repository's Pages settings and, for an actual publish, push repository contents; no GitHub Actions/workflow permission is used. This publisher does not edit workflow files.

## Play

| Control | Action |
|---------|--------|
| **Tap arrow** | Slide it in its fixed facing direction; it exits if clear or stops just before a blocker |
| **Undo** | 3 free undos per level; then rewarded stub for extra |
| **Ctrl+Z / Cmd+Z** | Undo the last move while playing, with the same free and rewarded limits as the Undo button |
| **Hint** | Rewarded stub → highlight a safe next arrow |
| **Retry** | Restart level (interstitial stub) |
| **Daily Challenge** | One PKT (Asia/Karachi) level per day — isolated from campaign progress |
| **Share** | Win overlay → share / copy clear text |

Clear all arrows to win. Other arrows and cross-hatched walls block movement; a blocked arrow stops in the last free cell and can move again after its path clears. A tap on a fully blocked arrow does not count as a move.

In compact landscape, the HUD and 44px action controls sit beside the board. With at least **480 CSS px of usable width** and **308px of safe-area-adjusted height** (for example, a 568×320 viewport with default insets), Level 50's 7×7 cell targets are **44×44 CSS px**. On narrower, shorter, or safe-area-constrained screens, the board and its non-overlapping targets scale together rather than extending hit areas across neighboring cells or introducing page scroll. Keyboard users can move with the arrow keys, use Home/End within a row or Ctrl+Home/Ctrl+End for the corners, move a selected arrow with Enter or Space, and Tab from the grid to the game controls.

In portrait, **320×568** uses safe-area-aware **5px minimum side gutters** to keep Level 50 cells at **44×44 CSS px**; **360×640** measures **48×48 px**. Play-screen HUD icons and action controls are at least **44×44 px**. Below 320px usable width, or when safe-area insets constrain the board, cells scale down without overlapping neighboring targets; keyboard navigation and firing remain available.

## Project layout

```
src/game/     engine, levels loader, persist, types
src/ads/      interstitial / rewarded / remove-ads stubs
src/ui/       canvas renderer, accessible board/dialogs, and PWA update notice
public/       levels.json (50), icons, manifest
tests/        vitest engine + ads + accessibility + update-policy regressions
scripts/      axe scan + service-worker update browser regressions
```

## Scope (v0.1 MVP)

- 50 JSON levels (neon metro theme)
- Walls on later levels
- Ads + remove-ads **hooks only** (no real AdMob/IAP SDK)
- PWA offline after first load

## Docs

- [PRODUCT.md](./PRODUCT.md) — product summary
- [STATUS.md](./STATUS.md) — build status
- [CHANGELOG.md](./CHANGELOG.md)
- [GUIDE-roman-urdu.md](./GUIDE-roman-urdu.md) — install & play (Roman Urdu)
- PRD: `/workspace/factory/research/PRD-arrowpath.md`

## License / IP

Original **neon metro** puzzle IP. **Not** affiliated with Arrows Puzzle Escape, Easybrain Arrow Puzzle, or any commercial arrow-path title. No competitor assets or branding.
