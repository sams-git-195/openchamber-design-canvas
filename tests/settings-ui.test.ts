// R5: the designs-location UI — the reusable inline editor (`openLocationEditor`)
// and its one-line summary (`renderLocationRow`) against `GET/PUT /settings`.
// A recording DOM and a stubbed host/service; no mount.
import { test } from 'node:test';
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
  append(...nodes: Array<FakeNode | string>): void { for (const node of nodes) if (node && typeof node !== 'string') this.children.push(node); }
  replaceChildren(...nodes: FakeNode[]): void { this.children = [...nodes]; }
  addEventListener(name: string, callback: (event?: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
  }
  removeEventListener(): void { /* recorder */ }
  focus(): void { /* recorder */ }
  select(): void { /* recorder */ }
  fire(name: string, event: Record<string, unknown> = {}): void {
    const full = { preventDefault() {}, stopPropagation() {}, ...event };
    for (const callback of this.listeners.get(name) ?? []) callback(full);
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
  contains(): boolean { return false; }
}

(globalThis as { window?: unknown }).window = {
  innerWidth: 1024,
  innerHeight: 768,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  parent: { postMessage: () => undefined },
};
(globalThis as { document?: unknown }).document = {
  getElementById: () => new FakeNode('div'),
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

const serviceCalls: ServiceRequest[] = [];
let serviceHandler: (request: ServiceRequest) => StubResult | Promise<StubResult> = () => ({ status: 200, body: '{}' });
const store = new Map<string, unknown>();
const host = api.host as unknown as Record<string, unknown>;
host.serviceRequest = async (request: ServiceRequest) => {
  serviceCalls.push(request);
  return serviceHandler(request);
};
host.storage = {
  get: async (key: string) => store.get(key),
  set: async (key: string, value: unknown) => { store.set(key, value); },
  delete: async (key: string) => { store.delete(key); },
  keys: async () => [...store.keys()],
};
host.toast = async () => undefined;
host.listProjects = async () => ({ kind: 'projects', state: 'ready', projects: [] });
host.openSession = async () => undefined;
const sessions: Array<{ text?: string }> = [];
host.startSession = async (request: { text?: string }) => {
  sessions.push(request);
  return { sessionId: `ses-new-${sessions.length}`, sent: 'sent' };
};

main.setSurface('page');

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await flushMicrotasks();
};
const ok = (body: unknown): StubResult => ({ status: 200, body: JSON.stringify(body) });

function settingsBody(root: string, envOverride = false): Record<string, unknown> {
  return { workspaceRoot: root, source: envOverride ? 'env' : 'settings', defaultRoot: '/home/me/Documents/Design Canvas', envOverride, previousRoots: [] };
}

function need(node: FakeNode, cls: string): FakeNode {
  const found = node.find(cls);
  assert.ok(found, `renders .${cls}`);
  return found!;
}

function reset(): void {
  serviceCalls.length = 0;
  main.resetDesignsSettings();
}

test('settings-ui-shows-env-override-readonly', async () => {
  reset();
  serviceHandler = (request) => (request.path === '/settings' ? ok(settingsBody('/env/designs', true)) : ok({ ok: true }));
  const container = new FakeNode('div');
  let done: boolean | null = null;
  await main.openLocationEditor(container as unknown as HTMLElement, (changed) => { done = changed; });
  assert.equal(need(container, 'ds-location-readonly').textContent, 'Set by DS_WORKSPACE_ROOT');
  assert.equal(need(container, 'ds-location-path').textContent, '/env/designs');
  assert.equal(container.find('ds-location-input'), undefined, 'no editable field');
  assert.equal(container.find('ds-location-save'), undefined, 'no Save');
  assert.equal(container.find('ds-location-default'), undefined, 'no Use default');
  need(container, 'ds-location-cancel').fire('click');
  assert.equal(done, false, 'closing reports no change');
  assert.equal(serviceCalls.some((call) => call.method === 'PUT'), false, 'nothing is written');

  const line = new FakeNode('div');
  main.renderLocationRow(line as unknown as HTMLElement);
  assert.equal(line.hidden, false);
  assert.equal(need(line, 'ds-location-readonly').textContent, 'Set by DS_WORKSPACE_ROOT', 'the summary line is read-only too');
  assert.equal(line.find('ds-location-change'), undefined, 'no Change link under an env override');
});

test('settings-ui-save-error-inline', async () => {
  reset();
  serviceHandler = (request) => {
    if (request.path === '/settings' && request.method === 'PUT') {
      return ok({ ok: false, code: 'NOT_ABSOLUTE', error: 'Choose a full folder path (for example C:\\Users\\you\\Designs).' });
    }
    if (request.path === '/settings') return ok(settingsBody('/home/me/Designs'));
    return ok({ ok: true });
  };
  const container = new FakeNode('div');
  let done: boolean | null = null;
  await main.openLocationEditor(container as unknown as HTMLElement, (changed) => { done = changed; });
  const input = need(container, 'ds-location-input');
  assert.equal(input.value, '/home/me/Designs', 'prefilled with the current root');
  const error = need(container, 'ds-location-error');
  assert.equal(error.getAttribute('role'), 'alert');
  assert.equal(error.hidden, true, 'no error before a save');
  input.value = 'relative/path';
  need(container, 'ds-location-save').fire('click');
  await settle();
  const put = serviceCalls.find((call) => call.method === 'PUT');
  assert.deepEqual(JSON.parse(put!.body ?? '{}'), { workspaceRoot: 'relative/path' });
  assert.equal(error.hidden, false, 'the refusal shows inline');
  assert.equal(error.textContent, 'Choose a full folder path (for example C:\\Users\\you\\Designs).');
  assert.equal(input.disabled, false, 'editable again');
  assert.equal(need(container, 'ds-location-save').textContent, 'Save');
  assert.equal(done, null, 'the editor stays open on a refusal');

  // Use default sends null.
  need(container, 'ds-location-default').fire('click');
  await settle();
  const puts = serviceCalls.filter((call) => call.method === 'PUT');
  assert.deepEqual(JSON.parse(puts.at(-1)!.body ?? '{}'), { workspaceRoot: null }, 'Use default resets with null');
  // Escape cancels.
  input.fire('keydown', { key: 'Escape' });
  assert.equal(done, false);
});

test('new-design-uses-new-root-after-change', async () => {
  reset();
  main.setWorkspace(null);
  main.setSessionId('ses-root');
  let root = '/old/root';
  serviceHandler = (request) => {
    if (request.path === '/settings' && request.method === 'PUT') {
      root = JSON.parse(request.body ?? '{}').workspaceRoot;
      return ok({ ok: true, workspaceRoot: root });
    }
    if (request.path === '/settings') return ok(settingsBody(root));
    if (request.path === '/workspaces') return ok({ root, roots: [root], workspaces: [] });
    if (request.path === '/scaffold') {
      const body = JSON.parse(request.body ?? '{}') as { dir?: string };
      return ok({ ok: true, jobId: 'job-root', dir: body.dir, url: 'http://localhost:5173/' });
    }
    if (request.path === '/scaffold/status') return ok({ state: 'done', elapsedMs: 900 });
    return ok({ ok: true });
  };
  const line = new FakeNode('div');
  main.renderLocationRow(line as unknown as HTMLElement);
  await settle();
  assert.equal(need(line, 'ds-location-path').textContent, '/old/root', 'the line loads the current root');
  need(line, 'ds-location-change').fire('click');
  await settle();
  const input = need(line, 'ds-location-input');
  input.value = '/new/root';
  input.fire('keydown', { key: 'Enter' });
  await settle();
  assert.equal(line.find('ds-location-input'), undefined, 'the editor closes on success');
  assert.equal(need(line, 'ds-location-path').textContent, '/new/root', 'the root-derived label refreshes');
  const putAt = serviceCalls.findIndex((call) => call.method === 'PUT');
  assert.ok(serviceCalls.slice(putAt).some((call) => call.path === '/workspaces'), 'the list reloads after the change');

  main.setPrompt('A calm pricing page');
  await main.startNewDesign();
  const scaffold = serviceCalls.find((call) => call.path === '/scaffold');
  assert.ok(scaffold, 'the new design scaffolds');
  const dir = (JSON.parse(scaffold!.body ?? '{}') as { dir: string }).dir;
  assert.ok(dir.startsWith('/new/root/'), `the scaffold dir follows the new root (${dir})`);
  main.setPrompt('');
  main.setWorkspace(null);
});
