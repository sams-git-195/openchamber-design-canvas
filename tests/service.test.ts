import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  normalizeScreens,
  readScreens,
  resolveScreenFile,
  screenUrl,
  writeScreens,
  ScreensError,
  type ScreensRegistry,
} from '../service/screens.ts';
import {
  candidateWorkspaceRoots,
  isInsideOrEqual,
  resolveWorkspaceRoot,
  WORKSPACE_FOLDER,
} from '../service/workspace-root.ts';
import { getLastWorkspace, setLastWorkspace, updateLastWorkspaceMode } from '../service/last-workspace.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'test-token-123';

/** Reserve then release an ephemeral port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Pick a port in [min, min+span) that the OS will actually let us BIND.
 * Blind random draws hit Windows' excluded port ranges (netsh shows blocks
 * like 55978–56477 covering most of the 56000 band) and the service dies
 * with EACCES before health — an environment flake the suite must not carry.
 * Probes stride 37 apart so a ~100-port exclusion block clears within a few
 * candidates; the final TOCTOU window (close→child bind) is milliseconds.
 */
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

async function waitForHealth(port: number, child: ChildProcess, stderr: () => string = () => ''): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`service exited early: ${child.exitCode}${stderr() ? `\nchild stderr:\n${stderr().slice(0, 2000)}` : ''}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('service did not become healthy');
}

test('service requires the bearer token and reports live-window state', async () => {
  const port = await pickFreePort(43000, 2000);
  const project = await mkdtemp(path.join(tmpdir(), 'ds-service-'));
  await mkdir(path.join(project, 'design'), { recursive: true });
  await writeFile(
    path.join(project, 'design', 'index.html'),
    '<!doctype html><html><head><style>body{color:#123}</style></head><body><h1 class="t">Hi</h1></body></html>',
  );

  const child = spawn(process.execPath, [path.join(root, 'service', 'main.js')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: 'ignore',
  });

  try {
    await waitForHealth(port, child);

    // Every route, including /state, needs the bearer token.
    const noAuth = await fetch(`http://127.0.0.1:${port}/state`);
    assert.equal(noAuth.status, 401);

    // /state before the first /open: no window, empty page.
    const stateRes = await fetch(`http://127.0.0.1:${port}/state`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(stateRes.status, 200);
    const state = (await stateRes.json()) as {
      url: string;
      title: string;
      lastPick: unknown;
      pickSeq: number;
      windowOpen: boolean;
      bridgeActive?: boolean;
    };
    assert.deepEqual(state, {
      url: '',
      title: '',
      lastPick: null,
      pickSeq: 0,
      windowOpen: false,
      bridgeActive: false,
    });

    const stat = await fetch(
      `http://127.0.0.1:${port}/stat?dir=${encodeURIComponent(project)}&path=${encodeURIComponent('design/index.html')}`,
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    assert.equal(stat.status, 200);
    assert.equal(typeof ((await stat.json()) as { mtime: number }).mtime, 'number');

    // /close requires the bearer token; with no window open it is a no-op that
    // still answers ok:true (the panel's Design Mode toggle OFF path).
    const closeNoAuth = await fetch(`http://127.0.0.1:${port}/close`, { method: 'POST' });
    assert.equal(closeNoAuth.status, 401, '/close needs the bearer token');
    const closeRes = await fetch(`http://127.0.0.1:${port}/close`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(closeRes.status, 200);
    assert.deepEqual(await closeRes.json(), { ok: true });

    // /focus requires the bearer token and answers ok:true with no window open
    // (the service has no browser instance here).
    const focusNoAuth = await fetch(`http://127.0.0.1:${port}/focus`, { method: 'POST' });
    assert.equal(focusNoAuth.status, 401, '/focus needs the bearer token');
    const focusRes = await fetch(`http://127.0.0.1:${port}/focus`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(focusRes.status, 200);
    assert.deepEqual(await focusRes.json(), { ok: true });

    // /highlight requires the bearer token. With no window open it answers
    // ok:false with an error (never a crash), for any selector.
    const highlightNoAuth = await fetch(`http://127.0.0.1:${port}/highlight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selector: '#x' }),
    });
    assert.equal(highlightNoAuth.status, 401, '/highlight needs the bearer token');
    const highlightRes = await fetch(`http://127.0.0.1:${port}/highlight`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ selector: '#x' }),
    });
    assert.equal(highlightRes.status, 200);
    const highlightBody = (await highlightRes.json()) as { ok: boolean; error?: string };
    assert.equal(highlightBody.ok, false, 'no window: highlight answers ok:false');
    assert.equal(typeof highlightBody.error, 'string', 'a failed highlight carries an error message');

    // A missing/empty selector is a validation error.
    const highlightEmpty = await fetch(`http://127.0.0.1:${port}/highlight`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ selector: '' }),
    });
    assert.equal(highlightEmpty.status, 400, 'an empty selector is rejected');
  } finally {
    child.kill('SIGKILL');
  }
});

test('/open answers ok:false for an unreachable loopback url without opening a window', async () => {
  const port = await pickFreePort(46000, 1500);
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.js')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: 'ignore',
  });

  try {
    await waitForHealth(port, child);

    const deadPort = await freePort();
    const res = await fetch(`http://127.0.0.1:${port}/open`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: `http://127.0.0.1:${deadPort}/` }),
    });
    assert.equal(res.status, 200, 'a refused open is a 200 with ok:false');
    const body = (await res.json()) as { ok: boolean; error?: string };
    assert.equal(body.ok, false, 'no window opens on a dead page');
    assert.match(body.error ?? '', /not running/);
  } finally {
    child.kill('SIGKILL');
  }
});

// OFF must always end with no lingering window: /close reaps any orphan Chrome
// process carrying a `ds-chrome-` temp profile, even one this service instance
// never tracked (e.g. launched by a previous service that then restarted).
test('/close kills an orphan ds-chrome- process the service does not track', { timeout: 30_000 }, async () => {
  const port = await pickFreePort(48000, 1500);
  const profile = await mkdtemp(path.join(tmpdir(), 'ds-chrome-test-'));
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.js')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  // A hermetic stand-in for a leftover Chrome: a live process whose command line
  // carries a ds-chrome- temp profile. The service never learned about it.
  const orphan = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${profile}`], {
    stdio: 'ignore',
  });

  try {
    await waitForHealth(port, child);
    const alive = (): boolean => orphan.exitCode === null && orphan.signalCode === null;
    assert.equal(alive(), true, 'the orphan is running before /close');

    const close = await fetch(`http://127.0.0.1:${port}/close`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(close.status, 200);
    assert.deepEqual(await close.json(), { ok: true });

    const killDeadline = Date.now() + 8_000;
    while (Date.now() < killDeadline && alive()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // A SIGKILL leaves exitCode null and sets signalCode; either proves it died.
    assert.equal(alive(), false, 'the orphan ds-chrome- process was killed by /close');

    let gone = false;
    const dirDeadline = Date.now() + 8_000;
    while (Date.now() < dirDeadline) {
      try {
        await stat(profile);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        gone = true;
        break;
      }
    }
    assert.equal(gone, true, 'the orphan ds-chrome- profile dir is removed');
  } finally {
    child.kill('SIGKILL');
    if (orphan.exitCode === null && orphan.signalCode === null) orphan.kill('SIGKILL');
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
});

// The scaffold route: bearer-authed, validates the body, and refuses a project
// that already exists. The hermetic cases here never reach npm install or a dev
// server (refusal and validation happen first), so this stays network-free.
test('POST /scaffold requires the bearer token, validates dir/type, and refuses an existing project', async () => {
  const port = await pickFreePort(52000, 1500);
  const existing = await mkdtemp(path.join(tmpdir(), 'ds-scaffold-existing-'));
  await writeFile(
    path.join(existing, '.design-studio.json'),
    JSON.stringify({ version: 1, name: 'taken', type: 'hi-fi' }),
    'utf8',
  );
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.js')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: 'ignore',
  });

  try {
    await waitForHealth(port, child);

    const noAuth = await fetch(`http://127.0.0.1:${port}/scaffold`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dir: existing, type: 'hi-fi' }),
    });
    assert.equal(noAuth.status, 401, '/scaffold needs the bearer token');

    const badDir = await fetch(`http://127.0.0.1:${port}/scaffold`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: 'relative/path', type: 'hi-fi' }),
    });
    assert.equal(badDir.status, 400, 'dir must be an absolute project path');

    const badType = await fetch(`http://127.0.0.1:${port}/scaffold`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: existing, type: '' }),
    });
    assert.equal(badType.status, 400, 'type must be a non-empty string');

    const taken = await fetch(`http://127.0.0.1:${port}/scaffold`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: existing, type: 'hi-fi' }),
    });
    assert.equal(taken.status, 200, 'a refused scaffold is a 200 with ok:false');
    const body = (await taken.json()) as { ok: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.match(body.error ?? '', /already exists/);
  } finally {
    child.kill('SIGKILL');
    await rm(existing, { recursive: true, force: true }).catch(() => undefined);
  }
});

// Design Mode turning ON posts to /harness; the service drops the in-session
// OpenCode plugin into the project and answers the write result. Idempotent.
test('POST /harness writes the generated plugin and is idempotent', async () => {
  const port = await pickFreePort(50000, 1500);
  const project = await mkdtemp(path.join(tmpdir(), 'ds-harness-route-'));
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.js')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: 'ignore',
  });

  try {
    await waitForHealth(port, child);

    const noAuth = await fetch(`http://127.0.0.1:${port}/harness`, { method: 'POST' });
    assert.equal(noAuth.status, 401, '/harness needs the bearer token');

    const badDir = await fetch(`http://127.0.0.1:${port}/harness`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: 'relative/path' }),
    });
    assert.equal(badDir.status, 400, 'dir must be an absolute project path');

    const first = await fetch(`http://127.0.0.1:${port}/harness`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: project }),
    });
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { path: string; created: boolean; changed: boolean };
    assert.equal(firstBody.path, '.opencode/plugin/design-studio-harness.ts');
    assert.equal(firstBody.created, true);
    assert.equal(firstBody.changed, true);
    assert.match(await readFile(path.join(project, firstBody.path), 'utf8'), /design-studio harness — generated, do not edit/);

    const second = await fetch(`http://127.0.0.1:${port}/harness`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: project }),
    });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), {
      path: '.opencode/plugin/design-studio-harness.ts',
      created: false,
      updated: false,
      changed: false,
    });
  } finally {
    child.kill('SIGKILL');
    await rm(project, { recursive: true, force: true }).catch(() => undefined);
  }
});

// The files route: bearer-authed, listing a project's files so the panel can
// attach a FILE reference. Validation of dir/limit is a 400; the listing itself
// is a 200 with the sorted relative paths.
test('POST /files requires the bearer token, validates dir/limit, and lists files', async () => {
  const port = await pickFreePort(54000, 1500);
  const project = await mkdtemp(path.join(tmpdir(), 'ds-files-route-'));
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'app.ts'), 'export const x = 1;\n');
  await writeFile(path.join(project, 'readme.md'), '# hi\n');
  await mkdir(path.join(project, 'node_modules', 'dep'), { recursive: true });
  await writeFile(path.join(project, 'node_modules', 'dep', 'index.js'), '// dep\n');
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.js')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: 'ignore',
  });

  try {
    await waitForHealth(port, child);

    const noAuth = await fetch(`http://127.0.0.1:${port}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dir: project }),
    });
    assert.equal(noAuth.status, 401, '/files needs the bearer token');

    const badDir = await fetch(`http://127.0.0.1:${port}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: 'relative/path' }),
    });
    assert.equal(badDir.status, 400, 'dir must be an absolute project path');

    const badLimit = await fetch(`http://127.0.0.1:${port}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: project, limit: 0 }),
    });
    assert.equal(badLimit.status, 400, 'limit must be a positive integer');

    const listed = await fetch(`http://127.0.0.1:${port}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: project }),
    });
    assert.equal(listed.status, 200);
    const body = (await listed.json()) as { ok: boolean; files: string[] };
    assert.equal(body.ok, true);
    assert.deepEqual(body.files, ['readme.md', 'src/app.ts']);
    assert.equal(body.files.some((file) => file.includes('node_modules')), false, 'node_modules is skipped');
  } finally {
    child.kill('SIGKILL');
    await rm(project, { recursive: true, force: true }).catch(() => undefined);
  }
});

// The server routes: bearer-authed, an absolute dir required. `POST /server/stop`
// for an unknown dir is a safe no-op (`stopped:false`), never a kill of a group
// the service did not record; `GET /server/status` reports a down server.
test('POST /server/stop requires the bearer token, validates dir, and no-ops an unknown dir', async () => {
  const port = await pickFreePort(56000, 1500);
  const unknown = await mkdtemp(path.join(tmpdir(), 'ds-server-stop-'));
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.js')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let childErr = '';
  child.stderr?.on('data', (d) => { childErr += String(d); });

  try {
    await waitForHealth(port, child, () => childErr);

    const noAuth = await fetch(`http://127.0.0.1:${port}/server/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dir: unknown }),
    });
    assert.equal(noAuth.status, 401, '/server/stop needs the bearer token');

    const badDir = await fetch(`http://127.0.0.1:${port}/server/stop`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: 'relative/path' }),
    });
    assert.equal(badDir.status, 400, 'dir must be an absolute project path');

    const stopped = await fetch(`http://127.0.0.1:${port}/server/stop`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: unknown }),
    });
    assert.equal(stopped.status, 200, 'a no-op stop is a 200');
    assert.deepEqual(await stopped.json(), { ok: true, stopped: false }, 'an unknown dir records nothing to stop');

    // /server/status: bearer-authed, absolute dir, down with no record.
    const statusNoAuth = await fetch(`http://127.0.0.1:${port}/server/status?dir=${encodeURIComponent(unknown)}`);
    assert.equal(statusNoAuth.status, 401, '/server/status needs the bearer token');
    const statusBadDir = await fetch(`http://127.0.0.1:${port}/server/status?dir=relative`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(statusBadDir.status, 400, 'dir must be absolute');
    const status = await fetch(`http://127.0.0.1:${port}/server/status?dir=${encodeURIComponent(unknown)}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { up: false, port: null }, 'an unknown dir reports down with no port');
  } finally {
    child.kill('SIGKILL');
    await rm(unknown, { recursive: true, force: true }).catch(() => undefined);
  }
});

// POST /server/start must treat the project's configured url as authoritative:
// the probe, the record and the recorded port all come from .design-studio.json,
// while the request url is validation-only. The test drives this with a request
// url whose port is held by a foreign ANSWERING server: if the route ever used
// the request url instead, that foreign answer would be reported as ours
// (ok:true, started:false) and the configured command would never be spawned —
// so started:true plus the config-port record here can only come from the
// config url.
test('POST /server/start uses the configured url, not the request url', { timeout: 60_000 }, async () => {
  const port = await pickFreePort(60000, 1500);
  const devPort = await freePort();
  const decoyPort = await freePort();
  const project = await mkdtemp(path.join(tmpdir(), 'ds-server-start-'));
  await writeFile(
    path.join(project, 'serve.cjs'),
    `require("http").createServer((q,s)=>s.end("ok")).listen(${devPort},"127.0.0.1")`,
    'utf8',
  );
  await writeFile(
    path.join(project, '.design-studio.json'),
    JSON.stringify({ version: 1, name: 'pinned', type: 'hi-fi', url: `http://127.0.0.1:${devPort}/`, command: `node serve.cjs` }),
    'utf8',
  );
  // A foreign process already answers on the request url's port: if the route
  // ever used the request url, this answerer would be reported as ours
  // (ok:true, started:false) instead of the config url's server being spawned.
  const decoyHolder = createServer((_q, res) => res.end('foreign'));
  await new Promise<void>((resolve, reject) => {
    decoyHolder.once('error', reject);
    decoyHolder.listen(decoyPort, '127.0.0.1', () => resolve());
  });
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.js')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: 'ignore',
  });

  try {
    await waitForHealth(port, child);

    const noAuth = await fetch(`http://127.0.0.1:${port}/server/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dir: project, url: `http://127.0.0.1:${decoyPort}/` }),
    });
    assert.equal(noAuth.status, 401, '/server/start needs the bearer token');

    const badDir = await fetch(`http://127.0.0.1:${port}/server/start`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: 'relative/path', url: `http://127.0.0.1:${decoyPort}/` }),
    });
    assert.equal(badDir.status, 400, 'dir must be an absolute project path');

    const start = await fetch(`http://127.0.0.1:${port}/server/start`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: project, url: `http://127.0.0.1:${decoyPort}/` }),
    });
    assert.equal(start.status, 200);
    const body = (await start.json()) as { ok: boolean; started: boolean; up: boolean; error?: string };
    assert.equal(body.ok, true, `the config url is authoritative; the request url (${decoyPort}) is foreign and must not be used: ${body.error ?? ''}`);
    assert.equal(body.started, true, 'the config url (not the request url) decides whether to spawn');
    assert.equal(body.up, true);

    // The record carries the config url's port, not the request url's port.
    const record = JSON.parse(await readFile(path.join(project, '.design-studio', 'server.json'), 'utf8')) as { port: number; pid: number };
    assert.equal(record.port, devPort, 'the recorded port is the config url port');
    assert.equal(record.port === decoyPort, false, 'the recorded port is never the request url port');

    // The pinned server answers on the config port; the request url's port is
    // still served by the foreign holder, never by the spawned server.
    assert.equal(await (await fetch(`http://127.0.0.1:${devPort}/`)).text(), 'ok', 'the pinned dev server is up');
    assert.equal(await (await fetch(`http://127.0.0.1:${decoyPort}/`)).text(), 'foreign', 'the request url port still belongs to the foreign holder');

    // Stopping through the route kills the pinned group and frees the port.
    const stop = await fetch(`http://127.0.0.1:${port}/server/stop`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: project }),
    });
    assert.equal(stop.status, 200);
    assert.deepEqual(await stop.json(), { ok: true, stopped: true }, 'the pinned server is stopped');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const rebound = await new Promise<boolean>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.listen(devPort, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    assert.equal(rebound, true, 'the config port was freed by the stop');
  } finally {
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => decoyHolder.close(() => resolve()));
    await rm(project, { recursive: true, force: true }).catch(() => undefined);
  }
});

// POST /server/start is the manual start path: when the configured port is
// answered by a process the service never started (and no verified record
// exists), the route must refuse with the port-in-use error instead of
// reporting ok:true/up:true for someone else's server.
test('POST /server/start refuses a foreign holder on the configured port', { timeout: 60_000 }, async () => {
  const port = await pickFreePort(62000, 1500);
  const devPort = await freePort();
  const project = await mkdtemp(path.join(tmpdir(), 'ds-server-foreign-'));
  await writeFile(
    path.join(project, 'serve.cjs'),
    `require("http").createServer((q,s)=>s.end("ok")).listen(${devPort},"127.0.0.1")`,
    'utf8',
  );
  await writeFile(
    path.join(project, '.design-studio.json'),
    JSON.stringify({ version: 1, name: 'pinned', type: 'hi-fi', url: `http://127.0.0.1:${devPort}/`, command: 'node serve.cjs' }),
    'utf8',
  );
  // A foreign process already ANSWERS on the configured port.
  const holder = createServer((_q, res) => res.end('foreign'));
  await new Promise<void>((resolve, reject) => {
    holder.once('error', reject);
    holder.listen(devPort, '127.0.0.1', () => resolve());
  });
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.js')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN },
    stdio: 'ignore',
  });

  try {
    await waitForHealth(port, child);

    const start = await fetch(`http://127.0.0.1:${port}/server/start`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dir: project, url: `http://127.0.0.1:${devPort}/` }),
    });
    assert.equal(start.status, 200);
    const body = (await start.json()) as { ok: boolean; started: boolean; up: boolean; error?: string };
    assert.equal(body.ok, false, 'a foreign answer on the configured port is not our running server');
    assert.equal(body.up, false);
    assert.equal(body.started, false);
    assert.match(body.error ?? '', /already in use/);
    assert.equal(await readFile(path.join(project, '.design-studio', 'server.json'), 'utf8').then(() => true, (e: NodeJS.ErrnoException) => e.code === 'ENOENT' ? false : Promise.reject(e)), false, 'no server record was written');
  } finally {
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => holder.close(() => resolve()));
    await rm(project, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// Design Canvas service layer — unit tests for the modules P1-screens owns.
// ---------------------------------------------------------------------------

test('normalizeScreens silently drops bad entries, dedupes ids and clamps sizes', () => {
  const base = tmpdir();
  const registry = normalizeScreens(
    {
      version: 2,
      screens: [
        { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
        { id: 'home', file: 'other.html', title: 'Duplicate', width: 300, height: 400 }, // dupe id → dropped
        { id: 'Bad ID!', file: 'x.html', title: 'X', width: 300, height: 400 }, // bad id → dropped
        { id: 'escape', file: '../evil.html', title: 'E', width: 300, height: 400 }, // escapes → dropped
        { id: 'nosize', file: 'a.html', title: 'A', width: 'wide', height: 400 }, // bad size → dropped
        'not-an-object', // dropped
        { id: 'smol', file: 's.html', title: 'S', width: 99, height: 99999 }, // clamped
      ],
    },
    base,
  );
  assert.deepEqual(registry, {
    version: 2,
    screens: [
      { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
      { id: 'smol', file: 's.html', title: 'S', width: 200, height: 8192 },
    ],
  });
});

test('normalizeScreens of unrecognizable input is the empty registry', () => {
  const base = tmpdir();
  for (const input of [null, undefined, 42, 'text', { nope: true }, { screens: 'x' }]) {
    assert.deepEqual(normalizeScreens(input, base), { version: 1, screens: [] });
  }
});

test('resolveScreenFile refuses escapes and absolutes on every OS', () => {
  const base = path.join(tmpdir(), 'ws');
  assert.equal(resolveScreenFile(base, '../evil.html'), null);
  assert.equal(resolveScreenFile(base, '..\\evil.html'), null, 'backslash escape');
  assert.equal(resolveScreenFile(base, 'C:\\x.html'), null, 'drive letter is absolute');
  assert.equal(resolveScreenFile(base, '/abs.html'), null);
  assert.equal(resolveScreenFile(base, 'a/../b.html'), null, 'dot-dot segment');
  assert.equal(resolveScreenFile(base, './x.html'), null, 'dot segment');
  assert.equal(resolveScreenFile(base, 'x.htm'), null, 'must end in .html');
  assert.equal(resolveScreenFile(base, 'x.css'), null);
  assert.equal(resolveScreenFile(base, ''), null);
  assert.equal(resolveScreenFile(base, { whatever: true }), null, 'non-string');
  assert.equal(resolveScreenFile(base, 'a/b.html'), 'a/b.html');
  assert.equal(resolveScreenFile(base, 'a\\b.html'), 'a/b.html', 'backslashes are separators');
  assert.equal(resolveScreenFile(base, 'X.HTML'), 'X.HTML', 'case-insensitive .html suffix');
  assert.equal(resolveScreenFile(base, 'h.html'), 'h.html');
});

test('writeScreens validates + normalizes + dedupes; readScreens round-trips', async () => {
  const ws = await mkdtemp(path.join(tmpdir(), 'ds-screens-unit-'));
  const { path: rel } = await writeScreens(ws, {
    version: 1,
    screens: [
      { id: 'checkout', file: 'checkout.html', title: 'Checkout', width: 99, height: 99999 },
      { id: 'pay', file: 'sub/pay.html', title: '', width: 300, height: 400 },
      { id: 'checkout', file: 'second.html', title: 'Duplicate', width: 300, height: 400 },
    ],
  });
  assert.equal(rel, 'screens.json');
  assert.deepEqual(await readScreens(ws), {
    version: 1,
    screens: [
      { id: 'checkout', file: 'checkout.html', title: 'Checkout', width: 200, height: 8192 },
      { id: 'pay', file: 'sub/pay.html', title: 'pay', width: 300, height: 400 },
    ],
  });
  assert.equal(JSON.parse(await readFile(path.join(ws, 'screens.json'), 'utf8') as string).screens[0].width, 200, 'clamps persist on disk');
});

test('missing or unreadable screens.json reads as the empty registry', async () => {
  const ws = await mkdtemp(path.join(tmpdir(), 'ds-screens-empty-'));
  assert.deepEqual(await readScreens(ws), { version: 1, screens: [] });
  await writeFile(path.join(ws, 'screens.json'), '{ not json', 'utf8');
  assert.deepEqual(await readScreens(ws), { version: 1, screens: [] }, 'invalid JSON reads empty');
});

test('writeScreens throws ScreensError for invalid registries (route → 400)', async () => {
  const ws = await mkdtemp(path.join(tmpdir(), 'ds-screens-bad-'));
  await assert.rejects(() => writeScreens(ws, 'nope'), ScreensError);
  await assert.rejects(() => writeScreens(ws, { version: 1, screens: 'x' }), ScreensError, 'screens must be an array');
  await assert.rejects(() => writeScreens(ws, { version: 'one', screens: [] }), ScreensError, 'version must be a number');
  await assert.rejects(() => writeScreens(ws, { screens: [{ id: 'Bad ID', file: 'x.html', width: 300, height: 400 }] }), ScreensError, 'id regex');
  await assert.rejects(() => writeScreens(ws, { screens: [{ id: 'a', file: '../../evil.html', width: 300, height: 400 }] }), ScreensError, 'file escapes');
  await assert.rejects(() => writeScreens(ws, { screens: [{ id: 'a', file: 'x.html', width: 'wide', height: 400 }] }), ScreensError, 'width type');
  await assert.rejects(() => writeScreens(ws, { screens: [{ id: 'a', file: 'x.html', width: 300, height: Infinity }] }), ScreensError, 'height finite');
});

test('screenUrl joins per decision 6 (strip trailing slashes, append file)', () => {
  assert.equal(screenUrl('http://localhost:5173/', 'home.html'), 'http://localhost:5173/home.html');
  assert.equal(screenUrl('http://localhost:5173//', 'home.html'), 'http://localhost:5173/home.html');
  assert.equal(screenUrl('http://localhost:5173', 'sub/a.html'), 'http://localhost:5173/sub/a.html');
});

// ---- workspace-root ----

test('candidateWorkspaceRoots: ONEDRIVE → USERPROFILE → homedir on win32, homedir elsewhere', () => {
  const win = candidateWorkspaceRoots({ ONEDRIVE: 'C:\\Users\\sam\\OneDrive', USERPROFILE: 'C:\\Users\\sam' }, 'win32', 'C:\\Users\\sam');
  assert.deepEqual(win, [
    path.resolve('C:\\Users\\sam\\OneDrive\\Documents', WORKSPACE_FOLDER),
    path.resolve('C:\\Users\\sam\\Documents', WORKSPACE_FOLDER),
  ]);
  assert.equal(candidateWorkspaceRoots({ USERPROFILE: 'C:\\Users\\sam' }, 'win32', 'C:\\Users\\sam').length, 1, 'homedir === USERPROFILE collapses');
  assert.deepEqual(candidateWorkspaceRoots({}, 'darwin', '/Users/sam'), [path.resolve('/Users/sam', 'Documents', WORKSPACE_FOLDER)]);
  assert.deepEqual(candidateWorkspaceRoots({}, 'linux', '/home/sam'), [path.resolve('/home/sam', 'Documents', WORKSPACE_FOLDER)]);
});

test('resolveWorkspaceRoot: DS_WORKSPACE_ROOT wins outright', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ds-wsroot-'));
  assert.equal(await resolveWorkspaceRoot({ DS_WORKSPACE_ROOT: dir }), path.resolve(dir));
  assert.equal(await resolveWorkspaceRoot({ DS_WORKSPACE_ROOT: `${dir}${path.sep}` }), path.resolve(dir), 'trailing separator resolved');
  const missing = path.join(dir, 'not-created-yet');
  assert.equal(await resolveWorkspaceRoot({ DS_WORKSPACE_ROOT: missing }), missing, 'override wins even when missing (scaffold creates it)');
});

test('resolveWorkspaceRoot probes "Documents" existence (win32 branch)', async () => {
  if (process.platform !== 'win32') return; // POSIX candidates are homedir-only (covered above)
  const one = await mkdtemp(path.join(tmpdir(), 'ds-od1-'));
  const two = await mkdtemp(path.join(tmpdir(), 'ds-od2-'));
  await mkdir(path.join(one, 'Documents'));
  await mkdir(path.join(two, 'Documents'));
  try {
    const picked = await resolveWorkspaceRoot({ ONEDRIVE: one, USERPROFILE: two });
    assert.equal(picked, path.resolve(one, 'Documents', WORKSPACE_FOLDER), 'first existing Documents wins');
    await rm(path.join(one, 'Documents'), { recursive: true });
    const second = await resolveWorkspaceRoot({ ONEDRIVE: one, USERPROFILE: two });
    assert.equal(second, path.resolve(two, 'Documents', WORKSPACE_FOLDER), 'when the first dies the next wins');
  } finally {
    await rm(one, { recursive: true, force: true }).catch(() => undefined);
    await rm(two, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('isInsideOrEqual is lexical and sibling-safe', () => {
  const base = path.join(tmpdir(), 'canvas-root');
  assert.equal(isInsideOrEqual(base, base), true);
  assert.equal(isInsideOrEqual(base, path.join(base, 'my-slug')), true);
  assert.equal(isInsideOrEqual(base, path.join(base, 'my-slug', 'deep')), true);
  assert.equal(isInsideOrEqual(base, `${base}-sibling`), false, 'a sibling sharing the prefix is NOT inside');
  assert.equal(isInsideOrEqual(base, tmpdir()), false);
});

test('lastWorkspace echo updates in memory', () => {
  setLastWorkspace({ dir: '/ws/demo', screens: [], mode: 'edit', activeScreen: null, view: null });
  assert.equal(getLastWorkspace()?.mode, 'edit');
  updateLastWorkspaceMode('play');
  assert.equal(getLastWorkspace()?.mode, 'play');
  setLastWorkspace(null);
  assert.equal(getLastWorkspace(), null);
});

// ---------------------------------------------------------------------------
// Design Canvas routes (spec §B). The compiled service/main.js is rebuilt by
// P2 — until then these spawn the TS entry directly; Node 24 type-strips the
// extension's .ts modules (all relative imports carry .ts extensions).
// ---------------------------------------------------------------------------

async function startServiceTs(extraEnv: Record<string, string>): Promise<{ port: number; child: ChildProcess }> {
  const port = await pickFreePort(64000, 1400); // above the other suites' bands, below 65536
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.ts')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN, ...extraEnv },
    stdio: 'ignore',
  });
  try {
    await waitForHealth(port, child);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  return { port, child };
}

test('GET/PUT /screens: 400 validation, silent read normalization, clamped write', { timeout: 60_000 }, async () => {
  const ws = await mkdtemp(path.join(tmpdir(), 'ds-screens-route-'));
  // V4-14 fixture (integrator): PUT /screens only acts on a marked design
  // workspace; this route-BEHAVIOR pin predates the marker, so the dir gains
  // one. The no-marker 400 direction is pinned in tests/v4-service.test.ts.
  await writeFile(path.join(ws, '.design-studio.json'), JSON.stringify({ version: 1 }));
  const { port, child } = await startServiceTs({});
  try {
    const bearer = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`http://127.0.0.1:${port}/screens`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 400, 'missing dir → 400');
    assert.equal((await fetch(`http://127.0.0.1:${port}/screens?dir=relative`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 400, 'relative dir → 400');
    assert.equal((await fetch(`http://127.0.0.1:${port}/screens?dir=${encodeURIComponent(ws)}`)).status, 401, 'bearer token required');

    // Missing screens.json reads as the empty registry.
    const empty = await (await fetch(`http://127.0.0.1:${port}/screens?dir=${encodeURIComponent(ws)}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    assert.deepEqual(empty, { version: 1, screens: [] });

    // Invalid PUT bodies → 400 with an actionable error.
    const badBodies = [
      'not json',
      JSON.stringify({ version: 1 }),
      JSON.stringify({ screens: 'nope' }),
      JSON.stringify({ version: 1, screens: [{ id: 'Bad ID', file: 'x.html', title: 'X', width: 300, height: 400 }] }),
      JSON.stringify({ version: 1, screens: [{ id: 'x', file: '../evil.html', title: 'X', width: 300, height: 400 }] }),
      JSON.stringify({ version: 1, screens: [{ id: 'x', file: 'x.html', title: 'X', width: 'wide', height: 400 }] }),
    ];
    for (const body of badBodies) {
      const res = await fetch(`http://127.0.0.1:${port}/screens?dir=${encodeURIComponent(ws)}`, { method: 'PUT', headers: bearer, body });
      assert.equal(res.status, 400, `body ${body.slice(0, 40)}… is refused`);
      assert.equal(typeof ((await res.json()) as { error?: string }).error, 'string');
    }

    // A valid PUT is clamped + deduped on write; GET reflects the written file.
    const put = await fetch(`http://127.0.0.1:${port}/screens?dir=${encodeURIComponent(ws)}`, {
      method: 'PUT',
      headers: bearer,
      body: JSON.stringify({
        version: 2,
        screens: [
          { id: 'checkout', file: 'checkout.html', title: 'Checkout', width: 99, height: 99999 },
          { id: 'checkout', file: 'dup.html', title: 'Duplicate', width: 300, height: 400 },
          { id: 'pay', file: 'sub/pay.html', title: '', width: 300, height: 400 },
        ],
      }),
    });
    assert.equal(put.status, 200);
    assert.deepEqual(await put.json(), { path: 'screens.json' });
    const got = await (await fetch(`http://127.0.0.1:${port}/screens?dir=${encodeURIComponent(ws)}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json() as ScreensRegistry;
    assert.deepEqual(got, {
      version: 2,
      screens: [
        { id: 'checkout', file: 'checkout.html', title: 'Checkout', width: 200, height: 8192 },
        { id: 'pay', file: 'sub/pay.html', title: 'pay', width: 300, height: 400 },
      ],
    });
  } finally {
    child.kill('SIGKILL');
    await rm(ws, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('GET /workspaces answers {root, workspaces} from the workspace root on disk', { timeout: 60_000 }, async () => {
  const wsRoot = await mkdtemp(path.join(tmpdir(), 'ds-wsroot-route-'));
  const alpha = path.join(wsRoot, 'alpha');
  const beta = path.join(wsRoot, 'beta');
  const gamma = path.join(wsRoot, 'gamma'); // no config → excluded
  await mkdir(alpha);
  await mkdir(beta);
  await mkdir(gamma);
  await writeFile(
    path.join(alpha, '.design-studio.json'),
    JSON.stringify({ version: 1, name: 'Alpha', url: 'http://localhost:5173/' }),
  );
  await writeFile(
    path.join(alpha, 'screens.json'),
    JSON.stringify({ version: 1, screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 }] }),
  );
  await writeFile(path.join(beta, '.design-studio.json'), JSON.stringify({ version: 1 })); // no name → basename, no url, no screens
  await writeFile(path.join(wsRoot, 'stray.txt'), 'not a workspace'); // files are skipped

  const { port, child } = await startServiceTs({ DS_WORKSPACE_ROOT: wsRoot });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspaces`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { root: string; workspaces: Array<Record<string, unknown>> };
    assert.equal(body.root, wsRoot);
    assert.equal(body.workspaces.length, 2, 'only dirs with .design-studio.json are listed');
    assert.deepEqual(body.workspaces[0], {
      dir: alpha,
      name: 'Alpha',
      url: 'http://localhost:5173/',
      screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 }],
    });
    assert.deepEqual(body.workspaces[1], { dir: beta, name: 'beta' }, 'no url/screens keys when absent');
    assert.equal(JSON.stringify(body.workspaces).includes('gamma'), false, 'no-config dirs are excluded');
  } finally {
    child.kill('SIGKILL');
    await rm(wsRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('GET /workspaces with a missing root answers the root with an empty list', { timeout: 60_000 }, async () => {
  const missing = path.join(await mkdtemp(path.join(tmpdir(), 'ds-wsroot-missing-')), 'never-created');
  const { port, child } = await startServiceTs({ DS_WORKSPACE_ROOT: missing });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspaces`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { root: missing, workspaces: [] });
  } finally {
    child.kill('SIGKILL');
  }
});

test('POST /mode validates edit|play and echoes in memory (no browser needed)', { timeout: 60_000 }, async () => {
  const { port, child } = await startServiceTs({});
  try {
    const bearer = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`http://127.0.0.1:${port}/mode`, { method: 'POST', headers: bearer, body: JSON.stringify({ mode: 'absurd' }) })).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${port}/mode`, { method: 'POST', headers: bearer, body: JSON.stringify({}) })).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${port}/mode`, { method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } })).status, 405);
    assert.equal((await fetch(`http://127.0.0.1:${port}/mode`, { method: 'POST', headers: bearer, body: 'nope' })).status, 400);
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/mode`, { method: 'POST', headers: bearer, body: JSON.stringify({ mode: 'play' }) })).json(), { ok: true, mode: 'play' });
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/mode`, { method: 'POST', headers: bearer, body: JSON.stringify({ mode: 'edit' }) })).json(), { ok: true, mode: 'edit' });
  } finally {
    child.kill('SIGKILL');
  }
});

// POST /open {dir, screen?} — the channel to a live Chrome via
// Browser.openWorkspace cannot run without the P1-browser methods; these pin
// the deterministic validation/refusal shapes. P2 integrates the open-success
// path against the real Browser implementation.
test('POST /open extension validates {dir, screen?} and refuses deterministically', { timeout: 60_000 }, async () => {
  const { port, child } = await startServiceTs({});
  try {
    const bearer = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${port}/open`, { method: 'POST', headers: bearer, body: JSON.stringify(body) });

    assert.equal((await post({})).status, 400, 'no url, no dir → 400');
    assert.equal((await post({ dir: 'relative/path' })).status, 400, 'relative dir → 400');

    // A dir with no config → 200 ok:false (business failure, not transport).
    const bare = await mkdtemp(path.join(tmpdir(), 'ds-open-bare-'));
    const noConfig = await post({ dir: bare });
    assert.equal(noConfig.status, 200);
    assert.deepEqual(await noConfig.json(), { ok: false, error: 'no .design-studio.json url found' });

    // Loopback config url that is down with no command to start it → 200
    // ok:false, never a window.
    const deadPort = await freePort();
    const dead = await mkdtemp(path.join(tmpdir(), 'ds-open-dead-'));
    await writeFile(path.join(dead, '.design-studio.json'), JSON.stringify({ version: 1, name: 'dead', url: `http://127.0.0.1:${deadPort}/` }));
    await writeFile(path.join(dead, 'screens.json'), JSON.stringify({ version: 1, screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 }] }));
    const deadRes = await post({ dir: dead });
    assert.equal(deadRes.status, 200);
    const deadBody = (await deadRes.json()) as { ok: boolean; error?: string };
    assert.equal(deadBody.ok, false);
    assert.match(deadBody.error ?? '', /not running/);

    // Unknown screen id → 400. The config url is non-loopback so the dev-server
    // step is skipped and the id check is reached deterministically.
    const ext = await mkdtemp(path.join(tmpdir(), 'ds-open-ext-'));
    await writeFile(path.join(ext, '.design-studio.json'), JSON.stringify({ version: 1, name: 'ext', url: 'https://example.com/' }));
    await writeFile(path.join(ext, 'screens.json'), JSON.stringify({ version: 1, screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 }] }));
    const unknown = await post({ dir: ext, screen: 'nope' });
    assert.equal(unknown.status, 400);
    assert.deepEqual(await unknown.json(), { error: 'unknown screen id' });
  } finally {
    child.kill('SIGKILL');
  }
});

// ---------------------------------------------------------------------------
// Design Canvas P2 routes (SPEC-V3-P2-SCOPE.md D4–D7). Spawn the TS entry on a
// dedicated port band (65400–65535 — the screens spawn tests own 64000–65535).
// ---------------------------------------------------------------------------

async function startServiceTsP2(extraEnv: Record<string, string>): Promise<{ port: number; child: ChildProcess }> {
  // NOTE: the orchestrator suggested 66000–66999, but TCP ports cap at 65535;
  // this band (65400–65535) sits above the screens suite's 64000–65399 band
  // and stays inside the valid port space.
  const port = await pickFreePort(65400, 136);
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.ts')], {
    env: { ...process.env, DS_KILL_WINDOW_ON_STOP: '1', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: TOKEN, ...extraEnv },
    stdio: 'ignore',
  });
  try {
    await waitForHealth(port, child);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  return { port, child };
}

test('GET/PATCH /view: default read, strict validation, per-key merge, no PUT', { timeout: 60_000 }, async () => {
  const ws = await mkdtemp(path.join(tmpdir(), 'ds-view-route-'));
  // V4-14 fixture (integrator): PATCH /view requires the workspace marker;
  // the plain-dir 400 direction lives in tests/v4-service.test.ts.
  await writeFile(path.join(ws, '.design-studio.json'), JSON.stringify({ version: 1 }));
  const { port, child } = await startServiceTsP2({});
  try {
    const bearer = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`http://127.0.0.1:${port}/view?dir=relative`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 400, 'relative dir → 400');
    assert.equal((await fetch(`http://127.0.0.1:${port}/view?dir=${encodeURIComponent(ws)}`)).status, 401, 'bearer token required');

    // The default view is the empty schema (never-persisted camera is null).
    const empty = await (await fetch(`http://127.0.0.1:${port}/view?dir=${encodeURIComponent(ws)}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    assert.deepEqual(empty, { version: 1, camera: null, positions: {}, mode: 'edit' });

    // Malformed patches → 400 with an actionable error.
    const badPatches = [
      'not json',
      JSON.stringify(null),
      JSON.stringify({}),
      JSON.stringify({ camera: { mode: 'warp', scale: 1, panX: 0, panY: 0 } }),
      JSON.stringify({ camera: { mode: 'manual', scale: NaN, panX: 0, panY: 0 } }),
      JSON.stringify({ positions: 'nope' }),
      JSON.stringify({ positions: { BAD: { x: 1, y: 2 } } }),
      JSON.stringify({ positions: { home: { x: Infinity, y: 2 } } }),
      JSON.stringify({ mode: 'sideways' }),
    ];
    for (const body of badPatches) {
      const res = await fetch(`http://127.0.0.1:${port}/view?dir=${encodeURIComponent(ws)}`, { method: 'PATCH', headers: bearer, body });
      assert.equal(res.status, 400, `patch ${body.slice(0, 40)}… is refused`);
      assert.equal(typeof ((await res.json()) as { error?: string }).error, 'string');
    }

    // A valid per-key merge under a missing file creates it; positions clamp.
    const patch = await fetch(`http://127.0.0.1:${port}/view?dir=${encodeURIComponent(ws)}`, {
      method: 'PATCH',
      headers: bearer,
      body: JSON.stringify({
        camera: { mode: 'manual', scale: 0.001, panX: -120, panY: 40 },
        positions: { home: { x: 1e9, y: -1e9 }, checkout: null },
        mode: 'play',
      }),
    });
    assert.equal(patch.status, 200);
    assert.deepEqual(await patch.json(), { ok: true });
    const got = await (await fetch(`http://127.0.0.1:${port}/view?dir=${encodeURIComponent(ws)}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json() as {
      version: number;
      camera: { mode: string; scale: number };
      positions: Record<string, unknown>;
      mode: string;
    };
    assert.equal(got.camera.scale, 0.1, 'camera scale clamps to the 0.1–3 zoom range');
    assert.deepEqual(got.positions, { home: { x: 32768, y: -32768 }, checkout: null }, 'positions clamp to ±32768');
    assert.equal(got.mode, 'play');

    // Per-key merge: a later patch leaves untouched keys alone.
    await fetch(`http://127.0.0.1:${port}/view?dir=${encodeURIComponent(ws)}`, {
      method: 'PATCH',
      headers: bearer,
      body: JSON.stringify({ positions: { pay: { x: 5, y: 5 } } }),
    });
    const merged = await (await fetch(`http://127.0.0.1:${port}/view?dir=${encodeURIComponent(ws)}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json() as { positions: Record<string, unknown>; mode: string };
    assert.deepEqual(merged.positions, { home: { x: 32768, y: -32768 }, checkout: null, pay: { x: 5, y: 5 } });
    assert.equal(merged.mode, 'play', 'the second merge leaves the persisted mode alone');

    // D6: nothing may full-overwrite view.json — PUT is refused.
    const put = await fetch(`http://127.0.0.1:${port}/view?dir=${encodeURIComponent(ws)}`, { method: 'PUT', headers: bearer, body: '{}' });
    assert.equal(put.status, 405);
  } finally {
    child.kill('SIGKILL');
    await rm(ws, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('POST /export preconditions answer 200 ok:false; malformed input is 400', { timeout: 60_000 }, async () => {
  // V4-14 fixture (integrator): the marker guard precedes D4's window
  // precondition, so the no-window probe dir must be a MARKED workspace to
  // still answer the 200 'window not open' order this pin checks. The
  // no-marker 400 direction lives in tests/v4-service.test.ts.
  const marked = await mkdtemp(path.join(tmpdir(), 'ds-export-probe-'));
  await writeFile(path.join(marked, '.design-studio.json'), JSON.stringify({ version: 1 }));
  const { port, child } = await startServiceTsP2({});
  try {
    const bearer = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`http://127.0.0.1:${port}/export`, { method: 'POST', headers: bearer, body: JSON.stringify({}) })).status, 400, 'missing dir → 400');
    assert.equal((await fetch(`http://127.0.0.1:${port}/export`, { method: 'POST', headers: bearer, body: JSON.stringify({ dir: 'relative' }) })).status, 400, 'relative dir → 400');
    assert.equal((await fetch(`http://127.0.0.1:${port}/export`, { method: 'POST', headers: bearer, body: JSON.stringify({ dir: '/tmp', formats: ['webp'] }) })).status, 400, 'unknown format → 400');

    // No window opened yet: the FIRST precondition fails (D4 order).
    const noWindow = await fetch(`http://127.0.0.1:${port}/export`, {
      method: 'POST',
      headers: bearer,
      body: JSON.stringify({ dir: marked }),
    });
    assert.equal(noWindow.status, 200);
    assert.deepEqual(await noWindow.json(), { ok: false, error: 'the live canvas window is not open' });
  } finally {
    child.kill('SIGKILL');
    await rm(marked, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('GET /export/status: missing params → 400, unknown job → 200 ok:false', { timeout: 60_000 }, async () => {
  const { port, child } = await startServiceTsP2({});
  try {
    const headers = { authorization: `Bearer ${TOKEN}` };
    assert.equal((await fetch(`http://127.0.0.1:${port}/export/status`, { headers })).status, 400, 'missing dir/job → 400');
    assert.equal((await fetch(`http://127.0.0.1:${port}/export/status?dir=relative&job=x`, { headers })).status, 400, 'relative dir → 400');
    const unknown = await fetch(`http://127.0.0.1:${port}/export/status?dir=${encodeURIComponent('C:\\no-such')}&job=export-9`, { headers });
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), { ok: false, error: 'unknown export job' });
  } finally {
    child.kill('SIGKILL');
  }
});

test('POST /critique: malformed input is 400, no window is a 200 ok:false', { timeout: 60_000 }, async () => {
  // V4-14 fixture (integrator): same marker-guard order as /export above —
  // the no-window probe needs a marked workspace dir to reach the 200 check.
  const marked = await mkdtemp(path.join(tmpdir(), 'ds-critique-probe-'));
  await writeFile(path.join(marked, '.design-studio.json'), JSON.stringify({ version: 1 }));
  const { port, child } = await startServiceTsP2({});
  try {
    const bearer = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`http://127.0.0.1:${port}/critique`, { method: 'POST', headers: bearer, body: JSON.stringify({}) })).status, 400, 'missing dir → 400');
    assert.equal((await fetch(`http://127.0.0.1:${port}/critique`, { method: 'POST', headers: bearer, body: JSON.stringify({ dir: 'relative' }) })).status, 400, 'relative dir → 400');
    assert.equal((await fetch(`http://127.0.0.1:${port}/critique`, { method: 'POST', headers: bearer, body: 'nope' })).status, 400, 'non-JSON → 400');
    assert.equal((await fetch(`http://127.0.0.1:${port}/critique`, { method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } })).status, 405, 'GET → 405');
    const noWindow = await fetch(`http://127.0.0.1:${port}/critique`, {
      method: 'POST',
      headers: bearer,
      body: JSON.stringify({ dir: marked }),
    });
    assert.equal(noWindow.status, 200);
    assert.deepEqual(await noWindow.json(), { ok: false, error: 'the live canvas window is not open' });
  } finally {
    child.kill('SIGKILL');
    await rm(marked, { recursive: true, force: true }).catch(() => undefined);
  }
});
