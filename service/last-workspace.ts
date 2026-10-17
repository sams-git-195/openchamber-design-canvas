// The in-memory echo of the workspace the canvas is currently showing (spec
// §B: "Service keeps lastWorkspace: {dir, screens, mode, activeScreen} in
// memory after /open").
//
// It lives in its own module (not in main.ts) so browser-control.ts can import
// it as the `dir` fallback when the host request's context.directory holds no
// config, without dragging the HTTP entry point into a dependency cycle.
//
// R8 (SPEC-V3-P2-SCOPE.md D9): the user's positions/camera/mode persistence
// extends THIS module — it is the single home for workspace state; no parallel
// state module may appear. The persisted shape (view.json) lives in
// view-state.ts, but the /open echo carries the read snapshot so every
// consumer finds workspace state in exactly one place.
import type { CanvasMode, Screen } from './screens.ts';
import type { ViewState } from './view-state.ts';

export type LastWorkspace = {
  /** Absolute workspace dir the canvas was opened for. */
  dir: string;
  /** The normalized registry entries (id/file form, NOT url form). */
  screens: Screen[];
  mode: CanvasMode;
  activeScreen: string | null;
  /** The view.json snapshot /open restored from (camera/positions/mode). */
  view: ViewState | null;
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

/** Update the echo's view snapshot after a merge (drag/camera persist). */
export function updateLastWorkspaceView(view: ViewState): void {
  if (last) last.view = view;
}