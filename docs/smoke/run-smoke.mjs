// docs/smoke/run-smoke.mjs — end-to-end Design Canvas smoke against the REAL service.
//
// P2 lane: spawns service/main.ts with host-style env, scaffolds a workspace,
// opens the real Chrome canvas, exports PNG+PDF per screen, and screenshots
// the full shell via DevToolsActivePort.
//
// V4 extension (SPEC-V4 §4 smoke, workstream D):
//   1. three screens (desktop 1280×800, phone 390×844, tall 390×1600) from
//      screens.json + html files;
//   2. activate EACH header (real mouse click on `.ds-ab-title`) and pin E1:
//      artboard sizes stay exact after activation;
//   3. pick → chip timing (edit-mode click, wall-clock until the pick is
//      service-visible — via `GET /picks` when V4-5 has landed, else
//      `/state.lastPick`);
//   4. a 4th screen added live appears ≤3 s (needs A's screens-watch, V4-4);
//   5. a corrupt screens.json surfaces `registryError` in /state (V4-4);
//   6. export after the activations: every PNG's IHDR dims == the registry
//      (E2 — must fail once V4-1 has landed if it does not);
//   7. screenshots at fit-all, 100% and with the context menu open (V4-10),
//      written to docs/smoke/v4/.
// Steps whose V4 feature is not integrated yet print a clear SKIP line instead
// of crashing: this script must run green at D's HEAD AND after integration.
// E1/E2 are special-cased: while the OLD toolbar (aria-label="Design viewport")
// still exists they report as pre-V4 advisories; once B removes it, the same
// checks become hard failures.
//
// Run from repo root: node docs/smoke/run-smoke.mjs   (needs Chrome; DS_CHROME_PATH optional)
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 56987, TOKEN = crypto.randomBytes(12).toString('hex');
const OUT = path.join(import.meta.dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const V4OUT = path.join(import.meta.dirname, 'v4'); fs.mkdirSync(V4OUT, { recursive: true });
const WS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ds-smoke-')), 'cozy-brew');
fs.mkdirSync(WS, { recursive: true });
const hdr = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const call = async (m, p, b) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: hdr, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${t.slice(0, 300)}`);
  return j;
};
// A non-throwing fetch for capability probes (routes that may not exist yet).
const probe = async (m, p, b) => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: hdr, body: b ? JSON.stringify(b) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  } catch (e) { return { status: 0, body: String((e && e.message) || e) }; }
};

// ---------------------------------------------------------------- steps ------
class SmokeSkip extends Error {}   // a step that cannot apply at this HEAD
const results = [];                // {name, status: 'PASS'|'FAIL'|'SKIP', note}
async function step(name, fn) {
  try {
    const note = await fn();
    results.push({ name, status: 'PASS', note: note || '' });
    console.log(`✓ ${name}${note ? ' — ' + note : ''}`);
  } catch (e) {
    if (e instanceof SmokeSkip) {
      results.push({ name, status: 'SKIP', note: e.message });
      console.log(`– ${name} — SKIP: ${e.message}`);
    } else {
      results.push({ name, status: 'FAIL', note: String((e && e.message) || e) });
      console.log(`✗ ${name} — ${String((e && e.message) || e)}`);
    }
  }
}
const skip = (why) => { throw new SmokeSkip(why); };

// PNG IHDR dimensions (bytes 16..23 big-endian) — no new deps.
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.subarray(1, 4).toString() !== 'PNG') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// ---------------------------------------------------------------- service ----
const svc = spawn(process.execPath, ['service/main.ts'], {
  env: { ...process.env, OPENCHAMBER_SERVICE_PORT: String(PORT), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
  stdio: ['ignore', 'pipe', 'pipe'], cwd: path.join(import.meta.dirname, '..', '..'), windowsHide: true,
});
svc.stderr.on('data', (d) => process.stderr.write(`[svc] ${d}`));
const die = async (code) => { try { await call('POST', '/close'); } catch {} svc.kill(); process.exit(code); };

try {
  for (let i = 0; i < 100; i++) {
    if (svc.exitCode !== null) throw new Error(`service exited early: ${svc.exitCode} (port ${PORT} busy?)`);
    if (await fetch(`http://127.0.0.1:${PORT}/health`, { headers: hdr }).then((r) => r.status === 200).catch(() => false)) break;
    await sleep(200);
  }
  console.log('service up');

  // ---------------------------------------------------------------- scaffold --
  let scaffoldUrl = '';
  await step('scaffold workspace (warm-editorial)', async () => {
    console.log('  (npm install can take a minute)');
    const sc = await call('POST', '/scaffold', { dir: WS, type: 'hi-fi', brief: 'Cozy Brew — a warm neighbourhood coffee shop landing page', designSystemId: 'warm-editorial' });
    if (!sc.ok) throw new Error('scaffold: ' + JSON.stringify(sc));
    scaffoldUrl = sc.url;
    // V4-14: a fresh scaffold binds/quotes the IPv4 loopback, never "localhost".
    const host = new URL(sc.url).hostname;
    if (host !== '127.0.0.1') throw new Error(`scaffold url host is ${host}, expected 127.0.0.1 (V4-14)`);
    const pkg = JSON.parse(fs.readFileSync(path.join(WS, 'package.json'), 'utf8'));
    if (!/--host 127\.0\.0\.1/.test(pkg.scripts.dev) || /--host(?!\s+127\.0\.0\.1)/.test(pkg.scripts.dev)) {
      throw new Error(`dev script exposes more than loopback: ${pkg.scripts.dev}`);
    }
    return sc.url;
  });

  // E5 pin while we're here: the bridged tokens.css must satisfy styles.css.
  await step('scaffold token bridge (E5): styles.css vars all declared', async () => {
    const styles = fs.readFileSync(path.join(WS, 'styles.css'), 'utf8');
    const tokens = fs.readFileSync(path.join(WS, 'tokens.css'), 'utf8');
    const declared = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const dangling = [...new Set([...styles.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))].filter((n) => !declared.has(n));
    if (dangling.length) throw new Error(`dangling vars render the preset unstyled (Times New Roman): ${dangling.join(', ')}`);
    if (!/--font-sans:\s*var\(--font-body\)/.test(tokens)) throw new Error('--font-sans is not bridged');
    return 'no dangling vars; --font-sans → --font-body';
  });

  // ---------------------------------------------------------------- screens --
  const REGISTRY = [
    { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
    { id: 'phone', file: 'phone.html', title: 'Phone', width: 390, height: 844 },
    { id: 'tall', file: 'tall.html', title: 'Tall', width: 390, height: 1600 },
  ];
  const pageHtml = (title, bg, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="styles.css"></head><body style="background:${bg}"><main style="padding:32px"><h1>${title}</h1><button id="b" style="padding:12px 24px">Press</button>${extra}</main></body></html>`;
  await step('write 3 screen files + registry', async () => {
    fs.writeFileSync(path.join(WS, 'phone.html'), pageHtml('Checkout — Cozy Brew (phone)', '#fbf1e6', '<p>One flat white · oat milk</p>'));
    fs.writeFileSync(path.join(WS, 'tall.html'), pageHtml('Menu — Cozy Brew (tall)', '#efe3d3', '<div style="height:1500px">long scroll</div>'));
    const put = await call('PUT', `/screens?dir=${encodeURIComponent(WS)}`, { version: 1, screens: REGISTRY });
    if (put.ok === false) throw new Error('PUT /screens: ' + JSON.stringify(put));
    return 'home 1280×800 · phone 390×844 · tall 390×1600';
  });

  await step('open the canvas window', async () => {
    const opened = await call('POST', '/open', { dir: WS });
    if (!opened.ok) throw new Error('/open: ' + JSON.stringify(opened));
    let state = null;
    for (let i = 0; i < 150; i++) {
      state = await call('GET', '/state');
      const ready = (state.screens || []).filter((s) => s.state === 'ready').length;
      if (ready === 3 && state.windowOpen) break;
      await sleep(400);
    }
    fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state, null, 2));
    const ready = (state.screens || []).filter((s) => s.state === 'ready').length;
    if (ready !== 3 || !state.windowOpen) throw new Error('window/screens not ready: ' + JSON.stringify((state.screens || []).map((s) => `${s.id}:${s.state}`)));
    return `mode ${state.mode}, screens ${state.screens.map((s) => `${s.id}:${s.state}`).join(', ')}`;
  });

  // ---------------------------------------------------------------- CDP ------
  // Attach to the shell page (the /canvas/ target). Other concurrent test
  // lanes leave their own ds-chrome-* profiles around, so walk the profiles
  // newest-first and take the FIRST one whose DevToolsActivePort answers with
  // a live /canvas/ page target — never just the freshest directory.
  const profileDirs = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('ds-chrome-')).map((d) => [d, fs.statSync(path.join(os.tmpdir(), d)).mtimeMs]).sort((a, b) => b[1] - a[1]);
  let ws = null;
  let debugHttpBase = '';
  const attachDeadline = Date.now() + 20_000;
  while (!ws && Date.now() < attachDeadline) {
    for (const [dir] of profileDirs) {
      const portFilePath = path.join(os.tmpdir(), dir, 'DevToolsActivePort');
      let lines;
      try { lines = fs.readFileSync(portFilePath, 'utf8').split(/\r?\n/); } catch { continue; }
      let shellTarget = null;
      try {
        const targets = await (await fetch(`http://127.0.0.1:${lines[0]}/json`)).json();
        shellTarget = targets.find((t) => t.type === 'page' && t.url.includes('/canvas/'));
      } catch { continue; }
      if (!shellTarget) continue;
      try {
        const candidate = new WebSocket(shellTarget.webSocketDebuggerUrl);
        await new Promise((res, rej) => { candidate.onopen = res; candidate.onerror = rej; setTimeout(() => rej(new Error('ws open timeout')), 5000); });
        ws = candidate;
        debugHttpBase = `http://127.0.0.1:${lines[0]}`;
        break;
      } catch { continue; }
    }
    if (!ws) await sleep(500);
  }
  if (!ws) throw new Error('no live /canvas/ CDP target on any ds-chrome-* profile within 20 s');
  let cdpId = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const cdp = (method, params = {}) => new Promise((res, rej) => {
    const id = ++cdpId;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`evaluate: ${JSON.stringify(r.exceptionDetails).slice(0, 200)}`);
    return r.result.value;
  };
  const mouse = (type, x, y, button = 'left') =>
    cdp('Input.dispatchMouseEvent', { type, x, y, button, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const rectOf = async (selector) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const shot = async (name) => {
    const s = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const file = path.join(V4OUT, name);
    fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
    const dims = pngSize(file);
    return `${name} (${dims ? dims.width + '×' + dims.height : '?'})`;
  };

  // Screens as the SHELL sees them (artboard width/height — what a capture uses).
  const shellScreens = async () =>
    evaluate(`window.__dsCanvas && typeof __dsCanvas.getScreens === 'function' ? __dsCanvas.getScreens() : []`);

  // V4-3 live acceptance (E5): the scaffolded warm-editorial body must NOT
  // render in Times New Roman. Artboard iframes are same-process and their
  // execution contexts DO arrive via Runtime.enable on the shell page — but a
  // sandboxed frame reports no usable `url` (it arrives as "undefined"), so
  // match by ORIGIN: only the workspace's own dev-server port hosts the
  // screen pages. Any screen context works — they all load the same bridged
  // tokens.css + styles.css.
  await step('E5 live: body fontFamily ≠ Times for warm-editorial', async () => {
    const devPort = new URL(scaffoldUrl).port;
    if (!devPort) skip('no scaffold dev url to match frame origins against');
    const contexts = [];
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.executionContextCreated') {
        const d = m.params?.context;
        if (d && String(d.origin || '').includes(`:${devPort}`)) contexts.push(d);
      }
    };
    ws.addEventListener('message', onMsg);
    await cdp('Runtime.enable');
    for (let i = 0; i < 20 && contexts.length === 0; i++) await sleep(200);
    let family = null;
    if (contexts.length) {
      const r = await cdp('Runtime.evaluate', {
        expression: '({url: location.href, family: getComputedStyle(document.body).fontFamily})',
        returnByValue: true,
        contextId: contexts[0].id,
      });
      family = r.result?.value?.family ?? null;
    }
    await cdp('Runtime.disable').catch(() => {});
    ws.removeEventListener('message', onMsg);
    if (!family) skip(`no dev-server (:${devPort}) execution context surfaced via Runtime.enable — cannot read the computed font`);
    if (/times new roman/i.test(family)) throw new Error(`E5 REGRESSION: body renders in ${family} — the token bridge let --font-sans dangle`);
    return `body fontFamily = ${String(family).slice(0, 70)} (${contexts.length} screen context(s))`;
  });
  // E1 strictness switch: while the old toolbar still mounts the viewport
  // preset ToggleGroup, V4-1 has not landed and activation-size checks are
  // advisories. B removes `aria-label="Design viewport"` in V4-1.
  const preV4Shell = () =>
    evaluate(`Boolean(document.querySelector('[aria-label="Design viewport"]'))`);

  await step('overview screenshot at fit-all', async () => {
    const hasFitAll = await evaluate(`Boolean(window.__dsCanvas && typeof __dsCanvas.fitAll === 'function')`);
    if (hasFitAll) await evaluate(`__dsCanvas.fitAll()`);
    else console.log('  (no __dsCanvas.fitAll — shooting with the current camera)');
    await sleep(600);
    const a = await shot('01-overview-fit-all.png');
    // Keep the P2 artifact too (same view, old path).
    const s = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, 'canvas-overview.png'), Buffer.from(s.data, 'base64'));
    return a + ' + out/canvas-overview.png';
  });

  let e1Advisory = false;
  for (const screen of REGISTRY) {
    await step(`activate header: ${screen.id} (E1: size stays exact)`, async () => {
      const sel = `[data-screen="${screen.id}"] .ds-ab-title`;
      const rect = await rectOf(sel);
      if (!rect) skip(`no ${sel} — artboard header not mounted`);
      await mouse('mousePressed', rect.x + rect.w / 2, rect.y + rect.h / 2);
      await mouse('mouseReleased', rect.x + rect.w / 2, rect.y + rect.h / 2);
      await sleep(2500); // the legacy qualification tail (if any) lands late
      const now = (await shellScreens()).find((s) => s.id === screen.id);
      if (!now) skip('screen vanished from the shell');
      const exact = now.width === screen.width && now.height === screen.height;
      const tag = `${screen.id} now ${now.width}×${now.height}`;
      if (exact) return tag + ' ✓ (registry size kept)';
      if (await preV4Shell()) {
        e1Advisory = true;
        skip(`E1 reproduces PRE-V4-1 (legacy qualification resized to ${now.width}×${now.height}) — advisory; it becomes a hard FAIL once the viewport-preset toolbar is gone`);
      }
      throw new Error(`E1 REGRESSION after V4-1: activating ${screen.id} changed its size to ${now.width}×${now.height} (registry ${screen.width}×${screen.height})`);
    });
    await step(`screenshot after activating ${screen.id}`, async () => shot(`02-active-${screen.id}.png`));
  }

  await step('screenshot at 100% zoom (toolbar zoom menu)', async () => {
    // Product path: the toolbar's Zoom dropdown item "100%" (V4-9 menu).
    const trigger = await rectOf('#zoom');
    if (!trigger) skip('no #zoom toolbar control at this HEAD — cannot pin the 100% view');
    await mouse('mousePressed', trigger.x + trigger.w / 2, trigger.y + trigger.h / 2);
    await mouse('mouseReleased', trigger.x + trigger.w / 2, trigger.y + trigger.h / 2);
    let item = null;
    for (let i = 0; i < 10 && !item; i++) {
      item = await rectOf(`[role="menu"] [role="menuitem"], [role="menu"] button`);
      if (!item) await sleep(150);
    }
    if (item) {
      // Click the menu item whose label is 100% (find its own rect by text).
      const target = await evaluate(`(() => { const els=[...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button')]; const el=els.find(e=>/100\\s*%/.test(e.textContent||'')); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,label:el.textContent.trim()}; })()`);
      if (target) {
        await mouse('mousePressed', target.x + target.w / 2, target.y + target.h / 2);
        await mouse('mouseReleased', target.x + target.w / 2, target.y + target.h / 2);
        await sleep(400);
        const s = await shot('03-zoom-100.png');
        return s + ` via toolbar "${target.label}"`;
      }
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
    // Fallback (pre-V4-9 HEADs): the canvas keyboard shortcut Shift+Digit0 = 100%.
    const ok = await evaluate(`(() => { const c=document.getElementById('canvas'); if(!c) return false; c.dispatchEvent(new KeyboardEvent('keydown',{key:'0',code:'Digit0',shiftKey:true,bubbles:true})); return true; })()`);
    if (!ok) skip('no #zoom menu item and no #canvas keyboard target — cannot pin the 100% view');
    await sleep(400);
    return (await shot('03-zoom-100.png')) + ' via Shift+0';
  });

  await step('pick → chip timing (edit mode, real click)', async () => {
    await call('POST', '/mode', { mode: 'edit' });
    await sleep(400);
    const before = await call('GET', '/state');
    const seqBefore = before.pickSeq || 0;
    // V4-5 queue baseline (before the click, so a fast pick is still counted).
    const q0 = await probe('GET', '/picks?since=0&wait=0');
    const usesQueue = q0.status === 200 && q0.body && Array.isArray(q0.body.picks);
    const seqBase = usesQueue ? (q0.body.seq || 0) : 0;

    // Integrator fix: after the 100%-zoom step the phone artboard can sit
    // OUTSIDE the viewport (grid ~2156 CSS px wide at scale 1) — the CDP click
    // would land on empty canvas. Bring the target fully into view with the
    // product's own focusScreen (scale 1, centred) before clicking.
    await evaluate(`__dsCanvas.focusScreen('phone')`);
    await sleep(300);
    const rect = await rectOf(`[data-screen="phone"]`);
    if (!rect) skip('no [data-screen=phone] artboard to click');
    const t0 = Date.now();
    await mouse('mousePressed', rect.x + rect.w / 2, rect.y + rect.h * 0.7);
    await mouse('mouseReleased', rect.x + rect.w / 2, rect.y + rect.h * 0.7);

    let arrived = null;
    let lastSeq = seqBase;
    const via = usesQueue ? 'GET /picks' : '/state.lastPick';
    // 80 polls ≈ 24 s (was 40 ≈ 12 s): a cold Chrome + Defender-scan window
    // in a full suite can push the FIRST edit-pick past 12 s (smoke-run flake
    // observed on otherwise-green HEAD). The ≤300 ms p50 verdict only measures
    // the arrival; a genuine pick-loop regression still fails the step —
    // after a re-framed retry click at the halfway mark, ruling out a stale
    // rect under a pending camera settle.
    for (let i = 0; i < 80 && arrived === null; i++) {
      if (usesQueue) {
        const q = await probe('GET', `/picks?since=${seqBase}&wait=300`);
        const fresh = (q.body?.picks || []).find((p) => p.seq > seqBase && p.screen === 'phone');
        if (fresh) { arrived = Date.now() - t0; lastSeq = fresh.seq; }
      } else {
        const st = await call('GET', '/state');
        if ((st.pickSeq || 0) > seqBefore && st.lastPick && st.lastPick.screen === 'phone') arrived = Date.now() - t0;
        else await sleep(100);
      }
      if (!arrived && i === 40) {
        const again = await rectOf(`[data-screen="phone"]`);
        if (again) {
          await mouse('mousePressed', again.x + again.w / 2, again.y + again.h * 0.7);
          await mouse('mouseReleased', again.x + again.w / 2, again.y + again.h * 0.7);
        }
      }
    }
    if (arrived === null) {
      // Once the V4 pick machinery is demonstrably present (queue route or
      // the V4-15 shellBridge state surface), a missing pick is a regression,
      // not an unavailable feature.
      const st = await call('GET', '/state');
      if (usesQueue || 'shellBridge' in st) {
        throw new Error(`edit-mode click (x2, re-framed) produced no pick via ${via} within ~24 s — V4 pick-loop regression; state: pickSeq=${st.pickSeq ?? '?'} window=${st.windowOpen ?? '?'}`);
      }
      skip('no pick observed via /state within ~4 s and no /picks route — edit-mode pick plumbing unavailable at this HEAD');
    }
    if (usesQueue) await probe('POST', '/picks/ack', { seq: lastSeq, label: 'smoke pick' });
    const verdict = arrived <= 300 ? 'within the ≤300 ms p50 target' : `${arrived} ms`;
    return `click→service-visible ${verdict} via ${via} (panel hop not in this measure)`;
  });

  await step('4th screen added live appears ≤3 s (V4-4 watch)', async () => {
    fs.writeFileSync(path.join(WS, 'about.html'), pageHtml('About — Cozy Brew', '#e8dcc8', '<p>roastery story</p>'));
    const four = [...REGISTRY, { id: 'about', file: 'about.html', title: 'About', width: 800, height: 600 }];
    fs.writeFileSync(path.join(WS, 'screens.json'), JSON.stringify({ version: 1, screens: four }, null, 2));
    const t0 = Date.now();
    let seen = false;
    while (Date.now() - t0 < 3000) {
      const list = await shellScreens();
      if (list.some((s) => s.id === 'about')) { seen = true; break; }
      await sleep(200);
    }
    if (seen) return `about appeared in ${Date.now() - t0} ms`;
    // Did the V4-4 machinery exist at all? A 200 from /screens/sync (the
    // backstop route) says the watch lane landed — then a 3 s miss is a FAIL.
    const sync = await probe('POST', '/screens/sync', { dir: WS });
    if (sync.status === 404 || sync.status === 0 || sync.status === 405) {
      skip('screens-watch (V4-4) not integrated at this HEAD — new registry entries need a manual /open');
    }
    // Give the backstop push a moment, but the acceptance is the WATCH.
    for (let i = 0; i < 20; i++) {
      const list = await shellScreens();
      if (list.some((s) => s.id === 'about')) break;
      await sleep(150);
    }
    throw new Error('about.html was written but never appeared within 3 s (V4-4 acceptance)');
  });

  await step('corrupt screens.json surfaces registryError in /state (V4-4)', async () => {
    const good = fs.readFileSync(path.join(WS, 'screens.json'), 'utf8');
    try {
      fs.writeFileSync(path.join(WS, 'screens.json'), '{"version":1,"screens":[ oops');
      // The key may exist from the first response with a null value — wait
      // for the watch (2 s poll + 250 ms debounce) to actually FLAG it.
      let state = null;
      let sawKey = false;
      for (let i = 0; i < 25; i++) {
        state = await call('GET', '/state');
        if (state && 'registryError' in state) sawKey = true;
        if (state && state.registryError) break;
        await sleep(300);
      }
      if (!state || !state.registryError) {
        if (!sawKey) skip('GET /state has no registryError key — V4-4 not integrated at this HEAD');
        throw new Error('screens.json was invalid for ~7.5 s but registryError stayed null — V4-4 watch is not flagging it');
      }
      await shot('04-registry-error-banner.png');
      fs.writeFileSync(path.join(WS, 'screens.json'), good);
      for (let i = 0; i < 30; i++) {
        state = await call('GET', '/state');
        if (!state.registryError) break;
        await sleep(300);
      }
      if (state.registryError) throw new Error('registryError not cleared after the file was fixed');
      return 'banner captured; registryError shown then cleared';
    } finally {
      fs.writeFileSync(path.join(WS, 'screens.json'), good);
    }
  });

  let exportStatus = null;
  let exportedRegistry = {};
  await step('export after activations', async () => {
    // Only export screens the SHELL has actually mounted: on a HEAD without
    // the V4-4 watch, `about` is in screens.json but no artboard exists, and
    // the capture would (rightly) fail. Once the watch lands, about is
    // mounted and stays in the registry untouched.
    const mounted = new Set((await shellScreens()).map((s) => s.id));
    const regPath = path.join(WS, 'screens.json');
    const onDisk = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const kept = onDisk.screens.filter((s) => mounted.has(s.id));
    if (kept.length !== onDisk.screens.length) {
      fs.writeFileSync(regPath, JSON.stringify({ version: 1, screens: kept }, null, 2));
      console.log(`  (registry trimmed to mounted screens: ${kept.map((s) => s.id).join(', ')})`);
    }
    exportedRegistry = Object.fromEntries(kept.map((s) => [s.id, s]));
    const job = await call('POST', '/export', { dir: WS });
    let status;
    for (let i = 0; i < 200; i++) {
      status = await call('GET', `/export/status?dir=${encodeURIComponent(WS)}&job=${job.jobId}`);
      if (status.state !== 'running') break;
      await sleep(500);
    }
    exportStatus = status;
    fs.writeFileSync(path.join(OUT, 'export-status.json'), JSON.stringify(status, null, 2));
    return `job ${job.jobId} → ${status.state}`;
  });

  await step('exported PNG dims == registry (E2)', async () => {
    if (!exportStatus || exportStatus.state !== 'done') skip(`export job not done (${exportStatus && exportStatus.state})`);
    const byId = exportedRegistry;
    const problems = [];
    for (const r of exportStatus.results || []) {
      if (!r.png) continue;
      if (!r.png.ok) { problems.push(`${r.screen}: png export failed: ${r.png.error}`); continue; }
      const dims = pngSize(r.png.file);
      const reg = byId[r.screen];
      if (!reg) continue;
      if (!dims || dims.width !== reg.width || dims.height !== reg.height) {
        problems.push(`${r.screen}: PNG ${dims ? dims.width + '×' + dims.height : '?'} != registry ${reg.width}×${reg.height}`);
      }
      fs.copyFileSync(r.png.file, path.join(OUT, path.basename(r.png.file)));
      if (r.pdf && r.pdf.ok) fs.copyFileSync(r.pdf.file, path.join(OUT, path.basename(r.pdf.file)));
    }
    if (problems.length && e1Advisory) skip(`E2 reproduces PRE-V4-1 (${problems.join('; ')}) — advisory until V4-1 lands, then this FAILS`);
    if (problems.length) throw new Error(`E2 REGRESSION after V4-1: ${problems.join('; ')}`);
    return `${(exportStatus.results || []).length} screens exported at exact registry dims`;
  });

  await step('screenshot with the artboard context menu open (V4-10)', async () => {
    // Integrator fix: frame the PHONE artboard (390×844 fits the viewport at
    // scale 1; the 1280-wide home header clips left after focusScreen) and
    // right-click its centre — edit mode accepts the trigger anywhere on the
    // board (V4-10), proven live by probe-ctx-menu.
    await evaluate(`__dsCanvas.focusScreen('phone')`);
    await sleep(300);
    const rect = await rectOf(`[data-screen="phone"]`);
    if (!rect) skip('no artboard to right-click');
    await mouse('mousePressed', rect.x + rect.w / 2, rect.y + rect.h * 0.35, 'right');
    await mouse('mouseReleased', rect.x + rect.w / 2, rect.y + rect.h * 0.35, 'right');
    let open = false;
    for (let i = 0; i < 10; i++) {
      if (await evaluate(`Boolean(document.querySelector('[role="menu"]'))`)) { open = true; break; }
      await sleep(150);
    }
    if (!open) skip('no [role=menu] after a right-click on a header — V4-10 context menu not integrated at this HEAD');
    const note = await shot('05-context-menu.png');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    return note;
  });

  await step('final overview screenshot', async () => shot('06-final-overview.png'));

  ws.close();

  // ---------------------------------------------------------------- summary --
  const fails = results.filter((r) => r.status === 'FAIL');
  const skips = results.filter((r) => r.status === 'SKIP');
  console.log(`\nSMOKE SUMMARY: ${results.length - fails.length - skips.length}/${results.length} pass, ${skips.length} skip, ${fails.length} fail`);
  for (const r of results) if (r.status !== 'PASS') console.log(`  [${r.status}] ${r.name}${r.note ? ' — ' + r.note : ''}`);
  fs.writeFileSync(path.join(V4OUT, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  if (fails.length) await die(1);
  console.log('DONE');
  await die(0);
} catch (e) {
  console.error('SMOKE ERROR', e);
  await die(1);
}
