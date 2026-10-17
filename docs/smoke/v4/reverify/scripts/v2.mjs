import { boot, frameContexts, evalInFrames, sleep, SHOTS, fs, path, WS } from './common.mjs';
const regPath = path.join(WS, 'screens.json');
fs.writeFileSync(regPath, fs.readFileSync(path.join(WS, '..', 'screens.base.json'), 'utf8'));
const { E, h, call } = await boot(57151);
const log = (...a) => console.log(...a);
try {
  await call('POST', '/mode', { mode: 'edit' }); await sleep(500);
  const devPort = new URL((await call('GET', '/state')).screens[0].url).port;
  const fc = await frameContexts(h, devPort);
  const byPath = {};
  for (const c of fc.ctxs) { const r = await h.cdp('Runtime.evaluate', { expression: 'location.pathname', returnByValue: true, contextId: c.id }); (byPath[r.result.value] ||= []).push(c); }
  log('frame ctx paths', JSON.stringify(Object.fromEntries(Object.entries(byPath).map(([k, v]) => [k, v.length]))));
  const visible = async () => {
    const res = {};
    for (const [p, ctx] of Object.entries(byPath)) res[p.replace('/', '').replace('.html', '')] = (await evalInFrames(h, ctx, `(()=>{const o=document.getElementById('__ds-hover-outline');if(!o)return 0;const cs=getComputedStyle(o);return cs.display!=='none'&&o.getBoundingClientRect().width>0?1:0})()`)).map((x) => x.value).join(',');
    return res;
  };
  const R = (id)=>h.rectOf('.ds-artboard[data-screen="'+id+'"]');
  const hover = async (id, dx = 40, dy = 100) => { const r = await R(id); if(!r||r.w<100) log('BAD RECT',id,JSON.stringify(r)); await h.mouse('mouseMoved', r.x + dx - 12, r.y + dy - 10); await sleep(100); await h.mouse('mouseMoved', r.x + dx, r.y + dy); await sleep(450); };
  const seqs = [];
  await hover('menu'); seqs.push(['hover menu', await visible()]);
  await hover('checkout', 44, 100); seqs.push(['hover checkout (menu→checkout)', await visible()]); await h.shot('after-ghost-hover.png');
  await hover('home', 200, 75); seqs.push(['hover home (checkout→home)', await visible()]);
  await hover('menu'); seqs.push(['hover menu (home→menu)', await visible()]);
  await h.mouse('mouseMoved', 600, 80); await sleep(100); await h.mouse('mouseMoved', 610, 85); await sleep(450); seqs.push(['empty canvas', await visible()]);
  await hover('checkout', 44, 100); await hover('menu'); await hover('checkout', 44, 100); await hover('menu'); seqs.push(['4 rapid alternations → menu', await visible()]);
  // hover then open ctx menu on another artboard
  await hover('checkout', 44, 100); const mr = await R('menu');
  await h.mouse('mouseMoved', mr.x + 20, mr.y + 200); await h.mouse('mousePressed', mr.x + 20, mr.y + 200, 'right'); await h.mouse('mouseReleased', mr.x + 20, mr.y + 200, 'right'); await sleep(450);
  seqs.push(['hover checkout then right-click menu', await visible()]);
  await h.shot('after-ghost-menuopen.png');
  await h.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(200);
  // switching mode while hovered
  await hover('menu'); await call('POST', '/mode', { mode: 'play' }); await sleep(600); seqs.push(['edit→play while hovering menu', await visible()]);
  await call('POST', '/mode', { mode: 'edit' }); await sleep(500);
  for (const [n, v] of seqs) log(n.padEnd(40), JSON.stringify(v), Object.values(v).reduce((a, x) => a + String(x).split(',').reduce((s, y) => s + Number(y || 0), 0), 0), 'outline(s)');
  fc.stop();
} catch (e) { console.error('FATAL', e); }
await E.die(0);
