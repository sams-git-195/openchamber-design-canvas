# Changelog

All notable changes to OpenChamber Design Canvas are documented here. Design
Canvas is a fork of OpenChamber Design Studio; the upstream 0.1.0 history is
kept below. Detailed fork engineering notes live in
[docs/FORK-CHANGELOG.md](docs/FORK-CHANGELOG.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

These are **not implemented yet** — they are noted here so the roadmap is
visible. Do not expect them in 0.1.0:

- **Agent-driven browsing**: letting the OpenCode agent drive the same browser
  (the `browser.*` actions) so it can see and verify its own work.
- **Point + voice pairing**: speaking a change while pointing at an element, for
  faster point → talk → change loops. Voice control is **not** present in 0.1.0.

## [0.2.0] - 2026-10-18 — Design Canvas (`canvas-fork`)

The fork release: Design Studio becomes **Design Canvas**, a project-free,
multi-screen artboard wall that any OpenChamber chat can open.

### Added

- **`/canvas <brief>` from any chat**: no project needed. A workspace is
  created under `Documents/Design Canvas/<name>` with a Vite skeleton, a design
  system (`DESIGN.md` + `tokens.css`) and a dev server on a free loopback port.
- **Multi-screen artboard canvas**: every screen in `screens.json` is a live
  artboard at its natural size on a pannable, zoomable dot-grid wall, with
  fit-all, zoom-to-screen, drag-to-arrange and per-workspace view state.
- **Edit / Play modes**: in Edit, hover outlines and clicks become queue-backed
  reference chips (rapid clicks are never lost); in Play, screens accept real
  interaction and click-throughs stay inside their artboard.
- **Artboard context menu**: send to chat, zoom, reload, reset position,
  export PNG/PDF, copy path, rename.
- **`/canvas export [png|pdf]`** (exact-size per-screen PNGs and PDFs) and
  **`/canvas critique`** (gate-backed contrast/overflow/tap-target/semantics
  review per screen).
- **Agent awareness**: a "Designing…" toolbar chip and fresh-artboard pulses;
  nothing is ever sent to the agent automatically.
- **Live registry**: new screens appear within seconds; a broken
  `screens.json` is reported in plain language.
- **Cross-platform**: Windows, macOS and Linux are first-class, with Chrome
  auto-discovered per OS.

### Removed

- Upstream Design Studio surfaces with no client in the canvas: the
  settings/tokens/harness/compose panel modules, the HTML linter, and the
  `/verify`, `/harness`, `/files`, `/stat`, `/highlight` and `/bridge` service
  routes. The verify gate engine stays behind the agent's `browser.*` actions.

## [0.1.0] - 2026-10-14

Upstream OpenChamber Design Studio.

First release. Everything below is present in this version.

### Added

- **Design Mode**: a toggle that turns the design harness on for a session and
  attaches the project's design context (the `design` command).
- **Live preview window**: the extension's local service drives a real headless
  Chrome and the host draws it as a shared surface, forwarding your pointer and
  keyboard to the real page.
- **Cmd/Ctrl-click pick → chat reference**: turn on Pick and click an element to
  attach it to the chat as a reference chip carrying its selector, markup,
  computed styles and page URL (`text` reaches the model, `data` is echoed back).
- **Per-project harness plugin**: a generated OpenCode v2 plugin written into
  `.opencode/plugin/design-studio-harness.ts`, so the craft rules and the
  verification mandate run inside the project's agent sessions.
- **DESIGN.md / tokens.css with a preset catalog**: a curated set of design-system
  presets, each with its `DESIGN.md` excerpt and semantic tokens parsed from its
  `tokens.css`.
- **Project scaffolding**: the service can lay down a project skeleton, write
  `.design-studio.json`, pin a loopback port and start the dev server, so a live
  preview appears the moment Design Mode opens.
- **`.design-studio.json` project config**: read on panel open to auto-open the
  project's URL, shown and edited from the panel's **Config** button.
- **Merged design-work list**: a single list that merges the project and chat
  sources into one set of design-work rows, with their loading and error states.
