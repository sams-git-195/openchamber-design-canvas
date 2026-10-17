import { boot, sleep, SHOTS, fs, path, WS } from './common.mjs';
const regPath = path.join(WS, 'screens.json');
const LONG = 'Home — a very long screen title that keeps going and going and going'.padEnd(72, '.').slice(0, 72);
fs.writeFileSync(regPath, JSON.stringify({ version: 1, screens: [
  { id: 'home', file: 'home.html', title: LONG, width: 1280, height: 800 },
  { id: 'banner', file: 'orders.html', title: 'Banner 8000x200', width: 8000, height: 200 },
  { id: 'menu', file: 'menu.html', title: 'Menu v2 — Seasonal', width: 390, height: 844 },
] }, null, 1));
const { E, h, call } = await boot(57121);
const log = (...a) => console.log(...a);
const out = { LONGlen: LONG.length };
try {
  await sleep(600);
  await h.shot('F3-stress-fitall.png');
  out.cam = await h.evaluate(`JSON.stringify(__dsCanvas.getCamera())`);
  log('cam', out.cam);
  out.toolbar = await h.evaluate(`(()=>{
    const cand=[...document.querySelectorAll('header, [role=toolbar], #toolbar, #root > div')].slice(0,6);
    const tb=document.querySelector('[role=toolbar]')||document.querySelector('header')||document.getElementById('toolbar');
    const res={found:!!tb};
    if(tb){const r=tb.getBoundingClientRect();res.rect={x:r.x,y:r.y,w:r.width,h:r.height};res.scrollW=tb.scrollWidth;res.clientW=tb.clientWidth;res.overflowX=getComputedStyle(tb).overflowX;}
    // any horizontally scrollable element in the top 80px
    const sc=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.top<80&&r.height>0&&e.scrollWidth>e.clientWidth+1&&['auto','scroll'].includes(getComputedStyle(e).overflowX)}).map(e=>e.tagName+'.'+String(e.className).slice(0,40));
    res.scrollables=sc;
    // docs scroll
    res.docScroll=document.documentElement.scrollWidth>document.documentElement.clientWidth;
    // status icon (right-most button) in viewport?
    const btns=[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().top<60).map(b=>{const r=b.getBoundingClientRect();return {label:(b.getAttribute('aria-label')||b.textContent||'').trim().slice(0,28),x:Math.round(r.x),r:Math.round(r.right),vis:r.right<=innerWidth&&r.left>=0}});
    res.btns=btns;res.iw=innerWidth;
    return res})()`);
  log('F4 toolbar', JSON.stringify(out.toolbar));
  out.headers = await h.evaluate(`[...document.querySelectorAll('.ds-artboard')].map(s=>{const t=s.querySelector('.ds-ab-title'),z=s.querySelector('.ds-ab-size');const a=s.getBoundingClientRect(),tr=t.getBoundingClientRect(),zr=z.getBoundingClientRect();const cs=getComputedStyle(t);return {id:s.dataset.screen,artW:Math.round(a.width),compact:s.dataset.headerCompact||s.getAttribute('data-header-compact'),title:t.textContent.slice(0,40),titleBox:[Math.round(tr.left),Math.round(tr.right)],sizeBox:[Math.round(zr.left),Math.round(zr.right)],sizeShown:getComputedStyle(z).display!=='none'&&zr.width>0,overlap:zr.width>0&&tr.right>zr.left&&tr.left<zr.right&&tr.bottom>zr.top&&tr.top<zr.bottom,overflow:cs.textOverflow,scrollW:t.scrollWidth,clientW:t.clientWidth,fs:cs.fontSize}})`);
  for (const x of out.headers) log('hdr', JSON.stringify(x));
  // crop header of home at 3x
  const hr = await h.rectOf('[data-screen="home"]');
  const clipShot = async (name, r) => { const s = await h.cdp('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.w, height: r.h, scale: 2 } }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(s.data, 'base64')); };
  await clipShot('F3-header-crop.png', { x: 0, y: 0, w: 1010, h: 60 });
  // zoom to menu to compare at 37%/45%
  // 100% zoom for dot grid
  await h.evaluate(`__dsCanvas.zoomCamera&&0`);
  // set 100%: use toolbar zoom menu
  await h.evaluate(`document.querySelector('button[aria-label*="oom"], button[aria-haspopup]')&&0`);
  // fit on menu then zoom 100 via __dsToolbarBridge
  await h.evaluate(`__dsToolbarBridge.zoomTo(1)`); await sleep(500);
  await h.mouse('mouseMoved', 500, 600); await sleep(200);
  await h.shot('F9-zoom100.png');
  out.zoom100 = await h.evaluate(`JSON.stringify(__dsCanvas.getCamera())`);
  await h.evaluate(`__dsCanvas.fitAll()`); await sleep(500);
  // active outline crisp at fit-all (~12%): activate banner (select a different one)
  await h.evaluate(`__dsCanvas.setActive('menu')`); await sleep(300);
  out.outline = await h.evaluate(`(()=>{const a=document.querySelector('.ds-artboard[data-screen=menu]');const cs=getComputedStyle(a);const cam=parseFloat(getComputedStyle(document.getElementById('camera')).getPropertyValue('--cam-scale'));return {cam,outlineWidth:cs.outlineWidth,effectivePx:parseFloat(cs.outlineWidth)*cam}})()`);
  log('F6 @fit', JSON.stringify(out.outline));
  const mr = await h.rectOf('[data-screen="menu"]');
  log('menu rect', JSON.stringify(mr));
  await h.mouse('mouseMoved', 900, 700); await sleep(200);
  await h.shot('F6-outline-lowzoom.png');
  await clipShot('F6-outline-crop.png', { x: mr.x - 40, y: mr.y - 40, w: mr.w + 80, h: Math.min(mr.h + 80, 400) });
  fs.writeFileSync(path.join(SHOTS, 'v3.json'), JSON.stringify(out, null, 1));
} catch (e) { console.error('FATAL', e); }
await E.die(0);
