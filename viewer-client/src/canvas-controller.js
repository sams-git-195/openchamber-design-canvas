/** Self-contained: serialized once by the HTML renderer before the React entry. */
export function initCanvas(initialConfig) {
  if (window.__dsToolbarBridge) return window.__dsCanvas;
  const $ = id => document.getElementById(id);
  const canvas = $('canvas'), camera = $('camera');
  const presets = {desktop:{width:1280,height:800},large:{width:1920,height:1080},tablet:{width:768,height:1024},mobile:{width:390,height:844}};
  const GRID_GAP=48, MIN_EXTENT=64, MAX_EXTENT=65536, MAX_SCREENS=12;
  const SCREEN_ID=/^[a-z0-9][a-z0-9-]{0,30}$/;
  const BOARD_COPY={loading:'Loading this screen.',ready:'',error:'This screen could not be displayed. Check that the dev server is running and the page allows embedding.'};
  const bootConfig=initialConfig||{};
  let pages = [], currentUrl = '', currentTitle = 'Preview';
  let screens = [], active = '', shellMode = 'edit', cellCenters = new Map();
  const boards = new Map();
  const view = {width:0,height:0,nominalHeight:Number.isInteger(bootConfig.viewport&&bootConfig.viewport.height)?bootConfig.viewport.height:800,layoutMode:'viewport',reason:'',preset:'desktop',mode:'fit',scale:1,panX:0,panY:0,pan:false,space:false,ready:false};
  let openMenu = null, drag = null, slowTimer = null, statusState = 'loading', message = '';
  let captureState = null, captureSequence = 0, repaintPending = false, lastTap = null;
  // Geometry constants from the original camera, not toolbar/theme tokens.
  const numToken = name => name === '--s7' ? 48 : name === '--pan-step' ? 32 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const listeners = new Set();
  let snapshot = null, publicationDepth = 0;
  function publish(){
    if(publicationDepth)return;
    const oldPages=snapshot?.pages;
    const samePages=oldPages&&oldPages.length===pages.length&&pages.every((p,i)=>p.id===oldPages[i].id&&p.label===oldPages[i].label&&p.url===oldPages[i].url);
    const oldScreens=snapshot?.screens;
    const sameScreens=!!oldScreens&&oldScreens.length===screens.length&&screens.every((s,i)=>oldScreens[i].id===s.id&&oldScreens[i].url===s.url&&oldScreens[i].title===s.title&&oldScreens[i].width===s.width&&oldScreens[i].height===s.height&&oldScreens[i].state===s.state);
    const activeScreen=screens.find(s=>s.id===active);
    const next={ready:view.ready,statusState,message,pages:samePages?oldPages:Object.freeze(pages.map(p=>Object.freeze({...p}))),currentUrl,currentTitle,screens:sameScreens?oldScreens:Object.freeze(screens.map(s=>Object.freeze({id:s.id,url:s.url,width:s.width,height:s.height,title:s.title,state:s.state}))),active,mode:shellMode,preset:view.preset,width:activeScreen?activeScreen.width:view.width,height:activeScreen?activeScreen.height:view.height,layoutMode:view.layoutMode,reason:view.reason,zoomMode:view.mode,scale:view.scale,pan:view.pan,capturing:!!captureState,openMenu};
    if(snapshot&&Object.keys(next).every(key=>next[key]===snapshot[key]))return;
    snapshot=Object.freeze(next);for(const listener of [...listeners])listener();
  }
  function transaction(fn){publicationDepth++;try{return fn();}finally{publicationDepth--;publish();}}
  function announce(text){$('announcement').textContent=text;}
  function validUrl(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
  function clampExtent(value){return value===0?0:Math.max(MIN_EXTENT,Math.min(MAX_EXTENT,value));}
  function validScreen(item){
    if(!item||typeof item!=='object'||typeof item.id!=='string'||!SCREEN_ID.test(item.id))return null;
    const url=validUrl(item.url);if(!url)return null;
    if(!Number.isInteger(item.width)||item.width<200||item.width>8192||!Number.isInteger(item.height)||item.height<200||item.height>8192)return null;
    const title=typeof item.title==='string'&&item.title.trim()?item.title.trim().slice(0,120):item.id;
    return {id:item.id,url,width:item.width,height:item.height,title};
  }
  // Grid model: artboards live at NATURAL px inside camera space; camera scale is
  // a transform only and never multiplies into these layout numbers.
  function gridBounds(list){
    const n=list.length;
    if(!n)return {width:0,height:0,cells:[],centers:new Map()};
    const cols=Math.max(1,Math.ceil(Math.sqrt(n))),rows=Math.ceil(n/cols);
    const colW=new Array(cols).fill(0),rowH=new Array(rows).fill(0);
    for(let i=0;i<n;i++){const c=i%cols,r=Math.floor(i/cols);if(list[i].width>colW[c])colW[c]=list[i].width;if(list[i].height>rowH[r])rowH[r]=list[i].height;}
    const colX=[],rowY=[];let x=0;for(let c=0;c<cols;c++){colX.push(x);x+=colW[c]+GRID_GAP;}
    let y=0;for(let r=0;r<rows;r++){rowY.push(y);y+=rowH[r]+GRID_GAP;}
    const cells=[],centers=new Map();
    for(let i=0;i<n;i++){const c=i%cols,r=Math.floor(i/cols);cells.push({x:colX[c],y:rowY[r]});centers.set(list[i].id,{x:colX[c]+list[i].width/2,y:rowY[r]+list[i].height/2});}
    return {width:x-GRID_GAP,height:y-GRID_GAP,cells,centers};
  }
  function renderBoardState(b,s){
    b.overlay.hidden=s.state==='ready';b.overlay.dataset.state=s.state;
    b.copy.textContent=s.state==='ready'?'':(s.message||BOARD_COPY[s.state]||'');
    b.action.hidden=s.state!=='error';
  }
  function wireBoard(id,b){
    b.title.onclick=()=>transaction(()=>applyActive(id,true));
    b.action.onclick=()=>transaction(()=>retryScreen(id));
    b.section.ondblclick=e=>{if(e&&typeof e.preventDefault==='function')e.preventDefault();transaction(()=>{if(applyActive(id,true))focusScreen(id);});};
    b.frame.addEventListener('error',()=>transaction(()=>{const s=screens.find(s=>s.id===id);if(s&&s.state==='ready')setScreenStateCore(id,{state:'error'});}));
  }
  // The renderer bakes the initial artboards into CANVAS_MARKUP; adopt them so a
  // first setScreens never duplicates a board or reloads a src that already matches.
  function adoptBoard(id){
    let section=null;
    for(const el of camera.children||[]){if(el&&el.dataset&&el.dataset.screen===id){section=el;break;}}
    if(!section)return null;
    const title=section.querySelector('.ds-ab-title'),size=section.querySelector('.ds-ab-size');
    const frame=section.querySelector('iframe'),overlay=section.querySelector('.ds-ab-state');
    if(!title||!size||!frame||!overlay)return null;
    const copy=overlay.querySelector('.ds-ab-card-copy'),action=overlay.querySelector('.ds-ab-retry');
    if(!copy||!action)return null;
    const board={section,title,size,frame,overlay,copy,action};
    wireBoard(id,board);return board;
  }
  function createBoard(id){
    const section=document.createElement('section');
    section.className='ds-artboard';section.dataset.screen=id;section.dataset.active='false';
    const title=document.createElement('button');title.type='button';title.className='ds-ab-title';
    const size=document.createElement('span');size.className='ds-ab-size';
    const frame=document.createElement('iframe');
    frame.id='ds-frame-'+id;frame.dataset.dsScreen=id;
    frame.setAttribute('name','__dsArtifact:'+id);
    frame.setAttribute('referrerpolicy','no-referrer');
    frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock');
    const overlay=document.createElement('div');overlay.className='ds-ab-state';overlay.dataset.state='loading';
    const copy=document.createElement('p');copy.className='ds-ab-card-copy';copy.setAttribute('role','status');
    const action=document.createElement('button');action.type='button';action.className='ds-ab-retry';action.textContent='Retry';
    overlay.appendChild(copy);overlay.appendChild(action);
    section.appendChild(title);section.appendChild(size);section.appendChild(frame);section.appendChild(overlay);
    const board={section,title,size,frame,overlay,copy,action};
    wireBoard(id,board);
    return board;
  }
  function relayout(){
    const layout=gridBounds(screens);
    view.width=clampExtent(layout.width);view.height=clampExtent(layout.height);
    cellCenters=layout.centers;
    const live=new Set(screens.map(s=>s.id));
    for(const [id,b] of [...boards]){if(!live.has(id)){b.section.remove();boards.delete(id);}}
    // Stray baked artboards (ids the service removed before this controller ever
    // adopted them) must leave the camera too, or the grid keeps a dead frame.
    for(const el of [...(camera.children||[])]){
      if(el&&el.dataset&&String(el.className||'').split(/\s+/).includes('ds-artboard')&&!live.has(el.dataset.screen))el.remove();
    }
    screens.forEach((s,i)=>{
      const cell=layout.cells[i];
      let b=boards.get(s.id);
      if(!b){
        b=adoptBoard(s.id);
        if(!b){b=createBoard(s.id);camera.appendChild(b.section);}
        else{const baked=b.frame.getAttribute?b.frame.getAttribute('src')||'':'';if(baked===s.url)s.src=s.url;}
        boards.set(s.id,b);
      }
      b.section.dataset.screen=s.id;
      b.section.style.left=cell.x+'px';b.section.style.top=cell.y+'px';
      b.section.style.width=s.width+'px';b.section.style.height=s.height+'px';
      b.section.dataset.active=s.id===active?'true':'false';
      b.title.textContent=s.title;b.size.textContent=s.width+' × '+s.height;
      if(s.url&&s.src!==s.url){b.frame.src=s.url;s.src=s.url;}
      renderBoardState(b,s);
    });
    view.ready=screens.length>0;
  }
  function paint(){
    if(captureState){repaintPending=true;return;}
    const box=canvas.getBoundingClientRect();
    canvas.dataset.layout=view.layoutMode;canvas.dataset.mode=shellMode;
    if(view.mode==='fit'&&view.width>0){view.scale=Math.max(.05,Math.min(1,(box.width-numToken('--s7'))/view.width));view.panX=0;view.panY=0;}
    else if(view.mode==='fit-all'&&view.width>0&&view.height>0){const gap=numToken('--s7');view.scale=Math.min(3,Math.max(.1,Math.min((box.width-gap)/view.width,(box.height-gap)/view.height)));view.panX=0;view.panY=0;}
    camera.hidden=screens.length===0;
    camera.style.width=view.width+'px';camera.style.height=view.height+'px';
    const x=(box.width-view.width*view.scale)/2+view.panX,y=view.mode==='fit-all'?(box.height-view.height*view.scale)/2+view.panY:numToken('--s7')+view.panY;
    camera.style.transform='translate('+x+'px,'+y+'px) scale('+view.scale+')';
    $('layout-reason').hidden=!(view.layoutMode==='viewport'&&view.reason);$('layout-reason').textContent=view.reason?'Viewport fallback: '+view.reason:'';
    $('pan-layer').hidden=!(view.ready&&(view.pan||view.space));
    publish();
  }
  function setScreensCore(list){
    if(captureState||!Array.isArray(list)||list.length>MAX_SCREENS)return false;
    const previous=new Map(screens.map(s=>[s.id,s]));
    const next=[],seen=new Set();
    for(const item of list){
      const s=validScreen(item);
      if(!s||seen.has(s.id))return false;seen.add(s.id);
      const old=previous.get(s.id);
      next.push({id:s.id,url:s.url,width:s.width,height:s.height,title:s.title,state:old?old.state:'loading',message:old?old.message:'',src:old?old.src:''});
    }
    screens=next;
    if(!screens.some(s=>s.id===active))active=screens.length?screens[0].id:'';
    const activeScreen=screens.find(s=>s.id===active);
    if(activeScreen){currentUrl=activeScreen.url;currentTitle=activeScreen.title;}
    relayout();
    if(screens.length)paint();else setStatus({state:'empty'});
    return true;
  }
  function setViewport(width,height){
    if(captureState)return false;
    if(![width,height].every(n=>Number.isInteger(n)&&n>=100&&n<=8192))return false;
    const s=screens.find(s=>s.id===active);if(!s)return false;
    s.width=width;s.height=height;view.nominalHeight=height;view.layoutMode='viewport';view.reason='';view.preset=Object.keys(presets).find(id=>presets[id].width===width&&presets[id].height===height)||'custom';relayout();paint();return true;
  }
  function getFitBounds(){
    return {width:Math.max(1,Math.min(8192,Math.floor(canvas.clientWidth))),height:Math.max(1,Math.min(8192,Math.floor(canvas.clientHeight)))};
  }
  function setLayout(info){
    if(captureState||!info||!['fit','page','viewport'].includes(info.mode)||!['fit','desktop','large','tablet','mobile','custom'].includes(info.preset))return false;
    if(![info.width,info.height,info.nominalHeight].every(n=>Number.isInteger(n)&&n>=MIN_EXTENT&&n<=MAX_EXTENT)||((info.mode==='fit')!==(info.preset==='fit')))return false;
    if(info.reason!==undefined&&(typeof info.reason!=='string'||info.reason.length>600))return false;
    const changed=view.layoutMode!==info.mode||view.preset!==info.preset;
    view.layoutMode=info.mode;view.preset=info.preset;view.nominalHeight=info.nominalHeight;view.reason=info.mode==='viewport'?(info.reason||''):'';
    // "fit" describes the active page's native-scroll layout, so its width/height
    // are viewport bounds; only page/viewport confirmations restyle the artboard.
    const s=screens.find(s=>s.id===active);
    if(s&&info.mode!=='fit'){s.width=info.width;s.height=info.height;}
    if(changed){view.mode='fit';view.panX=0;view.panY=0;view.pan=false;view.space=false;}relayout();paint();return true;
  }
  function closeMenu(refocus=true){if(!openMenu||captureState)return false;const id=openMenu;openMenu=null;publish();if(refocus)$(id==='page'?'pages':'zoom')?.focus();return true;}
  function setStatus(info){
    if(!info||!['loading','ready','empty','error'].includes(info.state))return false;
    if(captureState){captureState.pendingStatus=info;return true;}
    clearTimeout(slowTimer);statusState=info.state;view.ready=screens.length>0;
    if(!view.ready){closeMenu();view.space=false;if(info.state!=='loading')view.pan=false;}
    const global=screens.length===0;
    $('state').hidden=!global||info.state==='ready';
    $('spinner').hidden=!global||info.state!=='loading';$('state-action').hidden=info.state==='loading'||info.state==='ready';
    $('state').dataset.state=info.state;$('state-title').hidden=info.state==='loading';$('state-copy').hidden=info.state==='loading';
    const defaults={loading:['Opening the canvas','Waiting for the first screen.'],empty:['No screens on this canvas','Ask the agent to design a screen, or retry after adding an entry to screens.json.'],error:['Canvas could not be displayed','Check that the dev server is running and the page allows embedding, then retry.']};
    if(!view.ready&&global){$('state-title').textContent=defaults[info.state][0];$('state-copy').textContent=typeof info.message==='string'&&info.message?info.message:defaults[info.state][1];}
    message=typeof info.message==='string'&&info.message?info.message:view.ready?'Ready':info.state==='loading'?'Loading…':info.state==='empty'?'No screens':'Load failed';
    if(info.state==='loading')slowTimer=setTimeout(()=>{if(statusState!=='loading')return;$('state-copy').textContent='Still opening the canvas. Add a screen and retry if none appears.';$('state-copy').hidden=false;$('state-action').hidden=false;announce($('state-copy').textContent);},15000);
    paint();announce(message);return true;
  }
  function send(command){
    if(command.type==='ready'&&typeof window.__dsCanvasSend!=='function')return false;
    try{if(typeof window.__dsCanvasSend!=='function')throw new Error('Preview controls are not connected. Reopen the preview window.');window.__dsCanvasSend(JSON.stringify(command));return true;}
    catch(error){setStatus({state:'error',message:error instanceof Error?error.message:'Could not contact the preview service. Retry.'});return false;}
  }
  function renderPages(){if(openMenu==='page')closeMenu();publish();}
  function setPage(info){
    if(!info||typeof info.url!=='string')return false;
    const url=info.url?validUrl(info.url):'';if(url===null){setStatus({state:'error',message:'The preview page URL must use http or https.'});return false;}
    if(Array.isArray(info.pages)){
      const ids=new Set();const next=[];
      for(const p of info.pages){if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.label!=='string')return false;const u=validUrl(p.url);if(!u)return false;ids.add(p.id);next.push({id:p.id,label:p.label||'Untitled page',url:u});}pages=next;
    }
    currentTitle=typeof info.title==='string'&&info.title?info.title:'Preview';
    const s=screens.find(s=>s.id===active),b=s&&boards.get(s.id);
    currentUrl=url;
    if(s){
      if(url)s.url=url;
      if(url&&info.navigate!==false&&b&&s.src!==url){b.frame.src=url;s.src=url;s.state='loading';s.message='';renderBoardState(b,s);}
      else if(!url&&info.navigate!==false){s.state='loading';if(b)renderBoardState(b,s);}
    }
    document.title=currentTitle+' · Design Canvas';renderPages();return true;
  }
  function applyActive(id,notify){
    if(captureState||!id)return false;
    const s=screens.find(s=>s.id===id);if(!s)return false;
    if(id!==active){
      active=id;
      for(const [boardId,b] of boards)b.section.dataset.active=boardId===id?'true':'false';
      statusState=s.state;message=s.message||BOARD_COPY[s.state]||'Ready';
      currentUrl=s.url;currentTitle=s.title;
    }
    if(notify)send({type:'screen-activate',screen:id});
    publish();return true;
  }
  function setModeCore(mode){
    if(!['edit','play'].includes(mode))return false;
    shellMode=mode;canvas.dataset.mode=mode;paint();
    announce(mode==='edit'?'Edit mode: clicking a screen picks that element for the chat.':'Play mode: screens accept real interaction.');
    return true;
  }
  function setScreenStateCore(id,info){
    if(captureState||!info||!['loading','ready','error'].includes(info.state))return false;
    const s=screens.find(s=>s.id===id);if(!s)return false;
    s.state=info.state;
    s.message=typeof info.message==='string'?info.message.slice(0,600):'';
    renderBoardState(boards.get(id),s);
    if(id===active){statusState=s.state;message=s.message||BOARD_COPY[s.state]||'Ready';}
    if(info.state==='error')announce('Screen '+s.title+' failed to load.');
    publish();return true;
  }
  function zoomTo(value,point){
    if(!view.ready||captureState||view.layoutMode==='fit')return;if(value==='fit'){view.mode='fit';paint();announce('Fit page width, up to 100 percent');return;}
    const next=Number(value);if(!finite(next))return;const old=view.scale,scale=Math.min(3,Math.max(.1,next)),box=canvas.getBoundingClientRect(),px=point?point.x-box.width/2:0,py=point?point.y-box.height/2:0;
    view.panX=px-(px-view.panX)*scale/old;view.panY=py-(py-view.panY)*scale/old;view.scale=scale;view.mode='manual';paint();announce('Zoom '+Math.round(scale*100)+' percent');
  }
  function zoomCamera(info){
    if(!info||!['in','out','reset','wheel'].includes(info.action)||!view.ready||captureState||view.layoutMode==='fit')return false;
    if(info.action==='in')zoomTo(view.scale*1.25);
    else if(info.action==='out')zoomTo(view.scale/1.25);
    else if(info.action==='reset')zoomTo(1);
    else{if(![info.deltaY,info.x,info.y].every(finite)||Math.abs(info.deltaY)>8192)return false;zoomTo(view.scale*Math.exp(-info.deltaY*.005),{x:Math.max(0,Math.min(canvas.clientWidth,info.x)),y:Math.max(0,Math.min(canvas.clientHeight,info.y))});}
    return true;
  }
  function cameraShortcut(event){
    if(event.defaultPrevented||!(event.ctrlKey||event.metaKey))return false;
    const action=event.key==='+'||event.key==='='?'in':event.key==='-'?'out':event.key==='0'?'reset':null;
    if(!action)return false;event.preventDefault();event.stopImmediatePropagation();zoomCamera({action});return true;
  }
  function fitAll(){
    if(captureState||!screens.length)return false;
    view.mode='fit-all';view.panX=0;view.panY=0;paint();announce('Fit all screens');return true;
  }
  function focusScreen(id){
    if(captureState||!screens.length)return false;
    const center=cellCenters.get(id);if(!center)return false;
    const box=canvas.getBoundingClientRect();
    view.mode='manual';view.scale=Math.min(3,Math.max(.1,1));
    view.panX=box.width/2-center.x*view.scale-(box.width-view.width*view.scale)/2;
    view.panY=box.height/2-center.y*view.scale-numToken('--s7');
    paint();announce('Focused screen '+(screens.find(s=>s.id===id)?.title||id));return true;
  }
  function setPan(next){if(!view.ready||captureState||view.layoutMode==='fit')return;view.pan=next;view.space=false;paint();if(next)canvas.focus();announce(next?'Pan canvas enabled. Escape returns to page interaction.':'Page interaction enabled.');}
  function beginCapture(screenId){
    if(captureState)throw new Error('Canvas capture is already active.');
    const target=typeof screenId==='string'&&screenId?screenId:active;
    const screen=screens.find(s=>s.id===target);
    if(!screen)throw new Error('Canvas capture needs a screen with a preview URL.');
    captureState={token:++captureSequence,id:target,view:{...view},body:document.body.style.cssText,styles:[[camera,camera.style.cssText],[canvas,canvas.style.cssText]]};
    window.__dsCaptureActive=true;document.body.style.pointerEvents='none';publish();return captureState.token;
  }
  async function normalizeCapture(token){
    if(!captureState||captureState.token!==token)throw new Error('Invalid canvas capture transaction.');
    const screen=screens.find(s=>s.id===captureState.id),board=boards.get(captureState.id);
    if(!screen||!board)throw new Error('Invalid canvas capture transaction.');
    document.body.style.overflow='visible';canvas.style.flex='none';canvas.style.height=screen.height+'px';canvas.style.overflow='visible';
    camera.style.transform='none';camera.style.left='0';camera.style.top='0';camera.style.width=screen.width+'px';camera.style.height=screen.height+'px';
    for(const [id,b] of boards){
      captureState.styles.push([b.section,b.section.style.cssText]);
      if(id!==captureState.id){b.section.style.display='none';continue;}
      b.section.style.left='0';b.section.style.top='0';b.section.style.width=screen.width+'px';b.section.style.height=screen.height+'px';
      b.frame.style.width=screen.width+'px';b.frame.style.height=screen.height+'px';
    }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const r=board.frame.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
  }
  function endCapture(token){
    if(!captureState||captureState.token!==token)return false;
    const saved=captureState;document.body.style.cssText=saved.body;for(const [el,style] of saved.styles)el.style.cssText=style;Object.assign(view,saved.view);
    captureState=null;window.__dsCaptureActive=false;
    const pending=saved.pendingStatus;repaintPending=false;if(pending)setStatus(pending);else paint();return true;
  }
  for(const type of ['pointerdown','pointermove','pointerup','click','wheel','keydown','keyup'])document.addEventListener(type,e=>{if(captureState){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,passive:false});
  document.addEventListener('keydown',e=>{
    if(e.defaultPrevented||cameraShortcut(e))return;
    // Stock DropdownMenu owns all menu keyboard/focus and dismissal handling.
    if(openMenu)return;
    if(e.key==='Escape'&&(view.pan||view.space)){e.preventDefault();setPan(false);$('pan')?.focus();return;}
    if(document.activeElement!==canvas||!view.ready||view.layoutMode==='fit')return;
    if(e.key===' '){e.preventDefault();view.space=true;paint();}else if(e.key.toLowerCase()==='h'){e.preventDefault();setPan(!view.pan);}else if(e.key==='+'||e.key==='='){e.preventDefault();zoomTo(view.scale*1.25);}else if(e.key==='-'){e.preventDefault();zoomTo(view.scale/1.25);}else if(e.shiftKey&&(e.code==='Digit1'||e.key==='!')){e.preventDefault();zoomTo('fit');}else if(e.shiftKey&&(e.code==='Digit0'||e.key===')')){e.preventDefault();zoomTo(1);}else if(e.key.startsWith('Arrow')){e.preventDefault();moveCamera(e.key.slice(5).toLowerCase(),e.shiftKey?3:1);}
  });
  function moveCamera(direction,multiplier=1){if(!view.ready||captureState||view.layoutMode==='fit')return;view.mode='manual';const step=numToken('--pan-step')*multiplier;if(direction==='left')view.panX-=step;if(direction==='right')view.panX+=step;if(direction==='up')view.panY-=step;if(direction==='down')view.panY+=step;paint();}
  document.addEventListener('keyup',e=>{if(e.key===' '){view.space=false;paint();}});window.addEventListener('blur',()=>{view.space=false;drag=null;lastTap=null;canvas.classList.remove('dragging');paint();});
  function choosePreset(id){if(!view.ready||captureState||!active||!(id==='fit'||Object.hasOwn(presets,id)))return;if(id==='fit'){setLayout({mode:'fit',preset:'fit',...getFitBounds(),nominalHeight:view.nominalHeight});send({type: 'layout',mode:'fit',preset:'fit',screen:active});}else{const p=presets[id];setLayout({mode:'viewport',preset:id,width:p.width,height:p.height,nominalHeight:p.height});send({type: 'layout',mode:'page',preset:id,screen:active});}announce((id==='large'?'Desktop Large':id)+' layout');}
  canvas.addEventListener('pointerdown',e=>{if(!view.ready||view.layoutMode==='fit'||e.button!==0||e.target.closest('.state')||e.target.closest('.ds-ab-title')||e.target.closest('.ds-ab-state'))return;canvas.focus();view.mode='manual';drag={x:e.clientX,y:e.clientY,panX:view.panX,panY:view.panY,moved:false,section:e.target.closest('.ds-artboard')};canvas.setPointerCapture(e.pointerId);canvas.classList.add('dragging');e.preventDefault();});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if((Math.abs(dx)>4||Math.abs(dy)>4)&&!drag.moved){drag.moved=true;lastTap=null;}view.panX=drag.panX+dx;view.panY=drag.panY+dy;paint();});
  function endDrag(e){
    if(!drag)return;
    const moved=drag.moved,section=drag.section;drag=null;lastTap=moved?null:lastTap;
    canvas.classList.remove('dragging');
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(moved||shellMode!=='edit'||!section)return;
    const id=section.dataset.screen;
    if(!screens.some(s=>s.id===id))return;
    if(lastTap&&lastTap.id===id&&Date.now()-lastTap.at<350){lastTap=null;transaction(()=>{if(applyActive(id,true))focusScreen(id);});return;}
    lastTap={id,at:Date.now()};
    transaction(()=>{applyActive(id,false);pickAt(section,e);});
  }canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
  function pickAt(section,e){
    const s=screens.find(s=>s.id===section.dataset.screen);if(!s)return;
    const r=section.getBoundingClientRect();
    if(!r||!finite(r.left)||!finite(r.top)||!view.scale)return;
    const x=(e.clientX-r.left)/view.scale,y=(e.clientY-r.top)/view.scale;
    if(!finite(x)||!finite(y)||x<0||y<0||x>=s.width||y>=s.height)return;
    send({type:'screen-pick',screen:s.id,x:Math.round(x),y:Math.round(y)});
  }
  function wheelInput(deltaX,deltaY,x,y,zoom){if(!view.ready||captureState||view.layoutMode==='fit'||![deltaX,deltaY,x,y].every(finite))return false;if(zoom)zoomTo(view.scale*Math.exp(-deltaY*.005),{x,y});else{view.mode='manual';view.panX-=deltaX;view.panY-=deltaY;paint();}return true;}
  canvas.addEventListener('wheel',e=>{if(e.defaultPrevented)return;const b=canvas.getBoundingClientRect();if(e.ctrlKey||e.metaKey){e.preventDefault();e.stopPropagation();zoomCamera({action:'wheel',deltaY:e.deltaY,x:e.clientX-b.left,y:e.clientY-b.top});return;}if(!view.ready||view.layoutMode==='fit'||e.target.closest('.state'))return;e.preventDefault();wheelInput(e.deltaX,e.deltaY,e.clientX-b.left,e.clientY-b.top,false);},{passive:false});
  document.addEventListener('wheel',e=>{if(e.defaultPrevented||!(e.ctrlKey||e.metaKey))return;e.preventDefault();e.stopPropagation();const b=canvas.getBoundingClientRect();zoomCamera({action:'wheel',deltaY:e.deltaY,x:e.clientX-b.left,y:e.clientY-b.top});},{passive:false});
  let fitSizeQueued=false;
  new ResizeObserver(()=>{paint();if(view.layoutMode==='fit'&&!captureState&&!fitSizeQueued){fitSizeQueued=true;requestAnimationFrame(()=>{fitSizeQueued=false;if(view.layoutMode==='fit'&&!captureState)send({type: 'fit-size',screen:active});});}}).observe(canvas);
  function retry(){if(captureState)return;setStatus({state:'loading'});const command={type:'retry'};if(active)command.screen=active;send(command);}
  function retryScreen(id){if(captureState||!boards.get(id))return;setScreenStateCore(id,{state:'loading'});send({type:'retry',screen:id});}
  $('state-action').onclick=()=>transaction(retry);
  window.__dsCanvas = {
    setViewport:(...args)=>transaction(()=>setViewport(...args)),setScreens:list=>transaction(()=>setScreensCore(list)),setMode:mode=>transaction(()=>setModeCore(mode)),setActive:id=>transaction(()=>applyActive(id,false)),getActive:()=>active,getMode:()=>shellMode,
    setScreenState:(id,info)=>transaction(()=>setScreenStateCore(id,info)),fitAll:()=>transaction(()=>fitAll()),focusScreen:id=>transaction(()=>focusScreen(id)),zoomToScreen:id=>transaction(()=>focusScreen(id)),getScreens:()=>screens.map(s=>({id:s.id,url:s.url,width:s.width,height:s.height,title:s.title,state:s.state,message:s.message,src:s.src})),
    setLayout:info=>transaction(()=>setLayout(info)),getFitBounds,setStatus:info=>transaction(()=>setStatus(info)),setPage:info=>transaction(()=>setPage(info)),beginCapture,normalizeCapture,endCapture:token=>transaction(()=>endCapture(token)),zoomCamera:info=>transaction(()=>zoomCamera(info)),
    getCamera:()=>({mode:view.mode,scale:view.scale,panX:view.panX,panY:view.panY,width:screens.find(s=>s.id===active)?.width??view.width,height:screens.find(s=>s.id===active)?.height??view.height,preset:view.preset,layoutMode:view.layoutMode,nominalHeight:view.nominalHeight,reason:view.reason,gridWidth:view.width,gridHeight:view.height}),
    // width/height round-trip the ACTIVE screen size (like the old single frame);
    // the grid extent is derived from the screens list and never restored.
    restoreCamera:state=>transaction(()=>{if(captureState||!state||!['fit','manual','fit-all'].includes(state.mode)||![state.scale,state.panX,state.panY].every(finite)||state.scale<=0)return false;if(state.layoutMode!==undefined&&!setLayout({mode:state.layoutMode,preset:state.preset,width:state.width,height:state.height,nominalHeight:state.nominalHeight,reason:state.reason||''}))return false;view.mode=state.mode;view.scale=Math.min(3,Math.max(.05,state.scale));view.panX=state.panX;view.panY=state.panY;paint();return true;}),
    dismissMenu:()=>closeMenu(),
    handleCanvasInput:event=>{if(!event||view.layoutMode==='fit'||(!view.pan&&view.layoutMode!=='page')||event.type!=='wheel')return false;return wheelInput(event.deltaX,event.deltaY,event.x,event.y,Boolean(event.zoom));}
  };
  window.__dsToolbarBridge = {
    getSnapshot:()=>snapshot,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    selectPreset:id=>transaction(()=>choosePreset(id)),
    selectPage:id=>transaction(()=>{if(!view.ready||captureState||!pages.some(p=>p.id===id))return;closeMenu();send({type: 'page',id,screen:active});}),
    zoomTo:value=>transaction(()=>{if(!view.ready||captureState||view.layoutMode==='fit')return;zoomTo(value);closeMenu();}),
    zoomCamera:info=>transaction(()=>zoomCamera(info)),togglePan:()=>transaction(()=>setPan(!view.pan)),
    panBy:direction=>transaction(()=>{if(!view.ready||captureState||view.layoutMode==='fit'||!['left','right','up','down'].includes(direction))return;moveCamera(direction);announce('Canvas moved '+direction+'.');closeMenu();}),
    retry:()=>transaction(retry),setMenu:id=>{if(captureState||!(id===null||id==='page'||id==='zoom')||(id!==null&&!view.ready))return;if(openMenu===id)return;openMenu=id;publish();},
    setMode:id=>transaction(()=>{if(captureState||!['edit','play'].includes(id)||id===shellMode)return;send({type:'mode-request',mode:id});}),
    activateScreen:id=>transaction(()=>applyActive(id,true)),
    fitAll:()=>transaction(()=>{fitAll();}),
    focusScreen:id=>transaction(()=>focusScreen(id))
  };
  // Main's layout effect calls this only after stock semantic hooks are mounted.
  let readySent=false;
  window.__dsToolbarMounted=()=>{if(readySent)return true;readySent=send({type: 'ready'});return readySent;};
  transaction(()=>{
    setScreensCore(Array.isArray(bootConfig.screens)?bootConfig.screens:[]);
    setModeCore(bootConfig.mode==='play'?'play':'edit');
    setStatus({state:screens.length?'loading':'empty'});
  });
  return window.__dsCanvas;
}
