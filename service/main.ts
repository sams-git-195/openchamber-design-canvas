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
import { reapOrphanChrome } from './browser.ts';
import { handleBrowserControl } from './browser-control.ts';
import { handleVerifyRequest } from './verify-routes.ts';
import { writeHarnessPlugin } from './harness-plugin.ts';
import { listProjectFiles, resolveReferencePath } from './project-files.ts';
import { scaffoldProject } from './scaffold.ts';
import { hasScreensFile, readScreens, screenUrl, writeScreens, type CanvasMode } from './screens.ts';
import { resolveWorkspaceRoot } from './workspace-root.ts';
import { getLastWorkspace, setLastWorkspace, updateLastWorkspaceMode, updateLastWorkspaceView } from './last-workspace.ts';
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
 *  null = back to auto-grid, absent = the shell's inherit rule). */
type CanvasScreen = {
  id: string;
  url: string;
  width: number;
  height: number;
  title: string;
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
        | { dir?: unknown; type?: unknown; direction?: unknown; fidelity?: unknown; brief?: unknown; designSystemId?: unknown }
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
      const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
      sendJson(
        res,
        200,
        (await scaffoldProject({
          dir,
          type,
          direction: str(body?.direction),
          fidelity: str(body?.fidelity),
          brief: str(body?.brief),
          designSystemId: str(body?.designSystemId),
        })) as unknown as Json,
      );
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
      const body = parsed as { url?: unknown; dir?: unknown; screen?: unknown } | null;
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
      const screenParam = typeof body?.screen === 'string' && body.screen !== '' ? body.screen : null;

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
      const viewScreens: CanvasScreen[] = registry.screens.map((s) => {
        const hasPosition = Object.prototype.hasOwnProperty.call(view.positions, s.id);
        const position = view.positions[s.id];
        return {
          id: s.id,
          title: s.title,
          width: s.width,
          height: s.height,
          url: screenUrl(configUrl, s.file),
          // D6/P2-B handoff: positions ride BOTH the cold bake and the warm
          // setScreens. A stored null = back to auto-grid; an absent key =
          // omit the pair, which the shell reads as "inherit the live
          // position" on warm re-pushes (drag-vs-reopen never fights).
          ...(hasPosition ? { x: position ? position.x : null, y: position ? position.y : null } : {}),
        };
      });

      try {
        if (viewScreens.length === 0) {
          // No screens registered: fall back to the config url alone, exactly
          // like the { url } flow. The workspace echo still records the dir so
          // browser-control has its dir fallback.
          const browser = await ensureBrowser(configUrl);
          const nav = await browser.open(configUrl);
          setLastWorkspace({ dir: dirValue, screens: [], mode, activeScreen: null, view });
          sendJson(res, 200, { ok: true, url: nav.url, title: nav.title, settled: nav.settled, started });
        } else {
          const active = screenParam ?? viewScreens[0]!.id;
          const browser: Browser = await ensureBrowser();
          // Cold: openWorkspace bakes the screens into the ViewerConfig at
          // launch; warm: it pushes setScreens into the live shell (spec §B —
          // the Browser implements the cold/warm split itself). The dir rides
          // the cfg so currentWorkspaceDir() is non-null for browser-control's
          // dir fallback (P1-browser seam 2).
          await browser.openWorkspace({ dir: dirValue, screens: viewScreens, baseUrl: configUrl, mode });
          await browser.setActive(active);
          // R9/D5 restore, binding order in ONE transaction after ready:
          // setScreens (view.json positions merged) → setMode → restoreCamera.
          // A repeated /open is idempotent: §C setScreens replaces the whole
          // list and the camera push is a no-op when nothing was persisted.
          await browser.restoreWorkspaceView({ screens: viewScreens, mode, camera: view.camera });
          setLastWorkspace({ dir: dirValue, screens: registry.screens, mode, activeScreen: active, view });
          // Same shape /state answers with: {ok, started} + BrowserState (which
          // P1-browser extends with mode/screens/activeScreen; R1/R2 add
          // modeApplied and per-screen state/message).
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
      const browser = getBrowser();
      if (browser) await browser.close();
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
