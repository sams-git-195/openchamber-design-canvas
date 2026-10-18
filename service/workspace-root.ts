// Design Canvas workspace-root resolution — spec §3, §G.
//
// The service is the single source of truth for where design workspaces live:
// `<Documents>/Design Canvas/<slug>`. The panel NEVER builds this path —
// GET /workspaces answers it and PHP-free scaffold confinement checks against
// it. Probe order (win32): `%ONEDRIVE%\Documents` when it exists, then
// `%USERPROFILE%\Documents`, then `os.homedir()/Documents`; other platforms:
// `os.homedir()/Documents`. `DS_WORKSPACE_ROOT` overrides everything; R4: a
// root the user chose (service-owned settings.ts file) sits between the two.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_PREVIOUS_ROOTS,
  parseSettings,
  readSettings,
  settingsFilePath,
  writeSettings,
  type DesignCanvasSettings,
} from './settings.ts';
import { resolveConfigPath } from './studio-config.ts';

/** The folder workspaces live in, under the user's Documents directory. */
export const WORKSPACE_FOLDER = 'Design Canvas';

export type WorkspaceEnv = {
  DS_WORKSPACE_ROOT?: string;
  ONEDRIVE?: string;
  USERPROFILE?: string;
};

/**
 * Ordered candidate absolute workspace roots for the platform, with the
 * DS_WORKSPACE_ROOT override NOT applied (that is resolveWorkspaceRoot's job).
 * Candidates are deduplicated and made absolute; the final candidate is always
 * the homedir fallback so there is never an empty list.
 */
export function candidateWorkspaceRoots(
  env: WorkspaceEnv,
  platform: NodeJS.Platform,
  homeDir: string,
): string[] {
  const candidates: string[] = [];
  if (platform === 'win32') {
    if (env.ONEDRIVE) candidates.push(path.join(env.ONEDRIVE, 'Documents', WORKSPACE_FOLDER));
    if (env.USERPROFILE) candidates.push(path.join(env.USERPROFILE, 'Documents', WORKSPACE_FOLDER));
  }
  candidates.push(path.join(homeDir, 'Documents', WORKSPACE_FOLDER));
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const candidate of candidates) {
    const abs = path.resolve(candidate);
    if (seen.has(abs)) continue;
    seen.add(abs);
    roots.push(abs);
  }
  return roots;
}

/** The §3 Documents probe alone — the root when nothing overrides it. */
export async function defaultWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const candidates = candidateWorkspaceRoots(env, process.platform, os.homedir());
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(path.dirname(candidate))).isDirectory()) return candidate;
    } catch {
      /* probe the next candidate */
    }
  }
  return candidates[candidates.length - 1] ?? path.resolve(os.homedir(), 'Documents', WORKSPACE_FOLDER);
}

/** Cross-platform absolute-dir equality (win32 is case-insensitive;
 *  separators normalize through path.resolve). */
export function sameAbsoluteDir(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function envOverride(env: NodeJS.ProcessEnv): string | null {
  const override = env.DS_WORKSPACE_ROOT;
  return typeof override === 'string' && override.trim() !== '' ? path.resolve(override.trim()) : null;
}

// R4: the settings file is read on every resolve (the user can change the
// root while the service runs) but only re-parsed when its mtime/size moves.
let settingsCache: { file: string; mtimeMs: number; size: number; settings: DesignCanvasSettings } | null = null;

async function readSettingsCached(env: NodeJS.ProcessEnv): Promise<DesignCanvasSettings> {
  const file = settingsFilePath(env);
  let stat: { mtimeMs: number; size: number };
  try {
    stat = await fs.stat(file);
  } catch {
    return { version: 1 };
  }
  if (settingsCache && settingsCache.file === file && settingsCache.mtimeMs === stat.mtimeMs && settingsCache.size === stat.size) {
    return settingsCache.settings;
  }
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return { version: 1 };
  }
  const settings = parseSettings(text, file) ?? { version: 1 };
  settingsCache = { file, mtimeMs: stat.mtimeMs, size: stat.size, settings };
  return settings;
}

export type WorkspaceRootSource = 'env' | 'settings' | 'default';

export type WorkspaceRootInfo = {
  root: string;
  source: WorkspaceRootSource;
  defaultRoot: string;
  /** Earlier roots that still hold workspaces, newest first, never the current root. */
  previousRoots: string[];
};

/**
 * The workspace root and where it came from. Precedence:
 * DS_WORKSPACE_ROOT > settings.workspaceRoot > the Documents probe.
 */
export async function resolveWorkspaceRootInfo(env: NodeJS.ProcessEnv = process.env): Promise<WorkspaceRootInfo> {
  const defaultRoot = await defaultWorkspaceRoot(env);
  const settings = await readSettingsCached(env);
  const override = envOverride(env);
  let root: string;
  let source: WorkspaceRootSource;
  if (override) {
    root = override;
    source = 'env';
  } else if (settings.workspaceRoot && path.isAbsolute(settings.workspaceRoot)) {
    root = path.resolve(settings.workspaceRoot);
    source = 'settings';
  } else {
    root = defaultRoot;
    source = 'default';
  }
  const previousRoots: string[] = [];
  for (const candidate of settings.previousRoots ?? []) {
    if (!path.isAbsolute(candidate)) continue;
    const abs = path.resolve(candidate);
    if (sameAbsoluteDir(abs, root) || previousRoots.some((seen) => sameAbsoluteDir(seen, abs))) continue;
    previousRoots.push(abs);
  }
  return { root, source, defaultRoot, previousRoots };
}

/**
 * The absolute workspace root. `DS_WORKSPACE_ROOT` wins outright (even when
 * the directory does not exist yet — scaffold creates it); then the user's
 * chosen root from the settings file; otherwise the first candidate whose
 * parent Documents directory exists wins per §3 ("if it exists"); with no
 * existing Documents anywhere the homedir candidate is the predictable
 * fallback.
 */
export async function resolveWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const override = envOverride(env);
  if (override) return override;
  return (await resolveWorkspaceRootInfo(env)).root;
}

/** How many direct children of `root` are design workspaces (0 when unreadable). */
export async function countWorkspaces(root: string): Promise<number> {
  let count = 0;
  try {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && (await resolveConfigPath(path.join(root, entry.name))) !== null) count += 1;
    }
  } catch {
    return 0;
  }
  return count;
}

export type WorkspaceRootCode =
  | 'ENV_OVERRIDE'
  | 'NOT_ABSOLUTE'
  | 'INVALID'
  | 'IS_FS_ROOT'
  | 'IS_WORKSPACE'
  | 'INSIDE_EXTENSION'
  | 'NOT_WRITABLE'
  | 'SETTINGS_WRITE_FAILED';

export type WorkspaceRootResult =
  | { ok: true; workspaceRoot: string }
  | { ok: false; code: WorkspaceRootCode; error: string };

/** The extension's own folder (service/ is one level below it, in source and bundle alike). */
const EXTENSION_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function insideOrEqualCaseAware(root: string, dir: string): boolean {
  if (process.platform !== 'win32') return isInsideOrEqual(root, dir);
  return isInsideOrEqual(path.resolve(root).toLowerCase(), path.resolve(dir).toLowerCase());
}

function expandHome(raw: string, homeDir: string): string {
  if (raw === '~') return homeDir;
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(homeDir, raw.slice(2));
  return raw;
}

/**
 * Validate a user-chosen workspace root. Order: INVALID (NUL) → NOT_ABSOLUTE
 * (after ~ expansion; a win32 drive-relative `C:foo` is not absolute) →
 * IS_FS_ROOT → INSIDE_EXTENSION → IS_WORKSPACE (the dir or any ancestor holds
 * a design-studio config) → NOT_WRITABLE (mkdir -p, then a write+delete probe).
 */
export async function validateWorkspaceRootCandidate(
  raw: string,
  opts: { homeDir?: string; extensionDir?: string } = {},
): Promise<WorkspaceRootResult> {
  const value = raw.trim();
  if (value.includes('\u0000')) return { ok: false, code: 'INVALID', error: 'The folder path contains an invalid character.' };
  const expanded = expandHome(value, opts.homeDir ?? os.homedir());
  if (expanded === '' || !path.isAbsolute(expanded)) {
    return { ok: false, code: 'NOT_ABSOLUTE', error: 'Choose a full folder path (for example C:\\Users\\you\\Designs).' };
  }
  const abs = path.resolve(expanded);
  if (path.parse(abs).root === abs) {
    return { ok: false, code: 'IS_FS_ROOT', error: 'A drive or filesystem root cannot hold your designs — pick a folder inside it.' };
  }
  if (insideOrEqualCaseAware(opts.extensionDir ?? EXTENSION_DIR, abs)) {
    return { ok: false, code: 'INSIDE_EXTENSION', error: 'That folder is inside the Design Canvas extension itself — pick a folder elsewhere.' };
  }
  for (let dir = abs; ; dir = path.dirname(dir)) {
    if ((await resolveConfigPath(dir)) !== null) {
      return {
        ok: false,
        code: 'IS_WORKSPACE',
        error: `${dir} is a design workspace — choose the folder that should CONTAIN your workspaces instead.`,
      };
    }
    if (path.dirname(dir) === dir) break;
  }
  try {
    await fs.mkdir(abs, { recursive: true });
    const probe = path.join(abs, `.ds-write-probe-${Math.random().toString(36).slice(2)}`);
    await fs.writeFile(probe, '', 'utf8');
    await fs.rm(probe, { force: true });
  } catch (error) {
    return {
      ok: false,
      code: 'NOT_WRITABLE',
      error: `Design Canvas cannot write to ${abs}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ok: true, workspaceRoot: abs };
}

/**
 * PUT /settings: choose (string) or reset (null) the workspace root. The old
 * root joins previousRoots only when it still holds ≥1 workspace (so nothing
 * the user made disappears from the list); the new root leaves previousRoots.
 */
export async function setWorkspaceRoot(
  value: string | null,
  env: NodeJS.ProcessEnv = process.env,
  opts: { homeDir?: string; extensionDir?: string } = {},
): Promise<WorkspaceRootResult> {
  if (envOverride(env)) {
    return {
      ok: false,
      code: 'ENV_OVERRIDE',
      error: 'DS_WORKSPACE_ROOT is set for this service, so the designs location cannot be changed here.',
    };
  }
  const info = await resolveWorkspaceRootInfo(env);
  let next: string;
  if (value === null) {
    next = info.defaultRoot;
  } else {
    const checked = await validateWorkspaceRootCandidate(value, opts);
    if (!checked.ok) return checked;
    next = checked.workspaceRoot;
  }
  const settings = await readSettings(env);
  let previous = (settings.previousRoots ?? []).filter((r) => !sameAbsoluteDir(r, next));
  if (!sameAbsoluteDir(info.root, next) && (await countWorkspaces(info.root)) > 0) {
    previous = [info.root, ...previous.filter((r) => !sameAbsoluteDir(r, info.root))];
  }
  previous = previous.slice(0, MAX_PREVIOUS_ROOTS);
  const written: DesignCanvasSettings = { version: 1 };
  if (value !== null) written.workspaceRoot = next;
  if (previous.length > 0) written.previousRoots = previous;
  try {
    await writeSettings(written, env);
  } catch (error) {
    return {
      ok: false,
      code: 'SETTINGS_WRITE_FAILED',
      error: `Could not save the settings file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  settingsCache = null;
  return { ok: true, workspaceRoot: next };
}

/**
 * Lexical containment test: is `dir` the root itself or a descendant of it?
 * Used by scaffold confinement — creating a NEW directory during scaffold is
 * allowed only inside the resolved workspace root; existing dirs are accepted
 * anywhere.
 */
export function isInsideOrEqual(root: string, dir: string): boolean {
  const rootAbs = path.resolve(root);
  const dirAbs = path.resolve(dir);
  return dirAbs === rootAbs || dirAbs.startsWith(rootAbs + path.sep);
}