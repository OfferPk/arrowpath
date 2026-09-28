# ArrowPath — Product

| Field | Value |
|-------|--------|
| Name | ArrowPath |
| Slug | arrowpath |
| Project ID | proj_arrowpath_001 |
| Genre | Hybridcasual arrow / path-clear puzzle |
| Theme | Neon metro (original) |
| Platforms | Mobile web PWA (P0) |
| Monetization v0.1 | Free + ad/remove-ads **stubs** |
| PRD | `/workspace/factory/research/PRD-arrowpath.md` |

## One-liner

Offline arrow path-clear puzzle — tap neon transit arrows to fly off the grid without collisions.

## MVP scope

1. Rectangular grid: empty \| wall \| arrow(N/E/S/W)  
2. **50** JSON levels, progressive difficulty  
3. Tap to fire; collision/wall = fail; clear all = win  
4. Undo (3 free / level) + rewarded stub for extra undo/hint  
5. Level select + localStorage unlock  
6. PWA (manifest + SW)  
7. Ads stubs: `showInterstitial`, `showRewarded`, `isAdsRemoved`, `purchaseRemoveAds`  
8. README + GUIDE-roman-urdu + STATUS

## Non-goals

TubeSort; GlowGrid polyomino clear; WordHunt; real AdMob/IAP; online leaderboards; level editor UI.
