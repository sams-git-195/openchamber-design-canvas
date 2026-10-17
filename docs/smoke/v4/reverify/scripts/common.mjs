import { makeEnv, attachShell, frameContexts, evalInFrames, sleep, fs, path, os, SHOTS } from './lib.mjs';
export { makeEnv, attachShell, frameContexts, evalInFrames, sleep, fs, path, os, SHOTS };
export const WS = path.join(os.tmpdir(), 'dc-reverify', 'ws', 'brew-lab');
export async function boot(port, { n = 3, resetFiles = true } = {}) {
  try { fs.unlinkSync(path.join(WS, '.design-studio', 'view.json')); } catch {}
  const E = makeEnv(port); await E.ready;
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('ds-chrome-')));
  await E.call('POST', '/open', { dir: WS });
  for (let i = 0; i < 120; i++) { const s = await E.call('GET', '/state'); if (s.windowOpen && s.screens.length >= n && s.screens.every((x) => x.state === 'ready')) break; await sleep(300); }
  const h = await attachShell(before);
  return { E, h, call: E.call };
}
