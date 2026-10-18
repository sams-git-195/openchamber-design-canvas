// The async /export job — SPEC-V3-P2-SCOPE.md D4.
//
// POST /export cannot be synchronous: panel→service rides `host.serviceRequest`
// (20 s cap, 256 000-char response cap) and a 12-screen PNG+PDF walk blows it.
// So the route starts (or joins) a SINGLE-SLOT module-memory job and the panel
// polls /export/status. Business failures are `{ok:false,error}` — the job
// itself records per-screen outcomes and only dies on a job-level failure.
//
// Files land at `<workspace>/exports/<screenId>.png` / `.pdf` (mkdir -p,
// overwrite allowed — git is the history layer), each written tmp+rename so a
// crash never leaves a half image. Overwriting is allowed: a re-export
// replaces the previous artifact.
//
// PNG = the existing shell capture trio, one capture per screen at its NATURAL
// artboard size (D2). PDF = `Browser.printScreenToPdf` on a hidden throwaway
// page target in the same Chrome (D3). A screen whose per-artboard state is
// `error` is skipped with `screen not loaded`; the job continues (partial
// success is a valid outcome).
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Browser } from './browser.ts';

export type ExportFormat = 'png' | 'pdf';
export type FileResult = { ok: true; file: string } | { ok: false; error: string };
export type ExportResultEntry = { screen: string; png?: FileResult; pdf?: FileResult };

/** One screen as export.ts consumes it: resolved URL + natural size + state. */
export type ExportScreen = {
  id: string;
  url: string;
  width: number;
  height: number;
  state: 'loading' | 'ready' | 'error';
  message?: string;
};

export type ExportJob = {
  id: string;
  dir: string;
  screens: ExportScreen[];
  formats: ExportFormat[];
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  results: ExportResultEntry[];
  error?: string;
};

export type ExportStart = {
  ok: true;
  jobId: string;
  screens: number;
  formats: ExportFormat[];
  /** true when an already-running job was joined instead of started. */
  joined?: boolean;
};

export type ExportStatus = {
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  results: ExportResultEntry[];
  error?: string;
};

const EXPORTS_DIRNAME = 'exports';
const ALL_FORMATS: ExportFormat[] = ['png', 'pdf'];

/** The single slot. At most one export runs at a time; a finished one is
 *  replaced by the next POST, a running one is JOINED (never queued). */
let job: ExportJob | null = null;

let jobCounter = 0;

function isFormat(value: unknown): value is ExportFormat {
  return value === 'png' || value === 'pdf';
}

/** Dedupe + validate the requested formats; empty/omitted = both. */
export function resolveFormats(raw: unknown): { formats: ExportFormat[] } | { error: string } {
  if (raw === undefined || raw === null) return { formats: [...ALL_FORMATS] };
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'formats must be a non-empty array of "png" and/or "pdf"' };
  }
  const formats: ExportFormat[] = [];
  for (const value of raw) {
    if (!isFormat(value)) return { error: 'formats must contain only "png" and/or "pdf"' };
    if (!formats.includes(value)) formats.push(value);
  }
  return { formats };
}

export function getExportStatus(dir: string, id: string): ExportStatus | { ok: false; error: string } {
  // `dir` is validated by the route (absolute); the job is found by id alone,
  // because a JOINED poster polls the CURRENT job even when their own dir
  // differs from the joined one (single slot is global per D4).
  void dir;
  if (!job || job.id !== id) {
    return { ok: false, error: 'unknown export job' };
  }
  return {
    state: job.state,
    startedAt: job.startedAt,
    ...(job.state === 'failed' && job.error ? { error: job.error } : {}),
    results: job.results,
  };
}

/**
 * Start the export loop in the background (the POST answers at once) or JOIN
 * the running one. The resolved screens carry their own URLs; nothing here
 * touches screens.json or view.json.
 */
export function startExportJob(input: {
  dir: string;
  screens: ExportScreen[];
  formats?: ExportFormat[];
  browser: Browser;
}): ExportStart {
  if (job && job.state === 'running') {
    // D4: one export at a time, globally — a second concurrent POST joins the
    // running job (never queue-forever), whatever workspace it asked about.
    return {
      ok: true,
      jobId: job.id,
      screens: job.screens.length,
      formats: [...job.formats],
      joined: true,
    };
  }
  const formats = input.formats && input.formats.length ? [...input.formats] : [...ALL_FORMATS];
  const id = `export-${++jobCounter}`;
  const startedAt = new Date().toISOString();
  const next: ExportJob = {
    id,
    dir: path.resolve(input.dir),
    screens: input.screens.map((screen) => ({ ...screen })),
    formats,
    state: 'running',
    startedAt,
    results: [],
  };
  job = next;
  void runJob(next, input.browser);
  return { ok: true, jobId: id, screens: next.screens.length, formats: [...formats] };
}

async function runJob(current: ExportJob, browser: Browser): Promise<void> {
  try {
    // The user closing the canvas mid-export is a job-level failure, not a
    // per-screen one: every later capture would fail anyway.
    if (!(await browser.state()).windowOpen) {
      current.state = 'failed';
      current.error = 'the live canvas window is not open';
      return;
    }
    for (const screen of current.screens) {
      const entry: ExportResultEntry = { screen: screen.id };
      if (screen.state === 'error') {
        // D2: a dead artboard is skipped; the job continues.
        entry.png = { ok: false, error: 'screen not loaded' };
        entry.pdf = { ok: false, error: 'screen not loaded' };
        current.results.push(entry);
        continue;
      }
      if (current.formats.includes('png')) {
        entry.png = await captureScreen(browser, current.dir, screen).catch((error) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : 'capture failed',
        }));
      }
      if (current.formats.includes('pdf')) {
        entry.pdf = await printScreen(browser, current.dir, screen).catch((error) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : 'pdf failed',
        }));
      }
      current.results.push(entry);
    }
    current.state = 'done';
  } catch (error) {
    current.state = 'failed';
    current.error = error instanceof Error ? error.message : 'export failed';
  }
}

/** PNG per screen via the shell capture trio, at the artboard's natural size
 *  (D2), always from the top of the page (R3: the artboard is a scrolled
 *  viewport; the capture restores the live scroll afterwards). */
async function captureScreen(
  browser: Browser,
  dir: string,
  screen: ExportScreen,
): Promise<FileResult> {
  const shot = await browser.capture(screen.id, { top: true });
  const file = path.join(dir, EXPORTS_DIRNAME, `${screen.id}.png`);
  await atomicWrite(file, shot.png);
  return { ok: true, file };
}

/** PDF per screen via the hidden throwaway page target (D3). */
async function printScreen(
  browser: Browser,
  dir: string,
  screen: ExportScreen,
): Promise<FileResult> {
  const pdf = await browser.printScreenToPdf(screen.url, screen.width, screen.height);
  const file = path.join(dir, EXPORTS_DIRNAME, `${screen.id}.pdf`);
  await atomicWrite(file, pdf);
  return { ok: true, file };
}

/** tmp+rename write; a crash mid-write leaves no half file behind. */
async function atomicWrite(file: string, data: Buffer): Promise<void> {
  const targetDir = path.dirname(file);
  await fs.mkdir(targetDir, { recursive: true });
  const tmp = path.join(targetDir, `.${path.basename(file)}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Test seam: forget the finished job so another test starts fresh. */
export function resetExportJobs(): void {
  job = null;
}