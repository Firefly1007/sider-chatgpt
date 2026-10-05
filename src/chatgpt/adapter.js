// Only native, visible DOM interactions. Unknown page states block submission.
// Composer discovery/input follows the installed Sidely 1.7.0 implementation;
// no third-party business/auth code is loaded.
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const nativeMarkdown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' });
nativeMarkdown.use(gfm);
// Native streaming text can still contain Markdown that ChatGPT has not
// formatted. Keep Markdown delimiters, but never reinterpret literal HTML or entities.
nativeMarkdown.escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
nativeMarkdown.addRule('nativeMath', { filter: 'cgp-native-math', replacement: (_content, node) => node.getAttribute('data-markdown') });

const USER = '[data-message-author-role="user"], [data-chatgpt-search-unit-key$=":user"]';
const ASSISTANT = '[data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"]';
const STOP = 'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="停止生成"], button[aria-label="停止"]';
const MODEL = 'button[data-testid="model-switcher-dropdown-button"], button[aria-label="Model selector"], button[aria-label="模型选择器"], button[aria-label="选择 ChatGPT 模型"]';
const SEARCH_NAME = /^(search(?: the web)?|web search|网页搜索|搜索网页|搜索)$/i;
const TEMP_NAME = /^(temporary chat|临时聊天|临时对话|临时会话)$/i;
const STRENGTHS = ['instant', 'medium', 'high', 'extra-high'];
const SEARCH_TOKEN = '[contenteditable="false"][data-system-hint-type="search"][data-prompt-link-href="chatgpt-system-hint://search"]';

export class AdapterError extends Error {
  constructor(code, message) { super(message); this.name = 'AdapterError'; this.code = code; }
}
const fail = (code, message) => { throw new AdapterError(code, message); };
const normalize = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const label = element => normalize(element?.getAttribute('aria-label') || element?.textContent);
function visibleText(element) {
  if (!element) return '';
  const clone = element.cloneNode(true);
  clone.querySelectorAll('[aria-hidden="true"], [hidden]').forEach(child => child.remove());
  return normalize(clone.textContent);
}
function canonicalMode(text) {
  const value = normalize(text).toLowerCase();
  return ({ instant: 'instant', 即时: 'instant', medium: 'medium', 中: 'medium', high: 'high', 高: 'high', 'extra high': 'extra-high', 'extra-high': 'extra-high', pro: 'pro' })[value] || null;
}
const selected = element => element?.getAttribute('aria-pressed') === 'true' || element?.getAttribute('aria-checked') === 'true' || element?.getAttribute('data-state') === 'checked';
const enabled = element => Boolean(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('data-disabled');

export function isVisible(element) {
  if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  const win = element.ownerDocument.defaultView;
  for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
    const style = win.getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}
function visible(document, selector) { return [...document.querySelectorAll(selector)].filter(isVisible); }
function first(document, selector) { return visible(document, selector)[0] || null; }
function named(document, pattern, selector = 'button, [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]') {
  return visible(document, selector).find(element => pattern.test(label(element))) || null;
}
function composerScope(document) { const composer = findComposer(document); return composer?.closest('form') || composer?.closest('[data-testid="composer"]') || composer?.parentElement; }

// Newer ChatGPT builds render the prompt as a plain <textarea> with no role,
// no contenteditable and an id/name of their own (for example
// <textarea id="mobile-composer-prompt" name="prompt">). Accept a visible,
// writable native textarea on the composer's own identity so those builds keep
// working, while still preferring the explicit contenteditable editor first.
function promptTextarea(element) {
  return element?.tagName === 'TEXTAREA' && !element.disabled && !element.readOnly ? element : null;
}
export function findComposer(document) {
  const direct = document.getElementById('prompt-textarea');
  if (isVisible(direct) && (direct.isContentEditable || direct.getAttribute('contenteditable') === 'true' || direct.tagName === 'TEXTAREA')) return direct;
  return first(document, '[role="textbox"][contenteditable="true"]')
    || first(document, '[data-composer-markdown][contenteditable="true"], [data-composer-input] [contenteditable="true"]')
    || first(document, 'form [contenteditable="true"]')
    || first(document, '#mobile-composer-prompt')
    || promptTextarea(first(document, 'textarea[name="prompt-textarea"], textarea[name="prompt"]'))
    || promptTextarea(first(document, 'form textarea'))
    || promptTextarea(first(document, 'textarea'))
    || first(document, 'form textarea');
}
export function composerText(document) {
  const element = findComposer(document);
  if (element?.tagName === 'TEXTAREA') return element.value;
  return editableText(element);
}

// Preserve draft whitespace and empty paragraphs, including the two trailing
// newlines after an appended quote. The older normalized reader is for echoes.
export function composerDraft(document) {
  const editor = findComposer(document);
  if (!editor) fail('COMPOSER_UNAVAILABLE', '找不到可见的 ChatGPT 输入框。');
  if (editor.tagName === 'TEXTAREA') return editor.value;
  function read(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || node.matches(`${SEARCH_TOKEN}, [hidden], [aria-hidden="true"]`)) return '';
    if (node.tagName === 'BR') return '\n';
    if (node.childNodes.length === 1 && node.firstChild.nodeName === 'BR') return '';
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 1 && ['P', 'DIV', 'LI'].includes(child.tagName) && child.previousSibling) text += '\n';
      text += read(child);
    }
    return text;
  }
  return read(editor);
}

function writeDraft(document, text) {
  const editor = findComposer(document), win = document.defaultView;
  if (!editor || editor.disabled || editor.getAttribute('aria-disabled') === 'true') fail('COMPOSER_UNAVAILABLE', 'ChatGPT 输入框当前不可编辑。');
  editor.focus();
  if (editor.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(editor, text); else editor.value = text;
    editor.dispatchEvent(new win.Event('input', { bubbles: true }));
    editor.setSelectionRange(text.length, text.length);
  } else {
    const token = editor.querySelector(SEARCH_TOKEN), selection = win.getSelection();
    const range = document.createRange(); range.selectNodeContents(editor);
    if (token) range.setStartAfter(token);
    selection.removeAllRanges(); selection.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand?.('insertText', false, text) === true; } catch { /* DOM fallback below */ }
    if (!inserted) {
      const lines = text.split('\n');
      editor.replaceChildren();
      lines.forEach((line, index) => {
        const paragraph = document.createElement('p');
        if (index === 0 && token) paragraph.append(token);
        if (line) paragraph.append(document.createTextNode(line)); else paragraph.append(document.createElement('br'));
        editor.append(paragraph);
      });
      editor.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    selection.selectAllChildren(editor); selection.collapseToEnd();
  }
  if (composerDraft(document).replace(/\r\n/g, '\n') !== text.replace(/\r\n/g, '\n')) fail('INPUT_NOT_CONFIRMED', '原生输入框未确认收到完整文本。');
  return editor;
}
function editableText(element) {
  if (!element) return '';
  function children(node) {
    let text = '';
    for (const child of node.childNodes) {
      const content = read(child);
      // Chromium can insert first-line text followed by DIV sibling blocks in
      // a generic contenteditable. Both sides of that block need a boundary.
      if (content && child.nodeType === 1 && ['P', 'DIV', 'LI'].includes(child.tagName)
        && text && !text.endsWith('\n') && !content.startsWith('\n')) text += '\n';
      text += content;
    }
    return text;
  }
  function read(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || node.matches(`${SEARCH_TOKEN}, [hidden], [aria-hidden="true"]`)) return '';
    if (node.tagName === 'BR') return '\n';
    const text = children(node);
    return ['P', 'DIV', 'LI'].includes(node.tagName) ? `${text}\n` : text;
  }
  return children(element).trim();
}
export function findSendButton(document) {
  const scope = composerScope(document);
  if (!scope) return null;
  return first(scope, 'button[data-testid="send-button"], button#composer-submit-button')
    || named(scope, /^(send(?: message)?|发送(?:消息)?)$/i, 'button');
}
export function findStopButton(document) { return first(composerScope(document) || document, STOP); }

// A URL parameter is intentionally never used as proof of Temporary Chat.
export function temporaryState(document) {
  if (named(document, /^(关闭临时聊天|close temporary chat|turn off temporary chat)$/i, 'button')) return true;
  // Observed post-submit native Temporary Chat indicators (the initial title
  // and close button disappear when a conversation URL is allocated).
  if (first(document, '[data-user-message-bubble="true"][class*="temporaryBubble-"]')
    && named(document, /^(save chat|保存聊天)$/i, 'button')) return true;
  const activeToggle = visible(document, 'button, [role="switch"], [role="menuitemcheckbox"]')
    .find(element => TEMP_NAME.test(label(element)) && selected(element));
  if (activeToggle) return true;
  const banner = visible(document, '[data-testid="temporary-chat-banner"], [data-testid="temporary-chat-header"], main h1, main h2, [role="status"]')
    .find(element => /^(?:temporary chat|临时聊天|临时对话|临时会话)(?:\s|$)/i.test(normalize(element.textContent)));
  // A heading/status banner is evidence; a menu item offering the action is not.
  return Boolean(banner);
}
export function currentMode(document) {
  return canonicalMode(nativeModeText(document));
}
function nativeModeText(document) {
  // The real native picker replaces its composer trigger label with the
  // generic "思考强度" while open. Its visible effort label is authoritative.
  const effortLabel = first(document, '[data-model-picker-view-toggle] [data-effort-only="true"]');
  if (effortLabel && canonicalMode(visibleText(effortLabel))) return visibleText(effortLabel);
  const control = reasoningSlider(document);
  if (control) {
    const menu = control.wrapper.closest('[role="menu"]');
    for (const status of visible(menu || control.wrapper, '[role="status"], [aria-live]')) {
      const match = visibleText(status).match(/^(.+?)[，,]\s*第\s*(\d+)\s*项/);
      if (match && Number(match[2]) === control.index - control.min + 1 && canonicalMode(match[1])) return match[1];
    }
  }
  return visibleText(first(document, MODEL));
}
function reasoningSlider(document) {
  const wrapper = first(document, '[data-reasoning-slider="true"][role="menuitem"]');
  const slider = wrapper?.querySelector('[role="slider"]');
  if (!slider) return null;
  const min = Number(slider.getAttribute('aria-valuemin')), max = Number(slider.getAttribute('aria-valuemax'));
  const index = Number(slider.getAttribute('aria-valuenow'));
  if (![min, max, index].every(Number.isInteger) || min < 0 || max > 10 || min > max || index < min || index > max) return null;
  return { wrapper, slider, index, min, max };
}
export function searchState(document) {
  const scope = composerScope(document);
  if (!scope) return null;
  if (first(scope, SEARCH_TOKEN)) return true;
  const toggle = named(scope, SEARCH_NAME, 'button, [role="switch"]');
  if (toggle && (toggle.hasAttribute('aria-pressed') || toggle.hasAttribute('aria-checked'))) return selected(toggle);
  const chip = visible(scope, '[data-testid="web-search-chip"], [data-testid="composer-search-chip"]')[0];
  if (chip && SEARCH_NAME.test(label(chip))) return true;
  // A native selected Search chip also has a local remove control.
  const candidate = visible(scope, 'button').find(element => SEARCH_NAME.test(label(element)) && element.querySelector('button[aria-label*="Remove"], button[aria-label*="移除"]'));
  if (candidate) return true;
  // No search selection in the known composer means off, but an unrecognized
  // pressed tool is ambiguous and must never be silently ignored.
  if (visible(scope, '[aria-pressed="true"], [aria-checked="true"]').some(element => /search|搜索/i.test(label(element)))) return null;
  return false;
}
export function probe(document) {
  const composer = findComposer(document);
  const login = named(document, /^(log in|login|sign in|登录|登入)$/i);
  // Account presence is a status signal, not a click target. The native
  // responsive/collapsed sidebar hides it while the signed-in composer works.
  const account = document.querySelector('button[data-testid="accounts-profile-button"], button[data-testid="profile-button"], button[aria-label="Open profile menu"], button[aria-label="打开个人资料菜单"]');
  const loggedIn = !login && Boolean(account);
  const mode = currentMode(document);
  return {
    ready: Boolean(composer) && loggedIn && !quotaExhausted(document),
    loggedIn,
    loginRequired: Boolean(login),
    hasComposer: Boolean(composer),
    pageTitle: document.title.slice(0, 100),
    temporary: temporaryState(document),
    busy: Boolean(findStopButton(document)) || visible(document, '[data-is-streaming="true"]').length > 0,
    hasDraft: normalize(composerText(document)).length > 0,
    hasMessages: visible(document, `${USER}, ${ASSISTANT}`).length > 0,
    hasAttachments: hasAttachments(document),
    quotaExhausted: quotaExhausted(document),
    capabilities: { modes: mode ? [mode] : [], mode, search: searchState(document) },
    url: document.location.href,
  };
}
function quotaExhausted(document) {
  const scope = composerScope(document);
  return scope && visible(scope, '[role="alert"]').some(element => /(?:ChatGPT.*(?:额度|上限)|you.ve reached your (?:message |usage )?limit)/i.test(normalize(element.textContent)));
}

export function fillComposer(document, text) {
  if (normalize(composerText(document))) fail('DRAFT_PRESENT', 'ChatGPT 输入框已有草稿，请先自行处理草稿。');
  const composer = findComposer(document);
  if (!composer) fail('COMPOSER_UNAVAILABLE', '找不到可见的 ChatGPT 输入框。');
  composer.focus();
  const win = document.defaultView;
  if (composer.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(composer, text); else composer.value = text;
    composer.dispatchEvent(new win.Event('input', { bubbles: true }));
  } else {
    const selection = win.getSelection();
    selection?.selectAllChildren(composer);
    selection?.collapseToEnd();
    let inserted = false;
    try { inserted = document.execCommand?.('insertText', false, text) === true; } catch { /* DOM fallback below */ }
    if (!inserted) {
      const lines = text.split('\n');
      const token = composer.querySelector(SEARCH_TOKEN);
      if (token) {
        // Native search is an inline ProseMirror token. Keep it and insert only
        // the user's text; clearing/replacing the editor silently disables it.
        const paragraph = token.closest('p') || composer;
        paragraph.append(document.createTextNode(lines.shift()));
      } else composer.replaceChildren();
      composer.append(...lines.map(line => {
        const paragraph = document.createElement('p');
        if (line) paragraph.textContent = line; else paragraph.append(document.createElement('br'));
        return paragraph;
      }));
      composer.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }
  if (normalize(composerText(document)) !== normalize(text)) fail('INPUT_NOT_CONFIRMED', '原生输入框未确认收到完整问题。');
  return composer;
}

export function attachmentChips(document) {
  return visible(composerScope(document) || document, '[data-composer-attachments] [class~="group/composer-attachment"], [data-testid="attachment"], [data-testid="file-upload"], [data-testid="composer-file"], [data-testid="attachment-chip"]');
}
function hasAttachments(document) {
  return attachmentChips(document).length > 0 || Boolean(first(composerScope(document) || document, '[data-composer-attachments][data-visible-attachments]'));
}
function safeUrl(raw, base) {
  try { const url = new URL(raw, base); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function extractSources(assistant) {
  const results = [], seen = new Set();
  // Native citation/source containers only. General answer links are not sources.
  for (const anchor of assistant.querySelectorAll('a[data-testid="chatgpt-citation"], a[data-testid="web-citation"], [data-testid="web-search-source"] a[href], [data-testid="sources"] a[href], a[data-source-url], a[data-citation-id]')) {
    if (!isVisible(anchor)) continue;
    const url = safeUrl(anchor.getAttribute('data-source-url') || anchor.getAttribute('href'), assistant.ownerDocument.location.href);
    if (!url || seen.has(url)) continue;
    seen.add(url); results.push({ title: normalize(anchor.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.textContent).replace(/,\s*https?:\/\/.*$/i, '') || new URL(url).hostname, url });
  }
  return results;
}
export function extractAnswerText(assistant) {
  const body = assistant.querySelector('[data-markdown-text-style="assistant-message"], .markdown, [data-testid="assistant-message-content"]') || assistant;
  const clone = body.cloneNode(true);
  // Preserve explicit native TeX before removing its accessibility/HTML copies.
  for (const annotation of clone.querySelectorAll('annotation[encoding="application/x-tex"]')) {
    if (!clone.contains(annotation) || annotation.closest('pre, code, [data-markdown-copy="code-block"]')) continue;
    const math = annotation.closest('math');
    const formula = annotation.closest('.katex-display') || annotation.closest('.katex') || math;
    if (!formula || !annotation.textContent.trim()) continue;
    const block = formula.classList.contains('katex-display') || math?.getAttribute('display') === 'block';
    const source = body.ownerDocument.createElement('cgp-native-math');
    source.setAttribute('data-markdown', block ? `\n\n\\[${annotation.textContent}\\]\n\n` : `\\(${annotation.textContent}\\)`);
    source.textContent = annotation.textContent;
    if (formula === clone) formula.replaceChildren(source); else formula.replaceWith(source);
  }
  clone.querySelectorAll('button, [aria-hidden="true"], [data-markdown-copy="exclude"], [data-chatgpt-mermaid-preview], svg, style').forEach(element => element.remove());
  // Normalize the native code widget to semantic HTML; Turndown handles the
  // actual Markdown serialization, including fences, nesting, tables and lists.
  for (const pre of clone.querySelectorAll('[data-markdown-copy="code-block"], pre')) {
    if (!clone.contains(pre)) continue;
    const code = pre.querySelector('code') || pre;
    const language = code.className.match(/language-([\w-]+)/)?.[1] || (/^\s*mindmap\b/.test(code.textContent) ? 'mermaid' : '');
    const block = body.ownerDocument.createElement('pre'), content = body.ownerDocument.createElement('code');
    if (language) content.className = `language-${language}`;
    content.textContent = code.textContent; block.append(content); pre.replaceWith(block);
  }
  return nativeMarkdown.turndown(clone);
}
export function extractDiagram(assistant) {
  const svg = first(assistant, '[data-chatgpt-mermaid-preview] [data-mermaid-render-status="ready"] svg');
  return svg ? { svg: svg.outerHTML } : null;
}
function completedControl(assistant) {
  const turn = assistant.closest('[data-turn-key], [data-testid^="conversation-turn-"], article') || assistant;
  return visible(turn, 'button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"], button[data-testid="bad-response-turn-action-button"], button[aria-label="Copy"], button[aria-label="复制"], button[aria-label="评价回复"], button[aria-label="重新生成回复"]')
    .some(button => assistant.contains(button) || Boolean(assistant.compareDocumentPosition(button) & 4));
}
function messageKey(element) { return element.getAttribute('data-message-id') || element.getAttribute('data-chatgpt-search-message-ids') || element.querySelector('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id') || element.closest('[data-message-id]')?.getAttribute('data-message-id') || null; }
function userText(element) {
  const body = element.querySelector('[data-user-message-bubble="true"] [data-search-result-target]') || element;
  const clone = body.cloneNode(true), document = body.ownerDocument;
  // Native collapsed messages mark their inline links aria-hidden/inert while
  // retaining the full submitted text. Composer filtering would drop that URL.
  clone.querySelectorAll('[data-markdown-copy="exclude"]').forEach(node => node.remove());
  clone.querySelectorAll('br').forEach(node => node.replaceWith(document.createTextNode('\n')));
  clone.querySelectorAll('p').forEach(node => node.append(document.createTextNode('\n')));
  return normalize(clone.textContent);
}
function confirmedUser(document, anchor, id, text) {
  // React can replace a message node without changing the native turn. A
  // detached node is recoverable only with one matching stable ID and text;
  // text alone must never associate a different submission with this task.
  if (anchor?.isConnected && (!id || messageKey(anchor) === id) && userText(anchor) === text) {
    if (!id || visible(document, USER).filter(element => messageKey(element) === id).length === 1) return anchor;
  }
  if (anchor?.isConnected || !id) return null;
  const matches = visible(document, USER).filter(element => messageKey(element) === id);
  return matches.length === 1 && userText(matches[0]) === text ? matches[0] : null;
}
function confirmedTurn(document, task) {
  // Native virtualization may unmount only the user bubble. Its turn shell
  // can still identify the reply, but only after an exact user echo tied that
  // shell to the same native message ID. Never use the last arbitrary reply.
  if (!task.userId || task.turnKey !== task.userId || task.user?.isConnected) return null;
  if ([...document.querySelectorAll(USER)].some(element => messageKey(element) === task.userId)) return null;
  const turns = [...document.querySelectorAll('[data-turn-key]')].filter(element => element.getAttribute('data-turn-key') === task.turnKey);
  if (turns.length) return turns.length === 1 && isVisible(turns[0]) ? turns[0] : null;
  // A collapsed native turn can replace its UUID shell with a search fallback
  // shell. Use only the search-turn identity observed on the exact user echo,
  // with one matching inner container and the same explicit outer fallback key.
  if (!/^fallback-turn-\d+$/.test(task.contentTurnKey)) return null;
  const matches = [...document.querySelectorAll('[data-content-search-turn-key]')].filter(element => element.getAttribute('data-content-search-turn-key') === task.contentTurnKey);
  const candidate = matches.length === 1 ? matches[0] : null;
  return candidate && isVisible(candidate) && candidate.closest('[data-turn-key]')?.getAttribute('data-turn-key') === task.contentTurnKey ? candidate : null;
}
function ownedTurn(document, task) {
  const current = new URL(document.location.href), original = new URL(task.url);
  if (current.origin !== original.origin || current.pathname !== original.pathname) return null;
  const user = confirmedUser(document, task.user, task.userId, normalize(task.prompt));
  if (user) return visible(document, USER).at(-1) === user ? { user } : null;
  if (!task.before || !task.beforeIds) return null;
  const isNew = element => !task.before.has(element) && (!messageKey(element) || !task.beforeIds.has(messageKey(element)));
  if ([...document.querySelectorAll(USER)].some(isNew)) return null;
  const turn = confirmedTurn(document, task);
  if (!turn) return null;
  const assistants = [...document.querySelectorAll(ASSISTANT)].filter(isNew);
  if (assistants.length !== 1 || !turn.contains(assistants[0]) || !isVisible(assistants[0])) return null;
  return { turn, assistant: assistants[0] };
}
function confirmedSession(document, session) {
  const binding = { ...(session.binding || { user: session.anchor, userId: session.userId, prompt: session.prompt }), url: session.url };
  const ownership = ownedTurn(document, binding);
  if (!ownership) return null;
  if (ownership.user) { session.anchor = ownership.user; return ownership; }
  // A fallback turn number can be reused. A followup additionally requires the
  // exact native assistant identity already read for this retained session.
  const assistant = ownership.assistant;
  if (!session.assistantId || messageKey(assistant) !== session.assistantId
    || [...document.querySelectorAll(ASSISTANT)].filter(element => messageKey(element) === session.assistantId).length !== 1) return null;
  return ownership;
}
function retainedTemporary(document, ownership) {
  return Boolean(ownership?.turn && named(document, /^(save chat|保存聊天)$/i, 'button'));
}
function clearOwnedPrompt(document, task) {
  if (!task.ownedComposer || normalize(composerText(document)) !== normalize(task.prompt)) return;
  const editor = task.ownedComposer, token = editor.querySelector(SEARCH_TOKEN);
  if (editor.tagName === 'TEXTAREA') editor.value = '';
  else if (token) {
    const paragraph = document.createElement('p'); paragraph.append(token, document.createTextNode(' ')); editor.replaceChildren(paragraph);
  } else editor.replaceChildren();
  editor.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
}

// Hidden execution tabs throttle chained timers. Native DOM changes must wake
// a wait directly; the one deadline timer is a fallback for a silent page.
export async function waitForDom(document, predicate, {
  timeoutMs, check = () => {}, setWake = () => {},
  code = 'CONTROL_TIMEOUT', message = '原生网页控件状态未确认。',
} = {}) {
  const win = document.defaultView, deadline = Date.now() + timeoutMs;
  let resolveMutation = null, timer = null;
  const wake = () => { const resolve = resolveMutation; resolveMutation = null; resolve?.(); };
  const observer = new win.MutationObserver(wake);
  // Register before testing so mutations scheduled by a native control cannot
  // fall into a gap between the condition check and its next awaited event.
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  setWake(wake);
  timer = win.setTimeout(wake, timeoutMs);
  try {
    while (true) {
      check();
      const result = predicate();
      if (result) return result;
      if (Date.now() >= deadline) fail(code, message);
      await new Promise(resolve => { resolveMutation = resolve; });
    }
  } finally {
    observer.disconnect();
    if (timer !== null) win.clearTimeout(timer);
    resolveMutation = null;
    setWake(null, wake);
  }
}

function responseWaitDiagnostics(document, task) {
  const identity = element => element ? {
    messageId: messageKey(element)?.slice(0, 200),
    turnKey: element.closest('[data-turn-key]')?.getAttribute('data-turn-key')?.slice(0, 200),
    unitKey: element.getAttribute('data-chatgpt-search-unit-key')?.slice(0, 200),
    contentTurnKey: element.closest('[data-content-search-turn-key]')?.getAttribute('data-content-search-turn-key')?.slice(0, 200),
  } : null;
  const describe = element => {
    const hidden = [];
    for (let node = element; node && hidden.length < 4; node = node.parentElement) {
      const style = document.defaultView.getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('inert') || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) {
        hidden.push({ tag: node.tagName, hidden: node.hidden, ariaHidden: node.getAttribute('aria-hidden'), inert: node.hasAttribute('inert'), display: style.display, visibility: style.visibility });
      }
    }
    return { tag: element.tagName, textLength: element.textContent?.length || 0, visible: isVisible(element), hidden };
  };
  const messages = [...document.querySelectorAll(`${USER}, ${ASSISTANT}`)];
  return {
    elapsedMs: Date.now() - task.sentAt,
    document: { readyState: document.readyState, visibility: document.visibilityState, focused: document.hasFocus(), width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    userConnected: Boolean(task.user?.isConnected),
    turnCaptured: Boolean(task.turnKey),
    turnConfirmed: Boolean(confirmedTurn(document, task)),
    temporary: { indicatorsVisible: temporaryState(document), saveChatVisible: Boolean(named(document, /^(save chat|保存聊天)$/i, 'button')) },
    capturedIdentity: { userId: task.userId, turnKey: task.turnKey, contentTurnKey: task.contentTurnKey, shellConnected: Boolean(task.turnShell?.isConnected), shellCurrentKey: task.turnShell?.getAttribute('data-turn-key')?.slice(0, 200) },
    currentTurns: [...document.querySelectorAll('[data-turn-key]')].slice(-10).map(element => ({ ...describe(element), key: element.getAttribute('data-turn-key')?.slice(0, 200), assistants: element.querySelectorAll(ASSISTANT).length })),
    stopVisible: Boolean(findStopButton(document)),
    composerLength: composerText(document).length,
    completionControls: document.querySelectorAll('button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"], button[aria-label="复制"], button[aria-label="评价回复"], button[aria-label="重新生成回复"]').length,
    messages: messages.slice(-6).map(element => ({ ...describe(element), identity: identity(element), role: element.matches(USER) ? 'user' : 'assistant', afterUser: Boolean(task.user?.isConnected && task.user.compareDocumentPosition(element) & 4), newMessage: !task.before.has(element) && (!messageKey(element) || !task.beforeIds.has(messageKey(element))), answerLength: element.matches(ASSISTANT) ? extractAnswerText(element).length : undefined })),
    answerContainers: [...document.querySelectorAll('.markdown, [data-markdown-text-style="assistant-message"], [data-testid="assistant-message-content"]')].slice(-4).map(describe),
    alerts: visible(document, '[role="alert"], [data-testid*="error"], .text-token-text-error').slice(-4).map(element => normalize(element.textContent).slice(0, 250)),
  };
}

export class ChatGPTAdapter {
  constructor(document, { emit = () => {}, timeoutMs = 15000, responseTimeoutMs = 180000 } = {}) {
    this.document = document; this.emit = emit; this.timeoutMs = timeoutMs;
    this.responseTimeoutMs = responseTimeoutMs;
    this.active = null; this.session = null;
    this.lastCapabilities = null; this.modeIndices = new Map();
  }
  probe() { return probe(this.document); }
  async sidebarInput({ text, send = false } = {}) {
    if (typeof text !== 'string' || !text.trim() || text.length > 125000 || typeof send !== 'boolean') fail('INVALID_INPUT', '附加内容为空或过长。');
    if (this.active) fail('ADAPTER_BUSY', '插件正在操作输入框，请稍后重试。');
    const state = this.probe();
    if (!state.ready) fail('PAGE_NOT_READY', '请等待 ChatGPT 网页就绪并确认已登录。');
    if (send && state.busy) fail('NATIVE_BUSY', 'ChatGPT 正在生成，请稍后附加网页。');
    if (send && hasAttachments(this.document)) fail('ATTACHMENTS_PRESENT', '输入框已有附件，请先处理附件；原草稿未改动。');
    const draft = composerDraft(this.document);
    if (!send) {
      const separator = draft && !draft.endsWith('\n\n') ? (draft.endsWith('\n') ? '\n' : '\n\n') : '';
      writeDraft(this.document, draft + separator + text);
      return { ok: true, sent: false };
    }
    const task = { url: this.document.location.href, cancelled: false, sent: false, prompt: text };
    this.active = task;
    const deadline = Date.now() + Math.min(this.timeoutMs, 12000);
    const remaining = () => Math.max(1, deadline - Date.now());
    let wrote = false;
    try {
      wrote = true;
      writeDraft(this.document, text);
      const sendButton = await this.waitFor(task, () => { const button = findSendButton(this.document); return enabled(button) && button; }, remaining(), 'SEND_UNAVAILABLE', '原生发送按钮未就绪，已恢复草稿。');
      if (composerDraft(this.document) !== text) fail('DRAFT_CHANGED', '输入框被修改，未发送网页内容。');
      if (findStopButton(this.document)) fail('NATIVE_BUSY', 'ChatGPT 已开始另一轮生成，未发送网页内容。');
      task.before = new Set(this.document.querySelectorAll(`${USER}, ${ASSISTANT}`));
      task.beforeIds = new Set([...task.before].map(messageKey).filter(Boolean));
      task.sent = true; sendButton.click();
      await this.waitFor(task, () => visible(this.document, USER).find(element => !task.before.has(element)
        && (!messageKey(element) || !task.beforeIds.has(messageKey(element))) && userText(element) === normalize(text)), remaining(), 'SEND_NOT_CONFIRMED', '未确认网页内容已发送，未重复提交。');
      await this.waitFor(task, () => findComposer(this.document) && !composerText(this.document), remaining(), 'COMPOSER_NOT_CLEARED', '网页发送后输入框未清空。');
      return { ok: true, sent: true, draftRestored: Boolean(draft) };
    } finally {
      try {
        if (wrote && findComposer(this.document)) {
          const current = composerDraft(this.document);
          // Preserve edits made while awaiting the native send. Never submit
          // them or discard them when restoring the temporarily saved draft.
          const restored = current === draft ? current : !current || current === text ? draft : draft ? `${draft}\n\n${current}` : current;
          if (restored !== current) writeDraft(this.document, restored);
        }
      } finally { if (this.active === task) this.active = null; }
    }
  }
  check(task) {
    if (this.active !== task || task.cancelled) fail('CANCELLED', '本次请求已取消。');
    if (task.previousSession && !task.sent && !confirmedSession(this.document, task.previousSession)) fail('SESSION_LOST', '无法确认追问仍属于原会话。');
    if (task.user && !task.user.isConnected) this.rebindUser(task);
    const current = new URL(this.document.location.href), initial = new URL(task.url);
    if (current.origin !== initial.origin || current.pathname !== initial.pathname) {
      // A normal new chat changes / to /c/<id> after native submission. Bind
      // that route only when the exact new user echo is present in this DOM.
      const sameOrigin = current.origin === initial.origin;
      const newChatRoute = task.sent && sameOrigin && initial.pathname === '/' && /^\/c\/[^/]+\/?$/.test(current.pathname);
      const canonicalRoute = task.sent && sameOrigin && /^\/c\/local-chatgpt(?:%3a|:)[^/]+$/i.test(initial.pathname)
        && /^\/c\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(current.pathname)
        && task.user?.isConnected && messageKey(task.user) === task.userId && userText(task.user) === normalize(task.prompt);
      if ((!newChatRoute && !canonicalRoute) || (task.pendingRoute && task.pendingRoute !== current.pathname)) fail('NAVIGATED', 'ChatGPT 页面已导航，本次请求已中断。');
      const newUsers = visible(this.document, USER).filter(element => !task.before.has(element)
        && (!messageKey(element) || !task.beforeIds.has(messageKey(element))));
      if (newUsers.some(element => userText(element) && userText(element) !== normalize(task.prompt))) fail('NATIVE_INTERFERENCE', '原生页面出现不同的问题，本次提交未确认。');
      const ownEcho = newUsers.find(element => userText(element) === normalize(task.prompt));
      if (canonicalRoute && newUsers.some(element => element !== task.user)) fail('NATIVE_INTERFERENCE', '原生页面出现另一轮问题，无法确认会话路径转换。');
      if (ownEcho) {
        task.url = current.href; task.pendingRoute = null;
        task.user = ownEcho; task.userId = messageKey(ownEcho);
        if (this.session && this.session.id === task.sessionId && this.session.anchor === ownEcho) this.session.url = task.url;
      }
      // Native pushState can precede mounting the user bubble. During only
      // this send-confirmation window remember the route without binding a
      // session or accepting any assistant output. Exact echo must still
      // arrive before the existing submission deadline; never submit again.
      else if (!task.user) task.pendingRoute = current.pathname;
      else fail('NAVIGATED', 'ChatGPT 页面已导航，本次请求已中断。');
    }
    if (task.sent && task.alertsBeforeSend) {
      const alert = visible(this.document, '[role="alert"]').find(element => {
        const text = normalize(element.textContent);
        return text && !task.alertsBeforeSend.has(text);
      });
      if (alert) fail('NATIVE_ERROR', normalize(alert.textContent));
    }
  }
  rebindUser(task) {
    const user = confirmedUser(this.document, task.user, task.userId, normalize(task.prompt));
    if (!user) return null;
    const previous = task.user;
    task.user = user; task.userId ||= messageKey(user);
    if (this.session?.id === task.sessionId && this.session.anchor === previous) {
      this.session.anchor = user; this.session.userId = task.userId;
    }
    return user;
  }
  temporaryConfirmed(task) {
    return temporaryState(this.document) || (task.previousSession
      && retainedTemporary(this.document, confirmedSession(this.document, task.previousSession)));
  }
  event(task, state, payload = {}) {
    if (this.active !== task || task.cancelled) return;
    this.emit({ channel: 'cgp', type: 'TASK_EVENT', requestId: task.requestId, sessionId: task.sessionId, state, mode: task.mode, ...payload });
  }
  async waitFor(task, predicate, timeoutMs = this.timeoutMs, code = 'CONTROL_TIMEOUT', message = '原生网页控件状态未确认。') {
    return waitForDom(this.document, predicate, {
      timeoutMs, code, message, check: () => this.check(task),
      setWake: (wake, previous) => { if (wake || task.wake === previous) task.wake = wake; },
    });
  }
  async selectMode(task) {
    const model = await this.waitFor(task, () => { const button = first(this.document, MODEL); return enabled(button) && button; }, this.timeoutMs, 'MODE_UNAVAILABLE', '无法确认 ChatGPT 原生模型/思考档位。');
    if (currentMode(this.document) === task.mode) return;
    if (task.mode === 'pro') {
      this.check(task); model.click();
      await this.openModelList(task);
      const pro = await this.waitFor(task, () => named(this.document, /^pro(?:\b|$)/i, '[role="menuitemradio"], [role="option"]'), this.timeoutMs, 'MODE_UNAVAILABLE', '原生 Pro 模式不可用。');
      if (!enabled(pro)) fail('MODE_DISABLED', '原生 Pro 模式当前被禁用，无法切换；未替换为其他模式。');
      this.check(task); pro.click();
      await this.waitFor(task, () => currentMode(this.document) === 'pro', this.timeoutMs, 'MODE_NOT_CONFIRMED', '原生网页未确认 Pro 模式。');
      return;
    }
    await this.ensureSlider(task);
    if (!this.modeIndices.has(task.mode)) await this.inspectNativeModes(task);
    const target = this.modeIndices.get(task.mode);
    if (!Number.isInteger(target)) fail('MODE_UNAVAILABLE', '原生思考控件没有提供所需档位。');
    const current = await this.moveSlider(task, target);
    await this.waitFor(task, () => currentMode(this.document) === task.mode, this.timeoutMs, 'MODE_NOT_CONFIRMED', '原生模型按钮没有确认所需思考强度。');
    this.check(task);
    current.wrapper.dispatchEvent(new this.document.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }
  async ensureSlider(task) {
    let current = reasoningSlider(this.document);
    if (current) return current;
    const model = first(this.document, MODEL);
    if (!enabled(model)) fail('MODE_UNAVAILABLE', '原生模型控件不可用。');
    let advanced = first(this.document, '[data-model-picker-view="advanced"]');
    if (!advanced) {
      this.check(task); model.click();
      const opened = await this.waitFor(task, () => reasoningSlider(this.document) || first(this.document, '[data-model-picker-view="advanced"]'), this.timeoutMs, 'MODE_UNAVAILABLE', '原生思考强度控件不可用。');
      if (opened.wrapper) return opened;
      advanced = opened;
    }
    // The native picker persists its advanced model-list view across closes.
    // Re-select only its already-selected, enabled radio to return to strength;
    // never hardcode a model or change the selected model for discovery.
    const selectedModel = first(advanced, '[role="menuitemradio"][aria-checked="true"][data-model-selected="true"]')
      || first(advanced, '[role="menuitemradio"][aria-checked="true"]');
    if (!enabled(selectedModel)) fail('MODE_UNAVAILABLE', '无法确认原生模型列表中当前已选模型，未更换模型。');
    this.check(task); selectedModel.click();
    const returned = await this.waitFor(task, () => reasoningSlider(this.document)
      || (!first(this.document, '[data-model-picker-view="advanced"]') && !first(this.document, '[role="menu"]') && { closed: true }), this.timeoutMs, 'MODE_UNAVAILABLE', '当前原生模型未返回思考强度控件。');
    if (returned.wrapper) return returned;
    this.check(task); model.click();
    current = await this.waitFor(task, () => reasoningSlider(this.document), this.timeoutMs, 'MODE_UNAVAILABLE', '原生思考强度控件不可用。');
    return current;
  }
  async moveSlider(task, target) {
    let current = await this.ensureSlider(task);
    if (!enabled(current.wrapper)) fail('MODE_DISABLED', '原生思考强度控件当前被禁用。');
    if (target < current.min || target > current.max) fail('MODE_UNAVAILABLE', '原生思考控件的范围已变化。');
    for (let steps = 0; current.index !== target && steps <= current.max - current.min; steps++) {
      const nextIndex = current.index + (target > current.index ? 1 : -1);
      this.check(task);
      current.wrapper.dispatchEvent(new this.document.defaultView.KeyboardEvent('keydown', { key: target > current.index ? 'ArrowRight' : 'ArrowLeft', bubbles: true, cancelable: true }));
      current = await this.waitFor(task, () => { const next = reasoningSlider(this.document); return next?.index === nextIndex && next; }, this.timeoutMs, 'MODE_NOT_CONFIRMED', '原生思考强度控件没有确认档位变化。');
    }
    if (current.index !== target) fail('MODE_NOT_CONFIRMED', '原生思考强度设置未确认。');
    return current;
  }
  async openModelList(task) {
    const toggle = first(this.document, '[data-model-picker-view-toggle="true"][aria-label="选择模型"], [data-model-picker-view-toggle="true"][aria-label="Choose model"]');
    if (!toggle) return;
    if (!enabled(toggle)) fail('MODE_UNAVAILABLE', '原生模型列表当前不可用。');
    this.check(task); toggle.click();
    await this.waitFor(task, () => first(this.document, '[role="menu"] [role="menuitemradio"]'), this.timeoutMs, 'MODE_UNAVAILABLE', '原生模型列表未确认打开。');
  }
  async inspectNativeModes(task) {
    const model = await this.waitFor(task, () => { const button = first(this.document, MODEL); return enabled(button) && button; }, this.timeoutMs, 'MODE_UNAVAILABLE', '原生模型控件不可用。');
    const originalOpen = model.getAttribute('aria-expanded') === 'true';
    const originalMode = currentMode(this.document);
    if (!first(this.document, '[role="menu"]') && !reasoningSlider(this.document)) { this.check(task); model.click(); }
    await this.waitFor(task, () => reasoningSlider(this.document) || first(this.document, '[role="menu"]'), this.timeoutMs, 'MODE_UNAVAILABLE', '原生模型菜单不可用。');
    const modes = new Set(), unavailable = [], indices = new Map();
    let original = null, sliderRestored = false;
    try {
      const initial = reasoningSlider(this.document);
      if (initial) {
        original = initial.index;
        for (let index = initial.min; index <= initial.max; index++) {
          await this.moveSlider(task, index);
          const nativeLabel = nativeModeText(this.document);
          const mode = canonicalMode(nativeLabel);
          if (mode) { modes.add(mode); indices.set(mode, index); }
          else unavailable.push({ mode: 'unknown', label: nativeLabel, reason: '无法将实际原生档位标签映射到已知设置。' });
        }
        // Inspect the model list only after restoring strength. The advanced
        // view makes the old slider inert and cannot be used for restoration.
        await this.moveSlider(task, original); sliderRestored = true;
        if (originalMode) await this.waitFor(task, () => currentMode(this.document) === originalMode, this.timeoutMs, 'MODE_RESTORE_FAILED', '原生思考设置未恢复。');
      }
      await this.openModelList(task);
      for (const option of visible(this.document, '[role="menu"] [role="menuitemradio"], [role="menu"] [role="option"]')) {
        const text = visibleText(option), nativeLabel = text.match(/^(?:Extra High|Instant|Medium|High|Pro)(?:\b|$)/i)?.[0];
        const mode = canonicalMode(nativeLabel);
        if (!mode) continue;
        if (enabled(option)) modes.add(mode);
        else unavailable.push({ mode, label: nativeLabel, reason: '原生网页标记该模式为不可用或额度不足。' });
      }
    } finally {
      if (!task.cancelled && this.active === task) {
        if (original !== null && !sliderRestored) await this.moveSlider(task, original);
        // Advanced view persists across closes. Return through the currently
        // selected native model before restoring effort and menu open state.
        const advanced = Boolean(first(this.document, '[data-model-picker-view="advanced"]'));
        if (advanced) {
          await this.ensureSlider(task);
          if (original !== null) await this.moveSlider(task, original);
        }
        if (!originalOpen) {
          const menu = first(this.document, '[role="menu"]') || reasoningSlider(this.document)?.wrapper;
          menu?.dispatchEvent(new this.document.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        }
        if (originalMode) await this.waitFor(task, () => currentMode(this.document) === originalMode, this.timeoutMs, 'MODE_RESTORE_FAILED', '原生思考设置未确认恢复到检查前的档位。');
      }
    }
    this.modeIndices = indices;
    const capabilities = { modes: [...modes], unavailable, currentMode: currentMode(this.document) };
    this.lastCapabilities = capabilities;
    return capabilities;
  }
  async discoverCapabilities() {
    if (this.active) {
      if (this.lastCapabilities) return { ok: true, capabilities: this.lastCapabilities };
      fail('ADAPTER_BUSY', '当前任务执行中，不能改变原生模式控件。');
    }
    if (this.probe().busy) fail('NATIVE_BUSY', 'ChatGPT 正在生成，不能检查模式控件。');
    const task = { requestId: '_capabilities', sessionId: '_capabilities', url: this.document.location.href, cancelled: false };
    this.active = task;
    try { return { ok: true, capabilities: await this.inspectNativeModes(task) }; }
    finally { if (this.active === task) this.active = null; }
  }
  async selectSearch(task) {
    if (searchState(this.document) === task.search) return;
    if (!task.search && first(this.document, SEARCH_TOKEN)) fail('SEARCH_STATE_CONFLICT', '原生输入框已有网页搜索选项，请先自行移除后再提交普通问题。');
    const scope = composerScope(this.document);
    let toggle = named(scope || this.document, SEARCH_NAME, 'button, [role="switch"]');
    if (!toggle) {
      const tools = named(scope || this.document, /^(tools|工具|add files and more|添加文件及更多|添加文件等内容)$/i, 'button')
        || first(scope || this.document, 'button[data-testid="composer-plus-btn"], button[data-testid="composer-tools-button"]');
      if (!enabled(tools)) fail('SEARCH_UNAVAILABLE', '找不到原生网页搜索控件。');
      this.check(task); tools.click();
      toggle = await this.waitFor(task, () => named(this.document, SEARCH_NAME, '[role="menuitemcheckbox"], [role="menuitem"], [role="menuitemradio"]')
        || visible(this.document, '[data-mention-section-id="chatgpt-actions"] button[data-list-navigation-item="true"]').find(button => /^网页搜索(?:\s|查找|$)/.test(visibleText(button))), this.timeoutMs, 'SEARCH_UNAVAILABLE', '原生网页搜索不可用。');
    }
    if (!enabled(toggle)) fail('SEARCH_UNAVAILABLE', '原生网页搜索不可用。');
    this.check(task); toggle.click();
    await this.waitFor(task, () => searchState(this.document) === task.search, this.timeoutMs, 'SEARCH_NOT_CONFIRMED', '网页搜索的实际选中状态未确认。');
  }
  start(input) {
    if (!input?.requestId || !input.sessionId || typeof input.prompt !== 'string' || !input.prompt.trim()) fail('INVALID_REQUEST', '请求缺少身份或问题。');
    if (![...STRENGTHS, 'pro'].includes(input.mode) || typeof input.search !== 'boolean' || typeof input.temporary !== 'boolean') fail('INVALID_REQUEST', '请求的模式/搜索/临时状态无效。');
    if (this.active) fail('ADAPTER_BUSY', '插件任务尚未结束。');
    const task = { ...input, url: this.document.location.href, cancelled: false, sent: false, ownedComposer: null };
    this.active = task;
    task.done = this.execute(task).catch(error => {
      if (error.code === 'CANCELLED') return;
      let diagnostics;
      if (task.sent && ['RESPONSE_NOT_CONFIRMED', 'TEMPORARY_NOT_CONFIRMED'].includes(error.code)) {
        try { diagnostics = responseWaitDiagnostics(this.document, task); } catch { /* Diagnostics must not mask the original failure. */ }
      }
      this.event(task, error.code === 'NAVIGATED' ? 'interrupted' : 'failed', { error: { code: error.code || 'ADAPTER_FAILURE', message: error.message, ...(diagnostics ? { diagnostics } : {}) } });
      // Release only our own unchanged unsent text; a user's replacement is kept.
      if (!task.sent) clearOwnedPrompt(this.document, task);
    }).finally(() => { if (this.active === task) this.active = null; });
    return { ok: true, requestId: task.requestId, sessionId: task.sessionId };
  }
  async execute(task) {
    const state = this.probe();
    if (state.quotaExhausted) fail('QUOTA_EXHAUSTED', 'ChatGPT 原生网页提示额度已耗尽，请先处理额度后重试。');
    if (!state.loggedIn) fail('LOGIN_REQUIRED', '无法确认 ChatGPT 已登录，请先在原生页面登录。');
    if (!state.ready) fail('PAGE_NOT_READY', 'ChatGPT 原生网页尚未准备好。');
    if (state.busy) fail('NATIVE_BUSY', '原生 ChatGPT 正在生成，请等待后重试。');
    if (state.hasDraft) fail('DRAFT_PRESENT', 'ChatGPT 输入框已有草稿，请先自行处理草稿。');
    if (hasAttachments(this.document)) fail('ATTACHMENTS_PRESENT', 'ChatGPT 输入框已有附件，请先自行处理。');
    if (task.followup) {
      if (!this.session || this.session.id !== task.sessionId || new URL(this.session.url).origin !== new URL(task.url).origin || new URL(this.session.url).pathname !== new URL(task.url).pathname || this.session.temporary !== task.temporary) fail('SESSION_LOST', '无法确认追问仍属于原会话。');
      await this.waitFor(task, () => confirmedSession(this.document, this.session), this.timeoutMs, 'SESSION_LOST', '无法确认追问仍属于原会话。');
      task.previousSession = this.session;
    } else if (task.temporary && visible(this.document, `${USER}, ${ASSISTANT}`).length) {
      fail('TEMPORARY_NOT_FRESH', '新任务需要新的临时会话，不能复用已有对话。');
    }
    if (task.temporary && !this.temporaryConfirmed(task)) fail('TEMPORARY_NOT_CONFIRMED', '未确认原生网页处于临时会话，问题没有发送。');
    this.event(task, 'preparing', { capabilities: state.capabilities });
    await this.selectMode(task);
    await this.selectSearch(task);
    this.check(task);
    if (normalize(composerText(this.document))) fail('DRAFT_PRESENT', '准备期间原生输入框出现草稿，已停止提交。');
    task.ownedComposer = fillComposer(this.document, task.prompt);
    const send = await this.waitFor(task, () => { const button = findSendButton(this.document); return enabled(button) && button; }, this.timeoutMs, 'SEND_UNAVAILABLE', '原生发送按钮未就绪。');
    this.check(task);
    if (task.temporary && !this.temporaryConfirmed(task)) fail('TEMPORARY_NOT_CONFIRMED', '发送前临时会话状态失效。');
    await this.waitFor(task, () => currentMode(this.document) === task.mode, this.timeoutMs, 'MODE_NOT_CONFIRMED', '发送前思考设置未确认或已变化。');
    this.check(task);
    if (task.temporary && !this.temporaryConfirmed(task)) fail('TEMPORARY_NOT_CONFIRMED', '发送前临时会话状态失效。');
    if (searchState(this.document) !== task.search) fail('SEARCH_NOT_CONFIRMED', '发送前网页搜索设置发生变化。');
    if (normalize(composerText(this.document)) !== normalize(task.prompt)) fail('DRAFT_CHANGED', '问题草稿被修改，已停止提交。');
    if (findStopButton(this.document)) fail('NATIVE_BUSY', '原生页面已开始另一轮生成。');
    const before = new Set(this.document.querySelectorAll(`${USER}, ${ASSISTANT}`));
    const beforeIds = new Set([...before].map(messageKey).filter(Boolean));
    task.before = before; task.beforeIds = beforeIds;
    task.alertsBeforeSend = new Set(visible(this.document, '[role="alert"]').map(element => normalize(element.textContent)));
    task.sent = true;
    task.sentAt = Date.now();
    this.event(task, 'sending');
    send.click();
    const isNew = element => !before.has(element) && (!messageKey(element) || !beforeIds.has(messageKey(element)));
    const user = await this.waitFor(task, () => visible(this.document, USER).find(element => isNew(element) && userText(element) === normalize(task.prompt)), this.timeoutMs, 'SEND_NOT_CONFIRMED', '没有观察到属于本次问题的原生用户消息，未重复提交。');
    task.user = user; task.userId = messageKey(user);
    task.turnShell = user.closest('[data-turn-key]');
    const turnKey = task.turnShell?.getAttribute('data-turn-key');
    task.turnKey = turnKey && turnKey === task.userId ? turnKey : null;
    const contentTurnKey = user.closest('[data-content-search-turn-key]')?.getAttribute('data-content-search-turn-key');
    const unitKey = user.getAttribute('data-chatgpt-search-unit-key');
    task.contentTurnKey = contentTurnKey && unitKey?.startsWith(`${contentTurnKey}:`) && unitKey.endsWith(':user') ? contentTurnKey : null;
    this.session = { id: task.sessionId, url: task.url, temporary: task.temporary, anchor: user, userId: task.userId, prompt: normalize(task.prompt),
      binding: { user, userId: task.userId, prompt: task.prompt, turnKey: task.turnKey, contentTurnKey: task.contentTurnKey, before, beforeIds } };
    task.previousSession = null;
    this.event(task, 'waiting');
    let lastPayload = '', currentAssistant = null;
    await this.waitFor(task, () => {
      const user = this.rebindUser(task);
      let following, turn;
      if (!user) {
        if (!task.userId || [...this.document.querySelectorAll(USER)].some(isNew)) fail('SESSION_LOST', '无法重新确认本次用户消息，已停止观察；不会重复发送。');
        turn = confirmedTurn(this.document, task);
        if (!turn) {
          if (!task.reportedMissingTurn && visible(this.document, ASSISTANT).some(element => isNew(element) && extractAnswerText(element))) {
            task.reportedMissingTurn = true;
            this.event(task, lastPayload ? 'streaming' : 'waiting', { diagnostics: responseWaitDiagnostics(this.document, task) });
          }
          return false;
        }
        following = visible(turn, ASSISTANT).filter(isNew);
        if (following.length > 1) fail('SESSION_LOST', '本次轮次存在多个回答，无法确认回答归属。');
      }
      else following = visible(this.document, `${USER}, ${ASSISTANT}`).filter(element => user.compareDocumentPosition(element) & 4);
      // The temporary user bubble can vanish with its native turn shell. Only
      // for this already-confirmed temporary submission, an associated turn
      // plus the native Save Chat control remains evidence of an unsaved chat.
      const unsavedOwnTurn = turn && named(this.document, /^(save chat|保存聊天)$/i, 'button');
      if (task.temporary && !temporaryState(this.document) && !unsavedOwnTurn) fail('TEMPORARY_NOT_CONFIRMED', '临时会话状态已失效。');
      const otherUser = following.find(element => element.matches(USER));
      if (otherUser) fail('NATIVE_INTERFERENCE', '原生页面出现另一轮问题，本次观察已中断。');
      const assistant = following.find(element => element.matches(ASSISTANT) && isNew(element));
      if (!assistant) return false;
      currentAssistant = assistant;
      this.session.assistantId = messageKey(assistant);
      const generating = Boolean(findStopButton(this.document)) || assistant.getAttribute('data-is-streaming') === 'true';
      const text = extractAnswerText(assistant), sources = extractSources(assistant), diagram = extractDiagram(assistant);
      const content = { text, sources, ...(diagram ? { diagram } : {}) };
      const payload = JSON.stringify(content);
      if (payload !== lastPayload && (text || diagram)) { lastPayload = payload; this.event(task, 'streaming', content); }
      // Native per-turn actions must appear, and the native stop control must be
      // gone. A few seconds of silence alone is never completion evidence.
      if (!generating && (text || diagram) && completedControl(assistant)) return true;
      return false;
    }, this.responseTimeoutMs, 'RESPONSE_NOT_CONFIRMED', '等待 ChatGPT 回答超时；不会重复发送。');
    const diagram = extractDiagram(currentAssistant);
    this.event(task, 'completed', { text: extractAnswerText(currentAssistant), sources: extractSources(currentAssistant), ...(diagram ? { diagram } : {}) });
  }
  async stop({ requestId, sessionId } = {}) {
    const task = this.active;
    if (!task || task.sessionId !== sessionId || (requestId && task.requestId !== requestId)) return { ok: true, stopped: false };
    // Invalidate before clicking so synchronous/late mutations cannot publish.
    task.cancelled = true; task.wake?.(); this.active = null;
    let stopped = !task.sent;
    if (task.sent && !task.user) task.user = visible(this.document, USER).find(element => !task.before.has(element)
      && (!messageKey(element) || !task.beforeIds.has(messageKey(element))) && userText(element) === normalize(task.prompt));
    const samePage = this.document.location.origin === new URL(task.url).origin && this.document.location.pathname === new URL(task.url).pathname;
    const ownership = task.sent && task.user && samePage ? ownedTurn(this.document, task) : null;
    if (ownership && (!task.temporary || temporaryState(this.document) || retainedTemporary(this.document, ownership))) {
      const stop = findStopButton(this.document);
      if (enabled(stop)) {
        stop.click();
        try {
          const confirmation = await waitForDom(this.document, () => {
            if (!ownedTurn(this.document, task)) return { stopped: false };
            return !findStopButton(this.document) && { stopped: true };
          }, { timeoutMs: Math.min(this.timeoutMs, 2000), code: 'STOP_NOT_CONFIRMED', message: '原生停止生成未确认。' });
          stopped = confirmation.stopped;
        } catch (error) {
          if (error.code !== 'STOP_NOT_CONFIRMED') throw error;
          stopped = false;
        }
      }
      else stopped = !findStopButton(this.document);
    }
    if (!task.sent) clearOwnedPrompt(this.document, task);
    this.emit({ channel: 'cgp', type: 'TASK_EVENT', requestId: task.requestId, sessionId: task.sessionId, state: 'stopped', error: stopped ? undefined : { code: 'STOP_NOT_CONFIRMED', message: '本地观察已停止，但原生停止生成尚未确认。' } });
    return { ok: true, stopped, sessionUsable: this.session?.id === sessionId };
  }
  async dispose({ sessionId } = {}) {
    if (this.active?.sessionId === sessionId) await this.stop({ sessionId });
    if (this.session?.id === sessionId) this.session = null;
    return { ok: true };
  }
}
