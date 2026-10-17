// Design Studio local service.
//
// The panel iframe cannot touch the filesystem or the network, so this process
// owns the real Chrome window the live view is: the panel asks it to open or
// navigate a window (`/open`), raise it without reloading (`/focus`), read its
// state (`/state`) and reports change stats (`/stat`) so the panel can reload
// when the agent edits a file. Picking is a Cmd/Ctrl-click gesture in the live
// window (browser.ts's PICK_SCRIPT), not a route.
//
// Contract (GUEST_SERVICES.md): bind 127.0.0.1 on OPENCHAMBER_SERVICE_PORT,
// require `Authorization: Bearer OPENCHAMBER_SERVICE_TOKEN` on every request
// including /health, and answer GET /health with 200 once ready.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readStudioConfig, resolveConfigPath, writeStudioConfig } from './studio-config.ts';
import { ensureDevServer, getDevServerStatus, isLoopbackUrl, stopDevServer } from './project-server.ts';
import { ensureBrowser, getBrowser, stopBrowser } from './surface.ts';
import { BridgeClaims } from './bridge-claim.ts';
import { dockPlacement, reapOrphanChrome } from './browser.ts';
import { handleBrowserControl } from './browser-control.ts';
import { handleVerifyRequest } from './verify-routes.ts';
import { writeHarnessPlugin } from './harness-plugin.ts';
import { listProjectFiles, resolveReferencePath } from './project-files.ts';
import { scaffoldProject } from './scaffold.ts';
import * as scaffoldModule from './scaffold.ts';
import {
  hasScreensFile,
  readScreens,
  readScreensStrict,
  screenUrl,
  writeScreens,
  SCREENS_FILENAME,
  type DroppedScreenEntry,
  type CanvasMode,
} from './screens.ts';
import { watchRegistry, type RegistryChange } from './screens-watch.ts';
import { resolveWorkspaceRoot } from './workspace-root.ts';
import {
  getLastWorkspace,
  setLastWorkspace,
  updateLastWorkspaceAgentStatus,
  updateLastWorkspaceMode,
  updateLastWorkspaceView,
} from './last-workspace.ts';
import { mergeView, readView, validateViewPatch, ViewPatchError } from './view-state.ts';
import { getExportStatus, resolveFormats, startExportJob } from './export.ts';
import type { ExportScreen } from './export.ts';
import { runGateReport } from './gates/index.ts';
import { gatherGateContext } from './verify.ts';
import type { Browser } from './browser.ts';
import { BROWSER_PROVIDER_PATH } from '@openchamber/sdk';

const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT ?? 0);
const TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';

if (!PORT || !TOKEN) {
  console.error('[design-canvas] missing OPENCHAMBER_SERVICE_PORT or OPENCHAMBER_SERVICE_TOKEN');
  process.exit(1);
}

// ---- Design Canvas browser contract (spec §B) ----
// The real Browser class (service/browser.ts, P1-browser) carries the
// §B surface: openWorkspace(cfg)/setScreens/setMode/setActive/getMode/getState.
// main.ts calls those methods DIRECTLY — the P1 shim (asCanvas/CanvasBrowser)
// is gone.

/** View form of a screen: the registry entry with `file` joined into `url`
 *  plus optional view.json position fields (D6: merged in service-side;
 *  null = back to auto-grid, absent = the shell's inherit rule). `file`
 *  rides the push so the Browser can answer V4-10 copy-path / send-to-chat
 *  with the on-disk path. */
type CanvasScreen = {
  id: string;
  url: string;
  width: number;
  height: number;
  title: string;
  file?: string;
  x?: number | null;
  y?: number | null;
};

type Json = Record<string, unknown>;

function sendJson(res: http.ServerResponse, status: number, body: Json): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function requireFile(root: string, rel: string): Promise<string | null> {
  const abs = path.resolve(root, rel);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  try {
    const stat = await fs.stat(abs);
    return stat.isFile() ? abs : null;
  } catch {
    return null;
  }
}

/** Newest mtime among the entry and the files beside it, so a sibling edit reloads. */
async function newestMtime(dir: string, entryAbs: string): Promise<number> {
  let newest = 0;
  try {
    newest = (await fs.stat(entryAbs)).mtimeMs;
  } catch {
    /* entry unreadable; still report siblings */
  }
  try {
    const names = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of names) {
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.stat(path.join(dir, entry.name));
        if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* directory gone */
  }
  return newest;
}

// Exclusive pick-bridge ownership: one chat window at a time attaches picks.
const bridge = new BridgeClaims();

// ---- V4-14 (A): workspace-marker guard — defense in depth -------------------
// PUT /screens, PATCH /view, POST /export, POST /critique and POST
// /screens/sync may only ACT on a design workspace: the dir must carry a
// `.design-studio.json` (the marker name stays un-renamed per decision 1).
// A dir without it is a 400 {error:'not a design workspace'} — malformed by
// the house rule, because the route was addressed at a non-workspace.
//
// FORK-MERGE (V4-14 / integrator): this FROZEN decision re-baselines four
// PRE-V4 P2-A pins in tests/service.test.ts (NOT lane A's V4 file, so left
// untouched here) that addressed those routes with BARE mkdtemp dirs:
//   · 'GET/PUT /screens …'         — PUT now 400 unless the dir has the marker
//   · 'GET/PATCH /view …'          — PATCH now 400 unless the dir has the marker
//   · 'POST /export preconditions' — its `{dir:'C:\no-such-workspace'}` →
//       200 'window not open' NOW returns 400 not-a-design-workspace (the
//       marker guard runs before D4's window precondition, per V4-14)
//   · 'POST /critique …'           — same: no-window probe dir must be a marker
//       workspace to still reach the 200 ok:false window check
// Fix for each: create `.design-studio.json` in the test dir (the spec's OWN
// acceptance is "PATCH /view on a PLAIN temp dir → 400", so the guard must
// stay; only the fixtures change). Lane A's tests/v4-service.test.ts already
// pins BOTH directions (marker→200, no-marker→400) green.
async function isDesignWorkspace(dir: string): Promise<boolean> {
  return (await resolveConfigPath(dir)) !== null;
}

function sendNotAWorkspace(res: http.ServerResponse): void {
  sendJson(res, 400, { error: 'not a design workspace' });
}

// ---- V4-4: live registry watch (one watched dir at a time) -------------------
let watchStop: (() => void) | null = null;
let watchedDir: string | null = null;
/** JSON of the normalized registry last pushed into the shell (dedupe per V4-4). */
let lastPushedRegistry = '';

/** The notice text for silently-dropped registry entries (≤300 chars, V4-4). */
function droppedNoticeText(dropped: DroppedScreenEntry[]): string {
  const parts = dropped.map((d) => `screens.json entry ${d.index} dropped: ${d.reason}`);
  return parts.join(' · ').slice(0, 300);
}

/**
 * FIX-3 (F12): the registry banner is read by designers, so its text is human
 * prose — never the raw parser/JSON dump (`Unexpected token 'o', "not json"…
 * is not valid JSON` was the finding). The machine-readable string stays
 * untouched in `/state.registryError` (the route-live pin reads it there); the
 * service composes the banner copy here, at the single notice site.
 */
export function registryErrorNoticeText(error: string): string {
  const reason = error.startsWith(`${SCREENS_FILENAME}: `) ? error.slice(SCREENS_FILENAME.length + 2) : error;
  if (/is not valid JSON|Unexpected token|Unexpected end of JSON|Expected [^ ]+ in JSON/i.test(reason)) {
    return `screens.json isn't valid JSON, so the canvas kept the last good screens. Fix the file and the canvas picks it up automatically.`;
  }
  if (/ENOENT|no such file|does not exist/i.test(reason)) {
    return `screens.json could not be found, so the canvas kept the last good screens. Restore the file and the canvas picks it up automatically.`;
  }
  if (/EACCES|EPERM|EBUSY|operation not permitted/i.test(reason)) {
    return `screens.json could not be read (the file is locked or unreadable), so the canvas kept the last good screens. Close whatever holds the file and it reloads automatically.`;
  }
  const short = reason.length > 160 ? `${reason.slice(0, 157)}…` : reason;
  return `screens.json could not be read (${short}), so the canvas kept the last good screens.`;
}

/**
 * One registry tick: errors surface as a shell notice + /state.registryError
 * while the last good registry STAYS pushed; a good parse clears the error,
 * reports drops as a warn notice, and warm-pushes only when the normalized
 * registry actually differs from what the shell already has.
 */
async function applyRegistryChange(dir: string, change: RegistryChange): Promise<{ pushed: boolean }> {
  const browser = getBrowser();
  if (!browser || !(await browser.state()).windowOpen) return { pushed: false };
  if (!change.ok) {
    browser.setRegistryError(change.error);
    // FIX-3 (F12): the state field keeps the raw machine string; the BANNER is
    // composed human prose (see registryErrorNoticeText).
    await browser.setNotice({ id: 'registry', kind: 'error', text: registryErrorNoticeText(change.error) });
    return { pushed: false };
  }
  browser.setRegistryError(null);
  if (change.dropped.length > 0) {
    await browser.setNotice({ id: 'registry', kind: 'warn', text: droppedNoticeText(change.dropped) });
  } else {
    await browser.setNotice({ id: 'registry', kind: 'info', text: '' }); // empty text removes the notice
  }
  const key = JSON.stringify(change.registry);
  if (key === lastPushedRegistry) return { pushed: false };
  lastPushedRegistry = key;
  const pushed = await pushWorkspace(dir, { focus: false });
  return { pushed };
}

/** Start (or move) the watcher for a successfully opened workspace dir. */
function startRegistryWatch(dir: string): void {
  if (watchedDir === dir && watchStop) return;
  watchStop?.();
  watchedDir = dir;
  lastPushedRegistry = '';
  watchStop = watchRegistry(dir, (change) => {
    if (watchedDir !== dir) return;
    void applyRegistryChange(dir, change).catch(() => undefined); // V4-15: a push failure never escapes the watcher
  });
}

function stopRegistryWatch(): void {
  watchStop?.();
  watchStop = null;
  watchedDir = null;
  lastPushedRegistry = '';
}

/**
 * The WARM half of `/open {dir}` extracted (V4-4): view.json positions merged,
 * `openWorkspace` warm push, NO setActive change, NO camera restore, NO
 * bringToFront. Returns false when there is nothing live to push into.
 */
async function pushWorkspace(dir: string, opts: { focus: boolean }): Promise<boolean> {
  const browser = getBrowser();
  if (!browser || !(await browser.state()).windowOpen) return false;
  const { config } = await readStudioConfig(dir);
  const configUrl = typeof config?.url === 'string' && config.url.trim() !== '' ? config.url.trim() : null;
  if (!configUrl) return false;
  // A dead loopback dev server should come up for the new artboards, but the
  // push itself never depends on it (a down server = per-artboard error cards,
  // which V4-15's Retry then recovers).
  if (isLoopbackUrl(configUrl)) void ensureDevServer(configUrl, { dir }).catch(() => undefined);
  const registry = await readScreens(dir);
  if (registry.screens.length === 0) return false;
  const view = await readView(dir);
  const mode: CanvasMode = view.mode ?? getLastWorkspace()?.mode ?? 'edit';
  const viewScreens = mergeRegistryWithView(registry, view, configUrl);
  wireBrowserHooks(browser);
  await browser.openWorkspace({ dir, screens: viewScreens, baseUrl: configUrl, mode, focus: opts.focus });
  setLastWorkspace({
    dir,
    screens: registry.screens,
    mode,
    activeScreen: browser.getState().activeScreen,
    view,
  });
  return true;
}

/**
 * Registry entries + view.json positions → the pushed screen list (§C shape;
 * D6: a stored null = auto-grid, an absent key = omit the pair so the shell
 * inherits its live position). `file` rides along for V4-10 copy-path /
 * send-to-chat resolution.
 */
function mergeRegistryWithView(
  registry: { screens: { id: string; file: string; title: string; width: number; height: number }[] },
  view: Awaited<ReturnType<typeof readView>>,
  configUrl: string,
): CanvasScreen[] {
  return registry.screens.map((s) => {
    const hasPosition = Object.prototype.hasOwnProperty.call(view.positions, s.id);
    const position = view.positions[s.id];
    return {
      id: s.id,
      title: s.title,
      width: s.width,
      height: s.height,
      file: s.file,
      url: screenUrl(configUrl, s.file),
      ...(hasPosition ? { x: position ? position.x : null, y: position ? position.y : null } : {}),
    };
  });
}

/**
 * Wire the Browser's V4 hooks to the route layer (dev-server ensure behind
 * Retry V4-15; single-screen menu export V4-10). Idempotent — safe per open.
 */
function wireBrowserHooks(browser: Browser): void {
  browser.setDevServerEnsure(async (dir) => {
    try {
      const { config } = await readStudioConfig(dir);
      const url = typeof config?.url === 'string' && config.url.trim() !== '' ? config.url.trim() : null;
      if (!url) return { up: false, error: 'no .design-studio.json url found' };
      if (!isLoopbackUrl(url)) return { up: true }; // externally served: nothing to ensure
      const dev = await ensureDevServer(url, { dir });
      return { up: dev.up, ...(dev.error ? { error: dev.error } : {}) };
    } catch (error) {
      return { up: false, error: error instanceof Error ? error.message : 'dev-server check failed' };
    }
  });
  browser.setMenuExportHandler((screen, format) => {
    void runMenuExport(browser, screen, format).catch(() => undefined);
  });
  // FIX-3 (F17): the artboard context menu's 'Stop dev server' runs the same
  // recorded-process-group kill as POST /server/stop for the workspace dir.
  browser.setDevServerStop(async (dir) => stopDevServer(dir));
}

/**
 * V4-10 export-png / export-pdf: the existing single-slot D4 job with
 * screens:[id] and one format; the shell toast arrives when the job settles.
 * Exported for the hermetic joined-job pin (tests/v4-service.test.ts drives it
 * through a spawned import of this module with a stub Browser).
 */
export async function runMenuExport(browser: Browser, screen: string, format: 'png' | 'pdf'): Promise<void> {
  const dir = browser.currentWorkspaceDir();
  if (!dir) return;
  const { config } = await readStudioConfig(dir);
  const configUrl = typeof config?.url === 'string' && config.url.trim() !== '' ? config.url.trim() : null;
  if (!configUrl) {
    await browser.pushToast('warn', 'No dev-server url is configured for this workspace');
    return;
  }
  const registry = await readScreens(dir);
  const entry = registry.screens.find((s) => s.id === screen);
  if (!entry) {
    await browser.pushToast('warn', `screens.json has no "${screen}" entry to export`);
    return;
  }
  const live = (await browser.state()).screens.find((s) => s.id === screen);
  const started = startExportJob({
    dir,
    screens: [
      {
        id: entry.id,
        url: screenUrl(configUrl, entry.file),
        width: entry.width,
        height: entry.height,
        state: live?.state ?? 'loading',
        ...(live?.message ? { message: live.message } : {}),
      },
    ],
    formats: [format],
    browser,
  });
  // F6 (V4 QA): the D4 slot is GLOBAL — a menu export fired while any other
  // export runs JOINS that foreign job, and the old poll then reported
  // "Export failed: no result" for a screen the joined job never had. Say
  // what actually happened instead.
  if (started.joined === true) {
    await browser.pushToast('warn', 'Another export is running — try again');
    return;
  }
  // Poll the D4 status the same way the panel's /canvas export does (700 ms),
  // bounded at 120 s; the toast closes the loop in the canvas (V4-10).
  const deadline = Date.now() + 120_000;
  for (;;) {
    const status = getExportStatus(dir, started.jobId);
    if ('state' in status) {
      if (status.state === 'done') {
        const result = status.results.find((r) => r.screen === screen)?.[format];
        if (result && result.ok) await browser.pushToast('ok', `Exported ${result.file}`);
        else await browser.pushToast('warn', `Export failed: ${result && !result.ok ? result.error : status.error ?? 'no result'}`);
        return;
      }
      if (status.state === 'failed') {
        await browser.pushToast('warn', `Export failed: ${status.error ?? 'job failed'}`);
        return;
      }
    }
    if (Date.now() >= deadline) {
      await browser.pushToast('warn', 'Export is taking unusually long — check /export/status');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

/**
 * V4-13 (P2): dock the canvas beside the host window. availWidth comes from
 * the shell page itself (window.screen.availWidth — the only honest source;
 * the §3 dock payload carries just the host rect). Null = no window or no
 * number: leave the user's placement exactly as it is.
 */
async function applyDock(browser: Browser, host: { x: number; y: number; width: number; height: number }): Promise<void> {
  try {
    const availWidth = await browser.screenAvailWidth();
    if (availWidth === null) return;
    const spec = dockPlacement(host, availWidth);
    if (!spec) return;
    await browser.placeWindow(spec.x, spec.y, spec.width, spec.height);
  } catch {
    /* window placement is best effort — never fails an open */
  }
}

/**
 * V4-13 auto-dock (integrator decision, A's MUST 7): the panel CANNOT send a
 * dock rect yet — the OpenChamber SDK exposes no host-window bounds API (see
 * the FORK-MERGE in panel/main.ts; sending guest-iframe numbers would
 * mis-dock Chrome). The spec's intent is "canvas beside the chat", so on a
 * user-initiated open (focus:true) WITHOUT an explicit dock the service
 * assumes the chat occupies the LEFT HALF of the available screen and docks
 * Chrome into the remainder via the same pure dockPlacement math: it places
 * only when the right side leaves ≥640 px (640 floor, 1440 cap), and a
 * non-zero-origin (secondary) display simply answers null → placement is left
 * exactly as the user put it. An explicit body dock always overrides this.
 */
async function applyAutoDock(browser: Browser): Promise<void> {
  try {
    const screen = await browser.screenAvailRect();
    if (!screen) return;
    const spec = dockPlacement(
      { x: screen.x, y: screen.y, width: Math.round(screen.width / 2), height: screen.height },
      screen.width,
    );
    if (!spec) return;
    await browser.placeWindow(spec.x, spec.y, spec.width, spec.height);
  } catch {
    /* placement is best effort — never fails an open */
  }
}

// ---- V4-11: the async scaffold job (E15: first-run cannot time out) ----------
type ScaffoldJobState = 'installing' | 'booting' | 'done' | 'failed';
type ScaffoldJob = {
  id: string;
  dir: string;
  state: ScaffoldJobState;
  startedAt: number;
  url: string;
  error?: string;
};
let scaffoldJob: ScaffoldJob | null = null;
let scaffoldCounter = 0;

/**
 * D's split of scaffold.ts into `writeScaffoldFiles` + `installAndBoot`
 * (V4-11) upgrades the job to precise two-stage progress with the real url in
 * the immediate response. Detection is by export name — main.ts never edits
 * scaffold.ts. Until both land, the WHOLE scaffoldProject runs inside the
 * job: the 20 s host cap is off the response path either way, which is what
 * E15 actually breaks.
 * FORK-MERGE(V4-11/integrator): the split path assumes
 * `writeScaffoldFiles(options) -> {ok,url,files}|{ok,error}` and
 * `installAndBoot(options & {url}) -> {ok}|{ok,error}` — align to D's shipped
 * signatures at integration.
 */
type ScaffoldSplit = {
  writeScaffoldFiles: (options: Record<string, unknown>) => Promise<{ ok: boolean; url?: string; error?: string }>;
  installAndBoot: (options: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
};

function scaffoldSplit(): ScaffoldSplit | null {
  const mod = scaffoldModule as unknown as Record<string, unknown>;
  const writeFiles = mod['writeScaffoldFiles'];
  const installBoot = mod['installAndBoot'];
  if (typeof writeFiles === 'function' && typeof installBoot === 'function') {
    return {
      writeScaffoldFiles: writeFiles as ScaffoldSplit['writeScaffoldFiles'],
      installAndBoot: installBoot as ScaffoldSplit['installAndBoot'],
    };
  }
  return null;
}

export type ScaffoldAsyncOutcome =
  | { ok: true; jobId: string; dir: string; url: string }
  | { ok: false; error: string };

/**
 * POST /scaffold {async:true}: answer right after the workspace files exist;
 * npm install + dev boot continue in the single-slot job. A second concurrent
 * async POST for the SAME dir joins the running job (mirrors D4's export
 * slot); a different dir replaces a finished job and runs too.
 */
async function startAsyncScaffold(options: {
  dir: string;
  type: string;
  direction?: string;
  fidelity?: string;
  brief?: string;
  designSystemId?: string;
  install?: boolean;
  boot?: boolean;
}): Promise<ScaffoldAsyncOutcome> {
  const split = scaffoldSplit();
  if (split) {
    let files: { ok: boolean; url?: string; error?: string };
    try {
      files = await split.writeScaffoldFiles({ ...options });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'scaffold could not write its files' };
    }
    if (!files.ok) return { ok: false, error: files.error ?? 'scaffold could not write its files' };
    const job: ScaffoldJob = {
      id: `scaffold-${++scaffoldCounter}`,
      dir: options.dir,
      state: 'installing',
      startedAt: Date.now(),
      url: files.url ?? '',
    };
    scaffoldJob = job;
    void (async () => {
      try {
        const booted = await split.installAndBoot({ ...options, url: files.url });
        if (scaffoldJob === job) {
          job.state = booted.ok ? 'done' : 'failed';
          if (!booted.ok) job.error = booted.error ?? 'install/boot failed';
        }
      } catch (error) {
        if (scaffoldJob === job) {
          job.state = 'failed';
          job.error = error instanceof Error ? error.message : 'install/boot failed';
        }
      }
    })();
    return { ok: true, jobId: job.id, dir: job.dir, url: job.url };
  }
  // Legacy path: join a still-running job for the same dir, else run the whole
  // scaffold in the background; the url lands with the job result.
  if (scaffoldJob && scaffoldJob.dir === options.dir && (scaffoldJob.state === 'installing' || scaffoldJob.state === 'booting')) {
    return { ok: true, jobId: scaffoldJob.id, dir: scaffoldJob.dir, url: scaffoldJob.url };
  }
  const job: ScaffoldJob = {
    id: `scaffold-${++scaffoldCounter}`,
    dir: options.dir,
    state: 'installing',
    startedAt: Date.now(),
    url: '',
  };
  scaffoldJob = job;
  void (async () => {
    try {
      const result = await scaffoldProject(options);
      if (scaffoldJob === job) {
        if (result.ok) {
          job.state = 'done';
          job.url = result.url;
        } else {
          job.state = 'failed';
          job.error = result.error;
        }
      }
    } catch (error) {
      if (scaffoldJob === job) {
        job.state = 'failed';
        job.error = error instanceof Error ? error.message : 'scaffold failed';
      }
    }
  })();
  return { ok: true, jobId: job.id, dir: job.dir, url: job.url };
}

/** Cross-platform absolute-dir equality for the F10 job/dir match (win32 is
 *  case-insensitive; separators normalize through path.resolve). */
function sameAbsoluteDir(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** GET /scaffold/status body (unknown job = 200 business failure, house rule).
 *  F10 (V4 QA): the poll must name the job's OWN dir — an id/dir pair that
 *  does not match the single-slot job answers like an unknown job, so a stale
 *  or foreign poller can never read another workspace's scaffold progress. */
function scaffoldStatus(id: string, dir: string): Json {
  if (!scaffoldJob || scaffoldJob.id !== id || !sameAbsoluteDir(scaffoldJob.dir, dir)) {
    return { ok: false, error: 'unknown scaffold job' };
  }
  const job = scaffoldJob;
  return {
    state: job.state,
    elapsedMs: Date.now() - job.startedAt,
    ...(job.error ? { error: job.error } : {}),
    ...(job.url ? { url: job.url } : {}),
  };
}

const server = http.createServer(async (req, res) => {
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${TOKEN}`) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const params = url.searchParams;

  try {
    // The agent-facing browser provider. The host posts every browser.* action
    // here with the same bearer token; we answer with the BrowserProviderResult
    // union. A failed action is a 200 with `ok:false` and an actionable message,
    // never a transport error, so the agent can read it and correct itself.
    if (req.method === 'POST' && url.pathname === BROWSER_PROVIDER_PATH) {
      const body = await readBody(req);
      const result = await handleBrowserControl(req, body);
      sendJson(res, 200, result as unknown as Json);
      return;
    }

    // The verify routes (run the matrix, return the last report).
    if (url.pathname === '/verify' || url.pathname.startsWith('/verify/')) {
      if (await handleVerifyRequest(req, res)) return;
    }

    // Write the project-local OpenCode plugin that runs the harness in-session.
    // Called by the panel when Design Mode turns ON for a ready project. Writing
    // into the project is a deliberate side effect; harness-plugin.ts never
    // clobbers a file it did not generate and is idempotent.
    if (url.pathname === '/harness') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const dir = (parsed as { dir?: unknown } | null)?.dir;
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
        sendJson(res, 400, { error: 'dir must be an absolute project path' });
        return;
      }
      try {
        sendJson(res, 200, (await writeHarnessPlugin(dir)) as unknown as Json);
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : 'could not write harness plugin' });
      }
      return;
    }

    // Validate an explicitly pasted reference; no file contents are returned.
    if (url.pathname === '/reference') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const body = parsed as { dir?: unknown; path?: unknown } | null;
      if (typeof body?.dir !== 'string' || typeof body.path !== 'string') {
        sendJson(res, 400, { error: 'dir and path must be strings. Paste an accessible file path.' });
        return;
      }
      try {
        sendJson(res, 200, { ...(await resolveReferencePath(body.dir, body.path)) });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : 'could not validate file path' });
      }
      return;
    }

    // List a project's files so the panel can attach a FILE reference to a
    // message. Bearer-authed; `dir` must be an absolute path and `limit`, when
    // present, a positive integer. A listing the service cannot produce (a
    // missing or unreadable directory) is a 200 with `ok:false`, never a
    // transport error.
    if (url.pathname === '/files') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const body = parsed as { dir?: unknown; limit?: unknown } | null;
      const dir = body?.dir;
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
        sendJson(res, 400, { error: 'dir must be an absolute project path' });
        return;
      }
      const limit = body?.limit;
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) {
        sendJson(res, 400, { error: 'limit must be a positive integer' });
        return;
      }
      try {
        sendJson(res, 200, { ok: true, files: await listProjectFiles(dir, limit) });
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : 'could not list files' });
      }
      return;
    }

    // Scaffold a design project server-side, before the agent session starts, so
    // the panel has a live URL the moment Design Mode opens. The dir must be an
    // absolute path and type a non-empty string; questions of validity are a
    // 400, everything the scaffold itself decides (already exists, port busy,
    // install failure, server did not come up) is a 200 with `ok:false`.
    if (url.pathname === '/scaffold') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const body = parsed as
        | { dir?: unknown; type?: unknown; direction?: unknown; fidelity?: unknown; brief?: unknown; designSystemId?: unknown; async?: unknown; install?: unknown; boot?: unknown }
        | null;
      const dir = body?.dir;
      const type = body?.type;
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
        sendJson(res, 400, { error: 'dir must be an absolute project path' });
        return;
      }
      if (typeof type !== 'string' || type.trim() === '') {
        sendJson(res, 400, { error: 'type must be a non-empty string' });
        return;
      }
      // designSystemId is optional; only a present non-string value is invalid.
      if (body?.designSystemId !== undefined && typeof body.designSystemId !== 'string') {
        sendJson(res, 400, { error: 'designSystemId must be a string' });
        return;
      }
      // V4-14 hygiene: `async` must be a boolean when present (else 400).
      if (body?.async !== undefined && typeof body.async !== 'boolean') {
        sendJson(res, 400, { error: 'async must be a boolean' });
        return;
      }
      // install/boot pass through as booleans only (the V4-11 job's hermetic
      // seam — an injected install FUNCTION stays a module-level test seam, it
      // cannot cross JSON); anything non-boolean is malformed → 400.
      if (body?.install !== undefined && typeof body.install !== 'boolean') {
        sendJson(res, 400, { error: 'install must be a boolean' });
        return;
      }
      if (body?.boot !== undefined && typeof body.boot !== 'boolean') {
        sendJson(res, 400, { error: 'boot must be a boolean' });
        return;
      }
      const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
      const options = {
        dir,
        type,
        direction: str(body?.direction),
        fidelity: str(body?.fidelity),
        brief: str(body?.brief),
        designSystemId: str(body?.designSystemId),
        ...(typeof body?.install === 'boolean' ? { install: body.install } : {}),
        ...(typeof body?.boot === 'boolean' ? { boot: body.boot } : {}),
      };
      if (body?.async === true) {
        // V4-11 (E15): npm install + dev boot continue in a single-slot job;
        // the response leaves the 20 s host cap the moment the files exist.
        // Precondition failures stay {ok:false,error} at 200 like the sync path.
        const outcome = await startAsyncScaffold(options);
        sendJson(res, 200, outcome as unknown as Json);
        return;
      }
      sendJson(res, 200, (await scaffoldProject(options)) as unknown as Json);
      return;
    }

    // V4-11 status poll for the async scaffold job. `dir` and `job` are
    // required query params (400 when malformed); an unknown job answers
    // 200 {ok:false,error} — business failures never ride the transport.
    if (url.pathname === '/scaffold/status') {
      const dir = params.get('dir') ?? '';
      const jobParam = params.get('job') ?? '';
      if (!path.isAbsolute(dir) || jobParam === '') {
        sendJson(res, 400, { error: 'dir must be absolute and job is required' });
        return;
      }
      sendJson(res, 200, scaffoldStatus(jobParam, dir));
      return;
    }

    // Start (or confirm) the dev server for a project dir. The service reads
    // the project's `.design-studio.json` and only ever tries to start a loopback
    // URL. Bearer-authed; an absolute `dir` and a loopback `url` are required.
    // A business failure is a 200 with `ok:false` and an actionable `error`.
    if (url.pathname === '/server/start') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const dir = (parsed as { dir?: unknown } | null)?.dir;
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
        sendJson(res, 400, { error: 'dir must be an absolute project path' });
        return;
      }
      const targetUrl = (parsed as { url?: unknown } | null)?.url;
      if (typeof targetUrl !== 'string' || targetUrl === '') {
        sendJson(res, 400, { error: 'url is required' });
        return;
      }
      if (!isLoopbackUrl(targetUrl)) {
        sendJson(res, 400, { error: 'url must be a loopback address' });
        return;
      }
      try {
        const { config } = await readStudioConfig(dir);
        if (!config?.url?.trim()) {
          sendJson(res, 200, { ok: false, started: false, up: false, error: 'no .design-studio.json url found' });
          return;
        }
        const configuredUrl = config.url.trim();
        if (!isLoopbackUrl(configuredUrl)) {
          sendJson(res, 200, { ok: false, started: false, up: false, error: 'configured url is not loopback' });
          return;
        }
        // The request url is validation-only: the config's url is authoritative,
        // so the probe, the record and the recorded port all use the URL the
        // project is actually pinned to. `ownedOnly` keeps a manual start from
        // announcing a foreign process on the configured port as our running
        // server: without a verified record it refuses with the port-in-use
        // error instead. (/open stays permissive for externally served previews.)
        const result = await ensureDevServer(configuredUrl, { dir, ownedOnly: true });
        sendJson(res, 200, { ok: result.up, started: result.started, up: result.up, error: result.error });
      } catch (error) {
        sendJson(res, 200, { ok: false, started: false, up: false, error: error instanceof Error ? error.message : 'could not start the dev server' });
      }
      return;
    }

    // Stop the dev server the service started for a project dir (Design Mode
    // OFF, or the panel's manual escape hatch). The service ONLY kills a process
    // group it recorded for this dir; an unknown dir is a no-op. Bearer-authed,
    // an absolute dir required; a business failure is a 200 with ok:false.
    if (url.pathname === '/server/stop') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const dir = (parsed as { dir?: unknown } | null)?.dir;
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
        sendJson(res, 400, { error: 'dir must be an absolute project path' });
        return;
      }
      try {
        const result = await stopDevServer(dir);
        // A clean no-op (nothing recorded) stays ok:true; a refusal or failed
        // kill carries ok:false with the actionable error.
        sendJson(
          res,
          200,
          result.error
            ? { ok: false, stopped: result.stopped, error: result.error }
            : { ok: true, stopped: result.stopped },
        );
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : 'could not stop the dev server' });
      }
      return;
    }

    // Status of the dev server recorded for a project dir, so the panel can
    // show/verify the preview without starting anything.
    if (url.pathname === '/server/status') {
      const dir = params.get('dir') ?? '';
      if (!path.isAbsolute(dir)) {
        sendJson(res, 400, { error: 'dir must be absolute' });
        return;
      }
      try {
        sendJson(res, 200, (await getDevServerStatus(dir)) as unknown as Json);
      } catch (error) {
        sendJson(res, 200, { up: false, port: null, error: error instanceof Error ? error.message : 'could not read server status' });
      }
      return;
    }

    // The canvas screen registry (spec §A/§B). GET answers the normalized
    // registry (bad entries silently dropped, duplicates deduped, sizes
    // clamped 200–8192); a missing or unreadable screens.json reads as
    // {version:1,screens:[]}. PUT validates the full registry and writes it —
    // an invalid body is a 400 with an actionable error. `dir` must be
    // absolute in both cases.
    if (url.pathname === '/screens') {
      const dir = params.get('dir') ?? '';
      if (!path.isAbsolute(dir)) {
        sendJson(res, 400, { error: 'dir must be absolute' });
        return;
      }
      if (req.method === 'PUT') {
        // V4-14 defense in depth: only a design workspace's registry is writable.
        if (!(await isDesignWorkspace(dir))) {
          sendNotAWorkspace(res);
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          sendJson(res, 400, { error: 'body must be JSON' });
          return;
        }
        try {
          sendJson(res, 200, { ...(await writeScreens(dir, parsed)) });
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : 'invalid screens registry' });
        }
        return;
      }
      sendJson(res, 200, (await readScreens(dir)) as unknown as Json);
      return;
    }

    // V4-4 backstop: the panel posts this on session `completed` so a missed
    // watcher tick (sleep, sync-tool hiccup) still converges the canvas. Same
    // semantics as a watch tick: strict re-read, notice/error surfacing, and a
    // warm push only when the normalized registry differs. V4-14 marker guard.
    if (url.pathname === '/screens/sync') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const dir = (parsed as { dir?: unknown } | null)?.dir;
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
        sendJson(res, 400, { error: 'dir must be an absolute workspace path' });
        return;
      }
      if (!(await isDesignWorkspace(dir))) {
        sendNotAWorkspace(res);
        return;
      }
      try {
        const browser = getBrowser();
        if (!browser || !(await browser.state()).windowOpen) {
          sendJson(res, 200, { ok: true, pushed: false });
          return;
        }
        // A sync for a dir the canvas is not showing must not hijack the live
        // workspace — the response says so plainly (no push happened).
        const current = getLastWorkspace()?.dir ?? watchedDir ?? browser.currentWorkspaceDir();
        if (current && path.resolve(current) !== path.resolve(dir)) {
          sendJson(res, 200, { ok: true, pushed: false, reason: 'this workspace is not the one open on the canvas' });
          return;
        }
        const change = await readScreensStrict(dir);
        const result = await applyRegistryChange(dir, change);
        sendJson(res, 200, { ok: true, pushed: result.pushed });
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : 'registry sync failed' });
      }
      return;
    }

    // V4-5: the ordered pick queue the panel drains (GET /picks?since&wait).
    // `since` is a seq floor (default 0); `wait` long-polls 0..12000 ms — the
    // response resolves immediately when picks are pending, at the first push
    // otherwise, and at the deadline with whatever exists. No browser: empty.
    if (url.pathname === '/picks') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'GET required' });
        return;
      }
      const sinceRaw = params.get('since') ?? '0';
      const waitRaw = params.get('wait') ?? '0';
      const since = Number(sinceRaw);
      const wait = Number(waitRaw);
      if (!Number.isInteger(since) || since < 0) {
        sendJson(res, 400, { error: 'since must be a non-negative integer' });
        return;
      }
      if (!Number.isFinite(wait) || wait < 0) {
        sendJson(res, 400, { error: 'wait must be a non-negative number of milliseconds' });
        return;
      }
      const browser = getBrowser();
      if (!browser) {
        sendJson(res, 200, { seq: 0, picks: [] });
        return;
      }
      const page = await browser.getPicks(since, Math.min(wait, 12_000));
      sendJson(res, 200, page as unknown as Json);
      return;
    }

    // V4-5: the panel confirms consumption (`{seq:int≤latest, label≤80}`); the
    // service answers the shell with the "Added to chat" toast and clears the
    // unacked watchdog when the seq covers the newest push.
    if (url.pathname === '/picks/ack') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const body = parsed as { seq?: unknown; label?: unknown } | null;
      if (typeof body?.seq !== 'number' || !Number.isInteger(body.seq) || body.seq < 0) {
        sendJson(res, 400, { error: 'seq must be a non-negative integer' });
        return;
      }
      if (typeof body.label !== 'string' || body.label === '' || body.label.length > 80) {
        sendJson(res, 400, { error: 'label must be a string of 1–80 characters' });
        return;
      }
      getBrowser()?.ackPicks(body.seq, body.label);
      sendJson(res, 200, { ok: true });
      return;
    }

    // V4-12: the chat↔canvas loop is visible in the canvas. The panel posts
    // busy transitions; the service forwards to `__dsCanvas.setAgentStatus`
    // and echoes the status into lastWorkspace. Display-only (fence).
    if (url.pathname === '/agent-status') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const body = parsed as { busy?: unknown; label?: unknown } | null;
      if (typeof body?.busy !== 'boolean') {
        sendJson(res, 400, { error: 'busy must be a boolean' });
        return;
      }
      if (body.label !== undefined && (typeof body.label !== 'string' || body.label.length > 60)) {
        sendJson(res, 400, { error: 'label must be a string of at most 60 characters' });
        return;
      }
      const label = typeof body.label === 'string' && body.label !== '' ? body.label : undefined;
      updateLastWorkspaceAgentStatus(label ? { busy: body.busy, label } : { busy: body.busy });
      const browser = getBrowser();
      if (browser) await browser.setAgentStatus(label ? { busy: body.busy, label } : { busy: body.busy });
      sendJson(res, 200, { ok: true });
      return;
    }

    // Design workspaces on disk (decision 2/§F): the workspace root (resolved
    // service-side, NEVER by the panel) and every child containing a
    // .design-studio.json — with the config's name/url, and screens when
    // screens.json exists. A missing workspace root answers an empty list,
    // never an error.
    if (url.pathname === '/workspaces') {
      const rootDir = await resolveWorkspaceRoot();
      const workspaces: Json[] = [];
      try {
        for (const entry of await fs.readdir(rootDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const dir = path.join(rootDir, entry.name);
          if ((await resolveConfigPath(dir)) === null) continue;
          const { config } = await readStudioConfig(dir);
          const name =
            typeof config?.name === 'string' && config.name.trim() !== '' ? config.name.trim() : entry.name;
          const item: Json = { dir, name };
          if (typeof config?.url === 'string' && config.url.trim() !== '') item.url = config.url.trim();
          if (await hasScreensFile(dir)) {
            const registry = await readScreens(dir);
            item.screens = registry.screens as unknown as Json;
          }
          workspaces.push(item);
        }
      } catch {
        /* no workspace root yet: answer the root with an empty list */
      }
      workspaces.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      sendJson(res, 200, { root: rootDir, workspaces });
      return;
    }

    // Canvas mode (decision 8): validate 'edit'|'play', push into the live
    // shell when a browser is running and always echo in memory (so the next
    // /open starts in the chosen mode). With no browser yet this is a warm
    // no-op: ok:true. D5: the mode is workspace-persisted — through view.json
    // when the workspace dir is known (the browser records it on /open, the
    // echo carries it for the cold/no-browser case). R1: a shell refusal
    // still echoes the REQUESTED mode; /state.modeApplied flags it.
    if (url.pathname === '/mode') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const mode = (parsed as { mode?: unknown } | null)?.mode;
      if (mode !== 'edit' && mode !== 'play') {
        sendJson(res, 400, { error: 'mode must be "edit" or "play"' });
        return;
      }
      updateLastWorkspaceMode(mode);
      const target = getBrowser();
      if (target) {
        // The browser persists through its own workspaceDir when it has one.
        await target.setMode(mode);
      } else {
        const echo = getLastWorkspace();
        if (echo?.dir) {
          try {
            updateLastWorkspaceView(await mergeView(echo.dir, { mode }));
          } catch {
            /* view.json persistence is best effort; the echo still holds */
          }
        }
      }
      sendJson(res, 200, { ok: true, mode });
      return;
    }

    // D5/D6: the user's canvas view state. GET answers view.json-or-default
    // (absolute-dir gate like /stat); PATCH merges per key (camera/positions/
    // mode) through view-state.ts and answers {ok:true}. There is NO PUT:
    // nothing may full-overwrite view.json except the service's own merge.
    if (url.pathname === '/view') {
      const dir = params.get('dir') ?? '';
      if (!path.isAbsolute(dir)) {
        sendJson(res, 400, { error: 'dir must be absolute' });
        return;
      }
      if (req.method === 'PUT') {
        sendJson(res, 405, { error: 'PUT is not supported on /view; PATCH merges per key' });
        return;
      }
      if (req.method === 'PATCH') {
        // V4-14: only a design workspace owns a view.json.
        if (!(await isDesignWorkspace(dir))) {
          sendNotAWorkspace(res);
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          sendJson(res, 400, { error: 'body must be JSON' });
          return;
        }
        try {
          const patch = validateViewPatch(parsed);
          const merged = await mergeView(dir, patch);
          if (getLastWorkspace()?.dir === dir) updateLastWorkspaceView(merged);
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 400, { error: error instanceof ViewPatchError ? error.message : 'invalid view patch' });
        }
        return;
      }
      sendJson(res, 200, (await readView(dir)) as unknown as Json);
      return;
    }

    // D4: start (or join) the single-slot async export job. Business failures
    // are 200 {ok:false,error}; only malformed input is a 400. The job walks
    // screens → PNG (shell capture trio) → PDF (hidden throwaway target) and
    // writes <workspace>/exports/<id>.<fmt>; the panel polls /export/status.
    if (url.pathname === '/export') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const body = parsed as { dir?: unknown; screens?: unknown; formats?: unknown } | null;
      const dir = body?.dir;
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
        sendJson(res, 400, { error: 'dir must be an absolute workspace path' });
        return;
      }
      // V4-14: exports only run on a design workspace.
      if (!(await isDesignWorkspace(dir))) {
        sendNotAWorkspace(res);
        return;
      }
      let requested: string[] | null = null;
      if (body?.screens !== undefined) {
        if (!Array.isArray(body.screens) || body.screens.some((s) => typeof s !== 'string')) {
          sendJson(res, 400, { error: 'screens must be an array of screen ids' });
          return;
        }
        requested = body.screens as string[];
      }
      const formats = resolveFormats(body?.formats);
      if ('error' in formats) {
        sendJson(res, 400, { error: formats.error });
        return;
      }
      try {
        // Preconditions, in D4's order: a live window, the dev server (same
        // probe as /open: loopback configs only), then the screens resolve.
        const browser = getBrowser();
        if (!browser || !(await browser.state()).windowOpen) {
          sendJson(res, 200, { ok: false, error: 'the live canvas window is not open' });
          return;
        }
        const { config } = await readStudioConfig(dir);
        const configUrl =
          typeof config?.url === 'string' && config.url.trim() !== '' ? config.url.trim() : null;
        if (!configUrl) {
          sendJson(res, 200, { ok: false, error: 'no .design-studio.json url found' });
          return;
        }
        if (isLoopbackUrl(configUrl)) {
          const dev = await ensureDevServer(configUrl, { dir });
          if (!dev.up) {
            sendJson(res, 200, { ok: false, error: dev.error ?? 'the dev server is not available' });
            return;
          }
        }
        const registry = await readScreens(dir);
        if (registry.screens.length === 0) {
          sendJson(res, 200, { ok: false, error: 'the workspace has no screens to export' });
          return;
        }
        const wanted = requested ?? registry.screens.map((s) => s.id);
        const unknown = wanted.find((id) => !registry.screens.some((s) => s.id === id));
        if (unknown !== undefined) {
          sendJson(res, 400, { error: `unknown screen id: ${unknown}` });
          return;
        }
        // Per-screen readiness from the live browser state (R2); the exported
        // artboard is the DESIGN source, so the registry-joined URL is printed
        // (not a drifted in-frame liveUrl from play-mode navigation).
        const live = (await browser.state()).screens;
        const screens: ExportScreen[] = registry.screens
          .filter((s) => wanted.includes(s.id))
          .map((s) => {
            const liveScreen = live.find((entry) => entry.id === s.id);
            return {
              id: s.id,
              url: screenUrl(configUrl, s.file),
              width: s.width,
              height: s.height,
              state: liveScreen?.state ?? 'loading',
              ...(liveScreen?.message ? { message: liveScreen.message } : {}),
            };
          });
        const started = startExportJob({ dir, screens, formats: formats.formats, browser });
        sendJson(res, 200, started as unknown as Json);
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : 'export could not start' });
      }
      return;
    }

    // D4 status poll. `dir` and `job` are required query params (400 when
    // malformed); an unknown job id answers 200 {ok:false,error} — business
    // failures never ride the transport.
    if (url.pathname === '/export/status') {
      const dir = params.get('dir') ?? '';
      const jobParam = params.get('job') ?? '';
      if (!path.isAbsolute(dir) || jobParam === '') {
        sendJson(res, 400, { error: 'dir must be absolute and job is required' });
        return;
      }
      const status = getExportStatus(dir, jobParam);
      sendJson(res, 200, status as unknown as Json);
      return;
    }

    // D7-C: the gate-backed critique digest. A bounded walk over the canvas's
    // screens (≤12): per-screen probe (no camera move, no resize — the frame's
    // own inner size is its artboard size), runGateReport, and a bounded
    // digest the panel composes into the chat as a review REQUEST. 200 always,
    // except malformed input.
    if (url.pathname === '/critique') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const dir = (parsed as { dir?: unknown } | null)?.dir;
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
        sendJson(res, 400, { error: 'dir must be an absolute workspace path' });
        return;
      }
      // V4-14: a critique digests a design workspace, nothing else.
      if (!(await isDesignWorkspace(dir))) {
        sendNotAWorkspace(res);
        return;
      }
      const browser = getBrowser();
      if (!browser || !(await browser.state()).windowOpen) {
        sendJson(res, 200, { ok: false, error: 'the live canvas window is not open' });
        return;
      }
      const screens = browser.getState().screens;
      const MAX_CRITIQUE_SCREENS = 12;
      const taken = screens.slice(0, MAX_CRITIQUE_SCREENS);
      const ctx = await gatherGateContext(dir).catch(() => ({ files: [], tokens: {} }));
      const digestScreens: Json[] = [];
      for (const screen of taken) {
        const entry: Json = {
          screen: screen.id,
          state: screen.state,
          url: screen.url,
          width: screen.width,
          height: screen.height,
        };
        try {
          const probe = await browser.getProbe(screen.id);
          const gates = runGateReport(probe, ctx);
          entry.gates = gates.map((gate) => ({
            id: gate.gate,
            status: gate.status,
            findings: gate.findings.slice(0, 3),
          }));
          entry.probeCounts = { selectors: probe.selectors.length, cls: probe.cls };
        } catch {
          // A mid-navigation world: this screen contributes no gates, but the
          // digest still names it (the 0–10 critique is advisory anyway).
          entry.gates = [];
          entry.probeCounts = { selectors: 0, cls: 0 };
        }
        digestScreens.push(entry);
      }
      sendJson(res, 200, { screens: digestScreens, truncated: screens.length > MAX_CRITIQUE_SCREENS });
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (url.pathname === '/stat') {
      const root = params.get('dir') ?? '';
      const entry = params.get('path') ?? '';
      if (!path.isAbsolute(root)) {
        sendJson(res, 400, { error: 'dir must be absolute' });
        return;
      }
      const abs = await requireFile(root, entry);
      if (!abs) {
        sendJson(res, 404, { error: 'entry not found' });
        return;
      }
      const dir = path.dirname(abs);
      sendJson(res, 200, { mtime: await newestMtime(dir, abs) });
      return;
    }

    // The live window's state. Never starts the browser: a panel that only
    // reads state must not pop a Chrome window.
    if (url.pathname === '/state') {
      const target = getBrowser();
      if (!target) {
        sendJson(res, 200, { url: '', title: '', lastPick: null, pickSeq: 0, windowOpen: false, bridgeActive: bridge.active() });
        return;
      }
      const state = (await target.state()) as { bridgeActive?: boolean };
      state.bridgeActive = bridge.active();
      sendJson(res, 200, state as unknown as Json);
      return;
    }

    // Pick-bridge ownership (see service/bridge-claim.ts). The hidden pane that
    // /design mounts inside a chat window claims here and heartbeats; every
    // panel reads `bridgeActive` from /state and stands down while a bridge
    // holds the picks, so one pick becomes exactly one chip in one window.
    if (url.pathname === '/bridge') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const body = parsed as { token?: unknown; release?: unknown } | null;
      if (body?.release === true) {
        const released = typeof body.token === 'string' ? bridge.release(body.token) : false;
        sendJson(res, 200, { ok: released, bridgeActive: bridge.active() });
        return;
      }
      const result = bridge.claim(typeof body?.token === 'string' ? body.token : undefined);
      sendJson(res, 200, result as unknown as Json);
      return;
    }

    // Open (or navigate) the real Chrome window at the target URL.
    if (url.pathname === '/open') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const body = parsed as { url?: unknown; dir?: unknown; screen?: unknown; focus?: unknown; dock?: unknown } | null;
      // V4-8: /open is the USER-initiated route — focus defaults to true. The
      // panel sends focus:false for the screen dropdown; an agent NEVER
      // reaches /open through browser.* (those go to /browser-control and the
      // navigate path no longer raises the window).
      const focusRequested = body?.focus !== false;
      // { url } — the original single-page flow, kept unchanged (byte-for-byte
      // behavior for existing callers).
      const target = body?.url;
      if (typeof target === 'string' && target !== '') {
        const dir = typeof body?.dir === 'string' && body.dir !== '' ? body.dir : null;
        if (dir && !path.isAbsolute(dir)) {
          sendJson(res, 400, { error: 'dir must be absolute' });
          return;
        }
        // A loopback URL may belong to a project's dev server. When a project dir
        // is known (or the URL is loopback) make sure the server is up first: a
        // dead server must yield `ok:false`, never a window on Chrome's error page.
        let started = false;
        if (dir || isLoopbackUrl(target)) {
          const dev = await ensureDevServer(target, { dir: dir ?? undefined });
          if (!dev.up) {
            sendJson(res, 200, { ok: false, error: dev.error ?? 'the dev server is not available' });
            return;
          }
          started = dev.started;
        }
        try {
          const browser = await ensureBrowser(target);
          const nav = await browser.open(target);
          // F8 (V4 QA): the registry watch follows the canvas that is actually
          // open. A successful legacy {url} open used to leave the previous
          // workspace's fs.watch running against a window that moved on (a
          // stale applyRegistryChange could warm-push into it). Re-target the
          // watch when this open names a dir; stop it otherwise.
          if (dir) startRegistryWatch(dir);
          else stopRegistryWatch();
          // navigateGuarded dropped its bringToFront (V4-8); the user-facing
          // legacy open still raises on a settled navigation, exactly the old
          // observable behavior, now routed through the explicit focus seam.
          if (nav.settled && focusRequested) await browser.focus();
          sendJson(res, 200, { ok: true, url: nav.url, title: nav.title, settled: nav.settled, started });
        } catch (error) {
          sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : 'open failed' });
        }
        return;
      }

      // { dir, screen? } — the canvas workspace flow (spec §B extension). The
      // config's url is authoritative; screens.json supplies the artboards.
      const dirValue = body?.dir;
      if (typeof dirValue !== 'string' || dirValue === '') {
        sendJson(res, 400, { error: 'url is required' });
        return;
      }
      if (!path.isAbsolute(dirValue)) {
        sendJson(res, 400, { error: 'dir must be absolute' });
        return;
      }
      // V4-15: a folder that no longer exists is its own actionable business
      // failure (the panel offers "Create a new canvas" and clears its ws/ key)
      // — distinct from "exists but is not scaffolded".
      const dirExists = await fs.stat(dirValue).then((s) => s.isDirectory(), () => false);
      if (!dirExists) {
        sendJson(res, 200, {
          ok: false,
          code: 'WORKSPACE_MISSING',
          error: `The canvas folder ${dirValue} no longer exists.`,
        });
        return;
      }
      const screenParam = typeof body?.screen === 'string' && body.screen !== '' ? body.screen : null;
      // V4-13 (P2): dock = the host window rect the panel wants to sit beside.
      let dock: { x: number; y: number; width: number; height: number } | null = null;
      if (body?.dock && typeof body.dock === 'object' && !Array.isArray(body.dock)) {
        const d = body.dock as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
        if ([d.x, d.y, d.width, d.height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
          dock = { x: d.x as number, y: d.y as number, width: d.width as number, height: d.height as number };
        }
      }

      const { config } = await readStudioConfig(dirValue);
      const configUrl =
        typeof config?.url === 'string' && config.url.trim() !== '' ? config.url.trim() : null;
      if (!configUrl) {
        sendJson(res, 200, { ok: false, error: 'no .design-studio.json url found' });
        return;
      }

      // Auto-start the dev server only for loopback URLs (the panel's Start
      // control owns manual starts; externally served workspaces skip this).
      let started = false;
      if (isLoopbackUrl(configUrl)) {
        const dev = await ensureDevServer(configUrl, { dir: dirValue });
        if (!dev.up) {
          sendJson(res, 200, { ok: false, error: dev.error ?? 'the dev server is not available' });
          return;
        }
        started = dev.started;
      }

      const registry = await readScreens(dirValue);
      // An explicit initial screen must exist in the registry (400 otherwise).
      if (screenParam !== null && !registry.screens.some((s) => s.id === screenParam)) {
        sendJson(res, 400, { error: 'unknown screen id' });
        return;
      }
      // D5 restore sources: view.json is the workspace-persisted authority
      // (mode/positions/camera); the in-memory echo only fills what view.json
      // never recorded. Positions merge into the pushed list service-side
      // (D6: screens.json stays pure design content — x/y never enter it).
      const view = await readView(dirValue);
      const mode: CanvasMode = view.mode ?? getLastWorkspace()?.mode ?? 'edit';
      const viewScreens = mergeRegistryWithView(registry, view, configUrl);

      try {
        if (viewScreens.length === 0) {
          // No screens registered: fall back to the config url alone, exactly
          // like the { url } flow. The workspace echo still records the dir so
          // browser-control has its dir fallback. (V4-4 watch STILL starts
          // below: the first screen an agent writes then lands live instead of
          // waiting for a manual reopen.)
          const browser = await ensureBrowser(configUrl);
          const nav = await browser.open(configUrl);
          if (nav.settled && focusRequested) await browser.focus();
          setLastWorkspace({ dir: dirValue, screens: [], mode, activeScreen: null, view });
          startRegistryWatch(dirValue);
          wireBrowserHooks(browser);
          sendJson(res, 200, { ok: true, url: nav.url, title: nav.title, settled: nav.settled, started });
        } else {
          const active = screenParam ?? viewScreens[0]!.id;
          const browser: Browser = await ensureBrowser();
          // Cold: openWorkspace bakes the screens into the ViewerConfig at
          // launch; warm: it pushes setScreens into the live shell (spec §B —
          // the Browser implements the cold/warm split itself). The dir rides
          // the cfg so currentWorkspaceDir() is non-null for browser-control's
          // dir fallback (P1-browser seam 2). V4-1: the workspace pins fixed
          // artboard sizes; V4-8: only this user-initiated call may focus:true.
          wireBrowserHooks(browser);
          await browser.openWorkspace({ dir: dirValue, screens: viewScreens, baseUrl: configUrl, mode, focus: focusRequested });
          await browser.setActive(active);
          // R9/D5 restore, binding order in ONE transaction after ready:
          // setScreens (view.json positions merged) → setMode → restoreCamera.
          // A repeated /open is idempotent: §C setScreens replaces the whole
          // list and the camera push is a no-op when nothing was persisted.
          await browser.restoreWorkspaceView({ screens: viewScreens, mode, camera: view.camera });
          setLastWorkspace({ dir: dirValue, screens: registry.screens, mode, activeScreen: active, view });
          // V4-4: the watcher owns THIS workspace now (replacing any other
          // dir's watch). F3 (V4 QA): the dedupe seed goes in AFTER
          // startRegistryWatch — start RESETS lastPushedRegistry to '', so the
          // old seed-then-start order was always clobbered and the first watch
          // tick re-pushed the registry the open had just pushed.
          startRegistryWatch(dirValue);
          lastPushedRegistry = JSON.stringify(registry);
          // V4-13 (P2): dock only on user-initiated opens (focus flag). An
          // explicit body dock wins; with none, the auto-dock heuristic docks
          // beside the left-half "chat" — but only when dockPlacement says the
          // right side really leaves ≥640 px (otherwise placement is untouched).
          if (focusRequested) await (dock ? applyDock(browser, dock) : applyAutoDock(browser));
          // Same shape /state answers with: {ok, started} + BrowserState (which
          // P1-browser extends with mode/screens/activeScreen; R1/R2 add
          // modeApplied and per-screen state/message; V4 adds registryError
          // and shellBridge).
          const state = await browser.state();
          sendJson(res, 200, { ok: true, started, ...state });
        }
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : 'open failed' });
      }
      return;
    }

    // Close the live window and quit Chrome (Design Mode going OFF). Idempotent:
    // with no browser started there is nothing to quit and it answers ok:true.
    // Also reaps any orphan `ds-chrome-` Chrome process left by an earlier
    // service instance, so OFF always ends with no lingering window.
    if (url.pathname === '/close') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      // V4-4: the watch follows the window — OFF stops it (no orphan fs.watch).
      stopRegistryWatch();
      const browser = getBrowser();
      if (browser) {
        browser.setRegistryError(null);
        await browser.close();
      }
      try {
        await reapOrphanChrome();
      } catch {
        /* best effort: closing the tracked window already succeeded */
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // Briefly re-flash an element in the live window by CSS selector. The panel
    // posts this while the user hovers a reference row so the corresponding
    // element is visible in the window. Bearer-authed; answers ok:false (never a
    // transport error) with no window open or when the selector matches nothing.
    if (url.pathname === '/highlight') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      const selector = (parsed as { selector?: unknown } | null)?.selector;
      if (typeof selector !== 'string' || selector === '') {
        sendJson(res, 400, { error: 'selector is required' });
        return;
      }
      const browser = getBrowser();
      if (!browser) {
        sendJson(res, 200, { ok: false, error: 'no live window is open' });
        return;
      }
      try {
        const highlighted = await browser.highlight(selector);
        if (!highlighted) {
          sendJson(res, 200, { ok: false, error: 'selector did not match any element' });
          return;
        }
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : 'highlight failed' });
      }
      return;
    }

    // Raise the live window WITHOUT navigating or reloading it. Idempotent and
    // safe with no window open (answers ok:true so the panel's Focus control
    // never surfaces a dead error).
    if (url.pathname === '/focus') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST required' });
        return;
      }
      const browser = getBrowser();
      if (browser) await browser.focus();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/config') {
      const root = params.get('dir') ?? '';
      if (!path.isAbsolute(root)) {
        sendJson(res, 400, { error: 'dir must be absolute' });
        return;
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        let parsed: { path?: string | null; text?: string };
        try {
          parsed = JSON.parse(body) as { path?: string | null; text?: string };
        } catch {
          sendJson(res, 400, { error: 'body must be JSON' });
          return;
        }
        if (typeof parsed.text !== 'string') {
          sendJson(res, 400, { error: 'text is required' });
          return;
        }
        try {
          sendJson(res, 200, { ...(await writeStudioConfig(root, parsed.path ?? null, parsed.text)) });
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : 'invalid config' });
        }
        return;
      }
      sendJson(res, 200, { ...(await readStudioConfig(root)) });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'internal error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[design-canvas] service listening on 127.0.0.1:${PORT}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await stopBrowser();
  } catch {
    /* nothing to stop */
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
