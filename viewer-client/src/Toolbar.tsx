import { useSyncExternalStore, type FocusEvent, type ReactNode } from 'react';
import { ChevronDown, CircleAlert, CircleCheck, Frame, Hand, LoaderCircle, Minus, Palette, Pencil, Play, Plus, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ToolbarBridge, ToolbarMenu, ToolbarState } from './toolbar-types';

/** Scroll only the toolbar, never the document or canvas ancestors. */
export function revealControl(viewport: HTMLElement, control: HTMLElement): void {
  const box = control.getBoundingClientRect();
  const clip = viewport.getBoundingClientRect();
  const ringRoom = 4;
  if (box.left < clip.left + ringRoom) viewport.scrollLeft -= clip.left + ringRoom - box.left;
  else if (box.right > clip.right - ringRoom) viewport.scrollLeft += box.right - clip.right + ringRoom;
}

/**
 * The toolbar never flips the shell mode locally: it posts {type:'mode-request'}
 * through the controller and the service confirms by pushing __dsCanvas.setMode.
 * Base UI hands an array even in single-selection mode. Empty means no change.
 */
export function requestMode(values: readonly string[], bridge: ToolbarBridge): boolean {
  const state = bridge.getSnapshot();
  if (!state.ready || state.capturing || values.length !== 1) return false;
  const mode = values[0];
  if (mode !== 'edit' && mode !== 'play') return false;
  bridge.setMode(mode);
  return true;
}

function cameraAvailable(state: ToolbarState): boolean {
  return state.ready && !state.capturing;
}

function setOpen(menu: Exclude<ToolbarMenu, null>, open: boolean, bridge: ToolbarBridge): void {
  if (open) {
    const state = bridge.getSnapshot();
    if (!state.capturing && cameraAvailable(state)) bridge.setMenu(menu);
  } else if (bridge.getSnapshot().openMenu === menu) bridge.setMenu(null);
}

function Hint({ text, children }: { text: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger render={<span className="inline-flex shrink-0" />}>{children}</TooltipTrigger><TooltipContent>{text}</TooltipContent></Tooltip>;
}

function InformationIcon({ icon: Icon, label, live = false }: { icon: LucideIcon; label: string; live?: boolean }) {
  return <Tooltip>
    <TooltipTrigger render={<span tabIndex={0} role={live ? 'status' : 'img'} aria-live={live ? 'polite' : undefined} aria-label={label} className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center" />}>
      <Icon size={16} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>;
}

export function Toolbar({ bridge }: { bridge: ToolbarBridge }) {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot);
  const disabled = !state.ready || state.capturing;
  const cameraDisabled = !cameraAvailable(state);
  const cameraReason = state.capturing ? 'Capture in progress. Controls are temporarily unavailable.' : !state.ready ? 'The preview is not ready.' : '';
  const pendingMode = state.modePending;
  const workspaceName = state.currentTitle && state.currentTitle !== 'Preview' ? state.currentTitle : 'Design Canvas';
  const title = state.screens.find((screen) => screen.id === state.active)?.title || workspaceName;
  const statusLabel = state.capturing ? 'Capturing preview' : state.statusState === 'ready' ? 'Preview ready' : state.statusState === 'loading' ? 'Loading preview' : state.statusState === 'empty' ? 'No screens on this canvas' : 'Preview failed';
  const Status = state.capturing || state.statusState === 'loading' ? LoaderCircle : state.statusState === 'ready' ? CircleCheck : CircleAlert;
  const percentage = Number.isFinite(state.scale) ? `${Math.round(state.scale * 100)}%` : '—';
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.currentTarget.contains(event.target)) revealControl(event.currentTarget, event.target);
  };
  const actCamera = (action: () => void) => { if (cameraAvailable(bridge.getSnapshot())) action(); };

  return <TooltipProvider>
    <div role="toolbar" aria-label="Design Canvas preview controls" id="stock-toolbar-scroll" className="flex h-10 w-full shrink-0 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden px-2" onFocusCapture={onFocus}>
      <InformationIcon icon={Palette} label="Design Canvas" />
      {/* Workspace label: the service pushes the active screen's title through
          setPage; the shell never learns the folder name (fixed contract), so
          this is the best-effort name slot V4-9 specifies, truncated at 24ch. */}
      <span id="workspace-name" className="min-w-0 max-w-[24ch] shrink truncate text-sm text-muted-foreground" title={title}>{title}</span>
      <Hint text={pendingMode ? `Switching to ${pendingMode} mode…` : cameraReason || (state.mode === 'edit' ? 'Edit mode: clicking a screen picks that element for the chat' : 'Play mode: screens accept real interaction')}>
        <ToggleGroup aria-label="Interaction mode" variant="outline" size="sm" spacing={0} multiple={false} value={[pendingMode ?? state.mode]} onValueChange={(values) => requestMode(values, bridge)} disabled={disabled || !!pendingMode} className="shrink-0">
          <ToggleGroupItem value="edit" aria-label="Edit" className={pendingMode === 'edit' ? 'animate-pulse' : undefined}><Pencil aria-hidden="true" />Edit</ToggleGroupItem>
          <ToggleGroupItem value="play" aria-label="Play" className={pendingMode === 'play' ? 'animate-pulse' : undefined}><Play aria-hidden="true" />Play</ToggleGroupItem>
        </ToggleGroup>
      </Hint>
      {state.screens.length > 4 ? <DropdownMenu modal={false}>
        <DropdownMenuTrigger render={<Button id="screens-menu" variant="outline" size="sm" aria-label="Screens" disabled={state.capturing} />}>
          <span className="max-w-32 truncate">Screens</span><ChevronDown aria-hidden="true" data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent id="screens-list" className="menu">
          <DropdownMenuGroup><DropdownMenuLabel>Screens</DropdownMenuLabel>
            {state.screens.map((screen) => <DropdownMenuCheckboxItem key={screen.id} checked={screen.id === state.active} aria-label={screen.title} onCheckedChange={() => { if (!bridge.getSnapshot().capturing) bridge.activateScreen(screen.id); }}>
              {screen.state === 'error' ? <CircleAlert aria-hidden="true" /> : screen.state === 'loading' ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}{screen.title}
            </DropdownMenuCheckboxItem>)}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu> : state.screens.length > 0 ? <div role="group" aria-label="Screens" className="flex shrink-0 items-center gap-1">
        {state.screens.map((screen) => <Button key={screen.id} size="sm" variant={screen.id === state.active ? 'secondary' : 'ghost'} aria-pressed={screen.id === state.active} disabled={state.capturing} title={`${screen.title} · ${screen.width} × ${screen.height}`} onClick={() => { if (!bridge.getSnapshot().capturing) bridge.activateScreen(screen.id); }}>
          {screen.state === 'error' ? <CircleAlert aria-hidden="true" /> : screen.state === 'loading' ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}{screen.title}
        </Button>)}
      </div> : null}
      <span aria-hidden="true" className="min-w-4 flex-1 shrink" />
      {state.agentBusy ? <span id="agent-status" role="status" aria-live="polite" className="flex h-7 max-w-[32ch] min-w-0 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs text-muted-foreground">
        <span className="ds-agent-dot shrink-0" aria-hidden="true" /><span className="truncate">{state.agentLabel || 'Designing…'}</span>
      </span> : null}
      <Hint text={cameraReason || 'Zoom out'}><Button id="minus" variant="ghost" size="icon-sm" aria-label="Zoom out" aria-describedby={cameraDisabled ? 'stock-camera-reason' : undefined} disabled={cameraDisabled || state.scale <= .1} onClick={() => actCamera(() => { bridge.zoomCamera({ action: 'out' }); })}><Minus aria-hidden="true" /></Button></Hint>
      <DropdownMenu modal={false} open={state.openMenu === 'zoom'} onOpenChange={(open) => setOpen('zoom', open, bridge)}>
        <DropdownMenuTrigger render={<Button id="zoom" variant="outline" size="sm" aria-label={`Zoom ${percentage}`} aria-describedby={cameraDisabled ? 'stock-camera-reason' : undefined} disabled={cameraDisabled} />}>
          {percentage}<ChevronDown aria-hidden="true" data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent id="zoom-menu" className="menu">
          <DropdownMenuGroup><DropdownMenuLabel>Zoom</DropdownMenuLabel>
            <DropdownMenuItem id="zoom-fit-all" closeOnClick onClick={() => actCamera(() => bridge.fitAll())}>Fit all</DropdownMenuItem>
            <DropdownMenuItem id="zoom-50" closeOnClick onClick={() => actCamera(() => bridge.zoomTo(0.5))}>50%</DropdownMenuItem>
            <DropdownMenuItem id="zoom-100" closeOnClick onClick={() => actCamera(() => bridge.zoomTo(1))}>100%</DropdownMenuItem>
            <DropdownMenuItem id="zoom-200" closeOnClick onClick={() => actCamera(() => bridge.zoomTo(2))}>200%</DropdownMenuItem>
            <DropdownMenuItem id="zoom-selection" closeOnClick onClick={() => actCamera(() => bridge.focusScreen(state.active))}>Zoom to selection</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Hint text={cameraReason || 'Zoom in'}><Button id="plus" variant="ghost" size="icon-sm" aria-label="Zoom in" aria-describedby={cameraDisabled ? 'stock-camera-reason' : undefined} disabled={cameraDisabled || state.scale >= 3} onClick={() => actCamera(() => { bridge.zoomCamera({ action: 'in' }); })}><Plus aria-hidden="true" /></Button></Hint>
      <Hint text={cameraReason || 'Fit all screens'}>
        <Button id="fit-all" variant="ghost" size="icon-sm" aria-label="Fit all screens" disabled={disabled} onClick={() => { if (!bridge.getSnapshot().capturing && bridge.getSnapshot().ready) bridge.fitAll(); }}><Frame aria-hidden="true" /></Button>
      </Hint>
      <Hint text={cameraReason || 'Pan canvas'}>
        <Toggle id="pan" size="sm" variant="default" aria-label="Pan canvas" aria-describedby={cameraDisabled ? 'stock-camera-reason' : undefined} disabled={cameraDisabled} pressed={state.pan} onPressedChange={() => actCamera(bridge.togglePan)}><Hand aria-hidden="true" /></Toggle>
      </Hint>
      <InformationIcon icon={Status} label={state.message ? `${statusLabel}: ${state.message}` : statusLabel} live />
      {state.statusState === 'error' ? <Button size="sm" variant="outline" disabled={state.capturing} onClick={() => { if (!bridge.getSnapshot().capturing) bridge.retry(); }}>Retry</Button> : null}
      <span id="stock-camera-reason" className="sr-only">{cameraReason}</span>
    </div>
  </TooltipProvider>;
}
