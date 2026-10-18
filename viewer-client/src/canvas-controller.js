/** Self-contained: serialized once by the HTML renderer before the React entry. */
export function initCanvas(initialConfig) {
  if (window.__dsToolbarBridge) return window.__dsCanvas;
  const $ = id => document.getElementById(id);
  const canvas = $('canvas'), camera = $('camera');
  // Preset sizes survive ONLY as setViewport bookkeeping identities (service
  // compatibility). V4-1 retired the viewport-preset toolbar machinery: no
  // shell path resizes an artboard, and the shell never emits layout,
  // fit-size, or viewport commands. Artboards are fixed-size by the registry.
  const presets = {desktop:{width:1280,height:800},large:{width:1920,height:1080},tablet:{width:768,height:1024},mobile:{width:390,height:844}};
  const GRID_GAP=48, FLOW_BUDGET=3200, POS_CLAMP=32768, MIN_EXTENT=64, MAX_EXTENT=65536, MAX_SCREENS=12, EMIT_DEBOUNCE_MS=400;
  const NOTICE_MAX=3, NOTICE_TEXT_MAX=300, TOAST_MS=2000, NEW_PULSE_MS=1200, MODE_PENDING_MS=1500, HOVER_MIN_STEP=3, DOT=24, DOT_MIN_SCALE=.3;
  // Design-review (Sonnet) fixes: F3 header compact tier (device px of board
  // width below which the size label yields to the title), F7 error-card
  // compact tier (below this zoom the card shows only the styled Retry
  // button), and the F2 menu viewport margin.
  const HEADER_COMPACT_W=140, ERROR_COMPACT_SCALE=.5, MENU_EDGE=8;
  // B1 watchdog: a board still 'loading' after this long offers its Retry.
  const LOADING_STALL_MS=20000;
  const EDIT_HINT='Edit mode: click an element to select it. Reference in chat sends it to the composer.';
  const SCREEN_ID=/^[a-z0-9][a-z0-9-]{0,30}$/;
  const BOARD_COPY={loading:'Loading this screen.',ready:'',error:'Dev server unreachable — Reload to restart it.'};
  const EMBED_HINT='If it is running, check CSP / X-Frame-Options embedding permissions.';
  // F10: grouped menu — dividers between the groups, subtle CSS icons keyed by
  // data-action (viewer-ui geometry), Rename… alone in the LAST group. The
  // action strings are the frozen §3 screen-menu union, verbatim, plus FIX-3's
  // F17 'stop-server' (the in-canvas escape hatch for the documented
  // dev-servers-outlive-the-window policy), alone in its own group before Rename.
  const SCREEN_MENU=[[['send-to-chat','Send to chat']],[['zoom','Zoom to screen'],['reload','Reload screen']],[['reset-position','Reset position'],['export-png','Export PNG'],['export-pdf','Export PDF'],['copy-path','Copy file path']],[['stop-server','Stop dev server']],[['rename','Rename…']]];
  const bootConfig=initialConfig||{};
  let pages = [], currentUrl = '', currentTitle = 'Preview';
  let screens = [], active = '', shellMode = 'edit', cellCenters = new Map();
  const boards = new Map();
  // Integrator correction (V4-1/V4-9 seam): the fit-all boot default is the
  // WORKSPACE pose. A legacy single-frame launch (baked workspace:false) must
  // boot in 'fit' exactly like v1 — the page-requalification tail changes the
  // frame HEIGHT, and only the height-invariant fit pose keeps the artboard's
  // on-screen rect (and thus native-input landing) stable across it; under
  // fit-all the centered re-pose raced agent clicks (E-rebaseline of the
  // legacy fit-page pins). Absent flag = fit-all, so every pre-flag config
  // (tests, old bakes) keeps the V4 behavior.
  const view = {width:0,height:0,nominalHeight:Number.isInteger(bootConfig.viewport&&bootConfig.viewport.height)?bootConfig.viewport.height:800,layoutMode:'viewport',reason:'',preset:'desktop',mode:bootConfig.workspace===false?'fit':'fit-all',scale:1,panX:0,panY:0,pan:false,space:false,agentInput:false,ready:false};
  let openMenu = null, drag = null, slowTimer = null, statusState = 'loading', message = '', fitSizeQueued = false;
  let captureState = null, captureSequence = 0, repaintPending = false, lastTap = null, boardDrag = null, boardDragSquelch = false;
  let cameraTimer = null, applyingCamera = false, lastCameraSent = null, lastPositions = new Map();
  // V4 shell surface (SPEC-V4 §3): notices, toast, agent status/input, mode
  // pending, the artboard context menu, inline rename, and the hover emitter.
  let notices = Object.freeze([]);
  const noticeMap = new Map();
  let toast = null, toastEl = null, toastTimer = null;
  let agentBusy = false, agentLabel = '', agentReloadSeen = false;
  let modePending = null, modeTimer = null;
  let contextMenu = null, renaming = null;
  const hover = {screen:'',x:NaN,y:NaN,pending:null,raf:0};
  const newPulseTimers = new Map();
  let hadScreens = false;
  // R2 (B4): the selection the service mirrors from the artboards (it pushes
  // setSelection); the shell only renders it and asks for send/clear.
  const NO_SELECTION=Object.freeze({count:0,screens:Object.freeze([]),screen:'',label:''});
  let selection = NO_SELECTION, pillEl = null, pillSend = null;
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
    const next={ready:view.ready,statusState,message,pages:samePages?oldPages:Object.freeze(pages.map(p=>Object.freeze({...p}))),currentUrl,currentTitle,screens:sameScreens?oldScreens:Object.freeze(screens.map(s=>Object.freeze({id:s.id,url:s.url,width:s.width,height:s.height,title:s.title,state:s.state}))),active,mode:shellMode,preset:view.preset,width:activeScreen?activeScreen.width:view.width,height:activeScreen?activeScreen.height:view.height,layoutMode:view.layoutMode,reason:view.reason,zoomMode:view.mode,scale:view.scale,pan:view.pan,capturing:!!captureState,openMenu,notices,toast,agentBusy,agentLabel,modePending,agentInput:view.agentInput,selectionCount:selection.count,selectionScreen:selection.screen,selectionLabel:selection.label};
    if(snapshot&&Object.keys(next).every(key=>next[key]===snapshot[key]))return;
    snapshot=Object.freeze(next);for(const listener of [...listeners])listener();
  }
  function transaction(fn){publicationDepth++;try{return fn();}finally{publicationDepth--;publish();}}
  function announce(text){$('announcement').textContent=text;}
  function validUrl(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
  function clampExtent(value){return value===0?0:Math.max(MIN_EXTENT,Math.min(MAX_EXTENT,value));}
  const clampPos=n=>Math.round(Math.max(-POS_CLAMP,Math.min(POS_CLAMP,n)));
  function validScreen(item){
    if(!item||typeof item!=='object'||typeof item.id!=='string'||!SCREEN_ID.test(item.id))return null;
    const url=validUrl(item.url);if(!url)return null;
    if(!Number.isInteger(item.width)||item.width<200||item.width>8192||!Number.isInteger(item.height)||item.height<200||item.height>8192)return null;
    const title=typeof item.title==='string'&&item.title.trim()?item.title.trim().slice(0,120):item.id;
    // Positions are camera-space natural px: absent = auto-grid, null = back to
    // auto, a numeric pair = placed (finite, clamped to +-POS_CLAMP, rounded).
    // One-sided or junk values refuse the whole list -- setScreens stays honest.
    if(item.x!==undefined||item.y!==undefined){
      const pair=typeof item.x==='number'&&Number.isFinite(item.x)&&typeof item.y==='number'&&Number.isFinite(item.y);
      if(!pair&&!(item.x===null&&item.y===null))return null;
    }
    const x=typeof item.x==='number'?clampPos(item.x):null,y=typeof item.y==='number'?clampPos(item.y):null;
    return {id:item.id,url,width:item.width,height:item.height,title,x,y};
  }
  // Placement model: positioned screens keep their camera-space x/y exactly;
  // unpositioned screens flow in array order (row budget FLOW_BUDGET, gap
  // GRID_GAP). The auto flow is computed as if only unpositioned screens
  // existed, so positioned siblings never consume or disturb auto slots.
  function placeScreens(list){
    const n=list.length;
    if(!n)return {width:0,height:0,cells:[],centers:new Map()};
    const auto=[],cells=new Array(n);
    for(let i=0;i<n;i++){
      if(list[i].x===null||list[i].y===null)auto.push(i);else cells[i]={x:list[i].x,y:list[i].y};
    }
    let cursorX=0,cursorY=0,rowBottom=0;
    for(const i of auto){
      if(cursorX>0&&cursorX+list[i].width>FLOW_BUDGET){cursorX=0;cursorY=rowBottom+GRID_GAP;}
      cells[i]={x:cursorX,y:cursorY};
      cursorX+=list[i].width+GRID_GAP;
      rowBottom=Math.max(rowBottom,cursorY+list[i].height);
    }
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    const centers=new Map();
    for(let i=0;i<n;i++){
      const c=cells[i],s=list[i];
      minX=Math.min(minX,c.x);minY=Math.min(minY,c.y);maxX=Math.max(maxX,c.x+s.width);maxY=Math.max(maxY,c.y+s.height);
      centers.set(s.id,{x:c.x+s.width/2,y:c.y+s.height/2});
    }
    return {width:maxX-minX,height:maxY-minY,cells,centers};
  }
  // F7: the error card leads with the likely cause; embedding-permission
  // jargon (the service's CSP/X-Frame-Options copy) is demoted verbatim to a
  // secondary detail line. Specific diagnostics keep the primary slot untouched
  // (seam 5: never clobber a service message).
  function errorCopy(msg){
    const text=typeof msg==='string'?msg.trim():'';
    // Empty OR the generic default (seam 5 passes BOARD_COPY.error through as
    // the message) both mean "no specific diagnostic": lead with the likely
    // cause and keep the embedding hint as the secondary line.
    if(!text||text===BOARD_COPY.error)return {primary:BOARD_COPY.error,detail:EMBED_HINT};
    if(/CSP|X-Frame-Options/i.test(text))return {primary:BOARD_COPY.error,detail:text};
    return {primary:text,detail:''};
  }
  function renderBoardState(b,s){
    b.overlay.hidden=s.state==='ready';b.overlay.dataset.state=s.state;
    if(s.state==='error'){
      const c=errorCopy(s.message);
      b.copy.textContent=c.primary;
      if(b.detail){b.detail.textContent=c.detail;b.detail.hidden=!c.detail;}
    }else{
      b.copy.textContent=s.state==='ready'?'':(s.message||BOARD_COPY[s.state]||'');
      if(b.detail){b.detail.textContent='';b.detail.hidden=true;}
    }
    b.action.hidden=s.state!=='error';
    // B1 watchdog: a board stuck 'loading' for LOADING_STALL_MS shows the
    // existing Retry (same retry message) as "Still loading — Retry".
    if(s.state!=='loading'){clearTimeout(b.stallTimer);b.stallTimer=null;b.stalled=false;}
    else if(b.stalled){b.action.hidden=false;}
    else if(!b.stallTimer){
      b.stallTimer=setTimeout(()=>{
        b.stallTimer=null;
        const live=screens.find(x=>x.id===s.id);
        if(!live||live.state!=='loading'||boards.get(s.id)!==b)return;
        b.stalled=true;b.action.hidden=false;b.action.textContent='Still loading — Retry';
      },LOADING_STALL_MS);
    }
    if(!b.stalled&&b.action.textContent!=='Retry')b.action.textContent='Retry';
  }
  function menuButtonFor(section){
    let menu=section.querySelector('.ds-ab-menu');
    if(menu)return menu;
    menu=document.createElement('button');menu.type='button';menu.className='ds-ab-menu';
    menu.textContent='⋯';menu.setAttribute('aria-label','Screen options');
    section.appendChild(menu);
    return menu;
  }
  // N1 (FIX-3): the header text lives in an inner label span — the title
  // button is display:inline-flex, which ignores text-overflow, so the
  // ellipsis has to be applied to a block-level child. Bakes (or hand-rolled
  // test DOMs) without the span get one at adoption; the button keeps the
  // reserved size-label budget and the compact tier.
  function titleLabel(title){
    let label=title.querySelector('.ds-ab-label');
    if(!label){label=document.createElement('span');label.className='ds-ab-label';title.appendChild(label);}
    return label;
  }
  function wireBoard(id,b){
    b.title.onclick=()=>{if(boardDragSquelch){boardDragSquelch=false;return;}transaction(()=>applyActive(id,true));};
    b.title.addEventListener('pointerdown',e=>{
      if(captureState||!e||e.button!==0)return;
      const s=screens.find(x=>x.id===id);if(!s)return;
      const placed=lastPositions.get(id);if(!placed)return;
      // D14 risk 5: bind the camera scale at pointerdown so a zoom racing the
      // drag can never jitter the deltas; live drag stays in-memory only.
      e.preventDefault();e.stopPropagation();
      emitHoverEnd();
      if(typeof b.title.setPointerCapture==='function')b.title.setPointerCapture(e.pointerId);
      boardDrag={id,moved:false,startX:e.clientX,startY:e.clientY,originX:placed.x,originY:placed.y,scale:view.scale||1,wasAuto:s.x===null||s.y===null};
    });
    b.action.onclick=()=>transaction(()=>retryScreen(id));
    b.section.ondblclick=e=>{if(e&&typeof e.preventDefault==='function')e.preventDefault();transaction(()=>{if(applyActive(id,true))focusScreen(id);});};
    b.menu.onclick=()=>{
      if(captureState||!view.ready)return;
      const already=contextMenu&&contextMenu.section===b.section;
      closeScreenMenu(true);
      if(already)return;
      const r=b.menu.getBoundingClientRect();
      openScreenMenu(b.section,(r&&r.left)||0,((r&&r.bottom)||0)+2);
    };
    b.frame.addEventListener('load',()=>{
      if(agentBusy)agentReloadSeen=true; // V4-12: busy-turn reload sighting
      // Seam 3: keep s.src mirrored to what the frame actually shows. A
      // setPage({navigate:false}) confirmation (in-frame navigation) then no
      // longer leaves s.src stale, so a later relayout cannot rewrite the
      // iframe.src to the URL it is already displaying (duplicate load).
      const s=screens.find(x=>x.id===id);if(!s)return;
      const current=typeof b.frame.src==='string'?b.frame.src:'';
      if(current&&current!=='about:blank'&&s.src!==current)s.src=current;
    });
    b.frame.addEventListener('error',()=>transaction(()=>{
      const s=screens.find(x=>x.id===id);if(!s||s.state!=='ready')return;
      // Seam 5: never clobber a specific service message with the generic
      // BOARD_COPY text; pass whatever the service already said through.
      const existing=typeof s.message==='string'&&s.message?s.message:BOARD_COPY.error;
      setScreenStateCore(id,{state:'error',message:existing});
    }));
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
    // F7 detail line is optional: pre-fix bakes (and hand-rolled test DOMs)
    // carry only copy + retry; renderBoardState tolerates its absence.
    const detail=overlay.querySelector('.ds-ab-card-detail');
    const board={section,title,label:titleLabel(title),size,frame,overlay,copy,detail,action,menu:menuButtonFor(section)};
    wireBoard(id,board);return board;
  }
  function createBoard(id){
    const section=document.createElement('section');
    section.className='ds-artboard';section.dataset.screen=id;section.dataset.active='false';
    const title=document.createElement('button');title.type='button';title.className='ds-ab-title';
    const label=document.createElement('span');label.className='ds-ab-label';title.appendChild(label); // N1 (FIX-3)
    const size=document.createElement('span');size.className='ds-ab-size';
    const frame=document.createElement('iframe');
    frame.id='ds-frame-'+id;frame.dataset.dsScreen=id;
    frame.setAttribute('name','__dsArtifact:'+id);
    frame.setAttribute('referrerpolicy','no-referrer');
    frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock');
    const overlay=document.createElement('div');overlay.className='ds-ab-state';overlay.dataset.state='loading';
    const copy=document.createElement('p');copy.className='ds-ab-card-copy';copy.setAttribute('role','status');
    const detail=document.createElement('p');detail.className='ds-ab-card-detail';detail.hidden=true;
    const action=document.createElement('button');action.type='button';action.className='ds-ab-retry';action.textContent='Retry';
    overlay.appendChild(copy);overlay.appendChild(detail);overlay.appendChild(action);
    section.appendChild(title);section.appendChild(size);section.appendChild(frame);section.appendChild(overlay);
    const board={section,title,label,size,frame,overlay,copy,detail,action};
    board.menu=menuButtonFor(section);
    wireBoard(id,board);
    return board;
  }
  function relayout(){
    const layout=placeScreens(screens);
    view.width=clampExtent(layout.width);view.height=clampExtent(layout.height);
    cellCenters=layout.centers;
    lastPositions=new Map(screens.map((s,i)=>{const c=layout.cells[i];return [s.id,{x:c.x,y:c.y}];}));
    const live=new Set(screens.map(s=>s.id));
    for(const [id,b] of [...boards]){if(!live.has(id)){if(contextMenu&&contextMenu.section===b.section)closeScreenMenu(false);if(renaming&&renaming.id===id)cancelRename();b.section.remove();boards.delete(id);}}
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
        boards.set(s.id,b);
      }
      b.section.dataset.screen=s.id;
      b.section.style.left=cell.x+'px';b.section.style.top=cell.y+'px';
      b.section.style.width=s.width+'px';b.section.style.height=s.height+'px';
      // --w lets the counter-scaled header clamp to the artboard's on-screen
      // width (V4-9): max-width calc(var(--w) * var(--cam-scale)).
      if(b.section.style.setProperty)b.section.style.setProperty('--w',s.width+'px');
      b.section.dataset.active=s.id===active?'true':'false';
      // N1 (FIX-3): header text goes to the inner label span (the flex button
      // itself cannot ellipsis); fall back for boards adopted without one.
      if(b.label)b.label.textContent=(i+1)+' · '+s.title;else b.title.textContent=(i+1)+' · '+s.title;
      b.size.textContent=s.width+'×'+s.height;
      if(s.url&&s.src!==s.url){
        // If the frame already shows s.url (in-frame navigation synced through
        // the load hook) only the bookkeeping needs to move -- never rewrite
        // the src, or the same document loads twice.
        const current=typeof b.frame.src==='string'?b.frame.src:'';
        if(current===s.url){s.src=s.url;}
        else{b.frame.src=s.url;s.src=s.url;}
      }
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
    // Integrator restore: the v1 paint line, guarded — the #layout-reason band
    // only exists on legacy bakes (workspace:false); workspaces never had it.
    const reasonBand=$('layout-reason');if(reasonBand){reasonBand.hidden=!(view.layoutMode==='viewport'&&view.reason);reasonBand.textContent=view.reason?'Viewport fallback: '+view.reason:'';}
    // V4-9 art-wall polish: --cam-scale drives the header counter-scale (CSS
    // scales headers by 1/--cam-scale, so labels stay ~13px readable at every
    // zoom); the dot grid translates with the camera and hides below 0.3.
    if(camera.style.setProperty)camera.style.setProperty('--cam-scale',String(view.scale));
    // F3/F7 compact tiers track the live scale: below HEADER_COMPACT_W device
    // px of board width the size label hides and the title gets the full clamp
    // (CSS data-header-compact); below ERROR_COMPACT_SCALE the error cards drop
    // their prose and keep only the counter-scaled Retry button (CSS
    // data-zoom-compact). Pure presentation — no camera math is touched.
    canvas.dataset.zoomCompact=view.scale<ERROR_COMPACT_SCALE?'true':'false';
    for(const [id,b] of boards){const s=screens.find(v=>v.id===id);if(s)b.section.dataset.headerCompact=s.width*view.scale<HEADER_COMPACT_W?'true':'false';}
    canvas.style.backgroundSize=(DOT*view.scale)+'px '+(DOT*view.scale)+'px';
    canvas.style.backgroundPosition=x+'px '+y+'px';
    canvas.style.backgroundImage=view.scale<DOT_MIN_SCALE?'none':'';
    $('pan-layer').hidden=!(view.ready&&(view.pan||view.space));
    renderPill();
    scheduleCameraChanged();
    publish();
  }
  // User camera churn (wheel/pan/drag-zoom, all funneled through paint) emits
  // one debounced camera-changed command; service-originated camera application
  // (restoreCamera, revealScreen) never echoes back as user churn, and while
  // the agent owns input (V4-7) the user's persisted camera is never touched.
  function scheduleCameraChanged(){
    if(applyingCamera||captureState||view.agentInput)return;
    clearTimeout(cameraTimer);
    cameraTimer=setTimeout(emitCameraChanged,EMIT_DEBOUNCE_MS);
  }
  function emitCameraChanged(){
    cameraTimer=null;
    if(applyingCamera||captureState||view.agentInput||!view.ready)return;
    const camera={mode:view.mode,scale:view.scale,panX:view.panX,panY:view.panY};
    if(lastCameraSent&&lastCameraSent.mode===camera.mode&&lastCameraSent.scale===camera.scale&&lastCameraSent.panX===camera.panX&&lastCameraSent.panY===camera.panY)return;
    lastCameraSent=camera;
    send({type:'camera-changed',camera:{mode:camera.mode,scale:camera.scale,panX:camera.panX,panY:camera.panY}});
  }
  // V4-4 shell half: stacked persistent banners in #toolbar-status-area. The
  // service is the authority (registry errors); text rides textContent only, so
  // hostile payloads can never become markup.
  function freezeNotices(){return Object.freeze([...noticeMap.values()].map(n=>Object.freeze({...n})));}
  function renderNotices(){
    const area=$('toolbar-status-area');
    if(!area||typeof area.replaceChildren!=='function')return;
    const rows=[];
    for(const n of noticeMap.values()){
      const row=document.createElement('div');row.className='ds-notice';row.dataset.kind=n.kind;
      row.setAttribute('role',n.kind==='error'?'alert':'status');
      const dot=document.createElement('span');dot.className='ds-notice-dot';dot.setAttribute('aria-hidden','true');
      const text=document.createElement('span');text.className='ds-notice-text';text.textContent=n.text;
      row.appendChild(dot);row.appendChild(text);rows.push(row);
    }
    area.replaceChildren(...rows);
  }
  function setNoticeCore(info){
    if(!info||typeof info!=='object'||typeof info.id!=='string'||!info.id||info.id.length>120)return false;
    if(typeof info.text!=='string')return false;
    const kind=['info','warn','error'].includes(info.kind)?info.kind:'info';
    const text=info.text.slice(0,NOTICE_TEXT_MAX);
    if(!text){
      if(noticeMap.has(info.id)){noticeMap.delete(info.id);notices=freezeNotices();renderNotices();publish();}
      return true;
    }
    noticeMap.set(info.id,{id:info.id,kind,text});
    while(noticeMap.size>NOTICE_MAX){const oldest=noticeMap.keys().next().value;noticeMap.delete(oldest);}
    notices=freezeNotices();renderNotices();publish();return true;
  }
  // V4-5 shell half: one bottom-center transient pill; the newest replaces it
  // and it self-dismisses after 2000 ms. copy:true also mirrors the text to the
  // clipboard (127.0.0.1 is a secure context) and never surfaces a rejection.
  function renderToast(){
    if(!toastEl){toastEl=document.createElement('div');toastEl.className='ds-toast';toastEl.setAttribute('role','status');canvas.appendChild(toastEl);}
    if(!toast||captureState){toastEl.style.display='none';toastEl.textContent='';return;}
    toastEl.style.display='';toastEl.dataset.kind=toast.kind;toastEl.textContent=toast.text;
  }
  function showToastCore(info){
    if(!info||typeof info!=='object'||typeof info.text!=='string'||!info.text.trim())return false;
    const kind=['ok','warn','error','info'].includes(info.kind)?info.kind:'ok';
    const text=info.text.trim().slice(0,NOTICE_TEXT_MAX);
    toast=Object.freeze({kind,text});renderToast();
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{toastTimer=null;toast=null;renderToast();publish();},TOAST_MS);
    if(info.copy===true){
      try{
        const nav=window.navigator;
        if(nav&&nav.clipboard&&typeof nav.clipboard.writeText==='function'){
          const maybe=nav.clipboard.writeText(text);
          if(maybe&&typeof maybe.catch==='function')maybe.catch(()=>undefined);
        }
      }catch{/* clipboard is best effort only */}
    }
    publish();return true;
  }
  // R2 (B4) shell half: a click selects (the service draws the outlines in the
  // frame and pushes the mirrored count here); referencing is explicit — the
  // toolbar button, the floating pill under the selected artboard, or Enter.
  function setSelectionCore(info){
    if(!info||typeof info!=='object'||!Number.isInteger(info.count)||info.count<0||info.count>MAX_SCREENS*10||!Array.isArray(info.screens)||info.screens.length>MAX_SCREENS)return false;
    const list=[];
    for(const item of info.screens){
      if(!item||typeof item.id!=='string'||!SCREEN_ID.test(item.id)||!Number.isInteger(item.count)||item.count<0)return false;
      list.push(Object.freeze({id:item.id,count:item.count}));
    }
    const named=typeof info.screen==='string'&&list.some(item=>item.id===info.screen)?info.screen:'';
    const anchor=named||(list.length?list[list.length-1].id:'');
    const label=typeof info.label==='string'?info.label.slice(0,120):'';
    const had=selection.count;
    selection=info.count?Object.freeze({count:info.count,screens:Object.freeze(list),screen:anchor,label}):NO_SELECTION;
    if(had&&!selection.count)announce('Nothing selected');
    else if(selection.count)announce(selection.count===1?'1 element selected. Press Enter to reference it in chat.':selection.count+' elements selected. Press Enter to reference them in chat.');
    renderPill();publish();return true;
  }
  function dropLocalSelection(){if(!selection.count)return;selection=NO_SELECTION;renderPill();}
  function referenceSelection(){
    if(captureState||view.agentInput||!selection.count)return false;
    dropLocalSelection();
    send({type:'selection-send',sentAt:Date.now()});
    publish();return true;
  }
  function clearSelection(){
    if(captureState||!selection.count)return false;
    dropLocalSelection();
    send({type:'selection-clear'});
    announce('Nothing selected');
    publish();return true;
  }
  // The pill is pure shell geometry: bottom-centre of the anchor artboard in
  // canvas px (the same camera transform paint applies), clamped into view.
  function renderPill(){
    if(!pillEl&&!selection.count)return;
    if(!pillEl){
      pillEl=document.createElement('div');pillEl.className='ds-selection-pill';pillEl.setAttribute('role','group');pillEl.setAttribute('aria-label','Selection');
      pillSend=document.createElement('button');pillSend.type='button';pillSend.className='ds-pill-send';pillSend.textContent='Reference in chat';
      pillSend.onclick=()=>transaction(()=>referenceSelection());
      const clear=document.createElement('button');clear.type='button';clear.className='ds-pill-clear';clear.textContent='×';clear.setAttribute('aria-label','Clear selection');
      clear.onclick=()=>transaction(()=>clearSelection());
      pillEl.appendChild(pillSend);pillEl.appendChild(clear);canvas.appendChild(pillEl);
    }
    const s=selection.count?screens.find(v=>v.id===selection.screen):null,cell=s&&lastPositions.get(s.id);
    if(!s||!cell||captureState||!view.ready){pillEl.style.display='none';return;}
    const box=canvas.getBoundingClientRect();
    const tx=(box.width-view.width*view.scale)/2+view.panX;
    const ty=(view.mode==='fit-all'?(box.height-view.height*view.scale)/2:numToken('--s7'))+view.panY;
    const x=tx+(cell.x+s.width/2)*view.scale,y=ty+(cell.y+s.height)*view.scale+8;
    const w=finite(box.width)?box.width:0,h=finite(box.height)?box.height:0;
    pillEl.style.display='';
    pillEl.style.left=Math.round(w?Math.max(96,Math.min(w-96,x)):x)+'px';
    pillEl.style.top=Math.round(h?Math.max(8,Math.min(h-48,y)):y)+'px';
    pillEl.dataset.count=String(selection.count);
    pillSend.disabled=view.agentInput;
    pillSend.title=view.agentInput?'Available when the agent finishes using the canvas':selection.count===1?'Reference 1 element in chat (Enter)':'Reference '+selection.count+' elements in chat (Enter)';
  }
  // V4-12 shell half: the toolbar chip reads agentBusy/agentLabel; on the
  // busy→idle flip an Updated toast lands only if some artboard reloaded during
  // the turn (frame load events while busy).
  function setAgentStatusCore(info){
    if(!info||typeof info!=='object'||typeof info.busy!=='boolean')return false;
    const wasBusy=agentBusy;
    agentBusy=info.busy;
    agentLabel=info.busy&&typeof info.label==='string'?info.label.trim().slice(0,60):'';
    if(info.busy){if(!wasBusy)agentReloadSeen=false;}
    else if(wasBusy){
      const saw=agentReloadSeen;agentReloadSeen=false;
      if(saw)showToastCore({kind:'ok',text:'Updated'});
    }
    publish();return true;
  }
  // V4-7 shell half: while the agent owns input, canvas pointer/wheel/keyboard
  // paths ignore user events, camera-changed never emits, and CSS re-enables
  // iframe pointer-events so dispatched input lands inside the screen.
  function setAgentInputCore(on){
    if(typeof on!=='boolean')return false;
    if(on){
      view.agentInput=true;canvas.dataset.agentInput='true';
      emitHoverEnd();closeScreenMenu(false);cancelRename();
      clearTimeout(cameraTimer);cameraTimer=null;
    }else{
      view.agentInput=false;delete canvas.dataset.agentInput;
      lastCameraSent={mode:view.mode,scale:view.scale,panX:view.panX,panY:view.panY};
    }
    renderPill();publish();return true;
  }
  // V4-7: pan the minimum needed to bring the artboard fully into view (no
  // zoom change; its top-left when it is larger than the viewport). Service
  // application, so it never echoes as user camera churn.
  function revealScreenCore(id){
    if(captureState||!view.ready||typeof id!=='string'||!id)return false;
    const s=screens.find(v=>v.id===id),cell=lastPositions.get(id);
    if(!s||!cell)return false;
    const box=canvas.getBoundingClientRect();
    if(!box||!finite(box.width)||!box.width||!box.height||!view.scale)return false;
    const tx=(box.width-view.width*view.scale)/2+view.panX;
    const ty=(view.mode==='fit-all'?(box.height-view.height*view.scale)/2:numToken('--s7'))+view.panY;
    const left=tx+cell.x*view.scale,top=ty+cell.y*view.scale,w=s.width*view.scale,h=s.height*view.scale;
    let nx=tx,ny=ty;
    if(left<0||left+w>box.width)nx=w>box.width?tx-left:(left<0?tx-left:tx+(box.width-(left+w)));
    if(top<0||top+h>box.height)ny=h>box.height?ty-top:(top<0?ty-top:ty+(box.height-(top+h)));
    if(nx===tx&&ny===ty)return true;
    applyingCamera=true;
    try{
      view.mode='manual';
      view.panX=nx-(box.width-view.width*view.scale)/2;
      view.panY=ny-numToken('--s7');
      paint();
    }finally{
      applyingCamera=false;
      lastCameraSent={mode:view.mode,scale:view.scale,panX:view.panX,panY:view.panY};
    }
    return true;
  }
  // V4-6 shell half: edit-mode hover emitter. The outline inside the frame is
  // the service's job (__dsHoverAt); the shell only emits unscaled artboard
  // coordinates (same mapping as pickAt), rAF-coalesced, ≥3 px or screen
  // change, and one hover-end on leave/mode change/drag start.
  function framePoint(section,e){
    const s=screens.find(x=>x.id===section.dataset.screen);if(!s)return null;
    const r=section.getBoundingClientRect();
    if(!r||!finite(r.left)||!finite(r.top)||!view.scale)return null;
    const x=(e.clientX-r.left)/view.scale,y=(e.clientY-r.top)/view.scale;
    if(!finite(x)||!finite(y)||x<0||y<0||x>=s.width||y>=s.height)return null;
    return {screen:s.id,x:Math.round(x),y:Math.round(y)};
  }
  function emitHoverEnd(){
    if(!hover.screen)return;
    hover.screen='';hover.x=NaN;hover.y=NaN;hover.pending=null;
    send({type:'screen-hover-end'});
  }
  function flushHover(){
    hover.raf=0;
    const p=hover.pending;if(!p)return;
    if(hover.screen===p.screen&&Math.abs(p.x-hover.x)<HOVER_MIN_STEP&&Math.abs(p.y-hover.y)<HOVER_MIN_STEP)return;
    hover.screen=p.screen;hover.x=p.x;hover.y=p.y;
    send({type:'screen-hover',screen:p.screen,x:p.x,y:p.y});
  }
  function canvasHoverMove(e){
    if(!view.ready||captureState||view.agentInput||shellMode!=='edit'||contextMenu||renaming||drag||boardDrag)return;
    const target=e&&e.target;
    const section=target&&typeof target.closest==='function'?target.closest('.ds-artboard'):null;
    if(!section||target.closest('.ds-ab-title')||target.closest('.ds-ab-menu')||target.closest('.ds-ab-state')){emitHoverEnd();return;}
    const p=framePoint(section,e);
    if(!p){emitHoverEnd();return;}
    hover.pending=p;
    if(!hover.raf)hover.raf=requestAnimationFrame(flushHover);
  }
  // V4-10 shell half: a vanilla role=menu popover the controller builds itself
  // (fixed coords, so it is never clipped by the canvas). Actions map onto the
  // frozen {type:'screen-menu'} contract; 'zoom' focuses locally and 'rename'
  // opens the inline header input -- neither sends a screen-menu message.
  function closeScreenMenu(refocus){
    if(!contextMenu)return false;
    const {menu,section}=contextMenu;contextMenu=null;menu.remove();
    if(refocus&&section&&typeof section.querySelector==='function'){
      const target=section.querySelector('.ds-ab-title');
      if(target&&typeof target.focus==='function')target.focus();
    }
    return true;
  }
  // F2: the menu is position:fixed and placed from clientX/Y viewport coords,
  // so it is scroll-safe by construction. After the append measures it, the
  // preferred bottom-right-of-cursor spot flips to the left of / above the
  // cursor when the far edge would clip, and finally clamps inside an 8px
  // viewport margin (window resize re-runs this on the open menu).
  function positionMenu(menu,x,y){
    menu.style.left=Math.round(x)+'px';menu.style.top=Math.round(y)+'px';
    const de=document.documentElement;
    const vw=finite(window.innerWidth)?window.innerWidth:(de&&finite(de.clientWidth)?de.clientWidth:0);
    const vh=finite(window.innerHeight)?window.innerHeight:(de&&finite(de.clientHeight)?de.clientHeight:0);
    if(!vw||!vh)return;
    const r=typeof menu.getBoundingClientRect==='function'?menu.getBoundingClientRect():null;
    const w=r&&finite(r.width)?r.width:0,h=r&&finite(r.height)?r.height:0;
    if(!w||!h)return;
    const maxX=Math.max(MENU_EDGE,vw-w-MENU_EDGE),maxY=Math.max(MENU_EDGE,vh-h-MENU_EDGE);
    let left=x,top=y;
    if(left+w>vw-MENU_EDGE)left=(x-w>=MENU_EDGE)?x-w:maxX;
    if(top+h>vh-MENU_EDGE)top=(y-h>=MENU_EDGE)?y-h:maxY;
    left=Math.max(MENU_EDGE,Math.min(left,maxX));top=Math.max(MENU_EDGE,Math.min(top,maxY));
    menu.style.left=Math.round(left)+'px';menu.style.top=Math.round(top)+'px';
  }
  function openScreenMenu(section,x,y){
    if(captureState||!view.ready||!section)return false;
    const id=section.dataset.screen,s=screens.find(v=>v.id===id);
    if(!s)return false;
    closeScreenMenu(false);
    emitHoverEnd();
    const menu=document.createElement('div');
    menu.className='ds-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Screen options');
    const items=[];
    SCREEN_MENU.forEach((group,gi)=>{
      // F10: 1px separators between groups (role=separator — never menuitems,
      // so the items[] keyboard ring and the frozen action mapping are intact).
      if(gi){const sep=document.createElement('div');sep.className='ds-menu-sep';sep.setAttribute('role','separator');menu.appendChild(sep);}
      for(const [action,label] of group){
        const item=document.createElement('button');
        item.type='button';item.className='ds-menu-item';item.setAttribute('role','menuitem');item.textContent=label;
        if(item.dataset)item.dataset.action=action;else item.setAttribute('data-action',action);
        item.onclick=()=>screenMenuAction(id,action,section);
        menu.appendChild(item);items.push(item);
      }
    });
    document.body.appendChild(menu);
    positionMenu(menu,x,y);
    contextMenu={menu,section,items,focus:0,x,y};
    const first=items[0];
    if(first&&typeof first.focus==='function')first.focus();
    return true;
  }
  function moveMenuFocus(step){
    if(!contextMenu)return;
    const n=contextMenu.items.length;
    contextMenu.focus=((contextMenu.focus+step)%n+n)%n;
    const item=contextMenu.items[contextMenu.focus];
    if(item&&typeof item.focus==='function')item.focus();
  }
  function handleMenuKey(e){
    if(!contextMenu||!e)return false;
    const stop=()=>{if(typeof e.preventDefault==='function')e.preventDefault();};
    if(e.key==='Escape'){stop();closeScreenMenu(true);return true;}
    if(e.key==='ArrowDown'){stop();moveMenuFocus(1);return true;}
    if(e.key==='ArrowUp'){stop();moveMenuFocus(-1);return true;}
    if(e.key==='Home'){stop();contextMenu.focus=0;moveMenuFocus(0);return true;}
    if(e.key==='End'){stop();contextMenu.focus=contextMenu.items.length;moveMenuFocus(-1);return true;}
    if(e.key==='Enter'||e.key===' '){stop();const item=contextMenu.items[contextMenu.focus];if(item&&item.onclick)item.onclick();return true;}
    if(e.key==='Tab'){closeScreenMenu(false);return true;}
    return false;
  }
  function screenMenuAction(id,action){
    closeScreenMenu(true);
    if(action==='zoom'){transaction(()=>focusScreen(id));return;}
    if(action==='rename'){startRename(id);return;}
    send({type:'screen-menu',screen:id,action});
  }
  function startRename(id){
    const s=screens.find(v=>v.id===id),b=boards.get(id);
    if(!s||!b)return false;
    cancelRename();
    const input=document.createElement('input');
    input.className='ds-ab-rename';input.type='text';input.maxLength=120;
    input.value=s.title;input.setAttribute('aria-label','Rename screen');
    input.addEventListener('keydown',e=>{
      if(!e)return;
      if(e.key==='Enter'){if(typeof e.preventDefault==='function')e.preventDefault();if(typeof e.stopPropagation==='function')e.stopPropagation();commitRename();}
      else if(e.key==='Escape'){if(typeof e.preventDefault==='function')e.preventDefault();cancelRename();publish();}
    });
    input.addEventListener('blur',()=>{if(renaming&&renaming.input===input)commitRename();});
    b.section.appendChild(input);
    renaming={id,input,previous:s.title};
    if(typeof input.focus==='function')input.focus();
    if(typeof input.select==='function')input.select();
    publish();return true;
  }
  function commitRename(){
    if(!renaming)return false;
    const {id,input,previous}=renaming;
    const raw=typeof input.value==='string'?input.value.trim():'';
    renaming=null;input.remove();
    publish();
    if(!raw||raw===previous)return true;
    const title=raw.slice(0,120);
    transaction(()=>send({type:'screen-rename',screen:id,title}));
    return true;
  }
  function cancelRename(){
    if(!renaming)return false;
    const done=renaming;renaming=null;done.input.remove();
    return true;
  }
  function pulseNew(ids){
    for(const id of ids){
      const b=boards.get(id);if(!b)continue;
      b.section.dataset.new='true';
      clearTimeout(newPulseTimers.get(id));
      newPulseTimers.set(id,setTimeout(()=>{
        newPulseTimers.delete(id);
        const bb=boards.get(id);
        if(bb)delete bb.section.dataset.new;
      },NEW_PULSE_MS));
    }
  }
  function setScreensCore(list){
    if(captureState||!Array.isArray(list)||list.length>MAX_SCREENS)return false;
    const previous=new Map(screens.map(s=>[s.id,s]));
    const next=[],seen=new Set();
    for(const item of list){
      const s=validScreen(item);
      if(!s||seen.has(s.id))return false;seen.add(s.id);
      const old=previous.get(s.id);
      // Absent x/y on an entry whose live screen already carries a position
      // (user drag not yet persisted in the pushed registry) inherits it;
      // explicit null means "back to auto" and always applies.
      const inherit=old&&item.x===undefined&&item.y===undefined&&old.x!==null&&old.y!==null;
      next.push({id:s.id,url:s.url,width:s.width,height:s.height,title:s.title,state:old?old.state:'loading',message:old?old.message:'',src:old?old.src:'',x:inherit?old.x:s.x,y:inherit?old.y:s.y});
    }
    // V4-4: ids the previous live list did not have get a 1200 ms ring pulse
    // ("the agent just added this"). The boot bake and the very first screen
    // never pulse (nothing arrived -- the canvas simply opened).
    const added=hadScreens?next.filter(s=>!previous.has(s.id)).map(s=>s.id):[];
    screens=next;
    if(!screens.some(s=>s.id===active))active=screens.length?screens[0].id:'';
    const activeScreen=screens.find(s=>s.id===active);
    if(activeScreen){currentUrl=activeScreen.url;currentTitle=activeScreen.title;}
    relayout();
    if(screens.length)paint();else setStatus({state:'empty'});
    hadScreens=screens.length>0;
    if(added.length)pulseNew(added);
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
  // V4-1 shell pin: activating an artboard (title click, toolbar chip,
  // double-click, service setActive) is camera + focus ONLY. Sizes are owned by
  // the registry and this path never touches width/height, never qualifies a
  // layout, and never emits layout/fit-size/viewport commands.
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
    if(captureState||!['edit','play'].includes(mode))return false;
    // R2 (B4): a mode flip drops the selection (the service clears the frames
    // and confirms with setSelection; the shell stops showing it at once).
    if(mode!==shellMode)dropLocalSelection();
    shellMode=mode;canvas.dataset.mode=mode;
    // A service push is the truth: the toolbar's pending segment resolves.
    clearTimeout(modeTimer);modeTimer=null;modePending=null;
    emitHoverEnd();
    paint();
    announce(mode==='edit'?EDIT_HINT:'Play mode: screens accept real interaction. Ctrl or Cmd click selects an element.');
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
    const next=Number(value);if(!finite(next))return;const old=view.scale,scale=Math.min(3,Math.max(.1,next)),box=canvas.getBoundingClientRect(),px=point?point.x-box.width/2:0,py=point?point.y-numToken('--s7'):0;
    view.panX=px-(px-view.panX)*scale/old;view.panY=py-(py-view.panY-(point?(view.mode==='fit-all'?(box.height-view.height*old)/2-numToken('--s7'):0):0))*scale/old;view.scale=scale;view.mode='manual';paint();announce('Zoom '+Math.round(scale*100)+' percent');
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
    // V4-15 (E18): a capture must never leave an input grab dangling. Cancel an
    // in-flight board drag (reverts to the pre-drag cell) and the pan drag,
    // close the context menu/rename, and stop hover emission.
    emitHoverEnd();closeScreenMenu(false);cancelRename();
    if(boardDrag)finishBoardDrag(true);
    if(drag){drag=null;canvas.classList.remove('dragging');}
    captureState={token:++captureSequence,id:target,view:{...view},body:document.body.style.cssText,styles:[[camera,camera.style.cssText],[canvas,canvas.style.cssText]]};
    // Shell chrome that lives inside the canvas rect would leak into the export
    // region; snapshot and hide it until endCapture restores every cssText.
    const statusArea=$('toolbar-status-area');
    if(statusArea){captureState.styles.push([statusArea,statusArea.style.cssText]);statusArea.style.display='none';}
    if(toastEl){captureState.styles.push([toastEl,toastEl.style.cssText]);toastEl.style.display='none';}
    if(pillEl){captureState.styles.push([pillEl,pillEl.style.cssText]);pillEl.style.display='none';}
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
    renderToast();
    const pending=saved.pendingStatus;repaintPending=false;if(pending)setStatus(pending);else paint();return true;
  }
  for(const type of ['pointerdown','pointermove','pointerup','click','wheel','keydown','keyup'])document.addEventListener(type,e=>{if(captureState){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,passive:false});
  document.addEventListener('keydown',e=>{
    // F16b (FIX-3): a key press ends any pointer-focus suppression, so the
    // keyboard :focus-visible ring is back for keyboard users.
    if(canvas.dataset&&canvas.dataset.pointerFocus)delete canvas.dataset.pointerFocus;
    // The context menu owns the keyboard while it is open; typing into the
    // inline rename input never reaches canvas shortcuts. While the agent owns
    // input (V4-7) every user key path is inert.
    if(contextMenu){handleMenuKey(e);return;}
    if(renaming)return;
    if(view.agentInput)return;
    if(e.defaultPrevented||cameraShortcut(e))return;
    // Stock DropdownMenu owns all menu keyboard/focus and dismissal handling.
    if(openMenu)return;
    if(e.key==='Escape'&&(view.pan||view.space)){e.preventDefault();setPan(false);$('pan')?.focus();return;}
    // R2 (B4): with the canvas focused, Esc clears the selection and Enter
    // (or Ctrl/Cmd+Enter) references it in chat.
    if(document.activeElement===canvas&&selection.count&&!captureState){
      if(e.key==='Escape'){e.preventDefault();transaction(()=>clearSelection());return;}
      if(e.key==='Enter'){e.preventDefault();transaction(()=>referenceSelection());return;}
    }
    if(document.activeElement!==canvas||!view.ready||view.layoutMode==='fit')return;
    if(e.key===' '){e.preventDefault();view.space=true;paint();}else if(e.key.toLowerCase()==='h'){e.preventDefault();setPan(!view.pan);}else if(e.key==='+'||e.key==='='){e.preventDefault();zoomTo(view.scale*1.25);}else if(e.key==='-'){e.preventDefault();zoomTo(view.scale/1.25);}else if(e.shiftKey&&(e.code==='Digit1'||e.key==='!')){e.preventDefault();transaction(()=>fitAll());}else if(e.shiftKey&&(e.code==='Digit0'||e.key===')')){e.preventDefault();zoomTo(1);}else if(e.key.startsWith('Arrow')){e.preventDefault();moveCamera(e.key.slice(5).toLowerCase(),e.shiftKey?3:1);}
  });
  function moveCamera(direction,multiplier=1){if(!view.ready||captureState||view.layoutMode==='fit')return;view.mode='manual';const step=numToken('--pan-step')*multiplier;if(direction==='left')view.panX-=step;if(direction==='right')view.panX+=step;if(direction==='up')view.panY-=step;if(direction==='down')view.panY+=step;paint();}
  document.addEventListener('keyup',e=>{if(e.key===' '){view.space=false;paint();}});window.addEventListener('blur',()=>{view.space=false;drag=null;lastTap=null;finishBoardDrag(true);canvas.classList.remove('dragging');emitHoverEnd();paint();});
  // F2: a window resize re-clamps the open context menu into the new viewport.
  window.addEventListener('resize',()=>{if(contextMenu)positionMenu(contextMenu.menu,contextMenu.x,contextMenu.y);});
  canvas.addEventListener('pointerdown',e=>{
    if(!view.ready||view.layoutMode==='fit'||view.agentInput||e.button!==0||e.target.closest('.state')||e.target.closest('.ds-ab-title')||e.target.closest('.ds-ab-menu')||e.target.closest('.ds-ab-rename')||e.target.closest('.ds-ab-state')||e.target.closest('.ds-selection-pill'))return;
    // F16b (FIX-3): tag the pointer-originated focus BEFORE focusing so the
    // CSS never draws the keyboard :focus-visible ring for it (programmatic
    // focus can match :focus-visible — the white post-click ring finding).
    // Any keydown clears the tag, so keyboard focus keeps its ring.
    canvas.dataset.pointerFocus='true';
    canvas.focus();view.mode='manual';emitHoverEnd();
    drag={x:e.clientX,y:e.clientY,panX:view.panX,panY:view.panY,moved:false,section:e.target.closest('.ds-artboard')};canvas.setPointerCapture(e.pointerId);canvas.classList.add('dragging');e.preventDefault();
  });
  canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if((Math.abs(dx)>4||Math.abs(dy)>4)&&!drag.moved){drag.moved=true;lastTap=null;}view.panX=drag.panX+dx;view.panY=drag.panY+dy;paint();});
  canvas.addEventListener('pointermove',canvasHoverMove);
  canvas.addEventListener('pointerleave',()=>emitHoverEnd());
  canvas.addEventListener('contextmenu',e=>{
    if(captureState||!view.ready||view.agentInput||!e||!e.target||typeof e.target.closest!=='function')return;
    const section=e.target.closest('.ds-artboard');
    if(!section)return;
    // Play mode: the frame owns the body, so the menu only opens on the
    // artboard's header chrome (title/size/⋯ strip above and beside it).
    if(shellMode==='play'&&!e.target.closest('.ds-ab-title')&&!e.target.closest('.ds-ab-size')&&!e.target.closest('.ds-ab-menu'))return;
    if(typeof e.preventDefault==='function')e.preventDefault();
    openScreenMenu(section,Number(e.clientX)||0,Number(e.clientY)||0);
  });
  document.addEventListener('pointerdown',e=>{
    if(!contextMenu||!e||!e.target)return;
    if(typeof contextMenu.menu.contains==='function'&&contextMenu.menu.contains(e.target))return;
    if(typeof e.target.closest==='function'&&e.target.closest('.ds-ab-menu'))return;
    closeScreenMenu(false);
  });
  function endDrag(e){
    if(!drag)return;
    const moved=drag.moved,section=drag.section;drag=null;lastTap=moved?null:lastTap;
    canvas.classList.remove('dragging');
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(moved||shellMode!=='edit')return;
    // R2 (B4): a click on the empty canvas (no drag) clears the selection.
    if(!section){if(selection.count)transaction(()=>clearSelection());return;}
    const id=section.dataset.screen;
    if(!screens.some(s=>s.id===id))return;
    if(lastTap&&lastTap.id===id&&Date.now()-lastTap.at<350){lastTap=null;transaction(()=>{if(applyActive(id,true))focusScreen(id);});return;}
    lastTap={id,at:Date.now()};
    transaction(()=>{applyActive(id,false);pickAt(section,e);});
  }canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
  // Artboard drag-reposition: pointerdown on the title bar only (shell chrome,
  // never the iframe) -- deltas convert screen px to natural px through the
  // scale captured at pointerdown; live move is in-memory style updates only;
  // the pointerup commits relayout + one screen-move command.
  function boardDragMove(e){
    if(!boardDrag)return;
    const dx=(e.clientX-boardDrag.startX)/boardDrag.scale,dy=(e.clientY-boardDrag.startY)/boardDrag.scale;
    if(!boardDrag.moved&&(Math.abs(e.clientX-boardDrag.startX)>4||Math.abs(e.clientY-boardDrag.startY)>4))boardDrag.moved=true;
    const s=screens.find(x=>x.id===boardDrag.id),b=s&&boards.get(s.id);
    if(!s||!b)return;
    s.x=clampPos(boardDrag.originX+dx);s.y=clampPos(boardDrag.originY+dy);
    b.section.style.left=s.x+'px';b.section.style.top=s.y+'px';
  }
  function finishBoardDrag(cancelled){
    if(!boardDrag)return;
    const done=boardDrag;boardDrag=null;boardDragSquelch=done.moved;
    const s=screens.find(x=>x.id===done.id);
    if(!s)return;
    if(!cancelled&&!done.moved)return; // a plain title click commits nothing
    if(cancelled){s.x=done.wasAuto?null:done.originX;s.y=done.wasAuto?null:done.originY;}
    transaction(()=>{relayout();paint();});
    if(!cancelled)send({type:'screen-move',screen:done.id,x:s.x,y:s.y});
  }
  window.addEventListener('pointermove',boardDragMove);
  window.addEventListener('pointerup',()=>finishBoardDrag(false));
  window.addEventListener('pointercancel',()=>finishBoardDrag(true));
  function pickAt(section,e){
    const p=framePoint(section,e);if(!p)return;
    // R2 (B4): the click SELECTS (the service runs __dsSelectAt in the frame);
    // clickAt stamps the shell clock for the click→selected timing log.
    const command={type:'screen-pick',screen:p.screen,x:p.x,y:p.y,clickAt:Date.now()};
    // Shift-click toggles the element in or out of the selection.
    if(e&&e.shiftKey)command.additive=true;
    send(command);
  }
  function wheelInput(deltaX,deltaY,x,y,zoom){if(!view.ready||captureState||view.layoutMode==='fit'||![deltaX,deltaY,x,y].every(finite))return false;if(zoom)zoomTo(view.scale*Math.exp(-deltaY*.005),{x,y});else{view.mode='manual';view.panX-=deltaX;view.panY-=deltaY;paint();}return true;}
  canvas.addEventListener('wheel',e=>{
    if(e.defaultPrevented||view.agentInput)return;
    const b=canvas.getBoundingClientRect();
    if(e.ctrlKey||e.metaKey){e.preventDefault();e.stopPropagation();zoomCamera({action:'wheel',deltaY:e.deltaY,x:e.clientX-b.left,y:e.clientY-b.top});return;}
    if(!view.ready||view.layoutMode==='fit'||e.target.closest('.state'))return;e.preventDefault();wheelInput(e.deltaX,e.deltaY,e.clientX-b.left,e.clientY-b.top,false);
  },{passive:false});
  document.addEventListener('wheel',e=>{if(e.defaultPrevented||!(e.ctrlKey||e.metaKey)||view.agentInput)return;e.preventDefault();e.stopPropagation();const b=canvas.getBoundingClientRect();zoomCamera({action:'wheel',deltaY:e.deltaY,x:e.clientX-b.left,y:e.clientY-b.top});},{passive:false});
  // The observer keeps the camera/grid repainted on window resize. V4-1 killed
  // the fit-size qualification emit for WORKSPACE launches (artboards are
  // registry-fixed, §3: no layout/fit-size/viewport emission). Integrator
  // correction: the legacy single-frame contract (baked workspace:false) keeps
  // the v1 auto-refit channel byte-identical — the service's fit-size branch
  // (browser.ts, non-workspace) still answers it, and the pinned legacy
  // behavior needs it after a window resize. In workspaces the emit is dead by
  // BOTH guards: the flag, and pinWorkspaceLayout keeping layoutMode off 'fit'.
  new ResizeObserver(()=>{paint();if(bootConfig.workspace===false&&view.layoutMode==='fit'&&!captureState&&!fitSizeQueued){fitSizeQueued=true;requestAnimationFrame(()=>{fitSizeQueued=false;if(bootConfig.workspace===false&&view.layoutMode==='fit'&&!captureState)send({type:'fit-size',screen:active});});}}).observe(canvas);
  function retry(){if(captureState)return;setStatus({state:'loading'});const command={type:'retry'};if(active)command.screen=active;send(command);}
  function retryScreen(id){const b=boards.get(id);if(captureState||!b)return;clearTimeout(b.stallTimer);b.stallTimer=null;b.stalled=false;setScreenStateCore(id,{state:'loading'});send({type:'retry',screen:id});}
  $('state-action').onclick=()=>transaction(retry);
  window.__dsCanvas = {
    setViewport:(...args)=>transaction(()=>setViewport(...args)),setScreens:list=>transaction(()=>setScreensCore(list)),setMode:mode=>transaction(()=>setModeCore(mode)),setActive:id=>transaction(()=>applyActive(id,false)),getActive:()=>active,getMode:()=>shellMode,
    setScreenState:(id,info)=>transaction(()=>setScreenStateCore(id,info)),fitAll:()=>transaction(()=>fitAll()),focusScreen:id=>transaction(()=>focusScreen(id)),zoomToScreen:id=>transaction(()=>focusScreen(id)),getScreens:()=>screens.map(s=>({id:s.id,url:s.url,width:s.width,height:s.height,title:s.title,state:s.state,message:s.message,src:s.src,x:s.x,y:s.y})),
    setLayout:info=>transaction(()=>setLayout(info)),getFitBounds,setStatus:info=>transaction(()=>setStatus(info)),setPage:info=>transaction(()=>setPage(info)),beginCapture,normalizeCapture,endCapture:token=>transaction(()=>endCapture(token)),zoomCamera:info=>transaction(()=>zoomCamera(info)),
    // SPEC-V4 §3 service→shell surface (all boolean-returning).
    setNotice:info=>transaction(()=>setNoticeCore(info)),showToast:info=>transaction(()=>showToastCore(info)),
    setAgentStatus:info=>transaction(()=>setAgentStatusCore(info)),setAgentInput:on=>transaction(()=>setAgentInputCore(on)),
    revealScreen:id=>transaction(()=>revealScreenCore(id)),
    setSelection:info=>transaction(()=>setSelectionCore(info)),
    getCamera:()=>({mode:view.mode,scale:view.scale,panX:view.panX,panY:view.panY,width:screens.find(s=>s.id===active)?.width??view.width,height:screens.find(s=>s.id===active)?.height??view.height,preset:view.preset,layoutMode:view.layoutMode,nominalHeight:view.nominalHeight,reason:view.reason,gridWidth:view.width,gridHeight:view.height}),
    // width/height round-trip the ACTIVE screen size (like the old single frame);
    // the grid extent is derived from the screens list and never restored.
    restoreCamera:state=>transaction(()=>{if(captureState||!state||!['fit','manual','fit-all'].includes(state.mode)||![state.scale,state.panX,state.panY].every(finite)||state.scale<=0)return false;
      // Applying service-originated camera state must not echo back as user
      // churn: suppress the debounce during application and stamp the applied
      // values as the last-sent baseline so later paints only emit real changes.
      applyingCamera=true;clearTimeout(cameraTimer);cameraTimer=null;
      try{
        if(state.layoutMode!==undefined&&!setLayout({mode:state.layoutMode,preset:state.preset,width:state.width,height:state.height,nominalHeight:state.nominalHeight,reason:state.reason||''}))return false;
        view.mode=state.mode;view.scale=Math.min(3,Math.max(.05,state.scale));view.panX=state.panX;view.panY=state.panY;paint();return true;
      }finally{
        applyingCamera=false;
        lastCameraSent={mode:view.mode,scale:view.scale,panX:view.panX,panY:view.panY};
      }
    }),
    dismissMenu:()=>closeMenu(),
    handleCanvasInput:event=>{if(!event||view.agentInput||view.layoutMode==='fit'||(!view.pan&&view.layoutMode!=='page')||event.type!=='wheel')return false;return wheelInput(event.deltaX,event.deltaY,event.x,event.y,Boolean(event.zoom));}
  };
  window.__dsToolbarBridge = {
    getSnapshot:()=>snapshot,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    selectPage:id=>transaction(()=>{if(!view.ready||captureState||!pages.some(p=>p.id===id))return;closeMenu();send({type: 'page',id,screen:active});}),
    zoomTo:value=>transaction(()=>{if(!view.ready||captureState||view.layoutMode==='fit')return;zoomTo(value);closeMenu();}),
    zoomCamera:info=>transaction(()=>zoomCamera(info)),togglePan:()=>transaction(()=>setPan(!view.pan)),
    panBy:direction=>transaction(()=>{if(!view.ready||captureState||view.layoutMode==='fit'||!['left','right','up','down'].includes(direction))return;moveCamera(direction);announce('Canvas moved '+direction+'.');closeMenu();}),
    retry:()=>transaction(retry),setMenu:id=>{if(captureState||!(id===null||id==='page'||id==='zoom')||(id!==null&&!view.ready))return;if(openMenu===id)return;openMenu=id;publish();},
    // V4-15: the toolbar requests, the service confirms. The requested segment
    // stays pending for up to 1500 ms; a refusal falls back with a warn toast.
    setMode:id=>transaction(()=>{
      if(captureState||!['edit','play'].includes(id)||id===shellMode||modePending)return;
      modePending=id;send({type:'mode-request',mode:id});
      clearTimeout(modeTimer);
      modeTimer=setTimeout(()=>{
        modeTimer=null;
        if(modePending===id&&shellMode!==id){modePending=null;showToastCore({kind:'warn',text:'Mode change refused'});publish();}
      },MODE_PENDING_MS);
    }),
    activateScreen:id=>transaction(()=>applyActive(id,true)),
    fitAll:()=>transaction(()=>{fitAll();}),
    focusScreen:id=>transaction(()=>focusScreen(id)),
    referenceSelection:()=>transaction(()=>{referenceSelection();}),
    clearSelection:()=>transaction(()=>{clearSelection();})
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
