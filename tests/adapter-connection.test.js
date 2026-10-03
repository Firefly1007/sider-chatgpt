import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installAdapter } from '../src/chatgpt/index.js';

const event = () => {
  const listeners = new Set();
  return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), fire: (...args) => Promise.all([...listeners].map(f => f(...args))) };
};

test('a reloaded sidebar without a hash adopts identity only from its trusted parent', async () => {
  const dom = new JSDOM('<iframe src="https://chatgpt.com/c/reloaded"></iframe>', { url: 'chrome-extension://extension-id/sidepanel.html' });
  const frame = dom.window.document.querySelector('iframe').contentWindow;
  frame.document.open(); frame.document.write('<html><body><p>Retained chat</p></body></html>'); frame.document.close();
  const ports = [];
  const runtime = { id: 'extension-id', onMessage: event(), sendMessage: async () => ({ ok: false }), connect() {
    const port = { sent: [], onMessage: event(), onDisconnect: event(), postMessage(m) { this.sent.push(m); }, disconnect() {} };
    ports.push(port); return port;
  } };
  let onRebind;
  const addListener = frame.addEventListener.bind(frame);
  frame.addEventListener = (type, callback, options) => { if (type === 'message') onRebind = callback; addListener(type, callback, options); };
  const installed = installAdapter(frame.document, runtime);
  const token = '12345678-1234-1234-1234-123456789012';
  const rebind = overrides => onRebind({ isTrusted: true,
    source: dom.window, origin: 'chrome-extension://extension-id', data: { type: 'CGP_REBIND', token }, ...overrides,
  });
  rebind({ isTrusted: false });
  rebind({ source: frame }); rebind({ origin: 'https://chatgpt.com' });
  rebind({ origin: 'chrome-extension://another-extension' });
  rebind({ data: { type: 'CGP_REBIND', token: 'bad' } });
  assert.equal(ports.length, 0);
  rebind();
  assert.equal(ports.length, 1);
  assert.deepEqual(ports[0].sent[0], { channel: 'cgp', type: 'FRAME_READY', token });
  await ports[0].onDisconnect.fire();
  rebind({ data: { type: 'CGP_REBIND', token: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } });
  assert.equal(ports.length, 1);
  rebind(); assert.equal(ports.length, 2);
  assert.equal(installed.adapter.active, null);
  installed.dispose(); rebind(); assert.equal(ports.length, 2);
  dom.window.close();
});

test('only the matching extension parent can reconnect a hidden adapter without reloading its document', async () => {
  const dom = new JSDOM('<iframe src="https://chatgpt.com/?temporary-chat=true#cgp-frame=unused-frame"></iframe>', { url: 'chrome-extension://extension-id/offscreen.html' });
  const frame = dom.window.document.querySelector('iframe').contentWindow;
  frame.document.open(); frame.document.write('<html><body><p id="preserved">Existing warmed document</p></body></html>'); frame.document.close();
  const ports = [];
  const runtime = {
    id: 'extension-id', onMessage: event(), sendMessage: async () => ({ ok: true }),
    connect() {
      const port = { sent: [], onMessage: event(), onDisconnect: event(), postMessage(m) { this.sent.push(m); }, disconnect() { this.onDisconnect.fire(); } };
      ports.push(port); return port;
    },
  };
  const installed = installAdapter(frame.document, runtime);
  const retained = frame.document.querySelector('#preserved');
  assert.equal(ports.length, 1);
  await ports[0].onMessage.fire({ channel: 'cgp', type: 'FRAME_BOUND', ok: true });
  await ports[0].onDisconnect.fire();
  const rebind = (overrides = {}) => frame.dispatchEvent(new frame.MessageEvent('message', {
    source: dom.window, origin: 'chrome-extension://extension-id', data: { type: 'CGP_REBIND', token: 'unused-frame' }, ...overrides,
  }));
  rebind({ origin: 'https://chatgpt.com' });
  rebind({ source: frame });
  rebind({ data: { type: 'CGP_REBIND', token: 'another-frame' } });
  rebind({ data: { type: 'ADAPTER_RUN', token: 'unused-frame', prompt: 'must not submit' } });
  assert.equal(ports.length, 1);
  assert.equal(installed.adapter.active, null);
  rebind();
  assert.equal(ports.length, 2);
  assert.equal(frame.document.querySelector('#preserved'), retained);
  assert.deepEqual(ports[1].sent[0], { channel: 'cgp', type: 'FRAME_READY', token: 'unused-frame' });
  rebind(); assert.equal(ports.length, 2, 'Repeated parent requests cannot create duplicate live connections');
  const oldCount = ports[0].sent.length;
  await ports[0].onMessage.fire({ channel: 'cgp', type: 'ADAPTER_PROBE', rpcId: 'stale' });
  await ports[0].onDisconnect.fire();
  await ports[1].onMessage.fire({ channel: 'cgp', type: 'ADAPTER_PROBE', rpcId: 'current' });
  assert.equal(ports[0].sent.length, oldCount);
  assert.equal(ports[1].sent.at(-1).rpcId, 'current');
  ports[1].postMessage = () => { throw new Error('Attempting to use a disconnected port object'); };
  rebind({ origin: 'https://chatgpt.com' });
  assert.equal(ports.length, 2, 'Untrusted messages cannot probe or replace a Port');
  rebind();
  assert.equal(ports.length, 3, 'A stale Port must reconnect even if its disconnect callback was not delivered');
  assert.equal(frame.document.querySelector('#preserved'), retained);
  assert.deepEqual(ports[2].sent[0], { channel: 'cgp', type: 'FRAME_READY', token: 'unused-frame' });
  await ports[1].onDisconnect.fire();
  rebind(); assert.equal(ports.length, 3, 'Late disconnect must not replace the recovered connection');
  assert.equal(installed.adapter.active, null);
  installed.dispose(); rebind(); assert.equal(ports.length, 3);
  dom.window.close();
});
