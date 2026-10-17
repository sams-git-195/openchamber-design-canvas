// A real Chrome driven over the DevTools Protocol.
//
// Node 24 ships a global `WebSocket`, so the CDP transport is implemented here
// with no npm dependency. Chrome is launched with a throwaway profile and a
// random debugging port; we read the port from `<profile>/DevToolsActivePort`,
// ask `/json/version` for the browser socket, then attach to the existing app
// window's page target.
//
// There is one launch mode: a real, chromeless, user-positionable headful
// `--app` window opened in incognito with extensions off. The in-panel
// screencast surface is gone, so there are no frames to stream and no headless
// mode: the window IS the live view. The agent still gets deterministic PNG
// stills through `capture()`.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SurfaceInputEvent, SurfaceModifiers } from '@openchamber/sdk';

import { PROBE_EXPR, PROBE_SCRIPT } from '../shared/probe-script.ts';
import type { ProbeReport } from '../shared/verify-types.ts';
import { startViewerServer } from './viewer-server.ts';
import { ArtifactContexts } from './artifact-context.ts';
import type { ShellAuthority, DefaultContext } from './artifact-context.ts';
import type { ViewerPage } from './viewer-ui.ts';
import { mergeView, mergeViewCoalesced, sanitizeCamera } from './view-state.ts';

// FORK-WIN: `DS_CHROME_PATH` always wins; without it, standard Windows install
// locations are probed, macOS keeps its bundle default, and Linux falls back to
// `chrome` on PATH. (A later multi-frame phase rewrites this file — keep
// FORK-WIN changes surgical and clearly commented for that pass.)
function resolveChromePath(): string {
  const envOverride = process.env.DS_CHROME_PATH;
  if (envOverride) return envOverride;
  if (process.platform === 'win32') {
    // FORK-WIN: probe the usual Chrome install locations before falling back.
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const probes = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    ];
    for (const candidate of probes) {
      if (candidate && existsSync(candidate)) return candidate;
    }
    return 'chrome';
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return 'chrome';
}

const CHROME_PATH = resolveChromePath();

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;
const CDP_TIMEOUT_MS = 30_000;
const NAVIGATE_TIMEOUT_MS = 30_000;
const LAUNCH_TIMEOUT_MS = 20_000;

/** App-window geometry, `DS_WINDOW` = "x,y,w,h". */
export type WindowSpec = { x: number; y: number; width: number; height: number };

// 80,80 keeps the window clear of the macOS menu bar/notch corner; 1280x800 is
// a common desktop size that fits every screen this tool targets.
const DEFAULT_WINDOW: WindowSpec = { x: 80, y: 80, width: 1280, height: 800 };
// Floor for placeWindow()/setWindowBounds sizes: Chrome misbehaves on slivers,
// and a two-pixel window is useless for design review. Positions are NOT
// floored — macOS allows negative coordinates (offscreen test windows).
const MIN_WINDOW_EDGE = 200;

// Chrome backgrounds, timer-throttles and (on macOS) occlusion-culls windows it
// considers hidden. This is the flag set vscode/AFFiNE/qwen-code ship for
// exactly that reason; a design-review window the user is not looking at should
// still settle and capture reliably.
const ANTI_THROTTLE_FLAGS = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion',
];

function parseWindowSpec(raw: string | undefined): WindowSpec | null {
  if (!raw) return null;
  const parts = raw.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts;
  return { x: x ?? 0, y: y ?? 0, width: width ?? 0, height: height ?? 0 };
}

// Kept only so browser-control.ts's wheel helper can size its scroll steps; the
// screencast path that used to fill frames with JPEG is gone, so it is always
// null now and callers fall back to the viewport size.
/**
 * True when `url` has a scheme Chrome's `--app` window actually honours.
 *
 * `--app=<url>` yields a chromeless window ONLY when the URL is a valid GURL
 * with a web-safe scheme (http/https/file). For any other scheme (notably
 * `about:blank`) Chromium's `MaybeLaunchAppShortcutWindow`
 * (chrome/browser/ui/startup/startup_browser_creator.cc) returns false and
 * silently falls back to a NORMAL window with tabs and an omnibox. The live
 * view is always a local dev server, so only http/https are accepted here.
 */
export function isWebSafeUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The exact Chrome argv for the live window. Pure and exported so a test can
 * pin the privacy/chromeless contract without launching Chrome.
 *
 * `--app=<url>` creates the window directly at the target (and no positional
 * URL: that would open a SECOND window). The URL MUST be web-safe or Chrome
 * silently falls back to a tabbed window, so a non-http(s) URL is refused here
 * as defense in depth (start() rejects it first, before spawning). `--incognito`
 * is, per Chromium docs, unsupported together with `--app`, but it works on
 * Chrome 155 (measured `window.outerHeight - window.innerHeight = 28`,
 * `display-mode: standalone`), so it stays — the web-safe URL guard is the real
 * fix.
 */
export function buildLaunchArgs(spec: WindowSpec, profile: string, url: string): string[] {
  if (!isWebSafeUrl(url)) {
    throw new Error(`refusing to launch the --app window at a non-http(s) URL: ${url}`);
  }
  // The live view is a real, chromeless, incognito `--app` window with
  // extensions off and a throwaway profile. `--app=<url>` creates the window
  // directly at the target, so target acquisition attaches to the existing
  // target instead of opening anything new.
  return [
    `--app=${url}`,
    '--incognito',
    '--disable-extensions',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${spec.width},${spec.height}`,
    `--window-position=${spec.x},${spec.y}`,
    `--user-data-dir=${profile}`,
    ...ANTI_THROTTLE_FLAGS,
  ];
}

export type BrowserFrame = {
  jpeg: Buffer;
  seq: number;
  width: number;
  height: number;
};

export type PickedElement = {
  selector: string;
  tag: string;
  classes: string;
  text: string;
  outerHTML: string;
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
};

/** A pick always names the artboard it came from (spec §B/D). */
export type ScreenPick = PickedElement & { screen: string };

/** One canvas artboard as /state reports it (spec §B GET /state extension;
 *  R2 extends each entry with the per-screen readiness state and message). */
export type ScreenState = {
  id: string;
  title: string;
  url: string;
  width: number;
  height: number;
  active: boolean;
  /** Per-artboard readiness (spec §D, R2): export/critique consume this. */
  state: 'loading' | 'ready' | 'error';
  /** Present with the specific reason when state is 'error'. */
  message?: string;
};

/**
 * A screen entry as pushed into the Browser. Registry screens carry `file`
 * (joined against `baseUrl` here); the service routes join URLs at their own
 * caller (spec §B: "screens urls = baseUrl-joined by the CALLER"), so entries
 * may also arrive with a ready-made `url` — the browser accepts either.
 *
 * D6 + P2-B handoff: entries may carry view.json positions as `x,y`
 * (number|null; null = "back to auto-grid" like view.json; one-sided/junk
 * pairs are dropped here so a push can never poison the shell's all-or-nothing
 * setScreens; ABSENT = the shell's inherit semantics for warm re-pushes).
 */
export type CanvasScreenInput = {
  id: string;
  file?: string;
  url?: string;
  title?: string;
  width?: number;
  height?: number;
  x?: number | null;
  y?: number | null;
};

export type BrowserState = {
  url: string;
  title: string;
  lastPick: ScreenPick | null;
  pickSeq: number;
  /** True while the live Chrome window process is up; false once it has exited. */
  windowOpen: boolean;
  mode: 'edit' | 'play';
  /** R1: false when the shell refused the last setMode push (twice). */
  modeApplied: boolean;
  screens: ScreenState[];
  activeScreen: string | null;
  /** The screen the LAST pick landed on (panel contract: /state.lastPickScreen). */
  lastPickScreen: string | null;
  dir: string | null;
};

// ProbeElement / ProbeReport are single-sourced in shared/verify-types.ts; the
// in-page probe (shared/probe-script.ts) produces exactly that shape.

/** CSS that freezes animations/transitions and hides the text caret for a shot. */
const STABLE_STYLE =
  '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

/**
 * The PDF freeze evaluated raw on the hidden print target after its load event
 * (spec D3 step 6 — same freeze approach as applyStableMode, but no
 * ArtifactContexts involvement: fonts-ready + double-rAF + the STABLE_STYLE
 * injection run directly through the throwaway flattened session).
 */
const PRINT_FREEZE = `(async()=>{
  if(document.fonts&&document.fonts.ready){try{await document.fonts.ready;}catch{}}
  await new Promise(resolve=>{requestAnimationFrame(()=>requestAnimationFrame(resolve));});
  const style=document.createElement('style');
  style.textContent=${JSON.stringify(STABLE_STYLE)};
  (document.head||document.documentElement).appendChild(style);
  return true;
})()`;

function emptyProbeReport(): ProbeReport {
  return {
    scrollWidth: 0,
    clientWidth: 0,
    innerWidth: 0,
    innerHeight: 0,
    scrollHeight: 0,
    cls: 0,
    selectors: [],
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const onError = (): void => reject(new Error(`failed to open CDP socket at ${url}`));
    ws.addEventListener(
      'open',
      () => {
        ws.removeEventListener('error', onError);
        resolve(ws);
      },
      { once: true },
    );
    ws.addEventListener('error', onError, { once: true });
  });
}

type CdpHandler = (params: Record<string, unknown>, sessionId?: string) => void;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
};

/** Minimal CDP client: id-keyed requests, a tiny event emitter, timeouts. */
class CdpClient {
  private readonly ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, Set<CdpHandler>>();
  private closed = false;
  private closeError: Error | null = null;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => this.onMessage(event));
    ws.addEventListener('close', () => this.onClose(new Error('CDP socket closed')));
    ws.addEventListener('error', () => this.onClose(new Error('CDP socket error')));
  }

  private onMessage(event: MessageEvent): void {
    let message: Record<string, unknown>;
    try {
      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = message.id;
    if (typeof id === 'number' && this.pending.has(id)) {
      const entry = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      const error = message.error as { message?: string } | undefined;
      if (error) entry.reject(new Error(`CDP error: ${error.message ?? 'unknown'} [${entry.method}]`));
      else entry.resolve(message.result);
      return;
    }
    const method = message.method;
    if (typeof method === 'string') {
      const set = this.handlers.get(method);
      if (!set) return;
      const params = (message.params ?? {}) as Record<string, unknown>;
      const sessionId = typeof message.sessionId === 'string' ? message.sessionId : undefined;
      for (const handler of set) handler(params, sessionId);
    }
  }

  private onClose(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.closeError = error;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(this.closeError ?? new Error('CDP closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, CDP_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject, timer, method });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  on(method: string, handler: CdpHandler): () => void {
    let set = this.handlers.get(method);
    if (!set) {
      set = new Set();
      this.handlers.set(method, set);
    }
    set.add(handler);
    const current = set;
    return () => current.delete(handler);
  }

  close(): void {
    this.onClose(new Error('CDP closed'));
    try {
      this.ws.close();
    } catch {
      /* already closing */
    }
  }
}

/**
 * The sibling loopback literal for a local URL, or `null`. macOS dev servers
 * commonly bind IPv6 (`[::1]`) while Chrome resolves `localhost` to IPv4, so a
 * failed localhost load is retried against the other literal once.
 */
export function otherLoopback(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') url.hostname = '[::1]';
  else if (host === '[::1]' || host === '::1') url.hostname = '127.0.0.1';
  else return null;
  return url.toString();
}

function once(cdp: CdpClient, method: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const off = cdp.on(method, () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      resolve(true);
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      off();
      resolve(false);
    }, timeoutMs);
  });
}

/**
 * Like `once()`, but only counts events that name one flattened session — the
 * hidden PDF target's `Page.loadEventFired` must not be confused with the app
 * window's (spec D3 step 5). One-shot, self-removing on event or timeout.
 */
function onceInSession(cdp: CdpClient, method: string, sessionId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const off = cdp.on(method, (_params, eventSession) => {
      if (eventSession !== sessionId) return;
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      resolve(true);
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      off();
      resolve(false);
    }, timeoutMs);
  });
}

function modifierBits(modifiers: SurfaceModifiers): number {
  let bits = 0;
  if (modifiers.alt) bits |= 1;
  if (modifiers.ctrl) bits |= 2;
  if (modifiers.meta) bits |= 4;
  if (modifiers.shift) bits |= 8;
  return bits;
}

function buttonName(button: number): string {
  if (button === 0) return 'left';
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'none';
}

/**
 * Injected into every new document. A pick is a GESTURE, not a mode: hold Cmd
 * (macOS `metaKey`) or Ctrl and click an element in the live window. The click
 * is swallowed in the capture phase and reported through the CDP binding
 * `window.__dsPick`; a plain click is left untouched so the page navigates
 * normally. There is deliberately NO toggle (`__dsSetPick` is gone).
 *
 * Feedback: so the user can SEE what a modified click would choose, while the
 * modifier is held this script draws a transient outline (`#__ds-pick-outline`)
 * over whatever the pointer is over and switches the document cursor to a
 * crosshair; a completed pick keeps the outline on the chosen element in a
 * different colour. This is NOT an "overlay wrapper": it never wraps or copies
 * the page. It is a SINGLE `position: fixed`, `pointer-events: none` element,
 * created/positioned lazily on hover, hidden the moment the modifier is
 * released, and excluded from the verification probe via `data-ds-overlay`.
 * Being fixed with pointer events off, it cannot shift layout or steal input.
 */
export const PICK_SCRIPT = `(() => {
  // Arming and authority are SEPARATE concerns. Server-side authority is the
  // only security boundary: a pick counts only if its __dsPick binding call
  // arrives from the artifact frame's execution context (Runtime.bindingCalled
  // -> contexts.matches(context.artifact(), session, executionContextId)).
  // window.__dsTrustedArtifact is merely the client-side arming signal, set by
  // the post-attach Runtime.evaluate in initializeArtifact; while unset this
  // script BUFFERS pick payloads in window.__dsPickPending instead of sending,
  // and the same evaluate re-runs this script (idempotent) to flush them once.
  function armed() { return !!window.__dsTrustedArtifact; }
  function sendOrBuffer(json) {
    if (window.__dsPick && armed()) { window.__dsPick(json); return; }
    if (!window.__dsPickPending) window.__dsPickPending = [];
    // Small cap: a never-armed frame (any non-top iframe the artifact page
    // embeds) cannot buffer unboundedly.
    if (window.__dsPickPending.length < 10) window.__dsPickPending.push(json);
  }
  function flushPending() {
    if (!armed() || !window.__dsPick) return;
    var pending = window.__dsPickPending;
    window.__dsPickPending = null;
    if (pending) for (var i = 0; i < pending.length; i++) window.__dsPick(pending[i]);
  }
  // Idempotent re-run on navigation (fresh document) AND on arming (the
  // initializeArtifact evaluate re-runs this script after setting the trust
  // flag): an already-installed picker only flushes anything buffered while
  // the frame was still unarmed.
  if (window.__dsPickerInstalled) { flushPending(); return; }
  window.__dsPickerInstalled = true;
  function selectorFor(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (parent) {
        var index = 0, count = 0;
        for (var i = 0; i < parent.children.length; i++) {
          var child = parent.children[i];
          if (child.tagName === node.tagName) {
            count++;
            if (child === node) index = count;
          }
        }
        if (count > 1) tag += ':nth-of-type(' + index + ')';
      }
      parts.unshift(tag);
      depth++;
      if (node.id) { parts[0] = '#' + CSS.escape(node.id); break; }
      node = parent;
    }
    return parts.join(' > ');
  }
  function stylesFor(el) {
    var cs = getComputedStyle(el);
    var keys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign',
      'color', 'backgroundColor', 'borderTopWidth', 'borderStyle', 'borderColor', 'borderRadius',
      'padding', 'margin', 'display', 'gap', 'width', 'height'];
    var out = {};
    for (var i = 0; i < keys.length; i++) out[keys[i]] = cs[keys[i]];
    return out;
  }

  // ---- transient pick feedback --------------------------------------------
  // One lazily-created fixed box that follows the pointer while a modifier is
  // held. It is intentionally NOT a wrapper: no page subtree is moved or
  // cloned, the box has pointer-events off, and it is tagged with
  // data-ds-overlay so the probe skips it.
  function inOverlay(el) {
    return !!(el && el.nodeType === 1 && el.closest && el.closest('[data-ds-overlay]'));
  }

  var outline = null;
  var outlineLabel = null;
  var savedCursor = '';
  var cursorOverridden = false;

  function ensureOutline() {
    if (outline && outline.isConnected) return outline;
    // Never leave more than one: drop any stale copy (e.g. from a prior doc).
    var stale = document.querySelectorAll('#__ds-pick-outline,[data-ds-overlay="pick"]');
    for (var i = 0; i < stale.length; i++) {
      if (stale[i] !== outline && stale[i].parentNode) stale[i].parentNode.removeChild(stale[i]);
    }
    outline = document.createElement('div');
    outline.id = '__ds-pick-outline';
    outline.setAttribute('data-ds-overlay', 'pick');
    outline.setAttribute('aria-hidden', 'true');
    // Top-layer promotion: a body-mounted fixed element loses compositing to
    // any native <dialog>.showModal() or popover, whatever its z-index. Giving
    // the outline popover="manual" lets us move it into the document's top
    // layer (ordered above every dialog) via showPopover(). A manual popover
    // never auto-dismisses, takes no focus and ignores Escape — hover/click
    // semantics are unchanged. Browsers without the Popover API, or any
    // showPopover()/hidePopover() failure, simply keep the fixed + max
    // z-index fallback below.
    outline.setAttribute('popover', 'manual');
    var s = outline.style;
    s.position = 'fixed';
    s.pointerEvents = 'none';
    s.boxSizing = 'border-box';
    s.border = '2px solid #3b82f6';
    s.background = 'rgba(59,130,246,0.12)';
    s.borderRadius = '2px';
    s.zIndex = '2147483647';
    s.top = '0px';
    s.left = '0px';
    s.width = '0px';
    s.height = '0px';
    s.display = 'none';
    // Neutralise the popover UA sheet ([popover]{position:fixed;inset:0;
    // width/height:fit-content;margin:auto;border:solid;padding:0.25em;
    // overflow:auto}) so a promoted outline renders exactly like the fallback:
    // inset/size/margin/left/top are already overridden inline, these four
    // cover the rest and are inert while the element is a plain fixed div.
    s.right = 'auto';
    s.bottom = 'auto';
    s.margin = '0';
    s.padding = '0';
    s.overflow = 'visible';
    outlineLabel = document.createElement('div');
    var ls = outlineLabel.style;
    ls.position = 'absolute';
    ls.top = '-18px';
    ls.left = '-2px';
    ls.maxWidth = '60vw';
    ls.overflow = 'hidden';
    ls.textOverflow = 'ellipsis';
    ls.whiteSpace = 'nowrap';
    ls.padding = '0 4px';
    ls.borderRadius = '2px';
    ls.background = '#3b82f6';
    ls.color = '#ffffff';
    ls.font = '11px/16px ui-monospace, SFMono-Regular, Menlo, monospace';
    outline.appendChild(outlineLabel);
    (document.body || document.documentElement).appendChild(outline);
    return outline;
  }

  // Hover state is blue; a chosen element is marked in green so it stays
  // visibly identified (persisted) rather than blinking away.
  function paint(picked) {
    if (!outline) return;
    var s = outline.style;
    s.border = picked ? '2px solid #22c55e' : '2px solid #3b82f6';
    s.background = picked ? 'rgba(34,197,94,0.14)' : 'rgba(59,130,246,0.12)';
    if (outlineLabel) outlineLabel.style.background = picked ? '#22c55e' : '#3b82f6';
    if (picked) outline.setAttribute('data-ds-picked', '1');
    else outline.removeAttribute('data-ds-picked');
  }

  // Top-layer membership tracks outline visibility: promote on show, retire on
  // hide. Every failure keeps the plain fixed + z-index fallback behaviour.
  function showTopLayer() {
    try {
      if (outline && outline.showPopover && !outline.matches(':popover-open')) outline.showPopover();
    } catch (e) { /* unavailable or refused: fixed + z-index fallback */ }
  }
  function hideTopLayer() {
    try {
      if (outline && outline.hidePopover && outline.matches(':popover-open')) outline.hidePopover();
    } catch (e) { /* already out of the top layer */ }
  }

  function place(el) {
    ensureOutline();
    var rect = el.getBoundingClientRect();
    var s = outline.style;
    s.display = 'block';
    showTopLayer();
    s.top = rect.top + 'px';
    s.left = rect.left + 'px';
    s.width = rect.width + 'px';
    s.height = rect.height + 'px';
    if (outlineLabel) outlineLabel.textContent = el.tagName.toLowerCase() + ' ' + selectorFor(el);
  }

  function setCursor(on) {
    var root = document.documentElement;
    if (!root) return;
    if (on && !cursorOverridden) {
      savedCursor = root.style.cursor;
      root.style.cursor = 'crosshair';
      cursorOverridden = true;
    } else if (!on && cursorOverridden) {
      root.style.cursor = savedCursor;
      cursorOverridden = false;
    }
  }

  function hideOutline() {
    hideTopLayer();
    if (outline) outline.style.display = 'none';
    setCursor(false);
  }

  // ---- highlight by selector (driven from outside the page) ----------------
  // The panel asks for a brief re-flash of an element it already knows (a
  // reference row hovered in the UI). It borrows the SAME transient outline as
  // the modifier hover, in a distinct clear accent (violet), shows it for about
  // 900ms, then hides it. This is NOT a pick: it reports nothing through
  // __dsPick and leaves no persistent mark.
  var highlightTimer = 0;

  function paintHighlight() {
    if (!outline) return;
    var s = outline.style;
    s.border = '2px solid #a855f7';
    s.background = 'rgba(168,85,247,0.18)';
    if (outlineLabel) outlineLabel.style.background = '#a855f7';
    outline.setAttribute('data-ds-highlight', '1');
  }

  function endHighlight() {
    if (outline) outline.removeAttribute('data-ds-highlight');
    hideOutline();
  }

  window.__dsHighlight = function (selector) {
    var el = null;
    try {
      el = selector ? document.querySelector(selector) : null;
    } catch (e) {
      return false; // an invalid selector is not a match
    }
    if (!el || el.nodeType !== 1 || inOverlay(el)) return false;
    if (highlightTimer) clearTimeout(highlightTimer);
    place(el);
    paintHighlight();
    highlightTimer = setTimeout(function () {
      highlightTimer = 0;
      endHighlight();
    }, 900);
    return true;
  };

  // Hover is throttled: pointer moves only stash the latest target and one
  // rAF does the measuring, so a fast sweep costs a single layout read a frame.
  var rafId = 0;
  var pendingTarget = null;
  function schedulePlace(el) {
    pendingTarget = el;
    if (rafId) return;
    rafId = requestAnimationFrame(function () {
      rafId = 0;
      var target = pendingTarget;
      pendingTarget = null;
      if (target && target.isConnected && !inOverlay(target)) {
        paint(false);
        place(target);
      }
    });
  }

  function onHover(e) {
    if (e.metaKey || e.ctrlKey) {
      setCursor(true);
      if (!inOverlay(e.target)) schedulePlace(e.target);
    } else {
      hideOutline();
    }
  }
  document.addEventListener('mousemove', onHover, true);
  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Meta' || e.key === 'Control') setCursor(true);
  }, true);
  document.addEventListener('keyup', function (e) {
    if (e.key === 'Meta' || e.key === 'Control') hideOutline();
  }, true);
  window.addEventListener('blur', hideOutline, true);
  window.__dsPickAt = function(x,y) {
    var el = document.elementFromPoint(x,y);
    if (!el || inOverlay(el)) return false;
    el.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,ctrlKey:true}));
    return true;
  };

  // Registered on 'window' capture, not document capture: window precedes
  // document in the capture propagation path, so a page that installs
  // window-capture click interception (e.g.
  // window.addEventListener('click', e=>e.stopImmediatePropagation(),
  // {capture:true})) no longer trivially defeats the pick — with a
  // document-only capture listener it always did, whatever the order.
  // Measured history (probes 2026-10-14-pickfix-selection / -timing): the
  // effective install USED to be the post-attach Runtime.evaluate in
  // initializeArtifact (the document_start gate failed because the shell names
  // the frame post-load), so a page script registering a window-capture
  // stopImmediatePropagation interceptor during load preceded this listener
  // and blocked the pick. This script now installs at document start for every
  // non-top frame (see ARTIFACT_SCRIPTS), so on any document created AFTER
  // registration — every reload/navigation (HMR included) — the listener
  // registers before page scripts can. KNOWN RESIDUAL, measured (probe
  // 2026-10-14-timing-verify, caseb pickDelta=0): an OOPIF can commit BEFORE
  // addScriptToEvaluateOnNewDocument reaches it (seedArtifactLoader exists for
  // exactly that race), so on the FIRST artifact load a page that installs a
  // window-capture stopImmediatePropagation interceptor during its own load
  // still precedes us and wins until the next navigation. The buffered payload
  // means the early install can never produce a send the server would not
  // honour anyway.
  window.addEventListener('click', function (e) {
    // Cmd (metaKey) or Ctrl held: this click is a reference pick, not a
    // navigation. Anything else is an ordinary click and passes through.
    if (!(e.metaKey || e.ctrlKey)) return;
    // Chrome retargets trusted clicks (and elementFromPoint) at an open
    // shadow-root boundary, so e.target is the shadow HOST. The un-retargeted
    // first entry of composedPath() is the actual shadow-INNER element the
    // user clicked; fall back to e.target for non-composed/synthetic events.
    var path = typeof e.composedPath === 'function' ? e.composedPath() : null;
    var el = (path && path.length && path[0]) || e.target;
    if (!el || el.nodeType !== 1) return;
    if (inOverlay(el)) return;
    e.preventDefault();
    e.stopPropagation();
    // Keep the outline on the picked element so the choice stays visible.
    place(el);
    paint(true);
    var rect = el.getBoundingClientRect();
    var payload = {
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      classes: typeof el.className === 'string' ? el.className : '',
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
      outerHTML: el.outerHTML.slice(0, 4000),
      styles: stylesFor(el),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
    sendOrBuffer(JSON.stringify(payload));
  }, true);
})();`;

const ARTIFACT_BRIDGE = `(() => {
  if (window.__dsBridgeInstalled) return; window.__dsBridgeInstalled = true;
  window.__dsViewerFlags = {menu:false,pan:false};
  let consumed = null;
  const emit = type => {if(window.__dsArtifactEvent)window.__dsArtifactEvent(JSON.stringify({type}));};
  document.addEventListener('pointerdown', e => {
    // A new pointer sequence supersedes a stale dismissal; keyboard clicks do
    // not belong to any pointer sequence.
    consumed=null;
    if(!window.__dsViewerFlags.menu)return;
    consumed={id:e.pointerId,type:e.pointerType,ended:false};e.preventDefault();e.stopImmediatePropagation();emit('dismiss');
  },true);
  const matches=e=>consumed&&e.pointerId===consumed.id&&e.pointerType===consumed.type;
  document.addEventListener('pointerup',e=>{if(matches(e))consumed.ended=true;},true);
  document.addEventListener('pointercancel',e=>{if(matches(e))consumed=null;},true);
  document.addEventListener('lostpointercapture',e=>{if(matches(e)&&!consumed.ended)consumed=null;},true);
  window.addEventListener('blur',()=>{consumed=null;});
  document.addEventListener('click', e => {if(e.detail!==0&&matches(e)){consumed=null;e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&window.__dsViewerFlags.menu){e.preventDefault();e.stopImmediatePropagation();emit('dismiss');}},true);
  for(const method of ['pushState','replaceState']){const original=history[method];history[method]=function(...args){const result=original.apply(this,args);emit('changed');return result;};}
  window.addEventListener('hashchange',()=>emit('changed'));window.addEventListener('popstate',()=>emit('changed'));
  window.addEventListener('load',()=>emit('changed'));document.addEventListener('DOMContentLoaded',()=>emit('changed'));
  // Bubble phase preserves target/widget-owned shortcuts. Recognized browser
  // zoom defaults are suppressed even when the renderer declines camera zoom.
  document.addEventListener('keydown',e=>{
    if(e.defaultPrevented||(!e.ctrlKey&&!e.metaKey)||e.altKey)return;
    let action=null;
    if(e.key==='+'||e.key==='='||e.code==='Equal'||e.code==='NumpadAdd')action='in';
    else if(e.key==='-'||e.code==='Minus'||e.code==='NumpadSubtract')action='out';
    else if(e.key==='0'||(!e.shiftKey&&(e.code==='Digit0'||e.code==='Numpad0')))action='reset';
    if(!action)return;
    e.preventDefault();window.__dsArtifactEvent(JSON.stringify({type:'camera-zoom',action}));
  });
  document.addEventListener('wheel',e=>{
    if(e.defaultPrevented||(!e.ctrlKey&&!e.metaKey))return;
    e.preventDefault();
    if(![e.clientX,e.clientY,e.deltaY].every(Number.isFinite)||Math.abs(e.clientX)>8192||Math.abs(e.clientY)>8192||![0,1,2].includes(e.deltaMode))return;
    // Application policy: numeric computed root line-height, otherwise16 CSS
    // pixels per line; pages use this artifact's current CSS viewport height.
    const line=parseFloat(getComputedStyle(document.documentElement).lineHeight);
    const unit=e.deltaMode===1?(Number.isFinite(line)&&line>0?line:16):e.deltaMode===2?window.innerHeight:1;
    const pixels=e.deltaY*unit;
    if(!Number.isFinite(pixels)||!Number.isFinite(unit)||unit<=0)return;
    window.__dsArtifactEvent(JSON.stringify({type:'camera-zoom',action:'wheel',deltaY:Math.max(-8192,Math.min(8192,pixels)),x:e.clientX,y:e.clientY}));
  },{passive:false});
  let dirtyQueued=false,dirtyDuringSizing=false;
  const overlay=node=>node&&node.nodeType===1&&node.closest('[data-ds-overlay]');
  const dirty=()=>{if(window.__dsSizing){dirtyDuringSizing=true;return;}if(dirtyQueued)return;dirtyQueued=true;requestAnimationFrame(()=>{dirtyQueued=false;if(!window.__dsSizing)emit('height-dirty');});};
  window.__dsFinishSizing=()=>{window.__dsSizing=false;if(dirtyDuringSizing){dirtyDuringSizing=false;dirty();}};
  const observe=()=>{
    if(!document.body)return;
    new ResizeObserver(()=>{if(!window.__dsSizing)dirty();}).observe(document.body);
    new MutationObserver(records=>{if(records.some(r=>!overlay(r.target)&&!overlay(r.target.parentElement)&&!(r.type==='childList'&&[...r.addedNodes,...r.removedNodes].every(n=>overlay(n)))))dirty();}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','src','hidden','open','width','height']});
  };
  if(document.body)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true});
  document.addEventListener('load',e=>{if(e.target instanceof HTMLImageElement)dirty();},true);
  if(document.fonts)document.fonts.ready.then(dirty);
  document.addEventListener('wheel',e=>{
    if(window.__dsLayoutMode!=='page'||window.__dsSizing||e.defaultPrevented||e.ctrlKey||e.metaKey)return;
    for(const node of e.composedPath()){
      if(!(node instanceof Element)||node===document.body||node===document.documentElement)continue;
      if(node.matches('textarea,input,select,[contenteditable],canvas,[role="application"],[role="slider"]'))return;
      const css=getComputedStyle(node);
      if((/(auto|scroll)/.test(css.overflowY)&&node.scrollHeight>node.clientHeight+1)||(/(auto|scroll)/.test(css.overflowX)&&node.scrollWidth>node.clientWidth+1))return;
    }
    if(![e.clientX,e.clientY,e.deltaX,e.deltaY].every(Number.isFinite))return;
    e.preventDefault();window.__dsArtifactEvent(JSON.stringify({type:'wheel',x:e.clientX,y:e.clientY,deltaX:e.deltaX,deltaY:e.deltaY}));
  },{passive:false});
})();`;
// Injection timing (spec §D). Page.addScriptToEvaluateOnNewDocument (enable(),
// artifact-context.ts) runs this at document start — BEFORE any page script.
// The in-frame trust gate is `window.name.startsWith('__dsArtifact:')`: the
// shell's artboard markup carries `name="__dsArtifact:<id>"` statically, so the
// gate is true at document start and the historical post-load frame-naming
// loop (SHELL_BRIDGE naming) is deleted with its injection-race workaround. The
// bridge and probe install on that gate or the post-attach trust flag;
// PICK_SCRIPT installs unconditionally in any non-top frame and only sends
// once armed (unarmed frames buffer).
const ARTIFACT_SCRIPTS = `if(window!==top){
  if(window.__dsTrustedArtifact || window.name.startsWith('__dsArtifact:')){${ARTIFACT_BRIDGE}}
  ${PICK_SCRIPT}
  if((window.__dsTrustedArtifact || window.name.startsWith('__dsArtifact:')) && !window.__dsProbe){${PROBE_SCRIPT}}
}`;
// The shell-side bridge the service injects after attach (and on every `ready`).
// v2 deletions (spec §D): the `document.getElementById('preview')` lookup and
// the post-load `frame.name='__dsArtifact'` naming — artboards are static
// markup carrying `name="__dsArtifact:<id>"`, `data-ds-screen` and
// `id="ds-frame-<id>"`, so there is nothing to name. What remains is shell
// observation: menu/pan flag sync, the capture-mode keydown block, and the
// pan-layer pick gesture, which now HIT-TESTS the artboard under the pointer
// and reports `{type:'screen-pick',screen,x,y}` over __dsCanvasSend (spec §C)
// with x/y mapped from the scaled rect into frame CSS pixels.
const SHELL_BRIDGE = `(() => {
  // Install only once the session's bindings have actually reached this
  // context: the --app window's root document exists BEFORE we attach and
  // call Runtime.addBinding, and on Windows the propagation into the existing
  // context can lag the addBinding response. Returning false simply means the
  // service retries the evaluate (shellBridgeSettled), never a half-installed
  // bridge that throws on the first __dsShellState call.
  if(!window.__dsCanvas||typeof window.__dsShellState!=='function')return false;
  if(window.__dsShellBridgeInstalled)return true;window.__dsShellBridgeInstalled=true;
  let prior='';
  // The toolbar publishes openMenu/pan through __dsToolbarBridge's snapshot; the
  // DOM scan is the fallback for shells whose menu still expresses state via
  // aria-expanded. P2-B's toolbar renders menus as popovers (no attribute
  // mutation fires), so BOTH an observer and a snapshot subscription drive the
  // same update — whichever signals first wins.
  const update=()=>{const panLayer=document.getElementById('pan-layer');const bridge=window.__dsToolbarBridge;const snapshot=(bridge&&typeof bridge.getSnapshot==='function')?bridge.getSnapshot():null;const value=JSON.stringify({menu:!!(snapshot?snapshot.openMenu:document.querySelector('[aria-expanded="true"]')),pan:!!(snapshot?snapshot.pan:panLayer&&!panLayer.hidden)});if(value!==prior){prior=value;window.__dsShellState(value);}};
  if(typeof window.__dsToolbarBridge==='object'&&window.__dsToolbarBridge&&typeof window.__dsToolbarBridge.subscribe==='function')window.__dsToolbarBridge.subscribe(update);
  new MutationObserver(update).observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden','aria-expanded','aria-pressed']});update();
  document.addEventListener('keydown',e=>{if(window.__dsCaptureActive){e.preventDefault();e.stopImmediatePropagation();}},true);
  const layer=document.getElementById('pan-layer');
  if(layer){
    let picked=false;
    layer.addEventListener('pointerdown',e=>{
      if(!(e.ctrlKey||e.metaKey))return;
      e.preventDefault();e.stopImmediatePropagation();picked=true;
      if(typeof window.__dsCanvasSend!=='function')return;
      for(const frame of document.querySelectorAll('.ds-artboard iframe[data-ds-screen]')){
        const r=frame.getBoundingClientRect();
        if(e.clientX<r.left||e.clientX>=r.right||e.clientY<r.top||e.clientY>=r.bottom)continue;
        if(![r.width,r.height,frame.clientWidth,frame.clientHeight].every(Number.isFinite)||r.width<=0||r.height<=0)break;
        const x=(e.clientX-r.left)*frame.clientWidth/r.width,y=(e.clientY-r.top)*frame.clientHeight/r.height;
        if(![x,y].every(Number.isFinite))break;
        window.__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:frame.getAttribute('data-ds-screen'),x:Math.max(0,Math.min(8192,x)),y:Math.max(0,Math.min(8192,y))}));
        break;
      }
    },true);
    for(const type of ['pointerup','click'])layer.addEventListener(type,e=>{if(picked){e.preventDefault();e.stopImmediatePropagation();if(type==='click')picked=false;}},true);
  }
  return true;
})();`;

function validPick(value: unknown): value is PickedElement {
  if(!value || typeof value!=='object')return false;
  const item=value as PickedElement;
  for(const [key,max] of [['selector',2048],['tag',64],['classes',2048],['text',200],['outerHTML',4000]] as const)if(typeof item[key]!=='string'||item[key].length>max)return false;
  if(!item.selector||!item.tag||!item.styles||typeof item.styles!=='object'||Array.isArray(item.styles)||Object.keys(item.styles).length>32)return false;
  if(Object.entries(item.styles).some(([key,text])=>key.length>64||typeof text!=='string'||text.length>2048))return false;
  return !!item.rect && ['x','y','width','height'].every(key=>Number.isFinite(item.rect[key as keyof typeof item.rect])&&Math.abs(item.rect[key as keyof typeof item.rect])<=1e7)&&item.rect.width>=0&&item.rect.height>=0;
}

function validCameraZoom(value:Record<string,unknown>):boolean{
  if(typeof value.action!=='string'||!['in','out','reset','wheel'].includes(value.action))return false;
  if(!['deltaY','x','y'].every(key=>value[key]===undefined||(typeof value[key]==='number'&&Number.isFinite(value[key])&&Math.abs(value[key])<=8192)))return false;
  return value.action!=='wheel'||['deltaY','x','y'].every(key=>typeof value[key]==='number');
}

// Spec §A: artboard screen ids. The DOM `data-ds-screen` attribute and every
// shellEval/shell message carrying a screen id is validated against this
// before it is embedded in a `getElementById('ds-frame-<id>')` expression.
const SCREEN_ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

/** The implicit single-artboard screen used by the legacy url-only launch. */
const LEGACY_SCREEN_ID = 'preview';

/** Spec §A url join: `baseUrl` + `/` + screen file, no double slashes. */
function joinScreenUrl(baseUrl: string, file: string): string {
  return baseUrl.replace(/\/+$/, '') + '/' + file.replace(/^\/+/, '');
}

/** Per-screen sizes clamp 200–8192 (spec §A; the 64–65536 camera clamp is a
 *  different thing and lives in the camera validators). */
function clampScreenSize(value: unknown, fallback: number): number {
  const n = Math.round(typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  return Math.max(200, Math.min(8192, n));
}

/** View.json positions clamp to ±32768 (D5/D6; the shell clamps identically). */
function clampPosition(value: number): number {
  return Math.max(-32768, Math.min(32768, Math.round(value)));
}

/**
 * Normalize an incoming x/y pair (D6): both numbers → clamped; both null →
 * auto; anything one-sided or junk → undefined (the push omits the pair and
 * the shell inherits the live position — a malformed pair must never trigger
 * the shell's all-or-nothing setScreens refusal).
 */
function normalizePositionPair(
  raw: { x?: unknown; y?: unknown },
): { x?: number | null; y?: number | null } {
  if (raw.x === null && raw.y === null) return { x: null, y: null };
  if (typeof raw.x === 'number' && Number.isFinite(raw.x) && typeof raw.y === 'number' && Number.isFinite(raw.y)) {
    return { x: clampPosition(raw.x), y: clampPosition(raw.y) };
  }
  return {};
}

/** One tracked artboard: registry config (`url`), what the frame currently
 *  shows (`liveUrl`/`liveTitle`), the per-screen readiness state (spec §D:
 *  chrome-error detection is per screen, never a global blank), and the
 *  CONFIGURED position pair (D6 — view.json-merged x/y from the last
 *  applyScreenRegistry call; the shell owns the LIVE position). */
type ScreenRecord = {
  id: string;
  url: string;
  liveUrl: string;
  title: string;
  liveTitle: string;
  width: number;
  height: number;
  /** undefined = absent from the push (shell inherits); number = placed; null = auto. */
  x?: number | null;
  y?: number | null;
  state: 'loading' | 'ready' | 'error';
  message: string;
};


/**
 * Kill every leftover Chrome process this extension owns — one whose command
 * line carries a `ds-chrome-` throwaway profile under the OS temp dir — and
 * remove those temp profile dirs. `POST /close` calls this so OFF (or a manual
 * close) never leaves a window behind, even one a previous service instance
 * launched and no longer tracks.
 *
 * Loopback/safe: only processes whose command line matches the
 * `ds-chrome-`-prefixed profile under the OS temp dir are touched, and only
 * those profile dirs are removed.
 */
export async function reapOrphanChrome(): Promise<void> {
  const prefix = path.join(tmpdir(), 'ds-chrome-');
  // FORK-WIN: Windows has no `ps`; enumerate orphan Chrome processes through
  // PowerShell's process table instead and kill with taskkill. When PowerShell
  // is unavailable, reaping is skipped silently — never thrown.
  if (process.platform === 'win32') {
    await reapOrphanChromeWin32(prefix);
    return;
  }
  let stdout: string;
  try {
    ({ stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile('ps', ['-ax', '-o', 'pid=,command='], { maxBuffer: 8 * 1024 * 1024 }, (error, out) => {
        if (error) reject(error);
        else resolve({ stdout: String(out) });
      });
    }));
  } catch {
    return; // ps unavailable: nothing we can safely enumerate
  }

  const pids: number[] = [];
  const profiles = new Set<string>();
  for (const line of stdout.split('\n')) {
    if (!line.includes(prefix)) continue;
    const pidMatch = line.match(/^\s*(\d+)\s/);
    if (!pidMatch) continue;
    const pid = Number(pidMatch[1]);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    pids.push(pid);
    // Only the ds-chrome- prefix under the OS temp dir is ever removed.
    const dirMatch = line.match(/--user-data-dir=(\S+)/);
    if (dirMatch && dirMatch[1] && path.resolve(dirMatch[1]).startsWith(prefix)) {
      profiles.add(dirMatch[1]);
    }
  }

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  for (const profile of profiles) {
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {
      /* best effort */
    });
  }
}

// FORK-WIN (Phase 0 — G): the win32 half of `reapOrphanChrome`. Only processes
// whose command line carries the `ds-chrome-` marker are touched (the same
// throwaway-profile convention the POSIX path uses), killed via
// `taskkill /PID <pid> /F /T`. Every failure — PowerShell missing in
// particular — skips reaping silently; the caller (/close) must never throw.
async function reapOrphanChromeWin32(prefix: string): Promise<void> {
  let stdout: string;
  try {
    // FORK-WIN: filter on the command-line marker ALONE, exactly like the
    // POSIX path (a stand-in orphan may be any executable, not just
    // chrome.exe). Backtick-t is a real tab inside PowerShell's double quotes.
    const script =
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
      "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | " +
      "Where-Object { $_.CommandLine -like '*ds-chrome-*' } | " +
      'ForEach-Object { $_.ProcessId.ToString() + "`t" + $_.CommandLine }';
    ({ stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { maxBuffer: 8 * 1024 * 1024 },
        (error, out) => {
          if (error) reject(error);
          else resolve({ stdout: String(out) });
        },
      );
    }));
  } catch {
    return; // powershell unavailable: nothing we can safely enumerate on win32
  }

  const pids: number[] = [];
  const profiles = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const pid = Number(line.slice(0, tab).trim());
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    pids.push(pid);
    // Only profile dirs under the temp dir's ds-chrome- prefix are removed.
    const dirMatch = line.slice(tab + 1).match(/--user-data-dir=(\S+)/);
    if (dirMatch && dirMatch[1] && path.resolve(dirMatch[1]).startsWith(prefix)) {
      profiles.add(dirMatch[1]);
    }
  }

  for (const pid of pids) {
    try {
      await new Promise<void>((resolve) => {
        execFile('taskkill', ['/PID', String(pid), '/F', '/T'], () => resolve());
      });
    } catch {
      /* already gone */
    }
  }
  for (const profile of profiles) {
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {
      /* best effort */
    });
  }
}

export class Browser {
  private layoutState:{mode:'fit'|'page'|'viewport';preset:string;nominalHeight:number;reason?:string}={mode:'page',preset:'desktop',nominalHeight:800};
  private layoutGeneration=0;
  private layoutQueued=false;
  private layoutDirty=false;
  /**
   * The user/agent-requested layout intent (setLayout). v2's artboard churn
   * can abort an in-flight reconcile on a context swap; without a stored
   * intent the re-queue falls back to the CURRENT mode (often fit) and the
   * requested mode is lost forever — a fit/page livelock. queueLayout prefers
   * this until a reconcile actually applies it.
   */
  private requestedLayout:{mode:'fit'|'page';preset:string}|null=null;
  private layoutContext:DefaultContext|null=null;
  private captureInFlight=false;
  /** Per-screen navigation barriers (spec §D: refresh is per screen). */
  private pendingNavigations=new Map<string,{previous:DefaultContext;target:string;sameDocumentVersion:number;responded:boolean;loaderId?:string}>();
  private refreshingScreens=new Set<string>();
  private viewer: Awaited<ReturnType<typeof startViewerServer>> | null = null;
  private contexts: ArtifactContexts | null = null;
  private pages: ViewerPage[] = [];
  private requestedUrl = '';
  private canvasFlags = { menu:false, pan:false };
  private operationTail: Promise<unknown> = Promise.resolve();
  // ---- Design Canvas state (spec §B/§D): the multi-screen workspace model.
  private mode: 'edit' | 'play' = 'edit';
  /** R1: whether the shell actually accepted the last setMode push. */
  private modeApplied = true;
  /**
   * True once a workspace opened through openWorkspace() (not the legacy
   * url-only launch). Gates R5's natural-size viewport reporting so the v1
   * single-`preview` launch keeps its byte-identical behavior.
   */
  private workspaceMode = false;
  private screenOrder: string[] = [];
  private screens = new Map<string, ScreenRecord>();
  private activeScreenId: string | null = null;
  private workspaceDir: string | null = null;
  private baseUrl: string | null = null;
  private chrome: ChildProcess | null = null;
  private cdp: CdpClient | null = null;
  private profileDir: string | null = null;
  private sessionId: string | null = null;
  private targetId: string | null = null;
  private lastPick: ScreenPick | null = null;
  private pickSeq = 0;
  private viewportWidth = VIEWPORT_WIDTH;
  private viewportHeight = VIEWPORT_HEIGHT;
  private starting: Promise<void> | null = null;
  private windowSpec: WindowSpec;
  /**
   * URL the window is launched at. Set only when a launch actually happens; it
   * is never `about:blank`, because `--app` requires a web-safe URL.
   */
  private launchUrl: string | null = null;
  /** DevTools HTTP port, for the `/json/list` diagnostics helper. */
  private debuggingPort: number | null = null;
  /** Set when the Chrome child exits on its own; drives `windowOpen`. */
  private closedAt: number | null = null;
  /** True while an observed/intentional close is tearing Chrome down. */
  private quitting = false;
  /** The in-flight teardown, so a second close (or stop) joins it instead of racing. */
  private quitPromise: Promise<void> | null = null;

  constructor() {
    // Captured at construct time: tests pin DS_WINDOW before constructing, and
    // the service picks the user's placement up once, at first use.
    this.windowSpec = parseWindowSpec(process.env.DS_WINDOW) ?? DEFAULT_WINDOW;
  }

  // ---- Design Canvas workspace surface (spec §B) ----------------------------

  /**
   * Open (or re-push) a multi-screen workspace. COLD: the screens are baked
   * into the ViewerConfig at launch — one capability URL per launch, the
   * launch URL itself is a shell constant, so `start()` cannot reuse an
   * already-running window (spec §B's warm path is `setScreens`). WARM: only
   * `__dsCanvas.setScreens`-style pushes happen; no shell restart.
   *
   * `screens` entries carry either a ready-made `url` (joined by the caller)
   * or a `file` (joined here against `baseUrl`). `dir` feeds
   * `currentWorkspaceDir()`, browser-control's last-resort dir fallback.
   */
  async openWorkspace(cfg: { dir?: string; screens: CanvasScreenInput[]; baseUrl: string; mode?: 'edit' | 'play' }): Promise<void> {
    if (typeof cfg.dir === 'string' && cfg.dir) this.workspaceDir = cfg.dir;
    if (typeof cfg.baseUrl === 'string' && cfg.baseUrl) this.baseUrl = cfg.baseUrl;
    if (cfg.mode === 'edit' || cfg.mode === 'play') this.mode = cfg.mode;
    this.workspaceMode = true;
    this.applyScreenRegistry(cfg.screens ?? []);
    if (!this.screenOrder.length) throw new Error('a canvas workspace needs at least one valid screen');
    if (this.cdp) {
      // Warm path: push everything into the live shell, then settle the
      // (possibly new) active screen. No new capability URL is created.
      await this.pushShellScreens();
      await this.setMode(this.mode);
      if (this.activeScreenId) await this.waitScreen(this.activeScreenId);
      await this.refreshUnsettled();
      await this.bringToFront();
      return;
    }
    // Cold path: a running window is NOT reused for a different screen set —
    // the ViewerConfig (and therefore the capability URL) is baked at launch.
    const first = this.screens.get(this.activeScreenId ?? '') ?? this.screens.get(this.screenOrder[0]!)!;
    this.requestedUrl = first.url;
    await this.start(first.url);
    if (this.activeScreenId) {
      const settled = await this.waitScreen(this.activeScreenId);
      if (settled) await this.bringToFront();
    }
    await this.refreshUnsettled();
  }

  /** Replace the screen registry (warm push + state re-derivation). */
  async setScreens(screens: CanvasScreenInput[]): Promise<void> {
    this.applyScreenRegistry(screens);
    if (!this.cdp) return; // cold: openWorkspace bakes the registry at launch
    await this.pushShellScreens();
    if (this.activeScreenId) await this.pushShellActive();
    await this.refreshUnsettled();
  }

  /**
   * R9 (SPEC-V3-P2-SCOPE.md D5): the warm `/open` restore push, in ONE
   * transaction and in the binding order — setScreens (with view.json
   * positions merged in) → setMode → restoreCamera. A repeated `/open` is
   * idempotent: §C `setScreens` replaces the whole artboard list, so no
   * double artboards. `camera` null means "never persisted" — restore nothing.
   */
  async restoreWorkspaceView(input: {
    screens?: CanvasScreenInput[];
    mode?: 'edit' | 'play';
    camera?: Record<string, unknown> | null;
  }): Promise<void> {
    if (!this.cdp) return; // a window mid-launch settles these pushes via `ready`
    await this.transaction(async () => {
      if (input.screens) {
        await this.shellEvalSettled(`__dsCanvas.setScreens(${JSON.stringify(input.screens)})`);
      }
      if (input.mode === 'edit' || input.mode === 'play') {
        this.modeApplied = await this.applyModePush(input.mode);
      }
      if (input.camera) {
        await this.shellEvalSettled(`__dsCanvas.restoreCamera(${JSON.stringify(input.camera)})`);
      }
    });
  }

  async setMode(mode: 'edit' | 'play'): Promise<void> {
    if (mode !== 'edit' && mode !== 'play') throw new Error('Unsupported canvas mode');
    // R1: echo the REQUESTED mode even when the shell refuses, but flag the
    // refusal on /state.modeApplied so the panel/agent can tell them apart.
    this.mode = mode;
    this.modeApplied = this.cdp ? await this.applyModePush(mode) : true;
    // D5: the canvas toolbar's mode toggle persists through the same view.json
    // funnel as camera/positions. The REQUESTED mode is what persists (user
    // intent, like the echo); modeApplied separately marks shell acceptance.
    if (this.workspaceDir) {
      void mergeView(this.workspaceDir, { mode }).catch(() => undefined);
    }
  }

  /**
   * R1: await the shell's `__dsCanvas.setMode` answer and treat it strictly —
   * only an explicit `true` counts. A refusal (or the P1 shell returning
   * nothing) is retried exactly once; a second refusal returns false (the
   * caller keeps the requested echo and flags modeApplied:false). A dead
   * shell lease counts as a refusal, never a thrown error: /mode must keep
   * answering 200.
   */
  private async applyModePush(mode: 'edit' | 'play'): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if ((await this.shellEvalSettled(`__dsCanvas.setMode(${JSON.stringify(mode)})`, 4000, false)) === true) {
          return true;
        }
      } catch {
        /* lease storm or a dead world; the retry below or the refusal path */
      }
    }
    return false;
  }

  /** Focus one artboard: the service is the authority, the shell is echoed. */
  async setActive(id: string): Promise<void> {
    if (!SCREEN_ID_RE.test(id) || !this.screens.has(id)) throw new Error(`unknown screen: ${id}`);
    this.activeScreenId = id;
    if (this.contexts) this.contexts.activeScreenId = id;
    // R5: the emulated viewport tracks the ACTIVE screen's natural size
    // during a canvas session (the shell's normalizeCapture frames the active
    // artboard at its tracked size), so capture/verification summaries stay
    // truthful from the moment of activation. Later layout quals legitimately
    // rewrite it (they restyle the artboard away from natural — then the
    // viewport reports the qualified size, which is the truth again).
    this.syncViewportToActive();
    if (this.cdp) {
      await this.pushShellActive();
      // Re-arm the layout transaction for the newly focused artboard: its
      // context differs from the stored one, so a refresh re-qualifies it.
      await this.refreshScreen(id).catch(() => undefined);
    }
  }

  getMode(): 'edit' | 'play' { return this.mode; }

  /** The workspace dir recorded by openWorkspace (browser-control's dir fallback). */
  currentWorkspaceDir(): string | null { return this.workspaceDir; }

  /** The pick, tagged with the screen it came from (spec §B). */
  pick(): ScreenPick | null { return this.lastPick; }

  /** Spec §B: existing BrowserState plus mode/screens/activeScreen/dir; R1/R2
   *  add modeApplied, per-screen state/message, and the panel's
   *  lastPickScreen field. */
  getState(): BrowserState {
    const active = this.activeScreenId ? this.screens.get(this.activeScreenId) ?? null : null;
    return {
      url: active?.liveUrl || active?.url || '',
      title: active?.liveTitle || active?.title || '',
      lastPick: this.lastPick,
      pickSeq: this.pickSeq,
      // windowOpen mirrors state(): a synchronous best guess from the tracked
      // child/CDP handles; /open and /state still await state() for the live
      // document facts.
      windowOpen: this.closedAt === null && (this.chrome !== null || this.cdp !== null),
      mode: this.mode,
      modeApplied: this.modeApplied,
      screens: this.screenOrder.map((id) => this.screenState(id)),
      activeScreen: this.activeScreenId,
      lastPickScreen: this.lastPick?.screen ?? null,
      dir: this.workspaceDir,
    };
  }

  private screenState(id: string): ScreenState {
    const record = this.screens.get(id);
    return {
      id,
      title: record?.liveTitle || record?.title || '',
      url: record?.liveUrl || record?.url || '',
      width: record?.width ?? VIEWPORT_WIDTH,
      height: record?.height ?? VIEWPORT_HEIGHT,
      active: id === this.activeScreenId,
      state: record?.state ?? 'loading',
      ...(record?.message ? { message: record.message } : {}),
    };
  }

  /** Rebuild the records from registry input, preserving per-screen live state. */
  private applyScreenRegistry(inputs: CanvasScreenInput[]): void {
    const baseUrl = this.baseUrl ?? '';
    const next = new Map<string, ScreenRecord>();
    const order: string[] = [];
    for (const raw of inputs) {
      const id = typeof raw?.id === 'string' ? raw.id : '';
      if (!SCREEN_ID_RE.test(id) || next.has(id)) continue;
      let url = typeof raw.url === 'string' && raw.url ? raw.url : '';
      if (!url && typeof raw.file === 'string' && raw.file && baseUrl) url = joinScreenUrl(baseUrl, raw.file);
      if (!isWebSafeUrl(url)) continue; // a screen the shell cannot frame is dropped, like the screens.ts reader normalizes
      const previous = this.screens.get(id);
      const width = clampScreenSize(raw.width, previous?.width ?? this.viewportWidth);
      const height = clampScreenSize(raw.height, previous?.height ?? this.viewportHeight);
      const moved = previous !== undefined && previous.url !== url;
      const position = normalizePositionPair(raw);
      next.set(id, {
        id,
        url,
        liveUrl: moved ? '' : previous?.liveUrl ?? '',
        title: typeof raw.title === 'string' && raw.title ? raw.title : previous?.title ?? '',
        liveTitle: moved ? '' : previous?.liveTitle ?? '',
        width,
        height,
        ...(position.x !== undefined ? { x: position.x, y: position.y } : {}),
        state: moved ? 'loading' : previous?.state ?? 'loading',
        message: moved ? '' : previous?.message ?? '',
      });
      order.push(id);
    }
    this.screens = next;
    this.screenOrder = order;
    if (!this.activeScreenId || !this.screens.has(this.activeScreenId)) {
      this.activeScreenId = order[0] ?? null;
      // An active-screen change invalidates the single active-screen layout
      // transaction (v1 reconciles the active artboard only).
      this.layoutContext = null;
    }
    if (this.contexts) this.contexts.activeScreenId = this.activeScreenId;
    this.syncViewportToActive();
  }

  /**
   * R5: in a canvas session the emulated viewport tracks the ACTIVE screen's
   * natural size — the shell's normalizeCapture frames the active artboard at
   * its tracked size, so `viewport()` (and everything that summarizes from it)
   * answers the size a capture actually has. Later layout qualifications/
   * resizes legitimately rewrite it (they restyle the artboard away from
   * natural — then the viewport reports that size, which is the truth again).
   */
  private syncViewportToActive(): void {
    if (!this.workspaceMode) return;
    const record = this.activeScreenId ? this.screens.get(this.activeScreenId) : undefined;
    if (!record) return;
    this.viewportWidth = record.width;
    this.viewportHeight = record.height;
  }

  /** The baked/pushed ViewerConfig screen list: {id,url,width,height,title[,x,y]}
   *  (§C; D6 positions ride the push — absent pair = the shell's inherit rule,
   *  null pair = back to auto-grid). */
  private viewerScreens(): Array<{ id: string; url: string; width: number; height: number; title: string; x?: number | null; y?: number | null }> {
    return this.screenOrder.map((id) => {
      const record = this.screens.get(id)!;
      return {
        id,
        url: record.url,
        width: record.width,
        height: record.height,
        title: record.title,
        ...(record.x !== undefined ? { x: record.x, y: record.y } : {}),
      };
    });
  }

  private async pushShellScreens(): Promise<void> {
    await this.shellEvalSettled(`__dsCanvas.setScreens(${JSON.stringify(this.viewerScreens())})`);
  }
  private async pushShellActive(): Promise<void> {
    if (!this.activeScreenId) return;
    await this.shellEvalSettled(`__dsCanvas.setActive(${JSON.stringify(this.activeScreenId)})`);
  }

  /** Best-effort settle pass over every artboard still without a live URL:
   *  discovery/arm retries keep new frames from hanging in `loading`. */
  private async refreshUnsettled(): Promise<void> {
    if (!this.cdp) return;
    const pending = this.screenOrder.filter((id) => !this.screens.get(id)?.liveUrl);
    if (!pending.length) return;
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && this.cdp) {
      let allSettled = true;
      for (const id of pending) {
        await this.contexts?.discover().catch(() => undefined);
        await this.contexts?.initializeArtifact().catch(() => undefined);
        await this.refreshScreen(id).catch(() => undefined);
        if (!this.screens.get(id)?.liveUrl && this.screens.get(id)?.state !== 'error') allSettled = false;
      }
      if (allSettled) return;
      await delay(150);
    }
  }

  /**
   * Start the live window at `url` if it is not already up.
   *
   * Chrome is launched LAZILY with the real target URL: `--app=<url>` is the
   * only thing that yields a chromeless window and it needs a web-safe URL, so
   * there is no `about:blank` placeholder launch. A running window is reused
   * as-is (`open()`/`navigate()` do the navigating); a call with NO URL while no
   * window is up is an error rather than a blank launch.
   */
  async start(url?: string): Promise<void> {
    if (this.closedAt !== null) {
      // The previous window died on its own; clear the corpse before relaunch.
      await this.stop();
    }
    // A running window is reused. Do NOT validate `url` here: a later
    // `navigate()` may legitimately go to a data:/about: page, and the launch
    // guard applies only when this call actually spawns Chrome.
    if (this.cdp) return;
    if (url === undefined) {
      throw new Error('no live window is open and no URL was provided to launch one');
    }
    if (!isWebSafeUrl(url)) {
      throw new Error(`refusing to launch the live window at a non-http(s) URL: ${url}`);
    }
    this.requestedUrl = url;
    if (!this.starting) {
      this.starting = this.launch().catch((error) => {
        this.starting = null;
        throw error;
      });
    }
    return this.starting;
  }

  private async launch(): Promise<void> {
    if (!isWebSafeUrl(this.requestedUrl)) {
      throw new Error('launch() needs a web-safe --app URL');
    }
    // A URL-only launch with no workspace registered (the legacy `open(url)`
    // path) synthesizes the single 'preview' artboard, so the shell renders
    // N=1 and the multi-frame authority machinery discovers exactly it. This
    // path is agent browsing (browser.open/start), not a design workspace:
    // default to PLAY so native input reaches the page (an EDIT-mode canvas
    // freezes artboard pointer events per decision 8).
    if (!this.screenOrder.length) {
      this.applyScreenRegistry([{ id: LEGACY_SCREEN_ID, url: this.requestedUrl }]);
      if (!this.workspaceDir) this.mode = 'play';
    }
    // Spec §C ViewerConfig: screens/viewport/mode baked at launch; the panel
    // and routes join screen URLs before calling in (spec §B).
    this.viewer = await startViewerServer({
      screens: this.viewerScreens(),
      viewport: this.viewport(),
      mode: this.mode,
    });
    const url = this.viewer.url;
    this.launchUrl = url;
    const profile = await fs.mkdtemp(path.join(tmpdir(), 'ds-chrome-'));
    this.profileDir = profile;

    // Detached + unref: the window belongs to the user, not the service, so it
    // survives the service stopping/restarting (see stop()/stopBrowser()).
    const chrome = spawn(CHROME_PATH, buildLaunchArgs(this.windowSpec, profile, url), {
      stdio: 'ignore',
      detached: true,
    });
    chrome.unref();
    this.chrome = chrome;
    chrome.on('exit', () => {
      // The child dying on its own = the live window is gone (user closed it,
      // or quit Chrome). stop() clears this.chrome before its own kill lands, so
      // an intentional shutdown is not recorded as "closed". Route through the
      // same teardown so the throwaway profile is always removed and no Chrome
      // process is left behind. Never auto-relaunched; the UI reads
      // `state().windowOpen`.
      if (this.chrome !== chrome) return;
      this.closedAt = Date.now();
      void this.quit();
    });

    const port = await this.waitForPort(profile, chrome);
    this.debuggingPort = port;
    const version = (await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())) as {
      webSocketDebuggerUrl?: string;
    };
    const wsUrl = version.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('Chrome did not report a webSocketDebuggerUrl');

    const ws = await openSocket(wsUrl);
    const cdp = new CdpClient(ws);
    this.cdp = cdp;
    this.wireEvents(cdp);
    // Target discovery makes Chrome report `Target.targetDestroyed` for the app
    // window when the user closes it; without discovery a clean window close
    // leaves the whole Chrome app running as a background process. Best effort:
    // a browser that refuses it still works through detachedFromTarget/exit.
    try {
      await cdp.send('Target.setDiscoverTargets', { discover: true });
    } catch {
      /* older/newer Chrome refused discovery; other signals still fire */
    }

    // The `--app` window already exists as a page target: attach to it. A blind
    // Target.createTarget here would open a SECOND window beside it; that is
    // only a last-resort fallback when Chrome reports no page at all.
    if (!(await this.attachExistingPage(cdp))) await this.attachNewPage(cdp);
    const session = this.requireSession();

    this.contexts = new ArtifactContexts(cdp, session, ARTIFACT_SCRIPTS, () => { this.frameEventsChanged(); }, url);
    this.contexts.activeScreenId = this.activeScreenId;
    await this.contexts.enable(session);
    await this.contexts.discover();
    await this.shellBridgeSettled();
    await this.contexts.initializeArtifact();
  }

  /** Create a fresh page target and attach to it (last-resort fallback). */
  private async attachNewPage(cdp: CdpClient): Promise<void> {
    const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
    this.targetId = String(created.targetId ?? '');
    const attached = await cdp.send('Target.attachToTarget', { targetId: this.targetId, flatten: true });
    this.sessionId = String(attached.sessionId ?? '');
  }

  /**
   * Attach (flatten) to an ALREADY-EXISTING `page` target — the `--app` window.
   * With `--app=<url>` the target is already at the requested URL, so the first
   * non-internal page is the window; the about:blank-preference is gone because
   * the window is never launched at a placeholder. Returns false when Chrome
   * reports no page target at all, so the caller can fall back to creating one.
   */
  private async attachExistingPage(cdp: CdpClient): Promise<boolean> {
    const res = await cdp.send('Target.getTargets');
    const infos = Array.isArray(res.targetInfos)
      ? (res.targetInfos as Array<{ targetId?: unknown; type?: unknown; url?: unknown }>)
      : [];
    const pages = infos.filter((info) => info.type === 'page');
    const chosen = pages.find((info) => !String(info.url ?? '').startsWith('chrome://')) ?? pages[0];
    if (!chosen || typeof chosen.targetId !== 'string') return false;
    this.targetId = chosen.targetId;
    const attached = await cdp.send('Target.attachToTarget', { targetId: this.targetId, flatten: true });
    this.sessionId = String(attached.sessionId ?? '');
    return true;
  }

  private async waitForPort(profile: string, chrome: ChildProcess): Promise<number> {
    const file = path.join(profile, 'DevToolsActivePort');
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (chrome.exitCode !== null) throw new Error(`Chrome exited early (${chrome.exitCode})`);
      try {
        const text = await fs.readFile(file, 'utf8');
        const port = Number((text.split('\n')[0] ?? '').trim());
        if (Number.isFinite(port) && port > 0) return port;
      } catch {
        /* file not written yet */
      }
      await delay(50);
    }
    throw new Error('timed out waiting for DevToolsActivePort');
  }

  private wireEvents(cdp: CdpClient): void {
    cdp.on('Runtime.bindingCalled', (params, session) => {
      if(typeof params.payload!=='string'||params.payload.length>24000)return;
      try {
        const value=JSON.parse(params.payload);
        const context=this.contexts;
        if(!context)return;
        // Artboard branch (spec §D): picks and events are honoured from ANY
        // trusted artifact context; the screen id comes from the service-side
        // executionContextId→screenId map, never from the payload itself.
        const screen=context.screenForContext(session,params.executionContextId);
        if(screen&&context.matches(context.artifact(screen),session,params.executionContextId)) {
          if(params.name==='__dsPick'&&validPick(value)){this.lastPick={...value,screen};this.pickSeq+=1;}
          if(params.name==='__dsArtifactEvent'&&value&&['dismiss','changed','height-dirty','wheel','camera-zoom'].includes(value.type)){
            if(value.type==='dismiss'&&this.canvasFlags.menu)void this.shellEval('__dsCanvas.dismissMenu()').catch(()=>undefined);
            if(value.type==='changed')void this.refreshScreen(screen);
            // Height machinery is active-screen-only in v1 (spec §C).
            if(value.type==='height-dirty'&&screen===this.activeScreenId)this.queueLayout();
            if(value.type==='camera-zoom'&&validCameraZoom(value)&&!this.captureInFlight){
              const artifact=context.artifact(screen);
              void this.transaction(async()=>{
                if(this.contexts!==context||context.artifact(screen)!==artifact||this.captureInFlight)return;
                if(value.action==='wheel'){
                  await this.shellEval(`(()=>{const f=document.getElementById('ds-frame-${screen}'),r=f.getBoundingClientRect(),c=document.getElementById('canvas').getBoundingClientRect();if(![r.x,r.y,r.width,r.height,c.x,c.y,f.clientWidth,f.clientHeight].every(Number.isFinite)||r.width<=0||r.height<=0||f.clientWidth<=0||f.clientHeight<=0)return false;return typeof __dsCanvas.zoomCamera==='function'&&__dsCanvas.zoomCamera({action:'wheel',deltaY:${value.deltaY},x:r.x+${value.x}*r.width/f.clientWidth-c.x,y:r.y+${value.y}*r.height/f.clientHeight-c.y})})()`);
                }else await this.shellEval(`typeof __dsCanvas.zoomCamera==='function'&&__dsCanvas.zoomCamera({action:${JSON.stringify(value.action)}})`);
              }).catch(()=>undefined);
            }
            if(value.type==='wheel'&&[value.x,value.y,value.deltaX,value.deltaY].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=8192)){
              const artifact=context.artifact(screen);
              void this.transaction(async()=>{if(this.layoutState.mode!=='page'||screen!==this.activeScreenId||context.artifact(screen)!==artifact)return;
                await this.shellEval(`(()=>{const f=document.getElementById('ds-frame-${screen}'),r=f.getBoundingClientRect(),c=document.getElementById('canvas').getBoundingClientRect();return __dsCanvas.handleCanvasInput({type:'wheel',deltaX:${value.deltaX},deltaY:${value.deltaY},x:r.x+${value.x}*r.width/f.clientWidth-c.x,y:r.y+${value.y}*r.height/f.clientHeight-c.y,zoom:false})})()`);
              }).catch(()=>undefined);
            }
          }
        } else if(context.matches(context.shell(),session,params.executionContextId)) {
          const authority=context.captureShellAuthority(session,params.executionContextId);
          if(!authority)return;
          if(params.name==='__dsCanvasSend')void this.canvasCommand(value,authority).catch(()=>undefined);
          if(params.name==='__dsShellState'&&value){
            void this.transaction(async()=>{
            if(!context.shellAuthorityCurrent(authority))return;
            if(typeof value.menu==='boolean'&&typeof value.pan==='boolean'){
              this.canvasFlags={menu:value.menu,pan:value.pan};
              void this.evalIn(`window.__dsViewerFlags=${JSON.stringify(this.canvasFlags)}`,false).catch(()=>undefined);
            } else if(value.pick&&[value.pick.x,value.pick.y].every((n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=8192)){
              // Legacy pan-layer pick payload; v2 artboard picks arrive as
              // canvasCommand 'screen-pick'. Honour an optional screen, else
              // the active artboard.
              const pickScreen=typeof value.pick.screen==='string'&&SCREEN_ID_RE.test(value.pick.screen)?value.pick.screen:this.activeScreenId;
              void this.evalIn(`window.__dsPickAt(${value.pick.x},${value.pick.y})`,false,pickScreen??undefined).catch(()=>undefined);
            }
            }).catch(()=>undefined);
          }
        }
      } catch {
        /* malformed payload from the page */
      }
    });
    // The user closing the app window destroys our page target (or detaches our
    // flattened session). Either is the "window is gone" signal: mark the window
    // closed, then QUIT Chrome, because macOS Chrome does not exit when its last
    // window closes — it lingers (often respawning a `--no-startup-window`
    // process) in the Dock. Discovery events name the target; detach names the
    // session, so match either against ours.
    cdp.on('Target.targetDestroyed', (params) => {
      this.handleTargetGone(String(params.targetId ?? ''), undefined);
    });
    cdp.on('Target.detachedFromTarget', (params) => {
      this.handleTargetGone(String(params.targetId ?? ''), typeof params.sessionId === 'string' ? params.sessionId : undefined);
    });
  }

  /**
   * Our window target is gone. Quit Chrome (it would otherwise stay running —
   * macOS keeps the app alive after the last window closes) and remove the
   * throwaway profile. Ignored while an intentional teardown is already running.
   */
  private handleTargetGone(targetId: string, sessionId: string | undefined): void {
    if (this.quitting) return;
    if (this.targetId === null || (targetId !== this.targetId && sessionId !== this.sessionId)) return;
    this.closedAt = Date.now();
    void this.quit();
  }

  private requireCdp(): CdpClient {
    if (!this.cdp) throw new Error('browser not started');
    return this.cdp;
  }

  private requireSession(): string {
    if (!this.sessionId) throw new Error('browser has no attached session');
    return this.sessionId;
  }

  private transaction<T>(work:()=>Promise<T>):Promise<T>{
    const next=this.operationTail.then(work,work);this.operationTail=next.catch(()=>undefined);return next;
  }
  private async shellEval(expression:string, awaitPromise=false):Promise<unknown>{
    const context=this.contexts?.shell();
    if(!context||!this.contexts)throw new Error('canvas shell context is unavailable');
    return this.contexts.evaluate(context,expression,awaitPromise);
  }
  /**
   * Install SHELL_BRIDGE with a bounded retry loop. Two Windows launch races
   * make the single-shot evaluate unreliable: (a) `shell()` fails closed while
   * an event-driven `discover()` pass is in flight (the load storm restarts it
   * constantly while we attach mid-navigation), and (b) the Runtime bindings
   * added after attach may not have reached the shell's pre-existing context
   * yet — the bridge itself answers `false` for that and is re-evaluated.
   * Returns whether the bridge reported installed; callers on the launch path
   * proceed either way (the `ready` message re-runs this once the shell boots).
   */
  private async shellBridgeSettled(timeoutMs=5000):Promise<boolean>{
    const deadline=Date.now()+timeoutMs;
    for(;;){
      try { if(await this.shellEval(SHELL_BRIDGE)===true) return true; }
      catch { /* discovery in flight or the context was swapped; retry */ }
      if(Date.now()>=deadline)return false;
      await delay(50);
    }
  }
  /**
   * shellEval that waits for a shell lease instead of failing mid-load. The
   * lease deliberately fails closed while `discover()` is in flight (see the
   * artifact-context authority tests), but on Windows a navigation keeps the
   * discovery pump running for seconds, so metadata pushes for the USER-visible
   * flow (setPage/setStatus/setScreens/setMode/setActive) retry until the lease
   * frees. Commands whose failure a caller already absorbs through
   * waitScreen/refresh retries need not use this.
   */
  private async shellEvalSettled(expression:string, timeoutMs=4000, awaitPromise=false):Promise<unknown>{
    const deadline=Date.now()+timeoutMs;
    for(;;){
      try { return await this.shellEval(expression,awaitPromise); }
      catch (error) {
        // Retry the lease-race family only: 'unavailable' means the shell
        // lease failed closed mid-discovery, 'uniqueContextId not found'
        // means the world died between resolve and send (it never executed,
        // so retrying these idempotent pushes is safe). Anything else is a
        // real contract failure and propagates.
        const message=error instanceof Error?error.message:String(error);
        if(!/shell context is unavailable|uniqueContextId not found|execution context/i.test(message)||Date.now()>=deadline)throw error;
      }
      await delay(40);
    }
  }
  async getCamera():Promise<Record<string,unknown>|null>{
    if(!this.cdp)return null;
    const camera=await this.shellEvalSettled('__dsCanvas.getCamera()') as Record<string,unknown>;
    return {...camera,layoutMode:this.layoutState.mode,preset:this.layoutState.preset,nominalHeight:this.layoutState.nominalHeight,reason:this.layoutState.reason??''};
  }
  async restoreCamera(camera:Record<string,unknown>|null):Promise<void>{
    if(!camera||!this.cdp)return;
    const generation=++this.layoutGeneration;
    await this.transaction(async()=>{
      if(generation!==this.layoutGeneration)return;
      // Spec §C (audit #7): camera EXTENT clamps widened to 64–65536 because
      // view.width/height now measure the whole artboard grid; per-screen
      // sizes stay 200–8192 (screens.ts) and resize() keeps its own 100–8192.
      if(['fit','page','viewport'].includes(String(camera.layoutMode))&&[camera.width,camera.height,camera.nominalHeight].every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=64&&n<=65536)){
        await this.applyLayout({mode:camera.layoutMode as 'fit'|'page'|'viewport',preset:String(camera.preset),nominalHeight:Number(camera.nominalHeight),reason:typeof camera.reason==='string'?camera.reason:undefined},Number(camera.width),Number(camera.height));
      }
      await this.shellEvalSettled(`__dsCanvas.restoreCamera(${JSON.stringify(camera)})`);
    });
  }
  async setLayout(mode:'fit'|'page',preset='desktop'):Promise<void>{
    if(mode!=='fit'&&mode!=='page')throw new Error('Unsupported layout mode');
    if(mode==='fit'?preset!=='fit':!this.presetSize(preset))throw new Error('Unsupported layout preset');
    const generation=++this.layoutGeneration;
    this.requestedLayout={mode,preset};
    await this.transaction(()=>this.reconcileLayout(mode,preset,generation));
  }
  private presetSize(preset:string):{width:number;height:number}|undefined{
    return ({desktop:{width:1280,height:800},large:{width:1920,height:1080},tablet:{width:768,height:1024},mobile:{width:390,height:844}} as Record<string,{width:number;height:number}>)[preset];
  }
  private async applyLayout(state:typeof this.layoutState,width:number,height:number,current:()=>boolean=()=>true):Promise<void>{
    // setLayout is a renderer-geometry push: same lease-storm tolerance as
    // the other shell metadata pushes (a throttled Windows load otherwise
    // kills requalification with 'canvas shell context is unavailable').
    const accepted=await this.shellEvalSettled(`typeof __dsCanvas.setLayout==='function'&&__dsCanvas.setLayout(${JSON.stringify({...state,width,height})})`);
    if(!current())return;
    if(accepted!==true)throw new Error('Renderer contract unavailable: __dsCanvas.setLayout must accept confirmed geometry');
    await this.evalIn(`window.__dsLayoutMode=${JSON.stringify(state.mode)}`,false);
    if(!current())return;
    this.layoutState={...state};this.viewportWidth=width;this.viewportHeight=height;
  }
  private queueLayout():void{
    if((this.layoutState.mode==='viewport'&&!this.layoutState.reason)||!this.cdp)return;
    this.layoutDirty=true;if(this.layoutQueued)return;this.layoutQueued=true;
    const intent=this.requestedLayout;
    void this.transaction(async()=>{this.layoutDirty=false;await this.reconcileLayout(intent?intent.mode:(this.layoutState.mode==='fit'?'fit':'page'),intent?intent.preset:this.layoutState.preset,this.layoutGeneration);})
      .catch(()=>undefined).finally(()=>{this.layoutQueued=false;if(this.layoutDirty)this.queueLayout();});
  }
  private async reconcileLayout(mode:'fit'|'page',preset:string,generation:number,authority?:ShellAuthority):Promise<void>{
    const contexts=this.contexts,context=contexts?.artifact();if(!context||!contexts)return;
    const current=()=>this.contexts===contexts&&contexts.artifact()===context&&generation===this.layoutGeneration&&(!authority||contexts.shellAuthorityCurrent(authority));
    if(!current())return;
    // The sizing seed races document swaps like measure() does: a dead world
    // mid-storm aborts the reconcile quietly (the next height-dirty requeues)
    // instead of throwing 'uniqueContextId not found' at setLayout callers.
    try{await contexts.evaluate(context,'window.__dsSizing=true');}catch{return;}
    try{
      if(!current())return;
      const camera=mode==='page'&&this.layoutState.mode==='page'&&this.layoutState.preset===preset?await this.shellEvalSettled('__dsCanvas.getCamera()') as Record<string,unknown>:null;
      if(!current())return;
      if(mode==='fit'){
        // getFitBounds reports the artboard GRID bounds in v2: the camera-extent
        // clamp (64–65536, spec §C audit #7), not the per-screen 200–8192 clamp.
        const bounds=await this.shellEvalSettled("typeof __dsCanvas.getFitBounds==='function'?__dsCanvas.getFitBounds():null") as {width:number;height:number}|null;
        if(!current())return;
        if(!bounds||![bounds.width,bounds.height].every(n=>Number.isInteger(n)&&n>=64&&n<=65536))throw new Error('Renderer contract unavailable: valid current getFitBounds geometry required');
        await this.applyLayout({mode:'fit',preset:'fit',nominalHeight:bounds.height},bounds.width,bounds.height,current);
        if(this.requestedLayout?.mode==='fit')this.requestedLayout=null;
        return;
      }
      const size=this.presetSize(preset);if(!size)return;
      const nominal={mode:'viewport' as const,preset,nominalHeight:size.height};
      // Only reset to the nominal viewport when the geometry/state actually
      // differs: re-applying it on an already-nominal artboard blanked the
      // reason mid-measure (a visible flicker plus extra shell relayout
      // churn during the v2 reload storm).
      const needsReset=this.layoutState.mode!=='viewport'||this.layoutState.preset!==preset||this.viewportWidth!==size.width||this.viewportHeight!==size.height||this.layoutState.reason!==undefined;
      if(needsReset){await this.applyLayout(nominal,size.width,size.height,current);if(!current())return;}
      // Measurement races document swaps (the src-reconcile reload storm — see
      // the refreshScreen FORK-MERGE note). Retry once after a beat: a world
      // that survives is transient CDP churn; a destroyed one makes current()
      // false and the reconcile aborts quietly, exactly like the pre-existing
      // `if(!current())return null` paths, instead of throwing a stale-world
      // error at setLayout callers mid-load.
      const measureOnce=async()=>{
        await contexts.evaluate(context,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',true);if(!current())return null;
        const geometry=await contexts.evaluate(context,`(()=>{const overlays=[...document.querySelectorAll('[data-ds-overlay]')].map(el=>[el,el.style.display]);try{for(const [el] of overlays)el.style.display='none';return {width:innerWidth,extent:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),visible:document.documentElement.getBoundingClientRect().width>0};}finally{for(const [el,display] of overlays)el.style.display=display;}})()`) as {width:number;extent:number;visible:boolean};
        return current()?geometry:null;
      };
      const measure=async():Promise<{width:number;extent:number;visible:boolean}|null>=>{
        try{return await measureOnce();}catch(error){
          const message=error instanceof Error?error.message:String(error);
          if(!/uniqueContextId|authority was revoked|execution context/i.test(message))throw error;
          await delay(250);
          if(!current())return null;
          // Retry failed too: report an UNQUALIFIABLE geometry (not null,
          // which means 'superseded'), so the reason lines below fall back to
          // the nominal viewport WITH an actionable reason. A reasonless pin
          // would silence queueLayout's guard and strand the canvas
          // unqualified for the rest of the session.
          try{return await measureOnce();}catch{return {width:-1,extent:-1,visible:false};}
        }
      };
      const first=await measure();if(!first)return;
      let reason='';
      if(!first.visible||first.width!==size.width||!Number.isFinite(first.extent)||first.extent<0)reason='Document geometry is unavailable; using the nominal viewport.';
      else if(first.extent>8192)reason='Page exceeds the 8192px supported bound; using the nominal viewport.';
      const candidate=Math.max(size.height,Math.ceil(first.extent));
      if(!reason){
        await this.applyLayout(nominal,size.width,candidate,current);if(!current())return;
        const second=await measure();if(!second)return;
        if(!second.visible||second.width!==size.width||!Number.isFinite(second.extent)||second.extent>candidate+1)reason='Page height grows with its viewport and does not stabilize; using the nominal viewport.';
      }
      if(!current())return;
      if(reason)await this.applyLayout({...nominal,reason},size.width,size.height,current);
      else {
        await this.applyLayout({mode:'page',preset,nominalHeight:size.height},size.width,candidate,current);
        if(current()&&camera?.layoutMode==='page')await this.shellEvalSettled(`__dsCanvas.restoreCamera(${JSON.stringify({...camera,layoutMode:'page',preset,width:size.width,height:candidate,nominalHeight:size.height,reason:''})})`);
      }
      // The requested mode is now applied (nominal-with-reason or qualified
      // page): the intent is satisfied, and later queues follow the live mode.
      if(this.requestedLayout&&this.requestedLayout.mode==='page'&&this.requestedLayout.preset===preset)this.requestedLayout=null;
    }finally{if(contexts.artifact()===context)await contexts.evaluate(context,"typeof __dsFinishSizing==='function'?__dsFinishSizing():(window.__dsSizing=false)").catch(()=>undefined);}
  }
  /** The artifact-context `changed()` pump: refresh only the artboards that
   *  could have moved — the active screen plus every screen with a pending
   *  navigation barrier — so a CDP storm does not fan out to N evaluates. */
  private frameEventsChanged(): void {
    const targets = new Set<string>([...this.pendingNavigations.keys()]);
    if (this.activeScreenId) targets.add(this.activeScreenId);
    for (const screen of targets) void this.refreshScreen(screen);
  }
  private async canvasCommand(command:unknown,authority:ShellAuthority):Promise<void>{
    if(!command||typeof command!=='object')return;
    if(!this.contexts?.shellAuthorityCurrent(authority))return;
    const value=command as {type?:string;width?:number;height?:number;id?:string;mode?:string;preset?:string;screen?:string;x?:number;y?:number;camera?:unknown};
    // Per-screen layout machinery is active-screen-only in v1 (spec §C): a
    // message naming another screen is accepted but applied only when it is
    // the active artboard.
    const screen=typeof value.screen==='string'&&SCREEN_ID_RE.test(value.screen)?value.screen:undefined;
    const isActive=(target?:string)=>!target||target===(this.activeScreenId??undefined);
    if(value.type==='ready'){
      await this.shellBridgeSettled();
      await this.contexts?.discover();
      await this.contexts?.initializeArtifact();
      // A shell reload rebuilds the artboards from its baked ViewerConfig,
      // but the LIVE mode/active choice may have moved on since launch; the
      // pushes below are the only path back to truth (the baked setScreens
      // list is current because every warm mutation pushes as it records).
      if(this.screenOrder.length&&this.activeScreenId&&this.activeScreenId!==this.screenOrder[0])await this.pushShellActive();
    }
    else if(value.type==='viewport'&&isActive(screen)&&[value.width,value.height].every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=100&&n<=8192)){++this.layoutGeneration;await this.transaction(()=>this.resizeArtifact(value.width!,value.height!,authority));}
    else if(value.type==='page'&&typeof value.id==='string'&&value.id.length<=128){const page=this.pages.find(page=>page.id===value.id);if(page)await this.navigateGuarded(screen,page.url,authority);}
    else if(value.type==='retry'){
      const record=screen?this.screens.get(screen):this.activeScreenId?this.screens.get(this.activeScreenId):undefined;
      await this.navigateGuarded(screen,record?.url??this.requestedUrl,authority);
    }
    else if(value.type==='layout'&&isActive(screen)&&(value.mode==='fit'&&value.preset==='fit'||value.mode==='page'&&typeof value.preset==='string'&&!!this.presetSize(value.preset))){
      const generation=++this.layoutGeneration;this.requestedLayout={mode:value.mode as 'fit'|'page',preset:value.preset!};await this.transaction(()=>this.reconcileLayout(value.mode as 'fit'|'page',value.preset!,generation,authority));
    }else if(value.type==='fit-size'&&isActive(screen)&&this.layoutState.mode==='fit'&&!this.captureInFlight){
      // Re-fit through the queue WITHOUT bumping the generation. v2's shell
      // fires fit-size from a ResizeObserver during every artboard change;
      // bumping the generation here cancelled queued/public setLayout calls
      // mid-storm and livelocked Page qualification behind the fit loop.
      this.queueLayout();
    }
    // ---- canvas-only inbound types (spec §C NEW) ----------------------------
    else if(value.type==='screen-pick'&&typeof screen==='string'&&[value.x,value.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=8192)){
      // Edit-mode artboard click: run the picker INSIDE that frame's context.
      void this.evalIn(`window.__dsPickAt(${value.x},${value.y})`,false,screen).catch(()=>undefined);
    }
    else if(value.type==='screen-activate'&&typeof screen==='string'&&this.screens.has(screen)){
      await this.setActive(screen);
    }
    // FORK-MERGE (P2 seam): spec §C does not enumerate 'mode-request'; the
    // shell edit/play affordances need a way to ASK for a mode change, so the
    // service answers by pushing setMode back (decision 8). Reconcile the name
    // with the shell build at P2.
    else if(value.type==='mode-request'&&(value.mode==='edit'||value.mode==='play')){
      await this.setMode(value.mode);
    }
    // ---- D5/D6: shell-driven view-state persistence -------------------------
    else if(value.type==='camera-changed'){
      // The shell debounces ≥400 ms after the last paint; the service
      // coalesces writes further on a 300 ms per-dir queue. Validated
      // §C-style server-side: a payload that cannot become a {mode, scale,
      // panX, panY} camera is dropped, never persisted. No dir recorded (no
      // workspace opened yet) → the camera cannot be persisted either.
      const camera=sanitizeCamera(value.camera);
      const dir=this.workspaceDir;
      if(camera&&dir)void mergeViewCoalesced(dir,{camera}).catch(()=>undefined);
    }
    else if(value.type==='screen-move'&&typeof screen==='string'&&this.screens.has(screen)&&[value.x,value.y].every(n=>typeof n==='number'&&Number.isFinite(n))){
      // Drag pointerup (live drag is in-memory in the shell): per-key merge of
      // that artboard's camera-space natural-px position. Last-write-wins on
      // the same key is documented, not defended (D6).
      const dir=this.workspaceDir;
      if(dir)void mergeView(dir,{positions:{[screen]:{x:Number(value.x),y:Number(value.y)}}}).catch(()=>undefined);
    }
  }
  /**
   * Per-screen URL/title tracking (spec §D). `changed` events name their
   * screen; chrome-error detection answers
   * `__dsCanvas.setScreenState(id,{state:'error'})` for THAT artboard and
   * never blanks the whole grid.
   */
  private async refreshScreen(requested?:string):Promise<void>{
    const screen=requested??this.activeScreenId;
    const contexts=this.contexts;
    if(!contexts||!screen)return;
    const context=contexts.artifact(screen);
    if(!context||this.refreshingScreens.has(screen))return;
    this.refreshingScreens.add(screen);
    try{
      const info=await contexts.evaluate(context,'({url:location.href,title:document.title,ready:document.readyState,layout:document.documentElement.getBoundingClientRect().width>0})') as {url:string;title:string;ready:string;layout:boolean};
      const record=this.screens.get(screen);
      if(!record||contexts.artifact(screen)!==context)return;
      const navigation=this.pendingNavigations.get(screen);
      if(navigation){
        if(!navigation.responded)return;
        if(navigation.loaderId){
          // Redirects retain the requested loader, but replace its document
          // world. Neither a cached URL nor a commit event alone is readiness.
          if(context===navigation.previous||contexts.artifactLoaderId(screen)!==navigation.loaderId)return;
        }else if(info.url!==navigation.target||context!==navigation.previous||contexts.artifactSameDocumentVersion(screen)<=navigation.sameDocumentVersion)return;
      }
      if(!isWebSafeUrl(info.url)){
        if(info.url.startsWith('chrome-error:')&&record.state!=='error'){
          record.state='error';
          record.message='The preview could not be displayed. Check the dev server and CSP/X-Frame-Options embedding permissions.';
          await this.shellEvalSettled(`__dsCanvas.setScreenState(${JSON.stringify(screen)},${JSON.stringify({state:'error',message:record.message})})`).catch(()=>undefined);
          if(screen===this.activeScreenId)await this.shellEvalSettled(`__dsCanvas.setStatus({state:'error',message:${JSON.stringify(record.message)}})`).catch(()=>undefined);
        }
        return;
      }
      if((info.ready!=='complete'&&info.ready!=='interactive')||!info.layout)return;
      const wasReady=record.state==='ready';
      record.state='ready';record.message='';record.liveUrl=info.url;
      if(info.title)record.liveTitle=info.title;
      if(!this.pages.some(page=>page.url===info.url))this.pages.push({id:'page-'+(this.pages.length+1),url:info.url,label:info.title||new URL(info.url).pathname});
      else this.pages=this.pages.map(page=>page.url===info.url?{...page,label:info.title||page.label}:page);
      // Board state is per screen in v2 (audit #8): the artboard overlay only
      // hides when setScreenState(ready) arrives — the global setStatus does
      // not clear it — and a live-but-visible overlay silently eats clicks and
      // captures. Push it for EVERY screen, transition-gated to stay quiet.
      if(!wasReady){
        await this.shellEvalSettled(`__dsCanvas.setScreenState(${JSON.stringify(screen)},${JSON.stringify({state:'ready'})})`,2000).catch(()=>undefined);
      }
      if(screen===this.activeScreenId){
        // Confirm actual native/SPA URLs without mutating src or replacing the DOM.
        // FORK-MERGE (P2 shell seam): setPage({navigate:false}) adopts info.url
        // as the board's own url but does NOT update the controller's tracked
        // s.src; the next relayout (any setLayout) then REWRITES iframe.src to
        // s.url — one duplicate same-URL load per genuinely-new URL (self-
        // correcting, Chrome-coalesced for hash URLs). The clean fix is
        // controller-side: update s.src from frame.src on the iframe 'load'
        // event (canvas-controller.js wireBoard), then this note disappears.
        await this.shellEvalSettled(`__dsCanvas.setPage({url:${JSON.stringify(info.url)},title:${JSON.stringify(info.title)},pages:${JSON.stringify(this.pages)},navigate:false})`);
        await this.shellEvalSettled(`__dsCanvas.setStatus({state:'ready'})`);
        await this.evalIn(`window.__dsViewerFlags=${JSON.stringify(this.canvasFlags)}`,false,screen);
        if(context!==this.layoutContext){this.layoutContext=context;this.queueLayout();}
      }
    }catch{/* navigation destroys worlds; the next frame/context event reacquires */}
    finally{this.refreshingScreens.delete(screen);}
  }
  private async waitScreen(screen:string):Promise<boolean>{
    const deadline=Date.now()+10000;
    while(Date.now()<deadline&&this.cdp){
      await this.contexts?.discover();
      await this.contexts?.initializeArtifact().catch(()=>undefined);
      await this.refreshScreen(screen);
      const record=this.screens.get(screen);
      if(record?.state==='error')return false;
      if(record?.liveUrl)return true;
      await delay(50);
    }
    const record=this.screens.get(screen);
    if(record&&!record.liveUrl&&record.state!=='error'){
      record.state='error';
      record.message='The preview did not become available. Check the dev server and whether CSP/X-Frame-Options permits embedding, then retry.';
      await this.shellEvalSettled(`__dsCanvas.setScreenState(${JSON.stringify(screen)},${JSON.stringify({state:'error',message:record.message})})`).catch(()=>undefined);
      if(screen===this.activeScreenId)await this.shellEvalSettled(`__dsCanvas.setStatus({state:'error',message:${JSON.stringify(record.message)}})`).catch(()=>undefined);
    }
    return false;
  }

  private async pageInfo(cdp: CdpClient, session: string): Promise<{ url: string; title: string }> {
    const value = await this.evalIn('JSON.stringify({url:location.href,title:document.title})',false);
    try {
      const parsed = JSON.parse(typeof value==='string'?value:'{}') as { url?: string; title?: string };
      return { url: String(parsed.url ?? ''), title: String(parsed.title ?? '') };
    } catch {
      return { url: '', title: '' };
    }
  }

  /** Navigate and wait for the load event (resolving after 30s at the latest). */
  async navigate(url: string): Promise<{ url: string; title: string; settled: boolean }>;
  async navigate(screen: string | undefined, url: string): Promise<{ url: string; title: string; settled: boolean }>;
  /**
   * navigate(screen|undefined, url) per spec §B — `undefined` = the active
   * artboard. The v1 single-string form `navigate(url)` is still accepted:
   * verify.ts / main.ts keep zero-screen call sites compiling and working
   * against the active screen until P2 tightens them (decision 11).
   */
  async navigate(a: string | undefined, b?: string): Promise<{ url: string; title: string; settled: boolean }> {
    if (b === undefined) {
      if (typeof a !== 'string' || a === '') throw new Error('navigate(url) needs a URL, or navigate(screen, url)');
      return this.navigateGuarded(undefined, a);
    }
    return this.navigateGuarded(a, b);
  }
  private async navigateGuarded(screen:string|undefined,url:string,authority?:ShellAuthority):Promise<{url:string;title:string;settled:boolean}>{
    if(!isWebSafeUrl(url)||new URL(url).username||new URL(url).password)throw new Error('canvas artifact requires an http(s) URL without credentials');
    let target=screen??this.activeScreenId??null;
    if(!target&&this.screenOrder.length)target=this.screenOrder[0]!;
    const launched=!this.cdp;
    if(launched){
      if(!target){
        // Legacy URL-only launch: one 'preview' artboard (see launch()). This
        // path is agent browsing (browser.open), so it defaults to PLAY mode —
        // an EDIT-mode canvas freezes artboard input (decision 8), which would
        // break every native click/typing call site that predates workspaces.
        this.applyScreenRegistry([{id:LEGACY_SCREEN_ID,url}]);
        target=this.activeScreenId!;
        if(!this.workspaceDir)this.mode='play';
      }else{
        const record=this.screens.get(target);
        if(!record)throw new Error(`unknown screen: ${target}`);
        record.url=url; // the cold bake carries the requested navigation target
      }
      const record=this.screens.get(target)!;
      record.liveUrl='';record.liveTitle='';record.state='loading';record.message='';
      this.requestedUrl=url;
      await this.start(url);
      return this.transaction(async()=>{
        const settled=await this.waitScreen(target!);if(settled)await this.bringToFront();
        const done=this.screens.get(target!);
        return {url:done?.liveUrl||this.requestedUrl,title:done?.liveTitle||done?.title||'',settled};
      });
    }
    return this.transaction(async()=>{
      if(authority&&!this.contexts?.shellAuthorityCurrent(authority)){
        const record=target?this.screens.get(target):undefined;
        return {url:record?.liveUrl??'',title:record?.liveTitle??record?.title??'',settled:false};
      }
      if(!target)throw new Error('no canvas screen is active; open a workspace first');
      const record=this.screens.get(target);
      if(!record)throw new Error(`unknown screen: ${target}`);
      this.requestedUrl=new URL(url).href;
      const previous=this.contexts?.artifact(target);
      if(!previous)throw new Error('artifact navigation context is unavailable; retry after the frame becomes available');
      const navigation={previous,target:this.requestedUrl,sameDocumentVersion:this.contexts!.artifactSameDocumentVersion(target),responded:false,loaderId:undefined as string|undefined};
      this.pendingNavigations.set(target,navigation);record.url=this.requestedUrl;record.liveUrl='';record.liveTitle='';record.state='loading';record.message='';
      try{
        // One navigation primitive, with the loader returned by the requested
        // frame's CDP session. Metadata must never independently assign src.
        // The v1 shell chrome (setStatus/setPage) belongs to the ACTIVE
        // artboard; others get setScreenState (spec §C).
        await this.shellEvalSettled(target===this.activeScreenId
          ? `__dsCanvas.setStatus({state:'loading'});__dsCanvas.setPage({url:${JSON.stringify(this.requestedUrl)},pages:${JSON.stringify(this.pages)},navigate:false})`
          : `__dsCanvas.setScreenState(${JSON.stringify(target)},${JSON.stringify({state:'loading'})})`);
        if(authority&&!this.contexts?.shellAuthorityCurrent(authority))return {url:record.liveUrl,title:record.liveTitle||record.title,settled:false};
        const result=await this.requireCdp().send('Page.navigate',{url:this.requestedUrl,frameId:previous.frame},previous.session);
        navigation.loaderId=typeof result.loaderId==='string'?result.loaderId:undefined;navigation.responded=true;
        if(typeof result.errorText==='string'&&result.errorText){
          record.state='error';record.message='The preview navigation failed: '+result.errorText;
          await this.shellEvalSettled(`__dsCanvas.setScreenState(${JSON.stringify(target)},${JSON.stringify({state:'error',message:record.message})})`).catch(()=>undefined);
          if(target===this.activeScreenId)await this.shellEvalSettled(`__dsCanvas.setStatus({state:'error',message:${JSON.stringify(record.message)}})`).catch(()=>undefined);
          return {url:this.requestedUrl,title:'',settled:false};
        }
        const settled=await this.waitScreen(target);if(settled)await this.bringToFront();
        return {url:record.liveUrl||this.requestedUrl,title:record.liveTitle||record.title,settled};
      }finally{if(this.pendingNavigations.get(target)===navigation)this.pendingNavigations.delete(target);}
    });
  }

  /**
   * Ensure the live window exists, then navigate it to `url`. This is the one
   * entry the panel uses: a first call launches the window AT `url` (never
   * about:blank, which would spawn a second window), later calls reuse the
   * existing window and navigate it.
   * FORK-MERGE: main.ts is being re-sketched around openWorkspace(); `open`
   * keeps the legacy URL-only meaning (navigate the active/preview screen)
   * until P2 confirms the route no longer needs it.
   */
  async open(url: string): Promise<{ url: string; title: string; settled: boolean }> {
    return this.navigate(url);
  }

  /**
   * Go back/forward in the page's history and wait for the destination to
   * settle. Drives CDP's navigation history directly (a `history.back()` via
   * Runtime.evaluate races the destroyed execution context); a same-document
   * navigation fires no load event, so the settle wait is bounded. The screen
   * is optional (spec §B: undefined = active).
   */
  async goHistory(direction: 'back' | 'forward', screen?: string): Promise<{ url: string; title: string; settled: boolean }> {
    return this.transaction(async()=>{
      const target=screen??this.activeScreenId;
      if(!target)throw new Error('no canvas screen is active; open a workspace first');
      await this.evalIn(`history.${direction}();true`,false,target);await delay(200);
      const settled=await this.waitScreen(target);
      const record=this.screens.get(target);
      return {url:record?.liveUrl??'',title:record?.liveTitle??record?.title??'',settled};
    });
  }

  /**
   * Apply a batch of input events (already in screen CSS px). The screen is
   * optional (spec §B: undefined = active); events are dispatched through the
   * shell window, so each one is remapped through THAT artboard's scaled rect
   * (`ds-frame-<screen>`) to real compositor coordinates.
   */
  async input(events: SurfaceInputEvent[]): Promise<void>;
  async input(screen: string | undefined, events: SurfaceInputEvent[]): Promise<void>;
  async input(a: SurfaceInputEvent[] | string | undefined, b?: SurfaceInputEvent[]): Promise<void> {
    const events = Array.isArray(a) ? a : b ?? [];
    // FORK-MERGE (P1-browser seam 7): edit-mode artboards freeze native input
    // (decision 8). Input-heavy browser-control actions could temporarily
    // restore play around THIS dispatch and re-apply edit afterwards; shipped
    // semantics are left untouched — P2-D owns that decision.
    const requestedScreen = Array.isArray(a) ? undefined : a;
    return this.transaction(async()=>{
    const cdp = this.requireCdp();
    const session = this.requireSession();
    const screen = requestedScreen ?? this.activeScreenId;
    if (!screen || !SCREEN_ID_RE.test(screen)) throw new Error('no canvas screen is active; open a workspace first');

    for (const event of events) {
      await this.shellEval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',true);
      const rect=await this.shellEval(`(()=>{const f=document.getElementById('ds-frame-${screen}'),r=f.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,cssWidth:f.clientWidth,cssHeight:f.clientHeight}})()`) as {x:number;y:number;width:number;height:number;cssWidth:number;cssHeight:number};
      if(event.type==='pointer'&&event.action==='down'&&this.canvasFlags.menu){await this.shellEval('__dsCanvas.dismissMenu()');continue;}
      if(event.type==='pointer'&&(event.modifiers.ctrl||event.modifiers.meta)&&this.canvasFlags.pan){if(event.action==='up')await this.evalIn(`window.__dsPickAt(${event.x},${event.y})`,false,screen);continue;}
      if (event.type === 'pointer') {
        const type = event.action === 'down' ? 'mousePressed' : event.action === 'up' ? 'mouseReleased' : 'mouseMoved';
        await cdp.send(
          'Input.dispatchMouseEvent',
          {
            type,
            x: rect.x+event.x*rect.width/rect.cssWidth,
            y: rect.y+event.y*rect.height/rect.cssHeight,
            button: buttonName(event.button),
            buttons: event.buttons,
            clickCount: event.action === 'move' ? 0 : 1,
            modifiers: modifierBits(event.modifiers),
          },
          session,
        );
      } else if (event.type === 'wheel') {
        await cdp.send(
          'Input.dispatchMouseEvent',
          {
            type: 'mouseWheel',
            x: rect.x+event.x*rect.width/rect.cssWidth,
            y: rect.y+event.y*rect.height/rect.cssHeight,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            modifiers: modifierBits(event.modifiers),
          },
          session,
        );
      } else if (event.type === 'key') {
        await this.shellEval(`document.getElementById('ds-frame-${screen}').focus()`);
        await cdp.send(
          'Input.dispatchKeyEvent',
          {
            type: event.action === 'down' ? 'keyDown' : 'keyUp',
            key: event.key,
            code: event.code,
            modifiers: modifierBits(event.modifiers),
          },
          session,
        );
      } else {
        await this.shellEval(`document.getElementById('ds-frame-${screen}').focus()`);
        await cdp.send('Input.insertText', { text: event.text }, session);
      }
    }
    });
  }

  /** The emulated viewport size in CSS px. */
  viewport(): { width: number; height: number } {
    return { width: this.viewportWidth, height: this.viewportHeight };
  }

  /** Resize the emulated viewport. */
  async resize(width: number, height: number): Promise<{ width: number; height: number }> {
    if(![width,height].every(n=>Number.isInteger(n)&&n>=100&&n<=8192))throw new Error('artifact viewport must be integer dimensions from 100 to 8192');
    // An explicit size IS the layout intent: drop any pending setLayout request
    // so a later dirty pass cannot resurrect it over the agent's pin.
    this.requestedLayout=null;
    ++this.layoutGeneration;return this.transaction(()=>this.resizeArtifact(width,height));
  }
  private async resizeArtifact(width:number,height:number,authority?:ShellAuthority):Promise<{width:number;height:number}>{
    if(authority&&!this.contexts?.shellAuthorityCurrent(authority))return this.viewport();
    const supportsLayout=await this.shellEvalSettled("typeof __dsCanvas.setLayout==='function'");
    if(authority&&!this.contexts?.shellAuthorityCurrent(authority))return this.viewport();
    if(supportsLayout)await this.applyLayout({mode:'viewport',preset:'custom',nominalHeight:height},width,height,()=>!authority||!!this.contexts?.shellAuthorityCurrent(authority));
    else {await this.shellEvalSettled(`__dsCanvas.setViewport(${width},${height})`);this.layoutState={mode:'viewport',preset:'custom',nominalHeight:height};}
    if(authority&&!this.contexts?.shellAuthorityCurrent(authority))return this.viewport();
    this.viewportWidth = width;
    this.viewportHeight = height;
    return { width, height };
  }

  /**
   * The app window's geometry on screen, via the CDP Browser domain. These
   * requests go to the BROWSER endpoint (no page sessionId). `null` when not
   * started, or when Chrome does not answer (e.g. a dying child).
   */
  async windowBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const cdp = this.cdp;
    if (!cdp || !this.targetId) return null;
    try {
      const res = await cdp.send('Browser.getWindowForTarget', { targetId: this.targetId });
      const bounds = (res.bounds ?? {}) as { left?: unknown; top?: unknown; width?: unknown; height?: unknown };
      const x = Number(bounds.left);
      const y = Number(bounds.top);
      const width = Number(bounds.width);
      const height = Number(bounds.height);
      if (![x, y, width, height].every(Number.isFinite)) return null;
      return { x, y, width, height };
    } catch {
      return null;
    }
  }

  /**
   * Move/resize the app window. Coordinates are screen coordinates and may be
   * negative on macOS (a window above/left of the main display is legal — the
   * offscreen test window relies on it); only the size is floored at
   * MIN_WINDOW_EDGE. `windowState: 'normal'` so a minimized window cannot
   * silently swallow the move.
   */
  async placeWindow(x: number, y: number, width: number, height: number): Promise<void> {
    const cdp = this.requireCdp();
    if (!this.targetId) throw new Error('browser has no page target');
    const res = await cdp.send('Browser.getWindowForTarget', { targetId: this.targetId });
    const windowId = res.windowId;
    if (typeof windowId !== 'number' || windowId < 0) throw new Error('no window for the page target');
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        left: Math.round(x),
        top: Math.round(y),
        width: Math.max(MIN_WINDOW_EDGE, Math.round(width)),
        height: Math.max(MIN_WINDOW_EDGE, Math.round(height)),
        windowState: 'normal',
      },
    });
  }

  /**
   * How many `page` targets Chrome currently reports. Test hook for target
   * acquisition: the `--app` window is REUSED, so the count must stay 1 — a
   * blind createTarget would show up as 2 (a second window).
   */
  async pageTargetCount(): Promise<number> {
    const cdp = this.cdp;
    if (!cdp) return 0;
    const res = await cdp.send('Target.getTargets');
    const infos = Array.isArray(res.targetInfos) ? (res.targetInfos as Array<{ type?: unknown }>) : [];
    return infos.filter((info) => info.type === 'page').length;
  }

  /**
   * The DevTools HTTP `/json/list` targets, for diagnostics and tests. The
   * chromeless regression test reads this same source to prove no
   * `chrome://omnibox-popup` target (i.e. no address bar) exists. Empty when no
   * window is up or the endpoint is unreachable.
   */
  async jsonList(): Promise<Array<{ id?: string; type?: string; url?: string; webSocketDebuggerUrl?: string }>> {
    if (this.debuggingPort === null) return [];
    try {
      const res = await fetch(`http://127.0.0.1:${this.debuggingPort}/json/list`);
      return (await res.json()) as Array<{ id?: string; type?: string; url?: string; webSocketDebuggerUrl?: string }>;
    } catch {
      return [];
    }
  }

  /** The throwaway profile dir while a window is up, else null. Inspection/test seam. */
  profilePath(): string | null {
    return this.profileDir;
  }

  /**
   * Public seam for `POST /focus`: raise the live window (see bringToFront)
   * without navigating or reloading the page. Best effort — a request with no
   * window up is a no-op.
   */
  async focus(): Promise<void> {
    await this.bringToFront();
  }

  /**
   * Briefly re-flash the element matching `selector` in one artboard (the
   * panel drives this while the user hovers a reference row). Runs the injected
   * `window.__dsHighlight`, which reuses the pick outline in a distinct accent
   * and hides it after ~900ms. Returns false — never throws for a page-level
   * miss — when no window is open, the selector is invalid, or nothing matches.
   * Accepts the v1 single-selector form or spec §D's (screen, selector).
   */
  async highlight(selector: string): Promise<boolean>;
  async highlight(screen: string | undefined, selector: string): Promise<boolean>;
  async highlight(a: string | undefined, b?: string): Promise<boolean> {
    const screen = b === undefined ? undefined : a;
    const selector = b ?? a;
    if (!this.cdp) return false;
    const expression = `(typeof window.__dsHighlight === 'function') ? window.__dsHighlight(${JSON.stringify(
      selector,
    )}) : false`;
    const value = await this.evaluate(expression, screen);
    return value === true;
  }

  /**
   * Raise the live window so the user can see it. macOS keeps the Chrome bundle
   * already running as an application, so a freshly launched app window lands
   * behind the OpenChamber window (or on another Space) and looks like "nothing
   * opened". Activating the target and asking the page to come to the front is
   * what actually surfaces it; also restores a minimized window. Best effort —
   * the window still exists even if the OS refuses focus.
   */
  private async bringToFront(): Promise<void> {
    const cdp = this.cdp;
    if (!cdp) return;
    try {
      if (this.targetId) await cdp.send('Target.activateTarget', { targetId: this.targetId });
      await cdp.send('Page.bringToFront', {}, this.sessionId ?? undefined);
    } catch {
      /* best effort */
    }
    await this.ensureWindowNotMinimized();
  }

  /**
   * A minimized window stops compositing and cannot be captured reliably. A
   * navigate means someone is about to look at the page, so restore a
   * minimized window; maximized/fullscreen stay as the user left them. Best
   * effort — must never fail the navigation.
   */
  private async ensureWindowNotMinimized(): Promise<void> {
    const cdp = this.cdp;
    if (!cdp || !this.targetId) return;
    try {
      const res = await cdp.send('Browser.getWindowForTarget', { targetId: this.targetId });
      const bounds = (res.bounds ?? {}) as { windowState?: unknown };
      if (bounds.windowState === 'minimized') {
        await cdp.send('Browser.setWindowBounds', { windowId: res.windowId, bounds: { windowState: 'normal' } });
      }
    } catch {
      /* best effort */
    }
  }

  /**
   * PNG of one artboard (spec §B capture(screen?); undefined = active). The
   * camera-normalizing shell transaction runs with the optional screen id so
   * the shell frames THAT artboard; geometry checks only bind the active
   * screen because the per-screen layout machinery is active-only in v1.
   */
  async capture(requestedScreen?: string): Promise<{ png: Buffer; width: number; height: number }> {
    return this.transaction(async()=>{
    const cdp = this.requireCdp();
    const session = this.requireSession();
    const screen = requestedScreen ?? this.activeScreenId;
    if (!screen) throw new Error('no canvas screen is active; open a workspace first');
    const token=await this.shellEvalSettled(`__dsCanvas.beginCapture(${requestedScreen!==undefined?JSON.stringify(requestedScreen):''})`);
    this.captureInFlight=true;
    let overrideApplied=false;
    try{
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:Math.max(1000,this.viewportWidth+48),height:this.viewportHeight+256,deviceScaleFactor:1,mobile:false},session);
    overrideApplied=true;
    const bounds=await this.shellEvalSettled(`__dsCanvas.normalizeCapture(${JSON.stringify(token)})`,4000,true) as {x:number;y:number;width:number;height:number};
    const isActive=screen===this.activeScreenId;
    if(isActive&&(bounds.width!==this.viewportWidth||bounds.height!==this.viewportHeight))throw new Error('Canvas capture geometry did not match the artifact viewport');
    const result = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', fromSurface: true, captureBeyondViewport: true,clip:{...bounds,scale:1} },
      session,
    );
    const data = typeof result.data === 'string' ? result.data : '';
    return {
      png: Buffer.from(data, 'base64'),
      width: isActive ? this.viewportWidth : bounds.width,
      height: isActive ? this.viewportHeight : bounds.height,
    };
    }finally{
      // The override must end CLEARED on every path, including when the SET
      // itself failed. A bare clear after a rejected set leaves Chromium's
      // input routing into the frames dead (native clicks stop landing), so a
      // failed SET is repaired with a full set-then-clear cycle — and the
      // renderer transaction ends FIRST, because the shell's capture guard
      // swallows geometry ramps (its repaint would otherwise pin the camera
      // at the emulated width instead of the window's).
      if(!overrideApplied){
        try{await this.shellEvalSettled(`__dsCanvas.endCapture(${JSON.stringify(token)})`);}
        finally{
          try{await cdp.send('Emulation.setDeviceMetricsOverride',{width:Math.max(1000,this.viewportWidth+48),height:this.viewportHeight+256,deviceScaleFactor:1,mobile:false},session);}
          catch{/* still attempt the clear below */}
          try{await cdp.send('Emulation.clearDeviceMetricsOverride',{},session);}catch{/* best effort */}
          // The shell's resize observer repaints asynchronously after the
          // emulation cycle; wait for the camera transform to stop moving so
          // the canvas is AT REST when capture() rejects (a native click
          // dispatched immediately after must land, never race the settle).
          let prior='';let stable=0;
          for(let attempt=0;attempt<20&&stable<2;attempt+=1){
            const current=await this.shellEval("document.getElementById('camera').style.cssText").catch(()=>'');
            if(current===prior)stable+=1;else{stable=0;prior=String(current);}
            if(stable<2)await delay(30);
          }
          this.captureInFlight=false;
        }
      }else{
        try{await cdp.send('Emulation.clearDeviceMetricsOverride',{},session);}
        finally{try{await this.shellEvalSettled(`__dsCanvas.endCapture(${JSON.stringify(token)})`);}finally{this.captureInFlight=false;}}
      }
    }
    });
  }

  /**
   * Print one screen URL to PDF in a hidden throwaway page target in the SAME
   * Chrome (spec D3). Never mutates canvas state. Runs inside the operation
   * transaction, so it serializes against captures/navigations; the injection
   * world (bindings/scripts/setAutoAttach) deliberately does NOT exist on the
   * throwaway session.
   *
   * The binding, EXACT call sequence (D3 steps 1–8): validate → createTarget →
   * attach flattened → park off-screen BEFORE content → Page.enable + one-shot
   * session-filtered load waiter (15 s, non-fatal) → navigate → fonts/stable
   * freeze → printToPDF at the screen's physical size → finally closeTarget +
   * listener cleanup. `Page.printToPDF` prints the top-level page of ITS
   * session; the canvas shell prints the camera grid, so the screen URL loads
   * top-level here (paperWidth/Height = natural px / 96 in).
   */
  async printScreenToPdf(url: string, widthPx: number, heightPx: number): Promise<Buffer> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('canvas pdf export requires an http(s) URL without credentials');
    }
    if (!isWebSafeUrl(url) || parsed.username || parsed.password) {
      throw new Error('canvas pdf export requires an http(s) URL without credentials');
    }
    if (![widthPx, heightPx].every((n) => Number.isFinite(n) && Number.isInteger(n) && n >= 200 && n <= 8192)) {
      throw new Error('canvas pdf export requires screen sizes from 200 to 8192');
    }
    return this.transaction(async () => {
      const cdp = this.requireCdp();
      let targetId = '';
      let sessionId = '';
      try {
        // 2+3. A fresh page target, attached flattened (the hand-rolled CdpClient
        // already addresses any flattened session by id).
        const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
        targetId = String(created.targetId ?? '');
        const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        sessionId = String(attached.sessionId ?? '');
        // 4. Park it off-screen BEFORE any content exists (D14: no visible flash).
        const windowRes = await cdp.send('Browser.getWindowForTarget', { targetId });
        await cdp.send('Browser.setWindowBounds', {
          windowId: windowRes.windowId,
          bounds: { left: -32000, top: -32000, width: 1200, height: 900, windowState: 'normal' },
        });
        // 5. No Runtime.addBinding, no addScriptToEvaluateOnNewDocument, no
        // Target.setAutoAttach on this session — the pick/probe world must not
        // exist here. The load waiter matches ONLY this flattened session.
        await cdp.send('Page.enable', {}, sessionId);
        const loaded = onceInSession(cdp, 'Page.loadEventFired', sessionId, 15_000);
        // 6. Navigate top-level; a slow document simply times the waiter out
        // (non-fatal) and is frozen where it is.
        await cdp.send('Page.navigate', { url }, sessionId);
        await loaded;
        await cdp.send('Runtime.evaluate', { expression: PRINT_FREEZE, awaitPromise: true, returnByValue: true }, sessionId);
        // 7. Page.printToPDF prints the top-level page of this session. Paper is
        // the screen's NATURAL size at 96 dpi; a screen taller than the page
        // paginates at the same size (documented: overflow is a gate finding,
        // not an export concern). The 30 s CdpClient timeout caps this per
        // screen — a timeout becomes a per-screen {ok:false}, never job death.
        const result = await cdp.send(
          'Page.printToPDF',
          {
            printBackground: true,
            preferCSSPageSize: false,
            scale: 1,
            paperWidth: widthPx / 96,
            paperHeight: heightPx / 96,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
          },
          sessionId,
        );
        const data = typeof result.data === 'string' ? result.data : '';
        return Buffer.from(data, 'base64');
      } finally {
        // 8. Always close the throwaway target — including every failure path
        // (R7 pin: a mid-print throw still ends with pageTargetCount()===1).
        // onceInSession self-removes once it fires or times out.
        try {
          await cdp.send('Target.closeTarget', { targetId });
        } catch {
          /* the target was already gone; R7's invariant is still satisfied */
        }
      }
    });
  }

  /** Evaluate an expression in a screen's document (default: the active one). */
  async evaluate(expression: string, screen?: string): Promise<unknown> {
    return this.evalIn(expression, false, screen);
  }

  private async evalIn(expression: string, awaitPromise: boolean, screen?: string): Promise<unknown> {
    // A world destroyed between context resolution and send is the same
    // navigation storm as on the shell side: re-discover once (cheap, the
    // frame tree is cached in CDP) and retry before surfacing the error.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const context=this.contexts?.artifact(screen);
      if(!context||!this.contexts)throw new Error('artifact context is unavailable; check embedding permissions and retry');
      try {
        return await this.contexts.evaluate(context,expression,awaitPromise);
      } catch (error) {
        const message=error instanceof Error?error.message:String(error);
        if(attempt===0&&/uniqueContextId not found|execution context|authority was revoked/i.test(message)){
          await this.contexts.discover().catch(()=>undefined);
          await delay(80);
          continue;
        }
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  /**
   * The in-page probe report. Returns a null-safe default when the probe is
   * absent (e.g. before any navigation on `about:blank`). Zero-arg = active
   * screen, which keeps verify.ts's call sites unchanged (decision 11).
   */
  async getProbe(screen?: string): Promise<ProbeReport> {
    const value = await this.evaluate(PROBE_EXPR, screen);
    if (typeof value !== 'string' || value.length === 0) return emptyProbeReport();
    try {
      const parsed = JSON.parse(value) as Partial<ProbeReport>;
      return {
        scrollWidth: Number(parsed.scrollWidth ?? 0),
        clientWidth: Number(parsed.clientWidth ?? 0),
        innerWidth: Number(parsed.innerWidth ?? 0),
        innerHeight: Number(parsed.innerHeight ?? 0),
        scrollHeight: Number(parsed.scrollHeight ?? 0),
        cls: Number(parsed.cls ?? 0),
        selectors: Array.isArray(parsed.selectors) ? parsed.selectors : [],
      };
    } catch {
      return emptyProbeReport();
    }
  }

  /**
   * Freeze the page for deterministic capture: prefer-reduced-motion, a style
   * that kills animation/transition and the caret, plus a blur and finished
   * animations. Call before `waitForStable()` / `capture()`.
   */
  async applyStableMode(): Promise<void> {
    const cdp = this.requireCdp();
    const session = this.contexts?.artifact()?.session;
    if(!session)throw new Error('artifact context is unavailable');
    await cdp.send(
      'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] },
      session,
    );
    // There is no CDP `Page.addStyleTag` (that is a Puppeteer helper); inject the
    // freeze stylesheet straight into the document instead.
    await this.evaluate(
      `(function () {
        var style = document.createElement('style');
        style.textContent = ${JSON.stringify(STABLE_STYLE)};
        (document.head || document.documentElement).appendChild(style);
        return true;
      })()`,
    );
    await this.evaluate(
      'document.activeElement && document.activeElement.blur(); document.getAnimations().forEach(a=>{try{a.finish()}catch(e){}})',
    );
  }

  /**
   * Wait until two consecutive PNG captures are byte-identical. Waits for fonts,
   * lets two animation frames pass, then polls `capture()` every `intervalMs`
   * (default 120) up to `timeoutMs` (default 3000). Returns whether it settled.
   */
  async waitForStable(opts?: { timeoutMs?: number; intervalMs?: number }): Promise<boolean> {
    const timeoutMs = opts?.timeoutMs ?? 3000;
    const intervalMs = opts?.intervalMs ?? 120;
    await this.evalIn(
      'document.fonts && document.fonts.ready ? document.fonts.ready.then(function () { return true; }) : true',
      true,
    );
    await this.evalIn(
      'new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(true); }); }); })',
      true,
    );

    const deadline = Date.now() + timeoutMs;
    let previous = (await this.capture()).png;
    while (Date.now() < deadline) {
      await delay(intervalMs);
      const next = (await this.capture()).png;
      if (previous.equals(next)) return true;
      previous = next;
    }
    return false;
  }

  /** No live frames any more; kept for browser-control's scroll sizing helper. */
  latestFrame(): BrowserFrame | null {
    return null;
  }

  /**
   * The live BrowserState: refreshes the ACTIVE artboard's URL/title from the
   * real document, then returns the synchronous getState() superset (spec §B
   * extends BrowserState with mode/screens/activeScreen/dir).
   */
  async state(): Promise<BrowserState> {
    if (this.cdp) {
      try {
        const info = await this.pageInfo(this.cdp, this.requireSession());
        const record = this.activeScreenId ? this.screens.get(this.activeScreenId) : undefined;
        if (record && isWebSafeUrl(info.url)) {
          record.liveUrl = info.url;
          record.liveTitle = info.title;
        }
      } catch {
        // The CDP socket dies together with the Chrome child (windowOpen false);
        // /state must keep answering so the UI can show the closed notice.
      }
    }
    return this.getState();
  }

  /**
   * Close the live window and QUIT Chrome, removing the throwaway profile.
   *
   * This is what `POST /close` (Design Mode going OFF) calls, and it is the same
   * teardown the user's own window close triggers. After it resolves,
   * `state().windowOpen` is false and a later `start()`/`open()` relaunches a
   * fresh window with a new profile.
   */
  async close(): Promise<void> {
    if (this.chrome === null && this.cdp === null) {
      this.closedAt = Date.now();
      return;
    }
    this.closedAt = Date.now();
    await this.quit();
  }

  /** Run the teardown once; concurrent callers (close, stop, target events) join it. */
  private quit(): Promise<void> {
    if (!this.quitPromise) {
      this.quitting = true;
      this.quitPromise = this.doQuit().catch(() => {
        /* teardown is best effort; state() already reports the window closed */
      });
    }
    return this.quitPromise;
  }

  /**
   * The actual shutdown: destroy the page target (as closing the window does),
   * ask the BROWSER endpoint to `Browser.close` (a clean quit that also takes
   * down the `--no-startup-window` background process macOS would otherwise
   * leave), escalate to SIGTERM/SIGKILL on the child as a fallback, then remove
   * the temp profile.
   */
  private async doQuit(): Promise<void> {
    const cdp = this.cdp;
    if (cdp) {
      if (this.targetId) {
        try {
          await cdp.send('Target.closeTarget', { targetId: this.targetId });
        } catch {
          /* target already gone (the user closed the window first) */
        }
      }
      try {
        await cdp.send('Browser.close');
      } catch {
        /* the socket can die the moment Chrome quits */
      }
      cdp.close();
      this.cdp = null;
      this.sessionId = null;
      this.targetId = null;
    }

    const chrome = this.chrome;
    if (chrome) {
      // `Browser.close` usually ends the child; give it a moment before forcing.
      await this.waitForExit(chrome, 1500);
      if (chrome.exitCode === null) {
        try {
          chrome.kill('SIGTERM');
        } catch {
          /* already gone */
        }
        await this.waitForExit(chrome, 3000);
      }
      if (chrome.exitCode === null) {
        try {
          chrome.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        await this.waitForExit(chrome, 2000);
      }
      this.chrome = null;
    }

    await this.reapProfile();
    this.contexts?.close();this.contexts=null;
    await this.viewer?.close();this.viewer=null;
  }

  /** Resolve once the child has exited or `timeoutMs` elapses. */
  private waitForExit(chrome: ChildProcess, timeoutMs: number): Promise<void> {
    if (chrome.exitCode !== null || chrome.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        chrome.removeListener('exit', finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      chrome.once('exit', finish);
    });
  }

  /** Remove the throwaway profile dir, once Chrome has released it. */
  private async reapProfile(): Promise<void> {
    const profile = this.profileDir;
    if (!profile) return;
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {
      /* best effort */
    });
    if (this.profileDir === profile) this.profileDir = null;
    this.debuggingPort = null;
  }

  /**
   * Detach from the live window and — by default — kill the Chrome child.
   *
   * `kill: false` is the service's DELIBERATE lifetime choice (see
   * surface.stopBrowser): the detached window belongs to the user and must
   * outlive the service, so the service never kills it on shutdown. With
   * `kill: false` the throwaway profile is intentionally left behind, because
   * the surviving Chrome still owns it; the OS temp reaper reclaims it.
   */
  async stop(opts: { kill?: boolean } = {}): Promise<void> {
    const kill = opts.kill ?? true;
    if(kill&&!this.quitPromise&&(this.chrome||this.cdp)){await this.close();}
    this.contexts?.close();this.contexts=null;
    await this.viewer?.close();this.viewer=null;
    // Join an in-flight window-close teardown so a relaunch never races it.
    if (this.quitPromise) {
      await this.quitPromise;
      this.quitPromise = null;
      this.quitting = false;
    }
    if (this.cdp) {
      this.cdp.close();
      this.cdp = null;
    }
    if (this.chrome) {
      if (kill) {
        try {
          this.chrome.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
      this.chrome = null;
    }
    if (this.profileDir) {
      if (kill) {
        await fs.rm(this.profileDir, { recursive: true, force: true }).catch(() => {
          /* best effort */
        });
      }
      this.profileDir = null;
    }
    this.sessionId = null;
    this.targetId = null;
    this.starting = null;
    this.launchUrl = null;
    this.debuggingPort = null;
    // A fresh (re)launch must not inherit the previous window's closed flag.
    this.closedAt = null;
    this.quitting = false;
    this.quitPromise = null;
  }
}
