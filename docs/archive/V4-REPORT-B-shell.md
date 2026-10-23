# V4-B report (shell) — 2026-10-17

## Landed (viewer-client/**, service/viewer-ui.ts, assets via build:viewer only; viewer-server/CSP untouched; controller self-contained verified 0 fetch/XHR/WS/localStorage)
- V4-1B: viewport presets/selectPreset/choosePreset/"Fit width" DELETED; zoom menu = Fit all/50/100/200/Zoom-to-selection; setLayout/getFitBounds/setViewport remain for service compat but NO toolbar path reaches them; shell emits no layout/fit-size/viewport (pinned); #layout-reason deleted.
- V4-4B: setNotice({id,kind,text}) stacked banners (≤3, 300 clamp, textContent-only, empty removes, snapshot notices[]) + data-new 1200ms ring pulse on new artboard ids (never boot bake/first open).
- V4-5B: showToast pill 2000ms newest-replaces + copy:true clipboard attempt swallowed; shift-click pick → additive:true.
- V4-6B: edit-mode hover emitter — rAF-coalesced screen-hover{screen,x,y} unscaled via shared framePoint, ≥3px/screen-change only, screen-hover-end once; suppressed during drag/capture/menu/rename/agentInput/play. Local outline = service job.
- V4-7B: setAgentInput(on) → data-agent-input presence attr; suppresses canvas pointer/wheel/key/handleCanvasInput + camera-changed emission; revealScreen(id) minimum pan no zoom, echo-suppressed, hand-back re-emits.
- V4-9B: dot grid oklch(0.17) radial 1px/24px·scale, position=camera translate, hidden <0.3; shadows 0 1px 2px/.4 + 0 12px 32px/.35; inactive outline removed; active 2px #4f8cff; hover 1px rgba(79,140,255,.6); headers plain 13px/500 @85% + 12px tabular-nums, counter-scaled via --cam-scale on #camera (paint), origins bottom-left/-right, max-width calc(--w * --cam-scale); FIT-ALL DEFAULT on open (view.mode fit-all; legacy saved fit still restores); toolbar order Palette·name(24ch)·Edit/Play·chips(Screens▾>4)·spacer·agent chip·− N%▾+·Fit-all·Pan·status·Retry.
- V4-10B: right-click/⋯ menu (fixed-coord body-level popover, role=menu, keyboard nav, ESC/Tab/outside dismiss focus-return): Send-to-chat/Zoom(local)/Reload/Reset-position/Export PNG/Export PDF/Copy path/Rename… → screen-menu{screen,action} six frozen actions; copy-path expects showToast(copy:true).
- V4-12B: setAgentStatus chip "Designing…"+pulse dot; busy→idle + frame-load sighting → "Updated" toast (idle-without-reload silent).
- V4-15B: beginCapture cancels boardDrag(E18)/pan/menu/hover + hides status band + toast pill (no shell chrome in exports); modePending 1500ms revert + "Mode change refused" toast.
- V4-17B (P2, landed): inline rename input → screen-rename{screen,title≤120}; double-click→rename DELIBERATELY SKIPPED (keeps focus acceptance).
- V4-13B: none by spec.

## Camera math: ONLY two deviations from fixture (integrator KEEP both): seam-4 py --s7 fix + V4-9 fit-all Δ-term (fit-all default made pre-zoom Y base scale-dependent; old pin caught ~3px drift). getFitBounds/zoomCamera/cameraShortcut + 1-screen non-anchor ops still byte-identical (green). Fixture NOT updated; deviations content-asserted + new two-screen fit-all anchoring regression.

## Tests: stock-controller 30/30 (+10), viewer-ui 22/22 (+2 incl V4-9 exact-CSS block + preset-removal negatives), canvas-zoom-routing 7/7 unchanged. typecheck:viewer 0.

## FORK-MERGE (for A/C/D/integrator)
1. A: shell emits NO layout/fit-size/viewport; __dsToolbarBridge.selectPreset GONE (probe1/2 selectPreset patterns die with V4-1 svc). setLayout/setViewport still answer restore/verify. tests/fit-page-browser.test.ts still pins preset machinery — update with V4-1 svc.
2. A: §3 inbound names verbatim; screen-hover/menu/rename/pick.additive ready; menu reload → service maps to retry; reset-position/exports map accordingly.
3. A/C: busy→idle "Updated" toast = shell sync-pulse; panel still POST /screens/sync on completed (V4-4 backstop).
4. D: smoke preset/fit interactions must follow V4-1 (no presets; plain-text headers for pixel checks).
5. Workspace name slot: #workspace-name renders setPage({title}) currentTitle (fallback "Design Canvas") — A can push folder name via setPage on /open, no shell change.
6. INTEGRATOR: rebuild build:viewer ONCE after all lanes land — css digest provisional (Tailwind auto-content scans whole project; other lanes mid-write). Final B digest pre-integration: inputDigest 756a60ac…, js af549e… 482,609B, file sha 11f43883… ×2 identical.
