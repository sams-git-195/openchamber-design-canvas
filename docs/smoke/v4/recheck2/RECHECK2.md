# Design Canvas — FINAL re-check #2 (Sonnet 5.5), HEAD 1afc8d8

Independent re-run, nothing trusted. No repo code edited, no git. Scratch drivers in `scripts/` (copied from `%TEMP%\dc-recheck2`). Real Chrome (CDP mouse/keyboard), fresh service + fresh Chrome per F5 session, `DS_CHROME_PATH` inline.

## 1. F5 — dead sessions (my own scripts, same methodology as the reverify round)
Two fresh-session drivers, 10 sessions each (20 fresh service+Chrome sessions total):

| script | sessions | clicks | delivered | lost | dead sessions |
|---|---|---|---|---|---|
| `f5.mjs` (30 real clicks over 3 artboards, ack after each) | 10 | 300 | 300 (200 on `#b`, 100 on `main` of Home: the known aim-point artifact of my script — still delivered picks) | **0** | **0/10** |
| `v11.mjs` (8 alternating clicks, fresh session, no delay — the exact method that found 6/51 dead) | 10 | 80 | 80 | **0** | **0/10** |

Per-session: every f5 run `lost:[]`, p50 13–16 ms, min 9, max 19–34. Every v11 run 8/8 (first click 17–55 ms, then 9–26 ms). One v11 session (r4) took 7.1 s to reach all-ready (slow boot) and still delivered 8/8. So: **0 dead sessions in 20 (pre-fix 6/51 ≈ 12 %; P(0/20 | 12 %) ≈ 7 %, and the earlier 10/10 claim plus mine = consistent with fixed).** No dead session appeared, so the `__dsPick` typeof / 4 s-sweep recovery probe was not needed.
Note: click latency is ~3× my previous round's 3–5 ms (p50 13 vs 5) — probably the extra in-frame verify path or machine load; still imperceptible.

## 2. Stress ×5 (`DS_REQUIRE_CHROME=1 node --test --test-name-pattern STRESS tests/v4-live.test.ts`)
(Pattern is case-sensitive; the test is named `STRESS:` — a lowercase "stress" pattern matches nothing and passes vacuously, 1 test/0 work. Worth knowing if anyone scripts it.)

| run | delivered | misses | pickMs min/med/max | result |
|---|---|---|---|---|
| 1 | 100/100 | 0 | 5/8/29 | pass |
| 2 | 100/100 | 0 | 5/8/20 | pass |
| 3 | 100/100 | 0 | 5/8/18 | pass |
| 4 | 100/100 | 0 | 6/8/20 | pass |
| 5 | 100/100 | 0 | 6/8/19 | pass |

**5/5 green, 500/500 picks, 0 misses.** (Reverify: ~25 % flaky + 25 % geometry assertion failures → now 0/5; N2 closed.)

## 3. Per-close verdicts

| item | verdict | evidence (mine) |
|---|---|---|
| **F5** silent pick loss | **VERIFIED** | §1: 0/20 dead sessions, 380/380 clicks delivered; stress 500/500. |
| **F12** corrupt screens.json banner | **VERIFIED** | `F12-corrupt-banner-crop.png`: "screens.json isn't valid JSON, so the canvas kept the last good screens. Fix the file and the canvas picks it up automatically." No raw `Unexpected token` text. Still red-bordered error kind (appropriate); clears when file restored (`cleared:true`). |
| **F13** play-mode active follows nav | **VERIFIED** | `F13-before-play-active-home.png` (active = Home, getActive()=`home`) → click "Back to home →" link inside Checkout in Play mode → `F13-after-link-click-active-moved.png`: outline on Checkout, `getActive()=checkout`, checkout navigated to home.html. (A "Not delivered — open the chat with Design Mode on" toast is visible in that shot: it came from my earlier Edit-mode pick with no chat attached, expected.) |
| **F15** reset-position null key | **VERIFIED** | Drag Menu → `"positions":{"menu":{"x":1766,"y":134}}`; right-click Menu header → Reset position (real click) → `"positions":{}`. No `null`, key gone (`F15-1-moved.png`, `F15-2-after-reset.png`). (My first attempt hit the wrong board because the dragged board left the viewport — test error, redone cleanly.) |
| **F16a** artboard scrollbar | **VERIFIED** | `F16a-tall-no-scrollbar.png`: 390×1600 tall artboard at 100 %, no native scrollbar at the right edge of the board. |
| **F16b** canvas focus ring | **VERIFIED** | After real mouse click: `outline: none`, `data-pointer-focus=true` (`F16b-A-after-mouse-click.png`: no ring). Then first keydown → tag cleared, `outline: solid 1.6px rgb(79,140,255)` → blue keyboard ring (`F16b-B-…ring.png`). Caveat: plain Tab from the toolbar goes to the artboard iframes, never to `#canvas` itself, so the ring only appears when the canvas already has focus + a key is pressed; acceptable. |
| **F17** Stop dev server | **VERIFIED** (one nuance) | Menu now has 9 items / 5 groups incl. "Stop dev server" before Rename (`F17-1-menu-with-stop.png`, also in the smoke menu shot). Real click → toast "Dev server stopped", port 5543 stops LISTENING, server.json process gone. Existing already-loaded artboards stay painted (they're loaded documents) — an error card only appears on the next load: adding a screen → `error` in 479 ms with the card + Retry (`F17-3-error-card.png`); artboard menu → Reload screen → `error→ready` in **1168 ms**, dev server restarted, all 4 screens ready (`F17-4-recovered.png`). Nuance: Stop doesn't visibly change anything on screen until something reloads, apart from the toast. |
| **N1** header ellipsis | **VERIFIED** | 81-char title: inner `<span>` `text-overflow:ellipsis; display:block; overflow:hidden`, scrollWidth 512 > clientWidth 124; `N1-long-title-header.png`: "5 · Q3 Seasonal Ch…". Short titles unclipped. |
| **N2** flaky stress test | **VERIFIED** | §2, 5/5. |

## 4. Smoke / regression glance
* `node docs/smoke/run-smoke.mjs` → **SMOKE SUMMARY: 20/20 pass, 0 skip, 0 fail** (registry banner, exports at registry dims, context menu, final overview all ✓). Side effect as before: it rewrites tracked `docs/smoke/v4/*.png`, `docs/smoke/v4/summary.json`, `docs/smoke/out/*` — left modified in the working tree, uncommitted (I did not touch git).
* Menu open (`smoke-05-context-menu.png`): grouped, icons, clamped, Stop dev server separated before Rename. Fit-all overview: `00-overview-fitall.png` / `smoke-01-overview-fit-all.png` (active outline, ellipsised titles, dot grid, size labels all clean).
* Cleanup: one dev server (5543) from my F17 reload outlived the run (documented by-design); I killed it. No Chrome left.
* Not re-run: full 578-test suite and mutant sweep (the lead's numbers stand unverified by me; everything behavioural above was re-run from scratch).

## 5. Final scores
| Axis | Reverify | **Final** | One-liner |
|---|---|---|---|
| Look | 8 | **9** | Header ellipsis, calm banner prose, no scrollbar, no white ring, grouped menu, 1.8 px outline at every zoom; only subtle things left (name slot is a static "Design Canvas", dot grid modest, fit-all vertical centering leaves much empty canvas). |
| Feel | 7 | **8.5** | Active outline now follows play-mode navigation, clamp/rename/retry/reload all sub-1.2 s, picks 8–15 ms; Stop dev server gives only a toast (no visible state change until reload) and plain Tab never reaches the canvas ring. |
| Trust | 6 | **9** | The one silent-loss mode is gone in my independent runs (0/20 dead sessions, 500/500 stress), banner honest, positions file clean, stress test now a trustworthy guard. Held back from 10 by sample size (0/20 can't prove <5 %), my not having re-run the full suite/mutants, and no in-host evidence yet. |

## 6. Recommendation: **SHIP to the in-host P4 acceptance** (real `/canvas` inside OpenChamber).
No open Look/Feel/Trust blocker remains from my 17 + N1/N2 list. What P4 should specifically watch (things this out-of-host harness can't prove): (1) F5 dead-session rate in the real host window — log any session where a click gives no pick within 2 s and check `typeof window.__dsPick` in the artboard context (4 s sweep should heal within ~4–8 s); (2) the F16b keyboard-focus path inside the host's own focus management; (3) the leaked-dev-server-after-session behaviour in the host. Suggested P4 gate: ≥30 fresh sessions, 0 dead.
