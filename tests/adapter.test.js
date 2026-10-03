import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ChatGPTAdapter, probe, findComposer, fillComposer, composerDraft, extractSources, extractAnswerText } from '../src/chatgpt/adapter.js';

function fixture({ temporary = true, model = 'Instant', draft = '', url = 'https://chatgpt.com/?temporary-chat=true' } = {}) {
  const dom = new JSDOM(`<!doctype html><button data-testid="accounts-profile-button">Profile</button>
    <button data-testid="model-switcher-dropdown-button">${model}</button>
    <main>${temporary ? '<h1>Temporary Chat</h1>' : ''}<section id="messages"></section>
    <form><textarea name="prompt-textarea" hidden>mirror</textarea><div id="prompt-textarea" contenteditable="true">${draft}</div>
    <button type="button" aria-label="Search" aria-pressed="false">Search</button>
    <button type="button" data-testid="send-button">Send</button></form></main>`, { url, pretendToBeVisual: true });
  const document = dom.window.document, events = [];
  const adapter = new ChatGPTAdapter(document, { emit: event => events.push(event), timeoutMs: 30, responseTimeoutMs: 70 });
  let sends = 0;
  document.querySelector('[aria-label="Search"]').onclick = event => event.currentTarget.setAttribute('aria-pressed', event.currentTarget.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  const nativeSend = ({ answer = 'Fresh answer', complete = true, sources = false } = {}) => {
    document.querySelector('[data-testid="send-button"]').onclick = () => {
      sends++;
      const user = document.createElement('div'); user.dataset.messageAuthorRole = 'user'; user.dataset.messageId = `u-${sends}`; user.textContent = findComposer(document).textContent;
      document.querySelector('#messages').append(user); findComposer(document).textContent = '';
      const article = document.createElement('article'), assistant = document.createElement('div');
      assistant.dataset.messageAuthorRole = 'assistant'; assistant.dataset.messageId = `a-${sends}`;
      const body = document.createElement('div'); body.className = 'markdown'; body.textContent = answer; assistant.append(body);
      if (sources) assistant.insertAdjacentHTML('beforeend', '<a data-testid="web-citation" href="https://primary.example/paper">Primary</a><a href="https://unrelated.example/">ordinary link</a>');
      article.append(assistant); document.querySelector('#messages').append(article);
      if (complete) { const copy = document.createElement('button'); copy.dataset.testid = 'copy-turn-action-button'; copy.textContent = 'Copy'; article.append(copy); }
      else { const stop = document.createElement('button'); stop.type = 'button'; stop.dataset.testid = 'stop-button'; stop.textContent = 'Stop'; stop.onclick = () => stop.remove(); document.querySelector('form').append(stop); }
    };
  };
  const start = overrides => { const result = adapter.start({ requestId: 'r1', sessionId: 's1', prompt: 'my question', mode: 'instant', search: false, temporary: true, ...overrides }); return { result, done: adapter.active.done }; };
  return { dom, document, events, adapter, start, nativeSend, get sends() { return sends; } };
}

test('visible composer wins over hidden mirror; existing draft is preserved', () => {
  const f = fixture({ draft: 'unsent personal draft' });
  assert.equal(findComposer(f.document).id, 'prompt-textarea');
  assert.throws(() => fillComposer(f.document, 'replacement'), { code: 'DRAFT_PRESENT' });
  assert.equal(findComposer(f.document).textContent, 'unsent personal draft');
  assert.equal(f.document.querySelector('textarea').value, 'mirror');
});

test('sidebar page submission sends only the page and restores the exact draft without changing mode', async () => {
  const draft = '  私人草稿\n\n稍后提问  \n';
  const f = fixture({ draft, model: 'High', temporary: false });
  let sent, sends = 0;
  f.document.querySelector('[data-testid="send-button"]').onclick = () => {
    sends++; sent = composerDraft(f.document);
    const user = f.document.createElement('div'); user.dataset.messageAuthorRole = 'user'; user.textContent = sent;
    f.document.querySelector('#messages').append(user); findComposer(f.document).replaceChildren();
    f.dom.window.history.pushState({}, '', '/c/sidebar-page-conversation');
  };
  const result = await f.adapter.sidebarInput({ text: '网页标题\n网页正文\n只输出“已附加当前网页的内容”', send: true });
  assert.equal(result.sent, true); assert.equal(result.draftRestored, true); assert.equal(sends, 1);
  assert.doesNotMatch(sent, /私人草稿/); assert.match(sent, /网页正文/);
  assert.equal(composerDraft(f.document), draft);
  assert.equal(f.document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent, 'High');
  assert.equal(f.adapter.active, null);
  assert.equal(f.adapter.session, null, 'Sidebar native navigation must not create a floating task session');
});

test('sidebar quote appends to the draft with two trailing newlines and never sends', async () => {
  const f = fixture({ draft: '原问题', temporary: false }); f.nativeSend();
  await f.adapter.sidebarInput({ text: '> 选中的文字\n\n', send: false });
  assert.equal(composerDraft(f.document), '原问题\n\n> 选中的文字\n\n');
  assert.equal(f.sends, 0);
  await f.adapter.sidebarInput({ text: '> 第二段\n\n', send: false });
  assert.equal(composerDraft(f.document), '原问题\n\n> 选中的文字\n\n> 第二段\n\n');
  assert.equal(f.sends, 0);
});

test('failed sidebar page send restores draft and blocks existing attachments before editing', async () => {
  const f = fixture({ draft: '保留草稿', temporary: false });
  f.document.querySelector('[data-testid="send-button"]').disabled = true;
  await assert.rejects(f.adapter.sidebarInput({ text: '网页正文', send: true }), { code: 'SEND_UNAVAILABLE' });
  assert.equal(composerDraft(f.document), '保留草稿');
  f.document.querySelector('form').insertAdjacentHTML('beforeend', '<div data-testid="attachment">private.txt</div>');
  await assert.rejects(f.adapter.sidebarInput({ text: '网页正文', send: true }), { code: 'ATTACHMENTS_PRESENT' });
  assert.equal(composerDraft(f.document), '保留草稿'); assert.equal(f.sends, 0);
});

test('sidebar restores saved draft while preserving concurrent new edits on an unconfirmed send', async () => {
  const f = fixture({ draft: '原草稿', temporary: false });
  f.document.querySelector('[data-testid="send-button"]').onclick = () => { findComposer(f.document).textContent = '新输入'; };
  await assert.rejects(f.adapter.sidebarInput({ text: '网页正文', send: true }), { code: 'SEND_NOT_CONFIRMED' });
  assert.equal(composerDraft(f.document), '原草稿\n\n新输入');
});

test('temporary URL alone cannot prove Temporary Chat', async () => {
  const f = fixture({ temporary: false }); f.nativeSend();
  assert.equal(probe(f.document).temporary, false);
  await f.start().done;
  assert.equal(f.sends, 0); assert.equal(f.events.at(-1).error.code, 'TEMPORARY_NOT_CONFIRMED');
});

test('temporary menu action alone is not active-state evidence', () => {
  const f = fixture({ temporary: false });
  f.document.body.insertAdjacentHTML('beforeend', '<button>Temporary Chat</button>');
  assert.equal(probe(f.document).temporary, false);
  f.document.body.insertAdjacentHTML('beforeend', '<button aria-label="关闭临时聊天">Close</button>');
  assert.equal(probe(f.document).temporary, true);
});

test('logged-out composer does not count as logged in', async () => {
  const f = fixture(); f.nativeSend();
  f.document.body.insertAdjacentHTML('beforeend', '<button>Log in</button>');
  await f.start().done;
  assert.equal(f.sends, 0); assert.equal(f.events.at(-1).error.code, 'LOGIN_REQUIRED');
});

test('draft, busy native generation, unavailable mode all block sending', async () => {
  for (const kind of ['draft', 'busy', 'mode']) {
    const f = fixture({ draft: kind === 'draft' ? 'personal draft' : '' }); f.nativeSend();
    if (kind === 'busy') f.document.querySelector('form').insertAdjacentHTML('beforeend', '<button data-testid="stop-button">Stop</button>');
    await f.start({ mode: kind === 'mode' ? 'high' : 'instant' }).done;
    assert.equal(f.sends, 0, kind);
    assert.equal(f.events.at(-1).state, 'failed', kind);
    if (kind === 'draft') assert.equal(findComposer(f.document).textContent, 'personal draft');
  }
});

test('response needs own new user echo; a stale assistant answer cannot complete it', async () => {
  const f = fixture();
  f.document.querySelector('#messages').innerHTML = '<article><div data-message-author-role="assistant" data-message-id="old"><div class="markdown">Old answer</div></div><button data-testid="copy-turn-action-button">Copy</button></article>';
  // Existing history is allowed on an ordinary sidebar task; response still
  // requires a matching new user echo and a new assistant after it.
  await f.start({ temporary: false }).done;
  assert.equal(f.events.some(event => event.state === 'completed'), false);
  assert.equal(f.events.at(-1).error.code, 'SEND_NOT_CONFIRMED');
});

test('waiting contract: confirmed echo enters waiting without an assistant and stop rejects late output', async () => {
  const f = fixture(); f.adapter.responseTimeoutMs = 1000; f.nativeSend({ answer: '', complete: false });
  const send = f.document.querySelector('[data-testid="send-button"]'), mount = send.onclick;
  send.onclick = () => { mount(); f.document.querySelector('article').remove(); };
  const { done } = f.start();
  try {
    await new Promise(setImmediate);
    assert.equal(f.sends, 1); assert.ok(f.adapter.session?.anchor);
    assert.equal(f.events.at(-1).state, 'waiting', JSON.stringify(f.events.at(-1)));
    assert.equal(f.events.some(event => event.state === 'completed'), false);
    assert.equal((await f.adapter.stop({ requestId: 'r1', sessionId: 's1' })).stopped, true);
    const count = f.events.length;
    f.document.querySelector('#messages').insertAdjacentHTML('beforeend', '<article><div data-message-author-role="assistant" data-message-id="late"><div class="markdown">Late answer</div></div><button data-testid="copy-turn-action-button">Copy</button></article>');
    await done; await new Promise(setImmediate);
    assert.equal(f.events.length, count); assert.equal(f.events.at(-1).state, 'stopped');
  } finally { await f.adapter.dispose({ sessionId: 's1' }); f.dom.window.close(); }
});

test('waiting contract: unconfirmed echo never enters waiting and send is not retried', async () => {
  const f = fixture(); let clicks = 0;
  f.document.querySelector('[data-testid="send-button"]').onclick = () => { clicks++; findComposer(f.document).textContent = ''; };
  await f.start().done;
  assert.equal(clicks, 1); assert.equal(f.events.some(event => event.state === 'waiting'), false);
  assert.equal(f.events.at(-1).error.code, 'SEND_NOT_CONFIRMED'); f.dom.window.close();
});

test('waiting contract: new or changed native alerts fail during echo or reply waits despite residual stop', async () => {
  for (const phase of ['echo', 'reply']) for (const changed of [false, true]) {
    const f = fixture();
    const oldAlert = f.document.createElement('div'); oldAlert.setAttribute('role', 'alert'); oldAlert.textContent = 'Previous notice';
    if (changed) f.document.querySelector('main').append(oldAlert);
    f.nativeSend({ answer: '', complete: false });
    const send = f.document.querySelector('[data-testid="send-button"]'), mount = send.onclick;
    let clicks = 0;
    send.onclick = () => {
      clicks++;
      if (phase === 'reply') { mount(); f.document.querySelector('article').remove(); }
      else { findComposer(f.document).textContent = ''; f.document.querySelector('form').insertAdjacentHTML('beforeend', '<button data-testid="stop-button">Stop</button>'); }
      if (changed) oldAlert.textContent = 'New native error';
      else f.document.querySelector('main').insertAdjacentHTML('beforeend', '<div role="alert">New native error</div>');
    };
    await f.start().done;
    try {
      assert.equal(clicks, 1);
      assert.equal(f.events.at(-1).error.code, 'NATIVE_ERROR', `${phase}, changed=${changed}: ${JSON.stringify(f.events.at(-1))}`);
      assert.equal(f.events.at(-1).error.message, 'New native error');
      assert.equal(f.events.some(event => event.state === 'completed'), false);
      if (phase === 'echo') assert.equal(f.events.some(event => event.state === 'waiting'), false);
    } finally { f.dom.window.close(); }
  }
});

test('waiting contract: unchanged old native alert does not fail an empty answer or bypass completion controls', async () => {
  const f = fixture(); f.adapter.responseTimeoutMs = 1000;
  f.document.querySelector('main').insertAdjacentHTML('beforeend', '<div role="alert">Previous notice</div>');
  f.nativeSend({ answer: '', complete: true });
  const { done } = f.start();
  try {
    await new Promise(setImmediate);
    assert.equal(f.events.at(-1).state, 'waiting', JSON.stringify(f.events.at(-1)));
    const oldAlert = f.document.querySelector('[role="alert"]');
    oldAlert.replaceWith(oldAlert.cloneNode(true));
    await new Promise(setImmediate);
    assert.equal(f.events.at(-1).state, 'waiting', 'Re-rendering the same pre-existing notice is not a new error');
    f.document.querySelector('[data-testid="copy-turn-action-button"]').remove();
    f.document.querySelector('.markdown').textContent = 'Fresh answer';
    await new Promise(setImmediate);
    assert.equal(f.events.at(-1).state, 'streaming'); assert.equal(f.events.some(event => event.state === 'completed'), false);
    f.document.querySelector('article').insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button">Copy</button>');
    await done;
    assert.equal(f.sends, 1); assert.equal(f.events.at(-1).state, 'completed'); assert.equal(f.events.at(-1).text, 'Fresh answer');
  } finally { await f.adapter.dispose({ sessionId: 's1' }); f.dom.window.close(); }
});

test('native response and native sources are request-associated; ordinary links excluded', async () => {
  const f = fixture(); f.nativeSend({ sources: true });
  await f.start({ search: true }).done;
  assert.equal(f.sends, 1);
  const event = f.events.at(-1);
  assert.equal(event.state, 'completed'); assert.equal(event.requestId, 'r1');
  assert.equal(event.text, 'Fresh answer');
  assert.deepEqual(event.sources, [{ title: 'Primary', url: 'https://primary.example/paper' }]);
  assert.equal(f.document.querySelector('[aria-label="Search"]').getAttribute('aria-pressed'), 'true');
});

test('a missing turn reports its identity before the response deadline without accepting an unbound answer', async () => {
  const f = fixture(); f.nativeSend({ answer: '', complete: false });
  f.adapter.responseTimeoutMs = 5000;
  f.adapter.emit = event => {
    f.events.push(event);
    if (event.state === 'waiting' && !event.diagnostics) queueMicrotask(() => {
      f.document.querySelector('[data-message-author-role="user"]').remove();
      f.document.querySelector('.markdown').textContent = 'Private answer sentinel';
    });
  };
  const { done } = f.start({ prompt: 'Private question sentinel' });
  try {
    for (let turn = 0; turn < 30 && !f.events.some(event => event.diagnostics); turn++) await Promise.resolve();
    const event = f.events.find(event => event.diagnostics);
    assert.equal(event?.state, 'waiting');
    assert.equal(event.diagnostics.capturedIdentity.userId, 'u-1');
    assert.equal(event.diagnostics.capturedIdentity.shellConnected, false);
    assert.equal(event.diagnostics.messages[0].identity.messageId, 'a-1');
    assert.deepEqual(event.diagnostics.currentTurns, []);
    assert.doesNotMatch(JSON.stringify(event.diagnostics), /Private question sentinel|Private answer sentinel/);
    assert.equal(f.events.some(event => ['streaming', 'completed', 'failed'].includes(event.state)), false);
    assert.equal(f.sends, 1);
  } finally { await f.adapter.stop({ sessionId: 's1' }); await done; f.dom.window.close(); }
});

test('response timeout reports bounded DOM visibility diagnostics without copying question or answer text', async () => {
  const f = fixture(); f.nativeSend({ answer: 'Private answer sentinel', complete: true });
  const send = f.document.querySelector('[data-testid="send-button"]'), mount = send.onclick;
  send.onclick = () => { mount(); f.document.querySelector('article').setAttribute('aria-hidden', 'true'); };
  await f.start({ prompt: 'Private question sentinel' }).done;
  const error = f.events.at(-1).error;
  assert.equal(error.code, 'RESPONSE_NOT_CONFIRMED');
  assert.equal(error.diagnostics.userConnected, true);
  assert.equal(error.diagnostics.stopVisible, false);
  assert.equal(error.diagnostics.completionControls, 1);
  const reply = error.diagnostics.messages.find(message => message.role === 'assistant');
  assert.equal(reply.visible, false); assert.equal(reply.afterUser, true); assert.equal(reply.newMessage, true);
  assert.equal(reply.answerLength, 'Private answer sentinel'.length);
  assert.equal(reply.hidden[0].ariaHidden, 'true');
  assert.doesNotMatch(JSON.stringify(error.diagnostics), /Private question sentinel|Private answer sentinel/);
  assert.equal(f.sends, 1); f.dom.window.close();
});

test('quiet output is not completion without native per-turn completion controls', async () => {
  const f = fixture(); f.nativeSend({ complete: false });
  const { done } = f.start();
  await new Promise(resolve => setTimeout(resolve, 10));
  f.document.querySelector('[data-testid="stop-button"]').remove();
  await done;
  assert.equal(f.events.at(-1).error.code, 'RESPONSE_NOT_CONFIRMED');
  assert.equal(f.events.some(event => event.state === 'completed'), false);
});

test('stop invalidates observation before native stop; late output never completes', async () => {
  const f = fixture(); f.nativeSend({ complete: false });
  const { done } = f.start();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await f.adapter.stop({ sessionId: 'wrong' })).stopped, false);
  const result = await f.adapter.stop({ requestId: 'r1', sessionId: 's1' });
  assert.equal(result.stopped, true);
  const count = f.events.length;
  f.document.querySelector('.markdown').textContent = 'late answer';
  f.document.querySelector('article').insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button">Copy</button>');
  await done; await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.events.length, count); assert.equal(f.events.at(-1).state, 'stopped');
});

test('stop while preparing preserves late user draft and prevents send', async () => {
  const f = fixture(); f.nativeSend();
  f.document.querySelector('[data-testid="send-button"]').disabled = true;
  const { done } = f.start();
  await new Promise(resolve => setTimeout(resolve, 5));
  findComposer(f.document).textContent = 'new personal draft';
  await f.adapter.stop({ requestId: 'r1', sessionId: 's1' }); await done;
  assert.equal(f.sends, 0); assert.equal(findComposer(f.document).textContent, 'new personal draft');
});

test('followup requires same session and surviving native conversation anchor', async () => {
  const f = fixture(); f.nativeSend(); await f.start().done;
  await f.start({ requestId: 'r2', followup: true, prompt: 'second question' }).done;
  assert.equal(f.sends, 2);
  f.document.querySelector('#messages').replaceChildren();
  await f.start({ requestId: 'r3', followup: true }).done;
  assert.equal(f.sends, 2); assert.equal(f.events.at(-1).error.code, 'SESSION_LOST');
});

test('native re-render of the same confirmed user message does not lose the pending answer', async () => {
  const f = fixture(); f.nativeSend({ complete: false });
  const send = f.document.querySelector('[data-testid="send-button"]'), mount = send.onclick;
  let original;
  send.onclick = () => {
    mount(); original = f.document.querySelector('[data-message-author-role="user"]');
    setTimeout(() => {
      original.replaceWith(original.cloneNode(true));
      f.document.querySelector('[data-testid="stop-button"]').remove();
      f.document.querySelector('article').insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button">Copy</button>');
    }, 10);
  };
  await f.start().done;
  assert.equal(original.isConnected, false);
  assert.equal(f.events.at(-1).state, 'completed', JSON.stringify(f.events.at(-1)));
  assert.equal(f.events.at(-1).text, 'Fresh answer');
  assert.equal(f.sends, 1);
  assert.equal(f.adapter.session.anchor, f.document.querySelector('[data-message-author-role="user"]'));
});

test('a message may remount later within the response deadline and followup keeps its identity', async () => {
  const f = fixture(); f.nativeSend({ complete: false });
  f.adapter.responseTimeoutMs = 250;
  const send = f.document.querySelector('[data-testid="send-button"]'), mount = send.onclick;
  send.onclick = () => {
    mount();
    setTimeout(() => {
      const user = f.document.querySelector('[data-message-author-role="user"]'), replacement = user.cloneNode(true);
      user.remove();
      setTimeout(() => {
        f.document.querySelector('#messages').prepend(replacement);
        f.document.querySelector('[data-testid="stop-button"]').remove();
        f.document.querySelector('article').insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button">Copy</button>');
      }, 10);
    }, 10);
  };
  await f.start().done;
  assert.equal(f.events.at(-1).state, 'completed'); assert.equal(f.sends, 1);
  const user = f.document.querySelector('[data-message-author-role="user"]');
  user.replaceWith(user.cloneNode(true));
  f.nativeSend(); await f.start({ requestId: 'r2', followup: true, prompt: 'Follow up after render' }).done;
  assert.equal(f.events.at(-1).state, 'completed'); assert.equal(f.sends, 2);
});

test('message replacement rejects changed identity, changed text, ambiguity and missing stable IDs', async () => {
  for (const scenario of ['id', 'text', 'duplicate', 'no-id']) {
    const f = fixture(); f.nativeSend({ complete: false });
    const send = f.document.querySelector('[data-testid="send-button"]'), mount = send.onclick;
    send.onclick = () => {
      mount(); const user = f.document.querySelector('[data-message-author-role="user"]');
      if (scenario === 'no-id') user.removeAttribute('data-message-id');
      setTimeout(() => {
        const replacement = user.cloneNode(true);
        if (scenario === 'id') replacement.dataset.messageId = 'different-turn';
        if (scenario === 'text') replacement.textContent = 'different question';
        user.replaceWith(replacement);
        if (scenario === 'duplicate') replacement.after(replacement.cloneNode(true));
        f.document.querySelector('[data-testid="stop-button"]').remove();
        f.document.querySelector('article').insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button">Copy</button>');
      }, 10);
    };
    await f.start().done;
    assert.equal(f.events.at(-1).error.code, 'SESSION_LOST', scenario);
    assert.equal(f.events.some(e => e.state === 'completed'), false, scenario);
    assert.equal(f.sends, 1, scenario);
  }
});

test('stop tracks a remounted own message but never stops a newer native turn', async () => {
  for (const newer of [false, true]) {
    const f = fixture(); f.nativeSend({ complete: false });
    const { done } = f.start();
    await new Promise(resolve => setTimeout(resolve, 10));
    const user = f.document.querySelector('[data-message-author-role="user"]');
    user.replaceWith(user.cloneNode(true));
    if (newer) f.document.querySelector('#messages').insertAdjacentHTML('beforeend', '<div data-message-author-role="user" data-message-id="newer">Other task</div>');
    const result = await f.adapter.stop({ requestId: 'r1', sessionId: 's1' }); await done;
    assert.equal(result.stopped, !newer);
    assert.equal(Boolean(f.document.querySelector('[data-testid="stop-button"]')), newer);
    assert.equal(f.events.some(e => e.state === 'completed'), false);
    assert.equal(f.sends, 1);
  }
});

test('Mermaid fences survive DOM extraction and non-http citations are discarded', () => {
  const f = fixture();
  const assistant = f.document.createElement('div'); assistant.innerHTML = '<div class="markdown"><p>A map</p><pre><code class="language-mermaid">mindmap\n  root((Hello))</code></pre><button>Copy code</button></div><a data-testid="web-citation" href="javascript:alert(1)">bad</a>';
  f.document.body.append(assistant);
  assert.match(extractAnswerText(assistant), /```mermaid\nmindmap\n  root\(\(Hello\)\)\n```/);
  assert.equal(extractAnswerText(assistant).includes('Copy code'), false);
  assert.deepEqual(extractSources(assistant), []);
});

test('unrelated Codex quota text does not block the native composer', () => {
  const f = fixture(); f.document.querySelector('main').insertAdjacentHTML('afterbegin', '<div role="alert">工作空间额度已耗尽</div>');
  assert.equal(probe(f.document).ready, true);
});

test('observed native strength slider selects all four exact labels by keyboard', async () => {
  for (const [index, mode] of ['instant', 'medium', 'high', 'extra-high'].entries()) {
    const f = fixture({ model: 'Extra High' }); f.nativeSend();
    const model = f.document.querySelector('[data-testid="model-switcher-dropdown-button"]');
    model.removeAttribute('data-testid'); model.setAttribute('aria-label', '选择 ChatGPT 模型');
    model.onclick = () => {
      const menu = f.document.createElement('div'); menu.setAttribute('role', 'menu');
      menu.innerHTML = '<div data-reasoning-slider="true" role="menuitem" aria-label="强度" tabindex="0"><div role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="3" aria-valuenow="3"></div></div>';
      const wrapper = menu.firstElementChild, slider = wrapper.firstElementChild;
      wrapper.onkeydown = event => {
        if (event.key === 'Escape') { menu.remove(); return; }
        const next = Number(slider.getAttribute('aria-valuenow')) + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0);
        slider.setAttribute('aria-valuenow', String(Math.min(3, Math.max(0, next))));
        model.textContent = ['Instant', 'Medium', 'High', 'Extra High'][Number(slider.getAttribute('aria-valuenow'))];
      };
      f.document.body.append(menu);
    };
    await f.start({ mode }).done;
    assert.equal(f.sends, 1, mode);
    assert.equal(model.textContent, ['Instant', 'Medium', 'High', 'Extra High'][index]);
    assert.equal(f.events.at(-1).state, 'completed', mode);
    assert.equal(f.document.querySelector('[role="menu"]'), null);
  }
});

test('an unresponsive native strength slider fails closed, preserving empty input', async () => {
  const f = fixture({ model: 'Extra High' }); f.nativeSend();
  f.document.querySelector('[data-testid="model-switcher-dropdown-button"]').onclick = () => f.document.body.insertAdjacentHTML('beforeend', '<div data-reasoning-slider="true" role="menuitem"><div role="slider" aria-valuemin="0" aria-valuemax="3" aria-valuenow="3"></div></div>');
  await f.start({ mode: 'high' }).done;
  assert.equal(f.sends, 0); assert.equal(f.events.at(-1).error.code, 'MODE_NOT_CONFIRMED');
  assert.equal(findComposer(f.document).textContent, '');
});

test('actual no-id Chinese textbox is usable and unrelated forms are excluded', () => {
  const f = fixture();
  const editor = findComposer(f.document); editor.removeAttribute('id'); editor.setAttribute('role', 'textbox'); editor.setAttribute('aria-label', '询问 ChatGPT');
  f.document.body.insertAdjacentHTML('afterbegin', '<form><button type="submit">Delete</button></form>');
  assert.equal(findComposer(f.document), editor);
  fillComposer(f.document, 'hello'); assert.equal(editor.textContent, 'hello');
});

test('mode/search/temporary changes during send readiness block submission', async () => {
  for (const change of ['mode', 'search', 'temporary']) {
    const f = fixture(); f.nativeSend();
    const send = f.document.querySelector('[data-testid="send-button"]'); send.disabled = true;
    const { done } = f.start();
    await new Promise(resolve => setTimeout(resolve, 5));
    if (change === 'mode') f.document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'Medium';
    if (change === 'search') f.document.querySelector('[aria-label="Search"]').setAttribute('aria-pressed', 'true');
    if (change === 'temporary') f.document.querySelector('h1').remove();
    send.disabled = false; await done;
    assert.equal(f.sends, 0, change); assert.equal(f.events.at(-1).state, 'failed', change);
    assert.equal(findComposer(f.document).textContent, '', change);
  }
});

test('native new-chat route change binds only to this request user echo', async () => {
  const f = fixture({ temporary: false, url: 'https://chatgpt.com/' }); f.nativeSend();
  const send = f.document.querySelector('[data-testid="send-button"]'), original = send.onclick;
  send.onclick = () => { original(); f.dom.window.history.pushState({}, '', '/c/new-conversation'); };
  await f.start({ temporary: false }).done;
  assert.equal(f.events.at(-1).state, 'completed');
  await f.start({ temporary: false, followup: true, requestId: 'r2', prompt: 'follow up' }).done;
  assert.equal(f.events.at(-1).state, 'completed'); assert.equal(f.sends, 2);
});

test('Chromium multiline insertText text-node then DIV siblings confirms complete prompt', () => {
  const f = fixture(), editor = findComposer(f.document);
  f.document.execCommand = (command, _ui, text) => {
    assert.equal(command, 'insertText');
    const [first, ...remaining] = text.split('\n');
    editor.append(f.document.createTextNode(first));
    remaining.forEach(line => { const div = f.document.createElement('div'); div.textContent = line; editor.append(div); });
    return true;
  };
  assert.doesNotThrow(() => fillComposer(f.document, 'first line\nsecond line\nthird line'));
  assert.equal(editor.firstChild.nodeType, 3);
  assert.equal(editor.children[0].tagName, 'DIV');
});

test('native stop acknowledgement waits for asynchronous DOM confirmation', async () => {
  const f = fixture(); f.nativeSend({ complete: false });
  const { done } = f.start(); await new Promise(resolve => setTimeout(resolve, 10));
  const stop = f.document.querySelector('[data-testid="stop-button"]');
  stop.onclick = () => setTimeout(() => stop.remove(), 5);
  const result = await f.adapter.stop({ requestId: 'r1', sessionId: 's1' }); await done;
  assert.equal(result.stopped, true); assert.equal(f.events.at(-1).state, 'stopped');
  assert.equal(f.events.some(event => event.state === 'completed'), false);
});

function suspendTimersAndTrackObservers(f) {
  const win = f.dom.window, originalObserver = win.MutationObserver;
  const active = new Set(), clearedTimers = [];
  let nextTimer = 0;
  Object.defineProperty(f.document, 'hidden', { configurable: true, value: true });
  win.setTimeout = () => ++nextTimer; // Simulate hidden-tab timers never firing.
  win.clearTimeout = timer => clearedTimers.push(timer);
  win.MutationObserver = class extends originalObserver {
    constructor(callback) { super(callback); active.add(this); }
    disconnect() { active.delete(this); super.disconnect(); }
  };
  return { active, clearedTimers };
}

test('hidden-page DOM mutations advance waits even if browser timers never fire', { timeout: 1000 }, async () => {
  const f = fixture(), tracked = suspendTimersAndTrackObservers(f);
  const task = { url: f.document.location.href, cancelled: false }; f.adapter.active = task;
  const editor = findComposer(f.document);
  const pending = f.adapter.waitFor(task, () => editor.getAttribute('data-ready') === 'true' && editor);
  assert.equal(tracked.active.size, 1);
  editor.setAttribute('data-ready', 'true');
  assert.equal(await pending, editor);
  assert.equal(tracked.active.size, 0); assert.equal(task.wake, null); assert.equal(tracked.clearedTimers.length, 1);
});

test('hidden-page cancellation wakes promptly and disconnects observer/deadline timer', { timeout: 1000 }, async () => {
  const f = fixture(), tracked = suspendTimersAndTrackObservers(f);
  const task = { url: f.document.location.href, cancelled: false }; f.adapter.active = task;
  const pending = f.adapter.waitFor(task, () => false);
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(tracked.active.size, 1); task.cancelled = true; task.wake();
  await rejected;
  assert.equal(tracked.active.size, 0); assert.equal(task.wake, null); assert.equal(tracked.clearedTimers.length, 1);
});

test('native stop uses mutation wake when the hidden-page timeout fallback never runs', { timeout: 1000 }, async () => {
  const f = fixture(), tracked = suspendTimersAndTrackObservers(f); f.nativeSend({ complete: false });
  const { done } = f.start();
  for (let turns = 0; turns < 32 && !f.document.querySelector('[data-message-author-role="user"]'); turns++) await Promise.resolve();
  assert.ok(f.document.querySelector('[data-message-author-role="user"]'));
  const stop = f.document.querySelector('[data-testid="stop-button"]');
  stop.onclick = () => queueMicrotask(() => stop.remove());
  const result = await f.adapter.stop({ requestId: 'r1', sessionId: 's1' }); await done;
  assert.equal(result.stopped, true); assert.equal(tracked.active.size, 0);
  assert.equal(f.events.at(-1).state, 'stopped');
});

test('native new-chat pushState may precede own echo without premature binding', async () => {
  const f = fixture({ temporary: false, url: 'https://chatgpt.com/' }); f.nativeSend();
  const button = f.document.querySelector('[data-testid="send-button"]'), mountEcho = button.onclick;
  button.onclick = () => {
    f.dom.window.history.pushState({}, '', '/c/owned');
    f.document.body.setAttribute('data-route-render', 'pending');
    setTimeout(mountEcho, 10);
  };
  const { done } = f.start({ temporary: false });
  for (let turns = 0; turns < 12 && !f.adapter.active?.pendingRoute; turns++) await Promise.resolve();
  assert.equal(f.adapter.active.pendingRoute, '/c/owned');
  assert.equal(new URL(f.adapter.active.url).pathname, '/'); assert.equal(f.adapter.session, null);
  assert.equal(f.events.some(event => event.state === 'streaming'), false);
  await done;
  assert.equal(f.sends, 1); assert.equal(f.events.at(-1).state, 'completed');
  assert.equal(new URL(f.adapter.session.url).pathname, '/c/owned');
});

test('pending new-chat route with no echo times out without resubmitting or binding', async () => {
  const f = fixture({ temporary: false, url: 'https://chatgpt.com/' });
  let clicks = 0;
  f.document.querySelector('[data-testid="send-button"]').onclick = () => { clicks++; f.dom.window.history.pushState({}, '', '/c/pending'); f.document.body.setAttribute('data-route', 'pending'); };
  await f.start({ temporary: false }).done;
  assert.equal(clicks, 1); assert.equal(f.adapter.session, null); assert.equal(f.events.at(-1).error.code, 'SEND_NOT_CONFIRMED');
  assert.equal(f.events.some(event => ['streaming', 'completed'].includes(event.state)), false);
});

test('a pending route cannot accept another user question or a second conversation route', async () => {
  for (const interference of ['user', 'route']) {
    const f = fixture({ temporary: false, url: 'https://chatgpt.com/' });
    f.document.querySelector('[data-testid="send-button"]').onclick = () => {
      f.dom.window.history.pushState({}, '', '/c/pending'); f.document.body.setAttribute('data-route', 'pending');
      setTimeout(() => {
        if (interference === 'user') f.document.querySelector('#messages').insertAdjacentHTML('beforeend', '<div data-message-author-role="user" data-message-id="stranger">different question</div>');
        else { f.dom.window.history.pushState({}, '', '/c/unrelated'); f.document.body.setAttribute('data-route', 'unrelated'); }
      }, 5);
    };
    await f.start({ temporary: false }).done;
    assert.equal(f.adapter.session, null); assert.equal(f.events.at(-1).error.code, interference === 'user' ? 'NATIVE_INTERFERENCE' : 'NAVIGATED');
    assert.equal(f.events.some(event => event.state === 'completed'), false);
  }
});

test('native root -> local placeholder -> canonical route preserves a re-rendered own message and supports followup', async () => {
  const f = fixture({ temporary: false, url: 'https://chatgpt.com/' }); f.nativeSend({ complete: false });
  const button = f.document.querySelector('[data-testid="send-button"]'), mount = button.onclick;
  const canonical = '/c/6ac0ae73-1234-5678-abcd-1234567890ab';
  button.onclick = () => {
    mount(); f.dom.window.history.pushState({}, '', '/c/local-chatgpt%3A14451fd7');
    setTimeout(() => {
      const user = f.document.querySelector('[data-message-author-role="user"]');
      user.replaceWith(user.cloneNode(true));
      f.dom.window.history.pushState({}, '', canonical);
      f.document.querySelector('[data-testid="stop-button"]').remove();
      f.document.querySelector('article').insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button">Copy</button>');
    }, 10);
  };
  await f.start({ temporary: false }).done;
  assert.equal(f.events.at(-1).state, 'completed'); assert.equal(new URL(f.adapter.session.url).pathname, canonical);
  f.nativeSend(); await f.start({ temporary: false, followup: true, requestId: 'r2', prompt: 'follow up' }).done;
  assert.equal(f.events.at(-1).state, 'completed'); assert.equal(f.sends, 2);
});

test('local placeholder conversion rejects changed message identity and later unrelated canonical navigation', async () => {
  for (const scenario of ['id', 'anchor', 'canonical']) {
    const f = fixture({ temporary: false, url: 'https://chatgpt.com/' }); f.nativeSend({ complete: false });
    const button = f.document.querySelector('[data-testid="send-button"]'), mount = button.onclick;
    button.onclick = () => {
      mount(); f.dom.window.history.pushState({}, '', '/c/local-chatgpt%3Aowned');
      setTimeout(() => {
        const user = f.document.querySelector('[data-message-author-role="user"]');
        if (scenario === 'id') user.dataset.messageId = 'different';
        if (scenario === 'anchor') { const replacement = user.cloneNode(true); replacement.dataset.messageId = 'different'; user.replaceWith(replacement); }
        f.dom.window.history.pushState({}, '', '/c/6ac0ae73-1234-5678-abcd-1234567890ab');
        f.document.body.setAttribute('data-route', 'canonical');
        if (scenario === 'canonical') setTimeout(() => { f.dom.window.history.pushState({}, '', '/c/other-conversation'); f.document.body.setAttribute('data-route', 'other'); }, 5);
      }, 10);
    };
    await f.start({ temporary: false }).done;
    assert.equal(f.events.at(-1).state, 'interrupted', scenario); assert.equal(f.events.at(-1).error.code, 'NAVIGATED', scenario);
    assert.equal(f.events.some(event => event.state === 'completed'), false, scenario);
  }
});

test('ready composer waits for native model button delayed mounting before send', async () => {
  const f = fixture(); f.nativeSend();
  f.document.querySelector('[data-testid="model-switcher-dropdown-button"]').remove();
  assert.equal(probe(f.document).ready, true); assert.equal(probe(f.document).capabilities.mode, null);
  const { done } = f.start({ mode: 'high' });
  assert.equal(f.sends, 0);
  setTimeout(() => f.document.body.insertAdjacentHTML('afterbegin', '<button data-testid="model-switcher-dropdown-button">High</button>'), 5);
  await done;
  assert.equal(f.sends, 1); assert.equal(f.events.at(-1).state, 'completed'); assert.equal(f.events.at(-1).mode, 'high');
});
