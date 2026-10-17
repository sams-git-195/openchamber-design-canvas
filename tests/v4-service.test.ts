// SPEC-V4-CARBON-PARITY — workstream A (service core) hermetic pins.
// No Chrome, no network: every V4 decision that can be proven at the module
// or route level lives here; the Chrome-dependent regressions (E1/E3/E4/E9,
// live registry push, queue timing) live in tests/v4-live.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

/** Integrator: probe-bind candidate ports so blind random draws can never
 *  land in a Windows OS-excluded port range (EACCES at child bind). See
 *  tests/service.test.ts pickFreePort for the full rationale. */
function pickFreePort(min: number, span: number, attempts = 48): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Math.floor(Math.random() * span);
    let i = 0;
    const tryNext = (): void => {
      if (i >= attempts) { reject(new Error(`no bindable port in ${min}..${min + span - 1}`)); return; }
      const candidate = (start + i * 37) % span + min;
      i += 1;
      const probe = createServer();
      probe.once('error', () => { probe.removeAllListeners('listening'); setTimeout(tryNext, 10); });
      probe.once('listening', () => probe.close(() => resolve(candidate)));
      probe.listen(candidate, '127.0.0.1');
    };
    tryNext();
  });
}

import { Browser, dockPlacement, MIN_DOCK_WIDTH, resolveChromePath } from '../service/browser.ts';
import type { PickedElement } from '../service/browser.ts';
import { PickQueue, PICK_QUEUE_CAP, PICKS_PAGE_MAX } from '../service/pick-queue.ts';
import type { QueuedPick } from '../service/pick-queue.ts';
import { readScreensStrict, renameScreen, ScreenRenameError, SCREENS_FILENAME } from '../service/screens.ts';
import { watchRegistry, type RegistryChange } from '../service/screens-watch.ts';
import { mergeView, readView } from '../service/view-state.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'v4-test-token-123';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`service exited early: ${child.exitCode}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await pause(100);
  }
  throw new Error('v4 service did not become healthy');
}

const fakePicked = (): PickedElement & { additive?: boolean } => ({
  selector: '#b',
  tag: 'button',
  classes: '',
  text: 'B',
  outerHTML: '<button id="b">B</button>',
  styles: { color: 'rgb(0, 0, 0)' },
  rect: { x: 40, y: 40, width: 120, height: 40 },
});

// ---- V4-5: pick queue (ordering, cap, long-poll, ack, watchdog) --------------

test('pick queue keeps seq order, caps the ring at 50, and pages at most 20', async () => {
  const toasts: Array<{ kind: string; text: string }> = [];
  const queue = new PickQueue((kind, text) => toasts.push({ kind, text }));
  for (let i = 0; i < 55; i += 1) {
    queue.push({ kind: 'element', screen: 'home', screenUrl: 'http://x/home', at: 1000 + i, additive: false, ...fakePicked(), text: `t${i}` });
  }
  const page = await queue.read(0, 0);
  assert.equal(page.seq, 55, 'seq names the newest push');
  assert.equal(page.picks.length, PICKS_PAGE_MAX, 'at most 20 per response');
  assert.equal(page.picks[0]?.seq, 6, 'the ring dropped the five oldest (55-50)');
  const seqs = page.picks.map((p: QueuedPick) => p.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'oldest first');
  assert.equal(PICK_QUEUE_CAP, 50);
});

test('pick queue long-poll resolves at the first push and returns two close picks', async () => {
  const queue = new PickQueue(() => undefined);
  const first = queue.read(0, 3000);
  await pause(30);
  queue.push({ kind: 'element', screen: 'home', screenUrl: 'u', at: 1, additive: false, ...fakePicked() });
  const t0 = Date.now();
  const got = await first;
  assert.ok(Date.now() - t0 < 200, 'resolves promptly after a push');
  assert.equal(got.picks.length, 1);
  assert.equal(got.seq, 1);
  // Two picks 50 ms apart on the SAME since floor: the 900 ms poll window loss
  // (E7) must be impossible — both arrive, in seq order.
  queue.push({ kind: 'element', screen: 'home', screenUrl: 'u', at: 2, additive: false, ...fakePicked(), selector: '#x' });
  await pause(50);
  queue.push({ kind: 'element', screen: 'home', screenUrl: 'u', at: 3, additive: true, ...fakePicked(), selector: '#y' });
  const both = await queue.read(got.seq, 3000);
  assert.equal(both.picks.length, 2, 'two picks in one interval BOTH arrive');
  assert.equal(both.picks[0]?.selector, '#x');
  assert.equal(both.picks[1]?.selector, '#y');
  assert.equal(both.picks[1]?.additive, true, 'the reserved additive flag rides through');
});

test('pick queue long-poll times out empty when nothing arrives', async () => {
  const queue = new PickQueue(() => undefined);
  const t0 = Date.now();
  const got = await queue.read(0, 150);
  assert.equal(got.picks.length, 0);
  assert.ok(Date.now() - t0 >= 140, 'waited out the window');
});

test('pick queue ack toasts once and the unacked watchdog fires after 2.5s', async () => {
  const toasts: Array<{ kind: string; text: string }> = [];
  const acked = new PickQueue((kind, text) => toasts.push({ kind, text }));
  acked.push({ kind: 'screen', screen: 'home', screenUrl: 'u', at: 1, additive: false, width: 1280, height: 800 });
  acked.ack(1, 'Home (1280×800)');
  assert.deepEqual(toasts[0], { kind: 'ok', text: 'Added to chat · Home (1280×800)' });
  await pause(2800);
  assert.equal(toasts.length, 1, 'acked pushes never raise the warn toast');

  const lost = new PickQueue((kind, text) => toasts.push({ kind, text }));
  lost.push({ kind: 'screen', screen: 'home', screenUrl: 'u', at: 1, additive: false });
  await pause(2800);
  const warn = toasts.filter((t) => t.kind === 'warn');
  assert.equal(warn.length, 1, 'exactly one not-delivered warn after the watchdog');
  assert.match(warn[0]!.text, /Not delivered — open the chat with Design Mode on/);
  lost.ack(1, 'late'); // stale ack still answers through the ok toast
  assert.ok(toasts.some((t) => t.kind === 'ok'));

  const closed = new PickQueue(() => undefined);
  closed.push({ kind: 'screen', screen: 'a', screenUrl: '', at: 0, additive: false });
  closed.close();
  await pause(2800);
});

// ---- V4-4/V4-17: loud registry reads + rename ---------------------------------

test('readScreensStrict answers drops with reasons, clamps silently, and names parse errors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-screens-'));
  await writeFile(
    path.join(dir, SCREENS_FILENAME),
    JSON.stringify({
      version: 1,
      screens: [
        { id: 'home', file: 'home.html', title: 'Home', width: 120, height: 800 }, // clamp (kept)
        { id: 'BAD ID', file: 'x.html', width: 400, height: 400 }, // dropped: id
        { id: 'esc', file: '../escape.html', width: 400, height: 400 }, // dropped: file
        { id: 'nope', file: 'nope.html', width: 'wide', height: 400 }, // dropped: width
        { id: 'home', file: 'home2.html', width: 400, height: 400 }, // dropped: duplicate
      ],
    }),
    'utf8',
  );
  const read = await readScreensStrict(dir);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.registry.screens.length, 1, 'only the clampable entry survives');
  assert.equal(read.registry.screens[0]?.width, 200, '§A clamp stays silent (120 → 200, NOT a drop)');
  assert.equal(read.dropped.length, 4);
  assert.match(read.dropped[0]!.reason, /id must match/);
  assert.match(read.dropped[1]!.reason, /file must be a relative/);
  assert.match(read.dropped[2]!.reason, /width must be a number/);
  assert.match(read.dropped[3]!.reason, /duplicate id "home"/);
  assert.equal(read.dropped[0]!.index, 1, 'indexes count the RAW array');

  await writeFile(path.join(dir, SCREENS_FILENAME), '{oops', 'utf8');
  const broken = await readScreensStrict(dir);
  assert.equal(broken.ok, false);
  if (broken.ok) return;
  assert.match(broken.error, /^screens\.json: /, 'E11 message format');

  const gone = await readScreensStrict(path.join(dir, 'nothing-here'));
  assert.equal(gone.ok, true, 'missing dir is not a parse error');

  const silent = await (await import('../service/screens.ts')).readScreens(dir);
  assert.deepEqual(silent.screens, [], 'readScreens keeps its SILENT contract');
});

test('renameScreen rewrites one title atomically and refuses junk (V4-17)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-rename-'));
  await writeFile(
    path.join(dir, SCREENS_FILENAME),
    JSON.stringify({ version: 1, screens: [
      { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
      { id: 'phone', file: 'phone.html', title: 'Phone', width: 390, height: 844 },
    ] }),
    'utf8',
  );
  const next = await renameScreen(dir, 'phone', 'Phone portrait');
  assert.equal(next.screens.find((s) => s.id === 'phone')?.title, 'Phone portrait');
  assert.equal(next.screens.find((s) => s.id === 'home')?.title, 'Home', 'siblings survive the RMW');
  const onDisk = JSON.parse(await readFile(path.join(dir, SCREENS_FILENAME), 'utf8')) as { screens: Array<{ id: string; title: string }> };
  assert.equal(onDisk.screens.find((s) => s.id === 'phone')?.title, 'Phone portrait');
  await assert.rejects(() => renameScreen(dir, 'ghost', 'x'), ScreenRenameError);
  await assert.rejects(() => renameScreen(dir, 'home', ''), /1–120/);
  await assert.rejects(() => renameScreen(dir, 'home', 'x'.repeat(121)), /1–120/);
  await assert.rejects(() => renameScreen(dir, 'BAD ID', 'x'), /id must match/);
});

// ---- V4-4: the watcher itself --------------------------------------------------

test('watchRegistry delivers add, corrupt, and recover ticks; stop() goes silent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-watch-'));
  const registry1 = { version: 1, screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 }] };
  await writeFile(path.join(dir, SCREENS_FILENAME), JSON.stringify(registry1), 'utf8');
  const changes: RegistryChange[] = [];
  const stop = watchRegistry(dir, (change) => changes.push(change));
  await pause(400); // let the mtime baseline seed
  const registry2 = { version: 1, screens: [...registry1.screens, { id: 'b', file: 'b.html', title: 'B', width: 390, height: 844 }] };
  await writeFile(path.join(dir, SCREENS_FILENAME), JSON.stringify(registry2), 'utf8');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !changes.some((c) => c.ok && c.registry.screens.length === 2)) await pause(50);
  assert.ok(changes.some((c) => c.ok && c.registry.screens.length === 2), 'the new screen arrives within 5 s (fs.watch fast path or poll backstop)');

  await writeFile(path.join(dir, SCREENS_FILENAME), 'not json at all', 'utf8');
  const deadline2 = Date.now() + 5000;
  while (Date.now() < deadline2 && !changes.some((c) => !c.ok)) await pause(50);
  assert.ok(changes.some((c) => !c.ok && /^screens\.json: /.test(c.error)), 'a corrupt file is LOUD (E11)');

  await writeFile(path.join(dir, SCREENS_FILENAME), JSON.stringify(registry1), 'utf8');
  const deadline3 = Date.now() + 5000;
  let recovered = false;
  while (Date.now() < deadline3 && !recovered) {
    const last = changes.at(-1);
    recovered = last?.ok === true && last.registry.screens.length === 1;
    if (!recovered) await pause(50);
  }
  assert.ok(recovered, 'the fixed file settles ok');

  changes.length = 0;
  stop();
  stop(); // idempotent
  await writeFile(path.join(dir, SCREENS_FILENAME), JSON.stringify(registry2), 'utf8');
  await pause(900);
  assert.equal(changes.length, 0, 'stopped watchers emit nothing');
});

test('watchRegistry debounces a burst into a settled final read', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-watch-deb-'));
  await writeFile(path.join(dir, SCREENS_FILENAME), JSON.stringify({ version: 1, screens: [] }), 'utf8');
  const changes: RegistryChange[] = [];
  const stop = watchRegistry(dir, (change) => changes.push(change));
  try {
    for (let i = 1; i <= 3; i += 1) {
      await writeFile(path.join(dir, SCREENS_FILENAME), JSON.stringify({ version: 1, screens: Array.from({ length: i }, (_x, n) => ({ id: `s${n}`, file: `s${n}.html`, title: 'S', width: 300, height: 300 })) }), 'utf8');
      await pause(60); // inside the 250 ms debounce window
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !changes.some((c) => c.ok && c.registry.screens.length === 3)) await pause(50);
    const lastOk = changes.filter((c) => c.ok).at(-1);
    assert.ok(lastOk, 'the burst settles to a read');
    assert.equal(lastOk!.registry.screens.length, 3, 'the LAST state is what lands');
  } finally {
    stop();
  }
});

// ---- V4-13: dock placement math --------------------------------------------------

test('dockPlacement docks right only when ≥640px remain, width mirrored & capped', () => {
  assert.deepEqual(dockPlacement({ x: 0, y: 0, width: 1000, height: 900 }, 1920), { x: 1000, y: 0, width: 920, height: 900 });
  assert.equal(dockPlacement({ x: 0, y: 0, width: 1400, height: 900 }, 1920), null, '520 px remain < 640 — leave placement alone');
  assert.deepEqual(dockPlacement({ x: 100, y: 50, width: 1200, height: 800 }, 2560), { x: 1300, y: 50, width: 1200, height: 800 });
  assert.deepEqual(dockPlacement({ x: 0, y: 0, width: 2000, height: 800 }, 3840), { x: 2000, y: 0, width: 1440, height: 800 }, 'capped at DOCK_MAX_WIDTH');
  assert.deepEqual(dockPlacement({ x: 0, y: 0, width: 300, height: 800 }, 3840), { x: 300, y: 0, width: MIN_DOCK_WIDTH, height: 800 }, 'floored at 640');
  assert.equal(dockPlacement({ x: 0, y: 0, width: Number.NaN, height: 800 }, 1920), null);
  assert.equal(dockPlacement({ x: 0, y: 0, width: 1000, height: 800 }, 0), null);
});

test('resolveChromePath is exported and honors DS_CHROME_PATH verbatim (V4-16)', () => {
  const prior = process.env.DS_CHROME_PATH;
  process.env.DS_CHROME_PATH = 'Z:\\somewhere\\chrome-test.exe';
  try {
    assert.equal(resolveChromePath(), 'Z:\\somewhere\\chrome-test.exe');
  } finally {
    if (prior === undefined) delete process.env.DS_CHROME_PATH;
    else process.env.DS_CHROME_PATH = prior;
  }
});

// ---- browser.ts routing WITHOUT a window (V4 decisions at the seams) --------------

/** Build a Browser with its window-facing privates stubbed for routing pins. */
function stubbedBrowser(): {
  browser: Browser;
  internal: any;
  shellCalls: string[];
  evalCalls: Array<{ expr: string; screen?: string }>;
  toasts: Array<{ kind: string; text: string; expr: string }>;
} {
  const browser = new Browser();
  const internal = browser as unknown as Record<string, unknown> & { workspaceDir?: string };
  const shellCalls: string[] = [];
  const evalCalls: Array<{ expr: string; screen?: string }> = [];
  const toasts: Array<{ kind: string; text: string; expr: string }> = [];
  internal.cdp = { send: async () => ({}), on: () => () => undefined };
  internal.sessionId = 'fake-shell-session';
  internal.targetId = 'fake-target';
  internal.contexts = { shellAuthorityCurrent: () => true, shell: () => null, artifact: () => null, activeScreenId: null };
  internal.shellEvalSettled = async (expr: string) => { shellCalls.push(expr); return true; };
  internal.shellEval = async (expr: string) => { shellCalls.push(expr); return true; };
  internal.evalIn = async (expr: string, _await: boolean, screen?: string) => { evalCalls.push({ expr, screen }); return true; };
  internal.pushShellScreens = async () => { shellCalls.push('SETSCREENS'); };
  internal.pushShellActive = async () => { shellCalls.push('SETACTIVE'); };
  internal.waitScreen = async () => true;
  internal.refreshUnsettled = async () => {};
  internal.setMode = async () => {};
  internal.refreshScreen = async () => {};
  internal.pushToast = async (kind: string, text: string, copy = false) => {
    toasts.push({ kind, text, expr: `toast:${kind}:${text}:${copy}` });
    return true;
  };
  return { browser, internal, shellCalls, evalCalls, toasts };
}

function openFakeWorkspace(internal: Record<string, unknown>, dir?: string): void {
  internal.workspaceMode = true;
  internal.workspaceDir = dir ?? null;
  (internal as { applyScreenRegistry: (inputs: unknown[]) => void }).applyScreenRegistry([
    { id: 'home', url: 'http://localhost:9/home.html', file: 'home.html', title: 'Home', width: 1280, height: 800 },
    { id: 'phone', url: 'http://localhost:9/phone.html', file: 'phone.html', title: 'Phone', width: 390, height: 844 },
  ]);
}

test('V4-1: workspace canvasCommand IGNORES layout/fit-size/viewport (no reply, no error)', async () => {
  const { browser, internal } = stubbedBrowser();
  openFakeWorkspace(internal);
  let resizeRan = 0;
  let reconcileRan = 0;
  internal.resizeArtifact = async () => { resizeRan += 1; return browser.viewport(); };
  internal.reconcileLayout = async () => { reconcileRan += 1; };
  const canvasCommand = (browser as unknown as { canvasCommand: (c: unknown, a: unknown) => Promise<void> }).canvasCommand.bind(browser);
  const authority = {};
  await canvasCommand({ type: 'viewport', width: 640, height: 480 }, authority);
  await canvasCommand({ type: 'layout', mode: 'page', preset: 'desktop' }, authority);
  await canvasCommand({ type: 'fit-size' }, authority);
  assert.equal(resizeRan, 0, 'no resize machinery touched');
  assert.equal(reconcileRan, 0, 'no qualification touched');
});

test('V4-1: the legacy single-frame path STILL honours viewport (gate holds both ways)', async () => {
  const { browser, internal } = stubbedBrowser();
  // NOT a workspace: workspaceMode stays false (legacy launch).
  let resizeRan = 0;
  internal.resizeArtifact = async () => { resizeRan += 1; return browser.viewport(); };
  const canvasCommand = (browser as unknown as { canvasCommand: (c: unknown, a: unknown) => Promise<void> }).canvasCommand.bind(browser);
  await canvasCommand({ type: 'viewport', width: 640, height: 480 }, {});
  assert.equal(resizeRan, 1, 'legacy viewport still resizes (v1 intact)');
});

test('V4-1: openWorkspace pins layoutState viewport/custom at the active registry height with no reason', async () => {
  const { browser, internal } = stubbedBrowser();
  const raised: string[] = [];
  internal.bringToFront = async () => { raised.push('raise'); };
  await browser.openWorkspace({ screens: [{ id: 'phone', url: 'http://localhost:9/phone.html', width: 390, height: 844, title: 'Phone' }], baseUrl: 'http://localhost:9/', mode: 'edit', focus: false });
  const layoutState = internal.layoutState as { mode: string; preset: string; nominalHeight: number; reason?: string };
  assert.equal(layoutState.mode, 'viewport');
  assert.equal(layoutState.preset, 'custom');
  assert.equal(layoutState.nominalHeight, 844, 'pinned to the ACTIVE registry height');
  assert.equal('reason' in layoutState && layoutState.reason !== undefined, false, 'reasonless — queueLayout stays disarmed');
  assert.equal(internal.requestedLayout, null);
  assert.equal(raised.length, 0, 'V4-8: focus:false never raises the window');
  await browser.openWorkspace({ screens: [{ id: 'phone', url: 'http://localhost:9/phone.html', width: 390, height: 844, title: 'Phone' }], baseUrl: 'http://localhost:9/', mode: 'edit', focus: true });
  assert.equal(raised.length, 1, 'V4-8: the user-initiated warm open still raises');
});

test('V4-8: agent navigation never raises the window (bringToFront spy, stubbed cdp)', async () => {
  const { browser, internal } = stubbedBrowser();
  openFakeWorkspace(internal);
  const raised: string[] = [];
  internal.bringToFront = async () => { raised.push('raise'); };
  internal.contexts = {
    shellAuthorityCurrent: () => true,
    shell: () => null,
    artifact: () => ({ session: 's', frame: 'f', id: 1, unique: 'u', origin: '' }),
    artifactSameDocumentVersion: () => 0,
    discover: async () => undefined,
    initializeArtifact: async () => undefined,
  };
  const nav = await browser.navigate('home', 'http://localhost:9/other.html');
  assert.equal(nav.settled, true);
  assert.equal(raised.length, 0, 'navigate settled WITHOUT bringToFront (E16 root removed)');
});

test('V4-1/V4-7: restoreCamera in a workspace is camera-only and re-asserts registry sizes', async () => {
  const { browser, internal, shellCalls } = stubbedBrowser();
  openFakeWorkspace(internal); // active = home 1280×800
  await browser.restoreCamera({ layoutMode: 'page', preset: 'desktop', width: 1280, height: 2520, nominalHeight: 2520, reason: 'stale', mode: 'manual', scale: 0.42, panX: -7, panY: -9 });
  const push = shellCalls.find((expr) => expr.startsWith('__dsCanvas.restoreCamera('));
  assert.ok(push, 'the camera reached the shell');
  assert.deepEqual(JSON.parse(push!.replace('__dsCanvas.restoreCamera(', '').replace(/\)$/, '')), { mode: 'manual', scale: 0.42, panX: -7, panY: -9 }, 'only the four persisted keys');
  assert.equal(shellCalls.filter((c) => c.includes('setLayout')).length, 0, 'applyLayout NEVER ran');
  assert.ok(shellCalls.includes('SETSCREENS'), 'registry sizes re-pushed after the override');
  assert.equal(browser.viewport().height, 800, 'the ACTIVE home registry height survived the 2520 layout snapshot');
});

test('V4-7: workspace input routes wheels in-frame and brackets pointer batches with agentInput', async () => {
  const { browser, internal, evalCalls, shellCalls } = stubbedBrowser();
  openFakeWorkspace(internal);
  let dispatches: Array<{ screen: string; count: number }> = [];
  internal.dispatchCanvasInput = async (screen: string, events: unknown[]) => { dispatches.push({ screen, count: events.length }); };
  await browser.input('phone', [
    { type: 'wheel', x: 100, y: 100, deltaX: 0, deltaY: 400, modifiers: { alt: false, ctrl: false, meta: false, shift: false } },
    { type: 'pointer', action: 'down', x: 10, y: 10, button: 0, buttons: 1, modifiers: { alt: false, ctrl: false, meta: false, shift: false } },
    { type: 'key', action: 'down', key: 'a', code: 'KeyA', modifiers: { alt: false, ctrl: false, meta: false, shift: false } },
  ] as never);
  const wheelScroll = evalCalls.find((c) => c.expr.includes('scrollBy'));
  assert.ok(wheelScroll, 'the wheel became an in-frame scrollBy');
  assert.equal(wheelScroll.screen, 'phone', 'INSIDE the target frame, never the camera');
  assert.match(wheelScroll.expr, /scrollBy\(0,400\)/);
  const reveal = shellCalls.find((c) => c.includes('revealScreen') && c.includes('phone'));
  const agentOn = shellCalls.findIndex((c) => c.includes('setAgentInput(true)'));
  const agentOff = shellCalls.findIndex((c) => c.includes('setAgentInput(false)'));
  assert.ok(reveal, 'revealScreen ran first');
  assert.ok(agentOn >= 0 && agentOff >= 0 && agentOff > agentOn, 'setAgentInput on…off brackets the dispatch');
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0]!.count, 2, 'only the non-wheel events were dispatched');
  assert.equal(shellCalls.filter((c) => c.includes('mouseWheel')).length, 0);
});

test('V4-6: hover inbound is latest-wins coalesced and capture-dropped', async () => {
  const { browser, internal, evalCalls } = stubbedBrowser();
  openFakeWorkspace(internal);
  const canvasCommand = (browser as unknown as { canvasCommand: (c: unknown, a: unknown) => Promise<void> }).canvasCommand.bind(browser);
  let release: () => void = () => undefined;
  internal.evalIn = async (expr: string, _a: boolean, screen?: string) => {
    evalCalls.push({ expr, screen });
    if (expr.includes('__dsHoverAt')) await new Promise<void>((resolve) => { release = resolve; });
    return true;
  };
  void canvasCommand({ type: 'screen-hover', screen: 'home', x: 10, y: 10 }, {});
  void canvasCommand({ type: 'screen-hover', screen: 'home', x: 20, y: 20 }, {});
  void canvasCommand({ type: 'screen-hover', screen: 'home', x: 30, y: 30 }, {});
  await pause(20);
  release();
  await pause(60);
  const hoverAts = evalCalls.filter((c) => c.expr.includes('__dsHoverAt'));
  assert.equal(hoverAts.length, 2, 'one in flight + the single newest replacement — never three');
  assert.match(hoverAts[1]!.expr, /__dsHoverAt\(30,30\)/, 'latest coordinates win');
  assert.equal(hoverAts[0]!.screen, 'home');

  // captureInFlight drops everything.
  evalCalls.length = 0;
  internal.captureInFlight = true;
  void canvasCommand({ type: 'screen-hover', screen: 'home', x: 40, y: 40 }, {});
  void canvasCommand({ type: 'screen-hover-end' }, {});
  await pause(40);
  assert.equal(evalCalls.filter((c) => c.expr.includes('__dsHover')).length, 0, 'no hover evaluate during a capture');
  internal.captureInFlight = false;
});

test('V4-10: menu send-to-chat rides the queue as kind:screen; copy-path toasts the file', async () => {
  const { browser, internal, toasts } = stubbedBrowser();
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-menu-'));
  openFakeWorkspace(internal, dir);
  const canvasCommand = (browser as unknown as { canvasCommand: (c: unknown, a: unknown) => Promise<void> }).canvasCommand.bind(browser);
  await canvasCommand({ type: 'screen-menu', screen: 'phone', action: 'send-to-chat' }, {});
  const page = await browser.getPicks(0, 0);
  assert.equal(page.picks.length, 1);
  const pick = page.picks[0]!;
  assert.equal(pick.kind, 'screen');
  assert.equal(pick.screen, 'phone');
  assert.equal(pick.screenUrl, 'http://localhost:9/phone.html');
  assert.equal(pick.width, 390);
  assert.equal(pick.height, 844);
  assert.equal(pick.file, 'phone.html');
  assert.equal(pick.selector, undefined, 'screen picks carry NO element payload');

  await canvasCommand({ type: 'screen-menu', screen: 'phone', action: 'copy-path' }, {});
  const expect = path.join(dir, 'phone.html');
  assert.ok(toasts.some((t) => t.kind === 'ok' && t.text === expect && t.expr.endsWith(':true')), 'abs path toast with copy:true');

  await canvasCommand({ type: 'screen-menu', screen: 'phone', action: 'no-such-action' }, {});
  await canvasCommand({ type: 'screen-menu', screen: 'ghost', action: 'copy-path' }, {});
  assert.equal((await browser.getPicks(0, 0)).picks.length, 1, 'unknown actions/screens change nothing');

  let exportAsked: string | null = null;
  browser.setMenuExportHandler((screen, format) => { exportAsked = `${screen}:${format}`; });
  await canvasCommand({ type: 'screen-menu', screen: 'home', action: 'export-pdf' }, {});
  assert.equal(exportAsked, 'home:pdf');
});

test('V4-10: reset-position merges view.json to null and pushes the auto pair', async () => {
  const { browser, internal, shellCalls } = stubbedBrowser();
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-reset-'));
  openFakeWorkspace(internal, dir);
  await mergeView(dir, { positions: { home: { x: 500, y: 500 } } });
  const canvasCommand = (browser as unknown as { canvasCommand: (c: unknown, a: unknown) => Promise<void> }).canvasCommand.bind(browser);
  await canvasCommand({ type: 'screen-menu', screen: 'home', action: 'reset-position' }, {});
  const view = await readView(dir);
  assert.equal(view.positions.home, null, 'stored as null (auto), key kept');
  const push = shellCalls.find((expr) => expr.includes('__dsCanvas.setScreens('));
  assert.ok(push);
  const list = JSON.parse(push!.slice('__dsCanvas.setScreens('.length, -1)) as Array<{ id: string; x?: number | null }>;
  assert.deepEqual(list.find((s) => s.id === 'home'), { ...list.find((s) => s.id === 'home'), x: null }, 'the push carries the null pair');
});

test('V4-5: an honoured in-frame pick lands in the queue; ack toasts through showToast', async () => {
  const { browser, internal, toasts } = stubbedBrowser();
  openFakeWorkspace(internal);
  // Route a binding payload exactly as the bindingCalled authority does.
  const internal2 = browser as unknown as { enqueueElementPick: (screen: string, picked: PickedElement & { additive?: boolean }) => void };
  internal2.enqueueElementPick('home', { ...fakePicked(), additive: true });
  const page = await browser.getPicks(0, 0);
  assert.equal(page.picks.length, 1);
  assert.equal(page.picks[0]!.kind, 'element');
  assert.equal(page.picks[0]!.additive, true);
  assert.equal(page.picks[0]!.selector, '#b');
  assert.equal(page.picks[0]!.screenUrl, 'http://localhost:9/home.html');
  // ack → the §3 showToast expression reaches the shell.
  browser.ackPicks(page.seq, 'Button #b');
  await pause(30);
  assert.ok(toasts.some((t) => t.kind === 'ok' && t.text === 'Added to chat · Button #b'));
});

test('V4-5: screen-pick inbound relays additive into the frame __dsPickAt', async () => {
  const { browser, internal, evalCalls } = stubbedBrowser();
  openFakeWorkspace(internal);
  const canvasCommand = (browser as unknown as { canvasCommand: (c: unknown, a: unknown) => Promise<void> }).canvasCommand.bind(browser);
  await canvasCommand({ type: 'screen-pick', screen: 'home', x: 80, y: 60, additive: true }, {});
  await pause(20);
  assert.ok(evalCalls.some((c) => c.expr === 'window.__dsPickAt(80,60,true)' && c.screen === 'home'));
  await canvasCommand({ type: 'screen-pick', screen: 'home', x: 81, y: 61 }, {});
  await pause(20);
  assert.ok(evalCalls.some((c) => c.expr === 'window.__dsPickAt(81,61,false)'));
});

test('V4-17: screen-rename inbound rewrites screens.json', async () => {
  const { browser, internal } = stubbedBrowser();
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-ren-in-'));
  await writeFile(path.join(dir, SCREENS_FILENAME), JSON.stringify({ version: 1, screens: [
    { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
    { id: 'phone', file: 'phone.html', title: 'Phone', width: 390, height: 844 },
  ] }), 'utf8');
  openFakeWorkspace(internal, dir);
  const canvasCommand = (browser as unknown as { canvasCommand: (c: unknown, a: unknown) => Promise<void> }).canvasCommand.bind(browser);
  await canvasCommand({ type: 'screen-rename', screen: 'home', title: 'Homepage v2' }, {});
  const deadline = Date.now() + 1500;
  let title = '';
  while (Date.now() < deadline) {
    const raw = JSON.parse(await readFile(path.join(dir, SCREENS_FILENAME), 'utf8')) as { screens: Array<{ id: string; title: string }> };
    title = raw.screens.find((s) => s.id === 'home')?.title ?? '';
    if (title === 'Homepage v2') break;
    await pause(40);
  }
  assert.equal(title, 'Homepage v2', 'the inbound rename rewrote screens.json');
  await canvasCommand({ type: 'screen-rename', screen: 'home', title: '' }, {});
  await canvasCommand({ type: 'screen-rename', screen: 'home', title: 'x'.repeat(121) }, {});
  await pause(120);
  const after = JSON.parse(await readFile(path.join(dir, SCREENS_FILENAME), 'utf8')) as { screens: Array<{ id: string; title: string }> };
  assert.equal(after.screens.find((s) => s.id === 'home')?.title, 'Homepage v2', 'empty / over-long titles never reach the registry');
});

test('V4-4/V4-15: getState surfaces registryError and shellBridge; notice/toast/status pushes are guarded', async () => {
  const browser = new Browser();
  const state = browser.getState();
  assert.equal(state.registryError, null);
  assert.deepEqual(state.shellBridge, { authority: false, lastCommandAt: null });
  browser.setRegistryError('screens.json: BadJSON');
  assert.equal(browser.getState().registryError, 'screens.json: BadJSON');
  assert.equal(await browser.setNotice({ id: 'registry', kind: 'error', text: 'screens.json: BadJSON' }), false, 'no window: guarded false, no throw');
  assert.equal(await browser.pushToast('ok', 'Exported x.png', true), false);
  assert.equal(await browser.setAgentStatus({ busy: true, label: 'Designing' }), false);
  const withWindow = stubbedBrowser();
  assert.equal(await withWindow.browser.setAgentStatus({ busy: false }), true, 'guarded expression still reaches the shell');
  assert.ok(withWindow.shellCalls.some((c) => c.includes('setAgentStatus') && c.includes('typeof')));
  const longText = 'x'.repeat(500);
  await withWindow.browser.setNotice({ id: 'registry', kind: 'warn', text: longText });
  const noticeCall = withWindow.shellCalls.find((c) => c.includes('setNotice'));
  assert.ok(noticeCall && noticeCall.includes('x'.repeat(300)) && !noticeCall.includes('x'.repeat(301)), 'notice text clamps at 300');
});

// ---- V4 route contract (spawned service, NO Chrome) ----------------------------

test('v4 routes: malformed → 400, workspace-marker guards → 400, business failures → 200', async () => {
  const port = await pickFreePort(44000, 1500);
  const plain = await mkdtemp(path.join(tmpdir(), 'v4-plain-'));
  const workspace = await mkdtemp(path.join(tmpdir(), 'v4-ws-'));
  await writeFile(path.join(workspace, '.design-studio.json'), JSON.stringify({ version: 1, name: 'ws', type: 'hi-fi', url: 'http://localhost:5999/', command: 'npm run dev', entry: 'index.html' }), 'utf8');
  const wsRoot = await mkdtemp(path.join(tmpdir(), 'v4-wsroot-'));
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.ts')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', DS_WORKSPACE_ROOT: wsRoot, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  const api = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init?.body ? { 'content-type': 'application/json' } : {}) },
  });
  try {
    await waitForHealth(port, child);

    // GET /picks: malformed since → 400; valid → empty page (no window).
    assert.equal((await api('/picks?since=-1&wait=0')).status, 400);
    assert.equal((await api('/picks?since=abc')).status, 400);
    assert.equal((await api('/picks?since=0&wait=-5')).status, 400);
    const empty = await (await api('/picks?since=0&wait=200')).json() as { seq: number; picks: unknown[] };
    assert.deepEqual(empty, { seq: 0, picks: [] });

    // POST /picks/ack: {seq:int,label:1..80}.
    assert.equal((await api('/picks/ack', { method: 'POST', body: JSON.stringify({ seq: 1 }) })).status, 400);
    assert.equal((await api('/picks/ack', { method: 'POST', body: JSON.stringify({ seq: 'x', label: 'a' }) })).status, 400);
    assert.equal((await api('/picks/ack', { method: 'POST', body: JSON.stringify({ seq: 1, label: 'x'.repeat(81) }) })).status, 400);
    const ack = await api('/picks/ack', { method: 'POST', body: JSON.stringify({ seq: 3, label: 'Home (1280×800)' }) });
    assert.equal(ack.status, 200);
    assert.deepEqual(await ack.json(), { ok: true });

    // POST /agent-status: {busy:boolean,label?≤60}.
    assert.equal((await api('/agent-status', { method: 'POST', body: JSON.stringify({ busy: 'yes' }) })).status, 400);
    assert.equal((await api('/agent-status', { method: 'POST', body: JSON.stringify({ busy: true, label: 'x'.repeat(61) }) })).status, 400);
    const statusRes = await api('/agent-status', { method: 'POST', body: JSON.stringify({ busy: true, label: 'Designing the checkout' }) });
    assert.equal(statusRes.status, 200);
    assert.deepEqual(await statusRes.json(), { ok: true });

    // V4-14 guards — plain dir refuses at 400, marker dir passes the guard.
    assert.equal((await api(`/view?dir=${encodeURIComponent(plain)}`, { method: 'PATCH', body: JSON.stringify({ mode: 'play' }) })).status, 400);
    const guardedView = await api(`/view?dir=${encodeURIComponent(plain)}`, { method: 'PATCH', body: JSON.stringify({ mode: 'play' }) });
    assert.deepEqual(await guardedView.json(), { error: 'not a design workspace' });
    const viewOk = await api(`/view?dir=${encodeURIComponent(workspace)}`, { method: 'PATCH', body: JSON.stringify({ mode: 'play' }) });
    assert.equal(viewOk.status, 200);
    assert.deepEqual((await api('/screens?dir=' + encodeURIComponent(plain), { method: 'PUT', body: JSON.stringify({ version: 1, screens: [] }) })).status, 400);
    const screensOk = await api('/screens?dir=' + encodeURIComponent(workspace), { method: 'PUT', body: JSON.stringify({ version: 1, screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 }] }) });
    assert.equal(screensOk.status, 200);
    const syncPlain = await api('/screens/sync', { method: 'POST', body: JSON.stringify({ dir: plain }) });
    assert.equal(syncPlain.status, 400);
    // sync on a real workspace with NO window: business ok, nothing pushed.
    const syncWs = await api('/screens/sync', { method: 'POST', body: JSON.stringify({ dir: workspace }) });
    assert.equal(syncWs.status, 200);
    assert.deepEqual(await syncWs.json(), { ok: true, pushed: false });
    // export + critique guards.
    const exportPlain = await api('/export', { method: 'POST', body: JSON.stringify({ dir: plain }) });
    assert.equal(exportPlain.status, 400);
    const critiquePlain = await api('/critique', { method: 'POST', body: JSON.stringify({ dir: plain }) });
    assert.equal(critiquePlain.status, 400);

    // V4-11: /scaffold/status malformed + unknown job; async lifecycle.
    assert.equal((await api('/scaffold/status?job=x')).status, 400);
    assert.deepEqual(await (await api(`/scaffold/status?dir=${encodeURIComponent(plain)}&job=nope`)).json(), { ok: false, error: 'unknown scaffold job' });
    assert.equal((await api('/scaffold', { method: 'POST', body: JSON.stringify({ dir: workspace, type: 'hi-fi', async: 'yes' }) })).status, 400);
    assert.equal((await api('/scaffold', { method: 'POST', body: JSON.stringify({ dir: workspace, type: 'hi-fi', async: true, install: 'yes' }) })).status, 400);
    // A new dir OUTSIDE the workspace root fails at the file stage: that is a
    // business failure like the sync path answers — immediate {ok:false}.
    const outside = await (await api('/scaffold', { method: 'POST', body: JSON.stringify({ dir: path.join(path.dirname(wsRoot), 'v4-outside-scaffold'), type: 'hi-fi', async: true }) })).json() as { ok: boolean; error?: string };
    assert.equal(outside.ok, false);
    assert.match(outside.error ?? '', /workspace root/);
    // A fresh dir INSIDE the root, install/boot off: the response arrives
    // immediately with the real url (the 20 s cap is off the path), and the
    // job settles 'done' in the background.
    const inside = path.join(wsRoot, 'v4-async-ws');
    const asyncRes = await (await api('/scaffold', { method: 'POST', body: JSON.stringify({ dir: inside, type: 'hi-fi', async: true, install: false, boot: false }) })).json() as { ok: boolean; jobId?: string; dir?: string; url?: string; error?: string };
    assert.equal(asyncRes.ok, true, 'async scaffold answers right away');
    assert.ok(asyncRes.jobId);
    assert.match(String(asyncRes.url), /^http:\/\/127\.0\.0\.1:\d+\/$/, 'the pinned url is in the immediate response (D split landed)');
    let state = '';
    let seenStates = '';
    for (let i = 0; i < 60; i += 1) {
      const s = await (await api(`/scaffold/status?dir=${encodeURIComponent(inside)}&job=${asyncRes.jobId}`)).json() as { state?: string; elapsedMs?: number; ok?: boolean };
      seenStates += String(s.state ?? '');
      state = String(s.state ?? s.ok);
      if (s.state === 'failed' || s.state === 'done') break;
      await pause(80);
    }
    assert.equal(state, 'done', `the job settles (saw: ${seenStates})`);
    // F10 (V4 QA): the status poll must name the job's OWN dir — the same job
    // id with a foreign dir answers like an unknown job.
    const wrongDir = await (await api(`/scaffold/status?dir=${encodeURIComponent(plain)}&job=${asyncRes.jobId}`)).json() as { ok?: boolean; error?: string; state?: string };
    assert.deepEqual(wrongDir, { ok: false, error: 'unknown scaffold job' }, 'F10: a foreign dir cannot read the job');
    const rightDir = await (await api(`/scaffold/status?dir=${encodeURIComponent(inside)}&job=${asyncRes.jobId}`)).json() as { state?: string };
    assert.equal(rightDir.state, 'done', 'F10: the job\'s own dir still reads it');
    const homeRegistry = JSON.parse(await readFile(path.join(inside, 'screens.json'), 'utf8')) as { screens: unknown[] };
    assert.equal(homeRegistry.screens.length, 1, 'exactly one workspace, files already written behind the response');

    // V4-15: /open on a folder that no longer exists.
    const missing = await (await api('/open', { method: 'POST', body: JSON.stringify({ dir: path.join(plain, 'gone') }) })).json() as { ok: boolean; code?: string; error?: string };
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'WORKSPACE_MISSING');
    assert.match(missing.error ?? '', /no longer exists/);

    // /state keeps its exact legacy shape with no browser (byte-compat pin).
    const stateRes = await (await api('/state')).json() as Record<string, unknown>;
    assert.deepEqual(stateRes, { url: '', title: '', lastPick: null, pickSeq: 0, windowOpen: false, bridgeActive: false });
  } finally {
    child.kill('SIGKILL');
  }
});

// ---- D3 pin (V4-2): the PDF target carries NO pick/probe world -------------------

test('printScreenToPdf runs the D3 sequence WITHOUT injecting the pick/probe scripts (V4-2 PDF pin)', async () => {
  const browser = new Browser();
  const calls: Array<{ method: string; session?: string; params: Record<string, unknown> }> = [];
  const loadHandlers: Array<(params: Record<string, unknown>, session?: string) => void> = [];
  (browser as unknown as { cdp: unknown }).cdp = {
    send: async (method: string, params: Record<string, unknown> = {}, session?: string) => {
      calls.push({ method, params, session });
      if (method === 'Target.createTarget') return { targetId: 'x-target' };
      if (method === 'Target.attachToTarget') return { sessionId: 'x-session' };
      if (method === 'Browser.getWindowForTarget') return { windowId: 9, bounds: {} };
      if (method === 'Page.navigate') {
        for (const handler of loadHandlers) handler({}, 'x-session');
        return { loaderId: 'L1' };
      }
      if (method === 'Page.printToPDF') return { data: Buffer.from('%PDF-1.4 stub').toString('base64') };
      return {};
    },
    on: (method: string, handler: (params: Record<string, unknown>, session?: string) => void) => {
      if (method === 'Page.loadEventFired') loadHandlers.push(handler);
      return () => undefined;
    },
  };
  (browser as unknown as { targetId: string }).targetId = 'app-target';
  (browser as unknown as { sessionId: string }).sessionId = 'app-session';
  const pdf = await browser.printScreenToPdf('http://localhost:9/phone.html', 390, 844);
  assert.equal(pdf.toString('utf8').slice(0, 8), '%PDF-1.4');
  const methods = calls.map((c) => c.method);
  const indexOf = (m: string) => methods.indexOf(m);
  assert.ok(indexOf('Target.createTarget') < indexOf('Target.attachToTarget'), 'D3 2→3');
  assert.ok(indexOf('Target.attachToTarget') < indexOf('Browser.setWindowBounds'), 'park (4) before content');
  const park = calls.find((c) => c.method === 'Browser.setWindowBounds');
  assert.equal((park!.params.bounds as { left: number }).left, -32000, 'parked off-screen');
  assert.equal(calls.find((c) => c.method === 'Page.enable')?.session, 'x-session');
  assert.equal(calls.find((c) => c.method === 'Page.navigate')?.session, 'x-session');
  const print = calls.find((c) => c.method === 'Page.printToPDF')!;
  assert.equal(print.session, 'x-session');
  assert.equal((print.params as { paperWidth: number }).paperWidth, 390 / 96, 'natural px / 96 dpi');
  assert.equal((print.params as { paperHeight: number }).paperHeight, 844 / 96);
  assert.ok(indexOf('Target.closeTarget') > indexOf('Page.printToPDF'), 'finally closes the target');
  assert.equal(calls.filter((c) => c.method === 'Runtime.addBinding').length, 0, 'NO binding world on the throwaway session');
  assert.equal(calls.filter((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument').length, 0, 'NO PICK_SCRIPT world (exports stay clean)');
  assert.equal(calls.filter((c) => c.method === 'Target.setAutoAttach').length, 0);
});

// ---- PICK_SCRIPT text pins (V4-2/V4-6/V4-5 in-frame contract) ---------------------

test('PICK_SCRIPT carries the §3 in-frame surface: __dsOverlays / __dsHoverAt / __dsHoverEnd / additive / 1500ms fade', async () => {
  const { PICK_SCRIPT } = await import('../service/browser.ts');
  const script: string = PICK_SCRIPT;
  assert.match(script, /window\.__dsOverlays\s*=\s*function/);
  assert.match(script, /window\.__dsHoverAt\s*=\s*function/);
  assert.match(script, /window\.__dsHoverEnd\s*=\s*function/);
  assert.match(script, /__ds-hover-outline/);
  assert.match(script, /data-ds-overlay', 'hover'/, 'the hover box is overlay-tagged (probe-excluded + export-hidden)');
  assert.match(script, /1500/, 'picked outline auto-fades after 1500 ms');
  assert.match(script, /additive: !!e\.shiftKey/, 'picks record the shift flag');
  assert.match(script, /shiftKey:!!additive/, '__dsPickAt relays the additive flag');
  assert.match(script, /#3b82f6/, 'hover outline is blue');
  // The pick overlay stays green #22c55e (the exact colour V4-2 forbids in exports).
  assert.match(script, /22c55e/);
});

// ---- V4-15: per-screen Retry resilience ------------------------------------------

test('V4-15: per-screen Retry ensures a loopback dev server FIRST and shows the card text', async () => {
  const { browser, internal, shellCalls } = stubbedBrowser();
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-retry-'));
  openFakeWorkspace(internal, dir);
  let ensured = 0;
  browser.setDevServerEnsure(async () => { ensured += 1; return { up: true }; });
  let navigated: string | null = null;
  (browser as unknown as { navigateGuarded: (s: string | undefined, u: string, a?: unknown) => Promise<unknown> }).navigateGuarded = async (s, u) => { navigated = `${s}:${u}`; return { url: u, title: '', settled: true }; };
  const canvasCommand = (browser as unknown as { canvasCommand: (c: unknown, a: unknown) => Promise<void> }).canvasCommand.bind(browser);
  await canvasCommand({ type: 'retry', screen: 'phone' }, {});
  assert.equal(ensured, 1, 'the dev-server ensure hook ran before the re-navigation');
  assert.equal(navigated, 'phone:http://localhost:9/phone.html');
  assert.ok(shellCalls.some((expr) => expr.includes('setScreenState("phone",') && expr.includes('Starting the dev server')), 'the card said what is happening');

  // No hook (bare Browser / non-workspace): retry behaves exactly as before.
  const plain = stubbedBrowser();
  openFakeWorkspace(plain.internal);
  let plainNav: string | null = null;
  (plain.browser as unknown as { navigateGuarded: (s: string | undefined, u: string, a?: unknown) => Promise<unknown> }).navigateGuarded = async (s) => { plainNav = `${s}`; return { url: 'x', title: '', settled: true }; };
  const plainCommand = (plain.browser as unknown as { canvasCommand: (c: unknown, a: unknown) => Promise<void> }).canvasCommand.bind(plain.browser);
  await plainCommand({ type: 'retry', screen: 'home' }, {});
  assert.equal(plainNav, 'home', 'retry still navigates without the hook');
});

// ---- V4 QA fix round (F1–F10) hermetic pins --------------------------------------

test('F1: handshake recovery re-issues shell addBinding after repeated timeouts and stops at the first honoured command', async () => {
  const { browser, internal } = stubbedBrowser();
  const calls: Array<{ method: string; params: Record<string, unknown>; session?: string }> = [];
  internal.cdp = {
    send: async (method: string, params: Record<string, unknown> = {}, session?: string) => {
      calls.push({ method, params, session });
      return {};
    },
    on: () => () => undefined,
  };
  internal.sessionId = 'shell-session';
  internal.closedAt = null;
  internal.quitting = false;
  internal.lastShellCommandAt = null;
  internal.handshakeRecoveryIntervalMs = 30;
  internal.shellHandshakeFlush = async () => false; // every flush times out
  internal.shellBridgeSettled = async () => true;
  (browser as unknown as { startShellHandshakeRecovery: () => void }).startShellHandshakeRecovery();
  await pause(250); // several failed retries
  internal.lastShellCommandAt = Date.now(); // the first honoured shell command
  await pause(250); // let any in-flight tick finish and the loop observe the heartbeat
  const adds = calls.filter((c) => c.method === 'Runtime.addBinding');
  assert.ok(adds.length >= 2, `repeated flush timeouts re-issue the shell bindings (saw ${adds.length})`);
  assert.deepEqual([...new Set(adds.map((a) => a.params.name))].sort(), ['__dsCanvasSend', '__dsShellState']);
  assert.ok(adds.every((a) => a.session === 'shell-session'), 're-issued on the shell session');
  assert.equal(internal.handshakeTimer, null, 'the loop disarmed at the honoured heartbeat');
  const countAtStop = calls.length;
  await pause(200);
  assert.equal(calls.length, countAtStop, 'nothing more is sent after the heartbeat came alive');

  // Window close also stops the loop (a dead window cannot hang recovery).
  internal.cdp = {
    send: async (method: string, params: Record<string, unknown> = {}, session?: string) => {
      calls.push({ method, params, session });
      return {};
    },
    on: () => () => undefined,
  };
  internal.closedAt = null;
  internal.quitting = false;
  internal.lastShellCommandAt = null;
  (browser as unknown as { startShellHandshakeRecovery: () => void }).startShellHandshakeRecovery();
  await pause(80);
  internal.cdp = null; // the window died
  internal.closedAt = Date.now();
  await pause(250);
  assert.equal(internal.handshakeTimer, null, 'the loop disarmed at window close');
  const countAtClose = calls.length;
  await pause(150);
  assert.equal(calls.length, countAtClose, 'a closed window schedules no further attempts');
});

test('F1: a shell binding dropped by the fail-closed lease is replayed, never silently lost', async () => {
  const { browser, internal } = stubbedBrowser();
  openFakeWorkspace(internal);
  const commands: unknown[] = [];
  internal.canvasCommand = async (command: unknown) => { commands.push(command); };
  // A lease that fails closed for the first ~120 ms, exactly like a boot
  // discovery storm: captureShellAuthority answers null while `discovering`.
  let authorised = false;
  internal.contexts = {
    shellAuthorityCurrent: () => authorised,
    shell: () => null,
    artifact: () => null,
    screenForContext: () => null,
    matches: () => false,
    captureShellAuthority: () => (authorised ? { context: {}, revision: 1 } : null),
    activeScreenId: null,
  };
  const dispatch = browser as unknown as {
    dispatchBinding: (context: unknown, name: string, value: unknown, session: string | undefined, id: unknown) => boolean;
    queueBindingReplay: (context: unknown, name: string, value: unknown, session: string | undefined, id: unknown) => void;
  };
  const context = internal.contexts;
  const honouredNow = dispatch.dispatchBinding(context, '__dsCanvasSend', { type: 'ready' }, 'shell-session', 7);
  assert.equal(honouredNow, false, 'the fail-closed lease refuses the message (the old code dropped it HERE forever)');
  assert.equal(commands.length, 0);
  dispatch.queueBindingReplay(context, '__dsCanvasSend', { type: 'ready' }, 'shell-session', 7);
  await pause(80);
  assert.equal(commands.length, 0, 'still fail-closed: nothing honoured yet');
  authorised = true; // the storm settles
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && commands.length === 0) await pause(20);
  assert.equal(commands.length, 1, 'the replayed ready landed once authority materialised');
  assert.deepEqual(commands[0], { type: 'ready' });
  await pause(200);
  assert.equal(commands.length, 1, 'honoured exactly once (no duplicate replay)');
});

test('F2: attachExistingPage prefers the target at the launch URL, keeps the v1 fallback, and probes the session', async () => {
  const browser = new Browser();
  const internal = browser as unknown as Record<string, unknown> & {
    attachExistingPage: (cdp: unknown) => Promise<boolean>;
    launchUrl: string;
    targetId: string;
    sessionId: string;
    attachStableMs: number;
  };
  internal.launchUrl = 'http://127.0.0.1:4321/canvas/deadbeef';
  internal.attachStableMs = 150;
  const sent: Array<{ method: string; params: Record<string, unknown>; session?: string }> = [];
  const makeCdp = (targets: Array<{ targetId: string; type: string; url: string }>) => ({
    send: async (method: string, params: Record<string, unknown> = {}, session?: string) => {
      sent.push({ method, params, session });
      if (method === 'Target.getTargets') return { targetInfos: targets };
      if (method === 'Target.attachToTarget') return { sessionId: `ses-${String(params.targetId)}` };
      return { result: { value: true } };
    },
    on: () => () => undefined,
  });

  // A transient placeholder is listed FIRST; the app window (URL match) must win.
  const ok = await internal.attachExistingPage(makeCdp([
    { targetId: 't-blank', type: 'page', url: 'about:blank' },
    { targetId: 't-app', type: 'page', url: internal.launchUrl },
  ]));
  assert.equal(ok, true);
  assert.equal(internal.targetId, 't-app', 'the launch-URL target wins over a transient placeholder');
  assert.equal(internal.sessionId, 'ses-t-app');
  assert.ok(sent.some((c) => c.method === 'Runtime.evaluate' && c.session === 'ses-t-app'), 'the attached session is liveness-probed before the boot builds on it');

  // No URL match anywhere: the v1 choice (first non-chrome:// page) is kept.
  const browser2 = new Browser();
  const i2 = browser2 as unknown as Record<string, unknown> & { attachExistingPage: (cdp: unknown) => Promise<boolean>; launchUrl: string; targetId: string; attachStableMs: number };
  i2.launchUrl = 'http://127.0.0.1:4321/canvas/other';
  i2.attachStableMs = 120;
  const ok2 = await i2.attachExistingPage(makeCdp([
    { targetId: 't-ntp', type: 'page', url: 'chrome://new-tab-page/' },
    { targetId: 't-x', type: 'page', url: 'http://127.0.0.1:9/x' },
  ]));
  assert.equal(ok2, true);
  assert.equal(i2.targetId, 't-x', 'fallback keeps the v1 first-non-chrome:// choice byte-identical');
});

test('F4: renameScreen keeps unknown keys, unclamped sizes and invalid siblings byte-identical', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-rename-raw-'));
  const raw = {
    version: 1,
    $schema: 'https://example.invalid/screens.schema.json',
    generatedBy: 'agent',
    screens: [
      { id: 'home', file: 'home.html', title: 'Home', width: 120, height: 800, tags: ['hero', 'v2'], notes: { draft: true } },
      { id: 'BAD ENTRY', file: 'x.html', width: 'wide', height: 400 },
      { id: 'phone', file: 'phone.html', title: 'Phone', width: 390, height: 844 },
    ],
  };
  await writeFile(path.join(dir, SCREENS_FILENAME), JSON.stringify(raw, null, 2), 'utf8');
  const next = await renameScreen(dir, 'phone', 'Phone portrait');
  const onDisk = JSON.parse(await readFile(path.join(dir, SCREENS_FILENAME), 'utf8')) as typeof raw;
  assert.equal(onDisk.$schema, raw.$schema, 'unknown TOP-LEVEL keys survive (the old impl dropped them)');
  assert.equal(onDisk.generatedBy, 'agent');
  const home = onDisk.screens[0]!;
  assert.equal(home.width, 120, 'an out-of-clamp size is NOT rewritten (the reader clamps for display only)');
  assert.deepEqual(home.tags, ['hero', 'v2'], 'unknown ENTRY keys survive');
  assert.deepEqual(home.notes, { draft: true });
  assert.deepEqual(onDisk.screens[1], raw.screens[1], 'an invalid sibling is NOT removed by a rename');
  assert.equal(onDisk.screens[2]!.title, 'Phone portrait', 'only the matched entry title changed');
  assert.equal(home.title, 'Home', 'siblings keep their titles');
  // The returned view is the normalized reader contract (clamped, valid-only).
  assert.equal(next.screens.find((s) => s.id === 'phone')?.title, 'Phone portrait');
  assert.equal(next.screens.every((s) => s.width >= 200), true, 'the RETURNED view stays normalized');
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

test('F4: a failed inbound rename surfaces a warn toast (never a silent no-op)', async () => {
  const { browser, internal, toasts } = stubbedBrowser();
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-ren-toast-'));
  await writeFile(path.join(dir, SCREENS_FILENAME), '{broken json', 'utf8');
  openFakeWorkspace(internal, dir);
  const canvasCommand = (browser as unknown as { canvasCommand: (c: unknown, a: unknown) => Promise<void> }).canvasCommand.bind(browser);
  await canvasCommand({ type: 'screen-rename', screen: 'home', title: 'New name' }, {});
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !toasts.some((t) => t.kind === 'warn')) await pause(30);
  const warn = toasts.find((t) => t.kind === 'warn');
  assert.ok(warn, 'the invalid-file rename toasted a warn (F4: never silent)');
  assert.match(warn!.text, /^Rename failed: screens\.json/, 'the toast carries the actionable reason');
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

test('F5: crossing artboards retires the previous hover outline; an overwritten end still lands', async () => {
  const { browser, internal, evalCalls } = stubbedBrowser();
  openFakeWorkspace(internal);
  const canvasCommand = (browser as unknown as { canvasCommand: (c: unknown, a: unknown) => Promise<void> }).canvasCommand.bind(browser);
  await canvasCommand({ type: 'screen-hover', screen: 'home', x: 10, y: 10 }, {});
  await pause(40);
  assert.ok(evalCalls.some((c) => c.expr.includes('__dsHoverAt(10,10)') && c.screen === 'home'), 'home hovers');
  evalCalls.length = 0;
  // A board-to-board move: the shell sends NO screen-hover-end for these —
  // the service must retire the old outline itself (the ghost class).
  await canvasCommand({ type: 'screen-hover', screen: 'phone', x: 5, y: 5 }, {});
  await pause(40);
  const endIdx = evalCalls.findIndex((c) => c.expr.includes('__dsHoverEnd') && c.screen === 'home');
  const atIdx = evalCalls.findIndex((c) => c.expr.includes('__dsHoverAt(5,5)') && c.screen === 'phone');
  assert.ok(endIdx >= 0, 'F5: the PREVIOUS screen got __dsHoverEnd on the crossing');
  assert.ok(atIdx >= 0 && endIdx < atIdx, 'end-on-home precedes hoverAt-on-phone');

  // A queued 'end' OVERWRITTEN by newer coordinates for another screen must
  // still retire the old screen (the end intent is non-overwritable in effect).
  evalCalls.length = 0;
  let release: () => void = () => undefined;
  internal.evalIn = async (expr: string, _a: boolean, screen?: string) => {
    evalCalls.push({ expr, screen });
    if (expr.includes('__dsHoverAt') && screen === 'phone') await new Promise<void>((resolve) => { release = resolve; });
    return true;
  };
  void canvasCommand({ type: 'screen-hover', screen: 'phone', x: 6, y: 6 }, {});
  await pause(20); // hoverAt(phone) in flight (blocked below)
  void canvasCommand({ type: 'screen-hover-end' }, {}); // queued 'end' …
  void canvasCommand({ type: 'screen-hover', screen: 'home', x: 7, y: 7 }, {}); // … overwritten by home coords
  release();
  await pause(80);
  assert.ok(evalCalls.some((c) => c.expr.includes('__dsHoverEnd') && c.screen === 'phone'), 'F5: the overwritten end still retired phone');
  assert.ok(evalCalls.some((c) => c.expr.includes('__dsHoverAt(7,7)') && c.screen === 'home'), 'and the newest hover still lands');
});

test('F9: a closed PickQueue refuses pushes (no seq movement, no phantom watchdog warn)', async () => {
  const toasts: Array<{ kind: string; text: string }> = [];
  const queue = new PickQueue((kind, text) => toasts.push({ kind, text }));
  const first = queue.push({ kind: 'element', screen: 'home', screenUrl: 'u', at: 1, additive: false, ...fakePicked() });
  assert.ok(first, 'an open queue accepts pushes');
  queue.ack(1, 'x');
  queue.close();
  const after = queue.push({ kind: 'element', screen: 'home', screenUrl: 'u', at: 2, additive: false, ...fakePicked() });
  assert.equal(after, null, 'F9: push after close is refused');
  assert.equal(queue.lastSeq, 1, 'the seq never moves on a closed queue');
  await pause(2800);
  assert.equal(toasts.filter((t) => t.kind === 'warn').length, 0, 'no watchdog warn is armed by a post-close push');
});

test('F3/F8 source pins: the /open dedupe seed lands after startRegistryWatch; legacy {url} stops/re-targets the watch', async () => {
  const src = await readFile(path.join(root, 'service', 'main.ts'), 'utf8');
  // F3: seed AFTER start (startRegistryWatch resets the key; the old order was
  // always clobbered). Paired behavioral twin: the v4-live route-live watch pin.
  const region = src.slice(src.indexOf('V4-4: the watcher owns THIS workspace'));
  const startIdx = region.indexOf('startRegistryWatch(dirValue);');
  const seedIdx = region.indexOf('lastPushedRegistry = JSON.stringify(registry);');
  assert.ok(startIdx >= 0 && seedIdx >= 0, 'both lines exist in the /open workspace handler');
  assert.ok(seedIdx > startIdx, 'F3: the dedupe seed lands AFTER the watch start');
  assert.ok(
    /setLastWorkspace\(\{ dir: dirValue, screens: \[\], mode, activeScreen: null, view \}\);\s*startRegistryWatch\(dirValue\);/.test(src),
    'the no-screens branch still starts the watch unseeded',
  );
  // F8: a successful legacy {url} open re-targets (dir) or stops (no dir) the watch.
  const legacy = src.slice(
    src.indexOf('// { url } — the original single-page flow'),
    src.indexOf('// { dir, screen? } — the canvas workspace flow'),
  );
  assert.ok(legacy.includes('if (dir) startRegistryWatch(dir);'), 'F8: a legacy open WITH a dir re-targets the watch');
  assert.ok(legacy.includes('else stopRegistryWatch();'), 'F8: a legacy open WITHOUT a dir stops the watch');
  const watchIdx = legacy.indexOf('startRegistryWatch(dir)');
  const sendIdx = legacy.indexOf('sendJson(res, 200, { ok: true, url: nav.url');
  assert.ok(watchIdx >= 0 && sendIdx > watchIdx, 'the watch decision runs on the SUCCESS path only');
});

test('F6: a menu export that JOINS a foreign running job toasts "Another export is running — try again"', { timeout: 60_000 }, async () => {
  const port = await pickFreePort(43000, 900);
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-menu-export-'));
  await writeFile(path.join(dir, '.design-studio.json'), JSON.stringify({ version: 1, name: 'menu', type: 'hi-fi', url: 'http://127.0.0.1:9/', command: 'npm run dev', entry: 'index.html' }), 'utf8');
  await writeFile(path.join(dir, SCREENS_FILENAME), JSON.stringify({ version: 1, screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 }] }), 'utf8');
  // Child harness: importing main.ts boots the service module in-process (its
  // listen side effect rides the throwaway port env), occupies the single D4
  // export slot with a never-settling job, then drives the REAL runMenuExport
  // with a stub browser and reports the toasts it produced.
  const script = [
    'const dir = process.env.HARNESS_DIR;',
    'const main = await import(process.env.HARNESS_MAIN);',
    'const exp = await import(process.env.HARNESS_EXPORT);',
    'const stuck = { state: async () => ({ windowOpen: true, screens: [] }), capture: () => new Promise(() => {}), printScreenToPdf: () => new Promise(() => {}) };',
    "const occupied = exp.startExportJob({ dir, screens: [{ id: 'other', url: 'http://127.0.0.1:9/other.html', width: 300, height: 300, state: 'loading' }], formats: ['png'], browser: stuck });",
    'const toasts = [];',
    'const fake = { currentWorkspaceDir: () => dir, state: async () => ({ windowOpen: true, screens: [] }), pushToast: async (kind, text) => { toasts.push({ kind, text }); return true; } };',
    "await main.runMenuExport(fake, 'home', 'png');",
    'console.log(JSON.stringify({ toasts, occupiedJoined: occupied.joined ?? false }));',
    'process.exit(0);',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      OPENCHAMBER_SERVICE_PORT: String(port),
      OPENCHAMBER_SERVICE_TOKEN: TOKEN,
      HARNESS_DIR: dir,
      HARNESS_MAIN: pathToFileURL(path.join(root, 'service', 'main.ts')).href,
      HARNESS_EXPORT: pathToFileURL(path.join(root, 'service', 'export.ts')).href,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += String(d); });
  child.stderr.on('data', (d) => { stderr += String(d); });
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  assert.equal(code, 0, `harness exited cleanly (stderr: ${stderr.slice(0, 800)})`);
  const line = stdout.trim().split('\n').find((l) => l.startsWith('{'));
  const result = JSON.parse(line ?? 'null') as { toasts: Array<{ kind: string; text: string }>; occupiedJoined: boolean } | null;
  assert.ok(result, `harness printed its report (stdout: ${stdout.slice(0, 400)})`);
  assert.equal(result!.occupiedJoined, false, 'the occupying job started fresh (not a join itself)');
  assert.deepEqual(result!.toasts, [{ kind: 'warn', text: 'Another export is running — try again' }], 'F6: the joined menu export says the truth instead of "Export failed: no result"');
});
