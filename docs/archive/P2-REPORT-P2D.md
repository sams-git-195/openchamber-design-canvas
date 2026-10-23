# P2-D integration report — 2026-10-17

## Landed (single integration pass on `canvas-fork`, HEAD d3486dc → this commit)

1. **CSP/CRLF shell-boot fix (TASK 1).** `service/viewer-server.ts` now computes the
   CSP `script-src` hashes over the CRLF-normalized inline-script text
   (`match[1].replace(/\r\n?/g, '\n')`) — the exact text Chrome verifies after input
   byte-stream preprocessing, so a CRLF source file can never boot-block the shell.
   Cross-platform by construction (hash normalization, no OS branch). Added
   `.gitattributes` (`viewer-client/** text eol=lf`, `*.ts text eol=lf`) pinning LF for
   every source whose bytes feed CSP hashes or the viewer-build determinism digest;
   converted `viewer-client/src/canvas-controller.js` (and all `.ts` +
   `viewer-client/**`) to LF in-worktree. New pin in `tests/viewer-server.test.ts`:
   each CSP entry == sha256 of the `\n`-normalized served script text, with a
   CRLF regression control (hashing raw CRLF bytes can never equal the entry).

2. **The one rebuild (TASK 2).** `npm run build:viewer && npm run build` — bundles
   carry every P1/P2 source: service/main.js spot-greps `/export` `/view` `/critique`
   `/open`, `printScreenToPdf`, `onceInSession`, `restoreWorkspaceView`, and the CRLF
   normalization regex; panel/main.js carries CANVAS_PROTOCOL verbatim + critique
   digest header + export poll strings. Viewer digest reproducible against P2-B's:
   JS 0d165aa6…, CSS aecb7c93… (byte-identical); VIEWER_CLIENT_INPUT_DIGEST updated to
   2d709482… (now computed over LF inputs — deterministic on both platform families).

3. **Full suite (TASK 3): 481 tests — 477 pass, 0 fail, 4 documented
   platform-capability skips.** `npm run typecheck` and `typecheck:viewer` exit 0.
   Every suite file is green; the 4 skips: reference-path symlink-escape pins ×2 +
   mode-0-unreadable pin (win32 needs developer mode / cannot express mode-0),
   project-server's SIGTERM-linger race (win32 taskkill is instant — no linger
   window exists). All four skip with explicit reasons and run on capable hosts.

4. **Mutant sweep (TASK 4): 15/15 CAUGHT** — see table below. Every documented
   mutant makes its breaker suite fail; guards alive.

5. **Witness seams (TASK 5, real Chrome, %TEMP% scratch, service spawned with
   OPENCHAMBER_SERVICE_PORT/TOKEN + in-process Browser):** see evidence below.
   Smoke artifacts: `docs/smoke/{home,pay}.png|pdf` (routed export) +
   `docs/smoke/canvas-fit-all.png` (full-shell screenshot at fit-all, 1600×963,
   both artboards).

## Mutant results (each env variant must FAIL its suite)

| File / env | Mutant | Result |
|---|---|---|
| live-canvas-breaker / LIVE_CANVAS_MUTANT | artifact-authorization | exit 1 CAUGHT |
| | payload-bound | exit 1 CAUGHT |
| | capture-finally | exit 1 CAUGHT |
| | server-path | exit 1 CAUGHT |
| | pointer-cancellation | exit 1 CAUGHT |
| | uncancelled-click-suppression | exit 1 CAUGHT |
| fit-page-breaker / FIT_BREAKER_MUTANT | height-growth | exit 1 CAUGHT |
| | stale-first-width | exit 1 CAUGHT |
| | numeric-mode-suspension | exit 1 CAUGHT |
| | capture-renderer-finally | exit 1 CAUGHT |
| nova-canvas-breaker / NOVA_MUTANT | child-routing | exit 1 CAUGHT |
| | widget-ownership | exit 1 CAUGHT |
| | child-default | exit 1 CAUGHT |
| | wheel-anchor | exit 1 CAUGHT |
| | wheel-units | exit 1 CAUGHT |

## Witness evidence (live, real Chrome)

- **(R) REST drag→persist→reopen:** POST /open ok+modeApplied; PATCH /view
  {camera:{manual,0.75,111,222}, positions:{pay:{1568,48}}} → GET /view round-trips;
  POST /close → POST /open ok; in-process reopen: live shell DOM
  `[data-screen="pay"]` style left/top == `1568px`/`48px` (setScreens bake carries
  x/y), `getCamera()` deep-equal {manual, 0.75, 111, 222} (restoreCamera applied).
  Real drag: screen-move pay→(2000,100) + camera-changed {manual,1.25,-50,40}
  persisted to view.json; close→reopen → DOM @ `2000px`/`100px`, camera deep-equal
  {manual,1.25,-50,40}.
- **(S) retry(B) preserves A:** live-canvas-browser pin green post-rebuild
  (retry(B) — A's identity + recorded URL untouched, exactly one B reload).
- **(E) /export e2e:** routed job done; home.png IHDR 1280×800, pay.png 640×900
  (registry sizes); home.pdf MediaBox 960×600 pt == 13.333×8.333 in == 1280/96 ×
  800/96; pay.pdf 6.667×9.377 in == 640/96 × 900/96; post-export
  `pageTargetCount()==1` and camera deep-equal pre/post (after quiescing the
  layout-qualification tail — house pattern; see residual below).
- **Residual (flagged, P2-A-declared):** a late post-open layout-qualification
  (async after reopen) re-applies fit/viewport over a fresh fit-all camera. P2-A's
  report already flags "post-qual values keep P1-shell semantics". Capture/print
  themselves restore fit-all perfectly (pinned). Not Windows-specific; recommended
  as a P3 review item (qualification should not clobber a user-chosen fit-all).

## Test-pin changes (each with reason)

- **status-height.test.ts** — 'the row keeps exactly two controls' → exactly FOUR
  controls + the one `<select>`: the shipped row has server-control + mode toggle +
  play/edit toggle + focus (P1-panel drift noted by P2-C); height reporting pins
  untouched and green.
- **server-stop.test.ts** — the 10 dead pins re-bound to the shipped
  workspace-first model: `setWorkspace({dir,name})` seeds the row's bound workspace
  (the click path is now create-canvas when unbound); trailing `setWorkspace(null)`
  per test (mode-open house hygiene). Adversarial intent preserved verbatim:
  stop-safety (unverifiable sessions fail closed), refusal announcements, poll-error
  retry-by-start, A→B→A generation guards, per-dir start bodies. Also 'Design
  Studio' → 'Design Canvas' in one message pin (fork identity rename).
- **project-server.test.ts / window.test.ts / reference-path.test.ts /
  project-files.test.ts / stock-nova-assets.test.ts / *-breaker.test.ts** — win32
  test-fixture portability: cmd-safe `node -e` envelopes (`nodeE` helper, POSIX form
  byte-identical), `killGroup` via `taskkill /T`, platform-truthy `groupGone`,
  win32 record shapes (`platform:'win32'`, port-owner verification), PowerShell
  process enumeration (replaces `ps|pgrep`), `fileURLToPath` (fixes the `C:\C:\…`
  joins), junction fallbacks for scratch node_modules + directory-symlink escapes
  (Node reports junctions as symlinks — the escape guard still fires), capability
  probes gating fixtures that literally cannot exist without developer mode
  (plain FILE symlinks, mode-0 files), breaker scratch copy-sets extended with the
  new `view-state`/`screens` modules. No assertion was weakened; each platform
  branch keeps the POSIX form byte-identical or asserts the win32-equivalent truth.
- **viewer-server.test.ts** — added the CRLF-normalization CSP pin (above).

## Suite (481 = 477 pass + 4 skip, 0 fail)

All 44 test files green (0 fail across the run; the exit code is 0). The 4 skips (honest reasons, run on capable hosts):
reference-path file-symlink pins ×2 (win32 developer-mode EPERM), reference-path
mode-0-unreadable pin (win32 cannot express), project-server SIGTERM-linger race
(win32 taskkill has no linger window). Port bands unchanged
(screens 64000–65399, export 65400–65535): suites serialized via
`--test-concurrency=1`, no band widening.

## Docs/smoke

- `docs/smoke/home.png` (1280×800), `docs/smoke/pay.png` (640×900) — routed
  /export PNGs at registry sizes.
- `docs/smoke/home.pdf`, `docs/smoke/pay.pdf` — MediaBox == size/96 in.
- `docs/smoke/canvas-fit-all.png` (1600×963) — full-shell screenshot at fit-all
  with both artboards visible (encode-verified, 450 distinct sample colors).