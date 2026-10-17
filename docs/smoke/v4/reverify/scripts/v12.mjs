import { boot, sleep, fs, path, WS, SHOTS, frameContexts, evalInFrames } from './common.mjs';
const port = Number(process.argv[2] || 57500);
fs.writeFileSync(path.join(WS, 'screens.json'), fs.readFileSync(path.join(WS, '..', 'screens.base.json'), 'utf8'));
const { E, h, call } = await boot(port);
const log = (...a) => console.log(...a);
const btn = { menu: [32, 132.6], checkout: [32, 187.7] };
try {
  await call('POST', '/mode', { mode: 'edit' }); await sleep(200);
  let since = (await call('GET', '/picks?since=0&wait=0')).seq || 0;
  async function tryClick(id, wait = 1500) {
    const fr = await h.rectOf(`[data-screen="${id}"] iframe`); const sc = fr.w / 390;
    const bx = fr.x + (btn[id][0] + 42) * sc, by = fr.y + (btn[id][1] + 21) * sc;
    await h.mouse('mouseMoved', bx - 20, by - 10); await sleep(40); await h.mouse('mouseMoved', bx, by); await sleep(80);
    const c0 = Date.now(); await h.mouse('mousePressed', bx, by); await h.mouse('mouseReleased', bx, by);
    let got = null; while (Date.now() - c0 < wait && !got) { const q = await call('GET', `/picks?since=${since}&wait=300`); if ((q.picks || []).length) { got = q.picks[0]; since = q.picks[q.picks.length - 1].seq; } }
    if (got) await call('POST', '/picks/ack', { seq: got.seq, label: 'x' });
    return !!got;
  }
  const first = [await tryClick('menu'), await tryClick('checkout'), await tryClick('menu')];
  if (first.some(Boolean)) { log('HEALTHY', JSON.stringify(first)); }
  else {
    log('DEAD session; probing for self-heal');
    const t0 = Date.now(); let healedAt = null;
    for (let i = 0; i < 12 && !healedAt; i++) { await sleep(2000); if (await tryClick(i % 2 ? 'checkout' : 'menu', 800)) healedAt = Date.now() - t0; }
    log('self-heal within 26s?', healedAt ? `yes after ${healedAt}ms` : 'NO');
    if (!healedAt) {
      await call('POST', '/mode', { mode: 'play' }); await sleep(600); await call('POST', '/mode', { mode: 'edit' }); await sleep(800);
      log('after play→edit toggle:', await tryClick('menu', 1500));
      // reload screen via service route
      const r = await call('POST', '/screens/reload', { id: 'menu' }).catch((e) => String(e.message).slice(0, 80));
      log('reload route result', JSON.stringify(r)); await sleep(1500);
      log('after reload attempt:', await tryClick('menu', 1500));
    }
  }
} catch (e) { console.error('FATAL', e); }
await E.die(0);
