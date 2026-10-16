import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseManifestJson } from '@openchamber/sdk/schemas';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('package.json carries a valid OpenChamber manifest', async () => {
  const json = await readFile(path.join(root, 'package.json'), 'utf8');
  const result = parseManifestJson(json) as { ok: boolean; error?: string; manifest?: unknown };
  assert.equal(result.ok, true, `manifest rejected: ${result.error ?? 'unknown'}`);
});

test('the npm package and manifest identity changed to the Design Canvas fork', async () => {
  const json = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { name: string; version: string };
  assert.equal(json.name, 'openchamber-design-canvas');
  assert.equal(json.version, '0.2.0');
});

// The surface stays thin, but `panel.entry` is required because the SDK only
// accepts `page`, `commands` and `statusSection`'s frame beside it — they carry
// the full-screen page and the `/canvas` slash command.
test('declared entries match the shipped files: panel row, page, command and status section', async () => {
  const json = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
    openchamber: {
      contributes?: {
        panel?: { id: string; name?: string; icon?: string; entry?: string; dock?: string; size?: number };
        page?: unknown;
        attach?: { mode?: string; entry?: string };
        capabilities?: string[];
        commands?: { name: string; description?: string }[];
        statusSection?: { entry?: string; title?: string; requiresProject?: boolean; defaultExpanded?: boolean; height?: number };
        service?: { entry: string; runtime: string; surface?: boolean; provides?: string[] };
      };
    };
  };
  const contributes = json.openchamber.contributes!;

  // Fork identity (decision 1): extension id design-canvas.
  assert.equal(contributes.panel?.id, 'design-canvas');
  assert.equal(contributes.panel?.name, 'Design Canvas');
  assert.equal(contributes.panel?.entry, 'panel/index.html', 'panel.entry carries page + commands');
  // dock/size only make sense beside a shared service surface, which we do not ship.
  assert.equal(contributes.panel?.dock, undefined, 'no dock without service.surface');
  assert.equal(contributes.panel?.size, undefined, 'no size without service.surface');

  // The `/canvas` slash command replaces `/design` (decision 1).
  assert.deepEqual(contributes.commands, [
    { name: 'canvas', description: 'Start or toggle the design canvas and attach design context' },
  ]);
  assert.equal(contributes.attach, undefined, 'the attach dialog contribution is removed');

  // The chat Work Status section still reuses the same page — but it no longer
  // requires a registered project (decision 2).
  assert.equal(contributes.statusSection?.entry, 'panel/index.html');
  assert.equal(contributes.statusSection?.title, 'Canvas');
  assert.equal(contributes.statusSection?.requiresProject, false, 'the canvas works in any chat, project or not');
  assert.equal(contributes.statusSection?.defaultExpanded, true);
  assert.equal(typeof contributes.statusSection?.height, 'number', 'a compact height is declared');

  // The service this host starts to own the real Chrome window.
  assert.equal(contributes.service?.runtime, 'host');
  assert.equal(contributes.service?.surface, undefined);
  assert.ok(contributes.service?.provides?.includes('browser'), 'service provides the browser role');
  assert.ok(contributes.capabilities?.includes('sessions'), 'declares the sessions capability');
  assert.ok(contributes.capabilities?.includes('prompt'), 'declares the prompt capability');

  // The full-screen sidebar page reuses the panel page (decision 1).
  assert.deepEqual(contributes.page, { entry: 'panel/index.html', title: 'Design Canvas' });

  // The built bundles must exist: OpenChamber never compiles extension code.
  await assert.doesNotReject(readFile(path.join(root, 'panel', 'main.js')));
  await assert.doesNotReject(readFile(path.join(root, 'service', 'main.js')));
});

// The installed SDK makes contributes.panel a required key; a manifest without
// it is rejected. This pins why the identity panel stays (only its entry is
// dropped) rather than the whole panel being removed.
test('the SDK requires contributes.panel, so only its entry can be dropped', () => {
  const withoutPanel = JSON.stringify({
    openchamber: {
      apiVersion: 1,
      contributes: {
        statusSection: { entry: 'panel/index.html', title: 'Canvas', requiresProject: false },
        service: { entry: 'service/main.js', runtime: 'host', provides: ['browser'] },
      },
    },
  });
  const result = parseManifestJson(withoutPanel) as { ok: boolean; code?: string };
  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing-panel');
});

// Decision 10: no ids/commands/rails may collide with the original design-studio
// extension, so both can be installed at the same time (the README documents the
// browser-provider arbitration caveat).
test('no id, command or statusSection rail collides with the original design-studio', async () => {
  const json = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
    name: string;
    openchamber: { contributes: { panel: { id: string }; commands: { name: string }[]; statusSection: { title: string } } };
  };
  assert.notEqual(json.openchamber.contributes.panel.id, 'design-studio');
  assert.deepEqual(json.openchamber.contributes.commands.map((command) => command.name), ['canvas'], 'no /design command remains');
  assert.notEqual(json.openchamber.contributes.statusSection.title, 'Design Mode');
  assert.notEqual(json.name, 'openchamber-design-studio');
});