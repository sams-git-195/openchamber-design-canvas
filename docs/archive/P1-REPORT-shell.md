# P1-shell report (committed 2026-10-17) — for P2 integration

## Landed
- service/viewer-ui.ts: ViewerConfig={screens:[{id,url,width,height,title}],viewport,mode}; CANVAS_MARKUP = N ds-artboard sections baked at launch; validation + escaping (escapeText/escapeAttribute/inlineJson); CANVAS_GEOMETRY grid/mode/overlay CSS.
- viewer-client/src/canvas-controller.js: full rewrite to N-artboard grid (self-contained, .toString()-serialized); +canvas-controller.d.ts legacy optional.
- toolbar-types.ts/Toolbar.tsx: ToolbarState+screens/active/mode, zoomMode 'fit-all'; bridge +setMode/activateScreen/fitAll/focusScreen; Edit/Play segmented toggle, screen-chip row, Fit-all; branding "Design Canvas".
- service/viewer-assets.generated.ts rebuilt (npm run build:viewer only) — stable digest c2bfb5ad across two runs.
- NOT touched: viewer-server.ts (CSP/frame-src unchanged, 2 hash-scoped scripts), main.tsx, index.css.

## __dsCanvas surface (as shipped)
setScreens/setMode/setActive/getActive/getMode/setScreenState(id,{state,message?})/fitAll/focusScreen/zoomToScreen(alias)/getScreens()→[{id,url,width,height,title,state,message,src}] + retained setViewport/setLayout/getFitBounds/setStatus/setPage/beginCapture(screenId?)/normalizeCapture/endCapture/zoomCamera/getCamera/restoreCamera/dismissMenu/handleCanvasInput. All return booleans; transaction/publish pattern kept. beginCapture THROWS on zero screens (service = report error).

## Deliberate deviation (P2 ratify)
getCamera().width/height = ACTIVE-SCREEN size (old single-frame semantics — keeps browser.ts 100-8192 validator + getCamera→restoreCamera round-trip correct). Grid extent in NEW optional gridWidth/gridHeight keys (restoreCamera ignores). 64–65536 camera-extent clamps in setLayout/restoreCamera validators; per-screen 200–8192.

## Message contract
OUT: ready | layout{mode,preset,screen} | page{id,screen} | retry{screen? — omitted when zero screens} | fit-size{screen} | screen-pick{screen,x,y} (CSS px, /scale from artboard rect, int-rounded, clamped; pointerup path, 4px drag threshold, click suppressed by pointerdown preventDefault) | screen-activate{screen} (title click, artboard double-click/double-tap, toolbar chip) | mode-request{mode} (controller does NOT change mode locally).
IN: as API surface; setPage/setViewport/setStatus/zoomCamera/getCamera/restoreCamera/capture trio = ACTIVE screen.
Verified live vs concurrent P1-browser browser.ts: every __dsCanvas.* call they emit exists, arg-shapes match; their canvasCommand handles screen-pick/screen-activate/mode-request (~line 1704); P1-browser ALSO injects in-frame screen-pick emitter (~865, covers play-mode clicks — identical message shape). Seam closed.

## Grid math
cols=ceil(√n) (12 max→2–4 cols), row-major; col width=max screen width in col, row height=max; cell=cumulative+48px gaps; camera view=bounding box clamped 64–65536. Artboards absolute at natural px; scale NEVER in layout math — same pure function server (gridLayout, baked positions) + client (gridBounds). fitAll=clamp(.1–3,min((box.w−48)/gw,(box.h−48)/gh)) centered; focusScreen=cell center→canvas center @1.0. zoomTo/zoomCamera/cameraShortcut/getFitBounds/wheelInput/moveCamera BYTE-IDENTICAL to original fixture (test-proven 1-screen byte-equality).

## Security/validation
id regex both renderer+controller; publicUrl no credentials; ≤12 screens; empty legal; titles ≤120 escaped; sandbox exactly spec'd (no allow-top-navigation); name="__dsArtifact:<id>"; referrerpolicy no-referrer.

## Tests (own): viewer-ui 20/20 (+5 new incl hostile-title escaping, extraction harness re-targets), viewer-server 1/1 (data-screen, no #preview), stock-controller 13/13 (2 BASELINE CRLF failures FIXED — regex now \r?\n; +7 new: adopt-baked/no-reload-diff, grid recompute, fitAll/focus math, edit-pick unscale, double-tap, drag-never-picks, play passthrough, mode-request-vs-push, overlay isolation, capture sibling-hiding, 2-script/CSP new hashes). build:viewer deterministic. Typecheck own 0 errors.

## P2 seams
1. live-canvas-breaker.test.ts:113 still constructs OLD {url,pages} ViewerConfig — unowned in §H; needs {screens,viewport,mode} (boots scratch browser.ts — likely P1-browser or P2 owns; P2 MUST fix).
2. mode-request implemented + browser answers it — no work if kept.
3. Zero-screens retry (no screen field) → service should rescan screens.json.
4. screen-pick dual path (shell pointerup + in-frame click incl play mode) — both same shape.
5. statusState 'empty' = zero screens (toolbar copy).
6. setScreenState messages ≤600 chars sanitized; per-artboard cards never blank siblings (audit #8 satisfied).
