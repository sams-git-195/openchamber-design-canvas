export type CdpTransport = {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
  on(method: string, handler: (params: Record<string, unknown>, sessionId?: string) => void): () => void;
};
export type DefaultContext = { session: string; frame: string; id: number; unique?: string; origin: string };
export type ShellAuthority = { context: DefaultContext; revision: number };
type FrameTree = { frame?: { id?: string; loaderId?: string }; childFrames?: FrameTree[] };

// Spec §A/§D: an artboard frame is identified by the static markup attribute
// `data-ds-screen=<id>` on its iframe; ids follow the screens.json schema.
const SCREEN_ID = /^[a-z0-9][a-z0-9-]{0,30}$/;

/** Numeric IDs are session-local; frame ownership, not URL/name, selects worlds. */
export class ArtifactContexts {
  shellFrame: string | null = null;
  /**
   * The canvas' active screen id, mirrored in by the Browser (spec §D). Only
   * the service maps frameId→screenId: a cross-origin frame cannot read its
   * own frameElement, so the DOM attribute is the single source of truth and
   * `artifact(id?)`'s "or active" default resolves service-side.
   */
  activeScreenId: string | null = null;
  private contexts = new Map<string, DefaultContext>();
  private childSessions = new Map<string, string>();
  /** screenId → frameId, rebuilt by every `discover()` pass. */
  private screenFrames = new Map<string, string>();
  /** session:contextId keys whose context has been armed (trust flag +
   *  script re-run) since creation; destroyed/cleared contexts drop out, so
   *  a fresh document is always re-armed while a stable grid is not poked. */
  private armed = new Set<string>();
  private loaders = new Map<string,string>();
  private loaderVersions = new Map<string,number>();
  private sameDocumentVersions = new Map<string,number>();
  private discovering: Promise<void> | null = null;
  private active = true;
  private shellRevision = 0;
  private shellUrl = '';
  private trustedShellUrl: string;
  private trustedShellOrigin: string;
  private cdp: CdpTransport;
  readonly shellSession: string;
  private scripts: string;
  private changed: () => void;
  constructor(cdp: CdpTransport, shellSession: string, scripts: string, changed: () => void, trustedShellUrl: string) {
    this.cdp=cdp;this.shellSession=shellSession;this.scripts=scripts;this.changed=changed;
    this.trustedShellUrl=new URL(trustedShellUrl).href;this.trustedShellOrigin=new URL(trustedShellUrl).origin;
    cdp.on('Runtime.executionContextCreated', (params, session) => {
      const context = params.context as { id?: number; uniqueId?: string; origin?: string; auxData?: { isDefault?: boolean; frameId?: string } } | undefined;
      if (!session || !context?.auxData?.isDefault || !context.auxData.frameId || typeof context.id !== 'number') return;
      if(session===shellSession&&context.auxData.frameId===this.shellFrame)this.shellRevision++;
      this.contexts.set(session + ':' + context.id, { session, frame: context.auxData.frameId, id: context.id, unique: context.uniqueId, origin:context.origin??'' });
      void this.discover().then(() => this.initializeArtifact()).catch(() => undefined);
    });
    cdp.on('Runtime.executionContextDestroyed', (params, session) => {
      if(this.contexts.get(session+':'+params.executionContextId)?.frame===this.shellFrame)this.shellRevision++;
      this.contexts.delete(session + ':' + params.executionContextId); this.armed.delete(session + ':' + params.executionContextId); this.changed();
    });
    cdp.on('Runtime.executionContextsCleared', (_params, session) => {
      if(session===shellSession)this.shellRevision++;
      for (const [key, context] of this.contexts) if (context.session === session) this.contexts.delete(key);
      for (const key of this.armed) if (key.startsWith(session + ':')) this.armed.delete(key);
      this.changed();
    });
    cdp.on('Page.frameNavigated', (params, session) => {
      const frame=params.frame as {id?:string;parentId?:string;url?:string;loaderId?:string}|undefined;
      if(session===shellSession&&frame&&!frame.parentId){
        this.shellRevision++;this.shellUrl='';this.screenFrames.clear();this.armed.clear();
      }
      if (session === shellSession || this.childSessions.has(session ?? '')) {
        if(frame?.id&&frame.loaderId){
          this.loaders.set(frame.id,frame.loaderId);
          this.loaderVersions.set(frame.id,(this.loaderVersions.get(frame.id)??0)+1);
        }
        void this.discover().then(() => this.initializeArtifact()).catch(() => undefined); this.changed();
      }
    });
    cdp.on('Page.navigatedWithinDocument',(params,session)=>{
      if((session===shellSession||this.childSessions.has(session??''))&&typeof params.frameId==='string'){
        this.sameDocumentVersions.set(params.frameId,(this.sameDocumentVersions.get(params.frameId)??0)+1);this.changed();
      }
    });
    cdp.on('Page.frameAttached', () => { void this.discover().then(() => this.initializeArtifact()).catch(() => undefined); });
    cdp.on('Page.frameDetached', (params) => {
      if(params.frameId===this.shellFrame){this.shellRevision++;this.shellUrl='';this.screenFrames.clear();}
      // A detached artboard stops being trusted immediately; the next discover()
      // rebuilds the full screenId→frameId map from the live DOM.
      for (const [screen, frame] of this.screenFrames) if (frame === params.frameId) this.screenFrames.delete(screen);
      this.changed();
    });
    cdp.on('Target.attachedToTarget', (params) => {
      const info = params.targetInfo as { type?: string; targetId?: string } | undefined;
      if (info?.type !== 'iframe' || typeof params.sessionId !== 'string') return;
      this.childSessions.set(params.sessionId, info.targetId ?? '');
      void this.enable(params.sessionId).then(() => this.discover()).then(() => this.initializeArtifact()).catch(() => undefined);
    });
    cdp.on('Target.detachedFromTarget', (params) => {
      if(params.sessionId===shellSession){this.shellRevision++;this.shellUrl='';this.screenFrames.clear();this.armed.clear();}
      this.childSessions.delete(String(params.sessionId));
      for (const [key, context] of this.contexts) if (context.session === params.sessionId) this.contexts.delete(key);
      for (const key of this.armed) if (key.startsWith(params.sessionId + ':')) this.armed.delete(key);
      this.changed();
    });
  }
  async enable(session: string): Promise<void> {
    await this.cdp.send('Page.enable', {}, session);
    // Bindings must exist before any new-document script calls them.
    for (const name of ['__dsPick', '__dsArtifactEvent', '__dsCanvasSend', '__dsShellState']) await this.cdp.send('Runtime.addBinding', { name }, session);
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: this.scripts }, session);
    await this.cdp.send('Runtime.enable', {}, session);
    await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, session);
  }
  async discover(): Promise<void> {
    if (!this.active) return;
    if (this.discovering) return this.discovering;
    this.discovering = (async () => {
      const revision=this.shellRevision;
      const result = await this.cdp.send('Page.getFrameTree', {}, this.shellSession);
      const tree = result.frameTree as { frame?: { id?: string; url?: string }; childFrames?: Array<{ frame?: { id?: string } }> } | undefined;
      if (!tree?.frame?.id) return;
      if(!this.active||revision!==this.shellRevision)return;
      this.shellUrl=tree.frame.url??'';
      if(this.shellUrl!==this.trustedShellUrl||(this.shellFrame!==null&&this.shellFrame!==tree.frame.id)){this.shellUrl='';this.screenFrames.clear();return;}
      this.shellFrame = tree.frame.id;
      const candidates = new Set((tree.childFrames ?? []).map((child) => child.frame?.id).filter((id): id is string => !!id));
      // An OOPIF can be absent from getFrameTree until its session is enabled.
      for (const frame of this.childSessions.values()) if (frame) candidates.add(frame);
      // Spec §D: collect EVERY child frame whose owner element carries
      // data-ds-screen (the v1 loop returned on the first id==='preview'
      // match; the artboards are static markup, so the attribute is the gate).
      const found = new Map<string, string>();
      for (const frame of candidates) {
        try {
          const owner = await this.cdp.send('DOM.getFrameOwner', { frameId: frame }, this.shellSession);
          const result = await this.cdp.send('DOM.describeNode', { backendNodeId: owner.backendNodeId }, this.shellSession);
          const node = result.node as { attributes?: string[]; nodeName?: string } | undefined;
          const attrs = node?.attributes ?? [];
          if (node?.nodeName !== 'IFRAME') continue;
          for (let index = 0; index + 1 < attrs.length; index += 2) {
            if (attrs[index] !== 'data-ds-screen') continue;
            const screen = attrs[index + 1] ?? '';
            if (SCREEN_ID.test(screen) && !found.has(screen)) found.set(screen, frame);
            break;
          }
        } catch { /* nested/sibling targets have no owner in the shell */ }
      }
      if(this.active&&revision===this.shellRevision)this.screenFrames=found;
    })().finally(() => { this.discovering = null; });
    return this.discovering;
  }
  shell(): DefaultContext | null {
    if(!this.active||this.discovering||this.shellUrl!==this.trustedShellUrl)return null;
    const context=this.find(this.shellSession,this.shellFrame);
    return context?.origin===this.trustedShellOrigin?context:null;
  }
  captureShellAuthority(session:string|undefined,id:unknown):ShellAuthority|null{
    const context=this.shell();return this.matches(context,session,id)?{context:context!,revision:this.shellRevision}:null;
  }
  shellAuthorityCurrent(authority:ShellAuthority):boolean{
    return this.active&&authority.revision===this.shellRevision&&this.shell()===authority.context;
  }
  /** Every artboard screen → its current default execution context (may be an
   *  OOPIF session). Screens whose frame has no live default context are
   *  absent, so callers can treat a missing key as "frame not ready". */
  artifacts(): Map<string, DefaultContext> {
    const out = new Map<string, DefaultContext>();
    for (const [screen, frame] of this.screenFrames) {
      const context = [...this.contexts.values()].find((context) => context.frame === frame &&
        (context.session === this.shellSession || this.childSessions.get(context.session) === frame));
      if (context) out.set(screen, context);
    }
    return out;
  }
  /** Named-or-active artboard context (spec §D `artifact(id?)`). */
  artifact(id?: string): DefaultContext | null {
    const screen = id ?? this.activeScreenId;
    if (!screen) return null;
    return this.artifacts().get(screen) ?? null;
  }
  /** The generalized bindingCalled authority (spec §D): an
   *  executionContextId→screenId resolution. Picks and events count from ANY
   *  trusted artboard context, and the answer names their screen. */
  screenForContext(session: string | undefined, id: unknown): string | null {
    if (!this.active || session === undefined) return null;
    const context = this.contexts.get(session + ':' + String(id));
    if (!context) return null;
    for (const [screen, candidate] of this.artifacts()) if (candidate === context) return screen;
    return null;
  }
  artifactLoaderId(id?:string):string|null{const context=this.artifact(id);return context?this.loaders.get(context.frame)??null:null;}
  artifactSameDocumentVersion(id?:string):number{const context=this.artifact(id);return context?this.sameDocumentVersions.get(context.frame)??0:0;}
  private find(session: string, frame: string | null): DefaultContext | null {
    return [...this.contexts.values()].find((context) => context.session === session && context.frame === frame) ?? null;
  }
  matches(context: DefaultContext | null, session: string | undefined, id: unknown): boolean {
    return this.active && !!context && context.session === session && context.id === id && this.contexts.get(session + ':' + id)===context;
  }
  async evaluate(context: DefaultContext, expression: string, awaitPromise = false): Promise<unknown> {
    if(!this.matches(context,context.session,context.id))throw new Error('execution context authority was revoked');
    const result = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise,
      ...(context.unique ? { uniqueContextId: context.unique } : { contextId: context.id }) }, context.session);
    if (result.exceptionDetails) throw new Error('artifact evaluation failed: ' + JSON.stringify(result.exceptionDetails));
    return (result.result as { value?: unknown } | undefined)?.value;
  }
  async initializeArtifact(): Promise<void> {
    // Seed + arm EVERY artboard (v1 armed only the single preview frame). The
    // payload scripts are idempotent; the armed set skips contexts that
    // already received the trust flag, so a busy event stream does not poke a
    // stable grid. A frame mid-navigation loses its arm attempt and is
    // re-armed by the next discovery pass.
    for (const [screen, context] of this.artifacts()) {
      if (!this.active) break;
      const key = context.session + ':' + context.id;
      try {
        await this.seedArtifactLoader(screen, context);
        if (this.artifact(screen) === context && !this.armed.has(key)) {
          await this.evaluate(context, 'window.__dsTrustedArtifact=true;'+this.scripts);
          if (this.artifact(screen) === context) this.armed.add(key);
          // FIX-3 (F5): arming the script is only HALF the arm — the script's
          // send path needs the frame's `__dsPick` BINDING, and on Windows the
          // addBinding→context propagation can lag (or silently miss) a
          // context that already existed when the binding was issued. Verify
          // the binding actually landed in THIS context right after arming;
          // the re-arm below is the recovery (its script re-run flushes the
          // in-frame __dsPickPending buffer, so queued clicks are delivered).
          if (this.artifact(screen) === context) await this.verifyArtifactBinding(screen, context);
        }
      } catch { /* world destroyed mid-arm; a later event rediscovers the frame */ }
    }
    this.changed();
  }
  /**
   * FIX-3 (F5 root fix): verify the artifact bindings reached one armed
   * context and re-arm when they did not. `Runtime.addBinding` responses can
   * land BEFORE the binding itself propagates into a pre-existing execution
   * context (the same Windows lag this repo documents above SHELL_BRIDGE); the
   * in-frame picker then buffers every click into `__dsPickPending` forever —
   * the silent per-session pick-loss class (Sonnet re-verify F5: ~12% of fresh
   * sessions had `typeof window.__dsPick === 'undefined'` with buffered picks).
   * Recovery: re-issue the two artifact bindings on the context's OWN session
   * (idempotent, and re-adding forces propagation into the existing context —
   * FIX-1's proven shell-side mechanism) and re-run the payload scripts, whose
   * idempotent guards make the re-run a pure `flushPending()`. Returns true
   * when a re-arm was performed. Deliberately NOT a replay of dropped
   * bindingCalled messages (FIX-1's rationale stands): re-arming the frame IS
   * the replay — the buffer lives in the frame and flushes itself.
   */
  async verifyArtifactBinding(screen: string, context: DefaultContext): Promise<boolean> {
    if (!this.active || !this.matches(context, context.session, context.id)) return false;
    let kind: unknown;
    try {
      kind = await this.evaluate(context, 'typeof window.__dsPick');
    } catch {
      return false; // world died mid-check; the next frame/context event re-arms
    }
    if (kind === 'function') return false;
    try {
      for (const name of ['__dsPick', '__dsArtifactEvent']) {
        await this.cdp.send('Runtime.addBinding', { name }, context.session);
      }
      if (!this.active || !this.matches(context, context.session, context.id)) return false;
      await this.evaluate(context, 'window.__dsTrustedArtifact=true;'+this.scripts);
      this.armed.add(context.session + ':' + context.id);
      console.log(`[design-canvas] artifact binding re-armed for "${screen}" (in-frame __dsPick was ${typeof kind === 'string' ? kind : 'unreachable'}; buffered picks flushed)`);
      return true;
    } catch {
      return false; // context swapped mid-recovery; the sweep/event path retries
    }
  }
  /**
   * FIX-3: one arming sweep over every known artifact context — the cheap
   * periodic self-heal for late propagation races the per-arm verification
   * could not see (a binding that lands, then a context created after it that
   * missed the script re-run). Called by the Browser's unref'd sweep timer.
   */
  async verifyArtifactBindings(): Promise<void> {
    if (!this.active) return;
    for (const [screen, context] of this.artifacts()) {
      if (!this.active) break;
      await this.verifyArtifactBinding(screen, context).catch(() => undefined);
    }
  }
  /** A new OOPIF may commit before Page.enable can report frameNavigated. */
  private async seedArtifactLoader(screen:string,context:DefaultContext):Promise<void>{
    const revision=this.shellRevision,version=this.loaderVersions.get(context.frame)??0;
    const result=await this.cdp.send('Page.getFrameTree',{},context.session);
    if(!this.active||revision!==this.shellRevision||this.shellUrl!==this.trustedShellUrl||
      this.screenFrames.get(screen)!==context.frame||this.artifact(screen)!==context||
      !this.matches(context,context.session,context.id)||
      version!==(this.loaderVersions.get(context.frame)??0))return;
    const tree=result.frameTree as FrameTree|undefined;
    let frame:FrameTree['frame'];
    if(context.session===this.shellSession){
      if(tree?.frame?.id!==this.shellFrame)return;
      const find=(node:FrameTree|undefined):FrameTree['frame']=>{
        if(node?.frame?.id===context.frame)return node.frame;
        for(const child of node?.childFrames??[]){const found=find(child);if(found)return found;}
        return undefined;
      };
      frame=find(tree);
    }else{
      // The child session must own this exact frame as its root, not a nested
      // same-URL/name descendant or another attached target.
      if(this.childSessions.get(context.session)!==context.frame||tree?.frame?.id!==context.frame)return;
      frame=tree.frame;
    }
    if(typeof frame?.loaderId==='string'&&frame.loaderId)this.loaders.set(context.frame,frame.loaderId);
  }
  close(): void { this.active = false; this.shellRevision++;this.shellUrl='';this.contexts.clear(); this.childSessions.clear(); this.screenFrames.clear(); }
}
