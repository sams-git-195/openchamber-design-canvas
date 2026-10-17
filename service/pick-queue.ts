// The delivery queue behind GET /picks — SPEC-V4-CARBON-PARITY.md V4-5 (E7:
// the panel's 900 ms /state poll lost every second pick inside one interval
// and stalled entirely while the chat tab was hidden).
//
// A bounded ring (cap 50) of QueuedPick entries with a monotonic seq. The
// panel long-polls `GET /picks?since&wait` (wait 0..12000 ms — well under the
// host's 20 s request cap), processes picks in seq order, and acks the last
// seq it consumed. `POST /picks/ack` answers through the shell as a
// "Added to chat" toast; a push that is not acked within 2500 ms answers with
// a WARN toast ("open the chat with Design Mode on") — the user learns the
// delivery died instead of staring at a silent canvas.
//
// The queue is data-only: toasts arrive through the onToast callback the
// Browser wires into `__dsCanvas.showToast` (frozen §3 contract). lastPick /
// pickSeq in the Browser stay byte-compatible for legacy callers; the queue
// seq is its own monotonic counter (never conflated with pickSeq).
import type { PickedElement } from './browser.ts';

/**
 * One queued delivery. `kind:'screen'` picks (V4-10 "send to chat") carry no
 * selector fields — only the artboard identity plus the registry file/size;
 * `kind:'element'` picks carry the full PickedElement payload. `additive` is
 * reserved (shift-click): the panel behaves identically today, the flag lets
 * the agent text say "also".
 */
export type QueuedPick = {
  seq: number;
  kind: 'element' | 'screen';
  screen: string;
  screenUrl: string;
  at: number;
  additive: boolean;
} & Partial<PickedElement> & { width?: number; height?: number; file?: string };

export type PicksPage = { seq: number; picks: QueuedPick[] };

/** Contract V4-5: ring cap 50, at most 20 per response, unacked watchdog 2500 ms. */
export const PICK_QUEUE_CAP = 50;
export const PICKS_PAGE_MAX = 20;
export const PICK_UNACKED_WARN_MS = 2500;
export const PICK_WAIT_MAX_MS = 12_000;
export const PICK_LABEL_MAX = 80;

type Waiter = {
  since: number;
  resolve: (page: PicksPage) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * The bounded FIFO with seq ordering, long-poll waiters and the ack watchdog.
 * All methods are synchronous except `read` (which may wait); safe to call
 * from the CDP event pump.
 */
export class PickQueue {
  private items: QueuedPick[] = [];
  private latest = 0;
  private acked = 0;
  private waiters: Waiter[] = [];
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly emitToast: (kind: 'ok' | 'warn', text: string) => void;

  constructor(onToast: (kind: 'ok' | 'warn', text: string) => void) {
    this.emitToast = onToast;
  }

  /** The newest seq (what /picks reports as `seq` when nothing is newer). */
  get lastSeq(): number {
    return this.latest;
  }

  /**
   * Enqueue a pick (seq assigned here). Resolves waiters, rearms the watchdog.
   * F9 (V4 QA): a CLOSED queue accepts nothing — a binding push racing the
   * window teardown used to re-arm the watchdog on a dead queue (a pointless
   * "Not delivered" warn against a window that is already gone) and mutate the
   * seq the next window's fresh queue starts from. Returns null when dropped.
   */
  push(pick: Omit<QueuedPick, 'seq'>): QueuedPick | null {
    if (this.closed) return null;
    const entry: QueuedPick = { ...pick, seq: ++this.latest };
    this.items.push(entry);
    if (this.items.length > PICK_QUEUE_CAP) this.items.splice(0, this.items.length - PICK_QUEUE_CAP);
    this.flushWaiters();
    this.rearmWatchdog();
    return entry;
  }

  /**
   * Picks with seq > since (oldest first, ≤ 20). `waitMs > 0` long-polls:
   * resolves at the first push after `since`, else at the wait deadline with
   * whatever it has (possibly empty). Clamped to 0..PICK_WAIT_MAX_MS.
   */
  read(since: number, waitMs = 0): Promise<PicksPage> {
    const immediate = this.pageSince(since);
    if (immediate.length > 0 || waitMs <= 0) {
      return Promise.resolve({ seq: this.latest, picks: immediate });
    }
    return new Promise<PicksPage>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.timer !== timer);
        resolve({ seq: this.latest, picks: this.pageSince(since) });
      }, Math.min(waitMs, PICK_WAIT_MAX_MS));
      timer.unref?.();
      this.waiters.push({ since, resolve, timer });
    });
  }

  /**
   * Record the panel's consumption of everything up to `seq`. The toast rides
   * the same `showToast` channel; a stale/lower seq is ignored (never rewinds).
   */
  ack(seq: number, label: string): void {
    if (!Number.isInteger(seq) || seq < 0) return;
    if (seq <= this.acked) return;
    this.acked = Math.max(this.acked, Math.min(seq, this.latest));
    this.emitToast('ok', `Added to chat · ${label.slice(0, PICK_LABEL_MAX)}`);
    if (this.acked >= this.latest) this.clearWatchdog();
  }

  /** Stop timers/waiters (browser teardown); pending long-polls resolve empty. */
  close(): void {
    this.closed = true;
    this.clearWatchdog();
    const pending = this.waiters;
    this.waiters = [];
    for (const waiter of pending) {
      clearTimeout(waiter.timer);
      waiter.resolve({ seq: this.latest, picks: [] });
    }
  }

  private pageSince(since: number): QueuedPick[] {
    return this.items.filter((pick) => pick.seq > since).slice(0, PICKS_PAGE_MAX);
  }

  private flushWaiters(): void {
    const still: Waiter[] = [];
    for (const waiter of this.waiters) {
      const picks = this.pageSince(waiter.since);
      if (picks.length === 0) {
        still.push(waiter);
        continue;
      }
      clearTimeout(waiter.timer);
      waiter.resolve({ seq: this.latest, picks });
    }
    this.waiters = still;
  }

  private rearmWatchdog(): void {
    this.clearWatchdog();
    const target = this.latest;
    const timer = setTimeout(() => {
      this.watchdog = null;
      if (!this.closed && this.acked < target) {
        this.emitToast('warn', 'Not delivered — open the chat with Design Mode on');
      }
    }, PICK_UNACKED_WARN_MS);
    timer.unref?.();
    this.watchdog = timer;
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }
}
