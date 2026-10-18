# P1-browser report (committed 2026-10-17) — for P2 integration

## Landed
- service/browser.ts, artifact-context.ts, browser-control.ts rewritten for multi-frame (§B/§D) + 9 test files. No builds run; nothing else touched. P0 process.platform branches intact; only OS-specific addition: 'junction' symlink arg in two test files' scratch trees (POSIX byte-identical).

## Browser public surface AS IMPLEMENTED (overload-compatible)
openWorkspace(cfg:{dir?,screens:CanvasScreenInput[],baseUrl,mode?}) · setScreens · setMode · setActive · getMode() · getState() (sync; =state() minus url refresh) · state() (async; refreshes active url/title) · navigate(url)|navigate(screen,url) OVERLOADS keep v1 call shape compiling (verify.ts:319/352, main.ts unchanged) · pick():ScreenPick(PickedElement+screen) · input(events)|input(screen,events) · capture(screen?)→{png,width,height} NATURAL size · getProbe(screen?) zero-arg=active (decision 11 ✓) · highlight(selector)|(screen,selector) · focus/close · currentWorkspaceDir() (dir fallback for browser-control).
Deviations (intentional): openWorkspace cfg optional dir; overloads preserve v1 shapes; navigate returns {url,title,settled}; CanvasScreenInput accepts url OR file (joined vs baseUrl per §A; sizes 200–8192).

## Inbound canvasCommand
ready (bridge retry-install, discover, initializeArtifact, active-correction push) · viewport+screen (active-only v1→resizeArtifact) · page+screen (pages[id]→navigateGuarded) · retry+screen (record.url??requestedUrl) · layout/fit-size active-only + **fit-size no longer bumps generation (FIXED fit/page livelock)** + persisted requestedLayout intent · screen-pick{screen,x,y} (validates → __dsPickAt in THAT frame context) · screen-activate (setActive+echo push) · **mode-request (answers with setMode push — was not in §C; NOW FOLDED IN)** · legacy __dsShellState pick kept + optional pick.screen.
Outbound shellEval: all §C names incl setScreens/setMode/setActive/setScreenState(id,{state,message}); beginCapture(screen?) optional id, THROWS zero-screens. User-visible pushes via shellEvalSettled (bounded lease-race retry).

## Per-screen state
ScreenRecord{id,url,liveUrl,title,liveTitle,width,height,state,message} Map+order; activeScreenId mirrored into ArtifactContexts; chrome-error per screen (setScreenState(id,'error'); global setStatus ONLY when dead screen is active — audit #8 honored: dead artboard never blanks grid). pendingNavigations + refreshingScreens per screen. Layout active-screen-only v1.

## Deleted single-frame legacy
SHELL_BRIDGE #preview+post-load name loop → static __dsArtifact:<id>, hit-test .ds-artboard iframe[data-ds-screen], sends screen-pick. discover() first-match → full data-ds-screen map (id regex, untrusted frames never armed). artifactFrame→screenFrames + artifacts():Map + artifact(id?) + screenForContext() (executionContextId→screenId authority); armed-set idempotency. All #preview coord remaps → ds-frame-<screen>.

## Windows launch races FIXED (the HEAD 'open succeeded false' class — NOT flakiness, real bugs)
1. Binding-propagation race (Runtime.addBinding reaches shell context after response on Chrome 155/Win) → bridge self-refuses until __dsShellState is function + service retry (shellBridgeSettled).
2. Lease fails closed during in-flight discovery → shellEvalSettled for pushes; artifact evalIn re-discovers once on dead world.
Tests: artifact-context 4/4, canvas-zoom 7/7, browser 13/13 (was 6/10 all-Chrome-red), live-canvas-browser 9/9 (NEW: per-screen contexts, screen-activate/mode-request/screen-pick round-trips, capture('b') natural size, warm setScreens no second capability URL), fit-page-browser 5/5 ×2, fit-page-breaker 4/4 (was EPERM at import), nova-canvas-breaker 4/4, provider 2/2 (Chrome leg still runs STALE bundle until P2 rebuild).

## P2 seams (DISTRIBUTE — verbatim)
1. live-canvas-breaker.test.ts UNOWNED: mutation string gone (screenForContext+artifact(screen)); #preview selectors stale → P2-A.
2. main.ts /open must pass `dir` into openWorkspace cfg → currentWorkspaceDir() non-null (browser-control fallback). → P2-A.
3. shell: setPage({navigate:false}) updates board url not src → relayout rewrites iframe.src → one duplicate same-URL load per new URL (self-correcting). Fix: sync s.src from frame.src on iframe load. → P2-B.
4. shell BUG: first wheel-zoom after load shifts artboards ~40px vertically; Y-anchor compensation asymmetric (X exact; service payload exact — controller-side). → P2-B.
5. shell BUG: board 'error' DOM listener re-fires setScreenState WITHOUT message → clobbers service's specific error text with BOARD_COPY default. → P2-B.
6. mode-request now folded into spec §C (done by orchestrator this commit).
7. Decision-8 semantics: /canvas workspace defaults edit (artboards freeze native clicks); legacy browser.open self-defaults play. P2 MAY flip/restore play around input-heavy browser-control actions. → P2-A decision.
8. P2 MUST npm run build + build:viewer before bundle-dependent tests (service/main.js routes, provider Chrome leg).
