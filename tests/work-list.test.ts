// R5: the work-list row manages its workspace — the ⋯ menu (Rename…, Stop
// dev server, Copy folder path), the inline rename, the "● Running" badge and
// the inline Stop with its two-step confirm. Driven through the real row
// renderer against a recording DOM and a stubbed host/service; no mount.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

type ServiceRequest = { method: string; path: string; query?: Record<string, string>; body?: string };
type StubResult = { status: number; body: string };

class FakeNode {
  tagName: string;
  className = '';
  textContent = '';
  title = '';
  hidden = false;
  disabled = false;
  value = '';
  type = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = {};
  children: FakeNode[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<(event?: unknown) => void>>();
  focused = 0;
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
  append(...nodes: Array<FakeNode | string>): void { for (const node of nodes) if (node && typeof node !== 'string') this.children.push(node); }
  replaceChildren(...nodes: FakeNode[]): void { this.children = [...nodes]; }
  addEventListener(name: string, callback: (event?: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
  }
  removeEventListener(): void { /* recorder */ }
  focus(): void { this.focused += 1; }
  select(): void { /* recorder */ }
  fire(name: string, event: Record<string, unknown> = {}): void {
    const full = { preventDefault() {}, stopPropagation() {}, ...event };
    for (const callback of this.listeners.get(name) ?? []) callback(full);
  }
  contains(node: FakeNode | null): boolean {
    if (!node) return false;
    return this.children.some((child) => child === node || child.contains(node));
  }
  has(cls: string): boolean { return this.className.split(' ').includes(cls); }
  find(cls: string): FakeNode | undefined {
    return this.has(cls) ? this : this.children.map((child) => child.find(cls)).find(Boolean);
  }
  findAll(cls: string): FakeNode[] {
    return [...(this.has(cls) ? [this] : []), ...this.children.flatMap((child) => child.findAll(cls))];
  }
  querySelectorAll(selector: string): FakeNode[] { return selector.startsWith('.') ? this.findAll(selector.slice(1)) : []; }
  querySelector(selector: string): FakeNode | null { return this.querySelectorAll(selector)[0] ?? null; }
}

const root = new FakeNode('div');
(globalThis as { window?: unknown }).window = {
  innerWidth: 1024,
  innerHeight: 768,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  parent: { postMessage: () => undefined },
};
(globalThis as { document?: unknown }).document = {
  getElementById: (id: string) => (id === 'root' ? root : null),
  createElement: (tag: string) => new FakeNode(tag),
  createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
  createTextNode: (text: string) => text,
  documentElement: new FakeNode('html'),
  body: new FakeNode('body'),
  activeElement: null,
  visibilityState: 'visible',
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

const api = await import('../panel/api.ts');
const main = await import('../panel/main.ts');
const { workspaceStorageKey } = await import('../panel/mode.ts');
type Row = import('../panel/api.ts').WorkspaceWorkRow;

const serviceCalls: ServiceRequest[] = [];
let serviceHandler: (request: ServiceRequest) => StubResult | Promise<StubResult> = () => ({ status: 200, body: '{}' });
const store = new Map<string, unknown>();
const storageWrites: string[] = [];
const toasts: Array<{ kind: string; message: string }> = [];
const clipboard: string[] = [];
let sessionsByProject: Record<string, Array<{ id: string; activity: string }>> = {};

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
host.writeClipboard = async (text: string) => { clipboard.push(text); };
host.listProjects = async () => ({
  kind: 'projects', state: 'ready',
  projects: Object.keys(sessionsByProject).map((id) => ({ id, name: id, directory: `/projects/${id}` })),
});
host.listSessions = async (projectId: string) => ({
  kind: 'sessions', projectId, state: 'ready', coverage: [],
  sessions: (sessionsByProject[projectId] ?? []).map((s) => ({ ...s, items: [] })),
});

main.setSurface('page'); // rerender() is a no-op without a mounted page body

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await flushMicrotasks();
};
const ok = (body: unknown): StubResult => ({ status: 200, body: JSON.stringify(body) });

const DIR_ONE = '/docs/Design Canvas/one';
const DIR_TWO = '/docs/Design Canvas/two';

function rowOf(over: Partial<Row> = {}): Row {
  return { dir: DIR_ONE, name: 'one', url: 'http://localhost:5173', sessionId: null, ...over };
}

function reset(): void {
  serviceCalls.length = 0;
  storageWrites.length = 0;
  toasts.length = 0;
  clipboard.length = 0;
  sessionsByProject = {};
  main.resetStopState();
  main.setWorkspace(null);
  main.setSessionId('ses-current');
}

function need(node: FakeNode, cls: string): FakeNode {
  const found = node.find(cls);
  assert.ok(found, `renders .${cls}`);
  return found!;
}

function menuLabels(item: FakeNode): string[] {
  return item.findAll('ds-row-menu-item').map((node) => node.textContent);
}

function openMenu(item: FakeNode): void {
  need(item, 'ds-list-more').fire('click');
}

function clickMenu(item: FakeNode, label: string): void {
  const entry = item.findAll('ds-row-menu-item').find((node) => node.textContent === label);
  assert.ok(entry, `the menu offers ${label}`);
  entry!.fire('click');
}

function defaultService(request: ServiceRequest): StubResult {
  if (request.path === '/workspaces') return ok({ root: '/docs/Design Canvas', workspaces: [] });
  if (request.path === '/state') return ok({ url: '', title: '', lastPick: null, pickSeq: 0, windowOpen: false, dir: null });
  return ok({ ok: true });
}

test('row-menu-rename-inline-enter-saves-esc-cancels', async () => {
  reset();
  let release!: (result: StubResult) => void;
  serviceHandler = (request) => {
    if (request.path === '/workspaces/rename') return new Promise<StubResult>((resolve) => { release = resolve; });
    return defaultService(request);
  };
  const row = rowOf({ dir: '/docs/Design Canvas/rename-a', name: 'Alpha' });
  const item = main.renderWorkspaceListRow(row) as unknown as FakeNode;
  assert.equal(need(item, 'ds-list-name').textContent, 'Alpha');
  openMenu(item);
  assert.ok(item.find('ds-row-menu'), 'the ⋯ opens the row menu');
  assert.equal(need(item, 'ds-row-menu').getAttribute('role'), 'dialog', 'the shared anchored popover');
  assert.deepEqual(menuLabels(item), ['Rename…', 'Copy folder path'], 'no Stop entry for a row without a running server');

  // Esc cancels.
  clickMenu(item, 'Rename…');
  assert.equal(item.find('ds-row-menu'), undefined, 'choosing closes the menu');
  let input = need(item, 'ds-list-rename-input');
  assert.equal(input.value, 'Alpha', 'the field is prefilled');
  assert.equal(item.find('ds-list-name'), undefined, 'the name is swapped for the field');
  input.fire('keydown', { key: 'Escape' });
  assert.equal(item.find('ds-list-rename-input'), undefined, 'Escape cancels');
  assert.equal(need(item, 'ds-list-name').textContent, 'Alpha');

  // Blur cancels too.
  openMenu(item);
  clickMenu(item, 'Rename…');
  need(item, 'ds-list-rename-input').fire('blur');
  assert.equal(item.find('ds-list-rename-input'), undefined, 'leaving the field cancels');
  assert.equal(serviceCalls.some((call) => call.path === '/workspaces/rename'), false, 'a cancel sends nothing');

  // A refusal stays inline, the field stays editable.
  openMenu(item);
  clickMenu(item, 'Rename…');
  input = need(item, 'ds-list-rename-input');
  input.value = 'x'.repeat(200);
  input.fire('input');
  input.fire('keydown', { key: 'Enter' });
  await settle();
  input = need(item, 'ds-list-rename-input');
  assert.equal(input.disabled, true, 'disabled while saving');
  assert.equal(input.getAttribute('aria-busy'), 'true');
  assert.ok(item.find('ds-reference-spinner'), 'a spinner while saving');
  release(ok({ ok: false, error: 'The name is too long (max 80 characters).' }));
  await settle();
  const alert = need(item, 'ds-list-alert');
  assert.equal(alert.getAttribute('role'), 'alert');
  assert.equal(alert.textContent, 'The name is too long (max 80 characters).');
  input = need(item, 'ds-list-rename-input');
  assert.equal(input.disabled, false, 'editable again after a refusal');

  // Enter saves.
  input.value = 'Beta';
  input.fire('input');
  input.fire('keydown', { key: 'Enter' });
  await settle();
  release(ok({ ok: true, name: 'Beta' }));
  await settle();
  assert.equal(item.find('ds-list-rename-input'), undefined, 'the field closes on success');
  assert.equal(need(item, 'ds-list-name').textContent, 'Beta', 'the row updates in place');
  assert.equal(item.find('ds-list-alert'), undefined, 'the earlier error is cleared');
  const renames = serviceCalls.filter((call) => call.path === '/workspaces/rename');
  assert.deepEqual(JSON.parse(renames.at(-1)!.body ?? '{}'), { dir: '/docs/Design Canvas/rename-a', name: 'Beta' });
  assert.equal(renames.at(-1)!.method, 'POST');
  const renameAt = serviceCalls.lastIndexOf(renames.at(-1)!);
  assert.ok(serviceCalls.slice(renameAt).some((call) => call.path === '/workspaces'), 'the list reloads after the rename');
});

test('rename-updates-mapped-ws-record-only-if-present', async () => {
  reset();
  store.clear();
  store.set(workspaceStorageKey('ses-a')!, { dir: DIR_ONE, name: 'one' });
  store.set(workspaceStorageKey('ses-gone')!, { dir: DIR_TWO, name: 'two' });
  serviceHandler = (request) => {
    if (request.path === '/workspaces') {
      return ok({ root: '/docs/Design Canvas', workspaces: [{ dir: DIR_ONE, name: 'one' }, { dir: DIR_TWO, name: 'two' }, { dir: '/docs/Design Canvas/three', name: 'three' }] });
    }
    if (request.path === '/workspaces/rename') return ok({ ok: true, name: JSON.parse(request.body ?? '{}').name });
    return defaultService(request);
  };
  await main.loadCanvasWorkspaces(); // builds the dir → session map from ws/
  main.setWorkspace({ dir: DIR_ONE, name: 'one' });

  // Mapped and present: rewritten as {...record, name}.
  const one = main.renderWorkspaceListRow(rowOf({ dir: DIR_ONE, name: 'one', sessionId: 'ses-a' })) as unknown as FakeNode;
  openMenu(one);
  clickMenu(one, 'Rename…');
  let input = need(one, 'ds-list-rename-input');
  input.value = 'Uno';
  input.fire('input');
  input.fire('keydown', { key: 'Enter' });
  await settle();
  assert.deepEqual(store.get(workspaceStorageKey('ses-a')!), { dir: DIR_ONE, name: 'Uno' });
  assert.equal(main.getWorkspaceState()?.name, 'Uno', 'the bound workspace takes the new name');

  // Mapped, but the record vanished since the scan: nothing is written.
  store.delete(workspaceStorageKey('ses-gone')!);
  storageWrites.length = 0;
  const two = main.renderWorkspaceListRow(rowOf({ dir: DIR_TWO, name: 'two', sessionId: 'ses-gone' })) as unknown as FakeNode;
  openMenu(two);
  clickMenu(two, 'Rename…');
  input = need(two, 'ds-list-rename-input');
  input.value = 'Dos';
  input.fire('input');
  input.fire('keydown', { key: 'Enter' });
  await settle();
  assert.equal(store.has(workspaceStorageKey('ses-gone')!), false, 'a vanished record is never recreated');

  // Unmapped: no ws/ key of any kind is created.
  const three = main.renderWorkspaceListRow(rowOf({ dir: '/docs/Design Canvas/three', name: 'three' })) as unknown as FakeNode;
  openMenu(three);
  clickMenu(three, 'Rename…');
  input = need(three, 'ds-list-rename-input');
  input.value = 'Tres';
  input.fire('input');
  input.fire('keydown', { key: 'Enter' });
  await settle();
  assert.deepEqual(storageWrites, [], 'no storage write for a vanished or unmapped record');
  assert.equal(main.getWorkspaceState()?.name, 'Uno', 'another row\'s rename never touches the bound workspace');
});

test('row-stop-button-only-when-recorded-and-up', () => {
  reset();
  const running = main.renderWorkspaceListRow(rowOf({ dir: '/docs/Design Canvas/run', server: { recorded: true, up: true, port: 5173 } })) as unknown as FakeNode;
  assert.ok(running.find('ds-list-stop'), 'recorded + up → an inline Stop');
  assert.equal(running.findAll('ds-badge').map((b) => b.textContent).includes('● Running'), true, 'the "● Running" badge');
  assert.match(need(running, 'ds-list-stop').getAttribute('aria-label') ?? '', /^Stop the one dev server$/);
  openMenu(running);
  assert.deepEqual(menuLabels(running), ['Rename…', 'Stop dev server', 'Copy folder path']);
  for (const server of [{ recorded: true, up: false, port: 5173 }, { recorded: false, up: true, port: 5173 }, undefined]) {
    const item = main.renderWorkspaceListRow(rowOf({ dir: `/docs/Design Canvas/x-${String(server?.recorded)}-${String(server?.up)}`, server })) as unknown as FakeNode;
    assert.equal(item.find('ds-list-stop'), undefined, `no Stop for ${JSON.stringify(server)}`);
    assert.equal(item.findAll('ds-badge').some((b) => b.has('running')), false);
    openMenu(item);
    assert.deepEqual(menuLabels(item), ['Rename…', 'Copy folder path']);
  }
});

test('row-stop-busy-then-refresh', async () => {
  reset();
  const dir = '/docs/Design Canvas/busy';
  let release!: (result: StubResult) => void;
  serviceHandler = (request) => {
    if (request.path === '/server/stop') return new Promise<StubResult>((resolve) => { release = resolve; });
    return defaultService(request);
  };
  main.setWorkspace({ dir, name: 'busy' });
  main.markServerStartedByUs(dir);
  const item = main.renderWorkspaceListRow(rowOf({ dir, server: { recorded: true, up: true, port: 5173 } })) as unknown as FakeNode;
  need(item, 'ds-list-stop').fire('click');
  await settle();
  const stop = need(item, 'ds-list-stop');
  assert.equal(stop.textContent, 'Stopping…');
  assert.equal(stop.disabled, true);
  assert.equal(stop.getAttribute('aria-busy'), 'true');
  const stopCall = serviceCalls.find((call) => call.path === '/server/stop');
  assert.deepEqual(JSON.parse(stopCall!.body ?? '{}'), { dir }, 'POST /server/stop {dir} directly');
  assert.equal(stopCall!.method, 'POST');
  release(ok({ ok: true, stopped: true }));
  await settle();
  assert.deepEqual(main.getStopState().startedServers, [], 'the dir is forgotten from startedServers');
  assert.equal(main.getServerControlState().status, false, 'the bound workspace\'s control reads stopped');
  const after = serviceCalls.slice(serviceCalls.indexOf(stopCall!));
  assert.ok(after.some((call) => call.path === '/workspaces'), 'the list reloads afterwards');
  assert.equal(need(item, 'ds-list-stop').disabled, false, 'no longer busy');
});

test('row-stop-confirms-when-open-on-canvas', async () => {
  reset();
  const dir = 'C:\\Docs\\Design Canvas\\live';
  let windowDir: string | null = 'c:/Docs/Design Canvas/live';
  let stateFails = false;
  serviceHandler = (request) => {
    if (request.path === '/state') {
      if (stateFails) return { status: 500, body: '{}' };
      return ok({ url: '', title: '', lastPick: null, pickSeq: 0, windowOpen: true, dir: windowDir });
    }
    if (request.path === '/server/stop') return ok({ ok: true, stopped: true });
    return defaultService(request);
  };
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const row = rowOf({ dir, server: { recorded: true, up: true, port: 5173 } });
    const item = main.renderWorkspaceListRow(row) as unknown as FakeNode;
    need(item, 'ds-list-stop').fire('click');
    await settle();
    assert.equal(serviceCalls.some((call) => call.path === '/server/stop'), false, 'the first click only arms');
    assert.equal(need(item, 'ds-list-stop').textContent, 'Confirm stop');
    mock.timers.tick(4000);
    assert.notEqual(need(item, 'ds-list-stop').textContent, 'Confirm stop', 'the confirm disarms after 4 s');
    need(item, 'ds-list-stop').fire('click');
    await settle();
    need(item, 'ds-list-stop').fire('click');
    await settle();
    assert.equal(serviceCalls.filter((call) => call.path === '/server/stop').length, 1, 'the second click stops');

    // Window on another workspace, but the mapped chat is busy → confirm.
    windowDir = '/somewhere/else';
    const sessionDir = '/docs/Design Canvas/chat-busy';
    main.setSessionBusy(true);
    const mapped = main.renderWorkspaceListRow(rowOf({ dir: sessionDir, sessionId: 'ses-current', server: { recorded: true, up: true, port: 5173 } })) as unknown as FakeNode;
    need(mapped, 'ds-list-stop').fire('click');
    await settle();
    assert.equal(need(mapped, 'ds-list-stop').textContent, 'Confirm stop', 'a busy mapped chat asks first');

    // Another chat whose status cannot be found → fail closed to confirm.
    const unknown = main.renderWorkspaceListRow(rowOf({ dir: '/docs/Design Canvas/unknown', sessionId: 'ses-elsewhere', server: { recorded: true, up: true, port: 5173 } })) as unknown as FakeNode;
    need(unknown, 'ds-list-stop').fire('click');
    await settle();
    assert.equal(need(unknown, 'ds-list-stop').textContent, 'Confirm stop', 'an unverifiable session asks first');

    // A verified idle chat, window elsewhere → one click.
    sessionsByProject = { p1: [{ id: 'ses-idle', activity: 'idle' }] };
    const idle = main.renderWorkspaceListRow(rowOf({ dir: '/docs/Design Canvas/idle', sessionId: 'ses-idle', server: { recorded: true, up: true, port: 5173 } })) as unknown as FakeNode;
    const before = serviceCalls.filter((call) => call.path === '/server/stop').length;
    need(idle, 'ds-list-stop').fire('click');
    await settle();
    assert.equal(serviceCalls.filter((call) => call.path === '/server/stop').length, before + 1, 'idle and not on the canvas: one click');

    // An unreadable /state fails closed too.
    stateFails = true;
    const blind = main.renderWorkspaceListRow(rowOf({ dir: '/docs/Design Canvas/blind', server: { recorded: true, up: true, port: 5173 } })) as unknown as FakeNode;
    need(blind, 'ds-list-stop').fire('click');
    await settle();
    assert.equal(need(blind, 'ds-list-stop').textContent, 'Confirm stop');
  } finally {
    mock.timers.reset();
    main.setSessionBusy(false);
  }
});

test('row-stop-refusal-message', async () => {
  reset();
  let answer: unknown = { ok: false, stopped: false, error: 'The recorded server for this folder is not ours to stop.' };
  serviceHandler = (request) => {
    if (request.path === '/server/stop') return ok(answer);
    if (request.path === '/server/status') return ok({ up: true, port: 5173 });
    return defaultService(request);
  };
  const item = main.renderWorkspaceListRow(rowOf({ dir: '/docs/Design Canvas/refuse', server: { recorded: true, up: true, port: 5173 } })) as unknown as FakeNode;
  need(item, 'ds-list-stop').fire('click');
  await settle();
  let alert = need(item, 'ds-list-alert');
  assert.equal(alert.getAttribute('role'), 'alert');
  assert.equal(alert.textContent, 'The recorded server for this folder is not ours to stop.', 'the service\'s own reason');
  answer = { ok: true, stopped: false };
  need(item, 'ds-list-stop').fire('click');
  await settle();
  alert = need(item, 'ds-list-alert');
  assert.equal(alert.textContent, 'The service did not record this server; it was not started by Design Canvas.', 'the manual-stop refusal wording');
  assert.ok(serviceCalls.filter((call) => call.path === '/workspaces').length >= 2, 'the list reloads after each attempt');
});

test('copy-path uses writeClipboard', async () => {
  reset();
  serviceHandler = defaultService;
  const item = main.renderWorkspaceListRow(rowOf({ dir: 'C:\\Docs\\Design Canvas\\copy me' })) as unknown as FakeNode;
  openMenu(item);
  clickMenu(item, 'Copy folder path');
  await settle();
  assert.deepEqual(clipboard, ['C:\\Docs\\Design Canvas\\copy me'], 'the native path goes to host.writeClipboard');
  assert.deepEqual(toasts.at(-1), { kind: 'success', message: 'Folder path copied.' });
  assert.equal(item.find('ds-row-menu'), undefined, 'the menu closes');
  assert.deepEqual(serviceCalls, [], 'copying needs no service call');
});
