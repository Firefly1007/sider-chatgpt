import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installOffscreen } from '../src/offscreen/index.js';

const html = readFileSync(new URL('../public/offscreen.html', import.meta.url), 'utf8');
const event = () => { const listeners = new Set(); return { listeners, addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); }, fire(...args) { listeners.forEach((fn) => fn(...args)); } }; };
function fixture() {
  const dom = new JSDOM(html, { url: 'https://extension.test/offscreen.html' });
  const timers = new Map(); let timerId = 0;
  dom.window.setInterval = (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; };
  dom.window.clearInterval = (id) => timers.delete(id);
  const ports = [];
  const runtime = {
    id: 'own-extension', onMessage: event(),
    connect({ name }) {
      assert.equal(name, 'cgp-offscreen-host');
      const port = { onMessage: event(), onDisconnect: event(), replies: [], postMessage(message) { this.replies.push(message); }, disconnect() { this.onDisconnect.fire(); } };
      ports.push(port); return port;
    },
  };
  const cleanup = installOffscreen(dom.window.document, runtime);
  let sequence = 0;
  const send = (type, token, port = ports.at(-1)) => {
    const rpcId = `command-${++sequence}`;
    port.onMessage.fire({ channel: 'cgp', type, token, rpcId });
    const reply = port.replies.find((message) => message.rpcId === rpcId);
    if (reply) { assert.equal(reply.type, 'PORT_RESPONSE'); assert.equal(reply.channel, 'cgp'); }
    return reply?.result;
  };
  return { dom, document: dom.window.document, runtime, ports, timers, send, cleanup() { cleanup(); dom.window.close(); } };
}

test('only claimed conversations keep coordination alive; removal, sync, disconnect and disposal release timers', () => {
  const view = fixture();
  try {
    view.send('OFFSCREEN_CREATE', 'spare');
    assert.equal(view.timers.size, 0, 'prewarming alone must allow worker suspension');
    view.send('OFFSCREEN_CLAIM', 'spare');
    view.send('OFFSCREEN_CREATE', 'replacement');
    view.send('OFFSCREEN_CLAIM', 'replacement');
    assert.equal(view.timers.size, 1, 'concurrent conversations share one timer');
    const timer = [...view.timers.values()][0];
    assert.equal(timer.ms, 20000);
    timer.callback();
    assert.deepEqual(view.ports.at(-1).replies.at(-1), { channel: 'cgp', type: 'OFFSCREEN_KEEPALIVE' });
    view.send('OFFSCREEN_REMOVE', 'spare'); assert.equal(view.timers.size, 1);
    view.send('OFFSCREEN_REMOVE', 'replacement'); assert.equal(view.timers.size, 0);
    view.send('OFFSCREEN_CREATE', 'claimed'); view.send('OFFSCREEN_CLAIM', 'claimed');
    view.send('OFFSCREEN_CREATE', 'unused'); view.send('OFFSCREEN_SYNC');
    assert.equal(view.timers.size, 0); assert.equal(view.document.querySelectorAll('iframe').length, 1);
    view.send('OFFSCREEN_CLAIM', 'unused');
    view.ports.at(-1).disconnect(); assert.equal(view.timers.size, 0);
    view.runtime.onMessage.fire({ channel: 'cgp', target: 'offscreen', type: 'OFFSCREEN_CONNECT' }, { id: view.runtime.id });
    assert.equal(view.timers.size, 1);
    view.ports[0].onDisconnect.fire(); assert.equal(view.timers.size, 1, 'stale disconnect cannot cancel current connection');
    const current = [...view.timers.values()][0];
    view.cleanup(); assert.equal(view.timers.size, 0);
    const count = view.ports.at(-1).replies.length;
    current.callback(); assert.equal(view.ports.at(-1).replies.length, count);
  } finally { view.cleanup(); }
});

test('offscreen creates one iframe per token without hiding layout, claims/removes and rejects unknown tokens', () => {
  const view = fixture();
  try {
    assert.deepEqual(view.send('OFFSCREEN_CREATE', ''), { ok: false, error: { code: 'INVALID_TOKEN', message: 'Offscreen frame token is required.' } });
    assert.equal(view.send('OFFSCREEN_CREATE', 'first').ok, true);
    const frame = view.document.querySelector('iframe');
    assert.equal(frame.src, 'https://chatgpt.com/?temporary-chat=true#cgp-frame=first');
    assert.equal(frame.style.width, '1280px'); assert.equal(frame.style.height, '900px');
    assert.equal(frame.style.position, 'absolute'); assert.equal(frame.style.top, '0px');
    assert.notEqual(frame.style.display, 'none');
    view.send('OFFSCREEN_CREATE', 'first'); assert.equal(view.document.querySelectorAll('iframe').length, 1);
    assert.equal(view.send('OFFSCREEN_CLAIM', 'first').ok, true);
    view.send('OFFSCREEN_CREATE', 'first');
    assert.deepEqual(view.send('OFFSCREEN_SYNC'), { ok: true, frames: [] });
    for (const type of ['OFFSCREEN_CLAIM', 'OFFSCREEN_REMOVE', 'OFFSCREEN_REBIND']) assert.equal(view.send(type, 'missing').error.code, 'UNKNOWN_TOKEN');
    view.send('OFFSCREEN_CREATE', 'second'); assert.equal(view.send('OFFSCREEN_REMOVE', 'second').ok, true);
    assert.equal(view.document.querySelectorAll('iframe').length, 0);
  } finally { view.cleanup(); }
});

test('disconnect/reconnect preserves unused DOM; sync removes claimed and extra unused frames', () => {
  const view = fixture();
  try {
    view.send('OFFSCREEN_CREATE', 'used'); view.send('OFFSCREEN_CLAIM', 'used');
    view.send('OFFSCREEN_CREATE', 'unused'); view.send('OFFSCREEN_CREATE', 'extra');
    const unused = view.document.querySelector('[data-cgp-token="unused"]');
    const previous = view.ports[0]; previous.disconnect();
    assert.equal(view.document.querySelectorAll('iframe').length, 3);
    let ack;
    view.runtime.onMessage.fire({ channel: 'cgp', target: 'offscreen', type: 'OFFSCREEN_CONNECT' }, { id: view.runtime.id }, (reply) => { ack = reply; });
    assert.deepEqual(ack, { ok: true }); assert.equal(view.ports.length, 2);
    assert.deepEqual(view.send('OFFSCREEN_SYNC'), { ok: true, frames: [{ token: 'unused' }] });
    assert.equal(view.document.querySelector('iframe'), unused);
    assert.equal(view.send('OFFSCREEN_REMOVE', 'unused', previous), undefined);
    assert.equal(view.document.querySelector('iframe'), unused);
  } finally { view.cleanup(); }
});

test('rebind targets exactly the registered iframe and page/runtime commands cannot control host', () => {
  const view = fixture();
  try {
    view.send('OFFSCREEN_CREATE', 'one'); view.send('OFFSCREEN_CREATE', 'two');
    const frames = [...view.document.querySelectorAll('iframe')];
    const calls = [];
    frames.forEach((frame, index) => { frame.contentWindow.postMessage = (...args) => calls.push({ index, args }); });
    assert.equal(view.send('OFFSCREEN_REBIND', 'two').ok, true);
    assert.deepEqual(calls, [{ index: 1, args: [{ type: 'CGP_REBIND', token: 'two' }, 'https://chatgpt.com'] }]);
    view.dom.window.dispatchEvent(new view.dom.window.MessageEvent('message', { data: { channel: 'cgp', type: 'OFFSCREEN_REMOVE', token: 'one', rpcId: 'page-command' }, origin: 'https://chatgpt.com', source: frames[0].contentWindow }));
    view.runtime.onMessage.fire({ channel: 'cgp', type: 'OFFSCREEN_REMOVE', token: 'one' }, { id: view.runtime.id });
    view.runtime.onMessage.fire({ channel: 'cgp', target: 'offscreen', type: 'OFFSCREEN_CONNECT' }, { id: 'foreign-extension' });
    view.runtime.onMessage.fire({ channel: 'cgp', type: 'OFFSCREEN_CONNECT' }, { id: view.runtime.id });
    assert.equal(view.document.querySelectorAll('iframe').length, 2); assert.equal(view.ports.length, 1);
    assert.equal(view.send('ARBITRARY_COMMAND', 'one').error.code, 'INVALID_COMMAND');
    assert.equal(view.runtime.onMessage.listeners.size, 1);
  } finally { view.cleanup(); assert.equal(view.runtime.onMessage.listeners.size, 0); }
});

test('created iframe rebinds its token after the remote document commits', () => {
  const view = fixture();
  try {
    view.send('OFFSCREEN_CREATE', 'late-token');
    const frame = view.document.querySelector('iframe');
    const calls = [];
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: {
      get location() { throw new DOMException('Blocked cross-origin access', 'SecurityError'); },
      postMessage: (...args) => calls.push(args),
    } });
    frame.dispatchEvent(new view.dom.window.Event('load'));
    assert.deepEqual(calls, [[{ type: 'CGP_REBIND', token: 'late-token' }, 'https://chatgpt.com']]);
  } finally { view.cleanup(); }
});

test('offscreen document contains only the external module script, with no inline script or hiding CSS', () => {
  const dom = new JSDOM(html);
  try {
    const scripts = [...dom.window.document.querySelectorAll('script')];
    assert.equal(scripts.length, 1); assert.equal(scripts[0].getAttribute('src'), 'offscreen.js');
    assert.equal(scripts[0].textContent, ''); assert.equal(scripts[0].type, 'module');
    assert.equal(dom.window.document.querySelectorAll('style,[style]').length, 0);
  } finally { dom.window.close(); }
});
