// Design Canvas surfaces.
//
// Two surfaces, one thin row, one full-page home:
//   - "status" (chat Work Status) — the ambient mirror: the canvas row with the
//     Start/Stop control, Design Mode toggle, play/edit toggle, active-screen
//     dropdown, Focus and the pick hint. The row also runs the pick-queue
//     client (V4-5): every queued pick — element chips and artboard-menu screen
//     sends (V4-10) — arrives through `GET /picks` long-polling and becomes a
//     chip, acked to the service after delivery.
//   - "panel" (rail panel) — the compact rail: this chat's canvas status, one
//     Open/Create canvas button, a short brief box with Start design, and the
//     "Your design work" list. The SAME surface also hosts the hidden 1×1
//     `/canvas` resolve pane, which renders only the static shell and runs
//     nothing long-lived (see `isRealPane`).
//   - "page" (the sidebar "Extension pages → Design Canvas" entry) — the centred
//     creation home: the hero, the prompt composer with its type chip, and the
//     "Your design work" workspaces list from `GET /workspaces`.
// Any other surface renders nothing. Nothing opens a live window on its own:
// opening happens ONLY on the Design Mode toggle turning ON (or a Reopen/Retry).
//
// No registered project is required (decision 2): any chat starts a canvas by
// making sure this session has a workspace — `ws/<sessionId>` = `{dir, name}` —
// creating one inside the service-resolved workspace root when it does not
// (Start creates the workspace on first use). The canvas itself is a real
// headful Chrome window the local service opens on the workspace dir; this page
// only opens it, raises it and reads its state. English-only copy by requirement.
import { type HostReadyContext, GUEST_COMPOSE_TEXT_MAX } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';

import {
  ATTACH_NEEDS_URL,
  DESIGN_READY_BADGE,
  NO_CONFIG_BADGE,
  NO_DESIGN_WORK_MESSAGE,
  NO_PROJECT_URL_MESSAGE,
  NO_WORKSPACE_MESSAGE,
  OPENING_STATUS,
  PICK_HINT,
  ServiceUnavailable,
  WORKSPACE_MISSING_CODE,
  ackPicks,
  allProjectsFromSnapshot,
  canvasSessionStatus,
  closeLive,
  countOtherActiveDesignSessions,
  critiqueWorkspace,
  exportJob,
  exportStatus,
  focusLive,
  formatOpenStatus,
  getConfig,
  getPicks,
  getServerStatus,
  getScaffoldStatus,
  getState,
  getWorkspaces,
  host,
  isLoopbackUrl,
  isWorkspaceRecord,
  joinWorkspaceDir,
  joinWorkspaceSessions,
  normalizeDirPath,
  openWorkspace,
  pathContains,
  pickAckLabel,
  pickHintActive,
  postAgentStatus,
  projectReady,
  registryErrorToastMessage,
  resolveCanvasTarget,
  sameDirPath,
  scaffoldProgressText,
  scaffoldProject,
  setMode,
  shouldStopDevServer,
  shouldToastRegistryError,
  startDevServer,
  stopDevServer,
  syncScreens,
  uniqueCanvasSlug,
  validateReferencePath,
  workspaceFilePath,
  workspaceMeta,
  wsSessionIdFromKey,
  type CanvasScreenState,
  type ExportFormat,
  type LiveState,
  type PicksResult,
  type QueuedPick,
  type RegisteredProject,
  type ScaffoldResult,
  type ScaffoldStatus,
  type ServerStartResult,
  type StudioConfig,
  type WorkspaceRecord,
  type WorkspaceRow,
  type WorkspacesResult,
  type WorkspacesView,
  type WorkspaceWorkRow,
} from './api.ts';
import { DIRECTIONS, type DirectionId } from './craft.ts';
import {
  DEFAULT_MODE,
  DESIGN_TYPES,
  FIDELITIES,
  FIDELITY_OPTIONS,
  NO_DESIGN_SYSTEM,
  TYPE_HINT,
  attachUrl,
  buildCompactModeChip,
  buildModeChip,
  critiqueReviewChip,
  designMarkerKey,
  designMarkerValue,
  designSessionIdFromKey,
  designSessionPrompt,
  designSystemGroups,
  designSystemLabel,
  designSystemSwatches,
  exportFailureSummary,
  exportJobSummary,
  fileBaseName,
  fileReferenceChip,
  filterDesignSystems,
  findDesignSystem,
  isDesignMarker,
  modeStorageKey,
  parseCanvasExportArgs,
  parseDesignArgs,
  popoverStep,
  projectHttpUrl,
  projectReferenceChip,
  seedModeValue,
  seedSessionData,
  workspaceOpenPrompt,
  workspaceStorageKey,
  type DesignBriefSpec,
  type DesignMode,
  type DesignType,
  type Fidelity,
} from './mode.ts';
import type { DesignSystemPreset } from '../shared/design-systems.ts';
import { addDraftReference, removeDraftReference, buildReferenceSubmission, type DraftReference } from './reference-draft.ts';
import { buildAttachPayload, type PickContext } from './attach-dialog.ts';

const POLL_MS = 900;

/** One suggestion under the composer: a title, a one-liner and the brief it seeds. */
type Idea = { title: string; description: string; prompt: string };

/**
 * The design types as they read on the creation page: short labels for the
 * headline and the chip. The compact session row has no creation selectors.
 */
const PAGE_TYPE_LABELS: Record<DesignType, string> = {
  wireframe: 'Wireframe',
  'hi-fi': 'Hi-fi screens',
  prototype: 'Prototype',
  deck: 'Slide deck',
  custom: 'Custom',
};

/**
 * Idea cards, framed by the selected type: choosing a type reframes these. There
 * are no real project thumbnails, so each card carries a small abstract SVG
 * preview instead (see `ideaThumb`). English only.
 */
const IDEAS: Record<DesignType, Idea[]> = {
  prototype: [
    { title: 'Gamified Habit App', description: 'Daily streaks with playful rewards', prompt: 'A gamified habit-tracking app with daily streaks, points, and playful rewards.' },
    { title: 'Interactive Dashboard', description: 'Live metrics, filters and charts', prompt: 'An interactive dashboard with live metrics, filters, and charts.' },
    { title: 'Booking Flow', description: 'Pick a slot, confirm, pay', prompt: 'An interactive booking flow: choose a date and slot, confirm the details, and pay.' },
  ],
  'hi-fi': [
    { title: 'Luxury Property Website', description: 'Elegant listings and detail pages', prompt: 'A luxury property website with elegant listings, a photo gallery, and property detail pages.' },
    { title: 'Product Pricing Page', description: 'Three tiers, clear comparison', prompt: 'A product pricing page with three tiers and a clear feature comparison.' },
    { title: 'Marketing Landing Page', description: 'Hero, features and a call to action', prompt: 'A marketing landing page with a hero, feature highlights, and a strong call to action.' },
  ],
  deck: [
    { title: 'New Hire Onboarding Guide', description: 'A welcome deck for the first week', prompt: 'A new-hire onboarding deck covering the first week, the tools, and the team.' },
    { title: 'Q3 Product Review', description: 'Results, learnings and next bets', prompt: 'A Q3 product review deck: results, learnings, and the next bets.' },
    { title: 'Sales Pitch', description: 'Problem, solution, proof, pricing', prompt: 'A sales pitch deck: problem, solution, proof, and pricing.' },
  ],
  wireframe: [
    { title: 'Checkout Flow', description: 'Cart to confirmation, boxes only', prompt: 'A wireframe of the checkout flow from cart to confirmation, boxes and labels only.' },
    { title: 'Onboarding Steps', description: 'Sign-up to first value', prompt: 'A wireframe of the onboarding steps from sign-up to first value.' },
    { title: 'App Navigation', description: 'Tabs, menus and top-level screens', prompt: 'A wireframe of the app navigation: tabs, menus, and the top-level screens.' },
  ],
  custom: [
    { title: 'Marketing Page', description: 'A single page that sells', prompt: 'A single marketing page that explains the product and asks for one clear action.' },
    { title: 'Mobile App', description: 'A multi-screen product', prompt: 'A multi-screen mobile app for the core flow.' },
    { title: 'Data Tool', description: 'A dashboard or console', prompt: 'A data tool: a dashboard or console for the team to read at a glance.' },
  ],
};

/** The one-time heads-up about out-of-folder edit permissions (decision 4b). */
const PERMISSION_TOAST_KEY = 'ws-permission-notified';
const PERMISSION_HEADS_UP =
  'The agent edits the Design Canvas workspace, which lives outside the chat folder — approve its file-edit permission prompts so it can write the design files.';

const state = {
  surface: 'panel',
  /** The chat's own directory. The CANVAS session deliberately runs OUTSIDE the workspace (decision 4). */
  directory: null as string | null,
  sessionId: null as string | null,
  mode: { ...DEFAULT_MODE } as DesignMode,
  resolveAllowed: false,
  /** This session's canvas workspace (`ws/<sessionId>`), or null before the first use. */
  workspace: null as WorkspaceRecord | null,
  /** The workspace's `.design-studio.json`, read by the service for the workspace dir. */
  config: null as StudioConfig | null,
  configPath: null as string | null,
  /**
   * The workspace dir `config` was read for. `onDirectory` keeps the last config
   * until the fresh read resolves, so a stale cached config is only ever used
   * when it belongs to the CURRENT workspace (`currentConfig()`).
   */
  configDir: null as string | null,
  url: 'about:blank',
  title: '',
  windowOpen: false,
  /** True while OUR side is bringing the window up (see openCanvasWindow). */
  pendingOpen: false,
  /**
   * V4-4: the last `/state.registryError` message we toasted while the condition
   * held. Null clears the arm, so a fixed-then-rebroken registry toasts again.
   */
  registryErrorNotified: null as string | null,
  /** The live canvas controls from `GET /state` (spec §B). */
  liveMode: 'edit' as 'edit' | 'play',
  liveScreens: [] as CanvasScreenState[],
  activeScreen: null as string | null,
  /** The current session's live `SessionSnapshot.busy`, from `host.onSession`. */
  sessionBusy: false,
  /** Workspace dirs whose dev server THIS panel started (`/open` reported `started`). */
  startedServers: new Set<string>(),
  /**
   * A stop waiting for the session to go idle (Design Mode OFF happened while
   * busy). The queued REQUEST — its directory and manual mode — is preserved.
   */
  pendingStop: null as null | { dir: string; manual: boolean },
  /** Current preview-dev-server reachability for the row's Start/Stop control. */
  serverStatus: null as boolean | null,
  /** True while a manual start/stop is in flight. */
  serverPending: false,
  /** Last error from a server start/status action (for screen-reader announcement). */
  serverError: null as string | null,
  // ---- full-page creation surface ----
  /** The workspaces list (GET /workspaces joined with the cached ws/ scan). */
  workspaces: null as WorkspacesView | null,
  /** The selected creation type; drives the headline, chip and the idea cards. */
  pageType: 'hi-fi' as DesignType,
  pageDirection: 'auto' as 'auto' | DirectionId,
  pageFidelity: 'hi-fi' as Fidelity,
  prompt: '' as string,
  references: [] as DraftReference[],
  /** An actionable error from a failed scaffold (the session still starts). */
  pageError: '' as string,
  pageBusy: false,
  typeMenuOpen: false,
  /** The `+` attach overlay: its open state. */
  attachMenuOpen: false,
  /** The design-system picker panel open in the composer. */
  dsMenuOpen: false,
  /** The chosen design-system preset id, or null for "No design system". */
  pageDesignSystemId: null as string | null,
};

/**
 * The smallest frame (each side, px) that can be the right-rail tab. The host
 * mounts the SAME `surface: 'panel'` twice: as the rail tab, and as the hidden
 * pane that resolves one `/canvas` (GuestHosts wraps it in a `fixed … h-px
 * w-px overflow-hidden` div, then unmounts it when the resolve settles). The
 * hidden frame's document still reads `visibilityState: 'visible'`, so no
 * visibility signal tells the two apart — only its 1×1 px size does.
 */
const REAL_PANE_MIN_PX = 64;

/** Whether this frame is big enough to be a pane the user can see. Two property reads; re-check freely. */
export function isRealPane(): boolean {
  const width = typeof window.innerWidth === 'number' ? window.innerWidth : 0;
  const height = typeof window.innerHeight === 'number' ? window.innerHeight : 0;
  return width >= REAL_PANE_MIN_PX && height >= REAL_PANE_MIN_PX;
}

/**
 * The headless `/canvas` resolve pane: a panel frame too small to be the rail
 * tab. It lives for one resolve, so nothing long-lived or side-effecting
 * (intervals, the pick loop, handoff claims, window opens, config/agent-status
 * service calls) may run there. Keyed on the SURFACE as well as the size on
 * purpose: the chat Work Status row is never the hidden pane, yet its frame
 * may legitimately be shorter than 64 px (the host clamps status sections to
 * `GUEST_STATUS_SECTION_HEIGHT_MIN`, 24 px) — a bare size gate there would
 * strand every `/canvas` handoff the row owns.
 */
function isHiddenResolvePane(): boolean {
  return state.surface === 'panel' && !isRealPane();
}

let hintEl: HTMLElement;
let sessionLineEl: HTMLElement | null = null;
let pageBody: HTMLElement | null = null;
let statusRoot: HTMLElement | null = null;
let modeToggleBtn: HTMLButtonElement | null = null;
/** The interactive header line (the canvas row); hidden entirely when not ready. */
let barEl: HTMLElement | null = null;
/** The preview-dev-server Start/Stop icon button; doubles as "Create canvas". */
let serverBtn: HTMLButtonElement | null = null;
/** The play/edit toggle, from `GET /state` mode. */
let playToggleBtn: HTMLButtonElement | null = null;
/** The active-screen dropdown, from `GET /state` screens. */
let screenSelectEl: HTMLSelectElement | null = null;
/** The Focus action: raises the live canvas window. */
let focusLiveBtn: HTMLButtonElement | null = null;
/** Screen-reader-only live region for server state changes. */
let serverAnnounceEl: HTMLElement | null = null;

// Composer refs, updated in place so typing never rebuilds the page (and never
// steals the caret). Null whenever the page is not mounted.
let promptEl: HTMLTextAreaElement | null = null;
let sendEl: HTMLButtonElement | null = null;
let accentFillEl: HTMLElement | null = null;
/** Play the staggered reveal only on the first paint, not on every re-render. */
let pageEnter = true;
/** Live state of the open design-system picker. */
let dsQuery = '';
let dsHighlight: string | null = null;
/** The `+` panel's paste-a-path draft. */
let attachPathDraft = '';
let referenceError = '';
let referencePending = false;
let referenceSlow = false;
let referenceRequest = 0;
let referenceLiveEl: HTMLElement | null = null;
let referenceFocusId: string | null = null;
const DROP_PATH_MESSAGE = 'Paste an accessible file path using + → File path. Dropped filenames do not include their filesystem path.';

/** The cached ws/ scan: normalized workspace dir → session id (audit #19). */
let wsSessionMap = new Map<string, string>();
/** Every registered project, for decision 4c detection only. */
let allProjects: RegisteredProject[] = [];

function announceReference(message: string): void {
  if (!referenceLiveEl) return;
  referenceLiveEl.textContent = '';
  queueMicrotask(() => { if (referenceLiveEl) referenceLiveEl.textContent = message; });
}

/** Invalidate work from a closed menu or an already submitted/reset draft. */
function cancelReferenceValidation(): void {
  referenceRequest += 1;
  referencePending = false;
  referenceSlow = false;
}

/** Collapses overlapping `.design-studio.json` reads (mount + poll can race). */
let configReadInFlight = false;

function q<T extends HTMLElement>(tag: string, cls?: string, text?: string): T {
  const node = document.createElement(tag) as T;
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function option(value: string, label: string): HTMLOptionElement {
  const node = q<HTMLOptionElement>('option');
  node.value = value;
  node.textContent = label;
  return node;
}

/**
 * Errors and warnings the section must not swallow. Informational lines are
 * deliberately silent: the row carries only its controls.
 */
let lastStatus = '';
function setStatus(message: string, kind: 'info' | 'error' | 'warn' = 'info'): void {
  if (kind === 'info') return;
  if (message === lastStatus) return;
  lastStatus = message;
  void host.toast({ kind: kind === 'error' ? 'error' : 'info', message });
}

// ---- last-known URL (per workspace dir) ----

function lastUrlKey(dir: string | null): string | null {
  return dir ? `lastUrl/${dir}` : null;
}

async function loadLastUrl(dir: string | null): Promise<string | null> {
  const key = lastUrlKey(dir);
  if (!key) return null;
  try {
    const value = await host.storage.get(key);
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  } catch {
    return null;
  }
}

async function saveLastUrl(dir: string | null, url: string): Promise<void> {
  const key = lastUrlKey(dir);
  if (!key) return;
  try {
    await host.storage.set(key, url);
  } catch {
    /* a convenience only; opening still works without it */
  }
}

// ---- the per-session workspace (ws/<sessionId> = {dir, name}, decision 3) ----

/** Read this session's stored workspace record, if any. */
async function readStoredWorkspace(sessionId: string | null): Promise<WorkspaceRecord | null> {
  const key = workspaceStorageKey(sessionId);
  if (!key) return null;
  try {
    const value = await host.storage.get(key);
    if (isWorkspaceRecord(value)) {
      const name = typeof value.name === 'string' && value.name.trim() !== '' ? value.name.trim().slice(0, 80) : value.dir;
      return { dir: value.dir, name };
    }
  } catch {
    /* an unreadable record is simply absent */
  }
  return null;
}

/** Rebind `state.workspace` to the current session's stored record. */
async function loadWorkspace(): Promise<void> {
  const record = await readStoredWorkspace(state.sessionId);
  if (record) {
    state.workspace = record;
    state.configDir = null;
    state.config = null;
    renderRow();
    rerender();
    void loadStudioConfig();
  }
}

/** Persist the workspace record for `sessionId` (defaults to the current one). */
async function saveWorkspaceRecord(sessionId: string | null, record: WorkspaceRecord): Promise<void> {
  const key = workspaceStorageKey(sessionId);
  if (!key) return;
  try {
    await host.storage.set(key, record);
  } catch {
    /* the in-memory record still drives this session */
  }
}

/** A human workspace name: the brief's first words, else the slug prettified. */
function workspaceDisplayName(brief: string, slug: string): string {
  const words = brief.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (words) return words;
  return slug.replace(/-+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) || 'Canvas';
}

/**
 * The one-time heads-up (decision 4b): the FIRST scaffold flow notes that the
 * agent will ask permission for out-of-folder edits. Skipped when the chat
 * already sits inside the workspace dir. Fired once per device via host storage.
 */
async function maybeShowPermissionToast(dir: string): Promise<void> {
  if (state.directory && sameDirPath(dir, state.directory)) return;
  try {
    const seen = await host.storage.get(PERMISSION_TOAST_KEY);
    if (seen === true) return;
    await host.storage.set(PERMISSION_TOAST_KEY, true);
  } catch {
    return;
  }
  await host.toast({ kind: 'info', message: PERMISSION_HEADS_UP });
}

/** The outcome of the async scaffold POST for a NEW canvas workspace. */
type ScaffoldOutcome =
  | { ok: true; record: WorkspaceRecord; jobId: string; url: string }
  | { ok: false; error: string };

/**
 * What the new workspace is scaffolded AS (F8). Each caller passes its own
 * explicit selections — the page its type/direction/fidelity/design-system
 * pickers, `/canvas` its parsed type over the session mode — instead of the
 * scaffold reading `state.mode`, which on the page is the DEFAULT mode, not
 * what the user picked.
 */
type ScaffoldChoice = {
  type: DesignType;
  direction: DesignMode['direction'];
  fidelity: Fidelity;
  designSystemId: string | null;
};

/** The session mode as a scaffold choice (the row and `/canvas` flows). */
function modeScaffoldChoice(type?: DesignType | null): ScaffoldChoice {
  return {
    type: type ?? state.mode.type,
    direction: state.mode.direction,
    fidelity: state.mode.fidelity,
    designSystemId: state.pageDesignSystemId,
  };
}

/**
 * Create the workspace: `GET /workspaces` for the service-resolved ROOT (the
 * panel never constructs the Documents path itself — decision 3), a slug that
 * no existing workspace clashes with, then `POST /scaffold {…, async:true}`
 * into `<root>/<slug>` (the service confines creation to its own root, spec §E).
 * V4-11: the POST answers as soon as the FILES are written — the returned
 * `jobId` covers npm install + dev boot, which the caller polls so the request
 * can NEVER hit the 20 s host cap (E15).
 * `notify:false` leaves the error toast to the caller — the `/canvas` resolver
 * THROWS it instead, so the host shows it once rather than a toast followed by
 * "found nothing to attach".
 */
async function scaffoldCanvasWorkspace(
  brief: string,
  seed: string,
  choice: ScaffoldChoice,
  options: { notify?: boolean } = {},
): Promise<ScaffoldOutcome> {
  const notify = options.notify ?? true;
  let result: WorkspacesResult;
  try {
    result = await getWorkspaces();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (notify) await host.toast({ kind: 'error', message: `Could not list canvas workspaces: ${message}` });
    return { ok: false, error: `Could not list canvas workspaces: ${message}` };
  }
  const slug = uniqueCanvasSlug(brief || 'canvas', seed, result.workspaces.map((row) => row.dir));
  const dir = joinWorkspaceDir(result.root, slug);
  const name = workspaceDisplayName(brief, slug);
  let scaffold: ScaffoldResult;
  try {
    scaffold = await scaffoldProject(dir, {
      type: choice.type,
      direction: choice.direction,
      fidelity: choice.fidelity,
      brief: brief || undefined,
      // Omitted for "No design system" so the request stays as before.
      designSystemId: choice.designSystemId ?? undefined,
    });
  } catch (error) {
    scaffold = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!scaffold.ok) {
    if (notify) await host.toast({ kind: 'error', message: scaffold.error });
    return { ok: false, error: scaffold.error };
  }
  await maybeShowPermissionToast(dir);
  return { ok: true, record: { dir: scaffold.dir || dir, name }, jobId: scaffold.jobId, url: scaffold.url };
}

/** The async-scaffold job polling cadence (V4-11): a progress poll every 2 s. */
const SCAFFOLD_POLL_MS = 2000;
/** Progress toasts repeat on a 10 s cadence inside one state — "updated", not spammed. */
const SCAFFOLD_TOAST_STEP_MS = 10_000;
/**
 * Give up on a job that never settles. Cold-cache installs are slow, but not
 * fifteen-minutes slow; the honest error beats an open-ended wait. `ws/` stays
 * stored either way — the created dir is real, and Start retries the open, not
 * a second scaffold.
 */
const SCAFFOLD_MAX_MS = 15 * 60_000;

/**
 * Poll `GET /scaffold/status?job=&dir=` (every `timing.pollMs`, production 2 s)
 * until the job reports done/failed, TOASTING progress as it goes (V4-11): once
 * per state change, refreshed at most per `SCAFFOLD_TOAST_STEP_MS` inside a
 * state. `dir` is the workspace the job scaffolds — the service matches it
 * against the job (F10) and refuses a poll without it (F1). `timing` is a test
 * seam. Returns 'done' or an actionable error.
 */
export async function runScaffoldJob(
  jobId: string,
  dir: string,
  timing: { pollMs?: number; maxMs?: number } = {},
): Promise<'done' | { error: string }> {
  const pollMs = timing.pollMs ?? SCAFFOLD_POLL_MS;
  const maxMs = timing.maxMs ?? SCAFFOLD_MAX_MS;
  const start = Date.now();
  let lastKey = '';
  for (;;) {
    let job: ScaffoldStatus;
    try {
      job = await getScaffoldStatus(jobId, dir);
    } catch (error) {
      const message = `Canvas setup failed: the job status could not be read (${error instanceof Error ? error.message : String(error)}).`;
      await host.toast({ kind: 'error', message });
      return { error: message };
    }
    // An unknown job (the service restarted, or the single slot moved on)
    // answers 200 `{ok:false,error}` with NO state. Read as "still running" it
    // would poll for the full 15 minutes; it is a settled failure — the files
    // exist, so Start retries the open.
    if (job?.state !== 'installing' && job?.state !== 'booting' && job?.state !== 'done' && job?.state !== 'failed') {
      const reason = (job as { error?: unknown } | null)?.error;
      const message = `Canvas setup status is unavailable${typeof reason === 'string' && reason ? ` (${reason})` : ''} — the workspace files exist; press Start to try opening it.`;
      await host.toast({ kind: 'error', message });
      return { error: message };
    }
    if (job.state === 'done') {
      await host.toast({ kind: 'success', message: scaffoldProgressText(job) });
      return 'done';
    }
    if (job.state === 'failed') {
      const message = scaffoldProgressText(job);
      await host.toast({ kind: 'error', message });
      return { error: message };
    }
    const key = `${job.state}:${Math.floor((job.elapsedMs ?? 0) / SCAFFOLD_TOAST_STEP_MS)}`;
    if (key !== lastKey) {
      lastKey = key;
      await host.toast({ kind: 'info', message: scaffoldProgressText(job) });
    }
    if (Date.now() - start >= maxMs) {
      const message = 'Canvas setup is taking unusually long — the workspace files exist; press Start to try opening it.';
      await host.toast({ kind: 'error', message });
      return { error: message };
    }
    await sleep(pollMs);
  }
}

/**
 * Make sure this session has a canvas workspace, creating one on first use
 * (`Start creates the workspace` — spec §F). `forSessionId` overrides which
 * session the record is keyed to (the page flow keys it to the NEW session the
 * start-session call returns). A resolved record binds `state.workspace`.
 * V4-11: `ws/<sessionId>` is stored the MOMENT the async scaffold POST answers
 * (files written) — before the install/boot job finishes — so an interrupted
 * wait can never orphan a second workspace. The window opens only after `done`.
 */
async function ensureCanvasWorkspace(brief: string, forSessionId: string | null = null, choice?: ScaffoldChoice): Promise<WorkspaceRecord | null> {
  const prepared = await prepareCanvasWorkspace(brief, forSessionId ?? state.sessionId, choice ?? modeScaffoldChoice());
  if ('error' in prepared) return null;
  if (!prepared.jobId) return prepared.record;
  const job = await runScaffoldJob(prepared.jobId, prepared.record.dir);
  if (job !== 'done') return null; // `ws/` stays stored — the dir is real, Start retries the open
  return prepared.record;
}

/** What the FAST half of the workspace ensure answers (F3). */
type PreparedWorkspace =
  | { record: WorkspaceRecord; jobId: string | null; url: string | null }
  | { error: string; noSession?: true };

/**
 * The fast half of `ensureCanvasWorkspace` (F3): an existing record, or the
 * scaffold POST (files only — the service answers before npm install) plus the
 * `ws/<sessionId>` save. NEVER waits on the install/boot job: `jobId` is handed
 * back for a long-lived surface to poll. This is all the `/canvas` resolver may
 * await, because a hidden resolve pane is unmounted the moment it answers and
 * must answer inside `GUEST_REQUEST_TIMEOUT_MS` (20 s).
 */
async function prepareCanvasWorkspace(
  brief: string,
  sessionId: string | null,
  choice: ScaffoldChoice,
  options: { notify?: boolean } = {},
): Promise<PreparedWorkspace> {
  if (state.workspace && state.workspace.dir.trim() !== '') return { record: state.workspace, jobId: null, url: null };
  const stored = await readStoredWorkspace(sessionId);
  if (stored) {
    if (!state.workspace) {
      state.workspace = stored;
      renderRow();
      rerender();
    }
    return { record: stored, jobId: null, url: null };
  }
  if (!sessionId) {
    return { error: NO_SESSION_MESSAGE, noSession: true }; // no session to key a workspace to — the caller surfaces it
  }
  const outcome = await scaffoldCanvasWorkspace(brief, sessionId, choice, options);
  if (!outcome.ok) return { error: outcome.error };
  await saveWorkspaceRecord(sessionId, outcome.record);
  state.workspace = outcome.record;
  renderRow();
  rerender();
  return { record: outcome.record, jobId: outcome.jobId, url: outcome.url };
}

/**
 * F2: a new-chat draft has no session id yet, so there is nothing to key a
 * workspace or a mode to. Said plainly (the resolver throws it — the host shows
 * a thrown message verbatim; the row toasts it and hints it on the Start control).
 */
const NO_SESSION_MESSAGE = 'Start this chat by sending any message first, then run /canvas again.';
const NO_SESSION_HINT = 'Send a message to start this chat first';

// ---- Design Mode ----

function modeStoragePayload(): { on: boolean; type: DesignType; direction: DesignMode['direction']; fidelity: Fidelity; canvMode: 'edit' | 'play'; brief: string } {
  return {
    on: state.mode.on,
    type: state.mode.type,
    direction: state.mode.direction,
    fidelity: state.mode.fidelity,
    canvMode: state.mode.canvMode,
    brief: state.mode.brief.slice(0, 2000),
  };
}

/**
 * Bumped by every LOCAL mode write. A storage read that started before a local
 * write may return the pre-write value; `syncModeFromStorage` drops any read
 * whose generation moved, so this frame never adopts its own stale echo.
 */
let modeWriteGeneration = 0;

async function saveMode(): Promise<void> {
  const key = modeStorageKey(state.sessionId);
  if (!key) return;
  modeWriteGeneration += 1;
  try {
    await host.storage.set(key, modeStoragePayload());
  } catch {
    /* mode is a convenience; chat still works */
  }
}

/** Apply a stored `mode/<sessionId>` value onto `state.mode`. Garbage keeps the current fields. */
function applyStoredMode(stored: unknown): void {
  if (!stored || typeof stored !== 'object') return;
  const value = stored as Partial<DesignMode>;
  state.mode.on = Boolean(value.on);
  if (DESIGN_TYPES.includes(value.type as DesignType)) state.mode.type = value.type as DesignType;
  if (value.direction !== undefined && (value.direction === 'auto' || value.direction in DIRECTIONS)) state.mode.direction = value.direction as DesignMode['direction'];
  if (FIDELITIES.includes(value.fidelity as Fidelity)) state.mode.fidelity = value.fidelity as Fidelity;
  if (value.canvMode === 'play' || value.canvMode === 'edit') state.mode.canvMode = value.canvMode;
  state.mode.brief = typeof value.brief === 'string' ? value.brief : '';
}

/**
 * Re-read `mode/<sessionId>` and adopt it when it disagrees with memory (F3/F5).
 * Another frame — the hidden `/canvas` resolve pane above all — writes this key
 * while the row holds its own copy from mount; without the re-read the row kept
 * holding picks ("mode off") and never opened what `/canvas` turned ON. Returns
 * whether Design Mode is ON after the read. A read raced by a local write is
 * discarded (the local write is newer by construction).
 */
async function syncModeFromStorage(): Promise<boolean> {
  const key = modeStorageKey(state.sessionId);
  if (!key) return state.mode.on;
  const generation = modeWriteGeneration;
  const sessionId = state.sessionId;
  let stored: unknown;
  try {
    stored = await host.storage.get(key);
  } catch {
    return state.mode.on;
  }
  if (generation !== modeWriteGeneration || sessionId !== state.sessionId) return state.mode.on;
  if (!stored || typeof stored !== 'object') return state.mode.on;
  const value = stored as Partial<DesignMode>;
  const differs = Boolean(value.on) !== state.mode.on
    || (DESIGN_TYPES.includes(value.type as DesignType) && value.type !== state.mode.type)
    || (typeof value.brief === 'string' && value.brief !== state.mode.brief);
  if (differs) {
    applyStoredMode(stored);
    renderModeUi();
  }
  return state.mode.on;
}

/**
 * Record that Design Mode was turned ON for this session, permanently. Written
 * once on the ON transition and never cleared — the durable "this chat designs"
 * signal.
 */
async function writeDesignMarker(): Promise<void> {
  const key = designMarkerKey(state.sessionId);
  if (!key) return;
  try {
    await host.storage.set(key, designMarkerValue());
  } catch {
    /* the session's own mode chip still marks it; the marker is a bonus */
  }
}

async function loadMode(): Promise<void> {
  const key = modeStorageKey(state.sessionId);
  if (!key) return;
  try {
    applyStoredMode(await host.storage.get(key));
  } catch {
    /* keep defaults */
  }
  renderModeUi();
}

/**
 * Bumped by every ON transition. The NEWEST ON owns the pending-open release:
 * an older transition's cleanup must not drop the newer one's guard.
 */
let pendingOpenHoldSeq = 0;

export async function toggleMode(next: boolean, type?: DesignType | null, brief?: string): Promise<void> {
  const wasOn = state.mode.on;
  state.mode.on = next;
  if (type) state.mode.type = type;
  if (brief !== undefined && brief !== '') state.mode.brief = brief;
  // Hold the pending-open guard across the WHOLE ON transition so a stale
  // `/state` snapshot cannot read the just-flipped ON as a window close.
  const hold = next ? ++pendingOpenHoldSeq : 0;
  if (hold) state.pendingOpen = true;
  try {
    await saveMode();
    // The persistent marker is written exactly on the OFF→ON transition.
    if (next && !wasOn) await writeDesignMarker();
    renderModeUi();
    if (next) {
      // ON: the workspace exists BEFORE the window can open — Start/toggle
      // creates the canvas workspace on first use (spec §F).
      const ws = await ensureCanvasWorkspace('');
      if (!ws) return;
      if (state.windowOpen) {
        try {
          await focusLive();
        } catch (error) {
          setStatus(`Focus failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
      } else {
        await openCanvasWindow(false);
      }
    } else {
      // OFF is the mirror: close the live window and quit Chrome, then stop the
      // dev server we started, if it is safe.
      try {
        await closeLive();
      } catch {
        /* the window may already be gone; the mode is still off */
      }
      try {
        await requestDevServerStop();
      } catch {
        /* a stop failure is surfaced by requestDevServerStop's own toast */
      }
    }
  } finally {
    if (hold && hold === pendingOpenHoldSeq) state.pendingOpen = false;
  }
}

/** The live windows' screens as the mode chip lists them (id/file/title). */
function currentScreens(): Array<{ id: string; file: string; title: string }> {
  return state.liveScreens.map((screen) => ({
    id: screen.id,
    title: screen.title,
    file: screen.url.replace(/[?#].*$/, '').split('/').pop() || `${screen.id}.html`,
  }));
}

/** The `/canvas` resolver. Registered on panel and page surfaces only. */
async function resolveCanvasCommand(args: string): Promise<null | Awaited<ReturnType<typeof buildModeChip>>> {
  if (!state.resolveAllowed) return null;
  // `/canvas` toggles Design Mode ON/OFF; "play"/"edit" switch the canvas mode,
  // "on…" turns it ON, "off" turns it OFF, and a brief turns it ON for this chat
  // — the canvas workspace is created when the chat does not have one yet.
  // `export` and `critique` are reserved verbs (SPEC-V3-P2-SCOPE.md D7-B/C):
  // they never fall through to the brief branch.
  const [head = '', ...rest] = args.trim().split(/\s+/);
  if (/^export$/i.test(head!)) {
    await canvasExportCommand(rest.join(' '));
    return null;
  }
  if (/^critique$/i.test(head!)) {
    return await canvasCritiqueCommand();
  }
  const parsed = parseDesignArgs(args);
  if (!parsed.on) {
    await toggleMode(false);
    await host.toast({ kind: 'info', message: 'Design Mode is off.' });
    return null;
  }
  // F2: every ON path keys a workspace and a mode to the session. A new-chat
  // draft has none yet; null would surface only the host's generic "found
  // nothing to attach", while a THROWN error is shown to the user verbatim.
  if (!state.sessionId) throw new Error(NO_SESSION_MESSAGE);
  // `/canvas play|edit`: the canvas mode switch (spec §B `POST /mode`), in-memory
  // echo drives the row; persisted with the session's mode.
  if (parsed.mode) {
    try {
      const result = await setMode(parsed.mode);
      if (result.ok === false && result.error) setStatus(result.error, 'error');
      else state.liveMode = parsed.mode;
    } catch (error) {
      setStatus(`Could not switch the canvas mode: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
    state.mode.canvMode = parsed.mode;
    await saveMode();
  }
  // `/canvas [<type>] [<brief>]`: ensure/create THIS chat's canvas workspace,
  // then turn Design Mode ON (with the brief, when given). No registered
  // project is required, and no second session is started (decision 2/3) —
  // this chat designs.
  //
  // F3 — the 20 s budget: this resolve usually runs in a HIDDEN pane the host
  // mounts only for the resolve and unmounts the moment it answers. So it
  // awaits ONLY the fast half — the scaffold's file write and the `ws/` save —
  // and hands npm install, the dev-server boot and the Chrome open to the
  // status row (`canvas-open/<sessionId>`, consumed by `beginOpenHandoff`).
  const ws = await prepareCanvasWorkspace(parsed.brief, state.sessionId, modeScaffoldChoice(parsed.type), { notify: false });
  if ('error' in ws) throw new Error(ws.error); // F2/F3: the host shows a thrown message verbatim
  await armDesignModeForRow(ws, parsed.type, parsed.brief || undefined);
  const url = (await readWorkspaceUrl(ws.record.dir)) ?? ws.url ?? undefined;
  return buildModeChip(state.sessionId, state.mode, state.workspace, currentScreens(), url);
}

/**
 * The workspace's config url for the mode chip — one quick `/config` read
 * (a file read service-side; never a boot). Null when the service cannot say.
 */
async function readWorkspaceUrl(dir: string): Promise<string | null> {
  const cached = currentConfig()?.url?.trim();
  if (cached) return cached;
  try {
    const read = await getConfig(dir);
    if (state.workspace?.dir === dir) {
      state.config = read.config;
      state.configPath = read.path;
      state.configDir = dir;
    }
    return read.config?.url?.trim() || null;
  } catch {
    return null;
  }
}

// ---- the resolve → row open handoff (F3) ----
//
// The `/canvas` resolver must answer fast and usually runs in a pane that dies
// with its answer, while the status row stays mounted and already polls. So
// the resolver records WHAT to open in `canvas-open/<sessionId>` and turns the
// mode ON; the row's poll finds the record, waits out the install/boot job (if
// the resolve scaffolded one), and opens the canvas window. The record is
// written BEFORE `mode/` flips ON: a row reading ON must already find the
// handoff, or its `/state` mirror would read "ON, no window" as the user
// closing it and turn the mode straight back OFF.

/** A pending open the row owes a resolve (F3). */
type OpenHandoff = { dir: string; jobId: string | null; at: number };

/** A handoff older than this is not acted on — opening Chrome long after `/canvas` would be a surprise. */
const OPEN_HANDOFF_MAX_AGE_MS = 5 * 60_000;
/**
 * A fresh handoff seen while `mode/` still reads OFF is LEFT for the next tick
 * this long: the resolver writes `mode/` right after the handoff, and the row
 * may have read between the two writes.
 */
const OPEN_HANDOFF_SETTLE_MS = 5_000;

export function openHandoffKey(sessionId: string | null): string | null {
  return sessionId ? `canvas-open/${sessionId}` : null;
}

function isOpenHandoff(value: unknown): value is OpenHandoff {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<OpenHandoff>;
  return typeof record.dir === 'string' && record.dir.trim() !== ''
    && (record.jobId === null || typeof record.jobId === 'string')
    && typeof record.at === 'number' && Number.isFinite(record.at);
}

/**
 * Write a FRESH `canvas-open/<sessionId>` record (F3/F9). Always stamped now:
 * the row ignores a record older than `OPEN_HANDOFF_MAX_AGE_MS`. Callers write
 * it BEFORE the `mode/` ON it explains.
 */
async function writeOpenHandoff(sessionId: string | null, dir: string, jobId: string | null): Promise<void> {
  const key = openHandoffKey(sessionId);
  if (!key) return;
  const handoff: OpenHandoff = { dir, jobId, at: Date.now() };
  try {
    await host.storage.set(key, handoff);
  } catch {
    /* without the record the row cannot open; Start/the toggle still can */
  }
}

/**
 * Turn Design Mode ON for the row to act on (F3): the handoff record first,
 * then `mode/`, then the one-time design marker. No window work happens here.
 */
async function armDesignModeForRow(
  ws: { record: WorkspaceRecord; jobId: string | null },
  type: DesignType | null | undefined,
  brief: string | undefined,
): Promise<void> {
  await writeOpenHandoff(state.sessionId, ws.record.dir, ws.jobId);
  state.mode.on = true;
  if (type) state.mode.type = type;
  if (brief !== undefined && brief !== '') state.mode.brief = brief;
  await saveMode();
  // The marker is written once, ever. A hidden resolve pane may answer before
  // its own `loadMode` lands, so "was it off?" is asked of the marker itself.
  const markerKey = designMarkerKey(state.sessionId);
  let marked = false;
  if (markerKey) {
    try {
      marked = isDesignMarker(await host.storage.get(markerKey));
    } catch {
      marked = false;
    }
  }
  if (!marked) await writeDesignMarker();
  renderModeUi();
}

/** True while a handoff open is in progress (one at a time per row). */
let handoffInFlight = false;
let handoffTask: Promise<'opened' | 'skipped' | 'failed'> | null = null;

/**
 * Phase 1 of the row's handoff (awaited by the poll BEFORE it applies `/state`):
 * read `canvas-open/<sessionId>`, and when it is actionable claim it — hold the
 * pending-open guard, delete the record (one row, one open) — and start phase 2
 * in the background. Returns that task WRAPPED (`{ task }`): an async function
 * returning a bare promise would flatten it, and the poll would then sit on the
 * whole install instead of only on the claim. Null when there is nothing to do.
 */
async function beginOpenHandoff(timing: { pollMs?: number; maxMs?: number } = {}): Promise<{ task: Promise<'opened' | 'skipped' | 'failed'> } | null> {
  // Safety net: the hidden resolve pane may never claim (it would delete the
  // record and then die mid-install) nor open Chrome on its own. The row and
  // a real rail tab are unaffected, so any future headless poll is harmless.
  if (isHiddenResolvePane()) return null;
  if (handoffInFlight) return handoffTask ? { task: handoffTask } : null;
  const key = openHandoffKey(state.sessionId);
  if (!key) return null;
  let handoff: unknown;
  try {
    handoff = await host.storage.get(key);
  } catch {
    return null;
  }
  if (handoffInFlight) return handoffTask ? { task: handoffTask } : null;
  if (!isOpenHandoff(handoff)) return null;
  const pending: OpenHandoff = handoff;
  const age = Date.now() - pending.at;
  if (!state.mode.on) await syncModeFromStorage();
  if (!state.mode.on && age >= 0 && age < OPEN_HANDOFF_SETTLE_MS) return null; // mode/ not written yet — next tick
  handoffInFlight = true;
  const hold = ++pendingOpenHoldSeq;
  state.pendingOpen = true;
  try {
    await host.storage.delete(key);
  } catch {
    /* the in-flight flag still stops this row from running it twice */
  }
  const sessionId = state.sessionId;
  handoffTask = (async (): Promise<'opened' | 'skipped' | 'failed'> => {
    try {
      if (!state.mode.on || age > OPEN_HANDOFF_MAX_AGE_MS) return 'skipped';
      // Bind the workspace the resolve created; the row may not have read it yet.
      if (!state.workspace || !sameDirPath(state.workspace.dir, pending.dir)) {
        const stored = await readStoredWorkspace(sessionId);
        if (stored && sameDirPath(stored.dir, pending.dir)) bindWorkspace(stored);
      }
      if (!state.workspace || !sameDirPath(state.workspace.dir, pending.dir)) return 'failed';
      if (pending.jobId) {
        const job = await runScaffoldJob(pending.jobId, pending.dir, timing);
        if (job !== 'done') return 'failed'; // the job's own toast said why; `ws/` stays — Start retries
      }
      // The user may have switched it OFF (or the session) while the job ran.
      if (!state.mode.on || state.sessionId !== sessionId) return 'skipped';
      if (state.windowOpen) {
        try {
          await focusLive();
        } catch (error) {
          setStatus(`Focus failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
      } else {
        await openCanvasWindow(false);
      }
      return 'opened';
    } finally {
      handoffInFlight = false;
      if (hold === pendingOpenHoldSeq) state.pendingOpen = false;
    }
  })();
  return { task: handoffTask };
}

/** Run the row's handoff to completion (test seam; the poll only awaits the claim). */
export async function runOpenHandoff(timing: { pollMs?: number; maxMs?: number } = {}): Promise<'none' | 'opened' | 'skipped' | 'failed'> {
  const claimed = await beginOpenHandoff(timing);
  return claimed ? await claimed.task : 'none';
}

/** Bind a workspace record to this frame (the same reset `loadWorkspace` does). */
function bindWorkspace(record: WorkspaceRecord): void {
  state.workspace = record;
  state.configDir = null;
  state.config = null;
  renderRow();
  rerender();
  void loadStudioConfig();
}

/**
 * The row's per-tick storage sync (F3/F5): adopt a `ws/<sessionId>` another
 * frame created ("No canvas workspace yet" no longer sticks after a hidden-pane
 * `/canvas`), adopt `mode/<sessionId>`, and claim a pending open handoff. All of
 * it is awaited BEFORE the tick applies `/state`, so an ON adopted here is
 * already guarded when the closed window is read.
 */
export async function syncRowFromStorage(): Promise<void> {
  const sessionId = state.sessionId;
  if (!sessionId) return;
  const record = await readStoredWorkspace(sessionId);
  if (record && sessionId === state.sessionId && !(state.workspace && sameDirPath(state.workspace.dir, record.dir))) {
    bindWorkspace(record);
  }
  const wasOn = state.mode.on;
  // While memory says OFF, hold the guard across the gap between adopting ON
  // and claiming the handoff; released below when there is no handoff (the
  // plain "ON but no window" case keeps its old meaning: the window was
  // closed, the mode follows it OFF). Memory already ON needs no hold — its
  // own transition owns the guard.
  const hold = wasOn ? 0 : ++pendingOpenHoldSeq;
  if (hold) state.pendingOpen = true;
  try {
    await syncModeFromStorage();
    if (state.mode.on && !wasOn) renderRow();
    await beginOpenHandoff();
  } finally {
    if (hold && hold === pendingOpenHoldSeq) state.pendingOpen = false;
  }
}

// ---- /canvas export & critique (SPEC-V3-P2-SCOPE.md D4/D7-B/D7-C) ----

/** The export poll contract (D4): every 700 ms, giving up with a heads-up after ~60 s. */
const EXPORT_POLL_MS = 700;
const EXPORT_POLL_MAX_MS = 60_000;

const EXPORT_STILL_RUNNING_MESSAGE = 'Export is still running — files land in the workspace exports folder as each screen finishes.';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST /export for the workspace, then poll /export/status every 700 ms until
 * the job is done/failed or ~60 s pass (then toast "still running" and stop).
 * Join-running (D4) is service-side: a second POST while a job runs answers
 * with THAT job's id — the panel's only job is to poll the returned id, so a
 * repeated command during a long export simply re-polls the same job.
 * `timing` is a test seam; production always uses the D4 defaults.
 */
export async function runCanvasExport(
  dir: string,
  formats: ExportFormat[] | undefined,
  timing: { pollMs: number; maxMs: number } = { pollMs: EXPORT_POLL_MS, maxMs: EXPORT_POLL_MAX_MS },
): Promise<void> {
  let start: Awaited<ReturnType<typeof exportJob>>;
  try {
    start = await exportJob(dir, formats);
  } catch (error) {
    await host.toast({ kind: 'error', message: `Export failed: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  if (!start.ok) {
    await host.toast({ kind: 'error', message: start.error || 'Export failed.' });
    return;
  }
  const job = start.jobId;
  const deadline = Date.now() + timing.maxMs;
  for (;;) {
    let status: Awaited<ReturnType<typeof exportStatus>>;
    try {
      status = await exportStatus(dir, job);
    } catch (error) {
      await host.toast({ kind: 'error', message: `Could not read the export status: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    if (status.state === 'done') {
      const lines = exportJobSummary(status);
      const text = lines.join('\n');
      // GUEST_TOAST_MAX (500) bounds every toast; truncate honestly rather
      // than let the host silently cut a path mid-character.
      await host.toast({ kind: 'success', message: text.length > 480 ? `${text.slice(0, 480)}…` : text });
      return;
    }
    if (status.state === 'failed') {
      const text = exportFailureSummary(status);
      await host.toast({ kind: 'error', message: text.length > 480 ? `${text.slice(0, 480)}…` : text });
      return;
    }
    if (Date.now() >= deadline) {
      await host.toast({ kind: 'info', message: EXPORT_STILL_RUNNING_MESSAGE });
      return;
    }
    await sleep(timing.pollMs);
  }
}

/** `/canvas export [png|pdf]`: the workspace's screens → files under <dir>/exports. */
export async function canvasExportCommand(raw: string): Promise<void> {
  const parsed = parseCanvasExportArgs(raw);
  if ('error' in parsed) {
    await host.toast({ kind: 'error', message: parsed.error });
    return;
  }
  const ws = state.workspace;
  if (!ws || ws.dir.trim() === '') {
    await host.toast({ kind: 'error', message: 'No canvas workspace yet — /canvas <brief> creates one, then export again.' });
    return;
  }
  await runCanvasExport(ws.dir, 'formats' in parsed ? parsed.formats : undefined);
}

/**
 * `/canvas critique`: POST /critique for the workspace and compose the bounded
 * gate digest into the chat as a REVIEW REQUEST (D7-C) — the agent writes the
 * prose; the service guarantees the gate-backed part. The chip text is capped
 * at GUEST_COMPOSE_TEXT_MAX by critiqueReviewChip.
 */
export async function canvasCritiqueCommand(): Promise<null | Awaited<ReturnType<typeof buildModeChip>>> {
  const ws = state.workspace;
  if (!ws || ws.dir.trim() === '') {
    await host.toast({ kind: 'error', message: 'No canvas workspace yet — /canvas <brief> creates one, then critique again.' });
    return null;
  }
  let digest: Awaited<ReturnType<typeof critiqueWorkspace>>;
  try {
    digest = await critiqueWorkspace(ws.dir);
  } catch (error) {
    await host.toast({ kind: 'error', message: `Critique failed: ${error instanceof Error ? error.message : String(error)}` });
    return null;
  }
  if (!digest.ok) {
    await host.toast({ kind: 'error', message: digest.error || 'Critique failed.' });
    return null;
  }
  return critiqueReviewChip(state.sessionId, state.config?.url, digest);
}

// ---- canvas sessions ----

type DesignSessionSpec = {
  id: string;
  title: string;
  url: string;
  text: string;
  /** Decision 4c only: the registered project that CONTAINS the workspace dir. */
  projectId?: string;
  /** The workspace dir the session designs in (NOT the session's own dir). */
  dir: string;
  type: DesignType;
  brief: string;
  workspace?: WorkspaceRecord;
  /** Only the page supplies its own unsent references. */
  references?: DraftReference[];
};

/**
 * Start a NEW session with Design Mode ON: the request itself carries the mode
 * chip's `data`, the per-session mode and workspace storage are seeded (keyed to
 * the session the host returns), and the user is moved into the session. Called
 * WITHOUT `projectId` (decision 2) — the one exception is the decision 4c
 * upgrade path, and only there does `projectId` ride along.
 */
async function startDesignSession(spec: DesignSessionSpec): Promise<boolean> {
  state.pageBusy = true;
  rerender();
  try {
    const data = seedSessionData(spec.type, spec.brief, spec.workspace ?? null);
    const submission = spec.references !== undefined
      ? buildReferenceSubmission(spec.text, data, spec.references)
      : { text: spec.text, data };
    const result = await host.startSession({
      providerId: 'design-canvas',
      id: spec.id,
      title: spec.title,
      url: attachUrl(spec.url),
      text: submission.text,
      navigation: 'preserve',
      data: submission.data,
      // Decision 4c only: when a registered project CONTAINS the workspace dir,
      // the session may land in it. Omitted everywhere else (decision 2).
      ...(spec.projectId ? { projectId: spec.projectId } : {}),
    });
    if (!result.sessionId || result.sent !== 'sent') {
      const failure = 'failure' in result ? result.failure : undefined;
      const message = result.sent === 'no-model'
        ? 'The design brief was not sent. Choose a model in OpenChamber, then try again. Your draft is unchanged.'
        : `The design brief was not sent (${result.sent}${failure ? `: ${failure}` : ''}). Your draft is unchanged; try again.`;
      state.pageError = message;
      await host.toast({ kind: 'error', message });
      return false;
    }
    // Delivery consumes this draft before ancillary work can fail.
    if (spec.references !== undefined) {
      cancelReferenceValidation();
      state.references = [];
      state.prompt = '';
      attachPathDraft = '';
      referenceError = '';
    } else if (state.surface === 'panel') {
      state.prompt = ''; // the rail's brief box has no references, only the text
    }
    try {
      // F9: the new session is born with Design Mode ON, so its row would read
      // "ON, no window" as the user closing the canvas and flip it OFF. The
      // same handoff `/canvas` leaves (fresh, BEFORE `mode/`) makes that row
      // open the window instead. The page waited out the install job already,
      // hence no jobId.
      if (spec.workspace) await writeOpenHandoff(result.sessionId, spec.workspace.dir, null);
      await host.storage.set(modeStorageKey(result.sessionId)!, seedModeValue(spec.type, spec.brief));
      // A newly started design session is a design chat from birth.
      await host.storage.set(designMarkerKey(result.sessionId)!, designMarkerValue());
      // The workspace record binds to the SESSION the host created, so
      // "Your design work" maps the workspace back to this chat and a later
      // open reuses the session (decision 3 + audit #19).
      if (spec.workspace) await saveWorkspaceRecord(result.sessionId, spec.workspace);
    } catch {
      /* the session's own data chip still marks it; the widget shows defaults */
    }
    try {
      await host.toast({ kind: 'success', message: 'Design session started — its controls are in Work Status.' });
    } catch {
      /* Notification transport is not session-delivery failure. */
    }
    if (canLoadDesignWork()) void loadDesignHome();
    try {
      await host.openSession(result.sessionId);
    } catch (error) {
      state.pageError = `The brief was sent, but the chat could not open. Open it from Your design work. ${error instanceof Error ? error.message : String(error)}`;
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.pageError = message;
    await host.toast({ kind: 'error', message: `Could not start session: ${message}` });
    return false;
  } finally {
    state.pageBusy = false;
    rerender();
  }
}

/** Where the page's creation flow targets, via the shared pure rule. */

/** The outcome of making sure the target workspace exists before the session starts. */
type CanvasPrep =
  | { kind: 'workspace'; workspace: WorkspaceRecord; url: string; projectId?: string }
  | { kind: 'new'; workspace: WorkspaceRecord; url: string }
  /**
   * `workspace` (F4): set when the scaffold POST created the folder and only
   * the install/boot job failed — the dir is REAL, so the session's prompt and
   * its `ws/` record must point at it instead of orphaning it.
   */
  | { kind: 'failed'; error: string; workspace?: WorkspaceRecord };

/**
 * Make sure a canvas workspace exists for the composer's brief, scaffolding one
 * under the service root when this session has none (decision 2/3: there is no
 * project gate to refuse on). V4-11: the scaffold is the async job — files
 * first, then an install/boot poll — so this can never hit the 20 s host cap.
 * A scaffold failure surfaces the error and the session still starts — the
 * prompt ships the workspace path once the agent has created it (kept for the
 * /canvas flows that carry a workspace later).
 */
async function scaffoldCurrentProject(spec: DesignBriefSpec): Promise<CanvasPrep> {
  if (state.workspace && state.workspace.dir.trim() !== '') {
    let url = state.config?.url ?? '';
    try {
      const read = await getConfig(state.workspace.dir);
      url = read.config?.url ?? url;
      if (state.workspace.dir === state.configDir) state.config = read.config;
    } catch {
      /* keep the cached config; the prompt degrades to the scaffold branch */
    }
    const target = resolveCanvasTarget({ workspace: state.workspace, brief: '', projects: allProjects });
    const projectId = target.kind === 'workspace' ? target.projectId : undefined;
    return { kind: 'workspace', workspace: state.workspace, url, projectId };
  }
  // F8: the page's OWN selections (type / direction / fidelity / design
  // system) shape the scaffold — never the session row's `state.mode`.
  const outcome = await scaffoldCanvasWorkspace(spec.brief, `new-design:${Date.now()}`, {
    type: spec.type,
    direction: spec.direction,
    fidelity: spec.fidelity,
    designSystemId: spec.designSystemId ?? null,
  }, { notify: false });
  if (!outcome.ok) {
    await host.toast({ kind: 'error', message: outcome.error });
    return { kind: 'failed', error: outcome.error };
  }
  // The session starts once the workspace is REAL (installed and booted), not
  // half-written; the progress toasts tell the user where it is.
  const job = await runScaffoldJob(outcome.jobId, outcome.record.dir);
  if (job !== 'done') {
    return { kind: 'failed', error: job.error, workspace: outcome.record };
  }
  return { kind: 'new', workspace: outcome.record, url: outcome.url };
}

/**
 * The page's main action: start a canvas session for the composer's brief. The
 * workspace is scaffolded under the service root first when this session has
 * none (no registered project is required — decision 2); on failure the error
 * is shown on the page and the session still starts (the prompt asks the agent
 * to find the workspace). The fresh session is keyed to the workspace AFTER the
 * host answers, so `ws/<sessionId>` always holds the real session id.
 */
async function startNewDesign(): Promise<void> {
  if (state.pageBusy || referencePending) return;
  // Lock before the first await: a second click during the refresh must not
  // create a second session, and the first action owns this draft snapshot.
  state.pageBusy = true;
  state.pageError = '';
  const spec: DesignBriefSpec = {
    type: state.pageType,
    direction: state.pageDirection,
    fidelity: state.pageFidelity,
    brief: state.prompt.trim(),
    designSystemId: state.pageDesignSystemId,
  };
  const references = state.surface === 'page' ? [...state.references] : undefined;
  rerender();
  try {
    // An oversized brief fails loudly instead of letting the host silently
    // clamp the draft (the compose cap the SDK enforces is
    // GUEST_COMPOSE_TEXT_MAX — a clamped brief is data loss, never delivery).
    if (spec.brief.length > GUEST_COMPOSE_TEXT_MAX) {
      state.pageError = `The design brief is too long (${spec.brief.length} of ${GUEST_COMPOSE_TEXT_MAX} characters). Shorten it, then send again.`;
      rerender();
      await host.toast({ kind: 'error', message: state.pageError });
      return;
    }
    const prep = await scaffoldCurrentProject(spec);
    if (prep.kind === 'failed') {
      // The session still starts in the agent-scaffolds fallback. F4: when the
      // scaffold DID write the folder (only install/boot failed), the prompt
      // names that real path and the new session's `ws/` binds to it — never
      // "ask if the path is missing" next to a folder that exists on disk.
      state.pageError = prep.error;
      rerender();
      const workspace = prep.workspace ?? state.workspace ?? undefined;
      await startDesignSession({
        id: `new-design:${Date.now()}`,
        title: `New design · ${spec.type}`,
        url: '',
        type: spec.type,
        brief: spec.brief,
        dir: workspace?.dir ?? '',
        workspace,
        text: designSessionPrompt(spec, workspace ?? null),
        references,
      });
      return;
    }
    await startDesignSession({
      id: `new-design:${Date.now()}`,
      title: `New design · ${spec.type}`,
      url: prep.url,
      type: spec.type,
      brief: spec.brief,
      projectId: prep.kind === 'workspace' ? prep.projectId : undefined,
      dir: prep.workspace.dir,
      workspace: prep.workspace,
      text: designSessionPrompt(spec, prep.workspace),
      references,
    });
  } catch (error) {
    state.pageError = `Could not start session: ${error instanceof Error ? error.message : String(error)}`;
    await host.toast({ kind: 'error', message: state.pageError });
  } finally {
    state.pageBusy = false;
    rerender();
  }
}

// ---- references ----

/**
 * Attach one queued pick to the chat composer. Returns whether the chip LANDED:
 * a failure must NOT ack (the pick is re-delivered on the next poll — the queue
 * holds the last 50, so a transient host failure loses nothing and duplicates
 * nothing). No success toast here: the "Added to chat" confirmation rides the
 * ack and answers in the CANVAS (V4-5 — the service relays it to the shell's
 * toast pill), which is exactly where the user just clicked.
 */
async function addToChat(entry: QueuedPick): Promise<boolean> {
  try {
    await host.attach(buildAttachPayload(entry, pickContext()));
    return true;
  } catch (error) {
    setStatus(`Could not attach a canvas pick: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return false;
  }
}

/** Where the row's picks live on disk (F6): the bound workspace + the live screens. */
function pickContext(): PickContext | null {
  const dir = state.workspace?.dir?.trim();
  return dir ? { workspaceDir: dir, screens: state.liveScreens } : null;
}

/** The live screens with ABSOLUTE files, for the compact mode chip (F7). */
function currentScreenFiles(dir: string): Array<{ id: string; file: string; title: string }> {
  return currentScreens().map((screen) => {
    const live = state.liveScreens.find((candidate) => candidate.id === screen.id);
    let file = screen.file;
    try {
      if (live) file = decodeURIComponent(new URL(live.url).pathname).replace(/^\/+/, '') || 'index.html';
    } catch {
      /* keep the basename */
    }
    return { ...screen, file: workspaceFilePath(dir, file) };
  });
}

/**
 * F7: attach the compact Design Mode chip ahead of a pick batch. Best-effort —
 * a failure here never blocks or un-acks the picks themselves.
 */
async function attachCompactModeChip(): Promise<void> {
  const ws = state.workspace;
  if (!state.mode.on || !ws || ws.dir.trim() === '') return;
  try {
    await host.attach(buildCompactModeChip(state.sessionId, state.mode, ws, currentScreenFiles(ws.dir), currentConfig()?.url));
  } catch {
    /* the pick chips still carry Workspace:/File: lines (F6) */
  }
}

// ---- the pick queue (SPEC-V4 V4-5, row surface only) ----
//
// Picks arrive from the service as an ORDERED QUEUE, not a `lastPick` snapshot:
// ONE `GET /picks?since=<cursor>&wait=12000` long-poll in flight at a time,
// delivers every queued pick as its own chip in seq order, then `POST /picks/ack`
// up to the last delivered seq. Two consequences the old 900 ms poll had neither
// (E7): rapid clicks ALL arrive (the ring buffer holds them, no coalescing loss),
// and a hidden window loses nothing — this loop has NO visibility guard, and the
// persisted since-cursor catches up whatever queued while it could not read.
// A request error/timeout falls back to `wait=0` short polls every 250 ms for
// 30 s, then the long-poll retries. Design Mode OFF holds delivery (every pick
// stays queued and un-acked): chips land only on an explicit gesture path,
// never automatically (fence §5), and turning ON re-runs the cursor catch-up.

/** The long-poll window (the service accepts `wait` 0..12000). */
export const PICK_LONG_POLL_MS = 12_000;
/** The degraded-mode short poll: `wait=0` every 250 ms… */
export const PICK_SHORT_POLL_MS = 250;
/** …for up to 30 s, then back to the long-poll (spec V4-5). */
export const PICK_SHORT_POLL_BUDGET_MS = 30_000;
/** The idle check cadence while held (mode off). */
const PICK_HELD_POLL_MS = 900;
/** The pace after an idle long-poll round — pacing only; a real long-poll already waited. */
const PICK_IDLE_POLL_MS = 1000;

/**
 * The highest seq this row has delivered-and-acked. Persists for the frame's
 * life — across hidden windows, backoff stretches and mode toggles — so the
 * queue never replays delivered chips, and whatever it cannot read yet waits
 * for the cursor, not for luck.
 */
let pickCursor = 0;
let pickLoopActive = false;

/** Test seam / accounting: the current since-cursor. */
export function getPickCursor(): number {
  return pickCursor;
}

/**
 * Deliver a batch in seq order and ack the contiguous prefix. The cursor moves
 * ONLY past chips that landed (failure → no ack → retry); an ack that fails
 * AFTER its chip landed keeps the cursor advanced — the composer already has
 * the chip, and redelivering it would duplicate. The service's own unacked
 * watchdog raises the canvas-side warning when delivery truly stalls.
 */
async function deliverPickBatch(picks: QueuedPick[]): Promise<boolean> {
  let lastDelivered: QueuedPick | null = null;
  let modeRechecked = false;
  let modeChipSent = false;
  for (const entry of [...picks].sort((a, b) => a.seq - b.seq)) {
    if (entry.seq <= pickCursor) continue; // already delivered-and-acked (defensive)
    // F5: memory may say OFF only because another frame (the `/canvas` resolve
    // pane) turned the mode ON in storage after this row loaded it. One cheap
    // storage read per batch beats holding the pick for another long-poll.
    if (!state.mode.on && !modeRechecked) {
      modeRechecked = true;
      await syncModeFromStorage();
    }
    if (!state.mode.on) break; // held — the queue keeps it
    // F7: the FIRST deliverable pick of a batch carries the standing Design
    // Mode instructions (workspace path + rule + screens) — at most once per
    // batch, and under the mode chip's own id so it replaces, never stacks.
    if (!modeChipSent) {
      modeChipSent = true;
      await attachCompactModeChip();
    }
    if (!(await addToChat(entry))) break; // no ack past a failed attach; retry next poll
    lastDelivered = entry;
  }
  if (!lastDelivered) return false;
  pickCursor = lastDelivered.seq;
  try {
    await ackPicks(lastDelivered.seq, pickAckLabel(lastDelivered));
  } catch {
    /* the chips are in the composer; the next ack covers these seqs as well */
  }
  return true;
}

/** Whether a `/picks` answer has the shape the §3 contract gives it. */
function picksResultValid(result: PicksResult | null | undefined): result is PicksResult {
  return Boolean(result && Array.isArray(result.picks));
}

/**
 * One `/picks` round. `'progress'` — chips landed (drain the rest at once);
 * `'idle'` — the request answered with nothing deliverable; `'error'` — the
 * request failed or answered garbage, which sends the caller into the backoff
 * mode. Also rebases the cursor if the service restarted (its latest seq
 * regressed below ours): the ring's new picks must not be pinned behind a dead
 * cursor.
 */
async function pollPicksOnce(waitMs: number): Promise<'progress' | 'idle' | 'error'> {
  try {
    const result = await getPicks(pickCursor, waitMs);
    if (!picksResultValid(result)) return 'error';
    if (typeof result.seq === 'number' && result.seq < pickCursor) pickCursor = 0;
    return await deliverPickBatch(result.picks) ? 'progress' : 'idle';
  } catch {
    return 'error';
  }
}

/**
 * The queue loop: runs until `stop()` says so. Sequential awaits make it
 * SINGLE-IN-FLIGHT by construction — a second `/picks` can never overlap the
 * long-poll that is still open. Delivered batches loop immediately (the ≤20
 * page cap means a big queue needs successive reads); an idle round paces at
 * `PICK_IDLE_POLL_MS` so a service answering fast can never hot-spin the row;
 * errors take the V4-5 backoff route.
 */
export async function runPickLoop(stop: () => boolean): Promise<void> {
  while (!stop()) {
    if (!state.mode.on) {
      await sleep(PICK_HELD_POLL_MS);
      // F5: a mode turned ON by another frame must release the hold without
      // waiting for anything else to refresh this row's copy.
      if (!state.mode.on) await syncModeFromStorage();
      continue;
    }
    const outcome = await pollPicksOnce(PICK_LONG_POLL_MS);
    if (outcome === 'progress') continue;
    if (outcome === 'idle') {
      await sleep(PICK_IDLE_POLL_MS);
      continue;
    }
    // Backoff: short `wait=0` polls every 250 ms for up to 30 s, then the
    // long-poll retries (and the budget restarts if the service stays down).
    const backoffStart = Date.now();
    while (!stop() && Date.now() - backoffStart < PICK_SHORT_POLL_BUDGET_MS) {
      if (!state.mode.on) break;
      await sleep(PICK_SHORT_POLL_MS);
      if ((await pollPicksOnce(0)) !== 'error') break;
    }
  }
}

/** Start the row's queue loop (idempotent; the row mount calls it once). */
export function startPickLoop(): void {
  if (pickLoopActive) return;
  pickLoopActive = true;
  void runPickLoop(() => !pickLoopActive);
}

/** Stop it (test seam; a frame teardown takes the whole panel with it). */
export function stopPickLoop(): void {
  pickLoopActive = false;
}

/** Test seam: reset the queue bookkeeping between cases. */
export function resetPickLoop(): void {
  pickLoopActive = false;
  pickCursor = 0;
}

// NOTE — a hidden resolve frame CANNOT be a long-lived pick bridge (it is
// force-unmounted after `GUEST_REQUEST_TIMEOUT_MS`, 20 s), which is why the
// queue + the row attaches. Routing chips to another window still needs a
// host-side persistent surface there (tracked upstream).

// ---- the canvas window ----

/** Surface an open's progress/result. Errors go to a toast (deduped by `setStatus`). */
function openStatus(message: string, kind: 'info' | 'error' = 'info'): void {
  setStatus(message, kind);
}

/**
 * Open (or navigate) the workspace's live canvas: `POST /open {dir}` — the
 * service resolves `.design-studio.json` and all screens itself (spec §B).
 * Called only from an explicit action (the toggle turning ON, the Start
 * control) and from the async-scaffold flow's end, so it carries V4-8's
 * `focus:true` — raising the window IS what the user asked for. `wsReady`
 * (a config url) gates a real open; with none it stays SILENT — there is no
 * "no url" toast for a backstop-only path.
 * V4-15: a `WORKSPACE_MISSING` answer unbinds this session's `ws/` record and
 * offers a fresh create.
 *
 * FORK-MERGE (V4-13 dock, P2 — SKIPPED): the spec wants `dock:{x,y,width,height}`
 * beside the OpenChamber window "from `window.screenX/screenY/outerWidth/
 * outerHeight` of the host window (best effort)". The guest frame has NO such
 * surface: the SDK HostClient exposes no window geometry, and from a cross-origin
 * panel iframe `window.screenX/outerWidth` do not describe the HOST window (the
 * test frame proves it — the shim `window` has none). Sending the iframe's own
 * numbers would mis-dock Chrome, so the panel sends no `dock` and the service's
 * `placeWindow` default stands. Needs a host API (e.g. a window-bounds read on
 * the bridge) — filed, not faked.
 */
async function openCanvasWindow(notify: boolean): Promise<void> {
  const ws = state.workspace;
  if (!ws) return;
  // Mark an open in flight before any await: a /state poll landing mid-open must
  // not read the not-yet-open window as "the user closed it".
  state.pendingOpen = true;
  try {
    // Read the workspace config so wsReady is known (and keep the cached config
    // fresh for the row). A directory-level switch mid-read never commits.
    try {
      const read = await getConfig(ws.dir);
      if (state.workspace?.dir === ws.dir) {
        state.config = read.config;
        state.configPath = read.path;
        state.configDir = ws.dir;
      }
    } catch {
      /* service not ready: fall through to the cache and lastUrl */
    }
    const url = state.config?.url?.trim() ?? (await loadLastUrl(ws.dir)) ?? undefined;
    if (!url) {
      if (notify) await host.toast({ kind: 'error', message: NO_PROJECT_URL_MESSAGE });
      return;
    }
    openStatus(OPENING_STATUS);
    const result = await openWorkspace({ dir: ws.dir, focus: true });
    // V4-15: the folder is gone — unbind the session's workspace and let the
    // row offer a fresh "Create canvas" (the `ws/` record is deleted, not just
    // shadowed, so a reload cannot re-bind the dead dir).
    if (!result.ok && result.code === WORKSPACE_MISSING_CODE) {
      await handleMissingWorkspace(ws.dir, result.error);
      return;
    }
    // Persist the URL the moment it is opened, so a later ON with no live config
    // still reopens this workspace at its last page.
    if (result.ok) await saveLastUrl(ws.dir, result.url || url);
    // Remember that THIS panel started the server, so Design Mode OFF may stop
    // it later (never a server we did not start).
    if (result.ok && result.started) markServerStartedByUs(ws.dir);
    openStatus(formatOpenStatus(result), result.ok ? 'info' : 'error');
  } catch (error) {
    openStatus(`Could not open the canvas: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    state.pendingOpen = false;
  }
}

/**
 * The workspace dir no longer exists (V4-15). Clear this session's binding
 * (memory + `ws/<sessionId>` storage + the page's dir→session map) so the row's
 * Start control re-offers "Create canvas" and no poll path can resurrect the
 * dead dir. The mode mirror turns Design Mode OFF through the normal
 * window-closed path; the toast says what to do next.
 */
async function handleMissingWorkspace(dir: string, message?: string): Promise<void> {
  state.workspace = null;
  state.config = null;
  state.configPath = null;
  state.configDir = null;
  state.startedServers.delete(dir);
  wsSessionMap.delete(normalizeDirPath(dir));
  const key = workspaceStorageKey(state.sessionId);
  if (key) {
    try {
      await host.storage.delete(key);
    } catch {
      /* an undeletable record is shadowed by the in-memory clear for this session */
    }
  }
  renderRow();
  rerender();
  await host.toast({
    kind: 'error',
    message: `${message ?? `The canvas folder ${dir} no longer exists.`} Start creates a new canvas.`,
  });
}

/**
 * Raise the workspace of a workspaces-list row without rebinding this session:
 * `POST /open {dir}` against that row's dir. A Preview click is user-initiated,
 * so it carries the V4-8 `focus:true`.
 */
async function previewWorkspace(row: WorkspaceRow): Promise<void> {
  if (!row.url?.trim()) {
    await host.toast({ kind: 'error', message: NO_PROJECT_URL_MESSAGE });
    return;
  }
  try {
    const result = await openWorkspace({ dir: row.dir, focus: true });
    if (!result.ok) {
      await host.toast({ kind: 'error', message: result.error ?? 'Could not open the canvas' });
      return;
    }
    await host.toast({ kind: 'success', message: `Opened ${row.name} — its canvas window is live.` });
  } catch (error) {
    await host.toast({ kind: 'error', message: `Could not open the canvas: ${error instanceof Error ? error.message : String(error)}` });
  }
}

// ---- dev-server stop (smart stop on OFF, manual stop on the icon button) ----
//
// A dev server the panel started is stopped when Design Mode goes OFF — but
// only when it is safe: our session is idle AND no other design session in the
// same workspace dir is VERIFIED inactive (an unreadable check fails closed).
// The MANUAL path (the icon button) skips the in-memory gate and defers
// ownership to the service, which kills only a group it recorded for `dir`.

let directoryGeneration = 0;
let serverActionSeq = 0;

/**
 * The dir the dev-server actions resolve against: the workspace dir first (the
 * canvas model), the chat directory as the legacy/test fallback when no
 * workspace is bound yet (`setProjectDirectory` drives it in tests).
 */
function actionDir(): string | null {
  return state.workspace?.dir ?? state.directory;
}

/** Whether the action dir moved since `gen` — including an A→B→A round-trip. */
function directoryMovedSince(dir: string, gen: number): boolean {
  return actionDir() !== dir || directoryGeneration !== gen;
}

/** Remember that THIS panel started `dir`'s dev server, so OFF may stop it. */
export function markServerStartedByUs(dir: string | null): void {
  if (dir) state.startedServers.add(dir);
}

/** The project resolution for a directory, or `unknown` when it cannot be read. */
type ProjectResolution = { kind: 'id'; id: string } | { kind: 'unregistered' } | { kind: 'unknown' };

/**
 * The registered project whose directory contains `dir` (decision 4c detection
 * doubles as the ownership check for the dev-server stop).
 */
async function resolveProjectId(dir: string): Promise<ProjectResolution> {
  const cached = allProjects.find((row) => sameDirPath(row.directory, dir));
  if (cached) return { kind: 'id', id: cached.id };
  let snapshot: Awaited<ReturnType<typeof host.listProjects>>;
  try {
    snapshot = await host.listProjects();
  } catch {
    return { kind: 'unknown' };
  }
  if (snapshot.state !== 'ready') return { kind: 'unknown' };
  const project = snapshot.projects.find((candidate) => sameDirPath(candidate.directory, dir));
  return project ? { kind: 'id', id: project.id } : { kind: 'unregistered' };
}

/**
 * How many OTHER design sessions are active in `dir` right now — or `null`
 * when that CANNOT be verified. The stop decision fails closed.
 */
async function countActiveDesignSessions(dir: string): Promise<number | null> {
  const resolved = await resolveProjectId(dir);
  if (resolved.kind === 'unknown') return null;
  if (resolved.kind === 'unregistered') return 0;
  let snapshot: Awaited<ReturnType<typeof host.listSessions>>;
  try {
    snapshot = await host.listSessions(resolved.id);
  } catch {
    return null;
  }
  if (snapshot.state !== 'ready') return null;
  const markerIds = await readDesignMarkerSessionIds();
  return countOtherActiveDesignSessions(snapshot.sessions, state.sessionId, markerIds);
}

/** Send the stop to the service and forget the record ONLY on a confirmed stop. */
async function tryStopDevServer(dir: string): Promise<{ stopped: boolean; error?: string }> {
  const result = await stopDevServer(dir);
  if (result.ok && result.stopped) {
    state.startedServers.delete(dir);
    if (state.pendingStop?.dir === dir) state.pendingStop = null;
    return { stopped: true };
  }
  return { stopped: false, error: result.error };
}

/**
 * Decide whether THIS panel may stop the dev server for `dir`, applying the
 * idle/other-session rules. The safety lookup is awaited BEFORE anything
 * destructive is sent; a check that could not be verified FAILS CLOSED.
 * Ownership differs by path: the AUTOMATIC path stops only a server this panel
 * started; the MANUAL path defers ownership to the service.
 */
export async function requestDevServerStop(
  options: { manual?: boolean; dir?: string } = {},
): Promise<{ stopped: boolean; held: boolean; blocked?: boolean; unknown?: boolean; error?: string }> {
  const dir = options.dir ?? actionDir();
  if (!dir) return { stopped: false, held: false, blocked: false };
  const manual = options.manual ?? false;
  const gen = directoryGeneration;
  if (!manual && !state.startedServers.has(dir)) return { stopped: false, held: false, blocked: false };
  const otherActiveDesignSessions = await countActiveDesignSessions(dir);
  if (state.sessionBusy) {
    state.pendingStop = { dir, manual };
    return { stopped: false, held: true, blocked: false };
  }
  if (otherActiveDesignSessions === null) {
    return { stopped: false, held: false, blocked: false, unknown: true };
  }
  if (options.dir === undefined && directoryMovedSince(dir, gen)) {
    return { stopped: false, held: false, blocked: false };
  }
  if (shouldStopDevServer({ busy: state.sessionBusy, otherActiveDesignSessions, startedByUs: true })) {
    try {
      const outcome = await tryStopDevServer(dir);
      const result: { stopped: boolean; held: boolean; blocked?: boolean; error?: string } = {
        stopped: outcome.stopped,
        held: false,
        blocked: false,
      };
      if (outcome.error) result.error = outcome.error;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Could not stop the preview: ${message}`, 'error');
      return { stopped: false, held: false, blocked: false, error: message };
    }
  }
  return { stopped: false, held: false, blocked: true };
}

/** The truthful message for a manual stop the service answered `stopped:false`. */
export async function manualStopRefusalMessage(dir: string): Promise<string> {
  try {
    const status = await getServerStatus(dir);
    if (status.error) return status.error;
    return status.pid
      ? 'No preview dev server to stop.'
      : 'The service did not record this server; it was not started by Design Canvas.';
  } catch {
    return 'No preview dev server to stop.';
  }
}

/** Surface the outcome of a queued stop being honoured. */
function reportHonouredStop(
  result: { stopped: boolean; held: boolean; blocked?: boolean; unknown?: boolean },
  dir: string,
): void {
  if (result.stopped) {
    if (state.workspace?.dir === dir) {
      state.serverStatus = false;
      state.serverError = null;
      renderServerControl();
    }
    announceServer('Preview dev server stopped.');
  } else if (result.blocked) {
    announceServer('Another active design session is using this preview server.');
  } else if (result.unknown) {
    announceServer('Could not verify other design sessions — the queued stop stays pending.');
  }
}

/**
 * V4-12: mirror this session's agent turn to the canvas — `POST /agent-status`
 * on every busy→idle/idle→busy transition, so the shell shows the "Designing…"
 * chip and settles with its sync pulse. DISPLAY-ONLY: this never sends a prompt,
 * and the service never turns it into one (fence §5). Failures are silent: the
 * worst case is a stale chip, never a stuck row.
 */
async function reportAgentStatus(busy: boolean): Promise<void> {
  try {
    await postAgentStatus(busy, busy ? 'Designing…' : undefined);
  } catch {
    /* the canvas keeps its previous chip; the row's own state is unaffected */
  }
}

/**
 * V4-4 backstop: after an agent turn COMPLETES, ask the service to re-read the
 * registry and push it (`POST /screens/sync {dir}`) — the same tick the file
 * watcher fires, covering network roots where `fs.watch` is unreliable.
 * Best-effort: a miss only delays the next watcher tick.
 */
async function syncRegistryBackstop(): Promise<void> {
  const dir = state.workspace?.dir;
  if (!dir) return;
  try {
    await syncScreens(dir);
  } catch {
    /* the watcher owns the guarantee; the backstop is insurance */
  }
}

/**
 * The current session's live snapshot (`host.onSession`). Re-binds the session
 * (and its workspace record), keeps `sessionBusy` fresh (mirroring every busy
 * TRANSITION to the canvas, V4-12), and performs a queued stop once the session
 * goes idle.
 */
export async function applySessionSnapshot(session: { id: string; busy: boolean } | null): Promise<void> {
  const changed = state.sessionId !== (session?.id ?? null);
  const wasBusy = state.sessionBusy;
  state.sessionId = session?.id ?? null;
  state.sessionBusy = session?.busy ?? false;
  // The hidden resolve pane mirrors nothing to the canvas: the row owns it.
  if (wasBusy !== state.sessionBusy && !isHiddenResolvePane()) await reportAgentStatus(state.sessionBusy);
  if (state.sessionBusy) {
    if (state.pendingStop) {
      state.pendingStop = null;
      announceServer('Session is busy again — the queued stop was cancelled.');
    }
  } else if (state.pendingStop) {
    const request = state.pendingStop;
    const result = await requestDevServerStop({ manual: request.manual, dir: request.dir });
    reportHonouredStop(result, request.dir);
  }
  if (changed) {
    // The rail tab outlives a session switch; `loadWorkspace` only binds a
    // record that EXISTS, so drop the previous chat's canvas first or the
    // rail would offer "Open canvas" for a chat that has none.
    if (state.surface === 'panel') state.workspace = null;
    await loadWorkspace();
    renderRow(); // F2: the Start control's "send a message first" hint follows the session
  }
  await loadMode();
  // Only the rail: a page re-render here would rebuild the composer mid-typing.
  if (state.surface === 'panel') renderRail();
}

/**
 * A session lifecycle event: a `completed` turn is the moment a `pendingStop`
 * is honoured, if the session is now idle — and the moment the registry
 * backstop runs, because the agent's writes are all on disk (V4-4/V4-12).
 */
export async function handleSessionLifecycle(event: { phase: 'started' | 'completed' | 'failure' }): Promise<void> {
  if (event.phase === 'completed') {
    if (!isHiddenResolvePane()) void syncRegistryBackstop();
    if (state.pendingStop && !state.sessionBusy) {
      const request = state.pendingStop;
      const result = await requestDevServerStop({ manual: request.manual, dir: request.dir });
      reportHonouredStop(result, request.dir);
    }
  }
}

// ---- preview-dev-server Start/Stop control ----

const serverAnnouncements: string[] = [];

function announceServer(message: string): void {
  serverAnnouncements.push(message);
  if (!serverAnnounceEl) return;
  serverAnnounceEl.textContent = '';
  queueMicrotask(() => { if (serverAnnounceEl) serverAnnounceEl.textContent = message; });
}

/** Whether the frame's focus sits on `el` or inside it. */
function focusInside(el: HTMLElement | null): boolean {
  const active = document.activeElement as Node | null | undefined;
  if (!el || !active || typeof el.contains !== 'function') return false;
  return active === el || el.contains(active);
}

/** Focus the session line when a rendered control the user was on disappears. */
function focusSessionLine(): void {
  if (!sessionLineEl) return;
  sessionLineEl.tabIndex = -1;
  sessionLineEl.focus();
}

/** Monotonic token for the in-flight status read. */
let serverStatusRead = 0;

/** The rendered Start/Stop state, exactly as `renderServerControl` derives it. */
function serverRenderState(): 'loading' | 'error' | 'running' | 'stopped' | 'checking' {
  if (state.serverPending) return 'loading';
  if (state.serverError) return 'error';
  if (state.serverStatus === null) return 'checking';
  return state.serverStatus ? 'running' : 'stopped';
}

/** Announce a poll-driven change of the rendered state; silence when unchanged. */
function announceServerTransition(before: ReturnType<typeof serverRenderState>): void {
  const after = serverRenderState();
  if (after === before) return;
  if (after === 'running') announceServer('Preview dev server is running.');
  else if (after === 'stopped' && before !== 'checking') announceServer('Preview dev server stopped.');
  else if (after === 'error') announceServer('Preview dev server status unavailable — click to retry.');
}

/** The workspace dir the dev-server read watch (the workspace, not the chat dir). */
function workspaceDir(): string | null {
  return state.workspace?.dir ?? null;
}

/**
 * Poll the service for the current WORKSPACE's dev-server reachability. A stale
 * read — one a newer read or a manual action superseded — never commits.
 */
async function refreshServerStatus(): Promise<void> {
  const dir = actionDir();
  if (state.serverPending || !dir) return;
  const token = ++serverStatusRead;
  const superseded = (): boolean => token !== serverStatusRead || state.serverPending || actionDir() !== dir;
  try {
    const status = await getServerStatus(dir);
    if (superseded()) return;
    const before = serverRenderState();
    if (status.error) {
      state.serverError = status.error;
    } else {
      state.serverStatus = status.up;
      state.serverError = null;
    }
    announceServerTransition(before);
  } catch (error) {
    if (superseded()) return;
    const before = serverRenderState();
    state.serverError = error instanceof Error ? error.message : String(error);
    announceServerTransition(before);
  }
  renderServerControl();
}

/**
 * Update (or hide) the preview-dev-server Start/Stop button. With NO workspace
 * the button becomes "Create canvas" — the row NEVER falls back to "not set up"
 * (spec §F). With a workspace it appears for loopback-configured workspaces
 * only, exactly as before.
 */
function renderServerControl(): void {
  if (!barEl || !serverBtn) return;
  const ws = state.workspace;
  // No workspace yet: the control IS the create-canvas affordance.
  if (!ws) {
    serverBtn.hidden = false;
    serverBtn.disabled = state.serverPending;
    serverBtn.classList.remove('is-stopped', 'is-running', 'is-loading', 'is-error');
    serverBtn.classList.add(state.serverPending ? 'is-loading' : 'is-stopped');
    // F2: with no session yet the click can only explain itself — label it so.
    serverBtn.title = state.serverPending
      ? 'Working…'
      : state.sessionId
        ? 'Create canvas — start a Design Canvas workspace'
        : `${NO_SESSION_HINT}, then press Start to create a canvas`;
    serverBtn.setAttribute('aria-label', serverBtn.title);
    const icon = q('span', 'ds-server-icon');
    serverBtn.replaceChildren(icon);
    return;
  }
  const url = currentConfig()?.url?.trim();
  const ready = projectReady(currentConfig()) && url !== undefined && isLoopbackUrl(url);
  if (!ready) {
    // The control disappears: keep focus visible, never dropped to `body`.
    const hadFocus = focusInside(serverBtn);
    serverBtn.hidden = true;
    if (hadFocus) focusSessionLine();
    return;
  }
  serverBtn.hidden = false;
  serverBtn.disabled = state.serverPending;
  serverBtn.classList.remove('is-stopped', 'is-running', 'is-loading', 'is-error');
  let stateClass: 'is-stopped' | 'is-running' | 'is-loading' | 'is-error';
  if (state.serverPending) {
    stateClass = 'is-loading';
  } else if (state.serverError) {
    stateClass = 'is-error';
  } else if (state.serverStatus === null) {
    stateClass = 'is-loading';
  } else if (state.serverStatus) {
    stateClass = 'is-running';
  } else {
    stateClass = 'is-stopped';
  }
  serverBtn.classList.add(stateClass);
  serverBtn.title = state.serverPending
    ? 'Working…'
    : state.serverError
      ? 'Preview dev server error — click to retry'
      : state.serverStatus === null
        ? 'Checking the preview dev server…'
        : state.serverStatus
          ? 'Stop preview dev server'
          : 'Start preview dev server';
  serverBtn.setAttribute('aria-label', serverBtn.title);
  const icon = q('span', 'ds-server-icon');
  serverBtn.replaceChildren(icon);
}

/** The cached config, but ONLY when it was read for the CURRENT workspace. */
function currentConfig(): StudioConfig | null {
  return state.configDir === state.workspace?.dir ? state.config : null;
}

/**
 * Handle a click on the preview-dev-server Start/Stop button: with no workspace
 * it CREATES the canvas workspace (first use); otherwise start/stop the
 * workspace's dev server as before.
 */
async function onServerControlClick(): Promise<void> {
  if (state.serverPending) return;
  if (!state.workspace) {
    // F2: a new-chat draft has no session to key the workspace to — say so
    // where the user is looking (the live region alone is screen-reader-only).
    if (!state.sessionId) {
      announceServer(NO_SESSION_MESSAGE);
      await host.toast({ kind: 'error', message: NO_SESSION_MESSAGE });
      return;
    }
    // First use: Start creates the canvas workspace (spec §F), then turns
    // Design Mode ON, which opens it. The row is long-lived, so it may wait
    // out the install/boot job here; `serverPending` keeps the button busy
    // and swallows double clicks for the whole flow.
    state.serverPending = true;
    renderServerControl();
    try {
      const ws = await ensureCanvasWorkspace('');
      if (!ws) {
        // The scaffold / job paths toast their own cause; this names the outcome.
        announceServer('Could not create the canvas workspace.');
        await host.toast({ kind: 'error', message: 'Could not create the canvas workspace — see the message above, then press Start to retry.' });
        return;
      }
      await toggleMode(true);
    } finally {
      state.serverPending = false;
      renderServerControl();
    }
    return;
  }
  const url = currentConfig()?.url?.trim();
  if (!url || !isLoopbackUrl(url)) return;
  if (state.serverStatus && !state.serverError) {
    await stopCurrentServer();
  } else {
    await startCurrentServer();
  }
}

/** Ask the service to start the workspace's dev server and mark it as ours. */
async function startCurrentServer(): Promise<void> {
  const dir = actionDir();
  if (!dir) return;
  const url = currentConfig()?.url?.trim();
  if (!url || !isLoopbackUrl(url)) return;
  const gen = directoryGeneration;
  const action = ++serverActionSeq;
  state.serverPending = true;
  state.serverError = null;
  renderServerControl();
  try {
    const result: ServerStartResult = await startDevServer(dir, url);
    if (result.ok && result.up && result.started) markServerStartedByUs(dir);
    if (directoryMovedSince(dir, gen)) return;
    state.serverStatus = result.up ?? null;
    state.serverError = result.error ?? null;
    if (result.ok && result.started) {
      announceServer('Preview dev server started.');
    } else if (result.ok && result.up) {
      announceServer('Preview dev server is running.');
    } else {
      announceServer(result.error ?? 'Could not start the preview dev server.');
    }
  } catch (error) {
    if (directoryMovedSince(dir, gen)) return;
    state.serverError = error instanceof Error ? error.message : String(error);
    announceServer(`Could not start the preview dev server: ${state.serverError}`);
  } finally {
    if (action === serverActionSeq) state.serverPending = false;
    renderServerControl();
    void refreshServerStatus();
  }
}

/** Ask the service to stop the workspace's dev server from the icon button. */
async function stopCurrentServer(): Promise<void> {
  const dir = actionDir();
  if (!dir) return;
  const gen = directoryGeneration;
  const action = ++serverActionSeq;
  state.serverPending = true;
  state.serverError = null;
  renderServerControl();
  try {
    const result = await requestDevServerStop({ manual: true });
    if (directoryMovedSince(dir, gen)) return;
    if (result.stopped) {
      state.serverStatus = false;
      state.serverError = null;
      announceServer('Preview dev server stopped.');
    } else if (result.held) {
      state.serverError = null;
      announceServer('Session is busy — stop queued for when it becomes idle.');
    } else if (result.unknown) {
      state.serverError = null;
      announceServer('Could not verify other design sessions — the preview server was left running.');
    } else if (result.blocked) {
      state.serverError = null;
      announceServer('Another active design session is using this preview server.');
    } else {
      announceServer(result.error ?? await manualStopRefusalMessage(dir));
    }
  } catch (error) {
    if (directoryMovedSince(dir, gen)) return;
    state.serverError = error instanceof Error ? error.message : String(error);
    announceServer(`Could not stop the preview dev server: ${state.serverError}`);
  } finally {
    if (action === serverActionSeq) state.serverPending = false;
    renderServerControl();
    void refreshServerStatus();
  }
}

/**
 * Read the WORkSPACE's `.design-studio.json` for display only (never opens a
 * window). Called on mount, on workspace bind, and on every poll tick, so a
 * config the agent scaffolds mid-session flips the row to its ready state
 * WITHOUT a reload. `reportErrors` toasts a failure (mount only); the poll
 * reads silently.
 */
async function readStudioConfig(reportErrors: boolean): Promise<void> {
  const dir = workspaceDir();
  if (!dir) return;
  // The hidden resolve pane renders no row to keep ready; the resolver reads
  // the one url it needs itself (`readWorkspaceUrl`).
  if (isHiddenResolvePane()) return;
  if (configReadInFlight) return;
  configReadInFlight = true;
  try {
    const { config, path } = await getConfig(dir);
    if (workspaceDir() !== dir) return;
    state.config = config;
    state.configPath = path;
    state.configDir = dir;
    renderRow();
  } catch (error) {
    if (reportErrors) {
      setStatus(error instanceof ServiceUnavailable ? `Local service not ready: ${error.message}` : `Config error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  } finally {
    configReadInFlight = false;
  }
}

/** Read the workspace config and surface failures (mount / workspace bind). */
export async function loadStudioConfig(): Promise<void> {
  await readStudioConfig(true);
}

// ---- the full-page creation home ----

/** Re-render the mounted home surface (the page, or the rail). A no-op on the row. */
function rerender(): void {
  if (state.surface === 'page') renderPage();
  else if (state.surface === 'panel') renderRail();
}

/**
 * Whether this frame may read the "Your design work" list (storage scan +
 * `GET /workspaces`): the page always, the rail only when it is the real tab.
 */
function canLoadDesignWork(): boolean {
  return state.surface === 'page' || (state.surface === 'panel' && railWorkEl !== null && isRealPane());
}

/** Load the registered projects (decision 4c projectId detection only). */
async function loadProjects(): Promise<void> {
  let snapshot: Awaited<ReturnType<typeof host.listProjects>>;
  try {
    snapshot = await host.listProjects();
  } catch {
    allProjects = [];
    return;
  }
  allProjects = allProjectsFromSnapshot(snapshot);
}

/**
 * The cached ws/ scan: ONE `host.storage.keys()` pass per refresh, one map of
 * normalized dir → session id (audit #19). The dirs are matched to /workspaces
 * rows after separator/drive-case normalization (audit #11).
 */
async function readWorkspaceSessionMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let keys: string[];
  try {
    keys = await host.storage.keys();
  } catch {
    return map;
  }
  const sessionIds = keys.map(wsSessionIdFromKey).filter((id): id is string => id !== null);
  await Promise.all(
    sessionIds.map(async (id) => {
      try {
        const value = await host.storage.get(workspaceStorageKey(id)!);
        if (isWorkspaceRecord(value)) map.set(normalizeDirPath(value.dir), id);
      } catch {
        /* an unreadable record simply never maps */
      }
    }),
  );
  return map;
}

/** Read the workspaces list (decision 2: design work = workspaces on disk). */
async function loadCanvasWorkspaces(): Promise<void> {
  state.workspaces = { kind: 'loading' };
  rerender();
  wsSessionMap = await readWorkspaceSessionMap();
  let result: WorkspacesResult;
  try {
    result = await getWorkspaces();
  } catch (error) {
    state.workspaces = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    rerender();
    return;
  }
  const rows = Array.isArray(result.workspaces) ? result.workspaces : [];
  // The join NEVER drops a row: an unmapped workspace stays visible, sessionId null.
  state.workspaces = rows.length === 0
    ? { kind: 'empty' }
    : { kind: 'list', rows: joinWorkspaceSessions(rows, wsSessionMap) };
  rerender();
}

/** Read the registration list, then the workspaces list derived from it. */
async function loadDesignHome(): Promise<void> {
  await loadProjects();
  await loadCanvasWorkspaces();
}

/**
 * The session ids carrying a persistent design marker (`design/<id>`). IO only;
 * the key parse lives in `designSessionIdFromKey`.
 */
async function readDesignMarkerSessionIds(): Promise<Set<string>> {
  const marked = new Set<string>();
  let keys: string[];
  try {
    keys = await host.storage.keys();
  } catch {
    return marked;
  }
  for (const key of keys) {
    const id = designSessionIdFromKey(key);
    if (id !== null) marked.add(id);
  }
  return marked;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A 24px stroke icon from inline path markup (trusted, built here only). */
function svgIcon(paths: string, size = 18): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) {
    svg.setAttribute(name, String(value));
  }
  svg.innerHTML = paths;
  return svg;
}

/** The abstract mini-preview on an idea card. `variant` is the card index modulo four. */
function ideaThumb(variant: number): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 56 40');
  svg.setAttribute('width', '56');
  svg.setAttribute('height', '40');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag: string, attrs: Record<string, string | number>): void => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    svg.append(node);
  };
  add('rect', { x: 0, y: 0, width: 56, height: 40, rx: 7, class: 'ds-thumb-bg' });
  if (variant === 0) {
    add('rect', { x: 8, y: 8, width: 22, height: 4, rx: 2, class: 'ds-thumb-accent' });
    add('rect', { x: 8, y: 16, width: 40, height: 8, rx: 2, class: 'ds-thumb-line' });
    add('rect', { x: 8, y: 28, width: 18, height: 5, rx: 2, class: 'ds-thumb-line' });
    add('rect', { x: 30, y: 28, width: 18, height: 5, rx: 2, class: 'ds-thumb-line' });
  } else if (variant === 1) {
    add('rect', { x: 8, y: 7, width: 40, height: 5, rx: 2, class: 'ds-thumb-line' });
    add('rect', { x: 8, y: 16, width: 19, height: 16, rx: 3, class: 'ds-thumb-accent' });
    add('rect', { x: 29, y: 16, width: 19, height: 7, rx: 2, class: 'ds-thumb-line' });
    add('rect', { x: 29, y: 25, width: 19, height: 7, rx: 2, class: 'ds-thumb-line' });
  } else if (variant === 2) {
    add('rect', { x: 8, y: 8, width: 12, height: 24, rx: 3, class: 'ds-thumb-accent' });
    add('rect', { x: 24, y: 9, width: 24, height: 4, rx: 2, class: 'ds-thumb-line' });
    add('rect', { x: 24, y: 17, width: 24, height: 4, rx: 2, class: 'ds-thumb-line' });
    add('rect', { x: 24, y: 25, width: 16, height: 4, rx: 2, class: 'ds-thumb-line' });
  } else {
    add('rect', { x: 8, y: 12, width: 12, height: 16, rx: 3, class: 'ds-thumb-line' });
    add('rect', { x: 22, y: 12, width: 12, height: 16, rx: 3, class: 'ds-thumb-accent' });
    add('rect', { x: 36, y: 12, width: 12, height: 16, rx: 3, class: 'ds-thumb-line' });
  }
  return svg;
}

/** Whether the send action may run right now. */
function canSend(): boolean {
  return !state.pageBusy && !referencePending && state.prompt.trim() !== '';
}

/** Keep the send button and the accent progress line in sync with the prompt. */
function updateComposerState(): void {
  const ready = canSend();
  if (sendEl) {
    sendEl.disabled = !ready;
    sendEl.classList.toggle('ready', ready);
    sendEl.classList.toggle('busy', state.pageBusy);
    sendEl.setAttribute('aria-busy', String(state.pageBusy));
    sendEl.title = state.pageBusy ? 'Starting the design session…' : referencePending ? 'Wait for the reference to finish checking' : 'Start the design session';
  }
  if (accentFillEl) {
    const progress = Math.min(1, state.prompt.trim().length / 140);
    accentFillEl.style.width = `${6 + progress * 94}%`;
  }
}

/** The composer overlays, every one driven by the same toggle contract. */
export type OverlayId = 'type' | 'ds' | 'attach';

/**
 * The ONE decision behind every composer overlay trigger: clicking a trigger
 * toggles it. Pure, so the toggle contract is testable without a DOM.
 */
export function nextOverlayState(current: OverlayId | null, triggerId: OverlayId): OverlayId | null {
  return current === triggerId ? null : triggerId;
}

/** The overlay currently open, or null. At most one is open at a time. */
function currentOverlay(): OverlayId | null {
  if (state.typeMenuOpen) return 'type';
  if (state.attachMenuOpen) return 'attach';
  if (state.dsMenuOpen) return 'ds';
  return null;
}

/** The trigger to focus once the page is rebuilt — set whenever a close happens. */
let refocusOverlayTrigger: OverlayId | null = null;

/** Toggle one composer overlay through the shared rule. */
function toggleMenu(which: OverlayId): void {
  if (currentOverlay() === 'attach') cancelReferenceValidation();
  const next = nextOverlayState(currentOverlay(), which);
  state.typeMenuOpen = next === 'type';
  state.attachMenuOpen = next === 'attach';
  state.dsMenuOpen = next === 'ds';
  if (next === 'ds') {
    dsQuery = '';
    dsHighlight = state.pageDesignSystemId;
  }
  refocusOverlayTrigger = next === null ? which : null;
  renderPage();
}

/** Close the one open overlay. `refocus` hands focus back to that overlay's trigger. */
function closeMenus(refocus = false): void {
  const open = currentOverlay();
  if (!open) return;
  if (open === 'attach') cancelReferenceValidation();
  state.typeMenuOpen = false;
  state.attachMenuOpen = false;
  state.dsMenuOpen = false;
  refocusOverlayTrigger = refocus ? open : null;
  renderPage();
}

/** Close the active overlay after a selection and return focus to its trigger. */
function closeActiveOverlay(id: OverlayId): void {
  if (id === 'attach') cancelReferenceValidation();
  state.typeMenuOpen = false;
  state.attachMenuOpen = false;
  state.dsMenuOpen = false;
  refocusOverlayTrigger = id;
  renderPage();
}

/** Any click outside an open overlay closes it. */
function onPageWindowClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest('.ds-ds-panel, .ds-menu, .ds-menu-trigger')) return;
  closeMenus();
}

/** Escape from anywhere in the frame closes an open overlay. */
function onPageKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (!currentOverlay()) return;
  event.preventDefault();
  closeMenus(true);
}

/** The centred page: hero, composer, workspace row and idea cards. */
function renderPage(): void {
  if (!pageBody || state.surface !== 'page') return;
  pageBody.replaceChildren();
  promptEl = null;
  sendEl = null;
  accentFillEl = null;
  const shell = q('div', 'ds-home');
  if (pageEnter) {
    shell.classList.add('ds-enter');
    pageEnter = false;
  }
  shell.append(renderHero(), renderComposer(), renderWorkspaceRow(), renderIdeas(), renderCanvasSection(), renderFooter());
  pageBody.append(shell);
  updateComposerState();
  focusPendingTrigger();
  if (referenceFocusId) {
    const target = Array.from(pageBody.querySelectorAll<HTMLButtonElement>('.ds-reference-remove'))
      .find((button) => button.dataset.referenceId === referenceFocusId);
    referenceFocusId = null;
    target?.focus();
  }
}

/** Focus the trigger that a close asked to return focus to, once it is back in the DOM. */
function focusPendingTrigger(): void {
  const id = refocusOverlayTrigger;
  if (!id) return;
  refocusOverlayTrigger = null;
  pageBody?.querySelector<HTMLElement>(`[data-overlay-trigger="${id}"]`)?.focus();
}

function renderHero(): HTMLElement {
  const hero = q('header', 'ds-hero');
  const title = q('h1', 'ds-hero-title');
  title.append(document.createTextNode("Let's create "));
  title.append(q('span', 'ds-hero-type', PAGE_TYPE_LABELS[state.pageType]));
  hero.append(title);
  hero.append(q('p', 'ds-hero-sub', 'Good work starts here'));
  if (state.pageError) {
    const error = q('div', 'ds-home-warn', state.pageError);
    error.setAttribute('role', 'alert');
    hero.append(error);
  }
  return hero;
}

/**
 * ONE anchored-popover pattern, shared by the composer overlays — the type
 * picker, the design-system picker and the `+` attach menu.
 */
function anchoredPopover(options: {
  open: boolean;
  trigger: HTMLElement;
  panel: HTMLElement;
  label: string;
  optionSelector: string;
  onClose: () => void;
}): HTMLElement {
  const anchor = q('div', 'ds-ds-anchor');
  anchor.append(options.trigger);
  if (!options.open) return anchor;
  options.panel.setAttribute('role', 'dialog');
  options.panel.setAttribute('aria-label', options.label);
  anchor.append(q('div', 'ds-ds-backdrop'));
  anchor.append(options.panel);
  options.panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      options.onClose();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.tagName === 'SELECT') return;
    const items = Array.from(options.panel.querySelectorAll<HTMLElement>(options.optionSelector));
    if (items.length === 0) return;
    event.preventDefault();
    const current = active ? items.indexOf(active) : -1;
    const next = items[popoverStep(current, items.length, event.key === 'ArrowDown' ? 1 : -1)];
    next?.focus();
  });
  return anchor;
}

function renderComposer(): HTMLElement {
  const box = q('div', 'ds-composer');

  const area = q<HTMLTextAreaElement>('textarea', 'ds-composer-input');
  area.rows = 3;
  area.placeholder = 'Describe the design you want…';
  area.value = state.prompt;
  area.setAttribute('aria-label', 'Design brief');
  area.disabled = state.pageBusy;
  area.addEventListener('input', () => {
    state.prompt = area.value;
    updateComposerState();
  });
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend()) void startNewDesign();
    }
  });
  promptEl = area;

  const bar = q('div', 'ds-composer-bar');

  // References belong to this page's draft, not the original host composer.
  const plus = q<HTMLButtonElement>('button', 'ds-plus ds-menu-trigger');
  plus.dataset.overlayTrigger = 'attach';
  plus.append(svgIcon('<path d="M12 5v14"/><path d="M5 12h14"/>'));
  plus.title = 'Add a reference';
  plus.setAttribute('aria-label', 'Add a reference');
  plus.disabled = state.pageBusy || referencePending;
  plus.setAttribute('aria-expanded', String(state.attachMenuOpen));
  plus.addEventListener('click', () => toggleMenu('attach'));
  const attachAnchor = anchoredPopover({
    open: state.attachMenuOpen,
    trigger: plus,
    panel: renderAttachPanel(),
    label: 'Add a reference',
    optionSelector: '.ds-menu-item',
    onClose: () => closeMenus(true),
  });

  // The design-system control, next to `+`.
  const designSystem = q<HTMLButtonElement>('button', 'ds-chip ds-ds-trigger ds-menu-trigger');
  designSystem.dataset.overlayTrigger = 'ds';
  designSystem.append(designSystemIcon());
  designSystem.append(q('span', 'ds-chip-label', designSystemLabel(state.pageDesignSystemId)));
  designSystem.append(svgIcon('<path d="M6 9l6 6 6-6"/>', 14));
  designSystem.title = 'Choose a design system';
  designSystem.setAttribute('aria-label', `Design system: ${designSystemLabel(state.pageDesignSystemId)}`);
  designSystem.disabled = state.pageBusy;
  designSystem.addEventListener('click', () => toggleMenu('ds'));

  const chip = q<HTMLButtonElement>('button', 'ds-chip ds-menu-trigger');
  chip.dataset.overlayTrigger = 'type';
  chip.append(q('span', 'ds-chip-label', PAGE_TYPE_LABELS[state.pageType]));
  chip.append(svgIcon('<path d="M6 9l6 6 6-6"/>', 14));
  chip.title = 'Choose the design type';
  chip.setAttribute('aria-label', 'Choose the design type');
  chip.disabled = state.pageBusy;
  chip.addEventListener('click', () => toggleMenu('type'));

  const spacer = q('div', 'ds-composer-spacer');

  const send = q<HTMLButtonElement>('button', 'ds-send');
  send.append(svgIcon('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>', 20));
  send.title = 'Start the design session';
  send.setAttribute('aria-label', 'Start the design session');
  send.addEventListener('click', () => {
    if (canSend()) void startNewDesign();
  });
  sendEl = send;

  const dsAnchor = anchoredPopover({
    open: state.dsMenuOpen,
    trigger: designSystem,
    panel: renderDesignSystemPanel(),
    label: 'Choose a design system',
    optionSelector: '.ds-ds-item',
    onClose: () => closeMenus(true),
  });
  const typeAnchor = anchoredPopover({
    open: state.typeMenuOpen,
    trigger: chip,
    panel: renderTypeMenu(),
    label: 'Choose the design type',
    optionSelector: '.ds-menu-item',
    onClose: () => closeMenus(true),
  });

  const children: HTMLElement[] = [];
  children.push(attachAnchor);
  children.push(dsAnchor, typeAnchor, spacer, send);
  bar.append(...children);
  box.append(area, renderReferenceDraft(), bar);
  box.classList.toggle('ds-overlay-open', state.attachMenuOpen || state.dsMenuOpen || state.typeMenuOpen);

  const track = q('div', 'ds-composer-accent');
  accentFillEl = q('div', 'ds-composer-accent-fill');
  track.append(accentFillEl);
  box.append(track);

  return box;
}

/** Compact suffixes disambiguate equal basenames; disclosure exposes full paths. */
function referenceDisplayLabel(reference: DraftReference): string {
  const parts = reference.path.split('/').filter(Boolean);
  let count = Math.min(2, parts.length);
  const others = state.references.filter((candidate) => candidate.id !== reference.id);
  while (count < parts.length && others.some((candidate) => candidate.path.split('/').filter(Boolean).slice(-count).join('/') === parts.slice(-count).join('/'))) count += 1;
  return `${fileBaseName(reference.sourceDirectory)} · ${parts.slice(-count).join('/')}`;
}

/** One wrapping row; full canonical identity is available without a tooltip. */
function renderReferenceDraft(): HTMLElement {
  const list = q('ul', 'ds-reference-list');
  list.setAttribute('aria-label', 'References included with this design brief');
  list.hidden = state.references.length === 0;
  for (const reference of state.references) {
    const item = q('li', 'ds-reference-chip');
    item.append(svgIcon(reference.kind === 'project'
      ? '<path d="M3 7h6l2 2h10v11H3z"/>'
      : '<path d="M14 2H6v20h12V6z"/><path d="M14 2v6h6"/>', 14));
    const details = q<HTMLDetailsElement>('details', 'ds-reference-details');
    const summary = q('summary');
    summary.setAttribute('aria-label', `${reference.path}; source: ${reference.sourceDirectory}. Show full path`);
    const label = q('span', 'ds-reference-label', referenceDisplayLabel(reference));
    label.title = `${reference.path}\nSource: ${reference.sourceDirectory}`;
    summary.append(label);
    details.append(summary, q('span', 'ds-reference-path', reference.path), q('span', 'ds-reference-source', `Source: ${reference.sourceDirectory}`));
    const remove = q<HTMLButtonElement>('button', 'ds-reference-remove');
    remove.type = 'button';
    remove.dataset.referenceId = reference.id;
    remove.setAttribute('aria-label', `Remove ${reference.path}`);
    remove.title = `Remove ${reference.path}`;
    remove.disabled = state.pageBusy;
    remove.append(svgIcon('<path d="m6 6 12 12M18 6 6 18"/>', 14));
    remove.addEventListener('click', () => removePageReference(reference.id));
    item.append(details, remove);
    list.append(item);
  }
  return list;
}

export function removePageReference(id: string): void {
  if (state.pageBusy) return;
  const index = state.references.findIndex((reference) => reference.id === id);
  if (index < 0) return;
  const removed = state.references[index]!;
  state.references = removeDraftReference(state.references, id);
  referenceFocusId = state.references[index]?.id ?? state.references[index - 1]?.id ?? null;
  if (!referenceFocusId) refocusOverlayTrigger = 'attach';
  announceReference(`Removed ${removed.path}.`);
  renderPage();
}

/** The type picker panel: DESIGN_TYPES plus Direction/Fidelity options. */
function renderTypeMenu(): HTMLElement {
  const panel = q('div', 'ds-ds-panel ds-type-panel');
  const list = q('div', 'ds-ds-list ds-type-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Design types');
  for (const type of DESIGN_TYPES) {
    const on = type === state.pageType;
    const item = q<HTMLButtonElement>('button', `ds-menu-item${on ? ' on' : ''}`);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', on ? 'true' : 'false');
    const main = q('span', 'ds-menu-main');
    main.append(q('strong', undefined, PAGE_TYPE_LABELS[type]));
    main.append(q('span', 'ds-menu-hint', TYPE_HINT[type]));
    item.append(main);
    if (on) item.append(svgIcon('<path d="M20 6L9 17l-5-5"/>', 16));
    item.addEventListener('click', () => {
      state.pageType = type;
      closeActiveOverlay('type');
    });
    list.append(item);
  }
  panel.append(list, renderOptions());
  if (state.typeMenuOpen) queueMicrotask(() => panel.querySelector<HTMLElement>('.ds-menu-item')?.focus());
  return panel;
}

function renderOptions(): HTMLElement {
  const row = q('div', 'ds-options');

  const direction = q<HTMLSelectElement>('select');
  direction.append(option('auto', 'Auto (infer from the brief)'));
  for (const id of Object.keys(DIRECTIONS) as DirectionId[]) direction.append(option(id, DIRECTIONS[id].name));
  direction.value = state.pageDirection;
  direction.addEventListener('change', () => {
    state.pageDirection = direction.value as 'auto' | DirectionId;
  });

  const fidelity = q<HTMLSelectElement>('select');
  for (const [value, label] of FIDELITY_OPTIONS) fidelity.append(option(value, label));
  fidelity.value = state.pageFidelity;
  fidelity.addEventListener('change', () => {
    state.pageFidelity = fidelity.value as Fidelity;
  });

  row.append(field('Direction', direction), field('Fidelity', fidelity));
  return row;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = q('label', 'ds-field');
  wrap.append(q('span', 'ds-field-label', label), control);
  return wrap;
}

// ---- the `+` attach control (an anchored overlay above the composer) ----

/**
 * The workspace the `+` references: its dir, the registered-project id (decision
 * 4c), name and config. With no workspace yet, the chat's own directory stands
 * in so pasted paths still validate against SOMETHING reachable.
 */
type AttachProject = { dir: string; projectId?: string; name: string; config: StudioConfig | null };

function attachProject(): AttachProject {
  const ws = state.workspace;
  const dir = ws?.dir ?? state.directory ?? '';
  const config = ws ? (state.configDir === ws.dir ? state.config : null) : state.config;
  const name = ws?.name || (dir ? fileBaseName(dir) : 'Canvas');
  const projectId = allProjects.find((project) => dir !== '' && (sameDirPath(project.directory, dir) || pathContains(project.directory, dir)))?.id;
  return { dir, projectId, name, config };
}

/**
 * Attach a workspace reference to the composer. A no-url workspace refuses with
 * the actionable line rather than sending a chip the host would reject.
 */
export async function attachProjectReference(): Promise<void> {
  const project = attachProject();
  if (state.surface === 'page') {
    if (state.pageBusy || referencePending) return;
    if (!project.dir) {
      referenceError = 'No canvas workspace yet — start one with /canvas, then add references.';
      renderPage();
      annotateReferenceFeedback();
      return;
    }
    stagePageReference({ id: `project:${project.dir}`, kind: 'project', path: project.dir, sourceDirectory: project.dir, label: project.name });
    closeActiveOverlay('attach');
    return;
  }
  const url = projectHttpUrl(project.config);
  if (!url) {
    await host.toast({ kind: 'error', message: ATTACH_NEEDS_URL });
    return;
  }
  try {
    const chip = projectReferenceChip({ projectId: project.projectId, dir: project.dir, name: project.name, url });
    await host.attach(chip);
    await host.toast({ kind: 'success', message: 'Workspace reference added to the composer.' });
  } catch (error) {
    await host.toast({ kind: 'error', message: `Could not attach: ${error instanceof Error ? error.message : String(error)}` });
  }
}

/** Announce the reference error through the live region, if it is mounted. */
function annotateReferenceFeedback(): void {
  announceReference(referenceError);
}

/**
 * Attach a FILE reference from a pasted path: referenced (never uploaded) under
 * the workspace's url. A no-url project refuses the same way.
 */
export async function attachProjectPath(path: string): Promise<void> {
  const project = attachProject();
  if (state.surface === 'page') {
    if (state.pageBusy || referencePending) return;
    attachPathDraft = path;
    referenceError = '';
    if (!project.dir) {
      referenceError = 'No canvas workspace yet — start one with /canvas, then paste the file path again.';
      renderPage();
      announceReference(referenceError);
      return;
    }
    if (!path.trim()) {
      referenceError = 'Paste a workspace-relative or full file path.';
      renderPage();
      return;
    }
    const request = ++referenceRequest;
    referencePending = true;
    referenceSlow = false;
    renderPage();
    announceReference('Checking that the file is accessible…');
    const slowTimer = setTimeout(() => {
      if (request !== referenceRequest) return;
      referenceSlow = true;
      renderPage();
      announceReference('This is taking longer than expected. Close the reference menu to cancel, then retry.');
    }, 15000);
    try {
      const resolved = await validateReferencePath(project.dir, path.trim());
      if (request !== referenceRequest || state.surface !== 'page') return;
      stagePageReference({ id: `file:${resolved.path}`, kind: 'file', path: resolved.path, sourceDirectory: resolved.sourceDirectory, label: fileBaseName(resolved.path) });
      attachPathDraft = '';
      referencePending = false;
      closeActiveOverlay('attach');
    } catch (error) {
      if (request !== referenceRequest) return;
      referenceError = `${error instanceof Error ? error.message : String(error)} Paste an accessible file path and try again.`;
      announceReference(referenceError);
    } finally {
      clearTimeout(slowTimer);
      if (request === referenceRequest) {
        referencePending = false;
        referenceSlow = false;
        renderPage();
      }
    }
    return;
  }
  const url = projectHttpUrl(project.config);
  if (!url) {
    await host.toast({ kind: 'error', message: ATTACH_NEEDS_URL });
    return;
  }
  try {
    const chip = fileReferenceChip({ path, url });
    await host.attach(chip);
    await host.toast({ kind: 'success', message: 'File reference added to the composer.' });
  } catch (error) {
    await host.toast({ kind: 'error', message: `Could not attach: ${error instanceof Error ? error.message : String(error)}` });
  }
}

// ---- dropping a file onto the page ----

/** Whether a drag carries files (the only kind the page answers). */
export function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** Nesting depth of the file drag currently over the page (dragenter/leave pair). */
let dragDepth = 0;

function onPageDragEnter(event: DragEvent): void {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  pageBody?.classList.add('ds-drop');
}

function onPageDragOver(event: DragEvent): void {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function onPageDragLeave(event: DragEvent): void {
  if (!dragHasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) pageBody?.classList.remove('ds-drop');
}

function onPageDrop(event: DragEvent): void {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  pageBody?.classList.remove('ds-drop');
  void attachDroppedFiles(event);
}

/** A browser drop cannot provide a filesystem path. Ask, never guess or upload. */
export async function attachDroppedFiles(event: DragEvent): Promise<void> {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;
  announceReference(DROP_PATH_MESSAGE);
  await host.toast({ kind: 'info', message: DROP_PATH_MESSAGE });
}

// ---- references ----

function stagePageReference(reference: DraftReference): void {
  const duplicate = state.references.some((existing) => existing.kind === reference.kind && existing.path === reference.path);
  state.references = addDraftReference(state.references, reference);
  referenceError = '';
  announceReference(duplicate ? `Already added: ${reference.path}.` : `Added ${reference.path}.`);
}

/** One source row of the attach overlay: a real button. */
function attachOption(title: string, hint: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const item = q<HTMLButtonElement>('button', 'ds-menu-item');
  item.disabled = disabled;
  const main = q('span', 'ds-menu-main');
  main.append(q('strong', undefined, title));
  main.append(q('span', 'ds-menu-hint', hint));
  item.append(main);
  if (!disabled) item.addEventListener('click', onClick);
  return item;
}

/** The `+` overlay: a workspace reference and explicit pasted paths only. */
function renderAttachPanel(): HTMLElement {
  const panel = q('div', 'ds-ds-panel ds-attach-panel');
  const project = attachProject();
  const usable = project.dir !== '';

  const list = q('div', 'ds-ds-list ds-attach-list');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Add a reference');
  const projectHint = usable ? (project.dir || project.name) : 'No canvas workspace yet — /canvas creates one.';
  list.append(
    attachOption('Reference the workspace', projectHint, !usable || referencePending || state.pageBusy, () => {
      void attachProjectReference();
    }),
  );
  panel.append(list);

  // Never close or erase a path until validation succeeds.
  if (usable) {
    const form = q('form', 'ds-attach-paste');
    form.dataset.state = referencePending ? 'submitted-pending' : attachPathDraft ? 'dirty' : 'untouched';
    form.setAttribute('aria-busy', String(referencePending));
    const label = q('label', 'ds-attach-paste-field');
    label.append(q('span', 'ds-attach-paste-label', 'File path'));
    const input = q<HTMLInputElement>('input', 'ds-attach-paste-input');
    input.type = 'text';
    input.name = 'path';
    input.placeholder = 'src/styles.css';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.required = true;
    input.value = attachPathDraft;
    input.readOnly = referencePending;
    input.disabled = state.pageBusy;
    input.setAttribute('aria-describedby', 'ds-reference-feedback');
    input.setAttribute('aria-invalid', String(Boolean(referenceError)));
    label.append(input);
    const add = q<HTMLButtonElement>('button', 'ds-attach-paste-add', 'Add');
    add.type = 'submit';
    add.disabled = referencePending || state.pageBusy || !attachPathDraft.trim();
    add.textContent = referencePending ? 'Checking…' : 'Add';
    form.append(label, add);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const path = input.value.trim();
      if (!path) return;
      void attachProjectPath(path);
    });
    input.addEventListener('input', () => {
      attachPathDraft = input.value;
      form.dataset.state = input.value ? 'dirty' : 'untouched';
      add.disabled = referencePending || state.pageBusy || !input.value.trim();
    });
    input.addEventListener('blur', () => {
      if (!input.value.trim() && input.value.length > 0) {
        referenceError = 'Paste a workspace-relative or full file path.';
        input.setAttribute('aria-invalid', 'true');
        feedback.textContent = referenceError;
        feedback.classList.add('error');
      }
    });
    panel.append(form);
    const feedback = q('div', `ds-attach-note${referenceError ? ' error' : ''}`, referencePending
      ? referenceSlow ? 'Still checking. Close this menu to cancel, then retry.' : 'Checking that the file is accessible…'
      : referenceError || 'Paste a workspace-relative or full path. Files are referenced, never uploaded.');
    feedback.id = 'ds-reference-feedback';
    feedback.setAttribute('role', 'status');
    if (referencePending) {
      const spinner = svgIcon('<path d="M20 12a8 8 0 1 1-8-8"/>', 14);
      spinner.classList.add('ds-reference-spinner');
      feedback.prepend(spinner);
    }
    panel.append(feedback);
    if (state.attachMenuOpen) queueMicrotask(() => input.focus());
  } else {
    panel.append(q('div', 'ds-attach-note', projectHint));
  }
  return panel;
}

// ---- the design-system picker (an anchored overlay above the composer) ----

function designSystemIcon(): SVGElement {
  return svgIcon(
    '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    15,
  );
}

/** Commit a design-system choice (or clear it) and close the panel. */
function applyDesignSystem(id: string | null): void {
  state.pageDesignSystemId = findDesignSystem(id)?.id ?? null;
  closeActiveOverlay('ds');
}

/** The detail pane for the highlighted entry. */
function renderDesignSystemDetail(detail: HTMLElement, id: string | null): void {
  detail.replaceChildren();
  const preset = findDesignSystem(id);
  if (!preset) {
    detail.append(q('div', 'ds-ds-detail-name', NO_DESIGN_SYSTEM));
    detail.append(q('p', 'ds-ds-detail-desc', 'Start from scratch — no preset. The design system comes out of the brief.'));
    return;
  }
  detail.append(q('div', 'ds-ds-detail-name', preset.name));
  detail.append(q('div', 'ds-ds-detail-cat', preset.category));
  detail.append(q('p', 'ds-ds-detail-desc', preset.description));
  const swatches = designSystemSwatches(preset);
  if (swatches.length > 0) {
    const strip = q('div', 'ds-ds-swatches');
    for (const token of swatches) {
      const swatch = q('span', 'ds-ds-swatch');
      swatch.style.background = token.value;
      swatch.title = `${token.name} ${token.value}`;
      swatch.setAttribute('aria-label', `${token.name} ${token.value}`);
      strip.append(swatch);
    }
    detail.append(strip);
  }
}

function renderDesignSystemPanel(): HTMLElement {
  const panel = q('div', 'ds-ds-panel');

  const toolbar = q('div', 'ds-ds-toolbar');
  const search = q<HTMLInputElement>('input', 'ds-ds-search');
  search.type = 'search';
  search.placeholder = 'Search design systems';
  search.setAttribute('aria-label', 'Search design systems');
  search.value = dsQuery;
  const create = q<HTMLButtonElement>('button', 'ds-ds-create', '+ Create');
  create.title = 'Custom design systems are not available yet';
  create.setAttribute('aria-label', 'Create a design system');
  create.disabled = true;
  toolbar.append(search, create);

  const body = q('div', 'ds-ds-body');
  const list = q('div', 'ds-ds-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Design systems');
  const detail = q('div', 'ds-ds-detail');
  body.append(list, detail);

  const actions = q('div', 'ds-ds-foot');
  const clear = q<HTMLButtonElement>('button', 'ds-ds-clear', 'Clear');
  clear.addEventListener('click', () => applyDesignSystem(null));
  actions.append(clear);

  panel.append(toolbar, body, actions);

  const itemRefs: Array<{ id: string | null; el: HTMLButtonElement }> = [];

  const setHighlight = (id: string | null): void => {
    if (dsHighlight === id) return;
    dsHighlight = id;
    for (const ref of itemRefs) {
      const on = ref.id === dsHighlight;
      ref.el.classList.toggle('on', on);
      ref.el.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    renderDesignSystemDetail(detail, dsHighlight);
  };

  const buildList = (): void => {
    itemRefs.length = 0;
    list.replaceChildren();
    const add = (preset: DesignSystemPreset | null): void => {
      const id = preset?.id ?? null;
      const on = dsHighlight === id;
      const item = q<HTMLButtonElement>('button', `ds-ds-item${on ? ' on' : ''}`);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', on ? 'true' : 'false');
      const main = q('div', 'ds-ds-item-main');
      main.append(q('span', 'ds-ds-item-name', preset ? preset.name : NO_DESIGN_SYSTEM));
      if (preset) main.append(q('span', 'ds-ds-item-cat', preset.category));
      item.append(main);
      const check = q('span', 'ds-ds-check');
      check.append(svgIcon('<path d="M20 6L9 17l-5-5"/>', 16));
      item.append(check);
      item.addEventListener('click', () => applyDesignSystem(id));
      item.addEventListener('mouseenter', () => setHighlight(id));
      item.addEventListener('focus', () => setHighlight(id));
      itemRefs.push({ id, el: item });
      list.append(item);
    };
    add(null);
    const shown = filterDesignSystems(dsQuery);
    for (const group of designSystemGroups(shown)) {
      list.append(q('div', 'ds-ds-group', group.category));
      for (const preset of group.presets) add(preset);
    }
    if (shown.length === 0) list.append(q('div', 'ds-ds-empty', 'No design systems match your search.'));
  };

  buildList();
  renderDesignSystemDetail(detail, dsHighlight);

  search.addEventListener('input', () => {
    dsQuery = search.value;
    if (dsHighlight !== null && !filterDesignSystems(dsQuery).some((preset) => preset.id === dsHighlight)) {
      dsHighlight = null;
    }
    buildList();
    renderDesignSystemDetail(detail, dsHighlight);
  });

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target !== create) {
      event.preventDefault();
      applyDesignSystem(dsHighlight);
    }
  });

  queueMicrotask(() => search.focus());

  return panel;
}

/** The one-line workspace context under the composer (no registered-project gate). */
function renderWorkspaceRow(): HTMLElement {
  const row = q('div', 'ds-dir');
  const label = q('span', 'ds-dir-label', 'Canvas workspace');
  const ws = state.workspace;
  const value = q('span', 'ds-dir-value', ws
    ? (ws.name.length > 38 ? `${ws.name.slice(0, 38)}…` : ws.name)
    : 'Created on send — no project registration needed.');
  value.title = ws ? ws.dir : NO_WORKSPACE_MESSAGE;
  row.append(label, value);
  return row;
}

function renderIdeas(): HTMLElement {
  const wrap = q('div', 'ds-ideas');
  wrap.append(q('div', 'ds-ideas-label', 'Ideas'));
  const list = q('div', 'ds-idea-list');
  IDEAS[state.pageType].forEach((idea, index) => {
    const card = q<HTMLButtonElement>('button', 'ds-idea');
    card.disabled = state.pageBusy;
    card.append(ideaThumb(index % 4));
    const body = q('div', 'ds-idea-body');
    body.append(q('strong', 'ds-idea-title', idea.title));
    body.append(q('span', 'ds-idea-desc', idea.description));
    card.append(body);
    card.addEventListener('click', () => {
      if (state.pageBusy) return;
      state.prompt = idea.prompt;
      if (promptEl) promptEl.value = idea.prompt;
      updateComposerState();
      promptEl?.focus();
    });
    list.append(card);
  });
  wrap.append(list);
  return wrap;
}

/** The calm closing line under everything. */
function renderFooter(): HTMLElement {
  const footer = q('footer', 'ds-footer');
  footer.append(q('span', 'ds-footer-name', 'Design Canvas'));
  footer.append(q('span', 'ds-footer-hint', 'Add references by clicking an element in the live canvas — edit mode turns every click into a chip.'));
  return footer;
}

// ONE list: the workspaces on disk (`GET /workspaces`, decision 2), each row
// joined to its session via the cached ws/ scan when one exists.

const WORKSPACE_ROW_ICON = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>';

/** The small leading type icon on a row (decorative; the button carries the label). */
function rowIcon(paths: string): HTMLElement {
  const span = q('span', 'ds-list-icon');
  span.setAttribute('aria-hidden', 'true');
  span.append(svgIcon(paths, 15));
  return span;
}

/** The loading/error/empty note for a list, with a Retry that reloads the page's lists. */
function listNote(message: string, kind: 'info' | 'error' = 'info'): HTMLElement {
  const note = q('div', `ds-list-note${kind === 'error' ? ' error' : ''}`);
  note.append(q('span', undefined, message));
  if (kind === 'error') {
    const retry = q<HTMLButtonElement>('button', 'ds-list-retry', 'Retry');
    retry.addEventListener('click', () => void loadDesignHome());
    note.append(retry);
  }
  return note;
}

/** The workspaces list below the composer: one heading, one list. */
function renderCanvasSection(): HTMLElement {
  const section = q('section', 'ds-section');
  const head = q('div', 'ds-section-head');
  head.append(q('div', 'ds-section-label', 'Your design work'));
  section.append(head);
  const list = q('div', 'ds-list');
  const view = state.workspaces ?? { kind: 'loading' };
  if (view.kind === 'loading') {
    list.append(listNote('Loading…'));
  } else if (view.kind === 'error') {
    list.append(listNote(view.message, 'error'));
  } else if (view.kind === 'empty') {
    list.append(listNote(NO_DESIGN_WORK_MESSAGE));
  } else {
    for (const row of view.rows) {
      list.append(renderWorkspaceListRow(row));
    }
  }
  section.append(list);
  return section;
}

/**
 * A workspace row: a leading canvas icon, the name, its readiness badge and
 * meta, then the row's own action. The row NEVER hides (decision 2/3): an
 * unmapped workspace opens via a NEW session titled with the workspace name
 * (carrying the open prompt); a mapped one reuses its session via
 * `host.openSession`.
 */
function renderWorkspaceListRow(row: WorkspaceWorkRow): HTMLElement {
  const ready = Boolean(row.url?.trim());
  const item = q('div', 'ds-list-row');
  const open = q<HTMLButtonElement>('button', 'ds-list-open');
  open.setAttribute('aria-label', row.sessionId ? `Open the canvas chat ${row.name}` : `Open ${row.name} (starts its design chat)`);
  open.append(rowIcon(WORKSPACE_ROW_ICON));
  const main = q('div', 'ds-list-main');
  const titleLine = q('div', 'ds-list-title');
  titleLine.append(q('span', 'ds-list-name', row.name || fileBaseName(row.dir)));
  titleLine.append(q('span', `ds-badge${ready ? ' ready' : ''}`, ready ? DESIGN_READY_BADGE : NO_CONFIG_BADGE));
  main.append(titleLine);
  main.append(q('div', 'ds-list-meta', workspaceMeta(row)));
  open.append(main);
  open.append(q('span', 'ds-list-go', row.sessionId ? 'Open' : 'Open chat'));
  open.addEventListener('click', () => void openWorkspaceListRow(row));
  item.append(open);
  // Preview is offered only for a workspace with a url — it can do what it says.
  if (ready) {
    const preview = q<HTMLButtonElement>('button', 'ds-list-preview', 'Preview');
    preview.title = `Open the ${row.name} preview`;
    preview.setAttribute('aria-label', `Open the ${row.name} preview`);
    preview.addEventListener('click', () => void previewWorkspace(row));
    item.append(preview);
  }
  return item;
}

/**
 * A workspace row's action. When the ws/ scan mapped the workspace to a session,
 * reuse it; otherwise start a NEW session titled with the workspace name and
 * carrying the workspace-open prompt (decision 3 + §F).
 */
async function openWorkspaceListRow(row: WorkspaceWorkRow): Promise<void> {
  if (row.sessionId) {
    try {
      await host.openSession(row.sessionId);
    } catch (error) {
      await host.toast({ kind: 'error', message: `Could not open the canvas chat: ${error instanceof Error ? error.message : String(error)}` });
    }
    return;
  }
  const name = row.name || fileBaseName(row.dir);
  const record: WorkspaceRecord = { dir: row.dir, name };
  let result: Awaited<ReturnType<typeof host.startSession>>;
  try {
    result = await host.startSession({
      providerId: 'design-canvas',
      id: `workspace:${fileBaseName(row.dir)}`,
      title: name,
      url: attachUrl(row.url),
      text: workspaceOpenPrompt(record),
      navigation: 'preserve',
      data: seedSessionData('hi-fi', '', record),
    });
  } catch (error) {
    await host.toast({ kind: 'error', message: `Could not start the canvas chat: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  if (!result.sessionId || result.sent !== 'sent') {
    const failure = 'failure' in result ? result.failure : undefined;
    await host.toast({ kind: 'error', message: `The canvas chat could not be started (${result.sent}${failure ? `: ${failure}` : ''}).` });
    return;
  }
  try {
    await host.storage.set(workspaceStorageKey(result.sessionId)!, record);
  } catch {
    /* the session still opens; the map joins on the next refresh */
  }
  try {
    await host.openSession(result.sessionId);
  } catch (error) {
    await host.toast({ kind: 'error', message: `The canvas chat could not open. Open it from Your design work. ${error instanceof Error ? error.message : String(error)}` });
  }
}

// ---- live window state ----

/** Update the status row's live indicators. */
function renderWindowStatus(): void {
  if (hintEl) {
    hintEl.textContent = PICK_HINT;
    hintEl.classList.toggle('active', pickHintActive(state));
    hintEl.classList.toggle('idle', !pickHintActive(state));
  }
  renderSessionStatus();
  renderCanvasControls();
}

/**
 * The compact session line below the toggle row: this session's workspace and
 * its Design Mode state.
 */
function renderSessionStatus(): void {
  if (!sessionLineEl) return;
  const ws = state.workspace;
  if (!ws) {
    // F2: the visible hint for a draft chat — Start cannot work until it exists.
    sessionLineEl.textContent = state.sessionId ? NO_WORKSPACE_MESSAGE : `${NO_SESSION_HINT}, then press Start.`;
    sessionLineEl.classList.add('off');
    return;
  }
  sessionLineEl.textContent = canvasSessionStatus({
    modeOn: state.mode.on,
    workspaceDir: ws.dir,
    wsReady: projectReady(currentConfig()),
  });
  sessionLineEl.classList.toggle('off', !state.mode.on);
}

/**
 * The play/edit toggle, the active-screen dropdown and Focus — all sourced from
 * `GET /state` (spec §F). They appear only when the workspace is ready and the
 * canvas reports screens.
 */
function renderCanvasControls(): void {
  const ready = Boolean(state.workspace && projectReady(currentConfig()));
  const hasScreens = state.liveScreens.length > 0;
  if (playToggleBtn) {
    playToggleBtn.hidden = !ready || !hasScreens;
    if (!playToggleBtn.hidden) {
      const mode = state.liveMode;
      playToggleBtn.textContent = mode === 'play' ? 'Play' : 'Edit';
      playToggleBtn.title = mode === 'play'
        ? 'Canvas is in play mode — click to switch to edit'
        : 'Canvas is in edit mode — click to switch to play';
      playToggleBtn.classList.toggle('on', mode === 'play');
    }
  }
  if (screenSelectEl) {
    screenSelectEl.hidden = !ready || !hasScreens;
    if (!screenSelectEl.hidden) {
      screenSelectEl.replaceChildren();
      for (const screen of state.liveScreens) {
        screenSelectEl.append(option(screen.id, screen.title || screen.id));
      }
      screenSelectEl.value = state.activeScreen ?? state.liveScreens[0]?.id ?? '';
      screenSelectEl.title = 'Active screen';
      screenSelectEl.setAttribute('aria-label', 'Active screen');
    }
  }
  if (focusLiveBtn) {
    focusLiveBtn.hidden = !(state.mode.on && state.windowOpen);
  }
}

/** The play/edit toggle click: `POST /mode` (spec §B), in-memory echo drives the row. */
async function onPlayToggleClick(): Promise<void> {
  const next = state.liveMode === 'play' ? 'edit' : 'play';
  try {
    const result = await setMode(next);
    if (result.ok === false && result.error) {
      setStatus(result.error, 'error');
    } else {
      state.liveMode = next;
      state.mode.canvMode = next;
      await saveMode();
    }
  } catch (error) {
    setStatus(`Could not switch the canvas mode: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
  renderCanvasControls();
}

/**
 * The active-screen dropdown: `POST /open {dir, screen}` — warm activation, no
 * restart — and V4-8's `focus:false`: switching the screen must never raise
 * the canvas over the chat.
 */
async function onScreenSelectChange(): Promise<void> {
  const id = screenSelectEl?.value;
  const ws = state.workspace;
  if (!id || !ws) return;
  try {
    await openWorkspace({ dir: ws.dir, screen: id, focus: false });
    state.activeScreen = id;
  } catch (error) {
    setStatus(`Could not switch screens: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
  renderCanvasControls();
}

/** The Focus action: raise the live canvas window (POST /focus). */
async function onFocusClick(): Promise<void> {
  try {
    await focusLive();
  } catch {
    /* the window may be closing; the poll corrects the row */
  }
}

/**
 * Show the interactive canvas row whenever a workspace exists; the row NEVER
 * falls back to "not set up" — absent workspace, the Start control reads
 * "Create canvas" (spec §F). Re-run on every poll read so a config that appears
 * (or is deleted) mid-session flips the row live.
 */
function renderRow(): void {
  if (barEl) barEl.classList.toggle('hidden', false);
  if (hintEl) hintEl.classList.toggle('hidden', !projectReady(currentConfig()));
  // A readiness flip that hides the hint must not drop focus to `body`.
  if (!projectReady(currentConfig()) && focusInside(hintEl)) focusSessionLine();
  renderServerControl();
  renderWindowStatus();
}

export async function applyState(stateData: LiveState): Promise<void> {
  state.url = stateData.url;
  state.title = stateData.title;
  state.windowOpen = stateData.windowOpen;
  if (stateData.mode === 'edit' || stateData.mode === 'play') state.liveMode = stateData.mode;
  if (stateData.screens !== undefined) state.liveScreens = stateData.screens.map((screen) => ({ ...screen }));
  state.activeScreen = stateData.activeScreen ?? null;
  // V4-4: a broken screen registry is LOUD exactly once per distinct message —
  // the shell carries the banner, the chat gets a toast, and repeated poll
  // reads of the SAME error never re-toast. Clearing (null) re-arms it, so a
  // fixed-then-rebroken screens.json speaks up again.
  const registry = shouldToastRegistryError(state.registryErrorNotified, stateData.registryError ?? null);
  state.registryErrorNotified = registry.key;
  if (registry.toast) {
    await host.toast({ kind: 'error', message: registryErrorToastMessage(stateData.registryError as string) });
  }
  // Picks are NOT read here anymore (V4-5): they arrive through `GET /picks`
  // in `runPickLoop`; `/state` keeps serving window/mode/screens/registryError.
  renderWindowStatus();
  // The user closed the live window by hand: that IS Design Mode going off. Flip
  // the mode (persist it) and reflect it in the widget — never auto-reopen. The
  // `pendingOpen` guard keeps our own opening window from being read as a close.
  if (!state.windowOpen && state.mode.on && !state.pendingOpen) {
    await turnModeOffByWindowClose();
  }
}

/** The user closed the live window. Mirror that into Design Mode: OFF. */
async function turnModeOffByWindowClose(): Promise<void> {
  if (!state.mode.on) return;
  state.mode.on = false;
  state.pendingOpen = false;
  await saveMode();
  renderModeUi();
  try {
    await requestDevServerStop();
  } catch {
    /* a stop failure is surfaced by its own toast */
  }
}

async function poll(): Promise<void> {
  // F3: adopt what another frame wrote (`ws/`, `mode/`) and claim a pending
  // `/canvas` open BEFORE anything else — and before the visibility guard: a
  // collapsed sidebar must not strand a `/canvas` the user just ran.
  try {
    await syncRowFromStorage();
  } catch {
    /* storage is a convenience; the tick still reads /state */
  }
  if (document.visibilityState !== 'visible') return;
  // Re-detect `.design-studio.json` on every tick so the agent scaffolding one
  // mid-session flips the row to ready without a reload. Silent (mount reports
  // errors) and in-flight-guarded.
  void readStudioConfig(false);
  try {
    await applyState(await getState());
  } catch (error) {
    setStatus(error instanceof ServiceUnavailable ? `Local service not ready: ${error.message}` : `Live canvas error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
  // Keep the server Start/Stop icon honest without blocking the next poll tick.
  void refreshServerStatus();
}

// ---- in-chat widget (status surface) ----

/** Cheap text update, safe to call from the poll loop. */
function renderModeUi(): void {
  if (modeToggleBtn) {
    modeToggleBtn.textContent = state.mode.on ? 'Design Mode: ON' : 'Design Mode: OFF';
    modeToggleBtn.title = state.mode.on ? 'Design Mode is on — click to turn it off' : 'Design Mode is off — click to turn it on';
    modeToggleBtn.classList.toggle('on', state.mode.on);
  }
  renderSessionStatus();
  renderRailControls();
}

/** What kind of surface a host surface name maps to. Pure. */
export type SurfaceKind = 'row' | 'rail' | 'page' | 'none';

export function surfaceKind(surface: string): SurfaceKind {
  if (surface === 'status') return 'row';
  if (surface === 'panel') return 'rail';
  if (surface === 'page') return 'page';
  return 'none';
}

/** Report a frame height to the host, but only for the chat Work Status section. */
function setSurfaceHeight(height: number): void {
  if (state.surface !== 'status') return;
  void host.setHeight(height).catch(() => {});
}

/** The row content height already reported to the host. */
let reportedStatusHeight = 0;
/** The ResizeObserver watching the row's content height; a rebuild supersedes it. */
let statusHeightObserver: ResizeObserver | null = null;
let statusHeightGeneration = 0;

/** Measure only the content border box plus external vertical margins. */
function reportContentHeight(content: HTMLElement, generation: number): void {
  if (content !== statusRoot || generation !== statusHeightGeneration || state.surface !== 'status') return;
  const verticalMargins = (element: HTMLElement): number => {
    const style = window.getComputedStyle(element);
    return (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
  };
  const height = Math.ceil(content.getBoundingClientRect().height + verticalMargins(content) + verticalMargins(document.body));
  if (height <= 0 || Math.abs(height - reportedStatusHeight) <= 1) return;
  reportedStatusHeight = height;
  setSurfaceHeight(height);
}

/** Start watching the row's content height; disconnect any superseded observer first. */
function observeRowHeight(): void {
  statusHeightObserver?.disconnect();
  statusHeightObserver = null;
  const generation = ++statusHeightGeneration;
  reportedStatusHeight = 0;
  const content = statusRoot;
  if (!content || state.surface !== 'status') return;
  if (typeof ResizeObserver === 'undefined') { reportContentHeight(content, generation); return; }
  statusHeightObserver = new ResizeObserver(() => reportContentHeight(content, generation));
  statusHeightObserver.observe(content);
  reportContentHeight(content, generation);
}

/**
 * The compact chat Work Status row: Start/Stop, Design Mode, the play/edit
 * toggle, the active-screen dropdown and Focus, plus the click-to-pick hint and the
 * one-line session status below. Building it never opens a window.
 */
export function buildRow(root: HTMLElement): void {
  statusRoot = q('div', 'ds-statusmode');
  const bar = q('div', 'ds-rowline');
  // Preview-dev-server Start/Stop control — "Create canvas" before first use.
  serverBtn = q<HTMLButtonElement>('button', 'ds-server-control');
  serverBtn.addEventListener('click', () => void onServerControlClick());
  serverBtn.hidden = true;
  modeToggleBtn = q<HTMLButtonElement>('button', 'primary');
  // A plain ON/OFF toggle: turning it ON opens the live canvas (or focuses it
  // when already open); OFF closes the window (see toggleMode).
  modeToggleBtn.addEventListener('click', () => {
    void toggleMode(!state.mode.on);
  });
  // The play/edit toggle, sourced from /state (spec §F). The row controls
  // (ds-play-toggle / ds-screen-select / ds-focus) are styled in
  // panel/styles.css — same 30px rhythm as the Start/Stop icon button.
  playToggleBtn = q<HTMLButtonElement>('button', 'ds-chip ds-play-toggle');
  playToggleBtn.hidden = true;
  playToggleBtn.addEventListener('click', () => void onPlayToggleClick());
  screenSelectEl = q<HTMLSelectElement>('select', 'ds-screen-select');
  screenSelectEl.hidden = true;
  screenSelectEl.addEventListener('change', () => void onScreenSelectChange());
  focusLiveBtn = q<HTMLButtonElement>('button', 'ds-chip ds-focus');
  focusLiveBtn.textContent = 'Focus';
  focusLiveBtn.title = 'Raise the live canvas window';
  focusLiveBtn.hidden = true;
  focusLiveBtn.addEventListener('click', () => void onFocusClick());
  bar.append(serverBtn, modeToggleBtn, playToggleBtn, screenSelectEl, focusLiveBtn);
  barEl = bar;
  sessionLineEl = q('div', 'ds-sessionline');
  hintEl = q('span', 'ds-hintline');
  serverAnnounceEl = q('div', 'ds-server-announce');
  serverAnnounceEl.setAttribute('aria-live', 'polite');
  serverAnnounceEl.setAttribute('aria-atomic', 'true');
  statusRoot.append(bar, sessionLineEl, hintEl, serverAnnounceEl);
  root.append(statusRoot);
  renderRow();
  // The host sizes this frame from the row's MEASURED content height.
  observeRowHeight();
}

/**
 * The full-screen sidebar page (surface "page"): the Design Canvas creation
 * home. The hero, the composer, the workspace row and the idea cards all live
 * under one `renderPage`. Building it never opens a live window; only Send (or
 * Enter) does, through `startNewDesign`.
 */
function buildPage(root: HTMLElement): void {
  const wrap = q('div', 'ds ds-page');
  pageBody = q('div', 'ds-page-body');
  referenceLiveEl = q('div', 'ds-reference-announcement');
  referenceLiveEl.setAttribute('role', 'status');
  referenceLiveEl.setAttribute('aria-live', 'polite');
  referenceLiveEl.setAttribute('aria-atomic', 'true');
  wrap.append(pageBody, referenceLiveEl);
  root.append(wrap);
  window.addEventListener('click', onPageWindowClick);
  window.addEventListener('keydown', onPageKeydown);
  wrap.addEventListener('dragenter', onPageDragEnter);
  wrap.addEventListener('dragover', onPageDragOver);
  wrap.addEventListener('dragleave', onPageDragLeave);
  wrap.addEventListener('drop', onPageDrop);
  window.addEventListener('dragover', onPageWindowDragOver);
  window.addEventListener('drop', onPageWindowDrop);
  renderPage();
  void loadDesignHome();
}

/** A file drag over anything keeps the browser from navigating on a stray drop. */
function onPageWindowDragOver(event: DragEvent): void {
  if (dragHasFiles(event)) event.preventDefault();
}

function onPageWindowDrop(event: DragEvent): void {
  if (dragHasFiles(event)) {
    event.preventDefault();
    dragDepth = 0;
    pageBody?.classList.remove('ds-drop');
  }
}

function build(root: HTMLElement): void {
  const kind = surfaceKind(state.surface);
  if (kind === 'row') {
    buildRow(root);
    return;
  }
  if (kind === 'rail') {
    buildRail(root);
    return;
  }
  if (kind === 'page') {
    buildPage(root);
  }
}

// ---- the rail tab (surface "panel") ----
//
// One calm column for the chat the rail is showing: its canvas status, one
// Open/Create canvas button, a short brief box that starts a NEW design chat
// (the page's `startNewDesign`, minus the hero, ideas and references), and
// "Your design work". The rail is a second frame next to the chat's status
// row, so it never mirrors the window into Design Mode and never turns the
// mode ON by itself opening Chrome: the row would read "ON, no window" during
// the open and flip it straight back OFF. It hands the open to the row
// through the same `canvas-open/<sessionId>` record `/canvas` uses, and only
// claims that record itself when no row took it (the chat is not on screen).
//
// The same build also runs in the hidden 1×1 resolve pane: there it renders
// the static shell and nothing else — no list, no interval, no service call.

/** The rail's light refresh cadence (reads only: `ws/`, `mode/`, `/state`). */
const RAIL_POLL_MS = 2000;
/**
 * How long a rail-written handoff waits for a row to claim it before the rail
 * claims it itself. A mounted row polls every `POLL_MS` (even hidden), so this
 * is several of its ticks; past it, no row is going to open the canvas.
 */
const RAIL_CLAIM_DELAY_MS = 4000;
let railClaimDelayMs = RAIL_CLAIM_DELAY_MS;
const RAIL_FOOTER_HINT = 'Full home: Design Canvas in the sidebar.';

let railStatusEl: HTMLElement | null = null;
let railPrimaryBtn: HTMLButtonElement | null = null;
let railPrimaryHintEl: HTMLElement | null = null;
let railPromptEl: HTMLTextAreaElement | null = null;
let railStartBtn: HTMLButtonElement | null = null;
let railErrorEl: HTMLElement | null = null;
let railWorkEl: HTMLElement | null = null;
/** True while the primary button's flow runs (swallows double clicks). */
let railBusy = false;
/** The refresh interval is running (started once, and only in a real pane). */
let railLive = false;
/** "Your design work" has been asked for at least once (real pane only). */
let railWorkLoaded = false;

/** The static rail shell. Building it never opens a window or calls the service. */
export function buildRail(root: HTMLElement): void {
  const wrap = q('div', 'ds ds-rail');
  railStatusEl = q('div', 'ds-rail-status');
  railStatusEl.setAttribute('role', 'status');
  railPrimaryBtn = q<HTMLButtonElement>('button', 'primary ds-rail-primary');
  railPrimaryBtn.addEventListener('click', () => void onRailPrimaryClick());
  railPrimaryHintEl = q('div', 'ds-rail-hint');
  const brief = q('div', 'ds-rail-brief');
  railPromptEl = q<HTMLTextAreaElement>('textarea', 'ds-rail-input');
  railPromptEl.rows = 3;
  railPromptEl.placeholder = 'Describe a new design…';
  railPromptEl.setAttribute('aria-label', 'Design brief');
  railPromptEl.value = state.prompt;
  railPromptEl.addEventListener('input', () => {
    state.prompt = railPromptEl?.value ?? '';
    renderRailControls();
  });
  railPromptEl.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void onRailStartDesign();
    }
  });
  railStartBtn = q<HTMLButtonElement>('button', 'ds-rail-start', 'Start design');
  railStartBtn.title = 'Start a new design chat with this brief';
  railStartBtn.addEventListener('click', () => void onRailStartDesign());
  railErrorEl = q('div', 'ds-home-warn ds-rail-error');
  railErrorEl.setAttribute('role', 'alert');
  brief.append(railPromptEl, railStartBtn, railErrorEl);
  railWorkEl = q('div', 'ds-rail-work');
  const footer = q('div', 'ds-rail-footer', RAIL_FOOTER_HINT);
  wrap.append(railStatusEl, railPrimaryBtn, railPrimaryHintEl, brief, railWorkEl, footer);
  root.append(wrap);
  // A tab mounted while collapsed (or behind another tab) grows into a real
  // pane later; these wake it then. The hidden resolve pane never resizes.
  window.addEventListener('resize', onRailWake);
  window.addEventListener('focus', onRailWake);
  document.addEventListener('visibilitychange', onRailWake);
  renderRail();
}

/** The rail's one status line for this chat. */
function railStatusText(): string {
  if (!state.sessionId) return 'This chat has not started yet.';
  const ws = state.workspace;
  if (!ws) return 'No canvas for this chat yet.';
  return canvasSessionStatus({ modeOn: state.mode.on, workspaceDir: ws.dir, wsReady: projectReady(currentConfig()) });
}

/** Cheap in-place update of the rail's text and buttons (never touches the textarea's caret). */
function renderRailControls(): void {
  if (!railPrimaryBtn) return;
  if (railStatusEl) {
    railStatusEl.textContent = railStatusText();
    railStatusEl.classList.toggle('off', !state.workspace || !state.mode.on);
  }
  const working = railBusy || state.serverPending;
  railPrimaryBtn.textContent = working ? 'Working…' : state.workspace ? 'Open canvas' : 'Create canvas';
  // F2: a new-chat draft has no session to key a workspace to.
  railPrimaryBtn.disabled = working || !state.sessionId;
  railPrimaryBtn.title = !state.sessionId
    ? NO_SESSION_HINT
    : state.workspace
      ? state.windowOpen ? 'Raise the live canvas window' : 'Open the live canvas for this chat'
      : 'Create a Design Canvas workspace for this chat';
  if (railPrimaryHintEl) {
    railPrimaryHintEl.textContent = state.sessionId ? '' : NO_SESSION_HINT;
    railPrimaryHintEl.hidden = Boolean(state.sessionId);
  }
  if (railPromptEl) {
    if (railPromptEl.value !== state.prompt) railPromptEl.value = state.prompt;
    railPromptEl.disabled = state.pageBusy;
  }
  if (railStartBtn) {
    const ready = canSend();
    railStartBtn.disabled = !ready;
    railStartBtn.textContent = state.pageBusy ? 'Starting…' : 'Start design';
    railStartBtn.setAttribute('aria-busy', String(state.pageBusy));
  }
  if (railErrorEl) {
    railErrorEl.textContent = state.pageError;
    railErrorEl.hidden = state.pageError === '';
  }
}

/** "Your design work" — only in a real pane, and only once it has been asked for. */
function renderRailWork(): void {
  if (!railWorkEl) return;
  if (!isRealPane() || !railWorkLoaded) {
    railWorkEl.replaceChildren();
    return;
  }
  railWorkEl.replaceChildren(renderCanvasSection());
}

function renderRail(): void {
  renderRailControls();
  renderRailWork();
}

/**
 * The primary button. No workspace: create one (the fast half — files + `ws/`)
 * and hand install/boot/open to the row. A workspace with its window open:
 * raise it. A workspace without one: hand the open to the row.
 */
async function onRailPrimaryClick(): Promise<void> {
  if (railBusy || state.serverPending || !isRealPane()) return;
  if (!state.sessionId) {
    await host.toast({ kind: 'error', message: NO_SESSION_MESSAGE });
    return;
  }
  railBusy = true;
  renderRailControls();
  try {
    if (state.workspace) {
      if (state.windowOpen) {
        try {
          await focusLive();
        } catch (error) {
          setStatus(`Focus failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
        return;
      }
      await handRailOpenToRow({ record: state.workspace, jobId: null });
      return;
    }
    const prepared = await prepareCanvasWorkspace('', state.sessionId, modeScaffoldChoice());
    if ('error' in prepared) {
      // The scaffold paths toast their own cause; F2 is the one they do not.
      if (prepared.noSession) await host.toast({ kind: 'error', message: NO_SESSION_MESSAGE });
      return;
    }
    await handRailOpenToRow(prepared);
  } finally {
    railBusy = false;
    renderRail();
  }
}

/**
 * Turn Design Mode ON with a fresh handoff (exactly what `/canvas` leaves), so
 * the chat's row opens the window — and holds its pending-open guard while it
 * does. If no row claims it within `railClaimDelayMs`, the chat is not on
 * screen: the rail claims it itself (it is a real, long-lived pane).
 */
async function handRailOpenToRow(ws: { record: WorkspaceRecord; jobId: string | null }): Promise<void> {
  const sessionId = state.sessionId;
  await armDesignModeForRow(ws, null, undefined);
  renderRailControls();
  await sleep(railClaimDelayMs);
  if (!isRealPane() || state.sessionId !== sessionId) return;
  const claimed = await beginOpenHandoff();
  if (claimed) await claimed.task;
}

/** Start design: the page's `startNewDesign` with the rail's brief (no references). */
async function onRailStartDesign(): Promise<void> {
  if (!canSend()) return;
  await startNewDesign();
  renderRail();
}

/**
 * The rail's refresh, READ-ONLY by design: adopt `ws/` and `mode/` other
 * frames wrote and read `/state.windowOpen` for Open vs Focus. It does not
 * run `poll()`: `applyState` would mirror a closed window into Design Mode
 * OFF from a second frame and race the row's own handoff guard.
 */
async function refreshRail(): Promise<void> {
  if (!isRealPane() || document.visibilityState !== 'visible') return;
  const sessionId = state.sessionId;
  if (sessionId) {
    const record = await readStoredWorkspace(sessionId);
    if (sessionId === state.sessionId) {
      if (record && !(state.workspace && sameDirPath(state.workspace.dir, record.dir))) bindWorkspace(record);
      else if (!record && state.workspace && !railBusy) state.workspace = null; // the row unbound a missing folder (V4-15)
    }
    await syncModeFromStorage();
  }
  try {
    state.windowOpen = (await getState()).windowOpen === true;
  } catch {
    /* the service is not up yet; keep the last answer */
  }
  renderRailControls();
}

/** Ask for "Your design work" (storage scan + `GET /workspaces`). */
async function loadRailWork(): Promise<void> {
  if (!isRealPane()) return;
  railWorkLoaded = true;
  await loadDesignHome();
}

/** Start the rail's refresh — once, and only when the frame is a real pane. */
function startRailLive(): void {
  if (railLive || state.surface !== 'panel' || !isRealPane()) return;
  railLive = true;
  void refreshRail();
  void loadRailWork();
  setInterval(() => void refreshRail(), RAIL_POLL_MS);
}

/** Focus / visibility / resize: start the rail if it just became real, else refresh it. */
function onRailWake(): void {
  if (!isRealPane()) return;
  if (!railLive) {
    startRailLive();
    return;
  }
  if (document.visibilityState !== 'visible') return;
  void refreshRail();
  void loadRailWork();
}

/**
 * What a mount does after the shell is built. The row keeps its live state
 * fresh; the rail refreshes only when it is the real tab; the page does not
 * poll. In the hidden resolve pane every effect here is a storage READ.
 */
function mountSurface(root: HTMLElement): void {
  build(root);
  setStatus('Loading…');
  void loadMode();
  void loadWorkspace();
  void loadStudioConfig();
  const kind = surfaceKind(state.surface);
  if (kind === 'row') {
    void poll();
    setInterval(() => void poll(), POLL_MS);
    // V4-5: the pick-queue long-poll runs on the row surface only. It has no
    // visibility guard — picks queue and land whenever this frame can read them.
    startPickLoop();
  } else if (kind === 'rail') {
    startRailLive(); // a no-op in the 1×1 resolve pane
  }
}

async function main(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');

  // The `/canvas` resolver: valid on the panel and page surfaces (the ones that
  // carry `commands`). Registered once, before the host asks.
  host.onResolve((request) => resolveCanvasCommand(request.args));

  let started = false;
  host.onReady((context: HostReadyContext) => {
    applyHostReady(context, document.documentElement);
    state.surface = context.surface;
    state.directory = context.directory;
    state.sessionId = context.session?.id ?? null;
    state.resolveAllowed = context.surface === 'panel' || context.surface === 'page';
    if (started) return;
    started = true;
    mountSurface(root);
  });

  // The current session's live snapshot keeps `sessionBusy` fresh and re-binds
  // the workspace when the session changes.
  host.onSession((session) => {
    void applySessionSnapshot(session);
  });
  // A completed turn is the moment a pending stop is honoured.
  host.onSessionLifecycle((event) => {
    void handleSessionLifecycle(event);
  });

  host.onDirectory((directory) => {
    state.directory = directory;
    // The workspace is SESSION-bound, not directory-bound; the chat dir only
    // feeds the attach fallback and the decision 4c detection. Reset the
    // server-pending flags so a stale action never commits across a switch.
    state.serverStatus = null;
    state.serverPending = false;
    state.serverError = null;
    renderRow();
    rerender();
  });
}

/**
 * Test seam: `node --test` has no host, so a test points the panel at a chat
 * dir directly instead of replaying an `onReady` context.
 */
export function setProjectDirectory(dir: string | null): void {
  state.directory = dir;
  directoryGeneration += 1;
  state.serverStatus = null;
  state.serverPending = false;
  state.serverError = null;
}

/** Test seam: bind the session's canvas workspace, as if `ws/<id>` was read. */
export function setWorkspace(workspace: WorkspaceRecord | null): void {
  state.workspace = workspace;
  if (workspace) state.configDir = null;
}

/** Test seam: the session's currently-bound workspace record. */
export function getWorkspaceState(): WorkspaceRecord | null {
  return state.workspace;
}

/** Test seams for the unsent page draft, without installing a browser host. */
export function setSurface(surface: string): void {
  state.surface = surface;
}

export function setPrompt(prompt: string): void {
  state.prompt = prompt;
}

export function getPageDraft(): { prompt: string; references: DraftReference[]; error: string; path: string; referenceError: string; pending: boolean } {
  return { prompt: state.prompt, references: state.references.map((reference) => ({ ...reference })), error: state.pageError, path: attachPathDraft, referenceError, pending: referencePending };
}

export function resetReferenceDraft(): void {
  cancelReferenceValidation();
  state.references = [];
  attachPathDraft = '';
  referenceError = '';
}

export { renderComposer };

/** Test seam: pretend the host reported this session, so storage writes can target it. */
export function setSessionId(id: string | null): void {
  state.sessionId = id;
}

/** Test seam: the current Design Mode, so a test can assert toggle transitions. */
export function getModeState(): DesignMode {
  return { ...state.mode };
}

/** Test seam: whether the pending-open guard is held (an open or an ON transition). */
export function getPendingOpen(): boolean {
  return state.pendingOpen;
}

/** Test seam: the page's creation selections, without replaying the pickers. */
export function setPageChoice(choice: { type?: DesignType; direction?: 'auto' | DirectionId; fidelity?: Fidelity }): void {
  if (choice.type) state.pageType = choice.type;
  if (choice.direction) state.pageDirection = choice.direction;
  if (choice.fidelity) state.pageFidelity = choice.fidelity;
}

/** Test seam: allow the `/canvas` resolver without replaying an `onReady` context. */
export function allowResolve(value: boolean): void {
  state.resolveAllowed = value;
}

/** Test seam: run the New-design flow directly. */
export { startNewDesign, resolveCanvasCommand, loadProjects, loadCanvasWorkspaces };

/** Test seam: set the current session's busy flag without a host snapshot. */
export function setSessionBusy(busy: boolean): void {
  state.sessionBusy = busy;
}

/** Test seam: clear the stop bookkeeping between cases. */
export function resetStopState(): void {
  state.sessionBusy = false;
  state.pendingStop = null;
  state.startedServers.clear();
  state.serverStatus = null;
  state.serverPending = false;
  state.serverError = null;
}

/** Test seam: the current stop bookkeeping. */
export function getStopState(): {
  pendingStop: boolean;
  pendingRequest: { dir: string; manual: boolean } | null;
  sessionBusy: boolean;
  startedServers: string[];
} {
  return {
    pendingStop: state.pendingStop !== null,
    pendingRequest: state.pendingStop ? { ...state.pendingStop } : null,
    sessionBusy: state.sessionBusy,
    startedServers: [...state.startedServers],
  };
}

/** Test seam: set the cached config, as if read for the current workspace. */
export function setStudioConfig(config: StudioConfig | null): void {
  state.config = config;
  state.configDir = state.workspace?.dir ?? state.directory;
}

/** Test seam: the Start/Stop control's committed state. */
export function getServerControlState(): { status: boolean | null; pending: boolean; error: string | null } {
  return { status: state.serverStatus, pending: state.serverPending, error: state.serverError };
}

/** Test seam: the announcements `announceServer` made, in order. */
export function getServerAnnouncements(): string[] {
  return [...serverAnnouncements];
}

/** Test seam: clear the recorded announcements between cases. */
export function resetServerAnnouncements(): void {
  serverAnnouncements.length = 0;
}

/** Test seam: the poll-driven status read, without the poll loop. */
export { refreshServerStatus };

/** Test seam: the Start/Stop icon button's click handler, without a mounted row. */
export { onServerControlClick as clickServerControl };

/** Test seams: the rail's actions and refresh, without a host. */
export { onRailPrimaryClick as clickRailPrimary, onRailStartDesign as clickRailStartDesign, refreshRail };

/** Test seam: shorten how long a rail handoff waits for a row before claiming it. */
export function setRailClaimDelay(ms: number | null): void {
  railClaimDelayMs = ms ?? RAIL_CLAIM_DELAY_MS;
}

void main();