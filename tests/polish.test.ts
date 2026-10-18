// P5 — polish and native feel: the toast wording guide, the rail badge, the
// message/session actions, `/canvas help`, the first-run strip and the
// diagnostics popover. The rail is mounted for real (a fake host answers the
// SDK `hello` with a `ready` for a real-sized "panel" frame); everything else
// runs against recording stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { EXTENSION_VERSION } from '../panel/version.ts';

type ServiceRequest = { method: string; path: string; query?: Record<string, string>; body?: string };
type StubResult = { status: number; body: string };

class Node_ {
  tagName: string;
  className = '';
  textContent = '';
  title = '';
  hidden = false;
  disabled = false;
  value = '';
  type = '';
  rows = 0;
  placeholder = '';
  tabIndex = 0;
  innerHTML = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = {
    setProperty: (name: string, value: string) => { this.style[name] = value; },
    removeProperty: (name: string) => { delete this.style[name]; },
  };
  children: Node_[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<(event?: unknown) => void>>();
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get classList() {
    const self = this;
    const names = (): string[] => self.className.split(' ').filter(Boolean);
    return {
      add: (...add: string[]) => { self.className = [...new Set([...names(), ...add])].join(' '); },
      remove: (...drop: string[]) => { self.className = names().filter((c) => !drop.includes(c)).join(' '); },
      toggle: (name: string, on?: boolean) => {
        const next = on ?? !names().includes(name);
        self.className = [...names().filter((c) => c !== name), ...(next ? [name] : [])].join(' ');
        return next;
      },
      contains: (name: string) => names().includes(name),
    };
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...nodes: Array<Node_ | string>): void { for (const node of nodes) if (node && typeof node !== 'string') this.children.push(node); }
  replaceChildren(...nodes: Node_[]): void { this.children = [...nodes]; }
  addEventListener(name: string, callback: (event?: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
  }
  removeEventListener(): void { /* recorder */ }
  focus(): void { /* no focus engine */ }
  fire(name: string, event: Record<string, unknown> = {}): void {
    const full = { preventDefault() {}, stopPropagation() {}, ...event };
    for (const callback of this.listeners.get(name) ?? []) callback(full);
  }
  has(cls: string): boolean { return this.className.split(' ').includes(cls); }
  find(cls: string): Node_ | undefined {
    return this.has(cls) ? this : this.children.map((child) => child.find(cls)).find(Boolean);
  }
  findAll(cls: string): Node_[] {
    return [...(this.has(cls) ? [this] : []), ...this.children.flatMap((child) => child.findAll(cls))];
  }
  querySelectorAll(selector: string): Node_[] { return selector.startsWith('.') ? this.findAll(selector.slice(1)) : []; }
  querySelector(selector: string): Node_ | null { return this.querySelectorAll(selector)[0] ?? null; }
}

class FakeMessageEvent {
  data: unknown;
  source: unknown;
  constructor(_type: string, init: { data?: unknown; source?: unknown }) { this.data = init?.data; this.source = init?.source; }
}

const THEME_TOKENS = {
  background: '#17181b', elevated: '#202126', foreground: '#e7e7ea', muted: '#9a9aa2',
  subtle: '#1c1d21', border: '#2c2d33', hover: '#26272c', selection: '#2b3a5c',
  focus: '#4c8dff', primary: '#4c8dff', mutedSurface: '#1c1d21', elevatedForeground: '#e7e7ea',
  active: '#2f3037', selectionForeground: '#eef2ff', primaryForeground: '#ffffff',
  primaryText: '#ffffff', successText: '#e7e7ea', warningText: '#e7e7ea', errorText: '#e7e7ea',
  infoText: '#e7e7ea', success: '#46a758', warning: '#f5a524', error: '#e5484d', info: '#3b82f6',
  font: 'system-ui', mono: 'monospace', radius: '8px',
};

const SESSION_ID = 'polish-session';
/** The fake host answers `hello` only once the recorders are installed. */
let stubsInstalled = false;
const root = new Node_('div');
let messageListeners: Array<(event: unknown) => void> = [];

const shimWindow = {
  innerWidth: 320,
  innerHeight: 800,
  getComputedStyle: () => ({ marginTop: '0px', marginBottom: '0px' }),
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (type === 'message') messageListeners.push(listener);
  },
  removeEventListener(type: string, listener: (event: unknown) => void) {
    if (type === 'message') messageListeners = messageListeners.filter((l) => l !== listener);
  },
  parent: {
    postMessage(message: unknown) {
      if ((message as { type?: string })?.type !== 'hello') return;
      const deliver = (): void => {
        if (!stubsInstalled) { setTimeout(deliver, 5); return; }
        const ready = {
          channel: 'openchamber.sdk', v: 1, type: 'ready',
          payload: {
            theme: { mode: 'dark', tokens: THEME_TOKENS },
            locale: 'en-US',
            directory: '/chats/polish',
            session: { id: SESSION_ID, title: 'Polish session', busy: false },
            surface: 'panel',
            connection: { connected: true, account: 'fixture' },
            settings: {},
            item: null,
          },
        };
        for (const listener of [...messageListeners]) listener(new FakeMessageEvent('message', { data: ready, source: shimWindow.parent }));
      };
      setTimeout(deliver, 10);
    },
  },
};

const shimDocument = {
  getElementById: (id: string) => (id === 'root' ? root : null),
  createElement: (tag: string) => new Node_(tag),
  createElementNS: (_ns: string, tag: string) => new Node_(tag),
  createTextNode: (text: string) => text,
  documentElement: new Node_('html'),
  activeElement: null,
  body: new Node_('body'),
  visibilityState: 'visible' as 'visible' | 'hidden',
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

(globalThis as { window?: unknown }).window = shimWindow;
(globalThis as { document?: unknown }).document = shimDocument;
(globalThis as { MessageEvent?: unknown }).MessageEvent = FakeMessageEvent;
(globalThis as { setInterval?: unknown }).setInterval = (() => ({ unref() {} })) as unknown as typeof setInterval;

const serviceCalls: ServiceRequest[] = [];
let serviceHandler: (request: ServiceRequest) => StubResult = () => ({ status: 200, body: JSON.stringify({ ok: true }) });
const store = new Map<string, unknown>();
const toasts: Array<{ kind: string; message: string; copy?: unknown; persistent?: boolean }> = [];
const badges: Array<number | null> = [];
const clipboard: string[] = [];
let serviceStatusAnswer: { status: string } | Error = { status: 'ready' };

// Store a value the way the host would: JSON round-trip, so the panel never sees shared references.
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const api = await import('../panel/api.ts');
const main = await import('../panel/main.ts');
const copy = await import('../panel/copy.ts');
const { modeStorageKey, workspaceStorageKey, designMarkerKey } = await import('../panel/mode.ts');

const host = api.host as unknown as Record<string, unknown>;
host.serviceRequest = async (request: ServiceRequest) => {
  serviceCalls.push(request);
  return serviceHandler(request);
};
host.serviceStatus = async () => {
  if (serviceStatusAnswer instanceof Error) throw serviceStatusAnswer;
  return serviceStatusAnswer;
};
host.storage = {
  get: async (key: string) => (store.has(key) ? json(store.get(key)) : undefined),
  set: async (key: string, value: unknown) => { store.set(key, json(value)); },
  delete: async (key: string) => { store.delete(key); },
  keys: async () => [...store.keys()],
};
host.toast = async (toast: { kind: string; message: string }) => { toasts.push(toast); };
host.setBadge = async (count: number | null) => { badges.push(count); };
host.writeClipboard = async (text: string) => { clipboard.push(text); };
host.listProjects = async () => ({ kind: 'projects', state: 'ready', projects: [] });
host.setHeight = async () => undefined;
host.openSession = async () => undefined;

store.set('badge/count', { count: 3, at: 1, sessionId: 'old' });
serviceHandler = liveService(false);
stubsInstalled = true;

const tick = (ms = 15) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const WORKSPACES_BODY = JSON.stringify({
  root: '/docs/Design Canvas',
  workspaces: [{ dir: '/docs/Design Canvas/one', name: 'one', url: 'http://localhost:5173', server: { recorded: true, up: true, port: 5173 } }],
});
const SETTINGS_BODY = JSON.stringify({
  workspaceRoot: '/docs/Design Canvas', source: 'default', defaultRoot: '/docs/Design Canvas', envOverride: false,
  previousRoots: ['/old/one', '/old/two'],
});
const CONFIG_BODY = JSON.stringify({ config: { version: 1, name: 'Site', url: 'http://localhost:5173' }, path: '/p/site/.design-studio.json' });

function liveService(windowOpen = false): (request: ServiceRequest) => StubResult {
  return (request) => {
    if (request.path === '/state') return { status: 200, body: JSON.stringify({ url: '', title: '', lastPick: null, pickSeq: 0, windowOpen }) };
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (request.path === '/settings') return { status: 200, body: SETTINGS_BODY };
    if (request.path === '/focus') return { status: 200, body: JSON.stringify({ ok: true }) };
    return { status: 200, body: JSON.stringify({ ok: true }) };
  };
}

// ---- lint: the wording guide is held by the sources ----

test('no panel source says "successfully", and every host.toast goes through the wording helpers', async () => {
  const dir = new URL('../panel/', import.meta.url);
  const offenders: string[] = [];
  for (const name of await readdir(dir)) {
    if (!/\.(ts|html)$/.test(name)) continue;
    const text = await readFile(new URL(name, dir), 'utf8');
    if (/successfully/i.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], 'toasts and copy never say "successfully" — the toast itself is the success');
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  const raw = source.split('\n').filter((line) => /host\.toast\(/.test(line) && !/host\.toast\(copy\./.test(line) && !/^\s*(\/\/|\*)/.test(line));
  assert.equal(raw.length, 1, `only setStatus picks the helper by kind: ${raw.join(' | ')}`);
  assert.match(raw[0]!, /kind === 'error' \? copy\.errorToast\(message\) : copy\.infoToast\(message\)/);
  assert.doesNotMatch(source, /host\.toast\(\{/, 'no hand-built toast objects');
});

// ---- the wording helpers ----

test('toast helpers: sentence case, one line, Copy on paths and ids, persistent only when asked, always under the host cap', () => {
  const plain = copy.errorToast('Could not open the canvas: boom. Try again.');
  assert.deepEqual(plain, { kind: 'error', message: 'Could not open the canvas: boom. Try again.' }, 'no path or id → no Copy');
  assert.equal(copy.errorToast('The folder C:\\Users\\sam\\Documents\\Design Canvas\\one no longer exists.').copy, true, 'a path → Copy');
  assert.equal(copy.errorToast('Session ses_abc123 is gone.').copy, true, 'an id → Copy');
  assert.equal(copy.infoToast('Opened /a/b/c/d/e.').copy, undefined, 'Copy is for errors');
  assert.equal(copy.errorToast('x', { persistent: true }).persistent, true);
  assert.equal(copy.errorToast('x').persistent, undefined, 'persistent is opt-in');
  const longPath = `/very/long/${'folder-name/'.repeat(80)}file.png`;
  const long = copy.errorToast(`Export failed: ${longPath}. Try again.`);
  assert.ok(long.message.length <= copy.TOAST_MAX, 'under GUEST_TOAST_MAX');
  assert.ok(long.message.includes('…'), 'the path is truncated in the middle');
  assert.ok(long.message.startsWith('Export failed: /very/long/'), 'the head stays readable');
  assert.deepEqual((long.copy as { text: string }).text, `Export failed: ${longPath}. Try again.`, 'Copy carries the FULL text');
  const multi = copy.infoToast('line one\nline two');
  assert.equal(multi.message.includes('\n'), false, 'one line');
  assert.equal(copy.DESIGN_STARTED, 'Design started. Controls are in Work Status.', 'outcome first, then the next step');
  for (const sample of [copy.DESIGN_STARTED, copy.exportFailedToStart('x'), copy.critiqueFailed('x'), copy.startSessionFailed('x'), copy.setupFailed('Canvas setup failed: x')]) {
    assert.match(sample, /^[A-Z]/, `sentence case: ${sample}`);
    assert.match(sample, /[.!?]$/, `ends like a sentence: ${sample}`);
    assert.doesNotMatch(sample, /successfully|!|\n/i);
  }
});

test('the manifest declares the two actions with the shapes the SDK validates', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
    openchamber: { apiVersion: number; contributes: { actions?: Array<Record<string, unknown>> } };
  };
  const actions = pkg.openchamber.contributes.actions ?? [];
  assert.ok(actions.length >= 1 && actions.length <= 8, 'GUEST_ACTIONS_MAX is 8');
  const ids = actions.map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const action of actions) {
    assert.match(String(action.id), /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case id');
    assert.ok(typeof action.label === 'string' && action.label.length >= 1 && action.label.length <= 40, 'label is 1–40 chars');
    assert.ok(action.where === 'message' || action.where === 'session');
    assert.ok(action.mode === 'open' || action.mode === 'background' || action.mode === undefined);
    if (action.roles !== undefined) assert.equal(action.where, 'message', 'roles only on message actions');
    if (action.payload !== undefined) assert.equal(action.where, 'session', 'payload only on session actions');
  }
  const open = actions.find((action) => action.id === 'open-in-design-canvas');
  assert.deepEqual(open, { id: 'open-in-design-canvas', label: 'Open in Design Canvas', where: 'message', roles: ['assistant'], mode: 'open' });
  const on = actions.find((action) => action.id === 'turn-on-design-mode');
  assert.deepEqual(on, { id: 'turn-on-design-mode', label: 'Turn on Design Mode', where: 'session', mode: 'open' });
  const version = await import('../panel/version.ts');
  assert.equal(version.EXTENSION_VERSION, pkg.version, 'panel/version.ts follows package.json');
  assert.equal(version.EXTENSION_API_VERSION, pkg.openchamber.apiVersion);
});

// ---- the real rail mount: badge reset ----

test('badge: a real rail mount clears the icon first, then zeroes the stored count', async () => {
  serviceHandler = liveService(false);
  for (let i = 0; i < 80 && !root.find('ds-rail'); i++) await tick();
  assert.ok(root.find('ds-rail'), 'the rail mounted');
  await tick(60);
  assert.equal(main.isRealPane(), true);
  assert.equal(badges[0], null, 'host.setBadge(null) first');
  assert.equal((store.get('badge/count') as { count: number }).count, 0, '…then the stored count is zeroed');
});

test('badge: a completed design turn increments the count while the rail is closed, and the rail clears it again', async () => {
  badges.length = 0;
  main.setBadgeTracking(true);
  const sid = 'design-chat';
  store.set(designMarkerKey(sid)!, { on: true, at: '2026-01-01T00:00:00.000Z' });
  store.set('badge/count', { count: 0, at: 0, sessionId: null });

  // The user is looking at the rail: nothing to badge.
  await main.handleSessionLifecycle({ sessionId: sid, phase: 'started' });
  await main.handleSessionLifecycle({ sessionId: sid, phase: 'completed' });
  assert.deepEqual(badges, [], 'no badge while the rail is on screen');

  // The rail goes to the background.
  shimDocument.visibilityState = 'hidden';
  try {
    await main.handleSessionLifecycle({ sessionId: sid, phase: 'completed' });
    assert.deepEqual(badges, [], 'a synthetic completed (no turn seen) never counts');

    await main.handleSessionLifecycle({ sessionId: sid, phase: 'started' });
    await main.handleSessionLifecycle({ sessionId: sid, phase: 'completed' });
    assert.deepEqual(badges, [1], 'the first completed design turn → 1');
    assert.equal((store.get('badge/count') as { count: number }).count, 1);

    // A second frame hearing the same turn within the window counts once.
    await main.handleSessionLifecycle({ sessionId: sid, phase: 'started' });
    await main.handleSessionLifecycle({ sessionId: sid, phase: 'completed' });
    assert.deepEqual(badges, [1], 'a repeat inside the dedupe window is dropped');

    store.set('badge/count', { count: 1, at: 1, sessionId: sid });
    await main.handleSessionLifecycle({ sessionId: sid, phase: 'started' });
    await main.handleSessionLifecycle({ sessionId: sid, phase: 'completed' });
    assert.deepEqual(badges, [1, 2], 'the next turn → 2');

    // A chat that never designed does not badge.
    await main.handleSessionLifecycle({ sessionId: 'plain-chat', phase: 'started' });
    await main.handleSessionLifecycle({ sessionId: 'plain-chat', phase: 'completed' });
    assert.deepEqual(badges, [1, 2], 'no design marker → no badge');
  } finally {
    shimDocument.visibilityState = 'visible';
  }

  // Back on the rail: the refresh clears a count another frame left behind.
  await main.refreshRail();
  assert.equal(badges.at(-1), null, 'the rail clears the icon');
  assert.equal((store.get('badge/count') as { count: number }).count, 0, 'and zeroes the count');
  main.setBadgeTracking(false);
});

// ---- /canvas help ----

test('/canvas help returns a chip listing every verb, one per line, and the brief hint', async () => {
  main.allowResolve(true);
  for (const args of ['help', ' HELP ', '?']) {
    const chip = await main.resolveCanvasCommand(args);
    assert.ok(chip, `"${args}" answers with a chip`);
    assert.equal(chip!.providerId, 'design-canvas');
    assert.equal(chip!.title, copy.CANVAS_HELP_TITLE);
    const lines = (chip!.text ?? '').split('\n');
    for (const verb of ['on', 'off', 'play', 'edit', 'wireframe | hi-fi | prototype | deck | custom', 'export', 'critique', 'help']) {
      assert.ok(lines.some((line) => line.startsWith(`/canvas ${verb} — `)), `lists ${verb}`);
    }
    assert.equal(lines.at(-1), 'Type a brief after /canvas to start a design in this chat.');
    assert.equal(lines.filter((line) => line.startsWith('/canvas ')).length, 8, 'one line per verb');
  }
  assert.equal(copy.isHelpVerb('help me design a pricing page'), false, 'a brief that starts with "help" is still a brief');
  assert.equal(serviceCalls.some((call) => call.path === '/scaffold'), false, 'help touches no workspace');
});

// ---- actions ----

test('actions: "Open in Design Canvas" on a message of THIS chat hands the open to the row; another chat gets a toast', async () => {
  const sid = 'action-chat';
  main.setSessionId(sid);
  main.setWorkspace(null);
  store.set(workspaceStorageKey(sid)!, { dir: '/p/site', name: 'Site' });
  store.set(modeStorageKey(sid)!, { on: false, type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', canvMode: 'edit', brief: '' });
  serviceHandler = liveService(false);
  toasts.length = 0;
  main.setRailClaimDelay(0);
  try {
    await main.runItemAction({
      kind: 'message', action: 'open-in-design-canvas', sessionId: sid, sessionTitle: 'Chat', directory: '/chats/polish',
      messageId: 'msg_1', role: 'assistant', text: 'Here is the design',
    });
  } finally {
    main.setRailClaimDelay(null);
  }
  assert.equal((store.get(modeStorageKey(sid)!) as { on?: boolean }).on, true, 'Design Mode is ON for this chat');
  assert.ok(serviceCalls.some((call) => call.path === '/open'), 'the rail opened the canvas (no row claimed the handoff)');

  toasts.length = 0;
  await main.runItemAction({
    kind: 'message', action: 'open-in-design-canvas', sessionId: 'someone-else', sessionTitle: 'Other', directory: null,
    messageId: 'msg_2', role: 'assistant', text: '',
  });
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0]!.message, copy.ACTION_OTHER_CHAT);
});

test('actions: "Turn on Design Mode" arms an off chat and says so when it is already on', async () => {
  const sid = 'action-session';
  main.setSessionId(sid);
  main.setWorkspace(null);
  store.set(workspaceStorageKey(sid)!, { dir: '/p/site', name: 'Site' });
  store.set(modeStorageKey(sid)!, { on: false, type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', canvMode: 'edit', brief: '' });
  serviceHandler = liveService(true);
  toasts.length = 0;
  main.setRailClaimDelay(0);
  const item = { kind: 'session' as const, action: 'turn-on-design-mode', sessionId: sid, sessionTitle: 'Chat', directory: null };
  try {
    await main.runItemAction(item);
    assert.equal((store.get(modeStorageKey(sid)!) as { on?: boolean }).on, true, 'Design Mode turned ON even with a window already open');
    toasts.length = 0;
    await main.runItemAction(item);
  } finally {
    main.setRailClaimDelay(null);
  }
  assert.deepEqual(toasts.map((toast) => toast.message), [copy.ACTION_ALREADY_ON], 'already on → one calm line, no second arm');
});

// ---- diagnostics ----

test('diagnostics: the ring keeps the newest 20, the report carries version, service, root, previous roots, dev server and errors', async () => {
  main.resetDiagnostics();
  await main.loadDiagnostics();
  main.setSessionId('diag-chat');
  main.setWorkspace({ dir: '/docs/Design Canvas/one', name: 'one' });
  serviceHandler = (request) => {
    if (request.path === '/screens') {
      const dir = request.query?.dir ?? '';
      return { status: 500, body: JSON.stringify({ error: `boom ${dir}` }) };
    }
    return liveService(false)(request);
  };
  for (let i = 0; i < 25; i++) await api.getScreens(`/d/${i}`).catch(() => undefined);
  const errors = main.getDiagnosticErrors();
  assert.equal(errors.length, 20, 'capped at 20');
  assert.match(errors[0]!.message, /boom \/d\/24/, 'newest first');
  assert.equal(errors[0]!.source, 'GET /screens');
  assert.ok(!Number.isNaN(Date.parse(errors[0]!.at)), 'timestamped');

  // A scaffold failure and a start-session failure land in the same ring.
  serviceHandler = (request) => (request.path === '/scaffold' ? { status: 200, body: JSON.stringify({ ok: false, error: 'npm exited 1' }) } : liveService(false)(request));
  await main.flushDiagnostics();
  assert.equal((store.get('diag/errors') as unknown[]).length, 20, 'persisted to diag/errors');

  serviceHandler = liveService(false);
  const report = await main.diagnosticsReport();
  assert.match(report, new RegExp(`^Design Canvas ${EXTENSION_VERSION.replace(/\./g, '\\.')} \\(apiVersion 1\\)`));
  assert.match(report, /Service: ready/);
  assert.match(report, /Designs folder: \/docs\/Design Canvas \(source: default; previous folders: 2\)/);
  assert.match(report, /Workspace: \/docs\/Design Canvas\/one/);
  assert.match(report, /Dev server: up on port 5173/);
  assert.match(report, /Recent errors \(20, newest first\):/);
  assert.match(report, /\[GET \/screens\] boom \/d\/24/);
  assert.equal(report.includes('boom /d/4\n') || report.includes('boom /d/4 '), false, 'the oldest five fell off the ring');

  serviceStatusAnswer = new Error('NO_SERVICE');
  assert.match(await main.diagnosticsReport(), /Service: unreadable \(NO_SERVICE\)/);
  serviceStatusAnswer = { status: 'ready' };
});

test('diagnostics: the footer button opens the report and Copy diagnostics writes it to the clipboard with a confirmation toast', async () => {
  main.resetDiagnostics();
  main.setSessionId('diag-chat');
  main.setWorkspace({ dir: '/docs/Design Canvas/one', name: 'one' });
  serviceHandler = liveService(false);
  clipboard.length = 0;
  toasts.length = 0;
  const container = new Node_('div');
  main.renderDiagnosticsRow(container as unknown as HTMLElement);
  assert.equal(container.hidden, false, 'a real pane shows the control');
  const open = container.find('ds-diag-open');
  assert.equal(open?.textContent, 'Diagnostics');
  open!.fire('click');
  for (let i = 0; i < 40 && !container.find('ds-diag-pop'); i++) await tick();
  const pop = container.find('ds-diag-pop');
  assert.ok(pop, 'the report opens');
  assert.equal(pop!.getAttribute('role'), 'dialog');
  const copyBtn = container.find('ds-diag-copy');
  assert.equal(copyBtn?.textContent, 'Copy diagnostics');
  copyBtn!.fire('click');
  await tick();
  assert.equal(clipboard.length, 1);
  assert.match(clipboard[0]!, new RegExp(`Design Canvas ${EXTENSION_VERSION.replace(/\./g, '\\.')}`), 'version');
  assert.match(clipboard[0]!, /\/docs\/Design Canvas/, 'workspace root');
  assert.equal(pop!.find('ds-diag-text')?.textContent, clipboard[0], 'what you read is what you copy');
  assert.deepEqual(toasts.map((toast) => ({ kind: toast.kind, message: toast.message })), [{ kind: 'success', message: copy.DIAGNOSTICS_COPIED }]);
  // An unchanged container is not repainted by a redraw around it, so an open report survives.
  main.renderDiagnosticsRow(container as unknown as HTMLElement);
  assert.ok(container.find('ds-diag-pop'), 'still open after a redraw');
  container.find('ds-diag-close')!.fire('click');
  assert.ok(container.find('ds-diag-open'), 'Close returns to the button');
});

test('diagnostics: the report includes the ring entries it copies, newest first with timestamps', async () => {
  main.resetDiagnostics();
  await main.loadDiagnostics();
  serviceHandler = (request) => (request.path === '/workspaces' ? { status: 500, body: JSON.stringify({ error: 'disk offline' }) } : liveService(false)(request));
  main.setWorkspace({ dir: '/docs/Design Canvas/one', name: 'one' });
  const report = await main.diagnosticsReport();
  assert.match(report, /\d{4}-\d\d-\d\dT[\d:.]+Z \[GET \/workspaces\] disk offline/, 'timestamp, source and message');
  assert.match(report, /Dev server: unknown/, 'an unreadable peek says unknown');
});

// ---- the first-run strip (page) ----

test('first-run strip: shows the three steps until dismissed; the dismissal persists at prefs/first-run', async () => {
  main.setSurface('page');
  main.resetFirstRun();
  store.delete('prefs/first-run');
  assert.equal(main.renderFirstRun(), null, 'nothing renders before storage answered (no flash)');
  await main.loadFirstRun();
  assert.equal(main.getFirstRunDismissed(), false);
  const strip = main.renderFirstRun() as unknown as Node_ | null;
  assert.ok(strip, 'the strip renders above the composer');
  assert.equal(strip!.getAttribute('role'), 'note');
  assert.equal(strip!.find('ds-first-run-text')?.textContent, '1 Describe it · 2 Answer a few questions (or say go) · 3 Click any element, then Reference in chat');
  const dismiss = strip!.find('ds-first-run-dismiss');
  assert.equal(dismiss?.textContent, 'Dismiss');
  dismiss!.fire('click');
  await tick();
  assert.equal(main.renderFirstRun(), null, 'gone once dismissed');
  assert.equal((store.get('prefs/first-run') as { dismissed?: boolean }).dismissed, true, 'stored at prefs/first-run');

  // A later page load reads the dismissal back.
  main.resetFirstRun();
  await main.loadFirstRun();
  assert.equal(main.getFirstRunDismissed(), true);
  assert.equal(main.renderFirstRun(), null, 'stays dismissed across page loads');
  main.setSurface('panel');
});

test('the strip sits above the composer in the page column', async () => {
  const source = await readFile(new URL('../panel/main.ts', import.meta.url), 'utf8');
  assert.match(source, /renderHeader\(\), \.\.\.\(firstRun \? \[firstRun\] : \[\]\), renderComposer\(\)/);
  assert.match(source, /role[^\n]*note|setAttribute\('role', 'note'\)/);
});
