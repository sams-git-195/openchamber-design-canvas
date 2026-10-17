import { boot, sleep, fs, path, WS, SHOTS, frameContexts, evalInFrames } from './common.mjs';
const port = Number(process.argv[2] || 57170);
const delay = Number(process.argv[3] || 0);
const tag = process.argv[4] || 'run';
fs.writeFileSync(path.join(WS, 'screens.json'), fs.readFileSync(path.join(WS, '..', 'screens.base.json'), 'utf8'));
const t0 = Date.now();
const { E, h, call } = await boot(port);
const log = (...a) => console.log(...a);
try {
  const tReady = Date.now() - t0;
  await call('POST', '/mode', { mode: 'edit' });
  await sleep(delay);
  const btn = { menu: [32, 132.6], checkout: [32, 187.7] };
  let since = (await call('GET', '/picks?since=0&wait=0')).seq || 0;
  const res = [];
  for (let i = 0; i < 8; i++) {
    const id = i % 2 ? 'checkout' : 'menu';
    const fr = await h.rectOf(`[data-screen="${id}"] iframe`); const sc = fr.w / 390;
    const bx = fr.x + (btn[id][0] + 42) * sc, by = fr.y + (btn[id][1] + 21) * sc;
    await h.mouse('mouseMoved', bx - 20, by - 10); await sleep(40); await h.mouse('mouseMoved', bx, by); await sleep(80);
    const c0 = Date.now(); await h.mouse('mousePressed', bx, by); await h.mouse('mouseReleased', bx, by);
    let got = null;
    while (Date.now() - c0 < 2000 && !got) { const q = await call('GET', `/picks?since=${since}&wait=300`); if ((q.picks || []).length) { got = q.picks[0]; since = q.picks[q.picks.length - 1].seq; } }
    res.push(got ? Date.now() - c0 : null);
    if (got) await call('POST', '/picks/ack', { seq: got.seq, label: 'x' });
  }
  const st = await call('GET', '/state');
  const delivered = res.filter((x) => x !== null).length;
  log(`${tag} delay=${delay} readyAt=${tReady}ms delivered=${delivered}/8 res=${JSON.stringify(res)} bridge=${JSON.stringify(st.shellBridge)} states=${st.screens.map((s) => s.state).join(',')}`);
  if (delivered === 0) {
    await h.shot(`DEAD-session-${tag}.png`);
    const hov = await h.evaluate(`JSON.stringify({mode:__dsCanvas.getMode(),active:__dsCanvas.getActive()})`);
    log('  dead-session shell', hov);
    // does hover work? a retry after 3s
    await sleep(3000);
    const id = 'menu'; const fr = await h.rectOf(`[data-screen="${id}"] iframe`); const sc = fr.w / 390;
    const bx = fr.x + (btn[id][0] + 42) * sc, by = fr.y + (btn[id][1] + 21) * sc;
    await h.mouse('mouseMoved', bx - 20, by - 10); await sleep(60); await h.mouse('mouseMoved', bx, by); await sleep(300);
    await h.shot(`DEAD-session-${tag}-hover.png`);
    const c0 = Date.now(); await h.mouse('mousePressed', bx, by); await h.mouse('mouseReleased', bx, by);
    let got = null; while (Date.now() - c0 < 2500 && !got) { const q = await call('GET', `/picks?since=${since}&wait=300`); if ((q.picks || []).length) got = q.picks[0]; }
    log('  retry after 3s:', got ? 'DELIVERED' : 'still none');
    const devPort = new URL(st.screens[0].url).port; const fc = await frameContexts(h, devPort);
    for (const c of fc.ctxs) { const r = await evalInFrames(h, [c], `JSON.stringify({p:location.pathname,pick:typeof window.__dsPick,trusted:!!window.__dsTrustedArtifact,installed:!!window.__dsPickerInstalled,pending:(window.__dsPickPending||[]).length,top:window===window.top})`); log('  frame ctx', c.id, JSON.stringify(r[0].value)); }
    log('  state', JSON.stringify(await call('GET','/state')).slice(0,900));
  }
} catch (e) { console.error('FATAL', e); }
await E.die(0);
