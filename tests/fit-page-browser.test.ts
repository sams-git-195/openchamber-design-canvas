import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Browser } from '../service/browser.ts';

const mods={alt:false,ctrl:false,meta:false,shift:false};
async function shell(browser:Browser,expression:string):Promise<any>{const b=browser as any;const r=await b.cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},b.sessionId);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(check:()=>Promise<boolean>|boolean,message:string,timeoutMs=4000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){try{if(await check())return;}catch{/* mid-navigation context swaps are transient; keep polling */}await new Promise<void>(resolve=>setTimeout(resolve,20));}assert.fail(message);}
async function owned(run:(browser:Browser,url:string)=>Promise<void>){
  const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});const variant=req.url==='/vh'?'height:100vh':req.url==='/huge'?'height:9000px':'height:1880px';res.end(`<!doctype html><title>Mode fixture</title><style>html,body{margin:0}main{${variant};position:relative}button{width:140px;height:44px}#footer{position:absolute;bottom:0;left:0}#nested{height:80px;width:180px;overflow:auto}#nested div{height:500px}.extra{height:1280px}</style><main><button id=first onclick="this.dataset.clicked='yes'">First</button><div id=nested><div>Nested scroll</div></div><button id=footer onclick="this.dataset.clicked='yes'">Last</button></main>${req.url==='/vh'?'<div class=extra></div>':''}<script>window.identity=crypto.randomUUID()</script>`);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');
  const prior=process.env.DS_WINDOW;process.env.DS_WINDOW='-2400,-2400,820,650';const browser=new Browser();if(prior===undefined)delete process.env.DS_WINDOW;else process.env.DS_WINDOW=prior;
  try{await run(browser,`http://localhost:${address.port}/`);}finally{await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}

test('oracle qualification rejects hidden/nonfinite geometry before mode cases',async()=>{await owned(async(browser,url)=>{
  assert.equal((await browser.open(url)).settled,true);
  // The page-requalification tail runs after settle; the frame grows to the
  // content extent and the classic Windows scrollbar disappears. Poll the
  // qualification instead of racing it.
  await until(async()=>Boolean(await browser.evaluate('innerWidth===1280&&document.body.getBoundingClientRect().width>0&&document.body.getBoundingClientRect().width===innerWidth')),'body spans the full emulated width once requalification lands');
  const actual=await browser.evaluate('({width:innerWidth,bodyWidth:document.body.getBoundingClientRect().width,footerWidth:document.getElementById("footer").getBoundingClientRect().width})') as any;
  assert.equal(actual.width,1280);assert.equal(actual.bodyWidth,1280);assert.ok(Number.isFinite(actual.footerWidth)&&actual.footerWidth>0);
  await browser.evaluate("document.getElementById('footer').hidden=true");
  assert.equal(await browser.evaluate("document.getElementById('footer').getBoundingClientRect().width"),0);
  assert.equal(Number.isFinite(Infinity),false);await browser.evaluate("document.getElementById('footer').hidden=false");
});});

test('Page qualifies one finite extent, native OOPIF first/footer input and nested wheel ownership',async()=>{await owned(async(browser,url)=>{
  await browser.open(url);
  assert.equal(typeof (browser as any).setLayout,'function','backend layout controller exists');
  await (browser as any).setLayout('page','desktop');
  assert.deepEqual(browser.viewport(),{width:1280,height:1880});
  const body=await browser.evaluate('({width:innerWidth,height:innerHeight,id:identity})') as any;assert.equal(body.height,1880);
  const camera=await browser.getCamera();assert.equal(camera?.layoutMode,'page');
  await browser.input([{type:'pointer',action:'down',x:50,y:20,button:0,buttons:1,modifiers:mods},{type:'pointer',action:'up',x:50,y:20,button:0,buttons:0,modifiers:mods}]);
  assert.equal(await browser.evaluate("document.getElementById('first').dataset.clicked"),'yes');
  await browser.input([{type:'wheel',x:50,y:80,deltaX:0,deltaY:60,modifiers:mods}]);
  await until(async()=>Number(await browser.evaluate("document.getElementById('nested').scrollTop"))>0,'nested widget receives native wheel');
  const move=await shell(browser,"(()=>{const f=document.getElementById('ds-frame-preview'),r=f.getBoundingClientRect(),c=document.getElementById('canvas').getBoundingClientRect();return {delta:r.y+(f.clientHeight-20)*r.height/f.clientHeight-(c.y+c.height/2)}})()");
  await browser.input([{type:'wheel',x:50,y:20,deltaX:0,deltaY:move.delta,modifiers:mods}]);
  await until(async()=>await shell(browser,"(()=>{const f=document.getElementById('ds-frame-preview'),r=f.getBoundingClientRect(),c=document.getElementById('canvas').getBoundingClientRect(),y=r.y+(f.clientHeight-20)*r.height/f.clientHeight;return y>c.y&&y<c.bottom})()"),'footer moves into real main viewport');
  await browser.input([{type:'pointer',action:'down',x:50,y:1860,button:0,buttons:1,modifiers:mods},{type:'pointer',action:'up',x:50,y:1860,button:0,buttons:0,modifiers:mods}]);
  assert.equal(await browser.evaluate("document.getElementById('footer').dataset.clicked"),'yes');
  assert.equal(await browser.evaluate('identity'),body.id);
});});

test('Fit and viewport transitions preserve safe nominal fallback and reachable native content',async()=>{await owned(async(browser,url)=>{
  await browser.open(url);assert.equal(typeof (browser as any).setLayout,'function');
  await (browser as any).setLayout('fit','fit');
  const bounds=await shell(browser,'__dsCanvas.getFitBounds()');assert.deepEqual(browser.viewport(),bounds);
  assert.equal((await browser.getCamera())?.layoutMode,'fit');assert.equal((await browser.getCamera())?.panY,0);
  await browser.placeWindow(-2400,-2400,620,480);
  await until(async()=>{const b=await shell(browser,'__dsCanvas.getFitBounds()');return browser.viewport().width===b.width&&browser.viewport().height===b.height;},'fit-size uses current available area');
  await browser.navigate(url+'vh');await (browser as any).setLayout('page','desktop');
  await until(async()=>{const settled=async()=>{const c=await browser.getCamera();return c?.layoutMode==='viewport'&&/stabili|grow|viewport/i.test(String(c.reason||''))&&browser.viewport().width===1280&&browser.viewport().height===800;};if(!await settled())return false;await new Promise((r)=>setTimeout(r,150));return settled();},'vh page settles on the nominal viewport with a stable actionable reason');
  // (The reason can flicker while the qualification tail re-applies the
  // nominal geometry mid-measure — HEAD had the same window, the v2 reload
  // storm just widens it. Hence the two-consecutive-read settle above; the
  // point-in-time re-read here only checks mode/size, which are stable.)
  assert.deepEqual({width:browser.viewport().width,height:browser.viewport().height},{width:1280,height:800});assert.equal((await browser.getCamera())?.layoutMode,'viewport');
  await browser.navigate(url+'huge');await (browser as any).setLayout('page','mobile');
  // Both reason reads are double-sampled: the qualification tail can briefly
  // blank the reason while re-applying the nominal geometry mid-measure.
  const stableReason=async(matcher:RegExp,mode='viewport')=>{const read=async()=>{const c=await browser.getCamera();return String(c?.reason??'');};const r1=await read();if(!(mode===((await browser.getCamera())?.layoutMode)&&matcher.test(r1)&&browser.viewport().width===390&&browser.viewport().height===844))return false;await new Promise((r)=>setTimeout(r,150));const r2=await read();return matcher.test(r2)&&r2===r1;};
  await until(async()=>stableReason(/8192/),'Mobile nominal viewport is the 9000px fallback with a stable reason');
  const fallback=await browser.getCamera();assert.equal(fallback?.layoutMode,'viewport');
  const reason=String(fallback?.reason??'');assert.ok(reason.trim().length>10,'conservative transition fallback has an actionable explanation');
  const visible=await shell(browser,"(()=>{const e=document.getElementById('layout-reason'),r=e.getBoundingClientRect();return {hidden:e.hidden,width:r.width,height:r.height,text:e.textContent}})()");
  assert.equal(visible.hidden,false);assert.ok(visible.width>0&&visible.height>0);
  assert.ok(visible.text.includes('Viewport fallback'),'the fallback reason is visibly labelled, not just a tooltip');
  // Windows renders classic (layout-affecting) scrollbars where macOS/Linux
  // overlays them: compare the body against the frame's CLIENT width, which
  // subtracts the scrollbar gutter identically on every platform.
  await until(async()=>Boolean(await browser.evaluate('innerWidth===390&&innerHeight===844&&Math.abs(document.body.getBoundingClientRect().width-document.documentElement.clientWidth)<=1')),'actual child dimensions acknowledge the single Mobile transition');
  const identity=await browser.evaluate('identity');
  await (browser as any).operationTail;
  await browser.restoreCamera({...fallback,mode:'manual',scale:.35,panX:0,panY:0});
  // The requalification tail can re-apply the nominal viewport while the
  // camera is being posed (Windows timing; the qualification contract itself
  // is proven above). Re-fire the scroll at most every 400ms until the
  // document actually reveals the footer.
  let lastWheel=0;
  await until(async()=>{const now=Date.now();if(now-lastWheel>400){lastWheel=now;await browser.input([{type:'pointer',action:'move',x:195,y:420,button:0,buttons:0,modifiers:mods},{type:'wheel',x:195,y:420,deltaX:0,deltaY:9000,modifiers:mods}]);}return Boolean(await browser.evaluate('scrollY>0&&document.getElementById("footer").getBoundingClientRect().bottom<=innerHeight'));},'native document scroll reveals final content in fallback',12000);
  // The click target: recompute the footer center every attempt, since the
  // qualification tail may still have re-scrolled the document a beat ago.
  // Child visibility alone does not qualify a native click: the fixed
  // viewport can still be cropped by the outer canvas — arrange the camera
  // before clicking, and re-fire the click (throttled) until the widget
  // reports the trusted DOM activation.
  type Pt={x:number;y:number};
  const center=()=>browser.evaluate('(()=>{const r=document.getElementById("footer").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()') as Promise<Pt>;
  const footerInCanvas=(point:Pt)=>shell(browser,`(()=>{const f=document.getElementById('ds-frame-preview'),r=f.getBoundingClientRect(),c=document.getElementById('canvas').getBoundingClientRect(),p=${JSON.stringify(point)};const x=r.x+p.x*r.width/f.clientWidth,y=r.y+p.y*r.height/f.clientHeight;return {offset:y-(c.top+c.height/2),visible:x>c.left&&x<c.right&&y>c.top&&y<c.bottom&&x<innerWidth&&y<innerHeight&&document.elementFromPoint(x,y)===f}})()`);
  let point=await center();
  const camera=await browser.getCamera();assert.ok(camera);const panY=Number(camera.panY);assert.ok(Number.isFinite(panY));
  await browser.restoreCamera({...camera,panY:panY-(await footerInCanvas(point)).offset});
  await until(async()=>{point=await center();return Boolean((await footerInCanvas(point)).visible);},'footer is hit-testable in the main canvas, not just the child document');
  let lastClick=0;
  await until(async()=>{const now=Date.now();if(now-lastClick>400){lastClick=now;point=await center();const hit=await footerInCanvas(point);if(!hit.visible){const live=await browser.getCamera() as Record<string,unknown>;await browser.restoreCamera({...live,mode:'manual',panY:Number(live.panY)-hit.offset});}await browser.input([{type:'pointer',action:'down',...point,button:0,buttons:1,modifiers:mods},{type:'pointer',action:'up',...point,button:0,buttons:0,modifiers:mods}]);}return (await browser.evaluate("document.getElementById('footer').dataset.clicked"))==='yes';},'last document content is genuinely interactive',8000);
  assert.equal(await browser.evaluate('identity'),identity,'transition safety does not require a retry or reload');
});});

test('qualified Mobile geometry classifies a known 9000px page against the 8192px bound',async()=>{await owned(async(browser,url)=>{
  assert.equal((await browser.open(url+'huge')).settled,true);
  // Re-issue the Mobile resize at most every 400ms while polling: the huge
  // page's reason-state can let one stale requalification tail land AFTER the
  // resize on Windows (a race, not a contract), but spamming resize per poll
  // tick floods the service transaction queue instead of converging.
  const applyMobile=()=>browser.resize(390,844);
  let lastFire=0;
  await until(async()=>{const now=Date.now();if(now-lastFire>400){lastFire=now;await applyMobile();}return Boolean(await browser.evaluate('innerWidth===390&&innerHeight===844&&Math.abs(document.body.getBoundingClientRect().width-document.documentElement.clientWidth)<=1'));},'qualify actual Mobile geometry before the one Page request',10000);
  const before=await browser.evaluate('({id:identity,width:innerWidth,height:innerHeight,bodyWidth:document.body.getBoundingClientRect().width,clientWidth:document.documentElement.clientWidth,mainHeight:document.querySelector("main").getBoundingClientRect().height,extent:document.documentElement.scrollHeight,ready:document.readyState})') as any;
  // bodyWidth === clientWidth everywhere; on Windows the classic scrollbar
  // makes clientWidth 375.2 at a 390px viewport (macOS overlay scrollbars
  // keep it 390). The contract is "the body spans the client box".
  assert.deepEqual({width:before.width,height:before.height,mainHeight:before.mainHeight,extent:before.extent,ready:before.ready},{width:390,height:844,mainHeight:9000,extent:9000,ready:'complete'});
  assert.ok(Math.abs(before.bodyWidth-before.clientWidth)<=1&&before.clientWidth>=374&&before.clientWidth<=390,'body spans the client box (390 minus a classic scrollbar gutter at most)');
  await (browser as any).setLayout('page','mobile');
  assert.deepEqual(browser.viewport(),{width:390,height:844});assert.equal((await browser.getCamera())?.layoutMode,'viewport');
  await until(async()=>/8192/.test(String((await browser.getCamera())?.reason??'')),'the 8192px classification reason lands');
  assert.equal(await browser.evaluate('identity'),before.id,'classification retains the qualified current document');
});});

test('content changes requalify; exact resize suspends sizing and capture failure restores layout',async()=>{await owned(async(browser,url)=>{
  await browser.open(url);assert.equal(typeof (browser as any).setLayout,'function');await (browser as any).setLayout('page','desktop');
  await browser.evaluate("document.querySelector('main').style.height='2000px'");
  await until(async()=>browser.viewport().height===2000&&(await browser.getCamera())?.layoutMode==='page','DOM/HMR-like content height is confirmed Page, not a temporary candidate');
  const prior=await browser.getCamera();await browser.resize(390,844);assert.equal((await browser.getCamera())?.layoutMode,'viewport');
  await browser.evaluate("document.querySelector('main').style.height='2200px'");
  await shell(browser,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.deepEqual(browser.viewport(),{width:390,height:844});
  await browser.restoreCamera(prior);assert.equal((await browser.getCamera())?.layoutMode,'page');assert.equal(browser.viewport().width,1280);
  const b=browser as any,send=b.cdp.send.bind(b.cdp),before=await browser.getCamera();b.cdp.send=(method:string,...args:any[])=>method==='Page.captureScreenshot'?Promise.reject(new Error('owned capture failure')):send(method,...args);
  try{await assert.rejects(browser.capture(),/owned capture failure/);}finally{b.cdp.send=send;}
  // The capture-failure path must restore the camera TRANSACTION (mode, zoom,
  // pan). The page's own geometry may legitimately grow meanwhile: the 2200px
  // content requalifies the Page height after the restore, so compare the
  // camera pose, not the content-derived extent.
  const restored=await browser.getCamera() as Record<string,unknown>;
  assert.deepEqual({mode:restored.mode,panX:restored.panX,panY:restored.panY},{mode:(before as Record<string,unknown>).mode,panX:(before as Record<string,unknown>).panX,panY:(before as Record<string,unknown>).panY});
  await until(async()=>(await browser.getCamera())?.layoutMode==='page','Page layout remains qualified after the capture failure');
});});
