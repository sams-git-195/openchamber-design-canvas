// scratch harness for the design review probes (NOT part of the repo)
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO = process.env.DC_REPO || 'C:/Users/samhe/Documents/github/openchamber-design-canvas';
export const SHOTS = path.join(os.tmpdir(), 'dc-reverify', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
export { sleep, fs, path, os };

export function makeEnv(PORT) {
  const TOKEN = crypto.randomBytes(12).toString('hex');
  const hdr = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  const call = async (m, p, b) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: hdr, body: b ? JSON.stringify(b) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${t.slice(0, 300)}`);
    return j;
  };
  const svc = spawn(process.execPath, ['service/main.ts'], {
    env: { ...process.env, OPENCHAMBER_SERVICE_PORT: String(PORT), OPENCHAMBER_SERVICE_TOKEN: TOKEN, DS_CHROME_PATH: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO, windowsHide: true,
  });
  svc.stderr.on('data', (d) => process.stderr.write(`[svc] ${d}`)); svc.stdout.on('data', (d) => process.stderr.write(`[svc-out] ${d}`));
  const ready = (async () => {
    for (let i = 0; i < 100; i++) {
      if (svc.exitCode !== null) throw new Error('service exited early');
      if (await fetch(`http://127.0.0.1:${PORT}/health`, { headers: hdr }).then((r) => r.status === 200).catch(() => false)) return;
      await sleep(200);
    }
  })();
  const die = async (code = 0) => { try { await call('POST', '/close'); } catch {} svc.kill(); process.exit(code); };
  return { PORT, TOKEN, call, svc, ready, die };
}

export const pageHtml = (title, bg, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="styles.css"></head><body style="background:${bg}"><main style="padding:32px"><h1>${title}</h1><button id="b" style="padding:12px 24px">Press</button>${extra}</main></body></html>`;

export async function attachShell(exclude = new Set()) {
  const profileDirs = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('ds-chrome-') && !exclude.has(d)).map((d) => [d, fs.statSync(path.join(os.tmpdir(), d)).mtimeMs]).sort((a, b) => b[1] - a[1]);
  let ws = null;
  const deadline = Date.now() + 20000;
  while (!ws && Date.now() < deadline) {
    for (const [dir] of profileDirs) {
      let lines;
      try { lines = fs.readFileSync(path.join(os.tmpdir(), dir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/); } catch { continue; }
      let shellTarget = null;
      try {
        const targets = await (await fetch(`http://127.0.0.1:${lines[0]}/json`)).json();
        shellTarget = targets.find((t) => t.type === 'page' && t.url.includes('/canvas/'));
      } catch { continue; }
      if (!shellTarget) continue;
      try {
        const c = new WebSocket(shellTarget.webSocketDebuggerUrl);
        await new Promise((res, rej) => { c.onopen = res; c.onerror = rej; setTimeout(() => rej(new Error('t')), 5000); });
        ws = c; break;
      } catch { continue; }
    }
    if (!ws) await sleep(500);
  }
  if (!ws) throw new Error('no CDP shell');
  let id = 0; const pending = new Map(); const listeners = new Set();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else for (const l of listeners) l(m);
  });
  const cdp = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression, extra = {}) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...extra });
    if (r.exceptionDetails) throw new Error('evaluate: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const mouse = (type, x, y, button = 'left') => cdp('Input.dispatchMouseEvent', { type, x, y, button, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const click = async (x, y, button = 'left') => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, button); await mouse('mouseReleased', x, y, button); };
  const rectOf = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const shot = async (name, clip) => {
    const s = await cdp('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    const f = path.join(SHOTS, name); fs.writeFileSync(f, Buffer.from(s.data, 'base64')); return f;
  };
  return { ws, cdp, evaluate, mouse, click, rectOf, shot, listeners };
}

// Evaluate inside the screen frames (execution contexts whose origin is the dev-server port)
export async function frameContexts(h, devPort) {
  const ctxs = [];
  const on = (m) => { if (m.method === 'Runtime.executionContextCreated') { const d = m.params.context; if (String(d.origin || '').includes(':' + devPort)) ctxs.push(d); } };
  h.listeners.add(on);
  await h.cdp('Runtime.disable').catch(() => {});
  await h.cdp('Runtime.enable');
  for (let i = 0; i < 25 && ctxs.length === 0; i++) await sleep(200);
  await sleep(300);
  return { ctxs, stop: () => h.listeners.delete(on) };
}
export async function evalInFrames(h, ctxs, expr) {
  const out = [];
  for (const c of ctxs) {
    try {
      const r = await h.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, contextId: c.id });
      out.push({ ctx: c.id, value: r.result?.value });
    } catch (e) { out.push({ ctx: c.id, error: String(e.message) }); }
  }
  return out;
}
