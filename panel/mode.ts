// Design Mode: the switch that turns a chat session into a canvas session.
//
// It lives in three native hooks, because a guest cannot re-skin the host chat:
//  · `/canvas [on|off|play|edit|<type>] [brief…]` — a slash command resolved by
//    the panel; toggling returns a context chip on the composer (the "canvas is
//    on" signal the model sees when the user sends).
//  · a Work Status section (surface "status") rendered inside the chat — the
//    visible "the chat changed" part.
//  · per-session mode and workspace persisted in host storage, keyed by session
//    id (`mode/<id>` and `ws/<id>`): starting a canvas session seeds them, so
//    the new session opens with the widget ON and its workspace bound.
import type { AttachIssueRequest } from '@openchamber/sdk';
import { GUEST_COMPOSE_TEXT_MAX } from '@openchamber/sdk';
import { DIRECTIONS, type DirectionId } from './craft.ts';
import {
  CANVAS_PROTOCOL,
  CANVAS_PROTOCOL_CHIP,
  DESIGN_AUTHORITY,
  DESIGN_WORKSPACE_NOTE,
  IDENTITY,
  VERIFY_PROTOCOL,
  WORKING_AGREEMENT_CHIP,
  WORKING_AGREEMENT_COMPACT,
  defaultCraft,
  firstReplyContract,
  workingAgreementChip,
  type CraftRuleId,
  type OptionsChoice,
} from '../shared/harness-text.ts';
import { DESIGN_SYSTEMS, type DesignSystemPreset } from '../shared/design-systems.ts';
import type { CritiqueScreenDigest, ExportFormat, ExportStatusResult, ScreenInfo, StudioConfig, WorkspaceRecord } from './api.ts';

export { VERIFY_PROTOCOL, WORKING_AGREEMENT_CHIP };

/** The text cap every attach / start-session payload must respect (SDK). */
export const GUEST_ATTACH_TEXT_MAX = 16000;

/** The cap on screens listed in the mode chip (spec §F chip budget, audit #16). */
export const MODE_CHIP_SCREEN_CAP = 40;

export type DesignType = 'wireframe' | 'hi-fi' | 'prototype' | 'deck' | 'custom';

export const DESIGN_TYPES: DesignType[] = ['wireframe', 'hi-fi', 'prototype', 'deck', 'custom'];

export const TYPE_HINT: Record<DesignType, string> = {
  wireframe: 'structure and navigation only — no final colour, type or copy',
  'hi-fi': 'static screens with the full design system (tokens, type, colour)',
  prototype: 'a real, interactive app with a dev server, all five states and motion',
  deck: 'a presentation deck (HTML slides) with its own nav and print layout',
  custom: 'ask what is being made, then choose the closest approach',
};

export type Fidelity = 'wireframe' | 'hi-fi' | 'interactive';

export const FIDELITIES: Fidelity[] = ['wireframe', 'hi-fi', 'interactive'];

export const FIDELITY_HINT: Record<Fidelity, string> = {
  wireframe: 'low fidelity: boxes, flows and labels, no polish',
  'hi-fi': 'final visual quality: tokens, type, colour, spacing',
  interactive: 'hi-fi plus working interactions and transitions',
};

export const FIDELITY_OPTIONS: Array<[Fidelity, string]> = [
  ['hi-fi', 'Hi-fi'],
  ['wireframe', 'Wireframe'],
  ['interactive', 'Interactive'],
];

// ---- design-system presets (pure: the picker's list, filter and swatch rules) ----

/**
 * The composer control's label when no preset is chosen. It is also the first
 * entry of the picker list, so the default and the "clear" outcome read the same.
 */
export const NO_DESIGN_SYSTEM = 'No design system';

/** The preset with this id, or null for null/undefined/unknown ids. */
export function findDesignSystem(id: string | null | undefined): DesignSystemPreset | null {
  if (!id) return null;
  return DESIGN_SYSTEMS.find((preset) => preset.id === id) ?? null;
}

/** The composer control's label for a chosen id: the preset name, else "No design system". */
export function designSystemLabel(id: string | null | undefined): string {
  return findDesignSystem(id)?.name ?? NO_DESIGN_SYSTEM;
}

/**
 * Case-insensitive filter over a preset's name, category and description. An
 * empty (or whitespace) query keeps every preset; the order is the catalog order.
 */
export function filterDesignSystems(query: string, presets: DesignSystemPreset[] = DESIGN_SYSTEMS): DesignSystemPreset[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return presets.slice();
  return presets.filter(
    (preset) =>
      preset.name.toLowerCase().includes(needle) ||
      preset.category.toLowerCase().includes(needle) ||
      preset.description.toLowerCase().includes(needle),
  );
}

/**
 * Group presets by their category for the list, preserving first-seen order so
 * the grouping stays stable as the filter narrows. One label per group.
 */
export function designSystemGroups(presets: DesignSystemPreset[]): Array<{ category: string; presets: DesignSystemPreset[] }> {
  const order: string[] = [];
  const groups = new Map<string, DesignSystemPreset[]>();
  for (const preset of presets) {
    let bucket = groups.get(preset.category);
    if (!bucket) {
      bucket = [];
      groups.set(preset.category, bucket);
      order.push(preset.category);
    }
    bucket.push(preset);
  }
  return order.map((category) => ({ category, presets: groups.get(category)! }));
}

/**
 * The token order the swatch strip prefers: the colour roles a designer reads
 * first (canvas, accent, text, borders, feedback), before any extra colours.
 */
const SWATCH_TOKEN_ORDER = [
  '--bg', '--surface', '--surface-warm', '--accent', '--accent-hover', '--accent-active',
  '--fg', '--muted', '--border', '--success', '--warn', '--danger',
];

/**
 * Whether a token value can be painted as a swatch on its own: a literal colour,
 * not a `var(...)` indirection or a `color-mix(...)` that only resolves inside
 * the preset.
 */
export function isColorTokenValue(value: string): boolean {
  const text = value.trim().toLowerCase();
  return (
    /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(text) ||
    /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/.test(text)
  );
}

/**
 * A few colour swatches from a preset's tokens, in a deliberate order and capped
 * so the strip stays a glance.
 */
export function designSystemSwatches(preset: DesignSystemPreset, max = 8): Array<{ name: string; value: string }> {
  const preferred = SWATCH_TOKEN_ORDER.filter((name) => isColorTokenValue(preset.tokens[name] ?? ''));
  const extras = Object.keys(preset.tokens).filter(
    (name) => !SWATCH_TOKEN_ORDER.includes(name) && isColorTokenValue(preset.tokens[name]!),
  );
  return [...preferred, ...extras].slice(0, max).map((name) => ({ name, value: preset.tokens[name]! }));
}

/** The canvas mode: edit (pick elements) or play (click-throughs work). */
export type CanvasMode = 'edit' | 'play';

export type DesignMode = {
  on: boolean;
  type: DesignType;
  direction: 'auto' | DirectionId;
  fidelity: Fidelity;
  canvMode: CanvasMode;
  brief: string;
  /** Ask clarifying questions before building (default true; old stored modes omit it). */
  questions?: boolean;
  /** How many directions the user wants, or 'ask' (default). */
  options?: OptionsChoice;
  /** The device artboards to design; omitted = not chosen yet. */
  devices?: DeviceId[];
};

export type DeviceId = 'phone' | 'tablet' | 'desktop';

/** The device artboard sizes the canvas offers (CANVAS_PROTOCOL presets). */
export const DEVICE_PRESETS: Record<DeviceId, { label: string; width: number; height: number }> = {
  phone: { label: 'phone', width: 390, height: 844 },
  tablet: { label: 'tablet', width: 768, height: 1024 },
  desktop: { label: 'desktop', width: 1440, height: 900 },
};

/** `phone 390×844 · desktop 1440×900`, or the not-chosen wording for none. */
export function devicesLabel(devices: readonly DeviceId[] | null | undefined): string {
  const known = (devices ?? []).filter((id) => id in DEVICE_PRESETS);
  if (known.length === 0) return 'not chosen yet — agree them first';
  return known.map((id) => `${DEVICE_PRESETS[id].label} ${DEVICE_PRESETS[id].width}×${DEVICE_PRESETS[id].height}`).join(' · ');
}

/** `Questions first: on · Options: ask · Devices: …` — old stored modes read as defaults. */
export function agreementStatusLine(input: { questions?: boolean; options?: OptionsChoice; devices?: readonly DeviceId[] }): string {
  const questions = input.questions !== false;
  const options = input.options ?? (questions ? 'ask' : 1);
  return `Questions first: ${questions ? 'on' : 'off'} · Options: ${options === 'ask' ? 'ask the user' : options} · Devices: ${devicesLabel(input.devices)}`;
}

export const DEFAULT_MODE: DesignMode = { on: false, type: 'hi-fi', direction: 'auto', fidelity: 'hi-fi', canvMode: 'edit', brief: '' };

export type ParsedDesignArgs = {
  on: boolean;
  /** The explicit mode `play`/`edit` args carry, or null (keep the current mode). */
  mode: CanvasMode | null;
  type: DesignType | null;
  brief: string;
};

/**
 * `/canvas [args]`:
 *   ""          → on, keep the current type and mode
 *   "off"       → off
 *   "on …"      → on, keep the current type and mode
 *   "play|edit" → on with that canvas mode (a brief may follow)
 *   "<type> …"  → on with that type
 *   anything else → on, current type, whole text is the brief
 */
export function parseDesignArgs(raw: string): ParsedDesignArgs {
  const text = raw.trim();
  const [first = '', ...rest] = text.split(/\s+/);
  const brief = rest.join(' ');
  if (/^off$/i.test(first)) return { on: false, mode: null, type: null, brief };
  if (/^on$/i.test(first)) return { on: true, mode: null, type: null, brief };
  if (/^play$/i.test(first)) return { on: true, mode: 'play', type: null, brief };
  if (/^edit$/i.test(first)) return { on: true, mode: 'edit', type: null, brief };
  if (first === '') return { on: true, mode: null, type: null, brief };
  const type = DESIGN_TYPES.find((candidate) => candidate === first.toLowerCase());
  if (type) return { on: true, mode: null, type, brief };
  return { on: true, mode: null, type: null, brief: text };
}

export function modeStorageKey(sessionId: string | null): string | null {
  return sessionId ? `mode/${sessionId}` : null;
}

/** The per-session workspace key: `ws/<sessionId>` = `{dir, name}` (decision 3). */
export function workspaceStorageKey(sessionId: string | null): string | null {
  return sessionId ? `ws/${sessionId}` : null;
}

// ---- the persistent design marker ----
//
// The `mode/<id>` key says whether Design Mode is ON *right now*; the marker is
// the opposite: written once when Design Mode turns ON for a session and NEVER
// cleared, so a canvas chat stays recognizable even when the mode is off.

/** The host storage key holding a session's permanent design marker, or null. */
export function designMarkerKey(sessionId: string | null): string | null {
  return sessionId ? `design/${sessionId}` : null;
}

/** The marker payload: `on` is the load-bearing bit; `at` records the ON moment. */
export function designMarkerValue(at: Date = new Date()): { on: true; at: string } {
  return { on: true, at: at.toISOString() };
}

/**
 * Whether a stored value is our persistent design marker. Reads `on` loosely, so
 * any extra fields (like `at`) never invalidate it.
 */
export function isDesignMarker(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { on?: unknown }).on === true);
}

/**
 * The inverse of `designMarkerKey`: the session id a `design/<id>` host storage
 * key refers to, or null for any other key.
 */
export function designSessionIdFromKey(key: string): string | null {
  const prefix = 'design/';
  return key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : null;
}

/**
 * Every `attach` / `start-session` payload must carry an http(s) URL — the host
 * rejects anything else with "URL must be http or https.". The canvas session
 * has no real page yet, so fall back to a placeholder that the chips can show.
 */
export const PLACEHOLDER_URL = 'https://design.local/session';

export function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** A URL safe to send to the host: the workspace's when valid, a placeholder otherwise. */
export function attachUrl(value: string | undefined): string {
  return isHttpUrl(value) ? (value as string) : PLACEHOLDER_URL;
}

/** `foo/bar/baz` → `baz`; tolerates trailing separators and backslashes. */
export function fileBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).pop() || path;
}

/**
 * The workspace's own http(s) url from `.design-studio.json`, or null. Every
 * `attach` chip must carry an http(s) url (a hard host rule), so this is the
 * single gate the composer's `+` sources consult.
 */
export function projectHttpUrl(config: StudioConfig | null | undefined): string | null {
  const url = config?.url?.trim();
  return isHttpUrl(url) ? (url as string) : null;
}

/**
 * The chat chip for a workspace reference. `url` must already be http(s) — callers
 * gate on `projectHttpUrl`. The id is the registered project id when there is one
 * (decision 4c), else the directory's basename, so a second reference replaces
 * the first.
 */
export function projectReferenceChip(input: { projectId?: string | null; dir: string; name: string; url: string }): AttachIssueRequest {
  const handle = input.projectId?.trim() || fileBaseName(input.dir);
  return {
    providerId: 'design-canvas',
    id: `project-${handle}`.slice(0, 110),
    title: input.name,
    url: input.url,
    text: `Workspace reference: ${input.dir}`,
  };
}

/**
 * The chat chip for a FILE reference, built from a PATH the user gave — a file
 * dropped onto the page or a path pasted into the `+` panel. The file's own url
 * is the WORKSPACE's url; the id and title are the basename, so the same file
 * replaces its own chip instead of stacking. Nothing is uploaded — a reference
 * the agent reads from the workspace. `url` must be http(s).
 */
export function fileReferenceChip(input: { path: string; url: string; dropped?: boolean }): AttachIssueRequest {
  const base = fileBaseName(input.path);
  return {
    providerId: 'design-canvas',
    id: `file-${base}`.slice(0, 128),
    title: base,
    url: input.url,
    text: input.dropped
      ? `File reference: ${base} (dropped into Design Canvas)`
      : `File reference: ${input.path}`,
  };
}

/**
 * The next index when an arrow key walks a popover's list, wrapping at both ends.
 */
export function popoverStep(current: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** Storage payload for a canvas session that was started with the mode ON. */
export function seedModeValue(type: DesignType, brief: string, canvMode: CanvasMode = 'edit'): Pick<DesignMode, 'on' | 'type' | 'brief' | 'canvMode'> {
  return { on: true, type, brief: brief.slice(0, 2000), canvMode };
}

/**
 * The `data` payload a page-started canvas session carries on its `startSession`
 * request, shaped exactly like the mode chip's `data` (`buildModeChip`): the
 * session record echoes it back as `items[].data`, where `isModeChipData` reads
 * `data.mode.on` — so a session started from the page is a canvas chat even when
 * the post-session storage writes lose the race against the frame teardown.
 */
export function seedSessionData(
  type: DesignType,
  brief: string,
  workspace: WorkspaceRecord | null = null,
  canvMode: CanvasMode = 'edit',
): { mode: Pick<DesignMode, 'on' | 'type' | 'brief' | 'canvMode'>; workspace: WorkspaceRecord | null } {
  return { mode: seedModeValue(type, brief, canvMode), workspace };
}

export function directionLabel(value: 'auto' | DirectionId): string {
  return value === 'auto' ? 'Auto (infer from the brief)' : DIRECTIONS[value].name;
}

export type DesignBriefSpec = {
  type: DesignType;
  direction: 'auto' | DirectionId;
  fidelity: Fidelity;
  brief: string;
  /**
   * The chosen design-system preset id (see shared/design-systems.ts), or null /
   * omitted for "No design system".
   */
  designSystemId?: string | null;
  /** The user's project directory (read-only design context), when one is open. */
  projectDir?: string | null;
  /** Ask clarifying questions before building (default true). */
  questions?: boolean;
  /** How many directions the user wants, or 'ask' (default). */
  options?: OptionsChoice;
  /** The device artboards to design; omitted = not chosen yet. */
  devices?: DeviceId[];
  /** Where the look comes from: the user's project, the chosen preset, or a new one. */
  look?: DesignLook;
};

export type DesignLook = 'project' | 'preset' | 'new';

const LOOK_HINT: Record<DesignLook, string> = {
  project: "take it from the user's project (its tokens, theme and components)",
  preset: 'use the chosen design-system preset',
  new: 'a new look — propose it first',
};

/** The longest brief the session prompt carries and stays inside its budget. */
export const BRIEF_MAX = 3000;

/** The refusal for a brief over BRIEF_MAX, or null when it fits. */
export function briefLimitError(brief: string): string | null {
  const length = brief.trim().length;
  if (length <= BRIEF_MAX) return null;
  return `The design brief is too long (${length} characters; the limit is ${BRIEF_MAX}). Shorten it, then send again.`;
}

/** The craft rule sections each artifact type ships in its session prompt (budget). */
export const CRAFT_BY_TYPE: Record<DesignType, CraftRuleId[]> = {
  wireframe: ['layout', 'content', 'states', 'laws-of-ux', 'responsive'],
  'hi-fi': ['layout', 'typography', 'color', 'content', 'anti-slop', 'accessibility', 'laws-of-ux', 'responsive'],
  prototype: ['layout', 'typography', 'color', 'content', 'states', 'motion', 'accessibility', 'responsive'],
  deck: ['layout', 'typography', 'color', 'content', 'anti-slop'],
  custom: ['layout', 'typography', 'color', 'content', 'anti-slop', 'accessibility', 'responsive'],
};

/** The fidelity each artifact type implies. */
export const FIDELITY_FOR_TYPE: Record<DesignType, Fidelity> = {
  wireframe: 'wireframe',
  'hi-fi': 'hi-fi',
  prototype: 'interactive',
  deck: 'hi-fi',
  custom: 'hi-fi',
};

/**
 * Lay a free-text brief out as one bullet per line or sentence. It only
 * re-flows what the user wrote — never adds a heading, field or default — and
 * running it on its own output changes nothing.
 */
export function structureBrief(brief: string): string {
  const items: string[] = [];
  for (const raw of brief.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)) {
      const item = sentence.trim();
      if (item) items.push(item);
    }
  }
  return items.map((item) => `- ${item}`).join('\n');
}

/**
 * The workspace rule every prompt repeats (decision 4a): the absolute path is
 * the ONLY place design files are written; every edit/write/bash call uses it.
 */
export function workspacePathRule(dir: string): string {
  return [
    `The workspace's absolute path is ${JSON.stringify(dir)} — it is the ONLY place design files are written.`,
    `Use that absolute path in EVERY file write, edit and bash call you make, because the chat session does NOT run inside the workspace directory.`,
    `Never write design files relative to the chat's own directory, and never create another workspace folder.`,
  ].join(' ');
}

/**
 * The session's first message: what we are making and under which rules, with
 * the absolute workspace path front and centre (decision 4a). Budget: it carries
 * the agreement CHIP + first-reply contract (not the full `workingAgreement`),
 * the identity, authority, the craft subset for the type (CRAFT_BY_TYPE) and
 * VERIFY_PROTOCOL; the mode chip carries only the trimmed rules (audit #16).
 */
export function designSessionPrompt(spec: DesignBriefSpec, workspace: WorkspaceRecord | null): string {
  const brief = spec.brief.trim();
  const preset = findDesignSystem(spec.designSystemId);
  const questions = spec.questions !== false;
  const agreement = { questions: spec.questions, options: spec.options };
  const projectDir = spec.projectDir?.trim();
  const lines: string[] = [
    `Design brief — ${spec.type}: ${TYPE_HINT[spec.type]}`,
    `Visual direction: ${directionLabel(spec.direction)}. Lock it before building.`,
    `Fidelity: ${spec.fidelity} — ${FIDELITY_HINT[spec.fidelity]}.`,
    agreementStatusLine({ questions: spec.questions, options: spec.options, devices: spec.devices }),
  ];
  if (spec.look) lines.push(`Look: ${LOOK_HINT[spec.look]}.`);
  if (projectDir) {
    lines.push(`User project: ${JSON.stringify(projectDir)} — read it first for design context; never write design files there.`);
  }
  lines.push(
    brief
      ? `Brief: ${brief}`
      : questions
        ? 'Brief: none given — ask 3–6 questions with a bold recommended default each, then proceed.'
        : 'Brief: none given — state your assumptions, then build.',
  );
  if (preset) {
    lines.push(
      `Design system: ${preset.name} (${preset.category}) — its tokens and DESIGN.md are authoritative; use them as given and keep every screen inside the system.`,
    );
  }
  lines.push('', IDENTITY, '', workingAgreementChip(agreement), '', firstReplyContract(questions), '');
  if (workspace) {
    lines.push(
      `Design Canvas workspace: ${workspace.dir}`,
      workspacePathRule(workspace.dir),
      '',
      DESIGN_WORKSPACE_NOTE,
      '',
      CANVAS_PROTOCOL,
    );
  } else {
    lines.push(
      'Design Canvas workspace: created by the Design Canvas service before this prompt (ask if the path is missing).',
      '',
      CANVAS_PROTOCOL,
    );
  }
  lines.push(
    '',
    DESIGN_AUTHORITY,
    '',
    defaultCraft(CRAFT_BY_TYPE[spec.type]),
    '',
    'Workflow: in the live canvas (edit mode) the user clicks elements; EACH click arrives as its own reference chip with its screen id. Sending a whole artboard from its menu arrives as a `Screen: <id> (<w>×<h>) — <file>` chip with the screen URL — edit that file.',
    '',
    VERIFY_PROTOCOL,
  );
  return lines.join('\n');
}

/**
 * The prompt a workspace row's "Open" action sends when the workspace has no
 * session yet: open (or re-open) the canvas workspace at its absolute path.
 */
export function workspaceOpenPrompt(workspace: WorkspaceRecord): string {
  return [
    `Design Canvas workspace: ${workspace.dir}`,
    workspacePathRule(workspace.dir),
    '',
    DESIGN_WORKSPACE_NOTE,
    '',
    'Reopening this canvas: open the Design Canvas browser, then read BRIEF.md and DESIGN.md in the workspace first — they hold the agreed devices, look and chosen option. Keep to them; ask before changing any of them. The user will point at elements to change.',
    '',
    IDENTITY,
    '',
    WORKING_AGREEMENT_CHIP,
    '',
    DESIGN_AUTHORITY,
    '',
    VERIFY_PROTOCOL,
  ].join('\n');
}

/**
 * The chip the composer shows while Design Mode is on. Same id → replaces itself.
 * Chip budget (audit #16), in order: mode state → workspace path + screens
 * protocol (the canvas workspace note + the trimmed CANVAS_PROTOCOL lines,
 * SPEC-V3-P2-SCOPE.md D8) → screens id/URL list (cap 40) → TRIMMED rules
 * (IDENTITY + the agreement chip + design-system authority + VERIFY_PROTOCOL only — the craft
 * rulebook and the FULL protocol ship via `designSessionPrompt` instead).
 * Text is capped at `GUEST_ATTACH_TEXT_MAX`.
 */
export function buildModeChip(
  sessionId: string | null,
  mode: DesignMode,
  workspace: WorkspaceRecord | null,
  screens: ReadonlyArray<Pick<ScreenInfo, 'id' | 'file' | 'title'>> = [],
  workspaceUrl?: string | null,
): AttachIssueRequest {
  const id = `design-mode-${(sessionId || 'adhoc').slice(0, 110)}`;
  const lines: string[] = [
    'Design Mode: ON',
    `Canvas mode: ${mode.canvMode}${mode.canvMode === 'edit' ? ' — clicking an element sends a pick chip' : ' — clicks and links drive the screens'}`,
    `Artifact type: ${mode.type} — ${TYPE_HINT[mode.type]}`,
    `Visual direction: ${directionLabel(mode.direction)} · Fidelity: ${mode.fidelity}`,
    agreementStatusLine(mode),
    mode.brief ? `Brief: ${mode.brief}` : 'Brief: the user will say or type it next.',
  ];
  if (workspace) {
    lines.push(
      `Workspace: ${workspace.dir}`,
      workspacePathRule(workspace.dir),
      '',
      DESIGN_WORKSPACE_NOTE,
      '',
      CANVAS_PROTOCOL_CHIP,
    );
  } else {
    lines.push('Workspace: the Design Canvas service creates it on /canvas — do not write design files anywhere else.');
  }
  if (screens.length > 0) {
    const shown = screens.slice(0, MODE_CHIP_SCREEN_CAP);
    lines.push(`Screens (${screens.length}):`);
    for (const screen of shown) lines.push(`- ${screen.id} · ${screen.title || screen.file} · ${screen.file}`);
    if (screens.length > MODE_CHIP_SCREEN_CAP) {
      lines.push(`… ${screens.length - MODE_CHIP_SCREEN_CAP} more — every screen is reachable through the canvas; the full registry is screens.json at the workspace root.`);
    }
  } else {
    lines.push('Screens: none yet — add a screen by writing `<file>.html` and adding `{id, file, title, width, height}` to screens.json at the workspace root.');
  }
  lines.push('', IDENTITY, '', workingAgreementChip({ questions: mode.questions, options: mode.options }), '', DESIGN_AUTHORITY, '', VERIFY_PROTOCOL);
  return {
    providerId: 'design-canvas',
    id,
    title: `Design Mode · ${mode.type}`,
    url: attachUrl(workspaceUrl ?? undefined),
    text: lines.join('\n').slice(0, GUEST_ATTACH_TEXT_MAX),
    data: {
      mode: {
        on: true,
        type: mode.type,
        direction: mode.direction,
        fidelity: mode.fidelity,
        canvMode: mode.canvMode,
        brief: mode.brief.slice(0, 2000),
        ...(mode.questions !== undefined ? { questions: mode.questions } : {}),
        ...(mode.options !== undefined ? { options: mode.options } : {}),
        ...(mode.devices !== undefined ? { devices: mode.devices.slice() } : {}),
      },
      workspace: workspace ? { dir: workspace.dir, name: workspace.name } : null,
      screens: screens.slice(0, MODE_CHIP_SCREEN_CAP).map((screen) => ({
        id: screen.id,
        file: screen.file,
        title: screen.title,
      })),
    },
  };
}

/**
 * The COMPACT mode chip (F7) the row re-attaches with the first pick of every
 * delivered batch while Design Mode is ON. The full `buildModeChip` reaches the
 * model once, at `/canvas`; every later design request was a bare pick chip
 * with no standing instructions. This one is only the load-bearing part — mode
 * ON, the canvas mode, the workspace path + its rule, the screens — and shares
 * the full chip's id, so it REPLACES the composer's mode chip instead of
 * stacking a new one per batch. Same `data` shape, so `isModeChipData` still
 * reads it as a design session.
 */
export function buildCompactModeChip(
  sessionId: string | null,
  mode: DesignMode,
  workspace: WorkspaceRecord,
  screens: ReadonlyArray<Pick<ScreenInfo, 'id' | 'file' | 'title'>> = [],
  workspaceUrl?: string | null,
): AttachIssueRequest {
  const full = buildModeChip(sessionId, mode, workspace, screens, workspaceUrl);
  const lines: string[] = [
    'Design Mode: ON — every pick below is a design request for this workspace.',
    `Canvas mode: ${mode.canvMode} · Artifact type: ${mode.type}`,
    `Workspace: ${workspace.dir}`,
    workspacePathRule(workspace.dir),
    WORKING_AGREEMENT_COMPACT,
  ];
  if (screens.length > 0) {
    const shown = screens.slice(0, MODE_CHIP_SCREEN_CAP);
    lines.push(`Screens (${screens.length}):`);
    for (const screen of shown) lines.push(`- ${screen.id} · ${screen.file}`);
    if (screens.length > MODE_CHIP_SCREEN_CAP) lines.push(`… ${screens.length - MODE_CHIP_SCREEN_CAP} more in screens.json at the workspace root.`);
  }
  return { ...full, text: lines.join('\n').slice(0, GUEST_ATTACH_TEXT_MAX) };
}

// ---- /canvas export (SPEC-V3-P2-SCOPE.md D4/D7-B) ----

/** Preset chars the export summary may spend enumerating file paths. */
const EXPORT_SUMMARY_FILE_CAP = 4;
/** Preset chars the export summary may spend naming failed screens. */
const EXPORT_SUMMARY_FAILURE_CAP = 3;

/**
 * `/canvas export [png|pdf]`: any mix of `png`/`pdf` tokens, in any order
 * (duplicates ignored). No tokens → formats omitted, the service exports both.
 * A non-format token is an actionable error, never a silent brief.
 */
export function parseCanvasExportArgs(raw: string): { formats?: ExportFormat[] } | { error: string } {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return {};
  const formats: ExportFormat[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower !== 'png' && lower !== 'pdf') {
      return { error: `Unknown export format "${token}" — use png, pdf, or both.` };
    }
    if (!(formats as string[]).includes(lower)) formats.push(lower as ExportFormat);
  }
  return { formats };
}

/**
 * A bounded toast summary of a finished (or failed) export job: how many PNG/PDF
 * files landed, their paths, and the per-screen failure count (D4: partial
 * success is a valid outcome — failures are counted, never re-run here). The
 * enumerated file list is capped so the toast stays readable (GUEST_TOAST_MAX).
 */
export function exportJobSummary(status: ExportStatusResult): string[] {
  const pngOk: string[] = [];
  let pdfCount = 0;
  const failedScreens: string[] = [];
  for (const row of status.results ?? []) {
    if (row.png) {
      if (row.png.ok) pngOk.push(row.png.file);
      else if (!failedScreens.includes(row.screen)) failedScreens.push(row.screen);
    }
    if (row.pdf) {
      if (row.pdf.ok) pdfCount += 1;
      else if (!failedScreens.includes(row.screen)) failedScreens.push(row.screen);
    }
  }
  const parts: string[] = [];
  const total = (status.results ?? []).length;
  parts.push(`Export done: ${total} screen${total === 1 ? '' : 's'}`);
  const kinds: string[] = [];
  if (pngOk.length > 0) kinds.push(`${pngOk.length} PNG`);
  if (pdfCount > 0) kinds.push(`${pdfCount} PDF`);
  parts.push(kinds.length > 0 ? kinds.join(' + ') : '0 files');
  if (failedScreens.length > 0) {
    const shown = failedScreens.slice(0, EXPORT_SUMMARY_FAILURE_CAP).join(', ');
    parts.push(`${failedScreens.length} failed (${shown}${failedScreens.length > EXPORT_SUMMARY_FAILURE_CAP ? ', …' : ''})`);
  }
  const lines = [parts.join(' · ')];
  if (pngOk.length > 0) {
    const shown = pngOk.slice(0, EXPORT_SUMMARY_FILE_CAP);
    const more = pngOk.length - shown.length;
    lines.push(`PNG: ${shown.join(', ')}${more > 0 ? `, … +${more} more` : ''}`);
  }
  return lines;
}

/**
 * The toast message for a job that failed outright (state 'failed'): the
 * per-screen failures the service reported, bounded like the summary.
 */
export function exportFailureSummary(status: ExportStatusResult): string {
  const failed = (status.results ?? []).filter((row) => row.png?.ok === false || row.pdf?.ok === false);
  if (failed.length === 0) return 'Export failed.';
  const shown = failed
    .slice(0, EXPORT_SUMMARY_FAILURE_CAP)
    .map((row) => {
      const error = row.png?.ok === false ? row.png.error : row.pdf?.ok === false ? row.pdf.error : undefined;
      return error ? `${row.screen} (${error})` : row.screen;
    })
    .join(', ');
  return `Export failed: ${failed.length} screen${failed.length === 1 ? '' : 's'} — ${shown}${failed.length > EXPORT_SUMMARY_FAILURE_CAP ? ', …' : ''}`;
}

// ---- /canvas critique (SPEC-V3-P2-SCOPE.md D7-C) ----

/**
 * The standing advisory line every critique digest carries: the VERIFY_PROTOCOL
 * clause itself, so the 0–10 critique can never drift from the protocol text.
 */
export const CRITIQUE_ADVISORY =
  'The 0–10 critique is advisory only; never treat it as pass/fail and never optimise for it.';

/**
 * The review-request text for a critique digest (D7-C): the bounded digest the
 * service guarantees, composed table-ish for the chat — header, one line per
 * screen with its gates (≤3 findings each, already bounded service-side), and
 * the standing advisory note. The chip text is capped at
 * `GUEST_COMPOSE_TEXT_MAX` by the caller; the digest is first 12 screens +
 * `truncated` service-side.
 */
export function critiqueReviewText(digest: { screens: CritiqueScreenDigest[]; truncated?: boolean }): string {
  const lines: string[] = ['Canvas critique — deterministic gate digest (advisory):'];
  for (const screen of digest.screens) {
    lines.push(`- ${screen.screen} · ${screen.width}×${screen.height} · ${screen.state === 'ready' ? 'ready' : screen.state} · ${screen.url}`);
    if (screen.gates && screen.gates.length > 0) {
      for (const gate of screen.gates) {
        const findings = (gate.findings ?? []).slice(0, 3).join('; ');
        lines.push(`    ${gate.id}: ${gate.status}${findings ? ` — ${findings}` : ''}`);
      }
    } else {
      lines.push('    no gate findings');
    }
  }
  if (digest.truncated) lines.push('… more screens exist; the digest covers the first 12 (service-bound).');
  lines.push('', CRITIQUE_ADVISORY);
  return lines.join('\n');
}

/**
 * The chat chip `/canvas critique` hands to the composer (D7-C: composed into
 * the chat via the existing compose/attach path as a review REQUEST). Same id
 * per session → a repeated critique replaces its own chip.
 */
export function critiqueReviewChip(
  sessionId: string | null,
  workspaceUrl: string | null | undefined,
  digest: { screens: CritiqueScreenDigest[]; truncated?: boolean },
): AttachIssueRequest {
  const id = `canvas-critique-${(sessionId || 'adhoc').slice(0, 110)}`;
  return {
    providerId: 'design-canvas',
    id,
    title: 'Canvas critique — gate digest',
    url: attachUrl(workspaceUrl ?? undefined),
    text: critiqueReviewText(digest).slice(0, GUEST_COMPOSE_TEXT_MAX),
  };
}