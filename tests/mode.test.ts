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

const { DEFAULT_MODE, GUEST_ATTACH_TEXT_MAX, VERIFY_PROTOCOL, attachUrl, buildModeChip, designSessionPrompt, isHttpUrl, modeStorageKey, workspaceStorageKey, parseDesignArgs, seedModeValue, seedSessionData, NO_DESIGN_SYSTEM, designSystemGroups, designSystemLabel, designSystemSwatches, filterDesignSystems, findDesignSystem, isColorTokenValue, designMarkerKey, designMarkerValue, designSessionIdFromKey, fileBaseName, fileReferenceChip, isDesignMarker, popoverStep, projectHttpUrl, projectReferenceChip, parseCanvasExportArgs, exportJobSummary, exportFailureSummary, critiqueReviewText, critiqueReviewChip, CRITIQUE_ADVISORY, BRIEF_MAX, CRAFT_BY_TYPE, DESIGN_TYPES, DEVICE_PRESETS, FIDELITIES, FIDELITY_FOR_TYPE, buildCompactModeChip, devicesLabel, structureBrief, workspaceOpenPrompt } = await import('../panel/mode.ts');
const { CANVAS_PROTOCOL, CANVAS_PROTOCOL_CHIP, CRAFT_RULES, DESIGN_AUTHORITY, IDENTITY, WORKING_AGREEMENT_CHIP, WORKING_AGREEMENT_COMPACT, firstReplyContract } = await import('../shared/harness-text.ts');
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

test('design session prompt: the craft subset for the type ships here, not in the chip', () => {
  const text = designSessionPrompt({ type: 'wireframe', direction: 'auto', fidelity: 'wireframe', brief: '' }, null);
  assert.match(text, /Brief: none given — ask 3–6 questions with a bold recommended default each/);
  assert.match(text, /Hick: cut the number/, 'the laws-of-ux rules are in the wireframe prompt');
  assert.doesNotMatch(text, /Build one modular scale/, 'a wireframe carries no typography rulebook');
  assert.match(text, /created by the Design Canvas service/, 'a missing workspace is described, not refused');
  const hifi = designSessionPrompt({ type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', brief: 'x' }, null);
  for (const id of CRAFT_BY_TYPE['hi-fi']) assert.ok(hifi.includes(`### ${id}\n${CRAFT_RULES[id]}`), `hi-fi ships ${id}`);
  assert.match(hifi, /Build one modular scale/);
  assert.doesNotMatch(text, /follow them over any conflicting instinct/, 'the old authority line is gone');
});

test('design session prompt carries the agreement chip, first-reply contract and authority', () => {
  const text = designSessionPrompt({ type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', brief: 'x' }, WORKSPACE);
  assert.ok(text.includes(WORKING_AGREEMENT_CHIP));
  assert.ok(text.includes(firstReplyContract(true)));
  assert.ok(text.includes(DESIGN_AUTHORITY));
  assert.ok(text.includes(IDENTITY));
  assert.ok(!text.includes('## Working agreement'), 'the full working agreement does not fit the budget');
  assert.match(text, /Questions first: on · Options: ask the user · Devices: not chosen yet/);
});

test('design session prompt names the user project and the chosen devices', () => {
  const text = designSessionPrompt(
    { type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', brief: 'x', projectDir: 'C:\\code\\app', devices: ['phone', 'desktop'], look: 'project' },
    WORKSPACE,
  );
  assert.ok(text.split('\n').includes('User project: "C:\\\\code\\\\app" — read it first for design context; never write design files there.'));
  assert.match(text, /Devices: phone 390×844 · desktop 1440×900/);
  assert.match(text, /Look: take it from the user's project/);
  assert.doesNotMatch(designSessionPrompt({ type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', brief: 'x' }, WORKSPACE), /User project:/);
});

test('devicesLabel and DEVICE_PRESETS name the artboard sizes', () => {
  assert.deepEqual(DEVICE_PRESETS.phone, { label: 'phone', width: 390, height: 844 });
  assert.deepEqual(DEVICE_PRESETS.tablet, { label: 'tablet', width: 768, height: 1024 });
  assert.deepEqual(DEVICE_PRESETS.desktop, { label: 'desktop', width: 1440, height: 900 });
  assert.equal(devicesLabel(['phone', 'tablet', 'desktop']), 'phone 390×844 · tablet 768×1024 · desktop 1440×900');
  assert.equal(devicesLabel(undefined), 'not chosen yet — agree them first');
  assert.equal(devicesLabel([]), 'not chosen yet — agree them first');
});

test('FIDELITY_FOR_TYPE and CRAFT_BY_TYPE cover every design type', () => {
  for (const type of DESIGN_TYPES) {
    assert.ok(FIDELITIES.includes(FIDELITY_FOR_TYPE[type]), `${type} has a fidelity`);
    assert.ok(CRAFT_BY_TYPE[type].length > 0, `${type} has craft rules`);
    for (const id of CRAFT_BY_TYPE[type]) assert.ok(id in CRAFT_RULES, `${type}: ${id} is a real rule`);
  }
  assert.equal(FIDELITY_FOR_TYPE.prototype, 'interactive');
  assert.equal(FIDELITY_FOR_TYPE.wireframe, 'wireframe');
});

test('structureBrief re-flows without inventing and is idempotent', () => {
  const raw = 'A booking app for dog walkers. Owners book a walk in two taps!\n\n  * Phone first\n2) Real names, prices';
  const out = structureBrief(raw);
  assert.equal(out, '- A booking app for dog walkers.\n- Owners book a walk in two taps!\n- Phone first\n- Real names, prices');
  assert.equal(structureBrief(out), out, 'idempotent');
  assert.equal(structureBrief(''), '');
  assert.equal(structureBrief('   \n '), '');
  for (const sample of ['- 1. Foo. Bar', '- - x', 'one. 2. Two', 'Plain text with no stop', 'Hi. "Quoted" next. (paren) last']) {
    const once = structureBrief(sample);
    assert.equal(structureBrief(once), once, `idempotent for ${JSON.stringify(sample)}`);
    const words = (s: string) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '').split(/\s+/).filter((w) => !/^(?:[-*•]|\d+[.)])$/.test(w));
    for (const word of words(once)) assert.ok(sample.includes(word), `never invents: ${word}`);
  }
});

test('the budget holds: session prompt at BRIEF_MAX and the 45-screen chip stay ≤ 15500', () => {
  const ws = { dir: 'C:\\Users\\samhe\\Documents\\Design Canvas\\a-very-long-workspace-name-for-the-budget-1234567890', name: 'x' };
  const screens = Array.from({ length: 45 }, (_, i) => ({
    id: `screen-${String(i).padStart(2, '0')}-abcdefghijklmnop`,
    file: `screen-${String(i).padStart(2, '0')}-abcdefghijklmnop.html`,
    title: `Screen ${String(i).padStart(2, '0')} with a long descriptive title`,
  }));
  const brief = 'x'.repeat(BRIEF_MAX);
  let worst = 0;
  for (const type of DESIGN_TYPES) {
    for (const questions of [true, false]) {
      const text = designSessionPrompt(
        { type, direction: 'auto', fidelity: 'interactive', brief, designSystemId: 'stripe', projectDir: 'C:\\Users\\samhe\\Documents\\GitHub\\some-project', questions, options: 3, devices: ['phone', 'tablet', 'desktop'], look: 'project' },
        ws,
      );
      worst = Math.max(worst, text.length);
    }
  }
  const chip = buildModeChip('ses_budget45', { ...DEFAULT_MODE, on: true, brief: 'y'.repeat(2000), devices: ['phone', 'tablet', 'desktop'] }, ws, screens);
  const compact = buildCompactModeChip('ses_budget45', { ...DEFAULT_MODE, on: true }, ws, screens);
  console.info('P2 budget measurement:', JSON.stringify({ sessionPromptWorst: worst, chip: (chip.text ?? '').length, compact: (compact.text ?? '').length }));
  assert.ok(worst <= 15500, `session prompt ${worst} ≤ 15500`);
  assert.ok((chip.text ?? '').length <= 15500, `mode chip ${(chip.text ?? '').length} ≤ 15500`);
});

test('the mode chip carries the agreement status line; old stored modes read as defaults', () => {
  const chip = buildModeChip('ses_s', { ...DEFAULT_MODE, on: true }, WORKSPACE);
  const lines = (chip.text ?? '').split('\n');
  const at = lines.findIndex((line) => line.startsWith('Visual direction:'));
  assert.equal(lines[at + 1], 'Questions first: on · Options: ask the user · Devices: not chosen yet — agree them first');
  const off = buildModeChip('ses_s', { ...DEFAULT_MODE, on: true, questions: false, options: 2, devices: ['phone'] }, WORKSPACE);
  assert.match(off.text ?? '', /Questions first: off · Options: 2 · Devices: phone 390×844/);
  assert.match(off.text ?? '', /turned questions off/);
  assert.doesNotMatch(off.text ?? '', /numbered questions/);
  assert.equal((off.data as { mode: { questions?: boolean } }).mode.questions, false);
  assert.equal('questions' in (chip.data as { mode: object }).mode, false, 'defaults add nothing to the data');
});

test('the compact chip carries the compact agreement after the path rule', () => {
  const compact = buildCompactModeChip('ses_c', { ...DEFAULT_MODE, on: true }, WORKSPACE);
  const lines = (compact.text ?? '').split('\n');
  const rule = lines.findIndex((line) => line.includes('the ONLY place design files are written'));
  assert.equal(lines[rule + 1], WORKING_AGREEMENT_COMPACT);
});

test('the workspace open prompt points at BRIEF.md and DESIGN.md and carries the agreement', () => {
  const text = workspaceOpenPrompt(WORKSPACE);
  assert.match(text, /Reopening this canvas: open the Design Canvas browser, then read BRIEF\.md and DESIGN\.md in the workspace first/);
  assert.doesNotMatch(text, /reuse what is already there/);
  assert.ok(text.indexOf(IDENTITY) < text.indexOf(WORKING_AGREEMENT_CHIP));
  assert.ok(text.indexOf(WORKING_AGREEMENT_CHIP) < text.indexOf(DESIGN_AUTHORITY));
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

// ---- the CANVAS_PROTOCOL wording (SPEC-V3-P2-SCOPE.md D8 — verbatim) ----

test('CANVAS_PROTOCOL ships the D8 wording verbatim: five lines, exact openings', () => {
  const lines = CANVAS_PROTOCOL.split('\n');
  assert.equal(lines.length, 5, 'exactly the five D8 lines');
  const openings = [
    'Screens are artboards on one shared canvas. The',
    'Add or change a screen: write its HTML',
    'Positions are not design content: never write',
    'Variants = side-by-side artboards. "Two directions", "options",',
    'Responsive = one artboard per real size. Presets:',
  ];
  for (const [index, opening] of openings.entries()) {
    assert.equal(lines[index]!.slice(0, opening.length), opening, `line ${index + 1} opens verbatim`);
  }
  // The binding details, pinned individually.
  assert.match(lines[0]!, /\{ "version": 1, "screens": \[ \{ "id", "file", "title", "width", "height" \} \] \}/);
  assert.match(lines[1]!, /\^\[a-z0-9\]\[a-z0-9-\]\{0,30\}\$/);
  assert.match(lines[1]!, /sizes 200–8192/);
  assert.match(lines[2]!, /\.design-studio\/view\.json/);
  assert.match(lines[3]!, /2–3 complete sibling screens/);
  assert.match(lines[4]!, /390×844 phone · 768×1024 tablet · 1440×900 desktop \(default\) · 1280×800 laptop · 1080×1080 social post · 794×1123 A4 print at 96 dpi/);
  assert.match(lines[4]!, /three artboards of the same screen \(phone, tablet, desktop\)/);
});

test('the full protocol ships in the session prompt; the trimmed copy ships in the chip', () => {
  const text = designSessionPrompt({ type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', brief: 'x' }, WORKSPACE);
  assert.ok(text.includes(CANVAS_PROTOCOL), 'the prompt embeds the FULL protocol verbatim');
  const chip = buildModeChip('ses_p', { ...DEFAULT_MODE, on: true }, WORKSPACE);
  assert.ok((chip.text ?? '').includes(CANVAS_PROTOCOL_CHIP), 'the chip embeds the trimmed protocol verbatim');
  // Trimmed = D8 lines 1–2 verbatim + the preset numbers of 4–5; the
  // positions line (3) stays OUT of the chip.
  assert.ok((chip.text ?? '').includes('Screens are artboards on one shared canvas.'));
  assert.ok((chip.text ?? '').includes('^[a-z0-9][a-z0-9-]{0,30}$'));
  assert.ok((chip.text ?? '').includes('mean 2–3 complete sibling screens'));
  assert.ok((chip.text ?? '').includes('390×844 phone · 768×1024 tablet · 1440×900 desktop (default)'));
  assert.doesNotMatch(chip.text ?? '', /Positions are not design content/, 'the view.json positions line is not chip text');
  // The chip order (audit #16): protocol → screens → IDENTITY → authority → VERIFY_PROTOCOL.
  const t = chip.text ?? '';
  const at = (needle: string): number => { const i = t.indexOf(needle); assert.ok(i >= 0, `chip contains ${needle}`); return i; };
  assert.ok(at('screens.json') < at('You are an expert designer'), 'protocol before the trimmed rules');
  assert.ok(at('You are an expert designer') < at('DESIGN.md and tokens.css'), 'IDENTITY before authority');
  assert.ok(at('You are an expert designer') < at(WORKING_AGREEMENT_CHIP), 'IDENTITY before the agreement chip');
  assert.ok(at(WORKING_AGREEMENT_CHIP) < at('DESIGN.md and tokens.css'), 'the agreement chip before authority');
  assert.ok(at('DESIGN.md and tokens.css') < at('Before editing, state'), 'authority before VERIFY_PROTOCOL');
});

test('the chip budget holds at the 40-screen worst case with the protocol lines (≤16000)', () => {
  const mode: DesignMode = { ...DEFAULT_MODE, on: true, type: 'hi-fi', brief: 'worst case brief' };
  // Worst case within the cap: 40 screens at the registry's id/file/title limits.
  const screens = Array.from({ length: 40 }, (_, i) => ({
    id: `screen-${String(i).padStart(2, '0')}-abcdefghijklmnop`,
    file: `screen-${String(i).padStart(2, '0')}-abcdefghijklmnop.html`,
    title: `Screen ${String(i).padStart(2, '0')} with a long descriptive title`,
  }));
  const chip = buildModeChip('ses_budget_worst', mode, WORKSPACE, screens);
  const length = (chip.text ?? '').length;
  console.info('chip budget measurement:', JSON.stringify({ screens: 40, worstCaseChipLength: length, cap: GUEST_ATTACH_TEXT_MAX }));
  assert.ok(length <= GUEST_ATTACH_TEXT_MAX, `the assembled chip fits the cap (${length} ≤ ${GUEST_ATTACH_TEXT_MAX}) — if this ever overflows, drop the chip rules to IDENTITY+VERIFY_PROTOCOL only`);
  // The full rulebook stays out regardless of the budget.
  assert.doesNotMatch(chip.text ?? '', /Hick: cut the number/);
  assert.doesNotMatch(chip.text ?? '', /Build one modular scale/);
});

// ---- /canvas export: argument parsing and toast summaries ----

test('parseCanvasExportArgs accepts png/pdf mixes and refuses unknown tokens', () => {
  assert.deepEqual(parseCanvasExportArgs(''), {}, 'no tokens → formats omitted (both, service-side)');
  assert.deepEqual(parseCanvasExportArgs('png'), { formats: ['png'] });
  assert.deepEqual(parseCanvasExportArgs('pdf'), { formats: ['pdf'] });
  assert.deepEqual(parseCanvasExportArgs('png pdf'), { formats: ['png', 'pdf'] });
  assert.deepEqual(parseCanvasExportArgs('pdf png'), { formats: ['pdf', 'png'] });
  assert.deepEqual(parseCanvasExportArgs('PNG'), { formats: ['png'] }, 'case-insensitive');
  assert.deepEqual(parseCanvasExportArgs('png png'), { formats: ['png'] }, 'duplicates collapse');
  assert.deepEqual(parseCanvasExportArgs('svg'), { error: 'Unknown export format "svg" — use png, pdf, or both.' });
  assert.deepEqual(parseCanvasExportArgs('png jpeg'), { error: 'Unknown export format "jpeg" — use png, pdf, or both.' });
});

test('exportJobSummary counts files and per-screen failures, bounded for the toast', () => {
  const joiner = (file: string) => `C:\\Design Canvas\\ws\\exports\\${file}`;
  const summary = exportJobSummary({
    state: 'done',
    results: [
      { screen: 'home', png: { ok: true, file: joiner('home.png') }, pdf: { ok: true, file: joiner('home.pdf') } },
      { screen: 'checkout', png: { ok: true, file: joiner('checkout.png') }, pdf: { ok: false, error: 'print failed' } },
      { screen: 'void', png: { ok: false, error: 'screen not loaded' } },
    ],
  });
  const text = summary.join('\n');
  assert.match(text, /Export done: 3 screens/);
  assert.match(text, /2 PNG \+ 1 PDF/);
  assert.match(text, /2 failed \(checkout, void\)/);
  assert.match(text, /checkout\.png/);
  const large = exportJobSummary({
    state: 'done',
    results: Array.from({ length: 9 }, (_, i) => ({ screen: `s${i}`, png: { ok: true, file: joiner(`s${i}.png`) } })),
  });
  assert.match(large.join('\n'), /\+5 more/, 'the enumerated path list is capped for the toast');
});

test('exportFailureSummary names the failures the service reported', () => {
  const summary = exportFailureSummary({
    state: 'failed',
    results: [
      { screen: 'home', png: { ok: false, error: 'screen not loaded' } },
      { screen: 'checkout', pdf: { ok: false, error: 'print failed' } },
    ],
  });
  assert.match(summary, /Export failed: 2 screens — home \(screen not loaded\), checkout \(print failed\)/);
  assert.equal(exportFailureSummary({ state: 'failed', results: [] }), 'Export failed.');
});

// ---- /canvas critique: the digest composition ----

test('critiqueReviewText composes the bounded digest with the advisory note', () => {
  const digest = {
    screens: [
      {
        screen: 'home',
        state: 'ready',
        url: 'http://localhost:5173/home.html',
        width: 1280,
        height: 800,
        gates: [
          { id: 'overflow', status: 'P1', findings: ['x-overflow at 390', 'body wider than viewport'] },
          { id: 'contrast', status: 'P0', findings: ['4.0 < 4.5 on muted text', 'badge text', 'third finding', 'fourth finding must drop'] },
        ],
        probeCounts: { passed: 7, failed: 1 },
      },
      { screen: 'checkout', state: 'error', url: 'http://localhost:5173/checkout.html', width: 1280, height: 800, gates: [], probeCounts: {} },
    ],
    truncated: true,
  };
  const text = critiqueReviewText(digest);
  assert.match(text, /^Canvas critique — deterministic gate digest \(advisory\):/);
  assert.match(text, /- home · 1280×800 · ready · http:\/\/localhost:5173\/home\.html/);
  assert.match(text, /overflow: P1 — x-overflow at 390; body wider than viewport/);
  assert.doesNotMatch(text, /fourth finding must drop/, 'findings are bounded at 3 — a 4th drops from the composed text');
  assert.match(text, /- checkout · 1280×800 · error · /);
  assert.match(text, /no gate findings/);
  assert.match(text, /… more screens exist; the digest covers the first 12 \(service-bound\)\./);
  assert.ok(text.endsWith(CRITIQUE_ADVISORY), 'the standing advisory note closes the digest');
  assert.equal(CRITIQUE_ADVISORY, VERIFY_PROTOCOL.split('\n').filter((line) => line.startsWith('The 0–10 critique')).join('\n'), 'the note IS the protocol clause, never a reword');
});

test('critiqueReviewChip is a design-canvas chip, capped at the compose limit and self-replacing', () => {
  const huge = {
    screens: Array.from({ length: 12 }, (_, i) => ({
      screen: `screen-${i}`,
      state: 'ready',
      url: `http://localhost:5173/screen-${i}.html`,
      width: 1280,
      height: 800,
      gates: [{ id: 'gate', status: 'P0', findings: ['a very long finding text padded out to measure the cap '.repeat(8).trim()] }],
      probeCounts: {},
    })),
    truncated: true,
  };
  const chip = critiqueReviewChip('ses_c', 'http://localhost:5173', huge);
  assert.equal(chip.providerId, 'design-canvas');
  assert.equal(chip.id, 'canvas-critique-ses_c');
  assert.equal(chip.title, 'Canvas critique — gate digest');
  assert.equal(chip.url, 'http://localhost:5173');
  assert.match(chip.text ?? '', /Canvas critique — deterministic gate digest \(advisory\):/);
  assert.ok((chip.text ?? '').length <= 16000, 'the composed text respects GUEST_COMPOSE_TEXT_MAX');
  assert.equal(critiqueReviewChip('ses_c', 'http://localhost:5173', { screens: [] }).id, chip.id, 'same session → the critique chip replaces itself');
  assert.equal(critiqueReviewChip('ses_c', null, { screens: [] }).url, 'https://design.local/session', 'a missing url falls back to the placeholder');
});