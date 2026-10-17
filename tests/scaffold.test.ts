// Service-side project scaffolding. Hermetic and network-free: `install` and
// `boot` are turned off, so the tests assert the file set, the config and the
// no-clobber refusal without pulling `vite` or spawning a dev server. The
// install/boot paths are exercised (indirectly) by service.test.ts and
// project-server.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { scaffoldProject, PORT_SCAN_START, PORT_SCAN_END, findFreePort } from '../service/scaffold.ts';
import { canBindPort } from '../service/project-server.ts';
import { DESIGN_SYSTEMS } from '../shared/design-systems.ts';
import type { StudioConfig } from '../service/studio-config.ts';

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
    screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 }],
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

  // package.json pins the same port into the dev script.
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.match(pkg.scripts.dev ?? '', new RegExp(`--port ${port}\\b`));
  assert.equal(typeof pkg.devDependencies.vite, 'string');

  // The skeleton carries the design-system authority stub.
  assert.match(await readFile(path.join(dir, 'DESIGN.md'), 'utf8'), /authoritative/);

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
