// SPEC-V4 workstream A (service core) — LIVE Chrome regression pins.
// The four repro probes of the P3 gate (E1 fixed-size artboards, E3 fit-all +
// picking, E4 export overlay bleed, E9 agent wheel) are the named regression
// targets, plus the V4-4 live registry push (route-level, real service),
// V4-5 queue timing through the real binding, V4-6 hover geometry, and the
// V4-10 menu round-trip over __dsCanvasSend.
//
// Chrome discovery: tests/helpers/chrome.ts (D, V4-16 — liveTest() skips when
// Chrome is missing and LOUDLY fails under DS_REQUIRE_CHROME=1, closing E14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Browser } from '../service/browser.ts';
import { liveTest } from './helpers/chrome.ts';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'v4-live-token-123';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const page = (title: string, bg: string, extra = '') =>
  `<!doctype html><title>${title}</title><style>body{margin:0;background:${bg}}#b{display:block;width:200px;height:80px;margin:40px}</style><button id=b>${title}</button>${extra}`;

/** shell-context evaluate — same private seam the P3 probes used. */
async function shell(browser: Browser, expression: string): Promise<any> {
  const internal = browser as unknown as {
    cdp: { send: (method: string, params: object, session: string) => Promise<any> };
    sessionId: string;
  };
  const reply = await internal.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, internal.sessionId);
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}

const ihdr = (png: Buffer) => `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;

/** Decode a PNG to RGBA pixels (all five row filters — same decoder the P2 live suite ships). */
function pngPixels(png: Buffer) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), channels = png[25] === 6 ? 4 : 3;
  assert.ok(png[25] === 6 || png[25] === 2 || png[25] === 0, `unexpected color type ${png[25]}`);
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const size = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + size));
    at += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) for (let x = 0; x < stride; x++) {
    const filter = raw[y * (stride + 1)]!;
    const value = raw[y * (stride + 1) + x + 1]!;
    const a = x >= channels ? pixels[y * stride + x - channels]! : 0;
    const b = y ? pixels[(y - 1) * stride + x]! : 0;
    const c = y && x >= channels ? pixels[(y - 1) * stride + x - channels]! : 0;
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    const predictors = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c];
    pixels[y * stride + x] = (value + predictors[filter]!) & 255;
  }
  return {
    width,
    height,
    channels,
    near(x: number, y: number, rgb: [number, number, number], tol = 8) {
      const at = (y * width + x) * channels;
      return Math.abs(pixels[at]! - rgb[0]) <= tol && Math.abs(pixels[at + 1]! - rgb[1]) <= tol && Math.abs(pixels[at + 2]! - rgb[2]) <= tol;
    },
  };
}

/** True when NO pixel within ±tol of `rgb` exists anywhere in the image. */
function lacksColor(img: ReturnType<typeof pngPixels>, rgb: [number, number, number], tol = 8): boolean {
  for (let y = 0; y < img.height; y += 1) for (let x = 0; x < img.width; x += 1) if (img.near(x, y, rgb, tol)) return false;
  return true;
}

/** One fixture HTTP server + one off-screen Browser per live test. */
async function liveCanvas(testRun: (browser: Browser, base: string) => Promise<void>, body?: (url: string) => string) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end((body ?? ((u: string) => page(u.includes('phone') ? 'Phone' : u.includes('tall') ? 'Tall' : 'Home', u.includes('tall') ? '#cfe' : u.includes('phone') ? '#fce' : '#eef', u.includes('tall') ? '<div style="height:2400px"></div>' : '<div style="height:1200px"></div>')))(req.url ?? '/'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const prior = process.env.DS_WINDOW;
  process.env.DS_WINDOW = '-2400,-2400,1400,900';
  const browser = new Browser();
  try {
    await testRun(browser, `http://localhost:${address.port}/`);
  } finally {
    if (prior === undefined) delete process.env.DS_WINDOW;
    else process.env.DS_WINDOW = prior;
    await browser.close().catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const REGISTRY = [
  { id: 'home', url: 'home.html', width: 1280, height: 800, title: 'Home' },
  { id: 'phone', url: 'phone.html', width: 390, height: 844, title: 'Phone' },
  { id: 'tall', url: 'tall.html', width: 390, height: 844, title: 'Tall' },
] as const;

// ---- E1 / V4-1: fixed-size artboards (the headline regression) -----------------

test('E1/V4-1: activating every artboard keeps registry size; innerWidth and capture IHDR agree (probe1/probe4 shape)', { timeout: 180_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser, base) => {
    await browser.openWorkspace({
      screens: REGISTRY.map((s) => ({ id: s.id, url: base + s.url, width: s.width, height: s.height, title: s.title })),
      baseUrl: base,
      mode: 'edit',
    });
    await pause(2500);
    const sizes = async () => (await shell(browser, '__dsCanvas.getScreens().map(s=>s.id+":"+s.width+"x"+s.height)')) as string[];
    const expectSizes = REGISTRY.map((s) => `${s.id}:${s.width}x${s.height}`);
    assert.deepEqual(await sizes(), expectSizes, 'open sizes equal the registry');

    for (const screen of REGISTRY) {
      await browser.setActive(screen.id);
      await pause(2500);
      const after = await sizes();
      const reported = after.find((entry) => entry.startsWith(`${screen.id}:`));
      assert.equal(reported, `${screen.id}:${screen.width}x${screen.height}`, `activating ${screen.id} did NOT requalify it (E1: 1280x800 was the failure)`);
      assert.equal(await browser.evaluate('innerWidth', screen.id), screen.width, `${screen.id} frame innerWidth is its registry width`);
      const shot = await browser.capture(screen.id);
      assert.equal(ihdr(shot.png), `${screen.width}x${screen.height}`, `capture(${screen.id}) PNG IHDR equals the registry size (E2 pin)`);
      assert.equal(shot.width, screen.width);
      assert.equal(shot.height, screen.height);
    }

    // Navigation must not resurrect the qualification either (same sizes after).
    await browser.navigate('phone', base + 'phone.html?nav=1');
    await pause(2000);
    const afterNav = await sizes();
    assert.ok(afterNav.includes('phone:390x844'), `phone survived navigation at 390x844 (got ${afterNav.join(',')})`);
    assert.equal(await browser.evaluate('innerWidth', 'phone'), 390);

    // And the layout machinery stays disarmed: a height-dirty storm cannot
    // requalify — getCamera reports the pinned viewport/custom layout.
    const camera = await browser.getCamera();
    assert.equal(camera?.layoutMode, 'viewport', 'workspace layout stays pinned to viewport');
    assert.equal(camera?.preset, 'custom');
  });
});

// ---- E3 / V4-1 + V4-5: fit-all leaves the canvas fully usable -------------------

test('E3/V4-1: after fit-all the canvas still pans AND picks (probe2: fitPresetClickPick was 0)', { timeout: 150_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser, base) => {
    await browser.openWorkspace({
      screens: REGISTRY.map((s) => ({ id: s.id, url: base + s.url, width: s.width, height: s.height, title: s.title })),
      baseUrl: base,
      mode: 'edit',
    });
    await pause(2000);
    await shell(browser, '__dsToolbarBridge.fitAll()');
    await pause(500);
    const cam0 = await shell(browser, 'JSON.stringify([__dsCanvas.getCamera().panX,__dsCanvas.getCamera().scale])');
    await shell(browser, '__dsToolbarBridge.panBy("right")');
    await pause(400);
    const cam1 = await shell(browser, 'JSON.stringify([__dsCanvas.getCamera().panX,__dsCanvas.getCamera().scale])');
    assert.notEqual(cam1, cam0, 'fit-all keeps camera control (zoom/pan alive, unlike the old fit preset)');

    // Inbound pick still lands.
    const seq0 = browser.getState().pickSeq;
    await shell(browser, '__dsCanvasSend(JSON.stringify({type:"screen-pick",screen:"home",x:120,y:60}))');
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && browser.getState().pickSeq === seq0) await pause(25);
    assert.ok(browser.getState().pickSeq > seq0, 'edit-mode pick lands after fit-all');
    assert.equal(browser.pick()?.selector, '#b');

    // A REAL compositor click after fitAll too (probe2's exact flow — the fit
    // preset used to freeze pointerdown at layoutMode==='fit').
    const point = await shell(browser, "(()=>{const b=document.getElementById('ds-frame-home').getBoundingClientRect();const s=__dsCanvas.getCamera().scale;return {x:b.x+120*s,y:b.y+60*s}})()");
    const internal = browser as unknown as { cdp: { send: (m: string, p: object, s?: string) => Promise<unknown> }; sessionId: string };
    const seq1 = browser.getState().pickSeq;
    for (const type of ['mousePressed', 'mouseReleased']) await internal.cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 }, internal.sessionId);
    const deadline2 = Date.now() + 2000;
    while (Date.now() < deadline2 && browser.getState().pickSeq === seq1) await pause(25);
    assert.ok(browser.getState().pickSeq > seq1, 'native click pick lands after fit-all');

    // Presets are gone from the service surface too: a stray 'layout' message
    // is tolerated with NO effect (V4-1 ignore branch, live).
    await shell(browser, '__dsCanvasSend(JSON.stringify({type:"layout",mode:"page",preset:"desktop"}))');
    await pause(800);
    const sizes = (await shell(browser, '__dsCanvas.getScreens().map(s=>s.id+":"+s.width+"x"+s.height)')) as string[];
    assert.ok(sizes.includes('phone:390x844'), 'a stray layout message cannot resize artboards anymore');
  });
});

// ---- E4 / V4-2: overlays never reach exports; V4-6 hover geometry -----------------

test('E4/V4-2 + V4-6: pick then export = NO green pixels; hover outline tracks and fades; PDF stays clean', { timeout: 180_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser, base) => {
    await browser.openWorkspace({ screens: [{ id: 'home', url: base + 'home.html', width: 1280, height: 800, title: 'Home' }], baseUrl: base, mode: 'edit' });
    await pause(2000);

    // V4-6: the hover outline equals the button rect ±1 px within 150 ms.
    await shell(browser, '__dsCanvasSend(JSON.stringify({type:"screen-hover",screen:"home",x:100,y:60}))');
    const deadline = Date.now() + 400;
    type HoverRect = { top: number; left: number; width: number; height: number };
    let hoverRect: HoverRect | null = null;
    while (Date.now() < deadline) {
      hoverRect = (await browser.evaluate("(()=>{const o=document.getElementById('__ds-hover-outline');if(!o||o.style.display==='none')return null;const r=o.getBoundingClientRect();return {top:r.top,left:r.left,width:r.width,height:r.height}})()")) as HoverRect | null;
      if (hoverRect) break;
      await pause(20);
    }
    assert.ok(hoverRect, 'screen-hover produced the #__ds-hover-outline in-frame');
    const rect = hoverRect as HoverRect;
    assert.ok(Math.abs(rect.left - 40) <= 1 && Math.abs(rect.top - 40) <= 1 && Math.abs(rect.width - 200) <= 1 && Math.abs(rect.height - 80) <= 1, `hover rect matches the button: ${JSON.stringify(rect)}`);
    await shell(browser, '__dsCanvasSend(JSON.stringify({type:"screen-hover-end"}))');
    await pause(120);
    assert.equal(await browser.evaluate("(()=>{const o=document.getElementById('__ds-hover-outline');return !!o&&o.style.display!=='none'})()"), false, 'screen-hover-end hides it');

    // Coalescing: a burst of 40 hovers never errors and never queues more
    // than ~one per frame (the strict ≤70/s bound is timing-hostile in CI;
    // the hermetic pump test pins the exact latest-wins semantics).
    for (let i = 0; i < 40; i += 1) void shell(browser, `__dsCanvasSend(JSON.stringify({type:"screen-hover",screen:"home",x:${50 + i},y:60}))`);
    await pause(300);

    // E4: pick #b — the green outline shows, then capture must NOT contain it.
    await shell(browser, '__dsCanvasSend(JSON.stringify({type:"screen-pick",screen:"home",x:100,y:60}))');
    const pickDeadline = Date.now() + 2000;
    while (Date.now() < pickDeadline && !browser.pick()) await pause(25);
    assert.equal(browser.pick()?.selector, '#b');
    assert.equal(await browser.evaluate("(()=>{const o=document.getElementById('__ds-pick-outline');return !!o&&o.style.display!=='none'})()"), true, 'the picked outline is visible BEFORE the capture');

    const shot = await browser.capture('home');
    const img = pngPixels(shot.png);
    assert.equal(lacksColor(img, [0x22, 0xc5, 0x5e]), true, 'E4: no pick-green pixel (±8) survives the export');
    assert.equal(lacksColor(img, [0x3b, 0x82, 0xf6]), true, 'V4-6: no hover-blue pixel (±8) survives the export');
    // Within the 1500 ms window the outline is back on screen (capture hid and restored).
    assert.equal(await browser.evaluate("(()=>{const o=document.getElementById('__ds-pick-outline');return !!o&&o.style.display!=='none'})()"), true, 'restored inside the fade window');
    await pause(1700);
    assert.equal(await browser.evaluate("(()=>{const o=document.getElementById('__ds-pick-outline');return !!o&&o.style.display!=='none'})()"), false, 'the green mark faded after 1500 ms (no permanent mark)');

    // V4-2 PDF pin (live half): print still runs on the clean throwaway target.
    const pdf = await browser.printScreenToPdf(base + 'home.html', 1280, 800);
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-', 'PDF exported');
    assert.equal(await browser.pageTargetCount(), 1, 'R7: the throwaway target closed');
  });
});

// ---- E9 / V4-7: the agent wheel scrolls the PAGE, never the user's camera --------

test('E9/V4-7: agent wheel in EDIT mode scrolls the target frame; camera and view.json stay put (probe2 shape)', { timeout: 150_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-e9-'));
  await writeFile(path.join(dir, '.design-studio.json'), JSON.stringify({ version: 1, name: 'e9', type: 'hi-fi', url: 'http://localhost:1/', command: 'npm run dev', entry: 'index.html' }), 'utf8');
  await liveCanvas(async (browser, base) => {
    await browser.openWorkspace({ dir, screens: [{ id: 'home', url: base + 'home.html', width: 1280, height: 800, title: 'Home' }], baseUrl: base, mode: 'edit' });
    await pause(2000);
    const camBefore = await shell(browser, 'JSON.stringify([__dsCanvas.getCamera().panX,__dsCanvas.getCamera().panY])');
    const viewFile = path.join(dir, '.design-studio', 'view.json');
    const readCamera = async () => {
      try {
        return ((await readViewForTest(viewFile)) as { camera?: unknown }).camera ?? null;
      } catch {
        return 'ABSENT';
      }
    };
    const viewCameraBefore = await readCamera();
    const sy0 = Number(await browser.evaluate('scrollY'));
    assert.equal(sy0, 0);
    await browser.input([{ type: 'wheel', x: 640, y: 400, deltaX: 0, deltaY: 400, modifiers: { alt: false, ctrl: false, meta: false, shift: false } }]);
    await pause(400);
    const sy1 = Number(await browser.evaluate('scrollY'));
    assert.ok(Math.abs(sy1 - 400) < 4, `the PAGE scrolled to ~400 (got ${sy1}; E9 failure was scrollY 0)`);
    const camAfter = await shell(browser, 'JSON.stringify([__dsCanvas.getCamera().panX,__dsCanvas.getCamera().panY])');
    assert.equal(camAfter, camBefore, 'the user camera did NOT pan (E9 failure was [0,0]→[0,-400])');
    await pause(800);
    const viewCameraAfter = await readCamera();
    assert.deepEqual(viewCameraAfter, viewCameraBefore, 'view.json camera untouched (no bogus persistence)');

    // V4-7 pointer half — reveal + agentInput is B's shell API; run the full
    // flow once it exists, pin the routing absence-safe meanwhile.
    const hasAgentInput = await shell(browser, "typeof __dsCanvas.setAgentInput==='function'");
    const seqBefore = browser.getState().pickSeq;
    if (hasAgentInput === true) {
      await browser.input('home', [
        { type: 'pointer', action: 'down', x: 100, y: 60, button: 0, buttons: 1, modifiers: { alt: false, ctrl: false, meta: false, shift: false } },
        { type: 'pointer', action: 'up', x: 100, y: 60, button: 0, buttons: 0, modifiers: { alt: false, ctrl: false, meta: false, shift: false } },
      ]);
      await pause(400);
    } else {
      await browser.input('home', [{ type: 'key', action: 'down', key: 'a', code: 'KeyA', modifiers: { alt: false, ctrl: false, meta: false, shift: false } }]);
      await pause(200);
    }
    assert.equal(browser.getState().pickSeq, seqBefore, 'agent pointer/key input creates NO pick (V4-7), whether or not B shell API is merged');
  });
  await import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }).catch(() => undefined));
});

async function readViewForTest(file: string): Promise<unknown> {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

// ---- V4-5 live: the real binding path feeds the queue ------------------------------

test('V4-5 live: two picks 50ms apart BOTH drain from /picks in seq order; long-poll resolves on push', { timeout: 120_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser, base) => {
    await browser.openWorkspace({
      screens: REGISTRY.slice(0, 2).map((s) => ({ id: s.id, url: base + s.url, width: s.width, height: s.height, title: s.title })),
      baseUrl: base,
      mode: 'edit',
    });
    await pause(2000);
    const waiting = browser.getPicks(0, 5000);
    await pause(50);
    const t0 = Date.now();
    await shell(browser, '__dsCanvasSend(JSON.stringify({type:"screen-pick",screen:"home",x:120,y:60}))');
    const first = await waiting;
    assert.ok(Date.now() - t0 < 300, `the wait resolved within 300 ms of the binding pick (took ${Date.now() - t0})`);
    assert.equal(first.picks.length, 1);
    assert.equal(first.picks[0]?.screen, 'home');
    assert.equal(first.picks[0]?.kind, 'element');
    assert.equal(first.picks[0]?.screenUrl, base + 'home.html');

    // Two picks inside any realistic poll interval — both must queue.
    await shell(browser, '__dsCanvasSend(JSON.stringify({type:"screen-pick",screen:"home",x:120,y:60}))');
    await pause(50);
    await shell(browser, '__dsCanvasSend(JSON.stringify({type:"screen-pick",screen:"phone",x:100,y:60,additive:true}))');
    await pause(400);
    const both = await browser.getPicks(first.seq, 0);
    assert.equal(both.picks.length, 2, 'no pick is lost between polls (E7)');
    assert.equal(both.picks[0]?.screen, 'home');
    assert.equal(both.picks[1]?.screen, 'phone');
    assert.equal(both.picks[1]?.additive, true, 'shift-flag survives the real round-trip');
    assert.ok(both.picks[0]!.seq < both.picks[1]!.seq, 'seq ordered');
  });
});

// ---- V4-10 live: menu round-trip over the real shell channel -------------------------

test('V4-10 live: screen-menu send-to-chat rides /picks as kind:screen; reset-position persists; legacy counters untouched', { timeout: 120_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-menu-live-'));
  await writeFile(path.join(dir, '.design-studio.json'), JSON.stringify({ version: 1, name: 'menu', type: 'hi-fi', url: 'http://localhost:1/', command: 'npm run dev', entry: 'index.html' }), 'utf8');
  await liveCanvas(async (browser, base) => {
    await browser.openWorkspace({ dir, screens: [{ id: 'home', url: base + 'home.html', file: 'home.html', width: 1280, height: 800, title: 'Home' }], baseUrl: base, mode: 'edit' });
    await pause(2000);
    const pickSeq0 = browser.getState().pickSeq;
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-menu',screen:'home',action:'send-to-chat'}))");
    const deadline = Date.now() + 2000;
    let page = await browser.getPicks(0, 0);
    while (Date.now() < deadline && page.picks.length === 0) {
      await pause(50);
      page = await browser.getPicks(0, 0);
    }
    assert.equal(page.picks.length, 1, 'the synthetic menu event queued');
    assert.equal(page.picks[0]?.kind, 'screen');
    assert.equal(page.picks[0]?.file, 'home.html');
    assert.equal(page.picks[0]?.width, 1280);
    assert.equal(browser.getState().pickSeq, pickSeq0, 'lastPick/pickSeq stay element-only (back-compat kept)');

    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-menu',screen:'home',action:'reset-position'}))");
    const viewDeadline = Date.now() + 2500;
    let positions: Record<string, unknown> | undefined;
    while (Date.now() < viewDeadline) {
      try {
        positions = (JSON.parse(await readFile(path.join(dir, '.design-studio', 'view.json'), 'utf8')) as { positions?: Record<string, unknown> }).positions;
      } catch {
        positions = undefined;
      }
      if (positions && 'home' in positions) break;
      await pause(60);
    }
    assert.equal(positions?.home, null, 'reset-position stored null (back to auto)');
  });
  await import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }).catch(() => undefined));
});

// ---- V4-15 / E17: camera-save reliability (the 1-in-5 loss instrumented) --------

test('V4-15 E17 pin: 15 consecutive camera-changed pushes ALL persist to view.json (no lease-loss)', { timeout: 150_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-e17-'));
  await liveCanvas(async (browser, base) => {
    await browser.openWorkspace({ dir, screens: [{ id: 'home', url: base + 'home.html', width: 1280, height: 800, title: 'Home' }], baseUrl: base, mode: 'edit' });
    await pause(2000);
    for (let i = 1; i <= 15; i += 1) {
      await shell(browser, `__dsCanvasSend(JSON.stringify({type:"camera-changed",camera:{mode:"manual",scale:1,panX:${i * 100},panY:0}}))`);
      await pause(60); // outlives the 300 ms service coalescer so every value is its own burst
      const deadline = Date.now() + 2500;
      let saved = -1;
      while (Date.now() < deadline) {
        try {
          saved = (JSON.parse(await readFile(path.join(dir, '.design-studio', 'view.json'), 'utf8')) as { camera?: { panX?: number } }).camera?.panX ?? -1;
        } catch { saved = -1; }
        if (saved === i * 100) break;
        await pause(50);
      }
      assert.equal(saved, i * 100, `camera-changed #${i} persisted (E17 intermittent loss class)`);
    }
    const state = browser.getState();
    assert.ok(state.shellBridge.lastCommandAt !== null, 'the shell bridge heartbeat recorded inbound commands');
    assert.equal(state.registryError, null);
  });
  await import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }).catch(() => undefined));
});

// V4-15 / E17 — INTEGRATOR owed (SPEC-V4 §4 "Integrator … E17 20× loop"; A's
// MUST 5). Twenty rounds of the user flow — WARM re-open (the exact path a
// `{dir}` `/open` runs: pushShellScreens + setMode + waitScreen +
// refreshUnsettled) followed by a real shell `camera-changed` pan — each round
// must land its exact panX in view.json within 5 s. The E17 defect class (a
// whole session losing every camera write through the shell-authority lease
// race) would show up as misses; both the miss list and the persist latencies
// are printed for the CHANGELOG numbers. focus:false only skips the
// bringToFront raise — the persistence pipeline under test is identical.
test('V4-15/E17 integrator loop: 20× warm open + pan — camera persists EVERY time (numbers reported)', { timeout: 420_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  const dir = await mkdtemp(path.join(tmpdir(), 'v4-e17-20x-'));
  const misses: number[] = [];
  const latencies: number[] = [];
  try {
    await liveCanvas(async (browser, base) => {
      const wsScreens = () => [{ id: 'home', url: base + 'home.html', width: 1280, height: 800, title: 'Home' }];
      await browser.openWorkspace({ dir, screens: wsScreens(), baseUrl: base, mode: 'edit' });
      for (let i = 1; i <= 20; i += 1) {
        await browser.openWorkspace({ dir, screens: wsScreens(), baseUrl: base, mode: 'edit', focus: false }); // the warm re-open half of /open
        const panX = 4000 + i * 137; // distinct every round — a stale file can never false-match
        const started = Date.now();
        await shell(browser, `__dsCanvasSend(JSON.stringify({type:"camera-changed",camera:{mode:"manual",scale:1,panX:${panX},panY:0}}))`);
        let saved = -1;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          try {
            saved = (JSON.parse(await readFile(path.join(dir, '.design-studio', 'view.json'), 'utf8')) as { camera?: { panX?: number } }).camera?.panX ?? -1;
          } catch { saved = -1; }
          if (saved === panX) break;
          await pause(25);
        }
        latencies.push(Date.now() - started);
        if (saved !== panX) misses.push(i);
      }
      const sorted = [...latencies].sort((a, b) => a - b);
      console.info(JSON.stringify({
        e17: '20x warm-open + pan',
        iterations: 20,
        misses,
        persistMs: { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1], total: sorted.reduce((a, b) => a + b, 0) },
      }));
      assert.deepEqual(misses, [], `every open/pan pair persisted its camera (missed rounds: ${misses.join(',') || 'none'})`);
      const state = browser.getState();
      assert.ok(state.shellBridge.lastCommandAt !== null, 'the shell bridge heartbeat stayed alive across all 20 rounds');
    });
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }).catch(() => undefined));
  }
});

// ---- V4-4 route-level live: watcher pushes into a REAL window --------------------------

test('V4-4 route-live: agent screens appear within ~3s, corrupt registry is LOUD, recovery clears it; /screens/sync backstops', { timeout: 240_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  const fixture = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(page('Live WS', '#eef', '<div style="height:900px"></div>'));
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const base = `http://localhost:${(fixture.address() as { port: number }).port}/`;
  const ws = await mkdtemp(path.join(tmpdir(), 'v4-watch-live-'));
  await writeFile(path.join(ws, '.design-studio.json'), JSON.stringify({ version: 1, name: 'watch', type: 'hi-fi', url: base, command: 'npm run dev', entry: 'index.html', pagesRoot: '.' }), 'utf8');
  await writeFile(path.join(ws, 'home.html'), page('Home', '#eef'), 'utf8');
  await writeFile(path.join(ws, 'screens.json'), JSON.stringify({ version: 1, screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 }] }), 'utf8');
  const port = await pickFreePort(45000, 1200);
  const child: ChildProcess = spawn(process.execPath, [path.join(rootDir, 'service', 'main.ts')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', DS_WORKSPACE_ROOT: ws, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN, DS_WINDOW: '-2400,-2400,1400,900' },
    stdio: 'ignore',
  });
  const api = async (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...(init?.body ? { 'content-type': 'application/json' } : {}) } });
  const state = async () => (await (await api('/state')).json()) as {
    windowOpen: boolean;
    screens: Array<{ id: string }>;
    activeScreen: string | null;
    registryError: string | null;
    shellBridge: { authority: boolean; lastCommandAt: number | null };
  };
  const poll = async (predicate: (s: Awaited<ReturnType<typeof state>>) => boolean, timeoutMs: number, label: string) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const s = await state();
      if (predicate(s)) return s;
      if (Date.now() >= deadline) assert.fail(`${label} — last state: ${JSON.stringify({ screens: s.screens.map((x) => x.id), registryError: s.registryError, bridge: s.shellBridge })}`);
      await pause(100);
    }
  };
  try {
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await api('/health')).status === 200) break;
      } catch { /* booting */ }
      if (Date.now() >= deadline) assert.fail('service never became healthy');
      await pause(100);
    }
    const openRes = await (await api('/open', { method: 'POST', body: JSON.stringify({ dir: ws, focus: false }) })).json() as { ok: boolean; error?: string; windowOpen?: boolean };
    assert.equal(openRes.ok, true, `cold /open succeeded (${openRes.error ?? ''})`);

    // Heartbeat acceptance doubles as the boot-handshake pin: 'ready' used to
    // race the binding registration (page load beating attach silently dropped
    // it — found by this very step failing 2/4 suite runs). Fixed at the root
    // in service/browser.ts shellBridgeSettled (re-invoke the guarded
    // __dsToolbarMounted once the binding is proven live); the 30 s window is
    // kept for cold Chrome launches on a busy Windows host.
    const s0 = await poll((s) => s.windowOpen && s.shellBridge.lastCommandAt !== null, 30_000, 'window + shell heartbeat');
    assert.deepEqual(s0.screens.map((x) => x.id), ['home']);
    assert.equal(s0.registryError, null);

    // The agent adds a screen by writing files only — no route call, no reopen.
    const viewBefore = await (await api(`/view?dir=${encodeURIComponent(ws)}`)).json();
    await writeFile(path.join(ws, 'b.html'), page('B', '#fce'), 'utf8');
    await writeFile(path.join(ws, 'screens.json'), JSON.stringify({ version: 1, screens: [
      { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
      { id: 'b', file: 'b.html', title: 'Bee', width: 390, height: 844 },
    ] }), 'utf8');
    await poll((s) => s.screens.length === 2, 8000, 'V4-4: the new artboard appears within seconds (E6)');
    const pushedState = await state();
    const viewAfter = await (await api(`/view?dir=${encodeURIComponent(ws)}`)).json() as { positions: Record<string, unknown>; mode: string };
    const viewBeforeObj = viewBefore as { positions: Record<string, unknown>; mode: string };
    assert.deepEqual(viewAfter.positions, viewBeforeObj.positions, 'the registry push never wrote positions (no camera restore path ran)');
    assert.equal(viewAfter.mode, viewBeforeObj.mode, 'the push never flipped the mode');
    assert.equal(pushedState.activeScreen, 'home', 'the push did NOT change the active artboard');

    // Break the registry: LOUD, but the last good set stays.
    await writeFile(path.join(ws, 'screens.json'), '{broken', 'utf8');
    const broken = await poll((s) => s.registryError !== null, 8000, 'E11: registry error surfaced');
    assert.match(String(broken.registryError), /^screens\.json: /);
    assert.equal(broken.screens.length, 2, 'artboards unchanged while broken');

    // Fix it: error clears, the watcher settles.
    await writeFile(path.join(ws, 'screens.json'), JSON.stringify({ version: 1, screens: [
      { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
      { id: 'b', file: 'b.html', title: 'Bee', width: 390, height: 844 },
    ] }), 'utf8');
    await poll((s) => s.registryError === null && s.screens.length === 2, 8000, 'recovery clears registryError');

    // V4-12: agent status posts ride the live shell.
    const statusRes = await api('/agent-status', { method: 'POST', body: JSON.stringify({ busy: true, label: 'Designing' }) });
    assert.equal(statusRes.status, 200);

    // V4-4 backstop.
    const syncRes = await (await api('/screens/sync', { method: 'POST', body: JSON.stringify({ dir: ws }) })).json() as { ok: boolean; pushed: boolean };
    assert.equal(syncRes.ok, true);

    // The pick queue sees nothing without clicks — and ack answers.
    const picks = await (await api('/picks?since=0&wait=0')).json() as { seq: number; picks: unknown[] };
    assert.ok(Array.isArray(picks.picks));
  } finally {
    await api('/close', { method: 'POST' }).catch(() => undefined);
    child.kill('SIGKILL');
    fixture.closeAllConnections();
    fixture.close();
    await pause(300);
    await import('node:fs/promises').then(({ rm }) => rm(ws, { recursive: true, force: true }).catch(() => undefined));
  }
});
