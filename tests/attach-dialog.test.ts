// Focused tests for the pick chips (panel/attach-dialog.ts). The builder now
// takes ONE QUEUED PICK (SPEC-V4 V4-5/V4-10) as it arrives from `GET /picks`:
// `kind:'element'` keeps the exact element-chip shape every pick path shares
// (and now carries its Screen from the queue entry itself); `kind:'screen'` is
// the artboard-menu "Send to chat" chip — `Screen: <id> (<w>×<h>) — <file>` +
// `Screen URL:`, with NO selector/styles/markup block. The SDK's connectHost
// needs a `window`, so a minimal shim is installed before importing (same
// pattern as panel-open).
import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as { window?: unknown }).window = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  parent: { postMessage: () => undefined },
};

const attachDialog = await import('../panel/attach-dialog.ts');
const { workspacePathRule } = await import('../panel/mode.ts');
import type { QueuedElementPick, QueuedScreenPick } from '../panel/api.ts';

/** A queued ELEMENT pick, exactly as `GET /picks` delivers it (V4-5 shape). */
const elementPick = (seq: number, over: Partial<QueuedElementPick> = {}): QueuedElementPick => ({
  seq,
  kind: 'element',
  screen: 'checkout',
  screenUrl: 'http://127.0.0.1:5173/checkout.html',
  at: 1731500000000,
  additive: false,
  selector: '#view-hero > h1',
  tag: 'h1',
  classes: 'hero title',
  text: 'Plan trips together',
  outerHTML: '<h1 class="hero title">Plan trips together</h1>',
  styles: { color: 'rgb(15, 15, 15)', fontSize: '32px' },
  rect: { x: 100, y: 80, width: 320, height: 48 },
  ...over,
});

/** A queued SCREEN pick — the V4-10 menu "send-to-chat" synthetic event. */
const screenPick = (seq: number, over: Partial<QueuedScreenPick> = {}): QueuedScreenPick => ({
  seq,
  kind: 'screen',
  screen: 'home',
  screenUrl: 'http://127.0.0.1:5173/home.html',
  at: 1731500000000,
  additive: false,
  width: 1280,
  height: 800,
  file: 'C:\\Users\\me\\Documents\\Design Canvas\\site\\home.html',
  ...over,
});

test('an element queued pick keeps the exact chip shape every pick path shares', () => {
  const chip = attachDialog.buildAttachPayload(elementPick(7));
  assert.equal(chip.providerId, 'design-canvas');
  assert.equal(chip.id, 'element-7');
  assert.equal(chip.title, '#view-hero > h1');
  assert.equal(chip.url, 'http://127.0.0.1:5173/checkout.html');
  assert.equal((chip.data as Record<string, unknown>).selector, chip.title);
  assert.match(chip.text!, /^Reference from Design Canvas/);
  assert.match(chip.text!, /Picked at \d{2}:\d{2}:\d{2}/, 'the queue entry\'s `at` stamps the moment line');
  assert.match(chip.text!, /#view-hero > h1/);
  assert.match(chip.text!, /```html/, 'the markup block rides on element chips');
});

test('an element queued pick carries its Screen line, screen URL and data.screen fields', () => {
  const chip = attachDialog.buildAttachPayload(elementPick(8));
  assert.match(chip.text!, /Screen: checkout/);
  assert.match(chip.text!, /Screen URL: http:\/\/127\.0\.0\.1:5173\/checkout\.html/);
  const data = chip.data as { screen?: string; screenUrl?: string };
  assert.equal(data.screen, 'checkout');
  assert.equal(data.screenUrl, 'http://127.0.0.1:5173/checkout.html');
  assert.equal(chip.providerId, 'design-canvas');
});

test('a screen queued pick is the V4-10 chip: title + url + file, no selector/styles block', () => {
  const chip = attachDialog.buildAttachPayload(screenPick(9));
  assert.equal(chip.providerId, 'design-canvas');
  assert.equal(chip.id, 'screen-9');
  assert.equal(chip.url, 'http://127.0.0.1:5173/home.html');
  // Exact spec §V4-10 chip shape:
  assert.match(chip.text!, /^Reference from Design Canvas\n/);
  assert.match(chip.text!, /^.*Screen: home \(1280×800\) — C:\\Users\\me\\Documents\\Design Canvas\\site\\home\.html$/m);
  assert.match(chip.text!, /^Screen URL: http:\/\/127\.0\.0\.1:5173\/home\.html$/m);
  // …and NO selector, styles or markup block:
  assert.doesNotMatch(chip.text!, /Selector:/);
  assert.doesNotMatch(chip.text!, /Current styles:/);
  assert.doesNotMatch(chip.text!, /Markup:/);
  assert.doesNotMatch(chip.text!, /```html/);
  const data = chip.data as Record<string, unknown>;
  assert.equal(data.screen, 'home');
  assert.equal(data.screenUrl, 'http://127.0.0.1:5173/home.html');
  assert.equal(data.width, 1280);
  assert.equal(data.height, 800);
  assert.equal(data.file, 'C:\\Users\\me\\Documents\\Design Canvas\\site\\home.html');
  assert.equal(data.selector, undefined);
  assert.equal(data.styles, undefined);
});

test('the screen chip title names the screen and its size (readable in the composer)', () => {
  const chip = attachDialog.buildAttachPayload(screenPick(10, { screen: 'phone', width: 390, height: 844 }));
  assert.equal(chip.title, 'Screen · phone');
  assert.match(chip.text!, /Screen: phone \(390×844\) —/);
});

test('two picks of the same element/screen each get their own chip id (the queue delivers ALL)', () => {
  const first = attachDialog.buildAttachPayload(elementPick(7));
  const second = attachDialog.buildAttachPayload(elementPick(8));
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.data, second.data, 'identical elements carry identical context');
  const screenA = attachDialog.buildAttachPayload(screenPick(11));
  const screenB = attachDialog.buildAttachPayload(screenPick(12));
  assert.notEqual(screenA.id, screenB.id);
});

test('a malformed element entry degrades to empty fields, never a thrown chip build', () => {
  const broken = { seq: 13, kind: 'element', screen: 'home', screenUrl: 'http://127.0.0.1:5173/home.html', at: 1731500000000, additive: false } as unknown as QueuedElementPick;
  const chip = attachDialog.buildAttachPayload(broken);
  assert.equal(chip.id, 'element-13');
  assert.equal(chip.title, '');
  assert.match(chip.text!, /Selector: /);
});

test('an at that is not a timestamp omits the moment line instead of stamping Invalid Date', () => {
  const chip = attachDialog.buildAttachPayload(screenPick(14, { at: Number.NaN }));
  assert.doesNotMatch(chip.text!, /Picked at/);
});

// ---- F6: every pick chip names the workspace and the file the model edits ----

/** A win32 workspace dir, as the service hands it (native `\` separators). */
const WIN_WS = ['C:', 'Users', 'me', 'Documents', 'Design Canvas', 'site'].join('\\');
const winFile = (...parts: string[]): string => [WIN_WS, ...parts].join('\\');
const lines = (text: string | undefined): string[] => (text ?? '').split('\n');

test('F6: an element chip with a workspace context carries Workspace:, File: (screen id → file) and the path rule', () => {
  const chip = attachDialog.buildAttachPayload(elementPick(20), {
    workspaceDir: WIN_WS,
    screens: [{ id: 'checkout', url: 'http://127.0.0.1:5173/pages/checkout.html' }],
  });
  assert.ok(lines(chip.text).includes(`Workspace: ${WIN_WS}`), chip.text);
  assert.ok(lines(chip.text).includes(`File: ${winFile('pages', 'checkout.html')}`), 'the live screen url maps to the file, in the workspace separator style');
  assert.ok(lines(chip.text).includes(workspacePathRule(WIN_WS)), 'the exact workspacePathRule the mode chip uses');
  assert.ok(chip.text!.indexOf('File:') < chip.text!.indexOf('Selector:'), 'the location sits above the selector/markup, so trimming never drops it');
  const data = chip.data as { workspace?: string; filePath?: string };
  assert.equal(data.workspace, WIN_WS);
  assert.equal(data.filePath, winFile('pages', 'checkout.html'));
});

test('F6: with no live screen entry the element chip falls back to its own screen URL path (POSIX dir)', () => {
  const chip = attachDialog.buildAttachPayload(elementPick(21), { workspaceDir: '/home/me/Design Canvas/site' });
  assert.match(chip.text!, /^File: \/home\/me\/Design Canvas\/site\/checkout\.html$/m);
});

test('F6: a screen chip keeps its V4-10 lines and adds Workspace:/File: — an absolute registry file passes through', () => {
  const chip = attachDialog.buildAttachPayload(screenPick(22), { workspaceDir: WIN_WS });
  assert.match(chip.text!, /^Screen: home \(1280×800\) — /m);
  assert.ok(lines(chip.text).includes(`Workspace: ${WIN_WS}`));
  assert.ok(lines(chip.text).includes(`File: ${winFile('home.html')}`), 'the registry file (already absolute) passes through');
  const relative = attachDialog.buildAttachPayload(screenPick(23, { file: 'home.html' }), { workspaceDir: '/ws/site' });
  assert.match(relative.text!, /^File: \/ws\/site\/home\.html$/m, 'a relative registry file is joined onto the workspace');
});

test('F6: without a workspace context the chips are unchanged (no Workspace:/File: lines)', () => {
  assert.doesNotMatch(attachDialog.buildAttachPayload(elementPick(24)).text!, /^(Workspace|File):/m);
  assert.doesNotMatch(attachDialog.buildAttachPayload(screenPick(25), null).text!, /^(Workspace|File):/m);
});

test('F6: an oversized element chip stays under the host cap by trimming markup first — the path lines survive', () => {
  const huge = elementPick(26, { outerHTML: `<div>${'x'.repeat(40_000)}</div>` });
  const chip = attachDialog.buildAttachPayload(huge, { workspaceDir: '/ws/site' });
  assert.ok(chip.text!.length <= 16_000, `capped (got ${chip.text!.length})`);
  assert.match(chip.text!, /^File: \/ws\/site\/checkout\.html$/m);
  assert.match(chip.text!, /markup truncated/);
  assert.match(chip.text!, /Current styles:/, 'styles survive when trimming the markup was enough');
});
