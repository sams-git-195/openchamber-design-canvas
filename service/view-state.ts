// Design Canvas view-state persistence — SPEC-V3-P2-SCOPE.md D5/D6.
//
// The shell cannot persist anything itself (D5 verdict: `--incognito` +
// mkdtemp profile + ephemeral origin + `connect-src 'none'`), so the SERVICE
// owns the user's canvas state at `<workspace>/.design-studio/view.json`:
//
//   { "version": 1,
//     "camera": { "mode": "fit"|"manual", "scale": 0.1–3, "panX": -120, "panY": -40 },
//     "positions": { "home": { "x": 0, "y": 0 }, "checkout": null },
//     "mode": "edit" | "play" }
//
// Never-positions (null) mean "back to the auto-grid". Positions are CAMERA-
// space natural px (spec §7: scale is never baked in), clamped to ±32768.
// `camera` is null while the user has never touched the camera (then /open
// restores nothing and the shell keeps its own default).
//
// Contention rule (D6, binding): artboard CONTENT = screens.json (agent writes
// via PUT /screens, full-registry), layout STATE = view.json (user/drag writes,
// per-key merge). Two writers, two files — they can never clobber each other.
// Only the service's own merge may write view.json (there is no PUT /view).
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { SCREEN_ID_PATTERN } from './screens.ts';

/** view.json lives inside the workspace's state dir (never at the root). */
export const VIEW_STATE_DIR = '.design-studio';
export const VIEW_FILENAME = 'view.json';

/** Camera extent for pan/zoom positions (D5: values clamped ±32768). */
export const POSITION_LIMIT = 32768;
/** Camera scale is stored in the shell's zoom clamp (D5: 0.1–3). */
export const CAMERA_SCALE_MIN = 0.1;
export const CAMERA_SCALE_MAX = 3;

/** The shell camera's zoom mode union: fit, manual, and fit-all (the
 *  committed canvas-controller emits all three via getCamera/restoreCamera). */
export type CameraMode = 'fit' | 'manual' | 'fit-all';

export type ViewCamera = { mode: CameraMode; scale: number; panX: number; panY: number };
export type ViewPosition = { x: number; y: number };

export type ViewState = {
  version: 1;
  /** null = never saved: /open restores nothing, the shell keeps its default. */
  camera: ViewCamera | null;
  /** screenId → artboard top-left in camera-space natural px, or null (auto-grid). */
  positions: Record<string, ViewPosition | null>;
  mode: 'edit' | 'play';
};

/** What a PATCH /view (or a shell merge) may carry. All keys optional. */
export type ViewPatch = {
  camera?: ViewCamera;
  positions?: Record<string, ViewPosition | null>;
  mode?: 'edit' | 'play';
};

/** The empty default every missing/corrupt file reads as (D5). */
export function emptyView(): ViewState {
  return { version: 1, camera: null, positions: {}, mode: 'edit' };
}

export class ViewPatchError extends Error {}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Tolerant camera sanitizer: returns the four persisted keys (mode/scale/panX/
 * panY) or null when the payload cannot become one. The committed shell
 * `restoreCamera` validates exactly this subset, so nothing else is stored.
 * Shared by the read path (silent sanitize) and the shell `camera-changed`
 * inbound command (invalid → drop, never persist).
 */
export function sanitizeCamera(raw: unknown): ViewCamera | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.mode !== 'fit' && value.mode !== 'manual' && value.mode !== 'fit-all') return null;
  if (!isFiniteNumber(value.scale)) return null;
  if (!isFiniteNumber(value.panX) || !isFiniteNumber(value.panY)) return null;
  return {
    mode: value.mode,
    scale: clamp(value.scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX),
    panX: value.panX,
    panY: value.panY,
  };
}

/** Tolerant per-screen position: finite `{x,y}` clamped ±32768, else null. */
export function sanitizePosition(raw: unknown): ViewPosition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return {
    x: clamp(value.x, -POSITION_LIMIT, POSITION_LIMIT),
    y: clamp(value.y, -POSITION_LIMIT, POSITION_LIMIT),
  };
}

/**
 * The tolerant READ path: an unrecognizable input becomes the empty default,
 * and every bad entry inside an otherwise-valid document is dropped or
 * normalized silently (the same silent-normalize philosophy as screens.ts).
 */
export function sanitizeView(raw: unknown): ViewState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyView();
  const value = raw as Record<string, unknown>;
  const out = emptyView();
  const camera = sanitizeCamera(value.camera);
  if (camera) out.camera = camera;
  if (value.mode === 'edit' || value.mode === 'play') out.mode = value.mode;
  if (value.positions && typeof value.positions === 'object' && !Array.isArray(value.positions)) {
    const positions: Record<string, ViewPosition | null> = {};
    for (const [id, rawPosition] of Object.entries(value.positions as Record<string, unknown>)) {
      if (!SCREEN_ID_PATTERN.test(id)) continue;
      positions[id] = rawPosition === null ? null : sanitizePosition(rawPosition);
    }
    out.positions = positions;
  }
  return out;
}

/**
 * Strict PATCH /view validation (route → 400 on throw). Forks from
 * sanitizeView: a VALIDATION route must refuse what the read path tolerates,
 * so an agent PATCH gets an actionable error instead of a silent drop.
 */
export function validateViewPatch(raw: unknown): ViewPatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ViewPatchError('the patch must be an object with optional camera/positions/mode keys');
  }
  const value = raw as Record<string, unknown>;
  const patch: ViewPatch = {};
  if (value.camera !== undefined) {
    if (!sanitizeCamera(value.camera)) throw new ViewPatchError('camera must be {mode:"fit"|"manual"|"fit-all", scale, panX, panY} with finite numbers');
    patch.camera = sanitizeCamera(value.camera) ?? undefined;
  }
  if (value.positions !== undefined) {
    if (!value.positions || typeof value.positions !== 'object' || Array.isArray(value.positions)) {
      throw new ViewPatchError('positions must be an object mapping screen ids to {x,y} or null');
    }
    const positions: Record<string, ViewPosition | null> = {};
    let index = 0;
    for (const [id, rawPosition] of Object.entries(value.positions as Record<string, unknown>)) {
      if (!SCREEN_ID_PATTERN.test(id)) throw new ViewPatchError(`positions[${index}] has an invalid screen id`);
      if (rawPosition !== null && !sanitizePosition(rawPosition)) {
        throw new ViewPatchError(`positions.${id} must be null or {x,y} with finite numbers`);
      }
      positions[id] = rawPosition === null ? null : sanitizePosition(rawPosition);
      index += 1;
    }
    patch.positions = positions;
  }
  if (value.mode !== undefined) {
    if (value.mode !== 'edit' && value.mode !== 'play') throw new ViewPatchError('mode must be "edit" or "play"');
    patch.mode = value.mode;
  }
  if (patch.camera === undefined && patch.positions === undefined && patch.mode === undefined) {
    throw new ViewPatchError('the patch must carry at least one of camera/positions/mode');
  }
  return patch;
}

/** Read view.json-or-default for a workspace root (D5: corrupt → empty default). */
export async function readView(dir: string): Promise<ViewState> {
  const abs = path.join(path.resolve(dir), VIEW_STATE_DIR, VIEW_FILENAME);
  try {
    return sanitizeView(JSON.parse(await fs.readFile(abs, 'utf8')) as unknown);
  } catch {
    return emptyView();
  }
}

/**
 * Read-modify-write one view.json. Serialized through a module-level promise
 * chain PER DIR (two writers to different workspaces never queue behind each
 * other; two merges to the same dir apply in call order). Writes are atomic
 * tmp+rename, so a crash mid-write leaves either the old file or the new one,
 * never a half-written document.
 *
 * A corrupt/missing file reads as the empty default, and this merge then
 * rewrites valid JSON — the silent-normalize philosophy happens to also heal.
 */
export function mergeView(dir: string, patch: ViewPatch): Promise<ViewState> {
  const root = path.resolve(dir);
  const previous = chains.get(root) ?? Promise.resolve();
  const next = previous.then(() => applyMerge(root, patch));
  // The chain swallows errors: one failed write must not poison later merges.
  chains.set(root, next.then(() => undefined, () => undefined));
  return next;
}

/**
 * Coalesced merge for wheel/pan/zoom bursts (D5: the shell debounces ≥400 ms,
 * the service coalesces on a 300 ms per-dir queue). Pending fields replace the
 * previous pending ones; the timer restarts on every call, so only the LAST
 * camera of a burst is written, at most once per 300 ms per dir.
 */
export function mergeViewCoalesced(dir: string, patch: ViewPatch): Promise<ViewState> {
  const root = path.resolve(dir);
  const entry = coalescing.get(root);
  const pending: ViewPatch = entry ? { ...entry.pending, ...patch } : { ...patch };
  const waiters = entry?.waiters ?? [];
  if (entry?.timer) clearTimeout(entry.timer);
  return new Promise<ViewState>((resolve, reject) => {
    waiters.push({ resolve, reject });
    const timer = setTimeout(() => {
      const fired = coalescing.get(root);
      if (fired?.timer === timer) coalescing.delete(root);
      mergeView(root, pending).then(
        (view) => {
          for (const waiter of waiters) waiter.resolve(view);
        },
        (error: unknown) => {
          for (const waiter of waiters) waiter.reject(error);
        },
      );
    }, COALESCE_MS);
    coalescing.set(root, { pending, timer, waiters });
  });
}

const COALESCE_MS = 300;
/** Per-dir in-memory state (module memory is the single slot, per dir). */
const chains = new Map<string, Promise<unknown>>();
const coalescing = new Map<
  string,
  { pending: ViewPatch; timer: NodeJS.Timeout | null; waiters: Array<{ resolve: (view: ViewState) => void; reject: (error: unknown) => void }> }
>();

async function applyMerge(root: string, patch: ViewPatch): Promise<ViewState> {
  const current = await readView(root);
  if (patch.camera) current.camera = patch.camera;
  if (patch.mode) current.mode = patch.mode;
  if (patch.positions) {
    for (const [id, position] of Object.entries(patch.positions)) current.positions[id] = position;
  }
  await writeView(root, current);
  return current;
}

/** Atomic write: same-dir tmp file, then rename over the target. */
async function writeView(root: string, state: ViewState): Promise<void> {
  const dir = path.join(root, VIEW_STATE_DIR);
  const abs = path.join(dir, VIEW_FILENAME);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${VIEW_FILENAME}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, abs);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}