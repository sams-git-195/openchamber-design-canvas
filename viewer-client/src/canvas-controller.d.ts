/** This function must remain self-contained for server-side source serialization. */
export type CanvasScreenConfig = { id: string; url: string; width: number; height: number; title: string };
export function initCanvas(initialConfig: {
  screens?: readonly CanvasScreenConfig[];
  viewport?: { width: number; height: number };
  mode?: 'edit' | 'play';
  /** Legacy fields kept for the pre-canvas fixture controller; ignored by the grid shell. */
  url?: string;
  pages?: readonly { id: string; label: string; url: string }[];
}): unknown;
