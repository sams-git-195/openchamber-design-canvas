import { boot, frameContexts, evalInFrames, sleep, SHOTS, fs, path } from './common.mjs';
const { E, h, call } = await boot(57103);
const log = (...a) => console.log(...a);
try {
  await call('POST', '/mode', { mode: 'edit' }); await sleep(500);
  const btn = { home: { x: 32, y: 132.6, width: 85.3, height: 43.2 }, menu: { x: 32, y: 132.6, width: 85.3, height: 43.2 }, checkout: { x: 32, y: 187.7, width: 85.3, height: 43.2 } };
  const lat = []; let delivered = 0; const lost = [], wrong = [];
  let since = (await call('GET', '/picks?since=0&wait=0')).seq || 0;
  const ids = ['home', 'checkout', 'menu'];
  for (let i = 0; i < 30; i++) {
    const id = ids[i % 3]; const b = btn[id];
    const fr = await h.rectOf(`[data-screen="${id}"] iframe`);
    const sc = fr.w / (id === 'home' ? 1280 : 390);
    const bx = fr.x + (b.x + b.width / 2) * sc, by = fr.y + (b.y + b.height / 2) * sc;
    await h.mouse('mouseMoved', bx - 30, by - 20); await sleep(40); await h.mouse('mouseMoved', bx, by); await sleep(60);
    const t0 = Date.now();
    await h.mouse('mousePressed', bx, by); await h.mouse('mouseReleased', bx, by);
    let got = null;
    while (Date.now() - t0 < 4000 && !got) { const q = await call('GET', `/picks?since=${since}&wait=300`); if ((q.picks || []).length) { got = q.picks[0]; since = q.picks[q.picks.length - 1].seq; } }
    if (got && got.selector === '#b' && got.screen === id) { delivered++; lat.push(Date.now() - t0); await call('POST', '/picks/ack', { seq: got.seq, label: 'x' }); }
    else if (got) wrong.push({ i, id, got: [got.screen, got.selector] });
    else lost.push({ i, id });
    await sleep(80);
  }
  lat.sort((a, b) => a - b);
  const res = { clicks: 30, delivered, lost, wrong, p50: lat[Math.floor(lat.length / 2)], min: lat[0], max: lat[lat.length - 1] };
  log('F5 RESULT', JSON.stringify(res));
  fs.writeFileSync(path.join(SHOTS, 'f5.json'), JSON.stringify(res));
} catch (e) { console.error('FATAL', e); }
await E.die(0);
