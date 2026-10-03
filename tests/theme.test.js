import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readPageTheme, observePageTheme } from '../src/shared/theme.js';

function page(dark = false) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const listeners = new Set();
  const media = { get matches() { return dark; }, addEventListener(_type, listener) { listeners.add(listener); }, removeEventListener(_type, listener) { listeners.delete(listener); } };
  dom.window.matchMedia = (query) => query === '(prefers-color-scheme: dark)' ? media : { matches: query !== 'not all' && query !== 'print' };
  return { dom, document: dom.window.document, setSystem(value) { dark = value; listeners.forEach((listener) => listener()); }, listeners };
}
function style(document, css, media = '') {
  const node = document.createElement('style'); node.className = 'darkreader darkreader--user-agent'; node.textContent = css; node.media = media; document.head.append(node); return node;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('active Dark Reader dark/light overrides system and native page scheme; inactive styles do not', () => {
  const view = page(true);
  try {
    assert.deepEqual(readPageTheme(view.document), { theme: 'dark', source: 'system' });
    const native = view.document.createElement('style'); native.textContent = 'html{color-scheme:dark}'; view.document.head.append(native);
    const dr = style(view.document, 'body{background:#fff}');
    assert.deepEqual(readPageTheme(view.document), { theme: 'light', source: 'darkreader' });
    dr.textContent = 'html{color-scheme:dark!important}'; view.setSystem(false);
    assert.deepEqual(readPageTheme(view.document), { theme: 'dark', source: 'darkreader' });
    view.document.documentElement.setAttribute('data-darkreader-scheme', 'light');
    assert.deepEqual(readPageTheme(view.document), { theme: 'light', source: 'darkreader' });
    dr.media = 'not all';
    assert.deepEqual(readPageTheme(view.document), { theme: 'light', source: 'system' });
    dr.media = ''; dr.sheet.disabled = true;
    assert.deepEqual(readPageTheme(view.document), { theme: 'light', source: 'system' });
    dr.sheet.disabled = false; dr.textContent = '';
    assert.deepEqual(readPageTheme(view.document), { theme: 'light', source: 'system' });
  } finally { view.dom.window.close(); }
});

test('observer follows style text/media/removal, root scheme and system changes and cleans up', async () => {
  const view = page(); const changes = [];
  const stop = observePageTheme(view.document, (theme) => changes.push(`${theme.source}:${theme.theme}`));
  try {
    const dr = style(view.document, 'html{color-scheme:dark!important}'); await tick();
    dr.firstChild.textContent = 'body{background:#fff}'; await tick();
    view.document.documentElement.setAttribute('data-darkreader-scheme', 'dark'); await tick();
    dr.media = 'not all'; await tick();
    view.setSystem(true); dr.remove(); await tick();
    assert.deepEqual(changes, ['system:light', 'darkreader:dark', 'darkreader:light', 'darkreader:dark', 'system:light', 'system:dark']);
    stop(); assert.equal(view.listeners.size, 0);
    view.setSystem(false); style(view.document, 'html{color-scheme:dark!important}'); await tick();
    assert.equal(changes.length, 6);
  } finally { stop(); view.dom.window.close(); }
});
