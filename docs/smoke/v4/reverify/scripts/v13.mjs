import { boot, sleep, fs, path, WS, SHOTS } from './common.mjs';
fs.writeFileSync(path.join(WS, 'screens.json'), fs.readFileSync(path.join(WS, '..', 'screens.base.json'), 'utf8'));
const { E, h, call } = await boot(57700);
const log = (...a) => console.log(...a);
try {
  await call('POST', '/mode', { mode: 'edit' }); await sleep(300);
  const q = () => h.evaluate(`(()=>{const c=document.getElementById('canvas');const cs=getComputedStyle(c);return {ae:document.activeElement&&(document.activeElement.id||document.activeElement.tagName),fv:c.matches(':focus-visible'),f:c.matches(':focus'),outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor}})()`);
  log('before', JSON.stringify(await q()));
  const fr = await h.rectOf('[data-screen="menu"] iframe'); const sc = fr.w / 390;
  const bx = fr.x + 74 * sc, by = fr.y + 154 * sc;
  await h.mouse('mouseMoved', bx - 20, by - 10); await sleep(60); await h.mouse('mouseMoved', bx, by); await sleep(100);
  await h.mouse('mousePressed', bx, by); await h.mouse('mouseReleased', bx, by); await sleep(500);
  log('after click', JSON.stringify(await q()));
  await h.shot('F16-after-click.png');
  // click on empty canvas
  await h.mouse('mousePressed', 600, 200); await h.mouse('mouseReleased', 600, 200); await sleep(300);
  log('after empty click', JSON.stringify(await q()));
} catch (e) { console.error('FATAL', e); }
await E.die(0);
