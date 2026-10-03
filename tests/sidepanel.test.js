import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSidepanel } from '../src/sidepanel/index.js';
import { createOptions } from '../src/options/index.js';
import { DEFAULT_SETTINGS } from '../src/shared/settings.js';

const html = readFileSync(new URL('../public/sidepanel.html', import.meta.url), 'utf8');
const optionsHtml = readFileSync(new URL('../public/options.html', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function event() {
  const listeners = new Set();
  return { listeners, addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); }, fire(...args) { listeners.forEach((fn) => fn(...args)); } };
}

async function setup(overrides = {}) {
  const dom = new JSDOM(html, { url: 'https://extension.test/sidepanel.html' });
  if (overrides.clock) {
    dom.window.setInterval = overrides.clock.setInterval;
    dom.window.clearInterval = overrides.clock.clearInterval;
  }
  const calls = [];
  const onMessage = event(); const onDisconnect = event();
  const port = { onMessage, onDisconnect, postMessage() { assert.fail('Injected RPC should be used'); }, disconnect() { onDisconnect.fire(); } };
  const chrome = { windows: { getCurrent: async () => ({ id: 3 }) }, runtime: { onMessage: event(), connect({ name }) { calls.push({ type: 'CONNECT', name }); return port; } } };
  const rpc = async (type, payload = {}) => {
    calls.push({ type, ...payload });
    const custom = await overrides.rpc?.(type, payload);
    if (custom !== undefined) return custom;
    if (type === 'SIDEPANEL_READY') return { ok: true, token: '12345678-1234-1234-1234-123456789012', frameReady: true };
    if (type === 'GET_SETTINGS') return { ok: true, settings: { ...DEFAULT_SETTINGS } };
    if (type === 'ATTACH_CURRENT_PAGE') return { ok: true, draftRestored: true };
    return { ok: true };
  };
  const panel = createSidepanel(dom.window.document, chrome, { currentTab: async () => ({ id: 5 }), ...overrides, rpc });
  await panel.ready;
  return { dom, document: dom.window.document, panel, calls, port, chrome, cleanup() { panel.dispose(); dom.window.close(); } };
}

test('sidebar has no extension toolbar and binds its native frame to this window', async () => {
  const view = await setup();
  try {
    assert.equal(view.calls[0].name, 'cgp-sidepanel-host');
    assert.equal(view.document.querySelectorAll('button').length, 0);
    assert.equal(view.document.querySelector('#enhancement-tools,.enhancement-tools'), null);
    assert.equal(view.calls.find(call => call.type === 'SIDEPANEL_READY').windowId, 3);
    assert.equal(view.document.querySelectorAll('dialog,details,textarea,select').length, 0);
    const iframe = view.document.getElementById('cgp-chatgpt-frame');
    assert.equal(iframe.name, 'cgp-sidepanel');
    assert.equal(iframe.src, 'https://chatgpt.com/#cgp-frame=12345678-1234-1234-1234-123456789012');
    assert.equal(view.calls.some((call) => call.type === 'START_TASK'), false);
  } finally { view.cleanup(); }
});

test('host Port attachment event calls the page RPC with the active regular tab id', async () => {
  const view = await setup();
  try {
    view.chrome.runtime.onMessage.fire({ channel: 'cgp', type: 'SIDEPANEL_ATTACH_CURRENT_PAGE' }); await tick();
    assert.equal(view.calls.some((call) => call.type === 'ATTACH_CURRENT_PAGE'), false, 'The runtime message bus is not the trusted sidebar host Port');
    view.port.onMessage.fire({ channel: 'cgp', type: 'SIDEPANEL_ATTACH_CURRENT_PAGE' }); await tick();
    assert.deepEqual(view.calls.filter((call) => call.type === 'ATTACH_CURRENT_PAGE'), [{ type: 'ATTACH_CURRENT_PAGE', tabId: 5 }]);
    assert.equal(view.document.getElementById('panel-status').textContent, '');
    assert.equal(view.document.getElementById('panel-status').hidden, true);
    assert.equal(view.calls.some((call) => call.type === 'START_TASK'), false);
  } finally { view.cleanup(); }
});

test('production Port accepts the host attachment event and sends the page RPC with its rpc id', async () => {
  const dom = new JSDOM(html, { url: 'https://extension.test/sidepanel.html' });
  const messages = [];
  const onMessage = event(); const onDisconnect = event();
  const port = {
    onMessage, onDisconnect,
    postMessage(message) {
      messages.push(message);
      const result = message.type === 'SIDEPANEL_READY' ? { ok: true, token: '12345678-1234-1234-1234-123456789012', frameReady: true }
        : message.type === 'GET_SETTINGS' ? { ok: true, settings: { enabled: true } }
          : { ok: true, draftRestored: true };
      queueMicrotask(() => onMessage.fire({ channel: 'cgp', type: 'PORT_RESPONSE', rpcId: message.rpcId, result }));
    },
    disconnect() { onDisconnect.fire(); },
  };
  const chrome = { windows: { getCurrent: async () => ({ id: 3 }) }, runtime: { connect: ({ name }) => { assert.equal(name, 'cgp-sidepanel-host'); return port; } } };
  const panel = createSidepanel(dom.window.document, chrome, { currentTab: async () => ({ id: 19 }) });
  try {
    await panel.ready;
    onMessage.fire({ channel: 'cgp', type: 'SIDEPANEL_ATTACH_CURRENT_PAGE' }); await tick();
    const actions = messages.filter((message) => message.type === 'ATTACH_CURRENT_PAGE');
    assert.deepEqual(actions.map(({ type, tabId }) => ({ type, tabId })), [
      { type: 'ATTACH_CURRENT_PAGE', tabId: 19 },
    ]);
    assert.ok(actions.every((message) => typeof message.rpcId === 'string'));
  } finally { panel.dispose(); dom.window.close(); }
});

test('page request syncs busy state to the iframe, suppresses rapid repeats, and restores controls after completion', async () => {
  let resolveRequest;
  const view = await setup({ rpc: (type) => type === 'ATTACH_CURRENT_PAGE' ? new Promise((resolve) => { resolveRequest = resolve; }) : undefined });
  try {
    const attach = { channel: 'cgp', type: 'SIDEPANEL_ATTACH_CURRENT_PAGE' };
    view.port.onMessage.fire(attach); view.port.onMessage.fire(attach);
    await tick();
    assert.equal(view.calls.filter((call) => call.type === 'ATTACH_CURRENT_PAGE').length, 1);
    assert.deepEqual(view.calls.filter((call) => call.type === 'SET_SIDEPANEL_CONTROLS').map((call) => call.enabled).slice(-2), [true, false]);
    resolveRequest({ ok: true, draftRestored: true }); await tick();
    assert.equal(view.calls.filter((call) => call.type === 'SET_SIDEPANEL_CONTROLS').at(-1).enabled, true);
    assert.equal(view.document.getElementById('panel-status').textContent, '');
    assert.equal(view.document.getElementById('panel-status').hidden, true);
  } finally { view.cleanup(); }
});

test('settings synchronize disabled state, disconnect drops new action events, and missing page reports inline error', async () => {
  const view = await setup();
  try {
    view.port.onMessage.fire({ channel: 'cgp', type: 'SETTINGS_CHANGED', settings: { enabled: false } });
    assert.equal(view.calls.filter((call) => call.type === 'SET_SIDEPANEL_CONTROLS').at(-1).enabled, false);
    view.port.onMessage.fire({ channel: 'cgp', type: 'SIDEPANEL_ATTACH_CURRENT_PAGE' }); await tick();
    assert.equal(view.calls.some((call) => call.type === 'ATTACH_CURRENT_PAGE'), false);
    view.port.onMessage.fire({ channel: 'cgp', type: 'SETTINGS_CHANGED', settings: { enabled: true } });
    assert.equal(view.calls.filter((call) => call.type === 'SET_SIDEPANEL_CONTROLS').at(-1).enabled, true);
    const controlsBeforeDisconnect = view.calls.filter((call) => call.type === 'SET_SIDEPANEL_CONTROLS').length;
    view.port.onDisconnect.fire();
    assert.equal(view.calls.filter((call) => call.type === 'SET_SIDEPANEL_CONTROLS').length, controlsBeforeDisconnect, 'A lost host Port cannot send a controls update');
    const actionsBeforeLateMessage = view.calls.filter((call) => call.type === 'ATTACH_CURRENT_PAGE').length;
    view.port.onMessage.fire({ channel: 'cgp', type: 'SIDEPANEL_ATTACH_CURRENT_PAGE' }); await tick();
    assert.equal(view.calls.filter((call) => call.type === 'ATTACH_CURRENT_PAGE').length, actionsBeforeLateMessage);
  } finally { view.cleanup(); }

  const missingPage = await setup({ currentTab: async () => { throw new Error('请先打开要处理的普通网页'); } });
  try {
    missingPage.port.onMessage.fire({ channel: 'cgp', type: 'SIDEPANEL_ATTACH_CURRENT_PAGE' }); await tick();
    assert.equal(missingPage.document.getElementById('panel-status').textContent, '请先打开要处理的普通网页');
    assert.equal(missingPage.calls.some((call) => call.type === 'ATTACH_CURRENT_PAGE'), false);
  } finally { missingPage.cleanup(); }
});

test('mounted sidebar maintains one idle connection timer and releases it on disable, disconnect and disposal', async () => {
  const timers = new Map(); let next = 0;
  const clock = { setInterval(fn, ms) { timers.set(++next, { fn, ms }); return next; }, clearInterval(id) { timers.delete(id); } };
  const view = await setup({ clock });
  const messages = []; view.port.postMessage = message => messages.push(message);
  try {
    assert.equal(timers.size, 1); assert.equal([...timers.values()][0].ms, 20000);
    [...timers.values()][0].fn();
    assert.deepEqual(messages, [{ channel: 'cgp', type: 'SIDEPANEL_KEEPALIVE' }]);
    view.port.onMessage.fire({ channel: 'cgp', type: 'SETTINGS_CHANGED', settings: { enabled: true } });
    assert.equal(timers.size, 1, 'Repeated settings must not create extra timers');
    view.port.onMessage.fire({ channel: 'cgp', type: 'SETTINGS_CHANGED', settings: { enabled: false } });
    assert.equal(timers.size, 0);
    view.port.onMessage.fire({ channel: 'cgp', type: 'SETTINGS_CHANGED', settings: { enabled: true } });
    assert.equal(timers.size, 1);
    view.port.onDisconnect.fire(); assert.equal(timers.size, 0);
  } finally { view.cleanup(); }
  const second = await setup({ clock });
  assert.equal(timers.size, 1); second.cleanup(); assert.equal(timers.size, 0);
});

test('settings page validates before write and preserves remembered manual mode', async () => {
  const dom = new JSDOM(optionsHtml, { url: 'https://extension.test/options.html' });
  let settings = { ...DEFAULT_SETTINGS, manualMode: 'pro' }; const patches = [];
  const runtime = { async sendMessage(message) {
    if (message.type === 'UPDATE_SETTINGS') { patches.push(message.patch); settings = { ...settings, ...message.patch }; }
    return { ok: true, settings };
  } };
  const options = createOptions(dom.window.document, runtime); await options.ready;
  try {
    const get = (id) => dom.window.document.getElementById(id);
    assert.equal(get('manualMode').textContent, 'Pro');
    get('excludedHosts').value = 'https://invalid.test'; await options.save();
    assert.equal(patches.length, 0);
    get('excludedHosts').value = 'EXAMPLE.COM\n*.example.org'; get('enabled').checked = false; await options.save();
    assert.deepEqual(patches[0].excludedHosts, ['example.com', '*.example.org']);
    assert.equal(patches[0].enabled, false);
    assert.equal(Object.hasOwn(patches[0], 'manualMode'), false);
    assert.equal(settings.manualMode, 'pro');
  } finally { options.dispose(); dom.window.close(); }
});

test('sidebar resumes the same iframe and token after coordinator loss without replaying an in-flight action', async () => {
  const dom=new JSDOM(html,{url:'chrome-extension://extension-id/sidepanel.html',pretendToBeVisual:true});
  const timers=new Map(),ports=[],messages=[];let next=0;
  dom.window.setTimeout=(fn,ms)=>{timers.set(++next,{fn,ms});return next;};
  dom.window.clearTimeout=id=>timers.delete(id);
  const token='12345678-1234-1234-1234-123456789012';
  const chrome={windows:{getCurrent:async()=>({id:3})},runtime:{connect(){
    const index=ports.length;
    const port={onMessage:event(),onDisconnect:event(),disconnect(){this.onDisconnect.fire();},postMessage(message){
      messages.push({...message,connection:index});
      if (message.type==='ATTACH_CURRENT_PAGE') return; // Disconnect before its outcome is known.
      const result=message.type==='SIDEPANEL_READY'?{ok:true,token,frameReady:index===0}
        :message.type==='GET_SETTINGS'?{ok:true,settings:{enabled:true}}:{ok:true};
      queueMicrotask(()=>port.onMessage.fire({channel:'cgp',type:'PORT_RESPONSE',rpcId:message.rpcId,result}));
    }};ports.push(port);return port;
  }}};
  const panel=createSidepanel(dom.window.document,chrome,{currentTab:async()=>({id:9})});
  try {
    await panel.ready;
    const iframe=dom.window.document.querySelector('iframe'),src=iframe.src,retained=iframe.contentDocument;
    assert.equal(dom.window.document.querySelectorAll('button').length,0);
    assert.equal(dom.window.document.querySelector('#enhancement-tools,.enhancement-tools'),null);
    const controlStates = (connection) => messages.filter(message => message.type==='SET_SIDEPANEL_CONTROLS' && message.connection===connection).map(message => message.enabled);
    ports[0].onMessage.fire({channel:'cgp',type:'SIDEPANEL_ATTACH_CURRENT_PAGE'});await tick();
    assert.deepEqual(controlStates(0).slice(-2),[true,false]);
    ports[0].onDisconnect.fire();await tick();
    assert.match(dom.window.document.getElementById('panel-status').textContent,/结果未确认，未重复提交/u);
    assert.ok([...timers.values()].some(timer=>timer.ms===1000));
    dom.window.dispatchEvent(new dom.window.Event('focus'));await tick();await tick();
    assert.equal(ports.length,2);
    const ready=messages.filter(message=>message.type==='SIDEPANEL_READY');
    assert.equal(ready[0].token,undefined);assert.equal(ready[1].token,token);assert.equal(ready[1].windowId,3);
    assert.equal(iframe.src,src);assert.equal(iframe.contentDocument,retained);
    assert.equal(controlStates(1).length,0,'Do not enable the iframe before its retained adapter rebinds');
    ports[1].onMessage.fire({channel:'cgp',type:'SIDEPANEL_FRAME_BOUND'});await tick();
    assert.equal(controlStates(1).at(-1),true);assert.equal(timers.size,0);
    ports[0].onDisconnect.fire();assert.equal(controlStates(1).at(-1),true,'Ignore a stale Port disconnect');
    assert.equal(messages.filter(message=>message.type==='ATTACH_CURRENT_PAGE').length,1,'Never replay an uncertain submission');
    assert.match(dom.window.document.getElementById('panel-status').textContent,/结果未确认/u);
    ports[1].postMessage=()=>{throw new Error('Disconnected port before callback');};
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    dom.window.dispatchEvent(new dom.window.Event('focus'));await tick();await tick();
    assert.equal(ports.length,3,'Focus immediately detects a stale Port, with only one reconnect');
    ports[2].onMessage.fire({channel:'cgp',type:'SIDEPANEL_FRAME_BOUND'});await tick();
    assert.equal(controlStates(2).at(-1),true);assert.equal(iframe.contentDocument,retained);
    panel.dispose();dom.window.dispatchEvent(new dom.window.Event('focus'));await tick();
    assert.equal(ports.length,3);assert.equal(timers.size,0);
  } finally {panel.dispose();dom.window.close();}
});
