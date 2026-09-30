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
npm run test:a11y # axe browser scan; requires Chromium (or set CHROMIUM_PATH)
npm run build     # tsc + vite build → dist/
npm run preview   # serve production build at /arrowpath/
```

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
| **Tap arrow** | Fire it in its facing direction |
| **Undo** | 3 free undos per level; then rewarded stub for extra |
| **Hint** | Rewarded stub → highlight a safe next arrow |
| **Retry** | Restart level (interstitial stub) |
| **Daily Challenge** | One PKT (Asia/Karachi) level per day — isolated from campaign progress |
| **Share** | Win overlay → share / copy clear text |

Clear all arrows to win. Hitting another arrow or a wall fails the try.

## Project layout

```
src/game/     engine, levels loader, persist, types
src/ads/      interstitial / rewarded / remove-ads stubs
src/ui/       canvas renderer + accessible board and dialog behavior
public/       levels.json (50), icons, manifest
tests/        vitest engine + ads + accessibility regressions
scripts/      browser-based axe accessibility scan
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
