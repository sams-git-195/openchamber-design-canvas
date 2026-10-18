// Shared hermetic DOM for the shell controller (stock-controller + b4-selection).
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

export const source = readFileSync(process.env.DS_CONTROLLER_SOURCE || new URL('../../viewer-client/src/canvas-controller.js', import.meta.url), 'utf8');
export const toolbarSource = readFileSync(new URL('../../viewer-client/src/Toolbar.tsx', import.meta.url), 'utf8');
export const home = { id: 'home', url: 'http://127.0.0.1:5173/', width: 1280, height: 800, title: 'Home' };
export const other = { id: 'other', url: 'http://127.0.0.1:5173/checkout.html', width: 768, height: 1024, title: 'Checkout' };
export const phone = { id: 'phone', url: 'http://127.0.0.1:5173/phone.html', width: 390, height: 844, title: 'Phone' };
export const config = { screens: [home, other], viewport: { width: 1280, height: 800 }, mode: 'edit' as const };
export const single = { screens: [home], viewport: { width: 1280, height: 800 }, mode: 'edit' as const };
// Pre-canvas single-artboard config kept so the original camera fixture still boots.
export const legacy = { url: 'http://127.0.0.1:5173/', pages: [{ id: 'home', label: 'Home', url: 'http://127.0.0.1:5173/' }, { id: 'other', label: 'Other', url: 'http://127.0.0.1:5173/other' }], viewport: { width: 1280, height: 800 } };

export const matchesNode = (node: any, selector: string): boolean => String(selector).split(',').some((partRaw) => {
  const part = partRaw.trim();
  if (part.startsWith('.')) return String(node.className ?? '').split(/\s+/).includes(part.slice(1));
  return part.toLowerCase() === String(node.tagName ?? '').toLowerCase();
});

export function environment(script = source.replace('export function ', 'function ') + ';initCanvas(initialConfig);', connected = true, cfg: any = config, opts: { timers?: boolean, frames?: 'sync' | 'manual', clipboard?: (text: string) => Promise<void> } = {}) {
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
