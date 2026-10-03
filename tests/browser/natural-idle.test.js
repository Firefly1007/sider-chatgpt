import { chromium } from 'playwright';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn,execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { hiddenTargets } from './hidden-target.mjs';
import { rawCDP } from './raw-cdp.mjs';

const outputRoot=path.resolve('.test-output');
const extensionDist=path.resolve(process.env.CGP_IDLE_DIST||'dist');
const executablePath=(process.env.CGP_CHROMIUM_PATH || chromium.executablePath());
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,message,timeout=12000){const start=Date.now();while(Date.now()-start<timeout){const result=await check();if(result)return result;await pause(50);}throw new Error(message);}

test('native wait and completed floating session survive natural MV3 idle with every target debugger detached', {timeout:300000},async()=>{
  const profile=path.join(outputRoot,`natural-idle-${process.pid}-${Date.now()}`);
  await mkdir(profile,{recursive:true});
  // Reuse the deny-proxy/neutral fixture; importing its module would run its tests.
  const source=await readFile('tests/browser/extension.test.js','utf8');
  const fixture=source.slice(source.indexOf('const sourceHTML ='),source.indexOf('async function until('));
  const proxyCode=source.slice(source.indexOf('async function offlineProxy()'),source.indexOf("test('isolated real MV3"));
  const helpers=runInNewContext(`${fixture}\nchatHTML=temporary=>(${/function chatHTML\(temporary\) \{[\s\S]*?\n\}/.exec(fixture)[0].replace('function chatHTML','function originalChatHTML')})(temporary).replace('window.fixtureHold=false;', 'window.fixtureHold=true;').replace('window.fixtureSends++;const user', 'setTimeout(()=>window.finishFixture(),55000);window.fixtureSends++;const user');\n${proxyCode}\n({offlineProxy})`,{URL,http,https,net,execFileSync,Promise});
  let proxy,processHandle,cdp,hidden;
  const report={scope:'network-blocked neutral fixture; raw CDP, no Playwright or stopWorker',events:[],observations:[]};
  const reportPath=path.join(outputRoot,'natural-idle.json');
  try {
    proxy=await helpers.offlineProxy();
    processHandle=spawn(executablePath,[`--user-data-dir=${profile}`,'--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--disable-extensions-except=${extensionDist}`,`--load-extension=${extensionDist}`,`--proxy-server=http://127.0.0.1:${proxy.port}`,'--proxy-bypass-list=<-loopback>','--ignore-certificate-errors','--disable-quic','about:blank'],{stdio:'ignore',windowsHide:true});
    const active=await until(async()=>{try{return (await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/);}catch{return null;}},'Chrome CDP endpoint unavailable');
    cdp=await rawCDP(`ws://127.0.0.1:${active[0]}${active[1]}`);
    await cdp.send('Target.setDiscoverTargets',{discover:true});
    for(const name of ['Target.targetCreated','Target.targetDestroyed'])cdp.on(name,event=>report.events.push({at:Date.now(),type:name,...event}));
    const targets=async()=>(await cdp.send('Target.getTargets')).targetInfos;
    const manifest=JSON.parse(await readFile(path.join(extensionDist,'manifest.json'),'utf8'));
    const worker=await until(async()=>{for(const item of await targets())if(item.type==='service_worker'&&item.url.endsWith('/background.js')){try{if(await cdp.evaluate(item.targetId,'globalThis.chrome?.runtime?.getManifest().name')===manifest.name)return item;}catch{}}},'Startup worker missing');
    report.initialWorkerTarget=worker.targetId;
    const extensionId=new URL(worker.url).hostname;
    await until(()=>cdp.evaluate(worker.targetId,"!!globalThis.chrome?.runtime?.getManifest"),'Worker runtime not initialized');
    report.manifest=await cdp.evaluate(worker.targetId,"chrome.runtime.getManifest().version");
    report.workerEpoch=await cdp.evaluate(worker.targetId,"globalThis.fixtureIdleEpoch='epoch-'+Date.now()");
    hidden=await hiddenTargets({browser:()=>({newBrowserCDPSession:async()=>cdp})},extensionId);
    const unused=await until(async()=>{for(const frame of await hidden.frames())if(frame.ready&&await frame.evaluate(()=>!!document.querySelector('#prompt-textarea')))return frame;},'Unused iframe missing');
    const {targetId:sourceId}=await cdp.send('Target.createTarget',{url:'http://example.test/article'});
    await until(()=>cdp.evaluate(sourceId,"!!document.querySelector('#cgp-selection-root')"),'Source content script missing');
    await cdp.evaluate(sourceId,`(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#selection'));getSelection().removeAllRanges();getSelection().addRange(range);document.querySelector('#selection').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));})()`);
    await until(()=>cdp.evaluate(sourceId,"!!document.querySelector('#cgp-selection-root').shadowRoot.querySelector('[data-action=search]')"),'Selection toolbar missing');
    await cdp.evaluate(sourceId,"document.querySelector('#cgp-selection-root').shadowRoot.querySelector('[data-action=search]').click()");
    await until(()=>unused.evaluate(()=>window.fixtureSends===1&&!!document.querySelector('[data-testid=stop-button]')),'Held native generation missing');
    report.claimedToken=unused.token;
    report.claimedTargetId=unused.targetId;
    report.initialNative=await unused.evaluate(()=>({sends:window.fixtureSends,busy:!!document.querySelector('[data-testid=stop-button]'),url:location.href}));
    const readSource="(()=>{const root=document.querySelector('#cgp-selection-root').shadowRoot;return {state:root.querySelector('.cgp-state')?.textContent,result:root.querySelector('.cgp-result')?.textContent,error:root.querySelector('.cgp-error')?.textContent};})()";
    report.initialSource=await cdp.evaluate(sourceId,readSource);
    await cdp.detachTargets();
    report.detachedAt=Date.now();
    report.detachedTargets=(await targets()).filter(item=>item.url.startsWith(`chrome-extension://${extensionId}/`)||item.url.startsWith('https://chatgpt.com/')||item.targetId===sourceId).map(({targetId,type,url,attached})=>({targetId,type,url,attached}));
    assert.ok(report.detachedTargets.length>=4);assert.ok(report.detachedTargets.every(item=>item.attached===false),'Every worker, offscreen, iframe and source debugger must detach');
    console.log(`NATURAL IDLE WAIT ${report.manifest}; all ${report.detachedTargets.length} target debuggers detached for 65s`);
    // Browser-level discovery only. No target evaluations, runtime messages,
    // debugger sessions or synthetic stop/restart during this entire interval.
    await pause(65000);
    report.waitEndedAt=Date.now();
    report.afterTargets=(await targets()).map(({targetId,type,url,attached})=>({targetId,type,url,attached}));
    report.afterSource=await cdp.evaluate(sourceId,readSource);
    const afterWorker=(await targets()).find(item=>item.type==='service_worker'&&item.url===worker.url);
    report.afterWorker=afterWorker?{targetId:afterWorker.targetId,epoch:await cdp.evaluate(afterWorker.targetId,'globalThis.fixtureIdleEpoch')}:null;
    report.naturalWorkerDestruction=report.events.some(item=>item.type==='Target.targetDestroyed'&&item.targetId===worker.targetId&&item.at>=report.detachedAt);
    await writeFile(reportPath,JSON.stringify(report,null,2));
    console.log(`NATURAL IDLE EVIDENCE ${reportPath}; worker naturally stopped=${report.naturalWorkerDestruction}; source state=${report.afterSource.state}`);
    assert.equal(report.initialNative.sends,1);
    assert.ok(report.waitEndedAt-report.detachedAt>=65000);
    assert.match(report.afterSource.result||'',/Offline answer 1/,'Native completion must survive debugger-free waiting beyond MV3 idle timeout');
    assert.equal(report.naturalWorkerDestruction,false,'Claimed frame must preserve coordination throughout native wait');
    assert.equal(report.afterWorker.targetId,worker.targetId);assert.equal(report.afterWorker.epoch,report.workerEpoch);
    assert.doesNotMatch(report.afterSource.error||'',/WORKER_RESTARTED|background restarted|重新启动|后台已重启/);

    const claimed=await until(async()=>{const frames=await hidden.frames();return frames.find(frame=>frame.token===report.claimedToken&&frame.ready);},'Claimed iframe disappeared before the completed-session idle wait');
    report.completedBeforeIdle=await claimed.evaluate(()=>({sends:window.fixtureSends,busy:!!document.querySelector('[data-testid="stop-button"]'),answer:document.querySelector('#messages article:last-child .markdown')?.textContent||''}));
    assert.equal(report.completedBeforeIdle.sends,1);assert.equal(report.completedBeforeIdle.busy,false);
    assert.match(report.completedBeforeIdle.answer,/Offline answer 1/);
    report.completedSourceBeforeIdle=await cdp.evaluate(sourceId,readSource);
    assert.match(report.completedSourceBeforeIdle.result||'',/Offline answer 1/);
    assert.equal(report.completedSourceBeforeIdle.error,'');
    assert.equal(claimed.targetId,report.claimedTargetId);
    await cdp.detachTargets();report.completedDetachedAt=Date.now();
    report.completedDetachedTargets=(await targets()).filter(item=>item.url.startsWith(`chrome-extension://${extensionId}/`)||item.url.startsWith('https://chatgpt.com/')||item.targetId===sourceId).map(({targetId,type,url,attached})=>({targetId,type,url,attached}));
    assert.ok(report.completedDetachedTargets.length>=4);assert.ok(report.completedDetachedTargets.every(item=>item.attached===false),'Every target debugger must detach while the completed floating session remains open');
    console.log(`COMPLETED SESSION IDLE WAIT: floating session stays open; all ${report.completedDetachedTargets.length} target debuggers detached for 65s`);
    // Keep the floating session and claimed native iframe open. During this
    // interval only browser-level Target discovery runs; no target evaluation,
    // runtime probe, debugger session, or synthetic worker keepalive is used.
    await pause(65000);report.completedWaitEndedAt=Date.now();
    report.completedAfterTargets=(await targets()).map(({targetId,type,url,attached})=>({targetId,type,url,attached}));
    report.completedAfterSource=await cdp.evaluate(sourceId,readSource);
    const completedFrame=await until(async()=>{const frames=await hidden.frames();return frames.find(frame=>frame.token===report.claimedToken&&frame.ready);},'Original claimed iframe missing after completed-session idle wait');
    report.completedAfterNative=await completedFrame.evaluate(()=>({sends:window.fixtureSends,busy:!!document.querySelector('[data-testid="stop-button"]'),answer:document.querySelector('#messages article:last-child .markdown')?.textContent||''}));
    const completedWorker=(await targets()).find(item=>item.type==='service_worker'&&item.url===worker.url);
    report.completedAfterWorker=completedWorker?{targetId:completedWorker.targetId,epoch:await cdp.evaluate(completedWorker.targetId,'globalThis.fixtureIdleEpoch')}:null;
    report.completedWorkerDestruction=report.events.some(item=>item.type==='Target.targetDestroyed'&&item.targetId===worker.targetId&&item.at>=report.completedDetachedAt&&item.at<=report.completedWaitEndedAt);
    assert.ok(report.completedWaitEndedAt-report.completedDetachedAt>=65000);
    assert.equal(report.completedWorkerDestruction,false,'Worker must remain alive while completed floating session stays open');
    assert.equal(report.completedAfterWorker.targetId,worker.targetId);assert.equal(report.completedAfterWorker.epoch,report.workerEpoch);
    assert.match(report.completedAfterSource.result||'',/Offline answer 1/,'Completed answer must remain visible after a debugger-free idle interval');
    assert.equal(report.completedAfterSource.error,'','Completed floating session must remain error-free');
    assert.equal(report.completedAfterNative.sends,1);assert.equal(report.completedAfterNative.busy,false);
    assert.match(report.completedAfterNative.answer,/Offline answer 1/);
    assert.equal(completedFrame.token,report.claimedToken);assert.equal(completedFrame.targetId,report.claimedTargetId,'Completed session must retain the original native iframe target');
    await writeFile(reportPath,JSON.stringify(report,null,2));
    console.log(`COMPLETED SESSION IDLE EVIDENCE ${reportPath}; same worker epoch, iframe token, and first answer preserved`);

    await cdp.evaluate(sourceId,`(()=>{const root=document.querySelector('#cgp-selection-root').shadowRoot;const question=root.querySelector('textarea[aria-label="问题或追问"]');question.value='Follow up offline';root.querySelector('.cgp-send').click();})()`);
    await until(async()=>{const frames=await hidden.frames();const frame=frames.find(item=>item.token===report.claimedToken&&item.ready);if(!frame)return false;return (await frame.evaluate(()=>({sends:window.fixtureSends,busy:!!document.querySelector('[data-testid="stop-button"]')}))).sends===2?frame:false;},'Follow-up did not send through the original claimed iframe');
    await completedFrame.evaluate(()=>window.finishFixture());
    await until(async()=>{const state=await cdp.evaluate(sourceId,readSource);return state.state==='完成'&&(state.result||'').includes('Offline answer 2')?state:false;},'Follow-up answer did not complete in the floating session');
    const followUpFrames=await hidden.frames();const followUpFrame=followUpFrames.find(frame=>frame.token===report.claimedToken&&frame.ready);
    report.followUpToken=followUpFrame?.token||null;report.followUpTargetId=followUpFrame?.targetId||null;
    report.followUpSource=await cdp.evaluate(sourceId,readSource);
    report.followUpNative=followUpFrame?await followUpFrame.evaluate(()=>({sends:window.fixtureSends,busy:!!document.querySelector('[data-testid="stop-button"]'),answer:document.querySelector('#messages article:last-child .markdown')?.textContent||'',lastUser:[...document.querySelectorAll('[data-message-author-role="user"]')].at(-1)?.textContent||''})):null;
    assert.equal(report.followUpToken,report.claimedToken);assert.equal(report.followUpTargetId,report.claimedTargetId);
    assert.equal(report.followUpNative.sends,2);assert.equal(report.followUpNative.busy,false);
    assert.match(report.followUpNative.answer,/Offline answer 2/);assert.match(report.followUpNative.lastUser,/Follow up offline/);
    assert.match(report.followUpSource.result||'',/Offline answer 2/);assert.equal(report.followUpSource.error,'');
    await writeFile(reportPath,JSON.stringify(report,null,2));
    console.log(`FOLLOW-UP EVIDENCE ${reportPath}; second send completed on the original claimed iframe`);

    await cdp.evaluate(sourceId,"document.querySelector('#cgp-selection-root').shadowRoot.querySelector('[aria-label=关闭]').click()");
    const spare=await until(async()=>{const frames=await hidden.frames();if(frames.length!==1||!frames[0].ready)return null;const state=await frames[0].evaluate(()=>({sends:window.fixtureSends,ready:!!document.querySelector('#prompt-textarea')}));return state.ready&&state.sends===0?frames[0]:null;},'Close must leave exactly one unused zero-send iframe');
    report.onlyUnusedToken=spare.token;
    await cdp.detachTargets();report.closedDetachedAt=Date.now();
    report.closedDetachedTargets=(await targets()).filter(item=>item.url.startsWith(`chrome-extension://${extensionId}/`)||item.url.startsWith('https://chatgpt.com/')||item.targetId===sourceId).map(({targetId,type,url,attached})=>({targetId,type,url,attached}));
    assert.ok(report.closedDetachedTargets.every(item=>item.attached===false));
    console.log('NATURAL IDLE CLOSE WAIT: only unused remains, all target debuggers detached for 45s');
    await pause(45000);report.closeWaitEndedAt=Date.now();
    report.unusedWorkerDestruction=report.events.find(item=>item.type==='Target.targetDestroyed'&&item.targetId===worker.targetId&&item.at>=report.closedDetachedAt)||null;
    report.unusedAfterTargets=(await targets()).map(({targetId,type,url,attached})=>({targetId,type,url,attached}));
    assert.ok(report.unusedWorkerDestruction,'Unused frame alone must allow natural service worker suspension');
    assert.equal(report.unusedAfterTargets.some(item=>item.type==='service_worker'&&item.url===worker.url),false,'Unused frame must not reconnect and keep the worker awake');
    const remaining=await hidden.frames();assert.equal(remaining.length,1);assert.equal(remaining[0].token,report.onlyUnusedToken);assert.equal(await remaining[0].evaluate(()=>window.fixtureSends),0);
    await writeFile(reportPath,JSON.stringify(report,null,2));
    console.log(`NATURAL IDLE PASS: native completion preserved; after close worker slept naturally in ${report.unusedWorkerDestruction.at-report.closedDetachedAt}ms`);
  } finally {
    await writeFile(reportPath,JSON.stringify(report,null,2));
    cdp?.close();processHandle?.kill();await proxy?.close();
    if(processHandle)await pause(300);
    const relative=path.relative(outputRoot,path.resolve(profile));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
    await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:300});
  }
});
