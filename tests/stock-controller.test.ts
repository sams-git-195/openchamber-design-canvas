import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';

const source = readFileSync(process.env.DS_CONTROLLER_SOURCE || new URL('../viewer-client/src/canvas-controller.js', import.meta.url), 'utf8');
const toolbarSource = readFileSync(new URL('../viewer-client/src/Toolbar.tsx', import.meta.url), 'utf8');
const home = { id: 'home', url: 'http://127.0.0.1:5173/', width: 1280, height: 800, title: 'Home' };
const other = { id: 'other', url: 'http://127.0.0.1:5173/checkout.html', width: 768, height: 1024, title: 'Checkout' };
const phone = { id: 'phone', url: 'http://127.0.0.1:5173/phone.html', width: 390, height: 844, title: 'Phone' };
const config = { screens: [home, other], viewport: { width: 1280, height: 800 }, mode: 'edit' as const };
const single = { screens: [home], viewport: { width: 1280, height: 800 }, mode: 'edit' as const };
// Pre-canvas single-artboard config kept so the original camera fixture still boots.
const legacy = { url: 'http://127.0.0.1:5173/', pages: [{ id: 'home', label: 'Home', url: 'http://127.0.0.1:5173/' }, { id: 'other', label: 'Other', url: 'http://127.0.0.1:5173/other' }], viewport: { width: 1280, height: 800 } };

const matchesNode = (node: any, selector: string): boolean => String(selector).split(',').some((partRaw) => {
  const part = partRaw.trim();
  if (part.startsWith('.')) return String(node.className ?? '').split(/\s+/).includes(part.slice(1));
  return part.toLowerCase() === String(node.tagName ?? '').toLowerCase();
});

function environment(script = source.replace('export function ', 'function ') + ';initCanvas(initialConfig);', connected = true, cfg: any = config, opts: { timers?: boolean, frames?: 'sync' | 'manual', clipboard?: (text: string) => Promise<void> } = {}) {
  const nodes = new Map<string, any>(), events: Array<{ owner: string, type: string, fn: Function }> = [], commands: any[] = [];
  const clock = { t: 1700000000000 };
  let active: any;
  let elSeq = 0;
  let timerSeq = 0;
  const timers = new Map<number, { at: number, fn: Function }>();
  const frames: Function[] = [];
  const detach = (node: any) => { const parent = node.parent; if (!parent) return; const at = parent.children.indexOf(node); if (at >= 0) parent.children.splice(at, 1); node.parent = undefined; };
  const make = (id: string, tag = 'div') => {
    const style: any = { setProperty(name: string, value: unknown) { style[name] = String(value); }, getPropertyValue(name: string) { return name in style ? String(style[name]) : ''; } };
    // Real cssText REPLACES every inline declaration. Mirror that: begin/end
    // capture snapshots round-trip through it exactly like production Chrome.
    Object.defineProperty(style, 'cssText', {
      configurable: true, enumerable: false,
      get() { return Object.keys(style).filter((k) => typeof style[k] !== 'function').map((k) => `${k}:${style[k]}`).join(';'); },
      set(value: string) { for (const k of Object.keys(style)) if (typeof style[k] !== 'function') delete style[k]; for (const part of String(value).split(';')) { const at = part.indexOf(':'); if (at > 0) style[part.slice(0, at).trim()] = part.slice(at + 1).trim(); } },
    });
    const node: any = { id, tagName: String(tag).toUpperCase(), hidden: false, dataset: {}, attributes: {}, style,
      children: [], parent: undefined, srcWrites: [] as string[],
      clientWidth: 1000, clientHeight: 720, classList: { _s: new Set<string>(), add(...names: string[]) { names.forEach(n => this._s.add(n)); }, remove(...names: string[]) { names.forEach(n => this._s.delete(n)); }, contains(n: string) { return this._s.has(n); } },
      getBoundingClientRect: () => node.rect ?? { x: 0, y: 0, left: 0, top: 0, width: id === 'canvas' ? 1000 : 768, height: id === 'canvas' ? 720 : 720 },
      addEventListener: (type: string, fn: Function) => events.push({ owner: node.id, type, fn }),
      setAttribute(a: string, v: unknown) { node.attributes[a] = String(v); if (a === 'class') node.className = String(v); },
      getAttribute: (a: string) => (a === 'src' ? (node.attributes.src ?? node._src ?? '') : a in node.attributes ? node.attributes[a] : (a === 'class' ? (node.className ?? '') : null)),
      removeAttribute(a: string) { delete node.attributes[a]; },
      focus: () => { active = node; },
      appendChild(child: any) { detach(child); node.children.push(child); child.parent = node; return child; },
      append(...kids: any[]) { kids.forEach((k: any) => node.appendChild(k)); },
      remove() { detach(node); },
      contains(other: any) { let cursor = other; while (cursor) { if (cursor === node) return true; cursor = cursor.parent; } return false; },
      querySelector: (sel: string) => { const out = query(node, sel); return out.length ? out[0] : null; },
      querySelectorAll: (sel: string) => query(node, sel),
      closest: (sel: string) => { let cursor = node; while (cursor) { if (matchesNode(cursor, sel)) return cursor; cursor = cursor.parent; } return null; },
      replaceChildren(...kids: any[]) { node.children.forEach((c: any) => { c.parent = undefined; }); node.children = kids; kids.forEach((k: any) => { k.parent = node; }); },
      setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} };
    Object.defineProperty(node, 'className', { configurable: true, get() { return node._class ?? ''; }, set(v: unknown) { node._class = String(v); } });
    // The src property reflects the attribute until the frame navigates (the
    // load event then flips it to the current URL, as real Chrome does).
    Object.defineProperty(node, 'src', { configurable: true, get() { return node._src || String(node.attributes.src ?? ''); }, set(v: unknown) { node._src = String(v); node.attributes.src = String(v); node.srcWrites.push(String(v)); } });
    let textValue = '';
    Object.defineProperty(node, 'textContent', { configurable: true, get() { return textValue; }, set(v: unknown) { textValue = String(v); } });
    return node;
  };
  const query = (root: any, sel: string): any[] => { const out: any[] = []; const walk = (n: any) => { for (const child of n.children ?? []) { if (matchesNode(child, sel)) out.push(child); walk(child); } }; walk(root); return out; };
  const $ = (id: string) => { if (!nodes.has(id)) nodes.set(id, make(id)); return nodes.get(id)!; };
  const body = make('body', 'body');
  const document: any = { title: '', getElementById: $, createElement: (tag: string) => make('el-' + String(tag).toLowerCase() + '-' + (++elSeq), tag), body, documentElement: {}, querySelectorAll: () => [],
    addEventListener: (type: string, fn: Function) => events.push({ owner: 'document', type, fn }), get activeElement() { return active; } };
  const window: any = { addEventListener: (type: string, fn: Function) => events.push({ owner: 'window', type, fn }) };
  if (opts.clipboard) window.navigator = { clipboard: { writeText: (text: string) => opts.clipboard!(text) } };
  if (connected) window.__dsCanvasSend = (value: string) => commands.push(JSON.parse(value));
  // Mirror production: the renderer bakes the initial artboards into the markup
  // (header chrome + iframe + per-board overlay + the ⋯ menu button), then the
  // serialized controller adopts them.
  const camera = $('camera');
  if (Array.isArray(cfg.screens)) {
    for (const screen of cfg.screens) {
      const section = document.createElement('section'); section.className = 'ds-artboard'; section.dataset.screen = screen.id; section.dataset.active = 'false';
      const title = document.createElement('button'); title.className = 'ds-ab-title';
      const size = document.createElement('span'); size.className = 'ds-ab-size';
      const frame = document.createElement('iframe'); frame.id = `ds-frame-${screen.id}`; frame.setAttribute('src', screen.url);
      const overlay = document.createElement('div'); overlay.className = 'ds-ab-state'; overlay.dataset.state = 'loading';
      const copy = document.createElement('p'); copy.className = 'ds-ab-card-copy';
      const detail = document.createElement('p'); detail.className = 'ds-ab-card-detail'; detail.hidden = true;
      const action = document.createElement('button'); action.className = 'ds-ab-retry';
      const menu = document.createElement('button'); menu.className = 'ds-ab-menu';
      overlay.appendChild(copy); overlay.appendChild(detail); overlay.appendChild(action);
      section.appendChild(title); section.appendChild(size); section.appendChild(frame); section.appendChild(overlay); section.appendChild(menu);
      camera.appendChild(section);
    }
  }
  const context: any = { initialConfig: JSON.parse(JSON.stringify(cfg)), window, document, URL, Error, Number, Math, JSON, Object, Set, Map, Array, RegExp, Promise,
    Date: { now: () => clock.t },
    getComputedStyle: () => ({ getPropertyValue: (name: string) => name === '--s7' ? '48px' : '32px' }),
    clearTimeout: (id: number) => { timers.delete(id); },
    setTimeout: (fn: Function, delay: number) => { if (!opts.timers) return 1; const id = ++timerSeq; timers.set(id, { at: clock.t + delay, fn }); return id; },
    requestAnimationFrame: (fn: Function) => { if (opts.frames === 'manual') { frames.push(fn); return ++timerSeq; } fn(); return 1; }, ResizeObserver: class { observe() {} } };
  runInNewContext(script, context);
  const frameOf = (id: string) => camera.children.map((s: any) => s.querySelector('iframe')).find((f: any) => f && f.id === `ds-frame-${id}`);
  const sectionOf = (id: string) => camera.children.find((s: any) => s.dataset?.screen === id);
  const elementOf = (id: string, selector: string) => { const section = sectionOf(id); return section ? section.querySelector(selector) : null; };
  const fire = (owner: string, type: string, event: Record<string, unknown>) => { for (const entry of events) if (entry.owner === owner && entry.type === type) entry.fn(event); };
  const fireTimers = (ms: number) => { clock.t += ms; const due = [...timers.entries()].filter(([, t]) => t.at <= clock.t).sort((a, b) => a[1].at - b[1].at); for (const [id, t] of due) { timers.delete(id); t.fn(); } };
  const flushFrames = (rounds = 4) => { for (let i = 0; i < rounds; i++) { const due = frames.splice(0, frames.length); for (const fn of due) fn(); if (!frames.length) break; } };
  return { window, document, body, nodes, $, commands, events, api: window.__dsCanvas, bridge: window.__dsToolbarBridge, camera, frameOf, sectionOf, elementOf, fire, fireTimers, flushFrames, tick: (ms: number) => { clock.t += ms; } };
}

test('canvas is exposed before React, readiness waits for mounted hooks, absent binding stays pending', () => {
  const e = environment(undefined, false);
  assert.ok(e.api && e.bridge); assert.equal(e.commands.length, 0);
  assert.equal(e.bridge.getSnapshot().statusState, 'loading'); assert.equal(e.$('camera').hidden, false);
  assert.equal(e.window.__dsToolbarMounted(), false); assert.equal(e.bridge.getSnapshot().statusState, 'loading');
  e.window.__dsCanvasSend = (value: string) => e.commands.push(JSON.parse(value));
  assert.equal(e.window.__dsToolbarMounted(), true); assert.equal(e.window.__dsToolbarMounted(), true);
  assert.deepEqual(e.commands, [{ type: 'ready' }], 'the boot camera (fit-all default) never emits during the ready handshake');
});

test('snapshots are immutable and cached; an action publishes once; unsubscribe removes ownership', () => {
  const e = environment(); e.api.setStatus({ state: 'ready' });
  const initial = e.bridge.getSnapshot(); assert.strictEqual(initial, e.bridge.getSnapshot()); assert.ok(Object.isFrozen(initial)); assert.ok(Object.isFrozen(initial.screens[0]));
  // SPEC-V4 §3 snapshot surface exists from the first publish.
  assert.deepEqual([...initial.notices], []); assert.equal(initial.toast, null); assert.equal(initial.agentBusy, false); assert.equal(initial.agentLabel, ''); assert.equal(initial.modePending, null);
  let count = 0; const unsubscribe = e.bridge.subscribe(() => count++);
  e.api.setStatus({ state: 'ready' }); assert.equal(count, 0); assert.strictEqual(initial, e.bridge.getSnapshot());
  e.bridge.zoomCamera({ action: 'out' }); assert.equal(count, 1, 'a real camera change publishes once');
  assert.deepEqual(e.commands, [], 'zooming the camera sends no toolbar layout machinery (V4-1)');
  const after = e.bridge.getSnapshot();
  e.bridge.zoomCamera({ action: 'in' }); assert.equal(count, 2);
  assert.strictEqual(e.bridge.getSnapshot().notices, after.notices, 'unrelated publishes keep notice array identity');
  e.api.setStatus({ state: 'ready' }); assert.equal(count, 2, 'unchanged values cannot invalidate useSyncExternalStore');
  unsubscribe(); e.bridge.zoomCamera({ action: 'reset' }); assert.equal(count, 2);
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
  assert.equal(e.api.setScreens([home]), false); assert.equal(e.api.setActive('other'), false); assert.equal(e.api.setMode('play'), false, 'capture refuses mode pushes (R1)');
  assert.equal(e.api.setScreenState('other', { state: 'error' }), false); assert.equal(e.api.fitAll(), false);
  assert.equal(e.api.setNotice({ id: 'registry', kind: 'error', text: 'pushed during capture' }), true, 'service notice pushes still land while capturing');
  e.bridge.setMenu(null); e.bridge.togglePan(); e.bridge.selectPage('other'); e.bridge.panBy('left'); e.bridge.retry(); e.bridge.setMode('play');
  assert.equal(JSON.stringify(e.api.getCamera()), camera); assert.equal(e.bridge.getSnapshot().openMenu, 'zoom'); assert.equal(e.bridge.getSnapshot().pan, true);
  assert.equal(e.$('toolbar-status-area').style.display, 'none', 'the notice band never leaks into the export region');
  const rect = await e.api.normalizeCapture(token);
  assert.ok([rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)); assert.ok(rect.width > 0 && rect.height > 0);
  assert.equal(e.camera.children.length, 2, 'capture hides siblings but never removes them');
  assert.equal(e.api.endCapture(token + 1), false); assert.equal(e.api.endCapture(token), true);
  assert.equal(JSON.stringify(e.api.getCamera()), camera); assert.equal(e.bridge.getSnapshot().openMenu, 'zoom'); assert.equal(e.bridge.getSnapshot().pan, true);
  assert.notEqual(e.$('toolbar-status-area').style.display, 'none', 'the band returns after the capture');
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
  assert.equal(e.camera.children[0].style['--w'], '1280px', 'the header clamp variable follows the natural width');
  assert.equal(e.api.setScreens([{ ...home, title: 'Home v2' }, other]), true);
  assert.equal(e.frameOf('home').srcWrites.length, 0, 'same id + same url = no reload');
  assert.equal(e.camera.children.length, 2);
  assert.equal(e.sectionOf('home').querySelector('.ds-ab-label').textContent, '1 · Home v2'); // N1 (FIX-3): the header text lives in the inner label span
  assert.equal(e.sectionOf('other').querySelector('.ds-ab-size').textContent, '768×1024');
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
  // Auto-grid flow rows: 1280 + 48 + 768 + 48 + 390 = 2534 <= the 3200 row
  // budget, so all three share row 1; height = max(800,1024,844) = 1024.
  assert.equal(e.camera.style.width, '2534px'); assert.equal(e.camera.style.height, '1024px');
  assert.equal(e.sectionOf('third').style.left, '2144px'); assert.equal(e.sectionOf('third').style.top, '0px');
  assert.equal(e.sectionOf('third').querySelector('.ds-ab-label').textContent, '3 · Third'); // N1 (FIX-3)
});

test('fit-all is the DEFAULT camera when the shell first becomes ready (V4-9/E10)', () => {
  const e = environment();
  const camera = e.api.getCamera();
  assert.equal(camera.mode, 'fit-all', 'the canvas opens framed on the whole wall, not fit-width');
  const expected = Math.min(3, Math.max(.1, Math.min((1000 - 48) / 2096, (720 - 48) / 1024)));
  assert.ok(Math.abs(camera.scale - expected) < 1e-9);
  assert.equal(e.$('camera').style.transform, 'translate(' + ((1000 - 2096 * camera.scale) / 2) + 'px,' + ((720 - 1024 * camera.scale) / 2) + 'px) scale(' + camera.scale + ')');
  assert.equal(e.$('camera').style['--cam-scale'], String(camera.scale), 'paint exposes the live scale for header counter-scaling');
  assert.equal(e.$('canvas').style.backgroundSize, (24 * camera.scale) + 'px ' + (24 * camera.scale) + 'px', 'the dot grid tracks camera scale');
  assert.equal(e.$('canvas').style.backgroundPosition, ((1000 - 2096 * camera.scale) / 2) + 'px ' + ((720 - 1024 * camera.scale) / 2) + 'px', 'the dot grid pans with the camera');
  assert.equal(e.$('canvas').style.backgroundImage, '', 'the grid stays visible above 0.3');
  e.api.restoreCamera({ mode: 'manual', scale: 0.2, panX: 10, panY: 10 });
  assert.equal(e.$('canvas').style.backgroundImage, 'none', 'below scale 0.3 the dots hide');
  e.api.restoreCamera({ mode: 'manual', scale: 1, panX: 0, panY: 0 });
  assert.equal(e.$('camera').style['--cam-scale'], '1');
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

test('V4-1 E1 shell-side: activation NEVER resizes an artboard and no shell path emits layout machinery', () => {
  const e = environment(undefined, true, { screens: [home, phone], viewport: { width: 1280, height: 800 }, mode: 'edit' });
  e.api.setStatus({ state: 'ready' });
  const sizes = () => JSON.stringify(e.api.getScreens().map((s: any) => [s.id, s.width, s.height]));
  const natural = sizes();
  // Every activation path the old presets/chips/double-clicks used to run:
  assert.equal(e.api.setActive('phone'), true);
  assert.equal(sizes(), natural, 'service-side setActive keeps natural registry px');
  e.elementOf('phone', '.ds-ab-title').onclick();
  e.tick(400);
  e.sectionOf('home').ondblclick({ preventDefault() {} });
  e.bridge.activateScreen('phone');
  e.bridge.fitAll(); e.bridge.panBy('left'); e.bridge.zoomCamera({ action: 'in' }); e.bridge.togglePan();
  e.bridge.setMode('play'); e.api.setMode('play');
  assert.equal(sizes(), natural, 'no activation or camera path may resize a 390x844 phone to 1280x800 (E1)');
  const types = new Set(e.commands.map((c: any) => c.type));
  for (const banned of ['layout', 'fit-size', 'viewport']) assert.equal(types.has(banned), false, banned + ' emissions are removed (SPEC-V4 §3)');
  assert.ok(types.has('screen-activate') && types.has('mode-request'));
  // The toolbar bridge exposes no preset machinery at all, and the shipped
  // toolbar/controller source has no resize-to-desktop path left to reach.
  assert.equal((e.bridge as any).selectPreset, undefined, '__dsToolbarBridge.selectPreset is gone');
  // Integrator re-pin: the toolbar preset machinery is gone, and workspace
  // paths emit no layout machinery (§3). The ONE surviving `fit-size` site is
  // the legacy single-frame auto-refit channel (bootConfig.workspace===false
  // gated ResizeObserver), which keeps v1's pinned behavior byte-identical.
  assert.doesNotMatch(source, /choosePreset|selectViewport|type:\s*'layout'|type:\s*'viewport'/);
  assert.equal((source.match(/type:\s*'fit-size'/g) ?? []).length, 1, 'exactly one legacy fit-size emit site may survive');
  assert.match(source, /bootConfig\.workspace===false&&view\.layoutMode==='fit'&&!captureState&&!fitSizeQueued/, 'the fit-size emit is welded to the legacy launch gate');
  assert.match(source, /mode:bootConfig\.workspace===false\?'fit':'fit-all'/, 'legacy boots in the v1 fit pose; workspaces in V4 fit-all');
  assert.doesNotMatch(toolbarSource, /selectViewport|PRESETS\b|selectPreset|Design viewport|Fit width/);
  // setLayout/setViewport stay ONLY as service-compatibility APIs.
  assert.equal(typeof e.api.setLayout, 'function'); assert.equal(typeof e.api.getFitBounds, 'function');
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
  const up = (x: number, y: number, shiftKey = false) => fire('pointerup', { pointerId: 1, clientX: x, clientY: y, shiftKey });
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
  down(20 + 150, 30 + 150); up(20 + 150, 30 + 150, true);
  assert.equal(e.commands.filter(c => c.type === 'screen-pick').length, 2, 'play mode leaves clicks to the screen');
  // Shift-click in EDIT mode marks the pick additive (V4-5); plain picks omit it.
  e.api.setMode('edit'); e.tick(400);
  down(20 + 120, 30 + 120); up(20 + 120, 30 + 120, true);
  assert.deepEqual(e.commands.filter(c => c.type === 'screen-pick').at(-1), { type: 'screen-pick', screen: 'other', x: 120, y: 120, additive: true });
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

test('edit-mode hover emits rAF-coalesced unscaled coordinates and one hover-end (V4-6)', () => {
  const e = environment(undefined, true, config, { frames: 'manual' });
  e.api.setStatus({ state: 'ready' });
  e.api.restoreCamera({ mode: 'manual', scale: 1, panX: 0, panY: 0 });
  const section = e.sectionOf('other');
  section.rect = { x: 20, y: 30, left: 20, top: 30, width: 768, height: 1024 };
  const move = (x: number, y: number, target: any = section) => { for (const entry of e.events) if (entry.owner === 'canvas' && entry.type === 'pointermove') entry.fn({ clientX: x, clientY: y, target }); };
  const hovers = () => e.commands.filter((c: any) => c.type === 'screen-hover');
  // Many moves inside one animation frame coalesce to the LAST position.
  move(20 + 300, 30 + 300); move(20 + 301, 30 + 302); move(20 + 305, 30 + 306);
  e.flushFrames();
  assert.deepEqual(hovers(), [{ type: 'screen-hover', screen: 'other', x: 305, y: 306 }], 'one rAF emit per frame, coordinates unscaled by the camera');
  // A 2 px drift is below the threshold: nothing new goes on the wire.
  move(20 + 306, 30 + 307); e.flushFrames();
  assert.equal(hovers().length, 1);
  // 10+ px moves re-emit.
  move(20 + 316, 30 + 317); e.flushFrames();
  assert.deepEqual(hovers().at(-1), { type: 'screen-hover', screen: 'other', x: 316, y: 317 });
  // Moving over the header chrome ends the hover exactly once.
  move(20 + 10, 10, e.elementOf('other', '.ds-ab-title'));
  assert.deepEqual(e.commands.at(-1), { type: 'screen-hover-end' });
  move(20 + 12, 8, e.elementOf('other', '.ds-ab-title'));
  assert.equal(e.commands.filter((c: any) => c.type === 'screen-hover-end').length, 1, 'leaving twice does not spam hover-end');
  // The other artboard starts a new hover (screen change emits even under 3 px).
  const homeSection = e.sectionOf('home');
  homeSection.rect = { x: 0, y: 40, left: 0, top: 40, width: 1280, height: 800 };
  move(100, 40 + 50, homeSection); e.flushFrames();
  assert.deepEqual(hovers().at(-1), { type: 'screen-hover', screen: 'home', x: 100, y: 50 });
  // Leaving the canvas ends it; play mode emits nothing.
  for (const entry of e.events) if (entry.owner === 'canvas' && entry.type === 'pointerleave') entry.fn({});
  assert.deepEqual(e.commands.at(-1), { type: 'screen-hover-end' });
  e.api.setMode('play');
  const before = hovers().length;
  move(120, 40 + 60, homeSection); e.flushFrames();
  assert.equal(hovers().length, before, 'play mode has no edit hover emitter');
  e.api.setMode('edit');
  // A pan drag suppresses hover and cuts the live hover short with hover-end.
  move(121, 40 + 61, homeSection); e.flushFrames();
  const hoverEnds = () => e.commands.filter((c: any) => c.type === 'screen-hover-end').length;
  const ends0 = hoverEnds();
  for (const entry of e.events) if (entry.owner === 'canvas' && entry.type === 'pointerdown') entry.fn({ button: 0, clientX: 300, clientY: 300, pointerId: 4, target: homeSection, preventDefault() {} });
  assert.equal(hoverEnds(), ends0 + 1, 'drag start closes the live hover');
  const hv0 = hovers().length;
  move(340, 320, homeSection); e.flushFrames();
  assert.equal(hovers().length, hv0, 'no hover is emitted while the pan drag is live');
});

test('the artboard context menu opens, maps actions, dismisses, and renames (V4-10/V4-17)', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  const section = e.sectionOf('home');
  const menus = () => e.body.children.filter((c: any) => String(c.className) === 'ds-context-menu');
  const openVia = (target: any, button = 2) => { for (const entry of e.events) if (entry.owner === 'canvas' && entry.type === 'contextmenu') entry.fn({ target, clientX: 240, clientY: 160, button, preventDefault() {} }); };
  openVia(section);
  assert.equal(menus().length, 1, 'right-click on an artboard opens exactly one menu');
  const menu = menus()[0];
  assert.equal(menu.getAttribute('role'), 'menu');
  // F10 + FIX-3 (F17): 9 items in 5 groups, joined by 4 role=separator
  // dividers — the separators are never menuitems, so the keyboard ring skips
  // them. Stop dev server (F17) is alone in its group before Rename.
  assert.equal(menu.children.length, 13, '9 items + 4 group separators');
  assert.deepEqual(menu.children.map((c: any) => c.getAttribute('role')),
    ['menuitem', 'separator', 'menuitem', 'menuitem', 'separator', 'menuitem', 'menuitem', 'menuitem', 'menuitem', 'separator', 'menuitem', 'separator', 'menuitem']);
  const itemsOf = () => menus()[0].children.filter((c: any) => c.getAttribute('role') === 'menuitem');
  // Every frozen §3 action maps to exactly {type:'screen-menu',screen,action}.
  const fired = (index: number) => itemsOf()[index].onclick();
  const labels = itemsOf().map((c: any) => c.textContent);
  assert.deepEqual(labels, ['Send to chat', 'Zoom to screen', 'Reload screen', 'Reset position', 'Export PNG', 'Export PDF', 'Copy file path', 'Stop dev server', 'Rename…']);
  assert.deepEqual(itemsOf().map((c: any) => c.dataset.action),
    ['send-to-chat', 'zoom', 'reload', 'reset-position', 'export-png', 'export-pdf', 'copy-path', 'stop-server', 'rename'],
    'data-action drives the subtle CSS icons; Rename… stays last, in its own group');
  for (const [index, action] of [[0, 'send-to-chat'], [2, 'reload'], [3, 'reset-position'], [4, 'export-png'], [5, 'export-pdf'], [6, 'copy-path'], [7, 'stop-server']] as const) {
    openVia(section);
    assert.equal(menus().length, 1);
    fired(index);
    assert.deepEqual(e.commands.at(-1), { type: 'screen-menu', screen: 'home', action });
    assert.equal(menus().length, 0, 'an action closes the menu');
  }
  // Zoom is LOCAL: focusScreen runs and nothing goes on the wire.
  const before = e.commands.length;
  openVia(section); fired(1);
  assert.equal(e.commands.length, before, "'zoom' is local focus, no message");
  assert.equal(e.api.getCamera().mode, 'manual');
  // Rename (V4-17): inline input over the header; Enter commits <=120 chars.
  openVia(section); fired(8);
  const input = e.elementOf('home', '.ds-ab-rename');
  assert.ok(input, 'the menu Rename… opens the inline header input');
  assert.equal(input.value, 'Home');
  input.value = '  Landing  ';
  e.fire(input.id, 'keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(e.commands.at(-1), { type: 'screen-rename', screen: 'home', title: 'Landing' });
  assert.equal(e.elementOf('home', '.ds-ab-rename'), null, 'committing removes the input');
  openVia(section); fired(8);
  const input2 = e.elementOf('home', '.ds-ab-rename');
  input2.value = 'x'.repeat(160);
  e.fire(input2.id, 'keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(e.commands.at(-1).title.length, 120, 'titles clamp to 120');
  const count = e.commands.length;
  openVia(section); fired(8);
  const input3 = e.elementOf('home', '.ds-ab-rename');
  e.fire(input3.id, 'keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(e.commands.length, count, 'Escape cancels without emitting');
  assert.equal(e.elementOf('home', '.ds-ab-rename'), null);
  // Dismissal: Escape, outside pointerdown, and re-right-click.
  openVia(section);
  for (const entry of e.events) if (entry.owner === 'document' && entry.type === 'keydown') entry.fn({ key: 'Escape', preventDefault() {} });
  assert.equal(menus().length, 0, 'Escape dismisses');
  openVia(section);
  const menu2 = menus()[0];
  for (const entry of e.events) if (entry.owner === 'document' && entry.type === 'pointerdown') entry.fn({ target: e.$('canvas') });
  assert.equal(menus().length, 0, 'a pointerdown outside dismisses');
  openVia(section);
  assert.notEqual(menus()[0], menu2, 're-right-click rebuilds at the new spot');
  // Keyboard: arrows move focus, Enter activates the focused item. Two
  // ArrowDowns from item 0 land on item 2 (reload screen).
  for (const entry of e.events) if (entry.owner === 'document' && entry.type === 'keydown') entry.fn({ key: 'ArrowDown', preventDefault() {} });
  for (const entry of e.events) if (entry.owner === 'document' && entry.type === 'keydown') entry.fn({ key: 'ArrowDown', preventDefault() {} });
  for (const entry of e.events) if (entry.owner === 'document' && entry.type === 'keydown') entry.fn({ key: 'Enter', preventDefault() {} });
  assert.deepEqual(e.commands.at(-1), { type: 'screen-menu', screen: 'home', action: 'reload' }, 'Enter on the focused item activates it');
  assert.equal(menus().length, 0);
  // The ⋯ header button opens the same menu; play mode restricts it to header chrome.
  e.elementOf('home', '.ds-ab-menu').onclick();
  assert.equal(menus().length, 1, 'the hover ⋯ button opens the menu');
  for (const entry of e.events) if (entry.owner === 'document' && entry.type === 'pointerdown') entry.fn({ target: e.$('canvas') });
  assert.equal(menus().length, 0, 'outside pointerdown dismisses');
  e.api.setMode('play');
  openVia(e.frameOf('home'));
  assert.equal(menus().length, 0, 'play mode: right-click inside the frame stays native');
  openVia(e.elementOf('home', '.ds-ab-title'));
  assert.equal(menus().length, 1, 'play mode: header chrome still opens the menu');
});

test('the context menu never clips: it flips at the edges, clamps inside the viewport, and re-clamps on resize (Sonnet F2)', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  // Give every controller-created div (the menu) a measured 220×300 box.
  const origCreate = e.document.createElement;
  e.document.createElement = (tag: string) => { const n = origCreate(tag); if (String(tag).toLowerCase() === 'div') n.rect = { x: 0, y: 0, left: 0, top: 0, width: 220, height: 300 }; return n; };
  e.window.innerWidth = 800; e.window.innerHeight = 720;
  const openAt = (x: number, y: number) => { for (const entry of e.events) if (entry.owner === 'canvas' && entry.type === 'contextmenu') entry.fn({ target: e.sectionOf('home'), clientX: x, clientY: y, button: 2, preventDefault() {} }); };
  const menu = () => e.body.children.filter((c: any) => String(c.className) === 'ds-context-menu')[0];
  // Comfortable spot: the raw cursor coords survive (8px margin untouched).
  openAt(100, 100);
  assert.equal(menu().style.left, '100px'); assert.equal(menu().style.top, '100px');
  // Bottom-right corner (Sonnet measured 69px past right / 65px below): flips
  // to the left of and above the cursor.
  openAt(780, 700);
  assert.equal(menu().style.left, '560px', 'flips left of the cursor (780-220)');
  assert.equal(menu().style.top, '400px', 'flips above the cursor (700-300)');
  assert.ok(560 + 220 <= 800 - 8 && 400 + 300 <= 720 - 8, 'the whole menu is inside the viewport margin');
  // No flip room (flip would land past the left edge): clamps to vw-w-8.
  e.window.innerWidth = 300;
  openAt(200, 700);
  assert.equal(menu().style.left, '72px', 'clamped to 300-220-8');
  assert.equal(menu().style.top, '400px');
  // Resize re-clamps the OPEN menu with its stored anchor (scroll-safe: the
  // menu is position:fixed and anchored in viewport coords).
  e.window.innerWidth = 800;
  e.fire('window', 'resize', {});
  assert.equal(menu().style.left, '200px', 'the wider viewport fits the original spot again');
  assert.equal(menu().style.top, '400px');
});

test('headers reserve the size label, and compact tiers follow the zoom (Sonnet F3/F7)', () => {
  const e = environment(undefined, true, { screens: [home, other, phone], viewport: { width: 1280, height: 800 }, mode: 'edit' });
  e.api.setStatus({ state: 'ready' });
  // Pin scale 0.12 (the stress-grid fit-all): 1280*0.12=153.6 device px keeps
  // the label; 768*0.12=92.2 and 390*0.12=46.8 fall under the 140px floor.
  e.api.restoreCamera({ mode: 'manual', scale: 0.12, panX: 0, panY: 0 });
  assert.equal(e.sectionOf('home').dataset.headerCompact, 'false');
  assert.equal(e.sectionOf('other').dataset.headerCompact, 'true', 'below 140 device px the size label yields to the title');
  assert.equal(e.sectionOf('phone').dataset.headerCompact, 'true');
  assert.equal(e.$('canvas').dataset.zoomCompact, 'true', 'error cards drop prose below 0.5 zoom');
  e.api.restoreCamera({ mode: 'manual', scale: 0.5, panX: 0, panY: 0 });
  assert.equal(e.$('canvas').dataset.zoomCompact, 'false');
  assert.equal(e.sectionOf('other').dataset.headerCompact, 'false', '768*0.5=384 device px restores the label');
  assert.equal(e.sectionOf('phone').dataset.headerCompact, 'false', '390*0.5=195 >= 140');
  // Boundary: exactly 140 device px is NOT compact (floor is "below 140").
  e.api.restoreCamera({ mode: 'manual', scale: 0.5, panX: 0, panY: 0 });
  assert.equal(e.sectionOf('home').dataset.headerCompact, 'false');
});

test('error cards lead with the likely cause; CSP jargon is demoted, specifics survive (Sonnet F7)', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  const overlay = e.sectionOf('other').querySelector('.ds-ab-state');
  const copy = overlay.querySelector('.ds-ab-card-copy');
  const detail = overlay.querySelector('.ds-ab-card-detail');
  const retry = overlay.querySelector('.ds-ab-retry');
  assert.ok(detail && retry, 'the overlay carries the detail line and a real Retry button');
  // The service's embedding-permissions copy (browser.ts:2630/2683) is demoted
  // VERBATIM to the secondary line; the primary names the likely cause.
  const svc = 'The preview could not be displayed. Check the dev server and CSP/X-Frame-Options embedding permissions.';
  assert.equal(e.api.setScreenState('other', { state: 'error', message: svc }), true);
  assert.equal(copy.textContent, 'Dev server unreachable — Reload to restart it.');
  assert.equal(detail.textContent, svc);
  assert.equal(detail.hidden, false);
  assert.equal(retry.hidden, false, 'Retry is visible on error');
  // A specific diagnostic (port, path) keeps the primary slot — seam 5 stands.
  e.api.setScreenState('other', { state: 'error', message: 'dev server refused at 127.0.0.1:5999' });
  assert.equal(copy.textContent, 'dev server refused at 127.0.0.1:5999');
  assert.equal(detail.textContent, '');
  assert.equal(detail.hidden, true);
  // Loading clears the detail line and shows the service's progress copy.
  e.api.setScreenState('other', { state: 'loading', message: 'Starting the dev server…' });
  assert.equal(copy.textContent, 'Starting the dev server…');
  assert.equal(detail.hidden, true);
  assert.equal(retry.hidden, true);
});

test('toolbar: the name slot is workspace identity, chips truncate at 16ch, and the chip row can never scroll the toolbar (Sonnet F4/F8)', () => {
  // F8: no §3 vehicle carries the workspace name to the shell, so the slot
  // renders the product identity and snapshot.currentTitle stays untouched
  // (pinned above at 'invalid screens…' → setPage title 'Confirmed').
  assert.match(toolbarSource, /const workspaceName = 'Design Canvas';/, 'the slot stops duplicating the active screen chip (FORK-MERGE B8 wires a real name when the service lane ships one)');
  assert.doesNotMatch(toolbarSource, /state\.screens\.find\(\(screen\) => screen\.id === state\.active\)\?\.title \|\| workspaceName/, 'the active screen title no longer feeds the workspace slot');
  assert.match(toolbarSource, /id="workspace-name" className="min-w-0 max-w-\[24ch\] shrink truncate/);
  // F4: 66-char titles ellipsis inside the chip; the row shrinks and clips
  // instead of pushing the zoom cluster / status icon off-screen.
  assert.match(toolbarSource, /className="flex min-w-0 shrink items-center gap-1 overflow-hidden"/, 'the chip row can never create the native toolbar scrollbar');
  assert.match(toolbarSource, /<span className="max-w-\[16ch\] truncate">\{screen\.title\}<\/span>/, 'chip labels truncate at 16ch');
  assert.match(toolbarSource, /className="min-w-0 shrink" title=\{`\$\{screen\.title\}/, 'chips themselves shrink below their content width');
});

test('agent input suppresses user pan/zoom and camera emits, and revealScreen pans minimally (V4-7)', () => {
  const e = environment(undefined, true, config, { timers: true });
  e.api.setStatus({ state: 'ready' });
  const changed = () => e.commands.filter((c: any) => c.type === 'camera-changed');
  e.api.restoreCamera({ mode: 'manual', scale: 1, panX: -2000, panY: -300 });
  e.fireTimers(500);
  assert.equal(changed().length, 0, 'restore never echoes');
  assert.equal(e.api.setAgentInput(true), true);
  assert.equal(e.$('canvas').dataset.agentInput, 'true', 'CSS re-enables iframe pointer-events via this attribute');
  // User wheel/pointer/keys are inert while the agent owns input.
  const cam0 = JSON.stringify(e.api.getCamera());
  for (const entry of e.events) if (entry.owner === 'canvas' && entry.type === 'wheel') entry.fn({ defaultPrevented: false, ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 300, clientX: 300, clientY: 200, target: e.$('canvas'), preventDefault() {} });
  for (const entry of e.events) if (entry.owner === 'canvas' && entry.type === 'pointerdown') entry.fn({ button: 0, clientX: 100, clientY: 100, pointerId: 3, target: e.$('canvas'), closest: () => null, preventDefault() {} });
  for (const entry of e.events) if (entry.owner === 'document' && entry.type === 'keydown') entry.fn({ key: 'h', ctrlKey: false, metaKey: false, defaultPrevented: false, preventDefault() {} });
  assert.equal(JSON.stringify(e.api.getCamera()), cam0, 'no user input moves the camera while agent input is on');
  assert.equal(e.api.handleCanvasInput({ type: 'wheel', deltaX: 0, deltaY: 100, x: 10, y: 10 }), false);
  assert.equal(e.api.setAgentInput(false), true);
  assert.equal(e.$('canvas').dataset.agentInput, undefined, 'the attribute is removed, so [data-agent-input] stops matching');
  // revealScreen brings an off-screen artboard fully in with the MINIMUM pan.
  assert.equal(e.api.revealScreen('other'), true);
  const revealed = e.api.getCamera();
  assert.equal(revealed.scale, 1, 'reveal pans only, never zooms');
  // "other" sits at cell (1328,0); tx was (1000-2096)/2-2000=-2548, so its left
  // edge sat at -1220 (off screen). Minimum pan puts the left edge exactly at 0.
  assert.ok(Math.abs(revealed.panX - (0 - 1328 - (1000 - 2096) / 2)) < 1e-9, 'minimum pan slides the board to the left edge');
  assert.ok(Math.abs(revealed.panY - (0 - 48)) < 1e-9, 'tall board aligns its top edge at 0 (no vertical over-pan)');
  assert.equal(changed().length, 0, 'revealScreen is service application, never user churn');
  e.fireTimers(500);
  assert.equal(changed().length, 0);
  // A genuinely on-screen reveal is a no-op that still returns true.
  const before = JSON.stringify(e.api.getCamera());
  assert.equal(e.api.revealScreen('other'), true);
  assert.equal(JSON.stringify(e.api.getCamera()), before);
  // Back to user control: wheel churn emits camera-changed again.
  for (const entry of e.events) if (entry.owner === 'canvas' && entry.type === 'wheel') entry.fn({ defaultPrevented: false, ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 60, clientX: 300, clientY: 200, target: e.$('canvas'), preventDefault() {} });
  e.fireTimers(500);
  assert.equal(changed().length, 1, 'user pan after hand-back persists normally');
  assert.equal(e.api.revealScreen('missing'), false);
  assert.equal(e.api.setAgentInput('yes' as never), false);
});

test('setNotice renders a stacked banner surface with strict hygiene (V4-4)', () => {
  const e = environment(); e.api.setStatus({ state: 'ready' });
  const area = e.$('toolbar-status-area');
  assert.equal(e.api.setNotice({ id: 'registry', kind: 'error', text: 'screens.json: Unexpected token' }), true);
  assert.equal(e.api.setNotice({ id: 'other', kind: 'warn', text: 'entry 2 dropped: width 120 is outside 200–8192' }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(e.bridge.getSnapshot().notices)), [
    { id: 'registry', kind: 'error', text: 'screens.json: Unexpected token' },
    { id: 'other', kind: 'warn', text: 'entry 2 dropped: width 120 is outside 200–8192' },
  ]);
  assert.equal(area.children.length, 2);
  assert.equal(area.children[0].dataset.kind, 'error');
  // Hostile text travels through textContent only -- never markup, never innerHTML.
  const hostile = '<img src=x onerror=alert(1)>';
  assert.equal(e.api.setNotice({ id: 'registry', kind: 'error', text: hostile }), true);
  assert.equal(area.children.length, 2, 'replacing an id keeps the stack stable');
  assert.equal(area.children[0].querySelector('.ds-notice-text').textContent, hostile);
  assert.equal(area.children[0].children.length, 2, 'dot + text, nothing else');
  // Empty text removes that id; next good parse clears the registry banner.
  assert.equal(e.api.setNotice({ id: 'registry', kind: 'error', text: '' }), true);
  assert.deepEqual([...e.bridge.getSnapshot().notices].map((n: any) => n.id), ['other']);
  assert.equal(area.children.length, 1);
  // Cap at 3 (oldest evicted), clamp 300 chars, refuse junk.
  assert.equal(e.api.setNotice({ id: 'a', kind: 'info', text: 'a' }), true);
  assert.equal(e.api.setNotice({ id: 'b', kind: 'warn', text: 'b' }), true);
  assert.equal(e.bridge.getSnapshot().notices.length, 3);
  assert.equal(e.api.setNotice({ id: 'c', kind: 'error', text: 'c' }), true);
  assert.deepEqual([...e.bridge.getSnapshot().notices].map((n: any) => n.id), ['a', 'b', 'c']);
  assert.equal(e.api.setNotice({ id: 'long', kind: 'error', text: 'x'.repeat(400) }), true);
  assert.equal(e.bridge.getSnapshot().notices.at(-1)!.text.length, 300);
  for (const junk of [undefined, {}, { id: '' }, { id: 'k' }, { id: 'k', text: 5 }, { id: 'x'.repeat(130), text: 'long id' }]) {
    assert.equal(e.api.setNotice(junk as never), false, JSON.stringify(junk)?.slice(0, 30));
  }
  assert.equal(e.api.setNotice({ id: 'weird', text: 'ok', kind: 'sideways' as never }), true, 'unknown kind defaults to info');
  assert.equal(e.bridge.getSnapshot().notices.at(-1)!.kind, 'info');
  assert.equal(e.bridge.getSnapshot().notices.length, 3, 'and the <=3 cap holds');
  e.bridge.zoomCamera({ action: 'in' });
  assert.equal(e.bridge.getSnapshot().notices.length, 3);
});

test('showToast is one transient bottom pill; newest replaces; copy goes to the clipboard best-effort (V4-5)', () => {
  const writes: string[] = []; let rejectNext = false;
  const e = environment(undefined, true, config, { timers: true, clipboard: (text) => { writes.push(text); return rejectNext ? Promise.reject(new Error('denied')) : Promise.resolve(); } });
  e.api.setStatus({ state: 'ready' });
  const pill = () => e.$('canvas').children.find((c: any) => String(c.className) === 'ds-toast');
  assert.equal(e.api.showToast({ kind: 'ok', text: 'Added to chat · Button #b' }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(e.bridge.getSnapshot().toast)), { kind: 'ok', text: 'Added to chat · Button #b' });
  assert.equal(pill().textContent, 'Added to chat · Button #b');
  assert.equal(pill().dataset.kind, 'ok');
  // The newest replaces (exactly one pill ever).
  assert.equal(e.api.showToast({ kind: 'warn', text: 'Not delivered — open the chat with Design Mode on' }), true);
  assert.equal(e.$('canvas').children.filter((c: any) => String(c.className) === 'ds-toast').length, 1);
  assert.equal(pill().dataset.kind, 'warn');
  // 2000 ms lifecycle.
  e.fireTimers(1999); assert.notEqual(e.bridge.getSnapshot().toast, null);
  e.fireTimers(2);
  assert.equal(e.bridge.getSnapshot().toast, null); assert.equal(pill().style.display, 'none');
  // copy:true attempts the clipboard; rejection is swallowed; plain never copies.
  rejectNext = true;
  assert.equal(e.api.showToast({ kind: 'ok', text: '/abs/path/home.html', copy: true }), true);
  assert.deepEqual(writes, ['/abs/path/home.html']);
  assert.equal(e.api.showToast({ kind: 'ok', text: 'no copy' }), true);
  assert.equal(writes.length, 1);
  for (const junk of [undefined, {}, { text: '   ' }, { kind: 'ok' }]) assert.equal(e.api.showToast(junk as never), false);
  assert.equal(e.api.showToast({ text: 'kind coerces', kind: 7 as never }), true);
  assert.equal(e.bridge.getSnapshot().toast.kind, 'ok', 'unknown toast kinds degrade to ok, never reject the ack');
});

test('mode-request shows the segment pending, then reverts with a refusal toast at 1500 ms (V4-15)', () => {
  const e = environment(undefined, true, config, { timers: true });
  e.api.setStatus({ state: 'ready' });
  e.bridge.setMode('play');
  assert.deepEqual(e.commands, [{ type: 'mode-request', mode: 'play' }]);
  assert.equal(e.bridge.getSnapshot().mode, 'edit');
  assert.equal(e.bridge.getSnapshot().modePending, 'play', 'the requested segment renders pending');
  e.fireTimers(1499);
  assert.equal(e.bridge.getSnapshot().modePending, 'play');
  e.fireTimers(5);
  assert.equal(e.bridge.getSnapshot().modePending, null);
  assert.deepEqual(JSON.parse(JSON.stringify(e.bridge.getSnapshot().toast)), { kind: 'warn', text: 'Mode change refused' });
  // Let the refusal pill expire before the next round.
  e.fireTimers(2100);
  assert.equal(e.bridge.getSnapshot().toast, null);
  // A confirmed push resolves the pending state instantly with no toast.
  e.commands.length = 0;
  e.bridge.setMode('play');
  assert.equal(e.bridge.getSnapshot().modePending, 'play');
  assert.deepEqual(e.commands, [{ type: 'mode-request', mode: 'play' }]);
  e.api.setMode('play');
  assert.equal(e.bridge.getSnapshot().modePending, null);
  assert.equal(e.bridge.getSnapshot().mode, 'play');
  assert.equal(e.bridge.getSnapshot().toast, null, 'the confirmed path arms no refusal');
  e.fireTimers(3000);
  assert.equal(e.bridge.getSnapshot().mode, 'play');
  assert.equal(e.bridge.getSnapshot().toast, null, 'and its refusal timer is dead');
  // A second request while pending is ignored (no double-send).
  e.commands.length = 0;
  e.bridge.setMode('edit'); e.bridge.setMode('edit');
  assert.deepEqual(e.commands, [{ type: 'mode-request', mode: 'edit' }]);
});

test('setAgentStatus drives the busy chip and the busy→idle Updated ack only after real reloads (V4-12)', () => {
  const e = environment(undefined, true, config, { timers: true });
  e.api.setStatus({ state: 'ready' });
  assert.equal(e.api.setAgentStatus({ busy: true, label: 'Redrawing the hero ' + 'x'.repeat(60) }), true);
  assert.equal(e.bridge.getSnapshot().agentBusy, true);
  assert.equal(e.bridge.getSnapshot().agentLabel.length, 60, 'labels clamp to 60');
  // A screen reload while busy marks the turn productive.
  e.fire('ds-frame-home', 'load', {});
  assert.equal(e.api.setAgentStatus({ busy: false }), true);
  assert.equal(e.bridge.getSnapshot().agentBusy, false);
  assert.equal(e.bridge.getSnapshot().agentLabel, '');
  assert.deepEqual(JSON.parse(JSON.stringify(e.bridge.getSnapshot().toast)), { kind: 'ok', text: 'Updated' }, 'busy→idle after reloads acks with a 2 s toast');
  e.fireTimers(2100);
  assert.equal(e.bridge.getSnapshot().toast, null);
  // Busy→idle without any reload stays silent (no false "Updated").
  assert.equal(e.api.setAgentStatus({ busy: true }), true);
  assert.equal(e.api.setAgentStatus({ busy: false }), true);
  assert.equal(e.bridge.getSnapshot().toast, null);
  for (const junk of [undefined, {}, { busy: 'yes' }, { busy: 1 }]) assert.equal(e.api.setAgentStatus(junk as never), false);
});

test('newly added artboards pulse data-new for 1200 ms; the boot bake never pulses (V4-4)', () => {
  const e = environment(undefined, true, { screens: [home], viewport: { width: 1280, height: 800 }, mode: 'edit' }, { timers: true });
  assert.equal(e.sectionOf('home').dataset.new, undefined, 'a baked board never pulses');
  assert.equal(e.api.setScreens([home, other]), true);
  assert.equal(e.sectionOf('other').dataset.new, 'true', 'a new registry entry pulses its ring');
  assert.equal(e.sectionOf('home').dataset.new, undefined, 'existing boards are untouched');
  e.fireTimers(1300);
  assert.equal(e.sectionOf('other').dataset.new, undefined, 'the pulse clears after 1200 ms');
});

test('beginCapture cancels in-flight drags, menus, hover, and hides the toast/notice band (V4-15/E18)', () => {
  const e = environment(undefined, true, config, { timers: true });
  e.api.setStatus({ state: 'ready' });
  e.api.showToast({ kind: 'ok', text: 'Visible now' });
  assert.notEqual(e.$('canvas').children.find((c: any) => String(c.className) === 'ds-toast').style.display, 'none');
  // Start a board drag (not committed) and a context menu.
  const title = e.elementOf('other', '.ds-ab-title');
  e.fire(title.id, 'pointerdown', { button: 0, clientX: 300, clientY: 120, pointerId: 9, preventDefault() {}, stopPropagation() {} });
  e.fire('window', 'pointermove', { clientX: 340, clientY: 160 });
  for (const entry of e.events) if (entry.owner === 'canvas' && entry.type === 'contextmenu') entry.fn({ target: e.sectionOf('other'), clientX: 5, clientY: 5, preventDefault() {} });
  assert.equal(e.body.children.filter((c: any) => String(c.className) === 'ds-context-menu').length, 1);
  const token = e.api.beginCapture();
  assert.equal(e.body.children.filter((c: any) => String(c.className) === 'ds-context-menu').length, 0, 'no menu survives into the capture');
  assert.equal(e.commands.filter((c: any) => c.type === 'screen-move').length, 0, 'the swallowed pointerup no longer strands the board on the cursor (E18)');
  assert.equal(e.sectionOf('other').style.left, '1328px', 'the in-flight drag reverted to its pre-drag cell');
  assert.equal(e.$('canvas').children.find((c: any) => String(c.className) === 'ds-toast').style.display, 'none', 'the toast pill never leaks into the export');
  assert.equal(e.$('toolbar-status-area').style.display, 'none');
  e.api.endCapture(token);
  assert.equal(e.$('canvas').children.find((c: any) => String(c.className) === 'ds-toast').style.display, '', 'the live toast returns after the capture');
  e.fireTimers(2100);
  assert.equal(e.$('canvas').children.find((c: any) => String(c.className) === 'ds-toast').style.display, 'none', 'and clears on its own schedule');
});

test('extracted camera math remains byte-for-byte original; the single-screen grid reproduces the original camera', () => {
  const original = readFileSync(new URL('./fixtures/stock-controller.original-viewer-ui.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const oldScript = original.match(/const VIEWER_SCRIPT = String.raw`([\s\S]*)`;/)![1]!;
  const normalizedSource = source.replace(/\r\n/g, '\n');
  // setLayout/normalizeCapture intentionally move to the grid model (active-screen
  // sizing, per-artboard capture); getFitBounds/zoomCamera/cameraShortcut stay
  // byte-identical to the fixture. zoomTo carries exactly TWO deliberate
  // deviations, both anchor-geometry corrections (fixture line-by-line pinned so
  // no other drift can sneak in unnoticed):
  //   (1) P2 seam-4: the fixture anchored Y at box.height/2 while paint offsets
  //       non-fit-all cameras by --s7 -> py = point.y - numToken('--s7').
  //   (2) V4-9: the DEFAULT camera is now centered fit-all, so an anchored zoom
  //       taken from fit-all must first convert the centered Y base into the
  //       manual s7 base (Delta term), keeping the cursor-pinned point exact on
  //       both axes across the mode switch. Unanchored zooms are byte-identical.
  for (const name of ['getFitBounds', 'zoomCamera', 'cameraShortcut']) {
    const regex = new RegExp(`(?:async )?function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}`);
    assert.equal(normalizedSource.match(regex)?.[0], oldScript.match(regex)?.[0], name + ' algorithm is not part of this extraction');
  }
  const zoomRegex = /function zoomTo\([^)]*\)\{[\s\S]*?\n  \}/;
  const oldZoomLines = oldScript.match(zoomRegex)![0]!.split('\n'), newZoomLines = normalizedSource.match(zoomRegex)![0]!.split('\n');
  assert.equal(newZoomLines.length, oldZoomLines.length, 'zoomTo keeps its shape');
  const deviations = newZoomLines.map((line, i) => [line, oldZoomLines[i]] as const).filter(([n, o]) => n !== o);
  assert.equal(deviations.length, 2, 'zoomTo deviates in exactly the two documented anchor lines');
  assert.match(deviations[0]![0], /py=point\?point\.y-numToken\('--s7'\):0/, 'deviation one is the seam-4 Y-anchor compensation');
  assert.match(deviations[1]![0], /view\.panY=py-\(py-view\.panY-\(point\?\(view\.mode==='fit-all'\?\(box\.height-view\.height\*old\)\/2-numToken\('--s7'\):0\):0\)\)\*scale\/old/, 'deviation two is the V4-9 fit-all base conversion');
  assert.match(deviations[1]![1]!, /view\.panY=py-\(py-view\.panY\)\*scale\/old/, 'the fixture line is the unconverted one');
  // The fixture script is the pre-Nova IIFE: self-invoking, single artboard.
  // Non-anchor camera ops stay byte-identical between fixture and grid shell;
  // the anchored wheel zoom moved to its own symmetry regression (seam 4).
  const old = environment(oldScript, true, legacy);
  const current = environment(undefined, true, single);
  for (const e of [old, current]) {
    e.api.setStatus({ state: 'ready' });
    e.api.setLayout({ mode: 'page', preset: 'desktop', width: 1280, height: 1880, nominalHeight: 800 });
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

test('the first anchored wheel zoom pins the canvas point under the cursor on both axes (seam 4)', () => {
  const e = environment(undefined, true, single);
  e.api.setStatus({ state: 'ready' });
  const cameraTransform = () => {
    const m = /translate\(([-\d.e+]+)px,([-\d.e+]+)px\) scale\(([-\d.e+]+)\)/.exec(e.$('camera').style.transform)!;
    return { tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]) };
  };
  const t0 = cameraTransform();
  // canvas-relative cursor (canvas rect is 1000x720 at origin; fit scale 0.74375)
  const P = { x: 210, y: 170 };
  const C = { x: (P.x - t0.tx) / t0.s, y: (P.y - t0.ty) / t0.s };
  e.api.zoomCamera({ action: 'wheel', deltaY: -40, x: 210, y: 170 });
  const t1 = cameraTransform();
  const after = { x: C.x * t1.s + t1.tx, y: C.y * t1.s + t1.ty };
  assert.ok(Math.abs(after.x - P.x) < 1e-6, 'X anchor stays pinned');
  assert.ok(Math.abs(after.y - P.y) < 1e-6, 'Y anchor stays pinned (the pre-P2 formula drifted ~' + Math.round((720 / 2 - 48) * (Math.exp(0.2) - 1)) + 'px here)');
});

test('anchored zoom taken straight from the default centered fit-all view keeps BOTH axes pinned (V4-9)', () => {
  for (const point of [{ x: 210, y: 170 }, { x: 760, y: 505 }]) {
    const e = environment(undefined, true, config); // boots centered fit-all, scale < 1
    e.api.setStatus({ state: 'ready' });
    const transform = () => {
      const m = /translate\(([-\d.e+]+)px,([-\d.e+]+)px\) scale\(([-\d.e+]+)\)/.exec(e.$('camera').style.transform)!;
      return { tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]) };
    };
    const t0 = transform();
    assert.equal(e.api.getCamera().mode, 'fit-all');
    const C = { x: (point.x - t0.tx) / t0.s, y: (point.y - t0.ty) / t0.s };
    e.api.zoomCamera({ action: 'wheel', deltaY: -120, x: point.x, y: point.y });
    const t1 = transform();
    const after = { x: C.x * t1.s + t1.tx, y: C.y * t1.s + t1.ty };
    assert.ok(Math.abs(after.x - point.x) < 1e-6 && Math.abs(after.y - point.y) < 1e-6,
      'content under the cursor survives the fit-all -> manual base switch');
  }
});

test('title-bar drag repositions artboards with the pointerdown-bound scale and emits exactly one screen-move', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  e.api.restoreCamera({ mode: 'manual', scale: 0.5, panX: 0, panY: 0 });
  const title = e.elementOf('other', '.ds-ab-title');
  assert.equal(e.elementOf('other', '.ds-ab-label').textContent, '2 · Checkout'); // N1 (FIX-3): label span carries the text
  const auto = e.api.getScreens().find((s: any) => s.id === 'other');
  assert.equal(auto.x, null, 'unpositioned screens start on the auto flow');
  const down = { button: 0, clientX: 300, clientY: 120, pointerId: 9, preventDefault() {}, stopPropagation() {} };
  e.fire(title.id, 'pointerdown', down);
  // D14 risk 5: a camera zoom racing the drag (service push) must not jitter
  // the position -- the scale is bound at pointerdown.
  e.api.restoreCamera({ mode: 'manual', scale: 2, panX: 0, panY: 0 });
  e.fire('window', 'pointermove', { clientX: 340, clientY: 160 });
  // Δ screen px (40,40) / bound scale 0.5 = (80,80) natural px from (1328,0)
  assert.equal(e.sectionOf('other').style.left, '1408px');
  assert.equal(e.sectionOf('other').style.top, '80px');
  const moved = e.api.getScreens().find((s: any) => s.id === 'other');
  assert.equal(moved.x, 1408); assert.equal(moved.y, 80);
  assert.equal(e.commands.filter((c: any) => c.type === 'screen-move').length, 0, 'live drag never emits');
  e.fire('window', 'pointerup', { clientX: 340, clientY: 160, pointerId: 9 });
  assert.deepEqual(e.commands.filter((c: any) => c.type === 'screen-move'), [{ type: 'screen-move', screen: 'other', x: 1408, y: 80 }]);
  assert.equal(e.commands.filter((c: any) => c.type === 'screen-activate').length, 0, 'a drag never activates its screen');
  title.onclick();
  assert.equal(e.commands.filter((c: any) => c.type === 'screen-activate').length, 0, 'the synthesized click after a drag is swallowed');
  title.onclick();
  assert.deepEqual(e.commands.filter((c: any) => c.type === 'screen-activate'), [{ type: 'screen-activate', screen: 'other' }], 'a clean click activates normally');
  // pointercancel reverts an in-flight drag without emitting (the camera scale
  // is now the 2 that was pushed mid-first-drag, proving the rebind per drag)
  e.fire(title.id, 'pointerdown', { ...down, clientX: 100, clientY: 100, pointerId: 10 });
  e.fire('window', 'pointermove', { clientX: 260, clientY: 100 });
  assert.equal(e.sectionOf('other').style.left, '1488px', 'live move used the freshly bound scale 2 (160/2 = 80)');
  e.fire('window', 'pointercancel', {});
  assert.equal(e.sectionOf('other').style.left, '1408px', 'cancel restores the previous placement');
  assert.equal(e.commands.filter((c: any) => c.type === 'screen-move').length, 1);
});

test('auto-grid flow is deterministic, append-stable, and positioned screens never consume flow slots', () => {
  const e = environment(undefined, true, { ...config, screens: [] });
  const mk = (id: string, width: number, height: number) => ({ id, url: 'http://127.0.0.1:5173/' + id + '.html', width, height, title: id });
  const a = mk('home', 1280, 800), b = mk('checkout', 768, 1024), c = mk('phone', 390, 844);
  const place = (list: any[]) => { assert.equal(e.api.setScreens(list), true); return list.map((s: any) => ({ id: s.id, x: parseFloat(e.sectionOf(s.id).style.left), y: parseFloat(e.sectionOf(s.id).style.top) })); };
  const first = place([a, b, c]);
  assert.deepEqual(first, [{ id: 'home', x: 0, y: 0 }, { id: 'checkout', x: 1328, y: 0 }, { id: 'phone', x: 2144, y: 0 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(e.api.getScreens().map((s: any) => [s.x, s.y]))), [[null, null], [null, null], [null, null]], 'auto slots are placed, not stored');
  // Appending auto screens never shifts earlier auto slots (flow end). The
  // 1080px social board does not fit the 3200 budget after 2144+390+48, so it
  // wraps to row 2 at max row height + gap (1024+48=1072).
  const d = mk('social', 1080, 1080);
  let positions = place([a, b, c, d]);
  assert.deepEqual(positions.slice(0, 3), first, 'append-stable: earlier auto slots are untouched');
  assert.deepEqual(positions[3], { id: 'social', x: 0, y: 1072 });
  assert.equal(e.camera.style.width, '2534px'); assert.equal(e.camera.style.height, '2152px');
  // The next board joins row 2 while the budget allows.
  positions = place([a, b, c, d, mk('print', 794, 1123)]);
  assert.deepEqual(positions[4], { id: 'print', x: 1128, y: 1072 });
  assert.deepEqual(positions.slice(0, 4), [{ id: 'home', x: 0, y: 0 }, { id: 'checkout', x: 1328, y: 0 }, { id: 'phone', x: 2144, y: 0 }, { id: 'social', x: 0, y: 1072 }]);
  assert.equal(e.camera.style.height, '2195px', 'the bbox grows to max(2152, 2195)');
  // Positioned screens win their cells; auto flow is computed as if no
  // positioned screens existed (their slots neither consume nor disturb flow):
  // the auto pair [checkout, phone] alone flows 768 + 48 -> phone at 816.
  positions = place([{ ...a, x: 500, y: 5000 }, b, c]);
  assert.deepEqual(positions, [{ id: 'home', x: 500, y: 5000 }, { id: 'checkout', x: 0, y: 0 }, { id: 'phone', x: 816, y: 0 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(e.api.getScreens().map((s: any) => [s.x, s.y]))), [[500, 5000], [null, null], [null, null]]);
  // Removing the positioned screen leaves auto slots untouched.
  positions = place([b, c]);
  assert.deepEqual(positions, [{ id: 'checkout', x: 0, y: 0 }, { id: 'phone', x: 816, y: 0 }]);
  // Explicit null returns a screen to auto; positions clamp to +-32768.
  positions = place([{ ...b, x: null, y: null }, { ...c, x: 90, y: 80 }]);
  assert.deepEqual(positions, [{ id: 'checkout', x: 0, y: 0 }, { id: 'phone', x: 90, y: 80 }]);
  positions = place([{ ...a, x: 100000, y: -100000 }, b]);
  assert.deepEqual(positions[0], { id: 'home', x: 32768, y: -32768 });
  // Absent x/y on a screen whose live position exists inherits it (a registry
  // push racing an unpersisted drag never snaps the artboard back).
  assert.equal(e.api.setScreens([{ ...c, x: 600, y: 700 }, b]), true);
  positions = place([c, b]);
  assert.deepEqual(positions, [{ id: 'phone', x: 600, y: 700 }, { id: 'checkout', x: 0, y: 0 }]);
  // One-sided or junk positions refuse the whole list -- setScreens is honest.
  for (const bad of [[{ ...a, x: 5 }, b], [{ ...a, x: Infinity, y: 5 }, b], [{ ...a, x: '10', y: 3 }, b]]) {
    assert.equal(e.api.setScreens(bad as never), false, JSON.stringify(bad));
  }
});

test('camera-changed emits once, debounced 400ms after the last paint, never echoes a restore, and dedupes unchanged cameras', () => {
  const e = environment(undefined, true, config, { timers: true });
  e.api.setStatus({ state: 'ready' });
  const changed = () => e.commands.filter((c: any) => c.type === 'camera-changed');
  // Service applies the saved camera: no echo, boot timer dies with the flag.
  e.api.restoreCamera({ mode: 'manual', scale: 1, panX: 10, panY: -5 });
  e.fireTimers(1000);
  assert.equal(changed().length, 0, 'restore application never echoes as user churn');
  // Two user zooms inside the debounce window coalesce into one emit.
  e.api.zoomCamera({ action: 'out' });
  e.fireTimers(200);
  e.api.zoomCamera({ action: 'out' });
  e.fireTimers(300);
  assert.equal(changed().length, 0, 'still inside the 400ms debounce');
  e.fireTimers(150);
  assert.equal(changed().length, 1);
  const sent = changed()[0];
  assert.equal(sent.type, 'camera-changed');
  assert.equal(sent.camera.mode, 'manual');
  assert.ok(Math.abs(sent.camera.scale - 0.64) < 1e-12);
  assert.ok(Math.abs(sent.camera.panX - 6.4) < 1e-12);
  assert.ok(Math.abs(sent.camera.panY + 3.2) < 1e-12);
  // Status paints with the identical camera dedupe against the last emission.
  e.api.setStatus({ state: 'ready' });
  e.fireTimers(500);
  assert.equal(changed().length, 1, 'unchanged camera never re-emits');
  // Pan churn funnels through paint too and emits after the debounce.
  e.fire('canvas', 'wheel', { ctrlKey: false, deltaX: 0, deltaY: 60, clientX: 200, clientY: 100, defaultPrevented: false, target: e.$('canvas'), preventDefault() {} });
  e.fireTimers(500);
  assert.equal(changed().length, 2);
  const panned = changed()[1].camera;
  assert.ok(Math.abs(panned.panY + 63.2) < 1e-12);
});

test('an in-frame navigation synced on load never triggers a duplicate same-URL load (seam 3)', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  const frame = e.frameOf('home');
  assert.equal(frame.srcWrites.length, 0);
  // The screen navigates itself (link click): the src PROPERTY now shows the
  // new URL without any controller write -- exactly what real Chrome does.
  frame._src = home.url + 'next';
  e.fire(frame.id, 'load', {});
  assert.equal(e.api.getScreens()[0].src, home.url + 'next', 'the load event mirrors the frame URL into bookkeeping');
  // The service confirms with a metadata-only push.
  e.api.setPage({ url: home.url + 'next', title: 'Next', navigate: false });
  // A later relayout (agent setScreens push) must not rewrite the src that the
  // frame is already displaying -- that was the duplicate-load bug.
  e.api.setScreens([{ ...home, url: home.url + 'next', title: 'Next' }, other]);
  assert.equal(frame.srcWrites.length, 0, 'no duplicate same-URL load ever fires');
  // A genuinely changed url still navigates exactly once.
  e.api.setScreens([{ ...home, url: home.url + 'fresh' }, other]);
  assert.deepEqual(frame.srcWrites, [home.url + 'fresh']);
});

test('a late board error event preserves a service message; platform frames never go stale on new boards (seams 3+5)', () => {
  const e = environment();
  e.api.setScreenState('other', { state: 'ready', message: 'dev server refused at 127.0.0.1:5999' });
  e.fire('ds-frame-other', 'error', {});
  const overlay = e.sectionOf('other').querySelector('.ds-ab-state');
  assert.equal(overlay.dataset.state, 'error');
  assert.equal(overlay.querySelector('.ds-ab-card-copy').textContent, 'dev server refused at 127.0.0.1:5999', 'the service message survives the DOM error listener');
  assert.equal(e.api.getScreens()[1].message, 'dev server refused at 127.0.0.1:5999');
  e.api.setScreenState('other', { state: 'ready', message: '' });
  e.fire('ds-frame-other', 'error', {});
  assert.equal(overlay.querySelector('.ds-ab-card-copy').textContent, 'Dev server unreachable — Reload to restart it.', 'without a service message the default copy still applies (F7 primary line)');
  assert.equal(overlay.querySelector('.ds-ab-card-detail').textContent, 'If it is running, check CSP / X-Frame-Options embedding permissions.', 'the CSP hint is the demoted secondary line');
  // about:blank loads (a freshly created board) never poison the bookkeeping.
  const fresh = e.frameOf('other');
  fresh._src = 'about:blank';
  e.fire('ds-frame-other', 'load', {});
  assert.equal(e.api.getScreens()[1].src, other.url, 'about:blank is ignored by the sync');
});

test('setScreens/setActive/setMode report honest booleans while a capture freezes the shell (R1)', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  assert.equal(e.api.setMode('play'), true);
  assert.equal(e.api.setMode('nope'), false, 'unknown modes are refused');
  assert.equal(e.api.setActive('missing'), false);
  assert.equal(e.api.setScreens('junk' as never), false);
  const token = e.api.beginCapture();
  assert.equal(e.api.setMode('edit'), false, 'mode refused under captureState');
  assert.equal(e.api.getMode(), 'play', 'the refused mode never applied');
  assert.equal(e.api.setScreens([home]), false);
  assert.equal(e.api.setActive('other'), false);
  assert.equal(e.api.setScreenState('home', { state: 'ready' }), false);
  assert.equal(e.api.endCapture(token), true);
  assert.equal(e.api.setMode('edit'), true, 'mode accepted again after the capture');
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
