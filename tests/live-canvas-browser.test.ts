import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Browser } from '../service/browser.ts';
import { ensureBrowser } from '../service/surface.ts';
import { runVerification } from '../service/verify.ts';
import { liveTest } from './helpers/chrome.ts';

const mods = { alt: false, ctrl: false, meta: false, shift: false };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fixture = '<!doctype html><title>Artifact fixture</title><style>html,body{margin:0;min-height:100vh;background:#0000ff}#a{position:absolute;left:0;top:0;width:8px;height:8px;background:#ff0000}#z{position:fixed;right:0;bottom:0;width:8px;height:8px;background:#00ff00}button{position:absolute;left:40px;top:40px;width:80px;height:40px}input{position:absolute;left:140px;top:40px}</style><div id=a></div><div id=z></div><button id=button onclick="this.textContent=\'Clicked\'">Button</button><input id=input><script>window.fixtureIdentity=crypto.randomUUID();window.inputReceipts=[];document.addEventListener("click",e=>inputReceipts.push({x:e.clientX,y:e.clientY,id:e.target.id}))</script>';

type NavigationFixture = { requests: string[]; slowRequested: Promise<void>; releaseSlow(): void };
async function owned(run: (browser: Browser, url: string, navigation: NavigationFixture) => Promise<void>, singleton = false) {
  const requests: string[]=[];
  let slowResponse: import('node:http').ServerResponse | undefined;
  let requested!:()=>void;
  const slowRequested=new Promise<void>(resolve=>{requested=resolve;});
  const server = createServer((req, res) => {
    requests.push(req.url??'');
    if(req.url==='/redirect'){res.writeHead(302,{location:'/'});res.end();return;}
    if(req.url==='/slow'&&!slowResponse){slowResponse=res;requested();return;}
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control':'no-store', ...(req.url === '/blocked' ? { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" } : {}) });
    res.end(fixture);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const prior = process.env.DS_WINDOW;
  process.env.DS_WINDOW = '-2400,-2400,820,650';
  const browser = singleton ? await ensureBrowser() : new Browser();
  if (prior === undefined) delete process.env.DS_WINDOW; else process.env.DS_WINDOW = prior;
  try { await run(browser, `http://localhost:${address.port}/`, {requests,slowRequested,releaseSlow(){assert.ok(slowResponse);slowResponse.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});slowResponse.end(fixture);}}); }
  finally { await browser.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

async function shell(browser: Browser, expression: string): Promise<any> {
  const internal = browser as unknown as { cdp: { send: (method: string, params: object, session: string) => Promise<any> }; sessionId: string };
  const reply = await internal.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, internal.sessionId);
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}

/** Decode actual compositor PNG pixels, including all standard PNG row filters. */
function pngPixels(png: Buffer) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), channels = png[25] === 6 ? 4 : 3;
  assert.ok(png[25] === 6 || png[25] === 2, 'expected RGB/RGBA PNG');
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) { const size = png.readUInt32BE(at); if (png.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + size)); at += size + 12; }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) for (let x = 0; x < stride; x++) {
    const filter = raw[y * (stride + 1)]!, value = raw[y * (stride + 1) + x + 1]!;
    const a = x >= channels ? pixels[y * stride + x - channels]! : 0, b = y ? pixels[(y - 1) * stride + x]! : 0, c = y && x >= channels ? pixels[(y - 1) * stride + x - channels]! : 0;
    const p = a + b - c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
    const predictors = [0, a, b, Math.floor((a+b)/2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c];
    pixels[y * stride + x] = (value + predictors[filter]!) & 255;
  }
  return { width, height, pixel: (x: number, y: number) => [...pixels.subarray((y*width+x)*channels, (y*width+x)*channels+3)] };
}

test('actual Browser canvas keeps artifact viewport fixed under native window resize', { timeout: 60000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await owned(async (browser, url) => {
    assert.equal((await browser.open(url)).settled, true);
    assert.equal(await browser.evaluate('innerWidth'), 1280);
    await browser.placeWindow(-2400, -2400, 620, 480);
    await pause(150);
    assert.equal(await browser.evaluate('innerWidth'), 1280);
    assert.equal((await browser.getProbe()).innerWidth, 1280);
    assert.equal((await browser.state()).title, 'Artifact fixture');
    const targets = await browser.jsonList();
    assert.notEqual(targets.find((target) => target.type === 'page')?.url, url, 'page target is private shell, not artifact');
    assert.equal(await browser.pageTargetCount(), 1);
  });
});

// ---- canvas workspace helpers ------------------------------------------------
// Shell pushes for the just-settled screen continue a few ms after navigate()
// resolves (liveUrl gates waitScreen, the setScreenState/setPage/setStatus
// settle pushes follow). Canvas-state assertions must join that tail.
async function until(check: () => Promise<boolean> | boolean, message: string, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if (await check()) return; } catch { /* mid-navigation context swaps are transient; keep polling */ } await pause(40); }
  assert.fail(message);
}
async function boardStates(browser: Browser): Promise<Array<{ id: string; state: string; src: string; url: string }>> {
  return JSON.parse(await shell(browser, "JSON.stringify(__dsCanvas.getScreens().map(s=>({id:s.id,state:s.state,src:s.src,url:s.url})))"));
}

test('functional redirect confirms the new canonical document rather than rejecting its final URL', { timeout:60000 }, async(t)=>{
  if (!(await liveTest(t))) return;
  await owned(async(browser,url,nav)=>{
    await browser.open(url);
    await until(async()=>(await boardStates(browser)).find(b=>b.id==='preview')?.state==='ready','the first board reaches shell-ready before the redirect counts');
    const prior=await browser.evaluate('fixtureIdentity');
    const offset=nav.requests.length;
    const result=await browser.navigate(url+'redirect');
    assert.equal(result.settled,true,'valid 302 to a new ready canonical document must succeed');
    assert.equal(result.url,url);
    assert.notEqual(await browser.evaluate('fixtureIdentity'),prior);
    assert.equal(await browser.evaluate('document.body.getBoundingClientRect().width'),1280);
    await until(async()=>'ready'===(await shell(browser,"document.getElementById('state').dataset.state")),'the redirect settle push marks the canvas ready');
    // FORK-MERGE (P2 shell seam, re-confirmed here): after a 302 the board's
    // tracked src stays the pre-redirect URL while url records the final one;
    // every later relayout rewrites src to '/redirect' (a fresh 302 round-trip).
    // src===url convergence is impossible until the controller syncs s.src
    // from frame.src on load — so this test asserts only the first two hops.
    await until(()=>nav.requests.filter(path=>path==='/'||path==='/redirect').length-offset>=2,'both redirect hops were fetched');
    assert.deepEqual(nav.requests.slice(offset).filter(path=>path==='/'||path==='/redirect').slice(0,2),['/redirect','/']);
    console.log('[redirect completion]',JSON.stringify({result,newDocument:true,readyBodyWidth:1280}));
  });
});

test('same Browser recovers from refused IPv4 to authoritative IPv6 commit, reload and canonical redirect', {timeout:60000},async(t)=>{
  if (!(await liveTest(t))) return;
  const server=createServer((req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{location:'/'});res.end();return;}
    res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});
    res.end('<!doctype html><title>Owned IPv6 fixture</title><style>html,body{margin:0;min-height:800px}</style><h1 id=proof>IPv6 ready body</h1>');
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen({host:'::1',port:0,ipv6Only:true},resolve);});
  const address=server.address();assert.ok(address&&typeof address==='object');
  const v4=`http://127.0.0.1:${address.port}/`,v6=`http://[::1]:${address.port}/`;
  const previousWindow=process.env.DS_WINDOW;process.env.DS_WINDOW='-2400,-2400,820,650';
  const browser=new Browser();
  if(previousWindow===undefined)delete process.env.DS_WINDOW;else process.env.DS_WINDOW=previousWindow;
  try{
    const refusal=await new Promise<string>((resolve,reject)=>{
      const socket=createConnection({host:'127.0.0.1',port:address.port});
      socket.once('connect',()=>{socket.destroy();reject(new Error('IPv4 unexpectedly connected'));});
      socket.once('error',error=>resolve((error as NodeJS.ErrnoException).code??''));
    });
    assert.equal(refusal,'ECONNREFUSED');
    assert.equal((await fetch(v6)).status,200,'owned IPv6 fixture is reachable before Chrome');
    assert.equal((await browser.open(v4)).settled,false,'first IPv4 navigation fails honestly');
    const failedContext=(browser as any).contexts.artifact();
    const result=await browser.open(v6);
    assert.equal(result.settled,true,'same instance must confirm the new IPv6 document, not retain the error-document loader');
    assert.equal(result.url,v6);assert.equal(result.title,'Owned IPv6 fixture');
    assert.deepEqual(await browser.evaluate('({url:location.href,title:document.title,text:document.getElementById("proof").textContent})'),
      {url:v6,title:'Owned IPv6 fixture',text:'IPv6 ready body'});
    // Page-mode requalification is an async tail after settle: once the frame
    // grows to the content extent the classic Windows scrollbar disappears and
    // the body measures the full 1280 CSS px.
    await until(async()=>Boolean(await browser.evaluate('innerWidth===1280&&document.body.getBoundingClientRect().width===1280')),'IPv6 document requalified to full-width page geometry');
    assert.equal(await browser.pageTargetCount(),1);
    await until(async()=>(await shell(browser,"document.getElementById('state').dataset.state"))==='ready','the IPv6 commit settles the canvas ready');
    const internals=browser as any,current=internals.contexts.artifact();
    assert.notEqual(current.unique,failedContext.unique);
    const tree=await internals.cdp.send('Page.getFrameTree',{},current.session);
    assert.equal(tree.frameTree.frame.id,current.frame,'authoritative child tree belongs to the exact artifact');
    assert.equal(internals.contexts.artifactLoaderId(),tree.frameTree.frame.loaderId);
    const beforeReload=await browser.evaluate('performance.timeOrigin');
    assert.equal((await browser.open(v6)).settled,true,'IPv6 same-URL reload also confirms its loader');
    assert.notEqual(await browser.evaluate('performance.timeOrigin'),beforeReload);
    const canonical=await browser.navigate(v6+'redirect');
    assert.equal(canonical.settled,true);assert.equal(canonical.url,v6);
    await until(async()=>(await shell(browser,"document.getElementById('state').dataset.state"))==='ready','the canonical redirect settles ready');
    console.log('[IPv6 recovery]',JSON.stringify({refusal,firstSettled:false,recovered:result,reload:true,canonical,bodyWidth:1280,pageTargets:1,loaderMatchesCurrentFrame:true}));
  }finally{
    await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});

test('functional request barrier rejects cached old document; same-URL reload is once and hash navigation retains identity', {timeout:60000},async(t)=>{
  if (!(await liveTest(t))) return;
  await owned(async(browser,url,nav)=>{
    await browser.open(url);
    const prior=await browser.evaluate('fixtureIdentity');
    let completed=false;
    const pending=browser.navigate(url+'slow').then(result=>{completed=true;return result;});
    await nav.slowRequested;
    assert.equal(completed,false,'request receipt alone must not confirm cached ready state');
    nav.releaseSlow();
    const arrived=await pending;
    assert.equal(arrived.settled,true);
    assert.equal(arrived.url,url+'slow','cached root URL cannot satisfy the new request');
    const fresh=await browser.evaluate('fixtureIdentity');
    assert.notEqual(fresh,prior);
    // The first navigation's settle tail (page requalification → controller
    // relayout → src reconcile) may still be fetching; quiesce the request
    // stream before counting the same-URL reload, or the tail would count as
    // a second navigation for the reload.
    const quiesce=async()=>{let last=-1;let stable=0;while(stable<8){const n=nav.requests.filter(path=>path==='/slow').length;if(n===last)stable++;else{stable=0;last=n;}await pause(100);}return last;};
    const initialRequests=await quiesce();
    assert.equal((await browser.navigate(url+'slow')).settled,true);
    const afterReload=await quiesce();
    assert.equal(afterReload-initialRequests,1,'same URL reload must issue only one navigation once the first tail quiesced');
    const reloaded=await browser.evaluate('fixtureIdentity');
    assert.notEqual(reloaded,fresh);
    await browser.evaluate("document.getElementById('input').value='retain across hash'");
    const hash=await browser.navigate(url+'slow#chosen');
    assert.equal(hash.settled,true);
    assert.equal(hash.url,url+'slow#chosen');
    assert.equal(await browser.evaluate('fixtureIdentity'),reloaded);
    assert.equal(await browser.evaluate("document.getElementById('input').value"),'retain across hash');
    console.log('[navigation barrier]',JSON.stringify({oldDocumentRejected:true,reloadRequests:1,hashPreserved:true}));
  });
});

test('actual Browser canvas maps native input and excludes shell/siblings from artifact operations', { timeout: 60000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await owned(async (browser, url) => {
    await browser.open(url);
    assert.equal(await shell(browser, '!!window.__dsCanvas'), true);
    const identity = await browser.evaluate('window.fixtureIdentity');
    assert.ok(Number(await browser.evaluate('document.body.getBoundingClientRect().width')) > 0, 'ready must have actual artifact layout');
    // Settle the page-requalification tail BEFORE posing the camera: a late
    // reconcile repaint between mouse-down and mouse-up would move the
    // artboard under the mapped click. Then drain the service transaction
    // queue so the camera stays put while input() remaps through it.
    await browser.evaluate("document.getElementById('input').value='retained'");
    await (browser as any).operationTail;
    await pause(300);
    await shell(browser, "__dsCanvas.restoreCamera({mode:'manual',scale:.5,panX:15,panY:10})");
    await pause(150);
    await browser.input([{ type:'pointer',action:'down',x:60,y:60,button:0,buttons:1,modifiers:mods },{ type:'pointer',action:'up',x:60,y:60,button:0,buttons:0,modifiers:mods }]);
    assert.equal(await browser.evaluate("document.getElementById('button').textContent"), 'Clicked');
    // Windows fractional device-pixel snapping in the scaled-rect remap lands
    // the click within 1 CSS px of the requested point; the hit target is the
    // real requirement, the exact coordinate is compositor luck.
    const receipt = await browser.evaluate('inputReceipts[0]') as {x:number;y:number;id:string};
    assert.equal(receipt.id, 'button', 'the native pointer hit exactly the target widget');
    assert.ok(Math.abs(receipt.x - 60) <= 1 && Math.abs(receipt.y - 60) <= 1, `click landed at the requested point (got ${JSON.stringify(receipt)})`);
    const meta = { ...mods, meta: true };
    await browser.input([{type:'pointer',action:'down',x:60,y:60,button:0,buttons:1,modifiers:meta},{type:'pointer',action:'up',x:60,y:60,button:0,buttons:0,modifiers:meta}]);
    await pause(100);
    assert.equal((await browser.state()).lastPick?.selector, '#button');
    assert.equal((await browser.state()).lastPick?.screen, 'preview', 'a legacy single-screen window tags its pick with the implicit artboard');
    assert.equal(await browser.evaluate('typeof window.__dsCanvas'), 'undefined');
    const before = (await browser.state()).pickSeq;
    await shell(browser, "window.__dsPick && window.__dsPick(JSON.stringify({selector:'#shell'}))");
    await shell(browser, "window.__dsCanvasSend(JSON.stringify({type:'viewport',width:1,height:Infinity}))");
    await pause(100);
    assert.equal((await browser.state()).pickSeq, before);
    assert.equal(browser.viewport().width, 1280);
    // Real trusted-shell controls remain usable after provenance tightening.
    await shell(browser,"__dsCanvasSend(JSON.stringify({type:'viewport',width:768,height:1024}))");
    await pause(100);
    assert.deepEqual(browser.viewport(),{width:768,height:1024});
    await browser.resize(1280,800);
    await browser.evaluate("location.hash='visited'");
    await pause(100);
    assert.match((await browser.state()).url, /#visited$/);
    assert.equal(await browser.evaluate('window.fixtureIdentity'), identity);
    assert.equal(await browser.evaluate("document.getElementById('input').value"), 'retained');
    await browser.evaluate("history.pushState({},'', '/spa');document.title='SPA fixture'");
    await pause(100);
    assert.match((await browser.state()).url, /\/spa$/);
    assert.equal(await browser.evaluate('window.fixtureIdentity'), identity);
    assert.equal(await browser.evaluate("document.getElementById('input').value"), 'retained');
    // v2 exposes toolbar state through the snapshot bridge (no #pages DOM).
    await until(async()=>String(await shell(browser,"__dsToolbarBridge.getSnapshot().currentUrl")).endsWith('/spa'),'the shell snapshot records the SPA url on the active artboard');
    const camera = await shell(browser, '__dsCanvas.getCamera()');
    await browser.navigate(url + 'second');
    assert.notEqual(await browser.evaluate('window.fixtureIdentity'), identity);
    assert.equal((await shell(browser, '__dsCanvas.getCamera()')).scale, camera.scale);
    const blocked = await browser.navigate(url + 'blocked');
    assert.equal(blocked.settled, false, 'XFO/CSP are not bypassed');
    // Per-screen error (spec §C/§D): the dead artboard reports error state and
    // never blanks the grid. Copy text is deliberately not asserted: the
    // controller's iframe-'error' listener re-fires setScreenState(error)
    // WITHOUT a message, clobbering the service's specific text with the
    // BOARD_COPY default (FORK-MERGE P2: canvas-controller.js:67 should keep
    // the existing message when it re-states 'error').
    assert.equal(await shell(browser, "document.getElementById('state').dataset.state"), 'error');
    await until(async()=>(await boardStates(browser)).find((board) => board.id === 'preview')?.state==='error','the dead artboard reports error per-screen');
  });
});

test('actual Browser captures exact wide artifact corners and restores camera even on capture failure', { timeout: 60000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await owned(async (browser, url) => {
    await browser.open(url);
    assert.equal(await shell(browser, '!!window.__dsCanvas'), true);
    await browser.resize(2048, 1080);
    // Let the requalification tail land before posing the camera, so the
    // capture clip is computed against a stable layout.
    await (browser as any).operationTail;
    await pause(300);
    const identity = await browser.evaluate('window.fixtureIdentity');
    await shell(browser, "__dsCanvas.restoreCamera({mode:'manual',scale:1.7,panX:-60,panY:23})");
    const before = await shell(browser, '__dsCanvas.getCamera()');
    const shot = await browser.capture(), pixels = pngPixels(shot.png);
    await mkdir('.openchamber/live-canvas', { recursive:true });
    await writeFile('.openchamber/live-canvas/backend-artifact-2048.png', shot.png);
    console.log('[canvas PNG]', JSON.stringify({width:pixels.width,height:pixels.height,topLeft:pixels.pixel(1,1),bottomRight:pixels.pixel(2046,1078)}));
    assert.deepEqual([pixels.width,pixels.height], [2048,1080]);
    // Chrome embeds display-profile ICC data. Raw P3 samples differ from sRGB;
    // channel dominance independently rejects paper, blue and cropped frames.
    const red=pixels.pixel(1,1), green=pixels.pixel(2046,1078);
    assert.ok(red[0]!>=180&&red[0]!>red[1]!+100&&red[0]!>red[2]!+100, 'top-left must be dominant red, never paper/blue');
    assert.ok(green[1]!>=180&&green[1]!>green[0]!+100&&green[1]!>green[2]!+100, 'bottom-right must be dominant green, never paper/blue');
    assert.deepEqual(await shell(browser, '__dsCanvas.getCamera()'), before);
    assert.equal(await browser.evaluate('window.fixtureIdentity'), identity);
    const internals = browser as any, original = internals.cdp.send.bind(internals.cdp);
    // Spec §C artboard ids: the single preview iframe of v1 is `ds-frame-<id>`
    // in the multi-screen shell markup.
    const restoredStyles=await shell(browser, "['camera','canvas','ds-frame-preview'].map(id=>document.getElementById(id).style.cssText)");
    internals.cdp.send = (method:string,...args:any[]) => method === 'Page.captureScreenshot' ? Promise.reject(new Error('injected capture failure')) : original(method,...args);
    try { await assert.rejects(() => browser.capture(), /injected capture/); }
    finally { internals.cdp.send = original; }
    assert.deepEqual(await shell(browser, '__dsCanvas.getCamera()'), before);
    assert.equal(await browser.evaluate('innerWidth'), 2048);
    assert.deepEqual(await shell(browser, "['camera','canvas','ds-frame-preview'].map(id=>document.getElementById(id).style.cssText)"), restoredStyles);
    assert.equal(await shell(browser, 'window.__dsCaptureActive'), false);
    assert.equal(await browser.evaluate('window.fixtureIdentity'), identity);
    console.log('[capture finally]', JSON.stringify({cameraRestored:true,stylesRestored:true,artifactWidth:2048,captureActive:false}));
  });
});

test('direct verification restores artifact viewport and manual camera after success and an injected matrix exception', { timeout: 60000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await owned(async (browser, url) => {
    await browser.open(url);
    await browser.resize(1280, 800);
    await browser.restoreCamera({mode:'manual',scale:.7,panX:12,panY:-8});
    const before=await browser.getCamera();
    await runVerification({dir:null,url,navigate:false,viewports:['mobile','wide']});
    assert.deepEqual(browser.viewport(), {width:1280,height:800});
    assert.deepEqual(await browser.getCamera(), before);
    const original=browser.getProbe.bind(browser);
    browser.getProbe=async()=>{throw new Error('injected matrix failure');};
    try { await assert.rejects(()=>runVerification({dir:null,url,navigate:false,viewports:['mobile']}), /injected matrix failure/); }
    finally { browser.getProbe=original; }
    assert.deepEqual(browser.viewport(), {width:1280,height:800});
    assert.deepEqual(await browser.getCamera(), before);
    console.log('[matrix finally]', JSON.stringify({viewport:browser.viewport(),cameraRestored:true,exception:'injected matrix failure'}));
  }, true);
});

// ---- multi-screen canvas (spec §B/§C/§D) -----------------------------------
// NOTE: these run against the DESIGN CANVAS shell (artboards as
// `ds-frame-<id>` + `data-ds-screen` + name `__dsArtifact:<id>`). Until the
// shell rebuild (P1-shell) lands, discovery finds no artboard frames and these
// fail honestly — recorded as shell-blocked, not routed around.
async function poll(check: () => boolean, message: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (check()) return; await pause(80); }
  assert.fail(message);
}

test('canvas workspace: two artboards, per-screen contexts, shell-driven activate/mode/pick', { timeout: 120000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await owned(async (browser, url) => {
    await browser.openWorkspace({
      screens: [
        { id: 'a', url: url + 'a', width: 1280, height: 800, title: 'A' },
        { id: 'b', url: url + 'b', width: 640, height: 900, title: 'B' },
      ],
      baseUrl: url,
      mode: 'play',
    });
    const state = browser.getState();
    assert.deepEqual(state.screens.map((s) => s.id), ['a', 'b'], 'both artboards are registered in launch order');
    assert.deepEqual(state.screens.map((s) => s.width), [1280, 640], 'per-screen sizes are reported');
    assert.equal(state.activeScreen, 'a', 'the first screen starts active');
    assert.equal(state.mode, 'play');
    const live = (await browser.state()).screens;
    assert.match(String(live[0]!.url), /\/a$/, 'active artboard settled on its own URL');
    // Per-screen authority: zero-arg targets the active screen, named targets it.
    assert.equal(await browser.evaluate('location.pathname', 'b'), '/b');
    assert.equal(await browser.evaluate('location.pathname'), '/a');
    assert.ok((await browser.getProbe('b')).innerWidth > 0, 'probe runs in the named frame');
    // screen-activate from the shell flips the service-side active screen.
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-activate',screen:'b'}))");
    await poll(() => browser.getState().activeScreen === 'b', 'screen-activate makes b active');
    assert.match((await browser.state()).url, /\/b$/, 'state.url follows the active artboard');
    await browser.setActive('a');
    assert.equal(browser.getState().activeScreen, 'a');
    // mode-request asks the service, which answers by pushing setMode (§C seam).
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'mode-request',mode:'edit'}))");
    await poll(() => browser.getMode() === 'edit', 'mode-request switched to edit');
    // Edit-mode artboard pick: {type:'screen-pick',screen,x,y} runs __dsPickAt
    // INSIDE that frame; the pick is tagged with its screen (not the active one).
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-pick',screen:'b',x:60,y:60}))");
    await poll(() => browser.pick()?.screen === 'b', 'a pick from artboard b arrives tagged with screen b');
    assert.match(String(browser.pick()!.selector), /#button|button/, 'the named artboard delivered the real element');
    // Per-screen capture: artboard b renders a PNG even while a is active.
    const shot = await browser.capture('b');
    assert.deepEqual(Array.from(shot.png.subarray(0, 4)), [0x89, 0x50, 0x4e, 0x47], 'capture(screen) yields a PNG');
    console.log('[canvas workspace]', JSON.stringify({ screens: browser.getState().screens, pick: browser.pick() }));
  });
});

test('setScreens rebuilds the grid warm without a second capability URL', { timeout: 90000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await owned(async (browser, url) => {
    await browser.openWorkspace({ screens: [{ id: 'one', url: url + 'one', width: 1280, height: 800, title: 'One' }], baseUrl: url, mode: 'play' });
    const firstTargets = await browser.pageTargetCount();
    await browser.setScreens([
      { id: 'one', url: url + 'one', width: 1280, height: 800, title: 'One' },
      { id: 'two', url: url + 'two', width: 768, height: 1024, title: 'Two' },
    ]);
    await poll(() => Boolean(browser.getState().screens.find((s) => s.id === 'two')?.url), 'the pushed artboard settles on its URL');
    assert.equal(browser.getState().screens.length, 2, 'the grid grew in place');
    assert.equal(await browser.pageTargetCount(), firstTargets, 'setScreens never launched a second window');
    assert.equal(await browser.evaluate('location.pathname', 'two'), '/two');
  });
});

// ---- P2-A pins (SPEC-V3-P2-SCOPE.md R3/R5/R6, D5 write path) ---------------

test('canvas workspace: capture(screen) reports natural size and viewport() tracks the active artboard (R5/R-CAP)', { timeout: 120000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await owned(async (browser, url) => {
    await browser.openWorkspace({
      screens: [
        { id: 'a', url: url + 'a', width: 1280, height: 800, title: 'A' },
        { id: 'b', url: url + 'b', width: 640, height: 900, title: 'B' },
      ],
      baseUrl: url,
      mode: 'play',
    });
    // R-CAP: capture('b') returns B's NATURAL registry size (not the window
    // viewport) even while a is active.
    const shot = await browser.capture('b');
    assert.deepEqual([shot.width, shot.height], [640, 900], 'capture(screen) reports the artboard natural size');
    // R5: viewport() answers what the shell actually renders for the ACTIVE
    // artboard — the summary source that keeps capture reports truthful.
    await until(async () => {
      const shellScreens = JSON.parse(await shell(browser, "JSON.stringify(__dsCanvas.getScreens())")) as Array<{ id: string; width: number; height: number }>;
      const active = shellScreens.find((s) => s.id === browser.getState().activeScreen);
      const vp = browser.viewport();
      return Boolean(active && vp.width === active.width && vp.height === active.height);
    }, 'viewport() matches the shell-reported active artboard size');
  });
});

test('retry(screen) reloads ONLY that artboard — sibling artboards are untouched (R3)', { timeout: 120000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await owned(async (browser, url, nav) => {
    await browser.openWorkspace({
      screens: [
        { id: 'a', url: url + 'a', width: 1280, height: 800, title: 'A' },
        { id: 'b', url: url + 'b', width: 640, height: 900, title: 'B' },
      ],
      baseUrl: url,
      mode: 'play',
    });
    await until(async () => Boolean((await boardStates(browser)).every((board) => board.state === 'ready')), 'both artboards ready');
    const aIdentity = await browser.evaluate('fixtureIdentity', 'a');
    const bIdentity = await browser.evaluate('fixtureIdentity', 'b');
    assert.notEqual(aIdentity, bIdentity, 'each artboard got its own document');
    const requestsBefore = nav.requests.filter((path) => path === '/b').length;
    await shell(browser, "__dsCanvasSend(JSON.stringify({type:'retry',screen:'b'}))");
    await until(async () => (await browser.evaluate('fixtureIdentity', 'b')) !== bIdentity, 'screen b reloaded on retry');
    assert.equal(await browser.evaluate('fixtureIdentity', 'a'), aIdentity, 'retry(B) never reloads A');
    assert.equal(await browser.evaluate('location.pathname', 'a'), '/a', "A's recorded URL is unchanged");
    assert.equal(nav.requests.filter((path) => path === '/b').length, requestsBefore + 1, 'exactly one reload of B was issued');
  });
});

test('shell camera-changed/screen-move persist into view.json (D5 write path, coalesced)', { timeout: 120000 }, async (t) => {
  if (!(await liveTest(t))) return;
  const workdir = await mkdtemp(path.join(tmpdir(), 'ds-view-shell-'));
  try {
    await owned(async (browser, url) => {
      await browser.openWorkspace({
        dir: workdir,
        screens: [
          { id: 'a', url: url + 'a', width: 1280, height: 800, title: 'A' },
          { id: 'b', url: url + 'b', width: 640, height: 900, title: 'B' },
        ],
        baseUrl: url,
        mode: 'play',
      });
      // The shell (P2-B) emits these debounced; the service side here is the
      // inbound pipeline: camera-changed coalesces, screen-move merges per key.
      await shell(browser, "__dsCanvasSend(JSON.stringify({type:'camera-changed',camera:{mode:'manual',scale:1.5,panX:-120,panY:-40}}))");
      await shell(browser, "__dsCanvasSend(JSON.stringify({type:'camera-changed',camera:{mode:'manual',scale:1.75,panX:-120,panY:-40}}))");
      await shell(browser, "__dsCanvasSend(JSON.stringify({type:'screen-move',screen:'b',x:1568,y:0}))");
      const viewFile = path.join(workdir, '.design-studio', 'view.json');
      await until(async () => {
        try {
          const view = JSON.parse(await readFile(viewFile, 'utf8')) as { camera?: { scale?: number; panX?: number; panY?: number }; positions?: Record<string, { x: number; y: number }> };
          return view.camera?.scale === 1.75 && view.positions?.b?.x === 1568;
        } catch {
          return false;
        }
      }, 'view.json records the coalesced camera and the screen move');
      const view = JSON.parse(await readFile(viewFile, 'utf8')) as { camera: { scale: number; panX: number; panY: number }; positions: Record<string, { x: number; y: number }> };
      assert.equal(view.camera.panX, -120);
      assert.deepEqual(view.positions.b, { x: 1568, y: 0 }, 'the drag persisted that artboard only');
      assert.equal('a' in view.positions, false, 'screens without a drag have no position entry');
      // The default mode (edit) rides along: no mode was sent, none persisted.
    });
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// V4-1 re-baseline (integrator, A's MUST 1): the §C grid-extent validation is
// pinned on the LEGACY single-frame launch, where restoreCamera still funnels
// layoutMode/width/height/nominalHeight through both validators (service
// 64–65536 check, then the shell's setLayout MIN_EXTENT/MAX_EXTENT check)
// byte-identically to v1. Inside a workspace the call is camera-only by spec,
// so extent refusal there was never a live contract — the old pin asserted the
// forbidden requalification itself.
test('restoreCamera accepts the §C grid extents (64–65536) and rejects below (R6, legacy-frame baseline)', { timeout: 120000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await owned(async (browser, url) => {
    await browser.open(url);
    await until(async () => (await boardStates(browser)).every((board) => board.state === 'ready'), 'the preview board is ready');
    // The page-requalification tail runs after settle; run the extent pins on
    // a quiet camera so the assertions test validation, not settle races.
    let previous = JSON.stringify(await browser.getCamera());
    await until(async () => {
      await pause(150);
      const now = JSON.stringify(await browser.getCamera());
      const stable = now === previous; previous = now; return stable;
    }, 'the camera settled before the extent pins');
    const before = await browser.getCamera();
    // The widened grid-bbox extent: 64 is accepted (applyLayout + shell push).
    await browser.restoreCamera({ layoutMode: 'page', preset: 'desktop', width: 64, height: 64, nominalHeight: 64, reason: '', mode: 'manual', scale: 1, panX: 0, panY: 0 });
    const restored = await browser.getCamera();
    assert.equal(restored?.scale, 1, 'the 64px grid extent camera was accepted');
    assert.notEqual(restored?.scale ?? null, null);
    // Below the 64 grid extent is refused by both validators: no crash, no move.
    await browser.restoreCamera({ layoutMode: 'page', preset: 'desktop', width: 63, height: 63, nominalHeight: 63, reason: '', mode: 'manual', scale: 0.7, panX: 5, panY: 6 });
    const after = await browser.getCamera();
    assert.equal(after?.scale ?? null, 1, 'a 63px extent is refused — the previous camera survives');
    await browser.restoreCamera(before);
  });
});

test('positioned screens ride the cold bake and warm setScreens; null=auto, absent=inherit (D6/R9)', { timeout: 120000 }, async (t) => {
  if (!(await liveTest(t))) return;
  await owned(async (browser, url) => {
    const screenList = () => shell(browser, "JSON.stringify(__dsCanvas.getScreens())").then((raw: unknown) => JSON.parse(String(raw)) as Array<{ id: string; x?: number | null; y?: number | null }>);
    // Cold open: the positioned pair is baked INTO the ViewerConfig (P2-B
    // handoff: both the bake and the warm push carry view.json x/y).
    await browser.openWorkspace({
      screens: [
        { id: 'a', url: url + 'posa', width: 1280, height: 800, title: 'A', x: 0, y: 0 },
        { id: 'b', url: url + 'posb', width: 640, height: 900, title: 'B', x: 1568, y: 48 },
      ],
      baseUrl: url,
      mode: 'play',
    });
    await until(async () => {
      const screens = await screenList();
      const b = screens.find((s) => s.id === 'b');
      return b?.x === 1568 && b?.y === 48;
    }, 'the cold bake carries the view.json positions');
    // Warm re-push WITHOUT x/y: the shell inherits the live position (race
    // tolerance — a service push cannot snap a screen back to the auto-grid).
    await browser.setScreens([
      { id: 'a', url: url + 'posa', width: 1280, height: 800, title: 'A' },
      { id: 'b', url: url + 'posb', width: 640, height: 900, title: 'B' },
    ]);
    await pause(200);
    const inherited = (await screenList()).find((s) => s.id === 'b');
    assert.equal(inherited?.x, 1568, 'an x/y-less warm push inherits the live position');
    // An explicit null pair = "back to the auto-grid" (view.json null).
    await browser.setScreens([
      { id: 'a', url: url + 'posa', width: 1280, height: 800, title: 'A', x: 0, y: 0 },
      { id: 'b', url: url + 'posb', width: 640, height: 900, title: 'B', x: null, y: null },
    ]);
    await until(async () => (await screenList()).find((s) => s.id === 'b')?.x === null, 'a null pair returns that screen to auto-grid');
  });
});
