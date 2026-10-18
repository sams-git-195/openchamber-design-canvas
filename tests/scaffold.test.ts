// Service-side project scaffolding. Hermetic and network-free by default:
// `install` and `boot` are turned off, so the tests assert the file set, the
// config and the no-clobber refusal without pulling `vite` or spawning a dev
// server. The one exception is the V4-14 DEP0190 pin, which runs a REAL
// `npm install` in a subprocess (no shell:true → stderr must stay clean);
// set DS_SKIP_INSTALL_PROBE=1 to skip just that test. The install/boot paths
// are exercised (indirectly) by service.test.ts and project-server.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  scaffoldProject,
  writeScaffoldFiles,
  installAndBoot,
  PORT_SCAN_START,
  PORT_SCAN_END,
  findFreePort,
} from '../service/scaffold.ts';
import { canBindPort } from '../service/project-server.ts';
import { DESIGN_SYSTEMS } from '../shared/design-systems.ts';
import type { StudioConfig } from '../service/studio-config.ts';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'ds-scaffold-'));
}

/** Bind a server to a fixed loopback port and resolve once it is listening. */
function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** The first base port with `count` consecutive free loopback ports. */
async function consecutiveFree(count: number): Promise<number> {
  for (let base = 5900; base < 6600; base += 1) {
    let ok = true;
    for (let i = 0; i < count; i += 1) {
      if (!(await canBindPort(base + i))) {
        ok = false;
        break;
      }
    }
    if (ok) return base;
  }
  throw new Error('no run of free loopback ports found');
}

function isLoopback(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

test('scaffolds a runnable multi-page Vite skeleton with a pinned loopback URL', async () => {
  const dir = await tempDir();
  const result = await scaffoldProject({
    dir,
    type: 'prototype',
    direction: 'editorial',
    fidelity: 'interactive',
    brief: 'A small landing page for a type foundry',
    install: false,
    boot: false,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;

  const expected = [
    'package.json',
    'home.html',
    'index.html',
    'tokens.css',
    'styles.css',
    'DESIGN.md',
    'app.js',
    'screens.json',
    '.design-studio.json',
  ];
  for (const rel of expected) {
    const info = await stat(path.join(dir, rel));
    assert.equal(info.isFile(), true, `${rel} exists`);
    assert.ok(result.files.includes(rel), `${rel} is reported in files[]`);
  }
  // Decision 5: NO harness plugin is written — the in-session harness ships via
  // the panel's buildModeChip, not a project-scoped plugin.
  assert.equal(
    result.files.some((file) => file.includes('.opencode')),
    false,
    'no harness plugin is written or reported',
  );
  await assert.rejects(() => stat(path.join(dir, '.opencode', 'plugin', 'design-studio-harness.ts')), 'no plugin dir exists');

  // index.html is a meta-refresh redirect to home.html (keeps `vite build`'s
  // default entry valid); home.html carries the pre-fork hero with the brief.
  const indexHtml = await readFile(path.join(dir, 'index.html'), 'utf8');
  assert.match(indexHtml, /http-equiv="refresh" content="0; url=\.\/home\.html"/, 'index.html redirects to home.html');
  const homeHtml = await readFile(path.join(dir, 'home.html'), 'utf8');
  assert.match(homeHtml, /A small landing page for a type foundry/, 'the brief seeds the home lede');
  assert.match(homeHtml, /src="\.\/app\.js"/, 'home.html loads the shared nav');

  // app.js carries the bundled screen list for the bottom nav.
  assert.match(await readFile(path.join(dir, 'app.js'), 'utf8'), /DS_SCREENS/);

  // screens.json seeds the home screen registry per spec §A.
  const registry = JSON.parse(await readFile(path.join(dir, 'screens.json'), 'utf8')) as {
    version: number;
    screens: Array<{ id: string; file: string; title: string; width: number; height: number }>;
  };
  assert.deepEqual(registry, {
    version: 1,
    screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1440, height: 900 }],
  });

  // The URL is loopback and the port is inside the pinned scan range.
  assert.equal(isLoopback(result.url), true, 'url is loopback');
  const port = Number(new URL(result.url).port);
  assert.ok(port >= PORT_SCAN_START && port <= PORT_SCAN_END, `port ${port} is in the scan range`);

  // The config parses and carries the pinned port, the run command and the
  // canvas pagesRoot.
  const config = JSON.parse(await readFile(path.join(dir, '.design-studio.json'), 'utf8')) as StudioConfig;
  assert.equal(config.version, 1);
  assert.equal(config.type, 'prototype');
  assert.equal(config.entry, 'index.html');
  assert.equal(config.command, 'npm run dev');
  assert.equal((config as Record<string, unknown>).pagesRoot, '.');
  assert.equal(config.url, result.url);
  assert.deepEqual(config.harness, { direction: 'editorial', fidelity: 'interactive' });

  // package.json pins the same port into the dev script — and the script binds
  // the IPv4 loopback only (V4-14/E12): a bare `--host` exposes the workspace
  // to the LAN. preview must not regress either.
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.match(pkg.scripts.dev ?? '', new RegExp(`--port ${port}\\b`));
  assert.equal(pkg.scripts.dev, `vite --host 127.0.0.1 --strictPort --port ${port}`, 'dev binds 127.0.0.1 only');
  assert.equal(
    pkg.scripts.preview,
    `vite preview --host 127.0.0.1 --strictPort --port ${port}`,
    'preview binds 127.0.0.1 only',
  );
  assert.doesNotMatch(pkg.scripts.dev ?? '', /--host(?!\s+127\.0\.0\.1)/, 'no bare --host in the dev script');
  assert.equal(config.url, `http://127.0.0.1:${port}/`, 'the config url is the IPv4 loopback literal');
  assert.equal(typeof pkg.devDependencies.vite, 'string');

  // The skeleton carries the design-system authority stub, marked placeholder
  // until the agent confirms a look; tokens.css says the same.
  const defaultDesignMd = await readFile(path.join(dir, 'DESIGN.md'), 'utf8');
  assert.match(defaultDesignMd, /authoritative/);
  assert.match(defaultDesignMd, /Status: placeholder/, 'the default DESIGN.md is a placeholder');
  const defaultTokens = await readFile(path.join(dir, 'tokens.css'), 'utf8');
  assert.match(defaultTokens, /Status: placeholder/, 'the default tokens.css is a placeholder');
  assert.match(defaultTokens, /--bg: #0e1116/, 'the default values are unchanged');

  // BRIEF.md is seeded beside DESIGN.md with the request and the setup lines.
  assert.ok(result.files.includes('BRIEF.md'), 'BRIEF.md is reported in files[]');
  const briefMd = await readFile(path.join(dir, 'BRIEF.md'), 'utf8');
  assert.match(briefMd, /A small landing page for a type foundry/, 'BRIEF.md carries the brief');
  assert.match(briefMd, /- Type: prototype · Fidelity: interactive/);
  assert.match(briefMd, /- Look: editorial/);
  assert.match(briefMd, /- Devices: to confirm/, 'no devices → to confirm');
  assert.match(briefMd, /- User's project: none/);
  assert.match(briefMd, /## Decisions/);
  assert.match(briefMd, /## Open questions/);

  // D14 risk 5: vite.config.mjs keeps the service's runtime state dir
  // (.design-studio/ — view.json positions/camera) out of the watcher so
  // persisting canvas state never looks like a source edit to HMR.
  const expectedFiles = ['package.json', 'home.html', 'index.html', 'tokens.css', 'styles.css', 'DESIGN.md', 'app.js', 'screens.json', '.design-studio.json', 'vite.config.mjs'];
  for (const rel of expectedFiles) {
    assert.ok(result.files.includes(rel), `${rel} is reported in files[]`);
  }
  const viteConfig = await readFile(path.join(dir, 'vite.config.mjs'), 'utf8');
  assert.match(viteConfig, /\.design-studio/, 'the vite watcher ignores the state dir');
});

test('a second scaffold in the same directory is refused and clobbers nothing', async () => {
  const dir = await tempDir();
  const first = await scaffoldProject({ dir, type: 'hi-fi', install: false, boot: false });
  assert.equal(first.ok, true);

  const before = await readFile(path.join(dir, 'home.html'), 'utf8');

  const second = await scaffoldProject({ dir, type: 'deck', install: false, boot: false });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.match(second.error, /already exists/);

  // The original files are untouched.
  assert.equal(await readFile(path.join(dir, 'home.html'), 'utf8'), before);
  const config = JSON.parse(await readFile(path.join(dir, '.design-studio.json'), 'utf8')) as StudioConfig;
  assert.equal(config.type, 'hi-fi', 'the first type survives');
});

test('a non-absolute dir is refused', async () => {
  const result = await scaffoldProject({ dir: 'relative/project', type: 'hi-fi', install: false, boot: false });
  assert.equal(result.ok, false);
});

test('a known designSystemId writes the preset tokens, DESIGN.md and harness id', async () => {
  const dir = await tempDir();
  const preset = DESIGN_SYSTEMS.find((p) => p.id === 'vercel');
  assert.ok(preset, 'the vercel preset exists');
  if (!preset) return;

  const result = await scaffoldProject({
    dir,
    type: 'hi-fi',
    direction: 'editorial',
    fidelity: 'interactive',
    designSystemId: preset.id,
    install: false,
    boot: false,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;

  // The preset's tokens land in tokens.css, a color-mix(...) value verbatim.
  const tokens = await readFile(path.join(dir, 'tokens.css'), 'utf8');
  const [key, value] = Object.entries(preset.tokens)[0]!;
  assert.ok(tokens.includes(`${key}: ${value};`), `tokens.css carries ${key}: ${value}`);
  assert.ok(
    tokens.includes(`--accent-hover: ${preset.tokens['--accent-hover']};`),
    'the color-mix accent-hover value is preserved verbatim',
  );

  // DESIGN.md carries the preset text and the authority statement.
  const designMd = await readFile(path.join(dir, 'DESIGN.md'), 'utf8');
  assert.ok(designMd.includes('Design System Inspired by Vercel'), 'DESIGN.md carries the preset text');
  assert.match(designMd, /authoritative/, 'DESIGN.md carries the authority statement');
  assert.match(designMd, /focus-visible/, 'the authority statement keeps focus-visible');
  assert.match(designMd, /44px/, 'the authority statement keeps the 44px target');
  assert.match(designMd, /Status: confirmed — source: preset/, 'a preset DESIGN.md is marked confirmed');
  assert.ok(designMd.startsWith(`Status: confirmed — source: preset ${preset.name} (${preset.id}).\n\n`), 'the status line leads the file');

  // The config records the preset id and keeps direction/fidelity.
  const config = JSON.parse(await readFile(path.join(dir, '.design-studio.json'), 'utf8')) as StudioConfig;
  assert.equal(config.harness?.direction, 'editorial');
  assert.equal(config.harness?.fidelity, 'interactive');
  assert.equal((config.harness as Record<string, unknown> | undefined)?.designSystem, preset.id);
});

test('an unknown designSystemId falls back to the default skeleton', async () => {
  const dir = await tempDir();
  const result = await scaffoldProject({
    dir,
    type: 'wireframe',
    designSystemId: 'no-such-preset',
    install: false,
    boot: false,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;

  for (const rel of ['tokens.css', 'styles.css', 'DESIGN.md', '.design-studio.json']) {
    const info = await stat(path.join(dir, rel));
    assert.equal(info.isFile(), true, `${rel} exists`);
  }

  // The default token block survives, not a preset's.
  const tokens = await readFile(path.join(dir, 'tokens.css'), 'utf8');
  assert.match(tokens, /--bg: #0e1116/, 'the default token block is written');

  const config = JSON.parse(await readFile(path.join(dir, '.design-studio.json'), 'utf8')) as StudioConfig;
  assert.equal(
    (config.harness as Record<string, unknown> | undefined)?.designSystem,
    undefined,
    'no designSystem is recorded for an unknown id',
  );
});

// ---- P3: device artboards + BRIEF.md ----

test('devices seed one artboard per device at the viewport presets, sharing home.html', async () => {
  const dir = await tempDir();
  const projectDir = path.join(await tempDir(), 'my-app');
  const result = await scaffoldProject({
    dir,
    type: 'hi-fi',
    brief: 'A habit tracker',
    devices: ['phone', 'desktop'],
    projectDir,
    install: false,
    boot: false,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;

  const registry = JSON.parse(await readFile(path.join(dir, 'screens.json'), 'utf8')) as {
    screens: Array<{ id: string; file: string; title: string; width: number; height: number }>;
  };
  assert.deepEqual(
    registry.screens.map(({ id, file, width, height }) => ({ id, file, width, height })),
    [
      { id: 'home', file: 'home.html', width: 1440, height: 900 },
      { id: 'home-phone', file: 'home.html', width: 390, height: 844 },
    ],
    'desktop first, then phone; both point at the one shared home.html',
  );
  // The registry round-trips through the reader with both entries intact.
  const { readScreens } = await import('../service/screens.ts');
  assert.deepEqual((await readScreens(dir)).screens.map((s) => s.id), ['home', 'home-phone']);
  // No per-device copies are written.
  await assert.rejects(() => stat(path.join(dir, 'home-phone.html')));

  // app.js bakes the same list, in the same order.
  const appJs = await readFile(path.join(dir, 'app.js'), 'utf8');
  assert.ok(appJs.indexOf('"home-phone"') > appJs.indexOf('"id": "home"'), 'DS_SCREENS keeps the registry order');

  const briefMd = await readFile(path.join(dir, 'BRIEF.md'), 'utf8');
  assert.match(briefMd, /- Devices: desktop, phone/);
  assert.ok(briefMd.includes(`- User's project: ${projectDir}`), 'projectDir lands in BRIEF.md');
  await assert.rejects(() => stat(path.join(projectDir, 'BRIEF.md')), 'no project files are written');
});

test('all three devices seed home / home-tablet / home-phone in canvas order', async () => {
  const dir = await tempDir();
  const result = await scaffoldProject({
    dir,
    type: 'hi-fi',
    devices: ['phone', 'tablet', 'desktop'],
    install: false,
    boot: false,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const registry = JSON.parse(await readFile(path.join(dir, 'screens.json'), 'utf8')) as {
    screens: Array<{ id: string; width: number; height: number }>;
  };
  assert.deepEqual(
    registry.screens.map(({ id, width, height }) => ({ id, width, height })),
    [
      { id: 'home', width: 1440, height: 900 },
      { id: 'home-tablet', width: 768, height: 1024 },
      { id: 'home-phone', width: 390, height: 844 },
    ],
  );
});

test('a preset scaffold names the preset on the BRIEF.md Look line', async () => {
  const dir = await tempDir();
  const preset = DESIGN_SYSTEMS.find((p) => p.id === 'vercel');
  assert.ok(preset);
  if (!preset) return;
  const result = await scaffoldProject({ dir, type: 'hi-fi', designSystemId: preset.id, install: false, boot: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  const briefMd = await readFile(path.join(dir, 'BRIEF.md'), 'utf8');
  assert.ok(briefMd.includes(`- Look: ${preset.name}`));
  assert.match(briefMd, /\(none yet — the agent asks first\)/, 'no brief → the placeholder request');
});

// ---- port scan: skips busy ports, respects an injected offset/range ----

test('the port scan skips busy ports and respects an injected offset with wrapping', async () => {
  const base = await consecutiveFree(4);
  const a = await occupy(base);
  const b = await occupy(base + 1);
  try {
    // offset 0 starts at the busy base → the first free above it.
    assert.equal(await findFreePort(base, base + 3, 0), base + 2);
    // offset 2 starts at base+2 (free) → itself.
    assert.equal(await findFreePort(base, base + 3, 2), base + 2, 'the injected offset moves the scan start');
    // offset 3 starts at base+3 (free).
    assert.equal(await findFreePort(base, base + 3, 3), base + 3);
    // A single, busy port has no free candidate.
    assert.equal(await findFreePort(base, base, 0), null, 'a fully busy range has no port');
    // An empty range is null, not a crash.
    assert.equal(await findFreePort(base + 3, base, 0), null);
  } finally {
    await closeServer(a);
    await closeServer(b);
  }
});

test('scaffold pins a port from the injected range and offset', async () => {
  const base = await consecutiveFree(2);
  const dir = await tempDir();
  const result = await scaffoldProject({
    dir,
    type: 'hi-fi',
    install: false,
    boot: false,
    portRange: { start: base, end: base + 1, offset: 1 },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(new URL(result.url).port, String(base + 1), 'the offset port is pinned');
});

// ---- scaffold confinement (§E) ----

test('a NEW directory outside the workspace root is refused', async () => {
  const root = await tempDir(); // the injected workspace root
  const outside = await tempDir(); // an unrelated temp dir, sibling of root
  const target = path.join(outside, 'fresh-outside-dir');
  assert.ok(!insideOrEqualHelper(root, target), 'the target is genuinely outside the root');

  const result = await scaffoldProject({
    dir: target,
    type: 'hi-fi',
    install: false,
    boot: false,
    workspaceRoot: root,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /outside the Design Canvas workspace root/);
  await assert.rejects(() => stat(path.join(target, '.design-studio.json')), 'nothing was written');
});

test('a NEW directory inside the workspace root scaffolds', async () => {
  const root = await tempDir();
  const target = path.join(root, 'brand-new-slug');
  const result = await scaffoldProject({
    dir: target,
    type: 'wireframe',
    install: false,
    boot: false,
    workspaceRoot: root,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal((await stat(path.join(target, 'home.html'))).isFile(), true, 'home.html was seeded');
});

test('an EXISTING directory outside the workspace root is accepted (the user\u2019s own project)', async () => {
  const root = await tempDir();
  const existing = await tempDir(); // exists already, outside root
  assert.ok(!insideOrEqualHelper(root, existing), 'the existing dir is genuinely outside the root');

  const result = await scaffoldProject({
    dir: existing,
    type: 'hi-fi',
    install: false,
    boot: false,
    workspaceRoot: root,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

/** Local mirror of the lexical containment rule used by the tests. */
function insideOrEqualHelper(root: string, dir: string): boolean {
  const r = path.resolve(root);
  const d = path.resolve(dir);
  return d === r || d.startsWith(r + path.sep);
}

// ---- V4-3 (E5): the scaffold token bridge ----
//
// STYLES_CSS speaks the default skeleton vocabulary (--font-sans, --step-*,
// --radius, --measure); every shared preset defines the OpenDesign vocabulary
// (--font-body, --text-*, --radius-md) instead. presetTokensCss must bridge
// every gap so no `var(--x)` in styles.css dangles — a dangling font var is
// what rendered every preset workspace in Times New Roman.

/** Every custom-property name a CSS file references through `var(--…)`. */
function cssVarUses(css: string): string[] {
  return [...new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1] as string))];
}

/** Every custom-property name a CSS file declares (`--name: value`). */
function cssVarDecls(css: string): string[] {
  return [...new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string))];
}

/** The scaffold's styles.css vocabulary that presets do NOT define. */
const BRIDGED_ALIASES: Array<[string, string]> = [
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

/** Scaffold one throwaway workspace with the given preset id and read back its CSS pair. */
async function scaffoldCssPair(
  designSystemId?: string,
): Promise<{ tokens: string; styles: string }> {
  const dir = await tempDir();
  const result = await writeScaffoldFiles({ dir, type: 'hi-fi', designSystemId, install: false, boot: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  return {
    tokens: await readFile(path.join(dir, 'tokens.css'), 'utf8'),
    styles: await readFile(path.join(dir, 'styles.css'), 'utf8'),
  };
}

test('V4-3: for EVERY preset the generated tokens.css covers every var(--…) styles.css uses', async () => {
  // The default skeleton (no preset) is covered by its own token block — pin
  // the same subset property for it too.
  for (const preset of [null, ...DESIGN_SYSTEMS]) {
    const { tokens, styles } = await scaffoldCssPair(preset?.id);
    const declared = new Set(cssVarDecls(tokens));
    const dangling = cssVarUses(styles).filter((name) => !declared.has(name));
    assert.deepEqual(dangling, [], `${preset?.id ?? '(default skeleton)'}: dangling vars ${JSON.stringify(dangling)}`);
  }
});

test('V4-3: bridge alias targets resolve to tokens the preset itself declares', async () => {
  for (const preset of DESIGN_SYSTEMS) {
    const { tokens } = await scaffoldCssPair(preset.id);
    const declared = new Set(cssVarDecls(tokens));
    for (const [, value] of BRIDGED_ALIASES) {
      const target = value.match(/^var\(\s*(--[\w-]+)\s*\)$/)?.[1];
      if (target) {
        assert.ok(declared.has(target), `${preset.id}: alias target ${target} is declared in the preset block`);
      }
    }
  }
});

test('V4-3: warm-editorial, neon, brutalism and mono carry the exact alias block', async () => {
  for (const id of ['warm-editorial', 'neon', 'brutalism', 'mono']) {
    const preset = DESIGN_SYSTEMS.find((p) => p.id === id);
    assert.ok(preset, `preset ${id} exists`);
    if (!preset) continue;
    const { tokens } = await scaffoldCssPair(id);
    assert.match(tokens, /\/\* scaffold aliases — styles\.css vocabulary → preset tokens \*\//, `${id}: bridge comment present`);
    for (const [name, value] of BRIDGED_ALIASES) {
      // Only names the preset does not itself define are aliased.
      if (name in preset.tokens) {
        assert.ok(
          !tokens.includes(`${name}: ${value};`),
          `${id}: preset-defined ${name} is NOT overwritten by an alias`,
        );
      } else {
        assert.ok(tokens.includes(`  ${name}: ${value};`), `${id}: ${name}: ${value}; is bridged`);
      }
    }
    // The headline regression: the body font must come from the preset, not UA.
    assert.match(tokens, /--font-sans: var\(--font-body\);/, `${id}: --font-sans is bridged`);
  }
});

// ---- V4-11 (E15): scaffold split — writeScaffoldFiles + installAndBoot ----

test('writeScaffoldFiles writes the whole file set and installs/boots nothing', async () => {
  const dir = await tempDir();
  const result = await writeScaffoldFiles({ dir, type: 'hi-fi', install: false, boot: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;

  assert.equal(result.dir, dir, 'the result carries the dir for the async job half');
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'and the pinned loopback url');
  for (const rel of ['package.json', 'home.html', 'index.html', 'tokens.css', 'styles.css', 'DESIGN.md', 'app.js', 'screens.json', '.design-studio.json', 'vite.config.mjs']) {
    assert.ok(result.files.includes(rel), `${rel} is reported`);
    assert.equal((await stat(path.join(dir, rel))).isFile(), true, `${rel} exists on disk`);
  }

  // No install half ran: the workspace has no node_modules of its own…
  await assert.rejects(() => stat(path.join(dir, 'node_modules')), 'install did not run');
  // …and no boot half ran: the pinned port is STILL free (nothing is listening).
  const port = Number(new URL(result.url).port);
  assert.equal(await canBindPort(port), true, 'the dev server was not started');

  // The no-clobber guard lives in the write half: a second write is refused.
  const second = await writeScaffoldFiles({ dir, type: 'deck', install: false, boot: false });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.match(second.error, /already exists/);
});

test('installAndBoot skips cleanly, honours the flags, and runs an injected install hook (V4-11 seam)', async () => {
  const dir = await tempDir();
  const written = await writeScaffoldFiles({ dir, type: 'hi-fi', install: false, boot: false });
  assert.equal(written.ok, true);
  if (!written.ok) return;

  // install:false + boot:false — the trivially green composition path.
  assert.deepEqual(await installAndBoot(dir, written.url, { install: false, boot: false }), { ok: true });

  // A's /scaffold job runner calls the OPTIONS-OBJECT form (main.ts binds
  // `installAndBoot({...options, url})`); pin that call shape too — both forms
  // are contract, per the §3 integration note.
  const jobOptions = { dir, url: written.url, type: 'hi-fi', install: false, boot: false };
  assert.deepEqual(await installAndBoot(jobOptions), { ok: true }, 'the options-object call form works');

  // The injected hook replaces the real npm install (fake-npm-sleeps seam).
  const calls: string[] = [];
  const hooked = await installAndBoot(dir, written.url, {
    install: async (d) => {
      calls.push(d);
      return { ok: true };
    },
    boot: false,
  });
  assert.deepEqual(hooked, { ok: true });
  assert.deepEqual(calls, [dir], 'the hook ran exactly once with the workspace dir');

  // A failing hook fails the job with its error text.
  const failed = await installAndBoot(dir, written.url, {
    install: async () => ({ ok: false, error: 'fake npm exploded' }),
    boot: false,
  });
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.match(failed.error, /fake npm exploded/);

  // An installed workspace skips the hook entirely (node_modules present).
  await mkdir(path.join(dir, 'node_modules'), { recursive: true });
  const callsAfter = [...calls];
  await installAndBoot(dir, written.url, {
    install: async (d) => {
      calls.push(d);
      return { ok: true };
    },
    boot: false,
  });
  assert.deepEqual(calls, callsAfter, 'existing node_modules means no install at all');
});

// ---- V4-14 (E13): real win32/POSIX npm install must not warn DEP0190 ----
//
// `spawn('npm', [...], {shell:true})` made Node 24 print DEP0190 on every
// scaffold install. The fix spawns `cmd.exe /d /s /c "npm install …"` (a
// single literal command string, no args through a shell) on win32 and plain
// `npm` elsewhere. This pin RUNS THE REAL INSTALL in a child process (warm
// cache: ~5 s; cold cache may take a while) and fails if DEP0190 appears on
// the child's stderr or node_modules/vite is missing. Escape hatch:
// DS_SKIP_INSTALL_PROBE=1 (the integrator runs WITHOUT it).
test('a real scaffold + npm install emits no DEP0190 and produces node_modules/vite', { timeout: 420_000 }, async (t) => {
  if (process.env.DS_SKIP_INSTALL_PROBE === '1') {
    t.skip('DS_SKIP_INSTALL_PROBE=1 — real install probe skipped (integrator must run without it)');
    return;
  }
  const dir = await tempDir();
  const scaffoldModule = new URL('../service/scaffold.ts', import.meta.url).href;
  const probe = `
import { writeScaffoldFiles, installAndBoot } from ${JSON.stringify(scaffoldModule)};
let depWarn = false;
process.on('warning', (w) => {
  if (/DEP0190/.test(\`\${w.code ?? ''} \${w.message}\`)) depWarn = true;
});
const written = await writeScaffoldFiles({ dir: ${JSON.stringify(dir)}, type: 'hi-fi', install: false, boot: false });
if (!written.ok) { console.error('WRITE-FAILED', written.error); process.exit(2); }
const booted = await installAndBoot(written.dir, written.url, { boot: false });
if (!booted.ok) { console.error('INSTALL-FAILED', booted.error ?? ''); process.exit(3); }
if (depWarn) { console.error('PROBE-DEP0190'); process.exit(4); }
console.log('INSTALL-OK');
`;
  const probeFile = path.join(await tempDir(), 'dep0190-probe.mts');
  await writeFile(probeFile, probe, 'utf8');

  const child = spawn(process.execPath, [probeFile], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => (stdout += String(c)));
  child.stderr.on('data', (c) => (stderr += String(c)));
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));

  assert.equal(stdout.includes('INSTALL-OK'), true, `install probe finished ok (code=${code})\nstderr: ${stderr.slice(-400)}`);
  assert.doesNotMatch(stderr, /DEP0190/, `child stderr carries no DEP0190\n${stderr.slice(-400)}`);
  assert.equal(
    (await stat(path.join(dir, 'node_modules', 'vite'))).isDirectory(),
    true,
    'node_modules/vite was really installed',
  );
});
