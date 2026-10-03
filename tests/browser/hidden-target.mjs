// Finite fixture access via real browser CDP targets; no visible execution page.
export async function hiddenTargets(context, extensionId) {
  const browser = await context.browser().newBrowserCDPSession();
  const sessions = new Map(), pending = new Map(), identities = new Map();
  let sequence = 0;
  browser.on('Target.detachedFromTarget',({sessionId})=>{for(const [targetId,session]of sessions)if(session.id===sessionId)sessions.delete(targetId);});
  browser.on('Target.receivedMessageFromTarget', ({sessionId, message}) => {
    const value = JSON.parse(message), session = [...sessions.values()].find(item => item.id === sessionId);
    if (value.id) {
      const call = pending.get(`${sessionId}:${value.id}`);
      if (call) {pending.delete(`${sessionId}:${value.id}`);clearTimeout(call.timer);value.error?call.reject(new Error(value.error.message)):call.resolve(value.result);}
    } else if (session && value.method === 'Runtime.executionContextCreated') session.contexts.set(value.params.context.id,value.params.context);
    else if (session && value.method === 'Runtime.executionContextDestroyed') session.contexts.delete(value.params.executionContextId);
    else if (session && value.method === 'Runtime.executionContextsCleared') session.contexts.clear();
  });
  async function attach(targetId) {
    if (sessions.has(targetId)) return sessions.get(targetId);
    const {sessionId} = await browser.send('Target.attachToTarget',{targetId,flatten:false});
    const session={id:sessionId,contexts:new Map(),send(method,params={}) {
      const id=++sequence,key=`${sessionId}:${id}`;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(key);reject(new Error(`Hidden CDP ${method} timed out`));},12000);
        pending.set(key,{resolve,reject,timer});
        browser.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(error=>{clearTimeout(timer);pending.delete(key);reject(error);});
      });
    }};
    sessions.set(targetId,session);await session.send('Runtime.enable');return session;
  }
  async function evaluate(session, frameId, callback, argument) {
    const start=Date.now();
    while(Date.now()-start<5000) {
      const world=[...session.contexts.values()].find(item=>item.auxData?.isDefault && (!frameId || item.auxData.frameId===frameId));
      if(!world){await new Promise(resolve=>setTimeout(resolve,25));continue;}
      try {
        const result=await session.send('Runtime.evaluate',{contextId:world.id,expression:`(${callback.toString()})(${JSON.stringify(argument)??'undefined'})`,awaitPromise:true,returnByValue:true});
        if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      } catch(error) {if(!/Cannot find context|Execution context was destroyed/.test(error.message))throw error;session.contexts.delete(world.id);}
    }
    throw new Error(`Default hidden-frame world unavailable: ${frameId}`);
  }
  const targets=async()=>(await browser.send('Target.getTargets')).targetInfos;
  async function host() {
    const target=(await targets()).find(item=>item.url===`chrome-extension://${extensionId}/offscreen.html`);
    if(!target)return null;
    const session=await attach(target.targetId);const tree=await session.send('Page.getFrameTree');return {target,session,frameId:tree.frameTree.frame.id};
  }
  async function frames() {
    const owner=await host();if(!owner)return [];
    const records=await evaluate(owner.session,owner.frameId,()=>[...document.querySelectorAll('iframe')].map(item=>({token:item.dataset.cgpToken,src:item.src})));
    const tree=await owner.session.send('Page.getFrameTree');const ids=new Map();
    function visit(node) {try {const token=new URLSearchParams(new URL(node.frame.url).hash.slice(1)).get('cgp-frame');if(token)ids.set(token,node.frame.id);}catch{}for(const child of node.childFrames||[])visit(child);}
    visit(tree.frameTree);const all=await targets();
    return records.map(record=>{
      const previous=identities.get(record.token);
      const target=all.find(item=>item.targetId===previous?.targetId) || all.find(item=>item.type==='iframe' && item.url.startsWith('https://chatgpt.com/') && new URLSearchParams(new URL(item.url).hash.slice(1)).get('cgp-frame')===record.token);
      if(!target)return {...record,ready:false};
      const frameId=previous?.frameId||ids.get(record.token)||target.targetId;
      identities.set(record.token,{frameId,targetId:target.targetId});
      return {...record,frameId,targetId:target.targetId,ready:true,
        async evaluate(callback,argument) {return evaluate(await attach(target.targetId),frameId,callback,argument);},
        async isClosed() {return !(await frames()).some(item=>item.token===record.token);},
        async reload() {await this.evaluate(()=>location.reload());},
      };
    });
  }
  return {
    browser,frames,
    async describe() {const owner=await host();return {frames:(await frames()).map(({token,frameId,targetId,ready})=>({token,frameId,targetId,ready})),targets:await targets(),tree:owner?await owner.session.send('Page.getFrameTree'):null};},
    async hostState() {const owner=await host();return owner?evaluate(owner.session,owner.frameId,()=>({hidden:document.hidden,visibility:document.visibilityState,opener:window.opener,frames:document.querySelectorAll('iframe').length})):null;},
    async dispose() {for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error('Hidden fixture access disposed'));}pending.clear();await browser.detach();},
  };
}
