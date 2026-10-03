import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { ChatGPTAdapter, probe, currentMode, findComposer, findStopButton, composerText, fillComposer, extractAnswerText, extractSources, extractDiagram, searchState } from '../src/chatgpt/adapter.js';
import { buildPrompt } from '../src/features/prompts.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

test('actual native plain-code mindmap preserves indentation and fences without copying the toolbar language label', () => {
  const html = readFileSync(new URL('./fixtures/chatgpt-plain-mindmap-block.html', import.meta.url), 'utf8');
  const dom = new JSDOM(`<div class="markdown">${html}</div>`);
  const text = extractAnswerText(dom.window.document.body);
  assert.equal(text, '```mermaid\nmindmap\n  研究流程\n    提出问题\n    设计实验\n    评估结果\n```');
  assert.ok(!text.includes('纯文本'));
  dom.window.close();
});

test('probe distinguishes absent login evidence from an explicit login page and reports bounded page title', () => {
  const dom = new JSDOM('<title>请稍候…</title><body></body>', { url: 'https://chatgpt.com/', pretendToBeVisual: true });
  let state = probe(dom.window.document);
  assert.equal(state.ready, false); assert.equal(state.loggedIn, false); assert.equal(state.loginRequired, false);
  assert.equal(state.hasComposer, false); assert.equal(state.pageTitle, '请稍候…');
  dom.window.document.body.innerHTML = '<button>登录</button>';
  state = probe(dom.window.document); assert.equal(state.loginRequired, true);
  dom.window.document.title = 'a'.repeat(200);
  assert.equal(probe(dom.window.document).pageTitle.length, 100);
  dom.window.close();
});
function actual(name = 'chatgpt-after-reply-tools') {
  const f = fixture(name);
  return new JSDOM(`<!doctype html>${f.profile}${f.main}`, { url: f.url, pretendToBeVisual: true });
}

test('actual 2026-10-03 post-reply DOM proves login/temp/Instant or High, with no legacy ids', () => {
  for (const [name, mode, answer] of [['chatgpt-after-reply-tools', 'instant', '连接验证成功。'], ['chatgpt-high-native-reply', 'high', '适配器验证成功。']]) {
    const dom = actual(name), state = probe(dom.window.document);
    assert.equal(state.loggedIn, true); assert.equal(state.temporary, true); assert.equal(state.ready, true);
    assert.equal(state.hasDraft, false); assert.equal(state.capabilities.mode, mode);
    assert.equal(state.hasMessages, true); assert.equal(state.hasAttachments, false);
    assert.equal(findComposer(dom.window.document).id, '');
    assert.equal(dom.window.document.querySelector('[data-message-author-role]'), null);
    const assistant = dom.window.document.querySelector('[data-chatgpt-search-unit-key$=":assistant"]');
    assert.equal(extractAnswerText(assistant), answer);
  }
});

test('idle temporary-page probe excludes hidden messages and reports a clean composer', () => {
  const dom = actual(), document = dom.window.document;
  document.querySelectorAll('[data-chatgpt-search-unit-key]').forEach(node => node.remove());
  document.body.insertAdjacentHTML('beforeend', '<button aria-label="关闭临时聊天"></button><div hidden data-chatgpt-search-unit-key="hidden:user">Hidden stale message</div>');
  const state = probe(document);
  assert.equal(state.ready, true); assert.equal(state.temporary, true);
  assert.equal(state.busy, false); assert.equal(state.hasDraft, false);
  assert.equal(state.hasMessages, false); assert.equal(state.hasAttachments, false);
});

test('native responsive sidebar may hide account status without making the signed-in composer unavailable', () => {
  const dom = actual(), document = dom.window.document;
  const account = document.querySelector('button[aria-label="打开个人资料菜单"]');
  const sidebar = document.createElement('aside');
  account.replaceWith(sidebar); sidebar.append(account); sidebar.style.display = 'none';
  let state = probe(document);
  assert.equal(state.hasComposer, true); assert.equal(state.loggedIn, true); assert.equal(state.ready, true);
  document.body.insertAdjacentHTML('beforeend', '<button>登录</button>');
  state = probe(document);
  assert.equal(state.loginRequired, true); assert.equal(state.loggedIn, false); assert.equal(state.ready, false);
  document.querySelector('body > button:last-child').remove(); sidebar.remove();
  state = probe(document);
  assert.equal(state.hasComposer, true); assert.equal(state.loggedIn, false); assert.equal(state.ready, false);
  dom.window.close();
});

test('actual native search token is preserved when appending a multiline prompt', () => {
  const dom = actual('chatgpt-native-search-selected'), document = dom.window.document;
  const token = document.querySelector('[data-system-hint-type="search"]');
  assert.ok(token); assert.equal(searchState(document), true); assert.equal(composerText(document), '');
  fillComposer(document, 'First line\nSecond line');
  assert.equal(document.querySelector('[data-system-hint-type="search"]'), token);
  assert.equal(searchState(document), true);
  assert.equal(composerText(document), 'First line\nSecond line');
});

test('actual rendered native diagram exports only ready SVG and excludes its style/control text', () => {
  const dom = new JSDOM(`<div data-markdown-text-style="assistant-message">${fixture('chatgpt-native-diagram').previewHtml}</div>`, { pretendToBeVisual: true });
  const assistant = dom.window.document.body.firstElementChild;
  assert.equal(assistant.querySelector('pre, code'), null);
  const svg = assistant.querySelector('[data-mermaid-render-status="ready"] svg');
  assert.deepEqual(extractDiagram(assistant), { svg: svg.outerHTML });
  assert.equal(extractAnswerText(assistant), '');
  assistant.querySelector('[data-mermaid-render-status]').setAttribute('data-mermaid-render-status', 'rendering');
  assert.equal(extractDiagram(assistant), null);
  assert.equal(extractAnswerText(assistant), '');
  assistant.insertAdjacentHTML('beforeend', '<svg><text>Unrelated SVG</text></svg><style>.irrelevant{color:red}</style><p>Explanation</p>');
  assert.equal(extractDiagram(assistant), null); assert.equal(extractAnswerText(assistant), 'Explanation');
});

test('request-associated diagram alone streams and completes only after native generation stops', { timeout: 10000 }, async () => {
  const dom = new JSDOM(`<!doctype html><button aria-label="打开个人资料菜单"></button><button aria-label="关闭临时聊天"></button>
    <main><section id="messages"></section><form><button type="button" aria-label="选择 ChatGPT 模型">Instant</button>
    <div role="textbox" contenteditable="true" aria-label="询问 ChatGPT"></div><button type="button" aria-label="发送">发送</button></form></main>`,
    { url: 'https://chatgpt.com/?temporary-chat=true', pretendToBeVisual: true });
  const document = dom.window.document, events = [], adapter = new ChatGPTAdapter(document, { emit: event => events.push(event) });
  let sends = 0;
  document.querySelector('[aria-label="发送"]').onclick = () => {
    sends++;
    const turn = document.createElement('div'); turn.setAttribute('data-turn-key', 'own-diagram');
    turn.innerHTML = `<div data-chatgpt-search-unit-key="own:user" data-chatgpt-search-message-ids="own-user"><div data-user-message-bubble="true"><div data-search-result-target>Draw a map</div></div></div>
      <div data-chatgpt-search-unit-key="own:assistant" data-chatgpt-search-message-ids="own-answer"><div data-markdown-text-style="assistant-message">${fixture('chatgpt-native-diagram').previewHtml}</div></div><button aria-label="评价回复">评价回复</button>`;
    document.querySelector('#messages').append(turn); findComposer(document).replaceChildren();
    const stop = document.createElement('button'); stop.type = 'button'; stop.setAttribute('aria-label', '停止'); document.querySelector('form').append(stop);
    setImmediate(() => {
      assert.equal(events.at(-1).state, 'streaming'); assert.ok(events.at(-1).diagram.svg.startsWith('<svg'));
      assert.equal(events.some(event => event.state === 'completed'), false);
      stop.remove();
    });
  };
  adapter.start({ requestId: 'diagram', sessionId: 'session', prompt: 'Draw a map', mode: 'instant', search: false, temporary: true });
  await adapter.active.done;
  assert.equal(sends, 1); assert.equal(events.at(-1).state, 'completed'); assert.equal(events.at(-1).text, '');
  assert.equal(events.at(-1).diagram.svg, document.querySelector('[data-mermaid-render-status="ready"] svg').outerHTML);
  assert.equal(adapter.session.anchor.getAttribute('data-chatgpt-search-message-ids'), 'own-user');
});

test('actual current conversation structure supports a request-associated followup answer', async () => {
  const dom = actual(), document = dom.window.document, events = [];
  const adapter = new ChatGPTAdapter(document, { emit: event => events.push(event), timeoutMs: 50, responseTimeoutMs: 80 });
  const anchor = document.querySelector('[data-chatgpt-search-unit-key$=":user"]');
  adapter.session = { id: 'session', url: document.location.href, temporary: true, anchor,
    userId: anchor.getAttribute('data-chatgpt-search-message-ids'), prompt: anchor.querySelector('[data-search-result-target]').textContent.replace(/\s+/g, ' ').trim() };
  anchor.replaceWith(anchor.cloneNode(true));
  const originalUser = anchor.cloneNode(true);
  const originalTurn = document.querySelector('[data-turn-key]');
  const originalAssistant = document.querySelector('[data-chatgpt-search-unit-key$=":assistant"]').cloneNode(true);
  const button = document.querySelector('button[type="submit"][aria-label="发送"]');
  findComposer(document).addEventListener('input', () => { button.disabled = false; button.setAttribute('aria-disabled', 'false'); });
  let sends = 0;
  button.onclick = event => {
    event.preventDefault(); sends++;
    const turn = document.createElement('div'); turn.setAttribute('data-turn-key', 'new-turn');
    originalUser.setAttribute('data-chatgpt-search-unit-key', 'new:user'); originalUser.setAttribute('data-chatgpt-search-message-ids', 'new-user');
    originalUser.querySelector('[data-search-result-target]').textContent = 'follow up';
    originalAssistant.setAttribute('data-chatgpt-search-unit-key', 'new:assistant'); originalAssistant.setAttribute('data-chatgpt-search-message-ids', 'new-assistant');
    originalAssistant.querySelector('[data-markdown-text-style="assistant-message"]').textContent = 'new reply';
    // User Copy precedes the assistant; assistant completion action follows it.
    turn.append(originalUser); turn.insertAdjacentHTML('beforeend', '<button aria-label="复制">Copy user</button>');
    turn.append(originalAssistant); turn.insertAdjacentHTML('beforeend', '<button aria-label="评价回复">Rate reply</button>');
    originalTurn.after(turn); findComposer(document).replaceChildren();
  };
  adapter.start({ requestId: 'request', sessionId: 'session', prompt: 'follow up', mode: 'instant', search: false, temporary: true, followup: true });
  await adapter.active.done;
  assert.equal(sends, 1); assert.equal(events.at(-1).state, 'completed'); assert.equal(events.at(-1).text, 'new reply');
});

function nativeTurn(source, { contentKey, shellKey, userId, assistantId, prompt, reply, includeUser = true, streaming = false }) {
  const turn = source.cloneNode(true);
  turn.setAttribute('data-turn-key', shellKey || userId || contentKey);
  turn.querySelector('[data-content-search-turn-key]').setAttribute('data-content-search-turn-key', contentKey);
  const user = turn.querySelector('[data-chatgpt-search-unit-key$=":user"]');
  const assistant = turn.querySelector('[data-chatgpt-search-unit-key$=":assistant"]');
  if (includeUser) {
    user.setAttribute('data-chatgpt-search-unit-key', `${contentKey}:0:user`);
    user.setAttribute('data-chatgpt-search-message-ids', userId);
    user.querySelector('[data-user-message-bubble] [data-search-result-target]').textContent = prompt;
  } else user.remove();
  assistant.setAttribute('data-chatgpt-search-unit-key', `${contentKey}:1:assistant`);
  assistant.setAttribute('data-chatgpt-search-message-ids', assistantId);
  if (streaming) assistant.setAttribute('data-is-streaming', 'true');
  else assistant.removeAttribute('data-is-streaming');
  assistant.querySelector('[data-markdown-text-style="assistant-message"]').textContent = reply;
  return { turn, user: includeUser ? user : null, assistant };
}

function retainedFallbackConversation({ streamingFirst = false } = {}) {
  const dom = actual(), document = dom.window.document, events = [];
  const source = document.querySelector('[data-turn-key]').cloneNode(true);
  const contentKey = source.querySelector('[data-content-search-turn-key]').getAttribute('data-content-search-turn-key');
  document.querySelectorAll('[data-turn-key]').forEach(turn => turn.remove());
  const temporary = document.createElement('button'); temporary.setAttribute('aria-label', '关闭临时聊天');
  document.body.append(temporary);
  const send = document.querySelector('button[type="submit"][aria-label="发送"]');
  findComposer(document).addEventListener('input', () => { send.disabled = false; send.setAttribute('aria-disabled', 'false'); });
  let sends = 0, firstEcho, firstFallback, resolveFallback;
  const fallbackReady = new Promise(resolve => { resolveFallback = resolve; });
  const assistantIds = ['10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003'];
  const userIds = ['10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000013'];
  const contentKeys = [contentKey, 'fallback-turn-202', 'fallback-turn-303'];
  const prompts = ['first exact prompt', 'follow-up one', 'follow-up two'];
  const replies = ['first retained answer', 'follow-up answer one', 'follow-up answer two'];
  const turns = [];
  const adapter = new ChatGPTAdapter(document, {
    timeoutMs: 100, responseTimeoutMs: 1200,
    emit: event => {
      events.push(event);
      if (event.state !== 'waiting' || sends !== 1 || firstFallback) return;
      queueMicrotask(() => {
        firstEcho.turn.remove();
        temporary.remove();
        firstFallback = nativeTurn(source, { contentKey, shellKey: contentKey, assistantId: assistantIds[0], reply: replies[0], includeUser: false, streaming: streamingFirst });
        document.querySelector('main').append(firstFallback.turn);
        if (streamingFirst) {
          const stop = document.createElement('button'); stop.setAttribute('aria-label', '停止');
          document.querySelector('form').append(stop);
          stop.onclick = () => stop.remove();
        }
        resolveFallback();
      });
    },
  });
  send.onclick = event => {
    event.preventDefault(); sends++;
    if (sends === 1) {
      firstEcho = nativeTurn(source, { contentKey, shellKey: userIds[0], userId: userIds[0], assistantId: assistantIds[0], prompt: prompts[0], reply: '', includeUser: true });
      firstEcho.assistant.remove();
      document.querySelector('main').append(firstEcho.turn);
    } else {
      const round = sends - 1;
      const current = nativeTurn(source, { contentKey: contentKeys[round], shellKey: userIds[round], userId: userIds[round], assistantId: assistantIds[round], prompt: prompts[round], reply: replies[round] });
      turns.push(current);
      document.querySelector('main').append(current.turn);
    }
    findComposer(document).replaceChildren();
  };
  adapter.start({ requestId: 'first', sessionId: 'session', prompt: prompts[0], mode: 'instant', search: false, temporary: true });
  return { dom, document, events, adapter, send, source, contentKey, prompts, replies, turns, userIds, assistantIds, contentKeys,
    get sends() { return sends; }, firstDone: adapter.active.done, fallbackReady, get firstEcho() { return firstEcho; }, get firstFallback() { return firstFallback; } };
}

test('retained temporary fallback completes three exact turns with fresh native identities', { timeout: 10000 }, async () => {
  const run = retainedFallbackConversation();
  try {
    await run.firstDone;
    assert.equal(run.sends, 1);
    assert.equal(run.events.at(-1).state, 'completed', JSON.stringify(run.events.at(-1)));
    assert.equal(run.events.at(-1).text, run.replies[0]);
    assert.equal(run.firstEcho.user.isConnected, false);
    assert.equal(run.firstFallback.turn.getAttribute('data-turn-key'), run.contentKey);
    assert.equal(run.firstFallback.turn.querySelector('[data-chatgpt-search-unit-key$=":user"]'), null);
    assert.ok(run.document.querySelector('button[aria-label="Save chat"]'));

    for (let index = 1; index <= 2; index++) {
      const prompt = run.prompts[index];
      run.adapter.start({ requestId: `followup-${index}`, sessionId: 'session', prompt, mode: 'instant', search: false, temporary: true, followup: true });
      await run.adapter.active.done;
      assert.equal(run.sends, index + 1, `round ${index} sends exactly once`);
      assert.equal(run.events.at(-1).state, 'completed', JSON.stringify(run.events.at(-1)));
      assert.equal(run.events.at(-1).text, run.replies[index]);
      assert.equal(run.turns[index - 1].user.getAttribute('data-chatgpt-search-message-ids'), run.userIds[index]);
      assert.equal(run.turns[index - 1].assistant.getAttribute('data-chatgpt-search-message-ids'), run.assistantIds[index]);
      assert.equal(run.turns[index - 1].turn.querySelector('[data-content-search-turn-key]').getAttribute('data-content-search-turn-key'), run.contentKeys[index]);
      if (index === 1) {
        const completedTurn = run.turns[0];
        completedTurn.turn.remove();
        const retained = nativeTurn(run.source, { contentKey: run.contentKeys[1], shellKey: run.contentKeys[1], assistantId: run.assistantIds[1], reply: run.replies[1], includeUser: false });
        run.document.querySelector('main').append(retained.turn);
      }
    }
  } finally { run.dom.window.close(); }
});

for (const scenario of ['assistant-id-changed', 'foreign-user', 'duplicate-fallback', 'missing-save-chat', 'navigation']) {
  test(`retained temporary followup blocks ${scenario}`, { timeout: 10000 }, async () => {
    const run = retainedFallbackConversation();
    try {
      await run.firstDone;
      assert.equal(run.events.at(-1).state, 'completed', JSON.stringify(run.events.at(-1)));
      if (scenario === 'assistant-id-changed') run.firstFallback.assistant.setAttribute('data-chatgpt-search-message-ids', '90000000-0000-4000-8000-000000000009');
      if (scenario === 'foreign-user') {
        const foreign = nativeTurn(run.source, { contentKey: 'fallback-turn-909', shellKey: '90000000-0000-4000-8000-000000000009', userId: '90000000-0000-4000-8000-000000000009', assistantId: '90000000-0000-4000-8000-000000000019', prompt: 'foreign question', reply: '' });
        foreign.assistant.remove(); run.document.querySelector('main').append(foreign.turn);
      }
      if (scenario === 'duplicate-fallback') run.firstFallback.turn.after(run.firstFallback.turn.cloneNode(true));
      if (scenario === 'missing-save-chat') run.document.querySelector('button[aria-label="Save chat"]').remove();
      if (scenario === 'navigation') run.dom.reconfigure({ url: 'https://chatgpt.com/c/different-conversation?temporary-chat=true' });
      run.adapter.start({ requestId: `blocked-${scenario}`, sessionId: 'session', prompt: 'blocked follow-up', mode: 'instant', search: false, temporary: true, followup: true });
      await run.adapter.active.done;
      assert.equal(run.sends, 1, 'the blocked followup must not click Send');
      assert.equal(run.events.at(-1).state, 'failed', JSON.stringify(run.events.at(-1)));
      assert.equal(run.events.some(event => event.requestId === `blocked-${scenario}` && event.state === 'sending'), false);
    } finally { run.dom.window.close(); }
  });
}

test('stop clicks once for a retained own streaming fallback after the user shell disappears', { timeout: 10000 }, async () => {
  const run = retainedFallbackConversation({ streamingFirst: true });
  try {
    await run.fallbackReady;
    assert.equal(run.firstEcho.user.isConnected, false);
    assert.equal(run.firstFallback.turn.querySelector('[data-chatgpt-search-unit-key$=":user"]'), null);
    const stop = findStopButton(run.document); assert.ok(stop);
    let clicks = 0;
    stop.onclick = () => { clicks++; stop.remove(); };
    const result = await run.adapter.stop({ requestId: 'first', sessionId: 'session' });
    await run.firstDone;
    assert.equal(clicks, 1);
    assert.equal(result.stopped, true);
    assert.equal(run.events.at(-1).state, 'stopped');
  } finally { run.dom.window.close(); }
});

test('stop does not click when a foreign user appears beside the retained fallback', { timeout: 10000 }, async () => {
  const run = retainedFallbackConversation({ streamingFirst: true });
  try {
    await run.fallbackReady;
    const foreign = nativeTurn(run.source, { contentKey: 'fallback-turn-909', shellKey: '90000000-0000-4000-8000-000000000009', userId: '90000000-0000-4000-8000-000000000009', assistantId: '90000000-0000-4000-8000-000000000019', prompt: 'foreign question', reply: '' });
    foreign.assistant.remove(); run.document.querySelector('main').append(foreign.turn);
    const stop = findStopButton(run.document); assert.ok(stop);
    let clicks = 0;
    stop.onclick = () => { clicks++; stop.remove(); };
    const result = await run.adapter.stop({ requestId: 'first', sessionId: 'session' });
    await run.firstDone;
    assert.equal(clicks, 0);
    assert.equal(result.stopped, false);
    assert.equal(stop.isConnected, true);
  } finally { run.dom.window.close(); }
});

test('native content preflight does not trust Save chat alone or the temporary URL without a confirmed send', async () => {
  const dom = actual(), document = dom.window.document, events = [];
  document.querySelector('[data-turn-key]').remove();
  assert.ok(document.querySelector('button[aria-label="Save chat"]'));
  assert.equal(new URL(document.location.href).searchParams.get('temporary-chat'), 'true');
  const adapter = new ChatGPTAdapter(document, { emit: event => events.push(event) });
  let sends = 0; document.querySelector('button[type="submit"][aria-label="发送"]').onclick = () => sends++;
  adapter.start({ requestId: 'preflight', sessionId: 'session', prompt: 'Do not send', mode: 'instant', search: false, temporary: true });
  await adapter.active.done;
  assert.equal(sends, 0); assert.equal(events.at(-1).error.code, 'TEMPORARY_NOT_CONFIRMED');
  assert.equal(events.some(event => event.state === 'waiting'), false); dom.window.close();
});

for (const scenario of ['stable', 'missing-save-chat', 'uncaptured-content', 'mismatched-user-prefix', 'changed-content', 'duplicate-content', 'hidden-duplicate-content', 'outer-key-mismatch', 'duplicate-original-uuid']) {
  test(`native content turn: ${scenario} after original turn unmount`, { timeout: 15000 }, async () => {
    const dom = actual(), document = dom.window.document, events = [];
    const sourceTurn = document.querySelector('[data-turn-key]').cloneNode(true);
    if (scenario === 'stable') {
      const target = sourceTurn.querySelector('[data-user-message-bubble] [data-search-result-target]');
      const originalText = target.textContent;
      target.querySelector('.whitespace-pre-wrap').textContent = `${originalText}\n${'长背景材料 '.repeat(10000)}`;
      target.classList.add('overflow-hidden'); target.style.maxHeight = '494px';
      assert.ok(target.textContent.length > 49000, 'Full long echo remains in the collapsed target DOM');
    }
    const contentKey = sourceTurn.querySelector('[data-content-search-turn-key]').getAttribute('data-content-search-turn-key');
    const turn = sourceTurn.cloneNode(true), user = turn.querySelector('[data-chatgpt-search-unit-key$=":user"]');
    const prompt = user.querySelector('[data-user-message-bubble] [data-search-result-target]').textContent;
    const userId = user.getAttribute('data-chatgpt-search-message-ids');
    assert.equal(turn.getAttribute('data-turn-key'), userId);
    assert.ok(user.getAttribute('data-chatgpt-search-unit-key').startsWith(`${contentKey}:`));
    turn.querySelector('[data-chatgpt-search-unit-key$=":assistant"]').remove();
    if (scenario === 'uncaptured-content') turn.querySelector('[data-content-search-turn-key]').removeAttribute('data-content-search-turn-key');
    if (scenario === 'mismatched-user-prefix') user.setAttribute('data-chatgpt-search-unit-key', 'fallback-turn-99:0:user');
    document.querySelector('[data-turn-key]').remove();
    document.body.insertAdjacentHTML('beforeend', '<button aria-label="关闭临时聊天"></button>');
    const initialTempButton = document.body.lastElementChild;
    const saveChat = document.querySelector('button[aria-label="Save chat"]'); assert.ok(saveChat, 'Retain the actual native Save chat control');
    let replacement;
    const adapter = new ChatGPTAdapter(document, { responseTimeoutMs: 1000, emit: event => {
      events.push(event);
      if (event.state !== 'waiting' || replacement) return;
      queueMicrotask(() => {
        assert.equal(adapter.session.anchor, user, 'Full echo must be confirmed before the entire turn is unmounted');
        assert.equal(adapter.session.prompt, prompt.replace(/\s+/g, ' ').trim());
        turn.remove();
        initialTempButton.remove();
        if (scenario === 'missing-save-chat') saveChat.remove();
        replacement = sourceTurn.cloneNode(true);
        replacement.setAttribute('data-turn-key', scenario === 'outer-key-mismatch' ? 'fallback-turn-99' : contentKey);
        replacement.querySelector('[data-chatgpt-search-unit-key$=":user"]').remove();
        if (scenario === 'changed-content') replacement.querySelector('[data-content-search-turn-key]').setAttribute('data-content-search-turn-key', 'fallback-turn-99');
        document.querySelector('main').append(replacement);
        if (scenario === 'duplicate-content' || scenario === 'hidden-duplicate-content') {
          const duplicate = replacement.cloneNode(true); duplicate.hidden = scenario === 'hidden-duplicate-content'; replacement.after(duplicate);
        }
        if (scenario === 'duplicate-original-uuid') {
          for (const hidden of [false, true]) {
            const duplicate = document.createElement('div'); duplicate.setAttribute('data-turn-key', userId); duplicate.hidden = hidden; replacement.after(duplicate);
          }
        }
      });
    } });
    const send = document.querySelector('button[type="submit"][aria-label="发送"]');
    findComposer(document).addEventListener('input', () => { send.disabled = false; send.setAttribute('aria-disabled', 'false'); });
    let sends = 0;
    send.onclick = event => { event.preventDefault(); sends++; document.querySelector('main').append(turn); findComposer(document).replaceChildren(); };
    adapter.start({ requestId: 'content-anchor', sessionId: 'session', prompt, mode: 'instant', search: false, temporary: true });
    await adapter.active.done;
    try {
      assert.equal(sends, 1); assert.equal(turn.isConnected, false); assert.equal(user.isConnected, false);
      assert.equal(document.querySelector('[data-chatgpt-search-unit-key$=":user"]'), null);
      assert.equal(initialTempButton.isConnected, false);
      assert.equal(events.some(event => event.state === 'waiting'), true);
      if (scenario === 'stable') {
        assert.equal(saveChat.isConnected, true);
        assert.equal(events.at(-1).state, 'completed', JSON.stringify(events.at(-1)));
        assert.equal(events.at(-1).text, '连接验证成功。');
        assert.equal(replacement.getAttribute('data-turn-key'), contentKey);
      } else {
        assert.equal(events.at(-1).state, 'failed', JSON.stringify(events.at(-1)));
        assert.equal(events.some(event => ['streaming', 'completed'].includes(event.state)), false);
        if (scenario === 'missing-save-chat') {
          assert.equal(saveChat.isConnected, false); assert.equal(new URL(document.location.href).searchParams.get('temporary-chat'), 'true');
          assert.equal(events.at(-1).error.code, 'TEMPORARY_NOT_CONFIRMED');
        }
      }
    } finally { dom.window.close(); }
  });
}

for (const scenario of ['stable', 'changed-key', 'duplicate-key', 'hidden-duplicate-key', 'hidden-user-conflict', 'other-turn', 'no-user-id']) {
  test(`native turn anchor: ${scenario} after confirmed user unmount`, { timeout: 15000 }, async () => {
    const dom = actual(), document = dom.window.document, events = [];
    const turn = document.querySelector('[data-turn-key]').cloneNode(true);
    const user = turn.querySelector('[data-chatgpt-search-unit-key$=":user"]');
    const assistant = turn.querySelector('[data-chatgpt-search-unit-key$=":assistant"]');
    const assistantParent = assistant.parentElement, assistantNext = assistant.nextSibling;
    const userId = user.getAttribute('data-chatgpt-search-message-ids');
    const prompt = user.querySelector('[data-user-message-bubble] [data-search-result-target]').textContent;
    assert.equal(turn.getAttribute('data-turn-key'), userId);
    if (scenario === 'no-user-id') {
      user.removeAttribute('data-chatgpt-search-message-ids');
      user.querySelectorAll('[data-chatgpt-selection-message-id]').forEach(node => node.removeAttribute('data-chatgpt-selection-message-id'));
    }
    assistant.remove(); document.querySelector('[data-turn-key]').remove();
    document.body.insertAdjacentHTML('beforeend', '<button aria-label="关闭临时聊天"></button>');
    const adapter = new ChatGPTAdapter(document, { responseTimeoutMs: 1000, emit: event => {
      events.push(event);
      if (event.state !== 'waiting') return;
      queueMicrotask(() => {
        assert.equal(adapter.session.anchor, user, 'Full echo must be confirmed before unmount');
        user.remove();
        if (scenario === 'changed-key') turn.setAttribute('data-turn-key', 'different-turn');
        if (scenario === 'duplicate-key') turn.after(turn.cloneNode(true));
        if (scenario === 'hidden-duplicate-key') { const duplicate = turn.cloneNode(true); duplicate.hidden = true; turn.after(duplicate); }
        if (scenario === 'hidden-user-conflict') {
          const conflict = user.cloneNode(true); conflict.hidden = true;
          conflict.querySelector('[data-user-message-bubble] [data-search-result-target]').textContent = 'Different question'; turn.append(conflict);
        }
        if (scenario === 'other-turn') {
          const other = turn.cloneNode(true); other.setAttribute('data-turn-key', 'different-turn');
          other.querySelector('[data-content-search-turn-key]').append(assistant); turn.after(other);
        } else assistantParent.insertBefore(assistant, assistantNext);
      });
    } });
    const send = document.querySelector('button[type="submit"][aria-label="发送"]');
    findComposer(document).addEventListener('input', () => { send.disabled = false; send.setAttribute('aria-disabled', 'false'); });
    let sends = 0;
    send.onclick = event => { event.preventDefault(); sends++; document.querySelector('main').append(turn); findComposer(document).replaceChildren(); };
    adapter.start({ requestId: 'turn-anchor', sessionId: 'session', prompt, mode: 'instant', search: false, temporary: true });
    await adapter.active.done;
    try {
      assert.equal(sends, 1); assert.equal(user.isConnected, false);
      assert.equal(events.some(event => event.state === 'waiting'), true);
      if (scenario === 'stable') {
        assert.equal(events.at(-1).state, 'completed', JSON.stringify(events.at(-1)));
        assert.equal(events.at(-1).text, '连接验证成功。');
      } else {
        assert.equal(events.at(-1).state, 'failed', JSON.stringify(events.at(-1)));
        assert.equal(events.some(event => ['streaming', 'completed'].includes(event.state)), false);
      }
    } finally { dom.window.close(); }
  });
}

test('actual full translation echo retains collapsed inline URL through local/canonical routes and rejects changed words', { timeout: 10000 }, async () => {
  const captured = fixture('chatgpt-native-multiline-user');
  const prompt = buildPrompt({ action: 'translate', origin: 'selection', selectedText: 'Example Domain', targetLanguage: '简体中文',
    context: { title: 'Example Domain', url: 'https://example.com/', scope: '选区附近文本', truncated: false,
      text: 'Example Domain\nThis domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.' } });
  assert.equal(prompt, captured.expected);
  for (const changedUrl of [false, true]) {
    const dom = actual(), document = dom.window.document, events = [];
    dom.reconfigure({ url: 'https://chatgpt.com/?temporary-chat=true' });
    document.querySelectorAll('[data-chatgpt-search-unit-key]').forEach(node => node.remove());
    document.body.insertAdjacentHTML('beforeend', '<button aria-label="关闭临时聊天">临时聊天</button>');
    const adapter = new ChatGPTAdapter(document, { emit: event => events.push(event) });
    const send = document.querySelector('button[type="submit"][aria-label="发送"]');
    findComposer(document).addEventListener('input', () => { send.disabled = false; send.setAttribute('aria-disabled', 'false'); });
    let sends = 0;
    const canonical = '/c/6ac0b5e7-260c-83e8-bf07-7a4013e8b514';
    send.onclick = event => {
      event.preventDefault(); sends++;
      const turn = document.createElement('div'); turn.setAttribute('data-turn-key', 'multiline'); turn.innerHTML = captured.userHtml;
      const user = turn.firstElementChild;
      assert.equal(user.querySelectorAll('[data-search-result-target]').length, 2, 'Nested link is not a second message body');
      const link = user.querySelector('a[data-inline-mention-interactive]');
      assert.equal(link.getAttribute('aria-hidden'), 'true'); assert.equal(link.hasAttribute('inert'), true);
      if (changedUrl) link.querySelector('.Label-arpLwJ span').textContent = 'https://different.example/';
      document.querySelector('main').append(turn); findComposer(document).replaceChildren();
      dom.window.history.pushState({}, '', '/c/local-chatgpt%3Amultiline?temporary-chat=true');
      if (!changedUrl) queueMicrotask(() => {
        assert.equal(adapter.active.user, user, 'Local route must bind the exact echo before canonical conversion');
        dom.window.history.pushState({}, '', `${canonical}?temporary-chat=true`);
        turn.insertAdjacentHTML('beforeend', '<div data-chatgpt-search-unit-key="new:assistant" data-chatgpt-search-message-ids="new-answer"><div data-markdown-text-style="assistant-message">示例域名</div></div><button aria-label="评价回复">评价回复</button>');
      });
    };
    adapter.start({ requestId: 'multiline', sessionId: 'session', prompt, mode: 'instant', search: false, temporary: true });
    await adapter.active.done;
    assert.equal(sends, 1);
    if (changedUrl) {
      assert.equal(events.at(-1).error.code, 'NATIVE_INTERFERENCE'); assert.equal(adapter.session, null);
      assert.equal(events.some(event => ['streaming', 'completed'].includes(event.state)), false);
    } else {
      assert.equal(events.at(-1).state, 'completed', JSON.stringify(events.at(-1))); assert.equal(events.at(-1).text, '示例域名');
      assert.equal(new URL(adapter.session.url).pathname, canonical);
    }
  }
});

test('discovery reads actual slider labels, omits absent Extra High, and restores native original mode', async () => {
  const dom = actual(), document = dom.window.document;
  const model = document.querySelector('[aria-label="选择 ChatGPT 模型"]');
  const text = model.querySelector('.ModelPickerTriggerLabel-xR9gDc');
  const names = ['Instant', 'Medium', 'High'];
  let selectedIndex = 1; text.textContent = names[selectedIndex];
  model.onclick = () => {
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
    menu.innerHTML = `<div data-reasoning-slider="true" role="menuitem" aria-label="强度"><div role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${selectedIndex}"></div></div><div role="menuitemradio" aria-disabled="true" data-disabled="">Pro</div>`;
    const wrapper = menu.firstElementChild, slider = wrapper.firstElementChild;
    wrapper.onkeydown = event => {
      if (event.key === 'Escape') { menu.remove(); return; }
      selectedIndex = Math.min(2, Math.max(0, selectedIndex + (event.key === 'ArrowRight' ? 1 : -1)));
      slider.setAttribute('aria-valuenow', String(selectedIndex)); text.textContent = names[selectedIndex];
    };
    menu.onkeydown = event => { if (event.key === 'Escape') menu.remove(); };
    document.body.append(menu);
  };
  const adapter = new ChatGPTAdapter(document, { timeoutMs: 50 });
  const result = await adapter.discoverCapabilities();
  assert.deepEqual(result.capabilities.modes, ['instant', 'medium', 'high']);
  assert.deepEqual(result.capabilities.unavailable, [{ mode: 'pro', label: 'Pro', reason: '原生网页标记该模式为不可用或额度不足。' }]);
  assert.equal(result.capabilities.currentMode, 'medium'); assert.equal(selectedIndex, 1); assert.equal(document.querySelector('[role="menu"]'), null);
  adapter.active = { url: document.location.href, mode: 'pro', cancelled: false };
  await assert.rejects(adapter.selectMode(adapter.active), { code: 'MODE_DISABLED' });
  assert.equal(selectedIndex, 1, 'Disabled Pro must preserve selected strength');
});

test('actual native search reply returns citation sources and leaves only a native search pill', () => {
  const dom = actual('chatgpt-search-reply'), document = dom.window.document;
  const assistant = [...document.querySelectorAll('[data-chatgpt-search-unit-key$=":assistant"]')].at(-1);
  const sources = extractSources(assistant);
  assert.ok(sources.length > 0);
  assert.ok(sources.some(source => /mermaid/i.test(source.url)));
  assert.ok(sources.every(source => !source.title.includes('https://')));
  assert.equal(searchState(document), true); assert.equal(composerText(document), '');
  assert.equal(probe(document).hasDraft, false); assert.equal(probe(document).capabilities.mode, 'instant');
  const count = sources.length;
  assistant.insertAdjacentHTML('beforeend', '<a data-inline-mention-interactive="true" href="https://unrelated.example">Normal answer link</a>');
  assert.equal(extractSources(assistant).length, count);
});

test('actual menu-open generic trigger uses visible effort label and discovery waits for restored trigger', async () => {
  const dom = actual(), document = dom.window.document;
  const model = document.querySelector('[aria-label="选择 ChatGPT 模型"]');
  const text = model.querySelector('.ModelPickerTriggerLabel-xR9gDc');
  const names = ['Instant', 'Medium', 'High', 'Extra High'];
  let selectedIndex = 2; text.textContent = names[selectedIndex];
  model.onclick = () => {
    model.setAttribute('aria-expanded', 'true'); text.textContent = '思考强度';
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
    menu.innerHTML = `<button data-model-picker-view-toggle=""><span data-effort-only="true">${names[selectedIndex]}</span></button><div data-reasoning-slider="true" role="menuitem"><div role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${selectedIndex}"></div></div><div inert><span data-model-picker-view-toggle=""><span data-effort-only="true">stale invalid label</span></span></div>`;
    const wrapper = menu.querySelector('[data-reasoning-slider]'), slider = wrapper.firstElementChild;
    menu.onkeydown = event => {
      if (event.key === 'Escape') {
        menu.remove(); model.setAttribute('aria-expanded', 'false');
        setTimeout(() => { text.textContent = names[selectedIndex]; }, 5); return;
      }
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      selectedIndex = Math.min(3, Math.max(0, selectedIndex + (event.key === 'ArrowRight' ? 1 : -1)));
      slider.setAttribute('aria-valuenow', String(selectedIndex));
      menu.querySelector('[data-effort-only]').textContent = names[selectedIndex];
    };
    document.body.append(menu);
  };
  const adapter = new ChatGPTAdapter(document, { timeoutMs: 100 });
  const result = await adapter.discoverCapabilities();
  assert.deepEqual(result.capabilities.modes, ['instant', 'medium', 'high', 'extra-high']);
  assert.equal(result.capabilities.currentMode, 'high'); assert.equal(text.textContent, 'High');
  assert.equal(selectedIndex, 2); assert.equal(model.getAttribute('aria-expanded'), 'false');
  assert.equal(document.querySelector('[role="menu"]'), null);
});

test('slider-associated native live status confirms label against numeric position', () => {
  const dom = actual(), document = dom.window.document;
  document.querySelector('.ModelPickerTriggerLabel-xR9gDc').textContent = '思考强度';
  document.body.insertAdjacentHTML('beforeend', '<div role="menu"><div data-reasoning-slider="true" role="menuitem"><div role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="3" aria-valuenow="1"></div></div><span role="status">Medium，第 2 项，共 4 项。</span></div>');
  assert.equal(currentMode(document), 'medium');
  document.querySelector('[role="menu"] [role="status"]').textContent = 'High，第 3 项，共 4 项。';
  assert.equal(currentMode(document), null);
});

test('discovery opens native model list only after strength restore, excluding inert slider track', async () => {
  const dom = actual(), document = dom.window.document;
  const model = document.querySelector('[aria-label="选择 ChatGPT 模型"]');
  const text = model.querySelector('.ModelPickerTriggerLabel-xR9gDc');
  const advanced = fixture('chatgpt-native-model-list');
  const advancedDoc = new JSDOM(advanced.menus).window.document;
  const actualList = advancedDoc.querySelector('[data-model-picker-view="advanced"]');
  assert.ok(actualList);
  let selectedIndex = 1, inspectedAt = null; text.textContent = 'Medium';
  model.onclick = () => {
    text.textContent = '思考强度'; model.setAttribute('aria-expanded', 'true');
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
    menu.innerHTML = `<div data-model-picker-view="simple"><div data-model-picker-view-toggle="true" role="menuitem" aria-label="选择模型"><span data-effort-only="true">Medium</span></div><div data-reasoning-slider="true" role="menuitem"><span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${selectedIndex}"></span></div></div>`;
    const slider = menu.querySelector('[role="slider"]');
    menu.querySelector('[data-model-picker-view-toggle]').onclick = () => {
      inspectedAt = selectedIndex;
      const simpleView = menu.firstElementChild;
      menu.replaceChildren(actualList.cloneNode(true));
      menu.querySelector('[role="menuitemradio"][aria-checked="true"]').onclick = () => menu.replaceChildren(simpleView);
    };
    menu.onkeydown = event => {
      if (event.key === 'Escape') { menu.remove(); model.setAttribute('aria-expanded', 'false'); text.textContent = ['Instant', 'Medium', 'High'][selectedIndex]; return; }
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      selectedIndex += event.key === 'ArrowRight' ? 1 : -1;
      slider.setAttribute('aria-valuenow', String(selectedIndex));
      menu.querySelector('[data-effort-only]').textContent = ['Instant', 'Medium', 'High'][selectedIndex];
    };
    document.body.append(menu);
  };
  const adapter = new ChatGPTAdapter(document, { timeoutMs: 100 });
  const { capabilities } = await adapter.discoverCapabilities();
  assert.equal(inspectedAt, 1); assert.equal(selectedIndex, 1); assert.equal(currentMode(document), 'medium');
  assert.deepEqual(capabilities.modes, ['instant', 'medium', 'high']);
  assert.equal(capabilities.unavailable.find(option => option.mode === 'pro').label, 'Pro');
  assert.equal(document.querySelector('[role="menu"]'), null);
});

test('High selection recovers a native advanced view that persists across close/reopen', async () => {
  const dom = actual(), document = dom.window.document;
  const model = document.querySelector('[aria-label="选择 ChatGPT 模型"]');
  const text = model.querySelector('.ModelPickerTriggerLabel-xR9gDc');
  const list = new JSDOM(fixture('chatgpt-native-model-list').menus).window.document.querySelector('[data-model-picker-view="advanced"]');
  let view = 'advanced', selectedIndex = 0, selectedClicks = [];
  const names = ['Instant', 'Medium', 'High'];
  function close(menu) { menu.remove(); model.setAttribute('aria-expanded', 'false'); text.textContent = names[selectedIndex]; }
  model.onclick = () => {
    model.setAttribute('aria-expanded', 'true'); text.textContent = '思考强度';
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
    if (view === 'advanced') {
      menu.append(list.cloneNode(true));
      menu.querySelectorAll('[role="menuitemradio"]').forEach(radio => { radio.onclick = () => {
        selectedClicks.push(radio.textContent.trim());
        assert.equal(radio.getAttribute('aria-checked'), 'true', 'Never change the native model to regain slider');
        view = 'simple'; close(menu);
      }; });
    } else {
      menu.innerHTML = `<div data-model-picker-view="simple"><div data-model-picker-view-toggle="true"><span data-effort-only="true">${names[selectedIndex]}</span></div><div data-reasoning-slider="true" role="menuitem"><span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${selectedIndex}"></span></div></div>`;
    }
    menu.onkeydown = event => {
      if (event.key === 'Escape') { close(menu); return; }
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      selectedIndex += event.key === 'ArrowRight' ? 1 : -1;
      menu.querySelector('[role="slider"]').setAttribute('aria-valuenow', String(selectedIndex));
      menu.querySelector('[data-effort-only]').textContent = names[selectedIndex];
    };
    document.body.append(menu);
  };
  const adapter = new ChatGPTAdapter(document, { timeoutMs: 100 });
  adapter.modeIndices.set('high', 2); // Previously discovered native labels.
  const task = { url: document.location.href, mode: 'high', cancelled: false };
  adapter.active = task;
  await adapter.selectMode(task);
  assert.deepEqual(selectedClicks, ['Latest']); assert.equal(selectedIndex, 2); assert.equal(currentMode(document), 'high');
  assert.equal(model.getAttribute('aria-expanded'), 'false'); assert.equal(document.querySelector('[role="menu"]'), null);
});

test('actual native attachments remain detectable and block sidebar send without changing draft', async () => {
  for (const fixtureName of ['chatgpt-native-attachment-uploading', 'chatgpt-native-attachment-complete', 'chatgpt-native-image-upload']) {
    const dom = actual(fixtureName), document = dom.window.document;
    assert.equal(probe(document).hasAttachments, true, fixtureName);
    fillComposer(document, 'personal draft');
    const before = composerText(document);
    const adapter = new ChatGPTAdapter(document);
    await assert.rejects(adapter.sidebarInput({ text: 'replacement', send: true }), { code: 'ATTACHMENTS_PRESENT' });
    assert.equal(composerText(document), before);
  }
});

test('actual generating composer 停止 control means busy, prevents sends, and stops asynchronously', async () => {
  const dom = actual('chatgpt-native-generating'), document = dom.window.document, events = [];
  const stop = findStopButton(document); assert.equal(stop.getAttribute('aria-label'), '停止');
  document.body.insertAdjacentHTML('beforeend', '<button aria-label="停止">Unrelated stop</button>');
  assert.equal(findStopButton(document), stop); assert.equal(probe(document).busy, true);
  const adapter = new ChatGPTAdapter(document, { emit: event => events.push(event), timeoutMs: 100 });
  adapter.start({ requestId: 'blocked', sessionId: 'session', prompt: 'do not send', mode: 'high', search: false, temporary: true });
  await adapter.active.done;
  assert.equal(events.at(-1).error.code, 'NATIVE_BUSY'); assert.equal(events.some(event => event.state === 'completed'), false);
  const user = [...document.querySelectorAll('[data-chatgpt-search-unit-key$=":user"]')].at(-1);
  adapter.active = { requestId: 'own', sessionId: 'session', sent: true, user, url: document.location.href, cancelled: false,
    userId: user.getAttribute('data-chatgpt-search-message-ids'), prompt: user.querySelector('[data-search-result-target]').textContent.replace(/\s+/g, ' ').trim() };
  user.replaceWith(user.cloneNode(true));
  stop.onclick = () => queueMicrotask(() => stop.remove());
  const result = await adapter.stop({ requestId: 'own', sessionId: 'session' });
  assert.equal(result.stopped, true); assert.equal(probe(document).busy, false);
  assert.equal(document.querySelector('body > button[aria-label="停止"]').textContent, 'Unrelated stop');
});
