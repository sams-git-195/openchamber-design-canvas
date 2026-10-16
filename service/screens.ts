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