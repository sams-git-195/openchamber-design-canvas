// R4 (F1/F2): POST /workspaces/rename and the GET /workspaces server peek,
// against a spawned service/main.ts (no Chrome). DS_WORKSPACE_ROOT and
// DS_SETTINGS_PATH keep every run inside a temp root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renameWorkspaceConfig } from '../service/studio-config.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'workspace-rename-token';

function pickFreePort(min: number, span: number, attempts = 48): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Math.floor(Math.random() * span);
    let i = 0;
    const tryNext = (): void => {
      if (i >= attempts) { reject(new Error(`no bindable port in ${min}..${min + span - 1}`)); return; }
      const candidate = (start + i * 37) % span + min;
      i += 1;
      // Windows lets 127.0.0.1 bind beside a 0.0.0.0 listener, so a port is
      // only free when BOTH binds succeed.
      const bindable = (host: string) => new Promise<boolean>((done) => {
        const probe = createServer();
        probe.once('error', () => done(false));
        probe.once('listening', () => probe.close(() => done(true)));
        probe.listen(candidate, host);
      });
      void (async () => {
        if ((await bindable('127.0.0.1')) && (await bindable('0.0.0.0'))) resolve(candidate);
        else setTimeout(tryNext, 10);
      })();
    };
    tryNext();
  });
}

type Service = { port: number; child: ChildProcess; wsRoot: string; api: (p: string, init?: RequestInit) => Promise<Response> };

async function startService(): Promise<Service> {
  const wsRoot = await mkdtemp(path.join(tmpdir(), 'ds-rename-'));
  const port = await pickFreePort(53500, 1500);
  // A per-start token: a stale or foreign listener on the port answers 401,
  // so health only ever passes against THIS child.
  const token = `${TOKEN}-${Math.random().toString(36).slice(2)}`;
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.ts')], {
    env: {
      ...process.env,
      DS_WORKSPACE_ROOT: wsRoot,
      DS_SETTINGS_PATH: path.join(wsRoot, '.no-settings.json'),
      OPENCHAMBER_SERVICE_PORT: String(port),
      OPENCHAMBER_SERVICE_TOKEN: token,
    },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`service exited early: ${child.exitCode}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${token}` } })).status === 200) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error('rename service did not become healthy');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const api = (p: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  return { port, child, wsRoot, api };
}

async function stop(service: Service): Promise<void> {
  service.child.kill('SIGKILL');
  await rm(service.wsRoot, { recursive: true, force: true }).catch(() => undefined);
}

const rename = (service: Service, dir: unknown, name: unknown) =>
  service.api('/workspaces/rename', { method: 'POST', body: JSON.stringify({ dir, name }) });

test('rename-writes-only-name-byte-verbatim-otherwise', { timeout: 60_000 }, async () => {
  const service = await startService();
  try {
    const dir = path.join(service.wsRoot, 'shop');
    await mkdir(dir);
    const original = {
      version: 1,
      name: 'Old name',
      type: 'hi-fi',
      url: 'http://localhost:5174/',
      harness: { direction: 'editorial', verify: { gates: ['a11y'] } },
      pick: { extra: [1, 2, 3] },
      unknownKey: 'kept',
    };
    await writeFile(path.join(dir, '.design-studio.json'), `${JSON.stringify(original, null, 2)}\n`);
    const res = await rename(service, dir, '  New name  ');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, name: 'New name' });
    const text = await readFile(path.join(dir, '.design-studio.json'), 'utf8');
    assert.equal(text, `${JSON.stringify({ ...original, name: 'New name' }, null, 2)}\n`, 'only the name line changed; key order kept');
    assert.deepEqual((await readdir(dir)).sort(), ['.design-studio.json'], 'no tmp file left behind');

    // A config without a name gains one at the end; every other key stays.
    const bare = path.join(service.wsRoot, 'bare');
    await mkdir(bare);
    await writeFile(path.join(bare, '.design-studio.json'), '{"version":1,"url":"http://localhost:5175/"}');
    assert.deepEqual(await (await rename(service, bare, 'Bare')).json(), { ok: true, name: 'Bare' });
    assert.deepEqual(JSON.parse(await readFile(path.join(bare, '.design-studio.json'), 'utf8')), { version: 1, url: 'http://localhost:5175/', name: 'Bare' });
  } finally {
    await stop(service);
  }
});

test('rename-rejects-no-marker-400', { timeout: 60_000 }, async () => {
  const service = await startService();
  try {
    const plain = path.join(service.wsRoot, 'plain');
    await mkdir(plain);
    const res = await rename(service, plain, 'Nope');
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'not a design workspace' });
    assert.equal((await rename(service, 'relative/dir', 'x')).status, 400, 'dir not absolute');
    assert.equal((await rename(service, plain, 42)).status, 400, 'name not a string');
    assert.equal((await service.api('/workspaces/rename', { method: 'POST', body: '{nope' })).status, 400, 'body not JSON');
    assert.equal((await service.api('/workspaces/rename')).status, 405, 'GET is not a rename');
  } finally {
    await stop(service);
  }
});

test('rename-invalid-name-200-okfalse', { timeout: 60_000 }, async () => {
  const service = await startService();
  try {
    const dir = path.join(service.wsRoot, 'ws');
    await mkdir(dir);
    const before = '{"version":1,"name":"Keep"}';
    await writeFile(path.join(dir, '.design-studio.json'), before);
    for (const bad of ['', '   ', 'x'.repeat(81), 'tab\there', 'bell\u0007', 'del\u007f', 'line\nbreak']) {
      const res = await rename(service, dir, bad);
      assert.equal(res.status, 200, `${JSON.stringify(bad)} is a business failure`);
      const body = (await res.json()) as { ok: boolean; error?: string };
      assert.equal(body.ok, false);
      assert.equal(typeof body.error, 'string');
    }
    assert.equal(await readFile(path.join(dir, '.design-studio.json'), 'utf8'), before, 'nothing was written');
    assert.deepEqual(await (await rename(service, dir, 'x'.repeat(80))).json(), { ok: true, name: 'x'.repeat(80) }, '80 chars is the limit');
  } finally {
    await stop(service);
  }
});

test('rename-unparseable-config-200-okfalse', { timeout: 60_000 }, async () => {
  const service = await startService();
  try {
    const dir = path.join(service.wsRoot, 'broken');
    await mkdir(dir);
    await writeFile(path.join(dir, '.design-studio.json'), '{ not json');
    const res = await rename(service, dir, 'Fixed?');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.match(body.error ?? '', /JSON/);
    assert.equal(await readFile(path.join(dir, '.design-studio.json'), 'utf8'), '{ not json', 'an unparseable config is left alone');

    const arrayDir = path.join(service.wsRoot, 'array');
    await mkdir(arrayDir);
    await writeFile(path.join(arrayDir, '.design-studio.json'), '[1,2]');
    assert.equal(((await (await rename(service, arrayDir, 'Arr')).json()) as { ok: boolean }).ok, false, 'a non-object config is refused');
  } finally {
    await stop(service);
  }
});

test('rename-finds-alt-config-candidates', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'ds-rename-alt-'));
  try {
    const plainName = path.join(base, 'plain-name');
    await mkdir(plainName);
    await writeFile(path.join(plainName, 'design-studio.json'), '{"version":1,"name":"A"}');
    assert.deepEqual(await renameWorkspaceConfig(plainName, 'A2'), { name: 'A2' });
    assert.equal(JSON.parse(await readFile(path.join(plainName, 'design-studio.json'), 'utf8')).name, 'A2');

    const nested = path.join(base, 'nested');
    await mkdir(path.join(nested, 'design'), { recursive: true });
    await writeFile(path.join(nested, 'design', '.design-studio.json'), '{"version":1,"name":"B"}');
    assert.deepEqual(await renameWorkspaceConfig(nested, 'B2'), { name: 'B2' });
    assert.equal(JSON.parse(await readFile(path.join(nested, 'design', '.design-studio.json'), 'utf8')).name, 'B2');
    assert.deepEqual(await readdir(path.join(nested, 'design')), ['.design-studio.json'], 'tmp lands beside the config and is renamed away');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('workspaces-reflects-new-name', { timeout: 60_000 }, async () => {
  const service = await startService();
  try {
    const dir = path.join(service.wsRoot, 'landing');
    await mkdir(dir);
    await writeFile(path.join(dir, '.design-studio.json'), '{"version":1,"name":"Landing"}');
    assert.equal(((await (await rename(service, dir, 'Landing v2')).json()) as { ok: boolean }).ok, true);
    const listed = (await (await service.api('/workspaces')).json()) as { workspaces: Array<{ dir: string; name: string }> };
    assert.equal(listed.workspaces.find((w) => w.dir === dir)?.name, 'Landing v2');
  } finally {
    await stop(service);
  }
});

test('workspaces-server-peek: a recorded, reachable dev server reads recorded+up', { timeout: 60_000 }, async () => {
  const service = await startService();
  const dev = http.createServer((_req, res) => res.end('ok'));
  await new Promise<void>((resolve) => dev.listen(0, '127.0.0.1', resolve));
  const devPort = (dev.address() as AddressInfo).port;
  try {
    const up = path.join(service.wsRoot, 'up');
    const down = path.join(service.wsRoot, 'down');
    for (const dir of [up, down]) {
      await mkdir(path.join(dir, '.design-studio'), { recursive: true });
      await writeFile(path.join(dir, '.design-studio.json'), '{"version":1}');
    }
    await writeFile(path.join(up, '.design-studio', 'server.json'), JSON.stringify({ pgid: process.pid, port: devPort, startedAt: 1 }));
    const deadPort = await pickFreePort(56500, 500);
    await writeFile(path.join(down, '.design-studio', 'server.json'), JSON.stringify({ pgid: 999999, port: deadPort, startedAt: 1 }));
    const listed = (await (await service.api('/workspaces')).json()) as { workspaces: Array<{ dir: string; server: unknown }> };
    const byDir = new Map(listed.workspaces.map((w) => [w.dir, w.server]));
    assert.deepEqual(byDir.get(up), { recorded: true, up: true, port: devPort });
    assert.deepEqual(byDir.get(down), { recorded: true, up: false, port: deadPort });
  } finally {
    await new Promise<void>((resolve) => dev.close(() => resolve()));
    await stop(service);
  }
});
