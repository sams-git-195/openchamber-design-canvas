import { boot, sleep, fs, path, WS } from './common.mjs';
import { execSync } from 'node:child_process';
const OUT = 'C:/Users/samhe/Documents/github/openchamber-design-canvas/docs/smoke/v4/recheck2';
const regPath = path.join(WS, 'screens.json');
const base = { version: 1, screens: [
  { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
  { id: 'checkout', file: 'checkout.html', title: 'Checkout', width: 390, height: 844 },
  { id: 'menu', file: 'menu.html', title: 'Menu', width: 390, height: 844 },
] };
fs.writeFileSync(regPath, JSON.stringify(base, null, 1));
try { fs.unlinkSync(path.join(WS, '.design-studio', 'view.json')); } catch {}
const { E, h, call } = await boot(Number(process.argv[2] || 57810), { n: 3 });
const log = (...a) => console.log(...a);
const shot = async (name) => { const s = await h.cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64')); };
const rclick = async (x, y) => { await h.mouse('mouseMoved', x, y); await h.mouse('mousePressed', x, y, 'right'); await h.mouse('mouseReleased', x, y, 'right'); await sleep(300); };
const lclick = async (x, y) => { await h.mouse('mouseMoved', x, y); await sleep(60); await h.mouse('mousePressed', x, y); await h.mouse('mouseReleased', x, y); await sleep(300); };
const clickMenu = async (action) => { const r = await h.evaluate(`(()=>{const e=[...document.querySelectorAll('.ds-context-menu .ds-menu-item')].find(x=>x.dataset.action==='${action}');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`); if (!r) return false; await lclick(r.x + r.w / 2, r.y + r.h / 2); return true; };
const vj = () => { try { return fs.readFileSync(path.join(WS, '.design-studio', 'view.json'), 'utf8'); } catch { return null; } };
const dirQ = encodeURIComponent(WS);
const listening = (port) => { try { execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { stdio: 'pipe' }); return true; } catch { return false; } };
try {
  await call('POST', '/mode', { mode: 'edit' }); await sleep(600);
  // ---- F15
  await h.evaluate(`__dsCanvas.fitAll()`); await sleep(500);
  const t0 = await h.rectOf('[data-screen="menu"] .ds-ab-title');
  log('menu title rect', JSON.stringify(t0));
  await h.mouse('mouseMoved', t0.x + 8, t0.y + 6); await h.mouse('mousePressed', t0.x + 8, t0.y + 6);
  for (let i = 1; i <= 6; i++) { await h.mouse('mouseMoved', t0.x + 8, t0.y + 6 + i * 10); await sleep(25); }
  await h.mouse('mouseReleased', t0.x + 8, t0.y + 6 + 60); await sleep(1500);
  log('F15 moved', (vj() || '').replace(/\s+/g, ' '));
  await shot('F15-1-moved.png');
  const t1 = await h.rectOf('[data-screen="menu"] .ds-ab-title');
  await rclick(t1.x + 8, t1.y + 6);
  log('menu open', await h.evaluate(`!!document.querySelector('.ds-context-menu')`));
  const okr = await clickMenu('reset-position'); await sleep(1800);
  const after = vj(); log('F15 clicked reset', okr, 'view.json:', (after || '').replace(/\s+/g, ' '));
  log('F15 has null key?', /null/.test(after || ''), ' menu key present?', /"menu"/.test(after || ''));
  await shot('F15-2-after-reset.png');
  // ---- F17
  const srv = JSON.parse(fs.readFileSync(path.join(WS, '.design-studio', 'server.json'), 'utf8')); log('server', JSON.stringify(srv), 'listening', listening(srv.port));
  const m = await h.rectOf('[data-screen="menu"] .ds-ab-title'); await rclick(m.x + 8, m.y + 6);
  log('items', JSON.stringify(await h.evaluate(`[...document.querySelectorAll('.ds-context-menu .ds-menu-item')].map(x=>x.textContent)`)));
  await shot('F17-1-menu-with-stop.png');
  log('stop clicked', await clickMenu('stop-server'));
  const seen = [];
  for (let i = 0; i < 12; i++) { await sleep(150); const t = await h.evaluate(`(document.querySelector('.ds-toast')||{}).textContent||''`); if (t && seen[seen.length - 1] !== t) { seen.push(t); await shot('F17-2-toast.png'); } }
  log('toast(s)', JSON.stringify(seen), 'port listening after stop:', listening(srv.port));
  // force a load of a new screen against the dead server -> error card
  base.screens.push({ id: 'orders', file: 'orders.html', title: 'Orders', width: 390, height: 844 });
  await call('PUT', `/screens?dir=${dirQ}`, base);
  let st = null; const tt = Date.now();
  for (let i = 0; i < 80; i++) { await sleep(150); st = (await call('GET', '/state')).screens.find((s) => s.id === 'orders'); if (st && st.state === 'error') break; }
  log('orders state after stop', JSON.stringify(st && [st.state, st.message]), Date.now() - tt, 'ms');
  await sleep(600); await h.evaluate(`__dsCanvas.fitAll()`); await sleep(500);
  await shot('F17-3-error-card.png');
  // menu Reload on the error board
  const o = await h.rectOf('[data-screen="orders"] .ds-ab-title'); await rclick(o.x + 8, o.y + 6);
  log('menu open on orders', await h.evaluate(`!!document.querySelector('.ds-context-menu')`));
  const t2 = Date.now(); log('reload clicked', await clickMenu('reload'));
  let rec = null; const seq = [];
  for (let i = 0; i < 100; i++) { await sleep(150); const s = (await call('GET', '/state')).screens.find((x) => x.id === 'orders'); const k = s.state; if (seq[seq.length - 1] !== k) seq.push(k); if (k === 'ready') { rec = Date.now() - t2; break; } }
  log('orders after Reload:', JSON.stringify(seq), 'recovered ms', rec, 'port listening now:', listening(JSON.parse(fs.readFileSync(path.join(WS, '.design-studio', 'server.json'), 'utf8')).port));
  await sleep(1500);
  await shot('F17-4-recovered.png');
  log('all states', JSON.stringify((await call('GET', '/state')).screens.map((x) => x.id + ':' + x.state)));
} catch (e) { console.error('FATAL', e); }
await E.die(0);
