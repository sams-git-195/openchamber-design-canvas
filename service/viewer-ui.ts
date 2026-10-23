/** Capability-gated multi-artboard canvas. Stock toolbar assets are compiled offline. */
import { initCanvas } from '../viewer-client/src/canvas-controller.js';
import { VIEWER_CLIENT_JS, VIEWER_CLIENT_CSS } from './viewer-assets.generated.ts';

export type ViewerPage = { id: string; label: string; url: string };
export type ViewerScreen = { id: string; url: string; width: number; height: number; title: string; x?: number | null; y?: number | null };
export type ViewerConfig = { screens: ViewerScreen[]; viewport: { width: number; height: number }; mode: 'edit' | 'play'; /** V4 seam (integrator): true = multi-artboard workspace (fit-all boot pose, no fit-size emit); false = legacy single-frame (v1 'fit' pose + its auto-refit channel). Absent = treated as workspace. */ workspace?: boolean };

const MAX_SCREENS = 12;
const GRID_GAP = 48;
const FLOW_BUDGET = 3200;
const POS_CLAMP = 32768;
const SCREEN_ID = /^[a-z0-9][a-z0-9-]{0,30}$/;
// No allow-top-navigation: a screen can never navigate or destroy the shell.
const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock';

function publicUrl(value: string): string {
  if (value === '') return '';
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Preview URL must be an absolute http(s) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Preview URL must use http(s) without embedded credentials.');
  }
  return url.href;
}

function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function inlineScript(source: string): string {
  // Escaping the slash is equivalent inside JS strings/regexes; the HTML parser
  // must never see a script end tag originating in compiled source.
  return source.replace(/<\/script/gi, '<\\/script').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Mirrors canvas-controller.js placeScreens: positioned screens keep their
// camera-space x/y (null = auto); unpositioned screens flow in array order,
// gap 48, row budget 3200. The auto flow runs as if only unpositioned screens
// existed. Camera scale is transform-only and never enters this math.
function clampPos(value: number): number {
  return Math.round(Math.max(-POS_CLAMP, Math.min(POS_CLAMP, value)));
}

function flowLayout(screens: readonly PlacedScreen[]) {
  const n = screens.length;
  if (!n) return { width: 0, height: 0, cells: [] as { x: number; y: number }[] };
  const cells = new Array<{ x: number; y: number }>(n);
  const auto: number[] = [];
  screens.forEach((screen, index) => {
    if (screen.x !== null && screen.y !== null) cells[index] = { x: screen.x, y: screen.y };
    else auto.push(index);
  });
  let cursorX = 0, cursorY = 0, rowBottom = 0;
  for (const index of auto) {
    const screen = screens[index]!;
    if (cursorX > 0 && cursorX + screen.width > FLOW_BUDGET) { cursorX = 0; cursorY = rowBottom + GRID_GAP; }
    cells[index] = { x: cursorX, y: cursorY };
    cursorX += screen.width + GRID_GAP;
    rowBottom = Math.max(rowBottom, cursorY + screen.height);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  screens.forEach((screen, index) => {
    const cell = cells[index]!;
    minX = Math.min(minX, cell.x); minY = Math.min(minY, cell.y);
    maxX = Math.max(maxX, cell.x + screen.width); maxY = Math.max(maxY, cell.y + screen.height);
  });
  return { width: maxX - minX, height: maxY - minY, cells };
}

type PlacedScreen = ViewerScreen & { x: number | null; y: number | null };

function renderArtboard(screen: PlacedScreen, cell: { x: number; y: number }, index: number, active: boolean): string {
  const id = escapeAttribute(screen.id);
  const header = `${index + 1} · ${escapeText(screen.title)}`;
  return `<section class="ds-artboard" data-screen="${id}" data-active="${active ? 'true' : 'false'}" style="left:${cell.x}px;top:${cell.y}px;width:${screen.width}px;height:${screen.height}px;--w:${screen.width}px">`
    // N1 (FIX-3): .ds-ab-title is display:inline-flex, which ignores
    // text-overflow — the ellipsis lives on an inner label span instead.
    + `<button type="button" class="ds-ab-title"><span class="ds-ab-label">${header}</span></button>`
    + `<span class="ds-ab-size">${screen.width}×${screen.height}</span>`
    + `<iframe id="ds-frame-${id}" data-ds-screen="${id}" name="__dsArtifact:${id}" referrerpolicy="no-referrer" sandbox="${FRAME_SANDBOX}" src="${escapeAttribute(screen.url)}"></iframe>`
    + `<div class="ds-ab-state" data-state="loading"><p class="ds-ab-card-copy" role="status">Loading this screen.</p><p class="ds-ab-card-detail" hidden></p><button type="button" class="ds-ab-retry" hidden>Retry</button></div>`
    + `<button type="button" class="ds-ab-menu" aria-label="Screen options">⋯</button>`
    + `</section>`;
}

export function renderViewerHtml(config: ViewerConfig): string {
  const { width, height } = config.viewport;
  if (![width, height].every((n) => Number.isInteger(n) && n >= 100 && n <= 8192)) throw new Error('Invalid design viewport dimensions.');
  if (!Array.isArray(config.screens) || config.screens.length > MAX_SCREENS) throw new Error(`The canvas holds at most ${MAX_SCREENS} screens.`);
  const seen = new Set<string>();
  const screens: PlacedScreen[] = config.screens.map((screen) => {
    if (!screen || typeof screen.id !== 'string' || !SCREEN_ID.test(screen.id) || seen.has(screen.id)) {
      throw new Error('Canvas screens need unique ids of lowercase letters, digits, and dashes.');
    }
    seen.add(screen.id);
    const url = publicUrl(typeof screen.url === 'string' ? screen.url : '');
    if (!url) throw new Error('Each canvas screen needs a confirmed http(s) URL.');
    if (![screen.width, screen.height].every((n) => Number.isInteger(n) && n >= 200 && n <= 8192)) {
      throw new Error('Canvas screen sizes must be integers between 200 and 8192 pixels.');
    }
    const title = typeof screen.title === 'string' && screen.title.trim() ? screen.title.trim().slice(0, 120) : screen.id;
    const hasX = screen.x !== undefined && screen.x !== null;
    const hasY = screen.y !== undefined && screen.y !== null;
    if (hasX !== hasY) throw new Error('Canvas screen positions need both x and y.');
    if (hasX && ![screen.x, screen.y].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error('Canvas screen positions must be finite numbers.');
    }
    return { id: screen.id, url, width: screen.width, height: screen.height, title,
      x: hasX ? clampPos(screen.x as number) : null, y: hasX ? clampPos(screen.y as number) : null };
  });
  const mode = config.mode === 'play' ? 'play' : 'edit';
  // Deliberate allowlist: never serialize extra fields such as host bearer
  // tokens; positions x/y ride along on purpose (view.json placement).
  const safeConfig: ViewerConfig = {
    screens: screens.map((s) => ({ id: s.id, url: s.url, width: s.width, height: s.height, title: s.title, ...(s.x === null ? {} : { x: s.x, y: s.y }) })),
    viewport: { width, height }, mode,
    // Allowlisted launch kind flag (booleans only — never echoes caller junk).
    ...(config.workspace === undefined ? {} : { workspace: config.workspace === true }),
  };
  const bootstrap = `window.__dsViewerConfig=${inlineJson(safeConfig)};(${initCanvas.toString()})(window.__dsViewerConfig);`;
  return `<!DOCTYPE html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Design Canvas · Live screens</title>
<style>${VIEWER_CLIENT_CSS.replace(/<\/style/gi, '<\\/style')}</style><style>${CANVAS_GEOMETRY}</style></head><body>${CANVAS_MARKUP(screens, mode, config.workspace === false)}<script>${inlineScript(bootstrap)}</script><script>${inlineScript(VIEWER_CLIENT_JS)}</script></body></html>`;
}

// Canvas-only geometry. No legacy toolbar, control, typography, or palette CSS.
// V4-9 art-wall targets (SPEC-V4): dot grid that tracks the camera, shadowed
// artboards, plain-text counter-scaled headers, and the notice band / toast
// pill / context menu the controller renders. The dot grid's background-size
// and -position are rewritten by paint(); the counter-scale reads --cam-scale
// (set on #camera by paint) so headers stay a constant ~13 readable px at every
// zoom, and the title's max-width calc(var(--w) * var(--cam-scale) -
// var(--ab-size-w,84px)) reserves the size label's slot so the two can never
// collide (F3); below 140 device px of board width the controller flips
// data-header-compact and the label yields entirely.
const CANVAS_GEOMETRY = String.raw`
html,body{margin:0;width:100%;height:100%}
body{display:flex;flex-direction:column;height:100dvh;overflow:hidden}
#toolbar-root{flex:none;min-width:0}
.canvas{position:relative;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden;touch-action:none;background:oklch(0.17 0 0) radial-gradient(circle,oklch(1 0 0 / .11) 1.25px,transparent 1.5px);background-size:24px 24px;background-position:0 0}
.canvas[data-layout=fit]{touch-action:auto}
/* F16b (FIX-3): a mouse click on the canvas must not leave ANY focus ring
   around the whole art wall — the controller focuses the canvas from its
   pointerdown handler, and programmatic focus can match :focus-visible, so
   the ring is suppressed for :focus outright and only keyboard focus keeps
   an explicit blue ring. A pointer-originated focus is additionally tagged
   data-pointer-focus by the controller so it never shows the keyboard ring. */
.canvas:focus{outline:none}
.canvas:focus-visible{outline:2px solid #4f8cff;outline-offset:-2px}
.canvas[data-pointer-focus=true]:focus-visible{outline:none}
.camera{position:absolute;top:0;left:0;transform-origin:0 0}
iframe{display:block;border:0;width:100%;height:100%}
.camera[hidden],.pan-layer[hidden],.state[hidden],[hidden]{display:none}
.pan-layer{position:absolute;inset:0;z-index:4;cursor:grab;touch-action:none}
.canvas.dragging,.canvas.dragging .pan-layer{cursor:grabbing}
.ds-artboard{position:absolute;box-sizing:border-box;background:var(--card);box-shadow:0 1px 2px rgb(0 0 0/.4),0 12px 32px rgb(0 0 0/.35)}
.canvas[data-mode=edit] .ds-artboard:hover{outline:calc(1px / var(--cam-scale,1)) solid rgb(79 140 255/.6)}
.ds-artboard[data-active=true]{outline:calc(2px / var(--cam-scale,1)) solid #4f8cff;outline-offset:calc(2px / var(--cam-scale,1))}
.ds-artboard[data-new=true]{animation:ds-new-pulse .8s ease-out}
.ds-artboard>.ds-ab-title,.ds-artboard>.ds-ab-size{position:absolute;bottom:100%;margin:0 0 8px;padding:0;display:inline-flex;align-items:center;line-height:1;transform:scale(calc(1 / var(--cam-scale,1)))}
.ds-artboard>.ds-ab-title{left:0;transform-origin:bottom left;max-width:calc(var(--w,100%) * var(--cam-scale,1) - var(--ab-size-w,84px));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent;font-size:13px;font-weight:500;color:var(--foreground);opacity:.85;cursor:pointer}
.ds-artboard>.ds-ab-title:hover{opacity:1}
/* N1 (FIX-3): the title button is inline-flex (which ignores text-overflow),
   so the ellipsis is applied to the inner label span; the button keeps the
   reserved size-label budget (max-width above) and the compact tier. */
.ds-artboard>.ds-ab-title>.ds-ab-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* F11: no rectangular white UA ring left on the header after Esc/rename —
   keyboard users get a blue ring that matches the artboard radius instead. */
.ds-artboard>.ds-ab-title:focus{outline:none}
.ds-artboard>.ds-ab-title:focus-visible{outline:2px solid #4f8cff;outline-offset:2px;border-radius:4px}
.ds-artboard>.ds-ab-size{right:0;transform-origin:bottom right;white-space:nowrap;font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted-foreground)}
/* F3: below 140 device px of board width (data-header-compact, set by paint)
   the size label would out-measure the board itself — it yields to the title,
   which then gets the full on-screen width as its ellipsis budget. */
.ds-artboard[data-header-compact=true]>.ds-ab-size{display:none}
.ds-artboard[data-header-compact=true]>.ds-ab-title{max-width:calc(var(--w,100%) * var(--cam-scale,1))}
.ds-ab-menu{position:absolute;top:2px;right:2px;z-index:5;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--border);border-radius:6px;background:var(--popover);color:var(--muted-foreground);font-size:14px;line-height:1;cursor:pointer;opacity:0;transform:scale(calc(1 / var(--cam-scale,1)));transform-origin:top right}
.ds-artboard:hover>.ds-ab-menu,.ds-artboard:focus-within>.ds-ab-menu,.ds-ab-menu:focus-visible{opacity:1}
.ds-ab-menu:hover{color:var(--foreground)}
/* Task-9 (DEFECT-rename-input-overflow): the inline rename field never exceeds
   the artboard's on-screen width, with a 120px usable floor; the counter-scale
   means natural px here ARE device px. */
.ds-ab-rename{position:absolute;bottom:100%;left:0;z-index:5;margin:0 0 4px;padding:2px 6px;box-sizing:border-box;width:clamp(120px,calc(var(--w,220px) * var(--cam-scale,1)),220px);text-overflow:ellipsis;font-size:13px;color:var(--foreground);background:var(--card);border:1px solid #4f8cff;border-radius:6px;transform:scale(calc(1 / var(--cam-scale,1)));transform-origin:bottom left}
.ds-ab-state{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;background:var(--card);padding:16px}
.ds-ab-state[data-state=loading]::before{content:"";width:28px;height:28px;border-radius:50%;border:2px solid var(--border);border-top-color:var(--primary);animation:ds-spin .9s linear infinite}
.ds-ab-card-copy{max-width:480px;margin:0;overflow-wrap:anywhere;color:var(--muted-foreground)}
/* F7: CSP/X-Frame-Options jargon is demoted to this secondary line; Retry is a
   real secondary button (border + 8x14 padding, keyboard-focus ring). */
.ds-ab-card-detail{max-width:480px;margin:0;font-size:12px;line-height:1.4;color:var(--muted-foreground);opacity:.75;overflow-wrap:anywhere}
.ds-ab-retry{padding:8px 14px;border:1px solid var(--border);border-radius:calc(var(--radius) * .6);background:var(--secondary);color:var(--secondary-foreground);font-size:13px;line-height:1;cursor:pointer}
.ds-ab-retry:hover{background:var(--accent);color:var(--accent-foreground)}
.ds-ab-retry:focus-visible{outline:2px solid #4f8cff;outline-offset:2px}
/* F7 fit-all legibility: below 0.5 zoom (data-zoom-compact, set by paint) the
   card drops its prose and the Retry button counter-scales to a constant
   device size — readable and clickable at 12% where 7px text was not. */
.canvas[data-zoom-compact=true] .ds-ab-card-copy,.canvas[data-zoom-compact=true] .ds-ab-card-detail{display:none}
.canvas[data-zoom-compact=true] .ds-ab-retry{transform:scale(calc(1 / var(--cam-scale,1)));transform-origin:center}
@keyframes ds-spin{to{transform:rotate(360deg)}}
@keyframes ds-new-pulse{0%{box-shadow:0 0 0 0 rgb(79 140 255/.55),0 1px 2px rgb(0 0 0/.4),0 12px 32px rgb(0 0 0/.35)}100%{box-shadow:0 0 0 calc(8px / var(--cam-scale,1)) rgb(79 140 255/0),0 1px 2px rgb(0 0 0/.4),0 12px 32px rgb(0 0 0/.35)}}
.canvas[data-mode=edit] .ds-artboard>iframe{pointer-events:none}
.canvas[data-mode=edit] .ds-artboard{cursor:crosshair}
.canvas[data-agent-input] .ds-artboard>iframe{pointer-events:auto}
#toolbar-status-area{position:absolute;top:0;left:0;right:0;z-index:6;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 16px;pointer-events:none}
#toolbar-status-area:empty{padding:0}
/* Integrator restore (legacy bake only): the v1 visible viewport-fallback band
   (b21378f CSS, byte-identical). Only rendered when workspace:false. */
.fallback{position:absolute;bottom:0;left:0;max-width:100%;overflow-wrap:anywhere;pointer-events:none}
.ds-notice{display:flex;align-items:center;gap:8px;max-width:720px;padding:6px 14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--foreground);font-size:13px;line-height:1.4;box-shadow:0 12px 32px rgb(0 0 0/.35)}
.ds-notice[data-kind=error]{border-color:var(--destructive)}
.ds-notice[data-kind=warn]{border-color:#d97706}
.ds-notice-dot{width:8px;height:8px;flex:none;border-radius:9999px;background:var(--muted-foreground)}
.ds-notice[data-kind=error] .ds-notice-dot{background:var(--destructive)}
.ds-notice[data-kind=warn] .ds-notice-dot{background:#d97706}
.ds-notice-text{overflow-wrap:anywhere}
.ds-toast{position:absolute;left:50%;bottom:24px;z-index:6;transform:translateX(-50%);max-width:min(80%,560px);padding:8px 16px;border:1px solid var(--border);border-radius:9999px;background:var(--popover);color:var(--popover-foreground);font-size:13px;line-height:1.3;text-align:center;box-shadow:0 12px 32px rgb(0 0 0/.35);pointer-events:none}
/* R2 (B4): the floating "Reference in chat" pill, anchored bottom-centre of
   the selected artboard by the controller (left/top in canvas px). */
.ds-selection-pill{position:absolute;z-index:5;display:flex;align-items:center;gap:2px;transform:translateX(-50%);padding:3px;border:1px solid var(--border);border-radius:9999px;background:var(--popover);box-shadow:0 12px 32px rgb(0 0 0/.35);white-space:nowrap}
.ds-pill-send{padding:6px 12px;border:0;border-radius:9999px;background:var(--primary);color:var(--primary-foreground);font-size:13px;line-height:1.2;cursor:pointer}
.ds-pill-send:disabled,.ds-pill-send[aria-disabled=true]{opacity:.5;cursor:not-allowed}
.ds-pill-more{padding:6px 10px;border:0;border-radius:9999px;background:transparent;color:var(--muted-foreground);font-size:13px;line-height:1.2;cursor:pointer}
.ds-pill-more:hover{background:var(--accent);color:var(--accent-foreground)}
.ds-pill-more[aria-pressed=true]{background:var(--accent);color:var(--accent-foreground);box-shadow:inset 0 0 0 1px var(--border)}
.ds-pill-clear{width:26px;height:26px;border:0;border-radius:9999px;background:transparent;color:var(--muted-foreground);font-size:15px;line-height:1;cursor:pointer}
.ds-pill-clear:hover{background:var(--accent);color:var(--accent-foreground)}
.ds-pill-send:focus-visible,.ds-pill-more:focus-visible,.ds-pill-clear:focus-visible{outline:2px solid #4f8cff;outline-offset:2px}
.ds-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.ds-context-menu{position:fixed;z-index:7;min-width:180px;display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid var(--border);border-radius:var(--radius);background:var(--popover);box-shadow:0 12px 32px rgb(0 0 0/.35)}
.ds-menu-item{display:flex;align-items:center;gap:8px;padding:6px 10px;border:0;border-radius:calc(var(--radius) * .6);background:transparent;color:var(--popover-foreground);font-size:13px;line-height:1.2;text-align:left;cursor:pointer}
.ds-menu-item:hover,.ds-menu-item:focus{background:var(--accent);color:var(--accent-foreground);outline:none}
.ds-menu-item:focus-visible{outline:2px solid #4f8cff;outline-offset:-2px}
/* F10: 1px group separators and subtle per-action glyphs (text presentation,
   65% opacity — icons decorate, the labels carry the meaning). */
.ds-menu-sep{height:1px;margin:4px 2px;flex:none;background:var(--border)}
.ds-menu-item::before{flex:none;width:16px;text-align:center;font-size:13px;opacity:.65}
.ds-menu-item[data-action=send-to-chat]::before{content:"↗"}
.ds-menu-item[data-action=zoom]::before{content:"◎"}
.ds-menu-item[data-action=reload]::before{content:"↻"}
.ds-menu-item[data-action=reset-position]::before{content:"⌂"}
.ds-menu-item[data-action=export-png]::before{content:"⇩"}
.ds-menu-item[data-action=export-pdf]::before{content:"⇩"}
.ds-menu-item[data-action=copy-path]::before{content:"⧉"}
.ds-menu-item[data-action=fit-viewport]::before{content:"▯"}
.ds-menu-item[data-action=stop-server]::before{content:"⏹"}
.ds-menu-item[data-action=rename]::before{content:"✎"}
.state{position:absolute;inset:0;display:grid;place-items:center;text-align:center;background:var(--background)}
.state-body{max-width:100%;overflow-wrap:anywhere}
.sr{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
`;

const CANVAS_MARKUP = (screens: readonly PlacedScreen[], mode: 'edit' | 'play', legacyReasonBand: boolean): string => {
  const layout = flowLayout(screens);
  const artboards = screens.map((screen, index) => renderArtboard(screen, layout.cells[index]!, index, index === 0)).join('');
  const zero = screens.length === 0;
  return `
<div id="toolbar-root"></div><main id="canvas" class="canvas" data-mode="${mode}" tabindex="0" aria-label="Design canvas. Arrow keys pan. Plus and minus zoom. Shift 1 fits all screens. H toggles Pan. Double-click or press a screen title to focus it. Right-click a screen for options."><div id="toolbar-status-area"></div><div id="camera" class="camera" style="width:${layout.width}px;height:${layout.height}px">${artboards}</div><div id="pan-layer" class="pan-layer" hidden aria-hidden="true"></div><section id="state" class="state" data-state="empty"${zero ? '' : ' hidden'} aria-labelledby="state-title"><div class="state-body"><div id="spinner" role="status" aria-label="Loading screens"${zero ? ' hidden' : ''}>Loading…</div><h1 id="state-title"${zero ? '' : ' hidden'}>No screens on this canvas</h1><p id="state-copy"${zero ? '' : ' hidden'}>Ask the agent to design a screen, or retry after adding an entry to screens.json.</p><button id="state-action" hidden>Retry</button></div></section>${legacyReasonBand ? '<p id="layout-reason" class="fallback" role="status" hidden></p>' : ''}</main><div id="announcement" class="sr" aria-live="polite" aria-atomic="true"></div>
`;
};
