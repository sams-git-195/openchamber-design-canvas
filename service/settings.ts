// Service-owned Design Canvas settings (R4 / F4).
//
// One small JSON file per user, outside any workspace, holding where design
// workspaces live: `{version:1, workspaceRoot?, previousRoots?}`. The panel
// never reads or writes it — GET/PUT /settings are the only door. Location:
//   win32   %APPDATA%\Design Canvas\settings.json
//           (fallback os.homedir()\AppData\Roaming\Design Canvas\settings.json)
//   darwin  ~/Library/Application Support/Design Canvas/settings.json
//   else    ${XDG_CONFIG_HOME:-~/.config}/design-canvas/settings.json
// `DS_SETTINGS_PATH` overrides the file location (test seam). A corrupt file
// reads as absent (and is logged); writes are atomic (tmp + rename).
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SETTINGS_VERSION = 1;
/** previousRoots keeps at most this many entries, newest first. */
export const MAX_PREVIOUS_ROOTS = 10;

export type DesignCanvasSettings = {
  version: 1;
  workspaceRoot?: string;
  previousRoots?: string[];
};

export type SettingsEnv = {
  DS_SETTINGS_PATH?: string;
  APPDATA?: string;
  XDG_CONFIG_HOME?: string;
};

/** Absolute settings file path for the platform (DS_SETTINGS_PATH wins). */
export function settingsFilePath(
  env: SettingsEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): string {
  const override = env.DS_SETTINGS_PATH;
  if (typeof override === 'string' && override.trim() !== '') return path.resolve(override.trim());
  if (platform === 'win32') {
    const appData = env.APPDATA && env.APPDATA.trim() !== '' ? env.APPDATA : path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, 'Design Canvas', 'settings.json');
  }
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Design Canvas', 'settings.json');
  }
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() !== '' ? env.XDG_CONFIG_HOME : path.join(homeDir, '.config');
  return path.join(xdg, 'design-canvas', 'settings.json');
}

/** Keep only well-typed fields; anything else in the file is dropped. */
export function normalizeSettings(raw: unknown): DesignCanvasSettings {
  const out: DesignCanvasSettings = { version: 1 };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const value = raw as { workspaceRoot?: unknown; previousRoots?: unknown };
  if (typeof value.workspaceRoot === 'string' && value.workspaceRoot.trim() !== '') out.workspaceRoot = value.workspaceRoot;
  if (Array.isArray(value.previousRoots)) {
    const roots = value.previousRoots.filter((r): r is string => typeof r === 'string' && r.trim() !== '');
    if (roots.length > 0) out.previousRoots = roots.slice(0, MAX_PREVIOUS_ROOTS);
  }
  return out;
}

/** Parse settings text. Corrupt JSON = absent (null) so callers fall back. */
export function parseSettings(text: string, file: string): DesignCanvasSettings | null {
  try {
    return normalizeSettings(JSON.parse(text) as unknown);
  } catch (error) {
    console.warn(
      `[design-canvas] ignoring corrupt settings file ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** Read the settings file; a missing or corrupt file answers `{version:1}`. */
export async function readSettings(env: SettingsEnv = process.env): Promise<DesignCanvasSettings> {
  const file = settingsFilePath(env);
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return { version: 1 };
  }
  return parseSettings(text, file) ?? { version: 1 };
}

/** Atomically write the settings file (tmp + rename), creating its folder. */
export async function writeSettings(settings: DesignCanvasSettings, env: SettingsEnv = process.env): Promise<string> {
  const file = settingsFilePath(env);
  const clean = normalizeSettings(settings);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.settings.json.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    await fs.writeFile(tmp, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  return file;
}
