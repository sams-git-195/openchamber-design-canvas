// The in-memory echo of the workspace the canvas is currently showing (spec
// §B: "Service keeps lastWorkspace: {dir, screens, mode, activeScreen} in
// memory after /open").
//
// It lives in its own module (not in main.ts) so browser-control.ts can import
// it as the `dir` fallback when the host request's context.directory holds no
// config, without dragging the HTTP entry point into a dependency cycle.
import type { CanvasMode, Screen } from './screens.ts';

export type LastWorkspace = {
  /** Absolute workspace dir the canvas was opened for. */
  dir: string;
  /** The normalized registry entries (id/file form, NOT url form). */
  screens: Screen[];
  mode: CanvasMode;
  activeScreen: string | null;
};

let last: LastWorkspace | null = null;

export function getLastWorkspace(): LastWorkspace | null {
  return last;
}

export function setLastWorkspace(next: LastWorkspace | null): void {
  last = next;
}

/** Update just the mode of the current echo (POST /mode keeps it warm). */
export function updateLastWorkspaceMode(mode: CanvasMode): void {
  if (last) last.mode = mode;
}