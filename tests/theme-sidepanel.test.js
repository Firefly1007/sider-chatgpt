import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSidepanel } from '../src/sidepanel/index.js';

const html = readFileSync(new URL('../public/sidepanel.html', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function event() { const listeners = new Set(); return { listeners, addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); }, fire(...args) { listeners.forEach((fn) => fn(...args)); } }; }

test('sidebar reads active page, forwards matching theme, drops late switched-page results and disposes listeners', async () => {
  const dom = new JSDOM(html, { url: 'https://extension.test/sidepanel.html' });
  let active = 1; let resolveOld; let dark = false;
  const onActivated = event(), onUpdated = event(), onMessage = event(), systemListeners = new Set(), forwarded = [];
  const media = { get matches() { return dark; }, addEventListener(_type, fn) { systemListeners.add(fn); }, removeEventListener(_type, fn) { systemListeners.delete(fn); } };
  dom.window.matchMedia = () => media;
  const chrome = {
    windows: { getCurrent: async () => ({ id: 3 }) },
    runtime: { onMessage, connect: () => ({ onMessage: event(), onDisconnect: event(), disconnect() {} }) },
    tabs: {
      onActivated, onUpdated,
      async query(query) { assert.deepEqual(query, { active: true, currentWindow: true }); return [{ id: active }]; },
      async sendMessage(id, message, options) {
        assert.equal(message.type, 'GET_PAGE_THEME'); assert.equal(options.frameId, 0);
        if (id === 2) return new Promise((resolve) => { resolveOld = resolve; });
        if (id === 4) throw new Error('Restricted page');
        return { ok: true, theme: id === 1 ? 'dark' : 'light', source: 'darkreader' };
      },
    },
  };
  const panel = createSidepanel(dom.window.document, chrome, { rpc: async (type, payload) => {
    if (type === 'SIDEPANEL_READY') return { ok: true, token: '12345678-1234-1234-1234-123456789012', frameReady: true };
    if (type === 'GET_SETTINGS') return { ok: true, settings: { enabled: true } };
    if (type === 'SET_SIDEPANEL_THEME') forwarded.push(payload.theme);
    return { ok: true };
  } });
  try {
    await panel.ready; assert.equal(dom.window.document.documentElement.dataset.cgpTheme, 'dark');
    active = 2; onActivated.fire({ tabId: 2 }); await tick();
    active = 3; onActivated.fire({ tabId: 3 }); await tick();
    resolveOld({ ok: true, theme: 'dark', source: 'darkreader' }); await tick();
    assert.equal(dom.window.document.documentElement.dataset.cgpTheme, 'light');
    assert.deepEqual(forwarded, ['dark', 'light']);
    active = 4; dark = true; systemListeners.forEach((fn) => fn()); await tick();
    assert.equal(dom.window.document.documentElement.dataset.cgpTheme, 'dark');
    active = 3; onMessage.fire({ channel: 'cgp', type: 'PAGE_THEME_CHANGED' }, { tab: { id: 99 } }); await tick();
    assert.equal(dom.window.document.documentElement.dataset.cgpTheme, 'light');
    panel.dispose();
    assert.equal(onActivated.listeners.size + onUpdated.listeners.size + onMessage.listeners.size + systemListeners.size, 0);
  } finally { panel.dispose(); dom.window.close(); }
});
