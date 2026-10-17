// docs/smoke/run-smoke.mjs — end-to-end Design Canvas smoke against the REAL service.
// Spawns service/main.ts with host-style env, scaffolds a workspace, adds a 2nd screen,
// opens the real Chrome canvas, waits ready, exports PNG+PDF per screen, and screenshots
// the full shell (artboard grid + headers + toolbar) via DevToolsActivePort.
// Run from repo root: node docs/smoke/run-smoke.mjs   (needs Chrome; DS_CHROME_PATH optional)
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 56987, TOKEN = crypto.randomBytes(12).toString('hex');
const OUT = path.join(import.meta.dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const WS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ds-smoke-')), 'cozy-brew');
fs.mkdirSync(WS, { recursive: true });
const hdr = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const call = async (m, p, b) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: hdr, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${t.slice(0, 300)}`);
  return j;
};

const svc = spawn(process.execPath, ['service/main.ts'], {
  env: { ...process.env, OPENCHAMBER_SERVICE_PORT: String(PORT), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
  stdio: ['ignore', 'pipe', 'pipe'], cwd: path.join(import.meta.dirname, '..', '..'), windowsHide: true,
});
svc.stderr.on('data', (d) => process.stderr.write(`[svc] ${d}`));
const die = async (code) => { try { await call('POST', '/close'); } catch {} svc.kill(); process.exit(code); };

try {
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${PORT}/health`, { headers: hdr }).then(() => true).catch(() => false)); i++) await sleep(200);
  console.log('service up');

  console.log('scaffolding (npm install can take a minute)...');
  const sc = await call('POST', '/scaffold', { dir: WS, type: 'hi-fi', brief: 'Cozy Brew — a warm neighbourhood coffee shop landing page', designSystemId: 'warm-editorial' });
  if (!sc.ok) throw new Error('scaffold: ' + JSON.stringify(sc));
  console.log('scaffolded at', sc.url);

  const screens = (await call('GET', `/screens?dir=${encodeURIComponent(WS)}`)).screens;
  const home = screens.find((s) => s.id === 'home');
  fs.writeFileSync(path.join(WS, 'checkout.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Checkout — Cozy Brew</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="styles.css"></head><body><main class="content" style="padding:48px;font-family:var(--font-sans,system-ui)"><h1 style="color:var(--color-heading,#3a2b20)">Checkout</h1><p style="color:var(--color-text,#5b4636)">One flat white · oat milk · £3.60</p><button style="background:var(--color-primary,#b0552f);color:#fff;border:0;border-radius:8px;padding:12px 24px;font-size:16px">Pay now</button></main></body></html>`);
  const put = await call('PUT', `/screens?dir=${encodeURIComponent(WS)}`, { version: 1, screens: [{ ...home }, { id: 'checkout', file: 'checkout.html', title: 'Checkout', width: 390, height: 844 }] });
  console.log('screens.json ->', JSON.stringify(put));

  const opened = await call('POST', '/open', { dir: WS });
  console.log('opened:', opened.ok, '| screens:', (opened.screens || []).map((s) => `${s.id}:${s.state}`).join(', '));

  let state = null;
  for (let i = 0; i < 150; i++) {
    state = await call('GET', '/state');
    const ready = (state.screens || []).filter((s) => s.state === 'ready').length;
    if (ready === 2 && state.windowOpen) break;
    await sleep(400);
  }
  fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state, null, 2));
  console.log('state: mode', state.mode, 'applied', state.modeApplied, 'active', state.activeScreen, 'screens', state.screens.map((s) => `${s.id}:${s.state}`).join(', '));

  // full-shell screenshot via DevTools port (canvas view with headers/toolbar/grid)
  const profiles = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('ds-chrome-')).map((d) => [d, fs.statSync(path.join(os.tmpdir(), d)).mtimeMs]).sort((a, b) => b[1] - a[1]);
  const portFile = path.join(os.tmpdir(), profiles[0][0], 'DevToolsActivePort');
  const lines = fs.readFileSync(portFile, 'utf8').split(/\r?\n/);
  const targets = await (await fetch(`http://127.0.0.1:${lines[0]}/json`)).json();
  const shell = targets.find((t) => t.type === 'page' && t.url.includes('/canvas/'));
  const ws = new WebSocket(shell.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const shot = await new Promise((res) => {
    ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', captureBeyondViewport: true } }));
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) res(m.result); });
  });
  fs.writeFileSync(path.join(OUT, 'canvas-overview.png'), Buffer.from(shot.data, 'base64'));
  ws.close();
  console.log('wrote canvas-overview.png');

  const job = await call('POST', '/export', { dir: WS });
  console.log('export job', job.jobId);
  let status;
  for (let i = 0; i < 200; i++) { status = await call('GET', `/export/status?dir=${encodeURIComponent(WS)}&job=${job.jobId}`); if (status.state !== 'running') break; await sleep(500); }
  fs.writeFileSync(path.join(OUT, 'export-status.json'), JSON.stringify(status, null, 2));
  for (const r of status.results || []) for (const kind of ['png', 'pdf']) {
    const res = r[kind]; if (res?.ok) { fs.copyFileSync(res.file, path.join(OUT, path.basename(res.file))); console.log('exported', kind, r.screen, '->', res.file); }
    else if (res) console.log('FAILED', kind, r.screen, res.error);
  }
  console.log('DONE'); await die(0);
} catch (e) { console.error('SMOKE ERROR', e); await die(1); }
