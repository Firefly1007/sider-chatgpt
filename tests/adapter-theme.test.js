import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installAdapter } from '../src/chatgpt/index.js';

function event() {
  const listeners = new Set();
  return { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener), fire: async message => Promise.all([...listeners].map(listener => listener(message))) };
}
function setup({ frame = true, token = true, existingLock = false } = {}) {
  const url = `https://chatgpt.com/${token ? '#cgp-frame=binding-token' : ''}`;
  const dom = new JSDOM(frame ? `<iframe src="${url}"></iframe>` : '', { url });
  const document = frame ? dom.window.document.querySelector('iframe').contentDocument : dom.window.document;
  document.open(); document.write(`<html class="chatgpt-theme light custom" data-theme="light" data-appearance-theme="light" style="color-scheme:light"><head>${existingLock ? '<meta name="darkreader-lock">' : ''}</head><body></body></html>`); document.close();
  const sent = [], port = { onMessage: event(), onDisconnect: event(), postMessage: message => sent.push(message), disconnect() { this.onDisconnect.fire(); } };
  const runtime = { id: 'extension-id', onMessage: event(), connect: () => port, sendMessage: async () => ({ ok: true }) };
  const installed = installAdapter(document, runtime);
  const send = async (theme, rpcId = 'theme') => {
    await port.onMessage.fire({ channel: 'cgp', type: 'ADAPTER_THEME', rpcId, theme });
    return sent.findLast(message => message.rpcId === rpcId)?.result;
  };
  return { document, port, installed, send };
}

test('bound iframe follows native theme locally and restores original attributes/classes/own lock', async () => {
  const f = setup(), root = f.document.documentElement;
  assert.equal((await f.send('dark')).error.code, 'THEME_CONTEXT_INVALID', 'Cannot act before background frame binding');
  await f.port.onMessage.fire({ channel: 'cgp', type: 'FRAME_BOUND', ok: true });
  assert.equal((await f.send('dark', 'dark')).ok, true);
  assert.equal(root.getAttribute('data-theme'), 'dark'); assert.equal(root.getAttribute('data-appearance-theme'), 'dark');
  assert.ok(root.classList.contains('dark')); assert.equal(root.style.colorScheme, 'dark');
  assert.ok(f.document.querySelector('meta[name="darkreader-lock"]'));
  root.classList.add('native-other');
  assert.equal((await f.send('light', 'light')).ok, true); assert.equal(root.getAttribute('data-theme'), 'light');
  f.installed.dispose();
  assert.equal(root.getAttribute('data-theme'), 'light'); assert.equal(root.getAttribute('data-appearance-theme'), 'light');
  assert.ok(root.classList.contains('light')); assert.ok(root.classList.contains('chatgpt-theme')); assert.ok(root.classList.contains('native-other'));
  assert.equal(root.classList.contains('dark'), false); assert.equal(root.style.colorScheme, 'light');
  assert.equal(f.document.querySelector('meta[name="darkreader-lock"]'), null);
});

test('theme rejects top-level pages and runtime requests, and preserves an existing lock', async () => {
  const top = setup({ frame: false });
  await top.port.onMessage.fire({ channel: 'cgp', type: 'FRAME_BOUND', ok: true });
  assert.equal((await top.send('dark')).error.code, 'THEME_CONTEXT_INVALID');
  assert.equal(top.document.documentElement.getAttribute('data-theme'), 'light'); top.installed.dispose();
  const frame = setup({ existingLock: true }), lock = frame.document.querySelector('meta[name="darkreader-lock"]');
  await frame.port.onMessage.fire({ channel: 'cgp', type: 'FRAME_BOUND', ok: true });
  assert.equal((await frame.installed.handle({ channel: 'cgp', type: 'ADAPTER_THEME', theme: 'dark' })).error.code, 'THEME_CONTEXT_INVALID');
  assert.equal((await frame.send('sepia')).error.code, 'INVALID_THEME');
  assert.equal((await frame.send('dark', 'allowed')).ok, true);
  await frame.installed.handle({ channel: 'cgp', type: 'ADAPTER_DISPOSE', sessionId: 'unused' });
  assert.equal(frame.document.documentElement.getAttribute('data-theme'), 'dark', 'Ending a task must not reset the mounted sidebar theme');
  frame.installed.dispose();
  assert.equal(frame.document.querySelector('meta[name="darkreader-lock"]'), lock);
  assert.equal(frame.document.documentElement.getAttribute('data-theme'), 'light');
});

test('native theme rewrites are corrected without a mutation loop and stop after disconnect', async () => {
  const f = setup(), root = f.document.documentElement;
  await f.port.onMessage.fire({ channel: 'cgp', type: 'FRAME_BOUND', ok: true });
  await f.send('dark');
  root.setAttribute('data-theme', 'light'); root.setAttribute('data-appearance-theme', 'light');
  root.classList.remove('dark'); root.classList.add('light', 'native-route'); root.style.colorScheme = 'light';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.getAttribute('data-theme'), 'dark'); assert.equal(root.getAttribute('data-appearance-theme'), 'dark');
  assert.equal(root.style.colorScheme, 'dark'); assert.ok(root.classList.contains('dark'));
  assert.ok(root.classList.contains('native-route')); assert.equal(root.classList.contains('light'), false);
  let mutations = 0;
  const observer = new f.document.defaultView.MutationObserver(records => { mutations += records.length; });
  observer.observe(root, { attributes: true });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(mutations, 0); observer.disconnect();
  await f.send('light', 'light'); root.setAttribute('data-theme', 'dark');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.getAttribute('data-theme'), 'light');
  await f.port.onDisconnect.fire();
  root.setAttribute('data-theme', 'dark');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.getAttribute('data-theme'), 'dark', 'Disconnected adapter must stop enforcing theme');
  assert.equal(f.document.querySelector('meta[name="darkreader-lock"]'), null);
  f.installed.dispose();
});

test('sidebar retains its theme across coordinator loss but restores it when the frame is disposed', async () => {
  const f = setup(), root = f.document.documentElement;
  await f.port.onMessage.fire({channel:'cgp',type:'FRAME_BOUND',ok:true,hostType:'sidepanel'});
  await f.send('dark');await f.port.onDisconnect.fire();
  assert.equal(root.getAttribute('data-theme'),'dark');
  root.setAttribute('data-theme','light');await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(root.getAttribute('data-theme'),'dark');
  f.installed.dispose();
  assert.equal(root.getAttribute('data-theme'),'light');
  assert.equal(f.document.querySelector('meta[name="darkreader-lock"]'),null);
});
