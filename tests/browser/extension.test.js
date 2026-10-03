import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { Script } from 'node:vm';
import katex from 'katex';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { hiddenTargets } from './hidden-target.mjs';
import { JSDOM } from 'jsdom';
import { selectionContext } from '../../src/features/materials.js';
import { buildPrompt } from '../../src/features/prompts.js';

const executablePath = (process.env.CGP_CHROMIUM_PATH || chromium.executablePath());
const outputRoot = path.resolve('.test-output');
const dist = path.resolve('dist');

const sourceHTML = `<!doctype html><html><head><title>Offline Source Article</title></head><body><main><article><h1>Offline research source</h1><p id="selection">Chosen passage for local extension integration.</p>${'<p>This offline article describes a bounded browser test. It has enough original readable body text to exercise material extraction without loading outside resources.</p>'.repeat(12)}</article></main></body></html>`;
function chatHTML(temporary) {
  return `<!doctype html><html><head><title>Offline Native ChatGPT Fixture</title><style>body{font:16px sans-serif;margin:24px}#prompt-textarea{border:1px solid;padding:12px;min-height:80px}#composer-actions{display:flex;align-items:center;gap:6px;min-height:40px;flex-wrap:nowrap}#composer-actions>button{flex:0 0 auto;margin:0}#composer-plus-btn{width:34px;height:34px;padding:0;border-radius:50%}#composer-actions input[type=file]{width:78px}html[data-theme="dark"] body{background:#212121;color:#eee}html[data-theme="dark"] #prompt-textarea{background:#303030;border-color:#555;color:#eee}html[data-theme="dark"] #composer-actions button{background:#333;color:#eee}button{padding:8px;margin:4px}article{padding:8px}</style></head><body>
    <aside style="display:none"><button data-testid="accounts-profile-button">Profile</button></aside>
    <main>${temporary ? '<h1>Temporary Chat</h1>' : ''}<section id="messages"></section><form><div id="prompt-textarea" class="ProseMirror" role="textbox" contenteditable="true" aria-label="询问 ChatGPT"><p><br></p></div><div id="composer-actions" class="composer-actions"><button type="button" id="composer-plus-btn" aria-label="添加文件等内容" title="添加文件等内容">+</button><button type="button" data-testid="model-switcher-dropdown-button" aria-expanded="false">Instant</button><button type="button" aria-label="Search" aria-pressed="false">Search</button><input type="file" aria-label="Attach files"><div id="attachments"></div><button type="button" data-testid="send-button">Send</button></div></form></main>
    <script>
    window.fixtureSends=0;window.fixtureStops=0;window.fixtureAttachments=[];window.fixtureHold=false;window.fixtureNoAssistant=false;window.fixtureInitialAnswer='Streaming offline answer';window.fixtureNativeTurn=false;window.fixtureContentSearchTurn=false;window.fixtureTurnNode=null;
    const model=document.querySelector('[data-testid="model-switcher-dropdown-button"]');
    model.onclick=()=>{const existing=document.querySelector('[role="menu"]');if(existing){existing.remove();model.setAttribute('aria-expanded','false');return;}
      model.setAttribute('aria-expanded','true');const menu=document.createElement('div');menu.setAttribute('role','menu');menu.innerHTML='<div role="menuitem" data-reasoning-slider="true" tabindex="0"><div role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="1" aria-valuenow="'+(model.textContent==='High'?1:0)+'"></div></div><button role="menuitemradio" aria-disabled="true">Pro</button>';
      const wrapper=menu.firstElementChild,slider=wrapper.firstElementChild;wrapper.onkeydown=e=>{if(e.key==='Escape'){menu.remove();model.setAttribute('aria-expanded','false');return;}const i=Math.max(0,Math.min(1,Number(slider.getAttribute('aria-valuenow'))+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)));slider.setAttribute('aria-valuenow',String(i));model.textContent=['Instant','High'][i];};menu.onkeydown=e=>{if(e.key==='Escape'){menu.remove();model.setAttribute('aria-expanded','false');}};document.body.append(menu);};
    const composer=document.querySelector('#prompt-textarea'),messages=document.querySelector('#messages');
    document.querySelector('[aria-label="Search"]').onclick=e=>e.currentTarget.setAttribute('aria-pressed',String(e.currentTarget.getAttribute('aria-pressed')!=='true'));
    document.querySelector('input[type="file"]').onchange=async e=>{document.querySelector('#attachments').replaceChildren();window.fixtureAttachments=await Promise.all([...e.target.files].map(async f=>({name:f.name,type:f.type,text:await f.text()})));for(const f of e.target.files){const chip=document.createElement('div');chip.dataset.testid='attachment';chip.dataset.state='complete';chip.textContent=f.name;document.querySelector('#attachments').append(chip);}};
    window.finishFixture=(answer,asHTML=false)=>{const article=window.fixtureAnswerArticle||messages.querySelector('article:last-child');if(!article)return;
      if(window.fixtureMindmapCode){const block=document.createElement('div');block.dataset.markdownCopy='code-block';const header=document.createElement('div');header.dataset.markdownCopy='exclude';header.textContent='text';const code=document.createElement('code');code.className='language-text';code.textContent=window.fixtureMindmapCode;block.append(header,code);article.querySelector('.markdown').replaceChildren(block);}
      else if(asHTML) article.querySelector('.markdown').innerHTML=answer;
      else article.querySelector('.markdown').textContent=answer||'Offline answer '+window.fixtureSends;
      document.querySelector('[data-testid="stop-button"]')?.remove();if(!article.querySelector('[data-testid="copy-turn-action-button"]')){const copy=document.createElement('button');copy.dataset.testid='copy-turn-action-button';copy.textContent='Copy';article.append(copy);}};
    document.querySelector('[data-testid="send-button"]').onclick=()=>{window.fixtureSubmittedHTML=composer.innerHTML;window.fixtureSubmittedText=composer.innerText;window.fixtureSenderToken=location.hash;window.fixtureActiveElement=document.activeElement.id;window.fixtureDocumentFocus=document.hasFocus();window.fixtureSends++;const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.dataset.messageId='u-'+window.fixtureSends;user.append(...[...composer.childNodes].map(node=>node.cloneNode(true)));let turn=null;if(window.fixtureContentSearchTurn){turn=document.createElement('div');turn.dataset.turnKey=user.dataset.messageId;turn.dataset.testid='conversation-turn';const contentTurn=document.createElement('div'),contentTurnKey='fallback-turn-'+(window.fixtureSends-1);contentTurn.dataset.contentSearchTurnKey=contentTurnKey;user.dataset.chatgptSearchUnitKey=contentTurnKey+':0:user';user.dataset.userMessageBubble='true';user.classList.add('temporaryBubble-test');contentTurn.append(user);turn.append(contentTurn);messages.append(turn);window.fixtureTurnNode=turn;window.fixtureContentTurnNode=contentTurn;}else if(window.fixtureNativeTurn){turn=document.createElement('div');turn.dataset.turnKey=user.dataset.messageId;turn.dataset.testid='conversation-turn';turn.append(user);messages.append(turn);window.fixtureTurnNode=turn;}else{messages.append(user);window.fixtureTurnNode=null;}composer.innerHTML='<p><br></p>';
      if(!window.fixtureNoAssistant){const article=document.createElement('article'),assistant=document.createElement('div');assistant.dataset.messageAuthorRole='assistant';assistant.dataset.messageId='a-'+window.fixtureSends;assistant.innerHTML='<div class="markdown"></div><a data-testid="web-citation" href="https://primary.example/report">Offline primary source</a>';assistant.querySelector('.markdown').textContent=window.fixtureInitialAnswer;article.append(assistant);if(turn)turn.append(article);else messages.append(article);}
      const stop=document.createElement('button');stop.type='button';stop.dataset.testid='stop-button';stop.textContent='Stop';stop.onclick=()=>{window.fixtureStops++;stop.remove();};document.querySelector('form').append(stop);if(location.pathname==='/')history.pushState({},'', '/c/offline-conversation'+(location.search||''));if(!window.fixtureHold)setTimeout(()=>window.finishFixture(),180);};
    </script></body></html>`;
}

async function until(check, message, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error(message);
}

async function select(page, action) {
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#selection'));
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.querySelector('#selection').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await page.locator(`[role="toolbar"] [data-action="${action}"]`).click();
}
async function waitAnswer(page, text, context, hidden) {
  try { await page.locator('.cgp-result').filter({ hasText: text }).waitFor({ timeout: 10000 }); }
  catch (error) {
    console.log(`SOURCE STATE ${await page.locator('.cgp-popover').textContent()}`);
    console.log(`PAGES ${context.pages().map((item) => item.url()).join(', ')}`);
    console.log(`CONTEXTS ${JSON.stringify(await context.serviceWorkers()[0].evaluate(() => chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})))}`);
    if(hidden) {
      const dom=new JSDOM(sourceHTML,{url:'http://example.test/article'});const range=dom.window.document.createRange();range.selectNodeContents(dom.window.document.querySelector('#selection'));dom.window.getSelection().addRange(range);
      const expected=buildPrompt({action:'search',origin:'selection',mode:'instant',targetLanguage:'中文',...selectionContext(dom.window.getSelection(),dom.window.document,'nearby')});
      const frames=[];for(const frame of await hidden.frames())if(frame.ready){try{frames.push({token:frame.token,...await frame.evaluate(()=>({url:location.href,sends:window.fixtureSends,submittedHTML:window.fixtureSubmittedHTML,submittedText:window.fixtureSubmittedText,active:window.fixtureActiveElement,focused:window.fixtureDocumentFocus,senderToken:window.fixtureSenderToken,users:[...document.querySelectorAll('[data-message-author-role="user"]')].map(item=>({html:item.outerHTML,text:item.textContent,innerText:item.innerText})),composer:document.querySelector('#prompt-textarea').innerHTML}))});}catch{}}
      const report=path.join(outputRoot,`hidden-prompt-diff-${Date.now()}.json`);await writeFile(report,JSON.stringify({expected,frames},null,2));console.log(`HIDDEN PROMPT DIFF ${report}`);
    }
    throw error;
  }
}

async function offlineProxy() {
  const script = `$key=[System.Security.Cryptography.RSA]::Create(2048)
    $request=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=chatgpt.com',$key,[System.Security.Cryptography.HashAlgorithmName]::SHA256,[System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $names=[System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $names.AddDnsName('chatgpt.com');$request.CertificateExtensions.Add($names.Build())
    $certificate=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),[DateTimeOffset]::UtcNow.AddDays(1))
    @{key=$key.ExportPkcs8PrivateKeyPem();cert=$certificate.ExportCertificatePem()} | ConvertTo-Json -Compress`;
  const pem = JSON.parse(execFileSync(process.env.CGP_POWERSHELL_PATH || 'pwsh', ['-NoLogo', '-NoProfile', '-Command', script], { encoding: 'utf8' }));
  const blocked = [], sockets = new Set();
  const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const secure = https.createServer(pem, (request, response) => {
    const url = new URL(request.url, 'https://chatgpt.com');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
    response.end(chatHTML(url.searchParams.get('temporary-chat') === 'true'));
  });
  secure.on('connection', (socket) => socket.on('error', () => {}));
  secure.on('tlsClientError', () => {});
  const securePort = await listen(secure);
  const proxy = http.createServer((request, response) => {
    let url;
    try { url = new URL(request.url); } catch { response.writeHead(400); response.end(); return; }
    if (url.origin === 'http://example.test') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(sourceHTML); }
    else { blocked.push(url.href); response.writeHead(502); response.end('External network blocked by test proxy'); }
  });
  proxy.on('connect', (request, client, head) => {
    client.on('error', () => {});
    if (request.url !== 'chatgpt.com:443') { blocked.push(request.url); client.end('HTTP/1.1 502 Blocked\r\n\r\n'); return; }
    const upstream = net.connect(securePort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
    sockets.add(upstream); sockets.add(client);
    upstream.on('close', () => sockets.delete(upstream)); client.on('close', () => sockets.delete(client));
  });
  proxy.on('connection', (socket) => socket.on('error', () => {}));
  const port = await listen(proxy);
  return { port, blocked, async close() {
    for (const socket of sockets) socket.destroy();
    secure.closeAllConnections(); proxy.closeAllConnections();
    await Promise.all([new Promise((resolve) => secure.close(resolve)), new Promise((resolve) => proxy.close(resolve))]);
  } };
}

test('isolated real MV3 extension lifecycle against network-blocked native-shaped fixtures', { timeout: 120000 }, async (t) => {
  new Script(chatHTML(true).match(/<script>([\s\S]*?)<\/script>/)[1]);
  const profile = path.join(outputRoot, `extension-runtime-${process.pid}-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  let context, proxy, hidden;
  try {
    proxy = await offlineProxy();
    context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, ignoreHTTPSErrors: true, colorScheme: 'light',
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, `--proxy-server=http://127.0.0.1:${proxy.port}`, '--proxy-bypass-list=<-loopback>', '--ignore-certificate-errors', '--disable-quic'] });
    const errors = [], consoleErrors = [];
    context.on('page', (page) => {
      page.on('pageerror', (error) => { errors.push(error.message); console.log(`PAGE ERROR ${page.url()} ${error.stack}`); });
      page.on('console', (message) => { if (message.type() === 'error') { consoleErrors.push(message.text()); console.log(`CONSOLE ${page.url()} ${message.text()}`); } });
    });
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 12000 });
    assert.match(worker.url(), /^chrome-extension:\/\/[a-p]{32}\/background\.js$/);
    await until(() => worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).some((rule) => rule.id === 74001)
      && await chrome.action.getTitle({}) === ''), 'Background did not finish initialization');
    const api = await worker.evaluate(async () => ({ id: chrome.runtime.id, manifest: chrome.runtime.getManifest(),
      title: await chrome.action.getTitle({}), rules: await chrome.declarativeNetRequest.getDynamicRules() }));
    assert.equal(api.manifest.manifest_version, 3);
    assert.equal(api.title, '');
    assert.ok(api.rules.some((rule) => rule.id === 74001));
    await worker.evaluate(() => {
      globalThis.__testTabEvents = [];
      chrome.tabs.onUpdated.addListener((id, change, tab) => globalThis.__testTabEvents.push({ id, change, url: tab.url }));
    });
    console.log(`MV3 loaded ${api.id}; DNR rules ${api.rules.length}`);
    hidden=await hiddenTargets(context,api.id);
    const visible=()=>worker.evaluate(async()=>({tabs:(await chrome.tabs.query({})).map(({id,windowId,url,active})=>({id,windowId,url,active})),windows:(await chrome.windows.getAll()).map(({id,type,focused})=>({id,type,focused}))}));
    let baseline=await visible();
    const nativeState=frame=>frame.evaluate(()=>({sends:window.fixtureSends,stops:window.fixtureStops,ready:!!document.querySelector('#prompt-textarea'),hidden:document.hidden,top:window===top,url:location.href,busy:!!document.querySelector('[data-testid="stop-button"]')}));
    async function readyFrames() {
      const frames=await hidden.frames(),result=[];
      for(const frame of frames)if(frame.ready) {try {const state=await nativeState(frame);if(state.ready && Number.isInteger(state.sends))result.push({frame,state});}catch{}}
      return result;
    }
    async function claimed() {let result;await until(async()=>{result=(await readyFrames()).find(({state})=>state.sends>0)?.frame;return !!result;},'No claimed hidden execution iframe');return result;}
    async function spare() {let result;await until(async()=>{const frames=await readyFrames();result=frames.find(({state})=>state.sends===0)?.frame;return !!result;},'Unused hidden replacement did not become ready');return result;}
    let execution,firstRoundPassed=false;
    await t.test('one hidden unused iframe prewarms without sending or creating any tab/window',async()=>{
      const unused=await spare();const frames=await readyFrames();assert.equal(frames.length,1);
      assert.equal((await nativeState(unused)).sends,0);
      assert.equal((await nativeState(unused)).top,false);
      const hostState=await hidden.hostState();assert.equal(hostState.opener,null);assert.equal(hostState.frames,1);
      console.log(`OFFSCREEN DOM visibility ${JSON.stringify(hostState)} (API-hidden, not display:none)`);
      assert.equal((await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}))).length,1);
      assert.deepEqual(await visible(),baseline);assert.equal(context.pages().some(page=>page.url().startsWith('https://chatgpt.com/')),false);
    });
    const sourcePage = await context.newPage();
    await sourcePage.goto('http://example.test/article');
    await sourcePage.locator('#cgp-selection-root').waitFor({ state: 'attached' });
    await sourcePage.bringToFront();baseline=await visible();
    await t.test('floating explain survives a same-id user bubble rerender and temporary detach', async () => {
      const unused = await spare();
      await unused.evaluate(() => { window.fixtureHold = true; });
      let rerenderExecution;
      try {
        await select(sourcePage, 'explain');
        rerenderExecution = await claimed();
        assert.equal(rerenderExecution.token, unused.token);
        await until(() => rerenderExecution.evaluate(() => !!document.querySelector('[data-testid="stop-button"]')), 'Explain task did not enter generation');
        await sourcePage.locator('.cgp-result').filter({ hasText: 'Streaming offline answer' }).waitFor({ timeout: 10000 });
        const bubble = await rerenderExecution.evaluate(() => {
          const user = document.querySelector('[data-message-author-role="user"]');
          return { sends: window.fixtureSends, submittedText: window.fixtureSubmittedText,
            id: user?.dataset.messageId, text: user?.innerText };
        });
        assert.equal(bubble.sends, 1);
        assert.equal(bubble.id, 'u-1');
        assert.equal(bubble.text, bubble.submittedText);

        await rerenderExecution.evaluate(() => {
          const original = document.querySelector('[data-message-author-role="user"]');
          if (!original) throw new Error('The generated user bubble was missing before redraw');
          const replacement = original.cloneNode(true), messages = document.querySelector('#messages');
          const state = window.__fixtureUserBubbleRerender = { original, replacement, id: replacement.dataset.messageId, text: replacement.innerText, removed: false, remounted: false };
          original.replaceWith(replacement);
          replacement.remove();
          state.removed = !replacement.isConnected;
          setTimeout(() => {
            messages.insertBefore(replacement, messages.querySelector('article:last-child'));
            state.remounted = replacement.isConnected;
          }, 0);
        });
        await until(() => rerenderExecution.evaluate(() => window.__fixtureUserBubbleRerender?.remounted === true), 'Rerendered user bubble did not remount');
        const redraw = await rerenderExecution.evaluate(() => {
          const state = window.__fixtureUserBubbleRerender;
          const current = document.querySelector('[data-message-author-role="user"]');
          return { id: current?.dataset.messageId, text: current?.innerText,
            oldConnected: state.original.isConnected, replacementConnected: state.replacement.isConnected,
            replacementIsCurrent: state.replacement === current, stableId: state.id, originalText: state.text,
            removed: state.removed, remounted: state.remounted };
        });
        assert.equal(redraw.oldConnected, false);
        assert.equal(redraw.replacementConnected, true);
        assert.equal(redraw.replacementIsCurrent, true);
        assert.equal(redraw.removed, true);
        assert.equal(redraw.remounted, true);
        assert.equal(redraw.id, 'u-1');
        assert.equal(redraw.stableId, redraw.id);
        assert.equal(redraw.text, bubble.submittedText);
        assert.equal(redraw.originalText, bubble.submittedText);

        const answer = 'Correct explanation after user bubble rerender';
        await rerenderExecution.evaluate(text => { window.fixtureHold = false; window.finishFixture(text); }, answer);
        await waitAnswer(sourcePage, answer, context, hidden);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '完成', 'Explain result did not complete');
        assert.ok((await sourcePage.locator('.cgp-result').textContent()).includes(answer));
        assert.equal(await rerenderExecution.evaluate(() => window.fixtureSends), 1, 'The task must send exactly once');
        assert.doesNotMatch(await sourcePage.locator('.cgp-popover').innerText(), /SESSION_LOST|本次用户消息已离开页面/u);

        await sourcePage.locator('.cgp-popover button[aria-label="关闭"]').click();
        await until(() => rerenderExecution.isClosed(), 'Closing completed explain task did not remove its hidden iframe');
        assert.equal((await hidden.frames()).length, 1);
        const replacement = await spare();
        assert.equal((await nativeState(replacement)).sends, 0);
        assert.deepEqual(await visible(), baseline);
      } finally {
        const close = sourcePage.locator('.cgp-popover button[aria-label="关闭"]');
        if (await close.count()) { try { await close.click({ timeout: 1000 }); } catch { } }
        if (rerenderExecution && !rerenderExecution.isClosed()) { try { await until(() => rerenderExecution.isClosed(), 'Explain task cleanup timed out', 3000); } catch { } }
      }
    });
    await t.test('native user echo stays waiting without an answer, then a new native alert fails promptly', async () => {
      const unused = await spare();
      await unused.evaluate(() => { window.fixtureHold = true; window.fixtureNoAssistant = true; });
      let waitingExecution;
      try {
        await select(sourcePage, 'explain');
        waitingExecution = await claimed();
        assert.equal(waitingExecution.token, unused.token);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '已发送，等待回答', 'Confirmed native user echo did not enter waiting');
        const native = await waitingExecution.evaluate(() => ({ sends: window.fixtureSends,
          users: [...document.querySelectorAll('[data-message-author-role="user"]')].map(item => item.dataset.messageId),
          assistants: document.querySelectorAll('[data-message-author-role="assistant"]').length }));
        assert.deepEqual(native, { sends: 1, users: ['u-1'], assistants: 0 });
        assert.equal(await sourcePage.locator('.cgp-result').textContent(), '', 'Waiting should not invent an answer');
        assert.equal(await sourcePage.locator('.cgp-send').isDisabled(), true);
        assert.equal(await sourcePage.locator('.cgp-operations button').filter({ hasText: /^重试$/ }).isDisabled(), true);
        assert.equal(await sourcePage.locator('.cgp-operations button').filter({ hasText: /^停止$/ }).isEnabled(), true);

        const nativeError = 'The native page rejected this prompt';
        await waitingExecution.evaluate(message => {
          const alert = document.createElement('div'); alert.setAttribute('role', 'alert'); alert.textContent = message; document.body.append(alert);
        }, nativeError);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '失败', 'New native alert did not fail the task promptly', 5000);
        assert.equal(await sourcePage.locator('.cgp-error').textContent(), nativeError);
        assert.equal(await waitingExecution.evaluate(() => window.fixtureSends), 1, 'Native failure must not cause a retry');
        assert.equal(await sourcePage.locator('.cgp-result').textContent(), '');
        await sourcePage.locator('.cgp-popover button[aria-label="关闭"]').click();
        await until(() => waitingExecution.isClosed(), 'Closing failed Explain task did not remove its hidden iframe');
        assert.equal((await hidden.frames()).length, 1);
        await spare();
      } finally {
        const close = sourcePage.locator('.cgp-popover button[aria-label="关闭"]');
        if (await close.count()) { try { await close.click({ timeout: 1000 }); } catch { } }
        if (waitingExecution && !waitingExecution.isClosed()) { try { await until(() => waitingExecution.isClosed(), 'Waiting Explain cleanup timed out', 3000); } catch { } }
      }
    });
    await t.test('Explain follows the same native turn after its user bubble is permanently removed', async () => {
      const unused = await spare();
      await unused.evaluate(() => {
        window.fixtureHold = true;
        window.fixtureNoAssistant = true;
        window.fixtureNativeTurn = true;
      });
      const evidencePath = path.join(outputRoot, 'same-turn-user-detach-0118.json');
      const trace = [];
      const record = async (stage, evidence) => {
        trace.push({ stage, ...evidence });
        await writeFile(evidencePath, JSON.stringify(trace, null, 2));
      };
      let detachedExecution;
      try {
        await select(sourcePage, 'explain');
        detachedExecution = await claimed();
        assert.equal(detachedExecution.token, unused.token);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '已发送，等待回答', 'Confirmed native user echo did not enter waiting');
        const echo = await detachedExecution.evaluate(() => {
          const user = document.querySelector('[data-message-author-role="user"]');
          const turn = user?.closest('[data-turn-key]');
          return { sends: window.fixtureSends, userCount: document.querySelectorAll('[data-message-author-role="user"]').length,
            assistantCount: document.querySelectorAll('[data-message-author-role="assistant"]').length,
            userId: user?.dataset.messageId, turnKey: turn?.dataset.turnKey,
            textMatchesSubmitted: user?.innerText === window.fixtureSubmittedText,
            nativeStop: !!document.querySelector('[data-testid="stop-button"]') };
        });
        assert.equal(echo.sends, 1);
        assert.equal(echo.userCount, 1);
        assert.equal(echo.assistantCount, 0, 'No assistant exists before the native user echo is removed');
        assert.equal(echo.userId, 'u-1');
        assert.equal(echo.turnKey, 'u-1', 'The confirmed user belongs to the stable native turn key');
        assert.equal(echo.textMatchesSubmitted, true);
        assert.equal(echo.nativeStop, true);
        assert.equal(await sourcePage.locator('.cgp-result').textContent(), '');
        await record('waiting-user-echo-confirmed', { native: echo, state: await sourcePage.locator('.cgp-state').textContent(), visible: await visible() });

        const detached = await detachedExecution.evaluate(() => {
          const turn = window.fixtureTurnNode;
          const user = turn?.querySelector('[data-message-author-role="user"]');
          if (!turn?.isConnected || !user) throw new Error('Expected the confirmed user and its native turn before detach');
          user.remove();
          return { userConnected: user.isConnected, turnConnected: turn.isConnected, turnKey: turn.dataset.turnKey,
            usersLeft: document.querySelectorAll('[data-message-author-role="user"]').length,
            assistantsLeft: turn.querySelectorAll('[data-message-author-role="assistant"]').length };
        });
        assert.deepEqual(detached, { userConnected: false, turnConnected: true, turnKey: 'u-1', usersLeft: 0, assistantsLeft: 0 });
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(await sourcePage.locator('.cgp-state').textContent(), '已发送，等待回答', 'The task must keep waiting while the user is absent');
        assert.equal(await sourcePage.locator('.cgp-result').textContent(), '', 'No answer should be inferred during the gap');
        assert.equal(await detachedExecution.evaluate(() => window.fixtureSends), 1);
        await record('user-removed-turn-retained-still-waiting', { native: detached,
          state: await sourcePage.locator('.cgp-state').textContent(), result: await sourcePage.locator('.cgp-result').textContent(), visible: await visible() });

        await detachedExecution.evaluate(() => {
          const otherTurn = document.createElement('div'); otherTurn.dataset.turnKey = 'u-other';
          const article = document.createElement('article'), assistant = document.createElement('div');
          assistant.dataset.messageAuthorRole = 'assistant'; assistant.dataset.messageId = 'a-other';
          assistant.innerHTML = '<div class="markdown">Unrelated turn output must be ignored</div>';
          article.append(assistant); otherTurn.append(article); document.querySelector('#messages').append(otherTurn);
          window.fixtureOtherTurn = otherTurn;
        });
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(await sourcePage.locator('.cgp-state').textContent(), '已发送，等待回答', 'A new assistant in another turn must not satisfy this task');
        assert.equal(await sourcePage.locator('.cgp-result').textContent(), '');
        assert.equal(await sourcePage.locator('.cgp-result').getByText('Unrelated turn output must be ignored').count(), 0);
        await record('unrelated-turn-assistant-ignored', { state: await sourcePage.locator('.cgp-state').textContent(),
          result: await sourcePage.locator('.cgp-result').textContent(), visible: await visible() });

        await detachedExecution.evaluate(() => { window.fixtureTurnNode.dataset.turnKey = 'changed-native-key'; });
        await until(() => sourcePage.locator('.cgp-error').evaluate(element => Boolean(element.dataset.cgpDiagnostics)), 'Missing-turn diagnostics did not reach the source before timeout');
        const diagnostics = await sourcePage.locator('.cgp-error').evaluate(element => JSON.parse(element.dataset.cgpDiagnostics));
        assert.equal(diagnostics.capturedIdentity.userId, 'u-1');
        assert.equal(diagnostics.capturedIdentity.turnKey, 'u-1');
        assert.equal(diagnostics.capturedIdentity.shellConnected, true);
        assert.equal(diagnostics.capturedIdentity.shellCurrentKey, 'changed-native-key');
        assert.ok(diagnostics.currentTurns.some(turn => turn.key === 'changed-native-key'));
        assert.equal(await sourcePage.locator('.cgp-state').textContent(), '已发送，等待回答');
        assert.equal(await sourcePage.locator('.cgp-result').textContent(), '');
        assert.equal(await sourcePage.locator('.cgp-error').textContent(), '');
        await detachedExecution.evaluate(() => { window.fixtureTurnNode.dataset.turnKey = 'u-1'; });

        const answer = 'Reply from the confirmed native turn';
        const associatedAssistant = await detachedExecution.evaluate(text => {
          const turn = window.fixtureTurnNode, article = document.createElement('article'), assistant = document.createElement('div');
          if (!turn?.isConnected || turn.dataset.turnKey !== 'u-1') throw new Error('Confirmed native turn was not retained');
          assistant.dataset.messageAuthorRole = 'assistant'; assistant.dataset.messageId = 'a-1';
          assistant.innerHTML = '<div class="markdown"></div><a data-testid="web-citation" href="https://primary.example/turn">Offline turn source</a>';
          assistant.querySelector('.markdown').textContent = text; article.append(assistant); turn.append(article);
          window.fixtureAnswerArticle = article;
          return { turnKey: assistant.closest('[data-turn-key]')?.dataset.turnKey,
            assistantId: assistant.dataset.messageId, sameTurn: assistant.closest('[data-turn-key]') === turn,
            sameKeyAssistantCount: turn.querySelectorAll('[data-message-author-role="assistant"]').length,
            otherTurnKey: window.fixtureOtherTurn?.dataset.turnKey };
        }, answer);
        assert.deepEqual(associatedAssistant, { turnKey: 'u-1', assistantId: 'a-1', sameTurn: true, sameKeyAssistantCount: 1, otherTurnKey: 'u-other' });
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '生成中', 'Same-turn assistant did not enter streaming');
        assert.equal((await sourcePage.locator('.cgp-result').textContent()).trimEnd(), answer);
        await record('same-turn-assistant-streaming', { native: associatedAssistant, state: await sourcePage.locator('.cgp-state').textContent(),
          resultMatches: (await sourcePage.locator('.cgp-result').textContent()).trimEnd() === answer, visible: await visible() });
        await detachedExecution.evaluate(text => window.finishFixture(text), answer);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '完成', 'Same-turn assistant did not complete');
        assert.ok((await sourcePage.locator('.cgp-result').textContent()).includes(answer));
        const finalNative = await detachedExecution.evaluate(() => ({ sends: window.fixtureSends,
          users: document.querySelectorAll('[data-message-author-role="user"]').length,
          targetTurnKey: window.fixtureTurnNode?.dataset.turnKey,
          targetAssistants: window.fixtureTurnNode?.querySelectorAll('[data-message-author-role="assistant"]').length,
          otherTurnAssistant: window.fixtureOtherTurn?.querySelector('[data-message-author-role="assistant"]')?.dataset.messageId }));
        assert.deepEqual(finalNative, { sends: 1, users: 0, targetTurnKey: 'u-1', targetAssistants: 1, otherTurnAssistant: 'a-other' });
        assert.deepEqual(await visible(), baseline, 'The task must not create a visible tab or window');
        await record('completed-from-retained-turn', { native: finalNative, state: await sourcePage.locator('.cgp-state').textContent(),
          resultMatches: (await sourcePage.locator('.cgp-result').textContent()).includes(answer), visible: await visible() });
        console.log(`SAME TURN DETACH ARTIFACT ${evidencePath}`);

        await sourcePage.locator('.cgp-popover button[aria-label="关闭"]').click();
        await until(() => detachedExecution.isClosed(), 'Closing completed same-turn task did not remove its hidden iframe');
        assert.equal((await hidden.frames()).length, 1);
        await spare();
        assert.deepEqual(await visible(), baseline);
      } finally {
        const close = sourcePage.locator('.cgp-popover button[aria-label="关闭"]');
        if (await close.count()) { try { await close.click({ timeout: 1000 }); } catch { } }
        if (detachedExecution && !detachedExecution.isClosed()) { try { await until(() => detachedExecution.isClosed(), 'Same-turn task cleanup timed out', 3000); } catch { } }
      }
    });
    await t.test('Explain keeps one fallback session across long-prompt replacement, follow-up and stop', async () => {
      const unused = await spare();
      const evidencePath = path.join(outputRoot, 'fallback-turn-followups-0122.json');
      const trace = [];
      const record = async (stage, evidence) => {
        trace.push({ stage, ...evidence });
        await writeFile(evidencePath, JSON.stringify(trace, null, 2));
      };
      let backgroundLength;
      let longExecution;
      try {
        backgroundLength = await sourcePage.evaluate(() => {
          const background = document.createElement('p');
          background.dataset.fixtureLongContext = 'true';
          background.textContent = 'Long source context sentence. '.repeat(1667);
          document.querySelector('#selection').after(background);
          window.fixtureLongContext = background;
          return background.textContent.length;
        });
        assert.ok(backgroundLength >= 49000 && backgroundLength <= 51000, `Expected about 50K of source context, got ${backgroundLength}`);
        await unused.evaluate(() => {
          window.fixtureHold = true;
          window.fixtureNoAssistant = true;
          window.fixtureContentSearchTurn = true;
        });
        const temporaryBeforeSend = await unused.evaluate(() => ({
          heading: document.querySelector('main h1')?.textContent,
          saveChatButtonCount: document.querySelectorAll('button[aria-label="保存聊天"]').length,
        }));
        assert.deepEqual(temporaryBeforeSend, { heading: 'Temporary Chat', saveChatButtonCount: 0 }, 'The fixture starts with its native temporary-chat heading and no post-submit Save Chat button');
        const selectedText = await sourcePage.evaluate(() => {
          const node = document.querySelector('#selection'), range = document.createRange();
          range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range);
          return getSelection().toString();
        });
        assert.equal(selectedText, 'Chosen passage for local extension integration.', 'The selected Explain passage should remain the original short selection');
        await select(sourcePage, 'explain');
        longExecution = await claimed();
        assert.equal(longExecution.token, unused.token);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '已发送，等待回答', 'Long native user echo did not enter waiting');
        const echo = await longExecution.evaluate(() => {
          const user = document.querySelector('[data-message-author-role="user"]');
          const outer = user?.closest('[data-turn-key]');
          const contentTurn = user?.closest('[data-content-search-turn-key]');
          user.style.maxHeight = '494px';
          user.style.overflow = 'hidden';
          const style = getComputedStyle(user);
          return { sends: window.fixtureSends, userCount: document.querySelectorAll('[data-message-author-role="user"]').length,
            assistantCount: document.querySelectorAll('[data-message-author-role="assistant"]').length,
            submittedTextLength: window.fixtureSubmittedText.length, echoTextLength: user.innerText.length,
            echoMatchesSubmitted: user.innerText === window.fixtureSubmittedText,
            userId: user.dataset.messageId, userUnitKey: user.dataset.chatgptSearchUnitKey,
            outerTurnKey: outer?.dataset.turnKey, contentTurnKey: contentTurn?.dataset.contentSearchTurnKey,
            temporaryHeading: document.querySelector('main h1')?.textContent,
            foldedStyle: { maxHeight: style.maxHeight, overflow: style.overflow },
            textRetainedAfterFold: user.innerText.length === window.fixtureSubmittedText.length,
            stopVisible: !!document.querySelector('[data-testid="stop-button"]') };
        });
        assert.equal(echo.sends, 1);
        assert.equal(echo.userCount, 1);
        assert.equal(echo.assistantCount, 0, 'No assistant should exist before the native echo outer turn is removed');
        assert.ok(echo.submittedTextLength > 49000, `Expected submitted prompt above 49K chars, got ${echo.submittedTextLength}`);
        assert.equal(echo.echoTextLength, echo.submittedTextLength);
        assert.equal(echo.echoMatchesSubmitted, true);
        assert.equal(echo.userId, 'u-1');
        assert.equal(echo.userUnitKey, 'fallback-turn-0:0:user');
        assert.equal(echo.outerTurnKey, 'u-1');
        assert.equal(echo.contentTurnKey, 'fallback-turn-0');
        assert.equal(echo.temporaryHeading, 'Temporary Chat', 'The native temporary-chat heading should still be present at echo confirmation');
        assert.deepEqual(echo.foldedStyle, { maxHeight: '494px', overflow: 'hidden' });
        assert.equal(echo.textRetainedAfterFold, true);
        assert.equal(echo.stopVisible, true);
        await record('long-user-echo-confirmed-folded-no-answer', { native: echo, sourceBackgroundLength: backgroundLength,
          selectedTextLength: selectedText.length, state: await sourcePage.locator('.cgp-state').textContent(), visible: await visible() });

        const detached = await longExecution.evaluate(() => {
          const outer = window.fixtureTurnNode;
          const user = outer?.querySelector('[data-message-author-role="user"]');
          if (!outer?.isConnected || !user) throw new Error('Expected the confirmed folded user and its UUID outer turn before replacement');
          outer.remove();
          document.querySelector('main h1')?.remove();
          let saveChat = document.querySelector('button[aria-label="保存聊天"]');
          if (!saveChat) {
            saveChat = document.createElement('button');
            saveChat.type = 'button'; saveChat.setAttribute('aria-label', '保存聊天'); saveChat.textContent = '保存聊天';
            document.querySelector('main').prepend(saveChat);
          }
          return { outerConnected: outer.isConnected, userConnected: user.isConnected,
            usersLeft: document.querySelectorAll('[data-message-author-role="user"]').length,
            assistantsLeft: document.querySelectorAll('[data-message-author-role="assistant"]').length,
            fallbackTurnsLeft: document.querySelectorAll('[data-content-search-turn-key="fallback-turn-0"]').length,
            temporaryHeading: document.querySelector('main h1')?.textContent || null,
            saveChatButton: { tagName: saveChat.tagName, ariaLabel: saveChat.getAttribute('aria-label'),
              connected: saveChat.isConnected, outsideRemovedTurn: !outer.contains(saveChat) } };
        });
        assert.deepEqual(detached, { outerConnected: false, userConnected: false, usersLeft: 0, assistantsLeft: 0, fallbackTurnsLeft: 0,
          temporaryHeading: null, saveChatButton: { tagName: 'BUTTON', ariaLabel: '保存聊天', connected: true, outsideRemovedTurn: true } });
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(await sourcePage.locator('.cgp-state').textContent(), '已发送，等待回答', 'The task must keep waiting after its whole original turn is removed');
        assert.equal(await sourcePage.locator('.cgp-result').textContent(), '', 'No answer should be inferred during the replacement gap');
        assert.equal(await sourcePage.locator('.cgp-error').textContent(), '', 'Removing the temporary heading should not expose a temporary-session error while waiting');
        assert.equal(await longExecution.evaluate(() => window.fixtureSends), 1);
        await record('uuid-outer-removed-still-waiting', { native: detached, state: await sourcePage.locator('.cgp-state').textContent(),
          result: await sourcePage.locator('.cgp-result').textContent(), visible: await visible() });

        const replacement = await longExecution.evaluate(() => {
          const outer = document.createElement('div'); outer.dataset.turnKey = 'fallback-turn-0'; outer.dataset.testid = 'conversation-turn';
          const contentTurn = document.createElement('div'); contentTurn.dataset.contentSearchTurnKey = 'fallback-turn-0';
          const article = document.createElement('article'), assistant = document.createElement('div');
          assistant.dataset.messageAuthorRole = 'assistant'; assistant.dataset.messageId = 'a-1';
          assistant.dataset.chatgptSearchUnitKey = 'fallback-turn-0:1:assistant';
          assistant.innerHTML = '<div class="markdown">Fallback replacement answer</div>';
          article.append(assistant); contentTurn.append(article); outer.append(contentTurn); document.querySelector('#messages').append(outer);
          window.fixtureTurnNode = outer; window.fixtureContentTurnNode = contentTurn; window.fixtureAnswerArticle = article;
          return { turnKey: outer.dataset.turnKey, contentTurnKey: contentTurn.dataset.contentSearchTurnKey,
            assistantId: assistant.dataset.messageId, assistantUnitKey: assistant.dataset.chatgptSearchUnitKey,
            assistantCount: document.querySelectorAll('[data-message-author-role="assistant"]').length,
            userCount: document.querySelectorAll('[data-message-author-role="user"]').length,
            matchingContentTurns: document.querySelectorAll('[data-content-search-turn-key="fallback-turn-0"]').length,
            assistantInReplacement: assistant.closest('[data-turn-key]') === outer && assistant.closest('[data-content-search-turn-key]') === contentTurn };
        });
        assert.deepEqual(replacement, { turnKey: 'fallback-turn-0', contentTurnKey: 'fallback-turn-0',
          assistantId: 'a-1', assistantUnitKey: 'fallback-turn-0:1:assistant', assistantCount: 1, userCount: 0,
          matchingContentTurns: 1, assistantInReplacement: true });
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '生成中', 'Fallback-turn assistant did not enter streaming');
        const answer = 'Fallback replacement answer';
        assert.equal((await sourcePage.locator('.cgp-result').textContent()).trimEnd(), answer);
        assert.equal(await sourcePage.locator('.cgp-error').textContent(), '', 'Save Chat evidence should allow the confirmed replacement answer without a temporary-session error');
        await record('fallback-assistant-streaming', { native: replacement, state: await sourcePage.locator('.cgp-state').textContent(),
          resultMatches: (await sourcePage.locator('.cgp-result').textContent()).trimEnd() === answer, visible: await visible() });
        await longExecution.evaluate(text => window.finishFixture(text), answer);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '完成', 'Fallback-turn answer did not complete');
        assert.ok((await sourcePage.locator('.cgp-result').textContent()).includes(answer));
        assert.equal(await sourcePage.locator('.cgp-error').textContent(), '');
        const firstNative = await longExecution.evaluate(() => ({ sends: window.fixtureSends,
          users: document.querySelectorAll('[data-message-author-role="user"]').length,
          assistants: document.querySelectorAll('[data-message-author-role="assistant"]').length,
          outerTurnKey: window.fixtureTurnNode?.dataset.turnKey,
          contentTurnKey: window.fixtureContentTurnNode?.dataset.contentSearchTurnKey,
          assistantUnitKey: window.fixtureTurnNode?.querySelector('[data-message-author-role="assistant"]')?.dataset.chatgptSearchUnitKey }));
        assert.deepEqual(firstNative, { sends: 1, users: 0, assistants: 1, outerTurnKey: 'fallback-turn-0',
          contentTurnKey: 'fallback-turn-0', assistantUnitKey: 'fallback-turn-0:1:assistant' });
        await record('completed-from-fallback-replacement', { native: firstNative, state: await sourcePage.locator('.cgp-state').textContent(),
          resultMatches: (await sourcePage.locator('.cgp-result').textContent()).includes(answer), visible: await visible() });

        const secondPrompt = 'Follow up while the first native user remains absent';
        const secondAnswer = 'Answer to the first follow-up';
        const thinking = sourcePage.getByRole('combobox', { name: '思考程度', exact: true });
        assert.equal(await thinking.isEnabled(), true, 'Quick-action followups must unlock thinking mode after the first answer');
        assert.equal(await longExecution.evaluate(() => document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent), 'Instant');
        await thinking.focus();
        await until(async () => await thinking.locator('option[value="high"]:not([disabled])').count() === 1, 'Native High mode was not discovered');
        await thinking.selectOption('high');
        await sourcePage.locator('textarea[aria-label="问题或追问"]').fill(secondPrompt);
        await sourcePage.locator('.cgp-send').click();
        await until(async () => await longExecution.evaluate(() => window.fixtureSends) === 2, 'First follow-up did not send exactly once');
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '已发送，等待回答', 'First follow-up did not enter waiting');
        assert.equal(await thinking.isDisabled(), true, 'The selector remains locked during generation');
        assert.equal(await longExecution.evaluate(() => document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent), 'High', 'The same native conversation must actually use High for the followup');
        const secondToken = (await claimed()).token;
        assert.equal(secondToken, longExecution.token, 'The first follow-up must use the original hidden execution token');
        const secondEcho = await longExecution.evaluate(() => {
          const users = [...document.querySelectorAll('[data-message-author-role="user"]')];
          const user = users.at(-1), outer = user?.closest('[data-turn-key]'), contentTurn = user?.closest('[data-content-search-turn-key]');
          return { sends: window.fixtureSends, userIds: users.map(item => item.dataset.messageId),
            oldUserAbsent: !users.some(item => item.dataset.messageId === 'u-1'),
            userTextMatchesSubmitted: user?.innerText === window.fixtureSubmittedText,
            userUnitKey: user?.dataset.chatgptSearchUnitKey, turnKey: outer?.dataset.turnKey,
            contentTurnKey: contentTurn?.dataset.contentSearchTurnKey,
            temporaryBubble: user?.getAttribute('data-user-message-bubble') === 'true' && user.classList.contains('temporaryBubble-test'),
            saveChatButton: !!document.querySelector('button[aria-label="保存聊天"]') };
        });
        assert.deepEqual(secondEcho, { sends: 2, userIds: ['u-2'], oldUserAbsent: true,
          userTextMatchesSubmitted: true, userUnitKey: 'fallback-turn-1:0:user', turnKey: 'u-2', contentTurnKey: 'fallback-turn-1',
          temporaryBubble: true, saveChatButton: true });
        const secondNative = await longExecution.evaluate(text => {
          const outer = window.fixtureTurnNode, contentTurn = window.fixtureContentTurnNode;
          if (!outer?.isConnected || outer.dataset.turnKey !== 'u-2' || contentTurn?.dataset.contentSearchTurnKey !== 'fallback-turn-1') {
            throw new Error('Expected the second follow-up user in fallback-turn-1');
          }
          const article = document.createElement('article'), assistant = document.createElement('div');
          assistant.dataset.messageAuthorRole = 'assistant'; assistant.dataset.messageId = 'a-2';
          assistant.dataset.chatgptSearchUnitKey = 'fallback-turn-1:1:assistant';
          assistant.innerHTML = '<div class="markdown"></div>'; assistant.querySelector('.markdown').textContent = text;
          article.append(assistant); contentTurn.append(article); window.fixtureAnswerArticle = article;
          return { assistantId: assistant.dataset.messageId, assistantUnitKey: assistant.dataset.chatgptSearchUnitKey,
            sameOuter: assistant.closest('[data-turn-key]') === outer, userCount: document.querySelectorAll('[data-message-author-role="user"]').length };
        }, secondAnswer);
        assert.deepEqual(secondNative, { assistantId: 'a-2', assistantUnitKey: 'fallback-turn-1:1:assistant', sameOuter: true, userCount: 1 });
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '生成中', 'First follow-up did not enter streaming');
        assert.equal((await sourcePage.locator('.cgp-result').textContent()).trimEnd(), secondAnswer);
        await longExecution.evaluate(text => window.finishFixture(text), secondAnswer);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '完成', 'First follow-up did not complete');
        assert.equal(await thinking.isEnabled(), true);
        assert.equal(await sourcePage.locator('.cgp-error').textContent(), '', 'The first follow-up should not report a temporary-session error');
        const secondComplete = await longExecution.evaluate(() => ({ sends: window.fixtureSends,
          userIds: [...document.querySelectorAll('[data-message-author-role="user"]')].map(item => item.dataset.messageId),
          assistantIds: [...document.querySelectorAll('[data-message-author-role="assistant"]')].map(item => item.dataset.messageId),
          oldUserAbsent: !document.querySelector('[data-message-id="u-1"]') }));
        assert.deepEqual(secondComplete, { sends: 2, userIds: ['u-2'], assistantIds: ['a-1', 'a-2'], oldUserAbsent: true });
        assert.deepEqual((await readyFrames()).filter(({ state }) => state.sends === 2).map(({ frame }) => frame.token), [longExecution.token]);
        await record('same-hidden-session-followup-completed', { native: { echo: secondEcho, response: secondNative, complete: secondComplete },
          state: await sourcePage.locator('.cgp-state').textContent(), resultMatches: (await sourcePage.locator('.cgp-result').textContent()).includes(secondAnswer),
          error: await sourcePage.locator('.cgp-error').textContent(), visible: await visible() });

        const thirdPrompt = 'Follow up once more and stop the native generation';
        await sourcePage.locator('textarea[aria-label="问题或追问"]').fill(thirdPrompt);
        await sourcePage.locator('.cgp-send').click();
        await until(async () => await longExecution.evaluate(() => window.fixtureSends) === 3, 'Second follow-up did not send exactly once');
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '已发送，等待回答', 'Second follow-up did not enter waiting');
        const thirdEcho = await longExecution.evaluate(() => {
          const users = [...document.querySelectorAll('[data-message-author-role="user"]')];
          const user = users.at(-1), outer = user?.closest('[data-turn-key]'), contentTurn = user?.closest('[data-content-search-turn-key]');
          return { sends: window.fixtureSends, userIds: users.map(item => item.dataset.messageId),
            oldUserAbsent: !users.some(item => item.dataset.messageId === 'u-1'),
            userTextMatchesSubmitted: user?.innerText === window.fixtureSubmittedText,
            userUnitKey: user?.dataset.chatgptSearchUnitKey, turnKey: outer?.dataset.turnKey,
            contentTurnKey: contentTurn?.dataset.contentSearchTurnKey,
            temporaryBubble: user?.getAttribute('data-user-message-bubble') === 'true' && user.classList.contains('temporaryBubble-test') };
        });
        assert.deepEqual(thirdEcho, { sends: 3, userIds: ['u-2', 'u-3'], oldUserAbsent: true,
          userTextMatchesSubmitted: true, userUnitKey: 'fallback-turn-2:0:user', turnKey: 'u-3',
          contentTurnKey: 'fallback-turn-2', temporaryBubble: true });
        const thirdReplacement = await longExecution.evaluate(() => {
          const oldOuter = window.fixtureTurnNode, oldContent = window.fixtureContentTurnNode;
          const oldUser = oldOuter?.querySelector('[data-message-author-role="user"]');
          if (!oldOuter?.isConnected || !oldUser || oldOuter.dataset.turnKey !== 'u-3'
            || oldContent?.dataset.contentSearchTurnKey !== 'fallback-turn-2') throw new Error('Expected the third follow-up user turn before full-shell detach');
          oldOuter.remove();
          const outer = document.createElement('div'); outer.dataset.turnKey = 'fallback-turn-2'; outer.dataset.testid = 'conversation-turn';
          const contentTurn = document.createElement('div'); contentTurn.dataset.contentSearchTurnKey = 'fallback-turn-2';
          const article = document.createElement('article'), assistant = document.createElement('div');
          assistant.dataset.messageAuthorRole = 'assistant'; assistant.dataset.messageId = 'a-3';
          assistant.dataset.chatgptSearchUnitKey = 'fallback-turn-2:1:assistant';
          assistant.innerHTML = '<div class="markdown">Third follow-up streaming answer</div>';
          article.append(assistant); contentTurn.append(article); outer.append(contentTurn); document.querySelector('#messages').append(outer);
          window.fixtureTurnNode = outer; window.fixtureContentTurnNode = contentTurn; window.fixtureAnswerArticle = article;
          return { oldOuterConnected: oldOuter.isConnected, oldUserConnected: oldUser.isConnected,
            oldUserStillVisible: [...document.querySelectorAll('[data-message-author-role="user"]')].some(user => user.dataset.messageId === 'u-3'),
            outerTurnKey: outer.dataset.turnKey, contentTurnKey: contentTurn.dataset.contentSearchTurnKey,
            assistantId: assistant.dataset.messageId, assistantUnitKey: assistant.dataset.chatgptSearchUnitKey,
            otherUsers: [...document.querySelectorAll('[data-message-author-role="user"]')].map(user => user.dataset.messageId),
            assistantCount: document.querySelectorAll('[data-message-author-role="assistant"]').length,
            saveChatButton: !!document.querySelector('button[aria-label="保存聊天"]') };
        });
        assert.deepEqual(thirdReplacement, { oldOuterConnected: false, oldUserConnected: false, oldUserStillVisible: false,
          outerTurnKey: 'fallback-turn-2', contentTurnKey: 'fallback-turn-2', assistantId: 'a-3',
          assistantUnitKey: 'fallback-turn-2:1:assistant', otherUsers: ['u-2'], assistantCount: 3, saveChatButton: true });
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '生成中', 'Third follow-up fallback answer did not enter streaming');
        assert.equal((await sourcePage.locator('.cgp-result').textContent()).trimEnd(), 'Third follow-up streaming answer');
        assert.equal(await sourcePage.locator('.cgp-error').textContent(), '');
        assert.deepEqual((await readyFrames()).filter(({ state }) => state.sends === 3).map(({ frame }) => frame.token), [longExecution.token]);
        await record('third-followup-whole-user-turn-replaced-streaming', { native: { echo: thirdEcho, replacement: thirdReplacement },
          state: await sourcePage.locator('.cgp-state').textContent(), result: await sourcePage.locator('.cgp-result').textContent(), visible: await visible() });

        await sourcePage.locator('.cgp-operations button').filter({ hasText: /^停止$/ }).click();
        await sourcePage.locator('.cgp-state').filter({ hasText: '已停止' }).waitFor();
        const stopped = await longExecution.evaluate(() => ({ sends: window.fixtureSends, stops: window.fixtureStops,
          nativeStopVisible: !!document.querySelector('[data-testid="stop-button"]') }));
        assert.deepEqual(stopped, { sends: 3, stops: 1, nativeStopVisible: false });
        const stoppedResult = await sourcePage.locator('.cgp-result').textContent();
        await longExecution.evaluate(() => window.finishFixture('LATE THIRD FOLLOW-UP MUST NOT LEAK'));
        await new Promise(resolve => setTimeout(resolve, 250));
        const afterLateAnswer = { state: await sourcePage.locator('.cgp-state').textContent(),
          result: await sourcePage.locator('.cgp-result').textContent(), error: await sourcePage.locator('.cgp-error').textContent() };
        assert.equal(afterLateAnswer.state, '已停止');
        assert.equal(afterLateAnswer.result, stoppedResult);
        assert.equal(afterLateAnswer.result.includes('LATE THIRD FOLLOW-UP MUST NOT LEAK'), false);
        assert.equal(afterLateAnswer.error, '');
        const finalNative = await longExecution.evaluate(() => ({ sends: window.fixtureSends, stops: window.fixtureStops,
          userIds: [...document.querySelectorAll('[data-message-author-role="user"]')].map(item => item.dataset.messageId),
          assistantIds: [...document.querySelectorAll('[data-message-author-role="assistant"]')].map(item => item.dataset.messageId),
          outerTurnKey: window.fixtureTurnNode?.dataset.turnKey,
          contentTurnKey: window.fixtureContentTurnNode?.dataset.contentSearchTurnKey,
          assistantUnitKey: window.fixtureTurnNode?.querySelector('[data-message-author-role="assistant"]')?.dataset.chatgptSearchUnitKey }));
        assert.deepEqual(finalNative, { sends: 3, stops: 1, userIds: ['u-2'], assistantIds: ['a-1', 'a-2', 'a-3'],
          outerTurnKey: 'fallback-turn-2', contentTurnKey: 'fallback-turn-2', assistantUnitKey: 'fallback-turn-2:1:assistant' });
        assert.deepEqual(await visible(), baseline, 'Long Explain follow-ups must not create visible tabs or windows');
        await record('third-followup-stopped-no-late-answer', { native: { stopped, final: finalNative }, afterLateAnswer, visible: await visible() });
        console.log(`FALLBACK TURN FOLLOW-UP ARTIFACT ${evidencePath}`);

        await sourcePage.locator('.cgp-popover button[aria-label="关闭"]').click();
        await until(() => longExecution.isClosed(), 'Closing completed fallback-turn task did not remove its hidden iframe');
        assert.equal((await hidden.frames()).length, 1);
        await spare();
        assert.deepEqual(await visible(), baseline);
      } finally {
        try { await sourcePage.evaluate(() => window.fixtureLongContext?.remove()); } catch { }
        const close = sourcePage.locator('.cgp-popover button[aria-label="关闭"]');
        if (await close.count()) { try { await close.click({ timeout: 1000 }); } catch { } }
        if (longExecution && !longExecution.isClosed()) { try { await until(() => longExecution.isClosed(), 'Fallback-turn task cleanup timed out', 3000); } catch { } }
      }
    });
    await t.test('normal delayed native answer transitions from waiting to streaming and completed', async () => {
      const unused = await spare();
      await unused.evaluate(() => { window.fixtureHold = true; window.fixtureInitialAnswer = ''; });
      let delayedExecution;
      try {
        await select(sourcePage, 'explain');
        delayedExecution = await claimed();
        assert.equal(delayedExecution.token, unused.token);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '已发送，等待回答', 'Delayed-answer task did not enter waiting');
        assert.equal(await delayedExecution.evaluate(() => document.querySelectorAll('[data-message-author-role="assistant"]').length), 1);
        assert.equal(await sourcePage.locator('.cgp-result').textContent(), '', 'An empty initial native response should remain empty while waiting');
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(await sourcePage.locator('.cgp-state').textContent(), '已发送，等待回答');

        const answer = 'Delayed native answer became visible';
        await delayedExecution.evaluate(text => {
          const assistant = document.querySelector('[data-message-author-role="assistant"]');
          assistant.querySelector('.markdown').textContent = text;
        }, answer);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '生成中', 'Nonempty native reply did not enter streaming');
        assert.equal((await sourcePage.locator('.cgp-result').textContent()).trimEnd(), answer);
        await delayedExecution.evaluate(text => window.finishFixture(text), answer);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '完成', 'Delayed native reply did not complete');
        assert.equal(await delayedExecution.evaluate(() => window.fixtureSends), 1);
        await sourcePage.locator('.cgp-popover button[aria-label="关闭"]').click();
        await until(() => delayedExecution.isClosed(), 'Closing completed delayed Explain task did not remove its hidden iframe');
        assert.equal((await hidden.frames()).length, 1);
        await spare();
      } finally {
        const close = sourcePage.locator('.cgp-popover button[aria-label="关闭"]');
        if (await close.count()) { try { await close.click({ timeout: 1000 }); } catch { } }
        if (delayedExecution && !delayedExecution.isClosed()) { try { await until(() => delayedExecution.isClosed(), 'Delayed Explain cleanup timed out', 3000); } catch { } }
      }
    });
    await t.test('floating answers render extracted native KaTeX with local fonts, safe overflow and both themes', async () => {
      const originalViewport = sourcePage.viewportSize();
      const inlineTex = String.raw`\frac{1}{2}`;
      const matrixTex = String.raw`\begin{bmatrix}\frac{1}{2} & \alpha \\ \beta & \frac{3}{4}\end{bmatrix}`;
      const longTex = Array.from({ length: 36 }, (_, index) => `x_{${index + 1}}`).join(' + ') + String.raw` = \frac{1}{2}`;
      const renderNativeMath = (tex, displayMode = false) => katex.renderToString(tex, { displayMode, output: 'htmlAndMathml' });
      const nativeHTML = `<p>Math pipeline ready. Inline fraction: ${renderNativeMath(inlineTex)}</p><p>Display matrix:</p>${renderNativeMath(matrixTex, true)}<p>Long expression:</p>${renderNativeMath(longTex, true)}<p>Existing Markdown text remains.</p><pre><code class="language-js">const preserved = "code";</code></pre>`;
      let mathExecution;
      try {
        await sourcePage.setViewportSize({ width: 520, height: 900 });
        await sourcePage.evaluate(() => {
          const style = document.createElement('style'); style.id = 'offline-darkreader';
          style.className = 'darkreader darkreader--user-agent'; style.textContent = 'html{color-scheme:dark!important}';
          document.head.append(style);
        });
        await until(async () => await sourcePage.locator('#cgp-selection-root').getAttribute('data-cgp-theme') === 'dark', 'Dark Reader fixture theme did not apply');
        const unused = await spare();
        await unused.evaluate(() => { window.fixtureHold = true; });
        await select(sourcePage, 'explain');
        mathExecution = await claimed();
        assert.equal(mathExecution.token, unused.token);
        await until(() => mathExecution.evaluate(() => !!document.querySelector('[data-testid="stop-button"]')), 'Math explain task did not enter generation');
        await sourcePage.locator('.cgp-result').filter({ hasText: 'Streaming offline answer' }).waitFor({ timeout: 10000 });
        await mathExecution.evaluate(html => window.finishFixture(html, true), nativeHTML);
        await waitAnswer(sourcePage, 'Math pipeline ready.', context, hidden);
        await until(async () => await sourcePage.locator('.cgp-state').textContent() === '完成', 'Math explain result did not complete');
        assert.equal(await mathExecution.evaluate(() => window.fixtureSends), 1);

        const result = sourcePage.locator('.cgp-popover .cgp-result');
        const mathEvidence = await result.evaluate(element => {
          const shadow = element.getRootNode();
          const katexStylesheet = [...shadow.querySelectorAll('link[rel="stylesheet"]')].find(link => link.href.endsWith('/math/katex.css'));
          const fontStylesheet = [...document.querySelectorAll('link[rel="stylesheet"]')].find(link => link.href.endsWith('/math/fonts.css'));
          const formulas = [...element.querySelectorAll('.cgp-math')];
          const longBlock = [...element.querySelectorAll('.cgp-math-display')].at(-1);
          const katex = formulas[0]?.querySelector('.katex');
          return {
            formulaCount: formulas.length,
            katexCount: element.querySelectorAll('.cgp-math .katex').length,
            annotations: formulas.map(formula => [...formula.querySelectorAll('annotation[encoding="application/x-tex"]')].map(annotation => annotation.textContent)),
            display: formulas.map(formula => formula.classList.contains('cgp-math-display')),
            stylesheetLoaded: !!katexStylesheet?.sheet,
            fontStylesheetLoaded: !!fontStylesheet?.sheet,
            fontStylesheetHref: fontStylesheet?.href || '',
            katexFontFamily: katex ? getComputedStyle(katex).fontFamily : '',
            longBlock: longBlock ? { clientWidth: longBlock.clientWidth, scrollWidth: longBlock.scrollWidth, overflowX: getComputedStyle(longBlock).overflowX } : null,
            result: { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth },
            markdownText: element.textContent.includes('Existing Markdown text remains.'),
            code: (element.querySelector('pre code')?.textContent || '').trimEnd(),
          };
        });
        assert.equal(mathEvidence.formulaCount, 3, 'Native TeX annotations should become exactly three local math slots');
        assert.equal(mathEvidence.katexCount, 3, 'Each extracted formula should render once');
        assert.deepEqual(mathEvidence.annotations, [[inlineTex], [matrixTex], [longTex]], 'Rendered annotations must preserve the exact native TeX source once each');
        assert.deepEqual(mathEvidence.display, [false, true, true]);
        assert.equal(mathEvidence.stylesheetLoaded, true, 'Local KaTeX stylesheet should load inside the result shadow root');
        assert.equal(mathEvidence.fontStylesheetLoaded, true, 'Local KaTeX font stylesheet should load in the document');
        assert.match(mathEvidence.fontStylesheetHref, /chrome-extension:\/\/.+\/math\/fonts\.css$/u);
        assert.match(mathEvidence.katexFontFamily, /KaTeX_Main/u, 'KaTeX stylesheet should apply its local font family');
        assert.equal(mathEvidence.markdownText, true);
        assert.equal(mathEvidence.code, 'const preserved = "code";');
        assert.ok(mathEvidence.longBlock.scrollWidth > mathEvidence.longBlock.clientWidth + 40, 'Long display math should overflow its own block');
        assert.equal(mathEvidence.longBlock.overflowX, 'auto');
        assert.ok(mathEvidence.result.scrollWidth <= mathEvidence.result.clientWidth + 2, 'The result column should not grow to the long formula width');

        const fonts = await sourcePage.evaluate(async () => {
          const [main, math] = await Promise.all([
            document.fonts.load('16px KaTeX_Main', '0123456789'),
            document.fonts.load('italic 16px KaTeX_Math', 'xy'),
          ]);
          await document.fonts.ready;
          return {
            main: main.map(face => ({ family: face.family, status: face.status })),
            math: math.map(face => ({ family: face.family, status: face.status })),
            mainCheck: document.fonts.check('16px KaTeX_Main', '0123456789'),
            mathCheck: document.fonts.check('italic 16px KaTeX_Math', 'xy'),
          };
        });
        assert.ok(fonts.main.some(face => face.family === 'KaTeX_Main' && face.status === 'loaded'), 'KaTeX_Main must be fetched and loaded, not fall back');
        assert.ok(fonts.math.some(face => face.family === 'KaTeX_Math' && face.status === 'loaded'), 'KaTeX_Math must be fetched and loaded, not fall back');
        assert.equal(fonts.mainCheck, true);
        assert.equal(fonts.mathCheck, true);

        const colors = async () => result.evaluate(element => {
          const popover = element.closest('.cgp-popover'), math = element.querySelector('.katex');
          return { theme: document.querySelector('#cgp-selection-root').dataset.cgpTheme,
            text: getComputedStyle(element).color, math: getComputedStyle(math).color, background: getComputedStyle(popover).backgroundColor };
        });
        const darkColors = await colors();
        assert.deepEqual(darkColors, { theme: 'dark', text: 'rgb(237, 240, 244)', math: 'rgb(237, 240, 244)', background: 'rgb(32, 35, 40)' });
        const popover = sourcePage.locator('.cgp-popover');
        assert.ok(Math.abs((await popover.boundingBox()).width - 440) < 2, 'Floating math screenshot should show the 440px reading panel');
        await popover.screenshot({ path: path.join(outputRoot, 'floating-katex-dark-0115.png') });

        await sourcePage.locator('#offline-darkreader').evaluate(style => style.remove());
        await until(async () => await sourcePage.locator('#cgp-selection-root').getAttribute('data-cgp-theme') === 'light', 'Removing Dark Reader did not restore light theme');
        const lightColors = await colors();
        assert.deepEqual(lightColors, { theme: 'light', text: 'rgb(32, 33, 36)', math: 'rgb(32, 33, 36)', background: 'rgb(255, 255, 255)' });
        await popover.screenshot({ path: path.join(outputRoot, 'floating-katex-light-0115.png') });

        await sourcePage.locator('.cgp-popover button[aria-label="关闭"]').click();
        await until(() => mathExecution.isClosed(), 'Closing completed math task did not remove its hidden iframe');
        assert.equal((await hidden.frames()).length, 1);
        assert.deepEqual(await visible(), baseline);
      } finally {
        const style = sourcePage.locator('#offline-darkreader');
        if (await style.count()) await style.evaluateAll(styles => styles.forEach(item => item.remove()));
        const close = sourcePage.locator('.cgp-popover button[aria-label="关闭"]');
        if (await close.count()) { try { await close.click({ timeout: 1000 }); } catch { } }
        if (mathExecution && !mathExecution.isClosed()) { try { await until(() => mathExecution.isClosed(), 'Math task cleanup timed out', 3000); } catch { } }
        if (originalViewport) await sourcePage.setViewportSize(originalViewport);
      }
    });
    await t.test('selection search claims hidden spare and replaces it while first reply is held, then follows up', async () => {
      const unused=await spare();await unused.evaluate(()=>{window.fixtureHold=true;});
      await select(sourcePage, 'search');
      execution=await claimed();assert.equal(execution.token,unused.token);
      await until(async()=> (await nativeState(execution)).busy,'First hidden reply did not enter held generation');
      const promptDOM=await execution.evaluate(()=>({submittedHTML:window.fixtureSubmittedHTML,submittedText:window.fixtureSubmittedText,senderToken:window.fixtureSenderToken,active:window.fixtureActiveElement,focused:window.fixtureDocumentFocus,users:[...document.querySelectorAll('[data-message-author-role="user"]')].map(item=>({html:item.outerHTML,text:item.textContent,innerText:item.innerText}))}));
      const promptDocument=new JSDOM(sourceHTML,{url:'http://example.test/article'});const promptRange=promptDocument.window.document.createRange();promptRange.selectNodeContents(promptDocument.window.document.querySelector('#selection'));promptDocument.window.getSelection().addRange(promptRange);
      const expected=buildPrompt({action:'search',origin:'selection',mode:'instant',targetLanguage:'中文',...selectionContext(promptDocument.window.getSelection(),promptDocument.window.document,'nearby')});
      const report=path.join(outputRoot,`hidden-held-prompt-${Date.now()}.json`);await writeFile(report,JSON.stringify({expected,token:execution.token,...promptDOM},null,2));console.log(`HELD PROMPT DOM ${report}`);
      const replacement=await spare();assert.notEqual(replacement.token,execution.token);
      assert.equal((await nativeState(execution)).busy,true,'Replacement must be ready before held reply finishes');
      assert.equal((await nativeState(replacement)).sends,0);
      assert.equal((await hidden.frames()).length,2);
      assert.deepEqual(await visible(),baseline);
      await execution.evaluate(()=>{window.fixtureHold=false;window.finishFixture();});
      await waitAnswer(sourcePage, 'Offline answer 1', context, hidden);
      assert.ok(execution);
      assert.ok((await nativeState(execution)).url.includes('/c/offline-conversation?temporary-chat=true'));
      assert.equal(await execution.evaluate(() => window.fixtureSends), 1);
      assert.equal(await execution.evaluate(()=>document.querySelector('[aria-label="Search"]').getAttribute('aria-pressed')), 'true');
      assert.equal(await sourcePage.locator('.cgp-sources a').getAttribute('href'), 'https://primary.example/report');
      await sourcePage.locator('textarea[aria-label="问题或追问"]').fill('Follow up offline');
      await sourcePage.locator('.cgp-send').click();
      await waitAnswer(sourcePage, 'Offline answer 2', context, hidden);
      assert.equal(await execution.evaluate(() => window.fixtureSends), 2);
      assert.equal((await hidden.frames()).length,2);assert.deepEqual(await visible(),baseline);
      const lastUser = await execution.evaluate(()=>[...document.querySelectorAll('[data-message-author-role="user"]')].at(-1).textContent);
      assert.ok(lastUser.includes('Follow up offline'));
      assert.ok(!lastUser.includes('Chosen passage'));
      assert.ok(lastUser.includes('请简短回答'));
      firstRoundPassed=true;
    });
    assert.ok(firstRoundPassed, 'First round failed; stop dependent lifecycle tests after saving hidden DOM diagnostics.');
    await t.test('stop confirms native stop, late fixture answer does not leak, close removes execution', async () => {
      await execution.evaluate(() => { window.fixtureHold = true; });
      await sourcePage.locator('textarea[aria-label="问题或追问"]').fill('Hold this reply');
      await sourcePage.locator('.cgp-send').click();
      await until(()=>execution.evaluate(()=>!!document.querySelector('[data-testid="stop-button"]')),'Hidden native stop button missing');
      await sourcePage.locator('.cgp-operations button').filter({ hasText: /^停止$/ }).click();
      await sourcePage.locator('.cgp-state').filter({ hasText: '已停止' }).waitFor();
      assert.equal(await execution.evaluate(() => window.fixtureStops), 1);
      await execution.evaluate(() => window.finishFixture('LATE NEVER DELIVER'));
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.ok(!(await sourcePage.locator('.cgp-result').textContent()).includes('LATE NEVER DELIVER'));
      await sourcePage.locator('.cgp-popover button[aria-label="关闭"]').click();
      const replacement=await spare();
      await until(() => execution.isClosed(), 'Closing popup did not remove claimed hidden iframe');
      assert.equal((await hidden.frames()).length,1);assert.equal((await spare()).token,replacement.token);assert.equal((await nativeState(replacement)).sends,0);
      assert.deepEqual(await visible(),baseline);
      assert.equal(await sourcePage.locator('.cgp-popover').count(), 0);
    });
    await t.test('new selection task replaces existing execution with fresh context', async () => {
      await select(sourcePage, 'translate');
      await waitAnswer(sourcePage, 'Offline answer 1', context, hidden);
      const previous = await claimed();
      await select(sourcePage, 'summarize');
      await waitAnswer(sourcePage, 'Offline answer 1', context, hidden);
      await until(() => previous.isClosed(), 'Replacement did not remove prior execution');
      const replacement = await claimed();
      assert.notEqual(previous.token, replacement.token);
      assert.equal(await replacement.evaluate(()=>document.querySelectorAll('[data-message-author-role="user"]').length), 1);
      await sourcePage.locator('.cgp-popover button[aria-label="关闭"]').click();
      await until(() => replacement.isClosed(), 'Replacement cleanup failed');
      await spare();assert.equal((await hidden.frames()).length,1);assert.deepEqual(await visible(),baseline);
    });
    await t.test('direct selection mindmap extracts native div/code text fence and renders local SVG',async()=>{
      const unused=await spare();
      await unused.evaluate(()=>{window.fixtureHold=true;window.fixtureMindmapCode='mindmap\n  Offline topic\n    Evidence\n    Limits';});
      await select(sourcePage,'mindmap');
      const mapFrame=await claimed();assert.equal(mapFrame.token,unused.token);
      const prompt=await mapFrame.evaluate(()=>document.querySelector('[data-message-author-role="user"]').textContent);
      assert.ok(prompt.includes('text 代码块'));assert.ok(prompt.includes('不要使用 mermaid 围栏'));assert.ok(prompt.includes('Chosen passage for local extension integration.'));
      await mapFrame.evaluate(()=>window.finishFixture());
      await until(async()=>await sourcePage.locator('.cgp-state').textContent()==='完成','Selection mindmap did not complete');
      const native=await mapFrame.evaluate(()=>({code:document.querySelector('[data-markdown-copy="code-block"] code')?.textContent,pre:document.querySelectorAll('pre').length,busy:!!document.querySelector('[data-testid="stop-button"]'),copy:!!document.querySelector('[data-testid="copy-turn-action-button"]')}));
      assert.equal(native.code,'mindmap\n  Offline topic\n    Evidence\n    Limits');assert.equal(native.pre,0);assert.equal(native.busy,false);assert.equal(native.copy,true);
      const svg=sourcePage.locator('.cgp-mindmap-result svg');await svg.waitFor({state:'visible',timeout:15000});
      const labels=await svg.textContent();assert.ok(labels.includes('Offline topic'));assert.ok(labels.includes('Evidence'));assert.ok(labels.includes('Limits'));
      assert.equal(await sourcePage.locator('.cgp-mindmap-tools [aria-label="折叠节点"]').isVisible(),true);
      assert.equal(await sourcePage.locator('.cgp-mindmap-tools button').filter({hasText:'导出 SVG'}).isVisible(),true);
      assert.equal(await sourcePage.locator('.cgp-error').isVisible(),false);
      assert.ok(!(await sourcePage.locator('.cgp-popover').textContent()).includes('正在加载图表'));
      assert.equal(await mapFrame.evaluate(()=>document.querySelector('[data-chatgpt-mermaid-preview]')!==null),false);
      await sourcePage.screenshot({path:path.join(outputRoot,'selection-mindmap-native-code.png')});
      const replacement=await spare();assert.notEqual(replacement.token,mapFrame.token);
      await sourcePage.locator('.cgp-popover button[aria-label="关闭"]').click();
      await until(()=>mapFrame.isClosed(),'Closing mindmap did not remove claimed frame');
      assert.equal((await hidden.frames()).length,1);assert.equal((await spare()).token,replacement.token);assert.equal((await nativeState(replacement)).sends,0);assert.deepEqual(await visible(),baseline);
    });
    await t.test('native composer page-attachment icon restores draft and selection toolbar appends without sending', async () => {
      const panel = await context.newPage();
      try {
        await panel.setViewportSize({ width: 420, height: 820 });
        await sourcePage.evaluate(() => {
          const style = document.createElement('style'); style.id = 'offline-darkreader';
          style.className = 'darkreader darkreader--user-agent'; style.textContent = 'html{color-scheme:dark!important}';
          document.head.append(style);
        });
        await until(async () => await sourcePage.locator('#cgp-selection-root').getAttribute('data-cgp-theme') === 'dark', 'Dark Reader fixture theme did not apply');
        await panel.goto(`chrome-extension://${api.id}/sidepanel.html`);
        const frame = panel.frameLocator('#cgp-chatgpt-frame');
        await frame.locator('#prompt-textarea').waitFor({ timeout: 15000 });
        assert.equal(await panel.locator('#enhancement-tools').count(), 0, 'The old sidepanel attachment toolbar should be removed');
        assert.equal(await panel.locator('dialog, #materials-panel').count(), 0);
        const nativeFrame = panel.frames().find(item => item.url().startsWith('https://chatgpt.com/'));
        await nativeFrame.evaluate(() => { window.fixtureHold = true; });
        const attachPage = frame.locator('[data-cgp-attach-page]');
        await attachPage.waitFor({ state: 'attached', timeout: 15000 });
        await sourcePage.bringToFront();
        await until(async () => !(await attachPage.isDisabled()), 'Composer attachment icon did not enable');
        assert.equal(await attachPage.getAttribute('type'), 'button');
        assert.equal(await attachPage.getAttribute('title'), '附加当前网页');
        assert.equal(await attachPage.getAttribute('aria-label'), '附加当前网页');
        await until(async () => await frame.locator('html').getAttribute('data-theme') === 'dark', 'Dark theme did not reach the composer fixture');
        const iconColors = await attachPage.evaluate(button => ({ icon: getComputedStyle(button).color, body: getComputedStyle(button.ownerDocument.body).color }));
        assert.equal(iconColors.icon, iconColors.body, 'The injected icon should inherit the native composer text color');
        const plusBox = await frame.locator('#composer-plus-btn').boundingBox();
        const attachBox = await attachPage.boundingBox();
        assert.ok(plusBox && attachBox, 'Native plus and injected attachment icon must have measurable positions');
        assert.ok(attachBox.x >= plusBox.x + plusBox.width - 1, 'Attachment icon must appear to the right of the native plus button');
        assert.ok(Math.abs((attachBox.y + attachBox.height / 2) - (plusBox.y + plusBox.height / 2)) < 4, 'Attachment icon must share the composer action row');
        const tooltip = frame.locator('[role="tooltip"]');
        await frame.locator('#composer-plus-btn').press('Tab');
        await until(async () => await attachPage.evaluate(button => button.getRootNode().activeElement === button), 'Tab did not focus the injected composer attachment button');
        await tooltip.waitFor({ state: 'visible' });
        assert.equal((await tooltip.textContent()).trim(), '附加当前网页');
        await attachPage.hover();
        await tooltip.waitFor({ state: 'visible' });
        assert.equal((await tooltip.textContent()).trim(), '附加当前网页');
        await sourcePage.bringToFront();
        assert.equal(await sourcePage.evaluate(() => document.hasFocus()), true, 'Keep the reading tab active while operating the sidebar');
        await until(async () => await frame.locator('html').getAttribute('data-theme') === 'dark', 'Dark theme did not remain on the composer fixture after activating the source tab');
        await panel.screenshot({ path: path.join(outputRoot, 'native-composer-attach-page-dark.png') });
        await frame.locator('#prompt-textarea').fill('Original unsent draft');
        // Evaluated click keeps the reading tab active while routing through the iframe adapter.
        await attachPage.evaluate(button => button.click());
        assert.equal(await sourcePage.evaluate(() => document.hasFocus()), true, 'The composer action must not steal the active reading tab');
        await until(() => nativeFrame.evaluate(() => window.fixtureSends === 1), 'Page attachment did not submit once');
        await until(async () => await frame.locator('#prompt-textarea').textContent() === 'Original unsent draft', 'Draft was not restored');
        const submitted = await nativeFrame.evaluate(() => window.fixtureSubmittedText);
        assert.match(submitted, /已附加当前网页的内容/);
        assert.match(submitted, /http:\/\/example.test\/article/);
        assert.doesNotMatch(submitted, /Original unsent draft/);
        assert.equal(await frame.locator('[data-testid="model-switcher-dropdown-button"]').textContent(), 'Instant');
        assert.equal(await nativeFrame.evaluate(() => window.fixtureSends), 1);
        await nativeFrame.evaluate(() => window.finishFixture());
        await until(async () => !(await attachPage.isDisabled()), 'Composer attachment icon did not unlock');
        assert.equal(await panel.locator('#panel-status').textContent(), '');
        assert.equal(await panel.locator('#panel-status').evaluate(element => element.hidden), true);
        const selected = await sourcePage.evaluate(() => {
          const node=document.querySelector('#selection'),range=document.createRange();range.selectNodeContents(node);
          getSelection().removeAllRanges();getSelection().addRange(range);
          node.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));return getSelection().toString();
        });
        const attach = sourcePage.locator('[role="toolbar"] [data-action="append-selection"]');
        await attach.waitFor();
        assert.equal(await attach.textContent(), '附加');
        assert.deepEqual(await sourcePage.locator('[role="toolbar"] button').allTextContents(), ['问AI','翻译','解释','总结','AI 搜索','脑图','附加']);
        await attach.click();
        await until(async () => (await frame.locator('#prompt-textarea').innerText()).includes('> '+selected), 'Selected quote did not reach native composer');
        const quoted = await frame.locator('#prompt-textarea').innerText();
        assert.ok(quoted.startsWith('Original unsent draft')); assert.ok(quoted.endsWith('\n\n'), JSON.stringify(quoted));
        assert.equal(await nativeFrame.evaluate(() => window.fixtureSends), 1, 'Selection must not send');
        await until(async () => await attach.textContent() === '已附加', 'Selection operation did not finish');
        assert.equal(await sourcePage.locator('.cgp-popover').count(), 0, 'Attachment must not start a floating task');
        await sourcePage.screenshot({path:path.join(outputRoot,'selection-sidebar-attach.png')});
        await sourcePage.evaluate(() => getSelection().removeAllRanges());
        await attach.click();
        await until(async () => (await sourcePage.locator('[role="toolbar"] [role="status"]').textContent()).includes('选择'), 'Missing selection should show an error');
        assert.equal(await frame.locator('#prompt-textarea').innerText(), quoted);
        assert.equal(await nativeFrame.evaluate(() => window.fixtureSends), 1);
      } finally {
        await panel.close();
        await sourcePage.locator('#offline-darkreader').evaluateAll(styles => styles.forEach(style => style.remove()));
      }
      await until(async () => await sourcePage.locator('[role="toolbar"] [data-action="append-selection"]').count() === 0, 'Closing sidebar must remove toolbar attachment');
    });
    await t.test('source Dark Reader theme reaches popup, sidebar host and bound native iframe, then returns to system light', async () => {
      const panel = await context.newPage();
      try {
        await panel.goto(`chrome-extension://${api.id}/sidepanel.html`);
        const frame = panel.frameLocator('#cgp-chatgpt-frame');
        await frame.locator('#prompt-textarea').waitFor();
        await sourcePage.bringToFront();
        await select(sourcePage, 'ask');
        assert.equal(await sourcePage.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), false);
        const reaches = async (theme) => (await Promise.all([
          sourcePage.locator('#cgp-selection-root').getAttribute('data-cgp-theme'),
          panel.locator('html').getAttribute('data-cgp-theme'),
          frame.locator('html').getAttribute('data-theme'),
        ])).every((value) => value === theme);
        await until(() => reaches('light'), 'Initial source/system light did not reach bound sidebar iframe');
        await sourcePage.evaluate(() => {
          const style = document.createElement('style');
          style.id = 'offline-darkreader'; style.className = 'darkreader darkreader--user-agent';
          style.textContent = 'html{color-scheme:dark!important}'; document.head.append(style);
        });
        await until(() => reaches('dark'), 'Dark Reader dark did not reach popup, sidebar host and native iframe');
        assert.equal(await frame.locator('meta[name="darkreader-lock"]').count(), 1);
        await frame.locator('html').evaluate(root => {
          const style = document.createElement('style');
          style.textContent = 'html[data-theme="light"] body{background:rgb(252,252,252);color:rgb(13,13,13)}html[data-theme="dark"] body{background:rgb(14,14,14);color:rgb(237,237,237)}';
          document.head.append(style);
          // Actual ChatGPT hydration resets data-theme after the first dark write.
          root.setAttribute('data-theme', 'light');
        });
        await until(() => reaches('dark'), 'Native hydration overwrite must not leave sidebar iframe light');
        assert.equal(await frame.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(14, 14, 14)');
        await sourcePage.locator('#offline-darkreader').evaluate((style) => style.remove());
        await until(() => reaches('light'), 'Removing Dark Reader did not restore system light across actual extension messaging');
        assert.equal(await frame.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(252, 252, 252)');
        assert.equal(await frame.locator('meta[name="darkreader-lock"]').count(), 1);
        assert.equal(await frame.locator('#prompt-textarea').textContent(), '');
        const native = panel.frames().find((item) => item.url().startsWith('https://chatgpt.com/'));
        assert.equal(await native.evaluate(() => window.fixtureSends), 0);
        console.log('Actual MV3 source runtime event -> sidebar RPC -> token Port -> iframe theme verified with zero chat sends.');
      } finally {
        await sourcePage.locator('#offline-darkreader').evaluateAll((styles) => styles.forEach((style) => style.remove()));
        await sourcePage.locator('.cgp-popover button[aria-label="关闭"]').click();
        await panel.close();
      }
    });
    await t.test('actual options module loads, persists settings and disables/reinstates DNR', async () => {
      const options = await context.newPage();
      await options.goto(`chrome-extension://${api.id}/options.html`);
      assert.equal(await options.locator('script[src="options.js"]').getAttribute('type'), 'module');
      await until(() => options.locator('#save-settings').isEnabled(), 'Options module did not initialize');
      assert.equal(await options.locator('#targetLanguage').inputValue(), '中文');
      await options.locator('#targetLanguage').fill('English');
      await options.locator('#enabled').uncheck();
      await options.locator('#save-settings').click();
      await until(() => worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.targetLanguage === 'English'
        && (await chrome.declarativeNetRequest.getDynamicRules()).length === 0), 'Settings disable was not persisted/applied');
      await until(()=>worker.evaluate(async()=>(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length===0),'Disable did not close offscreen document');
      // The save response repopulates the checkbox after the backend is updated.
      // Wait for that response before editing the next setting.
      await until(() => options.locator('#save-settings').isEnabled(), 'Disable save did not finish');
      await options.locator('#enabled').check();
      await options.locator('#save-settings').click();
      await until(() => worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).some((rule) => rule.id === 74001)), 'DNR was not reinstated');
      const unused=await spare();assert.equal((await nativeState(unused)).sends,0);assert.equal((await hidden.frames()).length,1);
      await options.close();
    });
    await t.test('actual service worker stop/start keeps healthy unused iframe token and document marker',async(subtest)=>{
      const unused=await spare();const token=unused.token;const marker=`healthy-${Date.now()}`;
      await unused.evaluate(value=>{window.fixtureDocumentMarker=value;document.documentElement.dataset.testDocument=value;},marker);
      await worker.evaluate(value=>{globalThis.fixtureWorkerEpoch=value;},marker);
      const before=(await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})))[0];
      const cdp=await context.newCDPSession(sourcePage);let versions=[];const versionLog=[];
      cdp.on('ServiceWorker.workerVersionUpdated',event=>{versions=event.versions;versionLog.push(...event.versions.map(({versionId,runningStatus,scriptURL})=>({versionId,runningStatus,scriptURL})));});
      try {
        try {await cdp.send('ServiceWorker.enable');}
        catch(error) {subtest.skip(`Actual SW stop/start capability blocked: ${error.message}`);return;}
        await until(()=>Promise.resolve(versions.some(item=>item.scriptURL===worker.url())),'CDP did not report extension service worker version');
        const version=versions.find(item=>item.scriptURL===worker.url());
        await cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId});
        try {await until(async()=>versionLog.some(item=>item.versionId===version.versionId && item.runningStatus==='stopped')
          && !(await hidden.browser.send('Target.getTargets')).targetInfos.some(item=>item.type==='service_worker' && item.url===worker.url()),'Actual service worker did not stop');}
        catch(error) {await writeFile(path.join(outputRoot,'service-worker-stop-state.json'),JSON.stringify({versionLog,targets:(await hidden.browser.send('Target.getTargets')).targetInfos},null,2));throw error;}
        const stoppedIndex=versionLog.length;
        await cdp.send('ServiceWorker.startWorker',{scopeURL:`chrome-extension://${api.id}/`});
        await until(async()=>versionLog.slice(stoppedIndex).some(item=>item.runningStatus==='running' && item.scriptURL===worker.url())
          && (await hidden.browser.send('Target.getTargets')).targetInfos.some(item=>item.type==='service_worker' && item.url===worker.url()),'Actual service worker did not restart');
        await until(async()=>{try{return await worker.evaluate(()=>globalThis.fixtureWorkerEpoch===undefined);}catch{return false;}},'Service worker global context was not renewed');
        await until(async()=>{const frames=await readyFrames();return frames.length===1 && frames[0].frame.token===token;},'Restart did not recover the existing unused iframe');
        const recovered=await spare();assert.equal(recovered.frameId,unused.frameId);
        assert.equal(await recovered.evaluate(()=>window.fixtureDocumentMarker),marker);
        assert.equal(await recovered.evaluate(()=>document.documentElement.dataset.testDocument),marker);
        assert.equal((await nativeState(recovered)).sends,0);
        const after=(await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})))[0];
        assert.equal(after.documentId,before.documentId);assert.deepEqual(await visible(),baseline);
        await writeFile(path.join(outputRoot,'service-worker-restart.json'),JSON.stringify({versionLog,token,frameId:recovered.frameId,marker,beforeDocumentId:before.documentId,afterDocumentId:after.documentId,zeroSends:true},null,2));
        console.log('Actual CDP SW stopped and restarted; unused token, frame and document marker retained with zero sends.');
      } finally {await cdp.detach();}
    });
    await t.test('real execution-document reload invalidates its session without replay', async () => {
      await sourcePage.bringToFront();
      await select(sourcePage, 'search');
      await waitAnswer(sourcePage, 'Offline answer 1', context, hidden);
      const temporary = await claimed();
      await temporary.reload();
      await sourcePage.locator('.cgp-state').filter({ hasText: '已中断' }).waitFor();
      let reloaded;
      const reloadState=()=>temporary.evaluate(()=>({url:location.href,sends:window.fixtureSends,composer:!!document.querySelector('#prompt-textarea'),users:document.querySelectorAll('[data-message-author-role="user"]').length}));
      await until(async()=>{try{reloaded=await reloadState();return reloaded.url==='chrome-error://chromewebdata/' || reloaded.composer && reloaded.sends===0;}catch{return false;}},'Reload did not reach a fresh native or explicitly blocked document');
      if(reloaded.url==='chrome-error://chromewebdata/') {
        assert.equal(reloaded.composer,false);assert.equal(reloaded.users,0);
        assert.equal(reloaded.sends,undefined,'Blocked document has no fixture; absence is not a zero send count');
        console.log('Self-reloaded hidden frame was refused by strict embedding headers; session interrupted, no composer/user messages. Start a new task.');
      } else assert.equal(reloaded.sends,0);
      assert.equal(await sourcePage.locator('textarea[aria-label="问题或追问"]').isDisabled(), true);
      assert.ok((await sourcePage.locator('.cgp-result').textContent()).includes('Offline answer 1'));
      const restart = sourcePage.getByRole('button', { name: '重新开始', exact: true });
      assert.equal(await restart.isEnabled(), true);
      assert.deepEqual(await reloadState(), reloaded, 'Interruption cannot replay a task');
      await restart.click();
      await waitAnswer(sourcePage, 'Offline answer 1', context, hidden);
      const restarted = await claimed();
      assert.notEqual(restarted.token, temporary.token);
      assert.equal((await nativeState(restarted)).sends, 1, 'Explicit restart sends only in the new conversation');
      await until(() => temporary.isClosed(), 'Restart did not release the lost execution page');
      await sourcePage.locator('.cgp-popover button[aria-label="关闭"]').click();
      await until(() => restarted.isClosed(), 'Restarted execution page cleanup failed');
      const unused=await spare();assert.equal((await nativeState(unused)).sends,0);assert.equal((await hidden.frames()).length,1);
    });
    await t.test('DNR remains scoped: an ordinary webpage cannot embed the same restricted ChatGPT fixture', async () => {
      const count = consoleErrors.length;
      await sourcePage.evaluate(() => { const iframe = document.createElement('iframe'); iframe.id = 'ordinary-frame'; iframe.src = 'https://chatgpt.com/'; document.body.append(iframe); });
      await until(() => Promise.resolve(consoleErrors.slice(count).some((text) => text.includes('frame-ancestors') || text.includes('X-Frame-Options'))), 'Ordinary iframe was not blocked by restrictive headers');
      assert.equal(await sourcePage.frameLocator('#ordinary-frame').locator('#prompt-textarea').count(), 0);
      await sourcePage.locator('#ordinary-frame').evaluate((iframe) => iframe.remove());
    });
    assert.deepEqual(errors, [], `Page errors: ${errors.join('; ')}`);
    console.log(`Unexpected external requests blocked by local deny proxy: ${proxy.blocked.length}`);
  } finally {
    await hidden?.dispose();
    await context?.close();
    await proxy?.close();
    const relative = path.relative(outputRoot, path.resolve(profile));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await rm(profile, { recursive: true, force: true });
  }
});
