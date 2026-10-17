// Independent adversarial pass (breaker lane) over the workspaces design-work
// list: `joinWorkspaceSessions` (panel/api.ts), `loadCanvasWorkspaces` and the
// ws/ scan wiring (panel/main.ts). The fork moved the omission contract from
// "a listed project hides its own chats" to "a /workspaces row is NEVER hidden
// — an absent session is a null-join, an absent url is a badge, a broken
// service is an error". This lane attacks the failure modes the appended suite
// does not pin: state precedence, duplicate rows, exact-dir matching for the
// session join (prefix / case / separator normalization), input purity, the
// clash-avoiding slug, and the renderer's join derivation at source level.
//
// Run: node --test --test-concurrency=1 tests/adversarial/design-work-omit-2026-10-14/adversarial-designwork.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { WorkspaceRow, WorkspaceWorkRow } from '../../../panel/api.ts';

// Same shim contract as tests/panel-open.test.ts: the SDK's connectHost()
// needs a `window` before panel/api.ts is imported.
const shim = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  parent: { postMessage: () => undefined },
};
(globalThis as { window?: unknown }).window = shim;
(globalThis as { document?: unknown }).document = {
  getElementById: () => ({ append: () => undefined }),
  documentElement: {},
};

const { joinWorkspaceSessions, uniqueCanvasSlug, normalizeDirPath, wsSessionIdFromKey, workspaceMeta } = await import('../../../panel/api.ts');

function row(dir: string, name: string, url?: string): WorkspaceRow {
  return url ? { dir, name, url } : { dir, name };
}

test('every /workspaces row survives the join — missing url, missing screens, no session: all keep the row', () => {
  const rows = [
    row('/root/a', 'A'),
    row('/root/b', 'B', 'http://localhost:5173'),
    { dir: '/root/c', name: 'C', screens: [] },
  ];
  const joined = joinWorkspaceSessions(rows, new Map());
  assert.equal(joined.length, 3, 'no row can drop out of the design-work list');
  assert.ok(joined.every((r) => r.sessionId === null), 'nothing maps without a ws/ record');
  assert.deepEqual(joined.map((r) => r.dir), ['/root/a', '/root/b', '/root/c'], 'the /workspaces order is preserved');
});

test('the session join matches dirs exactly after normalization: prefixes, separator and drive-case cannot conflate', () => {
  const map = new Map<string, string>([
    [normalizeDirPath('C:\\Docs\\Design Canvas\\a-1'), 'ses_a'],
  ]);
  const rows = [
    row('c:/Docs/Design Canvas/a-1', 'A'),            // separators + drive-case only → MATCHES
    row('C:\\Docs\\Design Canvas\\a-10', 'A ten'),     // prefix lookalike → must NOT match
    row('/Docs/Design Canvas/a-1', 'posix lookalike'), // different root → must NOT match
  ];
  const joined = joinWorkspaceSessions(rows, map);
  assert.equal(joined[0]!.sessionId, 'ses_a', 'the dir matches after separator/drive normalization');
  assert.equal(joined[1]!.sessionId, null, 'a-10 is not a-1: exact-dir matching only');
  assert.equal(joined[2]!.sessionId, null, 'a posix path is not the win32 dir');
});

test('duplicate workspace rows keep both entries and share the mapped session', () => {
  const joined = joinWorkspaceSessions(
    [row('/root/a', 'first'), row('/root/a', 'second copy')],
    new Map([[normalizeDirPath('/root/a'), 'ses_dup']]),
  );
  assert.equal(joined.length, 2, 'both rows stay in disk order');
  assert.deepEqual(joined.map((r) => r.sessionId), ['ses_dup', 'ses_dup']);
});

test('joinWorkspaceSessions never mutates its inputs and returns fresh rows', () => {
  const rows: WorkspaceWorkRow[] = [
    { dir: '/root/a', name: 'A', sessionId: null },
    { dir: '/root/b', name: 'B', url: 'http://localhost:5173', sessionId: null },
  ];
  Object.freeze(rows);
  for (const r of rows) Object.freeze(r);
  const map = new Map<string, string>([[normalizeDirPath('/root/a'), 'ses_a']]);
  const before = structuredClone(rows);
  const first = joinWorkspaceSessions(rows, map);
  const second = joinWorkspaceSessions(rows, map);
  assert.deepEqual(rows, before, 'the input rows are untouched');
  assert.ok(first[0] !== second[0], 'each call returns fresh row objects');
  assert.ok(first[0] !== rows[0], 'the input objects are never reused');
});

test('a workspace row with neither a url nor a name still renders (meta and label fall back, the row is never filtered)', async () => {
  assert.equal(workspaceMeta({ dir: '/root/c', name: '' }), '/root/c', 'meta falls back to the dir');
  const text = await readFile(new URL('../../../panel/main.ts', import.meta.url), 'utf8');
  const listStart = text.indexOf('function renderWorkspaceListRow(');
  const list = text.slice(listStart, text.indexOf('async function openWorkspaceListRow('));
  assert.match(list, /row\.name \|\| fileBaseName\(row\.dir\)/, 'the label falls back to the dir basename');
  assert.equal(/(configError|continue;)/.test(list), false, 'no filter drops a rendered workspace row');
});

test('a /workspaces failure surfaces the error state — it never masquerades as "empty"', async () => {
  const text = await readFile(new URL('../../../panel/main.ts', import.meta.url), 'utf8');
  const start = text.indexOf('async function loadCanvasWorkspaces(');
  const body = text.slice(start, text.indexOf('async function loadDesignHome('));
  assert.match(body, /state\.workspaces = \{ kind: 'error', message: error instanceof Error \? error\.message : String\(error\) \}/, 'a failed read is an error, not a list');
  const errorLine = body.indexOf("kind: 'error'");
  const emptyLine = body.indexOf("kind: 'empty'");
  assert.ok(errorLine > 0 && emptyLine > errorLine, 'the error state precedes the empty computation — precedence is pinned');
});

test('the ws/ scan is one storage.keys() pass whose values are read per key — and the permission flag never parses as a session', async () => {
  const text = await readFile(new URL('../../../panel/main.ts', import.meta.url), 'utf8');
  const start = text.indexOf('async function readWorkspaceSessionMap(');
  const body = text.slice(start, text.indexOf('async function loadCanvasWorkspaces('));
  assert.equal((body.match(/storage\.keys\(\)/g) ?? []).length, 1, 'a SINGLE keys() pass per refresh (audit #19)');
  assert.match(body, /isWorkspaceRecord\(value\)/, 'a value is validated before it maps');
  assert.match(body, /map\.set\(normalizeDirPath\(value\.dir\), id\)/, 'the map key is the normalized dir');
  assert.equal(wsSessionIdFromKey('ws-permission-notified'), null, 'the flat permission flag key is never a session id');
  assert.equal(wsSessionIdFromKey('ws/'), null);
  assert.equal(wsSessionIdFromKey('ws/a/b'), 'a/b', 'session ids keep their own slashes');
});

test('the unique slug always avoids the exact basenames already on disk, suffixing deterministically', () => {
  const existing = ['/root/landing-one', 'C:\\root\\landing-one-2', '/root/landing-one-3'];
  const slugs = Array.from({ length: 6 }, (_, i) => uniqueCanvasSlug('landing', 'ses_one', [...existing, ...Array.from({ length: i }, (_, k) => `/root/landing-one-${k + 4}`)]));
  assert.equal(slugs[0], 'landing-one-4', 'all of one, one-2 and one-3 are taken');
  assert.equal(new Set(slugs).size, slugs.length, 'each call yields a fresh suffix');
  assert.ok(slugs.every((slug) => /^[a-z0-9-]+$/.test(slug)), 'every slug is [a-z0-9-] sanitized');
  assert.equal(uniqueCanvasSlug('landing', 'ses_one', ['/root/other']), 'landing-one', 'the tail is the id segment, not the id prefix');
});

test('the workspace-target resolution has no refusal state at all (decision 2)', async () => {
  const text = await readFile(new URL('../../../panel/api.ts', import.meta.url), 'utf8');
  const start = text.indexOf('export function resolveCanvasTarget(');
  const end = text.indexOf('// ---- slug creation');
  const body = text.slice(start, end);
  assert.equal(/needs-project|refuse/i.test(body), false, 'no refusal kind exists');
  assert.match(body, /kind: 'workspace'/, 'a bound workspace is a real target');
  assert.match(body, /kind: 'new'/, 'an unbound session scaffolds fresh');
});