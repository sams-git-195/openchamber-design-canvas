// R4 (F4): the service-owned settings file and the designs location.
// Unit tests drive settings.ts / workspace-root.ts in-process with an explicit
// env (DS_SETTINGS_PATH points every read/write at a temp file); one spawned
// service pins the GET/PUT /settings + /workspaces route contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSettings, settingsFilePath, writeSettings } from '../service/settings.ts';
import {
  defaultWorkspaceRoot,
  resolveWorkspaceRoot,
  resolveWorkspaceRootInfo,
  setWorkspaceRoot,
  validateWorkspaceRootCandidate,
} from '../service/workspace-root.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'settings-test-token';

async function sandbox(): Promise<{ base: string; env: NodeJS.ProcessEnv; settingsFile: string }> {
  const base = await mkdtemp(path.join(tmpdir(), 'ds-settings-'));
  const settingsFile = path.join(base, 'cfg', 'settings.json');
  // win32: a sandboxed ONEDRIVE\Documents makes the default probe land in the
  // sandbox instead of the machine's real (possibly non-empty) designs folder.
  await mkdir(path.join(base, 'od', 'Documents'), { recursive: true });
  return { base, settingsFile, env: { DS_SETTINGS_PATH: settingsFile, ONEDRIVE: path.join(base, 'od') } };
}

async function makeWorkspace(parent: string, slug: string): Promise<string> {
  const dir = path.join(parent, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '.design-studio.json'), JSON.stringify({ version: 1, name: slug }));
  return dir;
}

test('settingsFilePath: per-platform locations and the DS_SETTINGS_PATH seam', () => {
  assert.equal(
    settingsFilePath({ APPDATA: 'C:\\Users\\sam\\AppData\\Roaming' }, 'win32', 'C:\\Users\\sam'),
    path.join('C:\\Users\\sam\\AppData\\Roaming', 'Design Canvas', 'settings.json'),
  );
  assert.equal(
    settingsFilePath({}, 'win32', 'C:\\Users\\sam'),
    path.join('C:\\Users\\sam', 'AppData', 'Roaming', 'Design Canvas', 'settings.json'),
    'no APPDATA → homedir AppData\\Roaming',
  );
  assert.equal(
    settingsFilePath({}, 'darwin', '/Users/sam'),
    path.join('/Users/sam', 'Library', 'Application Support', 'Design Canvas', 'settings.json'),
  );
  assert.equal(settingsFilePath({}, 'linux', '/home/sam'), path.join('/home/sam', '.config', 'design-canvas', 'settings.json'));
  assert.equal(
    settingsFilePath({ XDG_CONFIG_HOME: '/xdg' }, 'linux', '/home/sam'),
    path.join('/xdg', 'design-canvas', 'settings.json'),
  );
  const seam = path.join(tmpdir(), 'seam', 'settings.json');
  assert.equal(settingsFilePath({ DS_SETTINGS_PATH: seam, APPDATA: 'X:\\nope' }, 'win32', 'C:\\Users\\sam'), path.resolve(seam));
});

test('precedence: DS_WORKSPACE_ROOT > settings.workspaceRoot > default probe', async () => {
  const { base, env } = await sandbox();
  try {
    const chosen = path.join(base, 'chosen');
    const envRoot = path.join(base, 'from-env');
    const def = await defaultWorkspaceRoot(env);
    assert.equal(await resolveWorkspaceRoot(env), def, 'no settings → the default probe');
    assert.equal((await resolveWorkspaceRootInfo(env)).source, 'default');

    await writeSettings({ version: 1, workspaceRoot: chosen }, env);
    const fromFile = await resolveWorkspaceRootInfo(env);
    assert.deepEqual([fromFile.root, fromFile.source, fromFile.defaultRoot], [chosen, 'settings', def]);
    assert.equal(await resolveWorkspaceRoot(env), chosen);

    const withEnv = { ...env, DS_WORKSPACE_ROOT: envRoot };
    const fromEnv = await resolveWorkspaceRootInfo(withEnv);
    assert.deepEqual([fromEnv.root, fromEnv.source], [envRoot, 'env']);
    assert.equal(await resolveWorkspaceRoot(withEnv), envRoot);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('validation codes: INVALID, NOT_ABSOLUTE, IS_FS_ROOT, INSIDE_EXTENSION, IS_WORKSPACE, NOT_WRITABLE', async () => {
  const { base } = await sandbox();
  try {
    const codeOf = async (value: string, opts: { homeDir?: string; extensionDir?: string } = {}) => {
      const result = await validateWorkspaceRootCandidate(value, { extensionDir: root, ...opts });
      return result.ok ? 'OK' : result.code;
    };
    assert.equal(await codeOf(path.join(base, 'a\u0000b')), 'INVALID');
    assert.equal(await codeOf('relative/designs'), 'NOT_ABSOLUTE');
    assert.equal(await codeOf(''), 'NOT_ABSOLUTE');
    assert.equal(await codeOf(path.parse(base).root), 'IS_FS_ROOT');
    assert.equal(await codeOf(path.join(root, 'designs')), 'INSIDE_EXTENSION');
    assert.equal(await codeOf(root), 'INSIDE_EXTENSION');

    const ws = await makeWorkspace(base, 'a-workspace');
    assert.equal(await codeOf(ws), 'IS_WORKSPACE', 'the dir itself is a workspace');
    assert.equal(await codeOf(path.join(ws, 'nested', 'deeper')), 'IS_WORKSPACE', 'an ancestor is a workspace');
    const alt = path.join(base, 'alt-ws');
    await mkdir(path.join(alt, 'design'), { recursive: true });
    await writeFile(path.join(alt, 'design', '.design-studio.json'), '{"version":1}');
    assert.equal(await codeOf(path.join(alt, 'inner')), 'IS_WORKSPACE', 'alternate config candidates count');

    // A regular FILE where the folder should be: mkdir -p fails → NOT_WRITABLE.
    const blocker = path.join(base, 'blocker');
    await writeFile(blocker, 'not a folder');
    assert.equal(await codeOf(path.join(blocker, 'designs')), 'NOT_WRITABLE');

    const fresh = path.join(base, 'fresh', 'designs');
    const ok = await validateWorkspaceRootCandidate(fresh, { extensionDir: root });
    assert.deepEqual(ok, { ok: true, workspaceRoot: fresh });
    assert.deepEqual(await readdir(fresh), [], 'mkdir -p ran and the write probe was cleaned up');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('~ expansion resolves against the home directory', async () => {
  const { base } = await sandbox();
  try {
    const result = await validateWorkspaceRootCandidate('~/My Designs', { homeDir: base, extensionDir: root });
    assert.deepEqual(result, { ok: true, workspaceRoot: path.join(base, 'My Designs') });
    const backslash = await validateWorkspaceRootCandidate('~\\Other', { homeDir: base, extensionDir: root });
    if (process.platform === 'win32') assert.deepEqual(backslash, { ok: true, workspaceRoot: path.join(base, 'Other') });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('win32: a drive-relative path (C:foo) is NOT_ABSOLUTE', async () => {
  if (process.platform !== 'win32') return;
  const result = await validateWorkspaceRootCandidate('C:designs', { extensionDir: root });
  assert.equal(result.ok ? 'OK' : result.code, 'NOT_ABSOLUTE');
});

test('ENV_OVERRIDE: PUT is refused while DS_WORKSPACE_ROOT is set', async () => {
  const { base, env, settingsFile } = await sandbox();
  try {
    const result = await setWorkspaceRoot(path.join(base, 'x'), { ...env, DS_WORKSPACE_ROOT: path.join(base, 'env') }, { extensionDir: root });
    assert.equal(result.ok ? 'OK' : result.code, 'ENV_OVERRIDE');
    await assert.rejects(readFile(settingsFile, 'utf8'), 'nothing was written');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('atomic write: 2-space JSON, trailing newline, no tmp files left behind', async () => {
  const { base, env, settingsFile } = await sandbox();
  try {
    const chosen = path.join(base, 'designs');
    const result = await setWorkspaceRoot(chosen, env, { extensionDir: root });
    assert.deepEqual(result, { ok: true, workspaceRoot: chosen });
    const text = await readFile(settingsFile, 'utf8');
    // #12: the default root it switched away from is remembered unconditionally.
    assert.equal(text, `${JSON.stringify({ version: 1, workspaceRoot: chosen, previousRoots: [await defaultWorkspaceRoot(env)] }, null, 2)}\n`);
    assert.deepEqual(await readdir(path.dirname(settingsFile)), ['settings.json'], 'tmp file renamed away');
    assert.equal(await resolveWorkspaceRoot(env), chosen, 'the next resolve sees the new root');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('previousRoots: the old root is pushed on every switch, even when empty; re-selecting removes it', async () => {
  const { base, env } = await sandbox();
  try {
    const defaultRoot = await defaultWorkspaceRoot(env);
    const empty = path.join(base, 'empty-root');
    const full = path.join(base, 'full-root');
    const next = path.join(base, 'next-root');
    assert.equal((await setWorkspaceRoot(empty, env, { extensionDir: root })).ok, true);
    assert.deepEqual((await readSettings(env)).previousRoots, [defaultRoot], 'the default root is remembered when switched away from');
    assert.equal((await setWorkspaceRoot(full, env, { extensionDir: root })).ok, true);
    assert.deepEqual((await readSettings(env)).previousRoots, [empty, defaultRoot], 'an empty old root is remembered too, newest first');

    await makeWorkspace(full, 'kept');
    assert.equal((await setWorkspaceRoot(next, env, { extensionDir: root })).ok, true);
    assert.deepEqual((await readSettings(env)).previousRoots, [full, empty, defaultRoot], 'a non-empty old root is remembered');
    assert.deepEqual((await resolveWorkspaceRootInfo(env)).previousRoots, [full, empty, defaultRoot]);

    // Same root, different case on win32: still one entry (sameAbsoluteDir dedupe).
    const spelled = process.platform === 'win32' ? full.toUpperCase() : full;
    assert.equal((await setWorkspaceRoot(spelled, env, { extensionDir: root })).ok, true);
    assert.deepEqual((await readSettings(env)).previousRoots, [next, empty, defaultRoot], 're-selecting the old root removes it from previousRoots');

    // Re-setting the current root is no switch: nothing new is recorded.
    assert.equal((await setWorkspaceRoot(spelled, env, { extensionDir: root })).ok, true);
    assert.deepEqual((await readSettings(env)).previousRoots, [next, empty, defaultRoot], 'no self-entry, no duplicate');

    // Reset (null) → default; the current root is remembered and the default leaves the list.
    const reset = await setWorkspaceRoot(null, env, { extensionDir: root });
    assert.deepEqual(reset, { ok: true, workspaceRoot: defaultRoot });
    const after = await readSettings(env);
    assert.equal(after.workspaceRoot, undefined, 'null clears the choice');
    assert.equal(after.previousRoots?.length, 3);
    assert.equal(after.previousRoots![0]!.toLowerCase(), full.toLowerCase());
    assert.deepEqual(after.previousRoots!.slice(1), [next, empty]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('previousRoots caps at 10, newest first', async () => {
  const { base, env } = await sandbox();
  try {
    for (let i = 0; i < 13; i += 1) {
      const r = path.join(base, `root-${i}`);
      await makeWorkspace(r, 'ws');
      assert.equal((await setWorkspaceRoot(r, env, { extensionDir: root })).ok, true);
    }
    const prev = (await readSettings(env)).previousRoots!;
    assert.equal(prev.length, 10);
    assert.equal(prev[0], path.join(base, 'root-11'));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('a corrupt settings file falls back to the default root', async () => {
  const { base, env, settingsFile } = await sandbox();
  try {
    await mkdir(path.dirname(settingsFile), { recursive: true });
    await writeFile(settingsFile, '{ not json');
    const info = await resolveWorkspaceRootInfo(env);
    assert.equal(info.source, 'default');
    assert.equal(info.root, info.defaultRoot);
    assert.deepEqual(await readSettings(env), { version: 1 });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// ---- the spawned route contract ---------------------------------------------

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

async function startService(extraEnv: Record<string, string>): Promise<{ port: number; child: ChildProcess; token: string }> {
  const port = await pickFreePort(50000, 1500);
  // A per-start token: a stale or foreign listener on the port answers 401.
  const token = `${TOKEN}-${Math.random().toString(36).slice(2)}`;
  const env: NodeJS.ProcessEnv = { ...process.env, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: token, ...extraEnv };
  if (!('DS_WORKSPACE_ROOT' in extraEnv)) delete env.DS_WORKSPACE_ROOT;
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.ts')], { env, stdio: 'ignore' });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`service exited early: ${child.exitCode}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${token}` } })).status === 200) return { port, child, token };
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGKILL');
  throw new Error('settings service did not become healthy');
}

test('GET/PUT /settings and /workspaces with previousRoots (spawned service)', { timeout: 60_000 }, async () => {
  const { base, settingsFile } = await sandbox();
  const first = path.join(base, 'first');
  const second = path.join(base, 'second');
  const old = await makeWorkspace(first, 'old-one');
  const { port, child, token } = await startService({ DS_SETTINGS_PATH: settingsFile, ONEDRIVE: path.join(base, 'od') });
  const api = (p: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  try {
    const initial = (await (await api('/settings')).json()) as Record<string, unknown>;
    assert.equal(initial.source, 'default');
    assert.equal(initial.envOverride, false);
    assert.equal(initial.workspaceRoot, initial.defaultRoot);
    assert.deepEqual(initial.previousRoots, []);

    assert.equal((await api('/settings', { method: 'PUT', body: 'nope' })).status, 400, 'body not JSON');
    assert.equal((await api('/settings', { method: 'PUT', body: JSON.stringify({ workspaceRoot: 5 }) })).status, 400, 'not string|null');
    assert.equal((await api('/settings', { method: 'PUT', body: JSON.stringify({}) })).status, 400, 'missing value');
    const relative = await api('/settings', { method: 'PUT', body: JSON.stringify({ workspaceRoot: 'designs' }) });
    assert.equal(relative.status, 200);
    assert.equal(((await relative.json()) as { code: string }).code, 'NOT_ABSOLUTE');

    assert.deepEqual(await (await api('/settings', { method: 'PUT', body: JSON.stringify({ workspaceRoot: first }) })).json(), { ok: true, workspaceRoot: first });
    assert.deepEqual(await (await api('/settings', { method: 'PUT', body: JSON.stringify({ workspaceRoot: second }) })).json(), { ok: true, workspaceRoot: second });
    const now = (await (await api('/settings')).json()) as Record<string, unknown>;
    // The default root was switched away from first: it is remembered as well (#12, unconditional).
    assert.deepEqual([now.workspaceRoot, now.source, now.previousRoots], [second, 'settings', [first, initial.defaultRoot]]);

    const fresh = await makeWorkspace(second, 'new-one');
    const listed = (await (await api('/workspaces')).json()) as { root: string; roots: string[]; workspaces: Array<Record<string, unknown>> };
    assert.equal(listed.root, second, 'root stays the CURRENT root');
    assert.deepEqual(listed.roots, [second, first, initial.defaultRoot]);
    const byDir = new Map(listed.workspaces.map((w) => [w.dir, w]));
    assert.deepEqual([byDir.get(fresh)?.root, byDir.get(fresh)?.legacyRoot], [second, false]);
    assert.deepEqual([byDir.get(old)?.root, byDir.get(old)?.legacyRoot], [first, true]);
  } finally {
    child.kill('SIGKILL');
    await rm(base, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('ENV_OVERRIDE over the route: GET reports envOverride, PUT refuses', { timeout: 60_000 }, async () => {
  const { base, settingsFile } = await sandbox();
  const envRoot = path.join(base, 'env-root');
  const { port, child, token } = await startService({ DS_SETTINGS_PATH: settingsFile, DS_WORKSPACE_ROOT: envRoot });
  const api = (p: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  try {
    const got = (await (await api('/settings')).json()) as Record<string, unknown>;
    assert.deepEqual([got.workspaceRoot, got.source, got.envOverride], [envRoot, 'env', true]);
    const put = (await (await api('/settings', { method: 'PUT', body: JSON.stringify({ workspaceRoot: path.join(base, 'x') }) })).json()) as Record<string, unknown>;
    assert.deepEqual([put.ok, put.code], [false, 'ENV_OVERRIDE']);
  } finally {
    child.kill('SIGKILL');
    await rm(base, { recursive: true, force: true }).catch(() => undefined);
  }
});
