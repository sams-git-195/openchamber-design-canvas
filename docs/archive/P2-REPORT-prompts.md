# P2-C report (prompts + panel commands) — 2026-10-17

## Landed
- shared/harness-text.ts: CANVAS_PROTOCOL export = SPEC-V3 D8 byte-identical (programmatically diffed). Full text → designSessionPrompt BOTH branches; CANVAS_PROTOCOL_CHIP (lines 1–2 verbatim + 2–3 variant rule + six presets; positions line excluded) → buildModeChip under §F order.
- Chip budget MEASURED: 40-screen worst case = 7785 chars ≤ 16000 — full rules fit, no fallback; pinned by new test documenting the IDENTITY+VERIFY_PROTOCOL fallback ordering if it ever overflows.
- Commands: /canvas export [png|pdf] (order/case-insensitive, dupes collapse; unknown format → error toast no call; no ws/ → 'No canvas workspace yet…'), /canvas critique (POST /critique {dir} → ≤16000 digest composed as REVIEW REQUEST, header 'Canvas critique — deterministic gate digest (advisory):', findings ≤3/screen, truncated note, VERIFY_PROTOCOL advisory clause pinned). startNewDesign: briefs >16000 fail loudly BEFORE scaffold/send. Export poll 700ms/~60s budget→'still running' toast; summary = counts+paths+per-screen failure count capped GUEST_TOAST_MAX.
- styles.css pass: ds-play-toggle/ds-focus chips (30px, .on reuse), ds-screen-select fully styled (token colors, focus ring, max-width, 44px touch target on coarse/narrow). FORK-MERGE comment in main.ts removed. Row DOM/height reporting untouched.
- panel/api.ts: openLive legacy wrapper DELETED (verified unreferenced).
- README: three comparison use-cases table (responsive triple/poster variants/app flow) w/ D8 preset numbers; export+critique documented; first-run note extended w/ poll line.

## Tests (own): mode 34/34(+8), mode-open 44/44(+10), panel-open 55/55, manifest 5/5, harness-plugin 10/10 (pins re-targeted to shipped note; adversarial no-clobber pins kept), reference-breaker 5/5 (was FILE-LOAD failure; A2 re-bound to workspace switch w/ decision-4c projectId delivery, A4 re-targeted, B1 now backed by REAL guard, mutants still caught), root-workspace-breaker 2/2 (junction fallback; R1 rebound workspace→projectId seam; /harness pin INVERTED to never-refresh contract; JSON backslash escaping fixed; mutant caught). status-height 7/8 pre-existing drift (below).
Typecheck: 4 own errors → 0; tree FULLY GREEN at report time (P2-A edits landed mid-run).

## P2-D musts
1. status-height.test.ts 'row keeps exactly two controls' pin fails — 4 buttons exist (P1-panel drift, unchanged by C). Fix count pin honestly.
2. For P2-A consumers, panel codes against EXACTLY: POST /export {dir,formats?}→{ok,jobId,screens,formats}; GET /export/status?dir=&job=→{state,startedAt,results:[{screen,png?:{ok,file}|{ok:false,error},pdf?…}]}; POST /critique {dir}→{ok:true,screens,truncated}|{ok:false,error} w/ gates[].findings ≤3 pre-trimmed service-side. /state mode/screens/activeScreen/lastPickScreen unchanged.
3. If P2-A returns export `file` paths in any format other than as-written-to-disk absolute paths, panel displays verbatim — check UX.

## Notes
- /open{dir,screen} activation transport confirmed (P1-screens /open accepts screen). lastPickScreen + workspaces screens? kept as shipped.
