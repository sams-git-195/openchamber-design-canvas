# FIX-2 report (shell polish) — 2026-10-17

## Sonnet defects closed (viewer-client + viewer-ui + assets via build:viewer only; camera math untouched, byte-stability pins green; §3 shapes untouched)
- F2 menu clipping: positionMenu() measure-then-flip (left/above when far edge clips), 8px viewport clamp margin, resize re-clamp w/ stored anchor; boundary pins (780,700→560/400 flip; 300px viewport→72px clamp).
- F3 header collision: title budget calc(--w*--cam-scale - --ab-size-w,84px) reserved label width + data-header-compact (<140px board device width hides size, frees clamp).
- F4 toolbar overflow: chip labels max-w-[16ch] truncate, chips min-w-0 shrink, row overflow-hidden — native scrollbar structurally impossible; >4 Screens▾ kept.
- F6 outline width: calc(2px/var(--cam-scale)) active + 1px hover counter-scaled → constant device px 0.12–3×.
- F7 error card: errorCopy() splits service text — CSP/X-Frame-Options → demoted .ds-ab-card-detail verbatim, primary "Dev server unreachable — Reload to restart it."; specifics stay primary verbatim; Retry = real bordered button w/ focus ring; zoom-compact <0.5 hides prose, counter-scales Retry.
- F8 name slot dedupe: static muted 'Design Canvas' (no §3 vehicle for workspace name — FORK-MERGE B8 to service: bake name into ViewerConfig; setPage({title}) must NOT be reused).
- F9 dot grid: alpha .07→.11, 1.25px dots. F10 menu: 4 groups w/ role=separator + unicode icons @65%, Rename last, keyboard ring skips separators. Rename input: clamp(120px, board width, 220px).
- Cheap minors: F14 pulse .8s + ring counter-scale, F16 focus-visible-only canvas outline, F11 header focus ring.

## Evidence: offline renders of shipped HTML — after-stress-cards (72-char title @17%: truncated chips, no scrollbar, crisp outline), after-twin-errorcard-v2 (dot grid reads, card split), after-menu-clamped (opened at innerW-6,innerH-6 fully inside), after-rename-open (board-width input @17%). Before-shots = Sonnet showcase/DEFECT-*.png.
## Digests (2 runs identical): inputDigest 194e83eb…, js 7b037c27… (482,647B), css 2a836496… (147,091B), file d6be8045…; CSP 2-script invariant re-pinned.
## Tests: viewer-ui 23/23 (+pins), stock-controller 34/34 (+boundary/tier/copy-split/structure pins), canvas-zoom-routing 7/7, typecheck:viewer 0.

## FORK-MERGE for service lane (FIX-1 running — will apply post-merge or next round)
1. B8: bake workspace name (basename(dir)) into ViewerConfig at startViewerServer → shell swaps static slot for it (optional field + allowlist pass-through on B's side when it lands). setPage({title}) NOT reusable (nav confirmations own it).
2. B7: browser.ts error text may keep wording — shell splits either shape.
3. Left for service: F1 hover-end on screen-change (assigned FIX-1 task 6), F5 pick telemetry, F13 play-mode activation outline, F15 mergeView null-key, F17 dev-server reaper on /close (lifecycle decision: document + menu/route stop, don't change outlive-by-design), F12 banner copy, F16 in-frame scrollbar-width:none via PICK_SCRIPT.
