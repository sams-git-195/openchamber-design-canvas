// Design Mode ON must bring up the canvas workspace's live Chrome window.
//
// The panel bundle runs in a browser frame, so this file installs the same
// minimal shim as panel-open.test.ts and stubs `host.serviceRequest` (and
// `host.toast`) to capture what the panel sends. It imports `panel/main.ts` so
// the real `toggleMode` path is exercised; `main()` no-ops without a host
// `onReady`, so nothing renders and no real Chrome is driven here.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

type ServiceRequest = { method: string; path: string; query?: Record<string, string>; body?: string };
type StubResult = { status: number; body: string };
type Toast = { kind: string; message: string };

// A real-sized frame: the row (and a real rail tab). The hidden 1×1 resolve
// pane is simulated per test by shrinking these.
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
const { NO_PROJECT_URL_MESSAGE, ATTACH_NEEDS_URL } = api;
const { toggleMode, setProjectDirectory, setWorkspace, applyState, getModeState, getPendingOpen, loadStudioConfig, loadProjects, resolveCanvasCommand, allowResolve, startNewDesign, setSessionId, attachProjectReference, attachProjectPath, attachDroppedFiles } = main;
const { runPickLoop, getPickCursor, resetPickLoop, applySessionSnapshot, handleSessionLifecycle, getWorkspaceState } = main;
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

/**
 * V4-11 async scaffold pair: `POST /scaffold {…,async:true}` answers the jobId
 * as soon as the FILES are written, and `GET /scaffold/status` reports `done`
 * on the first poll — so existing flows exercise the full contract with no
 * sleeps. Tests that need the slow-job path stub it themselves.
 */
function scaffoldJob(request: ServiceRequest): StubResult {
  if (request.path === '/scaffold') {
    const body = JSON.parse(request.body ?? '{}') as { dir?: string };
    return { status: 200, body: JSON.stringify({ ok: true, jobId: 'job-1', dir: body.dir ?? '/p/new', url: 'http://localhost:5173/' }) };
  }
  return { status: 200, body: JSON.stringify({ state: 'done', elapsedMs: 4400 }) };
}

const IS_SCAFFOLD_PATH = (path: string): boolean => path === '/scaffold' || path.startsWith('/scaffold/');

function stubService(handler: (request: ServiceRequest) => StubResult | Promise<StubResult>): ServiceRequest[] {
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
  (api.host as unknown as { storage: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void>; delete: (key: string) => Promise<void>; keys: () => Promise<string[]> } }).storage = {
    get: async (key) => store.get(key),
    set: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
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

test('toggleMode(true) reads the workspace config and opens the canvas via POST /open {dir, focus:true} (V4-8)', async () => {
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
  assert.deepEqual(JSON.parse(open!.body ?? ''), { dir: '/p/site', focus: true }, 'spec §B + V4-8: {dir, focus:true} — the toggle turning ON IS user-initiated, so it may raise the window; the config url stays authoritative');
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
  assert.deepEqual(JSON.parse(open!.body ?? ''), { dir: '/p/site', focus: true }, 'even the restored URL open carries the user-initiated focus flag (V4-8)');
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
    if (IS_SCAFFOLD_PATH(request.path)) return scaffoldJob(request);
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
  const dir = `${root}\\checkout-flow-3f2ad8`;
  const scaffold = calls.find((call) => call.path === '/scaffold');
  assert.ok(scaffold, 'the brief scaffolds the workspace');
  const scaffoldBody = JSON.parse(scaffold!.body ?? '') as { dir: string; type: string; brief: string; async?: boolean };
  assert.equal(scaffoldBody.dir, dir, 'the dir is <service root>/<slug> — never a Documents path of our own');
  assert.equal(scaffoldBody.brief, 'checkout flow');
  assert.match(scaffoldBody.type, /^(wireframe|hi-fi|prototype|deck|custom)$/, 'the scaffold uses a real design type');
  assert.equal(scaffoldBody.async, true, 'V4-11: the first-run scaffold is the async job — it can never hit the 20 s host cap');
  assert.equal(calls.some((call) => call.path === '/scaffold/status' || call.path === '/open'), false, 'F3: the resolve neither polls the job nor opens — the row does');
  assert.deepEqual(store.get(workspaceStorageKey('ses_3f2ad8')!), { dir, name: 'checkout flow' }, 'the ws/<sessionId> record is stored');
  assert.deepEqual({ ...(store.get(main.openHandoffKey('ses_3f2ad8')!) as object), at: 0 }, { dir, jobId: 'job-1', at: 0 }, 'F3: the open is handed to the row with the job to wait out');
  assert.equal(getModeState().on, true);
  assert.match(chip?.text ?? '', /Brief: checkout flow/);

  // The status row picks the handoff up: polls the job WITH its dir (F1), then opens.
  assert.equal(await main.runOpenHandoff(), 'opened');
  const status = calls.find((call) => call.path === '/scaffold/status');
  assert.deepEqual(status?.query, { job: 'job-1', dir }, 'F1: the status poll names the job AND its dir');
  assert.ok(calls.some((call) => call.path === '/open'), 'Design Mode ON opens the canvas — from the row');
  assert.equal(store.has(main.openHandoffKey('ses_3f2ad8')!), false, 'the handoff is consumed — one row, one open');
  assert.ok(
    toasts.some((toast) => toast.kind === 'info' && /permission prompts/.test(toast.message)),
    'the FIRST scaffold toasts the out-of-folder permission heads-up (decision 4b)',
  );
});

test('the permission heads-up fires only ONCE (decision 4b)', async () => {
  setWorkspace(null);
  const calls = stubService((request) => {
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (IS_SCAFFOLD_PATH(request.path)) return scaffoldJob(request);
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

test('/canvas <brief> scaffold failure THROWS the error (the host shows it) and attaches nothing', async () => {
  setWorkspace(null);
  const calls = stubService((request) => {
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (request.path === '/scaffold') return { status: 200, body: JSON.stringify({ ok: false, error: 'no template for type "xyz"' }) };
    return { status: 200, body: JSON.stringify({ ok: true }) };
  });
  const toasts = stubToast();
  const store = stubStorage();
  setSessionId('ses_fail');
  allowResolve(true);

  await assert.rejects(() => resolveCanvasCommand('hi-fi landing page'), /no template for type/, 'the scaffold error is surfaced verbatim through the host\'s command-failed toast');

  assert.equal(calls.some((call) => call.path === '/scaffold'), true, 'the scaffold was attempted');
  assert.equal(toasts.some((toast) => /no template for type/.test(toast.message)), false, 'no second copy of the same error as our own toast');
  assert.equal(store.has(modeStorageKey('ses_fail')!), false, 'no workspace → Design Mode is never armed for the row');
});

test('F2: /canvas in a new-chat draft (no session yet) throws the "send a message first" instruction', async () => {
  setWorkspace(null);
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  stubToast();
  stubStorage();
  setSessionId(null);
  allowResolve(true);

  await assert.rejects(() => resolveCanvasCommand('checkout flow'), /Start this chat by sending any message first, then run \/canvas again\./);
  await assert.rejects(() => resolveCanvasCommand(''), /sending any message first/, 'a bare /canvas too');
  assert.equal(calls.some((call) => call.path === '/scaffold' || call.path === '/workspaces'), false, 'nothing is created without a session to key it to');
});

test('F3: the resolve returns BEFORE install/boot — no status poll, dev-server, focus or Chrome call while it is pending', async () => {
  setWorkspace(null);
  setSessionId('ses_fast');
  stubToast();
  const store = stubStorage();
  const calls = stubService((request) => {
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (request.path === '/scaffold') {
      const body = JSON.parse(request.body ?? '{}') as { dir?: string };
      return { status: 200, body: JSON.stringify({ ok: true, jobId: 'job-fast', dir: body.dir, url: 'http://localhost:5173/' }) };
    }
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    // A job that never finishes: a resolve still awaiting it would hang here.
    if (request.path === '/scaffold/status') return { status: 200, body: JSON.stringify({ state: 'installing', elapsedMs: 1000 }) };
    return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/', title: 'Site', settled: true }) };
  });
  allowResolve(true);
  await resetToClosedWindow();
  try {
    const chip = await resolveCanvasCommand('fast landing');
    assert.ok(chip, 'the mode chip comes back at once');
    const forbidden = ['/scaffold/status', '/open', '/server/start', '/focus'];
    assert.deepEqual(calls.filter((call) => forbidden.includes(call.path)).map((call) => call.path), [], 'no install/boot/window work inside the resolve');
    assert.equal(getModeState().on, true, 'Design Mode is ON for the row to act on');
    assert.ok(store.has(main.openHandoffKey('ses_fast')!), 'the open is handed off');
  } finally {
    store.delete(main.openHandoffKey('ses_fast')!);
    setWorkspace(null);
    setSessionId(null);
  }
});

// ---- the page's New-design flow (no registered project required) ----

test('the New design flow scaffolds a fresh workspace in the service root and starts a canvas session WITHOUT projectId', async () => {
  setWorkspace(null);
  setSessionId(null);
  const calls = stubService((request) => request.path === '/workspaces'
    ? { status: 200, body: WORKSPACES_BODY }
    : IS_SCAFFOLD_PATH(request.path)
      ? scaffoldJob(request)
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
    : IS_SCAFFOLD_PATH(request.path)
      ? scaffoldJob(request)
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

// =====================================================================
// SPEC-V4-CARBON-PARITY — the panel lane: pick queue (V4-5), registry
// toast (V4-4), async scaffold (V4-11), agent-status mirror (V4-12),
// workspace-missing recovery (V4-15). Fake timers drive the loops; the
// stubbed service below emulates the frozen §3 contract exactly.
// =====================================================================

import type { QueuedElementPick, QueuedScreenPick, QueuedPick } from '../panel/api.ts';

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const flush = async (): Promise<void> => {
  await flushMicrotasks();
  await flushMicrotasks();
};

const live = (over: Record<string, unknown> = {}) => ({
  url: 'http://localhost:5173/', title: 'Site', lastPick: null, pickSeq: 0, windowOpen: true, ...over,
});

const queuedElement = (seq: number, selector = `#e${seq}`): QueuedElementPick => ({
  seq, kind: 'element', screen: 'home', screenUrl: 'http://127.0.0.1:5173/home.html', at: 1731500000000, additive: false,
  selector, tag: 'button', classes: 'cta', text: 'Buy', outerHTML: `<button id="${selector.slice(1)}">Buy</button>`,
  styles: { color: 'rgb(0, 0, 0)' }, rect: { x: 0, y: 0, width: 40, height: 16 },
});

const queuedScreen = (seq: number): QueuedScreenPick => ({
  seq, kind: 'screen', screen: 'home', screenUrl: 'http://127.0.0.1:5173/home.html', at: 1731500000000, additive: false,
  width: 1280, height: 800, file: 'C:\\Docs\\Design Canvas\\site\\home.html',
});

/**
 * The §3 pick queue as a stub: picks keep their pushed seq and are FILTERED by
 * the caller's `since` cursor (the service ring holds them until age-out — a
 * delivered-but-unacked pick comes back, which is how the retry path works).
 * A `wait>0` GET hangs until a push or the wait timer fires.
 */
function stubPickQueue() {
  const queue: QueuedPick[] = [];
  const acks: Array<{ seq: number; label: string }> = [];
  const requests: ServiceRequest[] = [];
  let latest = 0;
  let waiters: Array<{ since: number; settle: (result: StubResult) => void }> = [];
  const ok = (body: unknown): StubResult => ({ status: 200, body: JSON.stringify(body) });
  const dueFor = (since: number): QueuedPick[] => queue.filter((pick) => pick.seq > since).sort((a, b) => a.seq - b.seq);
  (api.host as unknown as { serviceRequest: (r: ServiceRequest) => Promise<StubResult> }).serviceRequest = async (request) => {
    requests.push(request);
    if (request.path === '/picks/ack') {
      acks.push(JSON.parse(request.body ?? '{}') as { seq: number; label: string });
      return ok({ ok: true });
    }
    if (request.path === '/picks') {
      const since = Number(request.query?.since ?? '0');
      const wait = Number(request.query?.wait ?? '0');
      const due = dueFor(since);
      if (due.length > 0) return ok({ seq: latest, picks: due });
      if (wait <= 0) return ok({ seq: latest, picks: [] });
      return new Promise<StubResult>((resolve) => {
        const timer = setTimeout(() => {
          waiters = waiters.filter((w) => w.settle !== settle);
          resolve(ok({ seq: latest, picks: [] }));
        }, wait);
        const settle = (result: StubResult) => {
          clearTimeout(timer);
          resolve(result);
        };
        waiters.push({ since, settle });
      });
    }
    return ok({ ok: true });
  };
  return {
    acks,
    requests,
    push: (pick: QueuedPick) => {
      queue.push(pick);
      latest = Math.max(latest, pick.seq);
      for (const waiter of [...waiters]) {
        const due = dueFor(waiter.since);
        if (due.length > 0) {
          waiters = waiters.filter((w) => w !== waiter);
          waiter.settle(ok({ seq: latest, picks: due }));
        }
      }
    },
  };
}

/** Design Mode ON for `sessionId`, through the real storage/mode path. */
async function seedModeOn(sessionId: string, store: Map<string, unknown>): Promise<void> {
  store.set(modeStorageKey(sessionId)!, { on: true, type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', canvMode: 'edit', brief: '' });
  await applySessionSnapshot({ id: sessionId, busy: false });
  assert.equal(getModeState().on, true, 'the row is in Design Mode');
}

// ---- V4-5: the pick-queue client ----

test('two queued picks become two chips IN ORDER, then ONE ack with the last seq + label (V4-5)', async () => {
  setWorkspace(null);
  stubToast();
  const store = stubStorage();
  await seedModeOn('ses_q1', store);
  const chips = stubAttach();
  const queue = stubPickQueue();
  // The acceptance's "two picks 50 ms apart": BOTH are queued when the loop
  // next reads — the queue must deliver BOTH in one batch, never the newest
  // only (the E7 defect), then a single ack up to the last seq.
  queue.push(queuedElement(1));
  queue.push(queuedScreen(2));
  resetPickLoop();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let stop = false;
    const loop = runPickLoop(() => stop);
    await flush();
    assert.deepEqual(chips.map((chip) => chip.id), ['element-1', 'screen-2'], 'every queued pick becomes its own chip, in seq order — a menu screen-send rides the same path (V4-10)');
    assert.deepEqual(queue.acks, [{ seq: 2, label: 'screen home' }], 'ONE ack carrying the LAST delivered seq rides to the canvas pill');
    assert.equal(getPickCursor(), 2, 'the since-cursor advanced');
    stop = true;
    mock.timers.tick(12_000);
    await flush(); // the timed-out long-poll answers idle → one more pacing sleep to drain
    mock.timers.tick(1_000);
    await loop;
  } finally {
    mock.timers.reset();
    setWorkspace(null);
  }
});

test('a hidden document does NOT stop delivery — live pushes each arrive, none lost (V4-5/E7)', async () => {
  setWorkspace(null);
  stubToast();
  const store = stubStorage();
  await seedModeOn('ses_q2', store);
  const chips = stubAttach();
  const queue = stubPickQueue();
  const doc = globalThis.document as unknown as { visibilityState?: string };
  doc.visibilityState = 'hidden';
  resetPickLoop();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let stop = false;
    const loop = runPickLoop(() => stop);
    await flush(); // the long-poll hangs open, ready for a push — and delivery never checks visibility
    queue.push(queuedElement(1));
    await flush();
    queue.push(queuedElement(2, '#f'));
    queue.push(queuedElement(3, '#g'));
    await flush();
    assert.equal(chips.length, 3, 'nothing is lost while the window is hidden: the pending long-poll answers the first push and the cursor catches up the rest');
    assert.deepEqual(chips.map((chip) => chip.id), ['element-1', 'element-2', 'element-3'], 'seq order across the rounds');
    assert.deepEqual(queue.acks.map((ack) => ack.seq), [1, 2, 3], 'each pushed pick rides its own round; acks advance monotonically');
    assert.equal(getPickCursor(), 3, 'the since-cursor advanced to the newest');
    stop = true;
    mock.timers.tick(12_000);
    await flush(); // the timed-out long-poll answers idle → one more pacing sleep to drain
    mock.timers.tick(1_000);
    await loop;
  } finally {
    doc.visibilityState = 'visible';
    mock.timers.reset();
  }
});

test('a failed attach is NOT acked; the queue redelivers and the retry acks once (failure→no-ack→retry)', async () => {
  setWorkspace(null);
  stubToast();
  const store = stubStorage();
  await seedModeOn('ses_q3', store);
  const chips: Array<{ id?: string }> = [];
  let attempts = 0;
  (api.host as unknown as { attach: (r: { id?: string }) => Promise<void> }).attach = async (request) => {
    attempts += 1;
    if (attempts === 1) throw new Error('composer offline');
    chips.push(request);
  };
  const queue = stubPickQueue();
  resetPickLoop();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let stop = false;
    const loop = runPickLoop(() => stop);
    await flush();
    queue.push(queuedElement(4));
    await flush();
    assert.equal(attempts, 1, 'the first attach failed');
    assert.equal(chips.length, 0, 'nothing landed');
    assert.deepEqual(queue.acks, [], 'NO ack after a failed attach');
    assert.equal(getPickCursor(), 0, 'the cursor held — the queued pick comes back');
    mock.timers.tick(1_000); await flush(); // the idle-pacled loop retries: since=0 redelivers seq 4, which now lands
    assert.deepEqual(chips.map((chip) => chip.id), ['element-4'], 'the retry delivered it');
    assert.deepEqual(queue.acks, [{ seq: 4, label: '#e4' }], 'acked exactly once');
    assert.equal(getPickCursor(), 4);
    stop = true;
    mock.timers.tick(12_000);
    await flush(); // the timed-out long-poll answers idle → one more pacing sleep to drain
    mock.timers.tick(1_000);
    await loop;
  } finally {
    mock.timers.reset();
  }
});

test('a /picks request error falls back to wait=0 short polls every 250 ms, then retries the long poll (V4-5 backoff)', async () => {
  setWorkspace(null);
  stubToast();
  const store = stubStorage();
  await seedModeOn('ses_q4', store);
  stubAttach();
  const waits: string[] = [];
  let failing = true;
  (api.host as unknown as { serviceRequest: (r: ServiceRequest) => Promise<StubResult> }).serviceRequest = async (request) => {
    if (request.path !== '/picks') return { status: 200, body: '{}' };
    const wait = request.query?.wait ?? '';
    waits.push(wait);
    if (failing) return { status: 500, body: JSON.stringify({ error: 'service down' }) };
    return { status: 200, body: JSON.stringify({ seq: 0, picks: [] }) };
  };
  resetPickLoop();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let stop = false;
    const loop = runPickLoop(() => stop);
    await flush(); // GET #1 (wait=12000) errors → backoff armed (sleep 250)
    mock.timers.tick(250); await flush(); // GET #2 (wait=0) errors
    mock.timers.tick(250); await flush(); // GET #3 (wait=0) errors
    failing = false;
    mock.timers.tick(250); await flush(); // GET #4 (wait=0) succeeds → straight back to long-poll #5
    assert.deepEqual(waits, ['12000', '0', '0', '0', '12000'], 'the exact V4-5 fallback policy: long → 250 ms shorts → long retry');
    stop = true;
    mock.timers.tick(12_000);
    await flush(); // the timed-out long-poll answers idle → one more pacing sleep to drain
    mock.timers.tick(1_000);
    await loop;
  } finally {
    mock.timers.reset();
  }
});

test('a claimed bridge stands the row down; on release the queue delivers everything since the cursor (V4-5)', async () => {
  setWorkspace(null);
  stubToast();
  const store = stubStorage();
  await seedModeOn('ses_q5', store);
  const chips = stubAttach();
  const queue = stubPickQueue();
  await applyState(live({ bridgeActive: true }));
  resetPickLoop();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let stop = false;
    const loop = runPickLoop(() => stop);
    await flush();
    mock.timers.tick(5_000); await flush();
    assert.deepEqual(queue.requests, [], 'no /picks reads while the bridge is claimed — the claim still stands the row down');
    queue.push(queuedElement(1));
    await applyState(live({ bridgeActive: false })); // bridge released
    mock.timers.tick(900); await flush(); // the held loop re-checks at its idle cadence
    assert.deepEqual(chips.map((chip) => chip.id), ['element-1'], 'the queued pick arrives on release, nothing lost');
    assert.deepEqual(queue.acks, [{ seq: 1, label: '#e1' }]);
    stop = true;
    mock.timers.tick(12_000);
    await flush(); // the timed-out long-poll answers idle → one more pacing sleep to drain
    mock.timers.tick(1_000);
    await loop;
  } finally {
    mock.timers.reset();
  }
});

// ---- V4-4: the registry error is loud, once ----

test('registryError toasts once per distinct message, repeats are silent, a clear re-arms it (V4-4)', async () => {
  setWorkspace(null);
  stubStorage();
  const toasts = stubToast();
  const registry = (message: string | null) => toasts.filter((toast) => toast.kind === 'error' && /screens\.json/.test(toast.message));
  await applyState(live({ registryError: 'screens.json: Expected \',\' or \'}\'' }));
  await applyState(live({ registryError: 'screens.json: Expected \',\' or \'}\'' }));
  assert.equal(registry('x').length, 1, 'the same error across poll ticks toasts EXACTLY once');
  await applyState(live({ registryError: null }));
  assert.equal(registry('x').length, 1, 'a clear never toasts');
  await applyState(live({ registryError: 'screens.json: Expected \',\' or \'}\'' }));
  assert.equal(registry('x').length, 2, 'broken again after a fix is a NEW episode — it speaks up again');
  await applyState(live({ registryError: 'screens.json: Unexpected end of JSON input' }));
  assert.equal(registry('x').length, 3, 'a different distinct message toasts too');
  assert.equal(registry('x').length, 3, '…and then stays deduped');
});

// ---- V4-12: the agent turn is mirrored to the canvas (display-only) ----

test('busy transitions post /agent-status exactly on the flip; a completed turn backstops /screens/sync (V4-12/V4-4)', async () => {
  setWorkspace({ dir: '/p/site', name: 'Site' });
  stubStorage();
  stubToast();
  const posts: Array<{ path: string; body: unknown }> = [];
  stubService((request) => {
    if (request.path === '/agent-status' || request.path === '/screens/sync') {
      posts.push({ path: request.path, body: request.body ? JSON.parse(request.body) : undefined });
    }
    return { status: 200, body: JSON.stringify({ ok: true }) };
  });
  await applySessionSnapshot({ id: 'ses_as', busy: true });
  await applySessionSnapshot({ id: 'ses_as', busy: true });
  await applySessionSnapshot({ id: 'ses_as', busy: false });
  await handleSessionLifecycle({ phase: 'completed' });
  const statusPosts = posts.filter((post) => post.path === '/agent-status').map((post) => post.body);
  assert.deepEqual(statusPosts, [{ busy: true, label: 'Designing…' }, { busy: false }], 'only TRANSITIONS post; busy carries the ≤60 label, idle sends none');
  const sync = posts.find((post) => post.path === '/screens/sync');
  assert.deepEqual(sync?.body, { dir: '/p/site' }, 'the completed turn re-reads screens.json through the V4-4 backstop');
  setWorkspace(null);
});

test('a started/failure lifecycle never posts the sync, and no workspace means no sync (V4-12 boundary)', async () => {
  setWorkspace(null);
  stubStorage();
  stubToast();
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  await handleSessionLifecycle({ phase: 'started' });
  await handleSessionLifecycle({ phase: 'completed' });
  await handleSessionLifecycle({ phase: 'failure' });
  assert.equal(calls.some((call) => call.path === '/screens/sync'), false, 'no workspace bound → nothing to sync; only COMPLETED turns backstop');
});

// ---- V4-11: the first-run scaffold that cannot time out ----

test('async first run: ws/ stored AT THE POST, progress toasts per state, ONE workspace, opens only at done (V4-11)', async () => {
  setWorkspace(null);
  setSessionId('ses_slow');
  stubToast();
  const base = stubStorage();
  const timeline: string[] = [];
  const storage = (api.host as unknown as { storage: { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown) => Promise<void>; delete: (k: string) => Promise<void>; keys: () => Promise<string[]> } }).storage;
  const toastList: Toast[] = [];
  (api.host as unknown as { toast: (t: Toast) => Promise<void> }).toast = async (toast) => { toastList.push(toast); };
  (api.host as unknown as { storage: typeof storage }).storage = {
    get: storage.get,
    delete: storage.delete,
    keys: storage.keys,
    set: async (key, value) => {
      if (key.startsWith('ws/')) timeline.push('ws-stored');
      await storage.set(key, value);
    },
  };
  const script = ['installing', 'installing', 'booting', 'done'] as const;
  let polls = 0;
  const calls = stubService((request) => {
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (request.path === '/scaffold') {
      timeline.push('scaffold-post');
      const body = JSON.parse(request.body ?? '{}') as { dir?: string };
      return { status: 200, body: JSON.stringify({ ok: true, jobId: 'job-9', dir: body.dir, url: 'http://localhost:5173/' }) };
    }
    if (request.path === '/scaffold/status') {
      const state = script[Math.min(polls, script.length - 1)];
      polls += 1;
      timeline.push(`status:${state}`);
      return { status: 200, body: JSON.stringify({ state, elapsedMs: (polls - 1) * 2000 }) };
    }
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') {
      timeline.push('open');
      return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/home.html', title: 'Site', settled: true }) };
    }
    return { status: 404, body: '{}' };
  });
  allowResolve(true);
  await resetToClosedWindow();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const chip = await resolveCanvasCommand('slow landing');
    assert.ok(chip, 'F3: the command answers with its chip as soon as the files + ws/ exist');
    assert.deepEqual(timeline, ['scaffold-post', 'ws-stored'], 'F3: the resolve stops at the fast half — no job poll, no open');
    // The status row owns the long half: it claims the handoff and polls the job.
    const pending = main.runOpenHandoff();
    await flush();
    for (let i = 0; i < 10 && !timeline.includes('open'); i += 1) {
      mock.timers.tick(2000);
      await flush();
    }
    assert.equal(await pending, 'opened');
    assert.deepEqual(timeline.slice(0, 7), ['scaffold-post', 'ws-stored', 'status:installing', 'status:installing', 'status:booting', 'status:done', 'open'], 'the V4-11 order: ws/ stored BEFORE any poll, the window opens only AFTER done');
    assert.equal(calls.filter((call) => call.path === '/scaffold').length, 1, 'exactly ONE scaffold POST — no orphan second workspace');
    assert.ok(base.has(workspaceStorageKey('ses_slow')!), 'ws/ses_slow persisted at the {ok:true, jobId} answer');
    assert.ok(toastList.some((t) => t.kind === 'info' && /Setting up the canvas… installing \(\d+ s\)/.test(t.message)), 'progress toast: installing (Ns)');
    assert.equal(toastList.filter((t) => /installing/.test(t.message)).length, 1, 'two installing polls inside one 10 s band → ONE toast, not spam');
    assert.ok(toastList.some((t) => t.kind === 'info' && /starting the dev server/.test(t.message)), 'progress toast: booting');
    assert.ok(toastList.some((t) => t.kind === 'success' && /ready \(\d+ s\) — opening the canvas/.test(t.message)), 'the settle line rides the done state');
  } finally {
    mock.timers.reset();
    setWorkspace(null);
    setSessionId(null);
  }
});

test('a failed scaffold job: error toast, NO open, and the ws/ record STAYS (V4-11 second-workspace guard)', async () => {
  setWorkspace(null);
  setSessionId('ses_broke');
  const toasts = stubToast();
  const store = stubStorage();
  const calls = stubService((request) => {
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (request.path === '/scaffold') {
      const body = JSON.parse(request.body ?? '{}') as { dir?: string };
      return { status: 200, body: JSON.stringify({ ok: true, jobId: 'job-f', dir: body.dir, url: 'http://localhost:5173/' }) };
    }
    if (request.path === '/scaffold/status') return { status: 200, body: JSON.stringify({ state: 'failed', elapsedMs: 6000, error: 'npm exited with code 1' }) };
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/', title: 'Site', settled: true }) };
    return { status: 404, body: '{}' };
  });
  allowResolve(true);
  await resetToClosedWindow();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const chip = await resolveCanvasCommand('doomed brief');
    assert.ok(chip, 'F3: the files exist, so the chip (with the real path) still lands — the job is the row\'s');
    assert.equal(await main.runOpenHandoff(), 'failed', 'the row reads the failed job'); // the first status answers failed — no sleeps needed
    assert.equal(calls.some((call) => call.path === '/open'), false, 'the window never opens on a failed job');
    assert.equal(calls.filter((call) => call.path === '/scaffold').length, 1, 'ONE workspace POST');
    assert.ok(store.has(workspaceStorageKey('ses_broke')!), 'the ws/ record STAYS — a retry re-opens this dir, it never scaffolds a second workspace');
    assert.ok(toasts.some((t) => t.kind === 'error' && /Canvas setup failed: npm exited with code 1/.test(t.message)), 'the job error is surfaced verbatim');
  } finally {
    mock.timers.reset();
    setWorkspace(null);
    setSessionId(null);
  }
});

// ---- V4-15: missing-workspace recovery ----

test('a WORKSPACE_MISSING /open deletes the ws/ record, unbinds, and offers a new canvas (V4-15)', async () => {
  const store = stubStorage();
  store.set(workspaceStorageKey('ses_gone')!, { dir: '/p/gone', name: 'Gone' });
  const toasts = stubToast();
  stubService((request) => {
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') return { status: 200, body: JSON.stringify({ ok: false, code: 'WORKSPACE_MISSING', error: 'The canvas folder /p/gone no longer exists.', url: '', title: '', settled: false }) };
    if (request.path === '/close') return { status: 200, body: JSON.stringify({ ok: true }) };
    return { status: 404, body: '{}' };
  });
  setSessionId('ses_gone');
  setWorkspace(null);
  await resetToClosedWindow();
  await toggleMode(true);
  assert.equal(getWorkspaceState(), null, 'the session unbinds from the dead dir — the row re-offers "Create canvas"');
  assert.equal(store.has(workspaceStorageKey('ses_gone')!), false, 'the ws/<sessionId> record is DELETED, not shadowed');
  assert.ok(toasts.some((toast) => /no longer exists/.test(toast.message) && /Start creates a new canvas/.test(toast.message)), 'the toast states the loss and the next action');
  assert.equal(store.has('lastUrl//p/gone'), false, 'a failed open persists nothing');
  setSessionId(null);
});
// =====================================================================
// The /canvas + Start repair (F1–F8): the resolve hands the long half to
// the status row, the row re-reads what other frames wrote, and every pick
// chip carries the workspace path the model must edit.
// =====================================================================

test('F3/F5: the row adopts ws/ + mode/ another frame wrote and claims the open BEFORE /state can read "ON, no window" as a close', async () => {
  setWorkspace(null);
  setSessionId('ses_row');
  stubToast();
  const store = stubStorage();
  await applySessionSnapshot({ id: 'ses_row', busy: false });
  await resetToClosedWindow();
  assert.equal(getModeState().on, false, 'the row loaded OFF before the hidden pane ran');
  const calls = stubService((request) => {
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/home.html', title: 'Site', settled: true }) };
    return { status: 404, body: '{}' };
  });
  // What the hidden resolve pane leaves behind, in its write order.
  store.set(workspaceStorageKey('ses_row')!, { dir: '/p/site', name: 'Site' });
  store.set(main.openHandoffKey('ses_row')!, { dir: '/p/site', jobId: null, at: Date.now() });
  store.set(modeStorageKey('ses_row')!, { on: true, type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', canvMode: 'edit', brief: 'landing' });

  await main.syncRowFromStorage();
  assert.deepEqual(getWorkspaceState(), { dir: '/p/site', name: 'Site' }, 'the row binds the workspace the resolve created — no more "No canvas workspace yet"');
  assert.equal(getModeState().on, true, 'the row adopts Design Mode ON from storage');
  assert.equal(getPendingOpen(), true, 'the handoff holds the pending-open guard');
  await applyState({ url: '', title: '', lastPick: null, pickSeq: 0, windowOpen: false });
  assert.equal(getModeState().on, true, 'a closed-window /state read during the handoff is NOT a user close');
  await flush();
  await flush();
  assert.ok(calls.some((call) => call.path === '/open'), 'the row opens the canvas the resolve asked for');
  assert.equal(store.has(main.openHandoffKey('ses_row')!), false, 'the handoff is consumed');
  setWorkspace(null);
  setSessionId(null);
});

test('F5: a row holding picks because its in-memory mode is OFF re-reads mode/ and delivers once another frame turned it ON', async () => {
  setWorkspace(null);
  stubToast();
  const store = stubStorage();
  store.set(modeStorageKey('ses_held')!, { on: false, type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', canvMode: 'edit', brief: '' });
  await applySessionSnapshot({ id: 'ses_held', busy: false });
  assert.equal(getModeState().on, false);
  const chips = stubAttach();
  const queue = stubPickQueue();
  queue.push(queuedElement(1));
  resetPickLoop();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let stop = false;
    const loop = runPickLoop(() => stop);
    await flush();
    assert.equal(chips.length, 0, 'held while the mode reads OFF');
    store.set(modeStorageKey('ses_held')!, { on: true, type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', canvMode: 'edit', brief: '' });
    mock.timers.tick(900); await flush(); await flush();
    assert.deepEqual(chips.map((chip) => chip.id), ['element-1'], 'the storage re-read releases the hold — the pick lands');
    assert.deepEqual(queue.acks.map((ack) => ack.seq), [1]);
    stop = true;
    mock.timers.tick(12_000);
    await flush();
    mock.timers.tick(1_000);
    await loop;
  } finally {
    mock.timers.reset();
  }
});

test('F6/F7: with a workspace bound, a batch carries ONE compact mode chip first, and each pick chip names Workspace: and File:', async () => {
  setWorkspace(null);
  stubToast();
  const store = stubStorage();
  await seedModeOn('ses_paths', store);
  const ws = ['C:', 'Docs', 'Design Canvas', 'site'].join('\\');
  const homeFile = `${ws}\\home.html`;
  setWorkspace({ dir: ws, name: 'Site' });
  await applyState(live({ screens: [{ id: 'home', title: 'Home', url: 'http://127.0.0.1:5173/home.html', width: 1280, height: 800, active: true }] }));
  const chips = stubAttach();
  const queue = stubPickQueue();
  queue.push(queuedElement(1));
  queue.push(queuedElement(2, '#second'));
  resetPickLoop();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let stop = false;
    const loop = runPickLoop(() => stop);
    await flush();
    assert.deepEqual(chips.map((chip) => chip.id), ['design-mode-ses_paths', 'element-1', 'element-2'], 'F7: at most one mode chip per batch, ahead of the first pick');
    const mode = chips[0]!.text ?? '';
    assert.match(mode, /^Design Mode: ON/);
    const modeLines = mode.split('\n');
    assert.ok(modeLines.includes(`Workspace: ${ws}`), mode);
    assert.match(mode, /it is the ONLY place design files are written/, 'the same path rule the full mode chip carries');
    assert.ok(modeLines.includes(`- home · ${homeFile}`), 'screens are listed with absolute files');
    for (const chip of chips.slice(1)) {
      const chipLines = (chip.text ?? '').split('\n');
      assert.ok(chipLines.includes(`Workspace: ${ws}`), 'F6: the pick names its workspace');
      assert.ok(chipLines.includes(`File: ${homeFile}`), 'F6: …and the screen file to edit');
    }
    assert.deepEqual(queue.acks.map((ack) => ack.seq), [2], 'the mode chip never changes the ack');
    stop = true;
    mock.timers.tick(12_000);
    await flush();
    mock.timers.tick(1_000);
    await loop;
  } finally {
    mock.timers.reset();
    setWorkspace(null);
  }
});

test('F2: Start in a draft chat (no session) toasts the "send a message first" instruction and creates nothing', async () => {
  setWorkspace(null);
  setSessionId(null);
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  const toasts = stubToast();
  stubStorage();
  await main.clickServerControl();
  assert.ok(toasts.some((toast) => toast.kind === 'error' && /sending any message first/.test(toast.message)), 'a visible error, not only the screen-reader live region');
  assert.equal(calls.length, 0, 'nothing is scaffolded');
});

test('F2: Start shows a busy state across the workspace creation and swallows a double click; a failure toasts', async () => {
  setWorkspace(null);
  setSessionId('ses_start');
  const toasts = stubToast();
  stubStorage();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls = stubService(async (request) => {
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (request.path === '/scaffold') {
      const body = JSON.parse(request.body ?? '{}') as { dir?: string };
      return { status: 200, body: JSON.stringify({ ok: true, jobId: 'job-s', dir: body.dir, url: 'http://localhost:5173/' }) };
    }
    if (request.path === '/scaffold/status') {
      await gate;
      return { status: 200, body: JSON.stringify({ state: 'failed', elapsedMs: 1000, error: 'npm exited with code 1' }) };
    }
    return { status: 404, body: '{}' };
  });
  const first = main.clickServerControl();
  await flush();
  assert.equal(main.getServerControlState().pending, true, 'the button is busy while the workspace is created');
  await main.clickServerControl();
  release();
  await first;
  assert.equal(calls.filter((call) => call.path === '/scaffold').length, 1, 'the second click was swallowed');
  assert.equal(main.getServerControlState().pending, false, 'the busy state clears');
  assert.ok(toasts.some((toast) => toast.kind === 'error' && /Could not create the canvas workspace/.test(toast.message)), 'the failure is a visible toast');
  setWorkspace(null);
  setSessionId(null);
});

test('F4/F8: the page flow scaffolds with the PAGE selections, and a failed job still ships the real path and binds ws/', async () => {
  setWorkspace(null);
  setSessionId(null);
  const store = stubStorage();
  stubToast();
  const sessions = stubStartSession();
  stubListProjects([]);
  const calls = stubService((request) => {
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (request.path === '/scaffold') {
      const body = JSON.parse(request.body ?? '{}') as { dir?: string };
      return { status: 200, body: JSON.stringify({ ok: true, jobId: 'job-p', dir: body.dir, url: 'http://localhost:5173/' }) };
    }
    if (request.path === '/scaffold/status') return { status: 200, body: JSON.stringify({ state: 'failed', elapsedMs: 3000, error: 'npm exited with code 1' }) };
    return { status: 200, body: JSON.stringify({ ok: true }) };
  });
  main.setSurface('page');
  main.resetReferenceDraft();
  main.setPrompt('Quarterly review deck');
  main.setPageChoice({ type: 'deck', direction: 'auto', fidelity: 'wireframe' });
  try {
    await startNewDesign();
    const body = JSON.parse(calls.find((call) => call.path === '/scaffold')!.body ?? '{}') as { dir: string; type: string; fidelity: string };
    assert.equal(body.type, 'deck', 'F8: the page\'s chosen type, not the row mode');
    assert.equal(body.fidelity, 'wireframe', 'F8: the page\'s chosen fidelity');
    assert.deepEqual(calls.find((call) => call.path === '/scaffold/status')?.query, { job: 'job-p', dir: body.dir }, 'F1: the page poll names the dir too');
    assert.equal(sessions.length, 1, 'the session still starts');
    assert.ok((sessions[0]!.text ?? '').includes(`Design Canvas workspace: ${body.dir}`), 'F4: the prompt names the folder that exists on disk');
    assert.doesNotMatch(sessions[0]!.text ?? '', /ask if the path is missing/, 'F4: never the "missing path" fallback next to a real folder');
    assert.deepEqual((store.get(workspaceStorageKey('s1')!) as { dir?: string } | undefined)?.dir, body.dir, 'F4: ws/ binds the new session to the real folder');
  } finally {
    main.setPageChoice({ type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi' });
    main.setSurface('panel');
    main.setPrompt('');
    setWorkspace(null);
  }
});

// =====================================================================
// F9 + the hidden-pane safety net (rail package).
// =====================================================================

test('F9: a page-started session gets a FRESH canvas-open handoff before mode/, so its row opens the window instead of turning mode OFF', async () => {
  setWorkspace(null);
  setSessionId(null);
  const store = stubStorage();
  const order: string[] = [];
  const set = (api.host as unknown as { storage: { set: (key: string, value: unknown) => Promise<void> } }).storage.set;
  (api.host as unknown as { storage: { set: (key: string, value: unknown) => Promise<void> } }).storage.set = async (key, value) => {
    order.push(key);
    await set(key, value);
  };
  stubToast();
  stubStartSession();
  stubListProjects([]);
  // Chrome takes a while to come up: the open stays in flight until released,
  // which is exactly when a closed-window /state read could flip the mode.
  let releaseOpen: () => void = () => undefined;
  const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
  const calls = stubService(async (request) => {
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (IS_SCAFFOLD_PATH(request.path)) return scaffoldJob(request);
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/open') {
      await openGate;
      return { status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/home.html', title: 'Site', settled: true }) };
    }
    return { status: 200, body: JSON.stringify({ ok: true }) };
  });
  await resetToClosedWindow();
  main.setSurface('page');
  main.resetReferenceDraft();
  main.setPrompt('A pricing page');
  const before = Date.now();
  try {
    await startNewDesign();
    const handoff = store.get(main.openHandoffKey('s1')!) as { dir?: string; jobId?: unknown; at?: number } | undefined;
    const ws = store.get(workspaceStorageKey('s1')!) as { dir: string };
    assert.ok(handoff, 'the new session carries a canvas-open handoff');
    assert.equal(handoff!.dir, ws.dir, 'it names the workspace the session was bound to');
    assert.equal(handoff!.jobId, null, 'the page already waited out the job');
    assert.ok((handoff!.at ?? 0) >= before, 'written fresh (the 5-minute staleness rule)');
    assert.ok(order.indexOf(main.openHandoffKey('s1')!) < order.indexOf(modeStorageKey('s1')!), 'the handoff lands BEFORE mode/ turns ON');

    // The new session's row mounts: it adopts ON and claims the handoff
    // BEFORE /state can read "ON, no window" as the user closing it.
    main.setSurface('status');
    setWorkspace(null);
    await applySessionSnapshot({ id: 's1', busy: false });
    assert.equal(getModeState().on, true, 'the new session is born ON');
    await main.syncRowFromStorage();
    assert.equal(getPendingOpen(), true, 'the claimed handoff holds the pending-open guard');
    await flush();
    await applyState({ url: '', title: '', lastPick: null, pickSeq: 0, windowOpen: false });
    assert.equal(getModeState().on, true, 'the row did NOT flip the mode OFF');
    assert.ok(calls.some((call) => call.path === '/open'), 'the row is opening the canvas window');
    releaseOpen();
    await flush();
    await flush();
    assert.equal(store.has(main.openHandoffKey('s1')!), false, 'the handoff is consumed');
  } finally {
    main.setSurface('panel');
    main.setPrompt('');
    setWorkspace(null);
    setSessionId(null);
  }
});

test('isRealPane safety net: in a 1×1 panel frame (the hidden resolve pane) beginOpenHandoff claims nothing and opens nothing', async () => {
  setWorkspace(null);
  setSessionId('ses_tiny');
  stubToast();
  const store = stubStorage();
  const calls = stubService(() => ({ status: 200, body: JSON.stringify({ ok: true, url: 'http://localhost:5173/', title: '', settled: true }) }));
  store.set(workspaceStorageKey('ses_tiny')!, { dir: '/p/site', name: 'Site' });
  store.set(main.openHandoffKey('ses_tiny')!, { dir: '/p/site', jobId: null, at: Date.now() });
  store.set(modeStorageKey('ses_tiny')!, { on: true, type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', canvMode: 'edit', brief: '' });
  const frame = shim as { innerWidth: number; innerHeight: number };
  frame.innerWidth = 1;
  frame.innerHeight = 1;
  main.setSurface('panel');
  try {
    assert.equal(main.isRealPane(), false);
    assert.equal(await main.runOpenHandoff(), 'none', 'the hidden pane never claims');
    await main.syncRowFromStorage();
    await flush();
    assert.ok(store.has(main.openHandoffKey('ses_tiny')!), 'the record is LEFT for the row');
    assert.equal(calls.length, 0, 'no /open, /focus or job poll from a 1×1 frame');
    // The row is exempt from the size gate (its section may be 24 px tall).
    main.setSurface('status');
    assert.equal(await main.runOpenHandoff(), 'opened', 'the row still claims in a small frame');
  } finally {
    frame.innerWidth = 1024;
    frame.innerHeight = 768;
    main.setSurface('panel');
    setWorkspace(null);
    setSessionId(null);
  }
});
