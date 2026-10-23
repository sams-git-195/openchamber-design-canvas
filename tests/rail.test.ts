// The rail tab (surface "panel") — and the hidden 1×1 `/canvas` resolve pane
// the host mounts on the SAME surface.
//
// The first test drives the REAL mount: a fake host window answers the SDK
// `hello` with a `ready` for surface "panel" while the frame is 1×1 px and its
// document reads `visibilityState: 'visible'` — exactly the hidden pane
// GuestHosts mounts. It must render the static shell and NOTHING else: no
// service call, no storage write, no interval, no window open. The rest grow
// the frame to a real tab and exercise the rail's actions through test seams.
import { test } from 'node:test';
import assert from 'node:assert/strict';

type ServiceRequest = { method: string; path: string; query?: Record<string, string>; body?: string };
type StubResult = { status: number; body: string };

// ---- DOM recorder (the status-height pattern, plus textarea fields) ----

class RailNode {
  tagName: string;
  className = '';
  textContent = '';
  title = '';
  hidden = false;
  disabled = false;
  value = '';
  rows = 0;
  placeholder = '';
  tabIndex = 0;
  innerHTML = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = {
    setProperty: (name: string, value: string) => { this.style[name] = value; },
    removeProperty: (name: string) => { delete this.style[name]; },
  };
  children: RailNode[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<(event?: unknown) => void>>();
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get classList() {
    const self = this;
    const names = (): string[] => self.className.split(' ').filter(Boolean);
    return {
      add: (...add: string[]) => { self.className = [...names(), ...add].join(' '); },
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
  append(...nodes: Array<RailNode | string>): void { for (const node of nodes) if (node && typeof node !== 'string') this.children.push(node); }
  replaceChildren(...nodes: RailNode[]): void { this.children = [...nodes]; }
  addEventListener(name: string, callback: (event?: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
  }
  removeEventListener(): void { /* recorder */ }
  focus(): void { /* no focus engine */ }
  fire(name: string, event?: unknown): void { for (const callback of this.listeners.get(name) ?? []) callback(event); }
  contains(node: RailNode | null): boolean {
    if (!node) return false;
    return this.children.some((child) => child === node || child.contains(node));
  }
  querySelectorAll(): RailNode[] { return []; }
  querySelector(): RailNode | null { return null; }
  find(cls: string): RailNode | undefined {
    return this.className.split(' ').includes(cls) ? this : this.children.map((child) => child.find(cls)).find(Boolean);
  }
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

const SESSION_ID = 'rail-session-1';
const root = new RailNode('div');
let messageListeners: Array<(event: unknown) => void> = [];
const windowListeners = new Map<string, Array<() => void>>();

const shimWindow = {
  // The hidden resolve pane: GuestHosts' `h-px w-px` wrapper.
  innerWidth: 1,
  innerHeight: 1,
  getComputedStyle: () => ({ marginTop: '0px', marginBottom: '0px' }),
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (type === 'message') messageListeners.push(listener);
    else windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener as () => void]);
  },
  removeEventListener(type: string, listener: (event: unknown) => void) {
    if (type === 'message') messageListeners = messageListeners.filter((l) => l !== listener);
  },
  parent: {
    postMessage(message: unknown) {
      if ((message as { type?: string })?.type !== 'hello') return;
      setTimeout(() => {
        const ready = {
          channel: 'openchamber.sdk', v: 1, type: 'ready',
          payload: {
            theme: { mode: 'dark', tokens: THEME_TOKENS },
            locale: 'en-US',
            directory: '/chats/rail',
            session: { id: SESSION_ID, title: 'Rail session', busy: false },
            surface: 'panel',
            connection: { connected: true, account: 'fixture' },
            settings: {},
            item: null,
          },
        };
        for (const listener of [...messageListeners]) listener(new FakeMessageEvent('message', { data: ready, source: shimWindow.parent }));
      }, 10);
    },
  },
};

const shimDocument = {
  getElementById: (id: string) => (id === 'root' ? root : null),
  createElement: (tag: string) => new RailNode(tag),
  createElementNS: (_ns: string, tag: string) => new RailNode(tag),
  documentElement: new RailNode('html'),
  activeElement: null,
  body: new RailNode('body'),
  // The hidden pane reads visible too — visibility can NOT be the gate.
  visibilityState: 'visible',
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

(globalThis as { window?: unknown }).window = shimWindow;
(globalThis as { document?: unknown }).document = shimDocument;
(globalThis as { MessageEvent?: unknown }).MessageEvent = FakeMessageEvent;
// Every interval the panel starts is recorded and NEVER fires.
const intervals: number[] = [];
(globalThis as { setInterval?: unknown }).setInterval = ((_fn: () => void, ms: number) => { intervals.push(ms); return { unref() {} }; }) as unknown as typeof setInterval;

// ---- host recorders, installed before the mount can run ----

const serviceCalls: ServiceRequest[] = [];
let serviceHandler: (request: ServiceRequest) => StubResult = () => ({ status: 200, body: JSON.stringify({ ok: true }) });
const store = new Map<string, unknown>();
const storageWrites: string[] = [];
const toasts: Array<{ kind: string; message: string }> = [];
const sessions: Array<{ text?: string; providerId?: string }> = [];

const api = await import('../panel/api.ts');
const main = await import('../panel/main.ts');
const { modeStorageKey, workspaceStorageKey } = await import('../panel/mode.ts');

const host = api.host as unknown as Record<string, unknown>;
host.serviceRequest = async (request: ServiceRequest) => {
  serviceCalls.push(request);
  return serviceHandler(request);
};
host.storage = {
  get: async (key: string) => store.get(key),
  set: async (key: string, value: unknown) => { storageWrites.push(key); store.set(key, value); },
  delete: async (key: string) => { storageWrites.push(`delete:${key}`); store.delete(key); },
  keys: async () => [...store.keys()],
};
host.toast = async (toast: { kind: string; message: string }) => { toasts.push(toast); };
host.listProjects = async () => ({ kind: 'projects', state: 'ready', projects: [] });
host.startSession = async (request: { text?: string; providerId?: string }) => {
  sessions.push(request);
  return { sessionId: `new-${sessions.length}`, sent: 'sent' };
};
host.openSession = async () => undefined;
host.setHeight = async () => undefined;

const tick = (ms = 15) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function railNode(cls: string): RailNode {
  const node = root.find(cls);
  assert.ok(node, `the rail renders .${cls}`);
  return node!;
}

function resetRecorders(): void {
  serviceCalls.length = 0;
  storageWrites.length = 0;
  toasts.length = 0;
}

const CONFIG_BODY = JSON.stringify({ config: { version: 1, name: 'Site', url: 'http://localhost:5173' }, path: '/p/site/.design-studio.json' });
const WORKSPACES_BODY = JSON.stringify({ root: '/docs/Design Canvas', workspaces: [{ dir: '/docs/Design Canvas/one', name: 'one', url: 'http://localhost:5173', server: { recorded: true, up: true, port: 5173 } }] });
const SETTINGS_BODY = JSON.stringify({ workspaceRoot: '/docs/Design Canvas', source: 'default', defaultRoot: '/docs/Design Canvas', envOverride: false, previousRoots: [] });
const OPEN_OK = JSON.stringify({ ok: true, url: 'http://localhost:5173/home.html', title: 'Site', settled: true });

function liveService(windowOpen: boolean): (request: ServiceRequest) => StubResult {
  return (request) => {
    if (request.path === '/state') return { status: 200, body: JSON.stringify({ url: '', title: '', lastPick: null, pickSeq: 0, windowOpen }) };
    if (request.path === '/config') return { status: 200, body: CONFIG_BODY };
    if (request.path === '/workspaces') return { status: 200, body: WORKSPACES_BODY };
    if (request.path === '/settings') return { status: 200, body: SETTINGS_BODY };
    if (request.path === '/scaffold') {
      const body = JSON.parse(request.body ?? '{}') as { dir?: string };
      return { status: 200, body: JSON.stringify({ ok: true, jobId: 'job-r', dir: body.dir, url: 'http://localhost:5173/' }) };
    }
    if (request.path === '/scaffold/status') return { status: 200, body: JSON.stringify({ state: 'done', elapsedMs: 1000 }) };
    if (request.path === '/open') return { status: 200, body: OPEN_OK };
    return { status: 200, body: JSON.stringify({ ok: true }) };
  };
}

// ---- the hidden 1×1 pane ----

test('a 1×1 panel frame (the hidden /canvas pane) mounts the static rail shell and performs ZERO service calls, storage writes, intervals or opens', async () => {
  // Something for the mount to find: a workspace and a pending handoff. A
  // careless mount would read the config (service), claim the handoff
  // (storage delete) and open Chrome.
  store.set(workspaceStorageKey(SESSION_ID)!, { dir: '/p/site', name: 'Site' });
  store.set(main.openHandoffKey(SESSION_ID)!, { dir: '/p/site', jobId: null, at: Date.now() });
  store.set(modeStorageKey(SESSION_ID)!, { on: true, type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', canvMode: 'edit', brief: '' });
  for (let i = 0; i < 60 && !root.find('ds-rail'); i++) await tick();
  assert.ok(root.find('ds-rail'), 'the rail shell mounted');
  await tick(50);
  assert.equal(main.isRealPane(), false, 'the 1×1 frame is not a real pane');
  assert.ok(railNode('ds-rail-primary'), 'the shell has the primary button');
  assert.ok(railNode('ds-rail-input'), 'the shell has the brief box');
  assert.deepEqual(railNode('ds-rail-work').children, [], 'no work list in a 1×1 frame');
  assert.equal(railNode('ds-rail-location').hidden, true, 'R5: no designs-location line in a 1×1 frame');
  assert.deepEqual(railNode('ds-rail-location').children, [], 'R5: …and nothing rendered into it');
  assert.deepEqual(serviceCalls, [], 'no service call of any kind (no /config, /state, /workspaces, /open)');
  assert.deepEqual(storageWrites, [], 'no storage write or delete (the handoff is not claimed)');
  assert.deepEqual(intervals, [], 'no interval is started');
  assert.ok(store.has(main.openHandoffKey(SESSION_ID)!), 'the handoff is left for the row');
  assert.equal(await main.runOpenHandoff(), 'none', 'the safety net: a 1×1 panel frame never claims');
  assert.deepEqual(serviceCalls, [], 'still nothing opened');
});

// ---- the real rail tab ----

test('the rail goes live when the frame grows into a real tab: one refresh interval, the work list, /state', async () => {
  resetRecorders();
  store.delete(main.openHandoffKey(SESSION_ID)!);
  serviceHandler = liveService(false);
  shimWindow.innerWidth = 320;
  shimWindow.innerHeight = 800;
  for (const listener of windowListeners.get('resize') ?? []) listener();
  await tick(50);
  assert.equal(main.isRealPane(), true);
  assert.equal(intervals.length, 1, 'exactly one rail refresh interval');
  assert.ok(serviceCalls.some((call) => call.path === '/workspaces'), 'Your design work loads');
  assert.ok(serviceCalls.some((call) => call.path === '/state'), 'the rail reads /state for Open vs Focus');
  assert.equal(serviceCalls.some((call) => call.path === '/open' || call.path === '/focus'), false, 'going live opens nothing');
  const work = railNode('ds-rail-work');
  assert.ok(work.find('ds-section'), 'the work list section renders');
  assert.ok(work.find('ds-list-row'), 'the workspace row renders');
  assert.ok(work.find('ds-list-more'), 'R5: the row has its ⋯ menu');
  assert.ok(work.find('ds-list-stop'), 'R5: a recorded + up server gets the inline Stop');
  const badges: string[] = [];
  const collect = (node: RailNode): void => {
    if (node.className.split(' ').includes('ds-badge')) badges.push(node.textContent);
    node.children.forEach(collect);
  };
  collect(work);
  assert.ok(badges.includes('● Running'), 'R5: the "● Running" badge');
  assert.ok(serviceCalls.some((call) => call.path === '/settings'), 'R5: the real rail reads the designs location');
  const location = railNode('ds-rail-location');
  assert.equal(location.hidden, false, 'R5: the designs-location line shows in the real tab');
  assert.equal(location.find('ds-location-path')?.textContent, '/docs/Design Canvas');
  assert.equal(location.find('ds-location-change')?.textContent, 'Change');
  assert.equal(railNode('ds-rail-footer').textContent, 'Full home: Design Canvas in the sidebar.');
  // A second wake refreshes; it never stacks a second interval.
  for (const listener of windowListeners.get('focus') ?? []) listener();
  await tick();
  assert.equal(intervals.length, 1, 'still one interval');
});

test('rail primary: no session → disabled with the "send a message first" hint, and a click creates nothing', async () => {
  resetRecorders();
  main.setSessionId(null);
  main.setWorkspace(null);
  await main.refreshRail();
  const primary = railNode('ds-rail-primary');
  assert.equal(primary.disabled, true, 'disabled without a session (F2)');
  assert.equal(railNode('ds-rail-hint').textContent, 'Send a message to start this chat first');
  assert.equal(railNode('ds-rail-hint').hidden, false);
  await main.clickRailPrimary();
  assert.equal(serviceCalls.some((call) => call.path === '/scaffold'), false, 'nothing is scaffolded');
  assert.equal(storageWrites.length, 0, 'nothing is written');
});

test('rail primary: no ws/ → "Create canvas" scaffolds, stores ws/, hands off and — with no row to claim it — opens the canvas itself', async () => {
  resetRecorders();
  const sid = 'rail-create';
  main.setSessionId(sid);
  main.setWorkspace(null);
  store.delete(workspaceStorageKey(sid)!);
  store.delete(modeStorageKey(sid)!);
  serviceHandler = liveService(false);
  await main.refreshRail();
  assert.equal(railNode('ds-rail-primary').textContent, 'Create canvas');
  assert.equal(railNode('ds-rail-primary').disabled, false);
  main.setRailClaimDelay(0);
  try {
    await main.clickRailPrimary();
  } finally {
    main.setRailClaimDelay(null);
  }
  assert.ok(serviceCalls.some((call) => call.path === '/scaffold'), 'the workspace is scaffolded');
  assert.ok(store.has(workspaceStorageKey(sid)!), 'ws/ is stored for this chat');
  assert.equal((store.get(modeStorageKey(sid)!) as { on?: boolean }).on, true, 'Design Mode is ON');
  assert.ok(storageWrites.indexOf(main.openHandoffKey(sid)!) < storageWrites.indexOf(modeStorageKey(sid)!), 'the handoff is written before mode/');
  assert.ok(serviceCalls.some((call) => call.path === '/scaffold/status'), 'the install job is waited out');
  const open = serviceCalls.find((call) => call.path === '/open');
  assert.ok(open, 'the canvas opened');
  assert.deepEqual(JSON.parse(open!.body ?? '{}'), { dir: (store.get(workspaceStorageKey(sid)!) as { dir: string }).dir, focus: true });
  assert.equal(store.has(main.openHandoffKey(sid)!), false, 'the rail consumed its own handoff');
  assert.equal(railNode('ds-rail-primary').textContent, 'Open canvas', 'the button now reads Open canvas');
});

test('rail primary: ws/ + window closed → "Open canvas" hands the open to the row; a row that claims it leaves the rail opening nothing', async () => {
  resetRecorders();
  const sid = 'rail-open';
  main.setSessionId(sid);
  main.setWorkspace(null);
  store.set(workspaceStorageKey(sid)!, { dir: '/p/site', name: 'Site' });
  store.set(modeStorageKey(sid)!, { on: false, type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', canvMode: 'edit', brief: '' });
  serviceHandler = liveService(false);
  await main.refreshRail();
  assert.equal(railNode('ds-rail-primary').textContent, 'Open canvas');
  await tick(); // the bind's own /config read settles first
  resetRecorders();
  main.setRailClaimDelay(40);
  try {
    const click = main.clickRailPrimary();
    await tick(10);
    const handoff = store.get(main.openHandoffKey(sid)!) as { dir?: string; jobId?: unknown } | undefined;
    assert.deepEqual({ dir: handoff?.dir, jobId: handoff?.jobId }, { dir: '/p/site', jobId: null }, 'a fresh handoff for the row');
    assert.equal((store.get(modeStorageKey(sid)!) as { on?: boolean }).on, true, 'Design Mode is ON for the row to act on');
    assert.equal(railNode('ds-rail-primary').disabled, true, 'busy while the hand-off waits');
    store.delete(main.openHandoffKey(sid)!); // the chat's row claims it
    await click;
  } finally {
    main.setRailClaimDelay(null);
  }
  assert.equal(serviceCalls.some((call) => call.path === '/open' || call.path === '/focus'), false, 'the row opens it; the rail does not open a second time');
  assert.equal(railNode('ds-rail-primary').disabled, false);
});

test('rail primary: ws/ + window open → "Open canvas" just focuses the live window', async () => {
  resetRecorders();
  const sid = 'rail-focus';
  main.setSessionId(sid);
  main.setWorkspace(null);
  store.set(workspaceStorageKey(sid)!, { dir: '/p/site', name: 'Site' });
  serviceHandler = liveService(true);
  await main.refreshRail();
  await tick(); // the bind's own /config read settles first
  resetRecorders();
  await main.clickRailPrimary();
  assert.deepEqual(serviceCalls.map((call) => call.path), ['/focus'], 'POST /focus only — no open, no handoff');
  assert.equal(storageWrites.length, 0, 'nothing written');
});

test('rail Start design reuses startNewDesign with the rail brief, then consumes the draft', async () => {
  resetRecorders();
  sessions.length = 0;
  main.setSessionId('rail-start');
  main.setWorkspace(null);
  serviceHandler = liveService(false);
  await main.refreshRail();
  const input = railNode('ds-rail-input');
  const start = railNode('ds-rail-start');
  assert.equal(start.disabled, true, 'nothing to send yet');
  input.value = 'A calm pricing page';
  input.fire('input');
  assert.equal(start.disabled, false, 'the brief enables Start design');
  await main.clickRailStartDesign();
  assert.equal(sessions.length, 1, 'one design chat started');
  assert.equal(sessions[0]!.providerId, 'design-canvas');
  assert.match(sessions[0]!.text ?? '', /A calm pricing page/, 'the session carries the rail brief');
  assert.ok(serviceCalls.some((call) => call.path === '/scaffold'), 'the page flow scaffolded the workspace');
  assert.equal(input.value, '', 'the rail draft is consumed on delivery');
  assert.ok(store.has(main.openHandoffKey('new-1')!), 'F9: the new chat carries its open handoff');
});
