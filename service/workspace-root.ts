// Design Canvas workspace-root resolution — spec §3, §G.
//
// The service is the single source of truth for where design workspaces live:
// `<Documents>/Design Canvas/<slug>`. The panel NEVER builds this path —
// GET /workspaces answers it and PHP-free scaffold confinement checks against
// it. Probe order (win32): `%ONEDRIVE%\Documents` when it exists, then
// `%USERPROFILE%\Documents`, then `os.homedir()/Documents`; other platforms:
// `os.homedir()/Documents`. `DS_WORKSPACE_ROOT` overrides everything.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

/**
 * The absolute workspace root. `DS_WORKSPACE_ROOT` wins outright (even when
 * the directory does not exist yet — scaffold creates it). Otherwise the first
 * candidate whose parent Documents directory exists wins per §3 ("if it
 * exists"); with no existing Documents anywhere the homedir candidate is the
 * predictable fallback.
 */
export async function resolveWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const override = env.DS_WORKSPACE_ROOT;
  if (typeof override === 'string' && override.trim() !== '') {
    return path.resolve(override.trim());
  }
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