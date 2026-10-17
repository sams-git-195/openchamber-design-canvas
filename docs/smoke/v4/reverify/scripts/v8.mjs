import { boot, sleep, SHOTS, fs, path, WS } from './common.mjs';
const regPath = path.join(WS, 'screens.json');
fs.writeFileSync(path.join(WS, 'tall.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Tall</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="styles.css"></head><body style="background:#e8f0e0"><main style="padding:32px"><h1>Tall</h1><button id="b">Press</button><div style="height:2400px"></div></main></body></html>');
const base = { version: 1, screens: [
  { id: 'home', file: 'home.html', title: 'Home', width: 1280, height: 800 },
  { id: 'checkout', file: 'checkout.html', title: 'Checkout', width: 390, height: 844 },
  { id: 'menu', file: 'menu.html', title: 'Menu', width: 390, height: 844 },
  { id: 'tall', file: 'tall.html', title: 'Tall', width: 390, height: 1600 },
] };
fs.writeFileSync(regPath, JSON.stringify(base, null, 1));
try { fs.unlinkSync(path.join(WS, '.design-studio', 'view.json')); } catch {}
const { E, h, call } = await boot(57141, { n: 4 });
const log = (...a) => console.log(...a);
const out = {};
const VK = { Escape: 27, Enter: 13 };
const keyp = async (key) => { await h.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: VK[key] }); await h.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: VK[key] }); await sleep(120); };
const clip = async (name, r, scale = 3) => { const s = await h.cdp('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.w, height: r.h, scale } }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(s.data, 'base64')); };
try {
  await sleep(500);
  await h.shot('N-first-open-4.png');
  out.cam = await h.evaluate(`JSON.stringify(__dsCanvas.getCamera())`); log('cam', out.cam);
  out.titleCss = await h.evaluate(`[...document.querySelectorAll('.ds-ab-title')].map(t=>{const cs=getComputedStyle(t);const p=t.parentElement;const pcs=getComputedStyle(p);const r=t.getBoundingClientRect();return {txt:t.textContent,display:cs.display,overflow:cs.overflow,to:cs.textOverflow,ws:cs.whiteSpace,w:Math.round(r.width),sw:t.scrollWidth,cw:t.clientWidth,pDisplay:pcs.display,pOverflow:pcs.overflow,maxW:cs.maxWidth}})`);
  for (const t of out.titleCss) log('title', JSON.stringify(t));
  const row = await h.evaluate(`(()=>{const a=[...document.querySelectorAll('.ds-artboard')].map(x=>x.getBoundingClientRect());return {x:Math.min(...a.map(r=>r.x))-4,y:Math.min(...a.map(r=>r.y))-30,w:Math.max(...a.map(r=>r.right))-Math.min(...a.map(r=>r.x))+8,h:40}})()`);
  await clip('N-header-row-3x.png', row, 2);

  // F13 play mode: click link in checkout
  await call('POST', '/mode', { mode: 'play' }); await sleep(600);
  await h.evaluate(`__dsCanvas.focusScreen('checkout')`); await sleep(600);
  const before = { active: await h.evaluate(`__dsCanvas.getActive()`) };
  const fr = await h.rectOf('[data-screen="checkout"] iframe');
  const sc = fr.w / 390;
  const st0 = (await call('GET', '/state')).screens.find((s) => s.id === 'checkout');
  await h.mouse('mouseMoved', fr.x + 170 * sc, fr.y + 330 * sc); await sleep(100);
  await h.mouse('mousePressed', fr.x + 170 * sc, fr.y + 330 * sc); await h.mouse('mouseReleased', fr.x + 170 * sc, fr.y + 330 * sc);
  let st1 = null; const t0 = Date.now();
  for (let i = 0; i < 40; i++) { await sleep(150); st1 = (await call('GET', '/state')).screens.find((s) => s.id === 'checkout'); if (st1.url !== st0.url) break; }
  out.play = { before, urlBefore: st0.url, urlAfter: st1.url, ms: Date.now() - t0, activeAfter: await h.evaluate(`__dsCanvas.getActive()`), size: await h.evaluate(`JSON.stringify(__dsCanvas.getScreens().find(s=>s.id==='checkout'))`) , regFile: JSON.parse(fs.readFileSync(regPath, 'utf8')).screens.find((s) => s.id === 'checkout').file };
  log('play', JSON.stringify(out.play).slice(0, 700));
  await h.shot('N-play-after-nav.png');
  // play-mode menu only on header; right click on the body should not open
  await h.mouse('mouseMoved', fr.x + 100, fr.y + 500); await h.mouse('mousePressed', fr.x + 100, fr.y + 500, 'right'); await h.mouse('mouseReleased', fr.x + 100, fr.y + 500, 'right'); await sleep(300);
  out.playMenuOnBody = await h.evaluate(`!!document.querySelector('.ds-context-menu')`);
  const tr = await h.rectOf('[data-screen="checkout"] .ds-ab-title');
  await h.mouse('mouseMoved', tr.x + 10, tr.y + 5); await h.mouse('mousePressed', tr.x + 10, tr.y + 5, 'right'); await h.mouse('mouseReleased', tr.x + 10, tr.y + 5, 'right'); await sleep(300);
  out.playMenuOnHeader = await h.evaluate(`!!document.querySelector('.ds-context-menu')`);
  log('play menu body/header', out.playMenuOnBody, out.playMenuOnHeader);
  await keyp('Escape');
  await call('POST', '/mode', { mode: 'edit' }); await sleep(500);

  // F15 reset position -> view.json
  await h.evaluate(`__dsCanvas.fitAll()`); await sleep(500);
  const mt = await h.rectOf('[data-screen="menu"] .ds-ab-title');
  await h.mouse('mouseMoved', mt.x + 8, mt.y + 6); await h.mouse('mousePressed', mt.x + 8, mt.y + 6);
  for (let i = 1; i <= 8; i++) { await h.mouse('mouseMoved', mt.x + 8, mt.y + 6 + i * 20); await sleep(20); }
  await h.mouse('mouseReleased', mt.x + 8, mt.y + 6 + 160); await sleep(1200);
  const vj = () => { try { return fs.readFileSync(path.join(WS, '.design-studio', 'view.json'), 'utf8'); } catch { return null; } };
  out.viewMoved = vj(); log('view after move', (out.viewMoved || '').replace(/\s+/g, ' ').slice(0, 300));
  await h.shot('N-moved.png');
  const mr = await h.rectOf('[data-screen="menu"]');
  await h.mouse('mouseMoved', mr.x + 30, mr.y + 80); await h.mouse('mousePressed', mr.x + 30, mr.y + 80, 'right'); await h.mouse('mouseReleased', mr.x + 30, mr.y + 80, 'right'); await sleep(300);
  await h.evaluate(`[...document.querySelectorAll('.ds-context-menu .ds-menu-item')].find(x=>x.dataset.action==='reset-position').click()`); await sleep(1200);
  out.viewReset = vj(); log('view after reset', (out.viewReset || '').replace(/\s+/g, ' ').slice(0, 300));

  // F12 corrupt registry banner
  const good = fs.readFileSync(regPath, 'utf8');
  fs.writeFileSync(regPath, good.replace('"screens"', '"screens":[ oops, "x"'));
  await sleep(1500);
  out.banner = await h.evaluate(`(()=>{const n=document.querySelector('.ds-notice');if(!n)return null;const cs=getComputedStyle(n);return {text:n.innerText.replace(/\\s+/g,' ').trim(),bg:cs.backgroundColor,color:cs.color,border:cs.borderColor,title:n.getAttribute('title')||(n.querySelector('[title]')||{}).title||null,dot:getComputedStyle(n.querySelector('.ds-notice-dot')||n).backgroundColor}})()`);
  log('F12 banner', JSON.stringify(out.banner));
  await h.shot('N-banner.png');
  fs.writeFileSync(regPath, good); await sleep(1500);
  out.bannerCleared = await h.evaluate(`!document.querySelector('.ds-notice')`); log('banner cleared', out.bannerCleared);

  // F16 scrollbar in tall artboard (edit mode) at 100% zoom of tall
  await h.evaluate(`__dsCanvas.focusScreen('tall')`); await sleep(700);
  await h.mouse('mouseMoved', 500, 700); await sleep(200);
  await h.shot('N-tall-focus.png');
  fs.writeFileSync(path.join(SHOTS, 'v8.json'), JSON.stringify(out, null, 1));
} catch (e) { console.error('FATAL', e); }
await E.die(0);
