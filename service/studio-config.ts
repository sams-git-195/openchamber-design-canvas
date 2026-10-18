// Per-project Design Canvas configuration.
//
// The agent owns it: when it scaffolds a design project it writes one of these
// next to the code, so the extension can open the right URL with no setup from
// the user. The extension only reads it (and can edit it from the dock).
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { VerifyConfig } from '../shared/verify-types.ts';

/** Where a config may live, in resolution order. The first match wins. */
export const CONFIG_CANDIDATES = ['.design-studio.json', 'design-studio.json', 'design/.design-studio.json'];
export const DEFAULT_CONFIG_PATH = CONFIG_CANDIDATES[0]!;

export type StudioConfig = {
  version: number;
  name?: string;
  /** wireframe | hi-fi | prototype | deck | custom */
  type?: string;
  /** URL the extension opens automatically. */
  url?: string;
  /** Dev command, informational (the agent runs it). */
  command?: string;
  /** Static entry file for non-served types. */
  entry?: string;
  harness?: {
    direction?: string;
    fidelity?: string;
    critiquePolicy?: string;
    // Preset id from shared/design-systems.ts, when the project was scaffolded with one.
    designSystem?: string;
    verify?: VerifyConfig;
  };
  pick?: Record<string, unknown>;
};

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isFile();
  } catch {
    return false;
  }
}

export async function resolveConfigPath(root: string): Promise<string | null> {
  for (const rel of CONFIG_CANDIDATES) {
    const abs = path.join(root, rel);
    if (await isFile(abs)) return abs;
  }
  return null;
}

export async function readStudioConfig(root: string): Promise<{ config: StudioConfig | null; path: string | null }> {
  const abs = await resolveConfigPath(root);
  if (!abs) return { config: null, path: null };
  const rel = path.relative(root, abs);
  try {
    const parsed = JSON.parse(await fs.readFile(abs, 'utf8')) as unknown;
    return { config: parsed && typeof parsed === 'object' ? (parsed as StudioConfig) : null, path: rel };
  } catch {
    return { config: null, path: rel };
  }
}

/** Write the config text. Validates JSON and confines the path to the project. */
export async function writeStudioConfig(root: string, rel: string | null, text: string): Promise<{ path: string }> {
  const relPath = rel && rel.trim() ? rel.trim() : DEFAULT_CONFIG_PATH;
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, relPath);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new Error('path outside project');
  JSON.parse(text); // rejects invalid JSON before touching disk
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text, 'utf8');
  return { path: relPath };
}

/** A rename the dock cannot apply (invalid name, unreadable config, failed write). */
export class WorkspaceRenameError extends Error {}

/** Max display-name length for a workspace (R4 / F1). */
export const MAX_WORKSPACE_NAME = 80;

/** Trimmed 1..80-char name without control characters, or null when invalid. */
export function cleanWorkspaceName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1 || name.length > MAX_WORKSPACE_NAME) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

/**
 * Set ONLY `name` in the workspace's config, keeping every other key (and its
 * order) as it was. The config is re-read immediately before the write, then
 * written atomically (tmp + rename) as 2-space JSON with a trailing newline.
 * Concurrency is last-write-wins: an agent editing the file between our read
 * and rename loses that edit, a window narrowed to a single tick by reading
 * right before writing — there is no lock across the host and the agent.
 */
export async function renameWorkspaceConfig(root: string, rawName: string): Promise<{ name: string }> {
  const name = cleanWorkspaceName(rawName);
  if (name === null) {
    throw new WorkspaceRenameError(`name must be 1–${MAX_WORKSPACE_NAME} characters with no control characters`);
  }
  const abs = await resolveConfigPath(root);
  if (!abs) throw new WorkspaceRenameError('no design-studio config found');
  const rel = path.relative(root, abs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(abs, 'utf8')) as unknown;
  } catch (error) {
    throw new WorkspaceRenameError(`${rel} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new WorkspaceRenameError(`${rel} is not a JSON object`);
  (parsed as Record<string, unknown>).name = name;
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    await fs.writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, abs);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw new WorkspaceRenameError(`could not write ${rel}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { name };
}
