import { boot, sleep, SHOTS, fs, path, WS } from './common.mjs';
const { E, h, call } = await boot(57111);
const log = (...a) => console.log(...a);
const out = {};
const regPath = path.join(WS, 'screens.json');
const VK = { ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, Escape: 27, Enter: 13 };
const keyp = async (key) => {
  await h.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: VK[key] });
  await h.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: VK[key] });
  await sleep(120);
};
const rclick = async (x, y) => { await h.mouse('mouseMoved', x, y); await h.mouse('mousePressed', x, y, 'right'); await h.mouse('mouseReleased', x, y, 'right'); await sleep(350); };
try {
  // A: first-open framing (no interaction)
  await h.shot('A-first-open.png');
  out.firstOpen = await h.evaluate(`JSON.stringify({cam:__dsCanvas.getCamera(),iw:innerWidth,ih:innerHeight,active:__dsCanvas.getActive(),mode:__dsCanvas.getMode()})`);
  log('A first-open', out.firstOpen);
  await call('POST', '/mode', { mode: 'edit' }); await sleep(500);

  // B: ghost hover (visual): hover menu then checkout
  const mr = await h.rectOf('[data-screen="menu"]'), cr = await h.rectOf('[data-screen="checkout"]');
  log('rects', JSON.stringify({ mr, cr }));
  await h.mouse('mouseMoved', mr.x + 30, mr.y + 80); await sleep(150); await h.mouse('mouseMoved', mr.x + 40, mr.y + 100); await sleep(500);
  await h.shot('B1-hover-A.png');
  await h.mouse('mouseMoved', cr.x + 30, cr.y + 80); await sleep(150); await h.mouse('mouseMoved', cr.x + 44, cr.y + 100); await sleep(500);
  await h.shot('B2-hover-B.png');
  await h.mouse('mouseMoved', 600, 60); await sleep(150); await h.mouse('mouseMoved', 610, 65); await sleep(500);
  await h.shot('B3-hover-none.png');

  // F6: active outline at fit-all
  await h.evaluate(`__dsCanvas.setActive('home')`); await sleep(300);
  out.outline = await h.evaluate(`(()=>{const a=document.querySelector('.ds-artboard[data-screen=home]');const cs=getComputedStyle(a);const cam=parseFloat(getComputedStyle(document.getElementById('camera')).getPropertyValue('--cam-scale'));return {active:a.dataset.active,outlineWidth:cs.outlineWidth,cam,effectivePx:parseFloat(cs.outlineWidth)*cam,style:cs.outlineStyle,color:cs.outlineColor,offset:cs.outlineOffset}})()`);
  log('F6 home active', JSON.stringify(out.outline));
  await h.mouse('mouseMoved', 600, 80); await sleep(200);
  await h.shot('F6-active-fitall.png');

  // F9: dot grid
  out.grid = await h.evaluate(`(()=>{const c=document.getElementById('canvas');const cs=getComputedStyle(c);return {bgImage:cs.backgroundImage.slice(0,200),bgSize:cs.backgroundSize,bgColor:cs.backgroundColor}})()`);
  log('F9', JSON.stringify(out.grid));

  // F2: context menu at the window corner
  await h.evaluate(`__dsCanvas.focusScreen('home')`); await sleep(500);
  const dim = await h.evaluate(`({iw:innerWidth,ih:innerHeight})`);
  const hit = await h.evaluate(`(()=>{const e=document.elementFromPoint(innerWidth-6,innerHeight-6);return e?{tag:e.tagName,cls:String(e.className||'').slice(0,60),art:!!e.closest('.ds-artboard')}:null})()`);
  log('F2 corner hit', JSON.stringify({ dim, hit }));
  const menuRect = () => h.evaluate(`(()=>{const m=document.querySelector('.ds-context-menu');if(!m)return null;const r=m.getBoundingClientRect();return {x:r.x,y:r.y,r:r.right,b:r.bottom,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()`);
  async function openMenuAt(x, y) {
    const art = await h.evaluate(`(()=>{const e=document.elementFromPoint(${x},${y});return !!(e&&e.closest('.ds-artboard'))})()`);
    if (art) await rclick(x, y);
    else { await h.evaluate(`(()=>{const a=document.querySelector('.ds-artboard[data-screen=home]');a.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:${x},clientY:${y},button:2}));})()`); await sleep(350); }
    return { real: art, rect: await menuRect() };
  }
  const corner = await openMenuAt(dim.iw - 6, dim.ih - 6);
  log('F2 menu @corner', JSON.stringify(corner));
  out.menuCorner = corner;
  await h.shot('F2-menu-corner.png');
  out.menuStruct = await h.evaluate(`(()=>{const m=document.querySelector('.ds-context-menu');return [...m.children].map(c=>c.getAttribute('role')==='separator'?'---':c.textContent.trim()+'['+c.dataset.action+']')})()`);
  log('F10 structure', JSON.stringify(out.menuStruct));
  out.menuIcons = await h.evaluate(`(()=>{const it=document.querySelector('.ds-context-menu .ds-menu-item');const b=getComputedStyle(it,'::before');const a=getComputedStyle(it,'::after');return {before:b.content,after:a.content,pad:getComputedStyle(it).paddingLeft}})()`);
  log('F10 icons', JSON.stringify(out.menuIcons));
  const focusLabel = () => h.evaluate(`document.activeElement&&document.activeElement.textContent`);
  const seq = [['start', await focusLabel()]];
  for (let i = 0; i < 8; i++) { await keyp('ArrowDown'); seq.push(['Down', await focusLabel()]); }
  await keyp('ArrowUp'); seq.push(['Up', await focusLabel()]);
  await keyp('End'); seq.push(['End', await focusLabel()]);
  await keyp('Home'); seq.push(['Home', await focusLabel()]);
  log('F10 kbd', JSON.stringify(seq));
  out.kbd = seq;
  await keyp('Escape'); await sleep(150);
  out.menuClosedAfterEsc = await h.evaluate(`!document.querySelector('.ds-context-menu')`);
  log('Esc closes', out.menuClosedAfterEsc);
  for (const [nm, x, y] of [['bl', 6, dim.ih - 6], ['tr', dim.iw - 6, 60], ['mid', 500, 500]]) {
    const r = await openMenuAt(x, y); log('menu', nm, JSON.stringify(r)); out['menu_' + nm] = r;
    await keyp('Escape'); await sleep(150);
  }

  // rename flow via menu
  await h.evaluate(`__dsCanvas.fitAll()`); await sleep(500);
  const mr2 = await h.rectOf('[data-screen="menu"]');
  await rclick(mr2.x + 20, mr2.y + 60);
  await h.shot('menu-open-fitall.png');
  await h.evaluate(`[...document.querySelectorAll('.ds-context-menu .ds-menu-item')].find(x=>x.dataset.action==='rename').click()`);
  await sleep(300);
  out.renameInput = await h.evaluate(`(()=>{const i=document.querySelector('.ds-ab-rename');if(!i)return null;const r=i.getBoundingClientRect();const ab=i.closest('.ds-artboard').getBoundingClientRect();return {w:r.width,abW:ab.width,x:r.x,right:r.right,iw:innerWidth,val:i.value,focused:document.activeElement===i}})()`);
  log('rename input', JSON.stringify(out.renameInput));
  await h.shot('H-rename-open.png');
  await h.evaluate(`document.querySelector('.ds-ab-rename').select()`);
  await h.cdp('Input.insertText', { text: 'Menu v2 — Seasonal Specials & Limited' });
  await sleep(100);
  await keyp('Enter');
  const t0 = Date.now(); let title = null;
  for (let i = 0; i < 40; i++) { await sleep(100); title = await h.evaluate(`document.querySelector('[data-screen=menu] .ds-ab-title').textContent`); if (/Seasonal/.test(title)) break; }
  out.renameMs = Date.now() - t0;
  log('rename converged', out.renameMs, 'ms', JSON.stringify(title), 'reg:', JSON.parse(fs.readFileSync(regPath, 'utf8')).screens.find((s) => s.id === 'menu').title);
  await h.shot('H-renamed.png');
  await rclick(mr2.x + 20, mr2.y + 60);
  await h.evaluate(`[...document.querySelectorAll('.ds-context-menu .ds-menu-item')].find(x=>x.dataset.action==='rename').click()`); await sleep(300);
  await h.cdp('Input.insertText', { text: 'zzz' });
  await keyp('Escape'); await sleep(400);
  out.afterEsc = await h.evaluate(`(()=>{const t=document.querySelector('[data-screen=menu] .ds-ab-title');return {text:t.textContent,hasInput:!!document.querySelector('.ds-ab-rename'),active:document.activeElement&&String(document.activeElement.className).slice(0,40),outline:getComputedStyle(t).outlineStyle}})()`);
  log('rename Esc', JSON.stringify(out.afterEsc));
  await h.mouse('mouseMoved', 700, 80); await sleep(200);
  await h.shot('H-after-esc.png');
  fs.writeFileSync(path.join(SHOTS, 'v1.json'), JSON.stringify(out, null, 1));
} catch (e) { console.error('FATAL', e); }
await E.die(0);
