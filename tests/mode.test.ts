import { test } from 'node:test';
import assert from 'node:assert/strict';

// This file imports from `panel/api.ts` too (the chip-data boundary cross-check
// with mode.ts), and api.ts calls `connectHost()` at import time, which needs a
// `window`. Install the same minimal shim panel-open.test.ts uses, then import
// dynamically (ESM imports hoist; the shim must exist first).
const shim = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  parent: { postMessage: () => undefined },
};
(globalThis as { window?: unknown }).window = shim;
(globalThis as { document?: unknown }).document = {
  getElementById: () => ({ append: () => undefined }),
  documentElement: {},
};

const { DEFAULT_MODE, GUEST_ATTACH_TEXT_MAX, VERIFY_PROTOCOL, attachUrl, buildModeChip, designSessionPrompt, isHttpUrl, modeStorageKey, workspaceStorageKey, parseDesignArgs, seedModeFromConfig, seedModeValue, seedSessionData, NO_DESIGN_SYSTEM, designSystemGroups, designSystemLabel, designSystemSwatches, filterDesignSystems, findDesignSystem, isColorTokenValue, attachAvailable, designMarkerKey, designMarkerValue, designSessionIdFromKey, fileBaseName, fileReferenceChip, isDesignMarker, popoverStep, projectHttpUrl, projectReferenceChip } = await import('../panel/mode.ts');
const { isModeChipData } = await import('../panel/api.ts');
const { DESIGN_SYSTEMS } = await import('../shared/design-systems.ts');
// A type-only import: erased at compile time, so it needs no window shim.
import type { DesignMode } from '../panel/mode.ts';

const WORKSPACE = { dir: '/p/site', name: 'Site' };

test('mode argument parsing', () => {
  assert.deepEqual(parseDesignArgs(''), { on: true, mode: null, type: null, brief: '' });
  assert.deepEqual(parseDesignArgs('off'), { on: false, mode: null, type: null, brief: '' });
  assert.deepEqual(parseDesignArgs('on'), { on: true, mode: null, type: null, brief: '' });
  assert.deepEqual(parseDesignArgs('play'), { on: true, mode: 'play', type: null, brief: '' });
  assert.deepEqual(parseDesignArgs('edit'), { on: true, mode: 'edit', type: null, brief: '' });
  assert.deepEqual(parseDesignArgs('play checkout flow'), { on: true, mode: 'play', type: null, brief: 'checkout flow' });
  assert.deepEqual(parseDesignArgs('hi-fi fintech landing'), { on: true, mode: null, type: 'hi-fi', brief: 'fintech landing' });
  assert.deepEqual(parseDesignArgs('dashboard for traders'), { on: true, mode: null, type: null, brief: 'dashboard for traders' });
});

test('mode chip carries context, the workspace path rule and replaces itself by id', () => {
  const mode: DesignMode = { ...DEFAULT_MODE, on: true, type: 'prototype', brief: 'storefront' };
  const chip = buildModeChip('ses_123', mode, WORKSPACE, [], 'http://localhost:5173');
  assert.equal(chip.providerId, 'design-canvas');
  assert.match(chip.id ?? '', /^design-mode-ses_123/);
  assert.match(chip.title ?? '', /prototype/);
  assert.match(chip.text ?? '', /Design Mode: ON/);
  assert.match(chip.text ?? '', /Canvas mode: edit/);
  assert.match(chip.text ?? '', /Workspace: \/p\/site/);
  assert.match(chip.text ?? '', /the ONLY place design files are written/);
  assert.match(chip.url ?? '', /http:\/\/localhost:5173/);
  assert.equal(typeof chip.data, 'object');
  assert.equal(buildModeChip('ses_123', mode, WORKSPACE, [], 'http://localhost:5173').id, chip.id, 'same session → same chip id → replaced, not stacked');
});

test('the mode chip carries the screens list capped at 40 and the trimmed rules only', () => {
  const mode: DesignMode = { ...DEFAULT_MODE, on: true, type: 'hi-fi' };
  const screens = Array.from({ length: 45 }, (_, i) => ({ id: `s${i}`, file: `s${i}.html`, title: `Screen ${i}` }));
  const chip = buildModeChip('ses_budget', mode, WORKSPACE, screens);
  assert.match(chip.text ?? '', /Screens \(45\):/);
  assert.match(chip.text ?? '', /- s0 · Screen 0 · s0\.html/);
  assert.match(chip.text ?? '', /… 5 more/);
  assert.doesNotMatch(chip.text ?? '', /- s44 ·/, 'the 45th screen is beyond the cap');
  // Trimmed rules: IDENTITY + design-system authority + VERIFY_PROTOCOL only —
  // the full craft rulebook ships via designSessionPrompt instead (audit #16).
  assert.match(chip.text ?? '', /You are an expert designer/);
  assert.match(chip.text ?? '', /DESIGN\.md and tokens\.css/);
  assert.match(chip.text ?? '', /at most 5 fix\/verify iterations OR 10 minutes/);
  assert.doesNotMatch(chip.text ?? '', /Hick: cut the number/, 'the laws-of-ux rulebook is NOT in the chip');
  assert.doesNotMatch(chip.text ?? '', /Build one modular scale/, 'the typography rulebook is NOT in the chip');
  assert.ok((chip.text ?? '').length <= GUEST_ATTACH_TEXT_MAX + 1, 'the chip text respects the attach cap');
});

test('mode storage key follows the session', () => {
  assert.equal(modeStorageKey('ses_x'), 'mode/ses_x');
  assert.equal(modeStorageKey(null), null);
});

test('workspace storage key follows the session (ws/<sessionId>)', () => {
  assert.equal(workspaceStorageKey('ses_x'), 'ws/ses_x');
  assert.equal(workspaceStorageKey(null), null);
});

test('verification protocol reaches both the session prompt and the mode chip', () => {
  const text = designSessionPrompt({ type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', brief: 'x' }, WORKSPACE);
  const chip = buildModeChip('ses_verify', { ...DEFAULT_MODE, on: true }, WORKSPACE);
  for (const out of [text, chip.text ?? '']) {
    assert.ok(out.includes(VERIFY_PROTOCOL), 'protocol text is embedded verbatim');
    assert.match(out, /overflow → design tokens → accessibility → semantics → layout/);
    assert.ok(!/visual baselines/.test(out), 'the protocol no longer mentions visual baselines');
    assert.match(out, /at most 5 fix\/verify iterations OR 10 minutes, whichever comes first/);
    assert.match(out, /Never mark the work done while any P0 remains/);
    assert.match(out, /state the breakpoints you checked/);
  }
  assert.match(text, /Before editing, state the change's acceptance criteria in one line\./);
});

test('design session prompt: names the absolute workspace path as the only place design files live', () => {
  const text = designSessionPrompt(
    { type: 'prototype', direction: 'tech-utility', fidelity: 'interactive', brief: 'traders dashboard' },
    { dir: 'C:\\Users\\samhe\\Documents\\Design Canvas\\traders-3f2a', name: 'traders dashboard' },
  );
  assert.match(text, /Design brief — prototype/);
  assert.match(text, /Brief: traders dashboard/);
  assert.match(text, /Design Canvas workspace: C:\\Users\\samhe\\Documents\\Design Canvas\\traders-3f2a/);
  assert.match(text, /the ONLY place design files are written/);
  assert.match(text, /absolute path in EVERY file write, edit and bash call/);
  assert.match(text, /screens\.json/);
  assert.doesNotMatch(text, /Scaffold the project/, 'the agent no longer scaffolds projects');
});

test('design session prompt: the full craft rulebook ships here, not in the chip', () => {
  const text = designSessionPrompt({ type: 'wireframe', direction: 'auto', fidelity: 'wireframe', brief: '' }, null);
  assert.match(text, /Brief: none given/);
  assert.match(text, /Build one modular scale/, 'the typography rules are in the session prompt');
  assert.match(text, /Hick: cut the number/, 'the laws-of-ux rules are in the session prompt');
  assert.match(text, /created by the Design Canvas service/, 'a missing workspace is described, not refused');
});

test('seed mode from config maps unknown types to custom', () => {
  assert.deepEqual(seedModeFromConfig({ version: 1, type: 'prototype' }), { on: true, type: 'prototype' });
  assert.deepEqual(seedModeFromConfig({ version: 1, type: 'banner' }), { on: true, type: 'custom' });
  assert.deepEqual(seedModeFromConfig(null), { on: true, type: 'custom' });
});

test('seed mode value is a persisted Design Mode payload', () => {
  const seeded = seedModeValue('deck', 'q3 review'.repeat(400));
  assert.equal(seeded.on, true);
  assert.equal(seeded.type, 'deck');
  assert.equal(seeded.canvMode, 'edit');
  assert.ok(seeded.brief.length <= 2000, 'brief is clamped for storage');
  assert.equal(seedModeValue('deck', '', 'play').canvMode, 'play');
});

test('attach url: the host rejects anything but http(s)', () => {
  assert.equal(isHttpUrl('http://localhost:5173'), true);
  assert.equal(isHttpUrl('https://example.com/x'), true);
  assert.equal(isHttpUrl('about:blank'), false);
  assert.equal(isHttpUrl('design.local/session'), false);
  assert.equal(isHttpUrl(''), false);
  assert.equal(isHttpUrl(undefined), false);
  assert.equal(attachUrl('http://localhost:5173'), 'http://localhost:5173');
  assert.equal(attachUrl(''), 'https://design.local/session');
  assert.equal(attachUrl(undefined), 'https://design.local/session');
});

// ---- design-system presets: the picker's pure rules ----

test('design system label is the default, else the preset name', () => {
  assert.equal(NO_DESIGN_SYSTEM, 'No design system');
  assert.equal(designSystemLabel(null), NO_DESIGN_SYSTEM);
  assert.equal(designSystemLabel(undefined), NO_DESIGN_SYSTEM);
  assert.equal(designSystemLabel('nope'), NO_DESIGN_SYSTEM, 'an unknown id falls back to the default');
  assert.equal(designSystemLabel('apple'), 'Apple');
  assert.equal(designSystemLabel('linear-app'), 'Linear');
});

test('findDesignSystem resolves a preset by id and null otherwise', () => {
  assert.equal(findDesignSystem('stripe')?.category, 'Fintech & Crypto');
  assert.equal(findDesignSystem('apple')?.name, 'Apple');
  assert.equal(findDesignSystem(null), null);
  assert.equal(findDesignSystem(undefined), null);
  assert.equal(findDesignSystem('missing-id'), null);
});

test('filterDesignSystems matches name, category and description, case-insensitively', () => {
  assert.equal(filterDesignSystems('').length, DESIGN_SYSTEMS.length, 'an empty query keeps every preset');
  assert.equal(filterDesignSystems('   ').length, DESIGN_SYSTEMS.length, 'a whitespace query keeps every preset');
  assert.ok(filterDesignSystems('apple').some((preset) => preset.id === 'apple'), 'name match');
  assert.ok(filterDesignSystems('APPLE').some((preset) => preset.id === 'apple'), 'case-insensitive');
  assert.ok(filterDesignSystems('fintech').some((preset) => preset.id === 'stripe'), 'category match');
  assert.ok(filterDesignSystems('glassmorphism').some((preset) => preset.id === 'glassmorphism'), 'name match');
  assert.equal(filterDesignSystems('zzz-no-such-system').length, 0, 'no match is an empty list');
});

test('designSystemGroups groups by category and keeps the catalog order', () => {
  const groups = designSystemGroups(DESIGN_SYSTEMS);
  const categories = groups.map((group) => group.category);
  assert.equal(new Set(categories).size, categories.length, 'one group per category');
  assert.equal(groups.flatMap((group) => group.presets).length, DESIGN_SYSTEMS.length, 'every preset is grouped');
  assert.equal(categories[0], DESIGN_SYSTEMS[0]!.category, 'first-seen order follows the catalog');
  const narrowed = designSystemGroups(filterDesignSystems('fintech'));
  assert.ok(narrowed.every((group) => group.presets.length > 0));
});

test('designSystemSwatches keeps only paintable colour tokens, capped and ordered', () => {
  const apple = findDesignSystem('apple')!;
  const swatches = designSystemSwatches(apple);
  assert.ok(swatches.length >= 4 && swatches.length <= 8, 'a glance, capped at 8');
  for (const swatch of swatches) {
    assert.match(swatch.name, /^--/, 'every swatch names a token');
    assert.equal(isColorTokenValue(swatch.value), true, `${swatch.name} must be a literal colour`);
  }
  assert.ok(swatches.some((swatch) => swatch.name === '--accent'), 'the preset accent is in the strip');

  assert.equal(isColorTokenValue('#fff'), true);
  assert.equal(isColorTokenValue('rgba(0, 0, 0, 0.5)'), true);
  assert.equal(isColorTokenValue('hsl(210 10% 50%)'), true);
  assert.equal(isColorTokenValue('var(--accent)'), false, 'a var() indirection is left out');
  assert.equal(isColorTokenValue('color-mix(in oklab, red, blue)'), false, 'an unresolvable mix is left out');
});

test('designSessionPrompt names the chosen design system and calls it authoritative', () => {
  const text = designSessionPrompt(
    { type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', brief: 'landing', designSystemId: 'stripe' },
    WORKSPACE,
  );
  assert.match(text, /Design system: Stripe \(Fintech & Crypto\)/);
  assert.match(text, /its tokens and DESIGN\.md are authoritative/);
});

test('designSessionPrompt is byte-for-byte unchanged when no design system is chosen', () => {
  const base = { type: 'hi-fi' as const, direction: 'auto' as const, fidelity: 'hi-fi' as const, brief: 'landing' };
  const without = designSessionPrompt(base, WORKSPACE);
  assert.equal(designSessionPrompt({ ...base, designSystemId: null }, WORKSPACE), without, 'an explicit null adds nothing');
  assert.equal(designSessionPrompt({ ...base, designSystemId: undefined }, WORKSPACE), without, 'undefined adds nothing');
  assert.equal(designSessionPrompt({ ...base, designSystemId: 'no-such-id' }, WORKSPACE), without, 'an unknown id adds nothing');
  assert.doesNotMatch(without, /Design system: \w/, 'no preset line appears by default');
  const withConfig = designSessionPrompt(
    { ...base, designSystemId: 'apple' },
    { dir: '/p/site', name: 'Site' },
  );
  assert.match(withConfig, /Design system: Apple \(Media & Consumer\)/);
});

// ---- the persistent design marker ----

test('design marker keys round-trip and never collide with other keys', () => {
  assert.equal(designMarkerKey('ses_x'), 'design/ses_x');
  assert.equal(designMarkerKey(null), null);
  assert.equal(designSessionIdFromKey(modeStorageKey('ses_x')!), null, 'a mode/ key is not a marker');
  assert.equal(designSessionIdFromKey('lastUrl//projects/site'), null, 'a lastUrl/ key is not a marker');
  assert.equal(designSessionIdFromKey('design/'), null, 'a bare prefix names nothing');
  assert.equal(designSessionIdFromKey(designMarkerKey('a/b')!), 'a/b', 'the id keeps its own slashes');
});

test('a design marker value is a permanent ON with an ISO moment', () => {
  const value = designMarkerValue(new Date('2026-01-02T03:04:05.678Z'));
  assert.deepEqual(value, { on: true, at: '2026-01-02T03:04:05.678Z' });
  assert.equal(isDesignMarker(value), true);
  assert.equal(isDesignMarker({ on: true, at: 'x', extra: 1 }), true, 'extra fields never invalidate it');
  assert.equal(isDesignMarker({ on: false, at: 'x' }), false);
  assert.equal(isDesignMarker({ at: 'x' }), false);
  assert.equal(isDesignMarker(null), false);
  assert.equal(isDesignMarker('design/on'), false, 'a bare string is not a marker');
});

// ---- attach sources ----

test('fileBaseName reduces a path to its last segment', () => {
  assert.equal(fileBaseName('src/app.ts'), 'app.ts');
  assert.equal(fileBaseName('a/b/c.txt'), 'c.txt');
  assert.equal(fileBaseName('/p/site/'), 'site', 'a trailing separator is ignored');
  assert.equal(fileBaseName('solo'), 'solo');
});

test('a reference is attachable only when the workspace has an http(s) url', () => {
  assert.equal(projectHttpUrl({ url: 'http://localhost:5173' }), 'http://localhost:5173');
  assert.equal(projectHttpUrl({ url: 'https://x.test/a' }), 'https://x.test/a');
  assert.equal(projectHttpUrl({ url: '  http://localhost:5173  ' }), 'http://localhost:5173');
  assert.equal(projectHttpUrl({ url: 'about:blank' }), null, 'a non-http url cannot become a chip');
  assert.equal(projectHttpUrl({ url: '' }), null);
  assert.equal(projectHttpUrl(null), null);
  assert.equal(attachAvailable({ url: 'https://x.test' }), true);
  assert.equal(attachAvailable({ url: 'about:blank' }), false);
  assert.equal(attachAvailable(null), false, 'no config means no + at all');
});

test('the workspace reference chip names the workspace and its dir', () => {
  const chip = projectReferenceChip({ projectId: 'p1', dir: '/p/site', name: 'Site', url: 'http://localhost:5173' });
  assert.equal(chip.providerId, 'design-canvas');
  assert.equal(chip.id, 'project-p1');
  assert.equal(chip.title, 'Site');
  assert.equal(chip.url, 'http://localhost:5173');
  assert.equal(chip.text, 'Workspace reference: /p/site');
  // No registered id (decision 2 default): the directory's basename identifies it.
  assert.equal(projectReferenceChip({ dir: '/p/site', name: 'Site', url: 'http://x' }).id, 'project-site');
});

test('the file reference chip names the file and its path, under the workspace url', () => {
  const chip = fileReferenceChip({ path: 'src/app.ts', url: 'http://localhost:5173' });
  assert.equal(chip.providerId, 'design-canvas');
  assert.equal(chip.id, 'file-app.ts', 'the basename ids the chip, so re-referencing replaces it');
  assert.equal(chip.title, 'app.ts');
  assert.equal(chip.url, 'http://localhost:5173', 'a file chip still carries the http(s) url');
  assert.equal(chip.text, 'File reference: src/app.ts');
  // A DROPPED file (no path available in the guest) is referenced by name.
  const dropped = fileReferenceChip({ path: 'hero.png', url: 'http://x', dropped: true });
  assert.equal(dropped.id, 'file-hero.png');
  assert.equal(dropped.text, 'File reference: hero.png (dropped into Design Canvas)');
  assert.equal(dropped.url, 'http://x');
});

// The payload a page-started session carries is the chip's own data shape,
// so `isModeChipData` reads it and the session is a canvas chat from birth.
test('seedSessionData is the mode-chip data shape a session snapshot echoes back', () => {
  const data = seedSessionData('deck', 'q3 review'.repeat(400), WORKSPACE);
  assert.equal(data.mode.on, true);
  assert.equal(data.mode.type, 'deck');
  assert.equal(data.mode.canvMode, 'edit');
  assert.ok(data.mode.brief.length <= 2000, 'brief is clamped like the storage payload');
  assert.deepEqual(data.workspace, WORKSPACE, 'the workspace record rides on the session data');
  assert.equal(isModeChipData(data), true, 'the SAME detection rule reads it — one shape, no drift');
  assert.equal(isModeChipData(seedSessionData('hi-fi', '')), true);
});

// ---- the shared popover keyboard math ----

test('popoverStep walks a list, wraps at both ends and enters from the right side', () => {
  assert.equal(popoverStep(-1, 3, 1), 0, 'nothing focused enters at the top going down');
  assert.equal(popoverStep(-1, 3, -1), 2, 'nothing focused enters at the bottom going up');
  assert.equal(popoverStep(0, 3, 1), 1);
  assert.equal(popoverStep(2, 3, 1), 0, 'wraps forward');
  assert.equal(popoverStep(0, 3, -1), 2, 'wraps back');
  assert.equal(popoverStep(0, 0, 1), -1, 'an empty list has no next');
});