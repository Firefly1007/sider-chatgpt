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
import { hiddenTargets } from './hidden-target.mjs';

const outputRoot = path.resolve('.test-output/sidebar-idle');
const extensionDist = path.resolve(process.env.CGP_IDLE_DIST || 'dist');
const executablePath = (process.env.CGP_CHROMIUM_PATH || chromium.executablePath());
const phase = process.env.CGP_SIDEPANEL_PHASE || 'fixed';
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

test(`sidebar connection and theme through natural worker idle (${phase})`, { timeout: 200000 }, async () => {
  await mkdir(outputRoot, { recursive: true });
  const profile = path.join(outputRoot, `profile-${phase}-${process.pid}-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  // Reuse the existing network-denied native fixtures without importing/running extension.test.js.
  const extensionTest = await readFile('tests/browser/extension.test.js', 'utf8');
  const fixtureCode = extensionTest.slice(extensionTest.indexOf('const sourceHTML ='), extensionTest.indexOf('async function until('));
  const proxyCode = extensionTest.slice(extensionTest.indexOf('async function offlineProxy()'), extensionTest.indexOf("test('isolated real MV3"));
  const fixture = runInNewContext(`${fixtureCode}\n${proxyCode}\n({ sourceHTML, chatHTML, offlineProxy })`, { URL, http, https, net, execFileSync, Promise });
  const manifest = JSON.parse(await readFile(path.join(extensionDist, 'manifest.json'), 'utf8'));
  const report = {
    phase,
    extensionDist,
    manifest: { name: manifest.name, version: manifest.version },
    surface: 'sidepanel.html opened as an extension tab; native ChatGPT iframe embedded; not Chrome browser side-panel UI',
    browser: 'headless Chromium with background timer throttling disabled so the extension-tab fixture models an open visible panel',
    events: [],
    monitor: [],
  };
  const reportPath = path.join(outputRoot, `${phase}-evidence.json`);
  let proxy, browserProcess, cdp, hidden;
  try {
    proxy = await fixture.offlineProxy();
    browserProcess = spawn(executablePath, [
      `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
      '--disable-background-timer-throttling', '--remote-debugging-port=0',
      `--disable-extensions-except=${extensionDist}`, `--load-extension=${extensionDist}`,
      `--proxy-server=http://127.0.0.1:${proxy.port}`, '--proxy-bypass-list=<-loopback>',
      '--ignore-certificate-errors', '--disable-quic', 'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    const active = await until(async () => {
      try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/); }
      catch { return null; }
    }, 'Chrome CDP endpoint unavailable');
    cdp = await rawCDP(`ws://127.0.0.1:${active[0]}${active[1]}`);
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    for (const name of ['Target.targetCreated', 'Target.targetDestroyed']) {
      cdp.on(name, event => report.events.push({ at: Date.now(), type: name, ...event }));
    }
    const targets = async () => (await cdp.send('Target.getTargets')).targetInfos;
    const worker = await until(async () => {
      for (const item of await targets()) {
        if (item.type !== 'service_worker' || !item.url.endsWith('/background.js')) continue;
        try { if (await cdp.evaluate(item.targetId, 'chrome.runtime.getManifest().name') === manifest.name) return item; }
        catch { }
      }
      return null;
    }, 'Startup worker for the requested extension missing');
    const workerUrl = worker.url;
    report.extensionId = new URL(workerUrl).hostname;
    report.initialWorkerTarget = worker.targetId;
    await until(async () => cdp.evaluate(worker.targetId, '!!globalThis.chrome?.runtime?.getManifest'), 'Worker runtime not initialized');
    report.workerVersion = await cdp.evaluate(worker.targetId, 'chrome.runtime.getManifest().version');
    report.workerEpoch = await cdp.evaluate(worker.targetId, `globalThis.__sidebarIdleEpoch='epoch-'+Date.now()`);
    hidden = await hiddenTargets({ browser: () => ({ newBrowserCDPSession: async () => cdp }) }, report.extensionId);

    const { targetId: sourceId } = await cdp.send('Target.createTarget', { url: 'http://example.test/article' });
    await until(() => cdp.evaluate(sourceId, "!!document.querySelector('#cgp-selection-root')"), 'Source content script missing');
    const sourceMarker = `source-${Date.now()}`;
    await cdp.evaluate(sourceId, `(()=>{window.__sidebarIdleSourceMarker=${JSON.stringify(sourceMarker)};const style=document.createElement('style');style.id='offline-darkreader';style.className='darkreader darkreader--user-agent';style.textContent='html{color-scheme:dark!important}';document.head.append(style)})()`);
    report.source = { targetId: sourceId, url: await cdp.evaluate(sourceId, 'location.href'), marker: sourceMarker };
    await until(() => cdp.evaluate(sourceId, "document.querySelector('#cgp-selection-root')?.getAttribute('data-cgp-theme')==='dark'"), 'Source Dark Reader theme did not apply');

    const { targetId: panelId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${report.extensionId}/sidepanel.html` });
    await until(() => cdp.evaluate(panelId, "!!document.querySelector('#cgp-chatgpt-frame')"), 'Sidebar frame did not initialize');
    await cdp.send('Target.activateTarget', { targetId: sourceId });
    const panelFrame = await cdp.evaluate(panelId, "document.querySelector('#cgp-chatgpt-frame').src");
    const token = new URL(panelFrame).hash.slice(1).split('=')[1];
    const nativeTarget = await until(async () => (await targets()).find(item => {
      try { return item.type === 'iframe' && new URL(item.url).hostname === 'chatgpt.com' && new URLSearchParams(new URL(item.url).hash.slice(1)).get('cgp-frame') === decodeURIComponent(token); }
      catch { return false; }
    }), 'Native iframe inside sidepanel did not load');
    const initialAttachButton = await until(() => readAttachPageButton(cdp, nativeTarget.targetId), 'Injected composer attachment icon missing');
    assert.equal(initialAttachButton.title, '附加当前网页');
    assert.equal(initialAttachButton.ariaLabel, '附加当前网页');
    report.sidebar = { targetId: panelId, frameUrl: panelFrame, nativeIframeTarget: nativeTarget.targetId };
    await until(() => cdp.evaluate(panelId, "document.documentElement.dataset.cgpTheme==='dark'"), 'Dark Reader theme did not reach sidepanel host');
    await until(() => cdp.evaluate(nativeTarget.targetId, "document.documentElement.getAttribute('data-theme')==='dark'"), 'Dark Reader theme did not reach native ChatGPT iframe');
    const docMarker = `iframe-${Date.now()}`;
    await cdp.evaluate(nativeTarget.targetId, `(()=>{window.__sidebarIdleDocumentMarker=${JSON.stringify(docMarker)};document.documentElement.dataset.sidebarIdleMarker=${JSON.stringify(docMarker)};window.fixtureHold=true})()`);
    await cdp.evaluate(nativeTarget.targetId, "document.querySelector('#prompt-textarea').innerHTML='<p>Original unsent draft</p>'");

    // The content page remains the active browser tab while sidepanel.html is held as a real extension page.
    await cdp.send('Target.activateTarget', { targetId: sourceId });
    await clickAttachPageButton(cdp, nativeTarget.targetId);
    await until(() => cdp.evaluate(nativeTarget.targetId, 'window.fixtureSends===1'), 'Attach current page did not send once');
    await until(() => cdp.evaluate(nativeTarget.targetId, "document.querySelector('#prompt-textarea').innerText==='Original unsent draft'"), 'Original draft did not return after page attachment');
    report.firstSend = await cdp.evaluate(nativeTarget.targetId, `({count:window.fixtureSends,submitted:window.fixtureSubmittedText,submittedHTML:window.fixtureSubmittedHTML,draft:document.querySelector('#prompt-textarea').innerText})`);
    await cdp.evaluate(nativeTarget.targetId, 'window.fixtureHold=false;window.finishFixture()');
    await until(async () => { const button = await readAttachPageButton(cdp, nativeTarget.targetId); return button && !button.disabled; }, 'Composer attachment icon did not unlock after page attachment');

    await cdp.evaluate(nativeTarget.targetId, `(()=>{const composer=document.querySelector('#prompt-textarea');composer.innerHTML='<p>Follow-up question after page attachment</p>';composer.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Follow-up question after page attachment'}));document.querySelector('[data-testid="send-button"]').click()})()`);
    await until(() => cdp.evaluate(nativeTarget.targetId, 'window.fixtureSends===2'), 'Manual native follow-up did not send');
    await until(() => cdp.evaluate(nativeTarget.targetId, "!document.querySelector('[data-testid=stop-button]')"), 'Manual native follow-up did not finish');
    await pause(250);
    report.beforeWait = {
      at: Date.now(),
      panel: await cdp.evaluate(panelId, `({theme:document.documentElement.dataset.cgpTheme,status:document.querySelector('#panel-status')?.textContent||'',frameSrc:document.querySelector('#cgp-chatgpt-frame').src})`),
      iframe: await cdp.evaluate(nativeTarget.targetId, `({url:location.href,theme:document.documentElement.getAttribute('data-theme'),marker:window.__sidebarIdleDocumentMarker,rootMarker:document.documentElement.dataset.sidebarIdleMarker,sends:window.fixtureSends,lastSubmitted:window.fixtureSubmittedText,busy:!!document.querySelector('[data-testid=stop-button]')})`),
      source: await cdp.evaluate(sourceId, `({url:location.href,marker:window.__sidebarIdleSourceMarker,theme:document.querySelector('#cgp-selection-root')?.getAttribute('data-cgp-theme')})`),
    };
    report.beforeWait.iframe.attachPageButton = await readAttachPageButton(cdp, nativeTarget.targetId);
    const spareFrames = await hidden.frames();
    report.offscreenBeforeWait = [];
    for (const frame of spareFrames.filter(item => item.ready)) report.offscreenBeforeWait.push({ token: frame.token, ...(await frame.evaluate(() => ({ sends: window.fixtureSends, url: location.href }))) });
    report.offscreenOnlySpare = report.offscreenBeforeWait.length === 1 && report.offscreenBeforeWait[0].sends === 0;
    const preWaitTargets = await targets();
    report.targetsBeforeWait = preWaitTargets.map(({ targetId, type, url, attached }) => ({ targetId, type, url, attached }));
    report.targetIdsBeforeWait = preWaitTargets.filter(item => [workerUrl, `chrome-extension://${report.extensionId}/sidepanel.html`, 'http://example.test/article'].some(url => item.url.startsWith(url)) || item.targetId === nativeTarget.targetId)
      .map(({ targetId, type, url, attached }) => ({ targetId, type, url, attached }));
    await cdp.detachTargets();
    report.detachedAt = Date.now();
    report.detachedAudit = (await targets())
      .map(({ targetId, type, url, attached }) => ({ targetId, type, url, attached }));
    report.allReportedTargetsDetached = report.detachedAudit.every(item => item.attached === false);
    assert.equal(report.allReportedTargetsDetached, true, 'Every discoverable target must have its debugger detached before idle observation');
    console.log(`SIDEBAR IDLE: ${phase}; extension tab + native fixture iframe; detached debugger wait 65s`);

    // Only browser-level Target.getTargets discovery runs during this interval.
    const waitUntil = Date.now() + 65000;
    while (Date.now() < waitUntil) {
      const at = Date.now(), current = await targets();
      report.monitor.push({
        at,
        elapsedMs: at - report.detachedAt,
        workers: current.filter(item => item.type === 'service_worker' && item.url === workerUrl).map(({ targetId, attached }) => ({ targetId, attached })),
        panelPresent: current.some(item => item.targetId === panelId),
        iframePresent: current.some(item => item.targetId === nativeTarget.targetId),
        sourcePresent: current.some(item => item.targetId === sourceId),
      });
      await pause(Math.min(2000, Math.max(1, waitUntil - Date.now())));
    }
    report.waitEndedAt = Date.now();
    const postWaitTargets = await targets();
    report.afterWaitTargetIds = postWaitTargets.filter(item => [workerUrl, `chrome-extension://${report.extensionId}/sidepanel.html`, 'http://example.test/article'].some(url => item.url.startsWith(url)) || item.targetId === nativeTarget.targetId)
      .map(({ targetId, type, url, attached }) => ({ targetId, type, url, attached }));
    report.workerDestroyedEvents = report.events.filter(item => item.type === 'Target.targetDestroyed' && item.targetId === report.initialWorkerTarget && item.at >= report.detachedAt);
    report.workerDestroyMsSinceDetach = report.workerDestroyedEvents[0] ? report.workerDestroyedEvents[0].at - report.detachedAt : null;
    report.destroyedTargetsDuringWait = report.events.filter(item => item.type === 'Target.targetDestroyed' && item.at >= report.detachedAt).map(item => {
      const created = report.events.find(event => event.type === 'Target.targetCreated' && event.targetInfo?.targetId === item.targetId);
      return { at: item.at, elapsedMs: item.at - report.detachedAt, targetId: item.targetId, type: created?.targetInfo?.type || null, url: created?.targetInfo?.url || null };
    });
    report.workerAfterWait = postWaitTargets.filter(item => item.type === 'service_worker' && item.url === workerUrl).map(item => ({ targetId: item.targetId, attached: item.attached }));

    report.afterWait = {
      at: Date.now(),
      panel: await cdp.evaluate(panelId, `({theme:document.documentElement.dataset.cgpTheme,status:document.querySelector('#panel-status')?.textContent||'',frameSrc:document.querySelector('#cgp-chatgpt-frame').src,marker:document.documentElement.dataset.sidebarIdleTestMarker||null})`),
      iframe: await cdp.evaluate(nativeTarget.targetId, `({url:location.href,theme:document.documentElement.getAttribute('data-theme'),marker:window.__sidebarIdleDocumentMarker,rootMarker:document.documentElement.dataset.sidebarIdleMarker,sends:window.fixtureSends,lastSubmitted:window.fixtureSubmittedText,busy:!!document.querySelector('[data-testid=stop-button]')})`),
      source: await cdp.evaluate(sourceId, `({url:location.href,marker:window.__sidebarIdleSourceMarker,theme:document.querySelector('#cgp-selection-root')?.getAttribute('data-cgp-theme')})`),
    };
    report.afterWait.iframe.attachPageButton = await readAttachPageButton(cdp, nativeTarget.targetId);
    const afterWorker = report.workerAfterWait[0];
    report.workerAfterWaitEpoch = afterWorker ? await cdp.evaluate(afterWorker.targetId, 'globalThis.__sidebarIdleEpoch') : null;
    report.pageDocumentPersisted = report.afterWait.source.marker === report.beforeWait.source.marker && report.afterWait.source.url === report.beforeWait.source.url;
    report.panelDocumentPersisted = report.afterWait.panel.frameSrc === report.beforeWait.panel.frameSrc && postWaitTargets.some(item => item.targetId === panelId);
    report.iframeDocumentPersisted = report.afterWait.iframe.marker === report.beforeWait.iframe.marker && report.afterWait.iframe.url === report.beforeWait.iframe.url && postWaitTargets.some(item => item.targetId === nativeTarget.targetId);
    report.iframeDarkBeforeAfter = report.beforeWait.iframe.theme === 'dark' && report.afterWait.iframe.theme === 'dark';
    report.attachPageButtonEnabledAfter = report.afterWait.iframe.attachPageButton?.disabled === false;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`SIDEBAR IDLE EVIDENCE ${reportPath}; worker destroyed=${report.workerDestroyedEvents.length>0}; panel status=${JSON.stringify(report.afterWait.panel.status)}; panel theme=${report.afterWait.panel.theme}; iframe theme=${report.afterWait.iframe.theme}; iframe persisted=${report.iframeDocumentPersisted}`);

    assert.equal(report.beforeWait.iframe.sends, 2, 'Attachment plus native follow-up should produce exactly two fixture sends');
    assert.match(report.firstSend.submitted, /已附加当前网页的内容/);
    assert.match(report.firstSend.submitted, /http:\/\/example\.test\/article/);
    assert.equal(report.beforeWait.panel.theme, 'dark');
    assert.equal(report.beforeWait.iframe.theme, 'dark');
    assert.equal(report.beforeWait.iframe.lastSubmitted, 'Follow-up question after page attachment');
    assert.ok(report.waitEndedAt - report.detachedAt >= 60000);
    assert.equal(report.pageDocumentPersisted, true, 'Source page must not reload');
    assert.equal(report.panelDocumentPersisted, true, 'Sidepanel extension page must not navigate');
    assert.equal(report.iframeDocumentPersisted, true, 'Native iframe must retain its document marker and target');

    if (phase === 'fixed') {
      assert.equal(report.workerDestroyedEvents.length, 0, 'Visible panel host Port should keep one worker alive during natural idle wait');
      assert.equal(report.workerAfterWait[0]?.targetId, report.initialWorkerTarget, 'The same worker target must survive the open panel');
      assert.equal(report.workerAfterWaitEpoch, report.workerEpoch, 'Worker global epoch must remain unchanged');
      assert.equal(report.beforeWait.panel.status, '', 'Successful attachment should not show a status bar');
      assert.equal(report.afterWait.panel.theme, 'dark');
      assert.equal(report.afterWait.iframe.theme, 'dark');
      assert.equal(report.afterWait.panel.status.includes('侧栏后台连接已中断'), false);
      assert.equal(report.attachPageButtonEnabledAfter, true);
      assert.equal(report.afterWait.iframe.sends, 2);
      assert.equal(report.offscreenOnlySpare, true, 'Only one unused zero-send offscreen iframe may remain before closing panel');

      report.offscreenAfterWait = [];
      for (const frame of await hidden.frames()) {
        if (!frame.ready) continue;
        report.offscreenAfterWait.push({ token: frame.token, targetId: frame.targetId, frameId: frame.frameId, ...(await frame.evaluate(() => ({ sends: window.fixtureSends, url: location.href }))) });
      }
      report.sameSingleSpareAfterWait = report.offscreenAfterWait.length === 1
        && report.offscreenAfterWait[0].token === report.offscreenBeforeWait[0].token
        && report.offscreenAfterWait[0].sends === 0;
      assert.equal(report.sameSingleSpareAfterWait, true, 'The offscreen spare must remain single, unchanged and unused');
      assert.equal((await targets()).some(item => item.type === 'service_worker' && item.url === workerUrl && item.targetId !== report.initialWorkerTarget), false,
        'Inspecting the spare must not cause a worker restart');
      await cdp.detachTargets();
      report.detachedBeforePanelClose = (await targets()).every(item => item.attached === false);
      assert.equal(report.detachedBeforePanelClose, true, 'Detach every target debugger again before the close-idle interval');

      await cdp.send('Target.closeTarget', { targetId: panelId });
      await until(async () => !(await targets()).some(item => item.targetId === panelId), 'Panel target remained after close request');
      report.closedPanelAt = Date.now();
      await cdp.detachTargets();
      report.closeDetachedAudit = (await targets()).map(({ targetId, type, url, attached }) => ({ targetId, type, url, attached }));
      report.allCloseTargetsDetached = report.closeDetachedAudit.every(item => item.attached === false);
      assert.equal(report.allCloseTargetsDetached, true, 'All target debuggers must be detached during the panel-close idle interval');
      const closeUntil = Date.now() + 45000;
      while (Date.now() < closeUntil) {
        const at = Date.now(), current = await targets();
        report.closeMonitor ||= [];
        report.closeMonitor.push({ at, elapsedMs: at - report.closedPanelAt, workers: current.filter(item => item.type === 'service_worker' && item.url === workerUrl).map(({ targetId }) => targetId), panelPresent: current.some(item => item.targetId === panelId) });
        await pause(Math.min(2000, Math.max(1, closeUntil - Date.now())));
      }
      report.workerDestroyedAfterClose = report.events.filter(item => item.type === 'Target.targetDestroyed' && item.targetId === report.initialWorkerTarget && item.at >= report.closedPanelAt);
      const closeTargets = await targets();
      report.workerAfterClose = closeTargets.filter(item => item.type === 'service_worker' && item.url === workerUrl).map(({ targetId }) => targetId);
      report.spareTargetAfterClose = closeTargets.find(item => item.targetId === report.offscreenAfterWait[0].targetId) || null;
      report.spareOnlyAfterClose = report.spareTargetAfterClose?.type === 'iframe'
        && new URLSearchParams(new URL(report.spareTargetAfterClose.url).hash.slice(1)).get('cgp-frame') === report.offscreenAfterWait[0].token
        && new URL(report.spareTargetAfterClose.url).searchParams.get('temporary-chat') === 'true';
      assert.equal(report.workerDestroyedAfterClose.length > 0, true, 'Closing the only live panel should allow natural idle suspension');
      assert.equal(report.workerAfterClose.length, 0, 'Unused offscreen spare alone must not keep the worker alive');
      assert.equal(report.closeMonitor.at(-1)?.panelPresent, false, 'Panel must remain closed during the natural idle check');
      assert.equal(report.spareOnlyAfterClose, true, 'Only the same unused zero-send offscreen iframe should remain');
    } else if (phase === 'baseline') {
      assert.ok(report.workerDestroyedEvents.length > 0, 'Baseline worker should naturally terminate despite the open panel Port');
      assert.equal(report.afterWait.panel.status, '侧栏后台连接已中断，请重新打开侧栏');
      assert.equal(report.panelButtonsEnabledAfter, false);
      assert.equal(report.afterWait.iframe.theme, null, 'Baseline disconnect removes the applied dark theme attribute (the fixture original was absent)');
      assert.equal(report.afterWait.iframe.sends, 2);
    }
  } finally {
    if (cdp) {
      try { await cdp.detachTargets(); } catch { }
      cdp.close();
    }
    await hidden?.dispose();
    await proxy?.close();
    browserProcess?.kill();
    if (browserProcess) await pause(300);
    const relative = path.relative(outputRoot, path.resolve(profile));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  }
});
