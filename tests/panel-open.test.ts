// Panel API + pure helpers. The panel bundle runs in a browser frame; the SDK's
// `connectHost()` needs a `window`, so this file installs a minimal shim before
// importing `panel/api.ts` and stubs `host.serviceRequest` to capture the exact
// request the panel sends. Panel DOM code is not unit-tested beyond the few
// pure helpers, matching the rest of the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

type ServiceRequest = { method: string; path: string; query?: Record<string, string>; body?: string };

// A real-sized frame (the rail tab / the row): the hidden 1×1 `/canvas`
// resolve pane is exercised on its own in rail.test.ts.
const shim = {
  innerWidth: 1024,
  innerHeight: 768,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  parent: { postMessage: () => undefined },
};
(globalThis as { window?: unknown }).window = shim;
(globalThis as { document?: unknown }).document = {
  getElementById: () => ({ append: () => undefined }),
  documentElement: {},
};

const api = await import('../panel/api.ts');
const main = await import('../panel/main.ts');
const {
  ATTACH_NEEDS_URL, DESIGN_READY_BADGE, NO_CONFIG_BADGE, NO_DESIGN_WORK_MESSAGE, NO_PROJECT_URL_MESSAGE,
  NO_WORKSPACE_MESSAGE, PICK_HINT, WORKSPACE_SLUG_LIMIT,
  ackPicks, allProjectsFromSnapshot, canvasSessionStatus, canvasSlug, closeLive, contrastRatio, countOtherActiveDesignSessions,
  focusLive, formatOpenStatus, getPicks, getScreens, getScaffoldStatus, getState, getWorkspaces,
  isLoopbackUrl, isModeChipData, isWorkspaceRecord, joinWorkspaceDir, joinWorkspaceSessions, normalizeDirPath,
  openWorkspace, pathContains, pickAckLabel, pickHintActive, postAgentStatus, projectReady,
  referenceText, registryErrorToastMessage, resolveCanvasTarget, sameDirPath, scaffoldProgressText, scaffoldProject,
  screenUrl, sessionShowsDesignMode, setMode, ServiceUnavailable, shouldStopDevServer, shouldToastRegistryError, startDevServer,
  syncScreens, uniqueCanvasSlug, workspaceMeta, WORKSPACE_MISSING_CODE, wsSessionIdFromKey,
} = api;
const { loadStudioConfig, setProjectDirectory, setWorkspace, surfaceKind, nextOverlayState } = main;
const { workspaceStorageKey } = await import('../panel/mode.ts');

type StubResult = { status: number; body: string };

function stubService(handler: (request: ServiceRequest) => StubResult): ServiceRequest[] {
  const calls: ServiceRequest[] = [];
  (api.host as unknown as { serviceRequest: (r: ServiceRequest) => Promise<StubResult> }).serviceRequest = async (request) => {
    calls.push(request);
    return handler(request);
  };
  return calls;
}

// ---- service wrappers (spec §B shapes, coded exactly) ----

test('getWorkspaces reads GET /workspaces and carries root + rows', async () => {
  const body = { root: 'C:\\Users\\samhe\\Documents\\Design Canvas', workspaces: [{ dir: 'C:\\Users\\samhe\\Documents\\Design Canvas\\landing-3f2a', name: 'landing', url: 'http://localhost:5173' }] };
  const calls = stubService(() => ({ status: 200, body: JSON.stringify(body) }));
  const result = await getWorkspaces();
  assert.deepEqual(result, body);
  assert.deepEqual(calls, [{ method: 'GET', path: '/workspaces', query: undefined, body: undefined }]);
});

test('getScreens reads GET /screens?dir= and returns the normalized registry', async () => {
  const body = { version: 1, screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 }] };
  const calls = stubService(() => ({ status: 200, body: JSON.stringify(body) }));
  const result = await getScreens('/p/site');
  assert.deepEqual(result, body);
  assert.equal(calls[0]!.method, 'GET');
  assert.deepEqual(calls[0]!.query, { dir: '/p/site' });
});

test('setMode posts POST /mode {mode} and echoes the held mode', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true, mode: 'play' }) }));
  const result = await setMode('play');
  assert.deepEqual(result, { ok: true, mode: 'play' });
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.path, '/mode');
  assert.deepEqual(JSON.parse(calls[0]!.body ?? ''), { mode: 'play' });
});

test('openWorkspace posts {dir}, {dir, screen}, and the V4-8 focus flag only when given', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/home.html', title: 'Home', settled: true }) }));
  await openWorkspace({ dir: 'C:\\p\\site' });
  assert.deepEqual(JSON.parse(calls[0]!.body ?? ''), { dir: 'C:\\p\\site' }, 'the config url stays authoritative service-side');
  await openWorkspace({ dir: 'C:\\p\\site', screen: 'checkout' });
  assert.deepEqual(JSON.parse(calls[1]!.body ?? ''), { dir: 'C:\\p\\site', screen: 'checkout' });
  await openWorkspace({ dir: 'C:\\p\\site', focus: true });
  assert.deepEqual(JSON.parse(calls[2]!.body ?? ''), { dir: 'C:\\p\\site', focus: true }, 'V4-8: a user-initiated open carries focus:true');
  await openWorkspace({ dir: 'C:\\p\\site', screen: 'checkout', focus: false });
  assert.deepEqual(JSON.parse(calls[3]!.body ?? ''), { dir: 'C:\\p\\site', screen: 'checkout', focus: false }, 'the dropdown activates WITHOUT raising the window');
});

test('getState reads /state with the V4 registryError field (V4-4)', async () => {
  const stateBody = {
    url: 'http://localhost:5173/', title: 'App', lastPick: null, pickSeq: 0, windowOpen: true,
    mode: 'edit', screens: [], activeScreen: 'home', registryError: 'screens.json: Expected \',\' or \'}\'', shellBridge: { authority: true, lastCommandAt: 1731500000000 },
  };
  stubService(() => ({ status: 200, body: JSON.stringify(stateBody) }));
  const state = await getState();
  assert.equal(state.registryError, 'screens.json: Expected \',\' or \'}\'');
  assert.deepEqual(state.shellBridge, { authority: true, lastCommandAt: 1731500000000 });
});

test('getState reads /state with the extended canvas fields', async () => {
  const stateBody = {
    url: 'http://localhost:5173/', title: 'App', lastPick: null, pickSeq: 0, windowOpen: true,
    mode: 'edit',
    screens: [{ id: 'home', title: 'Home', url: 'http://localhost:5173/home.html', width: 1280, height: 800, active: true }],
    activeScreen: 'home',
  };
  const calls = stubService(() => ({ status: 200, body: JSON.stringify(stateBody) }));
  const state = await getState();
  assert.deepEqual(state, stateBody);
  assert.equal(calls[0]!.path, '/state');
});

test('scaffoldProject posts {dir, type, …, async:true} and the design system travels only when chosen', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true, jobId: 'job-1', dir: '/root/slug', url: 'http://localhost:5173/' }) }));
  const started = await scaffoldProject('/root/slug', { type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', brief: 'landing' });
  assert.deepEqual(JSON.parse(calls[0]!.body ?? ''), { dir: '/root/slug', type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', brief: 'landing', async: true }, 'V4-11: async:true rides on every panel scaffold');
  assert.deepEqual(started, { ok: true, jobId: 'job-1', dir: '/root/slug', url: 'http://localhost:5173/' }, 'the async answer is the job to poll');
  await scaffoldProject('/root/slug', { type: 'hi-fi', designSystemId: 'apple' });
  assert.deepEqual(JSON.parse(calls[1]!.body ?? ''), { dir: '/root/slug', type: 'hi-fi', designSystemId: 'apple', async: true });
});

test('getScaffoldStatus polls GET /scaffold/status?job=&dir= — the async job state (V4-11, F1)', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ state: 'installing', elapsedMs: 4400 }) }));
  const status = await getScaffoldStatus('job-1', 'C:\\Docs\\Design Canvas\\landing-1');
  assert.deepEqual(status, { state: 'installing', elapsedMs: 4400 });
  assert.deepEqual(
    calls[0],
    { method: 'GET', path: '/scaffold/status', query: { job: 'job-1', dir: 'C:\\Docs\\Design Canvas\\landing-1' }, body: undefined },
    'F1: the service route requires dir next to job (job alone answers 400) — the real round trip is pinned in scaffold-contract.test.ts',
  );
});

test('scaffoldProgressText words each async-scaffold state for the progress toast (V4-11)', () => {
  assert.equal(scaffoldProgressText({ state: 'installing', elapsedMs: 12_400 }), 'Setting up the canvas… installing (12 s)');
  assert.equal(scaffoldProgressText({ state: 'booting', elapsedMs: 20_600 }), 'Setting up the canvas… starting the dev server (21 s)');
  assert.match(scaffoldProgressText({ state: 'done', elapsedMs: 30_000 }), /ready \(30 s\) — opening the canvas/);
  assert.match(scaffoldProgressText({ state: 'failed', elapsedMs: 1000, error: 'npm exited 1' }), /Canvas setup failed: npm exited 1/);
});

// ---- pick-queue wires (SPEC-V4 §3: GET /picks, POST /picks/ack) ----

test('getPicks long-polls GET /picks?since&wait exactly as §3 declares', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ seq: 0, picks: [] }) }));
  const result = await getPicks(12, 12_000);
  assert.deepEqual(result, { seq: 0, picks: [] });
  assert.deepEqual(calls[0], { method: 'GET', path: '/picks', query: { since: '12', wait: '12000' }, body: undefined });
  await getPicks(0, 0);
  assert.deepEqual(calls[1]!.query, { since: '0', wait: '0' }, 'the degraded short poll uses wait=0');
});

test('ackPicks posts POST /picks/ack {seq,label} and clamps the label to 80', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  await ackPicks(7, 'x'.repeat(120));
  assert.deepEqual(calls[0], { method: 'POST', path: '/picks/ack', query: undefined, body: JSON.stringify({ seq: 7, label: 'x'.repeat(80) }) });
});

test('pickAckLabel names the pick for the canvas confirmation pill — ≤80 chars', () => {
  assert.equal(pickAckLabel({ seq: 1, kind: 'element', screen: 'home', screenUrl: 'http://127.0.0.1:5173/home.html', at: 0, additive: false, selector: '#b', tag: 'button', classes: '', text: '', outerHTML: '', styles: {}, rect: { x: 0, y: 0, width: 0, height: 0 } }), '#b');
  assert.equal(pickAckLabel({ seq: 2, kind: 'screen', screen: 'home', screenUrl: 'http://127.0.0.1:5173/home.html', at: 0, additive: false, width: 1280, height: 800, file: 'home.html' }), 'screen home');
  const long = pickAckLabel({ seq: 3, kind: 'element', screen: 'home', screenUrl: '', at: 0, additive: false, selector: 'y'.repeat(100), tag: 'y', classes: '', text: '', outerHTML: '', styles: {}, rect: { x: 0, y: 0, width: 0, height: 0 } });
  assert.equal(long.length, 80, 'the §3 label cap holds');
});

// ---- agent status + registry sync wires (SPEC-V4 §3) ----

test('postAgentStatus posts POST /agent-status {busy,label?} capped at 60 (V4-12)', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  await postAgentStatus(true, 'Designing…');
  assert.deepEqual(JSON.parse(calls[0]!.body ?? ''), { busy: true, label: 'Designing…' });
  await postAgentStatus(false);
  assert.deepEqual(JSON.parse(calls[1]!.body ?? ''), { busy: false }, 'idle carries NO label — the chip just settles');
  await postAgentStatus(true, 'x'.repeat(90));
  assert.equal((JSON.parse(calls[2]!.body ?? '') as { label: string }).label.length, 60, 'the ≤60 cap is applied panel-side too');
});

test('syncScreens posts POST /screens/sync {dir} — the V4-4 turn-completed backstop', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  await syncScreens('C:\\p\\site');
  assert.deepEqual(calls[0], { method: 'POST', path: '/screens/sync', query: undefined, body: JSON.stringify({ dir: 'C:\\p\\site' }) });
});

// ---- registry-error toast rule (V4-4, decision C) ----

test('registry errors toast once per distinct message and re-arm on clear', () => {
  assert.deepEqual(shouldToastRegistryError(null, 'screens.json: bad'), { toast: true, key: 'screens.json: bad' });
  assert.deepEqual(shouldToastRegistryError('screens.json: bad', 'screens.json: bad'), { toast: false, key: 'screens.json: bad' }, 'the same error across poll ticks stays silent');
  assert.deepEqual(shouldToastRegistryError('screens.json: bad', 'screens.json: other'), { toast: true, key: 'screens.json: other' }, 'a NEW distinct message toasts');
  assert.deepEqual(shouldToastRegistryError('screens.json: other', null), { toast: false, key: null }, 'clearing never toasts');
  assert.deepEqual(shouldToastRegistryError('screens.json: other', undefined), { toast: false, key: null }, 'absent reads as cleared');
  assert.deepEqual(shouldToastRegistryError('screens.json: other', '  '), { toast: false, key: null }, 'whitespace is not an error');
  assert.deepEqual(shouldToastRegistryError(null, 'again'), { toast: true, key: 'again' }, 'after a clear, the SAME message is a fresh episode');
  assert.match(registryErrorToastMessage('screens.json: bad'), /screens\.json: bad/, 'the toast quotes the registry error');
});

test('WORKSPACE_MISSING is the exact code the V4-15 recovery keys on', () => {
  assert.equal(WORKSPACE_MISSING_CODE, 'WORKSPACE_MISSING');
});

test('focusLive posts /focus and closeLive posts /close', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  await focusLive();
  await closeLive();
  assert.deepEqual(calls.map((call) => call.path), ['/focus', '/close']);
  assert.equal(calls[0]!.method, 'POST');
});

test('a non-200 service answer surfaces as ServiceUnavailable', async () => {
  stubService(() => ({ status: 500, body: JSON.stringify({ error: 'window failed to open' }) }));
  await assert.rejects(() => openWorkspace({ dir: '/p/site' }), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailable);
    assert.match((error as Error).message, /window failed to open/);
    return true;
  });
});

// ---- cross-platform path compares (spec §F, audit #11) ----

test('normalizeDirPath folds separators and drive-letter case, trims trailing slashes', () => {
  assert.equal(normalizeDirPath('C:\\Users\\Sam\\Docs\\Site'), 'c:/Users/Sam/Docs/Site');
  assert.equal(normalizeDirPath('c:/users/sam/docs/site'), 'c:/users/sam/docs/site');
  assert.equal(normalizeDirPath('C:/Users/Sam/Docs/Site/'), 'c:/Users/Sam/Docs/Site', 'a trailing separator is trimmed');
  assert.equal(normalizeDirPath('/home/sam/site'), '/home/sam/site', 'POSIX paths stay byte-identical');
});

test('sameDirPath matches across separator and drive-case differences only', () => {
  assert.equal(sameDirPath('C:\\Users\\Sam\\Site', 'c:/Users/Sam/Site'), true, 'separators and the drive letter fold');
  assert.equal(sameDirPath('C:\\Users\\Sam\\Site', 'c:/users/sam/Site'), false, 'path-segment case is NOT folded — only the drive letter is');
  assert.equal(sameDirPath('/home/sam/site', '/home/sam/site'), true);
});

test('pathContains is a normalized, separator-aware prefix match', () => {
  assert.equal(pathContains('/p/site', '/p/site'), true, 'the workspace IS its own root');
  assert.equal(pathContains('C:\\Users\\Sam', 'c:/Users/Sam/site'), true, 'drive case and separators normalize');
  assert.equal(pathContains('/p/site', '/p/siteX'), false, 'no separator, no containment');
  assert.equal(pathContains('/p/site', '/p'), false, 'a parent is not inside the root');
});

// ---- slug creation (spec §F + decision 3) ----

test('canvasSlug kebab-sanitizes the brief and appends the session tail, ≤40 chars', () => {
  assert.equal(canvasSlug('Checkout Flow!!', 'ses_3F2Ad8'), 'checkout-flow-3f2ad8');
  assert.match(canvasSlug('A really very extremely long brief about absolutely everything at once', 'ses_abc123'), /^[a-z0-9-]+$/);
  assert.ok(canvasSlug('A really very extremely long brief about absolutely everything at once', 'ses_abc123').length <= WORKSPACE_SLUG_LIMIT);
  assert.equal(canvasSlug('', 'ses_abc123'), 'canvas-abc123', 'a blank brief still yields a canvas-<tail> slug');
});

test('uniqueCanvasSlug avoids every existing workspace dir basename', () => {
  const first = uniqueCanvasSlug('landing', 'ses_one', ['/root/landing-one', '/root/other-two']);
  assert.equal(first, 'landing-one-2', 'the -2 suffix dodges the occupied landing-one');
  const plain = uniqueCanvasSlug('landing', 'ses_one', ['/root/other']);
  assert.equal(plain, 'landing-one', 'no clash, no suffix');
});

test('joinWorkspaceDir joins the SERVICE-provided root with the slug, honoring its separators', () => {
  assert.equal(joinWorkspaceDir('C:\\Users\\Sam\\Documents\\Design Canvas', 'landing-3f2a'), 'C:\\Users\\Sam\\Documents\\Design Canvas\\landing-3f2a');
  assert.equal(joinWorkspaceDir('/home/sam/Documents/Design Canvas', 'landing-3f2a'), '/home/sam/Documents/Design Canvas/landing-3f2a');
  // The panel never constructs the Documents path itself (decision 3): the root
  // arrives verbatim from GET /workspaces and only the slug is appended.
  assert.ok(joinWorkspaceDir('/root/', 'slug').startsWith('/root/'));
});

test('screenUrl joins a workspace-relative file onto the base url (decision 6)', () => {
  assert.equal(screenUrl('http://localhost:5173/', 'checkout.html'), 'http://localhost:5173/checkout.html');
  assert.equal(screenUrl('http://localhost:5173', 'home.html'), 'http://localhost:5173/home.html');
});

// ---- the canvas target (pure, spec §F) ----

test('resolveCanvasTarget reuses the session workspace and adds the decision 4c projectId', () => {
  assert.deepEqual(
    resolveCanvasTarget({ workspace: { dir: '/p/site', name: 'Site' }, brief: '', projects: [{ id: 'p1', name: 'Site', directory: '/p/site' }] }),
    { kind: 'workspace', dir: '/p/site', name: 'Site', projectId: 'p1' },
  );
  assert.deepEqual(
    resolveCanvasTarget({ workspace: { dir: '/p/site', name: 'Site' }, brief: '', projects: [] }),
    { kind: 'workspace', dir: '/p/site', name: 'Site' },
    'no registered project: no projectId — the session starts WITHOUT one (decision 2)',
  );
});

test('resolveCanvasTarget falls to new with the brief when no workspace is bound', () => {
  assert.deepEqual(
    resolveCanvasTarget({ workspace: null, brief: '  landing page  ', projects: [] }),
    { kind: 'new', brief: 'landing page' },
  );
  assert.deepEqual(
    resolveCanvasTarget({ workspace: { dir: '   ', name: '' }, brief: 'landing', projects: [] }),
    { kind: 'new', brief: 'landing' },
    'a blank dir record is not a workspace',
  );
});

// ---- the ws/ scan + workspaces join (audit #19 + decision 2) ----

test('wsSessionIdFromKey is the inverse of workspaceStorageKey', () => {
  assert.equal(wsSessionIdFromKey(workspaceStorageKey('ses_1')!), 'ses_1');
  assert.equal(wsSessionIdFromKey(workspaceStorageKey('a/b')!), 'a/b', 'the id keeps its own slashes');
  assert.equal(wsSessionIdFromKey('mode/ses_1'), null, 'only ws/ keys name a session');
  assert.equal(wsSessionIdFromKey('ws/'), null, 'a bare prefix names nothing');
  assert.equal(wsSessionIdFromKey('ws-permission-notified'), null, 'the flat permission key never parses as a session');
});

test('isWorkspaceRecord accepts a real record and refuses junk', () => {
  assert.equal(isWorkspaceRecord({ dir: '/p/site', name: 'Site' }), true);
  assert.equal(isWorkspaceRecord({ dir: '/p/site' }), true, 'a name is optional');
  assert.equal(isWorkspaceRecord({ dir: '  ', name: 'x' }), false);
  assert.equal(isWorkspaceRecord({ name: 'x' }), false);
  assert.equal(isWorkspaceRecord(null), false);
  assert.equal(isWorkspaceRecord('ws/x'), false);
});

test('joinWorkspaceSessions maps dirs through normalization and NEVER drops a row', () => {
  const rows = [
    { dir: 'C:\\Users\\Sam\\Design Canvas\\a-1', name: 'a' },
    { dir: '/p/un-mapped', name: 'b', url: 'http://localhost:5173' },
  ];
  // The scan maps the STORED dir through the same normalization the rows go
  // through (audit #11: separators and drive-letter case only).
  const map = new Map<string, string>([[normalizeDirPath('c:\\Users\\Sam\\Design Canvas\\a-1'), 'ses_a']]);
  const joined = joinWorkspaceSessions(rows, map);
  assert.deepEqual(joined, [
    { dir: 'C:\\Users\\Sam\\Design Canvas\\a-1', name: 'a', sessionId: 'ses_a' },
    { dir: '/p/un-mapped', name: 'b', url: 'http://localhost:5173', sessionId: null },
  ]);
  assert.deepEqual(rows, [
    { dir: 'C:\\Users\\Sam\\Design Canvas\\a-1', name: 'a' },
    { dir: '/p/un-mapped', name: 'b', url: 'http://localhost:5173' },
  ], 'the input rows are untouched');
});

test('workspaceMeta shows the served url, else the directory', () => {
  assert.equal(workspaceMeta({ dir: '/p/site', name: 'Site', url: 'http://localhost:5173' }), 'http://localhost:5173');
  assert.equal(workspaceMeta({ dir: '/p/site', name: 'Site' }), '/p/site');
});

// ---- copy pinned (fork identity, decision 1 + §F) ----

test('the list copy is fixed', () => {
  assert.equal(DESIGN_READY_BADGE, 'Canvas ready');
  assert.equal(NO_CONFIG_BADGE, 'No dev server yet');
  assert.equal(NO_DESIGN_WORK_MESSAGE, 'No canvas workspaces yet — /canvas creates one.');
  assert.equal(NO_WORKSPACE_MESSAGE, 'No canvas workspace yet — Start creates one.');
  assert.equal(PICK_HINT, 'Click an element in the canvas, then Reference in chat.', 'R2/R5: a click selects; Reference in chat sends');
  assert.match(ATTACH_NEEDS_URL, /http\(s\)/);
  assert.match(NO_PROJECT_URL_MESSAGE, /No \.design-studio\.json url/);
});

test('canvasSessionStatus states the workspace and its readiness', () => {
  assert.equal(
    canvasSessionStatus({ modeOn: true, workspaceDir: 'C:\\Docs\\Design Canvas\\landing', wsReady: true }),
    'Design session · workspace C:\\Docs\\Design Canvas\\landing',
  );
  assert.equal(
    canvasSessionStatus({ modeOn: true, workspaceDir: '/p/site', wsReady: false }),
    'Design session · /p/site (no .design-studio.json url yet)',
  );
  assert.equal(
    canvasSessionStatus({ modeOn: false, workspaceDir: '/p/site', wsReady: true }),
    'Design Mode is off — turn it on to open the canvas',
  );
});

test('pickHintActive is active only while the window is open', () => {
  assert.equal(pickHintActive({ windowOpen: true }), true);
  assert.equal(pickHintActive({ windowOpen: false }), false);
});

test('formatOpenStatus summarizes the open result', () => {
  assert.equal(formatOpenStatus({ ok: true, url: 'u', title: '', settled: true }), 'Window open');
  assert.equal(
    formatOpenStatus({ ok: true, url: 'u', title: '', settled: true, started: true }),
    'Dev server started · window open',
  );
  assert.equal(formatOpenStatus({ ok: false, url: '', title: '', settled: false }), 'Could not open the window');
  const failure = 'the dev server is not running and .design-studio.json has no "command" to start it';
  assert.equal(formatOpenStatus({ ok: false, url: '', title: '', settled: false, error: failure }), failure);
});

test('projectReady is true only for a config with a non-empty url', () => {
  assert.equal(projectReady(null), false);
  assert.equal(projectReady(undefined), false);
  assert.equal(projectReady({}), false);
  assert.equal(projectReady({ url: '' }), false);
  assert.equal(projectReady({ url: '   ' }), false);
  assert.equal(projectReady({ url: 'http://localhost:5173' }), true);
  assert.equal(projectReady({ url: '  http://localhost:5173  ' }), true);
});

test('isLoopbackUrl gates the auto dev-server start to loopback hosts only', () => {
  assert.equal(isLoopbackUrl('http://localhost:5173'), true);
  assert.equal(isLoopbackUrl('http://127.0.0.1:5999'), true);
  assert.equal(isLoopbackUrl('https://example.com'), false, 'a remote url never starts a local server');
  assert.equal(isLoopbackUrl('not a url'), false);
});

test('shouldStopDevServer: all three inputs must hold', () => {
  assert.equal(shouldStopDevServer({ busy: false, otherActiveDesignSessions: 0, startedByUs: true }), true);
  assert.equal(shouldStopDevServer({ busy: true, otherActiveDesignSessions: 0, startedByUs: true }), false);
  assert.equal(shouldStopDevServer({ busy: false, otherActiveDesignSessions: 1, startedByUs: true }), false);
  assert.equal(shouldStopDevServer({ busy: false, otherActiveDesignSessions: 0, startedByUs: false }), false);
});

test('countOtherActiveDesignSessions skips self and idle sessions', () => {
  const idle = () => ({ id: 'a', items: [], activity: 'idle' as const });
  assert.equal(countOtherActiveDesignSessions([{ ...idle(), id: 'me' }, { ...idle(), id: 'other' }], 'me', new Set(['other'])), 0, 'idle sessions never count');
  assert.equal(
    countOtherActiveDesignSessions([{ ...idle(), activity: 'running' as const, items: [{ id: 'x', data: { mode: { on: true } } }] }], null, new Set()),
    1,
    'a busy design session counts',
  );
});

test('allProjectsFromSnapshot maps only a ready snapshot', () => {
  assert.deepEqual(allProjectsFromSnapshot({ state: 'ready', projects: [{ id: 'p1', name: 'Site', directory: '/p/site' }] }), [
    { id: 'p1', name: 'Site', directory: '/p/site' },
  ]);
  assert.deepEqual(allProjectsFromSnapshot({ state: 'loading', projects: [] }), []);
});

test('session detection: the mode chip data boundary is read loosely', () => {
  assert.equal(isModeChipData({ mode: { on: true } }), true);
  assert.equal(isModeChipData({ mode: { on: true, type: 'deck', brief: 'x' } }), true, 'extra mode fields do not matter');
  assert.equal(isModeChipData({ mode: { on: false } }), false);
  assert.equal(isModeChipData({ mode: null }), false);
  assert.equal(isModeChipData({}), false);
  assert.equal(isModeChipData(null), false);
  assert.equal(isModeChipData('mode/on'), false, 'a bare string is not chip data');
  assert.equal(sessionShowsDesignMode({ items: [{ id: 'x', data: { mode: { on: true } } }] }), true);
  assert.equal(sessionShowsDesignMode({ items: [{ id: 'x' }] }), false);
  assert.equal(sessionShowsDesignMode({ items: [] }), false);
});

test('contrastRatio is a pure colour helper', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.equal(contrastRatio('rgb(255,255,255)', '#000'), 21);
  assert.equal(contrastRatio('oklch(0.5 0.1 10)', '#fff'), null, 'a colour it cannot parse is null, not a guess');
});

test('referenceText builds a canvas reference chip and stamps Screen + Screen URL when given one', () => {
  const pick = {
    selector: 'div.hero',
    tag: 'div',
    classes: 'hero',
    text: 'Hi',
    outerHTML: '<div class="hero">Hi</div>',
    styles: { fontSize: '16px', fontWeight: '700', backgroundColor: '#fff', color: '#123', display: 'normal' },
    rect: { x: 0, y: 0, width: 1, height: 1 },
  };
  const text = referenceText(pick, 'http://localhost:5173/', undefined, { id: 'home', url: 'http://localhost:5173/home.html' });
  assert.match(text, /^Reference from Design Canvas/);
  assert.match(text, /Screen: home/);
  assert.match(text, /Screen URL: http:\/\/localhost:5173\/home\.html/);
  assert.match(text, /URL: http:\/\/localhost:5173\//);
  assert.match(text, /Selector: div\.hero/);
  assert.match(text, /Tag: div {2}Classes: hero/);
  assert.match(text, /Text: "Hi"/);
  assert.match(text, /fontSize: 16px;/);
  assert.match(text, /fontWeight: 700;/);
  assert.match(text, /backgroundColor: #fff;/);
  assert.match(text, /color: #123;/);
  assert.doesNotMatch(text, /display:/, 'neutral values are filtered out');
  assert.match(text, /<div class="hero">Hi<\/div>/);
  assert.doesNotMatch(text, /Picked at/, 'no moment line without a pickedAt');
});

test('referenceText stamps the local pick time when given a date', () => {
  const pick = {
    selector: 'div.hero', tag: 'div', classes: 'hero', text: 'Hi',
    outerHTML: '<div class="hero">Hi</div>', styles: {}, rect: { x: 0, y: 0, width: 1, height: 1 },
  };
  const pickedAt = new Date(2026, 0, 2, 9, 4, 7);
  const text = referenceText(pick, 'http://localhost:5173/', pickedAt);
  assert.match(text, /^Reference from Design Canvas\nPicked at 09:04:07\n/);
  assert.equal((text.match(/Picked at/g) ?? []).length, 1, 'the moment line appears once');
});

// ---- surface dispatch + the rail ----

test('surfaceKind maps status to the row, panel to the rail, page to the home', () => {
  assert.equal(surfaceKind('status'), 'row');
  assert.equal(surfaceKind('panel'), 'rail');
  assert.equal(surfaceKind('background'), 'none');
  assert.equal(surfaceKind('dialog'), 'none');
  assert.equal(surfaceKind('popover'), 'none');
  assert.equal(surfaceKind('page'), 'page');
  assert.equal(surfaceKind(''), 'none');
});

test('the rail panel surface builds the rail: primary button, brief box, work list, sidebar pointer', async () => {
  const text = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /buildPanelNote|PANEL_SIDEBAR_HINT|ds-panel-note/, 'the note-only panel is gone');
  assert.match(text, /kind === 'rail'[\s\S]*buildRail\(root\)/, 'the panel surface draws the rail');
  const rail = text.slice(text.indexOf('export function buildRail('), text.indexOf("/** The rail's one status line"));
  assert.match(rail, /railPrimaryBtn = q<HTMLButtonElement>\('button', 'primary ds-rail-primary'\)/, 'one full-width primary action');
  assert.match(rail, /railPromptEl = q<HTMLTextAreaElement>\('textarea', 'ds-rail-input'\)/, 'a compact brief box');
  assert.match(rail, /railPromptEl\.rows = 3/);
  assert.match(rail, /railWorkEl = q\('div', 'ds-rail-work'\)/, 'the work list container');
  assert.match(text, /const RAIL_FOOTER_HINT = 'Full home: Design Canvas in the sidebar\.'/, 'a text hint, not a button (openSurface cannot open the sidebar page)');
  const css = await readFile(new URL('../panel/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.ds-rail \{/, 'the rail has its own styles');
  assert.doesNotMatch(css, /\.ds-panel-note/, 'the dead note styles are gone');
});

test('the row surfaces share one builder, the page has its own, and no mount opens a window', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const buildStart = source.indexOf('function build(');
  const mainStart = source.indexOf('async function main(');
  assert.ok(buildStart > 0 && mainStart > buildStart, 'source markers are present');
  const dispatch = source.slice(buildStart, mainStart);
  assert.match(dispatch, /kind === 'row'[\s\S]*buildRow\(root\)/, 'the row surfaces draw the shared row');
  assert.match(dispatch, /kind === 'page'[\s\S]*buildPage\(root\)/, 'the page draws its own builder');
  assert.equal(count(source, 'function buildRow('), 1, 'one shared row builder');
  assert.equal(count(source, 'function buildPage('), 1, 'one page builder');
  const buildersStart = source.indexOf('function buildRow(');
  const builders = source.slice(buildersStart, mainStart);
  for (const region of [builders]) {
    assert.doesNotMatch(region, /openWorkspace\(/, 'no service open in a builder');
    assert.doesNotMatch(region, /openCanvasWindow\(/, 'no window open in a builder');
  }
  // The rail is the panel surface — the same one the hidden 1×1 resolve pane
  // mounts. Its builder opens nothing either; the behavioral proof (a 1×1
  // frame mounts with ZERO service calls, storage writes or opens) is the
  // real-mount test in rail.test.ts.
  assert.match(dispatch, /kind === 'rail'[\s\S]*buildRail\(root\)/, 'the panel surface draws the rail');
  const railBuilder = source.slice(source.indexOf('export function buildRail('), source.indexOf("/** The rail's one status line"));
  assert.doesNotMatch(railBuilder, /openWorkspace\(|openCanvasWindow\(|focusLive\(|beginOpenHandoff\(|setInterval\(/, 'the rail shell opens, claims and schedules nothing');
  const mount = source.slice(source.indexOf('function mountSurface('), mainStart);
  assert.match(mount, /kind === 'rail'\) \{\s*startRailLive\(\)/, 'the rail goes live only through startRailLive');
  const live = source.slice(source.indexOf('function startRailLive('), source.indexOf('function onRailWake('));
  assert.match(live, /!isRealPane\(\)\) return/, 'startRailLive refuses a 1×1 frame');
});

// ---- the canvas row (spec §F: Start/Stop + play/edit + screen dropdown + Focus) ----

test('the row carries Start/Stop, Design Mode, play/edit, the screen dropdown and Focus', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  assert.match(source, /serverBtn = q<HTMLButtonElement>\('button', 'ds-server-control'\)/, 'the Start/Stop control stays');
  assert.match(source, /modeToggleBtn = q<HTMLButtonElement>\('button', 'primary'\)/, 'the Design Mode toggle stays');
  assert.match(source, /playToggleBtn = q<HTMLButtonElement>\('button', 'ds-chip ds-play-toggle'\)/, 'the play/edit toggle exists');
  assert.match(source, /screenSelectEl = q<HTMLSelectElement>\('select', 'ds-screen-select'\)/, 'the active-screen dropdown exists');
  assert.match(source, /focusLiveBtn = q<HTMLButtonElement>\('button', 'ds-chip ds-focus'\)/, 'the Focus action is back for the canvas');
  assert.match(source, /bar\.append\(serverBtn, modeToggleBtn, playToggleBtn, screenSelectEl, focusLiveBtn\)/, 'all five controls share the one bar');
  assert.match(source, /screenSelectEl\.addEventListener\('change', \(\) => void onScreenSelectChange\(\)\)/, 'the dropdown switches the active screen');
  assert.match(source, /const result = await setMode\(next\)/, 'the play/edit toggle posts POST /mode');
});

test('the row NEVER hides: an absent workspace shows Start as "Create canvas" (spec §F)', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const controlStart = source.indexOf('function renderServerControl(');
  const control = source.slice(controlStart, source.indexOf('async function onServerControlClick('));
  assert.match(control, /!ws\)/, 'the no-workspace branch exists');
  assert.match(control, /'Create canvas — start a Design Canvas workspace'/, 'Start reads create-canvas on first use');
  assert.match(control, /serverBtn\.hidden = false/, 'the control never hides before first use');
  const rowStart = source.indexOf('function renderRow(');
  const row = source.slice(rowStart, source.indexOf('export async function applyState('));
  assert.match(row, /barEl\.classList\.toggle\('hidden', false\)/, 'the bar is always present');
  assert.equal(/(NO_PROJECT_CONFIG_MESSAGE|NO_PROJECT_URL_MESSAGE)[^\n]*no way to hide/.test(source), false, 'the not-set-up fallback is gone entirely');
  assert.doesNotMatch(source, /NO_PROJECT_CONFIG_MESSAGE/, 'the old "not set up" copy is gone');
});

test('the play/edit toggle and dropdown render from GET /state mode and screens', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const stateStart = source.indexOf('export async function applyState(');
  const pollStart = source.indexOf('async function poll()');
  const apply = source.slice(stateStart, pollStart);
  assert.match(apply, /stateData\.mode === 'edit' \|\| stateData\.mode === 'play'\) state\.liveMode = stateData\.mode/, 'the mode comes from /state');
  assert.match(apply, /state\.liveScreens = stateData\.screens\.map/, 'the screens come from /state');
  assert.match(apply, /state\.activeScreen = stateData\.activeScreen/, 'the active screen comes from /state');
  const controlsStart = source.indexOf('function renderCanvasControls(');
  const controls = source.slice(controlsStart, source.indexOf('async function onPlayToggleClick('));
  assert.match(controls, /playToggleBtn\.textContent = mode === 'play' \? 'Play' : 'Edit'/, 'the toggle reads Play/Edit');
  assert.match(controls, /screenSelectEl\.replaceChildren\(\)/, 'the dropdown options are rebuilt from liveScreens');
});

// ---- the workspaces list (decision 2: design work = /workspaces rows) ----

test('the page builds the workspaces list from GET /workspaces joined with the cached ws/ scan', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  assert.match(source, /function renderCanvasSection\(/, 'one workspaces section');
  assert.match(source, /'Your design work'/, 'the heading stays');
  assert.match(source, /async function loadCanvasWorkspaces\(/, 'the list loads from the service');
  const loader = source.slice(
    source.indexOf('async function loadCanvasWorkspaces('),
    source.indexOf('async function loadDesignHome('),
  );
  assert.match(loader, /result = await getWorkspaces\(\)/, 'the rows are GET /workspaces rows');
  assert.match(loader, /joinWorkspaceSessions\(rows, wsSessionMap\)/, 'the rows join against the cached ws/ scan');
  assert.doesNotMatch(loader, /host\.listSessions/, 'no host.listSessions(projectId) feeds the work list (decision 2)');
  assert.match(source, /async function readWorkspaceSessionMap\(/, 'one scan per refresh');
  const scan = source.slice(
    source.indexOf('async function readWorkspaceSessionMap('),
    source.indexOf('async function loadCanvasWorkspaces('),
  );
  assert.match(scan, /keys = await host\.storage\.keys\(\)/, 'a single storage.keys() pass (audit #19)');
});

test('a workspace row opens its session when mapped, else starts a new one carrying the open prompt', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const rowStart = source.indexOf('async function openWorkspaceListRow(');
  const row = source.slice(rowStart, source.indexOf('// ---- live window state ----'));
  assert.match(row, /await host\.openSession\(row\.sessionId\)/, 'a mapped workspace reuses its session');
  assert.match(row, /providerId: 'design-canvas'/, 'a new session is canvas-branded');
  assert.match(row, /url: attachUrl\(row\.url\)/, 'the session carries the workspace url');
  assert.match(row, /text: workspaceOpenPrompt\(record\)/, 'the session carries the open prompt');
  assert.match(row, /host\.storage\.set\(workspaceStorageKey\(result\.sessionId\)!, record\)/, 'the workspace binds to the created session');
  const listStart = source.indexOf('function renderWorkspaceListRow(');
  const list = source.slice(listStart, rowStart);
  assert.equal(/(configError)/.test(list), false, 'no config-error line can hide a workspace — rows never drop');
});

// ---- the composer + page (project-free) ----

test('the page builds the creation home: no registered-project gate anywhere', async () => {
  const text = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  assert.match(text, /function renderPage\(/, 'the page has its own renderer');
  assert.match(text, /function renderHeader\(/, 'the header is built');
  assert.match(text, /'Design on a live canvas'/, 'the title says what it is');
  assert.match(text, /function renderComposer\(/, 'the composer is built');
  assert.match(text, /function renderContextRow\(/, 'the project/designs context row is built');
  assert.match(text, /function renderStarters\(/, 'the starter cards are built');
  assert.match(
    text,
    /renderHeader\(\), \.\.\.\(firstRun \? \[firstRun\] : \[\]\), renderComposer\(\), renderContextRow\(\), renderStarters\(\), renderCanvasSection\(\), renderFooter\(\)/,
    'the one list mounts below the starters, closed by the footer',
  );
  assert.doesNotMatch(text, /function renderDirRow\(/, 'the registered working-directory selector is gone');
  assert.doesNotMatch(text, /NEEDS_PROJECT_MESSAGE/, 'no needs-project refusal remains');
  assert.doesNotMatch(text, /function buildDialog\(/, 'the wizard is gone');
  assert.match(text, /plus\.disabled = state\.pageBusy \|\| referencePending/, 'the + gate is busy-state only — no project target');
  assert.match(text, /q\('div', 'ds-eyebrow', 'Design Canvas'\)/, 'the eyebrow names the canvas');
  assert.match(text, /in any chat opens the canvas there/, 'the footer points at /canvas');
});

test('P4: the old creation-page remnants are gone from the page and its styles', async () => {
  const text = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const css = await readFile(new URL('../panel/styles.css', import.meta.url), 'utf8');
  for (const gone of [/Let's create /, /Good work starts here/, /function renderHero\(/, /function renderIdeas\(/, /function ideaThumb\(/, /const IDEAS\b/, /function renderOptions\(/, /function field\(/, /ds-composer-accent/, /'\+ Create'/, /function renderWorkspaceRow\(/]) {
    assert.doesNotMatch(text, gone, `main.ts no longer has ${gone}`);
  }
  for (const gone of [/\.ds-hero/, /\.ds-composer-accent/, /\.ds-options\b/, /\.ds-field\b/, /\.ds-ds-create/, /\.ds-ideas?\b/, /\.ds-thumb-/]) {
    assert.doesNotMatch(css, gone, `styles.css no longer has ${gone}`);
  }
  for (const added of ['.ds-header', '.ds-eyebrow', '.ds-title', '.ds-lede', '.ds-toggles', '.ds-switch[role="switch"][aria-checked="true"]', '.ds-seg', '.ds-counter', '.ds-context', '.ds-look-tabs', '.ds-device-list', '.ds-starters', '.ds-starter', '.ds-glyph', '.ds-hints kbd']) {
    assert.ok(css.includes(added), `styles.css styles ${added}`);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*\.ds-starter/, 'the starter hover lift honours reduced motion');
});

test('P4: the composer wires the Look/Devices chips, toggles, Structure brief and the brief limit', async () => {
  const text = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  assert.match(text, /export type OverlayId = 'type' \| 'look' \| 'devices' \| 'attach';/, 'the overlay contract: look + devices replace ds');
  assert.match(text, /setAttribute\('role', 'tablist'\)/, 'the Look popover has tabs');
  assert.match(text, /'Match this project'/);
  assert.match(text, /'Open a project in OpenChamber to use this'/, 'the Project look is gated on an open project');
  assert.match(text, /q<HTMLButtonElement>\('button', 'ds-ds-clear', 'No preset'\)/, 'Clear reads "No preset"');
  assert.match(text, /setAttribute\('role', 'switch'\)/, 'Questions first is a real switch');
  assert.match(text, /setAttribute\('role', 'radiogroup'\)/, 'Options is a segmented radio group');
  assert.match(text, /structureBrief\(state\.prompt, \{ devices: state\.pageDevices \}\)/, 'Structure brief applies the mode.ts skeleton');
  assert.match(text, /const tooLong = briefLimitError\(spec\.brief\)/, 'the brief limit uses the shared refusal');
  assert.match(text, /fidelity: FIDELITY_FOR_TYPE\[state\.pageType\]/, 'fidelity follows the type');
  assert.match(text, /projectDir: state\.directory/, 'the open project rides on the spec');
  assert.match(text, /const PAGE_PREFS_KEY = 'prefs\/page'/);
  assert.match(text, /const WORK_LIST_CAP = 5;/, 'the work list caps at five rows');
  assert.match(text, /`Show all \(\$\{view\.rows\.length\}\)`/);
  assert.match(text, /renderLocationRow\(pageLocationEl\)/, 'the context row reuses the R5 designs-location line');
});

test('P4: briefTitle takes the first clause, drops a Goal: label and caps at 40', () => {
  assert.equal(main.briefTitle('Budget app onboarding — 3 screens, phone first'), 'Budget app onboarding');
  assert.equal(main.briefTitle('Goal: a short pitch deck.\nSlides: problem'), 'A short pitch deck');
  assert.equal(main.briefTitle('x'.repeat(80)).length, 40);
  assert.equal(main.briefTitle('   '), '');
});

test('startDesignSession is canvas-branded and starts WITHOUT projectId by default (decision 2)', async () => {
  const text = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const start = text.indexOf('async function startDesignSession(');
  const body = text.slice(start, text.indexOf('if (!result.sessionId', start));
  assert.ok(start > 0 && body.length > 0, 'the startDesignSession source is present');
  assert.match(body, /providerId: 'design-canvas'/, 'the session is canvas-branded');
  assert.match(body, /\.\.\.\(spec\.projectId \? \{ projectId: spec\.projectId \} : \{\}\)/, 'projectId rides only on the decision 4c upgrade path');
  assert.match(body, /navigation: 'preserve'/);
  assert.doesNotMatch(body, /ensureHarness/, 'no harness plugin is written (decision 5)');
});

test('the /canvas resolver ensures the workspace, switches modes via POST /mode and returns the chip', async () => {
  const text = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const start = text.indexOf('async function resolveCanvasCommand(');
  const end = text.indexOf('// ---- canvas sessions ----');
  const resolver = text.slice(start, end);
  assert.match(resolver, /const parsed = parseDesignArgs\(args\)/);
  assert.match(resolver, /await toggleMode\(false\)/, 'off turns the mode off');
  assert.match(resolver, /await setMode\(parsed\.mode\)/, 'play/edit posts POST /mode');
  assert.match(resolver, /const ws = await prepareCanvasWorkspace\(parsed\.brief, state\.sessionId, modeScaffoldChoice\(parsed\.type\), \{ notify: false \}\)/, 'F3: the resolve awaits only the FAST half (files + ws/), with the parsed type (F8)');
  assert.match(resolver, /if \(!state\.sessionId\) throw new Error\(NO_SESSION_MESSAGE\)/, 'F2: no session → a thrown, user-actionable message');
  assert.match(resolver, /await armDesignModeForRow\(ws, parsed\.type, parsed\.brief \|\| undefined\)/, 'F3: install/boot/open are handed to the status row');
  assert.doesNotMatch(resolver.slice(0, resolver.indexOf('async function readWorkspaceUrl(')), /toggleMode\(true|runScaffoldJob|openCanvasWindow/, 'F3: nothing long-lived runs inside the resolve');
  assert.match(resolver, /return buildModeChip\(state\.sessionId, state\.mode, state\.workspace, currentScreens\(\), url\)/, 'the chip carries the workspace and screens');
});

test('the workspace scaffold creates under the SERVICE root via a unique slug (decision 3)', async () => {
  const text = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const start = text.indexOf('async function scaffoldCanvasWorkspace(');
  const end = text.indexOf('async function ensureCanvasWorkspace(');
  const scaffold = text.slice(start, end);
  assert.match(scaffold, /result = await getWorkspaces\(\)/, 'the root comes from GET /workspaces — never constructed');
  assert.match(scaffold, /uniqueCanvasSlug\(brief \|\| 'canvas', seed, result\.workspaces\.map\(\(row\) => row\.dir\)\)/, 'a clash-free slug against existing dirs');
  assert.match(scaffold, /const dir = joinWorkspaceDir\(result\.root, slug\)/, 'the dir joins the SERVICE root');
  assert.match(scaffold, /await scaffoldProject\(dir, \{/, 'POST /scaffold into <root>/<slug>');
  assert.doesNotMatch(scaffold, /homedir|USERPROFILE|ONE[A-Z]*DRIVE|Documents/, 'no Documents path construction');
});

test('the first scaffold toasts the one-time permission heads-up (decision 4b)', async () => {
  const text = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  assert.match(text, /const PERMISSION_TOAST_KEY = 'ws-permission-notified'/, 'the one-time flag key');
  assert.match(text, /async function maybeShowPermissionToast\(dir: string\)/, 'the heads-up lives once');
  const copySource = await readFile(new URL('../panel/copy.ts', import.meta.url), 'utf8');
  assert.match(copySource, /approve its file-edit permission prompts/i, 'the copy says to approve the prompts');
  assert.match(text, /await maybeShowPermissionToast\(dir\)/, 'it fires from the scaffold');
});

// ---- config reads target the WORKSPACE dir, never the chat dir ----

test('config and dev-server reads resolve against the workspace dir', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const apiSource = await readFile(new URL('../panel/api.ts', import.meta.url), 'utf8');
  const readStart = source.indexOf('async function readStudioConfig(');
  const read = source.slice(readStart, source.indexOf('/** Read the workspace config'));
  assert.match(read, /const dir = workspaceDir\(\)/, 'the config read uses the workspace dir');
  const openStart = source.indexOf('async function openCanvasWindow(');
  const open = source.slice(openStart, source.indexOf('async function handleMissingWorkspace('));
  assert.match(open, /await openWorkspace\(\{ dir: ws\.dir, focus: true \}\)/, 'POST /open {dir, focus:true}: a user-initiated open raises the window (V4-8), all screens');
  assert.match(open, /result\.code === WORKSPACE_MISSING_CODE/, 'V4-15: the missing-workspace answer is acted on, not just shown');
  const missing = source.slice(source.indexOf('async function handleMissingWorkspace('), source.indexOf('/**\n * Raise the workspace of a workspaces-list row'));
  assert.match(missing, /host\.storage\.delete\(key\)/, 'the ws/ record is deleted, not shadowed');
  assert.match(missing, /state\.workspace = null/, 'the session unbinds so Start re-offers "Create canvas"');
  const copySource = await readFile(new URL('../panel/copy.ts', import.meta.url), 'utf8');
  assert.match(missing, /copy\.missingWorkspace\(/, 'the toast goes through the shared wording');
  assert.match(copySource, /Start creates a new canvas\./, 'the toast offers the next action');
  assert.match(source, /await openWorkspace\(\{ dir: row\.dir, focus: true \}\)/, 'the page Preview row is user-initiated too');
  assert.match(source, /await openWorkspace\(\{ dir: ws\.dir, screen: id, focus: false \}\)/, 'the screen dropdown never raises the window (V4-8)');
  assert.doesNotMatch(source, /FORK-MERGE:?\s*panel\/styles\.css/, 'no unfilled style notes left for the row');
  // V4-13 dock — the seam is the INPUT TYPE (the runtime proof lives in
  // mode-open: every /open body deep-equals {dir[,screen],focus} — no dock key),
  // because a bare `dock` grep would hit the FORK-MERGE note itself.
  assert.match(apiSource, /export function openWorkspace\(input: \{ dir: string; screen\?: string; focus\?: boolean \}\)/, 'the /open seam accepts NO dock rect (V4-13 skipped — no host geometry API)');
  assert.match(source, /FORK-MERGE \(V4-13 dock/, 'the skip is filed as FORK-MERGE with the reason');
});

test('the pick pipeline is the V4-5 queue: long-poll, ordered attach, ack after delivery', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const queueStart = source.indexOf('// ---- the pick queue');
  assert.ok(queueStart > 0, 'the pick-queue section exists');
  const queue = source.slice(queueStart, source.indexOf('// ---- the canvas window ----'));
  assert.match(queue, /getPicks\(pickCursor, waitMs\)|pollPicksOnce\(PICK_LONG_POLL_MS\)/, 'delivery long-polls GET /picks from the since-cursor');
  assert.match(queue, /export const PICK_LONG_POLL_MS = 12_000/, 'wait=12000 — the §3 long-poll window');
  assert.match(queue, /export const PICK_SHORT_POLL_MS = 250/, 'error fallback: wait=0 short polls every 250 ms');
  assert.match(queue, /export const PICK_SHORT_POLL_BUDGET_MS = 30_000/, '…for a 30 s budget, then the long-poll retries');
  assert.match(queue, /\[...picks\]\.sort\(\(a, b\) => a\.seq - b\.seq\)/, 'batches deliver in SEQ ORDER');
  assert.match(queue, /if \(!\(await addToChat\(entry\)\)\) break/, 'a failed attach stops the batch — no ack past it, the queue retries it');
  assert.match(queue, /advanceTo = entry\.seq;\s*\}\s*if \(advanceTo === pickCursor\) return false;\s*pickCursor = advanceTo;/, 'the cursor moves only past delivered (or foreign, passed-over) picks');
  assert.match(queue, /await ackPicks\(lastDelivered\.seq, batchAckLabel\(delivered, lastDelivered\)\)/, 'ONE ack with the last delivered seq + label');
  assert.match(queue, /export const PICK_IDLE_POLL_MS = 150;/, 'R5: the idle pace is 150 ms');
  assert.match(queue, /if \(!pickBelongsHere\(entry\)\) \{\s*advanceTo = entry\.seq;\s*continue;\s*\}/, 'R5: a foreign-dir pick is passed over without attach or ack');
  assert.match(queue, /if \(!state\.mode\.on\) break/, 'mode-off HOLDS delivery (fence §5)');
  assert.doesNotMatch(queue, /bridgeActive/, 'the removed /bridge claim no longer gates delivery');
  assert.doesNotMatch(queue, /document\.visibilityState/, 'the queue loop has NO visibility guard — hidden windows lose nothing');
  assert.match(queue, /void runPickLoop\(\(\) => !pickLoopActive\)/, 'startPickLoop runs exactly one loop — single in-flight request');
  // The old snapshot path is really gone from the state reader:
  const applyStart = source.indexOf('export async function applyState(');
  const apply = source.slice(applyStart, source.indexOf('/** The user closed the live window.'));
  assert.doesNotMatch(apply, /lastPick|pickSeq|state\.lastSeq/, 'applyState no longer consumes lastPick/pickSeq');
  assert.match(apply, /shouldToastRegistryError\(state\.registryErrorNotified, stateData\.registryError \?\? null\)/, 'V4-4: /state.registryError feeds the once-per-message toast rule');
});

test('loadStudioConfig reads the config for display but never opens a window', async () => {
  const calls = stubService((request) =>
    request.path === '/config'
      ? { status: 200, body: JSON.stringify({ config: { version: 1, name: 'Site', url: 'http://localhost:5173' }, path: '/p/site/.design-studio.json' }) }
      : { status: 200, body: JSON.stringify({ ok: true }) },
  );
  setWorkspace({ dir: '/p/site', name: 'Site' });
  await loadStudioConfig();
  assert.equal(calls.some((call) => call.path === '/config'), true, 'reads the config');
  assert.equal(calls.some((call) => call.path === '/open'), false, 'never opens on read');
  setWorkspace(null);
});

test('nextOverlayState toggles, opens and switches with one overlay open at a time', () => {
  assert.equal(nextOverlayState(null, 'look'), 'look');
  assert.equal(nextOverlayState(null, 'devices'), 'devices');
  assert.equal(nextOverlayState(null, 'type'), 'type');
  assert.equal(nextOverlayState(null, 'attach'), 'attach');
  assert.equal(nextOverlayState('look', 'look'), null);
  assert.equal(nextOverlayState('devices', 'devices'), null);
  assert.equal(nextOverlayState('type', 'type'), null);
  assert.equal(nextOverlayState('attach', 'attach'), null);
  assert.equal(nextOverlayState('look', 'devices'), 'devices');
  assert.equal(nextOverlayState('devices', 'type'), 'type');
  assert.equal(nextOverlayState('type', 'attach'), 'attach');
  assert.equal(nextOverlayState('attach', 'look'), 'look');
});

test('a directory switch keeps the last config until the fresh read resolves', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const start = source.indexOf('host.onDirectory((directory) => {');
  const end = source.indexOf('renderRow();', start);
  assert.ok(start > 0 && end > start, 'the onDirectory handler is present');
  const handler = source.slice(start, end);
  assert.doesNotMatch(handler, /state\.config = null/, 'no synchronous config nulling: the row must not flicker');
  assert.match(source, /function currentConfig\(\): StudioConfig \| null/);
  assert.match(source, /return state\.configDir === state\.workspace\?\.dir \? state\.config : null;/, 'the cached config is guarded to the WORKSPACE');
});

test('setProjectDirectory and setWorkspace are independent test seams', () => {
  setProjectDirectory('/chat/dir');
  setWorkspace({ dir: 'C:\\Docs\\Design Canvas\\landing', name: 'landing' });
  setWorkspace(null);
  setProjectDirectory(null);
});

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}