/** Controller-owned snapshot; getSnapshot must retain its identity until a change. */
export type ToolbarPreset = 'fit' | 'desktop' | 'large' | 'tablet' | 'mobile' | 'custom';
export type ToolbarMenu = 'page' | 'zoom' | null;
export type CameraZoomRequest = { action: 'in' | 'out' | 'reset' | 'wheel'; deltaY?: number; x?: number; y?: number };
export type CanvasMode = 'edit' | 'play';
export type ScreenState = 'loading' | 'ready' | 'error';
export type NoticeKind = 'info' | 'warn' | 'error';
export type ToastKind = 'ok' | 'warn' | 'error' | 'info';

export type ToolbarScreen = {
  id: string;
  url: string;
  width: number;
  height: number;
  title: string;
  state: ScreenState;
};

export type ToolbarNotice = { id: string; kind: NoticeKind; text: string };
export type ToolbarToast = { kind: ToastKind; text: string };

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
  /** SPEC-V4 §3: persistent registry banners (<=3), transient toast, agent state. */
  notices: readonly ToolbarNotice[];
  toast: ToolbarToast | null;
  agentBusy: boolean;
  agentLabel: string;
  modePending: CanvasMode | null;
};

export type ToolbarBridge = {
  getSnapshot: () => ToolbarState;
  subscribe: (listener: () => void) => () => void;
  selectPage: (id: string) => void;
  /** Numeric zoom only: V4-1 retired the Fit-width preset from the toolbar. */
  zoomTo: (value: number) => void;
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
