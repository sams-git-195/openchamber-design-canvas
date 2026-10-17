// Design Canvas panel seam: the thin, typed surface over the two things the
// panel is allowed to do — talk to the host (attach references to the chat,
// start sessions) and reach its own local service through `serviceRequest`.
// Everything that can fail in a way the UI must explain is normalized to either
// `ServiceUnavailable` or a plain Error.
//
// The canvas is a real headful Chrome window the service owns; the panel only
// opens/navigates it (`POST /open {dir, screen?}`), raises it without reloading
// (`/focus`), switches edit/play (`POST /mode`), sets the active screen
// (`POST /open {dir, screen}` — in-memory activation, no shell restart) and
// reads its state (`/state`). Workspaces live on disk under the service-resolved
// root (`GET /workspaces`); the panel NEVER constructs the Documents path itself.
import { connectHost, HostRequestError } from '@openchamber/sdk';
import type { GuestProjectsSnapshot, GuestSessionRecord } from '@openchamber/sdk';
import type { VerifyConfig } from '../shared/verify-types.ts';

export const host = connectHost();

/** The service is declared but not approved/spawned, or died. */
export class ServiceUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceUnavailable';
  }
}

function describe(error: unknown): string {
  if (error instanceof HostRequestError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function callService<T>(
  path: string,
  query?: Record<string, string>,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: string,
): Promise<T> {
  let result;
  try {
    result = await host.serviceRequest({ method, path, query, body });
  } catch (error) {
    throw new ServiceUnavailable(describe(error));
  }
  if (result.status !== 200) {
    let detail = `HTTP ${result.status}`;
    try {
      const parsed = JSON.parse(result.body) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      /* body was not JSON */
    }
    throw new ServiceUnavailable(detail);
  }
  return JSON.parse(result.body) as T;
}

export type PickPayload = {
  selector: string;
  tag: string;
  classes: string;
  text: string;
  outerHTML: string;
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
};

/** One screen as the canvas shell reports it (spec §B `GET /state`). */
export type CanvasScreenState = {
  id: string;
  title: string;
  url: string;
  width: number;
  height: number;
  active: boolean;
};

/** The real window the service drives: its page, mode, screens and last pick. */
export type LiveState = {
  url: string;
  title: string;
  lastPick: PickPayload | null;
  pickSeq: number;
  windowOpen: boolean;
  /**
   * Another panel (the hidden pane `/canvas` mounts inside a chat window) is
   * the pick→chat bridge right now: this panel must not attach picks too.
   */
  bridgeActive?: boolean;
  /** The canvas mode (`edit` | `play`), from `GET /state` (spec §B). */
  mode?: 'edit' | 'play';
  /** The workspace's screens, activation included (spec §B). */
  screens?: CanvasScreenState[];
  /** The active screen id, when a workspace is open. */
  activeScreen?: string;
  /** The screen the LAST pick landed on (spec §B pick() gains `screen`). */
  lastPickScreen?: string;
};

/** What `POST /open` answers after opening/navigating the real window. */
export type OpenResult = {
  ok: boolean;
  url: string;
  title: string;
  settled: boolean;
  /** True when the service spawned the project's dev server for this open. */
  started?: boolean;
  /** Actionable reason when `ok` is false (the dev server is down, or open failed). */
  error?: string;
};

/** Status shown in the dock while an open (and dev-server start) is in flight. */
export const OPENING_STATUS = 'Starting dev server…';

/**
 * Open the workspace's canvas window. Spec §B: `POST /open` accepts
 * `{dir, screen?}` — the config's `.design-studio.json` url is authoritative,
 * the service resolves the screens itself. A warm window gets an in-memory
 * activation (`setActive`/`setScreens`), never a shell restart.
 */
export function openWorkspace(input: { dir: string; screen?: string }): Promise<OpenResult> {
  const payload = input.screen !== undefined ? { dir: input.dir, screen: input.screen } : { dir: input.dir };
  return callService<OpenResult>('/open', undefined, 'POST', JSON.stringify(payload));
}

/**
 * Close the live Chrome window and quit Chrome. The service removes the
 * throwaway profile, so a later open relaunches fresh.
 */
export function closeLive(): Promise<{ ok: boolean }> {
  return callService<{ ok: boolean }>('/close', undefined, 'POST');
}

/** What `POST /server/stop` answers: whether a recorded server was stopped. */
export type ServerStopResult = { ok: boolean; stopped?: boolean; error?: string };

/**
 * Stop the workspace's dev server. The service only kills a process group it
 * started for `dir`; an unknown dir is a safe no-op (`ok:true, stopped:false`).
 * This is the raw escape hatch — callers decide WHEN to call it (the smart stop
 * on Design Mode OFF, or the manual Stop preview action).
 */
export function stopDevServer(dir: string): Promise<ServerStopResult> {
  return callService<ServerStopResult>('/server/stop', undefined, 'POST', JSON.stringify({ dir }));
}

/** What `POST /server/start` answers: whether the dev server is up and who started it. */
export type ServerStartResult = { ok: boolean; started?: boolean; up?: boolean; error?: string };

/**
 * Start (or confirm) the dev server for `dir`. When `url` is omitted the
 * service reads the workspace's `.design-studio.json` url. The service only
 * attempts to start loopback addresses; a non-loopback url is a 400.
 */
export function startDevServer(dir: string, url?: string): Promise<ServerStartResult> {
  return callService<ServerStartResult>('/server/start', undefined, 'POST', JSON.stringify({ dir, url }));
}

/**
 * What `GET /server/status` answers: reachability, port and group leader.
 * `error` mirrors the service's own `DevServerStatus.error`: a condition the
 * service reports alongside the status (a recorded identity or port
 * conflict). When present the reachability bit must not be rendered as a
 * trustworthy green Start.
 */
export type ServerStatus = { up: boolean; port: number | null; pid?: number; error?: string };

/** The recorded dev-server status for a workspace dir (never starts one). */
export function getServerStatus(dir: string): Promise<ServerStatus> {
  return callService<ServerStatus>('/server/status', { dir });
}

/** Live window state: current page, mode, screens, window open/closed. */
export function getState(): Promise<LiveState> {
  return callService<LiveState>('/state');
}

/**
 * Switch the canvas mode (spec §B: `POST /mode` → push + in-memory echo). The
 * answer carries the mode the service now holds.
 */
export function setMode(mode: 'edit' | 'play'): Promise<{ ok: boolean; mode?: 'edit' | 'play'; error?: string }> {
  return callService<{ ok: boolean; mode?: 'edit' | 'play'; error?: string }>('/mode', undefined, 'POST', JSON.stringify({ mode }));
}

/**
 * Claim (or heartbeat) the exclusive pick→chat bridge. Called by the hidden
 * pane `/canvas` mounts inside a chat window: while it holds a warm claim,
 * every OTHER panel stands down, so each Cmd/Ctrl-click becomes exactly one
 * chip in the window that owns the bridge. `token` renews an existing claim;
 * omit it to take ownership.
 */
export function claimPickBridge(token?: string): Promise<{ ok: boolean; bridgeActive?: boolean; token?: string; ttlMs?: number }> {
  return callService('/bridge', undefined, 'POST', JSON.stringify(token ? { token } : {}));
}

/** Give the bridge up (the holding pane is exiting). Harmless if already gone. */
export function releasePickBridge(token: string): Promise<{ ok: boolean; bridgeActive?: boolean }> {
  return callService('/bridge', undefined, 'POST', JSON.stringify({ release: true, token }));
}

/**
 * Raise the live Chrome window (POST /focus) without navigating or reloading
 * it, so the user can see the page they are about to Cmd-click.
 */
export function focusLive(): Promise<{ ok: boolean }> {
  return callService<{ ok: boolean }>('/focus', undefined, 'POST');
}

/**
 * Flash a picked element in the live preview window: `POST /highlight` with its
 * selector. Best-effort and fire-and-forget from the caller.
 */
export function highlightElement(selector: string): Promise<{ ok: boolean }> {
  return callService<{ ok: boolean }>('/highlight', undefined, 'POST', JSON.stringify({ selector }));
}

export type StudioConfig = {
  version?: number;
  name?: string;
  type?: string;
  url?: string;
  command?: string;
  entry?: string;
  harness?: { direction?: string; fidelity?: string; critiquePolicy?: string; verify?: VerifyConfig };
  pick?: Record<string, unknown>;
  pagesRoot?: string;
};

/** The workspace's `.design-studio.json`, resolved by the service in a fixed order. */
export function getConfig(dir: string): Promise<{ config: StudioConfig | null; path: string | null }> {
  return callService('/config', { dir });
}

/** Validate an explicitly pasted file path without uploading its contents. */
export function validateReferencePath(dir: string, path: string): Promise<{ path: string; sourceDirectory: string }> {
  return callService('/reference', undefined, 'POST', JSON.stringify({ dir, path }));
}

// ---- workspaces (spec §B `GET /workspaces` + §A screens.json) ----

/** A screen registry entry (spec §A): file is workspace-relative and ends .html. */
export type ScreenInfo = {
  id: string;
  file: string;
  title: string;
  width: number;
  height: number;
};

/** The `screens.json` registry shape the service reads/writes (spec §A). */
export type ScreensRegistry = {
  version: number;
  screens: ScreenInfo[];
};

/** One workspace on disk, as `GET /workspaces` reports it (spec §B). */
export type WorkspaceRow = {
  dir: string;
  name: string;
  url?: string;
  screens?: ScreenInfo[];
};

/** What `GET /workspaces` answers: the resolved root plus every workspace. */
export type WorkspacesResult = {
  root: string;
  workspaces: WorkspaceRow[];
};

/**
 * All workspaces on disk — the page's "Your design work" list (decision 2).
 * The service resolves the workspace root (`%ONEDRIVE%\Documents` etc.); the
 * panel never constructs that path itself (decision 3).
 */
export function getWorkspaces(): Promise<WorkspacesResult> {
  return callService<WorkspacesResult>('/workspaces');
}

/** The normalized screens.json registry for a workspace dir (spec §B). */
export function getScreens(dir: string): Promise<ScreensRegistry> {
  return callService<ScreensRegistry>('/screens', { dir });
}

/** Validate and write the full registry (spec §B). The panel offers this so a
 * row action can repair a registry; the agent normally writes screens.json. */
export function putScreens(dir: string, registry: ScreensRegistry): Promise<{ path: string }> {
  return callService<{ path: string }>('/screens', { dir }, 'PUT', JSON.stringify(registry));
}

// ---- export (SPEC-V3-P2-SCOPE.md D4, `POST /export` + `GET /export/status`) ----

/** The formats an export job can write (D4): per-screen PNG and/or PDF. */
export type ExportFormat = 'png' | 'pdf';

/** What `POST /export` answers: the single-flight job to poll, or the failure. */
export type ExportStartResult =
  | { ok: true; jobId: string; screens: number; formats: ExportFormat[] }
  | { ok: false; error: string };

/** One file outcome inside a job result; partial success is a valid outcome (D4). */
export type ExportFileResult = { ok: true; file: string } | { ok: false; error: string };

/** One screen's outcome inside a job result (D4/D7-B `results[]` entries). */
export type ExportScreenResult = { screen: string; png?: ExportFileResult; pdf?: ExportFileResult };

/** What `GET /export/status?dir=&job=` answers while polling the job. */
export type ExportStatusResult = {
  state: 'running' | 'done' | 'failed';
  startedAt?: string;
  results: ExportScreenResult[];
};

/**
 * Start (or join) the workspace's export job. Formats omitted → the service
 * writes both. The service is single-flight: if a job is already running the
 * answer carries THAT job's id — "join-running" is just polling it (D4).
 */
export function exportJob(dir: string, formats?: ExportFormat[]): Promise<ExportStartResult> {
  const body = formats && formats.length > 0 ? { dir, formats } : { dir };
  return callService<ExportStartResult>('/export', undefined, 'POST', JSON.stringify(body));
}

/** Poll one export job: `GET /export/status?dir=<dir>&job=<job>` (D4). */
export function exportStatus(dir: string, job: string): Promise<ExportStatusResult> {
  return callService<ExportStatusResult>('/export/status', { dir, job });
}

// ---- critique (SPEC-V3-P2-SCOPE.md D7-C, `POST /critique {dir}`) ----

/** One gate's outcome inside a critique digest (findings capped at 3, service-side). */
export type CritiqueGateDigest = { id: string; status: string; findings: string[] };

/** One screen's line in the critique digest (the bounded shape spec D7-C names). */
export type CritiqueScreenDigest = {
  screen: string;
  state: string;
  url: string;
  width: number;
  height: number;
  gates: CritiqueGateDigest[];
  probeCounts: unknown;
};

/** What `POST /critique` answers: the bounded digest (≤12 screens, `truncated` beyond). */
export type CritiqueResult =
  | { ok: true; screens: CritiqueScreenDigest[]; truncated?: boolean }
  | { ok: false; error?: string };

/** Ask the service for the deterministic per-screen gate digest (D7-C). */
export function critiqueWorkspace(dir: string): Promise<CritiqueResult> {
  return callService<CritiqueResult>('/critique', undefined, 'POST', JSON.stringify({ dir }));
}

/** What the workspaces list should show, derived from a `GET /workspaces` read. */
export type WorkspacesView =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'list'; rows: WorkspaceWorkRow[] };

// ---- scaffolding (immediate workspace initialization) ----

/** What `POST /scaffold` is asked to build: the workspace dir plus the brief. */
export type ScaffoldSpec = {
  type: string;
  direction?: string;
  fidelity?: string;
  brief?: string;
  /**
   * The chosen design-system preset id (shared/design-systems.ts), when the user
   * picked one. Omitted for "No design system".
   */
  designSystemId?: string;
};

/** What `POST /scaffold` answers: the served URL and the files it wrote, or an actionable error. */
export type ScaffoldResult =
  | { ok: true; url: string; files: string[] }
  | { ok: false; error: string };

/**
 * Scaffold the workspace at `dir` from the design spec (the service writes
 * `.design-studio.json`, the multi-page skeleton and `screens.json`). The dir
 * must live inside the service-resolved workspace root — the panel derives it
 * from the `GET /workspaces` answer (decision 3), never from Documents itself.
 */
export function scaffoldProject(dir: string, spec: ScaffoldSpec): Promise<ScaffoldResult> {
  return callService<ScaffoldResult>('/scaffold', undefined, 'POST', JSON.stringify({ dir, ...spec }));
}

// ---- cross-platform path compares (spec §F, audit #11 / §G rule 2) ----
//
// Workspace dirs come from the service (native separators) and are compared
// against `ws/<sessionId>` dirs and registered-project dirs from the host.
// Normalize separators (`\`→`/`) and drive-letter case before any compare;
// trailing separators are trimmed. POSIX paths are unaffected (no backslashes,
// no drive letters — byte-identical).

/** One path, normalized for compare: separators, drive-letter case, trailing slash. */
export function normalizeDirPath(dir: string): string {
  const text = String(dir).trim().replace(/\\/g, '/');
  const drive = /^([a-zA-Z]):\/(.)/.exec(text);
  const base = drive ? `${drive[1]!.toLowerCase()}:${text.slice(2)}` : text;
  let end = base.length;
  while (end > 1 && base[end - 1] === '/') end -= 1;
  return base.slice(0, end).replace(/\/+$/, () => base.slice(0, end) === '/' ? '/' : '');
}

/** Whether two dirs are the same path, separators and drive-case aside. */
export function sameDirPath(a: string, b: string): boolean {
  return normalizeDirPath(a) === normalizeDirPath(b);
}

/** Whether `base` is `dir` or an ancestor of it (normalized, separator-aware). */
export function pathContains(root: string, dir: string): boolean {
  const rb = normalizeDirPath(root);
  const rd = normalizeDirPath(dir);
  return rd === rb || rd.startsWith(`${rb}/`);
}

// ---- the canvas target (pure) ----

/** The per-session workspace record stored under `ws/<sessionId>` (decision 3). */
export type WorkspaceRecord = { dir: string; name: string };

/** The inverse of the `ws/` storage key: the session id, or null for any other key. */
export function wsSessionIdFromKey(key: string): string | null {
  const prefix = 'ws/';
  return key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : null;
}

/** Whether a stored value is a workspace record (a dir and a name). */
export function isWorkspaceRecord(value: unknown): value is WorkspaceRecord {
  return Boolean(
    value && typeof value === 'object' &&
    typeof (value as WorkspaceRecord).dir === 'string' && (value as WorkspaceRecord).dir.trim() !== '',
  );
}

/** Every registered project a scan or a target resolution needs, from a workspace snapshot. */
export type RegisteredProject = { id: string; name: string; directory: string };

export function allProjectsFromSnapshot(snapshot: Pick<GuestProjectsSnapshot, 'state' | 'projects'>): RegisteredProject[] {
  if (snapshot.state !== 'ready') return [];
  return snapshot.projects.map((project) => ({ id: project.id, name: project.name, directory: project.directory }));
}

/**
 * Where a canvas flow targets (spec §F, pure). A `workspace` target means the
 * session already has a `ws/<sessionId>` record: reuse its dir/name, carrying
 * the registered project id when the user registered the workspace root (the
 * decision #4c upgrade path — only then does `startSession` pass `projectId`).
 * Otherwise the target is `new`: the brief drives slug + scaffold.
 */
export type CanvasTarget =
  | { kind: 'workspace'; dir: string; name: string; projectId?: string }
  | { kind: 'new'; brief: string };

export function resolveCanvasTarget(input: {
  workspace: WorkspaceRecord | null;
  brief: string;
  projects: RegisteredProject[];
}): CanvasTarget {
  const ws = input.workspace;
  if (ws && ws.dir.trim() !== '') {
    const registered = input.projects.find((candidate) => sameDirPath(candidate.directory, ws.dir) || pathContains(candidate.directory, ws.dir));
    const base: { kind: 'workspace'; dir: string; name: string } = { kind: 'workspace', dir: ws.dir, name: ws.name || ws.dir };
    return registered ? { ...base, projectId: registered.id } : base;
  }
  return { kind: 'new', brief: input.brief.trim() };
}

// ---- slug creation (spec §F: kebab brief/session, sanitized, ≤40, no clash) ----

/** The longest a slug may be (spec decision 3: ≤40 chars, `[a-z0-9-]`). */
export const WORKSPACE_SLUG_LIMIT = 40;

/** Kebab of the brief's first words plus the session id's tail, sanitized. */
export function canvasSlug(brief: string, seed: string): string {
  const words = brief.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).slice(0, 4).join('-');
  // The seed is a session id like `ses_3f2ad8` or `new-design:123`: keep the
  // last segment — the part that actually distinguishes the id — sanitized.
  const segments = seed.toLowerCase().replace(/[^a-z0-9-]+/g, '-').split('-').filter(Boolean);
  const tail = (segments[segments.length - 1] ?? seed.toLowerCase().replace(/[^a-z0-9]+/g, '')).slice(0, 8);
  const base = words ? `${words}-${tail}` : `canvas-${tail}`;
  const cleaned = base.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return (cleaned || 'canvas').slice(0, WORKSPACE_SLUG_LIMIT);
}

/**
 * A slug no existing workspace uses: compare against the basenames of the
 * dirs `GET /workspaces` returned, splatting `-2`, `-3`, … on clashes.
 */
export function uniqueCanvasSlug(brief: string, seed: string, existingDirs: string[]): string {
  const taken = new Set(existingDirs.map((dir) => normalizeDirPath(dir).split('/').pop() ?? ''));
  const first = canvasSlug(brief, seed);
  if (!taken.has(first)) return first;
  for (let i = 2; ; i += 1) {
    const candidate = `${first.slice(0, Math.max(1, WORKSPACE_SLUG_LIMIT - String(i).length - 1))}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Join the SERVICE-provided workspace root with a slug. The panel never builds
 * the Documents path itself (decision 3): the root comes from `GET /workspaces`,
 * and its separator style (win32 `\` vs POSIX `/`) decides the join.
 */
export function joinWorkspaceDir(root: string, slug: string): string {
  const trimmed = root.replace(/[\\/]+$/, '');
  const sep = trimmed.includes('\\') && !trimmed.startsWith('/') ? '\\' : '/';
  return `${trimmed}${sep}${slug}`;
}

/** The screen url for a workspace-relative file, on a workspace base url (decision 6). */
export function screenUrl(baseUrl: string, file: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${file}`;
}

// ---- the workspaces design-work list (pure, decision 2 + audit #19) ----

/** A workspace row joined against the cached `ws/` scan. */
export type WorkspaceWorkRow = WorkspaceRow & { sessionId: string | null };

/**
 * Join `GET /workspaces` rows against the CACHED `ws/` storage scan — one map
 * of normalized dir → session id, built from a single `host.storage.keys()`
 * pass per refresh (audit #19). The dirs match after separator/drive-case
 * normalization (audit #11). A row NEVER drops out: an unmapped workspace is a
 * plain `sessionId: null` row the page opens by starting a new session.
 */
export function joinWorkspaceSessions(rows: WorkspaceRow[], wsSessionMap: ReadonlyMap<string, string>): WorkspaceWorkRow[] {
  return rows.map((row) => ({ ...row, sessionId: wsSessionMap.get(normalizeDirPath(row.dir)) ?? null }));
}

/** The meta line under a workspace row: its served url, else its directory. */
export function workspaceMeta(row: WorkspaceRow): string {
  const url = row.url?.trim();
  return url ? url : row.dir;
}

/** A workspace is "ready" when its `.design-studio.json` carries a non-empty url. */
export function workspaceReady(url: string | null | undefined): boolean {
  return Boolean(url?.trim());
}

// ---- session detection (pure) ----

/**
 * Whether a single attached item's `data` is this package's Design Mode chip.
 * `buildModeChip` (mode.ts) writes `data.mode = { on: true, … }`, and the
 * session record echoes every attached chip's `data` back to us (SDK
 * `GuestSessionRecord.items[].data`). Kept loose on purpose: only `mode.on` is
 * load-bearing.
 */
export function isModeChipData(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const mode = (data as { mode?: unknown }).mode;
  return Boolean(mode && typeof mode === 'object' && (mode as { on?: unknown }).on === true);
}

/**
 * Whether a session snapshot itself shows Design Mode was ON: at least one of
 * its attached items carries our mode chip — the cross-device signal.
 */
export function sessionShowsDesignMode(session: Pick<GuestSessionRecord, 'items'>): boolean {
  return Array.isArray(session.items) && session.items.some((item) => isModeChipData(item.data));
}

// ---- pure helpers (kept DOM-free so they can be unit-tested) ----

/**
 * The row's compact pick gesture hint. A reference is added by holding Cmd
 * (macOS) or Ctrl and clicking an element in the live window.
 */
export const PICK_HINT = '⌘-click an element to add a reference';

/**
 * The hint is ACTIVE only while the live window is open; with no window there
 * is nothing to Cmd-click.
 */
export function pickHintActive(state: Pick<LiveState, 'windowOpen'>): boolean {
  return state.windowOpen;
}

/** One-line summary of the real window for the status row. */
export function formatWindowStatus(state: Pick<LiveState, 'windowOpen' | 'url' | 'title'>): string {
  if (!state.windowOpen) return 'Window closed';
  const where = state.url && state.url !== 'about:blank' ? state.url : 'no page open';
  return state.title ? `Window open · ${where} — ${state.title}` : `Window open · ${where}`;
}

/** One line describing the outcome of an open, for the status row. */
export function formatOpenStatus(result: OpenResult): string {
  if (result.ok) return result.started ? 'Dev server started · window open' : 'Window open';
  return result.error ?? 'Could not open the window';
}

// ---- dev-server stop decision (pure) ----

/** The inputs to the smart-stop decision on Design Mode OFF. */
export type StopDevServerDecision = {
  /** The current session's live `SessionSnapshot.busy`. */
  busy: boolean;
  /** How many OTHER design sessions in the same dir are not idle. */
  otherActiveDesignSessions: number;
  /** Whether THIS panel started the dev server (never stop one we did not). */
  startedByUs: boolean;
};

/**
 * Whether Design Mode OFF may stop the workspace's dev server. All three must
 * hold: we started it, our session is idle, and no other design session in the
 * same dir is active.
 */
export function shouldStopDevServer(input: StopDevServerDecision): boolean {
  return input.startedByUs && !input.busy && input.otherActiveDesignSessions === 0;
}

/**
 * Count the design sessions OTHER than `currentSessionId` that are still active
 * (activity not `idle`) in one sessions snapshot. A session counts as a design
 * session when it carries our mode chip or a persistent design marker.
 */
export function countOtherActiveDesignSessions(
  sessions: ReadonlyArray<Pick<GuestSessionRecord, 'id' | 'items' | 'activity'>>,
  currentSessionId: string | null,
  markerSessionIds: ReadonlySet<string>,
): number {
  let count = 0;
  for (const session of sessions) {
    if (currentSessionId && session.id === currentSessionId) continue;
    const isDesign = markerSessionIds.has(session.id) || sessionShowsDesignMode(session);
    if (isDesign && session.activity !== 'idle') count += 1;
  }
  return count;
}

/** URL labels and copy shared by the row and the page. English only. */

/** The badge a workspace row shows when its `.design-studio.json` has a url. */
export const DESIGN_READY_BADGE = 'Canvas ready';
/** The badge a workspace row shows when there is no usable url yet. */
export const NO_CONFIG_BADGE = 'No dev server yet';
/** The workspaces list's true empty state. */
export const NO_DESIGN_WORK_MESSAGE = 'No canvas workspaces yet — /canvas creates one.';
/** The rail panel surface's whole content: a calm pointer to the sidebar page. */
export const PANEL_SIDEBAR_HINT = 'Design Canvas opens from the sidebar.';
/** The one line the row shows while this session has no canvas workspace yet. */
export const NO_WORKSPACE_MESSAGE = 'No canvas workspace yet — Start creates one.';

/**
 * The one-line session status: is this a canvas session (Design Mode ON) and
 * does its workspace have a `.design-studio.json` url.
 */
export function canvasSessionStatus(state: { modeOn: boolean; workspaceDir: string | null; wsReady: boolean }): string {
  if (!state.modeOn) return 'Design Mode is off — turn it on to open the canvas';
  if (!state.workspaceDir) return 'Design session · workspace being created…';
  return state.wsReady
    ? `Design session · workspace ${state.workspaceDir}`
    : `Design session · ${state.workspaceDir} (no .design-studio.json url yet)`;
}

/** Actionable message when a workspace has no url to open or serve. */
export const NO_PROJECT_URL_MESSAGE =
  'No .design-studio.json url for this workspace — add one, or turn the dev server on first';

/**
 * Why the `+` reference sources can be unavailable: every attach chip must carry
 * an http(s) url (a hard host rule), so a workspace with none has nothing to offer.
 */
export const ATTACH_NEEDS_URL =
  'References need an http(s) url from .design-studio.json.';

/**
 * Whether a workspace is "ready": its `.design-studio.json` has a non-empty
 * `url`. The SINGLE source of truth for whether the row offers the Start
 * control and the page rows offer Preview.
 */
export function projectReady(config: StudioConfig | null | undefined): boolean {
  return Boolean(config?.url?.trim());
}

/**
 * Whether a URL points at a loopback host. The service starts a dev server for
 * loopback URLs only; a remote address is opened as-is, so we never hand the
 * service a dir alongside a non-loopback URL it would refuse.
 */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const hostname = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return hostname === 'localhost' || hostname === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  } catch {
    return false;
  }
}

// The exact camelCase key set PICK_SCRIPT (service/browser.ts, `stylesFor`)
// emits — read those keys, not hyphenated CSS names, or the section is empty.
const PICK_STYLE_KEYS = [
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign',
  'color', 'backgroundColor', 'borderTopWidth', 'borderStyle', 'borderColor', 'borderRadius',
  'padding', 'margin', 'display', 'gap', 'width', 'height',
];

/** `HH:MM:SS` in local time, for the chip's moment line. */
function localTimeOf(day: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(day.getHours())}:${pad(day.getMinutes())}:${pad(day.getSeconds())}`;
}

/** The screen a pick landed on, for the chip's Screen lines (spec §F). */
export type PickScreen = { id: string; url: string };

/**
 * The text of a picked element's chat reference chip. `screen` adds the
 * `Screen: <id>` line and that screen's URL (spec §F pick-chip payload).
 */
export function referenceText(pick: PickPayload, url: string, pickedAt?: Date, screen?: PickScreen): string {
  const styles = PICK_STYLE_KEYS
    .filter((key) => pick.styles[key] && pick.styles[key] !== 'normal' && pick.styles[key] !== 'none')
    .map((key) => `  ${key}: ${pick.styles[key]};`)
    .join('\n');
  return [
    'Reference from Design Canvas',
    ...(pickedAt ? [`Picked at ${localTimeOf(pickedAt)}`] : []),
    ...(screen ? [`Screen: ${screen.id}`, `Screen URL: ${screen.url}`] : []),
    `URL: ${url}`,
    `Selector: ${pick.selector}`,
    `Tag: ${pick.tag}${pick.classes ? `  Classes: ${pick.classes}` : ''}`,
    pick.text ? `Text: ${JSON.stringify(pick.text)}` : 'Text: (empty)',
    'Current styles:',
    styles || '  (none of note)',
    'Markup:',
    '```html',
    pick.outerHTML,
    '```',
  ].join('\n');
}

// ---- colour helpers (pure) ----

/** Parse `#rgb`, `#rrggbb` or `rgb()/rgba()` into 0–255 channels; null otherwise. */
function parseColor(value: string): [number, number, number] | null {
  const text = value.trim().toLowerCase();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let digits = hex[1]!;
    if (digits.length === 3) digits = digits.split('').map((c) => c + c).join('');
    return [parseInt(digits.slice(0, 2), 16), parseInt(digits.slice(2, 4), 16), parseInt(digits.slice(4, 6), 16)];
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio between two colours (1–21), rounded to one decimal, or
 * `null` when either colour is not a plain hex/rgb value (e.g. `oklch(...)` or a
 * `currentColor`). Pure, so the "Fix contrast" prompt and a test share one rule.
 */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
}

/**
 * The token a picked element's colour should come from. We can only guess from
 * the property that carries a hardcoded colour; `null` when there is none.
 */
export function tokenNameFor(styles: Record<string, string>): string | null {
  if (styles.backgroundColor) return '--color-surface';
  if (styles.color) return '--color-text';
  if (styles.borderColor) return '--color-border';
  return null;
}