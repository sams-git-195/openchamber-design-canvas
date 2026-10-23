# V4 Code QA Gate — final report (qwen3.8-max#xhigh, 2026-10-17)

## VERDICT: PASS-WITH-FIXES
Fence: CLEAN (zero crossings; receipts: screens.ts additive-only, view-state.ts untouched, viewer-server/CSP not in diff, FRAME_SANDBOX untouched, package.json/lock/tsconfig zero-diff, all listens 127.0.0.1, 0 sendMessage hits + 3 user-gesture host.attach sites, no editor-creep). All V4-1..17 have real impls + behavioral tests (matrix in full report; ✅ except V4-13 auto-dock wiring ⚠️ code-read only, V4-4/V4-15 live pins ⚠️ flaky).
CRITICAL HONESTY FINDING: integrator's "555/555 0-fail under DS_REQUIRE_CHROME=1" + "boot ready race FIXED at root" DO NOT REPRODUCE — QA ran full suite ×2: 2 fails each run (different tests: run1 live-canvas-browser:66 contexts-null + fit-page-breaker F2; run2 v4-live E1+E3; both files green isolated). Route-live heartbeat fails ~2/3 isolated (~75%). FORK-CHANGELOG must be corrected.
Bundle honesty: 14/14 input digests recomputed-match; all V4 symbols present in bundles. E17 isolated 20×: misses [], 319/334/343ms ✓. 4 win32 skips genuinely environmental. Mutant sweep not re-run (recommend fix round re-kills since browser.ts must change).

## MUST-FIX (before PASS)
1. F1 browser.ts:2063 shellHandshakeFlush one-shot 8s, result discarded → late Runtime.addBinding propagation bricks session silently. FIX: continuous recovery — retry guarded handshake on interval (~2s, unref'd) until first honoured command (lastShellCommandAt!==null) or window close; and/or re-issue addBinding on flush timeout; log outcome. Acceptance: route-live heartbeat green ≥5 consecutive isolated runs.
2. F2 launch/attach flake under suite load (contexts null between browser.ts:1866 assign and :1871 initializeArtifact = target died/attach raced). FIX: root-cause + retry-or-fail-loud diagnostics in launch(); acceptance: 3 CONSECUTIVE full-suite runs 0 fail under DS_REQUIRE_CHROME=1, numbers into CHANGELOG correcting the 555/555 claim.
3. F3 main.ts:1561+215 dedupe seed clobber: /open seeds lastPushedRegistry then startRegistryWatch resets ''. FIX: seed AFTER start (or pass in).
4. F4 screens.ts renameScreen (:262-310): validates whole file + writes NORMALIZED registry (drops extra fields, removes invalid entries, clamps sizes — violates V4-17 "keep everything else byte-verbatim"); invalid-entry file throws ScreensError swallowed at browser.ts:2346 → silent no-op rename. FIX: minimal in-place title edit on raw parsed JSON; surface failures via warn toast.

## SHOULD-FIX (same round)
5. F5 browser.ts:2383-2411 queueHover/runHoverLoop: latest-wins can overwrite queued screen-hover-end when crossing artboards mid-flight; previous screen's outline never hidden when target.screen changes → STALE GHOST OUTLINE (= Sonnet F1). FIX: __dsHoverEnd() old frame first when screen changes, or make 'end' non-overwritable.
6. F6 main.ts:313-367 runMenuExport joins foreign single-slot job → misleading "Export failed: no result". FIX: detect joined:true → "Another export is running" toast.

## TRACK-ONLY
F7 pick-queue epoch vs cursor rebase (practically unreachable; add service/boot epoch to /picks someday) · F8 legacy /open{url} doesn't stopRegistryWatch (edge; stop watch on any successful /open) · F9 PickQueue.push after close (nit early-return) · F10 /scaffold/status dir-vs-job match (nit) · F11 agent ctrl-click → __dsPickAt pick without user gesture (v1 seam, fence-adjacent; gate on agentInput or drop modifier-picks) · F12 source-regex pins paired with behavioral twins (acceptable).

## Related cross-report correlation (fix round should investigate as part of F1/F2)
Sonnet probe-b: ~3/30 edit-mode clicks never reached /picks despite fresh hover outline, unrepro in 12 controlled runs — SAME suspect chain (binding propagation / heartbeat / hover-loop drop). Include a targeted stress test (e.g. 100 scripted picks via real CDP clicks in a loop) proving the loss class is dead.
Sonnet also found: dev servers left running after /close (kill-on-close policy decision — spec says servers outlive service by design; document + add menu/route stop, don't silently change lifecycle).
