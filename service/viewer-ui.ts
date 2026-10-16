/** Capability-gated multi-artboard canvas. Stock toolbar assets are compiled offline. */
import { initCanvas } from '../viewer-client/src/canvas-controller.js';
import { VIEWER_CLIENT_JS, VIEWER_CLIENT_CSS } from './viewer-assets.generated.ts';

export type ViewerPage = { id: string; label: string; url: string };
export type ViewerScreen = { id: string; url: string; width: number; height: number; title: string };
export type ViewerConfig = { screens: ViewerScreen[]; viewport: { width: number; height: number }; mode: 'edit' | 'play' };

const MAX_SCREENS = 12;
const GRID_GAP = 48;
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

// Mirrors canvas-controller.js gridBounds: artboards at natural px, gap 48, array
// order, ceil(sqrt(n)) columns. Camera scale is transform-only and never enters this math.
function gridLayout(screens: readonly ViewerScreen[]) {
  const n = screens.length;
  if (!n) return { width: 0, height: 0, cells: [] as { x: number; y: number }[] };
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  const colWidths = new Array<number>(cols).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);
  screens.forEach((screen, index) => {
    const col = index % cols, row = Math.floor(index / cols);
    colWidths[col] = Math.max(colWidths[col]!, screen.width);
    rowHeights[row] = Math.max(rowHeights[row]!, screen.height);
  });
  const colX: number[] = []; let x = 0;
  for (const width of colWidths) { colX.push(x); x += width + GRID_GAP; }
  const rowY: number[] = []; let y = 0;
  for (const height of rowHeights) { rowY.push(y); y += height + GRID_GAP; }
  const cells = screens.map((_, index) => ({ x: colX[index % cols]!, y: rowY[Math.floor(index / cols)]! }));
  return { width: x - GRID_GAP, height: y - GRID_GAP, cells };
}

function renderArtboard(screen: ViewerScreen, cell: { x: number; y: number }, active: boolean): string {
  const id = escapeAttribute(screen.id);
  return `<section class="ds-artboard" data-screen="${id}" data-active="${active ? 'true' : 'false'}" style="left:${cell.x}px;top:${cell.y}px;width:${screen.width}px;height:${screen.height}px">`
    + `<button type="button" class="ds-ab-title">${escapeText(screen.title)}</button>`
    + `<span class="ds-ab-size">${screen.width} × ${screen.height}</span>`
    + `<iframe id="ds-frame-${id}" data-ds-screen="${id}" name="__dsArtifact:${id}" referrerpolicy="no-referrer" sandbox="${FRAME_SANDBOX}" src="${escapeAttribute(screen.url)}"></iframe>`
    + `<div class="ds-ab-state" data-state="loading"><p class="ds-ab-card-copy" role="status">Loading this screen.</p><button type="button" class="ds-ab-retry" hidden>Retry</button></div>`
    + `</section>`;
}

export function renderViewerHtml(config: ViewerConfig): string {
  const { width, height } = config.viewport;
  if (![width, height].every((n) => Number.isInteger(n) && n >= 100 && n <= 8192)) throw new Error('Invalid design viewport dimensions.');
  if (!Array.isArray(config.screens) || config.screens.length > MAX_SCREENS) throw new Error(`The canvas holds at most ${MAX_SCREENS} screens.`);
  const seen = new Set<string>();
  const screens = config.screens.map((screen) => {
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
    return { id: screen.id, url, width: screen.width, height: screen.height, title };
  });
  const mode = config.mode === 'play' ? 'play' : 'edit';
  // Deliberate allowlist: never serialize extra fields such as host bearer tokens.
  const safeConfig: ViewerConfig = { screens, viewport: { width, height }, mode };
  const bootstrap = `window.__dsViewerConfig=${inlineJson(safeConfig)};(${initCanvas.toString()})(window.__dsViewerConfig);`;
  return `<!DOCTYPE html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Design Canvas · Live screens</title>
<style>${VIEWER_CLIENT_CSS.replace(/<\/style/gi, '<\\/style')}</style><style>${CANVAS_GEOMETRY}</style></head><body>${CANVAS_MARKUP(screens, mode)}<script>${inlineScript(bootstrap)}</script><script>${inlineScript(VIEWER_CLIENT_JS)}</script></body></html>`;
}

// Canvas-only geometry. No legacy toolbar, control, typography, or palette CSS.
const CANVAS_GEOMETRY = String.raw`
html,body{margin:0;width:100%;height:100%}
body{display:flex;flex-direction:column;height:100dvh;overflow:hidden}
#toolbar-root{flex:none;min-width:0}
.canvas{position:relative;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden;touch-action:none}
.canvas[data-layout=fit]{touch-action:auto}
.camera{position:absolute;top:0;left:0;transform-origin:0 0}
iframe{display:block;border:0;width:100%;height:100%}
.camera[hidden],.pan-layer[hidden],.state[hidden],[hidden]{display:none}
.pan-layer{position:absolute;inset:0;z-index:4;cursor:grab;touch-action:none}
.canvas.dragging,.canvas.dragging .pan-layer{cursor:grabbing}
.ds-artboard{position:absolute;box-sizing:border-box;background:var(--card);outline:1px solid var(--border)}
.ds-artboard[data-active=true]{outline:2px solid var(--primary)}
.ds-artboard>.ds-ab-title,.ds-artboard>.ds-ab-size{position:absolute;bottom:100%;margin:0 0 6px;padding:0 8px;height:24px;display:inline-flex;align-items:center;font-size:12px;line-height:1;color:var(--muted-foreground);background:var(--muted);border-radius:6px}
.ds-artboard>.ds-ab-title{left:0;max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;cursor:pointer;color:var(--foreground)}
.ds-artboard>.ds-ab-title:hover{background:var(--accent)}
.ds-artboard>.ds-ab-size{right:0;white-space:nowrap}
.ds-ab-state{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;background:var(--card);padding:16px}
.ds-ab-state[data-state=loading]::before{content:"";width:28px;height:28px;border-radius:50%;border:2px solid var(--border);border-top-color:var(--primary);animation:ds-spin .9s linear infinite}
.ds-ab-card-copy{max-width:480px;margin:0;overflow-wrap:anywhere;color:var(--muted-foreground)}
.ds-ab-retry{color:var(--foreground)}
@keyframes ds-spin{to{transform:rotate(360deg)}}
.canvas[data-mode=edit] .ds-artboard>iframe{pointer-events:none}
.canvas[data-mode=edit] .ds-artboard{cursor:crosshair}
.canvas[data-mode=edit] .ds-artboard:hover{outline:2px solid var(--accent-foreground)}
.canvas[data-mode=edit] .ds-artboard:hover>.ds-ab-title{background:var(--accent)}
.state{position:absolute;inset:0;display:grid;place-items:center;text-align:center;background:var(--background)}
.state-body{max-width:100%;overflow-wrap:anywhere}
.fallback{position:absolute;bottom:0;left:0;max-width:100%;overflow-wrap:anywhere;pointer-events:none}
.sr{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
`;

const CANVAS_MARKUP = (screens: readonly ViewerScreen[], mode: 'edit' | 'play'): string => {
  const layout = gridLayout(screens);
  const artboards = screens.map((screen, index) => renderArtboard(screen, layout.cells[index]!, index === 0)).join('');
  const zero = screens.length === 0;
  return `
<div id="toolbar-root"></div><main id="canvas" class="canvas" data-mode="${mode}" tabindex="0" aria-label="Design canvas. Arrow keys pan. Plus and minus zoom. Shift 1 fits width. H toggles Pan. Double-click or press a screen title to focus it."><div id="toolbar-status-area"></div><div id="camera" class="camera" style="width:${layout.width}px;height:${layout.height}px">${artboards}</div><div id="pan-layer" class="pan-layer" hidden aria-hidden="true"></div><section id="state" class="state" data-state="empty"${zero ? '' : ' hidden'} aria-labelledby="state-title"><div class="state-body"><div id="spinner" role="status" aria-label="Loading screens"${zero ? ' hidden' : ''}>Loading…</div><h1 id="state-title"${zero ? '' : ' hidden'}>No screens on this canvas</h1><p id="state-copy"${zero ? '' : ' hidden'}>Ask the agent to design a screen, or retry after adding an entry to screens.json.</p><button id="state-action" hidden>Retry</button></div></section><p id="layout-reason" class="fallback" role="status" hidden></p></main><div id="announcement" class="sr" aria-live="polite" aria-atomic="true"></div>
`;
};
