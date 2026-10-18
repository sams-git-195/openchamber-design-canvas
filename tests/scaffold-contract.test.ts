// F1 contract pin: the PANEL's real request shapes against the REAL service
// route handler. Every panel test stubs `host.serviceRequest`, and every
// service test hand-writes its own query — so the two drifted apart unseen:
// the panel polled `/scaffold/status?job=` while the route required `dir`
// too (400), which killed `/canvas` and Start on first use. Here the panel's
// own `scaffoldProject` / `getScaffoldStatus` / `runScaffoldJob` talk to a
// spawned `service/main.ts` through a fetch adapter standing in for the host
// bridge, so a shape mismatch on either side fails this file. No Chrome: the
// only routes touched are /health, /workspaces, /scaffold and /scaffold/status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

(globalThis as { window?: unknown }).window = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  parent: { postMessage: () => undefined },
};
(globalThis as { document?: unknown }).document = {
  getElementById: () => ({ append: () => undefined }),
  documentElement: {},
};

const api = await import('../panel/api.ts');
const main = await import('../panel/main.ts');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'scaffold-contract-token';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Probe-bind candidate ports (Windows excluded ranges answer EACCES at bind — see service.test.ts). */
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
  throw new Error('scaffold-contract service did not become healthy');
}

type ServiceRequest = { method: string; path: string; query?: Record<string, string>; body?: string };

/**
 * The host bridge, faithfully: method + path + query + body → the service's
 * HTTP status and body text. One test-only liberty: `/scaffold` bodies get
 * `install:false, boot:false` (the route's own hermetic seam) so the job
 * settles without a real npm install — the QUERY/BODY SHAPES under test are
 * the panel's own and pass through untouched.
 */
function bridgeTo(port: number): ServiceRequest[] {
  const seen: ServiceRequest[] = [];
  (api.host as unknown as { serviceRequest: (r: ServiceRequest) => Promise<{ status: number; body: string }> }).serviceRequest = async (request) => {
    seen.push(request);
    const url = new URL(`http://127.0.0.1:${port}${request.path}`);
    for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, value);
    let body = request.body;
    if (request.path === '/scaffold' && body) body = JSON.stringify({ ...JSON.parse(body), install: false, boot: false });
    const res = await fetch(url, {
      method: request.method,
      headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body,
    });
    return { status: res.status, body: await res.text() };
  };
  return seen;
}

test('F1: the panel scaffold → status round trip is accepted by the REAL service route (200, never 400)', async () => {
  const port = await pickFreePort(45000, 1500);
  const wsRoot = await mkdtemp(path.join(tmpdir(), 'scaffold-contract-'));
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.ts')], {
    env: { ...process.env, DS_WORKSPACE_ROOT: wsRoot, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  (api.host as unknown as { toast: (t: unknown) => Promise<void> }).toast = async () => undefined;
  try {
    await waitForHealth(port, child);
    const seen = bridgeTo(port);

    // The panel's own discovery + POST shapes (decision 3: the root is the service's).
    const listed = await api.getWorkspaces();
    const dir = api.joinWorkspaceDir(listed.root, 'contract-ws');
    const started = await api.scaffoldProject(dir, { type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', brief: 'contract' });
    assert.equal(started.ok, true, `the async scaffold answers ok (${started.ok ? '' : started.error})`);
    if (!started.ok) return;

    // The exact query the panel sends — straight into the real route handler.
    const status = await api.getScaffoldStatus(started.jobId, started.dir || dir);
    assert.ok(['installing', 'booting', 'done'].includes(status.state), `a real job state, not 400/unknown (got ${JSON.stringify(status)})`);
    const poll = seen.find((request) => request.path === '/scaffold/status')!;
    assert.deepEqual(Object.keys(poll.query ?? {}).sort(), ['dir', 'job'], 'the panel names job AND dir');

    // …and the panel's whole poll loop settles against it.
    assert.equal(await main.runScaffoldJob(started.jobId, started.dir || dir, { pollMs: 50, maxMs: 20_000 }), 'done');

    // The pre-fix shape, pinned as the break it was: `job` alone is a 400.
    const jobOnly = await fetch(`http://127.0.0.1:${port}/scaffold/status?job=${encodeURIComponent(started.jobId)}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(jobOnly.status, 400, 'the service still requires dir — the panel must keep sending it');
  } finally {
    child.kill('SIGKILL');
    await rm(wsRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('F1: an unknown job (service restart) settles the panel poll as a failure instead of spinning for 15 minutes', async () => {
  const port = await pickFreePort(45000, 1500);
  const wsRoot = await mkdtemp(path.join(tmpdir(), 'scaffold-contract-'));
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.ts')], {
    env: { ...process.env, DS_WORKSPACE_ROOT: wsRoot, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  const toasts: Array<{ kind: string; message: string }> = [];
  (api.host as unknown as { toast: (t: { kind: string; message: string }) => Promise<void> }).toast = async (toast) => { toasts.push(toast); };
  try {
    await waitForHealth(port, child);
    bridgeTo(port);
    const outcome = await main.runScaffoldJob('scaffold-999', path.join(wsRoot, 'never-made'), { pollMs: 50, maxMs: 5_000 });
    assert.notEqual(outcome, 'done');
    assert.match(typeof outcome === 'object' ? outcome.error : '', /status is unavailable \(unknown scaffold job\)/);
    assert.ok(toasts.some((toast) => toast.kind === 'error'), 'the user is told');
  } finally {
    child.kill('SIGKILL');
    await rm(wsRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});
