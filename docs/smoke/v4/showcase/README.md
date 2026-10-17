# Design Canvas — V4 showcase (Sonnet design smoke, 2026-10-17, `canvas-fork` @ a33850f)

All captures are real Chrome `Page.captureScreenshot` output from the live service (nothing mocked). The Chrome window is
1010×1210 CSS px at Windows 125 % scaling, so images are 1263×1513. Smoke stills (`01…06`) are produced by
`docs/smoke/run-smoke.mjs` (20/20); the rest by throw-away probes in `%TEMP%\dc-design-review` (not in the repo).
Full judgement and findings: [`../SONNET-DESIGN-REVIEW.md`](../SONNET-DESIGN-REVIEW.md).

## Good — what already reads as Claude Design

| File | What it shows |
|---|---|
| `canvas-fit-all.png` | Default framing: dark art-wall, dot grid, three live artboards (1280×800 / 390×844 / 390×1600) side by side with `N · Title` + size headers, soft double shadow, Edit/Play segmented toggle, screen chips, `N%▾ − +`, Fit-all, Pan, status. Home carries the blue active outline. |
| `play-clickthrough-before-after.png` | Play mode. Real click on a real `<a href="home.html">` inside the Checkout phone artboard; the page navigates **inside the frame**, the artboard stays 390×844, and `/state` shows the recorded url/title change (`checkout.html`→`home.html`, title →"brew-lab") 812 ms later. `screens.json` is untouched. |
| `hover-outline.png` | Edit mode, mouse over a button *before* any click: blue `#3b82f6` 2 px outline, 10 % tint and a `button#b 85×43` tag chip — appears 29–65 ms after the move. This is the "blind click" fix (E8). |
| `pick-toast.png` | After the click: green pick outline + tag, and the bottom-centre pill `Added to chat · button#b` (service `GET /picks` + `POST /picks/ack`; pill auto-dismisses before 2.3 s). |
| `context-menu.png` | Right-click on an artboard: dark popover, 8 actions (Send to chat · Zoom to screen · Reload screen · Reset position · Export PNG · Export PDF · Copy file path · Rename…), first item focus-highlighted, `⋯` button on the artboard. |
| `error-recovery.png` | Left: dev server killed, agent adds `orders` → *that artboard only* shows the error card, siblings keep rendering. Right: Menu ▸ Reload screen auto-restarts the dev server; artboard live again in 855 ms. |
| `registry-error-banner.png` | `screens.json` corrupted → red banner under the toolbar (and the earlier pick toast, new-artboard pulse ring on "About"). |

## Stress

| File | What it shows |
|---|---|
| `stress-grid.png` | Deliberately ugly workspace: 1280×800 with a 66-char title, an **8000×200** banner, a 390×844 phone. The grid wraps into a column, nothing overlaps *artboards*, but fit-all drops to **12 %** and every header collides with its size label; the long chip also breaks the toolbar (native scrollbar, status icon pushed off). |

## Defect evidence (shown on purpose)

| File | Defect |
|---|---|
| `DEFECT-hover-ghost.png` | Hovered Checkout then Menu without leaving the canvas: **both** frames still draw a hover outline (`browser.ts:2403`). |
| `DEFECT-context-menu-clipped.png` | Right-click near the lower-right: menu runs 65 px below the window (Copy file path / Rename… unreachable); a stale hover outline is also still on the left artboard. |
| `DEFECT-header-title-collision.png` | After renaming to "Menu v2 — Seasonal" the title overprints the `390×844` size label (3rd artboard). |
| `DEFECT-rename-input-overflow.png` | Inline rename input is a fixed 220 px, wider than the 174 px artboard at 45 % and spills off the window edge. |
