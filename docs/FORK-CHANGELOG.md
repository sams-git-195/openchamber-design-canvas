# Fork changelog — "Design Canvas"

Append-only log of what each phase changed. Other phases append entries here;
keep them in phase order.

## P0 — cross-platform portability (committed)

- `service/browser.ts`: per-OS Chrome discovery (`DS_CHROME_PATH` wins; win32
  probes Program Files / %LOCALAPPDATA%; darwin keeps the .app bundle; linux
  probes google-chrome/chromium/snap/PATH), win32 orphan reaper via
  PowerShell `Get-CimInstance Win32_Process` + `taskkill`.
- `service/project-server.ts`: win32 dev-server identity/stop via
  `netstat -ano` PID verification before `taskkill /T /F`; POSIX pgid branch
  intact.
- `service/scaffold.ts`: `spawn('npm', …)` → `npm.cmd` on win32.
- `scripts/build-viewer.mjs`: `TMPDIR ?? '/tmp'` → `os.tmpdir()`.
- `package.json` test script: cmd-safe double-quoted glob
  `node --test --test-concurrency=1 "tests/*.test.ts"`.
- CI (ubuntu) stays the macOS/Linux-side gate.

## P1-panel — panel/identity/harness copy/README (this lane)

- Manifest identity (decision 1): package `openchamber-design-canvas` 0.2.0,
  `panel.id` `design-canvas`, `panel.name` `Design Canvas`, `page.title`
  `Design Canvas`, `commands[0].name` `canvas`
  ("Start or toggle the design canvas and attach design context"),
  `statusSection.title` `Canvas`, `statusSection.requiresProject` `false`.
  (Line `service.provides: ["browser"]` kept on purpose — see README
  coexistence note.)
- `providerId` `design-studio` → `design-canvas` at every panel site:
  `projectReferenceChip`, `fileReferenceChip`, `buildModeChip` (mode.ts),
  `buildAttachPayload` (attach-dialog.ts), `startDesignSession`'s
  `host.startSession` call (main.ts). Service-side sites belong to P1-screens /
  P1-browser / P2.
- Panel model per spec §F: `resolveCanvasTarget` (pure) with `workspace` /
  `new` targets (no refusal state — decision 2); `ws/<sessionId>` =
  `{dir,name}` storage; slug = kebab(brief)+session-id tail, sanitized,
  ≤40 chars, clash-avoiding against `GET /workspaces` dirs; scaffold into
  `<service root>/<slug>` (the panel gets the root from `GET /workspaces`,
  NEVER constructs the Documents path itself — decision 3).
- `wsReady = Boolean(config?.url)` with `isLoopbackUrl` gating the row
  Start/Stop control; separator/drive-letter-case normalized path compares
  (`normalizeDirPath`/`sameDirPath`/`pathContains`); cached single-pass
  `host.storage.keys()` ws/ scan joined to `/workspaces` rows (audit #19);
  rows never hidden — absent workspace shows Start ("Create canvas");
  row carries play/edit toggle + active-screen dropdown + Focus, all from
  `GET /state`; page "Your design work" = `/workspaces` rows; open a
  workspace = reuse its session via `host.openSession` when mapped, else a new
  session titled with the workspace name (carrying the open prompt).
- `/canvas` args extended: `on|off|play|edit|<type>|<brief>`; `play|edit`
  → `POST /mode`; `<brief>` → create workspace + Design Mode ON (no second
  session — the chat you typed in designs, acceptance 2).
- `buildModeChip` per decision 4 + chip budget: mode state → workspace path +
  screens protocol → screens list (cap 40) → TRIMMED rules (IDENTITY +
  DESIGN_AUTHORITY + VERIFY_PROTOCOL only); the full craft rulebook ships via
  `designSessionPrompt` instead. Text capped at 16000.
- Pick chip: adds `Screen: <id>` + `Screen URL` (text) and `data.screen` /
  `data.screenUrl` (spec §F).
- Decision 4b: one-time first-run toast (`ws-permission-notified` flag) about
  approving out-of-folder edit permissions.
- Decision 4c: `startDesignSession` passes `projectId` ONLY when a registered
  project contains the workspace dir (the "register Design Canvas root once"
  upgrade path); otherwise `host.startSession` is called WITHOUT `projectId`.
- Removed: NEEDS_PROJECT refusals (resolveDesignCommand / scaffoldCurrentProject /
  startNewDesign), registered-project list machinery in the panel
  (projectRows/designChatRows/designWorkRows/Page dir selector), the
  `ensureHarness` call from the session start (decision 5 — no plugin writes).
- New api.ts service wrappers, coded exactly to spec §B shapes:
  `getWorkspaces()` → `GET /workspaces` → `{root, workspaces:[{dir,name,url?,screens?}]}`;
  `getScreens(dir)` → `GET /screens?dir=`; `putScreens(dir, registry)` →
  `PUT /screens?dir=`; `setMode(mode)` → `POST /mode {mode}`;
  `openWorkspace({dir, screen?})` → `POST /open {dir[,screen]}`.
  `LiveState` gains `mode`, `screens`, `activeScreen`, `lastPickScreen`
  (see "P2 reconcile" below for the exact coded contracts).
- `shared/harness-text.ts`: `DESIGN_WORKSPACE_NOTE` rewritten for the canvas
  workspace (absolute-path discipline + screens.json protocol + index.html
  redirect). Other exports untouched.
- README replaced with the fork README (what Design Canvas is, Claude-canvas
  parity, no-project workspaces, win/mac/linux matrix, disable-the-original
  coexistence note, first-run permission note); license/attribution notices
  kept.
- Tests updated (this lane owns them): manifest (new ids/copy/requiresProject
  false + no-rail-collision pin), mode, attach-dialog, mode-open, panel-open,
  adversarial/design-work-omit-2026-10-14 (intent preserved: omission rules
  now apply to /workspaces rows — rows never hidden, exact-dir join matching,
  error precedence, purity).

### P2 reconcile notes (from P1-panel)

- Exact request/response shapes P1-panel coded against:
  - `GET /workspaces` → 200 `{ root: string, workspaces: [{ dir, name, url?, screens? }] }`.
  - `POST /scaffold {dir, type, direction?, fidelity?, brief?, designSystemId?}` →
    200 `{ ok: true, url, files }` | `{ ok: false, error }` (unchanged from v1).
  - `GET /screens?dir=` → 200 normalized `{ version, screens: [{id,file,title,width,height}] }` | 400 `{error}`.
  - `PUT /screens?dir=` + full registry body → 200 `{ path }` | 400 `{error}`.
  - `POST /mode {mode:'edit'|'play'}` → 200 `{ ok, mode?, error? }` (in-memory echo).
  - `POST /open {dir, screen?}` → 200 OpenResult
    `{ ok, url, title, settled, started?, error? }` (config url authoritative;
    `screen` = in-memory activation on a warm window — this is the panel's
    active-screen dropdown mechanism; please confirm `setActive` is what
    service-side implements).
  - `GET /state` → LiveState + `{ mode, screens: [{id,title,url,width,height,active}], activeScreen }`
    and `lastPickScreen` (the screen id of the last pick, so the pick chip can
    carry `Screen:`).
- `panel/styles.css` is out of this lane: the new row controls
  (`ds-play-toggle`, `ds-screen-select`, `ds-focus`) reuse existing classes
  with a `// FORK-MERGE` marker in main.ts — P2 should give them a styling
  pass.
- Tests not owned by this lane now drift: `server-stop`, `status-height`,
  `root-workspace-breaker`, `reference-breaker`, `reference-draft` may pin the
  pre-fork panel. P2 reconciles them against spec §F (seams kept:
  `setProjectDirectory` falls back to the chat dir when no workspace is bound,
  so `requestDevServerStop`/`refreshServerStatus`/`clickServerControl`
  behave as before for those fixtures except the create-canvas first-use path).