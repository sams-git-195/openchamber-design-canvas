// Live registry watching — SPEC-V4-CARBON-PARITY.md V4-4 (E6: agent-written
// screens never appeared until a manual reopen; E11: a malformed screens.json
// was swallowed in silence).
//
// `watchRegistry(dir, onChange)` watches ONE workspace's `screens.json` while
// its canvas is open: an fs.watch on the directory (filtered to the registry
// file, non-recursive, non-persistent) PLUS a 2000 ms `fs.stat` mtime poll,
// because OneDrive/network roots make fs.watch unreliable (the poll is the
// backstop, the watch is the fast path). Ticks debounce 250 ms so a tmp+rename
// writer — screens.ts's own write path included — delivers once.
//
// Every emitted change is a readScreensStrict result: `{ok:true, registry,
// dropped}` or `{ok:false, error}`. Any watch/poll error is swallowed (V4-15:
// a broken fs.watch degrades to poll-only, never kills the service).
import { watch, promises as fs, type FSWatcher } from 'node:fs';
import path from 'node:path';

import { readScreensStrict, SCREENS_FILENAME, type StrictRegistryRead } from './screens.ts';

export type RegistryChange = StrictRegistryRead;

/** fs.watch is the fast path; this poll is the OneDrive/network-root backstop. */
const POLL_MS = 2000;
/** Debounce window per V4-4 (a burst of watch events delivers one read). */
const DEBOUNCE_MS = 250;

/**
 * Watch `dir`'s screens.json and call `onChange` with the strict re-read on
 * every settled change. Returns the stop function (idempotent).
 */
export function watchRegistry(dir: string, onChange: (change: RegistryChange) => void): () => void {
  const root = path.resolve(dir);
  const file = path.join(root, SCREENS_FILENAME);
  let closed = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let watcher: FSWatcher | null = null;
  let lastMtimeMs = -1;
  let lastReadFailed = false;
  // One in-flight read at a time; a change that lands mid-read re-runs after.
  let reading: Promise<void> | null = null;
  let rereadQueued = false;

  const run = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (reading) {
      rereadQueued = true;
      return reading;
    }
    reading = (async () => {
      do {
        rereadQueued = false;
        let change: RegistryChange;
        try {
          change = await readScreensStrict(root);
        } catch (error) {
          // readScreensStrict answers {ok:false} for parse/IO failures itself;
          // anything throwing here is a watcher-side surprise — swallow, keep
          // the watcher alive, and let the next poll retry (V4-15).
          lastReadFailed = true;
          void error;
          break;
        }
        // Re-statement after the read so the poll compares against THIS read's
        // version; a write during the read set rereadQueued and re-runs below.
        lastMtimeMs = await fs.stat(file).then((s) => s.mtimeMs).catch(() => -1);
        lastReadFailed = !change.ok;
        if (!closed) onChange(change);
      } while (!closed && rereadQueued);
    })().finally(() => {
      reading = null;
    });
    return reading;
  };

  const schedule = (): void => {
    if (closed) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void run();
    }, DEBOUNCE_MS);
    // Never hold the event loop open for a pending tick.
    debounce.unref?.();
  };

  try {
    watcher = watch(root, { persistent: false }, (_event, filename) => {
      if (closed) return;
      // Filter to the registry file; a null filename (some platforms never
      // report one) is treated as "something changed" and debounces through
      // the strict read anyway.
      if (filename === null || String(filename) === SCREENS_FILENAME) schedule();
    });
    watcher.on('error', () => {
      /* V4-15: a broken fs.watch (EMFILE, unwatched root) degrades to poll-only */
    });
  } catch {
    /* watch unsupported on this root: poll only */
  }

  // Seed the mtime baseline so the first poll tick means a REAL change.
  void fs.stat(file).then((s) => { if (!closed) lastMtimeMs = s.mtimeMs; }, () => undefined);

  pollTimer = setInterval(() => {
    if (closed) return;
    void fs.stat(file).then(
      (stat) => {
        if (closed) return;
        if (lastReadFailed || stat.mtimeMs !== lastMtimeMs) schedule();
      },
      () => {
        // The registry vanished. Deleting it IS a change (the strict read
        // answers the empty registry per §A); the baseline reset makes a
        // later reappearance change once more.
        if (!closed && (lastMtimeMs !== -1 || lastReadFailed)) {
          lastMtimeMs = -1;
          lastReadFailed = false;
          schedule();
        }
      },
    );
  }, POLL_MS);
  pollTimer.unref?.();

  return () => {
    if (closed) return;
    closed = true;
    if (debounce) clearTimeout(debounce);
    debounce = null;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    try {
      watcher?.close();
    } catch {
      /* already closed */
    }
    watcher = null;
  };
}
