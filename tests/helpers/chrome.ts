// tests/helpers/chrome.ts — V4-16 (E14): honest Chrome discovery for live tests.
//
// The old live test files each hardcoded
// `process.env.DS_CHROME_PATH ?? '<macOS bundle path>'`, so on Windows (and
// Linux) without the env var they silently SKIPPED while the suite still
// reported green. This helper mirrors the PRODUCT discovery in
// service/browser.ts `resolveChromePath()` — DS_CHROME_PATH wins, then
// win32 standard install locations, then the macOS bundle, then known Linux
// paths (snap included), then the `chrome` PATH fallback — and gates live
// tests through `liveTest(t)`:
//
//   if (!(await liveTest(t))) return;   // true = run, false = already skipped
//
// `DS_REQUIRE_CHROME=1` (integrator + P4 runs) turns "Chrome unavailable"
// into a loud FAILURE instead of a skip, so a green suite means live tests
// actually ran.
//
// FORK-MERGE: SPEC-V4 V4-16 wants this helper to consume the product's
// resolver once `resolveChromePath` is exported from service/browser.ts (A's
// lane). Until that export exists, the discovery below is a deliberate
// mirror; the integrator may swap the body of `resolveChrome()` for a
// re-export without touching any test file.
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

/**
 * The Chrome binary the live tests (and the product) should use. Mirrors
 * service/browser.ts `resolveChromePath()` plus the Linux install probes the
 * product delegates to the PATH.
 */
export function resolveChrome(): string {
  const envOverride = process.env.DS_CHROME_PATH;
  if (envOverride) return envOverride;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const probes = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    ];
    for (const candidate of probes) {
      if (candidate && existsSync(candidate)) return candidate;
    }
    return 'chrome';
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  // Linux: probe the common package locations (deb flatpak-less installs and
  // the snap), then fall back to PATH like the product does.
  const linuxProbes = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const candidate of linuxProbes) {
    if (existsSync(candidate)) return candidate;
  }
  return 'chrome';
}

/** True when the resolved Chrome is actually usable (file exists / on PATH). */
export async function chromeAvailable(): Promise<boolean> {
  const resolved = resolveChrome();
  if (resolved !== 'chrome' && (path.isAbsolute(resolved) || resolved.includes(path.sep))) {
    try {
      await access(resolved);
      return true;
    } catch {
      return false;
    }
  }
  // PATH fallback: scan PATH entries for the bare executable name, the same
  // resolution `spawn('chrome', …)` would perform.
  const names =
    process.platform === 'win32'
      ? ['chrome.exe', 'chrome', 'chromium.exe']
      : process.platform === 'darwin'
        ? ['chrome', 'google-chrome', 'chromium']
        : ['chrome', 'chromium', 'chromium-browser', 'google-chrome'];
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      try {
        await access(path.join(dir, name));
        return true;
      } catch {
        /* keep scanning */
      }
    }
  }
  return false;
}

/**
 * Gate a live test: returns TRUE when the test should run. When Chrome is
 * unavailable it marks the test skipped and returns FALSE — unless
 * DS_REQUIRE_CHROME=1, in which case it fails the test loudly (E14: a green
 * suite must mean the live tests actually ran). Callers must `return` on
 * false:
 *
 *   test('...', async (t) => { if (!(await liveTest(t))) return; ... });
 */
export async function liveTest(t: TestContext): Promise<boolean> {
  if (await chromeAvailable()) return true;
  const resolved = resolveChrome();
  if (process.env.DS_REQUIRE_CHROME === '1') {
    assert.fail(
      `DS_REQUIRE_CHROME=1: Chrome is unavailable (resolved to ${JSON.stringify(resolved)}). ` +
        'Install Chrome or set DS_CHROME_PATH — a required live test must never skip.',
    );
  }
  t.skip(`Chrome not found (resolved: ${resolved}) — live test skipped; run with DS_REQUIRE_CHROME=1 to fail instead`);
  return false;
}
