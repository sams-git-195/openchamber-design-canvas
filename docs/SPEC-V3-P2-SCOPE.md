# SPEC-V3-P2-SCOPE — the BINDING P2/P2.5 contract (P1.5 gate output)

Author: P1.5 spec gate (qwen3.8-flash#xhigh). Reviewed against the committed P0 HEAD
(`e2d497c`, clean worktree `../.dspec-v3-review`) and the SDK contract
(`@openchamber/sdk/dist/contract.d.ts`). P3 holds every P2/P2.5 diff against the numbered
decisions below. §A–§H of `FORK-DESIGN-CANVAS.md` are untouched; where §B/§C need extension,
this doc's reconciliation list (R1–R9) is the amendment and P3 reviews against it, not
against the frozen §-text.

## VERDICT

**P2/P2.5 scope: KEPT, MECHANISMS AMENDED.** Every P2 promise survives as a product goal,
but four promised mechanisms are false against real code and are replaced here:

1. **PDF via `Page.printToPDF` is impossible on the `#preview`/`ds-frame-*` iframe** — it is a
   page-target command and prints the SHELL document. Chosen: hidden throwaway page target in
   the same Chrome (D3). PNG stays on the existing shell capture trio (D2).
2. **Shell localStorage cannot ever survive** — triple-ephemeral (D5): `--incognito` +
   mkdtemp'd profile per launch + ephemeral random `127.0.0.1:<port>` origin, and the shell's
   CSP has `connect-src 'none'` so it cannot sync to anyone anyway. Chosen: service-side
   `<workspace>/.design-studio/view.json`.
3. **"Drag persists via `PUT /screens`" and "screens.json entries gain `{x,y}`" are dropped**
   — `service/screens.ts` (P1, in flight) already strips unknown fields by rebuilding entries,
   and a full-file `PUT` racing agent registry writes is a guaranteed last-write-wins loss.
   Chosen: positions live in `view.json`, `screens.json` stays pure design content (D6).
4. **`POST /export` cannot be synchronous** — panel→service rides `host.serviceRequest`
   (`GUEST_REQUEST_TIMEOUT_MS` = 20 000 ms, response cap 256 000). A 12-screen PNG+PDF walk
   blows it. Chosen: async job + status poll + single-flight (D4).

The "exactly 1 page target" pins in `tests/live-canvas-browser.test.ts` (lines 76, 125) are
reconciled, not broken: they assert at idle; export is atomic and leaves the count at 1 (R7).

## D0. Working-tree directive (decided here, executed by orchestrator)

- **P2, P2.5, P3, P4 run in the fork clone `C:\Users\samhe\Documents\github\openchamber-design-canvas`**, branch `canvas-fork`. Its local `canvas-fork` ref is stale (a2acdf1); the cutover bundle below fixes that.
- Cutover procedure (only after ALL four P1 agents have committed on `canvas-fork` in the old clone):
  1. `git -C <old-clone> bundle create <temp>/canvas-fork.bundle canvas-fork` (full history).
  2. In the fork clone: `git fetch <temp>/canvas-fork.bundle canvas-fork:refs/heads/canvas-fork-new`, then reset the local `canvas-fork` branch to that tip and `git checkout canvas-fork`. Verify a clean tree.
  3. Fresh `npm install` in the fork clone (it has no `node_modules`; confirmed). Do NOT copy node_modules.
  4. Old clone `openchamber-design-studio` becomes a READ-ONLY archive from this moment: no new commits. The `.dspec-v3-review` worktree (registered in the old clone) stays as the committed reference **until P3 APPROVED**, because P3 diffs need the `e2d497c` base and the P1 commits sit in the old clone until the bundle lands.
  5. After P5 (pushed to user's remote fork, install handoff done): `git worktree remove .dspec-v3-review` from the old clone, then **ask** the user before deleting the old clone. Ask-never-delete: this spec only recommends deletion once (a) `canvas-fork` is pushed to the fork remote and (b) the bundle file is kept or superseded by the remote. Old clone deletion is the user's call.
  6. If P3 findings need an old-tree bisect before cutover completes, the review worktree is the read-only tool; nothing writes there, ever.

## D1. P2 feature set (binding order)

Integration first (D9 seams, everything green), then view-state (D5), positions+drag (D6),
export (D2–D4), prompt rules + critique (D7–D8). P2.5 (D11) is gated on P3 approval of P2.

## D2. Export — PNG via the shell camera (mechanism a), per screen

The committed capture trio proves the pattern: `capture()` → `beginCapture` freezes the shell,
`normalizeCapture` clears the camera transform and sizes `#preview` 1:1, `Page.captureScreenshot`
with `{format:'png', fromSurface:true, captureBeyondViewport:true, clip:rect, scale:1}` grabs the
composited iframe region, and the `finally` restores camera + styles (test
"restores camera even on capture failure" pins this). For artboards this extends trivially:
`normalizeCapture(screenId)` translates the camera so the target `ds-frame-<id>` sits at origin
with scale 1 and sizes it to its natural `width×height`.

**Browser contract P1-browser must expose (retrofit flag R-CAP, see "P1 report"):**

```ts
capture(screen?: string): Promise<{ png: Buffer; width: number; height: number }>
// width/height = that SCREEN's natural artboard size from the registry, NOT the window viewport.
// zero-arg = ACTIVE screen (verify.ts/browser-control keep compiling).
// Serialized through operationTail; concurrent calls queue (no torn captures).
```

- `Emulation.setDeviceMetricsOverride` in `capture()` stays as written (artboard + 48/+256 margin),
  applied on the SHELL session. Screens taller/wider than the window are covered by
  `captureBeyondViewport:true`; 8192 cap is per §A.
- Export PNG per screen = `for (const s of screens) { const shot = await browser.capture(s.id); fs.writeFile(exports/<id>.png) }`.
  A screen whose per-artboard state is `error` (D9 R2) is skipped with `{ok:false,error:'screen not loaded'}`;
  the job continues (partial success is a valid outcome).

## D3. Export — PDF via a hidden throwaway page target in the SAME Chrome (mechanism b)

`Page.printToPDF` prints the top-level page of the session it is sent on. The canvas page is the
shell — printing it would print the zoomed camera grid, not a screen. The screens are iframes —
`printToPDF` takes no `frameId`. Therefore PDF must happen on a page target that loads the
screen URL **top-level**. Chosen target: a temporary page in the same Chrome instance, driven by
the existing hand-rolled `CdpClient` (it already does `Target.createTarget` +
`Target.attachToTarget {flatten:true}` in `attachNewPage`, and `send(method, params, sessionId)`
addresses any flattened session — no client change needed).

**New method, service/browser.ts (P2-A owns):**

```ts
/** Print one screen URL to PDF in a hidden throwaway page target. Never mutates canvas state. */
async printScreenToPdf(url: string, widthPx: number, heightPx: number): Promise<Buffer>
```

Exact call sequence (binding; runs inside `this.transaction` so it serializes against captures/
navigations; everything after step 1 is in `try/finally`):

1. Validate `isWebSafeUrl(url)` and reject embedded credentials (same gate as `navigateGuarded`).
2. `const { targetId: xid } = await cdp.send('Target.createTarget', { url: 'about:blank' })`.
3. `const { sessionId: xsid } = await cdp.send('Target.attachToTarget', { targetId: xid, flatten: true })`.
4. Immediately park it off-screen BEFORE any content exists: `const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId: xid })`; `await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: -32000, top: -32000, width: 1200, height: 900, windowState: 'normal' } })`.
5. `await cdp.send('Page.enable', {}, xsid)`. Register a session-filtered one-shot waiter for `Page.loadEventFired` where `event.sessionId === xsid` (the existing `once()` helper matches by method only — add a private `onceInSession(cdp, method, sessionId, timeoutMs)`; 15 000 ms budget, timeout is non-fatal). No `Runtime.addBinding`, no `addScriptToEvaluateOnNewDocument`, no `Target.setAutoAttach` on this session — the pick/probe world must NOT exist here.
6. `await cdp.send('Page.navigate', { url }, xsid)`; await step-5's waiter; then `await cdp.send('Runtime.evaluate', { expression: fonts-ready + double-rAF + STABLE_STYLE injection, awaitPromise: true, returnByValue: true }, xsid)` (same freeze approach as `applyStableMode`, run raw on `xsid` — no ArtifactContexts involvement).
7. `const { data } = await cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: false, scale: 1, paperWidth: widthPx / 96, paperHeight: heightPx / 96, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 }, xsid)` → `Buffer.from(data, 'base64')`. If the document is taller than the screen height, printToPDF paginates at the same page size — acceptable and documented (a screen is fixed-size by §A; overflow is a gate finding, not an export concern).
8. `finally`: `await cdp.send('Target.closeTarget', { targetId: xid }).catch(() => {})`; remove the event listener.

Why the app-window assumptions survive: `handleTargetGone` ignores destroy/detach events whose
`targetId`/`sessionId` don't match the app's (`this.targetId`/`this.sessionId`);
`ArtifactContexts`' `Target.attachedToTarget` handler only adopts `type === 'iframe'` sessions and
ignores the `page` attach; discovery events for the extra target have no handlers. `bringToFront()`
after the export restores the user's window focus.

**Rejected mechanisms:**
- *(c) navigate the existing artifact frame to each screen URL one at a time and reuse active-capture:* mutates the user's live canvas (frame histories, recorded per-screen URLs, `pendingNavigation` tracking), races the `changed`→`refreshArtifact` flow, and any crash leaves a wrong screen loaded. Rejected.
- *printToPDF on the shell page with camera flattening:* prints the canvas composition, not a screen; multi-page output would be a screenshot collage. Rejected.
- *second `--headless=new` Chrome process + own CDP connection:* cleanest isolation (zero window flash, doesn't couple export success to the live window) but needs a second process lifecycle, second profile (`ds-chrome-export-`-prefixed so `reapOrphanChrome`'s `ds-chrome-` match covers it), and exporting `CdpClient` from browser.ts. **Kept as the sanctioned contingency**: if P4 smoke shows the parked window's flash or `createTarget` under `--incognito --app` misbehaves (e.g. spawns a tabbed window that steals focus), switch `printScreenToPdf`'s internals to the headless child WITHOUT changing any route shape. Documented in README risk section either way.

## D4. `/export` routes — async job (the 20 s host cap makes synchronous illegal)

New module `service/export.ts`; route wiring in `service/main.ts` (P2-A). House rule holds:
business failures are `200 {ok:false,error}`, never 4xx/5xx except malformed input (400).

```
POST /export  body { dir: string(abs), screens?: string[], formats?: ('png'|'pdf')[] }
  → 200 { ok: true, jobId: string, screens: number, formats: [...] }
  preconditions (→ ok:false): browser window open (getBrowser() non-null, windowOpen), dev
  server up (ensureDevServer, same probe as /open), screens resolve. One export at a time:
  a second concurrent POST returns { ok: true, jobId: <current> } (join, never queue-forever).
GET /export/status?dir=&job=   → 200 { state: 'running'|'done'|'failed', startedAt,
  results: [{ screen, png: {ok:true,file}|{ok:false,error}|undefined,
              pdf: {ok:true,file}|{ok:false,error}|undefined }] }
```

Single-slot job state in module memory (a new export replaces a finished one; a running one is
joined). Files: `<workspace>/exports/<screenId>.png` / `.pdf`, `mkdir -p`, overwrite allowed
(git is the history layer; parity line 148 owns that). Writes go tmp+rename. The job loop: for
each screen → PNG (D2) → PDF (D3), all serialized through `browser.transaction` so the user's
canvas input is frozen exactly as during a normal capture and camera state is restored by the
existing finally-paths. `/canvas export` (panel, D7-C) is a thin client: POST → poll status every
700 ms → toast summary with file paths.

## D5. View-state persistence — `<workspace>/.design-studio/view.json` (service-side; decided against three alternatives)

Evidence against the alternatives:
- **Shell localStorage:** the capability origin is `http://127.0.0.1:<ephemeral-port>` — port from `listen(0)` and the 64-hex path are fresh every `startViewerServer` (viewer-server.ts), Chrome runs `--incognito` on an mkdtemp profile removed at quit (browser.ts `launch`/`reapProfile`), and CSP `connect-src 'none'` forbids syncing out. Storage dies on every reopen — it could not even satisfy within-session reloads. Rejected.
- **Service memory only:** lost on OpenChamber/service restart; acceptance 6+9 demand reopen-survival. Rejected as sole store; kept as the `lastWorkspace` echo it already is.
- **screens.json:** contention, see D6. Rejected for positions.

**Schema (binding):**

```json
{ "version": 1,
  "camera": { "mode": "manual", "scale": 1.0, "panX": -120, "panY": -40 },
  "positions": { "home": { "x": 0, "y": 0 }, "checkout": { "x": 1568, "y": 0 } },
  "mode": "edit" }
```

- `camera`: the four keys `getCamera()` already returns (mode fit|manual, scale, panX, panY);
  scale stored 0.1–3; the committed shell `restoreCamera` validates exactly this subset
  (layoutMode undefined → skips setLayout) — restore is `__dsCanvas.restoreCamera(camera)`.
- `positions`: artboard top-left in CAMERA-space natural px (§7: never baked with scale).
  Values finite, clamped ±32768. Missing key = auto-grid (D6). `null` value = "back to auto".
- `mode`: workspace-persisted edit/play; absent → 'edit' (decision #8's default unchanged).
  This extends "in-memory echo" (§B /mode) additively; see R1/R6.

**Write path (all shell→service over the existing `__dsCanvasSend` binding — the one channel CSP
leaves open; new command types, §C-style, validated server-side):**

- `{type:'camera-changed', camera:{mode,scale,panX,panY}}` — shell emits it debounced (≥400 ms
  after last paint; wheel/pan/drag-zoom all funnel through `paint()`), service coalesces writes
  on a 300 ms per-dir queue.
- `{type:'screen-move', screen, x, y}` — emitted on drag `pointerup` only (live drag is
  in-memory), see D6.
- Service persistence: `service/view-state.ts` (P2-A, new): `readView(dir)`,
  `mergeView(dir, patch)` (read-modify-write serialized through a module-level promise chain per
  dir), atomic tmp+rename. Corrupt/missing file reads as the empty default, and the next merge
  rewrites valid JSON — same silent-normalize philosophy as screens.ts.

**Restore path:** on `/open` (cold or warm) the service sends, in ONE `transaction` after the
shell reports `ready`: `__dsCanvas.setScreens(list-with-positions)` → `__dsCanvas.setMode(mode)`
→ `__dsCanvas.restoreCamera(camera)`. Order is binding (bbox must exist before pan/zoom is
meaningful; R9). Panel-only restart with no shell (window closed) reads view.json at next launch.

## D6. Positions + drag-reposition — view.json ownership, per-key merge, contention ruled out

The promise "screens.json entries gain optional {x,y}, normalize accepts+persists, drag persists
via PUT /screens" is **withdrawn** (verdict items 3, and P1-screens' committed direction:
`normalizeScreenEntry` rebuilds entries from five named fields — x/y would be stripped, so
insisting on it would force a pointless §A-adjacent change AND create the contention below).
This is a STRONGER form of Claude's canvas.json separation: artboard *content* = its HTML file,
*registry* = screens.json (design content, agent-writable), *layout state* = view.json (user
canvas state). Moving an artboard remains "data, not redraw".

- Drag (shell, P2-B): `pointerdown` on `.ds-ab-title` (shell chrome, safe in both edit and play
  — the iframe never sees it) → live update `x,y` (Δ screen px / camera scale) → `pointerup`
  sends `screen-move`. Sections are absolutely positioned in `#camera` at `{x,y}`.
- Auto-grid fallback for unpositioned screens (deterministic, stable under append): flow rows,
  gap 48 px (§7), row budget 3200 px; walk array order, place at `(cursorX, rowTop)`, wrap rows.
  A newly added screen lands at the end of the flow and NEVER shifts positioned siblings;
  unpositioned siblings reflow only among themselves.
- **Contention rule (binding):** two writers, two files — agent writes `screens.json` (via
  `PUT /screens`, full-registry, per §B); user/drag writes `view.json` positions (merge per
  screen key). They can never clobber each other. Agent-driven placement: `PATCH /view` (below)
  merges per key; a race on the SAME screen key is last-write-wins, which matches Claude
  semantics and is documented, not defended.
- **Routes (P2-A):** `GET /view?dir=` → 200 view.json-or-default (absolute-dir gate like /stat);
  `PATCH /view?dir=` body `{camera?, positions?: {id:{x,y}|null}, mode?}` → 200 `{ok:true}` /
  malformed 400. No PUT — nothing may full-overwrite view.json except the service's own merge.
  `GET /screens` is untouched; `setScreens` payloads gain optional `x,y` fields merged in from
  view.json service-side (§C's screens list shape extends additively).

## D7. Artboard headers, panel commands and their wiring

- (A) Header format, shell (P2-B): `{n} · {title} · {width}×{height}` (Claude's "artboard 1 of 7"
  analog), 1-based array order; `.ds-ab-title` + `.ds-ab-size` slots from §C carry it.
- (B) `/canvas export [png|pdf]` — panel command (P2-C): resolve `ws/<sessionId>` dir → D4 job →
  poll → host.toast with paths.
- (C) `/canvas critique` — P2-C panel + `POST /critique {dir}` service route (P2-A): server-side
  loop over screens calling the per-screen probe — `getProbe(screenId)` evaluates
  `window.__dsProbe()` in that frame's context (no camera move, no resize; the frame's own
  `innerWidth/scrollWidth` ARE its artboard size) → existing `runGateReport` (service/gates) per
  screen → bounded digest `{screens:[{screen,state,url,width,height,gates:[{id,status,findings≤3}],probeCounts}]}`
  (first 12 screens max, `truncated:true` beyond). Panel composes it (≤16 000 chars,
  `GUEST_COMPOSE_TEXT_MAX`) into the chat via existing compose/attach paths as a review REQUEST
  to the agent, e.g. header "Canvas critique — deterministic gate digest (advisory):" + table +
  the standing VERIFY_PROTOCOL line that the 0–10 critique is advisory and never optimized to.
  The human-authored review text is the AGENT's job in-chat; the service guarantees the "gate
  backed" part.

## D8. Variants + size prompt rules — exact binding wording (P2 re-applies)

Owner chain: `shared/harness-text.ts` + `panel/mode.ts` are P1-panel's live files; P2-C appends
to them AFTER P1 commits, and owns the wording below verbatim. New export in harness-text.ts:

```ts
export const CANVAS_PROTOCOL = [
  'Screens are artboards on one shared canvas. The workspace-root screens.json registry maps each screen to its own .html file and its natural size: { "version": 1, "screens": [ { "id", "file", "title", "width", "height" } ] }.',
  'Add or change a screen: write its HTML file, then update its screens.json entry (ids ^[a-z0-9][a-z0-9-]{0,30}$, sizes 200–8192, file relative *.html inside the workspace). Rewriting one screen never rewrites siblings.',
  'Positions are not design content: never write x/y into screens.json; the canvas stores them in .design-studio/view.json and the user arranges artboards by hand.',
  'Variants = side-by-side artboards. "Two directions", "options", "alternatives" mean 2–3 complete sibling screens (ids like home-a, home-b), each its own file + entry, each at the same size unless the brief says otherwise. Never stack variants inside one file, never hide alternates behind toggles.',
  'Responsive = one artboard per real size. Presets: 390×844 phone · 768×1024 tablet · 1280×800 desktop (default) · 1440×900 large desktop · 1080×1080 social post · 794×1123 A4 print at 96 dpi. "Make it responsive" means three artboards of the same screen (phone, tablet, desktop). Other sizes are allowed within 200–8192.',
].join('\n');
```

Placement: full text into `designSessionPrompt` (session start); a trimmed copy (lines 1–2 and
the preset numbers of 4–5) inside `buildModeChip`'s rulebook block, under §F's chip budget order
and the 16 000 cap. README (P2-C) uses the three comparison cases from parity line 152 as usage
examples with these numbers.

## D9. Reconciliation list (residual §B↔§C mismatches; P2-A unless noted)

- **R1 mode round-trip:** §B "push + in-memory echo" never learns the shell refused
  (`setMode` can fail under `captureState`). Binding: `Browser.setMode` awaits
  `shellEval('__dsCanvas.setMode(m)')` (P1-shell per §C returns nothing/false); treat `false`
  strictly, retry once, else echo the REQUESTED mode but flag `/state.modeApplied:false`.
  P2-B makes `__dsCanvas.setMode` return a real boolean.
- **R2 per-screen state surface:** §C has `setScreenState` but §B's `BrowserState.screens` entry
  shape has no state field. Binding: extend entries to `{id,title,url,width,height,active,
  state:'loading'|'ready'|'error',message?}` (additive; /state is a superset, P2-A + its tests).
  Critique (D7-C) and export (D4) consume it.
- **R3 `retry` scoping:** committed `canvasCommand('retry')` re-navigates `requestedUrl` (the
  shell). Post-P1 it must accept `{screen}` and reload only that artboard's src; P2-D integration
  test: retry(B) never changes A's recorded URL.
- **R4 verify/resize vs fixed artboards (§11):** `browser.resize` during a canvas session is a
  TEMPORARY layout override of the ACTIVE screen's frame, always restored (verify.ts already
  saves+restores camera+viewport); it must NEVER persist into screens.json. `runVerification`
  gains optional `screen` (zero-arg = active, so verify.ts call sites keep compiling, per §11).
- **R5 capture size reporting:** during a canvas session `viewport()` returns the ACTIVE
  screen's natural size so browser-control's `handleCapture` (`width/height` + verification
  summary) stays truthful.
- **R6 camera extent validation:** browser.ts `restoreCamera`'s inline validator keeps
  `width/height/nominalHeight 100–8192`; §C widens the GRID-BBOX extent to 64–65536. P2-A aligns
  the browser-side validator to §C's numbers for the bbox fields while per-screen sizes stay
  200–8192 (§A).
- **R7 page-target invariant:** `pageTargetCount()==1` pins (live-canvas lines 76/125) assert at
  idle and stay untouched; D3's target is transient. NEW pins (P2-A): after each
  `printScreenToPdf` and after each `/export` job, `pageTargetCount()` is 1 and
  `getCamera()` deep-equals its pre-export value; a mid-export thrown error must still find the
  export target closed (inject-failure test like the capture one at line 244).
- **R8 lastWorkspace home:** positions/camera/mode persistence extends `service/last-workspace.ts`
  (P1-screens' new module) — P2-A reuses it; no parallel state module may appear.
- **R9 warm-push ordering:** `setScreens` → positions → `setMode` → `restoreCamera`, one
  transaction after `ready`; repeated `/open` idempotent (no double artboards — `setScreens`
  replaces the whole list per §C).

## D10. Screens.json purity note

`GET /screens` answers §A shapes; nothing in P2 writes x/y there; P3 greps the service tree for
position writes outside `view-state.ts`. If P1-screens shipped an x/y pass-through despite
normalize stripping, P2 removes the field from the wire shape (retrofit, see report).

## D11. P2.5 scope (only after P2 is P3-APPROVED) — binding, and its fence

- **In-place text retype (`POST /retype {dir, screen, selector, text}`):** double-click on a text
  element in EDIT mode (PICK_SCRIPT extension: dblclick handler, `contentEditable` on the live
  element, commit on blur/Enter → send `{selector, oldOuterHTML, newOuterHTML}` through the
  existing `__dsPick`-style binding path, reusing the `data-ds-overlay` hover-outline pattern for
  the editing caret box — the outline is already `position:fixed`, `popover:manual`, top-layer and
  probe-excluded, so a text-edit box can borrow its plumbing). Service: 1) snapshot the file to
  `<ws>/.design-studio/versions/<ts>/<file>` + `version.json {file,reason:'retype',ts}` (plain fs
  copy, no deps); 2) read the screen's source file from disk (screens entry `file`, via the
  existing `requireFile`-style confinement); 3) splice: replace `oldOuterHTML` → `newOuterHTML`
  ONLY on an EXACT, UNIQUE (count===1) substring match; 4) on match: write file (tmp+rename),
  toast; on NO match / multiple match / non-text node: revert the live DOM element, report
  "couldn't map to source — ask in chat", snapshot stays for git. **Selector-stability verdict:**
  the id-first/nth-of-type `selectorFor` is stable *within the live document tick* (it just
  locates the element to read `outerHTML`) and the FILE mapping does not use the selector at all
  — it uses the exact serialized substring; static Vite-served HTML with unmutated target nodes
  matches byte-for-byte. Guards: allowed tags only (`p,h1–h6,span,label,li,button,a,td,th,blockquote,figcaption`),
  element must have no element children (pure text) — otherwise refuse with reason.
- **Versioner:** `GET /versions?dir=&file=` → `[{ts,reason,files:[...]}]`; `POST /restore {dir,file,ts}`
  → copy back + `changed` event → artboard reloads via the per-screen refresh. Cap: keep last 30
  versions per workspace, prune oldest on write (bounded, silent). No git integration, no diff UI.
- **Pinned comments:** `<workspace>/comments.json` (design-visible content, root, per the parity
  map): `{version:1, comments:[{id:'c'+7hex, screen, x, y, selector?, text(≤1200), status:'open'|'resolved', createdAt}]}`.
  Shell renders pins inside each `ds-artboard` section (camera-space coords, counter-scaled so
  pins stay readable at any zoom — shell-side, NOT inside the iframe, so they survive screen
  navigation), popover reuse per the outline pattern; new bridge: `__dsCanvas.setComments(list)`
  service→shell; shell→service `{type:'comment-add', screen, x, y, text}` /
  `{type:'comment-resolve', id}` / `{type:'comment-send', id}` (the last builds the existing pick
  chip + note text and hands it through the panel's attach path = "Send to Claude" analog).
  Routes `GET /comments?dir=` / `PUT /comments?dir=` (validate+normalize like screens; writer is
  the service only — agent writes via chat/PUT like any file, no extra contention machinery).
- **SHARP FENCE — what P2.5 must NOT become:** not a visual editor (no element drag-resize-align,
  no properties panel, no style editing), not an HTML parser or dependency (splice-or-refuse only),
  not a collaborative/CRDT surface or comment server, not an undo-stack in the shell (the
  versioner is a snapshot list, git is history), not a prompt-injection channel (a comment never
  auto-sends to the agent; only the explicit user gesture routes it to the composer), not
  retype of structure or attributes (text nodes of listed tags or refusal). Any P2.5 diff growing
  beyond this fence fails P3 by definition.

## D12. P2 agent decomposition, ownership, ordering (fork clone, all on canvas-fork)

Rule of the old tree holds: agents touch ONLY owned files; parallel edits in ONE tree; nobody
runs `npm run build` except the integrator (P2-B alone runs `npm run build:viewer` — it owns the
generated asset file). Deepseek v4-pro #max for implementation, per governance table.

| Agent | Scope | Owns (in fork clone) | Model |
|---|---|---|---|
| P2-A service-core | D2–D7 routes/mechanisms, D9 R1–R8, view-state.ts, export.ts, browser.ts (printScreenToPdf, onceInSession, capture(screen), validators) | service/browser.ts, service/main.ts, service/artifact-context.ts (if R2 needs it), service/export.ts, service/view-state.ts, service/last-workspace.ts, tests/browser.test.ts, tests/service.test.ts, tests/live-canvas-browser.test.ts (new pins only), tests/view-state.test.ts (new), tests/export.test.ts (new, live) | deepseek-v4-pro#max |
| P2-B shell | artboard drag, headers `N · Title · WxH`, camera-changed/screen-move messages, setScreens x/y, setMode returns bool (R1), auto-grid | viewer-client/src/canvas-controller.js (+d.ts), service/viewer-ui.ts, service/viewer-assets.generated.ts via build:viewer, tests/viewer-ui.test.ts, tests/stock-controller.test.ts, tests/canvas-zoom-routing.test.ts | deepseek-v4-pro#max |
| P2-C panel+prompts | CANVAS_PROTOCOL wording, /canvas export+critique commands, chip budget re-apply, README usage examples | shared/harness-text.ts, panel/*.ts (api.ts, main.ts, mode.ts, attach-dialog.ts), tests/mode*.test.ts, tests/panel-open.test.ts, tests/harness*.test.ts, tests/manifest.test.ts, README.md | deepseek-v4-pro#max |
| P2-D integrator | green typecheck + FULL build + whole suite; cross-agent seams (R3/R9 tests); honest baseline-vs-new failure report | everything (last), no new design authority — deviations require a decision here or a flag to the gate | deepseek-v4-pro#max |

Ordering: P2-A, P2-B, P2-C run in parallel after cutover (D0); P2-D after all three report.
File-disjointness above is by construction; P3 rejects any diff that edits outside its row.
P2.5: two sequential agents (both touch main.ts/browser.ts) — P2.5-E comments (shell+routes),
then P2.5-F retype+versioner; each gets its own P3-style review gate.

## D13. P3 review requirements (what the reviewer must diff)

1. Every D-numbering + R-numbering has an implementation or a documented, gate-approved deviation.
2. screens.json purity grep (D10) + view.json merge-semantics test (agent write during simulated drag loses nothing).
3. viewer-server.ts byte-identical CSP (`connect-src 'none'` etc.) — no shell network surface sneaks in.
4. Export on REAL win32 Chrome: per-screen PNG dimensions == registry sizes; PDF pages == size/96 in; `pageTargetCount()` back to 1; camera+styles restored on the injected-failure path (R7).
5. Cross-platform branch audit on the new paths (no POSIX-only code in export/view modules).
6. Prompt wording pin (D8 exact strings in harness tests) and chip budget respected.
7. No new dependencies anywhere in P2.
8. Acceptance 9 (revised wording, FORK-DESIGN-CANVAS.md) demonstrable on the branch.

## D14. Risks (named, with contingencies)

- `Target.createTarget` in `--app --incognito` may briefly flash a parked window or land in a
  different browser context than the app's — sequence parks it off-screen at step 4 before
  content exists; context mismatch only affects which profile the page loads in (throwaway
  either way). Contingency: D3's headless child, route shapes unchanged.
- Screenshot of never-scrolled-to artboards: all `ds-frame-*` iframes load eagerly (src set at
  `setScreens`), compositor surfaces exist; OOPIF uncertainty is already absorbed by
  ArtifactContexts (§C audit #20). P4 smoke verifies a capture of an off-screen far-right
  artboard.
- Print memory at 8192×8192 paper (85 in) — within Chrome's print limits but slow; per-export
  30 s CDP timeout (`CDP_TIMEOUT_MS`) stays; timeout → per-screen `{ok:false}` not job death.
- view.json churn from wheel-heavy panning is bounded by the double debounce (400+300 ms) and
  tmp+rename writes; Vite watch already ignores `.design-studio/`? NOT verified — P2-A must add
  `.design-studio` to the scaffold `vite.config` watcher ignore (or a dev-server 404 probe note)
  so persisting view.json never triggers HMR reload storms. Integration-test owned by P2-A.
- `screen-move` x/y arrive from an unscaled drag math — a drag during a camera zoom race
  (scale changed mid-drag) could jitter position by Δ·scale; shell binds drag to the scale
  captured at pointerdown (P2-B, cheap).

## Report to the orchestrator: what the running P1 agents must hear

- **P1-screens: no change needed — your strip-by-rebuild normalize is now the BINDING behavior.**
  Do NOT add `{x,y}` to Screen; positions are moving to `.design-studio/view.json` (D5/D6). The
  spec sentence "screens.json entries gain optional {x,y}" is dead (I amend the parity section).
- **P1-browser: retrofit check, cheap:** `capture(screen?)` must return the ARTBOARD's natural
  size in `{width,height}` (R5) and `beginCapture/normalizeCapture/endCapture` must genuinely
  thread the screen id (D2). If you shipped active-only capture today, P2 finishes it — harmless,
  but report what you shipped. Add `windowOpen`/state surface per R2 if you touched getState.
- **P1-shell: two small promises to keep:** `__dsCanvas.setScreens` must tolerate entries WITH or
  WITHOUT `x,y` (P2 merges view.json positions into the existing §C list shape), and
  `__dsCanvas.setMode` should return a boolean accepted-refused (R1) — if it already returns
  undefined, P2-B revisits; harmless.
- **P1-panel: nothing structural**, but don't word the chip as "positions persist to screens.json";
  P2-C owns the final CANVAS_PROTOCOL wording (D8). Also: any `/canvas critique|export` parsing
  you pre-wired must survive being command-not-found stubs — P2-C completes them.
- Harmless-to-ignore if already frozen in their commits: everything else in this doc is P2-side.
