# P2-B report (shell) — 2026-10-17

## Landed
- canvas-controller.js: D6 drag (pointerdown on .ds-ab-title, scale bound at pointerdown per D14 risk5, live in-memory move, screen-move on pointerup) + auto-grid flow + D7-A headers (N · Title / W×H) + camera-changed (debounced 400ms after last paint; restoreCamera sets suppress-echo guard) + setScreens x/y (number|null; null=auto; absent on existing=INHERIT live position — race tolerance; one-sided/junk refuses whole list) + setMode REAL bool (false under captureState/unknown) + seams 3/4/5 fixed.
- canvas-controller.d.ts: CanvasScreenConfig x?,y? (number|null).
- viewer-ui.ts: ViewerScreen x/y validate+clamp ±32768, flowLayout (replaces sqrt-grid; byte-mirrors controller), header bake, x/y allowlisted into bake config.
- viewer-assets.generated.ts rebuilt via build:viewer; deterministic across 3 runs (digest 553acbc9… / js 0d165aa6… / css aecb7c93…).
- canvas-zoom-routing untouched (seam 4 was controller-side).

## Outbound (verbatim)
ready | page{id,screen} | retry{screen?} | layout{mode,preset,screen} | fit-size{screen} | screen-pick{screen,x,y} | screen-activate{screen} | mode-request{mode} | NEW screen-move{screen,x,y} | NEW camera-changed{camera:{mode:'fit'|'manual'|'fit-all',scale,panX,panY}}.
getCamera() now includes mode 'fit-all' + gridWidth/gridHeight.

## Auto-grid rule (binding, test-pinned)
positioned keep exact cell; unpositioned flow array-order from (0,0): wrap when cursorX>0 && cursorX+w>3200 → (0, rowBottom+48); cursorX+=w+48. AUTO SLOTS COMPUTED AS IF NO POSITIONED EXISTED (auto subsequence flows from origin; overlaps with positioned allowed — user intent wins). bbox min/max all rects; negative legal; extent clamp 64–65536. Append never shifts earlier autos; reflow autos only; positioned never move.

## Seam-4 root cause (for the record)
paint() uses translate(x, 48+panY) scale(s) (Y base = --s7 token; X base = centered). Inherited zoomTo anchored Y as centered (py = point.y − box.height/2) — correct for X only → every anchored zoom overshot Y by (box.height/2 − 48)·(s′/s − 1) px (≈40px dev window; first wheel-zoom after load = fit-mode boot pan0 = exactly that). Fix: py = point.y − numToken('--s7'). Protected by line-diff pin (fixture vs shipped zoomTo differ in EXACTLY one line); 1-screen non-anchor camera ops still byte-identical.

## Tests: viewer-ui 21/21 (+1), stock-controller 20/20 (+7: anchor symmetry, drag/scale-binding/screen-move, auto-grid determinism+append-stability, camera-debounce/dedupe/restore-echo, seam-3 src-sync, seam-5 msg preservation, honest bools), canvas-zoom-routing 7/7. Typecheck exit 0.

## FORK-MERGE → P2-A (must-have, restate)
1. merge view.json positions into BOTH cold-bake openWorkspace screens AND warm setScreens push as x,y (null=auto; clamp ±32768).
2. canvasCommand handle camera-changed (coalesce 300ms, never echo-suppressed restores) + screen-move → mergeView.
3. R1: shell setMode returns real bool — service false-retry logic can trust it.
4. headers now 'N · Title'/'W×H' — update any copy asserting old titles.

## P2-D must-witness seams
warm setScreens w/ x/y no-duplicate; retry(screen) preserves positions; restore→drag→reopen persists (view-state end-to-end); live smoke first-wheel-zoom + title-drag under Windows Chrome at P4.
