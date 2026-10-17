import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  emptyView,
  mergeView,
  mergeViewCoalesced,
  readView,
  sanitizeCamera,
  sanitizePosition,
  validateViewPatch,
  ViewPatchError,
  VIEW_FILENAME,
  VIEW_STATE_DIR,
} from '../service/view-state.ts';
import { readScreens, writeScreens } from '../service/screens.ts';

async function tempDir(label: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `ds-view-${label}-`));
}

const viewPath = (dir: string): string => path.join(dir, VIEW_STATE_DIR, VIEW_FILENAME);

test('readView: missing and corrupt files read as the empty default', async () => {
  const dir = await tempDir('read');
  try {
    assert.deepEqual(await readView(dir), emptyView(), 'a missing view.json is the empty default');
    await mkdir(path.join(dir, VIEW_STATE_DIR), { recursive: true });
    await writeFile(viewPath(dir), '{not json', 'utf8');
    assert.deepEqual(await readView(dir), emptyView(), 'corrupt JSON is the empty default');
    await writeFile(viewPath(dir), JSON.stringify({ version: 1, camera: 'nope', positions: 'x', mode: 'play' }), 'utf8');
    const sanitized = await readView(dir);
    assert.equal(sanitized.mode, 'play', 'a valid mode survives');
    assert.equal(sanitized.camera, null, 'a non-object camera is dropped');
    assert.deepEqual(sanitized.positions, {}, 'a non-object positions map is dropped');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readView sanitizes silently: bad ids dropped, positions clamped, camera clamped', async () => {
  const dir = await tempDir('sanitize');
  try {
    await mkdir(path.join(dir, VIEW_STATE_DIR), { recursive: true });
    await writeFile(
      viewPath(dir),
      JSON.stringify({
        version: 1,
        camera: { mode: 'manual', scale: 0.0001, panX: 12, panY: -4 },
        positions: { home: { x: 12, y: 300 }, BAD: { x: 1, y: 2 }, 'way-out': { x: 1e9, y: -1e9 }, nulled: null },
        mode: 'edit',
      }),
      'utf8',
    );
    const view = await readView(dir);
    assert.equal(view.camera?.mode, 'manual');
    assert.equal(view.camera?.scale, 0.1, 'scale clamps to the 0.1–3 zoom range');
    assert.deepEqual(view.positions, {
      home: { x: 12, y: 300 },
      'way-out': { x: 32768, y: -32768 },
      nulled: null,
    }, 'invalid ids drop; positions clamp to ±32768; null survives as auto-grid');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeView merges per key, is serialized per dir, and heals a corrupt file', async () => {
  const dir = await tempDir('merge');
  try {
    // A corrupt file is healed by the first merge (silent-normalize writes it back).
    await mkdir(path.join(dir, VIEW_STATE_DIR), { recursive: true });
    await writeFile(viewPath(dir), 'corrupt', 'utf8');
    const first = await mergeView(dir, { positions: { home: { x: 1, y: 2 } }, mode: 'play' });
    assert.deepEqual(first.positions.home, { x: 1, y: 2 });
    assert.equal(first.mode, 'play');
    const onDisk = JSON.parse(await readFile(viewPath(dir), 'utf8')) as { version: number };
    assert.equal(onDisk.version, 1, 'the healed file is valid JSON');

    // Per-key merge: a second merge never clobbers keys the first one set.
    // FIX-3 (F15): a null position DELETES its key (no `"id": null` residue);
    // readers stay null-tolerant for files old builds wrote (sanitizeView pin
    // above).
    const second = await mergeView(dir, { positions: { checkout: { x: 9, y: 9 }, home: null } });
    assert.deepEqual(second.positions, { checkout: { x: 9, y: 9 } }, 'F15: null deleted the home key');
    assert.equal('home' in second.positions, false, 'no null residue on disk');
    assert.equal(second.mode, 'play', 'the camera-less merge leaves the persisted mode alone');

    // Serialization: 20 rapid merges to the same dir apply in call order.
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => mergeView(dir, { camera: { mode: 'manual', scale: 1, panX: index, panY: 0 } })),
    );
    const final = await readView(dir);
    assert.equal(final.camera?.panX, 19, 'the last queued merge wins (per-dir promise chain)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed merge never poisons the per-dir chain', async () => {
  const dir = await tempDir('poison');
  try {
    // Block writes: .design-studio exists as a FILE, so mkdir refuses.
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, VIEW_STATE_DIR), 'not a directory', 'utf8');
    await assert.rejects(() => mergeView(dir, { mode: 'play' }), /EEXIST|ENOTDIR|exist/, 'the write fails honestly');
    await rm(path.join(dir, VIEW_STATE_DIR), { force: true });
    // The chain survives: a later merge succeeds and heals the state.
    const view = await mergeView(dir, { mode: 'edit', positions: { home: { x: 1, y: 1 } } });
    assert.equal(view.mode, 'edit');
    assert.deepEqual((await readView(dir)).positions.home, { x: 1, y: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeViewCoalesced collapses a camera burst into one write after 300 ms', async () => {
  const dir = await tempDir('coalesce');
  try {
    const bust: Promise<unknown>[] = [];
    for (let index = 0; index < 12; index += 1) {
      bust.push(mergeViewCoalesced(dir, { camera: { mode: 'manual', scale: 1, panX: index, panY: 0 } }));
    }
    await Promise.all(bust);
    const view = await readView(dir);
    assert.equal(view.camera?.panX, 11, 'only the last camera of the burst is persisted');
    const entries = await readdir(path.join(dir, VIEW_STATE_DIR));
    assert.deepEqual(entries, [VIEW_FILENAME], 'no tmp files linger after coalesced writes');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('atomic writes leave no tmp files behind, even after rapid merges', async () => {
  const dir = await tempDir('atomic');
  try {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        mergeView(dir, { positions: { [`s${index}`]: { x: index, y: -index } } }),
      ),
    );
    assert.deepEqual(await readdir(path.join(dir, VIEW_STATE_DIR)), [VIEW_FILENAME]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sanitizeCamera accepts fit/manual/fit-all shell cameras and rejects junk', () => {
  assert.deepEqual(sanitizeCamera({ mode: 'manual', scale: 2, panX: 1, panY: 2 }), { mode: 'manual', scale: 2, panX: 1, panY: 2 });
  assert.equal(sanitizeCamera({ mode: 'fit-all', scale: 1, panX: 0, panY: 0 })?.mode, 'fit-all', 'the shell camera union includes fit-all');
  assert.equal(sanitizeCamera({ mode: 'manual', scale: 0.5, panX: 0 }), null, 'missing keys refuse');
  assert.equal(sanitizeCamera({ mode: 'manual', scale: NaN, panX: 0, panY: 0 }), null, 'non-finite scale refuses');
  assert.equal(sanitizeCamera('zoom'), null);
});

test('sanitizePosition is finite + clamped; null stays null', () => {
  assert.deepEqual(sanitizePosition({ x: 3, y: -4 }), { x: 3, y: -4 });
  assert.deepEqual(sanitizePosition({ x: 1e9, y: -1e9 }), { x: 32768, y: -32768 });
  assert.equal(sanitizePosition({ x: '1', y: 2 }), null);
  assert.equal(sanitizePosition(null), null);
});

test('validateViewPatch: strict route validation with actionable errors', () => {
  const good = validateViewPatch({ camera: { mode: 'manual', scale: 1.2, panX: 0, panY: 0 } });
  assert.deepEqual(good, { camera: { mode: 'manual', scale: 1.2, panX: 0, panY: 0 } });
  assert.deepEqual(validateViewPatch({ positions: { home: null, 'other-1': { x: -5, y: 5 } }, mode: 'play' }), {
    positions: { home: null, 'other-1': { x: -5, y: 5 } },
    mode: 'play',
  });
  for (const bad of [
    null,
    'camera',
    {},
    { camera: { mode: 'warp', scale: 1, panX: 0, panY: 0 } },
    { positions: 'nope' },
    { positions: { BAD: { x: 1, y: 2 } } },
    { positions: { home: { x: Infinity, y: 2 } } },
    { mode: 'sideways' },
  ] as Array<unknown>) {
    assert.throws(() => validateViewPatch(bad), ViewPatchError, `patch ${JSON.stringify(bad)} is refused`);
  }
});

test('D6/D10 contention: two writers, two files — view merges never touch screens.json', async () => {
  const dir = await tempDir('contend');
  try {
    // The agent writes the full registry (screens.json)…
    await writeScreens(dir, { version: 1, screens: [{ id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 }] });
    // …while the user's drag writes view.json positions.
    await mergeView(dir, { positions: { home: { x: 4, y: 5 } }, mode: 'play' });
    // An agent registry append during the "drag" loses nothing: the two files
    // are independent (per-key last-write-wins applies per file only).
    await writeScreens(dir, {
      version: 1,
      screens: [
        { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
        { id: 'pay', file: 'pay.html', title: 'Pay', width: 390, height: 844 },
      ],
    });
    const view = await readView(dir);
    assert.deepEqual(view.positions.home, { x: 4, y: 5 }, 'the drag position survived the agent write');
    assert.equal(view.mode, 'play');
    const screens = await readScreens(dir);
    assert.equal(screens.screens.length, 2, 'the agent registry append survived the drag');
    // D10 purity: positions live ONLY in view.json — the registry text never
    // carries x/y even though the service merged positions while the registry
    // file existed beside it.
    const registryText = await readFile(path.join(dir, 'screens.json'), 'utf8');
    assert.equal(/[xy]":\s/.test(registryText), false, 'screens.json never carries x/y');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});