import { boot, sleep, fs, path, WS } from './common.mjs';
const OUT = 'C:/Users/samhe/Documents/github/openchamber-design-canvas/docs/smoke/v4/recheck2';
fs.writeFileSync(path.join(WS, 'screens.json'), fs.readFileSync(path.join(WS, '..', 'screens.base.json'), 'utf8'));
try { fs.unlinkSync(path.join(WS, '.design-studio', 'view.json')); } catch {}
const { E, h, call } = await boot(Number(process.argv[2] || 57820), { n: 3 });
const log = (...a) => console.log(...a);
const shot = async (name) => { const s = await h.cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1010, height: 400, scale: 1 } }); fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64')); };
const key = async (key, code, vk, mod = 0) => { await h.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers: mod }); await h.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mod }); await sleep(150); };
const q = () => h.evaluate(`(()=>{const c=document.getElementById('canvas');const cs=getComputedStyle(c);const a=document.activeElement;return {ae:a&&(a.id||a.tagName),canvasFocused:a===c,fv:c.matches(':focus-visible'),ptr:c.getAttribute('data-pointer-focus'),outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor}})()`);
try {
  await call('POST', '/mode', { mode: 'edit' }); await sleep(700);
  await h.mouse('mouseMoved', 600, 200); await h.mouse('mousePressed', 600, 200); await h.mouse('mouseReleased', 600, 200); await sleep(300);
  log('A. after mouse click on canvas', JSON.stringify(await q())); await shot('F16b-A-after-mouse-click.png');
  await key('Shift', 'ShiftLeft', 16);
  log('B. after click + first keydown (Shift)', JSON.stringify(await q())); await shot('F16b-B-after-click-then-key-ring.png');
  // pure keyboard: reload page focus: blur then Tab through
  await h.evaluate(`document.activeElement.blur()`);
  const seen = [];
  for (let i = 0; i < 14; i++) { await key('Tab', 'Tab', 9); const s = await q(); seen.push(s.ae); if (s.canvasFocused) { log('C. Tab reached canvas at step', i + 1, JSON.stringify(s)); await shot('F16b-C-keyboard-tab-ring.png'); break; } }
  log('Tab order seen', JSON.stringify(seen));
} catch (e) { console.error('FATAL', e); }
await E.die(0);
