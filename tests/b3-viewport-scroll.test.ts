// R3 (B3): artboards are device viewports. An edit-mode wheel over an artboard
// scrolls THAT frame (screen-scroll → __dsScrollBy), never the camera; the
// background still pans and Ctrl/Cmd+wheel still zooms. Export PNG renders from
// the top of the page and restores the live scroll; fit-viewport rewrites one
// screens.json entry. Unit pins run against the hermetic controller DOM and a
// stubbed Browser; the live ones against real Chrome (liveTest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import { Browser } from '../service/browser.ts';
import { resizeScreen, ScreenResizeError, SCREENS_FILENAME, viewportPresetHeight } from '../service/screens.ts';
import { liveTest } from './helpers/chrome.ts';
import { config, environment } from './helpers/controller-env.ts';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Env = ReturnType<typeof environment>;
const wheel = (e: Env, target: any, values: Record<string, unknown> = {}) => {
  const event: any = { defaultPrevented: false, ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 120, deltaMode: 0, clientX: 100, clientY: 100, target, ...values };
  event.preventDefault = () => { event.defaultPrevented = true; };
  event.stopPropagation = () => undefined;
  e.fire('canvas', 'wheel', event);
  return event;
};
const scrolls = (e: Env) => e.commands.filter((c: any) => c.type === 'screen-scroll');
const cam = (e: Env) => { const c = e.api.getCamera(); return { mode: c.mode, scale: c.scale, panX: c.panX, panY: c.panY }; };

// ---- shell (controller) ---------------------------------------------------------

test('b3-edit-wheel-over-artboard-scrolls-frame-not-camera', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  const before = cam(e);
  const scale = before.scale;
  const event = wheel(e, e.sectionOf('home'), { deltaY: 120, clientX: 100, clientY: 60 });
  assert.equal(event.defaultPrevented, true, 'the shell owns the wheel (no native page zoom/scroll)');
  assert.deepEqual(cam(e), before, 'the camera never moves');
  assert.deepEqual(scrolls(e), [{ type: 'screen-scroll', screen: 'home', x: Math.round(100 / scale), y: Math.round(60 / scale), deltaX: 0, deltaY: 120 }],
    'coords are unscaled artboard px; deltas are page px (unscaled)');
  // Line-mode deltas normalize to px; the far end of a page never chains into a pan.
  wheel(e, e.sectionOf('home'), { deltaY: 3, deltaMode: 1 });
  assert.equal(scrolls(e).at(-1).deltaY, 120);
  wheel(e, e.sectionOf('home'), { deltaY: 1e9 });
  assert.equal(scrolls(e).at(-1).deltaY, 8192, 'deltas are clamped to the service bound');
  assert.deepEqual(cam(e), before);
  // The header chrome is not the viewport: a wheel there pans like before.
  wheel(e, e.elementOf('home', '.ds-ab-title'), { deltaY: 40 });
  assert.notDeepEqual(cam(e), before, 'header chrome wheel pans the camera');
  assert.equal(scrolls(e).length, 3);
});

test('b3-edit-wheel-coalesces-per-frame (Windows high-res trackpad deltas are summed)', () => {
  const e = environment(undefined, true, config, { frames: 'manual' });
  e.api.setStatus({ state: 'ready' });
  e.flushFrames();
  const home = e.sectionOf('home');
  for (const dy of [4, 4.5, 3.5, 8]) wheel(e, home, { deltaY: dy, deltaX: 1 });
  assert.equal(scrolls(e).length, 0, 'nothing is sent before the frame');
  e.flushFrames();
  assert.equal(scrolls(e).length, 1, 'one message per rAF');
  assert.equal(scrolls(e)[0].deltaY, 20);
  assert.equal(scrolls(e)[0].deltaX, 4);
  // A screen change flushes the previous board's sum first (never mixes boards).
  const other = e.sectionOf('other');
  other.rect = { x: 0, y: 0, left: 0, top: 0, width: 300, height: 400 };
  wheel(e, home, { deltaY: 10 });
  wheel(e, other, { deltaY: 7 });
  assert.deepEqual(scrolls(e).slice(1).map((c: any) => [c.screen, c.deltaY]), [['home', 10]]);
  e.flushFrames();
  assert.deepEqual(scrolls(e).slice(1).map((c: any) => [c.screen, c.deltaY]), [['home', 10], ['other', 7]]);
});

test('b3-edit-wheel-over-background-pans', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  const before = cam(e);
  wheel(e, e.$('canvas'), { deltaY: 60 });
  const panned = cam(e);
  assert.equal(panned.mode, 'manual');
  assert.ok(Math.abs(panned.panY - (before.panY - 60)) < 1e-9, 'empty canvas wheel still pans the camera');
  assert.equal(scrolls(e).length, 0);
  // Ctrl/Cmd+wheel over an artboard is camera zoom, never a scroll.
  const zoomEvent = wheel(e, e.sectionOf('home'), { ctrlKey: true, deltaY: -100 });
  assert.equal(zoomEvent.defaultPrevented, true);
  assert.ok(cam(e).scale > panned.scale, 'ctrl+wheel zooms');
  assert.equal(scrolls(e).length, 0);
  // Space / H pan mode: the wheel over an artboard pans (the camera owns it).
  e.bridge.togglePan();
  const pre = cam(e);
  wheel(e, e.sectionOf('home'), { deltaY: 30 });
  assert.ok(Math.abs(cam(e).panY - (pre.panY - 30)) < 1e-9, 'pan mode wheel pans');
  assert.equal(scrolls(e).length, 0);
  e.bridge.togglePan();
  // Play mode: the iframe owns its wheel natively; whatever reaches the canvas pans.
  e.api.setMode('play');
  const prePlay = cam(e);
  wheel(e, e.sectionOf('home'), { deltaY: 20 });
  assert.ok(Math.abs(cam(e).panY - (prePlay.panY - 20)) < 1e-9);
  assert.equal(scrolls(e).length, 0);
  // Agent input owns the canvas: nothing is relayed.
  e.api.setMode('edit');
  e.api.setAgentInput(true);
  wheel(e, e.sectionOf('home'), { deltaY: 20 });
  assert.equal(scrolls(e).length, 0);
});

test('b3-legacy-launch-wheel-unchanged', () => {
  const e = environment(undefined, true, { ...config, workspace: false });
  e.api.setStatus({ state: 'ready' });
  const before = cam(e);
  wheel(e, e.sectionOf('home'), { deltaY: 50 });
  assert.equal(scrolls(e).length, 0, 'the legacy single-frame launch never emits screen-scroll');
  assert.ok(Math.abs(cam(e).panY - (before.panY - 50)) < 1e-9, 'its wheel pans exactly as before');
});

test('b3-scroll-cue: setScreenMeta marks the size label and survives setScreens', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  const size = () => e.elementOf('home', '.ds-ab-size').textContent;
  assert.equal(size(), '1280×800');
  assert.equal(e.api.setScreenMeta('home', { scrollable: true }), true);
  assert.equal(size(), '1280×800 ↕');
  assert.equal(e.sectionOf('home').dataset.scrollable, 'true');
  e.api.setScreens(config.screens);
  assert.equal(size(), '1280×800 ↕', 'a registry push keeps the cue');
  assert.equal(e.api.setScreenMeta('home', { scrollable: false }), true);
  assert.equal(size(), '1280×800');
  for (const bad of [['HOME', { scrollable: true }], ['home', null], ['home', { scrollable: 'yes' }]] as const) {
    assert.equal(e.api.setScreenMeta(bad[0], bad[1] as never), false);
  }
});

// ---- service (stubbed Browser) ----------------------------------------------------

function stubbed() {
  const browser = new Browser();
  const internal = browser as any;
  const evals: Array<{ expr: string; screen?: string }> = [];
  const toasts: Array<{ kind: string; text: string }> = [];
  internal.cdp = { send: async () => ({}), on: () => () => undefined };
  internal.sessionId = 'fake-shell-session';
  internal.contexts = { shellAuthorityCurrent: () => true, shell: () => null, artifact: () => null, activeScreenId: null };
  internal.shellEvalSettled = async () => true;
  internal.evalIn = async (expr: string, _await: boolean, screen?: string) => { evals.push({ expr, screen }); return true; };
  internal.pushToast = async (kind: string, text: string) => { toasts.push({ kind, text }); return true; };
  internal.workspaceMode = true;
  internal.applyScreenRegistry([
    { id: 'home', url: 'http://localhost:9/home.html', file: 'home.html', title: 'Home', width: 1280, height: 800 },
    { id: 'phone', url: 'http://localhost:9/phone.html', file: 'phone.html', title: 'Phone', width: 390, height: 2400 },
  ]);
  const command = (value: unknown) => internal.canvasCommand(value, {}) as Promise<void>;
  return { browser, internal, evals, toasts, command };
}

test('b3-service: screen-scroll is validated, deltas summed latest-wins, hover re-run, dropped during capture', async () => {
  const s = stubbed();
  let release: () => void = () => undefined;
  s.internal.evalIn = async (expr: string, _a: boolean, screen?: string) => {
    s.evals.push({ expr, screen });
    if (expr.includes('__dsScrollBy') && s.evals.length === 1) await new Promise<void>((resolve) => { release = resolve; });
    return true;
  };
  for (const bad of [
    { type: 'screen-scroll', screen: 'home', x: 9000, y: 10, deltaX: 0, deltaY: 10 },
    { type: 'screen-scroll', screen: 'home', x: 10, y: -1, deltaX: 0, deltaY: 10 },
    { type: 'screen-scroll', screen: 'home', x: 10, y: 10, deltaX: 0, deltaY: 9000 },
    { type: 'screen-scroll', screen: 'home', x: 10, y: 10, deltaX: '1', deltaY: 10 },
    { type: 'screen-scroll', screen: 'ghost', x: 10, y: 10, deltaX: 0, deltaY: 10 },
  ]) await s.command(bad);
  assert.equal(s.evals.length, 0, 'invalid payloads never reach a frame');
  void s.command({ type: 'screen-scroll', screen: 'home', x: 10, y: 10, deltaX: 0, deltaY: 100 });
  await pause(5);
  void s.command({ type: 'screen-scroll', screen: 'home', x: 11, y: 12, deltaX: 2, deltaY: 30 });
  void s.command({ type: 'screen-scroll', screen: 'home', x: 13, y: 14, deltaX: 3, deltaY: 40 });
  await pause(5);
  release();
  await pause(30);
  const relayed = s.evals.filter((c) => c.expr.includes('__dsScrollBy'));
  assert.equal(relayed.length, 2, 'one in flight; the queued ones coalesce into one evaluate');
  assert.match(relayed[0]!.expr, /__dsScrollBy\(0,100,10,10\)/);
  assert.match(relayed[1]!.expr, /__dsScrollBy\(5,70,13,14\)/, 'queued deltas are summed, coords latest-wins');
  assert.ok(relayed.every((c) => c.screen === 'home'));
  assert.ok(relayed.every((c) => !c.expr.includes('__dsHoverAt')), 'no hover re-run while this screen does not own the hover');
  // With the hover on this screen, the same evaluate re-runs __dsHoverAt.
  s.internal.lastHoverScreen = 'home';
  await s.command({ type: 'screen-scroll', screen: 'home', x: 20, y: 30, deltaX: 0, deltaY: 50 });
  await pause(10);
  assert.match(s.evals.at(-1)!.expr, /__dsScrollBy\(0,50,20,30\).*__dsHoverAt\(20,30\)/);
  // A capture owns the frame: scrolls drop.
  const count = s.evals.length;
  s.internal.captureInFlight = true;
  await s.command({ type: 'screen-scroll', screen: 'home', x: 20, y: 30, deltaX: 0, deltaY: 50 });
  await pause(10);
  assert.equal(s.evals.length, count, 'dropped while captureInFlight');
});

test('b3-fit-viewport-menu-rewrites-only-that-entry', async () => {
  assert.deepEqual([390, 480, 481, 768, 900, 901, 1280, 1440, 1920].map(viewportPresetHeight), [844, 844, 1024, 1024, 1024, 900, 800, 900, 900]);
  const dir = await mkdtemp(path.join(tmpdir(), 'ds-b3-fit-'));
  try {
    const original = {
      version: 1,
      extra: { keep: ['me', 1] },
      screens: [
        { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 3200, note: 'agent field' },
        { id: 'phone', file: 'phone.html', title: 'Phone', width: 390, height: 2600, x: 10 },
        { id: 'phone', file: 'shadow.html', title: 'Shadowed duplicate', width: 390, height: 9999 },
        { id: 'BAD id', width: 'junk' },
      ],
    };
    await writeFile(path.join(dir, SCREENS_FILENAME), `${JSON.stringify(original, null, 2)}\n`);
    const next = await resizeScreen(dir, 'phone', 390, 844);
    const expected = structuredClone(original);
    expected.screens[1]!.height = 844;
    assert.equal(await readFile(path.join(dir, SCREENS_FILENAME), 'utf8'), `${JSON.stringify(expected, null, 2)}\n`,
      'only that entry\'s height changed; key order, unknown keys, the shadowed duplicate and the invalid sibling are byte-verbatim');
    assert.deepEqual((await readdir(dir)).sort(), [SCREENS_FILENAME], 'no tmp file left behind');
    assert.equal(next.screens.find((entry) => entry.id === 'phone')!.height, 844);
    await assert.rejects(() => resizeScreen(dir, 'ghost', 390, 844), ScreenResizeError);
    await assert.rejects(() => resizeScreen(dir, 'home', 1280, 100), /integer 200–8192/);
    await assert.rejects(() => resizeScreen(dir, 'home', 1280.5, 800), ScreenResizeError);

    // The menu action: service computes the preset from the board width.
    const s = stubbed();
    s.internal.workspaceDir = dir;
    await s.command({ type: 'screen-menu', screen: 'phone', action: 'fit-viewport' });
    assert.deepEqual(s.toasts.at(-1), { kind: 'ok', text: 'Resized to 390×844 viewport' });
    // Home 1280×800 in the service record is already the desktop viewport.
    await s.command({ type: 'screen-menu', screen: 'home', action: 'fit-viewport' });
    assert.deepEqual(s.toasts.at(-1), { kind: 'ok', text: 'Already a 1280×800 viewport' });
    assert.match(await readFile(path.join(dir, SCREENS_FILENAME), 'utf8'), /"height": 3200/, 'a no-op never writes');
    await s.command({ type: 'screen-menu', screen: 'phone', action: 'fit-viewport' });
    assert.equal(s.toasts.at(-1)!.kind, 'ok');
    // Unwritable/unparseable registry surfaces as a warn toast.
    await writeFile(path.join(dir, SCREENS_FILENAME), '{nope');
    await s.command({ type: 'screen-menu', screen: 'phone', action: 'fit-viewport' });
    assert.equal(s.toasts.at(-1)!.kind, 'warn');
    assert.match(s.toasts.at(-1)!.text, /^Resize failed: /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- live (real Chrome, real in-frame script) --------------------------------------

const PAGE = '<!doctype html><title>B3</title><style>html,body{margin:0}#top{height:200px;background:#ff0000}#mid{height:1000px;background:#0000ff}#below{display:block;width:300px;height:100px;background:#00ff00;border:0}#tail{height:1200px;background:#0000ff}</style><div id=top></div><div id=mid></div><button id=below>Below</button><div id=tail></div>';

async function liveCanvas(run: (browser: Browser) => Promise<void>): Promise<void> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const prior = process.env.DS_WINDOW;
  process.env.DS_WINDOW = '-2400,-2400,1400,900';
  const browser = new Browser();
  try {
    const base = `http://localhost:${address.port}/`;
    await browser.openWorkspace({ dir: undefined, screens: [{ id: 'home', url: base + 'home.html', width: 390, height: 844, title: 'Home' }], baseUrl: base, mode: 'edit' });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && browser.getState().screens[0]?.state !== 'ready') await pause(100);
    await run(browser);
  } finally {
    if (prior === undefined) delete process.env.DS_WINDOW; else process.env.DS_WINDOW = prior;
    await browser.close().catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function shell(browser: Browser, expression: string): Promise<any> {
  const internal = browser as unknown as { cdp: { send: (m: string, p: object, s: string) => Promise<any> }; sessionId: string };
  const reply = await internal.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, internal.sessionId);
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}

async function until(check: () => boolean | Promise<boolean>, label: string, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await check()) return; await pause(10); }
  assert.fail(label);
}

const scrollY = async (browser: Browser) => Number(await browser.evaluate('scrollY', 'home'));
const sendScroll = (browser: Browser, deltaY: number, x = 100, y = 100) =>
  shell(browser, `__dsCanvasSend(JSON.stringify({type:'screen-scroll',screen:'home',x:${x},y:${y},deltaX:0,deltaY:${deltaY}}))`);

test('b3-live: native edit-mode wheel over the artboard scrolls the frame, not the camera (+ scroll cue, latency)', { timeout: 120_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser) => {
    await until(async () => String(await shell(browser, "document.querySelector('.ds-artboard[data-screen=home] .ds-ab-size').textContent")).endsWith('↕'), 'the scroll cue marks a document taller than the viewport', 8000);
    const internal = browser as unknown as { cdp: { send: (m: string, p: object, s: string) => Promise<any> }; sessionId: string };
    const rect = await shell(browser, "(()=>{const r=document.querySelector('.ds-artboard[data-screen=home]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+Math.min(r.height/2,120)};})()");
    const camera0 = JSON.stringify(await shell(browser, '(({mode,scale,panX,panY})=>({mode,scale,panX,panY}))(__dsCanvas.getCamera())'));
    assert.equal(await scrollY(browser), 0);
    await internal.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y }, internal.sessionId);
    const started = Date.now();
    await internal.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rect.x, y: rect.y, deltaX: 0, deltaY: 300 }, internal.sessionId);
    await until(async () => (await scrollY(browser)) > 0, 'the frame scrolled');
    const wheelToScrolled = Date.now() - started;
    assert.equal(await scrollY(browser), 300, 'page px, unscaled by the camera');
    assert.equal(JSON.stringify(await shell(browser, '(({mode,scale,panX,panY})=>({mode,scale,panX,panY}))(__dsCanvas.getCamera())')), camera0, 'the camera never moved');
    // Service hop latency (screen-scroll → frame scrolled), measured from Node.
    const hops: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const from = await scrollY(browser);
      const at = Date.now();
      await sendScroll(browser, 40);
      await until(async () => (await scrollY(browser)) !== from, 'relay landed');
      hops.push(Date.now() - at);
    }
    const internalMs = (browser as unknown as { lastScrollMs: number | null }).lastScrollMs;
    console.log(`[b3] native wheel→frame scrolled ${wheelToScrolled}ms; relay hops ${hops.join('/')}ms (incl. polling); service evaluate ${internalMs}ms`);
    // Scrolling to the end never chains into a pan.
    await sendScroll(browser, 8000);
    await until(async () => (await scrollY(browser)) > 1500, 'scrolled to the end');
    await internal.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rect.x, y: rect.y, deltaX: 0, deltaY: 600 }, internal.sessionId);
    await pause(150);
    assert.equal(JSON.stringify(await shell(browser, '(({mode,scale,panX,panY})=>({mode,scale,panX,panY}))(__dsCanvas.getCamera())')), camera0, 'past the page end the camera still stays put');
  });
});

test('b3-pick-after-scroll-hits-correct-element', { timeout: 120_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser) => {
    await sendScroll(browser, 1000);
    await until(async () => (await scrollY(browser)) === 1000, 'scrolled 1000px');
    // #below sits at document y 1200..1300 → viewport y 200..300 now.
    await shell(browser, `__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:'home',x:100,y:250,clickAt:${Date.now()}}))`);
    await until(() => browser.getState().selection.count === 1, 'selected below the fold');
    const payload = await browser.evaluate('window.__dsSelectionTake()', 'home') as Array<{ selector: string; rect: { y: number; height: number }; scrollX: number; scrollY: number }>;
    assert.equal(payload.length, 1);
    assert.equal(payload[0]!.selector, '#below', 'the element under the scrolled viewport point');
    assert.equal(Math.round(payload[0]!.rect.y), 200, 'rect is viewport-relative');
    assert.equal(payload[0]!.scrollY, 1000, 'the payload carries the document scroll');
    assert.equal(payload[0]!.scrollX, 0);
    // Through the queue (selection-send): the same element lands.
    await shell(browser, `__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:'home',x:100,y:250}))`);
    await until(() => browser.getState().selection.count === 1, 'selected again');
    await shell(browser, '__dsToolbarBridge.referenceSelection()');
    let page = await browser.getPicks(0, 2000);
    const deadline = Date.now() + 3000;
    while (!page.picks.length && Date.now() < deadline) page = await browser.getPicks(0, 300);
    assert.equal(page.picks[0]?.selector, '#below');
    assert.equal(Math.round(page.picks[0]!.rect!.y), 200);
  });
});

test('b3-hover-follows-scroll', { timeout: 120_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser) => {
    const label = () => browser.evaluate("(()=>{const o=document.getElementById('__ds-hover-outline');return o&&o.style.display!=='none'?o.textContent:''})()", 'home') as Promise<string>;
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-hover',screen:'home',x:100,y:250}))");
    await until(async () => (await label()).startsWith('div#mid'), 'hover outlines the element under the pointer');
    await sendScroll(browser, 1000, 100, 250);
    await until(async () => (await label()).startsWith('button#below'), 'after the scroll the hover outline follows to the new element');
    const top = Number(await browser.evaluate("Math.round(document.getElementById('__ds-hover-outline').getBoundingClientRect().top)", 'home'));
    assert.equal(top, 200, 'the outline sits on the element in viewport coords');
  });
});

/** Decode a PNG to RGB lookups (all five filters). */
function hasColor(png: Buffer, rgb: [number, number, number], tol = 8): boolean {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), channels = png[25] === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) { const size = png.readUInt32BE(at); if (png.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + size)); at += size + 12; }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) for (let x = 0; x < stride; x++) {
    const f = raw[y * (stride + 1)]!, v = raw[y * (stride + 1) + x + 1]!;
    const a = x >= channels ? px[y * stride + x - channels]! : 0, b = y ? px[(y - 1) * stride + x]! : 0, c = y && x >= channels ? px[(y - 1) * stride + x - channels]! : 0;
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    px[y * stride + x] = (v + [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!) & 255;
  }
  for (let i = 0; i < px.length; i += channels) if (Math.abs(px[i]! - rgb[0]) <= tol && Math.abs(px[i + 1]! - rgb[1]) <= tol && Math.abs(px[i + 2]! - rgb[2]) <= tol) return true;
  return false;
}

test('b3-export-png-captures-top-and-restores-scroll', { timeout: 120_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser) => {
    await sendScroll(browser, 1000);
    await until(async () => (await scrollY(browser)) === 1000, 'scrolled 1000px');
    const live = await browser.capture('home');
    assert.equal(hasColor(live.png, [255, 0, 0]), false, 'a plain capture (agent screenshot) keeps the live scroll');
    assert.equal(hasColor(live.png, [0, 255, 0]), true);
    const shot = await browser.capture('home', { top: true });
    assert.equal(shot.width, 390);
    assert.equal(shot.height, 844);
    assert.equal(hasColor(shot.png, [255, 0, 0]), true, 'the export renders from the top of the page');
    assert.equal(hasColor(shot.png, [0, 255, 0]), false, 'nothing below the first viewport');
    assert.equal(await scrollY(browser), 1000, 'the live scroll is restored after the export');
  });
});
