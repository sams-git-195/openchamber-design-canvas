// R2 (B4): a click SELECTS; referencing is the explicit "Reference in chat"
// send (toolbar button, floating pill, Enter). The send PULLS the payloads
// through CDP evaluate, so the pick queue only ever carries explicit sends —
// one batch id per send, the window's workspace dir on every entry.
//
// Hermetic pins drive the shell controller (tests/helpers/controller-env.ts)
// and a window-less Browser with stubbed privates; the live pins run the real
// in-frame script in Chrome (skipped without it, loud under DS_REQUIRE_CHROME).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inflateSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Browser, SELECTION_TOTAL_MAX } from '../service/browser.ts';
import type { PickedElement } from '../service/browser.ts';
import { PickQueue, PICK_UNACKED_WARN_MS, pickUnackedWarnMs } from '../service/pick-queue.ts';
import { liveTest } from './helpers/chrome.ts';
import { environment, toolbarSource } from './helpers/controller-env.ts';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- hermetic service harness ------------------------------------------------

type Stub = {
  browser: Browser;
  internal: any;
  shellCalls: string[];
  evalCalls: Array<{ expr: string; screen?: string }>;
  command: (value: unknown) => Promise<void>;
};

const picked = (selector: string): PickedElement & { additive: boolean; scrollX: number; scrollY: number } => ({
  selector,
  tag: 'button',
  classes: '',
  text: selector,
  outerHTML: `<button id="${selector.slice(1)}">x</button>`,
  styles: { color: 'rgb(0, 0, 0)' },
  rect: { x: 40, y: 40, width: 120, height: 40 },
  additive: false,
  scrollX: 0,
  scrollY: 12,
});

type Hooks = {
  /** Screens whose __dsSelectionTake throws a non-retryable error. */
  failTake: Set<string>;
  /** Screens whose take answers nothing usable (the elements went away). */
  emptyTake: Set<string>;
  /** Delay of every __dsSelectAt evaluate (ms), to open the click/send race. */
  selectDelay: number;
};

const SCREENS = [
  { id: 'home', url: 'http://localhost:9/home.html', file: 'home.html', title: 'Home', width: 1280, height: 800 },
  { id: 'phone', url: 'http://localhost:9/phone.html', file: 'phone.html', title: 'Phone', width: 390, height: 844 },
];

/** A Browser with a fake window: frames answer __dsSelectAt from a per-screen
 *  model (10 per frame, the full flag refuses adds), __dsSelectionTake(limit)
 *  takes the first `limit` and answers what is left. */
function stub(dir: string | null = '/ws/demo', screens = SCREENS): Stub & { frames: Map<string, string[]>; hooks: Hooks; toasts: Array<{ kind: string; text: string }> } {
  const browser = new Browser();
  const internal = browser as any;
  const shellCalls: string[] = [];
  const evalCalls: Array<{ expr: string; screen?: string }> = [];
  const frames = new Map<string, string[]>();
  const toasts: Array<{ kind: string; text: string }> = [];
  const hooks: Hooks = { failTake: new Set(), emptyTake: new Set(), selectDelay: 0 };
  internal.cdp = { send: async () => ({}), on: () => () => undefined };
  internal.sessionId = 'fake-shell-session';
  internal.targetId = 'fake-target';
  internal.contexts = { shellAuthorityCurrent: () => true, shell: () => null, artifact: () => null, activeScreenId: null };
  internal.shellEvalSettled = async (expr: string) => { shellCalls.push(expr); return true; };
  internal.shellEval = async (expr: string) => { shellCalls.push(expr); return true; };
  internal.pushToast = async (kind: string, text: string) => { toasts.push({ kind, text }); return true; };
  internal.refreshScreen = async () => {};
  internal.evalIn = async (expr: string, _await: boolean, screen?: string) => {
    evalCalls.push({ expr, screen });
    const id = screen ?? 'home';
    const list = frames.get(id) ?? [];
    const at = /__dsSelectAt\((\d+),(\d+),(true|false)(,true)?\)/.exec(expr);
    if (at) {
      if (hooks.selectDelay) await pause(hooks.selectDelay);
      const current = frames.get(id) ?? [];
      const selector = `#e${at[1]}`;
      if (at[3] === 'true') {
        const i = current.indexOf(selector);
        if (i >= 0) current.splice(i, 1);
        else if (at[4]) return { ok: true, count: current.length, label: current.at(-1) ?? '', full: true };
        else { if (current.length >= 10) current.shift(); current.push(selector); }
        frames.set(id, current);
      } else frames.set(id, [selector]);
      const now = frames.get(id)!;
      return { ok: true, count: now.length, label: now.at(-1) ?? '' };
    }
    if (expr.includes('__dsSelectionTake')) {
      if (hooks.failTake.has(id)) throw new Error('boom: frame unreachable');
      const limit = Number(/__dsSelectionTake\((\d+)\)/.exec(expr)?.[1] ?? list.length);
      const taken = hooks.emptyTake.has(id) ? [] : list.slice(0, limit);
      const rest = hooks.emptyTake.has(id) ? [] : list.slice(limit);
      frames.set(id, rest);
      return { items: taken.map((selector, i) => ({ ...picked(selector), additive: i > 0 })), count: rest.length, label: rest.at(-1) ?? '' };
    }
    if (expr.includes('__dsSelectionClear')) { frames.set(id, []); return { count: 0 }; }
    if (expr.includes('__dsSelectionState')) return { ok: true, count: list.length, label: list.at(-1) ?? '' };
    return true;
  };
  internal.workspaceMode = true;
  internal.workspaceDir = dir;
  internal.applyScreenRegistry(screens);
  const canvasCommand = internal.canvasCommand.bind(browser) as (c: unknown, a: unknown) => Promise<void>;
  return { browser, internal, shellCalls, evalCalls, frames, hooks, toasts, command: (value) => canvasCommand(value, {}) };
}

/** Wait for the ordered select relay to settle. */
async function settled(s: Stub): Promise<void> {
  for (let i = 0; i < 50 && s.internal.selectRunning; i += 1) await pause(5);
  await pause(5);
}

const lastSelectionPush = (s: Stub) => {
  const call = [...s.shellCalls].reverse().find((c) => c.includes('__dsCanvas.setSelection('));
  assert.ok(call, 'the shell received a setSelection push');
  return JSON.parse(call.slice(call.indexOf('__dsCanvas.setSelection(') + '__dsCanvas.setSelection('.length, -1)) as { count: number; screens: Array<{ id: string; count: number }>; screen?: string; label: string; notice?: string };
};

test('b4-click-selects-without-queueing', async () => {
  // Shell: a plain edit-mode click emits screen-pick (with clickAt) and NO send.
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  e.api.restoreCamera({ mode: 'manual', scale: 1, panX: 0, panY: 0 });
  const section = e.sectionOf('home');
  section.rect = { x: 0, y: 0, left: 0, top: 0, width: 1280, height: 800 };
  e.fire('canvas', 'pointerdown', { button: 0, clientX: 100, clientY: 60, pointerId: 1, target: section, preventDefault() {} });
  e.fire('canvas', 'pointerup', { pointerId: 1, clientX: 100, clientY: 60 });
  const pick = e.commands.find((c) => c.type === 'screen-pick');
  assert.deepEqual({ ...pick, clickAt: typeof pick.clickAt }, { type: 'screen-pick', screen: 'home', x: 100, y: 60, clickAt: 'number' });
  assert.equal(e.commands.some((c) => c.type === 'selection-send'), false, 'the click alone references nothing');

  // Service: the click selects in the frame and mirrors the count; the queue stays empty.
  const s = stub();
  await s.command({ type: 'screen-pick', screen: 'home', x: 100, y: 60, clickAt: Date.now() });
  await settled(s);
  assert.ok(s.evalCalls.some((c) => c.screen === 'home' && c.expr.includes('__dsSelectAt(100,60,false)')));
  assert.equal((await s.browser.getPicks(0, 0)).picks.length, 0, 'nothing queued');
  assert.equal(s.browser.getState().pickSeq, 0, 'lastPick/pickSeq untouched by a select');
  assert.deepEqual(s.browser.getState().selection, { count: 1, screens: [{ id: 'home', count: 1 }] });
  const push = lastSelectionPush(s);
  assert.equal(push.count, 1);
  assert.equal(push.screen, 'home');
  assert.equal(push.label, '#e100');
});

test('b4-shift-click-toggles-multi-select', async () => {
  const s = stub();
  await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
  await s.command({ type: 'screen-pick', screen: 'home', x: 2, y: 2, additive: true });
  await s.command({ type: 'screen-pick', screen: 'phone', x: 3, y: 3, additive: true });
  await settled(s);
  assert.deepEqual(s.browser.getState().selection, { count: 3, screens: [{ id: 'home', count: 2 }, { id: 'phone', count: 1 }] }, 'shift adds across artboards');
  await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1, additive: true });
  await settled(s);
  assert.deepEqual(s.browser.getState().selection, { count: 2, screens: [{ id: 'home', count: 1 }, { id: 'phone', count: 1 }] }, 'shift on a selected element toggles it out');
  // A plain click is single-select across the canvas: the other artboard clears.
  await s.command({ type: 'screen-pick', screen: 'phone', x: 9, y: 9 });
  await settled(s);
  assert.deepEqual(s.browser.getState().selection, { count: 1, screens: [{ id: 'phone', count: 1 }] });
  assert.ok(s.evalCalls.some((c) => c.screen === 'home' && c.expr.includes('__dsSelectionClear')), 'home was told to clear');
  // Shell: shift marks the screen-pick additive.
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  e.api.restoreCamera({ mode: 'manual', scale: 1, panX: 0, panY: 0 });
  const section = e.sectionOf('home');
  section.rect = { x: 0, y: 0, left: 0, top: 0, width: 1280, height: 800 };
  e.fire('canvas', 'pointerdown', { button: 0, clientX: 50, clientY: 50, pointerId: 1, target: section, preventDefault() {} });
  e.fire('canvas', 'pointerup', { pointerId: 1, clientX: 50, clientY: 50, shiftKey: true });
  assert.equal(e.commands.find((c) => c.type === 'screen-pick')?.additive, true);
});

test('b4-selection-send-queues-in-seq-order-with-batch', async () => {
  const s = stub('/ws/demo');
  await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1, clickAt: Date.now() });
  await s.command({ type: 'screen-pick', screen: 'home', x: 2, y: 2, additive: true });
  await s.command({ type: 'screen-pick', screen: 'phone', x: 3, y: 3, additive: true });
  await s.command({ type: 'selection-send', sentAt: Date.now() });
  const page = await s.browser.getPicks(0, 0);
  assert.deepEqual(page.picks.map((p) => [p.screen, p.selector]), [['home', '#e1'], ['home', '#e2'], ['phone', '#e3']], 'selection order');
  assert.deepEqual(page.picks.map((p) => p.seq), [1, 2, 3], 'seq ordered');
  assert.equal(new Set(page.picks.map((p) => p.batch)).size, 1, 'one batch id per send');
  assert.match(String(page.picks[0]!.batch), /^b[0-9a-z]+-[0-9a-z]+$/);
  assert.deepEqual(page.picks.map((p) => p.dir), ['/ws/demo', '/ws/demo', '/ws/demo'], 'the window workspace dir rides every entry');
  assert.deepEqual(page.picks.map((p) => p.additive), [false, true, true]);
  for (const p of page.picks) {
    assert.equal(p.kind, 'element');
    assert.deepEqual(Object.keys(p).filter((k) => ['selector', 'tag', 'classes', 'text', 'outerHTML', 'styles', 'rect'].includes(k)).sort(), ['classes', 'outerHTML', 'rect', 'selector', 'styles', 'tag', 'text'], 'the element shape is unchanged');
  }
  assert.equal(s.browser.getState().pickSeq, 3, 'pickSeq moves at send time');
  assert.equal(s.browser.pick()?.selector, '#e3');
  assert.equal(s.browser.pick()?.screen, 'phone');
  assert.deepEqual(s.browser.getState().selection, { count: 0, screens: [] }, 'the send clears the selection');
  assert.equal(lastSelectionPush(s).count, 0);
  // A second send with nothing selected queues nothing; a new send gets a new batch.
  await s.command({ type: 'selection-send' });
  assert.equal((await s.browser.getPicks(3, 0)).picks.length, 0);
  await s.command({ type: 'screen-pick', screen: 'home', x: 4, y: 4 });
  await s.command({ type: 'selection-send' });
  const next = await s.browser.getPicks(3, 0);
  assert.equal(next.picks.length, 1);
  assert.notEqual(next.picks[0]!.batch, page.picks[0]!.batch);
  // The ack closes the timing line.
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
  try { s.browser.ackPicks(next.seq, 'Button'); } finally { console.log = original; }
  assert.ok(logs.some((line) => /pick timing click→selected (\d+ms|—) · send→queued \d+ms · queued→acked \d+ms/.test(line)), `timing line logged: ${logs.join(' | ')}`);
});

test('b4-escape-and-background-click-clear', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  e.api.restoreCamera({ mode: 'manual', scale: 1, panX: 0, panY: 0 });
  const canvas = e.$('canvas');
  const select = () => assert.equal(e.api.setSelection({ count: 1, screens: [{ id: 'home', count: 1 }], screen: 'home', label: 'button#b' }), true);
  select();
  assert.equal(e.bridge.getSnapshot().selectionCount, 1);
  canvas.focus();
  e.fire('document', 'keydown', { key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  assert.deepEqual(e.commands.at(-1), { type: 'selection-clear' });
  assert.equal(e.bridge.getSnapshot().selectionCount, 0, 'Esc clears at once');
  assert.equal(e.$('announcement').textContent, 'Nothing selected');
  // A background click (no artboard, no drag) clears too.
  select();
  e.fire('canvas', 'pointerdown', { button: 0, clientX: 5, clientY: 5, pointerId: 2, target: canvas, preventDefault() {} });
  e.fire('canvas', 'pointerup', { pointerId: 2, clientX: 5, clientY: 5 });
  assert.deepEqual(e.commands.at(-1), { type: 'selection-clear' });
  assert.equal(e.bridge.getSnapshot().selectionCount, 0);
  // A background DRAG pans and keeps the selection.
  select();
  const before = e.commands.length;
  e.fire('canvas', 'pointerdown', { button: 0, clientX: 5, clientY: 5, pointerId: 3, target: canvas, preventDefault() {} });
  e.fire('canvas', 'pointermove', { clientX: 60, clientY: 5 });
  e.fire('canvas', 'pointerup', { pointerId: 3, clientX: 60, clientY: 5 });
  assert.equal(e.commands.slice(before).some((c) => c.type === 'selection-clear'), false, 'a drag never clears');
  assert.equal(e.bridge.getSnapshot().selectionCount, 1);
  // Enter (and Ctrl/Cmd+Enter) references.
  canvas.focus();
  e.fire('document', 'keydown', { key: 'Enter', ctrlKey: true, preventDefault() {}, stopImmediatePropagation() {} });
  const sent = e.commands.at(-1);
  assert.equal(sent.type, 'selection-send');
  assert.equal(typeof sent.sentAt, 'number');
  assert.equal(e.bridge.getSnapshot().selectionCount, 0, 'the shell drops the selection once it is sent');
  // Nothing selected: Enter / Esc send nothing.
  const quiet = e.commands.length;
  e.fire('document', 'keydown', { key: 'Enter', preventDefault() {}, stopImmediatePropagation() {} });
  e.fire('document', 'keydown', { key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(e.commands.length, quiet);

  // Service: selection-clear clears every selected frame and pushes zero.
  return (async () => {
    const s = stub();
    await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
    await s.command({ type: 'screen-pick', screen: 'phone', x: 2, y: 2, additive: true });
    await settled(s);
    await s.command({ type: 'selection-clear' });
    assert.deepEqual(s.browser.getState().selection, { count: 0, screens: [] });
    assert.ok(['home', 'phone'].every((id) => s.evalCalls.some((c) => c.screen === id && c.expr.includes('__dsSelectionClear'))));
    assert.equal(lastSelectionPush(s).count, 0);
    assert.equal((await s.browser.getPicks(0, 0)).picks.length, 0);
  })();
});

test('b4-mode-flip-clears-selection', async () => {
  for (const [from, to] of [['edit', 'play'], ['play', 'edit']] as const) {
    const s = stub(null); // no dir: setMode's view.json persist stays off disk
    s.internal.mode = from;
    await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
    await settled(s);
    assert.equal(s.browser.getState().selection.count, 1);
    await s.command({ type: 'mode-request', mode: to });
    assert.equal(s.browser.getMode(), to);
    assert.deepEqual(s.browser.getState().selection, { count: 0, screens: [] }, `${from}→${to} drops the selection`);
    assert.ok(s.evalCalls.some((c) => c.screen === 'home' && c.expr.includes('__dsSelectionClear')));
    assert.equal(lastSelectionPush(s).count, 0);
    // Re-asserting the same mode keeps a selection.
    await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
    await settled(s);
    await s.command({ type: 'mode-request', mode: to });
    assert.equal(s.browser.getState().selection.count, 1, 'no flip, no clear');
  }
  // Shell: the flip drops the local selection immediately.
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  e.api.setSelection({ count: 2, screens: [{ id: 'home', count: 2 }], label: 'x' });
  assert.equal(e.bridge.getSnapshot().selectionCount, 2);
  e.api.setMode('play');
  assert.equal(e.bridge.getSnapshot().selectionCount, 0);
});

test('b4-frame-reload-drops-screen-selection', async () => {
  const s = stub();
  await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
  await s.command({ type: 'screen-pick', screen: 'phone', x: 2, y: 2, additive: true });
  await settled(s);
  const sessions: Record<string, string> = { 'oopif-home': 'home', 'oopif-phone': 'phone' };
  const contexts = {
    screenForContext: (session: string | undefined) => (session ? sessions[session] ?? null : null),
    matches: () => true,
    artifact: () => ({ session: 's', frame: 'f', id: 1, unique: 'u', origin: '' }),
    shellAuthorityCurrent: () => true,
    shell: () => null,
  };
  s.internal.contexts = contexts;
  const dispatch = (name: string, value: unknown, session: string) => s.internal.dispatchBinding(contexts, name, value, session, 1);
  // Same-document navigation keeps it (elements are re-checked at send).
  dispatch('__dsArtifactEvent', { type: 'changed', reason: 'nav' }, 'oopif-phone');
  await pause(10);
  assert.deepEqual(s.browser.getState().selection.screens.map((x: { id: string }) => x.id), ['home', 'phone']);
  // A new document ('dom') drops THAT screen's selection only.
  dispatch('__dsArtifactEvent', { type: 'changed', reason: 'dom' }, 'oopif-phone');
  await pause(10);
  assert.deepEqual(s.browser.getState().selection, { count: 1, screens: [{ id: 'home', count: 1 }] });
  assert.equal(lastSelectionPush(s).count, 1);
  // m5: the same document's 'load' (after DOMContentLoaded) keeps a selection
  // made between the two.
  dispatch('__dsArtifactEvent', { type: 'changed', reason: 'load' }, 'oopif-home');
  await pause(10);
  assert.deepEqual(s.browser.getState().selection, { count: 1, screens: [{ id: 'home', count: 1 }] }, "'load' never drops a selection");
  dispatch('__dsArtifactEvent', { type: 'changed', reason: 'dom' }, 'oopif-home');
  await pause(10);
  assert.deepEqual(s.browser.getState().selection, { count: 0, screens: [] });
  // setScreens removing a screen drops its selection too.
  await s.command({ type: 'screen-pick', screen: 'phone', x: 5, y: 5 });
  await settled(s);
  s.internal.pushShellScreens = async () => {};
  s.internal.pushShellActive = async () => {};
  s.internal.refreshUnsettled = async () => {};
  await s.browser.setScreens([{ id: 'home', url: 'http://localhost:9/home.html', title: 'Home', width: 1280, height: 800 }]);
  assert.deepEqual(s.browser.getState().selection, { count: 0, screens: [] });
  assert.equal(lastSelectionPush(s).count, 0);
  // The in-frame Ctrl/Cmd-click reports its own count through the 'selection' event.
  dispatch('__dsArtifactEvent', { type: 'selection', count: 2, label: 'a#x', additive: true }, 'oopif-home');
  await pause(10);
  assert.deepEqual(s.browser.getState().selection, { count: 2, screens: [{ id: 'home', count: 2 }] });
  assert.equal((await s.browser.getPicks(0, 0)).picks.length, 0, 'an in-frame select never queues');
});

test('b4-close-drops-selection', async () => {
  const s = stub();
  await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
  await settled(s);
  assert.equal(s.browser.getState().selection.count, 1);
  await s.browser.close();
  assert.deepEqual(s.browser.getState().selection, { count: 0, screens: [] }, 'the closed window took its selection along');
  // A shell reload ('ready') re-reads the frames — new documents, so nothing
  // is selected — and zeroes the toolbar.
  const t = stub();
  await t.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
  await settled(t);
  t.frames.clear(); // the reloaded shell's artboards are fresh documents
  t.internal.shellBridgeSettled = async () => true;
  t.internal.contexts = { ...t.internal.contexts, discover: async () => undefined, initializeArtifact: async () => undefined };
  t.internal.refreshUnsettled = async () => {};
  await t.command({ type: 'ready' });
  await pause(10);
  assert.deepEqual(t.browser.getState().selection, { count: 0, screens: [] });
  assert.equal(lastSelectionPush(t).count, 0, 'ready re-syncs the toolbar to the (empty) mirror');
});

test('b4-ready-resync-never-clobbers-a-newer-select (root cause of the b4-live toolbar desync)', async () => {
  // The shell's 'ready' used to clear the mirror, await the bridge, THEN push a
  // hard-coded zero — a click selected in that window kept count 1 in the
  // service and the frame while the toolbar was told 0. The re-sync now runs
  // on the serial queue and pushes the mirror as it is.
  const s = stub();
  s.internal.shellBridgeSettled = async () => { await pause(40); return true; };
  s.internal.contexts = { ...s.internal.contexts, discover: async () => undefined, initializeArtifact: async () => undefined };
  s.internal.refreshUnsettled = async () => {};
  const ready = s.command({ type: 'ready' });
  await pause(5);
  await s.command({ type: 'screen-pick', screen: 'home', x: 7, y: 7 });
  await ready;
  await settled(s);
  await pause(20);
  await settled(s);
  assert.equal(s.browser.getState().selection.count, 1);
  assert.equal(lastSelectionPush(s).count, 1, 'the last push agrees with the mirror');
  // A late (replayed) 'ready' of the SAME shell document finds the frame still
  // holding its selection and keeps it.
  await s.command({ type: 'ready' });
  await pause(60);
  await settled(s);
  assert.equal(s.browser.getState().selection.count, 1, 'a late ready never wipes a live selection');
  assert.equal(lastSelectionPush(s).count, 1);
});

test('b4-toolbar-reference-button-visibility', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  const snap = () => e.bridge.getSnapshot();
  assert.deepEqual([snap().selectionCount, snap().selectionScreen, snap().selectionLabel, snap().agentInput], [0, '', '', false], 'nothing selected by default');
  // The button only renders with a selection; label carries the count, × clears.
  assert.match(toolbarSource, /state\.selectionCount > 0 \? <div id="selection-actions"/);
  assert.match(toolbarSource, /Reference in chat \(\{state\.selectionCount\}\)/);
  assert.match(toolbarSource, /aria-label="Clear selection"/);
  // m11: unavailable is aria-disabled + focusable, the reason described.
  assert.match(toolbarSource, /aria-disabled=\{referenceReason \? true : undefined\} aria-describedby=\{referenceReason \? 'selection-reason' : undefined\}/, 'aria-disabled while the agent owns input');
  assert.doesNotMatch(toolbarSource, /id="reference-selection"[^>]*\sdisabled=/, 'never natively disabled (stays focusable)');
  assert.match(toolbarSource, /<span id="selection-reason" className="sr-only">\{referenceReason\}<\/span>/);
  assert.match(toolbarSource, /The agent is using the canvas\. Reference in chat is available when it finishes\./);
  assert.match(toolbarSource, /Click an element to select it\. Shift-click adds to the selection\. Reference in chat sends it to the composer\./);
  assert.match(toolbarSource, /aria-label="Selection actions"/, 'the toolbar group is named apart from the pill');
  assert.match(toolbarSource, /Enter with the canvas focused/);
  // Snapshot drives it.
  assert.equal(e.api.setSelection({ count: 2, screens: [{ id: 'other', count: 2 }], screen: 'other', label: 'button#pay' }), true);
  assert.deepEqual([snap().selectionCount, snap().selectionScreen, snap().selectionLabel], [2, 'other', 'button#pay']);
  assert.equal(e.api.setSelection({ count: 1, screens: [{ id: 'BAD ID', count: 1 }] }), false, 'junk payloads are refused');
  assert.equal(e.api.setSelection(null), false);
  // The pill sits bottom-centre of the selected artboard and references too.
  const pill = e.$('canvas').children.find((n: any) => n.className === 'ds-selection-pill');
  assert.ok(pill, 'the pill exists while something is selected');
  assert.equal(pill.style.display, '');
  assert.equal(pill.attributes['aria-label'], 'Selected elements');
  assert.equal(pill.children[0].textContent, 'Reference in chat (2)', 'm12: the pill shows the count');
  // V4-7: while the agent drives input, referencing is refused (and the pill
  // aria-disabled — still focusable, the reason described).
  e.api.setAgentInput(true);
  assert.equal(snap().agentInput, true);
  assert.equal(pill.children[0].disabled, undefined, 'never natively disabled');
  assert.equal(pill.children[0].attributes['aria-disabled'], 'true');
  assert.equal(pill.children[0].attributes['aria-describedby'], 'ds-pill-reason');
  assert.match(pill.children.find((n: any) => n.id === 'ds-pill-reason').textContent, /The agent is using the canvas/);
  e.bridge.referenceSelection();
  pill.children[0].onclick();
  assert.equal(e.commands.some((c) => c.type === 'selection-send'), false, 'no send during agent input');
  e.api.setAgentInput(false);
  assert.equal(pill.children[0].attributes['aria-disabled'], undefined);
  pill.children[0].onclick();
  assert.equal(e.commands.at(-1).type, 'selection-send', 'the pill sends');
  assert.equal(snap().selectionCount, 0);
  assert.equal(pill.style.display, 'none', 'the pill hides once nothing is selected');
  // Toolbar button path (bridge) and the × clear.
  e.api.setSelection({ count: 1, screens: [{ id: 'home', count: 1 }], label: 'x' });
  e.bridge.clearSelection();
  assert.deepEqual(e.commands.at(-1), { type: 'selection-clear' });
  e.api.setSelection({ count: 1, screens: [{ id: 'home', count: 1 }], label: 'x' });
  e.bridge.referenceSelection();
  assert.equal(e.commands.at(-1).type, 'selection-send');
});

// ---- R2-fix ----------------------------------------------------------------------

test('r2fix-selection-cap: 11 screens × 10 elements caps at 40, sends 20 per send, nothing lost', async () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, url: `http://localhost:9/s${i}.html`, file: `s${i}.html`, title: `S${i}`, width: 400, height: 400 }));
  const s = stub('/ws/demo', many);
  for (const screen of many) {
    for (let k = 0; k < 10; k += 1) await s.command({ type: 'screen-pick', screen: screen.id, x: k, y: 1, additive: true });
    await settled(s);
  }
  assert.equal(SELECTION_TOTAL_MAX, 40);
  assert.equal(s.browser.getState().selection.count, 40, 'additive selects past the cap are refused');
  assert.deepEqual(s.browser.getState().selection.screens.map((x: { id: string; count: number }) => [x.id, x.count]), [['s0', 10], ['s1', 10], ['s2', 10], ['s3', 10]]);
  assert.ok(s.toasts.some((t) => t.kind === 'warn' && t.text.startsWith('Selection full (40)')), 'the cap is announced');
  assert.match(String(lastSelectionPush(s).notice), /^Selection full \(40\)/, 'and read out by the shell');
  assert.ok(s.evalCalls.some((c) => /__dsSelectAt\(\d+,1,true,true\)/.test(c.expr)), 'the frame is told it is full (toggle-out only)');
  // A toggle-OUT at the cap still works.
  await s.command({ type: 'screen-pick', screen: 's0', x: 0, y: 1, additive: true });
  await settled(s);
  assert.equal(s.browser.getState().selection.count, 39);
  await s.command({ type: 'screen-pick', screen: 's0', x: 0, y: 1, additive: true });
  await settled(s);
  assert.equal(s.browser.getState().selection.count, 40);
  // Send #1: PICKS_PAGE_MAX (20), the rest stays selected.
  await s.command({ type: 'selection-send', sentAt: Date.now() });
  const first = await s.browser.getPicks(0, 0);
  assert.equal(first.picks.length, 20);
  assert.equal(new Set(first.picks.map((p) => p.batch)).size, 1);
  assert.deepEqual([...new Set(first.picks.map((p) => p.screen))], ['s0', 's1']);
  assert.equal(s.browser.getState().selection.count, 20, 'the remainder stays selected for the next send');
  assert.match(String(lastSelectionPush(s).notice), /Referenced 20 in chat — 20 still selected/);
  // Send #2 takes the rest; all 40 are in the ring, none overwritten.
  await s.command({ type: 'selection-send', sentAt: Date.now() });
  const second = await s.browser.getPicks(first.seq - 0, 0);
  assert.equal(s.browser.getState().selection.count, 0);
  const all = [...first.picks, ...(await s.browser.getPicks(20, 0)).picks];
  assert.equal(all.length, 40, 'every selected element reached the queue');
  assert.equal(all[0]!.seq, 1, 'the first entries were not lost');
  assert.deepEqual([...new Set(all.slice(20).map((p) => p.screen))], ['s2', 's3']);
  assert.notEqual(all[20]!.batch, all[0]!.batch, 'one batch per send');
  assert.ok(second.seq >= 40);
});

test('r2fix-in-frame-ctrl-click-over-the-cap-is-trimmed', async () => {
  const s = stub();
  s.internal.selection.set('phone', { count: 38, label: 'x' });
  s.internal.selectionScreen = 'phone';
  await s.internal.runSelectionJob({ kind: 'note', screen: 'home', count: 4, label: 'a', additive: true, agent: false });
  assert.ok(s.evalCalls.some((c) => c.screen === 'home' && c.expr.includes('__dsSelectionTrim(2)')), 'the frame is trimmed back under the cap');
  assert.ok(s.toasts.some((t) => t.text.startsWith('Selection full (40)')));
});

test('r2fix-serial-queue: a send covers exactly the clicks before it; a click after a send starts fresh', async () => {
  const s = stub();
  s.hooks.selectDelay = 15; // every select evaluate is slow: the old relay raced the send
  void s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
  void s.command({ type: 'screen-pick', screen: 'home', x: 2, y: 2, additive: true });
  const sent = s.command({ type: 'selection-send', sentAt: Date.now() });
  // Clicks AFTER the send (one additive, as a shift-click straight after Enter).
  void s.command({ type: 'screen-pick', screen: 'phone', x: 3, y: 3, additive: true });
  await sent;
  const page = await s.browser.getPicks(0, 0);
  assert.deepEqual(page.picks.map((p) => p.selector), ['#e1', '#e2'], 'the send carried exactly the earlier clicks');
  await settled(s);
  assert.deepEqual(s.browser.getState().selection, { count: 1, screens: [{ id: 'phone', count: 1 }] }, 'the later click is a fresh selection, no phantom count');
  assert.equal(lastSelectionPush(s).count, 1);
  // Clear is ordered too: a clear after a click wins, a click after a clear stands.
  void s.command({ type: 'screen-pick', screen: 'home', x: 4, y: 4, additive: true });
  const cleared = s.command({ type: 'selection-clear' });
  void s.command({ type: 'screen-pick', screen: 'home', x: 5, y: 5 });
  await cleared;
  await settled(s);
  assert.deepEqual(s.browser.getState().selection, { count: 1, screens: [{ id: 'home', count: 1 }] });
  assert.deepEqual(s.frames.get('home'), ['#e5']);
});

test('r2fix-stress: send immediately after each click, never waiting', async () => {
  const s = stub();
  s.hooks.selectDelay = 3;
  const sends: Array<Promise<void>> = [];
  for (let i = 1; i <= 15; i += 1) {
    void s.command({ type: 'screen-pick', screen: i % 2 ? 'home' : 'phone', x: i, y: i, clickAt: Date.now() });
    sends.push(s.command({ type: 'selection-send', sentAt: Date.now() }));
  }
  await Promise.all(sends);
  await settled(s);
  const page = await s.browser.getPicks(0, 0);
  assert.deepEqual(page.picks.map((p) => p.selector), Array.from({ length: 15 }, (_, i) => `#e${i + 1}`), 'every click referenced exactly once, in order');
  assert.equal(new Set(page.picks.map((p) => p.batch)).size, 15, 'one batch per send');
  assert.deepEqual(s.browser.getState().selection, { count: 0, screens: [] });
  assert.equal(lastSelectionPush(s).count, 0, 'no phantom count after the last send');
});

test('r2fix-stranded-outlines: clears reach every registered frame; a failed read keeps the selection', async () => {
  const s = stub();
  // The frame holds a selection the service never heard about (dropped event).
  s.frames.set('phone', ['#ghost']);
  await s.command({ type: 'selection-clear' });
  assert.deepEqual(s.frames.get('phone'), [], 'selection-clear reached a frame the mirror did not know');
  s.frames.set('phone', ['#ghost']);
  await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
  await settled(s);
  assert.deepEqual(s.frames.get('phone'), [], 'a plain select clears every other frame');
  s.frames.set('phone', ['#ghost']);
  await s.command({ type: 'mode-request', mode: 'play' });
  assert.deepEqual(s.frames.get('phone'), [], 'a mode flip clears every frame');
  assert.deepEqual(s.frames.get('home'), []);
  // A failed read keeps the record (and the frame's outlines) for a retry.
  s.internal.mode = 'edit';
  await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
  await s.command({ type: 'screen-pick', screen: 'phone', x: 2, y: 2, additive: true });
  await settled(s);
  s.hooks.failTake.add('phone');
  await s.command({ type: 'selection-send' });
  let page = await s.browser.getPicks(0, 0);
  assert.deepEqual(page.picks.map((p) => p.selector), ['#e1'], 'the readable frame was referenced');
  assert.deepEqual(s.browser.getState().selection, { count: 1, screens: [{ id: 'phone', count: 1 }] }, 'the unread frame stays selected');
  assert.deepEqual(s.frames.get('phone'), ['#e2'], 'its outline is still there');
  assert.ok(s.toasts.some((t) => t.kind === 'warn' && /Couldn't read the selection/.test(t.text)));
  s.hooks.failTake.clear();
  await s.command({ type: 'selection-send' });
  page = await s.browser.getPicks(page.seq, 0);
  assert.deepEqual(page.picks.map((p) => p.selector), ['#e2'], 'the next send picks it up');
  assert.equal(s.browser.getState().selection.count, 0);
});

test('r2fix-zero-payload-send-announces-and-clears', async () => {
  const s = stub();
  await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
  await settled(s);
  s.hooks.emptyTake.add('home');
  const clearsBefore = s.evalCalls.filter((c) => c.screen === 'home' && c.expr.includes('__dsSelectionClear')).length;
  await s.command({ type: 'selection-send' });
  assert.equal((await s.browser.getPicks(0, 0)).picks.length, 0);
  assert.deepEqual(s.browser.getState().selection, { count: 0, screens: [] }, 'the stale record is gone');
  assert.ok(s.evalCalls.filter((c) => c.screen === 'home' && c.expr.includes('__dsSelectionClear')).length > clearsBefore, 'and its outlines');
  assert.ok(s.toasts.some((t) => t.text === 'Nothing to reference — the selected elements changed'));
  assert.equal(lastSelectionPush(s).notice, 'Nothing to reference — the selected elements changed');
});

test('r2fix-late-result-never-recreates-a-removed-screen', async () => {
  const s = stub();
  s.hooks.selectDelay = 20;
  s.internal.pushShellScreens = async () => {};
  s.internal.pushShellActive = async () => {};
  s.internal.refreshUnsettled = async () => {};
  void s.command({ type: 'screen-pick', screen: 'phone', x: 1, y: 1 });
  await pause(5);
  await s.browser.setScreens([SCREENS[0]!]);
  await settled(s);
  assert.deepEqual(s.browser.getState().selection, { count: 0, screens: [] }, 'the in-flight select on a removed screen was discarded');
});

test('r2fix-legacy-launch-relays-screen-pick-to-__dsPickAt', async () => {
  const s = stub(null);
  s.internal.workspaceMode = false;
  await s.command({ type: 'screen-pick', screen: 'home', x: 5, y: 6, additive: true });
  await pause(10);
  assert.ok(s.evalCalls.some((c) => c.screen === 'home' && c.expr === 'window.__dsPickAt(5,6,true)'), 'the legacy click picks directly');
  assert.equal(s.evalCalls.some((c) => c.expr.includes('__dsSelectAt')), false, 'no selection relay in legacy');
  assert.equal(s.browser.getState().selection.count, 0);
});

test('r2fix-agent-select-keeps-the-user-selection-on-other-boards', async () => {
  const s = stub();
  await s.command({ type: 'screen-pick', screen: 'phone', x: 1, y: 1 });
  await settled(s);
  const sessions: Record<string, string> = { 'oopif-home': 'home', 'oopif-phone': 'phone' };
  const contexts = { screenForContext: (session: string | undefined) => (session ? sessions[session] ?? null : null), matches: () => true, artifact: () => ({}), shellAuthorityCurrent: () => true, shell: () => null };
  s.internal.contexts = contexts;
  // The agent's synthetic modified click (__dsPickAt) reports script:true.
  s.internal.dispatchBinding(contexts, '__dsArtifactEvent', { type: 'selection', count: 1, label: 'a#x', additive: false, script: true }, 'oopif-home', 1);
  await pause(10);
  await settled(s);
  assert.deepEqual(s.browser.getState().selection, { count: 2, screens: [{ id: 'phone', count: 1 }, { id: 'home', count: 1 }] }, 'the user selection on phone survives');
  // During agent input the same holds for trusted (compositor) clicks.
  s.internal.agentInputDepth = 1;
  s.internal.dispatchBinding(contexts, '__dsArtifactEvent', { type: 'selection', count: 1, label: 'a#y', additive: false }, 'oopif-home', 1);
  await pause(10);
  await settled(s);
  assert.equal(s.browser.getState().selection.count, 2);
  // A user's own plain Ctrl-click is single-select across the canvas.
  s.internal.agentInputDepth = 0;
  s.internal.agentInputUntil = 0;
  s.internal.dispatchBinding(contexts, '__dsArtifactEvent', { type: 'selection', count: 1, label: 'a#z', additive: false }, 'oopif-home', 1);
  await pause(10);
  await settled(s);
  assert.deepEqual(s.browser.getState().selection, { count: 1, screens: [{ id: 'home', count: 1 }] });
});

test('r2fix-workspace-dir-change-clears-the-selection; an omitted dir stamps nothing', async () => {
  const dirA = await mkdtemp(path.join(tmpdir(), 'r2fix-a-'));
  const dirB = await mkdtemp(path.join(tmpdir(), 'r2fix-b-'));
  try {
    const s = stub(dirA);
    s.internal.pushShellScreens = async () => {};
    s.internal.pushShellActive = async () => {};
    s.internal.refreshUnsettled = async () => {};
    s.internal.waitScreen = async () => true;
    s.internal.bringToFront = async () => {};
    await s.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
    await settled(s);
    await s.browser.openWorkspace({ dir: dirA, screens: SCREENS, baseUrl: 'http://localhost:9/', focus: false });
    assert.equal(s.browser.getState().selection.count, 1, 'the same workspace keeps its selection');
    await s.browser.openWorkspace({ dir: dirB, screens: SCREENS, baseUrl: 'http://localhost:9/', focus: false });
    assert.deepEqual(s.browser.getState().selection, { count: 0, screens: [] }, 'another workspace starts with nothing selected');
    assert.deepEqual(s.frames.get('home'), [], 'and the old outlines are gone');
    assert.equal(s.browser.currentWorkspaceDir(), dirB);
    await s.browser.openWorkspace({ screens: SCREENS, baseUrl: 'http://localhost:9/', focus: false });
    assert.equal(s.browser.currentWorkspaceDir(), null, 'an omitted dir resets — never the previous workspace');
    await s.command({ type: 'screen-pick', screen: 'home', x: 2, y: 2 });
    await s.command({ type: 'selection-send' });
    assert.equal((await s.browser.getPicks(0, 0)).picks[0]!.dir, undefined, 'no stale dir on the entry');
  } finally {
    await pause(150); // setMode's fire-and-forget view.json persist
    await rm(dirA, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(dirB, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('r2fix-legacy-window-relaunches-cold-for-a-workspace', async () => {
  const s = stub(null);
  s.internal.workspaceMode = false;
  const order: string[] = [];
  s.internal.close = async () => { order.push('close'); s.internal.cdp = null; };
  s.internal.start = async () => { order.push('start'); };
  s.internal.waitScreen = async () => true;
  s.internal.refreshUnsettled = async () => {};
  s.internal.bringToFront = async () => {};
  await s.browser.openWorkspace({ screens: SCREENS, baseUrl: 'http://localhost:9/', focus: false });
  assert.deepEqual(order, ['close', 'start'], 'a warm legacy window is closed and relaunched cold');
  assert.equal(s.internal.workspaceMode, true);
});

test('r2fix-batch-ack-copy and the unacked watchdog scales with the batch', async () => {
  const toasts: Array<{ kind: string; text: string }> = [];
  const queue = new PickQueue((kind, text) => toasts.push({ kind, text }));
  const element = { kind: 'element' as const, screen: 'home', screenUrl: 'u', at: 1, additive: false, batch: 'b1' };
  queue.push(element); queue.push(element); queue.push(element);
  queue.ack(3, '3 elements');
  assert.deepEqual(toasts.at(-1), { kind: 'ok', text: 'Added 3 elements to chat' });
  queue.push(element);
  queue.ack(4, 'Button #b');
  assert.deepEqual(toasts.at(-1), { kind: 'ok', text: 'Added to chat · Button #b' }, 'a single element keeps its label');
  queue.close();
  assert.equal(pickUnackedWarnMs(1), PICK_UNACKED_WARN_MS);
  assert.equal(pickUnackedWarnMs(5), 4100);
  assert.equal(pickUnackedWarnMs(20), 8000, 'capped');
  // Two unacked elements: no warn at 2.5 s (the single-element window), one by 3.1 s.
  const late: Array<{ kind: string; text: string }> = [];
  const slow = new PickQueue((kind, text) => late.push({ kind, text }));
  slow.push(element); slow.push(element);
  await pause(2650);
  assert.equal(late.length, 0, 'a batch gets more time than one element');
  await pause(450);
  assert.equal(late.filter((t) => t.kind === 'warn').length, 1);
  slow.close();
});

test('r2fix-shell: count-only announces, notices, Select more (touch multi-select)', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  e.api.restoreCamera({ mode: 'manual', scale: 1, panX: 0, panY: 0 });
  const announced = () => e.$('announcement').textContent;
  e.api.setSelection({ count: 1, screens: [{ id: 'home', count: 1 }], screen: 'home', label: 'x' });
  assert.equal(announced(), '1 element selected. With the canvas focused, press Enter to reference it in chat or Escape to clear.');
  e.$('announcement').textContent = '';
  e.api.setSelection({ count: 1, screens: [{ id: 'home', count: 1 }], screen: 'home', label: 'x' });
  assert.equal(announced(), '', 'a re-push with the same count is not re-announced');
  e.api.setSelection({ count: 3, screens: [{ id: 'home', count: 3 }], screen: 'home', label: 'x' });
  assert.match(announced(), /^3 elements selected\. With the canvas focused, press Enter to reference them in chat or Escape to clear\.$/);
  e.api.setSelection({ count: 3, screens: [{ id: 'home', count: 3 }], screen: 'home', label: 'x', notice: 'Selection full (40) — reference it in chat first' });
  assert.equal(announced(), 'Selection full (40) — reference it in chat first', 'a service notice is always read out');
  // Select more: a plain click adds while it is on.
  const pill = e.$('canvas').children.find((n: any) => n.className === 'ds-selection-pill');
  const more = pill.children.find((n: any) => n.className === 'ds-pill-more');
  assert.equal(more.textContent, 'Select more');
  assert.equal(more.attributes['aria-pressed'], 'false');
  more.onclick();
  assert.equal(more.attributes['aria-pressed'], 'true');
  const section = e.sectionOf('home');
  section.rect = { x: 0, y: 0, left: 0, top: 0, width: 1280, height: 800 };
  e.fire('canvas', 'pointerdown', { button: 0, clientX: 30, clientY: 30, pointerId: 9, target: section, preventDefault() {} });
  e.fire('canvas', 'pointerup', { pointerId: 9, clientX: 30, clientY: 30 });
  assert.equal(e.commands.filter((c) => c.type === 'screen-pick').at(-1)?.additive, true, 'the tap adds');
  // Nothing selected any more → the toggle resets.
  e.api.setSelection({ count: 0, screens: [] });
  e.api.setSelection({ count: 1, screens: [{ id: 'home', count: 1 }], screen: 'home', label: 'x' });
  assert.equal(more.attributes['aria-pressed'], 'false');
  e.tick(400);
  e.fire('canvas', 'pointerdown', { button: 0, clientX: 30, clientY: 30, pointerId: 10, target: section, preventDefault() {} });
  e.fire('canvas', 'pointerup', { pointerId: 10, clientX: 30, clientY: 30 });
  assert.equal(e.commands.filter((c) => c.type === 'screen-pick').at(-1)?.additive, undefined, 'a plain click replaces again');
});

test('b4-capture-hides-selection-outlines (shell pill)', () => {
  const e = environment();
  e.api.setStatus({ state: 'ready' });
  e.api.setSelection({ count: 1, screens: [{ id: 'home', count: 1 }], screen: 'home', label: 'x' });
  const pill = e.$('canvas').children.find((n: any) => n.className === 'ds-selection-pill');
  assert.equal(pill.style.display, '');
  const token = e.api.beginCapture('home');
  assert.equal(pill.style.display, 'none', 'beginCapture hides the pill like the toast band');
  e.api.endCapture(token);
  assert.equal(pill.style.display, '', 'endCapture brings it back');
});

test('b1-loading-watchdog-offers-retry-after-20s', () => {
  const e = environment(undefined, true, undefined, { timers: true });
  e.api.setStatus({ state: 'ready' });
  const retry = e.elementOf('home', '.ds-ab-retry');
  assert.equal(retry.hidden, true, 'a loading board starts without Retry');
  e.fireTimers(19_000);
  assert.equal(retry.hidden, true);
  e.fireTimers(1_500);
  assert.equal(retry.hidden, false, 'still loading after 20 s: Retry appears');
  assert.equal(retry.textContent, 'Still loading — Retry');
  retry.onclick();
  assert.deepEqual(e.commands.at(-1), { type: 'retry', screen: 'home' }, 'the existing retry message');
  assert.equal(retry.hidden, true, 'a fresh retry re-arms the watchdog');
  e.api.setScreenState('home', { state: 'ready' });
  e.fireTimers(25_000);
  assert.equal(retry.hidden, true, 'a ready board never shows it');
});

// ---- live (real in-frame script) -----------------------------------------------

const PAGE = '<!doctype html><title>B4</title><style>body{margin:0;background:#eef}button{display:block;width:200px;height:80px;margin:40px}</style><button id=b>B</button><button id=c>C</button><div style="height:1600px"></div>';

async function liveCanvas(run: (browser: Browser, base: string) => Promise<void>): Promise<void> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const prior = process.env.DS_WINDOW;
  process.env.DS_WINDOW = '-2400,-2400,1400,900';
  const browser = new Browser();
  try {
    const base = `http://localhost:${address.port}/`;
    await browser.openWorkspace({ dir: undefined, screens: [{ id: 'home', url: base + 'home.html', width: 1280, height: 800, title: 'Home' }], baseUrl: base, mode: 'edit' });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && browser.getState().screens[0]?.state !== 'ready') await pause(100);
    await run(browser, base);
  } finally {
    if (prior === undefined) delete process.env.DS_WINDOW; else process.env.DS_WINDOW = prior;
    await browser.close().catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function shell(browser: Browser, expression: string): Promise<any> {
  const internal = browser as unknown as { cdp: { send: (m: string, p: object, s: string) => Promise<any> }; sessionId: string };
  const reply = await internal.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, internal.sessionId);
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}

async function until(check: () => boolean | Promise<boolean>, label: string, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await check()) return; await pause(25); }
  assert.fail(label);
}

const boxes = (browser: Browser) => browser.evaluate("[...document.querySelectorAll('[data-ds-overlay=\"selection\"]')].map(b=>({display:b.style.display,picked:b.getAttribute('data-ds-picked'),top:Math.round(b.getBoundingClientRect().top),w:Math.round(b.getBoundingClientRect().width)}))", 'home') as Promise<Array<{ display: string; picked: string | null; top: number; w: number }>>;

test('b4-live: click selects (outline, no queue), shift toggles, send pulls without the __dsPick binding', { timeout: 120_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser) => {
    // b4-send-does-not-need-pick-binding: the pull never touches __dsPick.
    await browser.evaluate('delete window.__dsPick; window.__dsPick=undefined; true', 'home');
    await shell(browser, `__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:'home',x:100,y:60,clickAt:${Date.now()}}))`);
    await until(() => browser.getState().selection.count === 1, 'the click selected one element');
    assert.equal((await browser.getPicks(0, 0)).picks.length, 0, 'b4-click-selects-without-queueing (live)');
    assert.equal((await boxes(browser)).length, 1, 'one selection outline in the frame');
    await until(async () => (await shell(browser, '__dsToolbarBridge.getSnapshot().selectionCount')) === 1, 'the toolbar mirrors the count');
    // Shift toggles #c in, then out, then back.
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:'home',x:100,y:180,additive:true}))");
    await until(() => browser.getState().selection.count === 2, 'shift added #c');
    assert.equal((await boxes(browser)).length, 2);
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:'home',x:100,y:180,additive:true}))");
    await until(() => browser.getState().selection.count === 1, 'shift toggled #c out');
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:'home',x:100,y:180,additive:true}))");
    await until(() => browser.getState().selection.count === 2, 'shift toggled #c back in');
    // Boxes follow scroll.
    await browser.evaluate('scrollTo(0,30)', 'home');
    await until(async () => (await boxes(browser))[0]?.top === 10, 'outlines re-place on scroll');
    await browser.evaluate('scrollTo(0,0)', 'home');
    await pause(80);
    // Reference through the toolbar bridge: both land in order, one batch.
    await shell(browser, '__dsToolbarBridge.referenceSelection()');
    let page = await browser.getPicks(0, 2000);
    const deadline = Date.now() + 3000;
    while (page.picks.length < 2 && Date.now() < deadline) page = await browser.getPicks(0, 300);
    assert.deepEqual(page.picks.map((p) => p.selector), ['#b', '#c'], 'b4-send-does-not-need-pick-binding: the send landed with __dsPick deleted');
    assert.equal(page.picks[0]!.batch, page.picks[1]!.batch);
    assert.ok(page.picks[0]!.seq < page.picks[1]!.seq);
    assert.equal(browser.getState().selection.count, 0, 'the send cleared the selection');
    const flashed = await boxes(browser);
    assert.ok(flashed.length === 2 && flashed.every((b) => b.picked === '1'), 'the outlines flash pick-green');
    await pause(1700);
    assert.equal((await boxes(browser)).length, 0, 'and fade after 1500 ms');
  });
});

test('r2fix-live-stress: click + send in one breath, then a click after the send starts fresh', { timeout: 120_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser) => {
    // Both bindings fire in ONE evaluate: no wait between the click and the send.
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:'home',x:100,y:60}));__dsCanvasSend(JSON.stringify({type:'selection-send',sentAt:Date.now()}));true");
    let page = await browser.getPicks(0, 3000);
    assert.deepEqual(page.picks.map((p) => p.selector), ['#b'], 'the send carried the click made just before it');
    // Shift-click, send, shift-click again — all at once.
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:'home',x:100,y:180,additive:true}));__dsCanvasSend(JSON.stringify({type:'selection-send'}));__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:'home',x:100,y:60,additive:true}));true");
    page = await browser.getPicks(page.seq, 3000);
    assert.deepEqual(page.picks.map((p) => p.selector), ['#c']);
    try {
      await until(() => browser.getState().selection.count === 1, 'the click after the send is a fresh selection of one');
    } catch (error) {
      throw new Error(`${(error as Error).message}: ${JSON.stringify(browser.getState().selection)} boxes ${JSON.stringify(await boxes(browser))}`);
    }
    await until(async () => (await shell(browser, '__dsToolbarBridge.getSnapshot().selectionCount')) === 1, 'and the toolbar agrees (no phantom count)');
    await pause(200);
    assert.equal(browser.getState().selection.count, 1);
    assert.equal((await boxes(browser)).filter((b) => b.picked !== '1').length, 1, 'one live (blue) outline');
  });
});

/** Decode a PNG to RGB lookups (all five filters). */
function hasColor(png: Buffer, rgb: [number, number, number], tol = 8): boolean {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), channels = png[25] === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) { const size = png.readUInt32BE(at); if (png.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + size)); at += size + 12; }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) for (let x = 0; x < stride; x++) {
    const f = raw[y * (stride + 1)]!, v = raw[y * (stride + 1) + x + 1]!;
    const a = x >= channels ? px[y * stride + x - channels]! : 0, b = y ? px[(y - 1) * stride + x]! : 0, c = y && x >= channels ? px[(y - 1) * stride + x - channels]! : 0;
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    px[y * stride + x] = (v + [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!) & 255;
  }
  for (let i = 0; i < px.length; i += channels) if (Math.abs(px[i]! - rgb[0]) <= tol && Math.abs(px[i + 1]! - rgb[1]) <= tol && Math.abs(px[i + 2]! - rgb[2]) <= tol) return true;
  return false;
}

test('b4-capture-hides-selection-outlines (live export) + reload drops the frame selection', { timeout: 120_000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await liveCanvas(async (browser) => {
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:'home',x:100,y:60}))");
    await until(() => browser.getState().selection.count === 1, 'selected');
    const shot = await browser.capture('home');
    assert.equal(hasColor(shot.png, [0x25, 0x63, 0xeb]), false, 'no selection-blue pixel survives the export');
    assert.equal((await boxes(browser))[0]?.display, '', 'the outline is restored after the capture');
    // b4-frame-reload-drops-screen-selection (live): a reload is a new document.
    await browser.evaluate('location.reload()', 'home').catch(() => undefined);
    await until(() => browser.getState().selection.count === 0, 'the reload dropped the selection', 8000);
    await until(async () => (await shell(browser, '__dsToolbarBridge.getSnapshot().selectionCount')) === 0, 'and the toolbar count cleared');
  });
});
