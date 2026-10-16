// The attach payload builder for picked elements.
//
// The former attach-dialog mode (the composer "+" menu) was removed: Design
// Mode is started with the `/canvas` command inside the target chat, whose
// hidden resolve frame doubles as the pick→chat bridge (see panel/main.ts).
// What stays here is the chip handed to `host.attach` for a picked element —
// the SAME shape every pick path sends, so a chip is indistinguishable
// regardless of which window picked it.
import type { AttachIssueRequest, JsonValue } from '@openchamber/sdk';

import { referenceText, type PickPayload } from './api.ts';

/**
 * The screen a pick landed on (spec §F pick-chip payload): its id and URL ride
 * on the chip's text and data.
 */
export type PickScreen = { id: string; url: string };

/**
 * The chip handed to `host.attach` for a picked element — the SAME shape
 * `addToChat` sends from the panel's live pick pipeline, so a picked-element
 * chip is identical no matter which window picked it. `screen` adds the
 * `Screen: <id>` line, the screen's URL and the `data.screen` fields.
 */
export function buildAttachPayload(
  pick: PickPayload,
  seq: number,
  url: string,
  pickedAt: Date,
  screen?: PickScreen,
): AttachIssueRequest {
  const data: { selector: string; tag: string; classes: string; snippet: string; styles: Record<string, string>; url: string; screen?: string; screenUrl?: string } = {
    selector: pick.selector,
    tag: pick.tag,
    classes: pick.classes,
    snippet: pick.outerHTML,
    styles: pick.styles,
    url,
  };
  if (screen) {
    data.screen = screen.id;
    data.screenUrl = screen.url;
  }
  return {
    providerId: 'design-canvas',
    id: `element-${seq}`,
    title: pick.selector,
    url,
    text: referenceText(pick, url, pickedAt, screen),
    data: data as unknown as JsonValue,
  };
}