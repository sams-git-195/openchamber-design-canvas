# FIX-1 report (service reliability) — 2026-10-17

## Dispositions (browser.ts, main.ts, screens.ts, pick-queue.ts, project-server.ts doc; shell untouched; fence held)
- F1 handshake: one-shot flush → startShellHandshakeRecovery (guarded ~2s unref'd retry until first honoured command or close; re-issues Runtime.addBinding every retry + proactive at boot; logged). SECOND ROOT CAUSE: __dsCanvasSend dropped by fail-closed lease during boot storm → bounded 6s REPLAY PUMP (authority re-validated per attempt; artifact pick/event deliberately don't replay). Telemetry: 18–19 bindings/run honoured-on-replay that old code silently dropped, 0 expired.
- F2 launch flake: root-caused (window died mid-launch between contexts assign and initializeArtifact) → launch() orchestrates launchOnce() w/ assertLaunchAlive → LaunchDiedError + diagnostics; one auto-retry fresh Chrome (explicit close never retried); attachExistingPage waits target AT launch URL (v1 fallback byte-identical) + liveness probe; evalIn entry retry tolerance. 0 launch-retries needed in acceptance runs (diagnostics ready if ever).
- Task 3 stress: NEW 100-real-CDP-clicks live test across 2 artboards, drain+ack; relayPickToFrame now retries lease/context family + logs undeliverable.
- F3 dedupe seed after startRegistryWatch ✓; F4 renameScreen minimal in-place raw-JSON edit (unknown keys/out-of-clamp/invalid siblings byte-verbatim; failure → warn toast never silent) ✓; F5 runHoverLoop __dsHoverEnd on previous screen at target change (exactly one outline) ✓; F6 joined:true → 'Another export is running' ✓; F8 legacy /open re-targets/stops watch ✓; F9 push-after-close early-return ✓; F10 /scaffold/status foreign dir+id = unknown ✓; dev-server leak: documented outlive-by-design, /server/stop only kill.

## BINDING PROOFS
- Heartbeat 5× isolated: 5/5 green (~2.8s each; was ~75% failing).
- Full suite DS_REQUIRE_CHROME=1 ×3: 575 tests, 571 pass, 0 FAIL, 4 documented win32 skips (177.6/176.9/169.1s).
- 100-pick stress ×3: delivered 100, misses [] every run; pickMs min2/med3/max9. Silent-loss class DEAD.

## Tests: v4-service 36/36 (+9 hermetic), v4-live +2 (ghost-outline, 100-pick). No pins weakened; legacy families green untouched.

## INTEGRATOR MUSTS (from FIX-1 honesty list)
1. service/main.js STALE (none of these fixes; browser.test:193/service.test/provider/verify run pre-fix bundle) → npm run build + ONE full-suite re-run against rebuilt bundle (expect 575/571+4sk; profile-count flake risk was stale-bundle artifact).
2. Re-run 23-mutant sweep (browser.ts changed; anchors untouched but prove).
3. Flagged future item (untouched, legacy v1): live-canvas-browser:271 blocked-nav global-status read = pre-existing push-ordering race (stale refreshScreen setStatus(ready) after nav error); hit once pre-replay-scoping, 0 recurrences in acceptance ×3. Watch-list only.
