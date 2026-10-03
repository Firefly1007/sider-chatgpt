import { EventEmitter } from 'node:events';

// No Playwright auto-attachment: each target debugger is explicitly released.
export async function rawCDP(url) {
  const socket=new WebSocket(url),events=new EventEmitter(),pending=new Map(),attached=new Set();
  let sequence=0;
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id){const call=pending.get(message.id);if(call){pending.delete(message.id);clearTimeout(call.timer);message.error?call.reject(new Error(message.error.message)):call.resolve(message.result);}}
    else {
      if(message.method==='Target.detachedFromTarget')attached.delete(message.params.sessionId);
      events.emit(message.method,message.params);
    }
  });
  async function send(method,params={}) {
    const id=++sequence;
    const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP ${method} timed out`));},12000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
    if(method==='Target.attachToTarget')attached.add(result.sessionId);
    if(method==='Target.detachFromTarget')attached.delete(params.sessionId);
    return result;
  }
  return {
    send,on:(...args)=>events.on(...args),detach:async()=>{},
    async detachTargets(){for(const sessionId of [...attached])await send('Target.detachFromTarget',{sessionId});},
    async evaluate(targetId,expression){
      const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:false});const rpcId=++sequence;
      const result=await new Promise((resolve,reject)=>{
        const handler=message=>{if(message.sessionId!==sessionId)return;const value=JSON.parse(message.message);if(value.id!==rpcId)return;clearTimeout(timer);events.off('Target.receivedMessageFromTarget',handler);value.error?reject(new Error(value.error.message)):resolve(value.result);};
        const timer=setTimeout(()=>{events.off('Target.receivedMessageFromTarget',handler);reject(new Error('Target evaluation timed out'));},12000);
        events.on('Target.receivedMessageFromTarget',handler);
        send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:rpcId,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})}).catch(reject);
      });
      await send('Target.detachFromTarget',{sessionId});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
      return result.result.value;
    },
    close(){for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error('CDP closed'));}pending.clear();socket.close();},
  };
}
