# Fork spec v2 — "Design Canvas": a project-free, multi-screen canvas for OpenChamber

Fork of `openchamber-design-studio` (branch `canvas-fork`). Goal: behave like Claude's design tool inside OpenChamber —
any chat can start a design without registering a project; one scrollable/zoomable canvas shows MULTIPLE screens as
artboards; edit mode picks elements into the chat; play mode makes click-throughs work.

v2 = v1 + the Qwen adversarial audit (20 amendments folded in). Line refs were pinned to commit `0c3c2c7`;
**all agents resolve code by symbol name (function/const), not by line number** — P0 shifts lines in browser.ts /
project-server.ts / scaffold.ts / main.ts as it lands.

## Product decisions (locked)

| # | Decision |
|---|----------|
| 1 | Identity: extension id `design-canvas`, name **Design Canvas**, command `/canvas`, statusSection title "Canvas", page/panel titles. Rename `providerId: 'design-studio'` → `'design-canvas'` at: panel/mode.ts (`projectReferenceChip`, `fileReferenceChip`, `buildModeChip`), panel/attach-dialog.ts (`buildAttachPayload`), panel/main.ts (`startDesignSession` host.startSession call), **service/browser-control.ts (`source:'design-studio'` literal)**, service/main.ts log-prefix strings. Manifest: `panel.id`, `commands[].name`, `statusSection.title`, `page.title`. Version `0.2.0`. **Do NOT rename**: `.design-studio.json` filename, `.design-studio/` state dir, `HARNESS_PLUGIN_*` strings, storage key prefixes `mode/`, `design/`. |
| 2 | **No project dependence.** `statusSection.requiresProject` → false. Registered-project gates replaced by the workspace model (#3). `host.startSession` called WITHOUT `projectId`/`worktree` (contract has no `directory` field — session lands in the chat's own dir; see #4 for how the agent still writes into the workspace). Design-work list = workspaces on disk via `GET /workspaces`, not `host.listSessions(projectId)`. |
| 3 | **Workspace model.** Design files live under `<Documents>/Design Canvas/<slug>` — root probe order: `%ONEDRIVE%\Documents` if it exists → `%USERPROFILE%\Documents` → `os.homedir()/Documents`; env `DS_WORKSPACE_ROOT` overrides. **The service resolves the root and returns it in `GET /workspaces`; the panel NEVER constructs the path itself** — single source of truth. Each session stores `ws/<sessionId>` = `{dir, name}` in panel host storage (next to the mode/ design/ key helpers in panel/main.ts). Slug: kebab of brief/title + short session id, sanitized (`[a-z0-9-]`, ≤40 chars). Never scaffold into OpenChamber's chats folder. |
| 4 | **Agent-cwd strategy (audit #1, critical).** The canvas session runs OUTSIDE the workspace dir. Therefore: (a) `buildModeChip` text and `designSessionPrompt` MUST state the absolute workspace path as "the ONLY place design files are written" and instruct every edit/write/bash call to use that absolute path; (b) the first `/canvas <brief>` flow toasts a one-time heads-up that the agent will ask permission for out-of-folder edits — approve them; (c) documented upgrade path for zero-prompt operation: if the user registers `<root>/Design Canvas` as an OpenChamber project once, `host.startSession({projectId})` puts the chat IN the workspace (keep `pageTarget`-style detection for this case and pass projectId when a matching registered project exists). Acceptance test 7 below proves out-of-cwd writes work. |
| 5 | **Harness via chips, not plugins.** Fork v1 does not write `.opencode/plugin/*` (plugin discovery is project-scoped; canvas sessions aren't in the workspace dir) — skip the `writeHarnessPlugin` call inside `scaffoldProject` (keep module dead for future). `buildModeChip` embeds a TRIMMED ruleset (see chip budget, §F). Rewrite `DESIGN_WORKSPACE_NOTE` (shared/harness-text.ts) to describe the canvas workspace (absolute-path instruction, screens.json protocol). |
| 6 | **Screens are real HTML pages.** Workspace = Vite multi-page app (root `*.html` files work with `vite dev` with zero config — verified). Screen = `{id, file, title, width, height}`; registry `screens.json` at workspace root; agent adds a screen by writing `<file>.html` + updating `screens.json`; screen URL join = `url.replace(/\/+$/,'') + '/' + file`. Inter-screen links are plain `<a href="other.html">`. |
| 7 | **Canvas = real Chrome window, N artboards.** Extend the viewer shell (service/viewer-ui.ts `CANVAS_MARKUP` + viewer-client/src/canvas-controller.js): `#camera` contains N `<section class="ds-artboard" data-screen=ID>` blocks (header + iframe) in a CSS grid (gap 48px, array order); camera keeps its `translate+scale` transform model — **artboards are laid out at NATURAL px inside camera space; scale is transform-only, never baked into sizes**. Panning/zooming all axes comes from the existing camera (wheel/drag/space/H/arrows/Ctrl+wheel). `fitAll()` = min scale that fits the grid bounding box (within existing zoom clamp 0.1–3). |
| 8 | **Modes.** `edit` (default when Design Mode on): iframes `pointer-events:none`; clicking inside an artboard's area sends `{type:'screen-pick',screen,x,y}` → service runs `__dsPickAt(x,y)` in that frame → pick → `host.attach` chip (existing row-poll path). `play`: pointer-events auto; real clicks/links drive the screen; in-frame navigation updates that artboard's recorded URL/title (reuse `changed` flow). Frames carry `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock"` — NO `allow-top-navigation`, so a screen's JS can never navigate/destroy the shell. Residual accepted risk: same-origin screens may rename sibling frames' `window.name` (local dev content). |
| 9 | **Cross-platform runtime** (Windows + macOS + Linux; dev host Win11): every OS-specific behavior is a `process.platform` branch — nothing POSIX-only un-branched, nothing win32-only that breaks darwin/linux; unchanged POSIX paths stay byte-identical. `DS_CHROME_PATH` env wins on all OSes; auto-discovery per OS (§G). |
| 10 | **Coexistence with the original extension**: no ids/commands/rails collide (design-canvas vs design-studio). BUT both manifests declare `service.provides:["browser"]`, and host arbitration between two browser providers is out of our control — v1 guidance: recommend disabling the original in Settings → Extensions while using the canvas (README says so). Port bands 5200–5999 overlap by design; `--strictPort` + random-offset scan makes collisions recoverable. |
| 11 | Verify gates per screen: DEFERRED — `service/verify.ts` + `service/verify-routes.ts` stay v1-compatible (zero-arg call sites keep working against the ACTIVE screen default). Owned by P2. |
| 12 | Out of scope v1: flow-connector arrows between artboards, mini-chat pick bridge, VSCode/mobile, per-screen verify history, per-screen concurrent layout. |

## Architecture contracts

### A. `screens.json` schema (new, workspace root)
```json
{ "version": 1,
  "screens": [ { "id": "home", "file": "home.html", "title": "Home", "width": 1280, "height": 800 } ] }
```
- `id`: `^[a-z0-9][a-z0-9-]{0,30}$`, unique. `file`: relative, ends `.html`, must resolve inside workspace root (no `..`, no absolute). width/height clamp **200–8192 in service/screens.ts** — do NOT reuse viewer-ui's 100–8192 camera clamp; that stays for the camera.
- Reader normalizes silently (drop bad entries, dedupe ids); empty/missing → `{version:1,screens:[]}`.
- Scaffold seeds `home.html` + entry `{id:"home",file:"home.html",title:"Home",1280,800}`.

### B. Service HTTP (service/main.ts; bearer auth unchanged) + the Browser class contract
NEW routes: `GET /screens?dir=` → normalized registry; `PUT /screens?dir=` → validate+write full registry (`200 {path}`/`400 {error}`); `GET /workspaces` → `{root, workspaces:[{dir,name,url?,screens?}]}` (children of workspace root containing `.design-studio.json`).
CHANGED: `POST /open` accepts `{dir, screen?}` (config's `url` still authoritative) → resolves screens → cold browser: bake screens into ViewerConfig at launch; warm browser: **push `setScreens`, no shell restart, no new capability URL** (one capability URL per launch). `POST /mode {mode:'edit'|'play'}` → push + in-memory echo. `GET /state` extends BrowserState with `{mode, screens:[{id,title,url,width,height,active}], activeScreen}`.
**Browser class public surface — `service/main.ts` may ONLY use these (audit #2/#3, the inter-agent contract):**
```ts
class Browser {
  openWorkspace(cfg: { screens: Screen[]; baseUrl: string; mode: 'edit'|'play' }): Promise<void>
  setScreens(screens: Screen[]): Promise<void>          // push into live shell
  setMode(m: 'edit'|'play'): Promise<void>
  setActive(id: string): Promise<void>
  getMode(): 'edit'|'play'
  getState(): /* existing BrowserState + mode/screens/activeScreen */
  navigate(screen: string|undefined, url: string): Promise<void>  // undefined = active
  pick(): (PickedElement & { screen: string }) | null
  input(screen: string|undefined, events: unknown[]): Promise<void>
  capture(screen?: string): Promise<...>
  getProbe(screen?: string): Promise<ProbeReport>       // zero-arg = active (verify.ts keeps compiling)
  focus(): void; close(): void
}
```
Service keeps `lastWorkspace: {dir, screens, mode, activeScreen}` in memory after `/open`; `browser-control.ts` uses it as the `dir` fallback when the host request's `context.directory` holds no config.

### C. Shell config + `window.__dsCanvas.*` bridge (the ONLY shell↔service surface)
Viewer config (baked at `startViewerServer`): `{ screens: [{id,url,width,height,title}], viewport:{width,height}, mode:'edit' }`.
Shell→service (`__dsCanvasSend`): keep `{type:'ready'|'viewport'|'page'|'retry'|'layout'|'fit-size'}` — **each of `viewport`/`page`/`retry` gains `screen`** (default active; per-screen layout/reconcile machinery is v1 = active-screen-only). NEW: `{type:'screen-pick', screen, x, y}` (x/y = CSS px inside the frame, mapped from scaled rect) and `{type:'screen-activate', screen}`.
Service→shell (`shellEval` of `Runtime.evaluate` into shell context): `__dsCanvas.setScreens(list)`, `__dsCanvas.setMode(m)`, `__dsCanvas.setActive(id)`, `__dsCanvas.setScreenState(id, {state:'loading'|'ready'|'error', message})`, `__dsCanvas.fitAll()`, plus retained `setPage/setViewport/setStatus/zoomCamera/getCamera/restoreCamera/dismissMenu/handleCanvasInput/begin|normalize|endCapture` (capture+page-height operate on ACTIVE screen; beginCapture accepts optional screen id).
Geometry (audit #7): artboards at natural px in camera space; `setScreens` recomputes `view.width/height` = grid bounding box; camera-extent clamps widened to **64–65536** (`setLayout`/`restoreCamera` validators, restoreCamera validation in browser.ts) while per-screen sizes stay 200–8192; `fitAll` clamps by the existing zoom range 0.1–3.
Status (audit #8): global `#state` overlay ONLY for "zero screens" (empty workspace); one dead screen = per-artboard error, never blanks the grid.
Shell DOM per artboard: `<section class="ds-artboard" data-screen=ID>` + `<button class="ds-ab-title">` + `<span class="ds-ab-size">` + `<iframe id="ds-frame-<ID>" data-ds-screen=ID name="__dsArtifact:<ID>" referrerpolicy="no-referrer" sandbox="...">`.
CSP/OOPIF (audit #20): viewer-server CSP `frame-src http: https:` already permits N dev-server origins — **no CSP edits needed**; same-origin child frames may or may not be OOPIFs — `ArtifactContexts` already handles both (`childSessions`, per-session `enable()`); **do not add fetch-based discovery**.

### D. Multi-frame authority (service/artifact-context.ts + browser.ts)
- `ArtifactContexts`: replace single `artifactFrame`/`artifact()` with `artifacts(): Map<screenId, DefaultContext>`, populated in `discover()` for EVERY child frame whose `DOM.getFrameOwner` element has `data-ds-screen` (today it returns after the first `id==='preview'` match). `artifact(id?)` = named-or-active. Trust gate IN-FRAME: `window.name.startsWith('__dsArtifact:')` ONLY — the `name` attribute is static markup so it exists at document start (this also closes the historical injection-race workaround; delete the post-load naming loop and its comments). frameId↔screenId mapping lives service-side (cross-origin frames can't read their own frameElement).
- **Every `getElementById('preview')` site becomes `ds-frame-<screen>` (active default)** — enumerate by symbol (audit #4): SHELL_BRIDGE frame-naming (now deleted), camera-zoom/wheel coordinate remaps in the artifact-event handler, `input()` rect mapping, keyboard `focus()` before key/insertText, `viewer-ui.ts` markup, `canvas-controller.js` refs, pan-layer pick mapping. Picks accepted from ANY trusted artifact context: generalize the bindingCalled artifact-context check into an `executionContextId → screenId` map; `lastPick` gains `screen`.
- `refreshArtifact` per-screen (URL/title/`changed` tagged by screen); `highlight`, `getProbe`, `capture`, navigate gain screen param; `browser-control.ts` handlers accept optional `screen` and use `lastWorkspace.dir` fallback.

### E. Scaffold changes (service/scaffold.ts)
- Multi-page Vite skeleton: seed `home.html` **plus `index.html` meta-refresh redirect to home.html** (keeps `vite build` default entry valid; `command` stays `npm run dev`), `tokens.css`, `styles.css`, `app.js` nav snippet; `.design-studio.json` gains `pagesRoot: "."`; write `screens.json` (A).
- New module `service/screens.ts` (read/write/normalize per A), used by `/screens`, `/open`, `/workspaces`.
- No harness-plugin write (#5): skip that step in `scaffoldProject`.
- **Scaffold confinement**: creating a NEW directory during scaffold is allowed only inside the resolved workspace root; an existing dir elsewhere is accepted (user's own project). Panel always passes workspace-root dirs.

### F. Panel changes (panel/*)
- `resolveDesignTarget` → `resolveCanvasTarget` (pure, panel/api.ts): target kinds `workspace` (ws/<sessionId> set) | `new` (brief required → `GET /workspaces` to avoid slug clash → create via `/scaffold` → store `ws/` key). Remove NEEDS_PROJECT refusals in `resolveDesignCommand`, `scaffoldCurrentProject`, `startNewDesign`; delete-branch behavior for list rendering. `wsReady = Boolean(config?.url)` AND keep `isLoopbackUrl(url)` gating the auto dev-server start (row Start control). **Path compare normalizes separators (`\`→`/`) and drive-letter case** before matching `ws/<sessionId>` dirs to session dirs (audit #11).
- `/canvas on`: ensure workspace → `POST /open {dir}` (all screens) → mode chip; `/canvas play|edit`: `POST /mode`; row keeps Start/Stop + play/edit toggle + active-screen dropdown + Focus, all sourced from `/state`. The row NEVER falls back to "not set up" — absent workspace shows Start ("create canvas").
- Page "Your design work" = `GET /workspaces` rows joined against a CACHED `ws/` storage scan (single `host.storage.keys()` pass per refresh, one map dir→sessionId; audit #19). Open a workspace: reuse its session via `host.openSession` when mapped, else start a new session titled with the workspace name (carrying the brief).
- Chip budget (audit #16): `buildModeChip` text is capped at 16000 (`GUEST_ATTACH_TEXT_MAX`); order: mode state → workspace path + screens protocol → screens id/URL list (cap 40) → TRIMMED rules (IDENTITY + design-system authority + VERIFY_PROTOCOL; drop the full craft-rulebook dump from the chip — the rulebook ships via `designSessionPrompt` on session start instead).
- Pick chip payload (panel/attach-dialog.ts): adds `Screen: <id>` + that screen's URL.
- Dead panel files stay dead (compose/settings/tokens unused).

### G. Cross-platform portability (P0 — symbol-owned files: browser.ts chrome/reaper, project-server.ts, scaffold.ts spawn, scripts/build-viewer.mjs, package.json test script)
Rule: **no Windows-only branch.** POSIX paths stay intact as darwin/linux behavior; win32 gets equivalents; Linux explicit everywhere.
| Fix | Where (symbols) |
|---|---|
| Chrome default per OS: `DS_CHROME_PATH` env wins; win32 probes Program Files, Program Files (x86), %LOCALAPPDATA% Google\Chrome\Application\chrome.exe; darwin keeps the .app bundle path; linux probes /usr/bin/google-chrome, google-chrome-stable, chromium, chromium-browser, /snap/bin/chromium, then PATH `google-chrome` | browser.ts `CHROME_PATH` |
| Orphan reaper: `ps -ax` branch intact for darwin/linux (tolerate missing `ps` silently); win32 via `Get-CimInstance Win32_Process` (powershell -NoProfile) matching `ds-chrome-` profiles, kill `taskkill /PID x /F /T`; unavailable → skip silently | browser.ts `reapOrphanChrome` |
| Dev-server identity/stop: POSIX pgid+`ps lstart`+group-kill branch intact; win32 record `{pid,port,startedAt,platform:'win32'}`, verify port owner via `netstat -ano` PID column before `taskkill /T /F`; never kill unverified | project-server.ts identity/stop/alive helpers |
| `spawn('npm',{shell:false})` → win32 `npm.cmd`; POSIX unchanged | scaffold.ts install spawn |
| `TMPDIR ?? '/tmp'` → `os.tmpdir()` | scripts/build-viewer.mjs |
| Test script glob: single quotes break under cmd → `node --test --test-concurrency=1 \"tests/*.test.ts\"` (DOUBLE-quoted glob — Node expands internally; a bare `tests` dir arg throws MODULE_NOT_FOUND on Node 24.21, P0 verified) | package.json |
| Workspace root probe (`%ONEDRIVE%\Documents` → `%USERPROFILE%\Documents` → homedir) implemented service-side; POSIX unaffected | new workspace-root helper (P1-screens, used by /workspaces + /scaffold) |
| Home dirs via `os.homedir()`; `ComSpec` reads win32-guarded; signals comment | all fork code |
CI: ubuntu workflow (typecheck+build+test, Chrome-dependent tests excluded upstream-style) stays green — the automated macOS/Linux-side gate.

### H. Copy/branding + tests ownership
README.md (fork purpose, Claude-canvas parity, OS matrix, disable-original guidance), docs/. Test files pinned to old behavior — owners by phase:
- **P0**: tests/project-server, server-stop, reference-path (the `new URL(...).pathname` Windows case)
- **P1-panel**: tests/manifest, mode, attach-dialog, mode-open, panel-open, root-workspace-breaker, provider, reference-*, adversarial/design-work-* (providerId/copy/`/canvas` renames)
- **P1-screens**: tests/scaffold, service (new routes), studio-config
- **P1-shell**: tests/viewer-ui, viewer-server, stock-controller
- **P1-browser**: tests/browser, artifact-context, live-canvas-browser, canvas-zoom-routing, fit-page-browser, fit-page-breaker, nova-canvas-breaker

## Phase plan (Alibaba models per AGENTS.md) — GATES LOCKED

**Model governance rule (user directive 2026-10-17):** spec authoring/approval and all code review/approval belong to the biggest Alibaba agents — **Qwen 3.8 flash @ xhigh (max effort)** for spec gates + adversarial code review; **Deepseek v4-pro #max** for planned implementation; **Deepseek flash** only for scoped visual/browser checks. No phase ships past a gate the Qwen reviewer has not approved.

| Phase | Scope | Model | Gate |
|---|---|---|---|
| P0 cross-OS | §G (+§H test rows) | deepseek-v4-pro-0813#max | committed after orchestrator scope-check ✅ |
| P0.5 spec audit | 20 amendments → spec v2 | qwen3.8-flash#xhigh | DONE ✅ |
| **P1.5 spec v3 gate** | review Claude-parity additions + P2/P2.5 scope against real code (esp. CDP export feasibility); produce docs/SPEC-V3-P2-SCOPE.md as the BINDING P2 contract; may edit ONLY parity/phase/acceptance sections of FORK-DESIGN-CANVAS.md — never §A–§H (live P1 contracts) | **qwen3.8-flash#xhigh** | blocks P2 |
| P1-panel | §F, identity §1, harness §5, README/docs, its §H tests | deepseek-v4-pro-0813#max | reviewed in P3 |
| P1-screens | §A/§B-routes/§E + workspace-root helper | deepseek-v4-pro-0813#max | reviewed in P3 |
| P1-shell | §C (+ its §H tests) | qwen3.8-flash#xhigh | reviewed in P3 |
| P1-browser | §D (+ §B Browser methods, its §H tests) | qwen3.8-flash#xhigh | reviewed in P3 |
| P2 integration | docs/SPEC-V3-P2-SCOPE.md contract: green build/typecheck/tests across phases; view-state persistence; `/export` PNG/PDF; variants+size prompt rules; `/canvas critique`; screens `{x,y}` + drag-reposition; cross-phase seams | deepseek-v4-pro#max | **P3 approval MANDATORY** |
| P3 review | adversarial full-diff review vs spec + SPEC-V3; per-OS branch audit (win/mac/linux); findings→fix→re-review until **APPROVED** | **qwen3.8-flash#xhigh** | **no P4 smoke / install / push before APPROVED verdict** |
| P2.5 enhancements | comments.json + pinned markers, in-place text retype + snapshot versioner — only if P2 is P3-approved clean | deepseek-v4-pro#max implement → **qwen3.8-flash#xhigh** review | same gate |
| P4 smoke | real Chrome on Windows; acceptance 1–9; install in OpenChamber | flash executes + orchestrator drives | findings → P3-style re-review for any fix |
| P5 ship | migrate branch to `~/Documents/github/openchamber-design-canvas`, push `canvas-fork` to user's fork, changelog, install handoff | orchestrator | final qwen3.8-flash#xhigh quick-look at shipped diff + instructions |

Agent rules: (1) branch `canvas-fork`; workdir per phase table (P0–P1: `C:\Users\samhe\Documents\github\openchamber-design-studio`; P1.5 onward of the cutover: `C:\Users\samhe\Documents\github\openchamber-design-canvas`); npm install done in the old clone; (2) touch ONLY your phase-owned files — outside changes only as `FORK-MERGE:` comment + report; (3) bundles: P1 agents do **NOT** run `npm run build` (parallel tree, corrupted-intermediate risk) — P2 rebuilds everything once (shell agent still runs `npm run build:viewer`, its asset file is phase-owned); (4) typecheck your files; run your owned tests individually; report baseline-vs-new failures honestly; (5) no new deps without flagging; (6) resolve code by SYMBOL, not line numbers; (7) all code cross-platform via explicit `process.platform` branches.

## P0 handoff notes (committed with P0)
- Bundles on this branch had PRE-EXISTING source→bundle drift (stale pick-bridge in panel/main.js); P0's rebuild re-synced. P5 must rebuild everything one final time before shipping.
- Win32 helpers in project-server.ts are module-private (`win32PortOwnerPid`, `win32PidAlive`, …). If P1-browser/P1-screens need them, PROMOTE deliberately — never duplicate.
- `stopDevServerWin32` descendant check needs PowerShell; plain pid equality remains the fallback gate (refuses, never guesses).
- Known pre-existing Windows test failures remain for P2: project-server (POSIX shell quoting in test bodies), reference-path (URL.pathname join), stock-nova (`C:\C:\`), window tests (Git-Bash `ps`), Chrome-open flakiness class.

## Claude Design parity map v2 — canvas/artboard details (2026-10-17, user-supplied docs + third-party reports)

New confirmations from the deeper write-up (marked unofficial where so):
- **Artboard = its own HTML file** (`.dc.html` upstream) in a sandboxed preview iframe; **`canvas.json` keeps positions separately** → one artboard can be rewritten without disturbing others; moving an artboard is a POSITION edit, not a redraw. → Our model matches already (per-screen HTML files, sandboxed iframes, screens.json data). Upgrade: screens.json entries gain optional `{x, y}` (service normalize accepts+persists, shell uses when present, auto-grid when absent — mixed model). **Drag-to-reposition artboards in the shell** (mousedown on artboard chrome → live move → persist via `PUT /screens`) = the cheap "edit by hand" win, promoted to P2.
- **Artboard identity**: title + position label ("artboard 1 of 7") → shell header shows `N · Title` + size. Trivial; P2.
- **Layers inside an artboard; enter & select elements** → edit-mode pick already does element-level selection incl. shadow DOM. P2 adds: clicking a chip's screen header enters a "focused screen" full-frame view where repeated picks are rapid-fire (no camera gymnastics). Stretch.
- **Hand edits don't cost tokens / direct drag-resize-align-rewrite text in place + properties panel + undo/redo + Save=version**:
  - Artboard reposition: ADOPTED (above — it's the same "data, not redraw" trick).
  - **In-place text retyping**: scoped experiment for P2.5: dblclick text element in edit mode → contentEditable → on commit, service patches the element's outerHTML into the screen's HTML file via the pick selector. Guarded: text-only, agent-generated structure, every patch snapshots the file first (see versions). Failure = restore + tell user to ask in chat. NOT v1.
  - Element drag/resize/align inside artboards + properties panel: remains DEFERRED (real HTML/CSS; doing this well is a different product).
  - **Undo/redo & versions**: local analog = lightweight file versioner (P2.5): service snapshots `<workspace>/<file>` into `<workspace>/.design-studio/versions/<ts>/` before any PATCH/export-time write; `POST /restore {file, ts}`; git remains the heavy layer.
- **Comments as notes OR instructions ("Send to Claude" checkbox)** → P2.5 comment markers upgrade: a pinned comment persists to `<workspace>/comments.json` (screen, selector, text, open/resolved) AND optionally sends the pick+note into the chat in the same action. The pick-chip→chat path already covers "instruction to Claude" as the default gesture.
- **One artifact, one share link; view/comment/edit access** → hosted-only, but local analog: `vite build` → static `dist/` (openable/shareable via any file host) + our `/export` PDF/PNG. Document as the "share" story in README; don't build link-serving.
- **Pan/zoom "like Figma/Illustrator"** → parity intent locked: camera keeps scale/translate under wheel+drag, cursor-anchored zoom, fit shortcuts — already in shell spec §C.
- **Canvas built for comparison** (one page × 3 widths; three directions; full flow in order) → these three cases become the README's usage examples and the prompt rules from the parity map v1 (variants as artboards; same-page responsive screens).

**Phase scope re-lock** (avoid bloat; P1 agents still mid-flight):
- P1 (running) — unchanged.
- P2 (integration) — the four parity items from v1 map (view-state persistence, `/export` PNG/PDF, variants+size prompt rules, `/canvas critique`) **PLUS**: screens.json `{x,y}` positions + shell drag-to-reposition + `N · Title · WxH` header format (v1 headers already reserved; now specified).
- P2.5 (enhancements, only if P2 green) — pinned comments (`comments.json`, note/instruction), in-place text retype with pre-patch snapshot, versioner + restore.
- Deferred with rationale — element-level drag/resize/align + properties panel; link-sharing/collab; paste-to-canvas.

## Acceptance
1. `design-canvas` installs beside `design-studio` without rail/command clashes; `/canvas` works in a chat with NO registered project. (Agent-`browser.*` arbitration between two installed providers is documented, not guaranteed — README tells users to disable the original.)
2. `/canvas <brief>` in a scratch chat → creates `<Documents>/Design Canvas/<slug>`, scaffolds (home.html+index redirect+tokens+screens.json), dev server up, Chrome canvas opens with 1 artboard.
3. Agent adds `checkout.html` + screens.json entry → artboard appears after re-open/`setScreens` push.
4. Canvas: drag/wheel pans BOTH axes, Ctrl+wheel zooms, fitAll frames all artboards, headers show title+size, double-click artboard → focus/zoom ≈100%.
5. Edit mode: click element in artboard B → chip in THIS chat's composer carries selector/styles + `Screen: B` + B's URL. Play mode: in-screen buttons/links work; navigation stays inside the artboard (sandbox); top-navigation attempts are refused by Chrome.
6. `/canvas off` → `on` restores same workspace, no re-scaffold; OpenChamber restart preserves ws/mode/design keys and reopens cleanly.
7. **Out-of-cwd writes**: from a chat whose dir ≠ workspace, the agent successfully creates home.html/checkout.html at the workspace path (permission prompts approved per decision #4).
8. `npm run check` green on Windows; ubuntu CI gate green (typecheck+build+non-Chrome tests); POSIX branches reviewed byte-compatible (P3).
9. (P2) Ask for "two directions" → canvas shows 2+ variant artboards side by side, each at its own frame size; camera pan/zoom position survives reopen; `POST /export` writes real PNGs (and PDF) under `<workspace>/exports/`; `/canvas critique` produces a gate-backed review message in chat.
