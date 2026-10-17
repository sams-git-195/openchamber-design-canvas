// Design Canvas screen registry — spec §A.
//
// `screens.json` at the workspace root is the single source of truth for the
// artboards a canvas shows. The agent adds a screen by writing `<file>.html`
// into the workspace and adding an entry to the registry; screen URLs are
// joined from the workspace's base URL per decision 6.
//
// Reading normalizes silently (bad entries dropped, duplicate ids dedupe to
// the first occurrence, sizes clamped); a missing or unreadable file reads as
// `{ version: 1, screens: [] }`. Writing validates: an invalid registry throws
// a ScreensError the route answers with a 400 so the agent can correct itself.
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** File name of the registry at the workspace root. */
export const SCREENS_FILENAME = 'screens.json';

// Size clamps live HERE per §A: 200–8192. Not to be confused with the camera
// extent clamp (100–8192) that stays in viewer-ui.ts / the shell.
export const SCREEN_MIN_SIZE = 200;
export const SCREEN_MAX_SIZE = 8192;

/** `[a-z0-9][a-z0-9-]{0,30}` per §A. */
export const SCREEN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}$/;

/** Canvas mode union, shared by /open, /mode and the lastWorkspace echo. */
export type CanvasMode = 'edit' | 'play';

export type Screen = {
  id: string;
  /** Relative, forward-slash path to an `.html` file inside the workspace root. */
  file: string;
  title: string;
  /** Clamped to 200–8192. */
  width: number;
  height: number;
};

export type ScreensRegistry = {
  version: number;
  screens: Screen[];
};

/** The registry an invalid PUT /screens is refused with (route → 400). */
export class ScreensError extends Error {}

export function emptyRegistry(): ScreensRegistry {
  return { version: 1, screens: [] };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampSize(value: number): number {
  return Math.min(SCREEN_MAX_SIZE, Math.max(SCREEN_MIN_SIZE, Math.round(value)));
}

/**
 * Resolve a registry `file` against the workspace root. Returns the normalized
 * relative path (forward slashes, for URL joining) when the file is relative,
 * ends in `.html`, carries no `.`/`..` segments and stays inside the root;
 * null otherwise. Cross-platform: backslashes are treated as separators and
 * drive-letter or absolute paths are refused on every OS.
 */
export function resolveScreenFile(root: string, file: unknown): string | null {
  if (typeof file !== 'string') return null;
  const flat = file.replace(/\\/g, '/');
  if (flat === '' || !/\.html$/i.test(flat)) return null;
  if (flat.startsWith('/') || /^[a-zA-Z]:\//.test(flat)) return null; // absolute
  if (/(^|\/)\.\.?(\/|$)/.test(flat)) return null; // "." or ".." segment
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, flat);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null; // escaped
  return path.relative(rootAbs, abs).split(path.sep).join('/');
}

/** Normalize one entry; null when it cannot become a valid Screen. */
export function normalizeScreenEntry(raw: unknown, root: string): Screen | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id : '';
  if (!SCREEN_ID_PATTERN.test(id)) return null;
  const file = resolveScreenFile(root, item.file);
  if (!file) return null;
  if (!isFiniteNumber(item.width) || !isFiniteNumber(item.height)) return null;
  return {
    id,
    file,
    title: typeof item.title === 'string' && item.title !== '' ? item.title : id,
    width: clampSize(item.width),
    height: clampSize(item.height),
  };
}

/**
 * Normalize a parsed registry silently: drops entries that cannot become a
 * valid Screen, dedupes ids (first occurrence wins) and clamps sizes. An
 * unrecognizable input becomes the empty registry. This is the READ path.
 */
export function normalizeScreens(raw: unknown, root: string): ScreensRegistry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyRegistry();
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.screens)) return emptyRegistry();
  const screens: Screen[] = [];
  const seen = new Set<string>();
  for (const entry of obj.screens) {
    const screen = normalizeScreenEntry(entry, root);
    if (!screen || seen.has(screen.id)) continue;
    seen.add(screen.id);
    screens.push(screen);
  }
  const version = isFiniteNumber(obj.version) ? obj.version : 1;
  return { version, screens };
}

/**
 * Validate a registry for writing. Throws ScreensError with an actionable
 * message for the first invalid entry; valid entries are normalized (clamp,
 * title default, dedupe) exactly like the read path. This is the WRITE path.
 */
export function validateRegistry(raw: unknown, root: string): ScreensRegistry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ScreensError('the registry must be an object with a "screens" array');
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.screens)) throw new ScreensError('"screens" must be an array');
  if (obj.version !== undefined && !isFiniteNumber(obj.version)) {
    throw new ScreensError('"version" must be a number');
  }
  const screens: Screen[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < obj.screens.length; index += 1) {
    const entry = obj.screens[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ScreensError(`screens[${index}] must be an object`);
    }
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '';
    if (!SCREEN_ID_PATTERN.test(id)) {
      throw new ScreensError(`screens[${index}].id must match ${SCREEN_ID_PATTERN.source}`);
    }
    const file = resolveScreenFile(root, item.file);
    if (!file) {
      throw new ScreensError(
        `screens[${index}].file must be a relative .html file inside the workspace (no "..", no absolute paths)`,
      );
    }
    if (!isFiniteNumber(item.width)) {
      throw new ScreensError(`screens[${index}].width must be a number (${SCREEN_MIN_SIZE}–${SCREEN_MAX_SIZE})`);
    }
    if (!isFiniteNumber(item.height)) {
      throw new ScreensError(`screens[${index}].height must be a number (${SCREEN_MIN_SIZE}–${SCREEN_MAX_SIZE})`);
    }
    if (seen.has(id)) continue; // duplicate ids: the first entry wins (dedupe per §A)
    seen.add(id);
    screens.push({
      id,
      file,
      title: typeof item.title === 'string' && item.title !== '' ? item.title : id,
      width: clampSize(item.width),
      height: clampSize(item.height),
    });
  }
  return { version: isFiniteNumber(obj.version) ? obj.version : 1, screens };
}

/**
 * Read the registry from the workspace root. Missing file, invalid JSON or an
 * unreadable file all normalize silently to `{ version: 1, screens: [] }`.
 */
export async function readScreens(root: string): Promise<ScreensRegistry> {
  try {
    const text = await fs.readFile(path.join(root, SCREENS_FILENAME), 'utf8');
    return normalizeScreens(JSON.parse(text) as unknown, root);
  } catch {
    return emptyRegistry();
  }
}

// ---- V4-4: loud registry reads (SPEC-V4-CARBON-PARITY.md V4-4, E6/E11) ------

/** One entry the silent normalize dropped, with the actionable reason. */
export type DroppedScreenEntry = { index: number; reason: string };

/** Strict read outcome: a parsed registry + visible drops, or the parse error. */
export type StrictRegistryRead =
  | { ok: true; registry: ScreensRegistry; dropped: DroppedScreenEntry[] }
  | { ok: false; error: string };

/** `normalizeScreenEntry` with a reason attached to each rejection. */
function screenEntryRejection(raw: unknown, root: string): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'entry must be an object';
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id : '';
  if (!SCREEN_ID_PATTERN.test(id)) return `id must match ${SCREEN_ID_PATTERN.source}`;
  if (!resolveScreenFile(root, item.file)) {
    return 'file must be a relative .html file inside the workspace (no "..", no absolute paths)';
  }
  for (const key of ['width', 'height'] as const) {
    const value = item[key];
    if (!isFiniteNumber(value)) return `${key} must be a number (${SCREEN_MIN_SIZE}–${SCREEN_MAX_SIZE})`;
  }
  return null;
}

/**
 * Read the registry LOUDLY (V4-4): invalid JSON answers `{ok:false, error:
 * 'screens.json: <parse message>'}` instead of the silent empty registry, and
 * every entry the normalize drops is reported with its index and reason.
 * `readScreens` keeps its silent contract for every other caller. A missing
 * file is not an error — it reads as the empty registry, exactly like §A.
 */
export async function readScreensStrict(root: string): Promise<StrictRegistryRead> {
  let text: string;
  try {
    text = await fs.readFile(path.join(root, SCREENS_FILENAME), 'utf8');
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'ENOENT') return { ok: true, registry: emptyRegistry(), dropped: [] };
    return { ok: false, error: `${SCREENS_FILENAME}: ${error instanceof Error ? error.message : String(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return { ok: false, error: `${SCREENS_FILENAME}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const registry = normalizeScreens(parsed, root);
  const dropped: DroppedScreenEntry[] = [];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const list = (parsed as { screens?: unknown }).screens;
    if (Array.isArray(list)) {
      // Mirror normalizeScreens' walk exactly, but say WHY each entry is lost:
      // the same rejection order, the same first-wins dedupe. Clamped sizes are
      // silent (§A clamp semantics) — only genuine drops are reported.
      const seen = new Set<string>();
      for (let index = 0; index < list.length; index += 1) {
        const entry = list[index];
        const rejection = screenEntryRejection(entry, root);
        if (rejection) {
          dropped.push({ index, reason: rejection });
          continue;
        }
        const id = (entry as { id: string }).id;
        if (seen.has(id)) {
          dropped.push({ index, reason: `duplicate id "${id}" (the first entry wins)` });
          continue;
        }
        seen.add(id);
      }
    }
  }
  return { ok: true, registry, dropped };
}

/** Errors renameScreen throws; the route/menu answers them as toasts, never crashes. */
export class ScreenRenameError extends Error {}

/**
 * Rename one registry entry IN PLACE (V4-17): a single-entry read-modify-write
 * of screens.json — re-read immediately before the write, mutate ONLY the
 * first entry whose `id` matches, and write atomically (tmp+rename).
 *
 * F4 (V4 QA): the edit is MINIMAL over the raw parsed JSON. The old impl
 * round-tripped the whole file through `validateRegistry` and rewrote a
 * NORMALIZED registry — dropping unknown/extra keys (top-level and per-entry),
 * removing sibling entries the reader considers invalid, and clamping sizes.
 * That violated V4-17's "keep everything else byte-verbatim": screens.json is
 * agent-owned data and a title rename is not a licence to reformat or prune
 * it. Now every byte of data the parse produced survives except the matched
 * entry's `title`; serialization uses the house 2-space format like every
 * other registry write. A file that does not PARSE (or has no `screens`
 * array, or no matching id) still throws ScreenRenameError — the caller must
 * surface it (browser.ts toasts a warn), never swallow it.
 *
 * Documented race (spec): an agent write landing in the same ~5 ms window
 * wins; the V4-4 watcher converges both directions. The title must be a
 * non-empty string of at most 120 characters (the §3 screen-rename message
 * caps it too). Returns the NORMALIZED view of the renamed registry (the
 * reader's contract) — the file itself keeps its raw shape.
 */
export async function renameScreen(root: string, id: string, title: string): Promise<ScreensRegistry> {
  if (!SCREEN_ID_PATTERN.test(id)) throw new ScreenRenameError(`id must match ${SCREEN_ID_PATTERN.source}`);
  const clean = title.trim();
  if (clean === '' || clean.length > 120) throw new ScreenRenameError('title must be 1–120 characters');
  const abs = path.join(path.resolve(root), SCREENS_FILENAME);
  let text: string;
  try {
    text = await fs.readFile(abs, 'utf8');
  } catch {
    throw new ScreenRenameError(`${SCREENS_FILENAME} not found`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new ScreenRenameError(`${SCREENS_FILENAME}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ScreenRenameError(`${SCREENS_FILENAME} is not an object`);
  const list = (parsed as { screens?: unknown }).screens;
  if (!Array.isArray(list)) throw new ScreenRenameError(`${SCREENS_FILENAME} has no "screens" array`);
  let found = false;
  for (const entry of list) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && (entry as { id?: unknown }).id === id) {
      // First match wins, exactly like the reader's dedupe — renaming never
      // touches a shadowed duplicate or any other entry.
      (entry as Record<string, unknown>).title = clean;
      found = true;
      break;
    }
  }
  if (!found) throw new ScreenRenameError(`screen "${id}" is not in ${SCREENS_FILENAME}`);
  const tmp = path.join(path.resolve(root), `.${SCREENS_FILENAME}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    await fs.writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, abs);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw new ScreenRenameError(`could not write ${SCREENS_FILENAME}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizeScreens(parsed, root);
}

/** True when a screens.json file exists at the workspace root. */
export async function hasScreensFile(root: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(root, SCREENS_FILENAME))).isFile();
  } catch {
    return false;
  }
}

/**
 * Validate and write the full registry. Returns the relative path written.
 * Throws ScreensError (route → 400) for an invalid registry body.
 */
export async function writeScreens(root: string, raw: unknown): Promise<{ path: string }> {
  const registry = validateRegistry(raw, root);
  const abs = path.join(path.resolve(root), SCREENS_FILENAME);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return { path: SCREENS_FILENAME };
}

/** Screen URL join per decision 6: strip trailing slashes, append the file. */
export function screenUrl(baseUrl: string, file: string): string {
  return baseUrl.replace(/\/+$/, '') + '/' + file;
}