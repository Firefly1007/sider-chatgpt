import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionManager } from '../src/background/session-manager.js';
import { frameRule, FRAME_RULE_ID } from '../src/background/dnr.js';
import { buildPrompt } from '../src/features/prompts.js';
import { DEFAULT_SETTINGS, resolveMode, validateSettings } from '../src/shared/settings.js';

const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, fire(...args) { for (const fn of this.listeners) fn(...args); } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const source = (tabId = 1, frameId = 0) => ({ id: 'extension-id', url: 'https://example.com/page', tab: { id: tabId, windowId: 3 }, frameId, documentId: `source-${tabId}-${frameId}` });
const input = (action = 'ask') => ({ action, origin: 'selection', selectedText: 'private page content' });
const msg = (type, rest = {}) => ({ channel: 'cgp', type, ...rest });
function fixture(overrides = {}) {
  const calls = [];
  const records = new Map([[1, { id: 1, url: 'https://example.com/page', windowId: 3, active: true }]]);
  let next = 100;
  let nextFrame = 20, hiddenExists = false;
  const frames = new Map();
  let manager, hiddenHost;
  let active = 1;
  const local = { settings: overrides.settings }, sessionStorage = { ...overrides.sessionStorage };
  const chrome = {
    runtime: { async getContexts() { return hiddenExists ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []; },
      async sendMessage(message) { calls.push(['runtimeSend', message]); if (message.type === 'OFFSCREEN_CONNECT') connectHost(); }, id: 'extension-id', getURL: (path) => `chrome-extension://extension-id/${path}`, onMessage: event(), onConnect: event(), onStartup: event(), onInstalled: event() },
    offscreen: {
      async createDocument(value) { calls.push(['offscreenCreate', value]); if (overrides.offscreenError) throw overrides.offscreenError; hiddenExists = true; connectHost(); },
      async closeDocument() { calls.push(['offscreenClose']); hiddenExists = false; for (const frame of frames.values()) frame.port.disconnect(); frames.clear(); hiddenHost?.disconnect(); },
    },
    storage: {
      local: { async get() { return local; }, async set(value) { Object.assign(local, value); } },
      session: { async get() { return sessionStorage; }, async set(value) { Object.assign(sessionStorage, value); calls.push(['persist', structuredClone(value)]); } },
    },
    declarativeNetRequest: { async updateDynamicRules(value) { calls.push(['dnr', value]); } },
    sidePanel: { onOpened: event(), onClosed: event(), async setPanelBehavior(value) { calls.push(['panelBehavior', value]); }, async open(value) { calls.push(['openPanel', value]); } },
    action: { onClicked: event(), async setTitle(value) { calls.push(['title', value]); } },
    webNavigation: { onCommitted: event() },
    tabs: {
      onRemoved: event(), onUpdated: event(),
      async create(value) {
        calls.push(['create', value]);
        if (overrides.create) await overrides.create();
        const tab = { id: next++, url: value.url, windowId: 3, active: value.active };
        records.set(tab.id, tab);
        return tab;
      },
      async get(id) { if (!records.has(id)) throw new Error('Missing tab'); return records.get(id); },
      async query(query) { return [...records.values()].filter((tab) => (!query.active || tab.id === active)
        && (query.windowId === undefined || tab.windowId === query.windowId)); },
      async remove(id) { records.delete(id); calls.push(['remove', id]); },
      async sendMessage(id, message, target) {
        calls.push(['send', id, message, target]);
        if (overrides.send) { const response = await overrides.send(id, message); if (response !== undefined) return response; }
        if (message.type === 'GET_VIEWPORT') return { ok: true, viewport: { width: 900, height: 600, devicePixelRatio: 2 } };
        if (message.type === 'EXTRACT_PAGE') return { ok: true, material: { text: 'body', title: 'Page', url: 'https://example.com/page' } };
        if (message.type === 'EXTRACT_SELECTION') return { ok: true, selectedText: '选中内容\n第二行' };
        return { ok: true };
      },
      async captureVisibleTab(windowId, value) { calls.push(['capture', windowId, value]); if (overrides.capture) return overrides.capture(); return 'data:image/png;base64,AA=='; },
    },
  };
  let id = 0;
  const managerOptions = {
    uuid: overrides.uuid || (() => `uuid-${++id}`), delay: async () => { await new Promise((resolve) => setImmediate(resolve)); }, probeAttempts: 2,
    buildPrompt: (value) => { if (!value.action) throw new Error('Missing action'); return value.question || value.selectedText || ''; },
    resolveMode: (value, settings) => value.mode || settings.manualMode || 'high',
    validateSettings: (patch) => { if (!patch || typeof patch !== 'object') throw new Error('Invalid patch'); return patch; },
    ...(overrides.realFeatures ? { defaultSettings: DEFAULT_SETTINGS, buildPrompt, resolveMode, validateSettings } : {}),
  };
  manager = createSessionManager(chrome, managerOptions);
  function makeFrame(token, id = nextFrame++) {
    const port = { name: 'cgp-adapter', sender: { id: 'extension-id', origin: 'https://chatgpt.com', url: `https://chatgpt.com/?temporary-chat=true#cgp-frame=${token}` },
      onMessage: event(), onDisconnect: event(), output: [],
      disconnect() { this.disconnected = true; this.onDisconnect.fire(); },
      postMessage(message) {
        this.output.push(message);
        if (!message.rpcId) return;
        calls.push(['send', id, message, { port: true }]);
        (async () => {
          let result = await overrides.send?.(id, message);
          if (result === undefined) {
            if (message.type === 'ADAPTER_PROBE') result = { ok: true, state: { ready: true, loggedIn: true, temporary: true, busy: false, hasDraft: false, hasMessages: false, hasAttachments: false, capabilities: { modes: ['instant', 'high'] } } };
            else if (message.type === 'ADAPTER_CAPABILITIES') result = { ok: true, capabilities: { modes: ['instant', 'high'], unavailable: [{ mode: 'pro', label: 'Pro', reason: 'quota' }], currentMode: 'high' } };
            else if (message.type === 'ADAPTER_STOP') result = { ok: true, stopped: true };
            else result = { ok: true };
          }
          if (!this.disconnected) this.onMessage.fire(msg('PORT_RESPONSE', { rpcId: message.rpcId, result }));
        })();
      },
    };
    const frame = { id, token, used: false, port }; frames.set(id, frame);
    return frame;
  }
  function bind(frame) { manager.connect(frame.port); frame.port.onMessage.fire(msg('FRAME_READY', { token: frame.token })); }
  function connectHost() {
    hiddenHost = { name: 'cgp-offscreen-host', sender: { id: 'extension-id', origin: 'chrome-extension://extension-id', url: chrome.runtime.getURL('offscreen.html') },
      onMessage: event(), onDisconnect: event(), disconnect() { this.onDisconnect.fire(); },
      postMessage(message) {
        calls.push(['host', message]);
        (async () => {
          let result = await overrides.host?.(message);
          if (result === undefined) {
            const frame = [...frames.values()].find((frame) => frame.token === message.token);
            if (message.type === 'OFFSCREEN_SYNC') {
              let unused;
              for (const item of frames.values()) {
                if (item.used || unused) { frames.delete(item.id); item.port.disconnect(); }
                else unused = item;
              }
              result = { ok: true, frames: unused ? [{ token: unused.token }] : [] };
            } else if (message.type === 'OFFSCREEN_CREATE') {
              const created = makeFrame(message.token);
              Promise.resolve(overrides.create?.()).then(() => { if (frames.get(created.id) === created) bind(created); });
            } else if (message.type === 'OFFSCREEN_CLAIM') { if (frame) frame.used = true; }
            else if (message.type === 'OFFSCREEN_REMOVE') { if (frame) { frames.delete(frame.id); frame.port.disconnect(); } }
            else if (message.type === 'OFFSCREEN_REBIND') { if (frame) { frame.port = makeFrame(frame.token, frame.id).port; bind(frame); } }
          }
          this.onMessage.fire(msg('PORT_RESPONSE', { rpcId: message.rpcId, result: result || { ok: true } }));
        })();
      } };
    manager.connect(hiddenHost);
  }
  if (overrides.noOffscreen) delete chrome.offscreen;
  const commands = (type) => calls.filter((entry) => entry[0] === 'send' && entry[2].type === type);
  return { manager, chrome, calls, records, frames, sessionStorage, commands, bind, makeFrame,
    emit: (id, message) => frames.get(id)?.port.onMessage.fire(message),
    hiddenHost: () => hiddenHost,
    restart() {
      hiddenHost.onMessage.listeners = []; hiddenHost.onDisconnect.listeners = [];
      for (const frame of frames.values()) { frame.port.onMessage.listeners = []; frame.port.onDisconnect.listeners = []; }
      manager = createSessionManager(chrome, managerOptions); this.manager = manager;
      return manager;
    }, setActive: (id) => { active = id; } };

}

test('late cancelled probe cannot clear the endpoint reused by a later followup', async () => {
  const oldProbe = deferred(), newProbe = deferred(); let probes = 0;
  const f = fixture({ send: (id, message) => message.type === 'ADAPTER_PROBE'
    ? (++probes === 2 ? oldProbe.promise : probes === 3 ? newProbe.promise : undefined) : undefined });
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  const native = f.commands('ADAPTER_RUN')[0];
  f.emit(native[1], msg('TASK_EVENT', { sessionId: started.sessionId, requestId: started.requestId, state: 'completed', text: 'First answer' }));
  await f.manager.handle(msg('FOLLOW_UP', { sessionId: started.sessionId, question: 'cancel this round' }), source());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(probes, 2);
  const stopped = await f.manager.handle(msg('STOP_TASK', { sessionId: started.sessionId }), source());
  assert.equal(stopped.sessionUsable, true);
  const next = await f.manager.handle(msg('FOLLOW_UP', { sessionId: started.sessionId, question: 'keep this round' }), source());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(probes, 3);
  const ready = { ok: true, state: { ready: true, loggedIn: true, busy: false, hasDraft: false } };
  oldProbe.resolve(ready);
  await new Promise(resolve => setImmediate(resolve));
  newProbe.resolve(ready); await f.manager.drain();
  assert.equal(f.frames.has(native[1]), true);
  assert.equal(f.commands('ADAPTER_RUN').length, 2);
  assert.equal(f.commands('ADAPTER_RUN').at(-1)[2].requestId, next.requestId);
  assert.equal(f.commands('TASK_EVENT').some(call => call[2].requestId === next.requestId && call[2].state === 'failed'), false);
  await f.manager.handle(msg('CLOSE_SESSION', { sessionId: started.sessionId }), source());
});

test('stopping followup preparation retains the established conversation after its probe settles', async () => {
  const held = deferred(); let probes = 0;
  const f = fixture({ send: (id, message) => message.type === 'ADAPTER_PROBE' && ++probes === 2 ? held.promise : undefined });
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  f.emit(20, msg('TASK_EVENT', { sessionId: started.sessionId, requestId: started.requestId, state: 'completed', text: 'answer' }));
  await f.manager.handle(msg('FOLLOW_UP', { sessionId: started.sessionId, question: 'cancel' }), source());
  await new Promise(resolve => setImmediate(resolve));
  const stopped = await f.manager.handle(msg('STOP_TASK', { sessionId: started.sessionId }), source());
  assert.equal(stopped.sessionUsable, true);
  held.resolve({ ok: true, state: { ready: true, loggedIn: true } }); await f.manager.drain();
  assert.equal(f.frames.has(20), true);
  assert.equal(f.commands('TASK_EVENT').at(-1)[2].state, 'stopped');
  await f.manager.handle(msg('FOLLOW_UP', { sessionId: started.sessionId, question: 'continue' }), source());
  await f.manager.drain();
  assert.equal(f.commands('ADAPTER_RUN').at(-1)[1], 20);
  assert.equal(f.commands('ADAPTER_RUN').length, 2);
  await f.manager.handle(msg('CLOSE_SESSION', { sessionId: started.sessionId }), source());
});

test('stopping before the first native submission requires a fresh task instead of a followup', async () => {
  const probe = deferred();
  const f = fixture({ send: (id, message) => message.type === 'ADAPTER_PROBE' ? probe.promise : undefined });
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await new Promise(resolve => setImmediate(resolve));
  const stopped = await f.manager.handle(msg('STOP_TASK', { sessionId: started.sessionId }), source());
  assert.equal(stopped.sessionUsable, false);
  const follow = await f.manager.handle(msg('FOLLOW_UP', { sessionId: started.sessionId, question: 'next' }), source());
  assert.equal(follow.error.code, 'SESSION_NOT_STARTED');
  probe.resolve({ ok: true, state: { ready: true, loggedIn: true } });
  await f.manager.drain();
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
  await f.manager.handle(msg('CLOSE_SESSION', { sessionId: started.sessionId }), source());
});

test('DNR strips frame-blocking headers from HTTPS ChatGPT subframes', () => {
  const rule = frameRule();
  assert.equal(rule.id, FRAME_RULE_ID);
  // An initiatorDomains condition never matched extension-initiated subframes in
  // Chrome, which left the hidden offscreen frame ERR_BLOCKED_BY_RESPONSE; the
  // rule must stay scoped by URL and resource type only.
  assert.equal(rule.condition.initiatorDomains, undefined);
  assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
  assert.ok(new RegExp(rule.condition.regexFilter).test('https://chatgpt.com/'));
  assert.ok(!new RegExp(rule.condition.regexFilter).test('https://chatgpt.com.evil.example/'));
});

test('selection search claims hidden frame without opening sidebar; metadata has no content', async () => {
  const f = fixture();
  const result = await f.manager.handle(msg('START_TASK', { input: input('search') }), source());
  assert.equal(result.ok, true);
  await f.manager.drain();
  assert.equal(f.commands('ADAPTER_RUN')[0][2].search, true);
  assert.equal(f.commands('ADAPTER_RUN')[0][2].temporary, true);
  assert.equal(f.calls.some((entry) => entry[0] === 'create'), false);
  assert.equal([...f.frames.values()].filter((frame) => !frame.used).length, 1);
  assert.equal(f.calls.filter((entry) => entry[0] === 'openPanel').length, 0);
  assert.equal(JSON.stringify(f.sessionStorage).includes('private page content'), false);
  assert.deepEqual(f.calls.find((entry) => entry[0] === 'panelBehavior')[1], { openPanelOnActionClick: false });
});

test('stop while hidden frame binding is pending prevents sending and removes reserved frame', async () => {
  const creation = deferred();
  const f = fixture({ create: () => creation.promise });
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.handle(msg('STOP_TASK', { sessionId: started.sessionId }), source());
  creation.resolve();
  await f.manager.drain();
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
  assert.equal(f.frames.has(20), false);
  assert.equal([...f.frames.values()].filter((frame) => !frame.used).length, 1);
});

test('close during probe prevents run and rejects late output', async () => {
  const probe = deferred();
  const f = fixture({ send: async (id, message) => message.type === 'ADAPTER_PROBE' ? probe.promise : undefined });
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await new Promise((resolve) => setImmediate(resolve));
  await f.manager.handle(msg('CLOSE_SESSION', { sessionId: started.sessionId }), source());
  probe.resolve({ ok: true, state: { ready: true, loggedIn: true } });
  await f.manager.drain();
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
  const late = await f.manager.handle(msg('TASK_EVENT', { ...started, state: 'completed', text: 'late' }),
    { id: 'extension-id', tab: { id: 20 }, frameId: 0, url: 'https://chatgpt.com/' });
  assert.equal(late.accepted, false);
});

test('replacement invalidates old request and removes only its hidden frame', async () => {
  const f = fixture();
  f.records.set(9, { id: 9, url: 'https://chatgpt.com/c/user-conversation', windowId: 3 });
  const first = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  const second = await f.manager.handle(msg('START_TASK', { input: input('search') }), source());
  await f.manager.drain();
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(f.frames.has(20), false);
  assert.equal(f.frames.has(21), true);
  assert.equal(f.records.has(9), true);
  const late = await f.manager.handle(msg('TASK_EVENT', { ...first, state: 'streaming' }),
    { id: 'extension-id', tab: { id: 20 }, frameId: 0, url: 'https://chatgpt.com/' });
  assert.equal(late.accepted, false);
});

test('follow-up reuses hidden frame and inherits search and mode', async () => {
  const f = fixture();
  const started = await f.manager.handle(msg('START_TASK', { input: { ...input('search'), mode: 'instant' } }), source());
  await f.manager.drain();
  f.emit(20, msg('TASK_EVENT', { sessionId: started.sessionId, requestId: started.requestId, state: 'waiting' }));
  await f.manager.handle(msg('STOP_TASK', { sessionId: started.sessionId }), source());
  const follow = await f.manager.handle(msg('FOLLOW_UP', { sessionId: started.sessionId, question: 'Next question' }), source());
  await f.manager.drain();
  assert.equal(follow.sessionId, started.sessionId);
  assert.notEqual(follow.requestId, started.requestId);
  assert.equal(f.calls.filter((entry) => entry[0] === 'create').length, 0);
  assert.equal(f.calls.filter((entry) => entry[0] === 'host' && entry[1].type === 'OFFSCREEN_CREATE').length, 2);
  const run = f.commands('ADAPTER_RUN').at(-1)[2];
  assert.equal(run.followup, true);
  assert.equal(run.search, true);
  assert.equal(run.mode, 'instant');
  assert.equal(run.prompt, 'Next question');
});

test('hidden events require the bound Port and execution identity; foreign source cannot stop', async () => {
  const f = fixture();
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  assert.equal((await f.manager.handle(msg('TASK_EVENT', { ...started, state: 'streaming' }), f.frames.get(20).port.sender)).accepted, false);
  f.emit(21, msg('TASK_EVENT', { ...started, state: 'completed', text: 'foreign frame' }));
  f.emit(20, msg('TASK_EVENT', { ...started, requestId: 'foreign-request', state: 'completed' }));
  assert.equal((await f.manager.handle(msg('STOP_TASK', { sessionId: started.sessionId }), source(2))).ok, false);
  f.emit(20, msg('TASK_EVENT', { ...started, state: 'waiting' }));
  await f.manager.drain();
  assert.equal(f.commands('TASK_EVENT').at(-1)[2].state, 'waiting');
  f.emit(20, msg('TASK_EVENT', { ...started, state: 'completed', text: 'real' }));
  await f.manager.drain();
  assert.equal(f.commands('TASK_EVENT').at(-1)[2].text, 'real');
});

test('disable removes frame rule and hidden document; rejects subsequent tasks', async () => {
  const f = fixture();
  await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  await f.manager.handle(msg('UPDATE_SETTINGS', { patch: { enabled: false } }), source());
  await f.manager.drain();
  assert.deepEqual(f.calls.filter((entry) => entry[0] === 'dnr').at(-1)[1], { removeRuleIds: [FRAME_RULE_ID], addRules: [] });
  assert.equal(f.frames.has(20), false);
  assert.equal((await f.manager.handle(msg('START_TASK', { input: input() }), source())).error.code, 'DISABLED');
});

test('worker restart reports lost context without replaying page text', async () => {
  const f = fixture({ sessionStorage: { cgpSessionMetadata: [{ sessionId: 'old', requestId: 'old-request', source: { key: 'tab:1:0', tabId: 1, frameId: 0 } }] } });
  await f.manager.initialized;
  assert.equal(f.commands('TASK_EVENT')[0][2].state, 'interrupted');
  assert.equal(f.commands('TASK_EVENT')[0][2].error.code, 'WORKER_RESTARTED');
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
  assert.deepEqual(f.sessionStorage.cgpSessionMetadata, []);
});

test('connected but unready page reports observed title and login controls without sending or masking failure on restart', async () => {
  for (const loginRequired of [false, true]) {
    const f = fixture({ send: (_id, message) => message.type === 'ADAPTER_PROBE'
      ? { ok: true, state: { ready: false, loggedIn: false, loginRequired, hasComposer: false, pageTitle: '请稍候…' } } : undefined });
    await f.manager.handle(msg('START_TASK', { input: input() }), source());
    await f.manager.drain();
    const error = f.commands('TASK_EVENT').at(-1)[2].error;
    assert.equal(error.code, loginRequired ? 'LOGIN_REQUIRED' : 'ADAPTER_NOT_READY');
    assert.match(error.message, loginRequired ? /要求登录/ : /网页已连接.*请稍候.*输入框：未找到.*登录：未确认/);
    assert.equal(f.commands('ADAPTER_RUN').length, 0);
    assert.deepEqual(f.sessionStorage.cgpSessionMetadata, [], 'failed tasks must not be relabeled as background restart failures');
    const events = f.commands('TASK_EVENT').length;
    await f.restart().initialized;
    await f.manager.drain();
    assert.equal(f.commands('TASK_EVENT').length, events);
  }
});

test('capability lookup preserves connected-page readiness diagnostics', async () => {
  const f = fixture({ send: (_id, message) => message.type === 'ADAPTER_PROBE'
    ? { ok: true, state: { ready: false, loggedIn: false, hasComposer: false, pageTitle: '请稍候…' } } : undefined });
  const result = await f.manager.handle(msg('GET_CAPABILITIES'), source());
  assert.equal(result.error.code, 'ADAPTER_NOT_READY');
  assert.match(result.error.message, /网页已连接.*请稍候/);
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
});

test('offscreen frame token still binds when Chrome omits the URL fragment from sender metadata', async () => {
  const f = fixture();
  await f.manager.initialized;
  const idle = f.frames.get(20), frame = f.makeFrame(idle.token, 99);
  idle.port.disconnect();
  frame.port.sender.url = 'https://chatgpt.com/?temporary-chat=true';
  f.manager.connect(frame.port);
  frame.port.onMessage.fire(msg('FRAME_READY', { token: frame.token }));
  assert.equal(frame.port.output[0].type, 'FRAME_BOUND');
  assert.equal(frame.port.output[0].hostType, 'offscreen');
});

test('sidepanel frame requires unpredictable token plus trusted browser sender; port replies route to bound source', async () => {
  const f = fixture();
  await f.manager.initialized;
  const hostSender = { id: 'extension-id', url: f.chrome.runtime.getURL('sidepanel.html'), documentId: 'panel-document' };
  const token = (await f.manager.handle(msg('SIDEPANEL_READY'), hostSender)).token;
  const makePort = (name, sender) => ({ name, sender, onMessage: event(), onDisconnect: event(), output: [], postMessage(message) { this.output.push(message); }, disconnect() { this.disconnected = true; } });
  const host = makePort('cgp-sidepanel-host', hostSender);
  f.manager.connect(host);
  await f.manager.drain();
  assert.equal((await f.manager.handle(msg('SIDEPANEL_KEEPALIVE'), hostSender)).ok, true);
  assert.equal((await f.manager.handle(msg('SIDEPANEL_KEEPALIVE'), source())).error.code, 'INVALID_SOURCE');
  assert.equal((await f.manager.handle(msg('SIDEPANEL_KEEPALIVE'), { ...hostSender, documentId: 'unregistered' })).error.code, 'INVALID_SOURCE');
  const frame = makePort('cgp-adapter', { id: 'extension-id', url: `https://chatgpt.com/#cgp-frame=${token}`, frameId: 2, documentId: 'frame-document' });
  f.manager.connect(frame);
  frame.onMessage.fire(msg('FRAME_READY', { token }));
  assert.equal(frame.output[0].type, 'FRAME_BOUND');
  assert.equal(frame.output[0].hostType, 'sidepanel');
  const originalPost = frame.postMessage;
  frame.postMessage = function(message) {
    originalPost.call(this, message);
    if (message.rpcId) queueMicrotask(() => frame.onMessage.fire(msg('PORT_RESPONSE', { rpcId: message.rpcId, result: message.type === 'ADAPTER_PROBE'
      ? { ok: true, state: { ready: true, loggedIn: true, temporary: true } } : { ok: true } })));
  };
  const started = await f.manager.handle(msg('START_TASK', { input: { action: 'ask', origin: 'sidepanel', question: 'Hello' } }), hostSender);
  await f.manager.drain();
  assert.equal(started.ok, true);
  assert.equal(f.calls.filter((entry) => entry[0] === 'create').length, 0);
  const nativeRun = frame.output.find((message) => message.type === 'ADAPTER_RUN');
  assert.equal(nativeRun.temporary, false);
  assert.equal(nativeRun.followup, false);
  assert.equal((await f.manager.handle(msg('ATTACH_CURRENT_PAGE', { tabId: 1 }), hostSender)).ok, true);
  const pageInput = frame.output.findLast(message => message.type === 'ADAPTER_SIDEBAR_INPUT');
  assert.equal(pageInput.send, true); assert.match(pageInput.text, /body/); assert.match(pageInput.text, /已附加当前网页的内容/);
  assert.equal((await f.manager.handle(msg('APPEND_SELECTION', { tabId: 1 }), hostSender)).error.code, 'INVALID_SOURCE');
  const beforeInputs = frame.output.filter(message => message.type === 'ADAPTER_SIDEBAR_INPUT').length;
  assert.equal((await f.manager.handle(msg('ATTACH_CURRENT_PAGE', { tabId: 1 }), source())).error.code, 'INVALID_SOURCE');
  assert.equal((await f.manager.handle(msg('APPEND_SELECTION', { tabId: 999 }), hostSender)).error.code, 'INVALID_SOURCE');
  assert.equal(frame.output.filter(message => message.type === 'ADAPTER_SIDEBAR_INPUT').length, beforeInputs);
  const diagram = { svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>native diagram</text></svg>' };
  frame.onMessage.fire(msg('TASK_EVENT', { ...started, state: 'completed', text: 'native answer', diagram }));
  await f.manager.drain();
  assert.equal(host.output.at(-1).text, 'native answer');
  assert.deepEqual(host.output.at(-1).diagram, diagram);
  const ordinary = makePort('cgp-adapter', { id: 'extension-id', url: `https://chatgpt.com/#cgp-frame=${token}`, frameId: 0, tab: { id: 9 } });
  f.manager.connect(ordinary);
  ordinary.onMessage.fire(msg('FRAME_READY', { token }));
  assert.equal(ordinary.disconnected, true);
});

test('top-level page selection appends the live selection only to its unique open same-window sidebar', async () => {
  const f = fixture({ send: (_id, message) => message.type === 'EXTRACT_SELECTION'
    ? { ok: true, selectedText: '页面实际选区\n第二行' } : undefined });
  await f.manager.initialized;
  f.records.set(2, { id: 2, url: 'https://other.example/page', windowId: 4, active: false });
  const query = (sender) => f.manager.handle(msg('GET_SIDEPANEL_STATE'), sender);
  assert.deepEqual(await query(source()), { ok: true, open: false });

  const connectPanel = async (windowId, documentId) => {
    const sender = { id: 'extension-id', url: f.chrome.runtime.getURL('sidepanel.html'), documentId };
    const ready = deferred();
    const port = { name: 'cgp-sidepanel-host', sender, onMessage: event(), onDisconnect: event(), output: [],
      postMessage(message) { this.output.push(message); if (message.type === 'PORT_RESPONSE' && message.rpcId === `panel-${documentId}`) ready.resolve(message.result); },
      disconnect() { this.disconnected = true; this.onDisconnect.fire(); } };
    f.manager.connect(port);
    port.onMessage.fire(msg('SIDEPANEL_READY', { windowId, rpcId: `panel-${documentId}` }));
    const result = await ready.promise;
    return { port, token: result.token };
  };
  const panel = await connectPanel(3, 'panel-window-3');
  await f.manager.drain();
  assert.equal((await query(source())).open, true, 'A connected panel counts as open before its frame is ready');
  assert.equal((await f.manager.handle(msg('APPEND_SELECTION'), source())).error.code, 'FRAME_NOT_READY');

  const frame = { name: 'cgp-adapter', sender: { id: 'extension-id', url: `https://chatgpt.com/#cgp-frame=${panel.token}`, frameId: 2 },
    onMessage: event(), onDisconnect: event(), output: [],
    postMessage(message) { this.output.push(message); if (message.rpcId) queueMicrotask(() => this.onMessage.fire(msg('PORT_RESPONSE', { rpcId: message.rpcId, result: { ok: true } }))); },
    disconnect() { this.disconnected = true; this.onDisconnect.fire(); } };
  f.manager.connect(frame); frame.onMessage.fire(msg('FRAME_READY', { token: panel.token }));
  const beforeRuns = f.commands('ADAPTER_RUN').length;
  const appended = await f.manager.handle(msg('APPEND_SELECTION', { selectedText: '伪造内容' }), source());
  assert.equal(appended.ok, true);
  const input = frame.output.findLast((message) => message.type === 'ADAPTER_SIDEBAR_INPUT');
  assert.deepEqual({ send: input.send, text: input.text }, { send: false, text: '> 页面实际选区\n> 第二行\n\n' });
  const extraction = f.calls.findLast((call) => call[0] === 'send' && call[2].type === 'EXTRACT_SELECTION');
  assert.equal(extraction[1], 1);
  assert.deepEqual(extraction[3], { frameId: 0 });
  assert.equal(f.commands('ADAPTER_RUN').length, beforeRuns, 'Appending a selection must not send a model request');

  const extractionCount = f.calls.filter((call) => call[0] === 'send' && call[2].type === 'EXTRACT_SELECTION').length;
  assert.equal((await f.manager.handle(msg('APPEND_SELECTION', { tabId: 2 }), source())).error.code, 'INVALID_TAB');
  assert.equal(f.calls.filter((call) => call[0] === 'send' && call[2].type === 'EXTRACT_SELECTION').length, extractionCount);
  f.records.set(3, { id: 3, url: 'https://active.example/page', windowId: 3, active: true });
  f.setActive(3);
  assert.equal((await f.manager.handle(msg('APPEND_SELECTION'), source())).error.code, 'TAB_CHANGED');
  assert.equal(f.calls.filter((call) => call[0] === 'send' && call[2].type === 'EXTRACT_SELECTION').length, extractionCount);
  f.setActive(1);

  const panelSender = { id: 'extension-id', url: f.chrome.runtime.getURL('sidepanel.html'), documentId: 'panel-window-3' };
  for (const sender of [{ ...source(), id: 'foreign-extension' }, { ...source(), frameId: 1 }, panelSender]) {
    assert.equal((await query(sender)).error.code, 'INVALID_SOURCE');
    assert.equal((await f.manager.handle(msg('APPEND_SELECTION'), sender)).error.code, 'INVALID_SOURCE');
  }

  await f.manager.panelClosed({ windowId: 3 });
  await f.manager.drain();
  assert.deepEqual(await query(source()), { ok: true, open: false });
  assert.equal((await f.manager.handle(msg('APPEND_SELECTION'), source())).error.code, 'SIDEBAR_NOT_OPEN');
  assert.equal(f.calls.filter((call) => call[0] === 'send' && call[2].type === 'SIDEPANEL_STATE_CHANGED').at(-1)[2].open, false);
  await f.manager.panelOpened({ windowId: 3 });
  assert.deepEqual(await query(source()), { ok: true, open: true });
  panel.port.disconnect(); await f.manager.drain();
  assert.deepEqual(await query(source()), { ok: true, open: false });

  const other = await connectPanel(4, 'panel-window-4');
  await f.manager.drain();
  const source4 = { ...source(2), tab: { id: 2, windowId: 4 } };
  assert.equal((await query(source())).open, false, 'A sidebar in another window does not make this page sidebar-open');
  assert.equal((await query(source4)).open, true);
  assert.equal((await f.manager.handle(msg('APPEND_SELECTION'), source())).error.code, 'SIDEBAR_NOT_OPEN');
  const duplicate = await connectPanel(4, 'second-panel-window-4');
  assert.equal((await f.manager.handle(msg('APPEND_SELECTION'), source4)).error.code, 'SIDEBAR_AMBIGUOUS');
  other.port.disconnect(); duplicate.port.disconnect();
});

test('trusted sidebar reconnect reclaims its token and rejects runtime spoofing and token collisions', async () => {
  let tokenId = 0;
  const f = fixture({ uuid: () => `token-for-reconnect-${++tokenId}` }); await f.manager.initialized;
  const makeHost = (documentId) => {
    const sender = { id: 'extension-id', url: f.chrome.runtime.getURL('sidepanel.html'), documentId };
    const port = { name: 'cgp-sidepanel-host', sender, onMessage: event(), onDisconnect: event(), output: [], waiters: new Map(),
      postMessage(message) { this.output.push(message); this.waiters.get(message.rpcId)?.(message.result); }, disconnect() { this.disconnected = true; this.onDisconnect.fire(); } };
    f.manager.connect(port);
    return port;
  };
  let readyId = 0;
  const ready = (port, payload) => new Promise((resolve) => {
    const rpcId = `ready-${++readyId}`;
    port.waiters.set(rpcId, resolve);
    port.onMessage.fire(msg('SIDEPANEL_READY', { ...payload, rpcId }));
  });
  const first = makeHost('reconnect-host');
  const initial = await ready(first, { windowId: 3 });
  assert.equal(initial.ok, true);
  assert.equal(initial.frameReady, false);
  first.disconnect(); await f.manager.drain();

  const ordinarySender = { id: 'extension-id', url: f.chrome.runtime.getURL('sidepanel.html'), documentId: 'reconnect-host' };
  assert.equal((await f.manager.handle(msg('SIDEPANEL_READY', { token: initial.token }), ordinarySender)).error.code, 'INVALID_SOURCE');
  const restored = makeHost('reconnect-host');
  const reclaimed = await ready(restored, { windowId: 3, token: initial.token });
  assert.deepEqual({ ok: reclaimed.ok, token: reclaimed.token, frameReady: reclaimed.frameReady },
    { ok: true, token: initial.token, frameReady: false });
  assert.equal((await ready(restored, { windowId: 3, token: initial.token })).ok, true, 'Repeated READY may retain the same token');

  const collision = makeHost('other-host');
  assert.equal((await ready(collision, { windowId: 3, token: initial.token })).error.code, 'INVALID_TOKEN');
  assert.equal((await ready(collision, { windowId: 3, token: f.frames.get(20).token })).error.code, 'INVALID_TOKEN', 'A token owned by an offscreen slot cannot be reclaimed');
  assert.equal((await ready(restored, { windowId: 3, token: 'too-short' })).error.code, 'INVALID_TOKEN');
  assert.equal((await ready(restored, { windowId: 3, token: '0123456789abcdef' })).error.code, 'INVALID_TOKEN',
    'An established host cannot replace its adopted frame token');

  const frame = { name: 'cgp-adapter', sender: { id: 'extension-id', url: 'https://chatgpt.com/c/native-conversation', frameId: 2 },
    onMessage: event(), onDisconnect: event(), output: [],
    postMessage(message) { this.output.push(message); if (message.rpcId) queueMicrotask(() => this.onMessage.fire(msg('PORT_RESPONSE', { rpcId: message.rpcId, result: { ok: true } }))); },
    disconnect() { this.disconnected = true; this.onDisconnect.fire(); } };
  f.manager.connect(frame); frame.onMessage.fire(msg('FRAME_READY', { token: initial.token }));
  assert.deepEqual({ type: frame.output[0].type, hostType: frame.output[0].hostType }, { type: 'FRAME_BOUND', hostType: 'sidepanel' });
  assert.equal(restored.output.some((message) => message.type === 'SIDEPANEL_FRAME_BOUND'), true);
  assert.equal((await f.manager.handle(msg('APPEND_SELECTION'), source())).ok, true, 'Reclaimed frame remains a valid append target');
  assert.equal(frame.output.findLast((message) => message.type === 'ADAPTER_SIDEBAR_INPUT').send, false);
  frame.disconnect(); await f.manager.drain();
  assert.equal(restored.output.some((message) => message.type === 'SIDEPANEL_FRAME_LOST'), true);
  assert.equal((await f.manager.handle(msg('GET_SIDEPANEL_STATE'), source())).open, true);
  assert.equal((await f.manager.handle(msg('APPEND_SELECTION'), source())).error.code, 'FRAME_NOT_READY');
  collision.disconnect(); restored.disconnect();
});

test('native composer attach is port-bound, enabled-gated, and restored with the current sidebar frame', async () => {
  const f = fixture(); await f.manager.initialized;
  const sender = { id: 'extension-id', url: f.chrome.runtime.getURL('sidepanel.html'), documentId: 'composer-panel' };
  const replies = new Map();
  const panel = { name: 'cgp-sidepanel-host', sender, onMessage: event(), onDisconnect: event(), output: [],
    postMessage(message) { this.output.push(message); if (message.type === 'PORT_RESPONSE') replies.get(message.rpcId)?.resolve(message.result); },
    disconnect() { this.disconnected = true; this.onDisconnect.fire(); } };
  f.manager.connect(panel);
  let nextRpc = 0;
  const call = (type, payload = {}) => {
    const rpcId = `composer-rpc-${++nextRpc}`, response = deferred();
    replies.set(rpcId, response); panel.onMessage.fire(msg(type, { ...payload, rpcId }));
    return response.promise;
  };
  const ready = await call('SIDEPANEL_READY', { windowId: 3 });
  assert.equal(ready.ok, true);
  const registeredRuntimeSender = { ...sender };
  assert.equal((await f.manager.handle(msg('SET_SIDEPANEL_CONTROLS', { enabled: true }), registeredRuntimeSender)).error.code, 'INVALID_SOURCE');
  assert.equal((await call('SET_SIDEPANEL_CONTROLS', { enabled: 1 })).error.code, 'INVALID_INPUT');
  assert.equal((await call('SET_SIDEPANEL_CONTROLS', { enabled: true })).ok, true, 'Controls may be stored before the adapter binds');

  const bind = (frameId) => {
    const frame = { name: 'cgp-adapter', sender: { id: 'extension-id', url: `https://chatgpt.com/#cgp-frame=${ready.token}`, frameId },
      onMessage: event(), onDisconnect: event(), output: [],
      postMessage(message) { this.output.push(message); if (message.rpcId) queueMicrotask(() => this.onMessage.fire(msg('PORT_RESPONSE', { rpcId: message.rpcId, result: { ok: true } }))); },
      disconnect() { this.disconnected = true; this.onDisconnect.fire(); } };
    f.manager.connect(frame); frame.onMessage.fire(msg('FRAME_READY', { token: ready.token }));
    return frame;
  };
  const first = bind(2); await f.manager.drain();
  assert.deepEqual(first.output.filter((message) => message.type === 'ADAPTER_SIDEPANEL_CONTROLS').map((message) => message.enabled), [true]);
  const attachCount = () => panel.output.filter((message) => message.type === 'SIDEPANEL_ATTACH_CURRENT_PAGE').length;
  const sendsBefore = f.calls.filter((call) => call[0] === 'send' && call[2].type === 'EXTRACT_PAGE').length;
  first.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'));
  assert.equal(attachCount(), 1);
  assert.deepEqual(panel.output.findLast((message) => message.type === 'SIDEPANEL_ATTACH_CURRENT_PAGE'),
    { channel: 'cgp', type: 'SIDEPANEL_ATTACH_CURRENT_PAGE' });
  assert.equal(f.calls.filter((call) => call[0] === 'send' && call[2].type === 'EXTRACT_PAGE').length, sendsBefore,
    'The backend only relays the composer action and does not extract page text');
  assert.equal((await f.manager.handle(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'), source())).error.code, 'INVALID_SOURCE');

  assert.equal((await call('SET_SIDEPANEL_CONTROLS', { enabled: false })).ok, true);
  assert.deepEqual(first.output.filter((message) => message.type === 'ADAPTER_SIDEPANEL_CONTROLS').map((message) => message.enabled), [true, false]);
  first.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'));
  assert.equal(attachCount(), 1, 'Disabled native control requests are ignored');
  assert.equal((await call('SET_SIDEPANEL_CONTROLS', { enabled: true })).ok, true);
  first.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'));
  assert.equal(attachCount(), 2, 'Re-enabling controls restores the relay');

  const second = bind(3); await f.manager.drain();
  first.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'));
  assert.equal(attachCount(), 2, 'An old adapter endpoint cannot trigger the composer action after rebind');
  second.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'));
  assert.equal(attachCount(), 3);
  const hidden = f.frames.get(20).port;
  hidden.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'));
  assert.equal(attachCount(), 3, 'Offscreen adapters are not sidebar attach sources');
  const unknown = { name: 'cgp-adapter', sender: { id: 'extension-id', url: 'https://chatgpt.com/c/unbound', frameId: 2 },
    onMessage: event(), onDisconnect: event(), disconnect() { this.disconnected = true; } };
  f.manager.connect(unknown); unknown.onMessage.fire(msg('FRAME_READY', { token: 'unbound-token' }));
  unknown.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'));
  assert.equal(unknown.disconnected, true);
  assert.equal(attachCount(), 3);

  await f.manager.handle(msg('UPDATE_SETTINGS', { patch: { enabled: false } }), source());
  first.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE')); second.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'));
  assert.equal(attachCount(), 3, 'Disabled extension settings block composer requests');
  await f.manager.handle(msg('UPDATE_SETTINGS', { patch: { enabled: true } }), source());
  await f.manager.drain();
  second.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'));
  assert.equal(attachCount(), 4, 'The current bound frame can relay again after extension re-enable');
  await f.manager.panelClosed({ windowId: 3 });
  second.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'));
  assert.equal(attachCount(), 4, 'A closed native sidebar cannot receive the composer action even while its Port remains connected');
  await f.manager.panelOpened({ windowId: 3 });
  second.onMessage.fire(msg('SIDEPANEL_ATTACH_CURRENT_PAGE'));
  assert.equal(attachCount(), 5, 'Reopening the native sidebar restores the composer relay');
  panel.disconnect();
});

test('existing execution draft blocks sends instead of clearing or replacing it', async () => {
  const f = fixture({ send: async (id, message) => message.type === 'ADAPTER_PROBE'
    ? { ok: true, state: { ready: true, loggedIn: true, hasDraft: true } } : undefined });
  await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
  assert.equal(f.commands('TASK_EVENT').at(-1)[2].error.code, 'EXECUTION_BUSY');
});

test('real prompt/settings integration applies translation default and follow-up omits prior material', async () => {
  const f = fixture({ realFeatures: true });
  const started = await f.manager.handle(msg('START_TASK', { input: input('translate') }), source());
  assert.equal(started.ok, true);
  await f.manager.drain();
  const initial = f.commands('ADAPTER_RUN')[0][2];
  assert.ok(initial.prompt.includes('中文'));
  assert.equal(initial.mode, 'instant');
  f.emit(20, msg('TASK_EVENT', { sessionId: started.sessionId, requestId: started.requestId, state: 'waiting' }));
  await f.manager.handle(msg('STOP_TASK', { sessionId: started.sessionId }), source());
  const follow = await f.manager.handle(msg('FOLLOW_UP', { sessionId: started.sessionId, question: 'Explain a term', mode: 'medium' }), source());
  assert.equal(follow.ok, true);
  await f.manager.drain();
  const next = f.commands('ADAPTER_RUN').at(-1)[2];
  assert.ok(next.prompt.includes('Explain a term'));
  assert.ok(!next.prompt.includes('private page content'));
  assert.ok(next.prompt.includes('请简短回答'));
  assert.equal(next.mode, 'medium', 'Translation follow-ups honor the manually selected mode');
  assert.equal(next.sessionId, initial.sessionId);
  await f.manager.handle(msg('STOP_TASK', { sessionId: started.sessionId }), source());
  await f.manager.handle(msg('FOLLOW_UP', { sessionId: started.sessionId, question: 'One more term' }), source());
  await f.manager.drain();
  assert.equal(f.commands('ADAPTER_RUN').at(-1)[2].mode, 'medium', 'Omitted mode keeps the last manual selection');
});

test('capabilities claim hidden transient probe and always clean it without sending', async () => {
  const f = fixture();
  const result = await f.manager.handle(msg('GET_CAPABILITIES'), source());
  await f.manager.drain();
  assert.equal(result.ok, true);
  assert.deepEqual(result.capabilities.modes, ['instant', 'high']);
  assert.equal(result.capabilities.unavailable[0].reason, 'quota');
  assert.equal(f.calls.some((entry) => entry[0] === 'create'), false);
  assert.equal([...f.frames.values()].filter((frame) => !frame.used).length, 1);
  assert.equal(f.frames.has(20), false);
  assert.equal(f.commands('ADAPTER_CAPABILITIES').length, 1);
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
  assert.deepEqual(f.sessionStorage.cgpSessionMetadata, []);
});

test('capability probe failure still removes transient frame', async () => {
  const f = fixture({ send: async (id, message) => message.type === 'ADAPTER_CAPABILITIES'
    ? { ok: false, error: { code: 'MODEL_CONTROL_UNAVAILABLE', message: 'No supported menu' } } : undefined });
  const result = await f.manager.handle(msg('GET_CAPABILITIES'), source());
  await f.manager.drain();
  assert.equal(result.error.code, 'MODEL_CONTROL_UNAVAILABLE');
  assert.equal(f.frames.has(20), false);
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
});

test('source navigation during pending capability frame binding cancels and removes reserved frame', async () => {
  const creation = deferred();
  const f = fixture({ create: () => creation.promise });
  const resultPromise = f.manager.handle(msg('GET_CAPABILITIES'), source());
  await new Promise((resolve) => setImmediate(resolve));
  f.manager.tabUpdated(1, { status: 'loading' });
  creation.resolve();
  const result = await resultPromise;
  await f.manager.drain();
  assert.equal(result.error.code, 'CANCELLED');
  assert.equal(f.frames.has(20), false);
  assert.equal(f.commands('ADAPTER_CAPABILITIES').length, 0);
});

test('disable while capability discovery is pending discards result and closes hidden document', async () => {
  const discovery = deferred();
  const f = fixture({ send: async (id, message) => message.type === 'ADAPTER_CAPABILITIES' ? discovery.promise : undefined });
  const resultPromise = f.manager.handle(msg('GET_CAPABILITIES'), source());
  await new Promise((resolve) => setImmediate(resolve));
  await f.manager.handle(msg('UPDATE_SETTINGS', { patch: { enabled: false } }), source());
  discovery.resolve({ ok: true, capabilities: { modes: ['instant'], unavailable: [], currentMode: 'instant' } });
  const result = await resultPromise;
  await f.manager.drain();
  assert.equal(result.error.code, 'CANCELLED');
  assert.equal(f.frames.has(20), false);
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
});

test('capabilities reuse idle session; active reply uses cached capabilities without touching menus', async () => {
  const f = fixture();
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  const active = await f.manager.handle(msg('GET_CAPABILITIES', { sessionId: started.sessionId }), source());
  assert.equal(active.ok, true);
  assert.equal(f.commands('ADAPTER_CAPABILITIES').length, 0);
  await f.manager.handle(msg('STOP_TASK', { sessionId: started.sessionId }), source());
  const idle = await f.manager.handle(msg('GET_CAPABILITIES', { sessionId: started.sessionId }), source());
  assert.equal(idle.ok, true);
  assert.equal(f.commands('ADAPTER_CAPABILITIES').length, 1);
  assert.equal(f.calls.filter((entry) => entry[0] === 'create').length, 0);
  assert.equal(f.calls.filter((entry) => entry[0] === 'host' && entry[1].type === 'OFFSCREEN_CREATE').length, 2);
  assert.equal(f.frames.has(20), true);
});

test('hidden SPA conversation reply stays on its actual Port, frame reload interrupts owned work', async () => {
  const f = fixture();
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  const original = f.frames.get(20).port;
  f.emit(20, msg('TASK_EVENT', { ...started, state: 'streaming', text: 'SPA reply' }));
  await f.manager.drain();
  assert.equal(f.commands('TASK_EVENT').at(-1)[2].text, 'SPA reply');
  const reloaded = f.makeFrame(f.frames.get(20).token, 20); f.bind(reloaded);
  original.onMessage.fire(msg('TASK_EVENT', { ...started, state: 'completed', text: 'late' }));
  await f.manager.drain();
  assert.equal(f.commands('TASK_EVENT').at(-1)[2].state, 'interrupted');
});

test('unconfirmed native STOP reports warning, suppresses late output and blocks follow-up', async () => {
  const f = fixture({ send: async (id, message) => message.type === 'ADAPTER_STOP' ? { ok: true, stopped: false } : undefined });
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  const result = await f.manager.handle(msg('STOP_TASK', { sessionId: started.sessionId }), source());
  assert.equal(result.ok, true);
  assert.equal(result.stopped, false);
  assert.equal(result.warning.code, 'STOP_UNCONFIRMED');
  await f.manager.drain();
  assert.equal(f.commands('TASK_EVENT').at(-1)[2].state, 'interrupted');
  assert.equal((await f.manager.handle(msg('FOLLOW_UP', { sessionId: started.sessionId, question: 'next' }), source())).error.code, 'EXECUTION_LOST');
  assert.equal((await f.manager.handle(msg('TASK_EVENT', { ...started, state: 'streaming', text: 'late' }),
    { id: 'extension-id', tab: { id: 20 }, frameId: 0, url: 'https://chatgpt.com/' })).accepted, false);
});

test('close reports failed stop confirmation but still disposes and removes owned page', async () => {
  const f = fixture({ send: async (id, message) => message.type === 'ADAPTER_STOP'
    ? { ok: false, error: { code: 'EXECUTION_LOST', message: 'No adapter' } } : undefined });
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  const result = await f.manager.handle(msg('CLOSE_SESSION', { sessionId: started.sessionId }), source());
  assert.equal(result.stopped, false);
  assert.equal(result.warning.code, 'STOP_UNCONFIRMED');
  assert.equal(result.warning.cause, 'EXECUTION_LOST');
  assert.equal(f.commands('ADAPTER_DISPOSE').length, 1);
  assert.equal(f.frames.has(20), false);
  assert.equal((await f.manager.handle(msg('FOLLOW_UP', { sessionId: started.sessionId, question: 'next' }), source())).error.code, 'INVALID_SESSION');
});

test('completed session close confirms no outstanding generation without stopping later native work', async () => {
  const f = fixture();
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  f.emit(20, msg('TASK_EVENT', { ...started, state: 'completed' }));
  await f.manager.drain();
  const result = await f.manager.handle(msg('CLOSE_SESSION', { sessionId: started.sessionId }), source());
  assert.equal(result.stopped, true);
  assert.equal(f.commands('ADAPTER_STOP').length, 0);
});

test('token is registered before hidden CREATE can synchronously announce FRAME_READY', async () => {
  const f = fixture();
  await f.manager.initialized;
  assert.equal(f.frames.get(20).port.output[0].type, 'FRAME_BOUND');
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  f.emit(20, msg('TASK_EVENT', { ...started, state: 'completed' }));
  await f.manager.drain();
  assert.equal(f.commands('TASK_EVENT').at(-1)[2].state, 'completed');
});

test('theme messages reject foreign sources, unregistered sidebar documents and invalid themes', async () => {
  const f = fixture();
  const panel = { id: 'extension-id', url: f.chrome.runtime.getURL('sidepanel.html'), documentId: 'panel-document' };
  assert.deepEqual(await f.manager.handle(msg('PAGE_THEME_CHANGED', { theme: 'dark' }), source()), { ok: true });
  for (const sender of [panel, { ...source(), id: 'foreign-extension' }, { ...source(), url: 'https://chatgpt.com/' }, { ...source(), frameId: undefined }]) {
    assert.equal((await f.manager.handle(msg('PAGE_THEME_CHANGED', { theme: 'dark' }), sender)).error.code, 'INVALID_SOURCE');
  }
  assert.equal((await f.manager.handle(msg('SET_SIDEPANEL_THEME', { theme: 'dark' }), panel)).error.code, 'INVALID_SOURCE');
  await f.manager.handle(msg('SIDEPANEL_READY'), panel);
  for (const sender of [source(), { ...panel, documentId: 'other-document' }, { ...panel, url: f.chrome.runtime.getURL('options.html') }, { ...panel, id: 'foreign-extension' }]) {
    assert.equal((await f.manager.handle(msg('SET_SIDEPANEL_THEME', { theme: 'dark' }), sender)).error.code, 'INVALID_SOURCE');
  }
  for (const theme of ['auto', '', null, { dark: true }]) {
    assert.equal((await f.manager.handle(msg('SET_SIDEPANEL_THEME', { theme }), panel)).error.code, 'INVALID_THEME');
  }
  assert.equal(f.commands('ADAPTER_THEME').length, 0);
  assert.equal(f.calls.filter((call) => call[0] === 'send').length, 0);
});

test('sidebar theme waits for its token frame, reapplies after reload and never targets execution tabs', async () => {
  const f = fixture();
  const panel = { id: 'extension-id', url: f.chrome.runtime.getURL('sidepanel.html'), documentId: 'panel-document' };
  const token = (await f.manager.handle(msg('SIDEPANEL_READY'), panel)).token;
  assert.deepEqual(await f.manager.handle(msg('SET_SIDEPANEL_THEME', { theme: 'dark' }), panel), { ok: true });
  await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  const bind = (documentId) => {
    const frame = { name: 'cgp-adapter', sender: { id: 'extension-id', url: `https://chatgpt.com/#cgp-frame=${token}`, frameId: 2, documentId },
      onMessage: event(), onDisconnect: event(), output: [], disconnect() { this.disconnected = true; },
      postMessage(message) {
        this.output.push(message);
        if (message.rpcId) queueMicrotask(() => this.onMessage.fire(msg('PORT_RESPONSE', { rpcId: message.rpcId, result: { ok: true } })));
      } };
    f.manager.connect(frame);
    frame.onMessage.fire(msg('FRAME_READY', { token }));
    return frame;
  };
  const first = bind('first-frame');
  await f.manager.drain();
  assert.deepEqual(first.output.filter((message) => message.type === 'ADAPTER_THEME').map((message) => message.theme), ['dark']);
  assert.deepEqual(await f.manager.handle(msg('SET_SIDEPANEL_THEME', { theme: 'light' }), panel), { ok: true });
  assert.deepEqual(first.output.filter((message) => message.type === 'ADAPTER_THEME').map((message) => message.theme), ['dark', 'light']);
  const reloaded = bind('reloaded-frame');
  first.onDisconnect.fire();
  await f.manager.drain();
  assert.deepEqual(reloaded.output.filter((message) => message.type === 'ADAPTER_THEME').map((message) => message.theme), ['light']);
  assert.equal((await f.manager.handle(msg('SET_SIDEPANEL_THEME', { theme: 'dark' }), panel)).ok, true);
  assert.deepEqual(reloaded.output.filter((message) => message.type === 'ADAPTER_THEME').map((message) => message.theme), ['light', 'dark']);
  assert.equal(first.output.filter((message) => message.type === 'ADAPTER_THEME').length, 2);
  assert.equal(f.commands('ADAPTER_THEME').length, 0);
  assert.equal(f.commands('ADAPTER_RUN').length, 1);
  assert.equal(JSON.stringify(f.sessionStorage).includes('theme'), false);
});

test('native sidebar Ports without documentId own independent frames and revoke pending work on disconnect', async () => {
  const f = fixture();
  const sender = { id: 'extension-id', url: f.chrome.runtime.getURL('sidepanel.html') };
  let nextRpc = 0, heldCapability;
  const replies = new Map();
  const makePort = (name, from, answer) => ({ name, sender: from, onMessage: event(), onDisconnect: event(), output: [],
    postMessage(message) { this.output.push(message); answer?.(this, message); },
    disconnect() { this.disconnected = true; this.onDisconnect.fire(); } });
  const makeHost = () => {
    const port = makePort('cgp-sidepanel-host', sender, (_, message) => {
      if (message.type === 'PORT_RESPONSE') replies.get(message.rpcId)?.resolve(message.result);
    });
    f.manager.connect(port);
    return port;
  };
  const call = (port, type, payload = {}) => {
    const rpcId = `host-rpc-${++nextRpc}`, response = deferred();
    replies.set(rpcId, response); port.onMessage.fire(msg(type, { ...payload, rpcId }));
    return response.promise;
  };
  const bind = (token) => {
    const frame = makePort('cgp-adapter', { id: 'extension-id', url: `https://chatgpt.com/#cgp-frame=${token}`, frameId: 2 }, (port, message) => {
      if (!message.rpcId) return;
      if (message.type === 'ADAPTER_CAPABILITIES') { heldCapability = { port, message }; return; }
      queueMicrotask(() => port.onMessage.fire(msg('PORT_RESPONSE', { rpcId: message.rpcId,
        result: message.type === 'ADAPTER_PROBE' ? { ok: true, state: { ready: true, loggedIn: true } }
          : message.type === 'ADAPTER_STOP' ? { ok: true, stopped: true } : { ok: true } })));
    });
    f.manager.connect(frame); frame.onMessage.fire(msg('FRAME_READY', { token }));
    return frame;
  };
  const first = makeHost(), second = makeHost();
  const readyA = await call(first, 'SIDEPANEL_READY', { windowId: 3 }), readyB = await call(second, 'SIDEPANEL_READY', { windowId: 4 });
  assert.equal(readyA.ok, true); assert.equal(readyB.ok, true);
  assert.notEqual(readyA.token, readyB.token);
  const frameA = bind(readyA.token), frameB = bind(readyB.token);
  assert.equal(frameA.output[0].type, 'FRAME_BOUND'); assert.equal(frameB.output[0].type, 'FRAME_BOUND');
  await call(first, 'SET_SIDEPANEL_THEME', { theme: 'dark' });
  assert.equal(frameA.output.find((message) => message.type === 'ADAPTER_THEME').theme, 'dark');
  assert.equal(frameB.output.some((message) => message.type === 'ADAPTER_THEME'), false);
  const taskA = await call(first, 'START_TASK', { input: { action: 'ask', origin: 'sidepanel', question: 'first sidebar' } });
  const taskB = await call(second, 'START_TASK', { input: { action: 'ask', origin: 'sidepanel', question: 'second sidebar' } });
  await f.manager.drain();
  assert.equal((await call(second, 'STOP_TASK', { sessionId: taskA.sessionId })).error.code, 'INVALID_SESSION');
  frameA.onMessage.fire(msg('TASK_EVENT', { ...taskA, state: 'completed', text: 'first answer' }));
  await f.manager.drain();
  assert.equal(first.output.filter((message) => message.type === 'TASK_EVENT').at(-1).text, 'first answer');
  assert.equal(second.output.some((message) => message.text === 'first answer'), false);
  call(first, 'GET_CAPABILITIES');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(heldCapability);
  const before = first.output.length;
  first.onMessage.fire(msg('START_TASK', { rpcId: 'disconnect-window', input: { action: 'ask', origin: 'sidepanel', question: 'must not send' } }));
  first.disconnect();
  first.onMessage.fire(msg('SIDEPANEL_READY', { rpcId: 'late-ready' }));
  heldCapability.port.onMessage.fire(msg('PORT_RESPONSE', { rpcId: heldCapability.message.rpcId,
    result: { ok: true, capabilities: { modes: ['instant'] } } }));
  frameA.onMessage.fire(msg('TASK_EVENT', { ...taskA, state: 'streaming', text: 'late answer' }));
  await f.manager.drain();
  assert.equal(first.output.length, before);
  assert.equal(frameA.output.filter((message) => message.type === 'ADAPTER_RUN').length, 1);
  assert.equal(frameA.output.filter((message) => message.type === 'ADAPTER_DISPOSE').length, 1);
  assert.deepEqual(f.sessionStorage.cgpSessionMetadata.map((item) => item.sessionId), [taskB.sessionId]);
  assert.equal((await call(second, 'GET_SETTINGS')).ok, true);
  const staleFrame = bind(readyA.token);
  assert.equal(staleFrame.disconnected, true, 'Disconnected host token must not become live again');
  second.disconnect(); await f.manager.drain();
  assert.deepEqual(f.sessionStorage.cgpSessionMetadata, []);
});

test('sidebar identity comes only from a trusted Port sender, never runtime payload claims', async () => {
  const f = fixture();
  const nativeSender = { id: 'extension-id', url: f.chrome.runtime.getURL('sidepanel.html') };
  for (const sender of [nativeSender, source(), { ...nativeSender, url: f.chrome.runtime.getURL('options.html') }]) {
    const result = await f.manager.handle(msg('SIDEPANEL_READY', { documentId: 'forged', sender: { ...nativeSender, documentId: 'forged' } }), sender);
    assert.equal(result.error.code, 'INVALID_SOURCE');
  }
  for (const sender of [{ ...nativeSender, id: 'foreign-extension' }, source(), { ...nativeSender, url: f.chrome.runtime.getURL('sidepanel.html/evil') }, { ...nativeSender, url: f.chrome.runtime.getURL('options.html') }]) {
    const port = { name: 'cgp-sidepanel-host', sender, onMessage: event(), onDisconnect: event(), disconnect() { this.disconnected = true; } };
    f.manager.connect(port);
    assert.equal(port.disconnected, true);
  }
  assert.equal(f.calls.some((call) => call[0] === 'create'), false);
});

test('page sidebar entry opens its actual window and rejects missing window identity', async () => {
  const f = fixture();
  assert.equal((await f.manager.handle(msg('OPEN_SIDEPANEL'), source())).ok, true);
  assert.deepEqual(f.calls.filter((call) => call[0] === 'openPanel'), [['openPanel', { windowId: 3 }]]);
  for (const windowId of [undefined, -1, '3']) {
    const sender = { ...source(), tab: { id: 1, windowId } };
    assert.equal((await f.manager.handle(msg('OPEN_SIDEPANEL'), sender)).error.code, 'INVALID_WINDOW');
  }
  assert.equal((await f.manager.handle(msg('OPEN_SIDEPANEL'), { ...source(), id: 'foreign-extension' })).error.code, 'INVALID_SOURCE');
  assert.equal(f.calls.filter((call) => call[0] === 'openPanel').length, 1);
});

test('real background action listener opens the clicked tab window rather than a tab-scoped panel', async () => {
  const f = fixture();
  const previous = globalThis.chrome;
  globalThis.chrome = f.chrome;
  try {
    delete f.chrome.offscreen;
    await import('../src/background/index.js?window-open-test');
    await new Promise((resolve) => setImmediate(resolve));
    f.chrome.action.onClicked.fire({ id: 1, windowId: 3 });
    for (const windowId of [undefined, -1, '3']) f.chrome.action.onClicked.fire({ id: 1, windowId });
    assert.deepEqual(f.calls.filter((call) => call[0] === 'openPanel'), [['openPanel', { windowId: 3 }]]);
  } finally {
    if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous;
  }
});

test('native diagram events require nonempty SVG plus the existing execution identity and reject late replies', async () => {
  const f = fixture();
  const started = await f.manager.handle(msg('START_TASK', { input: input('mindmap') }), source());
  await f.manager.drain();
  const diagram = { svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>native mindmap</text></svg>' };
  const message = msg('TASK_EVENT', { ...started, state: 'streaming', diagram });
  for (const invalid of [null, {}, { svg: '' }, { svg: ' \n ' }, { svg: 42 }]) f.emit(20, { ...message, diagram: invalid });
  f.emit(21, message);
  f.emit(20, { ...message, requestId: 'foreign-request' });
  f.emit(20, message);
  await f.manager.drain();
  const routed = f.commands('TASK_EVENT').filter((call) => call[2].diagram);
  assert.equal(routed.length, 1);
  assert.equal(routed[0][1], 1);
  assert.deepEqual(routed[0][2].diagram, diagram);
  assert.deepEqual(routed[0][3], { documentId: source().documentId });
  const original = f.frames.get(20).port;
  await f.manager.handle(msg('CLOSE_SESSION', { sessionId: started.sessionId }), source());
  original?.onMessage.fire({ ...message, state: 'completed' });
  await f.manager.drain();
  assert.equal(f.commands('TASK_EVENT').filter((call) => call[2].diagram).length, 1);
});


test('startup and simultaneous lifecycle hooks prewarm exactly one hidden unused frame without sending', async () => {
  const f = fixture();
  await Promise.all([f.manager.initialized, f.manager.prewarm(), f.manager.prewarm()]);
  await f.manager.drain();
  assert.equal(f.calls.filter((entry) => entry[0] === 'offscreenCreate').length, 1);
  assert.equal(f.calls.filter((entry) => entry[0] === 'host' && entry[1].type === 'OFFSCREEN_CREATE').length, 1);
  assert.equal(f.frames.size, 1);
  assert.equal(f.frames.get(20).used, false);
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
  assert.equal(f.calls.some((entry) => entry[0] === 'create'), false);
});

test('concurrent sources reserve distinct frames and one loading replacement before replies finish', async () => {
  const held = deferred();
  const f = fixture({ send: (id, message) => message.type === 'ADAPTER_PROBE' ? held.promise : undefined });
  await f.manager.initialized;
  await Promise.all([1, 2, 3, 4].map((id) => f.manager.handle(msg('START_TASK', { input: input() }), source(id))));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.frames.size, 5);
  assert.equal([...f.frames.values()].filter((frame) => !frame.used).length, 1);
  assert.equal(new Set(f.commands('ADAPTER_PROBE').map((entry) => entry[1])).size, 4);
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
  held.resolve({ ok: true, state: { ready: true, loggedIn: true, temporary: true, busy: false, hasDraft: false, hasMessages: false, hasAttachments: false } });
  await f.manager.drain();
  assert.equal(new Set(f.commands('ADAPTER_RUN').map((entry) => entry[1])).size, 4);
  assert.equal(f.calls.filter((entry) => entry[0] === 'offscreenCreate').length, 1);
});

test('claim starts loading a replacement before its existing frame readiness probe returns', async () => {
  const held = deferred(); let creates = 0;
  const f = fixture({ create: () => ++creates > 1 ? held.promise : undefined });
  await f.manager.initialized;
  await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.frames.get(20).used, true);
  assert.equal(f.frames.get(21).used, false);
  assert.equal(f.frames.get(21).port.output.length, 0, 'Replacement can still be loading while counted as the sole idle slot');
  const hostTypes = f.calls.filter((entry) => entry[0] === 'host').map((entry) => entry[1].type);
  assert.deepEqual(hostTypes.slice(-2), ['OFFSCREEN_CLAIM', 'OFFSCREEN_CREATE']);
  held.resolve(); await f.manager.drain();
});

test('restart recovers the same unused iframe, removes claimed contexts, reports interruption and never replays', async () => {
  const f = fixture();
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  const idleToken = f.frames.get(21).token;
  const creates = f.calls.filter((entry) => entry[0] === 'host' && entry[1].type === 'OFFSCREEN_CREATE').length;
  const runs = f.commands('ADAPTER_RUN').length;
  await f.restart().initialized;
  await f.manager.drain();
  assert.equal(f.frames.size, 1);
  assert.equal(f.frames.get(21).token, idleToken);
  assert.equal(f.calls.filter((entry) => entry[0] === 'offscreenCreate').length, 1);
  assert.equal(f.calls.filter((entry) => entry[0] === 'host' && entry[1].type === 'OFFSCREEN_CREATE').length, creates);
  assert.equal(f.calls.filter((entry) => entry[0] === 'host' && entry[1].type === 'OFFSCREEN_REBIND').length, 1);
  assert.equal(f.commands('ADAPTER_RUN').length, runs);
  assert.equal(f.commands('TASK_EVENT').at(-1)[2].error.code, 'WORKER_RESTARTED');
  assert.equal(f.commands('TASK_EVENT').at(-1)[2].sessionId, started.sessionId);
  const next = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  assert.notEqual(next.sessionId, started.sessionId);
  assert.equal(f.commands('ADAPTER_RUN').at(-1)[1], 21);
});

test('disable during replacement loading removes hidden document; late binding cannot recreate it; enable warms once', async () => {
  const held = deferred(); let creates = 0;
  const f = fixture({ create: () => ++creates > 1 ? held.promise : undefined });
  await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  await f.manager.handle(msg('UPDATE_SETTINGS', { patch: { enabled: false } }), source());
  held.resolve(); await f.manager.drain();
  assert.equal(f.frames.size, 0);
  assert.equal(f.calls.filter((entry) => entry[0] === 'offscreenClose').length, 1);
  await f.manager.prewarm();
  assert.equal(f.calls.filter((entry) => entry[0] === 'offscreenCreate').length, 1);
  await f.manager.handle(msg('UPDATE_SETTINGS', { patch: { enabled: true } }), source());
  await f.manager.drain();
  assert.equal(f.frames.size, 1);
  assert.equal(f.calls.filter((entry) => entry[0] === 'offscreenCreate').length, 2);
  assert.equal(f.commands('ADAPTER_RUN').length, 1);
});

test('disabled startup does not create a hidden host; unsupported or failed offscreen never falls back to tabs', async () => {
  const disabled = fixture({ settings: { enabled: false } });
  await disabled.manager.prewarm();
  assert.equal(disabled.calls.some((entry) => entry[0] === 'offscreenCreate'), false);
  for (const overrides of [{ noOffscreen: true }, { offscreenError: new Error('creation refused') }]) {
    const f = fixture(overrides);
    await f.manager.handle(msg('START_TASK', { input: input() }), source());
    await f.manager.drain();
    assert.equal(f.commands('ADAPTER_RUN').length, 0);
    assert.equal(f.calls.some((entry) => entry[0] === 'create'), false);
    assert.equal(f.commands('TASK_EVENT').at(-1)[2].state, 'failed');
    assert.ok(f.calls.filter((entry) => entry[0] === 'offscreenCreate').length <= 2, 'Only startup and the explicit user action may retry');
  }
});

test('unused validation rejects history, attachment, draft, busy, non-temporary and unknown state without modifying content', async () => {
  const clean = { ready: true, loggedIn: true, temporary: true, busy: false, hasDraft: false, hasMessages: false, hasAttachments: false };
  for (const patch of [{ hasMessages: true }, { hasAttachments: true }, { hasDraft: true }, { busy: true }, { temporary: false }, { hasMessages: undefined }, { hasAttachments: undefined }, { hasDraft: undefined }, { busy: undefined }]) {
    const f = fixture({ send: (id, message) => message.type === 'ADAPTER_PROBE' ? { ok: true, state: { ...clean, ...patch } } : undefined });
    await f.manager.handle(msg('START_TASK', { input: input() }), source());
    await f.manager.drain();
    assert.equal(f.commands('ADAPTER_RUN').length, 0);
    assert.equal(f.commands('TASK_EVENT').at(-1)[2].error.code, 'EXECUTION_BUSY');
    assert.equal(f.frames.has(20), false);
    assert.equal(f.frames.size, 1);
  }
});

test('parallel capabilities use distinct hidden contexts, recheck unused state and leave exactly one replacement', async () => {
  const held = deferred();
  const f = fixture({ send: (id, message) => message.type === 'ADAPTER_CAPABILITIES' ? held.promise : undefined });
  const first = f.manager.handle(msg('GET_CAPABILITIES'), source(1));
  const second = f.manager.handle(msg('GET_CAPABILITIES'), source(2));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.frames.size, 3);
  assert.equal([...f.frames.values()].filter((frame) => !frame.used).length, 1);
  held.resolve({ ok: true, capabilities: { modes: ['instant'], currentMode: 'instant' } });
  assert.equal((await first).ok, true); assert.equal((await second).ok, true);
  await f.manager.drain();
  assert.equal(f.frames.size, 1);
  assert.equal(f.commands('ADAPTER_PROBE').length, 4);
  assert.equal(f.commands('ADAPTER_RUN').length, 0);
});

test('offscreen host requires exact browser sender URL and ID; unknown frame token and stale Ports cannot bind', async () => {
  const f = fixture(); await f.manager.initialized;
  for (const sender of [source(), { id: 'foreign-extension', url: f.chrome.runtime.getURL('offscreen.html') }, { id: 'extension-id', url: f.chrome.runtime.getURL('offscreen.html/evil') }, { id: 'extension-id', url: f.chrome.runtime.getURL('sidepanel.html') }]) {
    const port = { name: 'cgp-offscreen-host', sender, onMessage: event(), onDisconnect: event(), disconnect() { this.disconnected = true; } };
    f.manager.connect(port); assert.equal(port.disconnected, true);
  }
  const unowned = f.makeFrame('unknown'); f.bind(unowned);
  assert.equal(unowned.port.disconnected, true);
  f.frames.delete(unowned.id);
  const started = await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain();
  const old = f.frames.get(20).port;
  f.emit(20, msg('TASK_EVENT', { ...started, state: 'completed' }));
  await f.manager.drain(); old.disconnect(); await f.manager.drain();
  assert.equal((await f.manager.handle(msg('FOLLOW_UP', { sessionId: started.sessionId, question: 'next' }), source())).error.code, 'EXECUTION_LOST');
  old.onMessage.fire(msg('TASK_EVENT', { ...started, state: 'streaming', text: 'stale' }));
  await f.manager.drain();
  assert.equal(f.commands('TASK_EVENT').at(-1)[2].state, 'interrupted');
});

test('source close releases only claimed frame and keeps the single prewarm', async () => {
  const f = fixture(); await f.manager.handle(msg('START_TASK', { input: input() }), source());
  await f.manager.drain(); f.manager.tabRemoved(1); await f.manager.drain();
  assert.equal(f.frames.size, 1); assert.equal(f.frames.get(21).used, false);
  assert.deepEqual(f.sessionStorage.cgpSessionMetadata, []);
});


test('disabled restart removes a residual hidden document without recreating it', async () => {
  const f = fixture(); await f.manager.initialized;
  await f.chrome.storage.local.set({ settings: { enabled: false } });
  await f.restart().initialized;
  assert.equal(f.frames.size, 0);
  assert.equal(f.calls.filter((entry) => entry[0] === 'offscreenCreate').length, 1);
  assert.equal(f.calls.filter((entry) => entry[0] === 'offscreenClose').length, 1);
});

test('failed CREATE acknowledgement removes its registered token and never recursively replenishes', async () => {
  let first = true;
  const f = fixture({ host: (message) => {
    if (message.type === 'OFFSCREEN_CREATE' && first) {
      first = false; f.makeFrame(message.token);
      return { ok: false, error: { code: 'CREATE_FAILED', message: 'Partial host creation' } };
    }
  } });
  await f.manager.initialized;
  assert.equal(f.frames.size, 0);
  assert.equal(f.calls.filter((entry) => entry[0] === 'host' && entry[1].type === 'OFFSCREEN_CREATE').length, 1);
  assert.equal(f.calls.filter((entry) => entry[0] === 'host' && entry[1].type === 'OFFSCREEN_REMOVE').length, 1);
  await f.manager.prewarm();
  assert.equal(f.frames.size, 1, 'A later explicit action can retry once');
});
