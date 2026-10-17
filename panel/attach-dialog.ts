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

import { referenceText, screenReferenceText, type QueuedPick } from './api.ts';

/**
 * The screen a pick landed on (spec §F pick-chip payload): its id and URL ride
 * on the element chip's text and data. Kept for the shared chip vocabulary.
 */
export type PickScreen = { id: string; url: string };

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
 * Each pick gets its own chip id (`element-<seq>` / `screen-<seq>`): the queue
 * guarantees delivery of EVERY pick, so two rapid picks are two chips, never a
 * replace.
 */
export function buildAttachPayload(pick: QueuedPick): AttachIssueRequest {
  if (pick.kind === 'screen') {
    const pickedAt = Number.isFinite(pick.at) ? new Date(pick.at) : undefined;
    return {
      providerId: 'design-canvas',
      id: `screen-${pick.seq}`,
      title: `Screen · ${pick.screen}`,
      url: pick.screenUrl,
      text: screenReferenceText(pick, pickedAt),
      data: {
        screen: pick.screen,
        screenUrl: pick.screenUrl,
        width: pick.width,
        height: pick.height,
        file: pick.file,
        url: pick.screenUrl,
      } as unknown as JsonValue,
    };
  }
  const url = pick.screenUrl;
  const screen = pick.screen ? { id: pick.screen, url } : undefined;
  const pickedAt = Number.isFinite(pick.at) ? new Date(pick.at) : undefined;
  const data: { selector: string; tag: string; classes: string; snippet: string; styles: Record<string, string>; url: string; screen?: string; screenUrl?: string } = {
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
  return {
    providerId: 'design-canvas',
    id: `element-${pick.seq}`,
    title: pick.selector ?? '',
    url,
    text: referenceText(
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
    ),
    data: data as unknown as JsonValue,
  };
}
