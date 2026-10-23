# V4-C report (panel) — 2026-10-17

## Landed (panel/main.ts, api.ts, mode.ts, attach-dialog.ts, README copy sync; styles.css + harness-text untouched)
- V4-4C: /state.registryError → one host.toast error per DISTINCT message while condition holds; null re-arms (fix-then-rebreak speaks up); pure shouldToastRegistryError dedupe.
- V4-5C pickLoop: 900ms lastPick handling REMOVED; long-poll GET /picks?since&wait=12000, single in-flight (sequential awaits), in-seq delivery, ONE ack {seq: last contiguous, label} after successful host.attach; attach failure → no ack → cursor holds → redelivery; ack-after-land never duplicates; request error → wait=0 @250ms ×30s → back to long-poll; NO visibility guard (hidden-window loss impossible); bridgeActive + mode-off HOLD fetch+delivery (queue retains, catch-up on release); service-restart seq-regression rebases cursor; instant-empty long-polls paced 1s. 'Added to chat' rides service→shell ack pill; panel toasts nothing on success (no spam).
- V4-8C: focus:true on toggle-ON/Start/page-Preview; screen dropdown sends focus:false explicitly; no defaults.
- V4-10C: screen-menu send-to-chat arrives via queue → chip id screen-<seq>, title 'Screen · <id>', text 'Screen: <id> (<w>×<h>) — <file>' + 'Screen URL: <url>', data {screen,screenUrl,width,height,file}, NO selector block; element chip shape verbatim fed from queue entry.
- V4-11C: POST /scaffold async:true → ws/<sessionId> stored at {ok,jobId} BEFORE polling; /scaffold/status poll 2s; progress toast per state change (installing (Ns)/booting/done-settle), same-state refresh ≤1/10s; open only at done; failed → error toast verbatim, NO open, ws stays (no twin); 15-min honest give-up; page flow rides same job; 20s cap unreachable both legs.
- V4-12C: busy↔idle flips of host.onSession → POST /agent-status {busy,label:'Designing…'} (idle busy:false only, no spurious posts); lifecycle completed → POST /screens/sync {dir} backstop. Display-only, never auto-sends.
- V4-15C: /open {ok:false,code:'WORKSPACE_MISSING'} → delete ws/<sessionId>, in-memory unbind, page map drop, toast '<error> Start creates a new canvas.' (row first-use affordance IS the offer).
- Copy: PICK_HINT now edit-mode CLICK (⌘-click wording gone); footer/workflow name the Screen: chip.

## V4-13 dock: SKIPPED (P2) — legitimate host gap. SDK HostClient exposes NO window-bounds API; guest iframe window.screenX/outer* ≠ OpenChamber window (cross-origin). Sending iframe numbers would mis-dock Chrome. Panel sends NO dock (type seam pinned). FORK-MERGE in panel/main.ts: needs a host bridge API → upstream feature request for OpenChamber.

## Disclosed out-of-list touch: tests/reference-breaker.test.ts (unowned, historically panel) — /scaffold stub re-bound to async contract (+2 lines, same pattern as mode-open) after V4-11 hung A3. A4 seam still holds.

## Tests (own): attach-dialog 7/7 (screen chip exact, no-selector pin), mode-open 55/55 (long-poll fake-timer batch/order/one-ack; hidden-delivers; failure→no-ack→retry; backoff pattern exactly ['12000','0','0','0','12000']; bridge stand-down+catch-up; registryError dedupe/re-break; agent-status flips-only + completed→sync; async scaffold timeline ONE POST failed→no-open+ws-stays; WORKSPACE_MISSING clears; focus:true rebind), panel-open 65/65 (§3 wires verbatim incl label clamp, no-dock pin, queue-client structural pins replacing lastPick pins), mode 34/34, status-height 8/8 (row still 4 controls; explicit pick-loop standdown so runner drains), server-stop 42/42. Collateral: manifest 5/5, harness-plugin 10/10, root-ws 2/2, adversarial 9/9. Tree typecheck 0.

## Integrator notes
- panel/main.js STALE (pre-V4 bundle) — rebuild before ANY live smoke (contributions load the bundle).
- Ack double-fault nuance: ack-transport failure after landed attach keeps cursor advanced (no dup chips; service 2500ms watchdog may raise one canvas warn — judged lesser evil, commented in deliverPickBatch).
- Cadences exported/pinned: idle-held 900ms, empty-poll pace 1s, error 250ms/30s.
- Sonnet smoke: re-measure E7 pick latency (p50 should be hop-chain only, tens of ms); DS_REQUIRE_CHROME=1.
- /state.shellBridge typed but unread by row (integrator/E17 field).
