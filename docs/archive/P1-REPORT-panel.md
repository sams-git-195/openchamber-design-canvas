# P1-panel report (committed 2026-10-17) — for P2 integration

## Landed
- package.json: identity only (name openchamber-design-canvas, v0.2.0; panel.id design-canvas; panel.name/page.title "Design Canvas"; command `canvas`; statusSection.title Canvas, requiresProject:false). Scripts byte-identical (P0 glob kept).
- panel/api.ts rewritten to canvas model: §B wrappers getWorkspaces/getScreens/putScreens/setMode/openWorkspace; getState LiveState + mode/screens/activeScreen/lastPickScreen; pure helpers resolveCanvasTarget (no refusal state), canvasSlug/uniqueCanvasSlug/joinWorkspaceDir, normalizeDirPath/sameDirPath/pathContains (separator+drive-case), wsSessionIdFromKey/isWorkspaceRecord/joinWorkspaceSessions/workspaceMeta, canvasSessionStatus, referenceText+PickScreen. REMOVED: resolveDesignTarget, projectRows, designChat*, designWorkRows, modeSessionIdFromKey, designSessionStatus, NO_PROJECT_CONFIG_MESSAGE, NEEDS_PROJECT_MESSAGE, decideProjectOpen, isDesignWorkspaceDir. KEPT for other lanes: shouldStopDevServer, countOtherActiveDesignSessions, sessionShowsDesignMode, openLive (legacy).
- panel/mode.ts: providerId design-canvas ×3 sites; parseDesignArgs +play/edit; DesignMode.canvMode; workspaceStorageKey ws/<id>; buildModeChip per decision 4 + chip budget (mode→path+protocol→screens≤40→IDENTITY+AUTHORITY+VERIFY_PROTOCOL, 16k cap); designSessionPrompt(spec, workspace) with absolute-path rule + full craft rulebook; workspaceOpenPrompt; workspacePathRule.
- panel/main.ts per §F: ensureCanvasWorkspace (GET /workspaces→unique slug→POST /scaffold into SERVICE-provided root; never self-constructs), ws/ storage, resolveCanvasCommand, openCanvasWindow (POST /open {dir}), startDesignSession without projectId (4c opt-in passes projectId when registered project matches — pinned), first-run permission toast (one-time), workspaces list = /workspaces + one-pass ws/ cache, row: Start=create-canvas-first-use + play/edit toggle + active-screen dropdown + Focus, ensureHarness call dropped, 2 FORK-MERGE comments (new row controls need panel/styles.css pass).
- panel/attach-dialog.ts: providerId + PickScreen param → "Screen:"/"Screen URL:" text + data.screen/screenUrl.
- shared/harness-text.ts: ONLY DESIGN_WORKSPACE_NOTE rewritten (absolute-path discipline, screens.json protocol, index redirect). Other exports untouched.
- README.md: fork README (parity table, no-project, OS matrix, disable-original note, first-run permission note). docs/FORK-CHANGELOG.md created.

## Tests (own): manifest 5/5, mode 26/26, attach-dialog 3/3, mode-open 34/34, panel-open 55/55, adversarial/design-work-omit 9/9 — 132/132. Typecheck: own files 0 errors.

## Deviations from spec (P2 must ratify or correct)
1. Active-screen dropdown → POST /open {dir, screen} (no dedicated setActive route in §B); P2 confirm service maps screen→setActive warm (screens agent's /open DOES accept screen — compatible).
2. /state pick-screen field named `lastPickScreen?: string` on LiveState — P2 confirm/rename vs P1-browser's actual field.
3. GET /workspaces rows `screens?: ScreenInfo[]` typed leniently.
4. /canvas <brief> does NOT start a second session (chip lands in same chat).
5. openLive(url,dir?) kept dead-but-legacy — P2 delete-or-keep.

## P2 reconciliation — exact panel-side contracts
GET /workspaces→{root,workspaces:[{dir,name,url?,screens?}]} · POST /scaffold{dir,type,direction?,fidelity?,brief?,designSystemId?}→{ok,url,files}|{ok:false,error} · GET /screens?dir=→{version,screens:[{id,file,title,width,height}]} · PUT /screens?dir= full registry →{path} · POST /mode{mode}→{ok,mode?,error?} · POST /open{dir,screen?}→{ok,url,title,settled,started?,error?} · GET /state→LiveState+{mode,screens:[{id,title,url,width,height,active}],activeScreen,lastPickScreen}.

## External tests drifting (P2 update list)
server-stop (clickServerControl create-first-use), status-height, root-workspace-breaker ×2, reference-breaker ×2, live-canvas-breaker + ViewerConfig screens/mode pair (P1-shell/browser in-flight), harness-plugin.test.ts runtime pins of OLD DESIGN_WORKSPACE_NOTE (fail by design — spec mandated reword), provider (service-side).

## FORK-MERGE
panel/styles.css pass for ds-play-toggle / ds-screen-select / ds-focus row controls (reuses existing classes, unstyled new ones).
