// B1 (R1) — LIVE Chrome regression pins: a reopened or reloaded canvas must
// never stick on "Loading this screen". Root cause: board live state outlived
// its window (doQuit/stop kept state/liveUrl), the reopen's cold path copied
// that stale 'ready' back, and the ready push was transition-gated on the
// STALE record — so a fresh shell (which boots every board 'loading') was
// never told 'ready'. Fixed by a window-scoped reset, a shellState gate (what
// THIS shell was last told) and a re-sync on the shell's 'ready' handshake.
//
// Chrome discovery: tests/helpers/chrome.ts (liveTest() skips when Chrome is
// missing and LOUDLY fails under DS_REQUIRE_CHROME=1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { Browser } from '../service/browser.ts';
import { liveTest } from './helpers/chrome.ts';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const page = (title: string, bg: string) =>
  `<!doctype html><title>${title}</title><style>body{margin:0;background:${bg}}</style><h1>${title}</h1><div style="height:1200px"></div>`;

/** shell-context evaluate — the same private seam the other live suites use. */
async function shell(browser: Browser, expression: string): Promise<any> {
  const internal = browser as unknown as {
    cdp: { send: (method: string, params: object, session: string) => Promise<any> };
    sessionId: string;
  };
  const reply = await internal.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, internal.sessionId);
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}

type Board = { id: string; state: string };
const shellBoards = async (browser: Browser): Promise<Board[]> =>
  JSON.parse(await shell(browser, 'JSON.stringify(__dsCanvas.getScreens().map(s=>({id:s.id,state:s.state})))')) as Board[];

/** Poll until every shell board AND every /state screen reads 'ready'. */
async function allReady(browser: Browser, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let boards: Board[] = [];
  let service: Array<{ id: string; state: string }> = [];
  while (Date.now() < deadline) {
    try {
      boards = await shellBoards(browser);
      service = (await browser.state()).screens.map((s) => ({ id: s.id, state: String(s.state) }));
      if (boards.length === REGISTRY.length && boards.every((b) => b.state === 'ready') && service.every((s) => s.state === 'ready')) return;
    } catch { /* shell mid-boot/reload: keep polling */ }
    await pause(100);
  }
  assert.fail(`${label} — shell boards ${JSON.stringify(boards)}, /state screens ${JSON.stringify(service)}`);
}

const REGISTRY = [
  { id: 'home', path: 'home', width: 1280, height: 800, title: 'Home' },
  { id: 'phone', path: 'phone', width: 390, height: 844, title: 'Phone' },
  { id: 'tall', path: 'tall', width: 390, height: 844, title: 'Tall' },
] as const;

async function liveCanvas(run: (browser: Browser, base: string) => Promise<void>) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    const url = req.url ?? '/';
    res.end(page(url.includes('phone') ? 'Phone' : url.includes('tall') ? 'Tall' : 'Home', url.includes('phone') ? '#fce' : url.includes('tall') ? '#cfe' : '#eef'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const prior = process.env.DS_WINDOW;
  process.env.DS_WINDOW = '-2400,-2400,1400,900';
  const browser = new Browser();
  if (prior === undefined) delete process.env.DS_WINDOW;
  else process.env.DS_WINDOW = prior;
  try {
    await run(browser, `http://localhost:${address.port}/`);
  } finally {
    await browser.close().catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const workspace = (base: string, mode: 'edit' | 'play') => ({
  screens: REGISTRY.map((s) => ({ id: s.id, url: base + s.path, width: s.width, height: s.height, title: s.title })),
  baseUrl: base,
  mode,
  focus: false,
});

/** Close the window and wait until the service sees it gone. */
async function closeWindow(browser: Browser): Promise<void> {
  await browser.close();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && (await browser.state()).windowOpen) await pause(100);
  assert.equal((await browser.state()).windowOpen, false, 'the window closed');
}

test('B1: open → close → open the same workspace — every board reaches ready (shell AND /state)', { timeout: 150_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser, base) => {
    await browser.openWorkspace(workspace(base, 'edit'));
    await allReady(browser, 'first open: every board ready');

    await closeWindow(browser);
    // The dead window's live facts do not survive it.
    const closed = (await browser.state()).screens;
    assert.ok(closed.every((s) => s.state === 'loading'), `closed boards read loading, not the dead window's ready: ${JSON.stringify(closed)}`);

    await browser.openWorkspace(workspace(base, 'edit'));
    await allReady(browser, 'B1: reopened boards never stick on loading');
  });
});

test('B1: a shell location.reload() re-syncs every board to ready without /open', { timeout: 150_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser, base) => {
    await browser.openWorkspace(workspace(base, 'edit'));
    await allReady(browser, 'first open: every board ready');

    await shell(browser, 'setTimeout(()=>location.reload(),0),true');
    // Wait for the reloaded shell to come up (its boards boot 'loading').
    const deadline = Date.now() + 10_000;
    let sawLoading = false;
    while (Date.now() < deadline && !sawLoading) {
      try { sawLoading = (await shellBoards(browser)).some((b) => b.state === 'loading'); } catch { /* reload in flight */ }
      if (!sawLoading) await pause(20);
    }
    await allReady(browser, 'B1: the reloaded shell was re-told every board is ready');
  });
});

test('B1 + F13: a play-mode relaunch keeps the restored activeScreen through the boot load storm', { timeout: 150_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser, base) => {
    await browser.openWorkspace(workspace(base, 'play'));
    await browser.setActive('phone');
    await allReady(browser, 'first open: every board ready');

    await closeWindow(browser);
    await browser.openWorkspace(workspace(base, 'play'));
    await browser.setActive('phone');
    // Watch through the whole boot storm (every board's dom/ready/load) and
    // the B1 re-sync: the follow must never steal the restored artboard.
    const watchUntil = Date.now() + 4000;
    const seen = new Set<string | null>();
    while (Date.now() < watchUntil) {
      seen.add(browser.getState().activeScreen);
      await pause(50);
    }
    await allReady(browser, 'relaunched play-mode boards ready');
    seen.add(browser.getState().activeScreen);
    assert.deepEqual([...seen], ['phone'], `F13: activeScreen stayed the restored one (saw ${JSON.stringify([...seen])})`);
  });
});
