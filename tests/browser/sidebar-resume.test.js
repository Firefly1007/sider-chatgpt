import { chromium } from 'playwright';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { rawCDP } from './raw-cdp.mjs';

const outputRoot = path.resolve('.test-output/sidebar-resume');
const extensionDist = path.resolve(process.env.CGP_RESUME_DIST || 'dist');
const executablePath = (process.env.CGP_CHROMIUM_PATH || chromium.executablePath());
const phase = process.env.CGP_RESUME_PHASE || 'fixed';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const readAttachPageButton = (cdp, targetId) => cdp.evaluate(targetId, `(()=>{const button=document.querySelector('span[data-cgp-attach-page-host]')?.shadowRoot?.querySelector('button[data-cgp-attach-page]');return button?{disabled:button.disabled,title:button.title,ariaLabel:button.getAttribute('aria-label')}:null})()`);
const clickAttachPageButton = (cdp, targetId) => cdp.evaluate(targetId, `document.querySelector('span[data-cgp-attach-page-host]').shadowRoot.querySelector('button[data-cgp-attach-page]').click()`);

async function until(check, message, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await check();
    if (result) return result;
    await pause(50);
  }
  throw new Error(message);
}

async function withExtensionRuntimeContext(cdp, targetId, extensionId, callback) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  const contexts = [];
  const pending = new Map();
  let sequence = 0;
  let closed = false;
  const onMessage = event => {
    if (closed || event.sessionId !== sessionId) return;
    let message;
    try { message = JSON.parse(event.message); } catch { return; }
    if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context);
    const call = pending.get(message.id);
    if (call) {
      pending.delete(message.id);
      clearTimeout(call.timer);
      message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
    }
  };
  cdp.on('Target.receivedMessageFromTarget', onMessage);
  const send = (method, params = {}) => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Isolated-world CDP ${method} timed out`)); }, 12000);
      pending.set(id, { resolve, reject, timer });
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => {
        clearTimeout(timer); pending.delete(id); reject(error);
      });
    });
  };
  const evaluate = async (contextId, expression, returnByValue = true) => {
    const result = await send('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return returnByValue ? result.result.value : result.result;
  };
  try {
    await send('Runtime.enable');
    await pause(100);
    const context = contexts.find(item => item.name === 'Sider ChatGPT' && item.origin === `chrome-extension://${extensionId}`);
    if (!context) throw new Error(`Sider ChatGPT isolated world not found; contexts=${JSON.stringify(contexts.map(({ id, name, origin, auxData }) => ({ id, name, origin, isDefault: auxData?.isDefault })))}`);
    return await callback({ context, send, evaluate });
  } finally {
    closed = true;
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Isolated-world session closed')); }
    pending.clear();
    try { await cdp.send('Target.detachFromTarget', { sessionId }); } catch { }
  }
}

test(`sidebar recovers its existing native frame after a frozen page resumes (${phase})`, { timeout: 170000 }, async () => {
  await mkdir(outputRoot, { recursive: true });
  const profile = path.join(outputRoot, `profile-${phase}-${process.pid}-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  // Reuse extension.test.js's network-denied, native-shaped fixture without running that test module.
  const extensionTest = await readFile('tests/browser/extension.test.js', 'utf8');
  const fixtureCode = extensionTest.slice(extensionTest.indexOf('const sourceHTML ='), extensionTest.indexOf('async function until('));
  const proxyCode = extensionTest.slice(extensionTest.indexOf('async function offlineProxy()'), extensionTest.indexOf("test('isolated real MV3"));
  const fixture = runInNewContext(`${fixtureCode}\n${proxyCode}\n({ sourceHTML, chatHTML, offlineProxy })`, { URL, http, https, net, execFileSync, Promise });
  const manifest = JSON.parse(await readFile(path.join(extensionDist, 'manifest.json'), 'utf8'));
  const report = {
    phase,
    extensionDist,
    manifest: { name: manifest.name, version: manifest.version },
    causeInjection: 'Page.setWebLifecycleState(frozen) is applied to sidepanel.html; this tests an explicit CDP freeze, not Edge/Windows OS background throttling.',
    surface: 'sidepanel.html opened as an extension tab with its real ChatGPT iframe; not Chrome browser side-panel UI',
    browser: 'headless Chromium; no disable-background-timer-throttling switch',
    events: [],
    monitor: [],
  };
  const reportPath = path.resolve(process.env.CGP_RESUME_REPORT || path.join(outputRoot, `${phase}-evidence.json`));
  let proxy, browserProcess, cdp;
  let panelId, nativeTarget, isolatedDiagnosticsInstalled = false;
  try {
    proxy = await fixture.offlineProxy();
    browserProcess = spawn(executablePath, [
      `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', `--disable-extensions-except=${extensionDist}`, `--load-extension=${extensionDist}`,
      `--proxy-server=http://127.0.0.1:${proxy.port}`, '--proxy-bypass-list=<-loopback>', '--ignore-certificate-errors', '--disable-quic', 'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    const active = await until(async () => {
      try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/); }
      catch { return null; }
    }, 'Chrome CDP endpoint unavailable');
    cdp = await rawCDP(`ws://127.0.0.1:${active[0]}${active[1]}`);
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    for (const name of ['Target.targetCreated', 'Target.targetDestroyed']) cdp.on(name, event => report.events.push({ at: Date.now(), type: name, ...event }));
    const targets = async () => (await cdp.send('Target.getTargets')).targetInfos;
    const sendToTarget = async (targetId, method, params = {}) => {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
      const commandId = Math.floor(Math.random() * 0x7fffffff);
      try {
        // Wait for the browser to queue the page command, not the page response:
        // freezing a document can suspend the renderer before it returns that response.
        const queued = await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: commandId, method, params }) });
        await pause(100);
        return { queued: true, targetId, method, ...queued };
      } finally {
        await cdp.send('Target.detachFromTarget', { sessionId });
      }
    };
    const worker = await until(async () => {
      for (const item of await targets()) {
        if (item.type !== 'service_worker' || !item.url.endsWith('/background.js')) continue;
        try { if (await cdp.evaluate(item.targetId, 'chrome.runtime.getManifest().name') === manifest.name) return item; }
        catch { }
      }
      return null;
    }, 'Startup extension worker missing');
    const workerUrl = worker.url;
    report.extensionId = new URL(workerUrl).hostname;
    report.initialWorker = { targetId: worker.targetId, url: workerUrl, epoch: await cdp.evaluate(worker.targetId, `globalThis.__resumeWorkerEpoch='epoch-'+Date.now()`) };

    const { targetId: sourceId } = await cdp.send('Target.createTarget', { url: 'http://example.test/article' });
    await until(() => cdp.evaluate(sourceId, "!!document.querySelector('#cgp-selection-root')"), 'Source content script missing');
    const sourceMarker = `source-${Date.now()}`;
    await cdp.evaluate(sourceId, `(()=>{window.__resumeSourceMarker=${JSON.stringify(sourceMarker)};const style=document.createElement('style');style.id='offline-darkreader';style.className='darkreader darkreader--user-agent';style.textContent='html{color-scheme:dark!important}';document.head.append(style)})()`);
    ({ targetId: panelId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${report.extensionId}/sidepanel.html` }));
    await until(() => cdp.evaluate(panelId, "!!document.querySelector('#cgp-chatgpt-frame')"), 'Sidebar frame missing');
    await cdp.send('Target.activateTarget', { targetId: sourceId });
    await until(() => cdp.evaluate(panelId, "document.querySelector('#cgp-chatgpt-frame').src.startsWith('https://chatgpt.com/')"), 'Sidebar host did not publish its native frame token');
    const panelFrameUrl = await cdp.evaluate(panelId, "document.querySelector('#cgp-chatgpt-frame').src");
    const token = new URL(panelFrameUrl).hash.slice(1).split('=')[1];
    nativeTarget = await until(async () => (await targets()).find(item => {
      try { return item.type === 'iframe' && new URL(item.url).hostname === 'chatgpt.com' && new URLSearchParams(new URL(item.url).hash.slice(1)).get('cgp-frame') === decodeURIComponent(token); }
      catch { return false; }
    }), 'Native ChatGPT iframe did not load');
    const initialAttachButton = await until(() => readAttachPageButton(cdp, nativeTarget.targetId), 'Injected composer attachment icon missing');
    assert.equal(initialAttachButton.title, '附加当前网页');
    assert.equal(initialAttachButton.ariaLabel, '附加当前网页');
    report.initialUi = {
      source: { targetId: sourceId, url: await cdp.evaluate(sourceId, 'location.href'), marker: sourceMarker },
      panel: { targetId: panelId, theme: await cdp.evaluate(panelId, 'document.documentElement.dataset.cgpTheme'), frameUrl: panelFrameUrl, token },
      iframe: { targetId: nativeTarget.targetId, url: nativeTarget.url },
    };
    await until(() => cdp.evaluate(panelId, "document.documentElement.dataset.cgpTheme==='dark'"), 'Dark Reader theme did not reach sidepanel');
    await until(() => cdp.evaluate(nativeTarget.targetId, "document.documentElement.getAttribute('data-theme')==='dark'"), 'Dark Reader theme did not reach native iframe');
    await cdp.evaluate(nativeTarget.targetId, "document.querySelector('#prompt-textarea').innerHTML='<p>Draft to preserve through browser freeze</p>'");
    await until(async () => { const button = await readAttachPageButton(cdp, nativeTarget.targetId); return button && !button.disabled; }, 'Composer attachment icon did not enable');
    await clickAttachPageButton(cdp, nativeTarget.targetId);
    await until(() => cdp.evaluate(nativeTarget.targetId, 'window.fixtureSends===1'), 'Attach current page did not send once');
    await until(() => cdp.evaluate(nativeTarget.targetId, "document.querySelector('#prompt-textarea').innerText==='Draft to preserve through browser freeze'"), 'Current draft was not restored after page attachment');
    await until(async () => { const button = await readAttachPageButton(cdp, nativeTarget.targetId); return button && !button.disabled; }, 'Composer attachment icon did not unlock');
    const iframeMarker = `iframe-${Date.now()}`;
    await cdp.evaluate(nativeTarget.targetId, `(()=>{window.__resumeIframeMarker=${JSON.stringify(iframeMarker)};document.documentElement.dataset.resumeMarker=${JSON.stringify(iframeMarker)}})()`);
    report.beforeFreeze = {
      at: Date.now(),
      panel: await cdp.evaluate(panelId, `({theme:document.documentElement.dataset.cgpTheme,status:document.querySelector('#panel-status')?.textContent||'',frameUrl:document.querySelector('#cgp-chatgpt-frame').src})`),
      iframe: await cdp.evaluate(nativeTarget.targetId, `({url:location.href,theme:document.documentElement.getAttribute('data-theme'),marker:window.__resumeIframeMarker,rootMarker:document.documentElement.dataset.resumeMarker,draft:document.querySelector('#prompt-textarea').innerText,sends:window.fixtureSends,lastSubmitted:window.fixtureSubmittedText})`),
      source: await cdp.evaluate(sourceId, `({url:location.href,marker:window.__resumeSourceMarker,theme:document.querySelector('#cgp-selection-root')?.getAttribute('data-cgp-theme')})`),
    };
    report.beforeFreeze.iframe.attachPageButton = await readAttachPageButton(cdp, nativeTarget.targetId);
    assert.equal(report.beforeFreeze.iframe.sends, 1);
    assert.match(report.beforeFreeze.iframe.draft, /Draft to preserve through browser freeze/u);

    // Record protocol metadata only; never retain message bodies or user text.
    await cdp.evaluate(panelId, `(()=>{
      const state=window.__resumePortDiagnostics={trace:[],ports:[],originalConnect:chrome.runtime.connect};
      const record=item=>state.trace.push({at:Date.now(),...item});
      chrome.runtime.connect=function(...args){
        const port=state.originalConnect.apply(this,args);
        const entry={port,name:port.name||args[0]?.name||''};state.ports.push(entry);
        record({event:'connect',name:entry.name});
        entry.onMessage=message=>record({event:'message',name:entry.name,type:message?.type||null,rpcId:message?.rpcId??null,ok:message?.result?.ok??message?.ok??null,errorCode:message?.result?.error?.code??message?.error?.code??message?.errorCode??null});
        entry.onDisconnect=()=>record({event:'disconnect',name:entry.name,error:chrome.runtime.lastError?.message||null});
        port.onMessage.addListener(entry.onMessage);port.onDisconnect.addListener(entry.onDisconnect);
        const originalPost=port.postMessage.bind(port);
        entry.originalPost=originalPost;
        port.postMessage=function(message){record({event:'postMessage',name:entry.name,type:message?.type||null,rpcId:message?.rpcId??null});return originalPost(message)};
        return port;
      };
      window.__resumePortDiagnosticsCleanup=()=>{chrome.runtime.connect=state.originalConnect;for(const entry of state.ports){entry.port.onMessage.removeListener(entry.onMessage);entry.port.onDisconnect.removeListener(entry.onDisconnect);entry.port.postMessage=entry.originalPost}}
    })()`);
    await cdp.evaluate(nativeTarget.targetId, `(()=>{
      const expected=${JSON.stringify(token)};
      const state=window.__resumeIframeDiagnostics={trace:[],timerFiredAt:0,timer:null,expected};
      state.listener=event=>{const data=event.data;state.trace.push({at:Date.now(),type:data?.type||null,origin:event.origin,sourceIsParent:event.source===parent,sourceIsNull:event.source===null,tokenMatch:!!data&&typeof data==='object'&&Object.values(data).some(value=>typeof value==='string'&&value===expected)})};
      window.addEventListener('message',state.listener);
      window.__resumeIframeDiagnosticsCleanup=()=>{window.removeEventListener('message',state.listener);if(state.timer)clearTimeout(state.timer)}
    })()`);
    report.isolatedWorld = await withExtensionRuntimeContext(cdp, nativeTarget.targetId, report.extensionId, async ({ context, send, evaluate }) => {
      const setup = await evaluate(context.id, `(()=>{
        const state=window.__resumeIsolatedDiagnostics={trace:[],ports:[],expected:${JSON.stringify(token)}};
        state.record=item=>state.trace.push({at:Date.now(),...item});
        const probe=chrome.runtime.connect({name:'cgp-resume-prototype-probe'});
        window.__resumeIsolatedPortPrototype=Object.getPrototypeOf(probe);
        state.portPrototypeConstructor=window.__resumeIsolatedPortPrototype?.constructor?.name||'';
        probe.disconnect();
        state.messageListener=event=>{const data=event.data;state.record({event:'message',type:data?.type||null,origin:event.origin,sourceIsParent:event.source===parent,sourceIsNull:event.source===null,isTrusted:event.isTrusted,tokenMatch:!!data&&typeof data==='object'&&Object.values(data).some(value=>typeof value==='string'&&value===state.expected)})};
        for(const name of ['pagehide','pageshow','freeze','resume']){const listener=event=>state.record({event:'lifecycle',name,persisted:typeof event.persisted==='boolean'?event.persisted:null,visibility:document.visibilityState});window.addEventListener(name,listener);(state.lifecycleListeners||=[]).push([name,listener])}
        state.visibilityListener=()=>state.record({event:'lifecycle',name:'visibilitychange',visibility:document.visibilityState});document.addEventListener('visibilitychange',state.visibilityListener);
        window.addEventListener('message',state.messageListener);
        state.arm=port=>{
          const entry={port,name:port.name||''};state.ports.push(entry);
          state.record({event:'connect',name:entry.name});
          entry.onMessage=message=>state.record({event:'message',name:entry.name,type:message?.type||null,rpcId:message?.rpcId??null,ok:message?.result?.ok??message?.ok??null,errorCode:message?.result?.error?.code??message?.error?.code??message?.errorCode??null,hostType:message?.hostType??null});
          entry.onDisconnect=()=>state.record({event:'disconnect',name:entry.name,error:chrome.runtime.lastError?.message||null});
          port.onMessage.addListener(entry.onMessage);port.onDisconnect.addListener(entry.onDisconnect);
          entry.originalPost=port.postMessage.bind(port);
          port.postMessage=function(message){state.record({event:'postMessage',name:entry.name,type:message?.type||null,rpcId:message?.rpcId??null});return entry.originalPost(message)};
        };
        state.originalConnect=chrome.runtime.connect;
        chrome.runtime.connect=function(...args){const port=Reflect.apply(state.originalConnect,this,args);state.arm(port);return port};
        state.cleanup=()=>{chrome.runtime.connect=state.originalConnect;window.removeEventListener('message',state.messageListener);document.removeEventListener('visibilitychange',state.visibilityListener);for(const [name,listener] of state.lifecycleListeners)window.removeEventListener(name,listener);for(const entry of state.ports){entry.port.onMessage.removeListener(entry.onMessage);entry.port.onDisconnect.removeListener(entry.onDisconnect);entry.port.postMessage=entry.originalPost}};
        return {name:state.portPrototypeConstructor,installed:true};
      })()`);
      const result = { context: { id: context.id, name: context.name, origin: context.origin }, installed: setup?.installed, portPrototypeConstructor: setup?.name, existingPortsArmed: 0 };
      isolatedDiagnosticsInstalled = true;
      try {
        const proto = await evaluate(context.id, 'window.__resumeIsolatedPortPrototype', false);
        result.portPrototypeObjectAvailable = !!proto.objectId;
        result.portPrototypeMethods = proto.objectId ? (await send('Runtime.getProperties', { objectId: proto.objectId, ownProperties: true })).result.map(item => item.name).filter(name => ['postMessage', 'disconnect', 'onDisconnect', 'onMessage'].includes(name)) : [];
        if (proto.objectId && (result.portPrototypeConstructor === 'Port' || result.portPrototypeMethods.includes('postMessage'))) {
          const query = await send('Runtime.queryObjects', { prototypeObjectId: proto.objectId });
          const matching = await send('Runtime.callFunctionOn', { objectId: query.objects.objectId, functionDeclaration: "function(){return this.filter(port=>port?.name==='cgp-adapter')}", returnByValue: false });
          const properties = await send('Runtime.getProperties', { objectId: matching.result.objectId, ownProperties: true });
          const ports = properties.result.filter(item => /^\\d+$/u.test(item.name) && item.value?.objectId);
          for (const item of ports) {
            await send('Runtime.callFunctionOn', { objectId: item.value.objectId, functionDeclaration: `function(){const state=globalThis.__resumeIsolatedDiagnostics;if(!state||this.name!=='cgp-adapter')return false;state.arm(this);state.ports[state.ports.length-1].existing=true;return true}`, returnByValue: true });
          }
          result.existingPortsArmed = ports.length;
        }
      } catch (error) { result.portHeapDiagnosticError = error.message; }
      return result;
    });

    // Keep the panel tab foreground until the explicit lifecycle freeze, so normal background-tab timer throttling is not the trigger.
    await cdp.send('Target.activateTarget', { targetId: panelId });
    await cdp.evaluate(panelId, 'window.__resumeFreezeProbeFiredAt=0;setTimeout(()=>{window.__resumeFreezeProbeFiredAt=Date.now()},1500)');
    await cdp.evaluate(nativeTarget.targetId, 'window.__resumeIframeDiagnostics.timerFiredAt=0;window.__resumeIframeDiagnostics.timer=setTimeout(()=>{window.__resumeIframeDiagnostics.timerFiredAt=Date.now()},1000)');
    await pause(100);
    report.freeze = await sendToTarget(panelId, 'Page.setWebLifecycleState', { state: 'frozen' });
    report.freezeAt = Date.now();
    report.freezeProbeBefore = await cdp.evaluate(panelId, 'window.__resumeFreezeProbeFiredAt');
    report.iframeProbeBefore = await cdp.evaluate(nativeTarget.targetId, 'window.__resumeIframeDiagnostics.timerFiredAt');
    const preWaitTargets = await targets();
    report.detachedBeforeWait = preWaitTargets.map(({ targetId, type, url, attached }) => ({ targetId, type, url, attached }));
    await cdp.detachTargets();
    report.detachedBeforeWait = (await targets()).map(({ targetId, type, url, attached }) => ({ targetId, type, url, attached }));
    report.allTargetsDetached = report.detachedBeforeWait.every(item => item.attached === false);
    assert.equal(report.allTargetsDetached, true, 'All CDP target sessions must be detached before waiting');
    console.log(`SIDEBAR RESUME: ${phase}; explicit Page.setWebLifecycleState(frozen); detached browser-only wait 45s`);

    const waitUntil = Date.now() + 45000;
    while (Date.now() < waitUntil) {
      const at = Date.now(), current = await targets();
      report.monitor.push({
        at,
        elapsedMs: at - report.freezeAt,
        workers: current.filter(item => item.type === 'service_worker' && item.url === workerUrl).map(({ targetId, attached }) => ({ targetId, attached })),
        panelPresent: current.some(item => item.targetId === panelId),
        iframePresent: current.some(item => item.targetId === nativeTarget.targetId),
        sourcePresent: current.some(item => item.targetId === sourceId),
      });
      await pause(Math.min(1500, Math.max(1, waitUntil - Date.now())));
    }
    report.waitEndedAt = Date.now();
    const frozenTargets = await targets();
    report.workersAfterFreeze = frozenTargets.filter(item => item.type === 'service_worker' && item.url === workerUrl).map(({ targetId, attached }) => ({ targetId, attached }));
    report.workerDestroyedDuringFreeze = report.events.filter(item => item.type === 'Target.targetDestroyed' && item.targetId === report.initialWorker.targetId && item.at >= report.freezeAt);
    report.workerExitedWhileFrozen = report.workerDestroyedDuringFreeze.length > 0 && !report.workersAfterFreeze.some(item => item.targetId === report.initialWorker.targetId);
    report.destroyedTargetsDuringFreeze = report.events.filter(item => item.type === 'Target.targetDestroyed' && item.at >= report.freezeAt).map(item => {
      const created = report.events.find(event => event.type === 'Target.targetCreated' && event.targetInfo?.targetId === item.targetId);
      return { at: item.at, elapsedMs: item.at - report.freezeAt, targetId: item.targetId, type: created?.targetInfo?.type || null, url: created?.targetInfo?.url || null };
    });
    report.targetIdentityBeforeResume = frozenTargets.filter(item => [panelId, nativeTarget.targetId, sourceId].includes(item.targetId)).map(({ targetId, type, url, attached }) => ({ targetId, type, url, attached }));

    // Resume the same documents. No navigation, tab recreation, or worker stop/start command is used.
    report.resume = await sendToTarget(panelId, 'Page.setWebLifecycleState', { state: 'active' });
    report.resumeAt = Date.now();
    await until(() => cdp.evaluate(panelId, "document.readyState==='complete'"), 'Sidepanel page did not resume');
    await pause(1500);
    report.freezeProbeAfterResume = await cdp.evaluate(panelId, 'window.__resumeFreezeProbeFiredAt');
    report.iframeProbeAfterPanelResume = await cdp.evaluate(nativeTarget.targetId, 'window.__resumeIframeDiagnostics.timerFiredAt');
    report.iframeMessagesAfterPanelResume = await cdp.evaluate(nativeTarget.targetId, 'window.__resumeIframeDiagnostics.trace.filter(item=>item.at>=__RESUME_AT__).length'.replace('__RESUME_AT__', String(report.resumeAt)));
    report.nativeIframeLifecycleIntervention = null;
    if (!report.iframeProbeAfterPanelResume && !report.iframeMessagesAfterPanelResume) {
      report.nativeIframeLifecycleIntervention = await sendToTarget(nativeTarget.targetId, 'Page.setWebLifecycleState', { state: 'active' });
      report.nativeIframeLifecycleInterventionAt = Date.now();
      await pause(2000);
      report.iframeProbeAfterNativeResume = await cdp.evaluate(nativeTarget.targetId, 'window.__resumeIframeDiagnostics.timerFiredAt');
      report.iframeMessagesAfterNativeResume = await cdp.evaluate(nativeTarget.targetId, 'window.__resumeIframeDiagnostics.trace.filter(item=>item.at>=__RESUME_AT__).length'.replace('__RESUME_AT__', String(report.nativeIframeLifecycleInterventionAt)));
    }
    await cdp.send('Target.activateTarget', { targetId: sourceId });
    await cdp.send('Target.activateTarget', { targetId: panelId });
    await pause(250);
    report.afterResumeImmediate = {
      at: Date.now(),
      panel: await cdp.evaluate(panelId, `({theme:document.documentElement.dataset.cgpTheme,status:document.querySelector('#panel-status')?.textContent||'',frameUrl:document.querySelector('#cgp-chatgpt-frame').src})`),
      iframe: await cdp.evaluate(nativeTarget.targetId, `({url:location.href,theme:document.documentElement.getAttribute('data-theme'),marker:window.__resumeIframeMarker,rootMarker:document.documentElement.dataset.resumeMarker,draft:document.querySelector('#prompt-textarea').innerText,sends:window.fixtureSends,lastSubmitted:window.fixtureSubmittedText})`),
      source: await cdp.evaluate(sourceId, `({url:location.href,marker:window.__resumeSourceMarker,theme:document.querySelector('#cgp-selection-root')?.getAttribute('data-cgp-theme')})`),
    };
    report.afterResumeImmediate.iframe.attachPageButton = await readAttachPageButton(cdp, nativeTarget.targetId);
    report.portDiagnostics = await cdp.evaluate(panelId, 'window.__resumePortDiagnostics?.trace||[]');
    report.iframeDiagnostics = await cdp.evaluate(nativeTarget.targetId, 'window.__resumeIframeDiagnostics?.trace||[]');
    report.isolatedWorld = { ...report.isolatedWorld, ...await withExtensionRuntimeContext(cdp, nativeTarget.targetId, report.extensionId, async ({ context, evaluate }) => ({ trace: await evaluate(context.id, 'window.__resumeIsolatedDiagnostics?.trace||[]'), portPrototypeConstructor: await evaluate(context.id, 'window.__resumeIsolatedDiagnostics?.portPrototypeConstructor||null'), ports: await evaluate(context.id, 'window.__resumeIsolatedDiagnostics?.ports.map(({name,existing})=>({name,existing:!!existing}))||[]') })) };
    await cdp.send('Target.activateTarget', { targetId: sourceId });
    await until(() => cdp.evaluate(panelId, "document.documentElement.dataset.cgpTheme==='dark'"), 'Reactivated reading tab theme did not reach the sidebar host');
    if (phase === 'fixed') await until(() => cdp.evaluate(nativeTarget.targetId, "document.documentElement.getAttribute('data-theme')==='dark'"), 'Reconnected sidebar did not restore dark theme to its existing ChatGPT iframe');
    report.afterResume = {
      at: Date.now(),
      panel: await cdp.evaluate(panelId, `({theme:document.documentElement.dataset.cgpTheme,status:document.querySelector('#panel-status')?.textContent||'',frameUrl:document.querySelector('#cgp-chatgpt-frame').src})`),
      iframe: await cdp.evaluate(nativeTarget.targetId, `({url:location.href,theme:document.documentElement.getAttribute('data-theme'),marker:window.__resumeIframeMarker,rootMarker:document.documentElement.dataset.resumeMarker,draft:document.querySelector('#prompt-textarea').innerText,sends:window.fixtureSends,lastSubmitted:window.fixtureSubmittedText})`),
      source: await cdp.evaluate(sourceId, `({url:location.href,marker:window.__resumeSourceMarker,theme:document.querySelector('#cgp-selection-root')?.getAttribute('data-cgp-theme')})`),
    };
    report.afterResume.iframe.attachPageButton = await readAttachPageButton(cdp, nativeTarget.targetId);
    const postResumeTargets = await targets();
    report.workerAfterResume = postResumeTargets.filter(item => item.type === 'service_worker' && item.url === workerUrl).map(item => ({ targetId: item.targetId, attached: item.attached }));
    const activeWorker = report.workerAfterResume[0];
    report.workerEpochAfterResume = activeWorker ? await cdp.evaluate(activeWorker.targetId, 'globalThis.__resumeWorkerEpoch') : null;
    report.samePanelDocument = postResumeTargets.some(item => item.targetId === panelId) && report.afterResume.panel.frameUrl === report.beforeFreeze.panel.frameUrl;
    report.sameIframeDocument = postResumeTargets.some(item => item.targetId === nativeTarget.targetId)
      && report.afterResume.iframe.url === report.beforeFreeze.iframe.url
      && report.afterResume.iframe.marker === report.beforeFreeze.iframe.marker;
    report.sameSourceDocument = postResumeTargets.some(item => item.targetId === sourceId)
      && report.afterResume.source.url === report.beforeFreeze.source.url
      && report.afterResume.source.marker === report.beforeFreeze.source.marker;
    report.draftPreserved = report.afterResume.iframe.draft === report.beforeFreeze.iframe.draft;
    report.noReplay = report.afterResume.iframe.sends === report.beforeFreeze.iframe.sends;
    report.themePreserved = report.afterResume.panel.theme === report.afterResume.source.theme && report.afterResume.iframe.theme === report.afterResume.source.theme;
    report.controlsEnabled = report.afterResume.iframe.attachPageButton?.disabled === false;
    report.freezePausedProbe = report.freezeProbeBefore === 0 && report.freezeProbeAfterResume >= report.waitEndedAt;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`SIDEBAR RESUME EVIDENCE ${reportPath}; worker exited while frozen=${report.workerExitedWhileFrozen}; status=${JSON.stringify(report.afterResume.panel.status)}; draft preserved=${report.draftPreserved}; theme preserved=${report.themePreserved}; controls enabled=${report.controlsEnabled}`);

    assert.equal(report.waitEndedAt - report.freezeAt >= 44000, true);
    assert.equal(report.freezePausedProbe, true, 'The panel timer probe must remain paused until the explicit lifecycle resume');
    assert.equal(report.workerExitedWhileFrozen, true, 'Freeze injection should allow the baseline service worker to reach natural idle exit');
    assert.equal(report.samePanelDocument, true);
    assert.equal(report.sameIframeDocument, true);
    assert.equal(report.sameSourceDocument, true);
    assert.equal(report.noReplay, true, 'Recovery must not resend the submitted page attachment');
    assert.equal(report.draftPreserved, true, 'Existing unsent composer draft must survive');
    assert.equal(report.afterResume.iframe.sends, 1);

    if (phase === 'fixed') {
      await until(async () => {
        const value = await cdp.evaluate(panelId, `({status:document.querySelector('#panel-status')?.textContent||''})`);
        const button = await readAttachPageButton(cdp, nativeTarget.targetId);
        return button && !button.disabled && !value.status.includes('侧栏后台连接已中断');
      }, 'Recovered composer attachment icon did not re-enable');
      report.afterReconnect = {
        panel: await cdp.evaluate(panelId, `({theme:document.documentElement.dataset.cgpTheme,status:document.querySelector('#panel-status')?.textContent||'',frameUrl:document.querySelector('#cgp-chatgpt-frame').src})`),
        iframe: await cdp.evaluate(nativeTarget.targetId, `({url:location.href,theme:document.documentElement.getAttribute('data-theme'),marker:window.__resumeIframeMarker,draft:document.querySelector('#prompt-textarea').innerText,sends:window.fixtureSends})`),
      };
      report.afterReconnect.iframe.attachPageButton = await readAttachPageButton(cdp, nativeTarget.targetId);
      report.sameToken = report.afterReconnect.panel.frameUrl === report.initialUi.panel.frameUrl;
      report.sameNativeFrame = report.afterReconnect.iframe.marker === iframeMarker && report.afterReconnect.iframe.url === report.beforeFreeze.iframe.url;
      assert.equal(report.sameToken, true, 'Reconnect must reclaim the original panel token');
      assert.equal(report.sameNativeFrame, true, 'Reconnect must preserve the same native iframe document');
      assert.equal(report.afterReconnect.iframe.sends, 1);
      assert.equal(report.afterReconnect.panel.theme, 'dark');
      assert.equal(report.afterReconnect.iframe.theme, 'dark');
      assert.equal(report.afterReconnect.iframe.draft, report.beforeFreeze.iframe.draft);
      assert.equal(report.afterReconnect.iframe.attachPageButton?.disabled, false);

      // Return focus to the reading page and use its normal selection toolbar to verify recovered routing.
      await cdp.evaluate(sourceId, `(()=>{const node=document.querySelector('#selection'),range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);node.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))})()`);
      await until(() => cdp.evaluate(sourceId, "!!document.querySelector('#cgp-selection-root').shadowRoot.querySelector('[data-action=\"append-selection\"]')"), 'Source page did not show the selected-text action');
      await cdp.evaluate(sourceId, `document.querySelector('#cgp-selection-root').shadowRoot.querySelector('[data-action="append-selection"]').click()`);
      await until(() => cdp.evaluate(nativeTarget.targetId, "document.querySelector('#prompt-textarea').innerText.includes('> Chosen passage for local extension integration.')"), 'Recovered sidebar button could not append the selected text');
      report.afterButton = await cdp.evaluate(nativeTarget.targetId, `({draft:document.querySelector('#prompt-textarea').innerText,sends:window.fixtureSends})`);
      assert.equal(report.afterButton.sends, 1, 'Appending selected text must not send or replay');
      assert.ok(report.afterButton.draft.startsWith('Draft to preserve through browser freeze'));
      assert.ok(report.afterButton.draft.endsWith('\n\n'));
    } else if (phase === 'baseline') {
      assert.equal(report.afterResume.panel.status, '侧栏后台连接已中断，请重新打开侧栏');
      assert.equal(report.controlsEnabled, false, 'Baseline should remain disconnected after resume');
    }
  } catch (error) {
    report.failure = { at: Date.now(), message: error.message, stack: error.stack };
    report.freezePausedProbe = report.freezeProbeBefore === 0 && report.freezeProbeAfterResume >= report.waitEndedAt;
    if (report.beforeFreeze && report.afterResumeImmediate) {
      report.samePanelDocument = report.afterResumeImmediate.panel.frameUrl === report.beforeFreeze.panel.frameUrl;
      report.sameIframeDocument = report.afterResumeImmediate.iframe.url === report.beforeFreeze.iframe.url
        && report.afterResumeImmediate.iframe.marker === report.beforeFreeze.iframe.marker;
      report.sameSourceDocument = report.afterResumeImmediate.source.url === report.beforeFreeze.source.url
        && report.afterResumeImmediate.source.marker === report.beforeFreeze.source.marker;
      report.draftPreserved = report.afterResumeImmediate.iframe.draft === report.beforeFreeze.iframe.draft;
      report.noReplay = report.afterResumeImmediate.iframe.sends === report.beforeFreeze.iframe.sends;
    }
    if (cdp) {
      try {
        report.finalTargets = (await cdp.send('Target.getTargets')).targetInfos.map(({ targetId, type, url, attached }) => ({ targetId, type, url, attached }));
        if (panelId) report.portDiagnostics = await cdp.evaluate(panelId, 'window.__resumePortDiagnostics?.trace||[]');
        if (nativeTarget?.targetId) report.iframeDiagnostics = await cdp.evaluate(nativeTarget.targetId, 'window.__resumeIframeDiagnostics?.trace||[]');
        if (nativeTarget?.targetId && isolatedDiagnosticsInstalled) report.isolatedWorld = { ...report.isolatedWorld, ...await withExtensionRuntimeContext(cdp, nativeTarget.targetId, report.extensionId, async ({ context, evaluate }) => ({ trace: await evaluate(context.id, 'window.__resumeIsolatedDiagnostics?.trace||[]'), portPrototypeConstructor: await evaluate(context.id, 'window.__resumeIsolatedDiagnostics?.portPrototypeConstructor||null'), ports: await evaluate(context.id, 'window.__resumeIsolatedDiagnostics?.ports.map(({name,existing})=>({name,existing:!!existing}))||[]') })) };
        if (panelId && nativeTarget?.targetId) report.finalUi = {
          panel: await cdp.evaluate(panelId, `({theme:document.documentElement.dataset.cgpTheme,status:document.querySelector('#panel-status')?.textContent||'',frameUrl:document.querySelector('#cgp-chatgpt-frame').src})`),
          iframe: await cdp.evaluate(nativeTarget.targetId, `({url:location.href,theme:document.documentElement.getAttribute('data-theme'),marker:window.__resumeIframeMarker,draftLength:document.querySelector('#prompt-textarea').innerText.length,sends:window.fixtureSends})`),
        };
        if (report.finalUi?.iframe) report.finalUi.iframe.attachPageButton = await readAttachPageButton(cdp, nativeTarget.targetId);
      } catch (diagnosticError) { report.diagnosticCaptureError = diagnosticError.message; }
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    throw error;
  } finally {
    if (cdp) {
      try { if (panelId) await cdp.evaluate(panelId, 'window.__resumePortDiagnosticsCleanup?.()'); } catch { }
      try { if (nativeTarget?.targetId) await cdp.evaluate(nativeTarget.targetId, 'window.__resumeIframeDiagnosticsCleanup?.()'); } catch { }
      try { if (nativeTarget?.targetId && isolatedDiagnosticsInstalled) await withExtensionRuntimeContext(cdp, nativeTarget.targetId, report.extensionId, async ({ context, evaluate }) => evaluate(context.id, 'window.__resumeIsolatedDiagnostics?.cleanup?.()')); } catch { }
    }
    browserProcess?.kill();
    if (cdp) {
      try { await cdp.detachTargets(); } catch { }
      cdp.close();
    }
    await proxy?.close();
    if (browserProcess) await pause(300);
    const relative = path.relative(outputRoot, path.resolve(profile));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  }
});
