// The /export mechanisms (SPEC-V3-P2-SCOPE.md D2–D4) against REAL Chrome:
//
//  - printScreenToPdf: the hidden throwaway page target (D3), with the R7
//    page-target invariant pins — after each print AND each export job,
//    pageTargetCount() is 1 and the camera deep-equals its pre-export value;
//    a mid-print injected failure still closes the throwaway target.
//  - startExportJob: the single-slot async loop (D4) writing PNG (shell
//    capture trio, natural size) + PDF under <workspace>/exports/.
//  - the service routes end-to-end: POST /open → POST /export → poll
//    /export/status (spawned TS entry; ports 65400–65535).
//
// Guarded like the other Chrome suites: skipped when Chrome is unavailable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { Browser } from '../service/browser.ts';
import { getExportStatus, resetExportJobs, startExportJob, type ExportScreen } from '../service/export.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chrome = process.env.DS_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TOKEN = 'export-acceptance-token';
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => Promise<boolean> | boolean, message: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      /* transient context swaps keep polling */
    }
    await pause(60);
  }
  assert.fail(message);
}

/** PNG header size (verified magic first). */
function pngSize(png: Buffer): { width: number; height: number } {
  assert.deepEqual(Array.from(png.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'a real PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const fixture = '<!doctype html><title>Export fixture</title><style>html,body{margin:0;min-height:100vh;background:#eef}#mark{position:absolute;left:0;top:0;width:16px;height:16px;background:#00f}</style><div id="mark"></div><script>window.fixtureIdentity=crypto.randomUUID()</script>';

interface Owned {
  browser: Browser;
  url: string;
  server: Server;
  requests: string[];
}

/** A loopback fixture server plus a fresh offscreen Browser. */
async function owned(run: (o: Owned) => Promise<void>): Promise<void> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(fixture);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const prior = process.env.DS_WINDOW;
  process.env.DS_WINDOW = '-2400,-2400,1280,800';
  const browser = new Browser();
  if (prior === undefined) delete process.env.DS_WINDOW;
  else process.env.DS_WINDOW = prior;
  try {
    await run({ browser, url: `http://localhost:${address.port}/`, server, requests });
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('printScreenToPdf prints a hidden throwaway target and keeps the R7 invariants', { timeout: 120000 }, async (t) => {
  try {
    await access(chrome);
  } catch {
    t.skip('Chrome unavailable');
    return;
  }
  await owned(async ({ browser, url }) => {
    await browser.open(url);
    await until(async () => (await browser.state()).windowOpen && /Export fixture/.test((await browser.state()).title), 'the window is up');
    assert.equal(await browser.pageTargetCount(), 1, 'idle: exactly one page target');
    const before = await browser.getCamera();

    const pdf = await browser.printScreenToPdf(url + 'pdfsource', 1280, 800);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'printToPDF returned a PDF document');
    // R7: after each print — one page target, camera deep-equals its pre value.
    assert.equal(await browser.pageTargetCount(), 1, 'the throwaway target is closed after the print');
    assert.deepEqual(await browser.getCamera(), before, 'the print never touched the canvas camera');
    // The print target loaded the URL top-level, not the private shell.
    assert.ok((await browser.jsonList()).every((t2) => t2.url !== url + 'pdfsource'), 'no lingering print target surfaces');

    // Injected failure mirrors the capture inject-failure pin: the target is
    // STILL closed and the camera restored.
    const internals = browser as unknown as { cdp: { send: (m: string, p: unknown, s?: string) => Promise<Record<string, unknown>> } };
    const original = internals.cdp.send.bind(internals.cdp);
    internals.cdp.send = ((method: string, params: unknown, session?: string) =>
      method === 'Page.printToPDF' ? Promise.reject(new Error('injected print failure')) : original(method, params, session)) as typeof original;
    try {
      await assert.rejects(() => browser.printScreenToPdf(url + 'breaks', 1280, 800), /injected print failure/);
    } finally {
      internals.cdp.send = original;
    }
    assert.equal(await browser.pageTargetCount(), 1, 'an injected mid-print failure still closes the target');
    assert.deepEqual(await browser.getCamera(), before);
  });
});

test('startExportJob writes natural-size PNGs and screen-sized PDFs, then restores the R7 invariants', { timeout: 180000 }, async (t) => {
  try {
    await access(chrome);
  } catch {
    t.skip('Chrome unavailable');
    return;
  }
  await owned(async ({ browser, url }) => {
    await browser.openWorkspace({
      screens: [
        { id: 'a', url: url + 'expa', width: 1280, height: 800, title: 'A' },
        { id: 'b', url: url + 'expb', width: 640, height: 900, title: 'B' },
      ],
      baseUrl: url,
      mode: 'play',
    });
    await until(async () => (await browser.state()).screens.every((s) => s.url.includes('exp')), 'both export screens settled');
    const workdir = await mkdtemp(path.join(tmpdir(), 'ds-export-job-'));
    try {
      // Quiesce the layout tail before freezing the camera for comparison.
      const internals = browser as unknown as { operationTail: Promise<unknown> };
      await internals.operationTail;
      await pause(400);
      const before = await browser.getCamera();
      const live = (await browser.state()).screens;
      const screens: ExportScreen[] = [
        { id: 'a', url: url + 'expa', width: 1280, height: 800, state: live.find((s) => s.id === 'a')?.state ?? 'ready' },
        { id: 'b', url: url + 'expb', width: 640, height: 900, state: live.find((s) => s.id === 'b')?.state ?? 'ready' },
      ];
      const started = startExportJob({ dir: workdir, screens, formats: ['png', 'pdf'], browser });
      assert.equal(started.ok, true);
      if (!started.ok) return;
      await until(async () => (getExportStatus(workdir, started.jobId) as { state?: string }).state !== 'running', 'the job finishes', 30000);
      const status = getExportStatus(workdir, started.jobId);
      if ('ok' in status) assert.fail('the job status was not found');
      assert.equal(status.state, 'done', JSON.stringify(status));
      assert.equal(status.results.length, 2, 'one result entry per screen');
      for (const entry of status.results) {
        assert.equal(entry.png?.ok, true, `${entry.screen} PNG succeeded`);
        assert.equal(entry.pdf?.ok, true, `${entry.screen} PDF succeeded`);
        assert.ok(entry.png && entry.png.ok && /\.png$/.test(entry.png.file));
      }
      // Files on disk: PNG dims == registry natural sizes; PDFs are PDFs.
      const pngA = pngSize(await readFile(path.join(workdir, 'exports', 'a.png')));
      assert.deepEqual([pngA.width, pngA.height], [1280, 800], 'a.png is the artboard natural size');
      const pngB = pngSize(await readFile(path.join(workdir, 'exports', 'b.png')));
      assert.deepEqual([pngB.width, pngB.height], [640, 900], 'b.png is the artboard natural size');
      assert.equal((await readFile(path.join(workdir, 'exports', 'a.pdf'))).subarray(0, 5).toString(), '%PDF-');
      assert.equal((await readFile(path.join(workdir, 'exports', 'b.pdf'))).subarray(0, 5).toString(), '%PDF-');
      // R7: after the WHOLE job — one page target, camera deep-equals.
      assert.equal(await browser.pageTargetCount(), 1, 'the export left exactly one page target');
      assert.deepEqual(await browser.getCamera(), before, 'the export job restored the camera exactly');
    } finally {
      resetExportJobs();
      await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

// ---- the service routes end-to-end (spawned TS entry) -----------------------

async function startServiceP2(extraEnv: Record<string, string>): Promise<{ port: number; child: ChildProcess }> {
  // Above the screens suite's 64000–65399 band, at the top of the valid space.
  const port = 65400 + Math.floor(Math.random() * 136);
  const child = spawn(process.execPath, [path.join(root, 'service', 'main.ts')], {
    env: {
      ...process.env,
      DS_KILL_WINDOW_ON_STOP: '1',
      DS_CHROME_PATH: process.env.DS_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      OPENCHAMBER_SERVICE_PORT: String(port),
      OPENCHAMBER_SERVICE_TOKEN: TOKEN,
      ...extraEnv,
    },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`service exited early: ${child.exitCode}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
      if (res.status === 200) return { port, child };
    } catch {
      /* not up yet */
    }
    await pause(100);
  }
  child.kill('SIGKILL');
  throw new Error('service did not become healthy');
}

test('POST /open → POST /export → poll /export/status writes real exports (D4 routes)', { timeout: 240000 }, async (t) => {
  try {
    await access(process.env.DS_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  } catch {
    t.skip('Chrome unavailable');
    return;
  }
  const workdir = await mkdtemp(path.join(tmpdir(), 'ds-export-route-'));
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(fixture);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/`;
  await writeFile(path.join(workdir, '.design-studio.json'), JSON.stringify({ version: 1, name: 'export ws', url: base }));
  await writeFile(
    path.join(workdir, 'screens.json'),
    JSON.stringify({
      version: 1,
      screens: [
        { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
        { id: 'pay', file: 'pay.html', title: 'Pay', width: 640, height: 900 },
      ],
    }),
  );
  const { port, child } = await startServiceP2({});
  const bearer = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  try {
    const openRes = await fetch(`http://127.0.0.1:${port}/open`, { method: 'POST', headers: bearer, body: JSON.stringify({ dir: workdir }) });
    assert.equal(openRes.status, 200);
    const opened = (await openRes.json()) as { ok: boolean; error?: string; modeApplied?: boolean; screens?: Array<{ id: string; state: string }> };
    assert.equal(opened.ok, true, JSON.stringify(opened));
    // R1/R2 surface through the route: the shell accepted the baked mode and
    // every screen reports a per-artboard readiness state.
    assert.equal(opened.modeApplied, true, 'the pushed mode was accepted');
    assert.ok(opened.screens && opened.screens.every((s) => ['loading', 'ready', 'error'].includes(s.state)), 'per-screen state is on /state');

    const exportRes = await fetch(`http://127.0.0.1:${port}/export`, {
      method: 'POST',
      headers: bearer,
      body: JSON.stringify({ dir: workdir, formats: ['png', 'pdf'] }),
    });
    assert.equal(exportRes.status, 200);
    const started = (await exportRes.json()) as { ok: boolean; jobId: string };
    assert.equal(started.ok, true);
    // Single-slot: a concurrent second POST joins the running job.
    const joinRes = await fetch(`http://127.0.0.1:${port}/export`, { method: 'POST', headers: bearer, body: JSON.stringify({ dir: workdir }) });
    assert.equal(joinRes.status, 200);
    const joined = (await joinRes.json()) as { ok: boolean; jobId: string };
    assert.equal(joined.ok, true);
    await until(async () => {
      const res = await fetch(`http://127.0.0.1:${port}/export/status?dir=${encodeURIComponent(workdir)}&job=${encodeURIComponent(started.jobId)}`, { headers: { authorization: `Bearer ${TOKEN}` } });
      const status = (await res.json()) as { state: string };
      return status.state === 'done' || status.state === 'failed';
    }, 'the routed job finishes', 60000);
    // The joined id is either the same job (still running at join time) or a
    // fresh one that POST-haste already finished — never an error.
    assert.ok(joined.jobId === started.jobId || joined.jobId.startsWith('export-'), 'the join answered an honest job id');
    const statusRes = await fetch(`http://127.0.0.1:${port}/export/status?dir=${encodeURIComponent(workdir)}&job=${encodeURIComponent(started.jobId)}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(statusRes.status, 200);
    const status = (await statusRes.json()) as { state: string; startedAt: string; results: Array<{ screen: string; png?: { ok: boolean; error?: string }; pdf?: { ok: boolean; error?: string } }> };
    assert.equal(status.state, 'done', JSON.stringify(status));
    assert.equal(typeof status.startedAt, 'string');
    assert.equal(status.results.length, 2);
    for (const entry of status.results) {
      assert.equal(entry.png?.ok, true, `${entry.screen} PNG ok`);
      assert.equal(entry.pdf?.ok, true, `${entry.screen} PDF ok`);
    }
    assert.equal((await readFile(path.join(workdir, 'exports', 'home.pdf'))).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await readFile(path.join(workdir, 'exports', 'pay.pdf'))).subarray(0, 5).toString(), '%PDF-');
    const homePng = pngSize(await readFile(path.join(workdir, 'exports', 'home.png')));
    assert.deepEqual([homePng.width, homePng.height], [1280, 800], 'home.png is its registry size');
    const payPng = pngSize(await readFile(path.join(workdir, 'exports', 'pay.png')));
    assert.deepEqual([payPng.width, payPng.height], [640, 900], 'pay.png is its registry size');
  } finally {
    await fetch(`http://127.0.0.1:${port}/close`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } }).catch(() => undefined);
    child.kill('SIGKILL');
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
});