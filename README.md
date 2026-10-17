# OpenChamber Design Canvas

A **project-free, multi-screen design canvas** for OpenChamber — an open, local
counterpart to Claude's design tool. Any chat can start a design: the canvas is
a real Chrome window showing **multiple screens as artboards** on one
scrollable/zoomable surface, with an **edit mode** that picks elements into the
chat and a **play mode** where clicks and links actually work. No project
registration, no uploads, your files stay in your own Documents folder.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenChamber engine](https://img.shields.io/badge/openchamber-%E2%89%A5%202.2.0-4b5563)](package.json)

This is the **Design Canvas fork** of the original OpenChamber Design Studio
(`canvas-fork` branch). The original extension remains available as
`openchamber-design-studio`.

## What this is for

Claude's design tool generates artboards inside the vendor's product. Design
Canvas instead keeps the screens yours: every screen is a real HTML file in a
workspace folder on your machine, the artboards are real pages served by a
local dev server, and picking an element attaches a reference chip (selector,
styles, markup, **the screen it came from** and that screen's URL) straight
into the chat composer.

| | Claude Design | OpenChamber Design Canvas |
| --- | --- | --- |
| Where the screens live | In the vendor's product, on their canvas | On your disk, in `Documents/Design Canvas/<workspace>` |
| Screen model | Artboards generated in the canvas | Real HTML pages (`<id>.html`) + a `screens.json` registry |
| Editing | Vendor's model, in their product | Edit mode: click an element → chip in THIS chat → your agent fixes it |
| Interacting | Click-throughs in the canvas | Play mode: real clicks and links drive the screens (sandboxed iframes) |
| Getting the work out | Export, then reconcile by hand | It was never uploaded — the workspace folder is the deliverable |
| Source | Vendor-hosted, closed | Open source (MIT), runs locally |

The comparison is qualitative and, deliberately, the difference that matters is
structural: local, open and on your own folders. Treat the left column as "as
of 2026-10-14".

## How it works

- **No project needed.** `/canvas <brief>` in any chat creates a workspace at
  `<Documents>/Design Canvas/<slug>` (the service resolves the root; `DS_WORKSPACE_ROOT`
  overrides it), scaffolds a multi-page Vite skeleton, starts its dev server and
  opens the canvas window. The chat you typed in becomes the canvas session —
  `statusSection.requiresProject` is off for this extension. The setup runs as an
  **async job** (files first, then install, then boot, polled every 2 s with
  progress toasts — "Setting up the canvas… installing (12 s)"), so a slow cold
  cache can never time out the chat's request cap, and the workspace binding is
  stored the moment the files exist: a second `/canvas` never builds a twin.
  User-initiated opens auto-dock the canvas beside the chat — Chrome takes the
  right-hand side of the screen when that still leaves ≥640 px, and your own
  window placement is left untouched when it does not.
- **One canvas, N artboards.** The window lays the workspace's screens out as
  artboards in a grid; pan both axes, Ctrl/⌘+wheel zooms, fit-all frames
  everything. Agent-written screens appear live — the service watches
  `screens.json` — and a broken registry raises a banner in the canvas **and**
  one error toast in the chat (once per distinct message, never a poll storm).
- **Edit vs play.** Edit mode: every iframe click becomes a pick; each queued
  pick arrives as its own reference chip (`Screen: <id>` + that screen's URL)
  through a long-polled **pick queue** — rapid clicks are never coalesced away,
  a hidden chat window loses nothing, and each delivered chip is acked so the
  canvas answers with its own "Added to chat" pill. The artboard menu's **Send
  to chat** attaches a screen-level chip (`Screen: <id> (w×h) — <file path>`).
  Play mode: clicks drive the real pages; navigation stays inside the artboard
  (sandboxed, no top-navigation).
- **The canvas knows when you're busy.** While the agent works, the canvas
  toolbar shows a "Designing…" chip; when the turn settles, fresh artboards
  pulse in. Display-only — nothing is ever sent to the agent automatically.
  Raising the window follows the same discipline: user-initiated opens focus
  it; screen switches and agent navigation never steal your foreground.
- **Screens are real HTML files.** Adding a screen means writing
  `<id>.html` and a `{ "id", "file", "title", "width", "height" }` entry in
  `screens.json` at the workspace root; `index.html` stays a redirect to
  `home.html` so Vite builds keep working. Links between screens are plain
  `<a href="other.html">`.
- **The chat lives OUTSIDE the workspace.** Your agent's prompts mandate the
  absolute workspace path for every file write, edit and bash call — the
  session never needs to move into the workspace folder.
- **`/canvas critique`** runs the deterministic per-screen gate report and
  composes it into the chat as a review request for the agent (the 0–10
  critique is advisory — the agent writes the prose, the service guarantees
  the gate-backed part).
- **`/canvas export [png|pdf]`** exports every screen: per-screen PNGs come
  from the canvas camera, screen-sized PDFs from a hidden throwaway page.
  Files land in `<workspace>/exports/`. `/canvas export` alone exports both
  formats. The export is an async job: the panel polls the service for up to
  ~60 seconds and then asks you to check back ("Export is still running…") —
  files appear in `exports/` as each screen finishes, and a failing screen is
  skipped and counted, never a blocker for the rest.

## Usage patterns

The canvas is built for comparison. Three patterns the prompt rules
(SPEC-V3-P2-SCOPE.md D8) encode, with the preset numbers:

| Ask for… | You get… | The rule |
| --- | --- | --- |
| **Responsive triple** — "make it responsive" | Three artboards of the SAME screen: 390×844 phone · 768×1024 tablet · 1280×800 desktop (default) | Responsive = one artboard per real size, never breakpoints hidden inside one file |
| **Poster / print variants** — "two directions for the poster" | 2–3 complete sibling screens (`home-a`, `home-b`), each its own file + screens.json entry, same size | Variants = side-by-side artboards, never stacked in one file, never hidden behind toggles |
| **App flow** — "the checkout flow from cart to confirmation" | One artboard per step (cart → details → confirmation), plain `<a href>` links between the screens — clickable in play mode | Each step is its own real HTML page; the flow is the screens' order on the canvas |

Other presets the protocol names: 1440×900 large desktop · 1080×1080 social
post · 794×1123 A4 print at 96 dpi. Any size within 200–8192 px is allowed.

## Install

Install through **Settings → Extensions** in OpenChamber, from this repository's
`canvas-fork` branch (a `#canvas-fork` suffix on the git URL pins the channel):

- **Git install.** Paste the repository https git URL with `#canvas-fork`.
- **Folder install (local development).** Paste an absolute path to this
  repository checkout.

Requirements:

- **OpenChamber ≥ 2.2.0** (the manifest declares `engines.openchamber`).
- **Google Chrome** — the local service launches it. `DS_CHROME_PATH` wins on
  every OS; otherwise the path is auto-discovered per platform (Windows:
  Program Files / %LOCALAPPDATA%; macOS: the .app bundle; Linux: google-chrome
  and friends, then PATH).
- Approval of the extension's local **service** permission, once.
- On the **first** `/canvas <brief>`, approve the agent's *out-of-folder*
  file-edit permissions when OpenChamber asks: the canvas session designs in
  the workspace folder, which lives outside the chat's own directory. This is
  a one-time heads-up (see decision 4b in `docs/FORK-DESIGN-CANVAS.md`) and the
  only extra prompt the agent will raise beside its normal edit approvals.
  Exports after that are prompt-free: the panel polls the running export job
  every ~0.7 s and toasts the file paths when it lands in `exports/`.

### Coexistence with the original Design Studio

This fork uses the extension id `design-canvas`, the panel name **Design
Canvas**, the `/canvas` command and the **Canvas** status-section title, so
nothing collides with the original `design-studio` extension — BUT both
manifests declare `service.provides: ["browser"]`, and host arbitration between
two browser providers is out of any extension's control. **Disable the original
Design Studio in Settings → Extensions while using Design Canvas** (and vice
versa) so file actions from the canvas never land in the wrong service.

### Supported platforms

Windows, macOS and Linux are all first-class: Chrome discovery, dev-server
stop/reaping and every path compare are explicitly branched per
`process.platform` — nothing is POSIX-only and nothing breaks on Windows.
Installing on Windows/macOS/Linux follows the same Settings → Extensions flow.

## Development

```bash
npm install
npm run build      # esbuild: panel/main.js (browser IIFE) + service/main.js (Node ESM)
npm run typecheck  # tsc --noEmit
npm run test       # node --test --test-concurrency=1 "tests/*.test.ts"
npm run check      # typecheck + build + test
```

Layout:

- `panel/` — the sandboxed guest iframe: the creation page, the workspace list
  ("Your design work" = `GET /workspaces` rows) and the Work Status row
  (Start/Stop, Design Mode, play/edit, active-screen dropdown, Focus).
- `service/` — the host-spawned local service: the real Chrome canvas driver,
  dev-server management (`project-server.ts`), scaffolding (`scaffold.ts`),
  the screens registry (`screens.ts`), and the verification harness
  (`verify.ts`, `gates/`).
- `shared/` — code both sides import: the vendored design-system catalog, the
  harness rule text, and the verification types.
- `docs/FORK-DESIGN-CANVAS.md` — the fork spec (product decisions 1–12,
  architecture contracts A–H, the phase plan and acceptance list).
- `docs/FORK-CHANGELOG.md` — what each phase changed.

The fork is cross-platform by rule (spec §G): every OS-specific behavior is an
explicit `process.platform` branch, and unchanged POSIX paths stay
byte-identical.

## Contributing

Issues and pull requests are welcome into the `canvas-fork` branch. Keep the
committed `panel/main.js` and `service/main.js` in sync with their sources,
since OpenChamber loads the built files directly. The CI workflow runs
typecheck, build and the non-Chrome test suite.

## License

MIT. See [`LICENSE`](LICENSE). Vendored design-system presets are redistributed
under the Apache License 2.0; see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Design Canvas is a community fork of
[OpenChamber Design Studio](https://github.com/lastonoga/openchamber-design-studio).
It is not affiliated with, endorsed by, or maintained by the OpenChamber team.