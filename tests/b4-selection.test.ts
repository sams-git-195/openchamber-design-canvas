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

import { Browser } from '../service/browser.ts';
import type { PickedElement } from '../service/browser.ts';
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

/** A Browser with a fake window: frames answer __dsSelectAt from a per-screen
 *  model, __dsSelectionTake returns (and clears) that model. */
function stub(dir: string | null = '/ws/demo'): Stub & { frames: Map<string, string[]> } {
  const browser = new Browser();
  const internal = browser as any;
  const shellCalls: string[] = [];
  const evalCalls: Array<{ expr: string; screen?: string }> = [];
  const frames = new Map<string, string[]>();
  internal.cdp = { send: async () => ({}), on: () => () => undefined };
  internal.sessionId = 'fake-shell-session';
  internal.targetId = 'fake-target';
  internal.contexts = { shellAuthorityCurrent: () => true, shell: () => null, artifact: () => null, activeScreenId: null };
  internal.shellEvalSettled = async (expr: string) => { shellCalls.push(expr); return true; };
  internal.shellEval = async (expr: string) => { shellCalls.push(expr); return true; };
  internal.pushToast = async () => true;
  internal.refreshScreen = async () => {};
  internal.evalIn = async (expr: string, _await: boolean, screen?: string) => {
    evalCalls.push({ expr, screen });
    const id = screen ?? 'home';
    const list = frames.get(id) ?? [];
    const at = /__dsSelectAt\((\d+),(\d+),(true|false)\)/.exec(expr);
    if (at) {
      const selector = `#e${at[1]}`;
      if (at[3] === 'true') {
        const i = list.indexOf(selector);
        if (i >= 0) list.splice(i, 1); else list.push(selector);
        frames.set(id, list);
      } else frames.set(id, [selector]);
      const now = frames.get(id)!;
      return { ok: true, count: now.length, label: now.at(-1) ?? '' };
    }
    if (expr.includes('__dsSelectionTake')) {
      frames.set(id, []);
      return list.map((selector, i) => ({ ...picked(selector), additive: i > 0 }));
    }
    if (expr.includes('__dsSelectionClear')) { frames.set(id, []); return true; }
    return true;
  };
  internal.workspaceMode = true;
  internal.workspaceDir = dir;
  internal.applyScreenRegistry([
    { id: 'home', url: 'http://localhost:9/home.html', file: 'home.html', title: 'Home', width: 1280, height: 800 },
    { id: 'phone', url: 'http://localhost:9/phone.html', file: 'phone.html', title: 'Phone', width: 390, height: 844 },
  ]);
  const canvasCommand = internal.canvasCommand.bind(browser) as (c: unknown, a: unknown) => Promise<void>;
  return { browser, internal, shellCalls, evalCalls, frames, command: (value) => canvasCommand(value, {}) };
}

/** Wait for the ordered select relay to settle. */
async function settled(s: Stub): Promise<void> {
  for (let i = 0; i < 50 && s.internal.selectRunning; i += 1) await pause(5);
  await pause(5);
}

const lastSelectionPush = (s: Stub) => {
  const call = [...s.shellCalls].reverse().find((c) => c.includes('__dsCanvas.setSelection('));
  assert.ok(call, 'the shell received a setSelection push');
  return JSON.parse(call.slice(call.indexOf('__dsCanvas.setSelection(') + '__dsCanvas.setSelection('.length, -1)) as { count: number; screens: Array<{ id: string; count: number }>; screen?: string; label: string };
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
  // A new document (dom/load) drops THAT screen's selection only.
  dispatch('__dsArtifactEvent', { type: 'changed', reason: 'dom' }, 'oopif-phone');
  await pause(10);
  assert.deepEqual(s.browser.getState().selection, { count: 1, screens: [{ id: 'home', count: 1 }] });
  assert.equal(lastSelectionPush(s).count, 1);
  dispatch('__dsArtifactEvent', { type: 'changed', reason: 'load' }, 'oopif-home');
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
  // A shell reload ('ready') clears the mirror and zeroes the toolbar.
  const t = stub();
  await t.command({ type: 'screen-pick', screen: 'home', x: 1, y: 1 });
  await settled(t);
  t.internal.shellBridgeSettled = async () => true;
  t.internal.contexts = { ...t.internal.contexts, discover: async () => undefined, initializeArtifact: async () => undefined };
  t.internal.refreshUnsettled = async () => {};
  await t.command({ type: 'ready' });
  await pause(10);
  assert.deepEqual(t.browser.getState().selection, { count: 0, screens: [] });
  assert.ok(t.shellCalls.some((c) => c.includes('__dsCanvas.setSelection({count:0,screens:[]})')), 'ready pushes the zero selection');
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
  assert.match(toolbarSource, /disabled=\{state\.agentInput \|\| state\.capturing\}/, 'disabled while the agent owns input');
  assert.match(toolbarSource, /The agent is using the canvas\. Reference in chat is available when it finishes\./);
  assert.match(toolbarSource, /Click an element to select it\. Reference in chat sends it to the composer\./);
  // Snapshot drives it.
  assert.equal(e.api.setSelection({ count: 2, screens: [{ id: 'other', count: 2 }], screen: 'other', label: 'button#pay' }), true);
  assert.deepEqual([snap().selectionCount, snap().selectionScreen, snap().selectionLabel], [2, 'other', 'button#pay']);
  assert.equal(e.api.setSelection({ count: 1, screens: [{ id: 'BAD ID', count: 1 }] }), false, 'junk payloads are refused');
  assert.equal(e.api.setSelection(null), false);
  // The pill sits bottom-centre of the selected artboard and references too.
  const pill = e.$('canvas').children.find((n: any) => n.className === 'ds-selection-pill');
  assert.ok(pill, 'the pill exists while something is selected');
  assert.equal(pill.style.display, '');
  assert.equal(pill.children[0].textContent, 'Reference in chat');
  // V4-7: while the agent drives input, referencing is refused (and the pill disabled).
  e.api.setAgentInput(true);
  assert.equal(snap().agentInput, true);
  assert.equal(pill.children[0].disabled, true);
  e.bridge.referenceSelection();
  assert.equal(e.commands.some((c) => c.type === 'selection-send'), false, 'no send during agent input');
  e.api.setAgentInput(false);
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
