import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactContexts } from '../service/artifact-context.ts';

function fixture() {
  const handlers=new Map<string,Array<(params:Record<string,unknown>,session?:string)=>void>>();
  const trusted='http://127.0.0.1:32123/canvas/private-capability';
  let url=trusted;
  const cdp={on:(method:string,handler:(params:Record<string,unknown>,session?:string)=>void)=>{
    const list=handlers.get(method)??[];list.push(handler);handlers.set(method,list);return ()=>undefined;
  },send:async(method:string):Promise<Record<string,unknown>>=>method==='Page.getFrameTree'?{frameTree:{frame:{id:'root',url}}}:{} };
  const contexts=new ArtifactContexts(cdp,'main','true',()=>undefined,trusted);
  const emit=(method:string,params:Record<string,unknown>)=>{for(const fn of handlers.get(method)??[])fn(params,'main');};
  const create=(unique:string,origin=new URL(trusted).origin)=>emit('Runtime.executionContextCreated',{context:{id:1,uniqueId:unique,origin,auxData:{isDefault:true,frameId:'root'}}});
  return {contexts,emit,create,setUrl:(next:string)=>{url=next;},trusted};
}

/**
 * Multi-artboard fixture (spec §D): the frame tree carries two child iframes
 * whose owner elements carry `data-ds-screen`; a third sibling iframe has no
 * attribute and must never be trusted, whatever its id/name/url.
 */
function canvasFixture() {
  const handlers=new Map<string,Array<(params:Record<string,unknown>,session?:string)=>void>>();
  const trusted='http://127.0.0.1:32123/canvas/private-capability';
  const frames=new Map<string,string[]>([
    ['f-home',['id','ds-frame-home','name','__dsArtifact:home','data-ds-screen','home']],
    ['f-checkout',['id','ds-frame-checkout','name','__dsArtifact:checkout','data-ds-screen','checkout']],
    ['f-noise',['id','noise','src','http://evil.invalid/']],
  ]);
  const cdp={
    on:(method:string,handler:(params:Record<string,unknown>,session?:string)=>void)=>{
      const list=handlers.get(method)??[];list.push(handler);handlers.set(method,list);return ()=>undefined;
    },
    send:async(method:string,params:Record<string,unknown>={}):Promise<Record<string,unknown>>=>{
      if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'root',url:trusted},childFrames:[{frame:{id:'f-home'}},{frame:{id:'f-checkout'}},{frame:{id:'f-noise'}}]}};
      if(method==='DOM.getFrameOwner')return {backendNodeId:`owner:${String(params.frameId)}`};
      if(method==='DOM.describeNode'){
        const frame=String(params.backendNodeId).replace('owner:','');
        const attributes=frames.get(frame);
        return attributes?{node:{nodeName:'IFRAME',attributes}}:{node:{nodeName:'DIV',attributes:[]}};
      }
      return {};
    },
  };
  const contexts=new ArtifactContexts(cdp,'main','true',()=>undefined,trusted);
  let nextId=10;
  const create=(frame:string)=>{const id=nextId++;(contexts as any).contexts.set('main:'+id,{session:'main',frame,id,unique:'world-'+frame,origin:new URL(trusted).origin});return id;};
  return {contexts,create,frames,trusted};
}

test('discover maps EVERY data-ds-screen frame and ignores unattributed siblings',async()=>{
  const f=canvasFixture();
  const homeId=f.create('f-home');
  f.create('root');
  await f.contexts.discover();
  f.create('f-checkout');f.create('f-noise');
  await f.contexts.discover();
  const screens=[...f.contexts.artifacts().keys()];
  assert.deepEqual(screens.sort(),['checkout','home'],'both artboards are authority-bearing');
  assert.equal(f.contexts.artifacts().has('f-noise'),false,'a frame without data-ds-screen is never an artifact');
  const home=f.contexts.artifact('home');assert.ok(home);assert.equal(home.frame,'f-home');
  const checkout=f.contexts.artifact('checkout');assert.ok(checkout);assert.equal(checkout.frame,'f-checkout');
  // named-or-active: nothing active yet -> null; setting the active screen
  // resolves artifact() with no argument.
  assert.equal(f.contexts.artifact(),null,'artifact() needs an active screen when none is set');
  f.contexts.activeScreenId='home';
  assert.equal(f.contexts.artifact()?.frame,'f-home','artifact() defaults to the active screen');
  // executionContextId -> screenId map (bindingCalled authority).
  assert.equal(f.contexts.screenForContext('main',homeId),'home');
  assert.equal(f.contexts.screenForContext('main',999),null,'unknown contexts resolve to no screen');
  assert.equal(f.contexts.screenForContext(undefined,homeId),null);
});

test('screenFrames drops detached artboards but keep the rest of the grid',async()=>{
  const f=canvasFixture();
  f.create('root');f.create('f-home');f.create('f-checkout');f.create('f-noise');
  await f.contexts.discover();
  f.contexts.activeScreenId='checkout';
  assert.equal(f.contexts.artifact()?.frame,'f-checkout');
  // Simulate the detach branch of the event handler via the public surface:
  // a re-discover after the DOM lost the artboard rebuilds the map.
  f.frames.delete('f-checkout');
  await f.contexts.discover();
  assert.equal(f.contexts.artifact('checkout'),null,'detached artboards leave authority on the next pass');
  assert.equal(f.contexts.artifact('home')?.frame,'f-home','sibling artboards keep their context');
});

test('shell leases reject pending discovery, wrong capability and same-ID replacement', async()=>{
  const f=fixture();f.create('original');await f.contexts.discover();
  const current=f.contexts.shell();assert.ok(current);
  const lease=f.contexts.captureShellAuthority('main',1);assert.ok(lease);
  assert.equal(f.contexts.shellAuthorityCurrent(lease),true);
  f.create('replacement');
  assert.equal(f.contexts.shell(),null,'authorization fails closed during asynchronous discovery');
  assert.equal(f.contexts.matches(current,'main',1),false,'map-key reuse cannot preserve an old context record');
  await f.contexts.discover();
  assert.equal(f.contexts.shellAuthorityCurrent(lease),false,'queued old-context side effects are revoked');
  f.setUrl(f.trusted+'-wrong');
  f.emit('Page.frameNavigated',{frame:{id:'root',url:f.trusted+'-wrong'}});
  assert.equal(f.contexts.captureShellAuthority('main',1),null,'navigation revokes synchronously');
  await f.contexts.discover();
  assert.equal(f.contexts.shell(),null,'same origin with wrong capability has no authority');
});

test('shell leases reject an attacker origin, destruction and close',async()=>{
  const f=fixture();f.create('attacker','http://attacker.invalid');await f.contexts.discover();
  assert.equal(f.contexts.shell(),null);
  f.create('legitimate');await f.contexts.discover();
  const lease=f.contexts.captureShellAuthority('main',1);assert.ok(lease);
  f.emit('Runtime.executionContextDestroyed',{executionContextId:1});
  assert.equal(f.contexts.shellAuthorityCurrent(lease),false);
  f.create('new-legitimate');await f.contexts.discover();
  const fresh=f.contexts.captureShellAuthority('main',1);assert.ok(fresh);
  f.contexts.close();assert.equal(f.contexts.shellAuthorityCurrent(fresh),false);
});

// ---- FIX-3 (F5): in-frame binding verify + re-arm (the dead-session root fix) ----

test('a missing in-frame __dsPick binding is verified after arming and re-armed on its OWN session (flush path)',async()=>{
  const calls:Array<{method:string;params:Record<string,unknown>;session?:string}>=[];
  let bound=false;
  const trusted='http://127.0.0.1:32123/canvas/private-capability';
  const frames=new Map<string,string[]>([['f-home',['id','ds-frame-home','data-ds-screen','home']]]);
  const cdp={
    on:(_method:string,_handler:(params:Record<string,unknown>,session?:string)=>void)=>()=>undefined,
    send:async(method:string,params:Record<string,unknown>={},session?:string):Promise<Record<string,unknown>>=>{
      calls.push({method,params,session});
      if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'root',url:trusted},childFrames:[{frame:{id:'f-home'}}]}};
      if(method==='DOM.getFrameOwner')return {backendNodeId:`owner:${String(params.frameId)}`};
      if(method==='DOM.describeNode'){
        const frame=String(params.backendNodeId).replace('owner:','');
        const attributes=frames.get(frame);
        return attributes?{node:{nodeName:'IFRAME',attributes}}:{node:{nodeName:'DIV',attributes:[]}};
      }
      if(method==='Runtime.addBinding'){bound=true;return {};}
      if(method==='Runtime.evaluate'){
        const expression=String(params.expression??'');
        if(expression==='typeof window.__dsPick')return {result:{value:bound?'function':'undefined'}};
        return {result:{value:true}};
      }
      return {};
    },
  };
  const contexts=new ArtifactContexts(cdp,'main','PAYLOAD_SCRIPTS',()=>undefined,trusted);
  (contexts as unknown as { contexts: Map<string, unknown> }).contexts.set('main:10',{session:'main',frame:'f-home',id:10,unique:'world-home',origin:new URL(trusted).origin});
  await contexts.discover();
  await contexts.initializeArtifact();
  // The arming evaluate ran, verification saw 'undefined' (the Windows
  // addBinding-propagation race), re-issued BOTH artifact bindings on the
  // frame's own session, and re-ran the payload scripts — the re-run is the
  // in-frame flushPending() recovery for buffered clicks.
  const arms=calls.filter((c)=>c.method==='Runtime.evaluate'&&String(c.params.expression).includes('PAYLOAD_SCRIPTS'));
  assert.equal(arms.length,2,'the payload ran once to arm and once to re-arm (flush)');
  const adds=calls.filter((c)=>c.method==='Runtime.addBinding');
  assert.deepEqual(adds.map((a)=>String(a.params.name)).sort(),['__dsArtifactEvent','__dsPick'],'both artifact bindings re-issued');
  assert.ok(adds.every((a)=>a.session==='main'),'re-issued on the frame context\'s own session');
  // A later sweep pass over the now-bound context is a cheap silent no-op.
  calls.length=0;
  await contexts.verifyArtifactBindings();
  assert.equal(calls.filter((c)=>c.method==='Runtime.addBinding').length,0,'a landed binding is never re-issued');
  assert.equal(calls.filter((c)=>c.method==='Runtime.evaluate').length,1,'the sweep costs one typeof check per artifact');
  // A dead world mid-check is swallowed (a later event/sweep re-arms).
  bound=false;
  (contexts as unknown as { contexts: Map<string, unknown> }).contexts.set('main:10',{session:'main',frame:'f-home',id:10,unique:'world-home',origin:new URL(trusted).origin});
  assert.equal(await contexts.verifyArtifactBinding('home',{session:'main',frame:'gone',id:99} as never),false,'a revoked context verifies to false, never a throw');
});
