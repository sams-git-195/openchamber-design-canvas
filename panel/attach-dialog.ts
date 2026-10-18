// The attach payload builder for picks arriving on the pick queue.
//
// The former attach-dialog mode (the composer "+" menu) was removed: Design
// Mode is started with the `/canvas` command inside the target chat. Since
// SPEC-V4 V4-5 every pick — element clicks and V4-10 artboard-menu "Send to
// chat" events — arrives as a `QueuedPick` from `GET /picks`, and this builder
// turns one into the chip handed to `host.attach`. The SAME shape every pick
// path sends, so a chip is indistinguishable regardless of which window picked
// it: `kind:'element'` keeps the full element payload; `kind:'screen'` is the
// screen-level chip (title + url + file path — no selector/styles block).
import type { AttachIssueRequest, JsonValue } from '@openchamber/sdk';

import { referenceText, screenReferenceText, workspaceFilePath, type PickPayload, type QueuedPick } from './api.ts';
import { GUEST_ATTACH_TEXT_MAX, workspacePathRule } from './mode.ts';

/**
 * The screen a pick landed on (spec §F pick-chip payload): its id and URL ride
 * on the element chip's text and data. Kept for the shared chip vocabulary.
 */
export type PickScreen = { id: string; url: string };

/**
 * Where a pick lives on disk (F6). Without it a chip names only a selector and
 * a dev-server URL, and the model — whose chat does NOT run inside the
 * workspace — has no file it can edit. The row supplies its bound workspace
 * dir and the live screens (`/state.screens`) so a screen id maps to a file.
 */
export type PickContext = {
  workspaceDir: string;
  screens?: ReadonlyArray<{ id: string; url: string }>;
};

/** A dev-server URL's path as a workspace-relative file (`/` → `index.html`). */
function fileFromUrl(raw: string): string | null {
  try {
    const pathname = decodeURIComponent(new URL(raw).pathname).replace(/^\/+/, '');
    return pathname === '' ? 'index.html' : pathname;
  } catch {
    return null;
  }
}

/**
 * The absolute file behind a pick: a screen pick names its registry file (the
 * service resolves it absolute); an element pick maps its screen id through the
 * live screens, falling back to the pick's own screen URL path — the dev server
 * serves the workspace root, so the URL path IS the workspace-relative file.
 */
export function pickFilePath(pick: QueuedPick, context: PickContext): string | null {
  if (pick.kind === 'screen' && typeof pick.file === 'string' && pick.file.trim() !== '') {
    return workspaceFilePath(context.workspaceDir, pick.file);
  }
  const screen = context.screens?.find((candidate) => candidate.id === pick.screen);
  const file = (screen ? fileFromUrl(screen.url) : null) ?? (pick.screenUrl ? fileFromUrl(pick.screenUrl) : null);
  return file ? workspaceFilePath(context.workspaceDir, file) : null;
}

/**
 * The F6 location block: `Workspace:`, `File:` and the SAME absolute-path rule
 * the mode chip carries (`workspacePathRule`), so every pick tells the model
 * where to write — not only the one-time mode chip.
 */
export function pickLocationLines(pick: QueuedPick, context: PickContext | null | undefined): string[] {
  const dir = context?.workspaceDir?.trim();
  if (!context || !dir) return [];
  const file = pickFilePath(pick, context);
  return [
    `Workspace: ${dir}`,
    ...(file ? [`File: ${file}`] : []),
    workspacePathRule(dir),
  ];
}

const TRUNCATED_MARKUP = '<!-- markup truncated to fit the chat chip -->';

/**
 * The element chip text, kept under the host's attach cap. The markup block is
 * the only unbounded part, so it shrinks first; the styles go next; the hard
 * slice is the last resort. The location block sits ABOVE both, so trimming
 * never costs the model its file path.
 */
function boundedElementText(pick: PickPayload, url: string, pickedAt: Date | undefined, screen: PickScreen | undefined, location: string[]): string {
  const full = referenceText(pick, url, pickedAt, screen, location);
  if (full.length <= GUEST_ATTACH_TEXT_MAX) return full;
  const overflow = full.length - GUEST_ATTACH_TEXT_MAX;
  const keep = Math.max(0, pick.outerHTML.length - overflow - TRUNCATED_MARKUP.length - 1);
  const trimmedMarkup = { ...pick, outerHTML: `${pick.outerHTML.slice(0, keep)}\n${TRUNCATED_MARKUP}` };
  const shorter = referenceText(trimmedMarkup, url, pickedAt, screen, location);
  if (shorter.length <= GUEST_ATTACH_TEXT_MAX) return shorter;
  const noStyles = referenceText({ ...trimmedMarkup, outerHTML: TRUNCATED_MARKUP, styles: {} }, url, pickedAt, screen, location);
  return noStyles.slice(0, GUEST_ATTACH_TEXT_MAX);
}

/**
 * The chip handed to `host.attach` for one queued pick (V4-5/V4-10).
 *
 * `kind:'element'` — the exact chip shape every element-pick path has always
 * sent (selector title, element payload data), with the `Screen:`/`Screen
 * URL:` lines from the queue entry's own `screen`/`screenUrl`.
 *
 * `kind:'screen'` — the artboard-menu chip: `Screen: <id> (<w>×<h>) — <file>`
 * plus `Screen URL:` in the text, size and file in the data, and NO selector,
 * styles or markup block (spec §V4-10).
 *
 * `context` (F6) adds `Workspace:` / `File:` lines + the path rule to either
 * kind, and the same two paths to `data`, when the row knows its workspace.
 *
 * Each pick gets its own chip id (`element-<seq>` / `screen-<seq>`): the queue
 * guarantees delivery of EVERY pick, so two rapid picks are two chips, never a
 * replace.
 */
export function buildAttachPayload(pick: QueuedPick, context?: PickContext | null): AttachIssueRequest {
  const location = pickLocationLines(pick, context);
  const workspaceDir = location.length > 0 ? context!.workspaceDir.trim() : null;
  const filePath = workspaceDir ? pickFilePath(pick, context!) : null;
  if (pick.kind === 'screen') {
    const pickedAt = Number.isFinite(pick.at) ? new Date(pick.at) : undefined;
    return {
      providerId: 'design-canvas',
      id: `screen-${pick.seq}`,
      title: `Screen · ${pick.screen}`,
      url: pick.screenUrl,
      text: screenReferenceText(pick, pickedAt, location).slice(0, GUEST_ATTACH_TEXT_MAX),
      data: {
        screen: pick.screen,
        screenUrl: pick.screenUrl,
        width: pick.width,
        height: pick.height,
        file: pick.file,
        url: pick.screenUrl,
        ...(workspaceDir ? { workspace: workspaceDir } : {}),
        ...(filePath ? { filePath } : {}),
      } as unknown as JsonValue,
    };
  }
  const url = pick.screenUrl;
  const screen = pick.screen ? { id: pick.screen, url } : undefined;
  const pickedAt = Number.isFinite(pick.at) ? new Date(pick.at) : undefined;
  const data: { selector: string; tag: string; classes: string; snippet: string; styles: Record<string, string>; url: string; screen?: string; screenUrl?: string; workspace?: string; filePath?: string } = {
    selector: pick.selector ?? '',
    tag: pick.tag ?? '',
    classes: pick.classes ?? '',
    snippet: pick.outerHTML ?? '',
    styles: pick.styles ?? {},
    url,
  };
  if (screen) {
    data.screen = screen.id;
    data.screenUrl = screen.url;
  }
  if (workspaceDir) data.workspace = workspaceDir;
  if (filePath) data.filePath = filePath;
  return {
    providerId: 'design-canvas',
    id: `element-${pick.seq}`,
    title: pick.selector ?? '',
    url,
    text: boundedElementText(
      {
        selector: pick.selector ?? '',
        tag: pick.tag ?? '',
        classes: pick.classes ?? '',
        text: pick.text ?? '',
        outerHTML: pick.outerHTML ?? '',
        styles: pick.styles ?? {},
        rect: pick.rect ?? { x: 0, y: 0, width: 0, height: 0 },
      },
      url,
      pickedAt,
      screen,
      location,
    ),
    data: data as unknown as JsonValue,
  };
}
