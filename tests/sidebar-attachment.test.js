import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installSidebarAttachment } from '../src/chatgpt/sidebar-attachment.js';
import { installAdapter } from '../src/chatgpt/index.js';

const composer = '<form><div id="prompt-textarea" contenteditable="true">Original draft</div><div class="actions"><button id="composer-plus-btn" type="button">+</button><button type="submit">Send</button></div></form>';
const tick = () => new Promise(resolve => setImmediate(resolve));
const host = document => document.querySelector('[data-cgp-attach-page-host]');
const button = document => host(document)?.shadowRoot.querySelector('[data-cgp-attach-page]');
function event() {
  const listeners = new Set();
  return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), fire: (...args) => Promise.all([...listeners].map(f => f(...args))) };
}

test('paperclip follows the composer plus across native re-renders, locks repeats, and cleans up', async () => {
  const dom = new JSDOM('', { url: 'https://chatgpt.com/' });
  let clicks = 0, submits = 0;
  const control = installSidebarAttachment(dom.window.document, () => clicks++);
  const document = dom.window.document;
  try {
    assert.equal(host(document), null);
    document.body.innerHTML = composer; await tick();
    document.querySelector('form').addEventListener('submit', () => submits++);
    assert.equal(host(document).previousElementSibling.id, 'composer-plus-btn');
    assert.equal(button(document).title, '附加当前网页');
    assert.equal(button(document).getAttribute('aria-label'), '附加当前网页');
    assert.equal(button(document).textContent, '');
    button(document).click(); assert.equal(clicks, 0);
    control.setEnabled(true); button(document).click(); button(document).click();
    assert.equal(clicks, 1); assert.equal(submits, 0);
    assert.equal(document.getElementById('prompt-textarea').textContent, 'Original draft');
    assert.equal(button(document).disabled, true);
    const retained = host(document);
    document.body.innerHTML = composer; await tick();
    assert.equal(host(document), retained);
    assert.equal(document.querySelectorAll('[data-cgp-attach-page-host]').length, 1);
    assert.equal(button(document).disabled, true, 'Re-render cannot unlock an in-flight operation');
    control.setEnabled(true); assert.equal(button(document).disabled, false);
    document.querySelector('#composer-plus-btn').remove(); await tick();
    assert.equal(host(document), null, 'Do not float at an arbitrary location when native plus is absent');
    control.dispose(); document.body.innerHTML = composer; await tick();
    assert.equal(host(document), null);
  } finally { control.dispose(); dom.window.close(); }
});

test('only a bound sidebar mounts paperclip and only Port controls can enable it', async () => {
  const dom = new JSDOM('<iframe src="https://chatgpt.com/#cgp-frame=sidebar-binding-token"></iframe>', { url: 'chrome-extension://extension-id/sidepanel.html' });
  const document = dom.window.document.querySelector('iframe').contentDocument;
  document.open(); document.write(composer); document.close();
  const sent = [];
  const port = { onMessage: event(), onDisconnect: event(), postMessage: m => sent.push(m), disconnect() { this.onDisconnect.fire(); } };
  const runtime = { id: 'extension-id', onMessage: event(), connect: () => port, sendMessage: async () => ({ ok: true }) };
  const installed = installAdapter(document, runtime);
  try {
    assert.equal(host(document), null);
    await port.onMessage.fire({ channel: 'cgp', type: 'FRAME_BOUND', ok: true, hostType: 'offscreen' });
    assert.equal(host(document), null, 'Hidden execution pages have no sidebar controls');
    await port.onMessage.fire({ channel: 'cgp', type: 'FRAME_BOUND', ok: true, hostType: 'sidepanel' });
    assert.equal(button(document).disabled, true);
    const control = { channel: 'cgp', type: 'ADAPTER_SIDEPANEL_CONTROLS', enabled: true, rpcId: 'controls' };
    assert.equal((await installed.handle(control)).error.code, 'INVALID_FRAME');
    assert.equal(button(document).disabled, true);
    await port.onMessage.fire(control);
    button(document).click(); button(document).click();
    assert.equal(sent.filter(m => m.type === 'SIDEPANEL_ATTACH_CURRENT_PAGE').length, 1);
    await port.onMessage.fire(control); assert.equal(button(document).disabled, false);
    await port.onDisconnect.fire(); assert.equal(button(document).disabled, true);
    await port.onMessage.fire(control); assert.equal(button(document).disabled, true, 'Late old-Port state cannot enable the icon');
    installed.dispose(); assert.equal(host(document), null);
  } finally { installed.dispose(); dom.window.close(); }
});
