import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';

const source = readFileSync(process.env.DS_CONTROLLER_SOURCE || new URL('../viewer-client/src/canvas-controller.js', import.meta.url), 'utf8');
const home = { id: 'home', url: 'http://127.0.0.1:5173/', width: 1280, height: 800, title: 'Home' };
const other = { id: 'other', url: 'http://127.0.0.1:5173/checkout.html', width: 768, height: 1024, title: 'Checkout' };
const config = { screens: [home, other], viewport: { width: 1280, height: 800 }, mode: 'edit' as const };
const single = { screens: [home], viewport: { width: 1280, height: 800 }, mode: 'edit' as const };
// Pre-canvas single-artboard config kept so the original camera fixture still boots.
const legacy = { url: 'http://127.0.0.1:5173/', pages: [{ id: 'home', label: 'Home', url: 'http://127.0.0.1:5173/' }, { id: 'other', label: 'Other', url: 'http://127.0.0.1:5173/other' }], viewport: { width: 1280, height: 800 } };

const matchesNode = (node: any, selector: string): boolean => String(selector).split(',').some((partRaw) => {
  const part = partRaw.trim();
  if (part.startsWith('.')) return String(node.className ?? '').split(/\s+/).includes(part.slice(1));
  return part.toLowerCase() === String(node.tagName ?? '').toLowerCase();
});

function environment(script = source.replace('export function ', 'function ') + ';initCanvas(initialConfig);', connected = true, cfg: any = config) {
  const nodes = new Map<string, any>(), events: Array<{ owner: string, type: string, fn: Function }> = [], commands: any[] = [];
  const clock = { t: 1700000000000 };
  let active: any;
  const detach = (node: any) => { const parent = node.parent; if (!parent) return; const at = parent.children.indexOf(node); if (at >= 0) parent.children.splice(at, 1); node.parent = undefined; };
  const make = (id: string, tag = 'div') => {
    const node: any = { id, tagName: String(tag).toUpperCase(), hidden: false, dataset: {}, attributes: {}, style: { cssText: '' }, children: [], parent: undefined, srcWrites: [] as string[],
      clientWidth: 1000, clientHeight: 720, classList: { _s: new Set<string>(), add(...names: string[]) { names.forEach(n => this._s.add(n)); }, remove(...names: string[]) { names.forEach(n => this._s.delete(n)); }, contains(n: string) { return this._s.has(n); } },
      getBoundingClientRect: () => node.rect ?? { x: 0, y: 0, left: 0, top: 0, width: id === 'canvas' ? 1000 : 768, height: id === 'canvas' ? 720 : 720 },
      addEventListener: (type: string, fn: Function) => events.push({ owner: id, type, fn }),
      setAttribute(a: string, v: unknown) { node.attributes[a] = String(v); if (a === 'class') node.className = String(v); },
      getAttribute: (a: string) => (a === 'src' ? (node.attributes.src ?? node._src ?? '') : a in node.attributes ? node.attributes[a] : (a === 'class' ? (node.className ?? '') : null)),
      removeAttribute(a: string) { delete node.attributes[a]; },
      focus: () => { active = node; },
      appendChild(child: any) { detach(child); node.children.push(child); child.parent = node; return child; },
      append(...kids: any[]) { kids.forEach((k: any) => node.appendChild(k)); },
      remove() { detach(node); },
      querySelector: (sel: string) => { const out = query(node, sel); return out.length ? out[0] : null; },
      querySelectorAll: (sel: string) => query(node, sel),
      closest: (sel: string) => { let cursor = node; while (cursor) { if (matchesNode(cursor, sel)) return cursor; cursor = cursor.parent; } return null; },
      replaceChildren(...kids: any[]) { node.children.forEach((c: any) => { c.parent = undefined; }); node.children = kids; kids.forEach((k: any) => { k.parent = node; }); },
      setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} };
    Object.defineProperty(node, 'className', { configurable: true, get() { return node._class ?? ''; }, set(v: unknown) { node._class = String(v); } });
    Object.defineProperty(node, 'src', { configurable: true, get() { return node._src ?? ''; }, set(v: unknown) { node._src = String(v); node.attributes.src = String(v); node.srcWrites.push(String(v)); } });
    let textValue = '';
    Object.defineProperty(node, 'textContent', { configurable: true, get() { return textValue; }, set(v: unknown) { textValue = String(v); } });
    return node;
  };
  const query = (root: any, sel: string): any[] => { const out: any[] = []; const walk = (n: any) => { for (const child of n.children ?? []) { if (matchesNode(child, sel)) out.push(child); walk(child); } }; walk(root); return out; };
  const $ = (id: string) => { if (!nodes.has(id)) nodes.set(id, make(id)); return nodes.get(id)!; };
  const document: any = { title: '', getElementById: $, createElement: (tag: string) => make('created', tag), body: { style: { cssText: '', overflow: '', pointerEvents: '' } }, documentElement: {}, querySelectorAll: () => [],
    addEventListener: (type: string, fn: Function) => events.push({ owner: 'document', type, fn }), get activeElement() { return active; } };
  const window: any = { addEventListener: (type: string, fn: Function) => events.push({ owner: 'window', type, fn }) };
  if (connected) window.__dsCanvasSend = (value: string) => commands.push(JSON.parse(value));
  // Mirror production: the renderer bakes the initial artboards into the markup,
  // then the serialized controller adopts them.
  const camera = $('camera');
  if (Array.isArray(cfg.screens)) {
    for (const screen of cfg.screens) {
      const section = document.createElement('section'); section.className = 'ds-artboard'; section.dataset.screen = screen.id; section.dataset.active = 'false';
      const title = document.createElement('button'); title.className = 'ds-ab-title';
      const size = document.createElement('span'); size.className = 'ds-ab-size';
      const frame = document.createElement('iframe'); frame.id = `ds-frame-${screen.id}`; frame.setAttribute('src', screen.url);
      const overlay = document.createElement('div'); overlay.className = 'ds-ab-state'; overlay.dataset.state = 'loading';
      const copy = document.createElement('p'); copy.className = 'ds-ab-card-copy';
      const action = document.createElement('button'); action.className = 'ds-ab-retry';
      overlay.appendChild(copy); overlay.appendChild(action);
      section.appendChild(title); section.appendChild(size); section.appendChild(frame); section.appendChild(overlay);
      camera.appendChild(section);
    }
  }
  const context: any = { initialConfig: JSON.parse(JSON.stringify(cfg)), window, document, URL, Error, Number, Math, JSON, Object, Set, Map, Array, RegExp, Promise,
    Date: { now: () => clock.t },
    getComputedStyle: () => ({ getPropertyValue: (name: string) => name === '--s7' ? '48px' : '32px' }),
    clearTimeout() {}, setTimeout: () => 1, requestAnimationFrame: (fn: Function) => fn(), ResizeObserver: class { observe() {} } };
  runInNewContext(script, context);
  const frameOf = (id: string) => camera.children.map((s: any) => s.querySelector('iframe')).find((f: any) => f && f.id === `ds-frame-${id}`);
  const sectionOf = (id: string) => camera.children.find((s: any) => s.dataset?.screen === id);
  return { window, document, nodes, $, commands, events, api: window.__dsCanvas, bridge: window.__dsToolbarBridge, camera, frameOf, sectionOf, tick: (ms: number) => { clock.t += ms; } };
}

test('canvas is exposed before React, readiness waits for mounted hooks, absent binding stays pending', () => {
  const e = environment(undefined, false);
  assert.ok(e.api && e.bridge); assert.equal(e.commands.length, 0);
  assert.equal(e.bridge.getSnapshot().statusState, 'loading'); assert.equal(e.$('camera').hidden, false);
  assert.equal(e.window.__dsToolbarMounted(), false); assert.equal(e.bridge.getSnapshot().statusState, 'loading');
  e.window.__dsCanvasSend = (value: string) => e.commands.push(JSON.parse(value));
  assert.equal(e.window.__dsToolbarMounted(), true); assert.equal(e.window.__dsToolbarMounted(), true);
  assert.deepEqual(e.commands, [{ type: 'ready' }]);
});

test('snapshots are immutable and cached; an action publishes once and sends once; unsubscribe removes ownership', () => {
  const e = environment(); e.api.setStatus({ state: 'ready' });
  const initial = e.bridge.getSnapshot(); assert.strictEqual(initial, e.bridge.getSnapshot()); assert.ok(Object.isFrozen(initial)); assert.ok(Object.isFrozen(initial.screens[0]));
  let count = 0; const unsubscribe = e.bridge.subscribe(() => count++);
  e.api.setStatus({ state: 'ready' }); assert.equal(count, 0); assert.strictEqual(initial, e.bridge.getSnapshot());
  e.bridge.selectPreset('mobile'); assert.equal(count, 1); assert.deepEqual(e.commands, [{ type: 'layout', mode: 'page', preset: 'mobile', screen: 'home' }]); assert.equal(e.bridge.getSnapshot().width, 390);
  e.bridge.selectPreset('mobile'); assert.equal(count, 1, 'unchanged values cannot invalidate useSyncExternalStore');
  unsubscribe(); e.bridge.togglePan(); assert.equal(count, 1);
});

test('controller never mutates stock toolbar children or installs menu keyboard/click handlers', () => {
  const e = environment();
  for (const id of ['pages', 'zoom', 'minus', 'plus', 'pan', 'fit-all', 'page-name', 'page-static', 'page-menu', 'zoom-menu']) {
    const node = e.$(id); for (const key of ['textContent', 'disabled', 'onclick', 'onkeydown']) Object.defineProperty(node, key, { set() { throw new Error('imperative stock node mutation: ' + id + '.' + key); } });
  }
  e.api.setStatus({ state: 'ready' }); e.bridge.setMenu('zoom'); e.bridge.zoomTo(1); e.bridge.togglePan(); e.bridge.panBy('right');
  e.api.setPage({ url: home.url, title: 'Confirmed', navigate: false, pages: [{ id: 'a', label: 'A', url: home.url }, { id: 'other', label: 'B', url: other.url }] });
  e.bridge.selectPage('other');
  assert.equal(e.events.filter(x => x.owner === 'canvas' && x.type === 'wheel').length, 1);
  assert.equal(e.events.filter(x => x.owner === 'document' && x.type === 'keydown').length, 2, 'capture blocker and one root shortcut path only');
  assert.equal(e.commands.filter(x => x.type === 'page').length, 1);
  assert.deepEqual(e.commands.filter(x => x.type === 'page'), [{ type: 'page', id: 'other', screen: 'home' }]);
});

test('capture locks shell mutations, preserves camera, and normalizes the ACTIVE artboard only', async () => {
  const e = environment(); e.api.setStatus({ state: 'ready' }); e.bridge.zoomTo(1); e.bridge.togglePan(); e.bridge.setMenu('zoom');
  const camera = JSON.stringify(e.api.getCamera()), token = e.api.beginCapture();
  assert.equal(e.bridge.getSnapshot().capturing, true);
  assert.equal(e.api.setViewport(390, 844), false); assert.equal(e.api.zoomCamera({ action: 'out' }), false);
  assert.equal(e.api.setScreens([home]), false); assert.equal(e.api.setActive('other'), false);
  assert.equal(e.api.setScreenState('other', { state: 'error' }), false); assert.equal(e.api.fitAll(), false);
  e.bridge.setMenu(null); e.bridge.togglePan(); e.bridge.selectPage('other'); e.bridge.selectPreset('mobile'); e.bridge.panBy('left'); e.bridge.retry(); e.bridge.setMode('play');
  assert.equal(JSON.stringify(e.api.getCamera()), camera); assert.equal(e.bridge.getSnapshot().openMenu, 'zoom'); assert.equal(e.commands.length, 0);
  const rect = await e.api.normalizeCapture(token);
  assert.ok([rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)); assert.ok(rect.width > 0 && rect.height > 0);
  assert.equal(e.camera.children.length, 2, 'capture hides siblings but never removes them');
  assert.equal(e.api.endCapture(token + 1), false); assert.equal(e.api.endCapture(token), true);
  assert.equal(JSON.stringify(e.api.getCamera()), camera); assert.equal(e.bridge.getSnapshot().openMenu, 'zoom'); assert.equal(e.bridge.getSnapshot().pan, true);
  const next = e.api.beginCapture('other'); assert.equal(await e.api.normalizeCapture(next) !== undefined, true);
  e.api.setStatus({ state: 'error', message: 'Confirmed failure' }); assert.equal(e.bridge.getSnapshot().statusState, 'ready'); assert.equal(e.api.endCapture(next), true);
  assert.equal(e.bridge.getSnapshot().statusState, 'error'); assert.equal(e.bridge.getSnapshot().message, 'Confirmed failure');
  assert.equal(e.$('camera').hidden, false, 'one dead screen never blanks the grid');
});

test('invalid screens and metadata cannot poison the snapshot', () => {
  const e = environment(); e.api.setStatus({ state: 'ready' }); const before = e.bridge.getSnapshot();
  for (const width of [NaN, Infinity, 0, 8193]) assert.equal(e.api.setViewport(width, 800), false);
  assert.equal(e.api.setPage({ url: 'javascript:alert(1)' }), false); e.api.setStatus({ state: 'ready' });
  for (const bad of [undefined, 'list', [home, { ...home }], [{ ...home, url: 'data:text/html,x' }], [{ ...home, width: 199 }], [{ ...home, height: 8193 }],
    [{ ...home, id: 'BAD ID' }], Array.from({ length: 13 }, (_, i) => ({ ...home, id: `s-${i}` }))]) {
    assert.equal(e.api.setScreens(bad as never), false, JSON.stringify(bad)?.slice(0, 40));
  }
  assert.strictEqual(e.bridge.getSnapshot().screens, before.screens);
  e.api.setPage({ url: home.url + '#confirmed', title: 'Confirmed', navigate: false });
  assert.equal(e.bridge.getSnapshot().currentTitle, 'Confirmed'); assert.equal(e.bridge.getSnapshot().ready, true);
  assert.equal(e.api.getScreens()[0]?.src, home.url, 'confirmation must not rewrite a matching src');
  e.api.setPage({ url: home.url, pages: [{ id: 'duplicate', label: 'A', url: home.url }, { id: 'duplicate', label: 'B', url: home.url }] });
  assert.deepEqual(JSON.parse(JSON.stringify(e.bridge.getSnapshot().pages)), JSON.parse(JSON.stringify(before.pages)));
});

test('setScreens adopts baked artboards, diffs without reloads, and recomputes the grid', () => {
  const e = environment();
  assert.equal(e.camera.children.length, 2, 'baked artboards adopted, not duplicated');
  assert.equal(e.frameOf('home').srcWrites.length, 0, 'a matching baked src is never rewritten');
  assert.equal(e.api.getActive(), 'home');
  assert.deepEqual(e.camera.children.map((s: any) => [s.dataset.screen, s.style.left, s.style.top, s.style.width]), [['home', '0px', '0px', '1280px'], ['other', '1328px', '0px', '768px']]);
  assert.equal(e.camera.children[0].style.height, '800px'); assert.equal(e.camera.style.width, '2096px'); assert.equal(e.camera.style.height, '1024px');
  assert.equal(e.api.setScreens([{ ...home, title: 'Home v2' }, other]), true);
  assert.equal(e.frameOf('home').srcWrites.length, 0, 'same id + same url = no reload');
  assert.equal(e.camera.children.length, 2);
  assert.equal(e.sectionOf('home').querySelector('.ds-ab-title').textContent, 'Home v2');
  assert.equal(e.api.setScreens([{ ...home, url: home.url + 'next' }, other]), true);
  assert.deepEqual(e.frameOf('home').srcWrites, [home.url + 'next'], 'a changed url rewrites exactly that frame');
  assert.equal(e.api.getScreens()[0]?.state, 'loading');
  assert.equal(e.api.setScreens([home]), true);
  assert.equal(e.camera.children.length, 1, 'removed screens drop their artboards');
  assert.equal(e.api.setScreens([]), true);
  assert.equal(e.bridge.getSnapshot().statusState, 'empty'); assert.equal(e.api.getActive(), '');
  assert.equal(e.$('state').hidden, false, 'zero screens show the global state overlay');
  assert.equal(e.api.setScreens([home, other, { id: 'third', url: 'http://127.0.0.1:5173/third.html', width: 390, height: 844, title: 'Third' }]), true);
  assert.equal(e.camera.children.length, 3);
  // cols = ceil(sqrt(3)) = 2: row heights take the tallest member of each row;
  // height = max(800,1024) + 48 + 844 = 1916, width unchanged (1280 + 48 + 768).
  assert.equal(e.camera.style.width, '2096px'); assert.equal(e.camera.style.height, '1916px');
  assert.equal(e.sectionOf('third').style.top, '1072px');
});

test('fitAll and focusScreen frame the grid inside the existing zoom clamp', () => {
  const e = environment(); e.api.setStatus({ state: 'ready' });
  assert.equal(e.api.fitAll(), true);
  const camera = e.api.getCamera();
  assert.equal(camera.mode, 'fit-all'); assert.equal(camera.gridWidth, 2096); assert.equal(camera.gridHeight, 1024);
  const expected = Math.min((1000 - 48) / 2096, (720 - 48) / 1024);
  assert.ok(Math.abs(camera.scale - expected) < 1e-9);
  assert.equal(e.$('camera').style.transform, 'translate(' + ((1000 - 2096 * camera.scale) / 2) + 'px,' + ((720 - 1024 * camera.scale) / 2) + 'px) scale(' + camera.scale + ')');
  assert.equal(e.api.focusScreen('other'), true);
  const focused = e.api.getCamera();
  assert.equal(focused.mode, 'manual'); assert.equal(focused.scale, 1);
  // Cell center of "other" (1328+384, 512) lands at the canvas center (500, 360).
  assert.ok(Math.abs(focused.panX - (500 - 1712 - (1000 - 2096) / 2)) < 1e-9);
  assert.ok(Math.abs(focused.panY - (360 - 512 - 48)) < 1e-9);
  assert.equal(e.api.focusScreen('missing'), false);
  assert.equal(e.api.setMode('play'), true); assert.equal(e.api.setMode('nope'), false);
});

test('edit mode picks unscaled frame coordinates; play mode forwards the real click', () => {
  const e = environment(); e.api.setStatus({ state: 'ready' });
  e.api.restoreCamera({ mode: 'manual', scale: 1, panX: 0, panY: 0 });
  const section = e.sectionOf('other');
  section.rect = { x: 20, y: 30, left: 20, top: 30, width: 768, height: 1024 };
  const fire = (type: string, event: Record<string, unknown>) => {
    for (const entry of e.events) if (entry.owner === 'canvas' && entry.type === type) entry.fn(event);
  };
  const down = (x: number, y: number) => fire('pointerdown', { button: 0, clientX: x, clientY: y, pointerId: 1, target: section, preventDefault() {} });
  const up = (x: number, y: number) => fire('pointerup', { pointerId: 1, clientX: x, clientY: y });
  down(20 + 200, 30 + 250); up(20 + 200, 30 + 250);
  assert.deepEqual(e.commands.at(-1), { type: 'screen-pick', screen: 'other', x: 200, y: 250 });
  assert.equal(e.api.getActive(), 'other', 'a pick selects its artboard quietly');
  assert.equal(e.commands.filter(c => c.type === 'screen-activate').length, 0, 'plain picks never spam activations');
  e.tick(400);
  down(20 + 900, 30 + 250); up(20 + 900, 30 + 250);
  assert.equal(e.commands.filter(c => c.type === 'screen-pick').length, 1, 'clicks outside the natural artboard are not picks');
  // Double tap inside the same artboard focuses and announces an activation.
  e.tick(400);
  down(20 + 100, 30 + 100); up(20 + 100, 30 + 100);
  down(20 + 100, 30 + 100); up(20 + 100, 30 + 100);
  assert.equal(e.commands.filter(c => c.type === 'screen-pick').length, 2);
  assert.deepEqual(e.commands.at(-1), { type: 'screen-activate', screen: 'other' });
  // A drag pans instead of picking.
  down(20 + 300, 30 + 300); fire('pointermove', { clientX: 20 + 340, clientY: 30 + 300 }); up(20 + 340, 30 + 300);
  assert.equal(e.commands.filter(c => c.type === 'screen-pick').length, 2, 'a drag never fakes a pick');
  e.api.setMode('play');
  down(20 + 150, 30 + 150); up(20 + 150, 30 + 150);
  assert.equal(e.commands.filter(c => c.type === 'screen-pick').length, 2, 'play mode leaves clicks to the screen');
  // Title buttons activate explicitly; scale is divided out of the pick coordinates.
  e.api.setMode('edit'); e.api.restoreCamera({ mode: 'manual', scale: 2, panX: 0, panY: 0 }); e.tick(400);
  section.rect = { x: 0, y: 0, left: 0, top: 0, width: 1536, height: 2048 };
  down(400, 300); up(400, 300);
  assert.deepEqual(e.commands.filter(c => c.type === 'screen-pick').at(-1), { type: 'screen-pick', screen: 'other', x: 200, y: 150 });
  e.sectionOf('home').querySelector('.ds-ab-title').onclick();
  assert.deepEqual(e.commands.at(-1), { type: 'screen-activate', screen: 'home' });
  assert.equal(e.api.getActive(), 'home');
  assert.equal(e.bridge.getSnapshot().active, 'home');
});

test('mode changes arrive from the service; the toolbar only requests', () => {
  const e = environment(); e.api.setStatus({ state: 'ready' });
  e.bridge.setMode('play');
  assert.deepEqual(e.commands, [{ type: 'mode-request', mode: 'play' }]);
  assert.equal(e.bridge.getSnapshot().mode, 'edit');
  assert.equal(e.$('canvas').dataset.mode, 'edit');
  e.api.setMode('play');
  assert.equal(e.bridge.getSnapshot().mode, 'play');
  assert.equal(e.$('canvas').dataset.mode, 'play');
  assert.equal(e.commands.length, 1, 'the service push sends nothing back');
});

test('per-artboard overlays report state without touching siblings', () => {
  const e = environment();
  assert.equal(e.api.setScreenState('missing', { state: 'error' }), false);
  assert.equal(e.api.setScreenState('other', { state: 'sideways' }), false);
  assert.equal(e.api.setScreenState('other', { state: 'error', message: 'dev server down' }), true);
  const overlay = e.sectionOf('other').querySelector('.ds-ab-state');
  assert.equal(overlay.hidden, false); assert.equal(overlay.dataset.state, 'error');
  assert.equal(overlay.querySelector('.ds-ab-card-copy').textContent, 'dev server down');
  assert.equal(overlay.querySelector('.ds-ab-retry').hidden, false);
  const homeOverlay = e.sectionOf('home').querySelector('.ds-ab-state');
  assert.equal(homeOverlay.dataset.state, 'loading', 'the sibling artboard keeps its own card');
  assert.equal(e.bridge.getSnapshot().screens[1].state, 'error');
  assert.equal(e.bridge.getSnapshot().statusState, 'loading', 'a dead inactive screen does not replace the active status');
  assert.equal(e.api.setActive('other'), true);
  assert.equal(e.bridge.getSnapshot().statusState, 'error');
  assert.equal(e.sectionOf('other').dataset.active, 'true');
  assert.equal(e.commands.length, 0, 'service-side setActive never echoes back');
  assert.equal(e.api.setScreenState('other', { state: 'ready' }), true);
  assert.equal(overlay.hidden, true);
});

test('extracted camera math remains byte-for-byte original; the single-screen grid reproduces the original camera', () => {
  const original = readFileSync(new URL('./fixtures/stock-controller.original-viewer-ui.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const oldScript = original.match(/const VIEWER_SCRIPT = String.raw`([\s\S]*)`;/)![1]!;
  const normalizedSource = source.replace(/\r\n/g, '\n');
  // setLayout/normalizeCapture intentionally move to the grid model (active-screen
  // sizing, per-artboard capture); every pure camera function stays byte-identical.
  // Line endings are checkout noise on Windows; the algorithms are compared byte-for-byte.
  for (const name of ['getFitBounds', 'zoomTo', 'zoomCamera', 'cameraShortcut']) {
    const regex = new RegExp(`(?:async )?function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}`);
    assert.equal(normalizedSource.match(regex)?.[0], oldScript.match(regex)?.[0], name + ' algorithm is not part of this extraction');
  }
  // The fixture script is the pre-Nova IIFE: self-invoking, single artboard.
  const old = environment(oldScript, true, legacy);
  const current = environment(undefined, true, single);
  for (const e of [old, current]) {
    e.api.setStatus({ state: 'ready' });
    e.api.setLayout({ mode: 'page', preset: 'desktop', width: 1280, height: 1880, nominalHeight: 800 });
    e.api.zoomCamera({ action: 'wheel', deltaY: -40, x: 210, y: 170 });
    e.api.handleCanvasInput({ type: 'wheel', deltaX: 19, deltaY: 31, x: 20, y: 40 });
  }
  const strip = (c: any) => { const { gridWidth: _gw, gridHeight: _gh, ...rest } = c; return rest; };
  assert.equal(JSON.stringify(strip(current.api.getCamera())), JSON.stringify(old.api.getCamera()));
  assert.equal(current.$('camera').style.transform, old.$('camera').style.transform);
});

function renderer() {
  // Source-only serialization proof: private sentinel assets, not generated or
  // production assets. Canonical client build/render remains the primary gate.
  const ui = readFileSync(process.env.DS_VIEWER_UI_SOURCE || new URL('../service/viewer-ui.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export function renderViewerHtml', 'function renderViewerHtml');
  const controller = runInNewContext(source.replace('export function ', 'function ') + ';initCanvas');
  return runInNewContext(stripTypeScriptTypes(ui) + ';renderViewerHtml', { URL, Set, JSON, Math, Number, Array, initCanvas: controller,
    VIEWER_CLIENT_CSS: ':root{}', VIEWER_CLIENT_JS: 'window.__sentinel="</script>\u2028\u2029";' });
}

test('HTML allowlist escapes config and compiled script data, exposes controller before one compiled entry', () => {
  const render = renderer(), hostile = '</script><img src=x onerror=alert(1)>\u2028\u2029';
  const html = render({ ...config, screens: [{ ...home, title: hostile, url: home.url }], bearer: 'NEVER-SERIALIZE' });
  assert.doesNotMatch(html, /<img src=x|NEVER-SERIALIZE|--nova-|Iowan|design-tokens|<script[^>]+src=/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; assert.equal(scripts.length, 2);
  assert.match(scripts[0][1], /window\.__dsViewerConfig=/); assert.match(scripts[1][1], /__sentinel/);
  const e = environment(scripts[0][1], false); assert.ok(e.bridge && e.api);
  assert.equal(e.api.getScreens()[0]?.src, home.url);
  // The renderer trims screen titles (U+2028/U+2029 are whitespace); the hostile
  // markup must survive the pipeline escaped, never as live HTML.
  assert.equal(e.bridge.getSnapshot().screens[0].title, hostile.trim()); assert.equal(e.$('camera').hidden, false);
  assert.equal(e.camera.children.length, 1, 'bootstrap adopts the baked artboard instead of duplicating it');
  assert.equal(e.frameOf('home').srcWrites.length, 0, 'the baked src is preserved');
  const sandbox: any = { window: {} }; runInNewContext(scripts[1][1], sandbox); assert.equal(sandbox.window.__sentinel, '</script>\u2028\u2029');
  assert.throws(() => render({ ...config, screens: [{ ...home, url: 'https://user:secret@example.com/' }] })); assert.throws(() => render({ ...config, viewport: { width: Infinity, height: 800 } }));
});

test('server hashes the exact two script bodies and permits only data fonts without widening authority', async () => {
  const server = readFileSync(process.env.DS_SERVER_SOURCE || new URL('../service/viewer-server.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export async function startViewerServer', 'async function startViewerServer');
  const start = runInNewContext(stripTypeScriptTypes(server) + ';startViewerServer', { createServer, createHash, randomBytes, renderViewerHtml: renderer(), Promise });
  const running = await start(config);
  try {
    const response = await fetch(running.url), html = await response.text(), csp = response.headers.get('content-security-policy')!;
    assert.equal(response.status, 200); assert.match(csp, /font-src data:/); assert.match(csp, /connect-src 'none'/); assert.match(csp, /img-src 'none'/); assert.match(csp, /frame-src http: https:/);
    const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => "'sha256-" + createHash('sha256').update(m[1]!).digest('base64') + "'");
    assert.equal(hashes.length, 2); assert.equal(csp.match(/script-src ([^;]+)/)![1], hashes.join(' ')); assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline|font-src[^;]*https?:/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.equal((await fetch(running.url + 'x')).status, 404);
    assert.equal((await fetch(running.url, { method: 'POST' })).status, 405);
    // Native fetch normalizes Host: use an actual raw HTTP request for this gate.
    const invalidHost = await new Promise<number | undefined>((resolve, reject) => { const req = request(running.url, { headers: { Host: 'invalid.example' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); }); req.once('error', reject); req.end(); });
    assert.equal(invalidHost, 403);
  } finally { await running.close(); }
});
