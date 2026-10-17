import { boot, sleep, SHOTS, fs, path, WS } from './common.mjs';
import { execSync } from 'node:child_process';
const regPath = path.join(WS, 'screens.json');
const base = JSON.parse(fs.readFileSync(path.join(WS, '..', 'screens.base.json'), 'utf8'));
fs.writeFileSync(regPath, JSON.stringify(base, null, 1));
const { E, h, call } = await boot(57131);
const log = (...a) => console.log(...a);
const out = {};
const dirQ = encodeURIComponent(WS);
const cardInfo = (id) => h.evaluate(`(()=>{const a=document.querySelector('[data-screen="${id}"]');if(!a)return null;const card=a.querySelector('.ds-ab-state, .ds-ab-card-copy')?.closest('.ds-ab-state')||a.querySelector('.ds-ab-state');const rt=a.querySelector('.ds-ab-retry');const r=rt&&rt.getBoundingClientRect();const cs=rt&&getComputedStyle(rt);return {state:a.dataset.state||a.getAttribute('data-state'),cardText:card?card.innerText.replace(/\\s+/g,' ').trim():null,cardVisible:card?getComputedStyle(card).display!=='none':false,retry:rt?{text:rt.textContent.trim(),w:Math.round(r.width),h:Math.round(r.height),border:cs.borderTopWidth+' '+cs.borderTopStyle+' '+cs.borderTopColor,pad:cs.paddingTop+' '+cs.paddingLeft,bg:cs.backgroundColor,color:cs.color,radius:cs.borderRadius,fontSize:cs.fontSize,x:r.x,y:r.y}:null,detail:(a.querySelector('.ds-ab-card-detail')||{}).textContent||null}})()`);
try {
  await call('POST', '/mode', { mode: 'edit' }); await sleep(400);
  const srv = JSON.parse(fs.readFileSync(path.join(WS, '.design-studio', 'server.json'), 'utf8'));
  log('dev server', JSON.stringify(srv));
  // kill the dev server tree
  try { execSync(`taskkill /PID ${srv.pid} /T /F`, { stdio: 'pipe' }); } catch (e) { log('taskkill', String(e.message).slice(0, 120)); }
  // also kill anything still listening on its port
  try { const ns = execSync(`netstat -ano | findstr :${srv.port} | findstr LISTENING`, { stdio: 'pipe' }).toString(); for (const l of ns.trim().split(/\r?\n/)) { const pid = l.trim().split(/\s+/).pop(); if (pid && pid !== '0') try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' }); } catch {} } } catch {}
  await sleep(1500);
  let listening = true; try { execSync(`netstat -ano | findstr :${srv.port} | findstr LISTENING`, { stdio: 'pipe' }); } catch { listening = false; }
  log('port still listening?', listening);
  const t0 = Date.now();
  base.screens.push({ id: 'orders', file: 'orders.html', title: 'Orders', width: 390, height: 844 });
  await call('PUT', `/screens?dir=${dirQ}`, base);
  let st = null;
  for (let i = 0; i < 80; i++) { await sleep(150); st = (await call('GET', '/state')).screens.find((s) => s.id === 'orders'); if (st && st.state === 'error') break; }
  log('orders state', JSON.stringify(st && [st.state, st.message]), Date.now() - t0, 'ms');
  await sleep(500);
  out.cardFit = await cardInfo('orders'); log('card @fit', JSON.stringify(out.cardFit));
  await h.mouse('mouseMoved', 700, 80); await sleep(200);
  await h.shot('F7-error-fitall.png');
  // zoom to the orders screen to see full card
  await h.evaluate(`__dsCanvas.focusScreen('orders')`); await sleep(600);
  out.cardFocus = await cardInfo('orders'); log('card @focus', JSON.stringify(out.cardFocus), 'cam', await h.evaluate(`__dsCanvas.getCamera().scale`));
  await h.mouse('mouseMoved', 100, 300); await sleep(200);
  await h.shot('F7-error-focus.png');
  // click Retry for real
  const rr = await h.rectOf('[data-screen="orders"] .ds-ab-retry');
  log('retry rect', JSON.stringify(rr));
  const t1 = Date.now();
  await h.mouse('mouseMoved', rr.x + rr.w / 2, rr.y + rr.h / 2); await sleep(150);
  await h.shot('F7-retry-hover.png');
  await h.mouse('mousePressed', rr.x + rr.w / 2, rr.y + rr.h / 2); await h.mouse('mouseReleased', rr.x + rr.w / 2, rr.y + rr.h / 2);
  const seen = [];
  let ready = null;
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const s = (await call('GET', '/state')).screens.find((x) => x.id === 'orders');
    const txt = await h.evaluate(`(()=>{const a=document.querySelector('[data-screen="orders"]');return (a.dataset.state||'')+'|'+((a.querySelector('.ds-ab-state')||{}).innerText||'').replace(/\\s+/g,' ').trim().slice(0,70)})()`);
    if (!seen.length || seen[seen.length - 1][1] !== s.state + '/' + txt) seen.push([Date.now() - t1, s.state + '/' + txt]);
    if (s.state === 'ready') { ready = Date.now() - t1; break; }
  }
  log('retry → ready', ready, 'ms; transitions', JSON.stringify(seen));
  out.retry = { ready, seen };
  await sleep(800);
  await h.shot('F7-recovered.png');
  // other artboards untouched?
  out.after = (await call('GET', '/state')).screens.map((s) => [s.id, s.state]);
  log('states after', JSON.stringify(out.after));
  fs.writeFileSync(path.join(SHOTS, 'v7.json'), JSON.stringify(out, null, 1));
} catch (e) { console.error('FATAL', e); }
await E.die(0);
