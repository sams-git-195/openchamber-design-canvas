// Service-side project scaffolding.
//
// The agent session should open on a project that already exists, runs and has a
// live URL, so the user sees a preview the moment Design Mode starts. This module
// does the mechanical part the prompt describes: create a minimal, runnable Vite
// multi-page skeleton (home.html + an index.html redirect + the shared app.js
// nav + the screens.json registry), write `.design-studio.json`, install deps,
// pin a loopback port and start its dev server (reusing
// project-server.ts's ensureDevServer). The agent only fills content later.
// No harness plugin is written (§5): the canvas session lives outside the
// workspace, so the in-session harness ships via the panel's buildModeChip.
//
// It never clobbers: a directory that already holds a `.design-studio.json` is
// refused, and a dev server that is already up is reused rather than restarted.
// New directories are confined to the workspace root (§E).
//
// SPEC-V4 (V4-11) splits the work in two so the `/scaffold` route can answer
// before the slow part starts:
//   - `writeScaffoldFiles(options)` — the fast half: validate, pin a port,
//     write every project file and the screens registry. No install, no boot.
//   - `installAndBoot(dir, url, ...)` — the slow async half: `npm install` when
//     `node_modules` is missing, then bring the dev server up.
//   - `scaffoldProject(options)` stays as the thin composition of both, so
//     every existing caller keeps its current behaviour.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { canBindPort, ensureDevServer, isLoopbackUrl } from './project-server.ts';
import { DEFAULT_CONFIG_PATH, resolveConfigPath } from './studio-config.ts';
// FORK (decision 5): the in-session harness ships via the panel's buildModeChip
// (and designSessionPrompt), not a plugin — plugin discovery is project-scoped
// while a canvas session runs outside the workspace dir. The module/import stay
// here, deliberately dead, for the future plugin path.
import { writeHarnessPlugin } from './harness-plugin.ts';
import { DESIGN_SYSTEMS, type DesignSystemPreset } from '../shared/design-systems.ts';
import { SCREENS_FILENAME, writeScreens, type Screen } from './screens.ts';
import { isInsideOrEqual, resolveWorkspaceRoot } from './workspace-root.ts';

/**
 * Loopback ports scanned for a free one; pinned into the dev command. The range
 * is wide (800 ports) so parallel inits rarely collide, and the scan starts at a
 * RANDOM offset so two inits do not race for the same low port. Tests inject a
 * `portRange` (start/end/offset) to stay deterministic.
 */
export const PORT_SCAN_START = 5200;
export const PORT_SCAN_END = 5999;

/** A scan window; `offset` pins where the (wrapping) scan begins. */
export type PortRange = { start: number; end: number; offset?: number };

/** How long `npm install` may run before it is killed. */
const INSTALL_TIMEOUT_MS = 180_000;

export type ScaffoldOptions = {
  /** Absolute project directory to create or fill. */
  dir: string;
  /** Artifact type (wireframe | hi-fi | prototype | deck | custom). */
  type: string;
  /** Visual direction, stored under `harness.direction`. */
  direction?: string;
  /** Fidelity, stored under `harness.fidelity`. */
  fidelity?: string;
  /** The user's brief, seeded into the skeleton's hero slot. */
  brief?: string;
  /**
   * Chosen design system preset id (`DESIGN_SYSTEMS`). When it resolves, the
   * skeleton's `tokens.css` and `DESIGN.md` come from the preset and the id is
   * recorded under `harness.designSystem`. An absent or unknown id keeps the
   * default skeleton.
   */
  designSystemId?: string;
  /**
   * Run `npm install` when `node_modules` is missing (default true). Tests turn
   * this off to stay hermetic and independent of the network. A function runs
   * INSTEAD of the real install (V4-11 test seam: a fake npm that sleeps).
   */
  install?: boolean | InstallHook;
  /** Start the dev server after scaffolding (default true). */
  boot?: boolean;
  /**
   * Override the port scan window and start offset. Tests inject this to stay
   * deterministic; production uses the wide default range with a random offset.
   */
  portRange?: PortRange;
  /**
   * Override the resolved workspace root (spec §3) for scaffold confinement.
   * Tests inject this to stay hermetic and independent of the machine's
   * Documents layout; production resolves it via DS_WORKSPACE_ROOT / probing.
   */
  workspaceRoot?: string;
};

export type ScaffoldResult =
  | { ok: true; url: string; files: string[] }
  | { ok: false; error: string };

/** The fast half's result: everything the route needs before starting a job. */
export type WriteScaffoldResult =
  | { ok: true; dir: string; url: string; files: string[] }
  | { ok: false; error: string };

/** Test seam that replaces the real `npm install` (V4-11 acceptance). */
export type InstallHook = (dir: string) => Promise<{ ok: boolean; error?: string }>;

/** Options for the slow half (install + dev-server boot). */
export type InstallBootOptions = {
  /** Run `npm install` when `node_modules` is missing (default true); a
   *  function is called INSTEAD of the real install (test seam, V4-11). */
  install?: boolean | InstallHook;
  /** Bring the dev server up (default true). */
  boot?: boolean;
};

/** Where a wrapping port scan begins: the injected offset, else a random one. */
function scanOffset(start: number, end: number, offset?: number): number {
  const size = end - start + 1;
  if (size <= 0) return 0;
  const base =
    typeof offset === 'number' && Number.isFinite(offset) ? Math.floor(offset) : Math.floor(Math.random() * size);
  return ((base % size) + size) % size;
}

/**
 * First free port in [start, end], scanning from `offset` and wrapping, or null
 * when the whole range is busy. Each candidate is verified by binding it.
 */
export async function findFreePort(start: number, end: number, offset?: number): Promise<number | null> {
  const size = end - start + 1;
  if (size <= 0) return null;
  const from = scanOffset(start, end, offset);
  for (let step = 0; step < size; step += 1) {
    const port = start + ((from + step) % size);
    if (await canBindPort(port)) return port;
  }
  return null;
}

/** npm-package-safe name derived from the directory basename. */
function projectName(dir: string): string {
  const base = path.basename(path.resolve(dir)).toLowerCase();
  const slug = base.replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '');
  if (!slug) return 'design-project';
  return /^[a-z0-9]/.test(slug) ? slug : `design-${slug}`;
}

/** Minimal HTML escaping for values interpolated into the skeleton. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Last `n` lines of captured install output, for an actionable error. */
function tail(text: string, n = 20): string {
  const lines = text.trimEnd().split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

function packageJson(name: string, port: number): string {
  return `${JSON.stringify(
    {
      name,
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        // V4-14 (E12): bind the dev/preview servers to the IPv4 loopback only.
        // A bare `--host` binds all interfaces and serves the workspace to the
        // LAN; `--host 127.0.0.1` keeps the fence ("nothing listening beyond
        // 127.0.0.1") true for scaffolds too.
        dev: `vite --host 127.0.0.1 --strictPort --port ${port}`,
        build: 'vite build',
        preview: `vite preview --host 127.0.0.1 --strictPort --port ${port}`,
      },
      devDependencies: { vite: '^5.4.0' },
    },
    null,
    2,
  )}\n`;
}

/**
 * The canvas home screen. This is where the pre-fork hero logic lives now:
 * the brief seeds the lede slot and everything else is the skeleton the agent
 * fills. The shared bottom nav (app.js) is included here for parity with the
 * screens the agent adds later.
 */
function homeHtml(name: string, brief: string): string {
  const lede = brief
    ? esc(brief)
    : 'Replace this hero with the brief&#39;s opening moment and keep every value a token.';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(name)}</title>
    <link rel="stylesheet" href="./tokens.css" />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <header class="site-header">
      <span class="brand">${esc(name)}</span>
      <nav class="site-nav" aria-label="Primary">
        <a href="#hero">Start</a>
        <a href="#content">Content</a>
      </nav>
    </header>

    <main>
      <!-- Add a screen: create <file>.html, then add it to screens.json AND to
           the DS_SCREENS array in app.js. Keep every value a token. -->
      <!-- HERO SLOT: the agent replaces this block with the brief's opening moment. -->
      <section class="hero" id="hero">
        <p class="eyebrow">Design canvas</p>
        <h1 class="hero__title">${esc(name)}</h1>
        <p class="hero__lede">${lede}</p>
        <div class="hero__actions">
          <a class="button button--primary" href="#content">Get started</a>
          <a class="button" href="#content">Learn more</a>
        </div>
      </section>

      <!-- CONTENT SLOT: sections for the brief go here. -->
      <section class="content" id="content" aria-label="Content">
        <h2>Content</h2>
        <p>Fill this area with the sections the brief calls for.</p>
      </section>
    </main>

    <footer class="site-footer">
      <p>Built with the Design Canvas harness.</p>
    </footer>
    <script src="./app.js" defer></script>
  </body>
</html>
`;
}

/**
 * The Vite default entry stays valid: `vite build` needs an index.html at the
 * root, while the canvas opens home.html (the seeded screen) directly. A
 * meta-refresh redirects any / visit to home.html; the dev command is NOT
 * touched.
 */
function indexRedirectHtml(name: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0; url=./home.html" />
    <title>${esc(name)}</title>
  </head>
  <body>
    <p>Opening <a href="./home.html">${esc(name)}</a>…</p>
  </body>
</html>
`;
}

/**
 * D14 risk 5: the service persists the user's canvas state (view.json:
 * camera/positions/mode) into `.design-studio/` at the workspace root while
 * Vite watches the tree. Without an ignore rule those writes could surface as
 * watched-file events; canvas-state churn must never look like a source edit
 * to HMR. The dev script in package.json stays `npm run dev`.
 */
function viteConfig(): string {
  return `// Design Canvas: .design-studio/ holds runtime view state (view.json), written
// by the extension service while the dev server watches this tree. Keep the
// state dir out of the watcher so saving canvas state never reloads the page.
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    watch: { ignored: ['**/.design-studio/**'] },
  },
});
`;
}

/**
 * The shared bottom nav every screen includes. Deliberately dead simple (fork
 * rule): it renders the SCREENS array baked in at scaffold time — NO runtime
 * screens.json fetch. THE AGENT OWNS BOTH FILES: when a screen is added,
 * update screens.json AND this array here, then re-run npm run dev.
 */
function appJs(screens: ReadonlyArray<{ id: string; file: string; title: string }>): string {
  return `/* app.js — Design Canvas shared bottom nav (scaffold-generated).
   Dead simple by design: the screen list below is baked in at scaffold time,
   not fetched from screens.json. When you add a screen:
     1. create <file>.html in this workspace,
     2. add the entry to screens.json,
     3. add the SAME entry to DS_SCREENS below.
   All three must stay in sync. */
const DS_SCREENS = ${JSON.stringify(screens, null, 2)};
(function () {
  'use strict';
  if (!Array.isArray(DS_SCREENS) || DS_SCREENS.length <= 1) return; // one screen needs no nav
  var page = (location.pathname.split('/').pop() || 'index.html');
  var nav = document.createElement('nav');
  nav.className = 'ds-nav';
  nav.setAttribute('aria-label', 'Screens');
  for (var i = 0; i < DS_SCREENS.length; i += 1) {
    var s = DS_SCREENS[i];
    var a = document.createElement('a');
    a.href = s.file;
    a.textContent = s.title;
    if (s.file === page) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  }
  var style = document.createElement('style');
  style.textContent =
    '.ds-nav{position:fixed;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;padding:10px 16px;background:var(--surface,#161b22);border-top:1px solid var(--border,#262d36);z-index:50}' +
    '.ds-nav a{color:var(--muted,#8b949e);text-decoration:none;padding:4px 10px;border-radius:6px;font-size:0.875rem}' +
    '.ds-nav a:hover,.ds-nav a[aria-current="page"]{color:var(--fg,#e6edf3);background:var(--bg,#0e1116)}';
  document.head.appendChild(style);
  document.body.appendChild(nav);
})();
`;
}

const TOKENS_CSS = `/* tokens.css — the design system's single source of values.
   Every colour, space and type value in styles.css must come from here. */
:root {
  color-scheme: dark;

  /* Surfaces and ink */
  --bg: #0e1116;
  --surface: #161b22;
  --fg: #e6edf3;
  --muted: #8b949e;
  --border: #262d36;
  --accent: #4c8dff;

  /* Type */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --step--1: 0.875rem;
  --step-0: 1rem;
  --step-1: 1.25rem;
  --step-2: 1.563rem;
  --step-3: 1.953rem;
  --step-4: 2.441rem;
  --leading-tight: 1.15;
  --leading-body: 1.55;

  /* Space and shape */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 40px;
  --space-6: 64px;
  --radius: 10px;
  --measure: 68ch;
}
`;

const STYLES_CSS = `/* styles.css — base layer and the starter skeleton.
   Use tokens from tokens.css; a hardcoded value a token covers is a defect. */
*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: var(--step-0);
  line-height: var(--leading-body);
  -webkit-font-smoothing: antialiased;
}

a {
  color: inherit;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border);
}

.brand {
  font-weight: 600;
  letter-spacing: -0.01em;
}

.site-nav {
  display: flex;
  gap: var(--space-4);
}

.site-nav a {
  color: var(--muted);
  text-decoration: none;
}

.site-nav a:hover {
  color: var(--fg);
}

.hero {
  max-width: var(--measure);
  margin: 0 auto;
  padding: var(--space-6) var(--space-5);
}

.eyebrow {
  margin: 0 0 var(--space-2);
  color: var(--muted);
  font-size: var(--step--1);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hero__title {
  margin: 0 0 var(--space-3);
  font-size: clamp(var(--step-3), 6vw, var(--step-4));
  line-height: var(--leading-tight);
  letter-spacing: -0.02em;
}

.hero__lede {
  margin: 0 0 var(--space-5);
  max-width: var(--measure);
  color: var(--muted);
  font-size: var(--step-1);
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--fg);
  font: inherit;
  text-decoration: none;
}

.button--primary {
  border-color: transparent;
  background: var(--accent);
  color: var(--bg);
}

.content {
  max-width: var(--measure);
  margin: 0 auto;
  padding: 0 var(--space-5) var(--space-6);
  color: var(--muted);
}

.content h2 {
  color: var(--fg);
  font-size: var(--step-2);
}

.site-footer {
  padding: var(--space-5);
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: var(--step--1);
}
`;

const DESIGN_MD = `# Design system

**This file and \`tokens.css\` are authoritative for this project.** Follow them over
any conflicting instinct. Do not invent colours, spacing or type values that are
not expressed as tokens; a hardcoded value a token already covers is a defect.

## Tokens

The single source of values is \`tokens.css\`:
\`--bg\`, \`--surface\`, \`--fg\`, \`--muted\`, \`--border\`, \`--accent\`, the type
steps (\`--step-*\`), and the space scale (\`--space-*\`).

## Rules for every screen

- Colour comes from the tokens above; no ad-hoc hex values.
- Type comes from the modular scale; no invented sizes.
- Spacing comes from \`--space-*\`; no magic numbers.
- Every interactive element has a visible \`:focus-visible\` treatment and a 44px
  touch target.
- Render data surfaces in all five states: Loading, Empty, Error, Populated, Edge.
`;

/** The authority statement appended to a preset's DESIGN.md. */
const AUTHORITY_STATEMENT = `## Authority

**This file and \`tokens.css\` are authoritative for this project.** Follow them over
any conflicting instinct. Do not invent colours, spacing or type values that are
not expressed as tokens; a hardcoded value a token already covers is a defect.

## Rules for every screen

- Colour comes from the tokens in \`tokens.css\`; no ad-hoc hex values.
- Type comes from the scale; no invented sizes.
- Spacing comes from the space tokens; no magic numbers.
- Every interactive element has a visible \`:focus-visible\` treatment and a 44px
  touch target.
- Render data surfaces in all five states: Loading, Empty, Error, Populated, Edge.
`;

/** The first preset whose id matches, or null for an absent/blank/unknown id. */
function resolveDesignSystem(id: string | undefined): DesignSystemPreset | null {
  if (typeof id !== 'string') return null;
  const wanted = id.trim();
  if (!wanted) return null;
  return DESIGN_SYSTEMS.find((preset) => preset.id === wanted) ?? null;
}

/**
 * V4-3 (E5) — the scaffold token bridge. `STYLES_CSS` speaks the default
 * skeleton's token vocabulary (`--font-sans`, `--step-*`, `--radius`,
 * `--measure`); every shared design-system preset instead defines the
 * OpenDesign vocabulary (`--font-body`, `--text-*`, `--radius-md`). Without a
 * bridge, every preset workspace renders Times New Roman at UA sizes. Each
 * entry maps a styles.css name onto the preset token that carries it; the
 * last two entries are plain values, not tokens. Emitted inside the preset's
 * `:root` ONLY for names the preset does not itself define, so a preset that
 * ships a real `--radius` keeps its own value.
 */
const SCAFFOLD_TOKEN_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['--font-sans', 'var(--font-body)'],
  ['--font-serif', 'var(--font-display)'],
  ['--step--1', 'var(--text-sm)'],
  ['--step-0', 'var(--text-base)'],
  ['--step-1', 'var(--text-xl)'],
  ['--step-2', 'var(--text-2xl)'],
  ['--step-3', 'var(--text-3xl)'],
  ['--step-4', 'var(--text-4xl)'],
  ['--radius', 'var(--radius-md)'],
  ['--measure', '68ch'],
];

/** A `:root` token block built from a preset, values preserved verbatim. */
function presetTokensCss(preset: DesignSystemPreset): string {
  const decls = Object.entries(preset.tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  // The bridge block: only the names the preset does not define.
  const aliases = SCAFFOLD_TOKEN_ALIASES.filter(([name]) => !(name in preset.tokens));
  const bridge = aliases.length
    ? `\n\n  /* scaffold aliases — styles.css vocabulary → preset tokens */\n${aliases
        .map(([name, value]) => `  ${name}: ${value};`)
        .join('\n')}`
    : '';
  return `/* tokens.css — ${preset.name} design system (id: ${preset.id}).
   Every colour, space and type value in styles.css must come from here. */
:root {
${decls}${bridge}
}
`;
}

/** A preset's DESIGN.md followed by the project's authority statement. */
function presetDesignMd(preset: DesignSystemPreset): string {
  return `${preset.designMd.trimEnd()}\n\n${AUTHORITY_STATEMENT}`;
}

/**
 * The fast half of the scaffold (V4-11): validate, confine, pin a free port
 * and write every project file plus the screens registry. NO install, NO
 * dev-server boot — the `/scaffold` route can answer `{dir,url,files}` right
 * after this resolves and run `installAndBoot` as a background job.
 * `install`/`boot` options are ignored here (they belong to the other half).
 */
export async function writeScaffoldFiles(options: ScaffoldOptions): Promise<WriteScaffoldResult> {
  const dir = options.dir;
  if (!path.isAbsolute(dir)) return { ok: false, error: 'dir must be an absolute path' };
  if (typeof options.type !== 'string' || options.type.trim() === '') {
    return { ok: false, error: 'type must be a non-empty string' };
  }

  // Scaffold confinement (§E): creating a NEW directory is allowed only inside
  // the resolved workspace root — the panel always passes workspace-root dirs;
  // this guards an accidental design project landing in some unrelated folder.
  // An EXISTING directory elsewhere is accepted (the user's own project).
  const existed = await fs.stat(dir).then((s) => s.isDirectory()).catch(() => false);
  if (!existed) {
    const root = options.workspaceRoot ?? (await resolveWorkspaceRoot());
    if (!isInsideOrEqual(root, dir)) {
      return {
        ok: false,
        error: `refusing to create a new design directory outside the Design Canvas workspace root (${root}) — pass a dir under it, or an existing directory`,
      };
    }
  }

  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    return { ok: false, error: `could not create ${dir}: ${error instanceof Error ? error.message : String(error)}` };
  }

  // Never clobber an existing project: any recognised config file at the root
  // means a design project already lives here.
  if ((await resolveConfigPath(dir)) !== null) {
    return { ok: false, error: 'a design project already exists here' };
  }

  const range = options.portRange ?? { start: PORT_SCAN_START, end: PORT_SCAN_END };
  const port = await findFreePort(range.start, range.end, range.offset);
  if (port === null) {
    return { ok: false, error: `no free loopback port in ${range.start}..${range.end}` };
  }
  // V4-14 (E12): the URL is the IPv4 literal, matching the `--host 127.0.0.1`
  // bind below — no localhost/IPv6 ambiguity for Chrome or the probes.
  const url = `http://127.0.0.1:${port}/`;
  const name = projectName(dir);
  const brief = typeof options.brief === 'string' ? options.brief.trim() : '';
  const direction = options.direction && options.direction.trim() ? options.direction.trim() : 'auto';
  const fidelity = options.fidelity && options.fidelity.trim() ? options.fidelity.trim() : 'hi-fi';

  // A resolved preset replaces the default token block and DESIGN.md; an absent
  // or unknown id falls back to the default skeleton (never an error).
  const preset = resolveDesignSystem(options.designSystemId);
  const harness: { direction: string; fidelity: string; designSystem?: string } = { direction, fidelity };
  if (preset) harness.designSystem = preset.id;

  const config = {
    version: 1,
    name,
    type: options.type.trim(),
    url,
    command: 'npm run dev',
    entry: 'index.html',
    pagesRoot: '.',
    harness,
  };

  // The seeded registry entry mirrors what the agent must keep in sync when
  // adding screens (screens.json + the DS_SCREENS array baked into app.js).
  const seedScreen: Screen = { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 };
  const files: Array<[string, string]> = [
    ['package.json', packageJson(name, port)],
    ['home.html', homeHtml(name, brief)],
    ['index.html', indexRedirectHtml(name)],
    ['vite.config.mjs', viteConfig()],
    ['tokens.css', preset ? presetTokensCss(preset) : TOKENS_CSS],
    ['styles.css', STYLES_CSS],
    ['DESIGN.md', preset ? presetDesignMd(preset) : DESIGN_MD],
    ['app.js', appJs([seedScreen])],
  ];

  const written: string[] = [];
  // Persist the chosen port FIRST, before any other file: the config file is
  // both the durable pin and the guard a parallel init sees, so two inits cannot
  // settle on the same free port.
  try {
    await fs.writeFile(path.join(dir, DEFAULT_CONFIG_PATH), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    written.push(DEFAULT_CONFIG_PATH);
  } catch (error) {
    return { ok: false, error: `could not write project files: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    for (const [rel, content] of files) {
      await fs.writeFile(path.join(dir, rel), content, 'utf8');
      written.push(rel);
    }
  } catch (error) {
    return { ok: false, error: `could not write project files: ${error instanceof Error ? error.message : String(error)}` };
  }

  // The screens registry (§A) — validated and written through screens.ts, the
  // same module the /screens routes use.
  try {
    await writeScreens(dir, { version: 1, screens: [seedScreen] });
    written.push(SCREENS_FILENAME);
  } catch (error) {
    return { ok: false, error: `could not write the screens registry: ${error instanceof Error ? error.message : String(error)}` };
  }

  // FORK (decision 5): NO harness plugin write. Canvas sessions run outside the
  // workspace dir and plugin discovery is project-scoped, so the in-session
  // harness ships via the panel's buildModeChip / designSessionPrompt instead.
  // (writeHarnessPlugin stays imported above, intentionally dead — see note.)

  return { ok: true, dir, url, files: written };
}

/**
 * The slow half of the scaffold (V4-11): `npm install` when `node_modules` is
 * missing (or run the injected `install` hook instead — the V4-11 test seam),
 * then bring the dev server up. `ensureDevServer` reuses an already-reachable
 * server for this URL (never a second one) and bounds its own wait. Safe to
 * run as a background job after `/scaffold` has already answered.
 *
 * Call forms (both are used during V4 integration; the positional one is the
 * documented shape from §3):
 *   installAndBoot(dir, url, { install?, boot? })
 *   installAndBoot({ dir, url, ...ScaffoldOptions })   // A's job runner
 */
export async function installAndBoot(
  dir: string | (InstallBootOptions & { dir: string; url: string }),
  url?: string,
  options: InstallBootOptions = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  let targetDir: string;
  let targetUrl: string;
  let opts: InstallBootOptions;
  if (typeof dir === 'string') {
    targetDir = dir;
    targetUrl = url ?? '';
    opts = options;
  } else {
    targetDir = dir.dir;
    targetUrl = dir.url;
    opts = dir;
  }

  // Install the project's own dependencies when they are missing. `vite` is the
  // design project's dependency, not the extension's.
  if (opts.install !== false) {
    const hasModules = await fs
      .stat(path.join(targetDir, 'node_modules'))
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!hasModules) {
      if (typeof opts.install === 'function') {
        const hooked = await opts.install(targetDir);
        if (!hooked.ok) return { ok: false, error: hooked.error ?? 'the injected install hook failed' };
      } else {
        const installed = await runNpmInstall(targetDir);
        if (!installed.ok) return { ok: false, error: installed.error };
      }
    }
  }

  // Bring the dev server up. ensureDevServer reuses an already-reachable server
  // for this URL (never a second one) and bounds its own wait.
  if (opts.boot !== false) {
    if (!isLoopbackUrl(targetUrl)) return { ok: false, error: `scaffolded URL is not loopback: ${targetUrl}` };
    const dev = await ensureDevServer(targetUrl, { dir: targetDir });
    if (!dev.up) return { ok: false, error: dev.error ?? `the dev server did not come up at ${targetUrl}` };
  }

  return { ok: true };
}

/**
 * Create a minimal, runnable design project in `dir`, install its dependencies,
 * start its dev server and write the harness plugin. See the module header.
 * Thin composition of the two halves (V4-11): existing callers keep working.
 */
export async function scaffoldProject(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const written = await writeScaffoldFiles(options);
  if (!written.ok) return written;
  const booted = await installAndBoot(written.dir, written.url, {
    install: options.install,
    boot: options.boot,
  });
  if (!booted.ok) return booted;
  return { ok: true, url: written.url, files: written.files };
}

/** Run `npm install` in `dir`, bounded, capturing the output for errors. */
/**
 * Environment for the `npm install` child. When THIS process was launched
 * under `npm run` (the test suite, host tooling, or any npm-wrapped start),
 * npm exports its own script-policy config as `npm_config_*` variables —
 * including `allow_scripts` fed from the root package.json's allowScripts
 * field. A workspace-level `npm install` then reads them as if the
 * `--allow-scripts` FLAG had been passed and hard-fails EALLOWSCRIPTS ("not
 * allowed in project-scoped installs"). The workspace's own package.json /
 * .npmrc is the honest home for those entries, so the install runs with only
 * this config family stripped; everything else is inherited untouched.
 */
function npmInstallEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    'npm_config_allow_scripts', 'npm_config_allow-scripts',
    'npm_config_never_allow_scripts', 'npm_config_never-allow-scripts',
    'npm_config_dangerously_allow_all_scripts', 'npm_config_dangerously-allow-all-scripts',
  ]) delete env[key];
  return env;
}

async function runNpmInstall(dir: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const finish = (result: { ok: true } | { ok: false; error: string }): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    const win = process.platform === 'win32';
    try {
      // FORK-WIN / V4-14 (E13): `npm` is a .cmd shim on win32 and Node refuses
      // to spawn a .cmd/.bat without a shell (EINVAL since the Node 18/20
      // hardening). The previous `spawn('npm', [...], { shell: true })` passed
      // args through a shell and Node 24 warns DEP0190 on every call. Spawning
      // `cmd.exe /d /s /c "<command line>"` with the command as ONE literal
      // argument runs the same npm shim without ever handing arguments to a
      // shell — no DEP0190, and the command line is a fixed literal (no user
      // input, no concatenation surface). /d skips AutoRun, /s keeps the
      // command string after /c intact. NOTE (verified live): the command
      // string must NOT carry inner quotes around `npm` — Node's argv quoting
      // escapes them and cmd then execs the literal file `"npm"` (not
      // recognized). POSIX spawns `npm` directly (a shebang'd shim, no shell).
      child = win
        ? spawn('cmd.exe', ['/d', '/s', '/c', 'npm install --no-audit --no-fund'], { cwd: dir, env: npmInstallEnv() })
        : spawn('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, env: npmInstallEnv() });
    } catch (error) {
      finish({ ok: false, error: `could not run npm install: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, error: `npm install timed out after ${Math.round(INSTALL_TIMEOUT_MS / 1000)}s\n${tail(output)}` });
    }, INSTALL_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, error: `could not run npm install: ${error.message}` });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) finish({ ok: true });
      else finish({ ok: false, error: `npm install failed (exit code ${code})\n${tail(output)}` });
    });
  });
}
