# Fork spec — "Design Canvas": a project-free, multi-screen canvas for OpenChamber

Fork of `openchamber-design-studio` (branch `canvas-fork`). Goal: behave like Claude's design tool inside OpenChamber —
any chat can start a design without registering a project; one scrollable/zoomable canvas shows MULTIPLE screens as
artboards; edit mode picks elements into the chat; play mode makes click-throughs work.

## Product decisions (locked)

| # | Decision |
|---|----------|
| 1 | Identity: extension id `design-canvas`, name **Design Canvas**, command `/canvas`, statusSection title "Canvas", `providerId: 'design-canvas'` everywhere (panel/mode.ts:279,299,425; panel/attach-dialog.ts:25; panel/main.ts:575). Both extensions can coexist with the original. |
| 2 | **No project dependence.** `statusSection.requiresProject` → false. All registered-project gates are replaced by a workspace model (D3). `host.startSession` is called WITHOUT `projectId`. Design-work list scans workspaces on disk (below), not `host.listSessions(projectId)`. |
| 3 | **Workspace model.** Design files live under `~/Documents/Design Canvas/<slug>` (override: env `DS_WORKSPACE_ROOT`). Never scaffold into OpenChamber's chats folder. Each design session keeps its workspace dir in panel host storage: `ws/<sessionId>` = `{dir, name}` (panel/main.ts storage helpers next to mode/<id> keys at main.ts:388-422). Slug: kebab of the brief/title + short session id, sanitized. |
| 4 | **Harness via chips, not plugins.** Drop `.opencode/plugin` writes for fork v1 (plugin discovery is project-scoped; canvas sessions aren't in the workspace dir). `buildModeChip` text (panel/mode.ts:410-435) must embed `harnessRulesText()` (shared/harness-text.ts:171-190) + the screens list; rewrite `DESIGN_WORKSPACE_NOTE` to describe the canvas workspace instead. |
| 5 | **Screens are real HTML pages.** A workspace is a Vite multi-page app (dev server per workspace, same port machinery). A screen = `{id, file, title, width, height}`. New `screens.json` at workspace root is the registry; the agent adds a screen by writing `<file>.html` + updating `screens.json`; each screen URL = `<config.url><file>`. Inter-screen links are plain `<a href="other.html">` (work in play mode). |
| 6 | **Canvas = real Chrome window, N artboards.** Extend the existing viewer shell (service/viewer-ui.ts + viewer-client/src/canvas-controller.js): one `#camera` containing N `<section data-screen><header…><iframe data-ds-screen=ID></section>` artboards laid out in an auto grid, each scaled like today, whole camera pannable/zoomable (wheel/Ctrl+wheel/space/H/arrows all already exist in canvas-controller.js:89-146). Fit-all button + per-screen focus/zoom. |
| 7 | **Modes.** `edit` (default when Design Mode on): iframes get `pointer-events:none`; per-artboard header shows title+size; a Ctrl/Cmd-click (or plain click in edit) on an artboard picks the element under the point → existing pick→`host.attach` chip path (panel/main.ts:3066-3086,829-836). `play`: pointer-events auto, headers dim; clicks and in-app links drive the screen itself; a screen navigating updates its artboard (reuse `changed` event, browser.ts:1063-1082,1256-1268). |
| 8 | **Windows-first runtime** (user is on Win11): fix every POSIX-only process/path assumption (Phase 0 list below). `DS_CHROME_PATH` auto-detected; env override kept. |
| 9 | Verify gates per screen: deferred to integration phase; fork v1 keeps single-active-screen verify via `browser.getProbe(screen?)`. |
| 10 | Out of scope v1: connectors/flow arrows between artboards, mini-chat bridge, VSCode/mobile, per-screen verify history. |

## Architecture contracts

### A. `screens.json` schema (new, at workspace root)
```json
{ "version": 1,
  "screens": [ { "id": "home", "file": "home.html", "title": "Home",
                 "width": 1280, "height": 800 } ] }
```
- `id`: `^[a-z0-9][a-z0-9-]{0,30}$`, unique. `file`: relative path, `.html`, inside the workspace root (no `..`). width/height: 200–8192, default 1280×800 (reuse viewer-ui viewport clamp).
- Read API normalizes silently (bad entries dropped, ids deduped); at least one valid screen required else `[]`.
- Seed on scaffold: `home.html` + registry entry `{id:"home",file:"home.html",title:"Home",1280,800}`.

### B. New/changed service HTTP (service/main.ts route table; bearer auth unchanged)
| Route | Shape |
|---|---|
| `GET /screens?dir=` | → `{config:{version,screens}}` normalized, `200` (missing file → `{version:1,screens:[]}`) |
| `PUT /screens?dir=` | body = full `{version,screens}` JSON → validates + writes, `200 {path}` / `400 {error}` |
| `GET /workspaces` | → `{root, workspaces:[{dir,name,screens?,url?}]}` — lists `DS_WORKSPACE_ROOT` children that contain `.design-studio.json` (read via studio-config resolver). Powers the page list without projects. |
| `POST /open` | extended: `{url, dir?}` → also accepts `{dir, screen?}`; resolves screens+config from dir, opens/refreshes canvas shell with ALL screens; `screen` id selects the active/focused one. Response adds `{screens}`. |
| `POST /mode` | `{mode:'edit'|'play'}` → shell-wide mode, echoed in `/state`. |
| `GET /state` | extends BrowserState: `{…, mode, screens:[{id,title,url,active}], activeScreen}`. |

### C. Shell config + `window.__dsCanvas.*` bridge (the ONLY shared surface between the shell rebuild and browser.ts — both sides code against this)
Viewer config (viewer-server capability URL) becomes:
```js
{ screens: [{id,url,width,height,title}], viewport: {width,height}, mode: 'edit' }
```
Controller API (canvas-controller.js keeps old names where semantics survive):
- `setScreens(screens)` — full replacement; lays out the artboard grid (CSS grid, gap 48px, order = array order; artboard width = its own width × current camera scale).
- `setActive(id)` / `getActive()`.
- `setMode('edit'|'play')` — toggles `[data-mode]` on `#canvas` (CSS: `#canvas[data-mode=edit] iframe {pointer-events:none}` etc), updates headers.
- `fitAll()`, `focusScreen(id)` (zoom camera to a screen), `zoomToScreen(id)` alias.
- keep: `setViewport, setLayout, setStatus, zoomCamera, getCamera, restoreCamera, dismissMenu, handleCanvasInput, begin/normalize/endCapture` — capture now operates on the ACTIVE screen's iframe (beginCapture takes optional screen id).
- Send-to-service (via `__dsCanvasSend` binding): `{type:'ready'}`, `{type:'viewport'|'page'|'retry'|'layout'|'fit-size', …}` unchanged; NEW: `{type:'screen-pick', screen, x, y}` (click in edit mode; x/y = CSS px inside that frame, computed from scaled rect like browser.ts:1072-1079), `{type:'screen-activate', screen}` (header click / double-click on frame).
- Shell DOM: each artboard = `<section class="ds-artboard" data-screen=ID>` with `<button class="ds-ab-title">` + `<span class="ds-ab-size">` + `<iframe id="ds-frame-<ID>" data-ds-screen=ID name="__dsArtifact:<ID>" referrerpolicy="no-referrer">`. Frame names carry the screen id (replaces the single `__dsArtifact` gate).

### D. Multi-frame authority (service/artifact-context.ts + browser.ts)
- `ArtifactContexts`: replace single `artifactFrame`/`artifact()` with `artifacts(): Map<screenId, DefaultContext>` populated by discovering every child frame whose owner element has `data-ds-screen` (generalize discover() loop at artifact-context.ts:107-117 — it currently returns after first `id==='preview'` match). `artifact(id?)` → active or named. Trust gate for injected scripts: frame name prefix `__dsArtifact:` OR per-frame id match (replace browser.ts:771-777 single-name gate; PICK_SCRIPT installs in every frame already — browser.ts:659-687).
- Pick path: `__dsPick` binding → accept from ANY trusted artifact context; map `executionContextId → screenId` (Map like browser.ts:1059-1061 check generalized). `lastPick` gains `screen`. Shell-side picks (edit mode) arrive as `{type:'screen-pick',screen,x,y}` → run `__dsPickAt(x,y)` in THAT frame's context.
- `input(action)` / `capture` / `highlight` / `getProbe` / navigate: gain optional leading `screen` param (default active). Navigate per screen: `Page.navigate` on that frame's session (generalize browser.ts:1312-1321).
- `refreshArtifact` generalized to per-screen URL/title tracking; `changed` events tagged by context→screen.
- browser-control.ts: every action handler accepts optional `screen`; `dir` fallback = the last-opened workspace the service recorded (service keeps `state.dir` after /open) when host `context.directory` doesn't contain a config (browser-control.ts:126-130).

### E. Scaffold changes (service/scaffold.ts)
- Multi-page Vite skeleton: `home.html` (+ per-type extra pages optional: keep ONE seed page v1), `tokens.css`, `styles.css`, shared `app.js` nav snippet; `.design-studio.json` gains `pagesRoot: "."`; write `screens.json` (A). `command` stays `npm run dev`.
- Config resolver (service/studio-config.ts): add `screens.json` reader/writer module `service/screens.ts` here.
- No harness-plugin write (D4): skip `writeHarnessPlugin` call at scaffold.ts:499-505 behind fork flag; keep module dead for future.

### F. Panel changes (panel/*)
- Replace project gates: `resolveDesignTarget` → `resolveCanvasTarget` (pure, panel/api.ts:490-522): target = current session workspace if `ws/<sessionId>` exists (kind `workspace`), else `new` (brief required → create slug → mkdir → scaffold → store `ws/` key). Delete NEEDS_PROJECT refusals at main.ts:523-528,739,794; `projectReady` → `wsReady = Boolean(config?.url)`.
- `/canvas on`: ensure workspace (scaffold via `/scaffold`), `POST /open {dir}` (all screens), mode ON chip = `buildModeChip` (now includes rulebook + screens), focus row polls `/state` for mode/screens/active/picks unchanged.
- `/canvas play` / `/canvas edit`: `POST /mode` shortcut (nice-to-have; also a toggle on the row).
- Row (surface 'status'): Start/Stop + edit/play toggle + active screen dropdown (from /state.screens) + Focus. Hidden gates on NO_PROJECT_CONFIG_MESSAGE now: never hide — Start creates the workspace on first use.
- Page: creation home keeps type/direction/fidelity/brief + design-system picker; "Your design work" list = `GET /workspaces` rows (open = focus existing chat if `ws/<sessionId>` match, else open a new session with brief text).
- Pick chip payload (panel/attach-dialog.ts): include `Screen: <id>` line + the screen url.
- Keep dead files dead (panel/compose.ts, settings.ts, tokens.ts unused).

### G. Windows portability (Phase 0 — before D/E work)
| Fix | Where |
|---|---|
| Chrome default: `DS_CHROME_PATH` → probe `C:\Program Files\Google\Chrome\Application\chrome.exe`, `(x86)`, `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`; posix defaults unchanged | browser.ts:28-29 |
| Orphan reaper: `ps -ax` → `tasklist /FO CSV /FI "IMAGENAME eq chrome.exe"` + parse `--user-data-dir=ds-chrome-` in wmic-less way: enumerate via `Get-CimInstance` powershell fallback; skip reaping gracefully if unavailable | browser.ts:816-858 |
| Dev-server identity/stop: POSIX pgid+`ps lstart` → on win32 record `{pid, port, cmdish}` and stop via `taskkill /PID <pid> /T /F` gated on port-owner check (`Get-NetTCPConnection -LocalPort`) ; never kill unverified pid | project-server.ts:258-311, 278-300, 333-393 |
| `spawn('npm', {shell:false})` on win32 → `spawn(process.env.ComSpec?\u0022npm.cmd\u0022)` with shell:false, or shell:true | scaffold.ts:544 |
| `process.env.TMPDIR ?? '/tmp'` → `os.tmpdir()` | scripts/build-viewer.mjs:14 |
| `node --test 'tests/*.test.ts'` single-quote glob breaks under cmd → `node --test --test-concurrency=1 tests` (dir arg; Node 24 type-stripping finds *.test.ts) | package.json test script |
| SIGTERM handler no-op note; host kill is fine | main.ts:596-613 (leave) |
| Keep DS_CHROME_PATH env respected (already set in user's env) | done |

### H. Copy/branding
README.md, docs/, tests/manifest.test.ts (pins ids/copy — update expectations), statusSection title, page title, command description. Version → `0.2.0`.

## Phase plan & agent assignment (Alibaba models per AGENTS.md)

| Phase | Scope | Files (ownership: only these agents touch these in this phase) | Model |
|---|---|---|---|
| **P0 Windows** | G | service/browser.ts (reaper/chrome-path only), service/project-server.ts, service/scaffold.ts (spawn line), scripts/build-viewer.mjs, package.json (test script) | deepseek-v4-pro-0813#max |
| **P0.5 Spec audit** | critique this spec vs code, list contradictions | read-only | qwen3.8-flash#xhigh |
| P1 panel | F, H(panel bits) | package.json manifest+contributes, panel/*.ts, tests/manifest+panel-open+mode-open | deepseek-v4-pro-0813#max |
| P1 screens+scaffold | A, B (routes), E | service/screens.ts (new), service/main.ts, service/studio-config.ts, service/scaffold.ts, tests/scaffold+service | deepseek-v4-pro-0813#max |
| P1 shell | C | service/viewer-ui.ts, service/viewer-server.ts (config type), viewer-client/src/*, tests/stock-controller | qwen3.8-flash#xhigh |
| P1 browser | D | service/browser.ts, service/artifact-context.ts, service/browser-control.ts, tests/live-canvas+canvas-zoom+nova-canvas | qwen3.8-flash#xhigh |
| P2 integration | build+typecheck+tests green; per-screen verify (D9); cross-phase fixes | anything | deepseek-v4-pro#max |
| P3 review | adversarial code review vs this spec; findings→fix list; apply approved fixes | anything | qwen3.8-flash#xhigh (review) |
| P4 smoke | real Chrome on Windows via installed extension; screenshots of canvas with 2 screens, edit pick, play click-through | — | flash agent + orchestrator browser tools |
| P5 ship | commit on canvas-fork, install path handoff to user | — | orchestrator |

Rules for all agents:
1. Work in `C:\Users\samhe\Documents\github\openchamber-design-studio` on branch `canvas-fork`. `npm install` first if node_modules missing.
2. Only edit files in your assigned scope; if a change outside it is REQUIRED, leave a `FORK-MERGE:` comment line at the site and report it.
3. Source of truth is the `.ts`/`.js` sources; ALWAYS rerun `npm run build` (and `npm run build:viewer` when shell touched) and keep bundles in sync — the host loads built files.
4. Run `npm run typecheck` + `npm run test` where your scope allows; report failures honestly.
5. No new npm dependencies without noting it in the report (viewer build needs Tailwind CLI already present).

## Acceptance (what "done" looks like)
1. Original `design-studio` and fork `design-canvas` both installed, no rail/command clashes; `/canvas` works in THIS scratch chat with no project registered.
2. First `/canvas <brief>` creates `~/Documents/Design Canvas/<slug>`, scaffolds, starts dev server, opens a Chrome canvas window with 1 artboard; agent adds a second screen (file + screens.json) → artboard appears (row refresh or re-/open).
3. Canvas: wheel-drag pans both axes, Ctrl+wheel zooms, Fit-all frames every artboard, header shows title + device size, double-click an artboard = zoom to ~100%.
4. Edit mode: click element in artboard → chip appears in THIS chat's composer with selector/styles + screen id. Play mode: buttons/links inside screens work, navigation stays inside its artboard frame, URL/title of that artboard updates.
5. Everything survives OpenChamber restart: mode chips, workspace list, reopening canvas (`/canvas on` in the same chat reopens, no re-scaffold).
6. `npm run check` green on Windows.
