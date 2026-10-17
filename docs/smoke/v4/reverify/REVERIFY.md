# Design Canvas — design RE-VERIFY (Sonnet 5.5), HEAD 6becfd4

Scope: re-check my 17 findings from `../SONNET-DESIGN-REVIEW.md` after FIX-1 (service, 170dadc) and FIX-2 (shell, a086a3c) + rebuild.
No repo code edited. Scratch drivers are in `scripts/` (copied from `%TEMP%\dc-reverify`). Real Chrome 1010×1210 @125 %, live service.

## 1. Harness
`node docs/smoke/run-smoke.mjs` → **SMOKE SUMMARY: 20/20 pass, 0 skip, 0 fail** (note: running it rewrites the tracked `docs/smoke/v4/*.png` and `docs/smoke/out/*` — left modified in the working tree, not committed).

## 2. Per-defect verdicts

| # | Verdict | Evidence |
|---|---|---|
| F1 ghost hover | **FIXED** (screens) | `after-ghost-hover-moment1.png` (hover Menu: one outline) → `after-ghost-hover.png` (hover Checkout: Menu's outline gone, only Checkout's tag `button#b`). Also clean on empty canvas, right-click and edit→play. Caveat: my programmatic outline counter read `0` on the second artboard where the screenshot clearly shows one, so I rely on the screenshots (probe lost the context id), not on the counter. |
| F2 menu clamp | **FIXED** | `after-menu-corner.png`: opened at (innerW−6, innerH−6) → rect x822..1002, y921..1202 inside 1010×1210 (8 px margin); also bl/tr/mid all `inside:true`. Corner point is bare canvas, so that one was a dispatched `contextmenu`; the mid-canvas case was a real right-click. |
| F3 header collision | **FIXED (collision) / new wart N1** | 72-char title in the stress grid: no title/size overlap (0/3 overlaps, compact tier hides size on the 47 px board). But the clipped title is a hard cut, no ellipsis: `2 · Checkc`, `3 · Menu v2 — ‹cut›` (`after-header-row-clip.png`, `after-header-clip-wart.png`). |
| F4 long-title toolbar | **FIXED** | `after-long-title.png`, `after-long-title-toolbar-crop.png`: chips truncate with `…`, no scrollable element in the top 80 px, status icon visible at far right, all buttons within the 1010 px viewport. |
| F5 silent pick loss | **NOT FIXED** | see §3 |
| F6 active outline | **FIXED** | effective 1.79 px @45 %, 1.92 px @12 % (was 0.59 / ~0) — `after-outline-12pct-crop.png`. |
| F7 error card | **FIXED (mostly)** | `after-error-card.png`: lead line "Dev server unreachable — Reload to restart it.", CSP jargon demoted to small grey detail, **real bordered 62×31 button** (8×14 pad, 6 px radius). Real click on Retry → `ready` in **303 ms**, siblings untouched. At fit-all the card shows only the counter-scaled Retry (no prose, `after-error-card-fitall.png`). Gap: still no "Starting the dev server…" interim state. |
| F8 name slot | **ACCEPTABLE** | static muted "Design Canvas": the duplicate chip title is gone and the active state lives on chips only. It is a product label, not the workspace name (B8 still open), and it truncates to "Design Canv…" when the chip row is long. Fine as a stopgap. |
| F9 dot grid | **FIXED (modest)** | alpha .07→.11, 1.25 px dots; visible at 100 % (`after-dotgrid-100.png`) and at fit-all. Still subtle, but it reads. |
| F10 menu | **FIXED** | 4 groups with separators (Send │ Zoom/Reload │ Reset/PNG/PDF/Path │ Rename…), glyph icons, Rename last (`after-menu-corner.png`, `after-menu-open-fitall.png`). Keyboard: ↓ skips separators and wraps (Send→…→Rename→Send), ↑ wraps back, Home/End work, Esc closes. No shortcut hints. |
| F11 rename | **FIXED** | input width = board width (174 px at 45 %, `after-rename-open.png`), focused with text selected; Enter → title converged in **203 ms** (title with `—` and `&` round-trips verbatim into screens.json); after Esc no stray focus ring. |
| F12 registry banner | **NOT FIXED** | still red, raw `screens.json: Unexpected token 'o' … is not valid JSON`, no `title=`. |
| F13 play-mode active | **NOT FIXED** | after in-frame navigation inside Checkout, `getActive()` is still `home`. (In-frame nav itself: 165 ms, size and registry untouched; play-mode menu opens only on header chrome, not on the body: correct.) |
| F14 new-artboard pulse | not re-tested | |
| F15 null key | **NOT FIXED** | `view.json` after Reset position → `"positions":{…,"tall":null}` (null residue). |
| F16 scrollbar / focus ring | **NOT FIXED** | tall artboard still shows a native scrollbar (`after-tall-scrollbar-remaining.png`), and after any canvas click `#canvas` matches `:focus-visible` (white `auto` ring around the whole canvas, visible in the top/left edge of every post-click shot). The `:focus-visible`-only rule does not help because the controller focuses the canvas programmatically. |
| F17 leaked dev servers | **NOT FIXED (documented outlive-by-design)** | two dev servers still LISTENING on 5534/5543 after the runs; I killed them. |

## 3. F5 — the one that matters

**Repo stress test** (`DS_REQUIRE_CHROME=1 node --test --test-name-pattern STRESS tests/v4-live.test.ts`): 13 runs.
* 7 pass: 100/100 delivered, pickMs min 2 / **median 3** / max 7–71.
* 3 FAIL: 99/100, `click 0 (home): no pick reached /picks within 5 s (SILENT LOSS)` — the very first click of the run.
* 3 FAIL (the first three runs, back to back after the smoke): `click N: the <board> button maps inside the window viewport` (x=1693 / 1453 / −9.9) — geometry assumption violated mid-test (the camera moved); not reproduced afterwards.
So "100-click stress, 0 loss ×3" does reproduce when the session is healthy, but the test is flaky at ~25 % and the failure it hits is the exact silent loss it was written to kill.

**Independent manual loop** (`scripts/f5.mjs`, real CDP mouse: move → 60 ms dwell → press/release, 3 artboards, ack after each): **30 clicks → 30 delivered, 0 lost** (20 landed on #b of Checkout/Menu, 10 on Home landed on `main` because my aim point was off the button; still delivered picks), **p50 5 ms, min 4, max 9**. Camera mode flips `fit-all`→`manual` on the first edit click and the active artboard follows the click — by design, same as before.

**But the failure is per session, not per click** (`scripts/v11.mjs`, fresh service + fresh Chrome, 8 alternating clicks):
| build | sessions | session where 0/8 clicks delivered |
|---|---|---|
| HEAD 6becfd4 (all fixes) | 51 | **6** (≈12 %) |
| a33850f (pre-fix, `git archive`) | 12 | **2** (≈17 %) |
Not distinguishable from the baseline. A dead session never self-heals: still 0 picks 26 s later, after a Play→Edit toggle, and after a reload attempt. Meanwhile the shell looks perfectly healthy: hover outline and tag render (`dead-session-hover-works-click-lost.png`), `/state.shellBridge.authority:true`, screens `ready`, `/picks` empty.

Diagnosis of a dead session on HEAD (read-only probe of the artboard contexts): `window.__dsTrustedArtifact:true`, `__dsPickerInstalled:true`, **`typeof window.__dsPick === 'undefined'`**, and `__dsPickPending` holds 4–5 buffered payloads (the clicks) that are never flushed. So the artboard `__dsPick` binding never reached the context (the Windows addBinding-propagation lag the code itself describes at `browser.ts:~1131`), the in-frame script buffers forever, and FIX-1's shell-binding replay pump does not touch this path. The pre-fix dead session was different (binding present, authority dropped) — FIX-1 fixed that one class and left this one.

**Fix I'd make:** in `initializeArtifact`, after arming each artboard frame, `evalIn('typeof window.__dsPick')`; if not `function`, re-issue `Runtime.addBinding('__dsPick')` on that session and re-run the picker script (it already flushes `__dsPickPending`); retry for ~6 s with logging. Belt-and-braces: shell shows "Click didn't register — try again" when `screen-pick` gets no ack within ~1.5 s.

## 4. New-defect scan
* **N1 (minor)** header title hard-clips with no ellipsis (`.ds-ab-title` is `display:flex`, which ignores `text-overflow`): `2 · Checkc`. Fix: ellipsise an inner `<span>` or use `display:block`.
* **N2 (major)** repo STRESS test is flaky (3/13 loss, 3/13 geometry assertion), contradicting the "0 loss ×3" claim — see §3.
* Observations, not defects: toolbar name slot truncates to "Design Canv…" on a crowded row; the fit-all pose is centered vertically with a lot of empty canvas above/below at 1010×1210 (fine; matches Claude Design); error card at fit-all shows only a Retry button with no explanation.
* Checked with no regression: menu keyboard nav, rename (Enter/Esc, 203 ms), play-mode in-frame navigation and header-only menu, edit→play while hovering (no stale outline), error → Retry recovery (303 ms), first-open fit-all framing (45 % with 3 screens, 37 % with 4, 12 % ugly grid), registry error banner shows and clears.

## 5. Scores
| Axis | Before | After | Why |
|---|---|---|---|
| Look | 7 | **8** | Ugly-workspace case now holds together (toolbar, headers, 1.8 px outline at every zoom), grouped menu with icons, real Retry button, visible dots. Remaining: hard-clipped header titles, red raw-JSON banner, scrollbar in artboards, white canvas focus ring. |
| Feel | 6 | **7** | No ghost outlines, menu always reachable, rename 0.2 s, retry 0.3 s, picks 3–5 ms. Play mode still never moves the active outline. |
| Trust | 6 | **6** | Sizes/exports/never-blank-grid all still hold, but the silent pick loss is still there (~1 in 8 sessions is dead with no signal, ≈ same as pre-fix) and the stress test that should guard it is itself flaky. Cannot go up until a dead session is detected or impossible. |

## 6. Findings table
| State | Findings |
|---|---|
| Fixed | F1, F2, F3 (collision), F4, F6, F7, F8 (acceptable), F9, F10, F11 |
| Remaining | **F5**, F12, F13, F15, F16, F17 (F14 untested) |
| New | N1 header title hard-clip, N2 flaky stress test |

**Most improved:** the stress-workspace/ugly-case — F3+F4+F6 together turned the 12 % fit-all screen from "broken toolbar, overprinted headers, invisible outline" into something presentable. Close second: the context menu (clamped, grouped, keyboard-correct).

**Next wart I'd fix:** F5, the dead artboard `__dsPick` binding (above). Everything else is polish; this is the only thing that can make a designer's click vanish without a trace.

## Files here
`after-*.png` (corner menu, ghost hover ×2, long title ×2, error card ×2, 12 % outline crop, 100 % dot grid, first-open overview, rename, header-clip wart, scrollbar remaining, menu at fit-all), `before-*.png` (my original baselines), `dead-session-hover-works-click-lost.png`, `stress-run*.log` (first three STRESS failures), `old-baseline-dead-session-rate.log`, `scripts/`.
