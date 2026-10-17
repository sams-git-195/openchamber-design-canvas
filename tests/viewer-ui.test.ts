import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Script, runInNewContext } from 'node:vm';

const modulePath = '../service/viewer-ui.ts';
const viewer = await import(modulePath).catch(() => null);
const home = { id: 'home', url: 'http://127.0.0.1:5173/', width: 1280, height: 800, title: 'Home' };
const other = { id: 'other', url: 'http://127.0.0.1:5173/checkout.html', width: 768, height: 1024, title: 'Checkout' };
const config = { screens: [home, other], viewport: { width: 1280, height: 800 }, mode: 'edit' as const };
function html(extra: Record<string, unknown> = {}): string {
  assert.ok(viewer, 'the production viewer renderer must exist');
  return viewer.renderViewerHtml({ ...config, ...extra });
}

test('renderer bakes one artboard per screen with hardening attributes and never a legacy single preview', () => {
  const rendered = html();
  assert.equal((rendered.match(/<section class="ds-artboard"/g) ?? []).length, 2);
  assert.match(rendered, /<section class="ds-artboard" data-screen="home"[^>]*style="left:0px;top:0px;width:1280px;height:800px;--w:1280px"/);
  // Grid math is natural px only: gap 48 after the 1280 column, never scaled.
  assert.match(rendered, /<section class="ds-artboard" data-screen="other"[^>]*style="left:1328px;top:0px;width:768px;height:1024px;--w:768px"/);
  assert.match(rendered, /id="camera"[^>]*style="width:2096px;height:1024px"/);
  assert.match(rendered, /<iframe id="ds-frame-home" data-ds-screen="home" name="__dsArtifact:home" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock" src="http:\/\/127\.0\.0\.1:5173\/"/);
  assert.doesNotMatch(rendered, /allow-top-navigation/);
  assert.doesNotMatch(rendered, /id="preview"/);
  assert.match(rendered, /class="ds-ab-title"/);
  assert.match(rendered, /class="ds-ab-size">1280×800</);
  assert.match(rendered, /class="ds-ab-title">1 · Home<\/button>/);
  assert.match(rendered, /class="ds-ab-title">2 · Checkout<\/button>/);
  assert.equal((rendered.match(/class="ds-ab-menu"/g) ?? []).length, 2, 'V4-10: every baked artboard carries the hover ⋯ trigger');
  assert.doesNotMatch(rendered, /id="layout-reason"|class="fallback"/, 'the legacy fit/page layout machinery is retired (V4-1)');
  assert.doesNotMatch(rendered, /srcdoc|contentDocument|contentWindow\.document|fixtureDocument|Fieldnotes|DEMO/);
  assert.match(rendered, /frame\.src\s*=/);
  assert.doesNotMatch(rendered, /<script[^>]+src=|<link[^>]+href=/);
});

test('the shell carries edit mode, the artboard hover affordance, and per-artboard overlays', () => {
  const rendered = html();
  assert.match(rendered, /id="canvas" class="canvas" data-mode="edit"/);
  assert.match(rendered, /data-mode=edit\] \.ds-artboard>iframe\{pointer-events:none\}/);
  assert.match(rendered, /data-mode=edit\] \.ds-artboard:hover/);
  assert.equal((rendered.match(/class="ds-ab-state"/g) ?? []).length, 2, 'one overlay card inside each artboard');
  assert.match(rendered, /ds-ab-retry/, 'artboard retry never blanks the grid');
});

test('V4-9 art-wall CSS: dot grid, shadows, counter-scaled headers, and the notice/toast/menu surfaces', () => {
  const rendered = html();
  assert.match(rendered, /background:oklch\(0\.17 0 0\) radial-gradient\(circle,oklch\(1 0 0 \/ \.11\) 1\.25px,transparent 1\.5px\)/, 'dot-grid canvas background at the exact spec value (F9: raised from the near-invisible .07/1px)');
  assert.match(rendered, /box-shadow:0 1px 2px rgb\(0 0 0\/\.4\),0 12px 32px rgb\(0 0 0\/\.35\)/, 'artboard shadow pair at the exact spec value');
  assert.doesNotMatch(rendered, /\.ds-artboard\{[^}]*outline:1px solid/, 'the inactive 1 px outline is gone');
  assert.match(rendered, /\.ds-artboard\[data-active=true\]\{outline:calc\(2px \/ var\(--cam-scale,1\)\) solid #4f8cff;outline-offset:calc\(2px \/ var\(--cam-scale,1\)\)\}/);
  assert.match(rendered, /data-mode=edit\] \.ds-artboard:hover\{outline:calc\(1px \/ var\(--cam-scale,1\)\) solid rgb\(79 140 255\/\.6\)\}/, 'edit hover is the soft blue artboard-level outline');
  // Counter-scaled plain-text headers (E10 fix): scale 1/cam reads --cam-scale.
  assert.match(rendered, /\.ds-artboard>\.ds-ab-title,\.ds-artboard>\.ds-ab-size\{[^}]*transform:scale\(calc\(1 \/ var\(--cam-scale,1\)\)\)/);
  assert.match(rendered, /\.ds-artboard>\.ds-ab-title\{[^}]*transform-origin:bottom left[^}]*max-width:calc\(var\(--w,100%\) \* var\(--cam-scale,1\) - var\(--ab-size-w,84px\)\)/);
  assert.match(rendered, /\.ds-artboard>\.ds-ab-size\{[^}]*transform-origin:bottom right[^}]*font-variant-numeric:tabular-nums/);
  assert.doesNotMatch(rendered, /\.ds-ab-title[^{]*\{[^}]*background:var\(--muted\)/, 'no pill backgrounds behind plain-text headers');
  // V4-7 handoff, V4-4 pulse ring, and the controller-rendered surfaces.
  assert.match(rendered, /\.canvas\[data-agent-input\] \.ds-artboard>iframe\{pointer-events:auto\}/);
  assert.match(rendered, /\.ds-artboard\[data-new=true\]\{animation:ds-new-pulse/);
  assert.match(rendered, /#toolbar-status-area\{[^}]*position:absolute[^}]*z-index:6/);
  assert.match(rendered, /\.ds-notice\{/); assert.match(rendered, /\.ds-toast\{[^}]*bottom:24px/);
  assert.match(rendered, /\.ds-context-menu\{[^}]*position:fixed[^}]*z-index:7/);
  assert.match(rendered, /aria-label="Design canvas[^"]*Shift 1 fits all screens[^"]*Right-click a screen for options/);
});

test('design-review pins (Sonnet F3/F6/F7/F9/F10 + rename overflow): reserved size label, device-px outlines, error card, grouped menu, clamped rename field', () => {
  const rendered = html();
  // F9: dot grid raised from oklch(1 0 0 / .07) 1px — the old value must be gone.
  assert.doesNotMatch(rendered, /oklch\(1 0 0 \/ \.07\)/, 'the near-invisible .07 dot grid is retired');
  // F6: the active outline counter-scales to a constant 2 DEVICE px at every
  // zoom (pin scale: at --cam-scale 0.12 calc(2px/0.12) ≈ 16.7 natural px →
  // 2px rendered; same at 3x). The edit-hover 1px outline counter-scales too.
  assert.match(rendered, /outline:calc\(2px \/ var\(--cam-scale,1\)\) solid #4f8cff/, 'active outline is 2 device px at fit-all (was 0.59px at 37%)');
  // F3: the title reserves the size label's slot; the controller-set compact
  // tier (<140 device px of board width) hides the label and frees the clamp.
  assert.match(rendered, /--ab-size-w,84px/, 'the size label width is reserved out of the title budget');
  assert.match(rendered, /\.ds-artboard\[data-header-compact=true\]>\.ds-ab-size\{display:none\}/);
  assert.match(rendered, /\.ds-artboard\[data-header-compact=true\]>\.ds-ab-title\{max-width:calc\(var\(--w,100%\) \* var\(--cam-scale,1\)\)\}/);
  // F7: styled, keyboard-focusable Retry; demoted CSP detail line; compact
  // zoom tier keeps only the counter-scaled button below 0.5.
  assert.match(rendered, /\.ds-ab-retry\{padding:8px 14px;border:1px solid var\(--border\);border-radius:calc\(var\(--radius\) \* \.6\);background:var\(--secondary\);color:var\(--secondary-foreground\);font-size:13px;line-height:1;cursor:pointer\}/);
  assert.match(rendered, /\.ds-ab-retry:focus-visible\{outline:2px solid #4f8cff;outline-offset:2px\}/);
  assert.match(rendered, /\.ds-ab-card-detail\{[^}]*font-size:12px[^}]*color:var\(--muted-foreground\)/);
  assert.match(rendered, /\.canvas\[data-zoom-compact=true\] \.ds-ab-card-copy,\.canvas\[data-zoom-compact=true\] \.ds-ab-card-detail\{display:none\}/);
  assert.match(rendered, /\.canvas\[data-zoom-compact=true\] \.ds-ab-retry\{transform:scale\(calc\(1 \/ var\(--cam-scale,1\)\)\);transform-origin:center\}/);
  assert.equal((rendered.match(/class="ds-ab-card-detail" hidden/g) ?? []).length, 2, 'every baked overlay carries the hidden detail line');
  assert.doesNotMatch(rendered, /\.ds-ab-retry\{color:var\(--foreground\)\}/, 'the bare-white-text Retry is gone');
  // Rename overflow defect: the field clamps to the artboard's on-screen width
  // with a 120px usable floor and ellipsis.
  assert.match(rendered, /\.ds-ab-rename\{[^}]*width:clamp\(120px,calc\(var\(--w,220px\) \* var\(--cam-scale,1\)\),220px\)[^}]*text-overflow:ellipsis/);
  assert.doesNotMatch(rendered, /\.ds-ab-rename\{[^}]*width:220px;/, 'the fixed 220px rename field is retired');
  // Cheap minors from the same review: F14 pulse counter-scaled + shortened,
  // F16 no UA focus ring after a mouse click on the wall, F11 header ring.
  assert.match(rendered, /\.ds-artboard\[data-new=true\]\{animation:ds-new-pulse \.8s ease-out\}/);
  assert.match(rendered, /100%\{box-shadow:0 0 0 calc\(8px \/ var\(--cam-scale,1\)\) rgb\(79 140 255\/0\)/, 'the new-board ring is 8 device px, not a 16px camera-space slab');
  assert.doesNotMatch(rendered, /0 0 0 16px rgb\(79 140 255\/0\)/, 'the heavy 16px pulse ring is retired');
  assert.match(rendered, /\.canvas:focus:not\(:focus-visible\)\{outline:none\}/);
  assert.match(rendered, /\.ds-artboard>\.ds-ab-title:focus\{outline:none\}/);
  assert.match(rendered, /\.ds-artboard>\.ds-ab-title:focus-visible\{outline:2px solid #4f8cff;outline-offset:2px;border-radius:4px\}/);
  // F10: separators + subtle per-action icons; Rename… keeps the last group.
  assert.match(rendered, /\.ds-menu-sep\{height:1px;margin:4px 2px;flex:none;background:var\(--border\)\}/);
  assert.match(rendered, /\.ds-menu-item\{display:flex;align-items:center;gap:8px/);
  for (const [action, glyph] of [['send-to-chat', '↗'], ['zoom', '◎'], ['reload', '↻'], ['reset-position', '⌂'], ['export-png', '⇩'], ['export-pdf', '⇩'], ['copy-path', '⧉'], ['rename', '✎']] as const) {
    assert.ok(rendered.includes(`.ds-menu-item[data-action=${action}]::before{content:"${glyph}"}`), `icon for ${action}`);
  }
});

test('hostile titles and script terminators cannot break out; bad ids are refused; unknown secrets are omitted', () => {
  const hostile = '</script><img src=x onerror=alert(1)>&"\u2028';
  const rendered = html({ screens: [{ ...home, title: hostile }], bearer: 'DO-NOT-SERIALIZE-THIS-SECRET' });
  assert.doesNotMatch(rendered, /<img src=x|DO-NOT-SERIALIZE-THIS-SECRET/);
  assert.match(rendered, /&lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;&amp;/);
  // The renderer emits two inline scripts: the controller bootstrap (which
  // embeds hostile screen data as escaped JSON config) and the compiled client
  // bundle. Hostile contents must close both scripts intact.
  const scripts = [...rendered.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2, 'two closed scripts regardless of screen contents');
  for (const script of scripts) assert.doesNotThrow(() => new Script(script[1]!));
});

test('screen validation: unique lowercase ids, http(s) URLs, 200-8192 sizes, max 12 screens, empty allowed', () => {
  assert.throws(() => html({ screens: [home, { ...home }] }), /unique/i);
  assert.throws(() => html({ screens: [{ ...home, id: 'Home' }] }), /id/i);
  assert.throws(() => html({ screens: [{ ...home, id: 'bad"id' }] }), /id/i);
  assert.throws(() => html({ screens: [{ ...home, url: 'javascript:alert(1)' }] }), /http|URL/i);
  assert.throws(() => html({ screens: [{ ...home, url: 'https://user:password@example.com/' }] }), /credential|URL/i);
  assert.throws(() => html({ screens: [{ ...home, url: 'data:text/html,x' }] }), /http|URL/i);
  assert.throws(() => html({ screens: [{ ...home, width: 199 }] }), /200|8192/);
  assert.throws(() => html({ screens: [{ ...home, height: 8193 }] }), /200|8192/);
  assert.throws(() => html({ screens: [{ ...home, width: 1280.5 }] }), /200|8192/);
  assert.throws(() => html({ screens: Array.from({ length: 13 }, (_, i) => ({ ...home, id: `s-${i}` })) }), /12/);
  assert.throws(() => html({ viewport: { width: Infinity, height: 800 } }), /viewport/i);
  assert.throws(() => html({ screens: 'not-a-list' as never }), /12|screen/);
});

test('an empty workspace renders the zero-screens state, not a broken grid', () => {
  const rendered = html({ screens: [] });
  assert.equal((rendered.match(/<section class="ds-artboard"/g) ?? []).length, 0);
  assert.match(rendered, /id="camera" class="camera" style="width:0px;height:0px"/);
  assert.doesNotMatch(rendered, /<section id="state" class="state" data-state="empty" hidden/);
  assert.match(html(), /<section id="state" class="state" data-state="empty" hidden/, 'screens present parks the global overlay');
  assert.match(rendered, /No screens on this canvas/);
});

test('canvas mode is baked and only edit or play survive', () => {
  assert.match(html({ mode: 'play' }), /id="canvas" class="canvas" data-mode="play"/);
  assert.match(html({ mode: 'sideways' as never }), /id="canvas" class="canvas" data-mode="edit"/);
});

test('the bake places positioned screens at their view.json coordinates and flows the rest', () => {
  const rendered = html({ screens: [{ ...home }, { ...other, x: 500, y: 700 }] });
  assert.match(rendered, /data-screen="home"[^>]*style="left:0px;top:0px;width:1280px;height:800px;--w:1280px"/);
  assert.match(rendered, /data-screen="other"[^>]*style="left:500px;top:700px;width:768px;height:1024px;--w:768px"/);
  // bbox spans max(1280, 500+768) x max(800, 700+1024)
  assert.match(rendered, /id="camera"[^>]*style="width:1280px;height:1724px"/);
  // explicit null = auto flow, still first-painted from the bake
  const auto = html({ screens: [{ ...home, x: null, y: null }, { ...other, x: null, y: null }] });
  assert.match(auto, /data-screen="other"[^>]*style="left:1328px;top:0px;width:768px;height:1024px;--w:768px"/);
  // one-sided or non-finite prescriptions are refused, never silently baked
  assert.throws(() => html({ screens: [{ ...home, x: 100 }] }), /both/i);
  assert.throws(() => html({ screens: [{ ...home, x: Infinity, y: 0 }] }), /finite/i);
});

test('rendered client exposes the CDP contract incl. the SPEC-V4 §3 surface and the approved outbound commands', () => {
  const rendered = html();
  for (const name of ['setScreens', 'setMode', 'setActive', 'getActive', 'setScreenState', 'fitAll', 'focusScreen', 'zoomToScreen', 'getScreens',
    'setViewport', 'setStatus', 'setPage', 'getCamera', 'restoreCamera', 'dismissMenu', 'beginCapture', 'normalizeCapture', 'endCapture',
    // SPEC-V4 §3 (frozen service->shell names, verbatim):
    'setNotice', 'showToast', 'setAgentStatus', 'setAgentInput', 'revealScreen']) assert.ok(rendered.includes(name), name);
  assert.match(rendered, /window\.__dsCanvasSend/);
  assert.doesNotMatch(rendered, /host\.attach|fetch\(|XMLHttpRequest|WebSocket|localStorage/);
  for (const type of ['ready', 'page', 'retry', 'screen-pick', 'screen-activate', 'mode-request', 'screen-move', 'camera-changed',
    // SPEC-V4 §3 (frozen shell->service emissions, verbatim shapes):
    'screen-hover', 'screen-hover-end', 'screen-menu', 'screen-rename']) assert.ok(rendered.includes(`'${type}'`), type);
  // REMOVED from shell emission (V4-1): the legacy layout machinery messages.
  // Integrator re-pin: the ONE allowed `fit-size` site is the legacy
  // single-frame auto-refit channel (bootConfig.workspace===false gated) that
  // keeps the pinned v1 behavior; workspace/toolbar paths emit none.
  assert.doesNotMatch(rendered, /type:\s*'layout'|type:\s*'viewport'/);
  assert.equal((rendered.match(/type:\s*'fit-size'/g) ?? []).length, 1, 'exactly one legacy fit-size emit site');
  assert.match(rendered, /bootConfig\.workspace === false && view\.layoutMode === 'fit'|bootConfig\.workspace===false&&view\.layoutMode==='fit'/, 'the fit-size emit is welded to the legacy launch gate');
  // The context menu action union is the frozen §3 set.
  for (const action of ['send-to-chat', 'reload', 'reset-position', 'export-png', 'export-pdf', 'copy-path']) assert.ok(rendered.includes(`'${action}'`), action);
});

function clientFunction(name: string): string {
  const match = html().match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}`));
  assert.ok(match, `missing client method ${name}`);
  return match[0];
}

test('V4-1: the toolbar has no viewport presets, no Fit-width zoom, and no selectPreset path', () => {
  const rendered = html();
  assert.doesNotMatch(rendered, /selectPreset|selectViewport/, 'no toolbar path may reach setLayout (the E1 resize machinery)');
  assert.doesNotMatch(rendered, /aria-label="Design viewport|Design viewport: /, 'the viewport ToggleGroup is gone');
  assert.doesNotMatch(rendered, /Fit width|Width · /, 'the zoom label is only N% and there is no fit-width item');
  assert.doesNotMatch(rendered, /Desktop Large/, 'preset labels are retired from the toolbar');
  // The zoom menu instead: Fit all / 50% / 100% / 200% / Zoom to selection.
  for (const item of ['Zoom to selection', '50%', '100%', '200%']) assert.ok(rendered.includes(item), item);
  assert.doesNotMatch(rendered, /<footer|class="notice"|<select/);
  // setLayout/getFitBounds REMAIN on __dsCanvas for service compatibility.
  assert.match(rendered, /setLayout:info=>transaction/); assert.match(rendered, /getFitBounds,setStatus/);
});

test('backend-confirmed page height and explicit viewport fallback restyle the ACTIVE artboard only', () => {
  const view = { width: 2096, height: 1024, nominalHeight: 800, preset: 'desktop', layoutMode: 'viewport', mode: 'manual', scale: 1, panX: 30, panY: 70, pan: false, space: false, reason: '' };
  const screens = [{ id: 'home', width: 1280, height: 800 }, { id: 'other', width: 768, height: 1024 }];
  let relayouts = 0;
  const context = { view, captureState: null, paint: () => undefined, relayout: () => relayouts++, screens, active: 'home', MIN_EXTENT: 64, MAX_EXTENT: 65536 };
  const setLayout = runInNewContext(clientFunction('setLayout') + ';setLayout', context);
  assert.equal(setLayout({ mode: 'page', preset: 'desktop', width: 1280, height: 1880, nominalHeight: 800 }), true);
  assert.equal(screens[0]!.height, 1880, 'the active screen grows to the confirmed page height');
  assert.equal(screens[1]!.height, 1024, 'a sibling artboard keeps its own natural size');
  assert.equal(view.layoutMode, 'page');
  assert.equal(setLayout({ mode: 'viewport', preset: 'desktop', width: 1280, height: 800, nominalHeight: 800, reason: 'Viewport-relative content did not stabilize.' }), true);
  assert.equal(screens[0]!.height, 800);
  assert.equal(view.layoutMode, 'viewport');
  assert.match(view.reason, /did not stabilize/);
  // Camera extents accept the widened grid bounds; per-screen clamps stay upstream.
  assert.equal(setLayout({ mode: 'page', preset: 'desktop', width: 1280, height: 65536, nominalHeight: 800 }), true);
  const previous = { ...view, screens: screens.map((s) => ({ ...s })) };
  assert.equal(setLayout({ mode: 'page', preset: 'desktop', width: 1280, height: Infinity, nominalHeight: 800 }), false);
  assert.equal(setLayout({ mode: 'page', preset: 'desktop', width: 63, height: 800, nominalHeight: 800 }), false);
  assert.equal(screens[0]!.height, previous.screens[0]!.height);
  assert.ok(relayouts >= 1, 'grid bounds recompute whenever a screen is resized');
});

test('capture-frozen layout rejects mutations without changing the saved mode or dimensions', () => {
  const view = { width: 1280, height: 800, layoutMode: 'viewport', preset: 'desktop' };
  const setLayout = runInNewContext(clientFunction('setLayout') + ';setLayout', { view, captureState: { token: 1 }, paint: () => undefined, relayout: () => undefined, screens: [], active: '', MIN_EXTENT: 64, MAX_EXTENT: 65536 });
  assert.equal(setLayout({ mode: 'fit', preset: 'fit', width: 390, height: 844, nominalHeight: 844 }), false);
  assert.deepEqual(view, { width: 1280, height: 800, layoutMode: 'viewport', preset: 'desktop' });
});

test('with screens present the global overlay never blanks the grid', () => {
  const nodes = new Map<string, { hidden?: boolean; dataset: Record<string, string>; textContent?: string; title?: string; setAttribute: (a: string, b: string) => void }>();
  const $ = (id: string) => { if (!nodes.has(id)) nodes.set(id, { hidden: false, dataset: {}, setAttribute: () => undefined }); return nodes.get(id)!; };
  const view = { ready: false, space: false, pan: false };
  const context = { $, view, screens: [{ id: 'home', state: 'loading' }], captureState: null, slowTimer: null, statusState: 'ready', message: '', clearTimeout: () => undefined, setTimeout: () => 1, closeMenu: () => undefined, paint: () => undefined, announce: () => undefined };
  const setStatus = runInNewContext(clientFunction('setStatus') + ';setStatus', context);
  assert.equal(setStatus({ state: 'error', message: 'This screen died.' }), true);
  assert.equal($('state').hidden, true, 'one dead screen never blanks the grid');
  assert.equal(view.ready, true, 'a grid with screens keeps the camera usable');
  assert.equal(context.statusState, 'error');
  assert.equal(context.message, 'This screen died.');
});

test('the zero-screens state keeps the global overlay with spinner, late Retry, and copy', () => {
  const nodes = new Map<string, { hidden?: boolean; dataset: Record<string, string>; textContent?: string; title?: string; setAttribute: (a: string, b: string) => void }>();
  const $ = (id: string) => { if (!nodes.has(id)) nodes.set(id, { hidden: false, dataset: {}, setAttribute: () => undefined }); return nodes.get(id)!; };
  let delayed: (() => void) | undefined;
  const view = { ready: true, space: false, pan: false };
  const context = { $, view, screens: [], captureState: null, slowTimer: null, statusState: 'ready', message: '', clearTimeout: () => undefined, setTimeout: (fn: () => void, delay: number) => { assert.equal(delay, 15000); delayed = fn; return 1; }, closeMenu: () => undefined, paint: () => undefined, announce: () => undefined };
  const setStatus = runInNewContext(clientFunction('setStatus') + ';setStatus', context);
  assert.equal(setStatus({ state: 'loading' }), true);
  assert.equal($('state').hidden, false, 'zero screens use the global overlay');
  assert.equal($('state-title').hidden, true);
  assert.equal($('state-copy').hidden, true);
  assert.equal($('spinner').hidden, false);
  assert.equal($('state-action').hidden, true);
  delayed!();
  assert.equal($('state-action').hidden, false);
  assert.equal($('state-title').hidden, true);
});

test('live readiness is backend-reported, not inferred from the iframe load event', () => {
  const rendered = html();
  // The controller waits for the toolbar's mounted hook, never for a frame's
  // load event; the compiled bundle's own load listeners are library internals.
  const controller = [...rendered.matchAll(/<script>([\s\S]*?)<\/script>/g)][0]![1]!;
  assert.doesNotMatch(controller, /frame\.onload\s*=/);
  // The only frame 'load' listener is the P2 src-sync (seam 3) plus the V4-12
  // busy-turn sighting: it may touch bookkeeping, never status/state --
  // readiness stays service-driven.
  for (const match of controller.matchAll(/addEventListener\(['"]load['"]/g)) {
    const site = match.index ?? 0;
    assert.match(controller.slice(site, site + 660), /s\.src\s*=/, 'frame load listeners only sync src');
    assert.doesNotMatch(controller.slice(site, site + 660), /setScreenState|renderBoardState|setStatus|state\s*=\s*['"]ready/);
  }
  for (const state of ['loading', 'ready', 'empty', 'error']) assert.ok(rendered.includes(`'${state}'`));
  assert.match(rendered, /allows embedding/);
  assert.match(rendered, /15000/);
});

test('V4-1/V4-9: no preset toggle labels anywhere, and the workspace toolbar copy is in', () => {
  const rendered = html();
  for (const label of ['Desktop Large', 'Tablet', 'Mobile']) assert.equal(rendered.includes(label), false, `${label} preset toggle is retired`);
  // The art-wall toolbar language (compiled bundle + controller announces).
  for (const label of ['Fit all', 'Zoom out', 'Zoom in', 'Pan canvas', 'Fit all screens']) assert.ok(rendered.includes(label), label);
  assert.doesNotMatch(rendered, /<footer|<select/);
});

test('initial ready before CDP binding stays pending, while disconnected user commands report failure', () => {
  const source = html().match(/function send\(command\)\{[\s\S]*?\n  \}/)![0];
  const statuses: unknown[] = [];
  const send = runInNewContext(source + ';send', { window: {}, setStatus: (value: unknown) => statuses.push(value), Error, JSON });
  assert.equal(send({ type: 'ready' }), false);
  assert.equal(statuses.length, 0, 'bootstrap must not hide the live grid as an embedding error');
  assert.equal(send({ type: 'retry' }), false);
  assert.equal(statuses.length, 1, 'a disconnected interactive command is still actionable');
});

test('metadata-only page confirmation changes selection without writing iframe src or resetting status', () => {
  const source = html().match(/function setPage\(info\)\{[\s\S]*?\n  \}/)![0];
  let writes = 0;
  const frame = { set src(_value: string) { writes++; }, removeAttribute() { writes++; } };
  const screen = { id: 'home', url: 'http://localhost:5173/', src: 'http://localhost:5173/', state: 'ready', message: '', title: 'Preview', width: 390, height: 844 };
  const context = { screens: [screen], active: 'home', boards: new Map([['home', { frame }]]), renderBoardState: () => undefined,
    setStatus: () => { throw new Error('confirmation must not reset status'); }, renderPages: () => undefined,
    validUrl: (value: string) => new URL(value).href, document: { title: '' } };
  const result = runInNewContext(`let pages=[],currentUrl='http://localhost:5173/',currentTitle='Preview';${source};setPage({url:'http://localhost:5173/#visited',title:'Visited',navigate:false});({currentUrl,currentTitle})`, context);
  assert.equal(writes, 0, 'confirmation must not reload the current document');
  assert.equal(result.currentUrl, 'http://localhost:5173/#visited');
  assert.equal(result.currentTitle, 'Visited');
});

test('a confirming page push that changes the active URL navigates exactly that artboard', () => {
  const source = html().match(/function setPage\(info\)\{[\s\S]*?\n  \}/)![0];
  const writes: string[] = [];
  const frame = { set src(value: string) { writes.push(value); } };
  const screen = { id: 'home', url: 'http://localhost:5173/', src: 'http://localhost:5173/', state: 'ready', message: '', title: 'Preview', width: 390, height: 844 };
  const context = { screens: [screen], active: 'home', boards: new Map([['home', { frame }]]), renderBoardState: () => undefined,
    setStatus: () => undefined, renderPages: () => undefined, validUrl: (value: string) => new URL(value).href, document: { title: '' } };
  runInNewContext(`let pages=[],currentUrl='',currentTitle='Preview';${source};setPage({url:'http://localhost:5173/next.html',title:'Next'});setPage({url:'http://localhost:5173/next.html',title:'Next'});({currentUrl})`, context);
  assert.deepEqual(writes, ['http://localhost:5173/next.html'], 'unchanged src is never rewritten');
  assert.equal(screen.state, 'loading', 'a navigated artboard shows its own loading card');
});

// The stock Nova migration moved toolbar/control styling into the compiled
// Tailwind CSS (style block 0, generated offline). Canvas geometry adds only
// artboard/grid rules; control styling stays in the compiled stylesheet.

test('compiled stock hover states exclude disabled controls from interactive styling', () => {
  // Tailwind escapes hover variants as .hover\:…:hover; the compiled stock CSS
  // has no bare element/button hover selectors, so interactive styling lands
  // only on class hooks the stock components gate by their own disabled state.
  const rules = [...html().matchAll(/([^{}{}\n]*):hover([^{};{]*)\{([^{}]*)\}/g)].filter((m) => /background|color/.test(m[3]!) && !m[1]!.includes('\\:'));
  assert.doesNotMatch(rules.map((r) => r[0]).join('\n'), /^button:hover|\.toolbar button:hover/i, 'bare interactive hover selectors would style disabled controls too');
});

test('bounded camera API delegates actions and ignores Fit/loading/capture without changing layout', () => {
  const calls: unknown[][] = []; const view = { ready: true, layoutMode: 'page', scale: 2, width: 2096, height: 1024 };
  const context = { view, captureState: null, canvas: { clientWidth: 1000, clientHeight: 800 }, finite: Number.isFinite, zoomTo: (...args: unknown[]) => calls.push(args) };
  const zoom = runInNewContext(clientFunction('zoomCamera') + ';zoomCamera', context);
  assert.equal(zoom({ action: 'in' }), true); assert.equal(calls[0]![0], 2.5);
  assert.equal(zoom({ action: 'out' }), true); assert.equal(calls[1]![0], 1.6);
  assert.equal(zoom({ action: 'reset' }), true); assert.equal(calls[2]![0], 1);
  assert.equal(zoom({ action: 'wheel', deltaY: 0, x: 100, y: 50 }), true); assert.equal(calls[3]![0], 2);
  assert.equal(JSON.stringify(calls[3]![1]), JSON.stringify({ x: 100, y: 50 }));
  for (const value of [NaN, Infinity, 1e9]) assert.equal(zoom({ action: 'wheel', deltaY: value, x: 1, y: 1 }), false);
  view.layoutMode = 'fit'; assert.equal(zoom({ action: 'in' }), false); view.layoutMode = 'page'; view.ready = false; assert.equal(zoom({ action: 'reset' }), false); view.ready = true; context.captureState = {} as never; assert.equal(zoom({ action: 'out' }), false);
  assert.equal(calls.length, 4); assert.equal(view.width, 2096); assert.equal(view.height, 1024);
});

test('modified camera shortcuts consume native browser zoom even when camera action is unavailable', () => {
  const requests: unknown[] = []; const shortcut = runInNewContext(clientFunction('cameraShortcut') + ';cameraShortcut', { zoomCamera: (x: unknown) => { requests.push(x); return false; } });
  for (const [key, action] of [['+', 'in'], ['=', 'in'], ['-', 'out'], ['0', 'reset']]) {
    let prevented = false, stopped = false; assert.equal(shortcut({ key, ctrlKey: true, metaKey: false, defaultPrevented: false, preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } }), true); assert.ok(prevented && stopped); assert.equal(JSON.stringify(requests.at(-1)), JSON.stringify({ action }));
  }
  assert.equal(shortcut({ key: '+', ctrlKey: false, metaKey: false }), false, 'literal plus must remain available to inputs');
  assert.equal(shortcut({ key: '+', ctrlKey: true, defaultPrevented: true }), false, 'widget-owned events must not be processed twice');
});
