import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('browser sidebar has no extension toolbar and syncs host attachment state to the native frame', { timeout: 90000 }, async () => {
  const bundle = await build({ stdin: { contents: 'export { createSidepanel } from "./src/sidepanel/index.js";', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'Sidebar' });
  const hasEdge = process.platform === 'win32' && existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
  const browser = await chromium.launch({ headless: true, ...(hasEdge ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page.route('**/*', (route) => route.abort());
    await page.setContent(readFileSync(new URL('../public/sidepanel.html', import.meta.url), 'utf8'));
    await page.addStyleTag({ content: readFileSync(new URL('../public/sidepanel.css', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      window.__calls = [];
      window.__port = {
        messageListeners: [], disconnectListeners: [],
        onMessage: { addListener(fn) { window.__port.messageListeners.push(fn); } },
        onDisconnect: { addListener(fn) { window.__port.disconnectListeners.push(fn); } },
        disconnect() {},
        fire(message) { window.__port.messageListeners.forEach((listener) => listener(message)); },
      };
      window.__panel = Sidebar.createSidepanel(document, { windows: { getCurrent: async () => ({ id: 3 }) }, runtime: { connect() { return window.__port; } } }, {
        currentTab: async () => ({ id: 12 }),
        rpc: async (type, payload = {}) => {
          window.__calls.push({ type, ...payload });
          if (type === 'SIDEPANEL_READY') return { ok: true, token: '12345678-1234-1234-1234-123456789012', frameReady: true };
          if (type === 'GET_SETTINGS') return { ok: true, settings: { enabled: true } };
          if (type === 'ATTACH_CURRENT_PAGE') return new Promise((resolve) => { window.__resolveAttach = resolve; });
          return { ok: true };
        },
      });
      return window.__panel.ready;
    });
    await page.waitForFunction(() => window.__panel && document.getElementById('cgp-chatgpt-frame').src.includes('#cgp-frame='));
    assert.equal(await page.locator('button').count(), 0);
    assert.equal(await page.locator('#enhancement-tools,.enhancement-tools').count(), 0);
    await page.waitForFunction(() => window.__calls.some((call) => call.type === 'SET_SIDEPANEL_CONTROLS' && call.enabled === true));
    await page.evaluate(() => {
      const event = { channel: 'cgp', type: 'SIDEPANEL_ATTACH_CURRENT_PAGE' };
      window.__port.fire(event);
      window.__port.fire(event);
    });
    await page.waitForFunction(() => window.__calls.some((call) => call.type === 'ATTACH_CURRENT_PAGE'));
    assert.deepEqual(await page.evaluate(() => window.__calls.filter((call) => call.type === 'ATTACH_CURRENT_PAGE')), [{ type: 'ATTACH_CURRENT_PAGE', tabId: 12 }]);
    assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.type === 'SET_SIDEPANEL_CONTROLS').at(-1).enabled), false);
    await page.evaluate(() => window.__resolveAttach({ ok: true, draftRestored: true }));
    await page.waitForFunction(() => window.__calls.filter((call) => call.type === 'SET_SIDEPANEL_CONTROLS').at(-1)?.enabled === true);
    assert.equal(await page.locator('#panel-status').textContent(), '');
    assert.equal(await page.locator('#panel-status').isVisible(), false);
    assert.equal(await page.locator('dialog,details,textarea,select').count(), 0);
  } finally { await browser.close(); }
});

test('real extension sidepanel defers CGP_REBIND until the ChatGPT document owns its origin', { timeout: 90000 }, async () => {
  const extensionDist = path.resolve(process.env.CGP_SIDEPANEL_REBIND_DIST || 'dist');
  const manifest = JSON.parse(readFileSync(path.join(extensionDist, 'manifest.json'), 'utf8'));
  const root = path.resolve('.test-output/sidepanel-origin');
  await mkdir(root, { recursive: true });
  const profile = path.join(root, `profile-${process.pid}-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const profileParent = path.dirname(profile);
  const mismatchConsole = [], consoleEvents = [], pageErrors = [], externalAttempts = [], routedChatGPT = [];
  let context, releaseSidepanelResponse;
  const responseGate = new Promise(resolve => { releaseSidepanelResponse = resolve; });
  let sidepanelRequestInfo;
  const fixtureHTML = `<!doctype html><html><head><meta charset="utf-8"><title>Local ChatGPT route fixture</title></head><body><p>Offline native document fixture</p><form><div id="prompt-textarea" contenteditable="true"></div><button type="button" id="composer-plus-btn">+</button></form><script>
    window.__cgpRebindMessages=[];
    window.addEventListener('message',event=>{if(event.data?.type==='CGP_REBIND')window.__cgpRebindMessages.push({origin:event.origin,isTrusted:event.isTrusted,sourceParent:event.source===parent,token:event.data.token});});
  </script></body></html>`;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: (process.env.CGP_CHROMIUM_PATH || chromium.executablePath()),
      headless: true,
      args: [
        `--disable-extensions-except=${extensionDist}`, `--load-extension=${extensionDist}`,
        '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps',
        '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND',
      ],
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === 'https://chatgpt.com') {
        let parentUrl = '', referrer = '';
        try { parentUrl = request.frame().parentFrame()?.url() || ''; } catch { }
        try { referrer = request.headers().referer || ''; } catch { }
        const sidepanel = parentUrl.endsWith('/sidepanel.html') || referrer.endsWith('/sidepanel.html');
        routedChatGPT.push({ url: url.href, parentUrl, referrer, sidepanel });
        if (sidepanel) { sidepanelRequestInfo ||= { url: url.href, parentUrl, referrer }; await responseGate; }
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixtureHTML });
        return;
      }
      if (url.protocol === 'chrome-extension:' || url.protocol === 'data:' || url.protocol === 'about:' || url.protocol === 'blob:') {
        await route.continue(); return;
      }
      if (url.protocol === 'http:' || url.protocol === 'https:') externalAttempts.push(url.href);
      await route.abort();
    });
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = new URL(worker.url()).hostname;
    const page = await context.newPage();
    page.on('console', message => {
      consoleEvents.push({ type: message.type(), text: message.text() });
      if (/target origin.*https:\/\/chatgpt\.com.*does not match.*recipient.*origin.*chrome-extension:\/\//iu.test(message.text())) {
        mismatchConsole.push(message.text());
      }
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.__cgpFrameSrcBefore = null;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        configurable: true, enumerable: descriptor.enumerable,
        get() { return descriptor.get.call(this); },
        set(value) {
          if (this.id === 'cgp-chatgpt-frame') {
            try {
              const childDocument = this.contentDocument;
              window.__cgpFrameSrcBefore = { href: this.contentWindow.location.href, locationOrigin: this.contentWindow.location.origin,
                documentUrl: childDocument?.URL || '', sameOriginReadable: childDocument === this.contentWindow.document, parentOrigin: location.origin };
            }
            catch (error) { window.__cgpFrameSrcBefore = { error: error.name }; }
          }
          descriptor.set.call(this, value);
        },
      });
    });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('#cgp-chatgpt-frame')?.src.includes('#cgp-frame='), undefined, { timeout: 15000 });
    const routeStart = Date.now();
    while (!sidepanelRequestInfo && Date.now() - routeStart < 15000) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(sidepanelRequestInfo, `Sidepanel ChatGPT route was not intercepted: ${JSON.stringify(routedChatGPT)}`);
    const initialDocument = await page.evaluate(() => window.__cgpFrameSrcBefore);
    assert.equal(initialDocument.href, 'about:blank', 'The iframe must be assigned its remote src while its initial about:blank is still current');
    assert.equal(initialDocument.documentUrl, 'about:blank');
    assert.equal(initialDocument.sameOriginReadable, true, 'The initial document must still be script-readable from the extension parent');
    assert.equal(initialDocument.parentOrigin, `chrome-extension://${extensionId}`);
    await new Promise(resolve => setTimeout(resolve, 1250));
    const mismatchBeforeLoad = [...mismatchConsole];
    releaseSidepanelResponse();

    let nativeFrame;
    const start = Date.now();
    while (Date.now() - start < 15000) {
      nativeFrame = page.frames().find(frame => frame.url().startsWith('https://chatgpt.com/'));
      if (nativeFrame) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(nativeFrame, `Local ChatGPT document did not commit; routed=${JSON.stringify(routedChatGPT)}`);
    const token = await page.locator('#cgp-chatgpt-frame').evaluate(frame => decodeURIComponent(new URL(frame.src).hash.slice('#cgp-frame='.length)));
    await nativeFrame.waitForFunction(expected => window.__cgpRebindMessages?.some(message => message.token === expected), token, { timeout: 12000 });
    const delivered = await nativeFrame.evaluate(expected => window.__cgpRebindMessages.find(message => message.token === expected), token);
    assert.deepEqual(delivered, { origin: `chrome-extension://${extensionId}`, isTrusted: true, sourceParent: true, token }, 'The loaded native document must receive the trusted parent rebind for its own token');
    await nativeFrame.getByRole('button', { name: '附加当前网页', exact: true }).waitFor();
    await nativeFrame.waitForFunction(() => !document.querySelector('[data-cgp-attach-page-host]')?.shadowRoot.querySelector('button').disabled);
    await nativeFrame.goto('https://chatgpt.com/c/reloaded-conversation', { waitUntil: 'domcontentloaded' });
    assert.equal(new URL(nativeFrame.url()).hash, '');
    await nativeFrame.waitForFunction(expected => document.documentElement.hasAttribute('data-theme')
      && window.__cgpRebindMessages?.some(message => message.isTrusted && message.sourceParent && message.token === expected)
      && document.querySelector('[data-cgp-attach-page-host]')?.shadowRoot.querySelector('button').disabled === false, token);
    assert.equal(await nativeFrame.locator('#prompt-textarea').textContent(), '', 'Rebinding must not replay any input');
    const mismatchPattern = /target origin.*https:\/\/chatgpt\.com.*does not match.*recipient.*origin.*chrome-extension:\/\//iu;
    const mismatchAll = [...mismatchConsole, ...pageErrors.filter(message => mismatchPattern.test(message))];
    assert.equal(mismatchBeforeLoad.length, 0, `Initial about:blank should not receive a ChatGPT-targeted postMessage: ${JSON.stringify({ mismatchBeforeLoad, consoleEvents, pageErrors })}`);
    assert.equal(mismatchAll.length, 0, `No ChatGPT target-origin mismatch should be logged: ${JSON.stringify({ mismatchAll, consoleEvents, pageErrors })}`);
    assert.equal(pageErrors.some(message => mismatchPattern.test(message)), false, `postMessage origin mismatch must not escape as a page error: ${JSON.stringify(pageErrors)}`);
    assert.deepEqual(externalAttempts, [], 'Non-fixture HTTP(S) requests are blocked and none should be attempted');
    assert.ok(routedChatGPT.some(request => request.sidepanel), `No sidepanel request was isolated: ${JSON.stringify(routedChatGPT)}`);
    console.log(`SIDEPANEL REBIND EVIDENCE ${JSON.stringify({ version: manifest.version, extensionId, initialDocument, sidepanelRequestInfo, mismatchBeforeLoad, mismatchAll, consoleEvents, pageErrors, delivered, externalAttempts, routedChatGPT })}`);
  } finally {
    releaseSidepanelResponse?.();
    await context?.close();
    if (path.dirname(profile) !== profileParent || profileParent !== root) throw new Error('Unsafe temporary profile cleanup path');
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
