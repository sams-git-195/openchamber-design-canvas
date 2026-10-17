# SPEC-V4-CARBON-PARITY — the binding V4 polish-to-parity contract (P3 gate output)

Author: P3 review gate (claude-opus-5-5), reviewed against `canvas-fork` @ `b21378f` (full P2 integration),
2026-10-17. Implementers: Qwen 3.8 (xhigh) per workstream; smoke + screenshots: Sonnet 5.5; code QA: Qwen 3.8.
SPEC-V3-P2-SCOPE.md and FORK-DESIGN-CANVAS.md §A–§H stay binding except where a V4 decision below amends
them explicitly ("AMENDS"). Resolve code by **symbol**, never line number (line refs below are evidence only,
pinned to `b21378f`).

## 0. Verdict and scope statement

**The code is close.** V4 is polish-to-parity plus five real defects, not a rewrite. The architecture (service as
authority, shell as a CSP-locked renderer, per-screen HTML files, view.json for user state, bearer-loopback
service) is right and stays. What breaks the Claude-Design feel today is (1) legacy single-frame layout machinery
still running inside the multi-artboard canvas, (2) a pick loop that is slow, lossy and invisible from the canvas
window, (3) agent-written screens not appearing until a manual reopen, and (4) a first-run scaffold that renders
unstyled. Total estimated effort: ~6–8 implementer-days across 4 parallel workstreams.

## 1. Evidence index (all reproduced by the P3 gate; scratch probes in `%TEMP%\dc-review\probe{1..5}.mts`)

| ID | Finding | Status | Evidence |
|---|---|---|---|
| E1 | Activating any artboard (title click, toolbar chip, double-click, panel dropdown, agent `browser.navigate {screen}`) runs the legacy **page-layout qualification at the `desktop` preset** on it: a 390×844 artboard becomes **1280×800**; a tall 390×844 one becomes **1280×2520**; the frame's `innerWidth` becomes 1280. Never reverts. | CONFIRMED (live) | probe1: `afterActivatePhone: phone:1280x800`, `afterActivateTall: tall:1280x2520`. Root: `Browser.refreshScreen` → `queueLayout` → `reconcileLayout(page, layoutState.preset='desktop')` → `__dsCanvas.setLayout` mutates the active screen's width/height (`setLayout` in canvas-controller.js). |
| E2 | Consequence of E1: **export PNG of an activated phone screen is 1280×800**, not its registry 390×844. The P2 smoke's "exact size" passed only because nothing was clicked. | CONFIRMED (live) | probe4: before activate `390x844`, after `1280x800`. |
| E3 | The toolbar's **Fit preset** switches layoutMode to `fit`, which disables zoom, pan **and edit-mode picking** (canvas `pointerdown` guard returns on `layoutMode==='fit'`). | CONFIRMED (live) | probe2: `fitPresetClickPick: 0`, probe1: `fitZoomInAccepted: false`. |
| E4 | The green pick outline (`#__ds-pick-outline`) **leaks into exported PNGs** (stays visible in-frame after a pick; `capture()` does not hide `[data-ds-overlay]`). | CONFIRMED (live) | probe5 + `%TEMP%\dc-review\pick-export.png` shows "button #b" label in the export. |
| E5 | Scaffold `styles.css` uses `--font-sans`, `--step-*`, `--radius`, `--measure`; **all 22 design-system presets** define `--font-body`, `--text-*`, `--radius-md`… instead → every preset workspace renders in Times New Roman at UA sizes (the dead-looking Home artboard in `docs/smoke/out/canvas-overview.png`). | CONFIRMED (code + workspace files) | `presetTokensCss` (scaffold.ts) emits preset tokens only; common preset vocabulary computed over `shared/design-systems.ts` (22/22 share it). |
| E6 | Agent-written screens never appear live: no watcher on `screens.json`, and `PUT /screens` does not push to the browser. New screens/size/title changes need a manual `/open`. | CONFIRMED (code) | no `fs.watch`/poll anywhere in service; `/screens` PUT route only `writeScreens`. |
| E7 | Pick delivery: panel polls `/state` every 900 ms (`POLL_MS`), **skips while `document.visibilityState!=='visible'`**, and attaches only `lastPick` → two picks within one poll interval lose the first. Service-side pick latency is ~5 ms; the 0–900 ms (+host hop) is all panel. | CONFIRMED (code + live: probe1 `twoPicksSeqDelta: 2`, `pickServiceLatencyMs: 5`) | `applyState`, `poll` in panel/main.ts. |
| E8 | No element hover in edit mode (iframes are `pointer-events:none`; the in-frame outline only follows Ctrl/⌘-hover) → edit mode is a blind click; only the whole artboard outlines. | CONFIRMED (code) | `CANVAS_GEOMETRY` edit rules; `PICK_SCRIPT.onHover`. |
| E9 | Agent `browser.scroll` (wheel, no selector) in **edit** mode pans the **user's camera** (and persists it to view.json) instead of scrolling the page. | CONFIRMED (live) | probe2: camera `[0,0]→[0,-400]`, page `scrollY 0→0`. `Browser.input` FORK-MERGE seam 7 never decided. |
| E10 | Artboard headers live inside the scaled camera at 12 px → at fit-all with 6+ screens (scale ≈0.25) labels render ≈3 px. | CONFIRMED (code) | `.ds-ab-title` in `CANVAS_GEOMETRY`, no counter-scale. |
| E11 | Malformed `screens.json` (agent typo) is swallowed (`readScreens` catch → empty) → `/open` silently falls back to the single config-URL page; nobody is told. | CONFIRMED (code) | `readScreens` in service/screens.ts. |
| E12 | Scaffolded dev server binds **all interfaces** (`vite --host`) → workspace served to the LAN. | CONFIRMED (code) | `packageJson()` dev script in scaffold.ts; smoke workspace package.json. |
| E13 | Win32 `npm install` uses `spawn('npm',[args],{shell:true})` → Node 24 DEP0190 warning. | CONFIRMED (code) | `runNpmInstall` in scaffold.ts. |
| E14 | Live Chrome tests read `DS_CHROME_PATH ?? <macOS path>`: on Windows without the env var **16/17** live-canvas+export tests **skip** and the suite still reports green. | CONFIRMED (run) | `node --test tests/live-canvas-browser.test.ts tests/export.test.ts` → `pass 1, skipped 16`. |
| E15 | `/scaffold` (npm install + dev boot) and cold `/open` (Chrome launch + `waitScreen` ≤10 s + `refreshUnsettled` ≤4 s) run synchronously behind `host.serviceRequest` (20 s cap). Warm-cache npm install measured 4.4 s; a cold cache or slow disk can exceed 20 s → panel shows a timeout, service finishes anyway, `ws/` key never stored → next `/canvas` scaffolds a **second** workspace. | SUSPECTED (timing) | `GUEST_REQUEST_TIMEOUT_MS=20000`; `scaffoldCanvasWorkspace`. No host-in-the-loop test exists. |
| E16 | Focus stealing: every agent `browser.navigate`/`open` that settles calls `bringToFront()`; warm `/open` (panel screen dropdown) too. | SUSPECTED (Windows foreground-lock may downgrade to a taskbar flash) | `bringToFront` call sites in `navigateGuarded`, `openWorkspace`. |
| E17 | Intermittent: 1 of 5 live runs never persisted view.json for the whole session (camera-changed lost), 4/5 fine. | SUSPECTED (1/5 repro) | probe3 runs. Likely shell-authority lease race; needs instrumentation (V4-15). |
| E18 | `beginCapture` during an in-progress title drag swallows the `pointerup` (capture-phase guard) → after export the artboard keeps following the cursor until the next click. | SUSPECTED (code) | `boardDrag` + capture guard in canvas-controller.js. |

Known-good, re-verified: typecheck 0 errors; full suite 481 = 477 pass + 4 documented skips, 0 fail (with
`DS_CHROME_PATH` set); dead dev server → per-artboard error card with actionable message, siblings untouched
(probe2); Chrome killed by hand → `windowOpen:false`, reopen works (probe2); restored camera survives later
activations (probe1/3); sandbox has no `allow-top-navigation`; CSP `connect-src 'none'` + hashed scripts.
Mutant count (24 claimed in commit msg, 15 tabulated in P2-D report) was **not re-run** by this gate.

## 2. Decisions

Priority: **P0** = must land before P4 install/P2.5; **P1** = should land in V4; **P2** = nice, cut first.
Effort: S ≤ 2 h, M ≤ 1 day, L ≤ 2 days (one implementer).

### V4-1 · P0 · Fixed-size artboards: retire layout qualification in workspace mode (E1, E2, E3) — A+B, M
AMENDS SPEC-V3 R4/R5 residuals (they disappear).
- **Service (A):** in `Browser.openWorkspace` (cold and warm) set
  `layoutState = {mode:'viewport', preset:'custom', nominalHeight:<active.height>}` with **no** `reason` and
  `requestedLayout = null`. `queueLayout`'s existing guard then never schedules. Additionally, when
  `workspaceMode===true`: `canvasCommand` ignores `layout`, `fit-size`, `viewport` (no reply, no error);
  `refreshScreen` skips the `layoutContext`/`queueLayout` branch; `setActive` only does
  `syncViewportToActive` + `pushShellActive` + `refreshScreen` (no requalification).
  `Browser.resize()` / `setLayout()` (browser-control, verify R4) stay functional as **temporary** overrides and
  MUST restore the registry size in a `finally` (verify.ts already restores camera+viewport; add an explicit
  `applyScreenRegistry`-size re-push for the active screen).
- **Shell (B):** delete the viewport-preset `ToggleGroup` (`PRESETS`, `selectViewport`, `choosePreset`,
  `__dsToolbarBridge.selectPreset`) and the "Fit width"/`Width · N%` zoom semantics from the toolbar. Zoom menu
  items become: `Fit all` (→`fitAll`), `50%`, `100%`, `200%`, `Zoom to selection` (→`focusScreen(active)`).
  `setLayout`/`getFitBounds` stay on `__dsCanvas` (service compatibility) but no toolbar path reaches them.
  The zoom label shows only `N%`.
- **Acceptance (A, new `tests/v4-live.test.ts`):** registry `[home 1280×800, phone 390×844, tall 390×844 with
  2400 px content]`; for each id: `setActive(id)`, wait 2.5 s → `__dsCanvas.getScreens()` sizes equal the
  registry, `evaluate('innerWidth', id)` == registry width, `capture(id)` PNG IHDR == registry size. Same after
  `navigate('phone', url)`. **(B, stock-controller):** toolbar render has no element with
  `aria-label="Design viewport"`; zoom menu has no "Fit width".

### V4-2 · P0 · Overlays never reach exports (E4) — A, S
- `PICK_SCRIPT` gains `window.__dsOverlays(visible:boolean)` (sets `display:none` + `hidePopover()` on every
  `[data-ds-overlay]`, restores on `true`). `Browser.capture(screen)` calls `__dsOverlays(false)` in that
  screen's context before `normalizeCapture` and `__dsOverlays(true)` in its `finally`. The picked outline also
  auto-fades: green state persists **1500 ms** then hides (no permanent mark).
- PDF path is already clean (fresh target, no PICK_SCRIPT) — pin it.
- **Acceptance:** live: pick `#b`, `capture('home')`, decode PNG → no pixel of `#22c55e`±8 anywhere; outline
  visible again after capture iff within its 1500 ms window.

### V4-3 · P0 · Scaffold token bridge so every preset renders styled (E5) — D, S
- `presetTokensCss(preset)` appends, inside the same `:root`, an alias block mapping the STYLES_CSS vocabulary
  onto the shared preset vocabulary (only for names the preset does not itself define):
  `--font-sans: var(--font-body); --font-serif: var(--font-display); --step--1: var(--text-sm);
  --step-0: var(--text-base); --step-1: var(--text-xl); --step-2: var(--text-2xl); --step-3: var(--text-3xl);
  --step-4: var(--text-4xl); --radius: var(--radius-md); --measure: 68ch;` (comment line:
  `/* scaffold aliases — styles.css vocabulary → preset tokens */`).
- **Acceptance (tests/scaffold.test.ts):** for EVERY preset id, the set of `var(--x` names used by STYLES_CSS ⊆
  names declared in the generated tokens.css (parse both with a regex; no browser). Live smoke: Home artboard
  `getComputedStyle(body).fontFamily` ≠ Times for `warm-editorial`.

### V4-4 · P0 · Live registry sync + loud registry errors (E6, E11) — A (+B notice, +C toast), M
New module `service/screens-watch.ts`:
```ts
export function watchRegistry(dir: string, onChange: (r: {ok:true; registry: ScreensRegistry} | {ok:false; error: string}) => void): () => void
```
- `fs.watch(dir, {persistent:false})` (non-recursive; filter `filename === 'screens.json'` or `filename == null`)
  **plus** a 2000 ms `fs.stat` mtime poll (OneDrive/network roots make fs.watch unreliable). Debounce 250 ms.
  Parse with a new `readScreensStrict(dir)` in screens.ts → `{ok:true, registry}` | `{ok:false, error:
  'screens.json: <JSON.parse message>'}` (readScreens keeps its silent contract for other callers).
- main.ts extracts the warm half of `/open {dir}` into `pushWorkspace(dir, {focus:false})` (view.json positions
  merged, `openWorkspace` warm push, **no** setActive change, **no** camera restore, **no** bringToFront).
  Watch starts on successful `/open {dir}`, is replaced on `/open` of a different dir, stops on `/close`.
  `onChange ok` → `pushWorkspace` only if the normalized registry JSON differs from the last pushed one.
  `onChange error` → keep last good registry; `__dsCanvas.setNotice({id:'registry', kind:'error', text})`;
  `/state.registryError: string|null`. Next good parse clears it (`setNotice({id:'registry', text:''})`).
- Backstop route `POST /screens/sync {dir}` → same as a watch tick (panel calls it on session `completed`, V4-12).
- Normalization drops become visible too: `readScreensStrict` returns `dropped: [{index, reason}]`; non-empty →
  notice `kind:'warn'`, e.g. `screens.json entry 2 dropped: width 120 is outside 200–8192`.
- **Shell (B):** `__dsCanvas.setNotice({id:string, kind:'info'|'warn'|'error', text:string})` renders a
  stacked banner in `#toolbar-status-area` (empty text removes that id; ≤3 notices; text ≤300 chars, escaped via
  `textContent`). Newly added artboard ids (not in previous list) get `data-new="true"` for 1200 ms (CSS ring pulse).
- **Panel (C):** if `/state.registryError` changes to a non-null value, one `host.toast({kind:'error'})` per
  distinct message.
- **Acceptance:** live: open 1 screen; write `b.html` + rewrite screens.json → within 3 s shell has 2 artboards,
  no new capability URL, camera unchanged; write invalid JSON → notice visible + `/state.registryError` set,
  artboards unchanged; fix file → notice cleared.

### V4-5 · P0 · Pick delivery: queue, long-poll, ack, in-canvas confirmation (E7) — A+B+C, M
- **Service (A):** new `service/pick-queue.ts`: ring buffer (cap 50) of
  `QueuedPick = {seq:number; kind:'element'|'screen'; screen:string; screenUrl:string; at:number; additive:boolean} & Partial<PickedElement>`
  (`kind:'screen'` from V4-10 has no selector). `Browser` pushes every honoured `__dsPick` (keeps
  `lastPick`/`pickSeq` for back-compat). Routes:
  - `GET /picks?since=<int>&wait=<ms 0..12000>` → `200 {seq:<latest>, picks: QueuedPick[] (seq>since, oldest first, ≤20)}`;
    resolves immediately when non-empty, else at the first push or at `wait`.
  - `POST /picks/ack {seq:int, label:string≤80}` → `200 {ok:true}`; pushes
    `__dsCanvas.showToast({kind:'ok', text:'Added to chat · '+label})`.
  - Unacked watchdog: 2500 ms after a push with no ack ≥ that seq → `showToast({kind:'warn', text:'Not delivered —
    open the chat with Design Mode on'})`.
- **Shell (B):** `__dsCanvas.showToast({kind:'ok'|'warn', text})` — one bottom-center pill, `textContent`,
  2000 ms, newest replaces. Shift-click in edit mode sends `screen-pick` with `additive:true` (service passes it
  through; panel treats additive picks as "append chip" vs default "append chip" — identical today, the flag is
  reserved so the agent text can say "also").
- **Panel (C):** replace pick handling in `applyState` with `pickLoop()` (row surface only): `GET /picks` with
  `wait=12000`, **no visibility guard**, process picks in seq order → `addToChat` → `POST /picks/ack`. On any
  request error/timeout fall back to `wait=0` every 250 ms for 30 s, then retry long-poll. `bridgeActive`
  semantics unchanged (a claimed bridge still stands the row down). `/state` polling stays for window/mode/screens.
- **Acceptance:** (A) `GET /picks?since=0&wait=5000` resolves ≤100 ms after a binding pick; two picks 50 ms apart
  both returned. (C, fake host) two queued picks → two `host.attach` calls in order, then one ack with the last
  seq; document hidden does not stop delivery. (Smoke) wall-clock click→chip p50 ≤ 300 ms on Windows.

### V4-6 · P1 · Edit-mode hover outline (E8) — A+B, M
- **Shell (B):** in edit mode, `pointermove` over a `.ds-artboard` (not on `.ds-ab-title`, not during pan/board
  drag/capture) → rAF-coalesced, emit `{type:'screen-hover', screen, x, y}` (artboard CSS px, same un-scaling as
  `pickAt`) only when the point moved ≥3 px or the screen changed; `pointerleave` of the artboard, mode change,
  drag start → `{type:'screen-hover-end'}`.
- **Service (A):** `PICK_SCRIPT` adds a SECOND overlay `#__ds-hover-outline` (`data-ds-overlay="hover"`, blue
  `#3b82f6`, label `tag#id.class · W×H`), `window.__dsHoverAt(x,y)` / `window.__dsHoverEnd()`. canvasCommand
  handles the two types **outside** `transaction` with latest-wins coalescing per service (one evaluate in flight;
  newer coordinates replace the queued one); dropped while `captureInFlight`. Hover never creates a pick.
- **Acceptance:** live: `screen-hover` at the button's center → `#__ds-hover-outline` rect equals the button rect
  ±1 px within 150 ms; `screen-hover-end` hides it; 200 hover messages in 1 s produce ≤ 70 evaluates.

### V4-7 · P1 · Agent input never hijacks the user's canvas (E9) — A+B, S
- **Shell (B):** `__dsCanvas.setAgentInput(on:boolean)` toggles `canvas.dataset.agentInput`; CSS
  `.canvas[data-agent-input] .ds-artboard>iframe{pointer-events:auto}`; while on, canvas pointer/wheel handlers
  ignore events. `__dsCanvas.revealScreen(id)` pans (no zoom change) the minimum needed to bring the artboard
  fully into the viewport (or its top-left when larger).
- **Service (A):** `Browser.input()` in `workspaceMode`: `wheel` events become an in-frame
  `scrollBy(deltaX, deltaY)` evaluate (no shell dispatch); pointer/key batches call `revealScreen(screen)` then
  `setAgentInput(true)` … dispatch … `finally setAgentInput(false)`. Delete the seam-7 FORK-MERGE comment.
- **Acceptance:** live (edit mode): agent wheel 400 → page `scrollY` 400, camera unchanged, view.json camera
  unchanged; agent pointer click on an off-screen artboard lands on the element (fixture receipt) and creates
  **no** pick (`pickSeq` unchanged).

### V4-8 · P1 · Focus discipline (E16) — A, S
`bringToFront()` only from user-initiated paths: `POST /focus`, `POST /open` **when the body carries
`focus:true`** (panel sends it for Design Mode ON / workspace-row open; NOT for the screen dropdown), and V4-13
dock. Agent `browser.*` navigations, warm pushes, registry sync and export never raise the window.
Acceptance: unit-level spy on `bringToFront` call sites (A test with a stubbed cdp).

### V4-9 · P1 · Art-wall visual polish (E10 + overview screenshot) — B, M
Exact targets (all in `CANVAS_GEOMETRY`/controller; tokens from index.css):
- Canvas: background `oklch(0.17 0 0)` with a dot grid
  `radial-gradient(circle, oklch(1 0 0 / .07) 1px, transparent 1.2px)`; `paint()` sets
  `background-size: (24*scale)px (24*scale)px` and `background-position` = camera translate, so the grid moves
  with pan/zoom (hidden below scale 0.3).
- Artboard: remove the inactive 1 px outline; `box-shadow: 0 1px 2px rgb(0 0 0/.4), 0 12px 32px rgb(0 0 0/.35)`;
  active = `outline: 2px solid #4f8cff; outline-offset: 2px`; edit-mode hover = `outline:1px solid
  rgb(79 140 255/.6)` (artboard-level; element hover is V4-6).
- Headers: plain text, no pill background: title 13px/500 `var(--foreground)` at 85% opacity, size label
  12px tabular-nums `var(--muted-foreground)`; 8 px above the artboard. **Counter-scaled**: `paint()` sets
  `--cam-scale` on `#camera`; headers use `transform: scale(calc(1 / var(--cam-scale)))`,
  `transform-origin: bottom left` (size label: `bottom right`), with `max-width: calc(var(--w) * var(--cam-scale))`
  so a header never exceeds its artboard's on-screen width. Readable 13 px at every zoom.
- Default camera when view.json has none: **fit-all** (not `fit` width). AMENDS D5 default.
- Toolbar (left→right): Palette icon · workspace name (truncate 24ch) · Edit/Play segmented · *spacer* ·
  agent status chip (V4-12) · `−` `N%▾` `+` · Fit-all (`Frame`) · Pan toggle · status icon. Screen chips move into
  a "Screens ▾" menu when `screens.length > 4` (chips otherwise); presets gone (V4-1).
- **Acceptance (Sonnet smoke):** screenshots at fit-all with 6 artboards (scale ≈0.25): every header legible
  (≥11 CSS px rendered), grid visible, no pill backgrounds; compare against `docs/smoke/out/canvas-overview.png`.
  (B, stock-controller) `--cam-scale` updated on paint; header computed transform inverse of camera scale.

### V4-10 · P1 · Artboard context menu — B+A+C, M
- Trigger: right-click anywhere on an artboard (edit and play mode; in play mode only on the header) or a `⋯`
  button revealed on header hover. Vanilla `role="menu"` popover built by the controller (keyboard: arrows,
  Enter, Esc; focus returns to the header).
- Items → shell→service `{type:'screen-menu', screen, action}` where action ∈
  `'zoom'` (local `focusScreen`, no message) · `'send-to-chat'` · `'reload'` (= existing per-screen `retry`) ·
  `'reset-position'` · `'export-png'` · `'export-pdf'` · `'copy-path'` (the shell does not know the
  file path → service resolves it from the registry and answers with `showToast({kind:'ok', text:<abs path>, copy:true})`;
  on `copy:true` the shell also tries `navigator.clipboard.writeText(text)` — 127.0.0.1 is a secure context —
  and ignores a rejection).
- Service (A): `send-to-chat` pushes a `kind:'screen'` QueuedPick (V4-5) `{screen, screenUrl, width, height,
  file}`; `reset-position` = `mergeView(dir,{positions:{[id]:null}})` + warm push; `export-*` = existing export
  job with `screens:[id]`, toast on done with the path.
- Panel (C): `attach-dialog.buildAttachPayload` handles `kind:'screen'`: chip text
  `Screen: <id> (<w>×<h>) — <abs file path>` + `Screen URL:`; no selector/styles block.
- **Acceptance:** live: menu action `send-to-chat` → `/picks` returns a `kind:'screen'` entry; `reset-position`
  removes the key from view.json and the artboard returns to its auto slot.

### V4-11 · P1 · First-run that cannot time out (E15) — A+C (+D for the job split), M
- `POST /scaffold` accepts `async:true` → returns `200 {ok:true, jobId, dir, url}` right after files are written;
  npm install + dev boot continue in a single-slot job; `GET /scaffold/status?job=` →
  `{state:'installing'|'booting'|'done'|'failed', elapsedMs, error?}`. (D owns the scaffold.ts split into
  `writeScaffoldFiles` + `installAndBoot`; A owns the routes.)
- Panel (C): store `ws/<sessionId>` **as soon as** `{ok:true, jobId}` arrives (no orphan second workspace);
  toast "Setting up the canvas… installing (12 s)" updating every 2 s; open the window at `done`.
  `/open` cold path gets the same treatment only if the smoke proves >15 s on a cold machine (measure first).
- **Acceptance:** fake npm that sleeps 30 s (test-injected `install` hook) → panel stores ws/ key immediately,
  window opens after `done`, exactly one workspace dir exists.

### V4-12 · P1 · The chat↔canvas loop is visible in the canvas — C+A+B, S
- Panel (C): on `host.onSession` busy transitions → `POST /agent-status {busy:boolean, label?:string≤60}`;
  on lifecycle `completed` → `POST /screens/sync {dir}` (V4-4 backstop).
- Service (A): forwards to `__dsCanvas.setAgentStatus({busy, label})`.
- Shell (B): toolbar chip "Designing…" with a pulsing dot while busy; on busy→idle, a 2 s "Updated" toast if any
  artboard reloaded during the turn.
- **Acceptance:** fake host flips busy → service receives both posts; shell snapshot `agentBusy` toggles.

### V4-13 · P2 · Dock the canvas beside the chat — A+C, M
Panel sends `dock:{x,y,width,height}` (from `window.screenX/screenY/outerWidth/outerHeight` of the host window,
best effort) with `/open {focus:true}`; service (`placeWindow`) puts Chrome adjacent on the right when
`screen.availWidth` leaves ≥ 640 px, else leaves placement alone; `/canvas dock` re-applies. Never on agent
paths. Acceptance: unit math test for placement; smoke screenshot of side-by-side layout.

### V4-14 · P1 · Security + hygiene (E12, E13) — D+A, S
- (D) New scaffolds: dev script `vite --host 127.0.0.1 --strictPort --port <p>`, config url
  `http://127.0.0.1:<p>/`; `preview` likewise. Existing workspaces untouched. win32 install spawns
  `spawn('npm install --no-audit --no-fund', {cwd, shell:true})` (single string, fixed literal) → no DEP0190.
- (A) Defense in depth: `PUT /screens`, `PATCH /view`, `POST /export`, `POST /critique`, `POST /screens/sync`
  require `dir` to contain a `.design-studio.json` (→ `400 {error:'not a design workspace'}`).
- Acceptance: scaffold test asserts the dev script string; service test: PATCH /view on a plain temp dir → 400.

### V4-15 · P1 · Resilience — A+B, M
- Per-screen Retry (A): before re-navigating, if the workspace config url is loopback and unreachable,
  `ensureDevServer(configUrl,{dir})`; card text while starting: "Starting the dev server…".
- Missing workspace (A): `/open {dir}` on a non-existent dir → `200 {ok:false, code:'WORKSPACE_MISSING',
  error:'The canvas folder <dir> no longer exists.'}`; panel (C) offers "Create a new canvas" and clears `ws/`.
- Capture vs drag (B): `beginCapture` cancels any `boardDrag` (`finishBoardDrag(true)`) and pan `drag`.
- Mode toggle feedback (B): after `mode-request`, toolbar shows the requested segment as pending; if no
  `setMode` push arrives within 1500 ms, revert and `showToast({kind:'warn', text:'Mode change refused'})`.
- Bridge health (A, for E17): `/state.shellBridge: {authority:boolean, lastCommandAt:number|null}`; integrator
  runs a 20× open/pan loop asserting view.json camera is written every time; root-cause if any miss.
- Acceptance: each bullet one test in the owning lane's suite; E17 loop in `tests/v4-live.test.ts`.

### V4-16 · P1 · Test honesty (E14) — D (+every lane adds its regression pins), S
- New `tests/helpers/chrome.ts` exporting `chromePath()` that reuses the product's resolver (export the
  discovery function from browser.ts as `resolveChromePath()` — A adds the export, D consumes). Every live test
  file replaces its `const chrome = process.env.DS_CHROME_PATH ?? '<mac path>'` line with the helper.
- `DS_REQUIRE_CHROME=1` turns every "Chrome unavailable" skip into a failure; the integrator and P4 run with it.
- Regression pins required: E1/E2 (V4-1), E3 (presets gone), E4 (V4-2), E5 (V4-3), E7 (V4-5), E9 (V4-7).
- Acceptance: on Windows with `DS_CHROME_PATH` unset and Chrome installed, live suites run (0 skips).

### V4-17 · P2 · Artboard rename — A+B, S
Context-menu "Rename…" → inline input over the header → `{type:'screen-rename', screen, title≤120}` → service
single-entry read-modify-write of screens.json (`renameScreen(dir,id,title)` in screens.ts, atomic tmp+rename,
re-read immediately before write) → V4-4 push. Documented race: an agent write in the same ~5 ms window wins.

## 3. Message/route contract summary (frozen for parallel work)

Shell → service (`__dsCanvasSend`), additive to §C + SPEC-V3:
`{type:'screen-hover',screen,x,y}` · `{type:'screen-hover-end'}` · `{type:'screen-pick',screen,x,y,additive?:boolean}` ·
`{type:'screen-menu',screen,action:'send-to-chat'|'reload'|'reset-position'|'export-png'|'export-pdf'|'copy-path'}` ·
`{type:'screen-rename',screen,title}` (P2).
REMOVED from shell emission (service keeps tolerating): `layout`, `fit-size`, `viewport`.

Service → shell (`__dsCanvas.*`, all return boolean):
`setNotice({id,kind,text})` · `showToast({kind,text,copy?})` · `setAgentStatus({busy,label?})` · `setAgentInput(on)` ·
`revealScreen(id)`. Toolbar snapshot gains `notices[]`, `toast|null`, `agentBusy`, `agentLabel`, `modePending`.

In-frame (PICK_SCRIPT): `__dsOverlays(visible)` · `__dsHoverAt(x,y)` · `__dsHoverEnd()`.

HTTP (bearer, 200-business/400-malformed house rule):
`GET /picks?since&wait` · `POST /picks/ack {seq,label}` · `POST /screens/sync {dir}` · `POST /agent-status {busy,label?}` ·
`POST /scaffold {…, async:true}` + `GET /scaffold/status?job=` · `/open` body gains `focus?:boolean`, `dock?:{x,y,width,height}` ·
`/state` gains `registryError`, `shellBridge`.

## 4. Workstreams (file-disjoint; parallel; integrator last)

| WS | Owner model | Decisions | Owns (only these files) |
|---|---|---|---|
| **A · service core** | Qwen 3.8 xhigh | V4-1(svc), 2, 4(svc), 5(svc), 6(in-frame+routing), 7(svc), 8, 10(svc), 11(routes), 12(svc), 14(route guard), 15(svc), 17(svc) | service/browser.ts, service/main.ts, service/screens.ts, service/view-state.ts, service/export.ts, service/last-workspace.ts, service/browser-control.ts, **new** service/screens-watch.ts, **new** service/pick-queue.ts, **new** tests/v4-service.test.ts, **new** tests/v4-live.test.ts |
| **B · shell** | Qwen 3.8 xhigh | V4-1(toolbar), 4(notice), 5(toast), 6(emitter), 7(shell API), 9, 10(menu UI), 12(chip), 15(shell), 17(UI) | viewer-client/src/** (canvas-controller.js/.d.ts, Toolbar.tsx, toolbar-types.ts, main.tsx, index.css), service/viewer-ui.ts, service/viewer-assets.generated.ts (via `npm run build:viewer` only), tests/viewer-ui.test.ts, tests/stock-controller.test.ts, tests/canvas-zoom-routing.test.ts (service/viewer-server.ts and its CSP stay untouched) |
| **C · panel** | Qwen 3.8 xhigh | V4-4(toast), 5(pickLoop), 8(focus flag), 10(screen chip), 11(panel), 12(panel), 13(panel), 15(missing ws) | panel/main.ts, panel/api.ts, panel/mode.ts, panel/attach-dialog.ts, panel/styles.css, shared/harness-text.ts, README.md, tests/mode*.test.ts, tests/panel-open.test.ts, tests/attach-dialog.test.ts, tests/status-height.test.ts, tests/server-stop.test.ts |
| **D · scaffold + test infra** | Qwen 3.8 high | V4-3, 11(scaffold split), 14(scaffold), 16 | service/scaffold.ts, tests/scaffold.test.ts, **new** tests/helpers/chrome.ts, the single `const chrome =` line in each live test file, docs/smoke/run-smoke.mjs (V4 smoke extension) |

Rules: no `npm run build` except the integrator (B runs `build:viewer` only); contract §3 is frozen — a lane
needing a change files a `FORK-MERGE:` note, never edits another lane's file; no new dependencies.
Integrator (Qwen 3.8 xhigh): full build, `npm run check` with `DS_REQUIRE_CHROME=1`, E17 20× loop, CHANGELOG.
Smoke (Sonnet 5.5): extend run-smoke.mjs — 3 screens (desktop, phone, tall phone) → click each header →
screenshot; pick → chip timing; agent writes a 4th screen → appears ≤3 s; break screens.json → banner;
export after activations → PNG sizes == registry; screenshots at fit-all, 100%, and with the context menu open.
Code QA (Qwen 3.8): diff vs this spec + fence.

**Sequencing vs P2.5:** V4 P0+P1 land **before** P2.5 (comments/retype/versioner) — both touch browser.ts,
main.ts and the controller, and P2.5's pins/retype ride the same overlay + hover plumbing V4-2/V4-6 build.

## 5. Fence — what V4 must NOT become

- **No visual editor:** no element drag/resize/align, no properties/style panel, no in-canvas CSS editing, no
  layers tree. Edit mode stays "point → chip → the agent edits the file".
- **No collaboration / hosting:** no share links, no remote sync, no accounts, no comment server, no telemetry,
  nothing listening beyond 127.0.0.1 (V4-14 tightens this).
- **No embedding the canvas inside OpenChamber** (the Chrome window + CDP is the pick mechanism); dock (V4-13) is
  window placement only.
- **No new runtime dependencies**, no HTML parser, no framework in the shell beyond the existing React toolbar.
- **No undo stack, no versioner** (that is P2.5 D11, unchanged).
- **No auto-send to the agent:** picks, screen chips and critique only land in the composer via an explicit user
  gesture; agent-status and sync are display-only.
- **No change** to screens.json §A schema, view.json schema (D5), the CSP string, or the sandbox token list.

Any V4 diff crossing this fence fails code QA by definition.

## 6. Exit criteria (P3 re-review)

All P0 decisions merged with their acceptance tests green under `DS_REQUIRE_CHROME=1` on Windows; Sonnet smoke
screenshots attached under `docs/smoke/v4/`; E15/E16/E17 either fixed or measured-and-closed with numbers;
CHANGELOG appended. Then P4 (real OpenChamber install, acceptance 1–9 incl. host-in-the-loop `/canvas <brief>`).
