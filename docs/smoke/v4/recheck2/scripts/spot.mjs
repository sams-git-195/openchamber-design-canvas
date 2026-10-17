import { boot, sleep, SHOTS as S0, fs, path, WS, os } from './common.mjs';
const OUT = 'C:/Users/samhe/Documents/github/openchamber-design-canvas/docs/smoke/v4/recheck2';
fs.mkdirSync(OUT, { recursive: true });
const regPath = path.join(WS, 'screens.json');
const LONG = 'Q3 Seasonal Checkout Flow — Gift Cards & Loyalty Points Redemption Variant B2';
fs.writeFileSync(path.join(WS, 'tall.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Tall</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="styles.css"></head><body style="background:#e8f0e0"><main style="padding:32px"><h1>Tall</h1><button id="b">Press</button><div style="height:2400px"></div></main></body></html>');
const base = { version: 1, screens: [
  { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
  { id: 'checkout', file: 'checkout.html', title: 'Checkout', width: 390, height: 844 },
  { id: 'menu', file: 'menu.html', title: 'Menu', width: 390, height: 844 },
  { id: 'tall', file: 'tall.html', title: 'Tall', width: 390, height: 1600 },
  { id: 'long', file: 'orders.html', title: LONG, width: 390, height: 844 },
] };
fs.writeFileSync(regPath, JSON.stringify(base, null, 1));
try { fs.unlinkSync(path.join(WS, '.design-studio', 'view.json')); } catch {}
const { E, h, call } = await boot(Number(process.argv[2] || 57800), { n: 5 });
const log = (...a) => console.log(...a);
const out = {};
const shot = async (name, clip) => { const s = await h.cdp('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: clip.scale || 1 } } : {}) }); fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64')); };
const VK = { Escape: 27, Enter: 13, Tab: 9 };
const keyp = async (key) => { await h.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: VK[key] }); await h.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: VK[key] }); await sleep(150); };
const rclick = async (x, y) => { await h.mouse('mouseMoved', x, y); await h.mouse('mousePressed', x, y, 'right'); await h.mouse('mouseReleased', x, y, 'right'); await sleep(300); };
const lclick = async (x, y) => { await h.mouse('mouseMoved', x, y); await sleep(60); await h.mouse('mousePressed', x, y); await h.mouse('mouseReleased', x, y); await sleep(300); };
const clickMenu = async (action) => { const r = await h.evaluate(`(()=>{const e=[...document.querySelectorAll('.ds-context-menu .ds-menu-item')].find(x=>x.dataset.action==='${action}');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`); if (!r) return false; await lclick(r.x + r.w / 2, r.y + r.h / 2); return true; };
const menuItems = () => h.evaluate(`[...document.querySelectorAll('.ds-context-menu .ds-menu-item')].map(x=>x.textContent)`);
try {
  await call('POST', '/mode', { mode: 'edit' }); await sleep(700);
  await shot('00-overview-fitall.png');
  // N1
  out.n1 = await h.evaluate(`[...document.querySelectorAll('.ds-artboard')].map(s=>{const t=s.querySelector('.ds-ab-title');const inner=t.querySelector('*');const el=inner||t;const cs=getComputedStyle(el);return {id:s.dataset.screen,txt:t.textContent.slice(0,30),len:t.textContent.length,innerTag:inner?inner.tagName:null,to:cs.textOverflow,disp:cs.display,ov:cs.overflow,sw:el.scrollWidth,cw:el.clientWidth,clipped:el.scrollWidth>el.clientWidth}})`);
  for (const r of out.n1) log('N1', JSON.stringify(r));
  const lr = await h.rectOf('[data-screen="long"]'); await shot('N1-long-title-header.png', { x: Math.max(0, lr.x - 6), y: Math.max(0, lr.y - 34), width: lr.w + 12, height: 44, scale: 3 });
  // F16
  await h.evaluate(`__dsCanvas.focusScreen('tall')`); await sleep(800);
  await h.mouse('mouseMoved', 500, 700); await sleep(200);
  await shot('F16a-tall-no-scrollbar.png');
  out.tallScroll = await h.evaluate(`(()=>{const f=document.querySelector('[data-screen="tall"] iframe');return {w:f.offsetWidth,cw:f.contentDocument?'sameorigin':'xorigin'}})()`);
  // scrollbar presence inside frame ctx: compare via screenshot only + try find frame ctx
  const q = () => h.evaluate(`(()=>{const c=document.getElementById('canvas');const cs=getComputedStyle(c);return {ae:document.activeElement&&(document.activeElement.id||document.activeElement.tagName),fv:c.matches(':focus-visible'),f:c.matches(':focus'),outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor}})()`);
  await lclick(300, 150); await lclick(900, 900); await sleep(300);
  out.afterClick = await q(); log('F16b after canvas clicks', JSON.stringify(out.afterClick));
  await shot('F16b-after-canvas-click-no-ring.png');
  await keyp('Tab'); await keyp('Tab');
  out.afterTab = await q(); log('F16b after Tab', JSON.stringify(out.afterTab));
  await shot('F16b-after-tab-keyboard-ring.png');
  await h.evaluate(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
  // F15
  await h.evaluate(`__dsCanvas.fitAll()`); await sleep(500);
  const vj = () => { try { return fs.readFileSync(path.join(WS, '.design-studio', 'view.json'), 'utf8'); } catch { return null; } };
  const mt = await h.rectOf('[data-screen="menu"] .ds-ab-title');
  await h.mouse('mouseMoved', mt.x + 8, mt.y + 6); await h.mouse('mousePressed', mt.x + 8, mt.y + 6);
  for (let i = 1; i <= 8; i++) { await h.mouse('mouseMoved', mt.x + 8, mt.y + 6 + i * 20); await sleep(20); }
  await h.mouse('mouseReleased', mt.x + 8, mt.y + 6 + 160); await sleep(1200);
  out.viewMoved = vj(); log('F15 moved', (out.viewMoved || '').replace(/\s+/g, ' ').slice(0, 300));
  await shot('F15-moved.png');
  const mr = await h.rectOf('[data-screen="menu"]');
  await rclick(mr.x + 30, mr.y + 80);
  out.menuItems = await menuItems(); log('menu items', JSON.stringify(out.menuItems));
  await shot('menu-open.png');
  await clickMenu('reset-position'); await sleep(1500);
  out.viewReset = vj(); log('F15 reset', (out.viewReset || '').replace(/\s+/g, ' ').slice(0, 300));
  out.f15HasNull = /null/.test(out.viewReset || '');
  log('F15 contains null?', out.f15HasNull);
  await shot('F15-after-reset.png');
  // F12
  const good = fs.readFileSync(regPath, 'utf8');
  fs.writeFileSync(regPath, good.replace('"screens"', '"screens":[ oops, "x"'));
  await sleep(1800);
  out.banner = await h.evaluate(`(()=>{const n=document.querySelector('.ds-notice');if(!n)return null;const cs=getComputedStyle(n);return {text:n.innerText.replace(/\s+/g,' ').trim(),kind:n.dataset.kind,bg:cs.backgroundColor,color:cs.color,title:n.getAttribute('title')||(n.querySelector('[title]')||{}).title||null}})()`);
  log('F12 banner', JSON.stringify(out.banner));
  await shot('F12-corrupt-banner.png');
  await shot('F12-corrupt-banner-crop.png', { x: 0, y: 0, width: 1010, height: 90, scale: 2 });
  fs.writeFileSync(regPath, good); await sleep(1800);
  out.bannerCleared = await h.evaluate(`!document.querySelector('.ds-notice')`); log('F12 cleared', out.bannerCleared);
  // F13
  await h.evaluate(`__dsCanvas.fitAll()`); await sleep(500);
  // make home active via edit click (header click on home)
  const hr = await h.rectOf('[data-screen="home"] iframe'); await lclick(hr.x + hr.w / 2, hr.y + hr.h / 2); await sleep(400);
  await call('POST', '/mode', { mode: 'play' }); await sleep(700);
  await h.evaluate(`__dsCanvas.fitAll()`); await sleep(500);
  const beforeActive = await h.evaluate(`__dsCanvas.getActive()`); log('F13 active before', beforeActive);
  await shot('F13-before-play-active-' + beforeActive + '.png');
  const fr = await h.rectOf('[data-screen="checkout"] iframe'); const sc = fr.w / 390;
  const st0 = (await call('GET', '/state')).screens.find((s) => s.id === 'checkout');
  const lx = fr.x + 170 * sc, ly = fr.y + 330 * sc;
  await h.mouse('mouseMoved', lx, ly); await sleep(100); await h.mouse('mousePressed', lx, ly); await h.mouse('mouseReleased', lx, ly);
  let st1; for (let i = 0; i < 40; i++) { await sleep(150); st1 = (await call('GET', '/state')).screens.find((s) => s.id === 'checkout'); if (st1.url !== st0.url) break; }
  await sleep(500);
  out.f13 = { before: beforeActive, after: await h.evaluate(`__dsCanvas.getActive()`), navigated: st1.url !== st0.url, urlBefore: st0.url, urlAfter: st1.url };
  log('F13', JSON.stringify(out.f13));
  await shot('F13-after-link-click-active-moved.png');
  await call('POST', '/mode', { mode: 'edit' }); await sleep(500);
  // F17
  const srvFile = path.join(WS, '.design-studio', 'server.json');
  await h.evaluate(`__dsCanvas.fitAll()`); await sleep(500);
  const hh = await h.rectOf('[data-screen="menu"]');
  await rclick(hh.x + 30, hh.y + 80);
  out.menuItems2 = await menuItems(); log('menu items (F17)', JSON.stringify(out.menuItems2));
  await shot('F17-menu-with-stop.png');
  const had = fs.existsSync(srvFile);
  const ok = await clickMenu('stop-server'); log('F17 clicked stop-server', ok, 'server.json before', had);
  let states = [];
  for (let i = 0; i < 30; i++) { await sleep(300); const s = (await call('GET', '/state')).screens.map((x) => x.id + ':' + x.state).join(','); if (!states.length || states[states.length - 1][1] !== s) states.push([i * 300, s]); if (/error/.test(s)) break; }
  log('F17 states', JSON.stringify(states));
  await sleep(800);
  await shot('F17-after-stop-error-card.png');
  out.f17cards = await h.evaluate(`[...document.querySelectorAll('.ds-artboard')].map(a=>a.dataset.screen+':'+(a.dataset.state||'')+':'+((a.querySelector('.ds-ab-state')||{}).innerText||'').replace(/\s+/g,' ').trim().slice(0,90))`);
  log('F17 cards', JSON.stringify(out.f17cards));
  const t = await h.rectOf('[data-screen="menu"] .ds-ab-title'); await rclick(t.x + 8, t.y + 6);
  log('menu open after stop?', await h.evaluate(`!!document.querySelector('.ds-context-menu')`));
  const t1 = Date.now();
  const ok2 = await clickMenu('reload'); log('F17 clicked reload', ok2);
  let rec = null;
  for (let i = 0; i < 100; i++) { await sleep(200); const s = (await call('GET', '/state')).screens.find((x) => x.id === 'menu'); if (s.state === 'ready') { rec = Date.now() - t1; break; } }
  log('F17 menu recovered ms', rec);
  await sleep(1200);
  await shot('F17-after-reload-recovered.png');
  out.f17 = { stopClicked: ok, states, cards: out.f17cards, reloadClicked: ok2, recoveredMs: rec, after: (await call('GET', '/state')).screens.map((x) => x.id + ':' + x.state) };
  log('F17 after', JSON.stringify(out.f17.after));
  fs.writeFileSync(path.join(OUT, 'spot.json'), JSON.stringify(out, null, 1));
} catch (e) { console.error('FATAL', e); }
await E.die(0);
