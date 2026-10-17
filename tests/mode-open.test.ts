// Design Mode ON must bring up the canvas workspace's live Chrome window.
//
// The panel bundle runs in a browser frame, so this file installs the same
// minimal shim as panel-open.test.ts and stubs `host.serviceRequest` (and
// `host.toast`) to capture what the panel sends. It imports `panel/main.ts` so
// the real `toggleMode` path is exercised; `main()` no-ops without a host
// `onReady`, so nothing renders and no real Chrome is driven here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

type ServiceRequest = { method: string; path: string; query?: Record<string, string>; body?: string };
type StubResult = { status: number; body: string };
type Toast = { kind: string; message: string };

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

const api = await import('../panel/api.ts');
const main = await import('../panel/main.ts');
const { NO_PROJECT_URL_MESSAGE, ATTACH_NEEDS_URL } = api;
const { toggleMode, setProjectDirectory, setWorkspace, applyState, getModeState, getPendingOpen, loadStudioConfig, loadProjects, resolveCanvasCommand, allowResolve, startNewDesign, setSessionId, attachProjectReference, attachProjectPath, attachDroppedFiles } = main;
const { designMarkerKey, modeStorageKey, workspaceStorageKey } = await import('../panel/mode.ts');

type StartSession = {
  providerId?: string;
  id?: string;
  projectId?: string;
  text?: string;
  navigation?: string;
  data?: unknown;
};

/** Stub `host.startSession` and capture every request. */
function stubStartSession(): StartSession[] {
  const sessions: StartSession[] = [];
  (api.host as unknown as { startSession: (r: StartSession) => Promise<{ sessionId: string; sent: string }> }).startSession = async (request) => {
    sessions.push(request);
    return { sessionId: `s${sessions.length}`, sent: 'sent' };
  };
  (api.host as unknown as { openSession: (id: string) => Promise<void> }).openSession = async () => undefined;
  return sessions;
}

type SnapshotProject = { id: string; name: string; directory: string };

function stubListProjects(projects: SnapshotProject[]): SnapshotProject[] {
  (api.host as unknown as { listProjects: () => Promise<unknown> }).listProjects = async () => ({
    kind: 'projects',
    state: 'ready',
    projects,
  });
  return projects;
}

/** `/config` for a workspace that has a url, as the service answers it. */
const CONFIG_BODY = JSON.stringify({
  config: { version: 1, name: 'Site', url: 'http://localhost:5173' },
  path: '/p/site/.design-studio.json',
});

const NO_CONFIG_BODY = JSON.stringify({ config: null, path: null });

/** GET /workspaces: the service-resolved root plus one existing workspace. */
const WORKSPACES_BODY = JSON.stringify({
  root: 'C:\\Users\\samhe\\Documents\\Design Canvas',
  workspaces: [{ dir: 'C:\\Users\\samhe\\Documents\\Design Canvas\\other-1', name: 'other' }],
});

function stubService(handler: (request: ServiceRequest) => StubResult): ServiceRequest[] {
  const calls: ServiceRequest[] = [];
  (api.host as unknown as { serviceRequest: (r: ServiceRequest) => Promise<StubResult> }).serviceRequest = async (request) => {
    calls.push(request);
    return handler(request);
  };
  return calls;
}

function stubToast(): Toast[] {
  const toasts: Toast[] = [];
  (api.host as unknown as { toast: (t: Toast) => Promise<void> }).toast = async (toast) => {
    toasts.push(toast);
  };
  return toasts;
}

/** In-memory host storage so saveMode/loadMode have somewhere to go. */
function stubStorage(): Map<string, unknown> {
  const store = new Map<string, unknown>();
  (api.host as unknown as { storage: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void>; keys: () => Promise<string[]> } }).storage = {
    get: async (key) => store.get(key),
    set: async (key, value) => {
      store.set(key, value);
    },
    keys: async () => [...store.keys()],
  };
  return store;
}

type AttachChip = { providerId?: string; id?: string; title?: string; url?: string; text?: string };

/** Capture every `host.attach` this panel sends. */
function stubAttach(): AttachChip[] {
  const chips: AttachChip[] = [];
  (api.host as unknown as { attach: (r: AttachChip) => Promise<void> }).attach = async (request) => {
    chips.push(request);
  };
  return chips;
}

/** Known starting point: the window is closed. */
async function resetToClosedWindow(): Promise<void> {
  await applyState({ url: '', title: '', lastPick: null, pickSeq: 0, windowOpen: false });
}

/** A ready workspace, as if `ws/<sessionId>` had been read. */
function useWorkspace(dir = '/p/site', name = 'Site'): void {
  setWorkspace({ dir, name });
}

// ---- the OPEN path (spec §B `POST /open {dir}`) ----

test('toggleMode(true) reads the workspace config and opens the canvas via POST /open {dir}', async () => {
  const calls = stubService((request) => {
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') {
      return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/home.html', title: 'Site', settled: true }) };
    }
    return { status: 404, body: '{}' };
  });
  stubToast();
  stubStorage();
  useWorkspace();
  setSessionId('ses_1');

  await resetToClosedWindow();
  await toggleMode(true);

  const config = calls.find((call) => call.path === '/config');
  assert.ok(config, 'reads .design-studio.json for the workspace dir');
  assert.deepEqual(config!.query, { dir: '/p/site' });

  const open = calls.find((call) => call.path === '/open');
  assert.ok(open, 'turning Design Mode ON opens the live canvas');
  assert.equal(open!.method, 'POST');
  assert.deepEqual(JSON.parse(open!.body ?? ''), { dir: '/p/site' }, 'spec §B: {dir} only — the config url is authoritative');
});

test('toggleMode(true) with the window already open focuses it and never opens a second', async () => {
  const calls = stubService((request) => {
    if (request.path === '/focus') return { status: 200, body: JSON.stringify({ ok: true }) };
    if (request.path === '/open') return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/', title: 'Site', settled: true }) };
    return { status: 404, body: '{}' };
  });
  stubToast();
  useWorkspace();

  await applyState({ url: 'http://localhost:5173/', title: 'Site', lastPick: null, pickSeq: 0, windowOpen: true });
  await toggleMode(true);

  assert.equal(calls.some((call) => call.path === '/focus'), true, 'an open window is focused');
  assert.equal(calls.some((call) => call.path === '/open'), false, 'no second window is spawned');
});

test('toggleMode(false) never opens a window', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  stubToast();
  useWorkspace();

  await toggleMode(false);

  assert.equal(calls.some((call) => call.path === '/open'), false);
});

test('toggleMode(true) without a workspace config url opens nothing and stays silent', async () => {
  const calls = stubService((request) =>
    request.path === '/config'
      ? { status: 200, body: NO_CONFIG_BODY }
      : { status: 200, body: JSON.stringify({ ok: true }) },
  );
  const toasts = stubToast();
  stubStorage(); // empty: no persisted last URL to fall back to
  useWorkspace();
  await loadStudioConfig();

  await resetToClosedWindow();
  await toggleMode(true);

  assert.equal(calls.some((call) => call.path === '/open'), false, 'no url: nothing opens');
  assert.equal(toasts.length, 0, 'no error toast — there is no control to fail');
});

test('toggleMode(true) with no live config falls back to the persisted last URL for the workspace', async () => {
  const calls = stubService((request) => {
    if (request.path === '/config') return { status: 200, body: NO_CONFIG_BODY };
    if (request.path === '/open') {
      return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:6000/home.html', title: 'Restored', settled: true }) };
    }
    return { status: 404, body: '{}' };
  });
  stubToast();
  const store = stubStorage();
  store.set('lastUrl//p/site', 'http://localhost:6000');
  useWorkspace();

  await resetToClosedWindow();
  await toggleMode(true);

  const open = calls.find((call) => call.path === '/open');
  assert.ok(open, 'ON opens the canvas from the persisted URL');
  assert.deepEqual(JSON.parse(open!.body ?? ''), { dir: '/p/site' });
});

test('a failed open still goes through the open path (error is surfaced, not swallowed)', async () => {
  const calls = stubService((request) => {
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') {
      return {
        status: 200,
        body: JSON.stringify({
          ok: false,
          error: 'the dev server is not running and .design-studio.json has no "command" to start it',
        }),
      };
    }
    return { status: 404, body: '{}' };
  });
  stubToast();
  useWorkspace();

  await resetToClosedWindow();
  await toggleMode(true);

  assert.equal(calls.some((call) => call.path === '/open'), true, 'the open was attempted');
});

test('toggleMode(false) closes the live window via /close and opens nothing', async () => {
  const calls = stubService((request) => {
    if (request.path === '/close') return { status: 200, body: JSON.stringify({ ok: true }) };
    return { status: 404, body: '{}' };
  });
  stubToast();
  stubStorage();
  useWorkspace();

  await toggleMode(false);

  const close = calls.find((call) => call.path === '/close');
  assert.ok(close, 'turning Design Mode OFF closes the live window');
  assert.equal(close!.method, 'POST');
  assert.equal(calls.some((call) => call.path === '/open'), false, 'OFF does not open a window');
});

test('a /state poll showing windowOpen:false while Design Mode is ON flips the mode OFF', async () => {
  const calls = stubService((request) => {
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') {
      return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/home.html', title: 'Site', settled: true }) };
    }
    if (request.path === '/close') return { status: 200, body: JSON.stringify({ ok: true }) };
    return { status: 404, body: '{}' };
  });
  stubToast();
  stubStorage();
  useWorkspace();

  await resetToClosedWindow();
  await toggleMode(true);
  assert.equal(getModeState().on, true, 'mode is on after a successful open');

  await applyState({ url: 'http://localhost:5173/', title: 'Site', lastPick: null, pickSeq: 0, windowOpen: true });
  assert.equal(getModeState().on, true, 'a live window keeps the mode on');

  const opensBefore = calls.filter((call) => call.path === '/open').length;
  await applyState({ url: '', title: '', lastPick: null, pickSeq: 0, windowOpen: false });

  assert.equal(getModeState().on, false, 'windowOpen:false while ON turns Design Mode OFF');
  assert.equal(
    calls.filter((call) => call.path === '/open').length,
    opensBefore,
    'the close is not answered with an auto-reopen',
  );
});

// A stale `/state` snapshot — windowOpen:false, sampled BEFORE the window is up
// — can land inside the ON transition's awaits. The pending-open guard must keep
// it from reading the just-flipped ON as a window close.
test('a stale windowOpen:false poll inside the ON transition cannot self-OFF the toggle', async () => {
  const calls = stubService((request) => {
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/home.html', title: 'Site', settled: true }) };
    return { status: 404, body: '{}' };
  });
  stubToast();
  stubStorage();
  useWorkspace();
  setSessionId('ses_stale');
  await resetToClosedWindow();

  // Withhold the FIRST storage write (the mode persist): the ON transition is
  // parked inside `saveMode`, before the marker and before any open.
  const hostStub = api.host as unknown as { storage: { set: (key: string, value: unknown) => Promise<void> } };
  const realSet = hostStub.storage.set;
  let first = true;
  let release!: () => void;
  hostStub.storage.set = (key: string, value: unknown) => {
    if (!first) return realSet(key, value);
    first = false;
    return new Promise<void>((resolve) => {
      release = () => {
        void realSet(key, value);
        resolve();
      };
    });
  };

  const toggling = toggleMode(true);

  await applyState({ url: '', title: '', lastPick: null, pickSeq: 0, windowOpen: false });

  assert.equal(getModeState().on, true, 'the stale pre-open snapshot must not flip the ON transition OFF');
  assert.equal(getPendingOpen(), true, 'the pending-open guard spans the whole ON transition');
  assert.equal(calls.some((call) => call.path === '/close'), false, 'the stale snapshot must not close anything either');

  release();
  await toggling;

  assert.equal(getModeState().on, true, 'the ON transition completes normally');
  assert.equal(getPendingOpen(), false, 'the guard is cleaned up after the transition');
  assert.ok(calls.some((call) => call.path === '/open'), 'the open still proceeds (unchanged behaviour)');
  assert.equal(calls.some((call) => call.path === '/close'), false, 'no close on the honourable path either');
});

test('the Design Mode widget has no two-step confirm arm', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /click to confirm/i, 'no "click to confirm" copy remains');
  assert.doesNotMatch(source, /modeOffArm/, 'the confirm-arm state is gone');
});

test('the row toggle is a plain ON/OFF label', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  assert.match(source, /void toggleMode\(!state\.mode\.on\)/, 'the toggle flips the mode');
  assert.match(source, /Design Mode: ON/);
  assert.match(source, /Design Mode: OFF/);
});

// ---- /canvas: the command (spec §F: on|off|play|edit|<type>|<brief>) ----

test('/canvas off turns Design Mode off', async () => {
  stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  const toasts = stubToast();
  stubStorage();
  setWorkspace({ dir: '/p/site', name: 'Site' });
  allowResolve(true);

  const chip = await resolveCanvasCommand('off');

  assert.equal(chip, null);
  assert.ok(toasts.some((toast) => /Design Mode is off/.test(toast.message)));
});

test('/canvas play and /canvas edit switch the canvas mode via POST /mode, persisted with the session', async () => {
  setWorkspace(null); // creation tests that follow must not inherit this fixture
  const calls = stubService((request) => {
    if (request.path === '/mode') return { status: 200, body: JSON.stringify({ ok: true, mode: 'play' }) };
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/', title: 'Site', settled: true }) };
    return { status: 404, body: '{}' };
  });
  const toasts = stubToast();
  const store = stubStorage();
  setWorkspace({ dir: '/p/site', name: 'Site' });
  setSessionId('ses_play');
  await resetToClosedWindow();
  allowResolve(true);

  const chip = await resolveCanvasCommand('play');

  const mode = calls.find((call) => call.path === '/mode');
  assert.ok(mode, 'the command switches the canvas mode');
  assert.deepEqual(JSON.parse(mode!.body ?? ''), { mode: 'play' });
  assert.ok(chip, 'the command still returns the Design Mode chip');
  assert.match(chip!.text ?? '', /Canvas mode: play/);
  assert.match(chip!.providerId ?? '', /design-canvas/);
  const stored = store.get(modeStorageKey('ses_play')!) as { canvMode?: unknown } | undefined;
  assert.equal(stored?.canvMode, 'play', 'the canvas mode is persisted with the session');
  assert.equal(toasts.length, 0, 'a successful mode switch toasts nothing');
});

test('/canvas <brief> creates the chat\'s workspace in the service root, toasts the permission heads-up once, and opens', async () => {
  setWorkspace(null);
  const calls = stubService((request) => {
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (request.path === '/scaffold') {
      return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/', files: ['home.html', 'index.html', 'screens.json'] }) };
    }
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/home.html', title: 'Site', settled: true }) };
    return { status: 404, body: '{}' };
  });
  const toasts = stubToast();
  const store = stubStorage();
  setProjectDirectory('C:\\Users\\samhe\\Documents\\openchamber\\chats\\scratch');
  setSessionId('ses_3f2ad8');
  await resetToClosedWindow();
  allowResolve(true);

  const chip = await resolveCanvasCommand('checkout flow');

  const root = JSON.parse(WORKSPACES_BODY).root as string;
  const scaffold = calls.find((call) => call.path === '/scaffold');
  assert.ok(scaffold, 'the brief scaffolds the workspace');
  const scaffoldBody = JSON.parse(scaffold!.body ?? '') as { dir: string; type: string; brief: string };
  assert.equal(scaffoldBody.dir, `${root}\\checkout-flow-3f2ad8`, 'the dir is <service root>/<slug> — never a Documents path of our own');
  assert.equal(scaffoldBody.brief, 'checkout flow');
  assert.match(scaffoldBody.type, /^(wireframe|hi-fi|prototype|deck|custom)$/, 'the scaffold uses a real design type');
  assert.ok(calls.some((call) => call.path === '/open'), 'Design Mode ON opens the canvas');
  assert.deepEqual(store.get(workspaceStorageKey('ses_3f2ad8')!), { dir: `${root}\\checkout-flow-3f2ad8`, name: 'checkout flow' }, 'the ws/<sessionId> record is stored');
  assert.equal(getModeState().on, true);
  assert.match(chip?.text ?? '', /Brief: checkout flow/);
  assert.ok(
    toasts.some((toast) => toast.kind === 'info' && /permission prompts/.test(toast.message)),
    'the FIRST scaffold toasts the out-of-folder permission heads-up (decision 4b)',
  );
});

test('the permission heads-up fires only ONCE (decision 4b)', async () => {
  setWorkspace(null);
  const calls = stubService((request) => {
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (request.path === '/scaffold') return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/', files: [] }) };
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/', title: 'Site', settled: true }) };
    return { status: 404, body: '{}' };
  });
  const toasts = stubToast();
  stubStorage();
  setProjectDirectory('/chats/scratch');
  setSessionId('ses_once');
  await resetToClosedWindow();
  allowResolve(true);

  await resolveCanvasCommand('first flow');
  assert.equal(toasts.filter((toast) => /permission prompts/.test(toast.message)).length, 1, 'first scaffold toasts once');
  // The storage flag (set by stubStorage) makes the next scaffold silent — but
  // this session now HAS a workspace, so nothing scaffolds again: no second toast.
  await resolveCanvasCommand('second flow');
  assert.equal(toasts.filter((toast) => /permission prompts/.test(toast.message)).length, 1, 'the heads-up never repeats');
});

test('/canvas <brief> scaffold failure toasts the error and returns no chip', async () => {
  setWorkspace(null);
  const calls = stubService((request) => {
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (request.path === '/scaffold') return { status: 200, body: JSON.stringify({ ok: false, error: 'no template for type "xyz"' }) };
    return { status: 200, body: JSON.stringify({ ok: true }) };
  });
  const toasts = stubToast();
  stubStorage();
  setSessionId('ses_fail');
  allowResolve(true);

  const chip = await resolveCanvasCommand('hi-fi landing page');

  assert.equal(calls.some((call) => call.path === '/scaffold'), true, 'the scaffold was attempted');
  assert.ok(
    toasts.some((toast) => toast.kind === 'error' && /no template for type/.test(toast.message)),
    'the scaffold error is surfaced, not swallowed',
  );
  assert.equal(chip, null, 'no chip without a workspace');
});

// ---- the page's New-design flow (no registered project required) ----

test('the New design flow scaffolds a fresh workspace in the service root and starts a canvas session WITHOUT projectId', async () => {
  setWorkspace(null);
  setSessionId(null);
  const calls = stubService((request) => request.path === '/workspaces'
    ? { status: 200, body: WORKSPACES_BODY }
    : request.path === '/scaffold'
      ? { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/', files: ['home.html'] }) }
      : request.path === '/config'
        ? { status: 200, body: NO_CONFIG_BODY }
        : { status: 200, body: JSON.stringify({ ok: true }) });
  stubToast();
  const store = stubStorage();
  const sessions = stubStartSession();
  stubListProjects([]); // nothing registered — decision 2: no refusal
  setProjectDirectory('/chats/elsewhere');
  setWorkspace(null);
  setSessionId(null);
  main.setPrompt('Edit the existing root app.');
  main.setSurface('page');
  main.resetReferenceDraft();

  await startNewDesign();

  const scaffold = calls.find((call) => call.path === '/scaffold');
  assert.ok(scaffold, 'the New design flow scaffolds a workspace');
  const body = JSON.parse(scaffold!.body ?? '') as { dir: string };
  const root = JSON.parse(WORKSPACES_BODY).root as string;
  assert.match(body.dir, new RegExp(`^${root.replace(/[\\/]/g, '[\\\\/]')}[\\\\/]`), 'the scaffold lands under the SERVICE root');
  assert.equal(sessions.length, 1, 'a session is started');
  assert.equal(sessions[0]?.providerId, 'design-canvas');
  assert.equal('projectId' in sessions[0]!, false, 'host.startSession is called WITHOUT projectId (decision 2)');
  assert.match(sessions[0]?.text ?? '', /ONLY place design files are written/, 'the prompt mandates absolute workspace paths');
  assert.ok(store.has(workspaceStorageKey('s1')!), 'the workspace record binds to the created session');
  main.setSurface('panel');
  setWorkspace(null);
  main.setPrompt('');
});

test('the started session payload carries the design-mode data chip', async () => {
  stubService((request) => request.path === '/workspaces'
    ? { status: 200, body: WORKSPACES_BODY }
    : request.path === '/scaffold'
      ? { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/', files: [] }) }
      : { status: 200, body: JSON.stringify({ ok: true }) });
  stubToast();
  stubStorage();
  const sessions = stubStartSession();
  stubListProjects([]);
  setWorkspace({ dir: '/p/site', name: 'Site' });
  setSessionId(null);
  await startNewDesign();

  assert.equal(sessions.length, 1);
  const data = sessions[0]?.data as { mode?: { on?: unknown; type?: unknown; brief?: unknown }; workspace?: unknown } | undefined;
  assert.ok(data && typeof data === 'object', 'the payload carries data');
  assert.equal(data.mode?.on, true, 'data.mode.on is the load-bearing bit sessionShowsDesignMode reads');
  assert.equal(data.mode?.type, 'hi-fi');
  assert.deepEqual(data.workspace, { dir: '/p/site', name: 'Site' }, 'the workspace rides on the session data');
  setWorkspace(null);
});

test('decision 4c: a session started for a workspace INSIDE a registered project carries that projectId', async () => {
  stubService((request) => request.path === '/config'
    ? { status: 200, body: CONFIG_BODY }
    : { status: 200, body: JSON.stringify({ ok: true }) });
  stubToast();
  stubStorage();
  const sessions = stubStartSession();
  stubListProjects([{ id: 'p1', name: 'Design Canvas', directory: 'C:\\Users\\samhe\\Documents\\Design Canvas' }]);
  await loadProjects(); // the 4c detection reads the FRESH registration list
  setProjectDirectory('/chats/elsewhere');
  setWorkspace({ dir: 'C:\\Users\\samhe\\Documents\\Design Canvas\\landing-1', name: 'landing' });
  setSessionId(null);

  await startNewDesign();

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.projectId, 'p1', 'the registered Design Canvas root supplies the projectId');
  assert.equal(sessions[0]?.providerId, 'design-canvas');
  setWorkspace(null);
});

// ---- the persistent design marker: written once on ON, never cleared ----

test('toggleMode(true) writes the persistent marker exactly on the ON transition', async () => {
  stubService((request) => {
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/home.html', title: 'Site', settled: true }) };
    if (request.path === '/close') return { status: 200, body: JSON.stringify({ ok: true }) };
    return { status: 404, body: '{}' };
  });
  stubToast();
  const store = stubStorage();
  setWorkspace({ dir: '/p/site', name: 'Site' });
  setSessionId('ses_1');

  assert.equal([...store.keys()].filter((key) => key.startsWith('design/')).length, 0, 'no marker before any ON');

  await resetToClosedWindow();
  await toggleMode(true);

  const marker = store.get(designMarkerKey('ses_1')!) as { on?: unknown; at?: unknown } | undefined;
  assert.ok(marker, 'the ON transition writes the marker');
  assert.equal(marker!.on, true);
  assert.equal(typeof marker!.at, 'string', 'the ON moment is recorded');
  const at = marker!.at;

  await toggleMode(true);
  assert.equal((store.get(designMarkerKey('ses_1')!) as { at?: unknown }).at, at, 'a repeat ON never rewrites the marker');
});

test('the design marker is never cleared on OFF or on a window close', async () => {
  stubService((request) => {
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/home.html', title: 'Site', settled: true }) };
    if (request.path === '/close') return { status: 200, body: JSON.stringify({ ok: true }) };
    return { status: 404, body: '{}' };
  });
  stubToast();
  const store = stubStorage();
  setWorkspace({ dir: '/p/site', name: 'Site' });
  setSessionId('ses_2');

  await resetToClosedWindow();
  await toggleMode(true);
  assert.ok(store.has(designMarkerKey('ses_2')!), 'ON writes the marker');

  await toggleMode(false);
  assert.ok(store.has(designMarkerKey('ses_2')!), 'OFF does NOT clear the marker');
  assert.ok(store.has(modeStorageKey('ses_2')!), 'the mode key itself stays');
  assert.equal((store.get(modeStorageKey('ses_2')!) as { on?: unknown }).on, false, 'while the live mode key says off');

  await toggleMode(true);
  await applyState({ url: 'http://localhost:5173/', title: 'Site', lastPick: null, pickSeq: 0, windowOpen: true });
  await applyState({ url: '', title: '', lastPick: null, pickSeq: 0, windowOpen: false });
  assert.equal(getModeState().on, false, 'the window close turns the mode off');
  assert.ok(store.has(designMarkerKey('ses_2')!), 'the marker survives the window close');
});

test('a newly started design session is marked permanently from birth', async () => {
  stubService((request) => request.path === '/config'
    ? { status: 200, body: CONFIG_BODY }
    : { status: 200, body: JSON.stringify({ ok: true }) });
  stubToast();
  const store = stubStorage();
  stubStartSession();
  stubListProjects([]);
  setWorkspace({ dir: '/p/site', name: 'Site' });
  setSessionId(null);

  await startNewDesign();

  assert.ok(store.has(designMarkerKey('s1')!), 'the new session carries a design marker');
  setWorkspace(null);
});

// ---- the `+` attach sources: the chips they send ----

test('attachProjectReference attaches the workspace chip', async () => {
  main.setSurface?.('status');
  stubService((request) => (request.path === '/config' ? { status: 200, body: CONFIG_BODY } : { status: 200, body: JSON.stringify({ ok: true }) }));
  stubToast();
  stubStorage();
  const chips = stubAttach();
  useWorkspace();
  await loadStudioConfig();

  await attachProjectReference();

  assert.equal(chips.length, 1, 'one workspace chip is attached');
  assert.deepEqual(chips[0], {
    providerId: 'design-canvas',
    id: 'project-site',
    title: 'Site',
    url: 'http://localhost:5173',
    text: 'Workspace reference: /p/site',
  });
});

test('a pasted path attaches the file chip referenced under the workspace url', async () => {
  main.setSurface?.('status');
  stubService((request) => (request.path === '/config' ? { status: 200, body: CONFIG_BODY } : { status: 200, body: JSON.stringify({ ok: true }) }));
  stubToast();
  stubStorage();
  const chips = stubAttach();
  useWorkspace();
  setSessionId(null);
  await loadStudioConfig();

  await attachProjectPath('src/app.ts');

  assert.equal(chips.length, 1, 'one file chip is attached');
  assert.deepEqual(chips[0], {
    providerId: 'design-canvas',
    id: 'file-app.ts',
    title: 'app.ts',
    url: 'http://localhost:5173',
    text: 'File reference: src/app.ts',
  });
});

test('a dropped file asks for an accessible pasted path, without creating filename chips', async () => {
  stubService((request) => (request.path === '/config' ? { status: 200, body: CONFIG_BODY } : { status: 200, body: JSON.stringify({ ok: true }) }));
  const toasts = stubToast();
  stubStorage();
  const chips = stubAttach();
  useWorkspace();
  setSessionId(null);
  await loadStudioConfig();

  const file = (name: string) => ({ name }) as File;
  await attachDroppedFiles({ dataTransfer: { files: [file('hero.png'), file('index.html')] } } as unknown as DragEvent);

  assert.equal(chips.length, 0, 'File.name is not an accessible path');
  assert.ok(toasts.some((toast) => /paste.*path/i.test(toast.message)), 'the drop explains the keyboard alternative');
});

test('the attach sources refuse with the http(s) explanation when the workspace has no url', async () => {
  main.setSurface?.('status');
  stubService((request) =>
    request.path === '/config'
      ? { status: 200, body: JSON.stringify({ config: { version: 1, name: 'Site' }, path: null }) }
      : { status: 200, body: JSON.stringify({ ok: true }) },
  );
  const toasts = stubToast();
  stubStorage();
  const chips = stubAttach();
  useWorkspace();
  setSessionId(null);
  await loadStudioConfig();

  await attachProjectReference();
  await attachProjectPath('src/app.ts');
  await attachDroppedFiles({ dataTransfer: { files: [{ name: 'a.png' } as File] } } as unknown as DragEvent);

  assert.equal(chips.length, 0, 'a chip is never sent without an http(s) url — the host would reject it');
  assert.equal(toasts.length, 3, 'each source gives feedback');
  for (const toast of toasts.slice(0, 2)) assert.equal(toast.message, ATTACH_NEEDS_URL);
  assert.match(toasts[2]!.message, /paste.*path/i);
  assert.match(ATTACH_NEEDS_URL, /http\(s\)/);
});

test('a drop with no files is a no-op', async () => {
  stubService((request) => (request.path === '/config' ? { status: 200, body: CONFIG_BODY } : { status: 200, body: JSON.stringify({ ok: true }) }));
  const toasts = stubToast();
  stubStorage();
  const chips = stubAttach();
  useWorkspace();
  setSessionId(null);
  await loadStudioConfig();

  await attachDroppedFiles({ dataTransfer: { files: [] } } as unknown as DragEvent);

  assert.equal(chips.length, 0, 'no chips for an empty drop');
  assert.equal(toasts.length, 0, 'and no noise about it');
});

// ---- local draft regressions: the service is mocked, not the reference logic ----

async function referencePage(noUrl = false): Promise<{ chips: AttachChip[]; toasts: Toast[] }> {
  main.setSurface?.('page');
  main.resetReferenceDraft?.();
  main.setPrompt?.('Use these files to design the settings screen.');
  setProjectDirectory('/chats/elsewhere');
  setWorkspace({ dir: '/projects/site', name: 'Site' });
  setSessionId(null);
  stubListProjects([]);
  stubService((request) => {
    if (request.path === '/config') return { status: 200, body: noUrl ? JSON.stringify({ config: { name: 'Site' }, path: null }) : CONFIG_BODY };
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    const body = JSON.parse(request.body || '{}') as { path?: string; dir?: string };
    return { status: 200, body: JSON.stringify({ ok: true, path: body.path?.startsWith('/') ? body.path : `${body.dir}/${body.path}`, sourceDirectory: body.dir }) };
  });
  const toasts = stubToast();
  stubStorage();
  const chips = stubAttach();
  await loadProjects();
  await loadStudioConfig();
  return { chips, toasts };
}

test('the page stages validated workspace paths without host composer attachment', async () => {
  const { chips } = await referencePage(true);
  await attachProjectPath('src/app.ts');
  assert.equal(chips.length, 0, 'page references must not leak into the original host composer');
  assert.deepEqual(main.getPageDraft().references.map((ref) => ref.path), ['/projects/site/src/app.ts']);
  setWorkspace(null);
});

test('the page page removes only the chosen full-path reference and delivers retained source', async () => {
  await referencePage();
  await attachProjectPath('src/app.ts');
  await attachProjectPath('examples/app.ts');
  const first = main.getPageDraft().references[0]!;
  main.removePageReference(first.id);
  const sessions = stubStartSession();
  await startNewDesign();
  assert.equal(sessions.length, 1);
  assert.match(sessions[0]!.text!, /\/projects\/site\/examples\/app\.ts/);
  assert.doesNotMatch(sessions[0]!.text!, /\/projects\/site\/src\/app\.ts/);
  assert.match(JSON.stringify(sessions[0]!.data), /\/projects\/site\/examples\/app\.ts/);
  assert.equal(sessions[0]!.navigation, 'preserve');
  assert.equal(main.getPageDraft().references.length, 0, 'only a confirmed send clears refs');
  setWorkspace(null);
});

test('a session id with failed or no-model sending must not navigate, mark success, or clear the draft', async () => {
  for (const sent of ['failed', 'no-model']) {
    const { toasts } = await referencePage();
    await attachProjectPath('src/app.ts');
    const opens: string[] = [];
    (api.host as unknown as { openSession: (id: string) => Promise<void> }).openSession = async (id) => { opens.push(id); };
    (api.host as unknown as { startSession: (request: StartSession) => Promise<unknown> }).startSession = async () => ({ sessionId: 'created-but-unsent', sent });
    await startNewDesign();
    assert.equal(toasts.some((toast) => toast.kind === 'success' && /session started/i.test(toast.message)), false, 'a created session is not proof the brief was sent');
    assert.deepEqual(opens, []);
    assert.equal(main.getPageDraft().prompt, 'Use these files to design the settings screen.');
    assert.equal(main.getPageDraft().references.length, 1);
    assert.match(main.getPageDraft().error, sent === 'no-model' ? /model/i : /not sent|failed/i);
  }
  setWorkspace(null);
});

test('repeated send during a delayed config read starts only one session', async () => {
  await referencePage();
  const sessions = stubStartSession();
  const releases: Array<() => void> = [];
  (api.host as unknown as { serviceRequest: (r: ServiceRequest) => Promise<StubResult> }).serviceRequest = (request) =>
    request.path === '/storage-seam' ? Promise.resolve({ status: 200, body: '{}' }) : new Promise((resolve) => {
      releases.push(() => resolve({ status: 200, body: request.path === '/config' ? CONFIG_BODY : JSON.stringify({ ok: true }) }));
    });
  const first = startNewDesign();
  const second = startNewDesign();
  for (const release of releases) release();
  await Promise.all([first, second]);
  assert.equal(sessions.length, 1);
  setWorkspace(null);
});

test('validation failure keeps the pasted path and a late validation cannot mutate a reset draft', async () => {
  const { chips } = await referencePage();
  stubService(() => ({ status: 400, body: JSON.stringify({ error: 'File not found. Paste an accessible file path.' }) }));
  await attachProjectPath('missing.ts');
  assert.equal(main.getPageDraft().path, 'missing.ts');
  assert.match(main.getPageDraft().referenceError, /File not found/);
  assert.equal(main.getPageDraft().references.length, 0);
  let release!: (result: StubResult) => void;
  (api.host as unknown as { serviceRequest: (r: ServiceRequest) => Promise<StubResult> }).serviceRequest = () => new Promise((resolve) => { release = resolve; });
  const pending = attachProjectPath('src/app.ts');
  main.resetReferenceDraft();
  release({ status: 200, body: JSON.stringify({ path: '/projects/site/src/app.ts', sourceDirectory: '/projects/site' }) });
  await pending;
  assert.equal(main.getPageDraft().references.length, 0);
  assert.equal(chips.length, 0);
  setWorkspace(null);
});

test('the composer + refuses nothing for a project-free canvas — only busy/reference states gate it', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  assert.match(source, /plus\.disabled = state\.pageBusy \|\| referencePending/, 'the + gate is busy-state only');
  assert.doesNotMatch(source, /plus\.title = 'Register or select a project/, 'no register-a-project refusal exists');
  assert.doesNotMatch(source, /NEEDS_PROJECT_MESSAGE/, 'the refusal copy is gone entirely');
});

test('the workspaces list loader and the /state-driven controls are wired to the poll', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  assert.match(source, /void readStudioConfig\(false\)/, 'the poll re-reads the workspace config');
  assert.match(source, /await applyState\(await getState\(\)\)/, 'the poll applies /state');
});

// ---- /canvas export & critique (SPEC-V3-P2-SCOPE.md D4/D7-B/D7-C) ----

test('/canvas export png posts POST /export and polls /export/status until done, then toasts the summary', async () => {
  setWorkspace(null);
  const exported: Array<{ method?: string; path?: string; query?: Record<string, string>; body?: string }> = [];
  const calls = stubService((request) => {
    if (request.path === '/export') {
      exported.push({ method: request.method, path: request.path, body: request.body });
      return { status: 200, body: JSON.stringify({ ok: true, jobId: 'job-1', screens: 2, formats: ['png'] }) };
    }
    if (request.path === '/export/status') {
      exported.push({ path: request.path, query: request.query });
      const polls = exported.filter((call) => call.path === '/export/status').length;
      return polls === 1
        ? { status: 200, body: JSON.stringify({ state: 'running', results: [] }) }
        : {
            status: 200,
            body: JSON.stringify({
              state: 'done',
              results: [
                { screen: 'home', png: { ok: true, file: 'C:\\Design Canvas\\ws\\exports\\home.png' } },
                { screen: 'checkout', png: { ok: false, error: 'screen not loaded' } },
              ],
            }),
          };
    }
    return { status: 404, body: '{}' };
  });
  const toasts = stubToast();
  stubStorage();
  setWorkspace({ dir: '/p/site', name: 'Site' });
  allowResolve(true);

  const chip = await resolveCanvasCommand('export png');

  assert.equal(chip, null, 'export toasts, it never returns a chat chip');
  const post = calls.find((call) => call.path === '/export');
  assert.ok(post, 'POST /export reached the service');
  assert.equal(post!.method, 'POST');
  assert.deepEqual(JSON.parse(post!.body ?? ''), { dir: '/p/site', formats: ['png'] }, 'D4 body: {dir, formats}');
  const statuses = calls.filter((call) => call.path === '/export/status');
  assert.equal(statuses.length, 2, 'one running poll, then the done state');
  for (const status of statuses) assert.deepEqual(status.query, { dir: '/p/site', job: 'job-1' }, 'status polls the job id the POST returned');
  const summary = toasts.find((toast) => toast.kind === 'success');
  assert.ok(summary, 'a summary toast lands');
  assert.match(summary!.message, /Export done: 2 screens/);
  assert.match(summary!.message, /1 PNG/);
  assert.match(summary!.message, /1 failed \(checkout\)/);
  assert.match(summary!.message, /home\.png/, 'the toast names the file path');
});

test('/canvas export without format args omits formats (the service writes both)', async () => {
  const calls = stubService((request) => {
    if (request.path === '/export') return { status: 200, body: JSON.stringify({ ok: true, jobId: 'job-both', screens: 1, formats: ['png', 'pdf'] }) };
    if (request.path === '/export/status') return { status: 200, body: JSON.stringify({ state: 'done', results: [{ screen: 'home', png: { ok: true, file: '/ws/exports/home.png' }, pdf: { ok: true, file: '/ws/exports/home.pdf' } }] }) };
    return { status: 404, body: '{}' };
  });
  const toasts = stubToast();
  stubStorage();
  setWorkspace({ dir: '/p/site', name: 'Site' });
  allowResolve(true);

  await resolveCanvasCommand('export');

  const post = calls.find((call) => call.path === '/export');
  assert.deepEqual(JSON.parse(post!.body ?? ''), { dir: '/p/site' }, 'formats omitted → both formats');
  assert.match(toasts.find((toast) => toast.kind === 'success')!.message, /1 PNG \+ 1 PDF/);
});

test('/canvas export surfaces a failed job with the per-screen failures', async () => {
  const calls = stubService((request) => {
    if (request.path === '/export') return { status: 200, body: JSON.stringify({ ok: true, jobId: 'job-fail', screens: 1, formats: ['pdf'] }) };
    if (request.path === '/export/status') {
      return { status: 200, body: JSON.stringify({ state: 'failed', results: [{ screen: 'checkout', pdf: { ok: false, error: 'print failed' } }] }) };
    }
    return { status: 404, body: '{}' };
  });
  const toasts = stubToast();
  stubStorage();
  setWorkspace({ dir: '/p/site', name: 'Site' });
  allowResolve(true);

  await resolveCanvasCommand('export pdf');

  assert.ok(toasts.some((toast) => toast.kind === 'error' && /Export failed: 1 screen — checkout \(print failed\)/.test(toast.message)), 'the failure is named');
  assert.ok(!toasts.some((toast) => toast.kind === 'success'), 'no success summary on failure');
});

test('/canvas export with an unknown format refuses before touching the service', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  const toasts = stubToast();
  setWorkspace({ dir: '/p/site', name: 'Site' });
  allowResolve(true);

  await resolveCanvasCommand('export svg');

  assert.equal(calls.some((call) => call.path === '/export'), false, 'no export is posted for a bad format');
  assert.ok(toasts.some((toast) => toast.kind === 'error' && /Unknown export format "svg"/.test(toast.message)));
});

test('/canvas export with no workspace refuses with the actionable line', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  const toasts = stubToast();
  stubStorage();
  setWorkspace(null);
  allowResolve(true);

  await resolveCanvasCommand('export png');

  assert.equal(calls.some((call) => call.path === '/export'), false);
  assert.ok(toasts.some((toast) => toast.kind === 'error' && /No canvas workspace yet/.test(toast.message)));
});

test('a still-running export beyond the budget toasts the heads-up instead of polling forever', async () => {
  const calls = stubService((request) => {
    if (request.path === '/export') return { status: 200, body: JSON.stringify({ ok: true, jobId: 'job-long', screens: 3, formats: ['png'] }) };
    if (request.path === '/export/status') return { status: 200, body: JSON.stringify({ state: 'running', results: [] }) };
    return { status: 404, body: '{}' };
  });
  const toasts = stubToast();
  setWorkspace({ dir: '/p/site', name: 'Site' });

  await main.runCanvasExport('/p/site', ['png'], { pollMs: 1, maxMs: 6 });

  assert.ok(
    toasts.some((toast) => toast.kind === 'info' && /still running/.test(toast.message)),
    'the 60s-style budget ends with a heads-up, not a silent hang',
  );
  assert.ok(!toasts.some((toast) => toast.kind === 'success'));
});

test('/canvas critique posts POST /critique and returns the digest chip as a review request', async () => {
  const calls = stubService((request) => {
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/critique') {
      return {
        status: 200,
        body: JSON.stringify({
          ok: true,
          screens: [
            { screen: 'home', state: 'ready', url: 'http://localhost:5173/home.html', width: 1280, height: 800, gates: [{ id: 'overflow', status: 'P1', findings: ['x-overflow at 390'] }], probeCounts: { passed: 7 } },
          ],
          truncated: false,
        }),
      };
    }
    return { status: 404, body: '{}' };
  });
  stubToast();
  stubStorage();
  setWorkspace({ dir: '/p/site', name: 'Site' });
  setSessionId('ses_crit');
  await loadStudioConfig();
  allowResolve(true);

  const chip = await resolveCanvasCommand('critique');

  const critique = calls.find((call) => call.path === '/critique');
  assert.ok(critique, 'POST /critique reached the service');
  assert.deepEqual(JSON.parse(critique!.body ?? ''), { dir: '/p/site' }, 'D7-C body: {dir}');
  assert.ok(chip, 'the digest returns as a chat chip (the compose path)');
  assert.equal(chip!.providerId, 'design-canvas');
  assert.match(chip!.text ?? '', /^Canvas critique — deterministic gate digest \(advisory\):/);
  assert.match(chip!.text ?? '', /- home · 1280×800 · ready · http:\/\/localhost:5173\/home\.html/);
  assert.match(chip!.text ?? '', /overflow: P1 — x-overflow at 390/);
  assert.match(chip!.text ?? '', /never optimise for it/, 'the standing advisory line rides along');
  assert.equal(chip!.url, 'http://localhost:5173', 'the chip carries the workspace url');
});

test('/canvas critique service failure toasts the error and returns no chip', async () => {
  const calls = stubService((request) =>
    request.path === '/critique'
      ? { status: 200, body: JSON.stringify({ ok: false, error: 'no browser window open' }) }
      : { status: 200, body: JSON.stringify({ ok: true }) },
  );
  const toasts = stubToast();
  stubStorage();
  setWorkspace({ dir: '/p/site', name: 'Site' });
  allowResolve(true);

  const chip = await resolveCanvasCommand('critique');

  assert.equal(chip, null);
  assert.ok(toasts.some((toast) => toast.kind === 'error' && /no browser window open/.test(toast.message)));
});

test('/canvas critique without a workspace refuses without posting', async () => {
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  const toasts = stubToast();
  stubStorage();
  setWorkspace(null);
  allowResolve(true);

  const chip = await resolveCanvasCommand('critique');

  assert.equal(chip, null);
  assert.equal(calls.some((call) => call.path === '/critique'), false);
  assert.ok(toasts.some((toast) => toast.kind === 'error' && /No canvas workspace yet/.test(toast.message)));
});

// The panel command verbs never leak into the brief/mode paths.
test('export and critique are reserved /canvas verbs, never briefs', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function resolveCanvasCommand(');
  const end = source.indexOf('// ---- /canvas export & critique');
  const resolver = source.slice(start, end);
  assert.match(resolver, /if \(\/\^export\$\/i\.test\(head!\)\)/, 'export is intercepted before parseDesignArgs');
  assert.match(resolver, /if \(\/\^critique\$\/i\.test\(head!\)\)/, 'critique is intercepted before parseDesignArgs');
});