# P1-screens report (committed 2026-10-17) — for P2 integration

## Landed
- NEW service/screens.ts — §A registry: readScreens (silent normalize, missing/bad → {version:1,screens:[]}), writeScreens (validate→ScreensError→400), hasScreensFile, normalizeScreens/normalizeScreenEntry (drop-bad, dedupe first-wins, clamp 200–8192 HERE; viewer-ui's 100–8192 untouched), resolveScreenFile (relative .html case-insensitive, no ../absolute/drive, backslash→/ cross-platform, containment-checked), screenUrl (decision 6 verbatim), CanvasMode type.
- NEW service/workspace-root.ts — resolveWorkspaceRoot(env): DS_WORKSPACE_ROOT → win32 %ONEDRIVE%\Documents → %USERPROFILE%\Documents → homedir/Documents (existence probe, homedir fallback); POSIX homedir/Documents; candidateWorkspaceRoots (testable), isInsideOrEqual (lexical, sibling-safe). Panel never builds the path.
- NEW service/last-workspace.ts — §B in-memory echo {dir, screens, mode, activeScreen}; separate module so browser-control can import it without a main.ts cycle.
- service/main.ts — new routes (shapes below); [design-studio]→[design-canvas] in the 2 log prefixes only.
- service/scaffold.ts — §E: home.html (hero/brief logic moved; includes app.js), index.html meta-refresh → ./home.html (dev script untouched), app.js baked-DS_SCREENS nav snippet (agent must sync screens.json + app.js array), screens.json seed, .design-studio.json pagesRoot:'.', writeHarnessPlugin call REMOVED (decision 5; import kept dead w/ comment), scaffold confinement: NEW dir only inside workspace root (injectable workspaceRoot for tests), existing dirs anywhere; P0 npm.cmd branch untouched.
- Tests: scaffold.test.ts 10/10, studio-config.test.ts 6/6, service.test.ts 26/26 (5 spawn tests run the TS entry via Node type-stripping — MUST re-verify after P2 bundle rebuild).

## Route contract (panel codes against this)
- GET /screens?dir= → 200 {version,screens:[{id,file,title,width,height}]} normalized; missing→{version:1,screens:[]}; non-abs dir→400.
- PUT /screens?dir= body {version?,screens[]} → 200 {path:"screens.json"} (clamped/deduped/normalized) / 400 {error names entry index}.
- GET /workspaces → 200 {root, workspaces:[{dir,name,url?,screens?}]} sorted by name; children with .design-studio.json only; missing root → {root,workspaces:[]} never error.
- POST /open {dir, screen?} — config url authoritative; no config → 200 {ok:false,error:"no .design-studio.json url found"}; dead loopback → {ok:false,error}; screen unknown → 400 "unknown screen id"; no screens → falls back to config-url open; with screens → openWorkspace+setActive → 200 {ok:true,started,...BrowserState(mode/screens/activeScreen/dir)}. {url} path byte-for-byte old behavior.
- POST /mode {mode:'edit'|'play'} → 200 {ok,mode} (browser.setMode push + echo; no browser = warm no-op) / 400 / 405.
- GET /state passthrough unchanged.

## P2 reconciliation list (verbatim from agent)
1. Delete asCanvas/CanvasBrowser shim in main.ts; call real Browser.openWorkspace/setMode/setActive (P1-browser's landed signature: openWorkspace(cfg:{dir?,screens,baseUrl,mode?}) — structurally compatible).
2. Decide: pass dir into openWorkspace cfg? (BrowserState.dir null otherwise; last-workspace holds it.)
3. npm run build so compiled service/main.js carries new routes; re-run new-route spawn tests against bundle after.
4. Wire browser-control.ts dir fallback to getLastWorkspace().
5. Port bands: screens spawn tests use 64000–65399 (above other suites' bands, below 65536).
6. Spec-silent follow-ups: non-'.' pagesRoot honoring; Screens section in scaffolded DESIGN.md.

Deviation noted (accepted): /open workspace flow auto-starts dev server only for loopback config URLs (non-loopback workspace must not hit ensureDevServer host guard).
