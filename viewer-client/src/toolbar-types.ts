/** Controller-owned snapshot; getSnapshot must retain its identity until a change. */
export type ToolbarPreset = 'fit' | 'desktop' | 'large' | 'tablet' | 'mobile' | 'custom';
export type ToolbarMenu = 'page' | 'zoom' | null;
export type CameraZoomRequest = { action: 'in' | 'out' | 'reset' | 'wheel'; deltaY?: number; x?: number; y?: number };
export type CanvasMode = 'edit' | 'play';
export type ScreenState = 'loading' | 'ready' | 'error';

export type ToolbarScreen = {
  id: string;
  url: string;
  width: number;
  height: number;
  title: string;
  state: ScreenState;
};

export type ToolbarState = {
  ready: boolean;
  statusState: 'loading' | 'ready' | 'empty' | 'error';
  message: string;
  pages: readonly { id: string; label: string; url: string }[];
  currentUrl: string;
  currentTitle: string;
  screens: readonly ToolbarScreen[];
  active: string;
  mode: CanvasMode;
  preset: ToolbarPreset;
  width: number;
  height: number;
  layoutMode: 'fit' | 'page' | 'viewport';
  reason: string;
  zoomMode: 'fit' | 'manual' | 'fit-all';
  scale: number;
  pan: boolean;
  capturing: boolean;
  openMenu: ToolbarMenu;
};

export type ToolbarBridge = {
  getSnapshot: () => ToolbarState;
  subscribe: (listener: () => void) => () => void;
  selectPreset: (id: Exclude<ToolbarPreset, 'custom'>) => void;
  selectPage: (id: string) => void;
  zoomTo: (value: 'fit' | number) => void;
  zoomCamera: (info: CameraZoomRequest) => boolean;
  togglePan: () => void;
  panBy: (direction: 'left' | 'right' | 'up' | 'down') => void;
  retry: () => void;
  setMenu: (menu: ToolbarMenu) => void;
  setMode: (mode: CanvasMode) => void;
  activateScreen: (id: string) => void;
  fitAll: () => void;
  focusScreen: (id: string) => void;
};

declare global {
  interface Window {
    __dsToolbarBridge?: ToolbarBridge;
    __dsToolbarMounted?: () => void;
  }
}
