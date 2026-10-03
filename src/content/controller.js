import { selectionContext, extractMaterial } from '../features/materials.js';
import { DEFAULT_SETTINGS, isExcludedHost, resolveMode } from '../shared/settings.js';
import { createSelectionToolbar, SELECTION_ACTIONS } from '../ui/selection-toolbar.js';
import { DOUBAO_STYLES } from '../ui/doubao-styles.js';
import { UI_ICONS } from '../ui/neutral-icons.js';
import { renderAnswer, renderSources, installMathStyles } from '../ui/markdown.js';
import { createDoubaoSuppression } from '../compat/doubao.js';
import { createMindmapResult } from '../ui/mindmap-result.js';
import { THEME_STYLES } from '../ui/theme-styles.js';
import { readPageTheme, observePageTheme } from '../shared/theme.js';

const LABELS = Object.fromEntries(SELECTION_ACTIONS);
const MODES = { instant: '即时', medium: '中', high: '高', 'extra-high': '超高', pro: 'Pro' };
const STATES = { preparing: '准备中', sending: '发送中', waiting: '已发送，等待回答', streaming: '生成中', stopping: '正在确认停止…', completed: '完成', stopped: '已停止', failed: '失败', interrupted: '已中断' };
const BUSY = new Set(['preparing', 'sending', 'waiting', 'streaming', 'stopping']);
const EXCLUDED = 'input,textarea,select,[contenteditable],[data-cgp-ui],[data-cgp-owned]';
const PATCH_STYLES = `
:host{all:initial;font-family:"Segoe UI Variable Text","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;color:#202124}
*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{border:0;cursor:pointer}button:disabled{opacity:.38;cursor:default}[hidden]{display:none!important}button:focus-visible,a:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--cgp-link);outline-offset:2px}
.cgp-anchor{position:absolute;z-index:2147483647}.cgp-popover{width:440px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);display:flex;flex-direction:column;overflow:auto;scrollbar-width:thin}.container-yap8B5{gap:0}
.cgp-body{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:0 20px;display:flex;flex-direction:column;gap:16px}.cgp-body>*{flex-shrink:0}.cgp-body>:empty{display:none}.cgp-selected{border:1px solid var(--cgp-border);border-radius:9px;padding:8px 10px;color:var(--cgp-muted);font-size:12px;line-height:19px;white-space:pre-wrap;overflow-wrap:anywhere}.cgp-selected summary{cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cgp-selected[open] summary{margin-bottom:8px}.cgp-selected>div{max-height:140px;overflow:auto}.cgp-context-note{margin-top:8px;border-top:1px solid var(--cgp-border);padding-top:8px}
.cgp-state{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:20px;color:var(--cgp-muted)}.cgp-state::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0}.cgp-popover[data-state=completed] .cgp-state{color:var(--cgp-success)}.cgp-popover[data-state=failed] .cgp-state,.cgp-popover[data-state=interrupted] .cgp-state{color:var(--cgp-error)}
.cgp-error{color:var(--cgp-error);font-size:13px;line-height:1.6;white-space:pre-wrap}.cgp-mode{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--cgp-muted);min-width:0}.cgp-mode select{min-width:0;max-width:112px;height:24px;border:0;border-radius:6px;padding:2px 4px;font-size:11px}.cgp-mode-note{font-size:11px;color:var(--cgp-muted);line-height:17px}.cgp-availability{padding:7px 2px 0}.cgp-sources{display:flex;flex-direction:column;gap:6px;font-size:12px}.cgp-sources a{color:var(--cgp-link);overflow-wrap:anywhere}
.cgp-footer{padding:14px 20px 16px;flex-shrink:0}.cgp-composer{background:var(--cgp-soft);border:1px solid var(--cgp-border);border-radius:12px;padding:9px}.cgp-composer:focus-within{border-color:var(--cgp-muted);box-shadow:0 0 0 2px var(--cgp-soft)}.cgp-composer-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;flex-wrap:wrap}.cgp-form{display:flex;gap:8px;align-items:flex-end}.cgp-form textarea{width:100%;resize:vertical;min-height:38px;max-height:120px;border:0;border-radius:6px;padding:8px 4px;line-height:22px;background:transparent;color:var(--cgp-text)}.cgp-form textarea:focus-visible{outline:none}.cgp-send{display:flex;align-items:center;justify-content:center;width:32px;height:32px;margin-bottom:3px;border-radius:9px;background:var(--cgp-brand);color:var(--cgp-on-brand);flex-shrink:0}.cgp-send:hover:not(:disabled){filter:brightness(1.15)}.cgp-send svg{width:18px;height:18px}.cgp-operations{display:flex;gap:2px}.cgp-result{overflow-wrap:anywhere;line-height:1.8;user-select:text}.cgp-result p{margin:0 0 12px}.cgp-result p:last-child{margin-bottom:0}.cgp-result pre{overflow:auto;white-space:pre;background:var(--cgp-soft);border-radius:10px;padding:12px}.cgp-result table{border-collapse:collapse;display:block;overflow:auto}.cgp-result th,.cgp-result td{border:1px solid var(--cgp-border);padding:7px 10px}.cgp-result a{color:var(--cgp-link)}.cgp-options button[aria-pressed=true]{color:var(--cgp-text);background:var(--cgp-soft)}
@media(max-width:480px){.header-container-cL372Q{padding-left:14px;padding-right:14px}.cgp-body{padding:0 14px}.cgp-footer{padding:12px 14px}.cgp-mode select{max-width:100px}}

.cgp-mindmap-tools{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.cgp-mindmap-tools select{max-width:200px;border:1px solid #ddd;border-radius:8px;padding:4px}.cgp-mindmap-canvas{max-height:360px;min-height:160px;overflow:auto}.cgp-mindmap-source{font-size:12px;margin-top:8px}.cgp-mindmap-source pre{overflow:auto;max-height:200px;white-space:pre;background:#f6f6f6;padding:8px}
.cgp-diagram-image{display:block;max-width:none;max-height:none;background:#fff}.cgp-diagram-viewer{position:fixed;inset:20px;z-index:2147483647;display:flex;flex-direction:column;padding:16px;border:1px solid var(--cgp-border);border-radius:12px;background:var(--cgp-bg);color:var(--cgp-text);box-shadow:var(--cgp-shadow)}.cgp-diagram-expanded{flex:1;min-height:0;overflow:auto}
.cgp-mindmap-expanded{position:fixed;inset:0;z-index:2147483647;overscroll-behavior:contain;display:flex;flex-direction:column;width:100%;height:100%;padding:20px;background:var(--cgp-bg);color:var(--cgp-text)}.cgp-mindmap-expanded .cgp-mindmap-tools{flex-shrink:0}.cgp-mindmap-expanded .cgp-mindmap-canvas{flex:1;min-height:0;max-height:none}.cgp-mindmap-expanded .cgp-mindmap-source{flex-shrink:0;max-height:25vh;overflow:auto}
.cgp-result .cgp-math{display:inline-block;max-width:100%;overflow-x:auto;overflow-y:hidden;vertical-align:middle;padding:.2em 0}.cgp-result .cgp-math-display{display:block}.cgp-result .katex{white-space:nowrap;overflow-wrap:normal;color:inherit}.cgp-result .katex-display{margin:.4em 0}
.cgp-popup-drag-handle,.cgp-drag-handle{cursor:grab;touch-action:none;user-select:none}.cgp-drag-handle{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:25px;height:20px;margin-left:5px;border-left:1px solid var(--cgp-border);color:var(--cgp-muted,#777)}.cgp-drag-handle svg{width:18px;height:18px;pointer-events:none}.cgp-dragging{cursor:grabbing!important}
.cgp-popup-drag-handle{position:absolute;top:calc(50% - 7px);left:50%;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;width:44px;height:28px;color:var(--cgp-muted,#777)}.cgp-popup-drag-handle::before{content:"";width:16px;height:5px;border-top:1px solid currentColor;border-bottom:1px solid currentColor;opacity:.65}.cgp-popup-drag-handle:hover::before{opacity:1}.cgp-popover>.container-yap8B5{padding-top:12px}
.cgp-result strong{font-weight:700}.cgp-result em{font-style:italic}.cgp-result del{text-decoration:line-through}.cgp-result h1,.cgp-result h2,.cgp-result h3,.cgp-result h4,.cgp-result h5,.cgp-result h6{font-weight:650;line-height:1.35;margin:16px 0 8px}.cgp-result h1{font-size:1.5em}.cgp-result h2{font-size:1.3em}.cgp-result h3{font-size:1.15em}.cgp-result h4,.cgp-result h5,.cgp-result h6{font-size:1em}.cgp-result h6{color:var(--cgp-muted)}.cgp-result>:first-child{margin-top:0}.cgp-result ul,.cgp-result ol{margin:8px 0;padding-left:1.7em}.cgp-result ul{list-style:disc}.cgp-result ol{list-style:decimal}.cgp-result li{margin:4px 0}.cgp-result li>p{margin:4px 0}.cgp-result blockquote{border-left:3px solid var(--cgp-border);margin:10px 0;padding:4px 12px;color:var(--cgp-muted)}.cgp-result blockquote p:last-child{margin-bottom:0}.cgp-result code{font-family:Consolas,"SFMono-Regular",monospace;font-size:.92em;border-radius:4px;padding:2px 4px}.cgp-result pre code{font-size:inherit;padding:0;border-radius:0}.cgp-result pre{font-size:12px;line-height:1.5}.cgp-result table{margin:10px 0;max-width:100%;font-size:13px}.cgp-result th{background:var(--cgp-soft);font-weight:650}.cgp-result th:not([align]){text-align:left}.cgp-result td,.cgp-result th{vertical-align:top}.cgp-result hr{border:0;border-top:1px solid var(--cgp-border);margin:14px 0}.cgp-result input[type=checkbox]{margin:0 6px 0 0;accent-color:var(--cgp-brand);vertical-align:middle}
`;

export function createContentController({ document, chrome, initialSettings = DEFAULT_SETTINGS }) {
  const window = document.defaultView;
  const host = document.createElement('div');
  host.id = 'cgp-selection-root'; host.setAttribute('data-cgp-ui', 'true');
  host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  // Dark Reader 4.9.133 shouldManageStyle explicitly skips style.darkreader.
  // Mark only our shadow stylesheet; do not alter page styles or DR settings.
  style.className = 'darkreader cgp-theme-style';
  style.textContent = DOUBAO_STYLES + PATCH_STYLES + THEME_STYLES; shadow.append(style);
  const removeMathStyles = installMathStyles(shadow, chrome.runtime);
  host.dataset.cgpTheme = readPageTheme(document).theme;
  (document.body || document.documentElement).append(host);
  const suppression = createDoubaoSuppression(document);
  let settings = { ...DEFAULT_SETTINGS, ...initialSettings };
  let current = null;
  let toolbar = null;
  let stopToolbarDrag = null;
  let selection = null;
  let retainedRange = null;
  const selectionStyle = document.createElement('style');
  selectionStyle.textContent = '::highlight(cgp-page-selection){background-color:Highlight;color:HighlightText}';
  function clearSelectionHighlight() {
    retainedRange = null;
    window.CSS?.highlights?.delete('cgp-page-selection');
    selectionStyle.remove();
  }
  function retainPageSelection() {
    const selected = window.getSelection();
    if (selected?.rangeCount && !selected.isCollapsed && selected.anchorNode?.getRootNode() === document
      && !selected.getRangeAt(0).intersectsNode(host)) {
      retainedRange = selected.getRangeAt(0).cloneRange();
    }
    // Native text-field focus needs its own caret. A passive page highlight
    // preserves the original range without stealing that caret or keyboard input.
    if (retainedRange && window.CSS?.highlights && window.Highlight) {
      if (!selectionStyle.isConnected) (document.head || document.documentElement).append(selectionStyle);
      window.CSS.highlights.set('cgp-page-selection', new window.Highlight(retainedRange));
    }
  }
  let sidebarOpen = false;
  let sidebarStateVersion = 0;
  let disposed = false;
  const send = async (type, payload = {}) => {
    try { return await chrome.runtime.sendMessage({ channel: 'cgp', type, ...payload }); }
    catch (error) { return { ok: false, error: { code: 'EXTENSION_UNAVAILABLE', message: error.message || '扩展连接已失效，请刷新页面' } }; }
  };
  const enabled = () => settings.enabled && !isExcludedHost(window.location.hostname, settings);
  function applySettings(next) {
    settings = { ...DEFAULT_SETTINGS, ...next };
    suppression.setEnabled(enabled() && settings.suppressDoubao);
    if (!enabled()) { close(); removeToolbar(); selection = null; clearSelectionHighlight(); }
  }
  function removeToolbar() { stopToolbarDrag?.(); stopToolbarDrag = null; toolbar?.remove(); toolbar = null; }
  function moveWithinViewport(element, left, top) {
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(0, Math.min(window.innerWidth - rect.width, left))}px`;
    element.style.top = `${Math.max(0, Math.min(window.innerHeight - rect.height, top))}px`;
  }
  function makeDraggable(element, handle) {
    let drag, suppressClick = false;
    const cancel = () => {
      const previous = drag; drag = null;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
      handle.classList.remove('cgp-dragging');
      if (previous && handle.hasPointerCapture?.(previous.pointerId)) handle.releasePointerCapture(previous.pointerId);
    };
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false || drag) return;
      // Text fields retain native focus/caret behavior; the host capture handler
      // preserves the page selection for all other popup and toolbar surfaces.
      if (handle !== element) event.preventDefault();
      suppressClick = false;
      const rect = element.getBoundingClientRect();
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', end, true);
      document.addEventListener('pointercancel', end, true);
    });
    function move(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      if (!drag.moved) {
        element.style.position = 'fixed'; drag.moved = true; element.dataset.cgpDragged = 'true'; handle.classList.add('cgp-dragging');
        handle.setPointerCapture?.(event.pointerId);
      }
      event.preventDefault();
      moveWithinViewport(element, drag.left + dx, drag.top + dy);
    }
    function end(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      suppressClick = drag.moved && event.type === 'pointerup';
      cancel();
    }
    handle.addEventListener('lostpointercapture', end);
    handle.addEventListener('dragstart', event => { if (drag) event.preventDefault(); });
    handle.addEventListener('click', event => {
      if (!suppressClick) return;
      suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    return cancel;
  }
  function viewportPosition(element, rect, position = 'bottom') {
    const width = element.getBoundingClientRect().width || 420;
    const height = element.getBoundingClientRect().height || 200;
    // Doubao 1.38.0 content.js: ordinary-page selection bars prefer top;
    // l9 centers on the selection, flips at the viewport edge, and uses 5+4px spacing.
    const margin = 20;
    const above = (rect.top ?? rect.bottom) - height - 9;
    const below = rect.bottom + 9;
    const left = Math.max(margin, Math.min(rect.left + (rect.width || 0) / 2 - width / 2, window.innerWidth - width - margin));
    let top = position === 'top' ? above : below;
    if (position === 'top' ? top < 0 : top + height > window.innerHeight) top = position === 'top' ? below : above;
    top = Math.max(0, Math.min(top, window.innerHeight - height - margin));
    element.style.left = `${left + window.scrollX}px`;
    element.style.top = `${top + window.scrollY}px`;
  }
  function showSelection() {
    if (!enabled()) return removeToolbar();
    const value = window.getSelection();
    if (!value || value.isCollapsed || !value.rangeCount || !value.toString().trim()) return removeToolbar();
    const range = value.getRangeAt(0);
    const parent = node => node.nodeType === 1 ? node : node.parentElement;
    if (parent(range.startContainer)?.closest(EXCLUDED) || parent(range.endContainer)?.closest(EXCLUDED)) return removeToolbar();
    const saved = range.cloneRange();
    const text = value.toString().trim();
    selection = { rangeCount: 1, isCollapsed: false, getRangeAt: () => saved, toString: () => text };
    drawToolbar();
    const shown = toolbar, version = sidebarStateVersion;
    send('GET_SIDEPANEL_STATE').then(response => {
      if (!disposed && toolbar === shown && version === sidebarStateVersion) setSidebarOpen(response?.ok && response.open);
    });
  }
  function setSidebarOpen(open) {
    const next = Boolean(open);
    if (sidebarOpen === next) return;
    sidebarOpen = next;
    if (toolbar) drawToolbar(true);
  }
  async function appendSelection() {
    const shown = toolbar, action = shown?.querySelector('[data-action="append-selection"]');
    if (!action || action.disabled) return;
    action.disabled = true; action.textContent = '正在附加…';
    shown.querySelector('[role="status"]')?.remove();
    const response = await send('APPEND_SELECTION');
    if (toolbar !== shown || disposed) return;
    action.disabled = false; action.textContent = response?.ok ? '已附加' : '附加';
    if (!response?.ok) {
      const status = document.createElement('div'); status.setAttribute('role', 'status'); status.className = 'cgp-error';
      status.textContent = response?.error?.message || '附加失败，请重试';
      shown.append(status);
    }
  }
  function placeAt(element, position) {
    element.style.position = position.fixed ? 'fixed' : 'absolute';
    moveWithinViewport(element, position.left - (position.fixed ? 0 : window.scrollX), position.top - (position.fixed ? 0 : window.scrollY));
    if (!position.fixed) {
      element.style.left = `${parseFloat(element.style.left) + window.scrollX}px`;
      element.style.top = `${parseFloat(element.style.top) + window.scrollY}px`;
    }
  }
  function drawToolbar(preservePosition = false, position = null) {
    const saved = selection.getRangeAt(0), text = selection.toString();
    const moved = preservePosition && toolbar?.dataset.cgpDragged === 'true' ? toolbar.getBoundingClientRect() : null;
    removeToolbar();
    toolbar = createSelectionToolbar(document, action => {
      if (action === 'append-selection') { void appendSelection(); return; }
      const rect = toolbar.getBoundingClientRect(), fixed = toolbar.style.position === 'fixed';
      const returnToolbar = { selection, fixed, left: rect.left + (fixed ? 0 : window.scrollX), top: rect.top + (fixed ? 0 : window.scrollY) };
      const scope = action === 'ask' || action === 'explain' ? 'body' : 'nearby';
      try {
        const input = { action, origin: 'selection', ...selectionContext(selection, document, scope), targetLanguage: settings.targetLanguage };
        open(input, saved.getBoundingClientRect?.() || { left: 20, bottom: 20 }, null, returnToolbar);
      } catch (error) { open({ action, origin: 'selection', selectedText: text }, { left: 20, bottom: 20 }, error, returnToolbar); }
    }, sidebarOpen);
    toolbar.classList.add('cgp-anchor'); shadow.append(toolbar);
    viewportPosition(toolbar, saved.getBoundingClientRect?.() || { left: 20, bottom: 20 }, 'top');
    if (position) { placeAt(toolbar, position); if (position.fixed) toolbar.dataset.cgpDragged = 'true'; }
    if (moved) { toolbar.style.position = 'fixed'; toolbar.dataset.cgpDragged = 'true'; moveWithinViewport(toolbar, moved.left, moved.top); }
    stopToolbarDrag = makeDraggable(toolbar, toolbar.querySelector('.cgp-drag-handle'));
  }
  function button(label, onClick, className = 'actionButton-DxGdJm') {
    const element = document.createElement('button'); element.type = 'button'; element.className = className;
    element.textContent = label; element.addEventListener('click', onClick); return element;
  }
  function draw(state) {
    const panel = document.createElement('section'); panel.className = 'cgp-anchor cgp-popover popover-container-aQawvz';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', LABELS[state.input.action] || 'ChatGPT');
    panel.innerHTML = `
      <div class="container-yap8B5">
        <div class="header-container-cL372Q"><div class="cgp-heading"><div class="caption-ElsTYI"></div><div class="cgp-state" role="status" aria-live="polite"></div></div><span class="cgp-popup-drag-handle" role="img" aria-label="拖动浮窗" title="按住把手拖动浮窗"></span><div class="options-node-nfubHU cgp-options"></div></div>
        <div class="cgp-body"><details class="cgp-selected"><summary></summary><div></div><div class="cgp-mode-note cgp-context-note"></div></details><div class="result-YM4GhA cgp-result"></div><div class="cgp-sources"></div><div class="cgp-error" role="alert" hidden></div><div class="cgp-login" hidden></div></div>
        <div class="cgp-footer"><div class="cgp-composer"><div class="cgp-composer-top"><label class="cgp-mode">思考程度 <select aria-label="思考程度"></select></label><div class="cgp-operations"></div></div><form class="cgp-form"><textarea aria-label="问题或追问" rows="1"></textarea><button type="submit" class="cgp-send" aria-label="发送">↑</button></form></div><div class="cgp-mode-note cgp-availability">实际可用档位将在发送前由网页确认</div></div>
      </div>`;
    state.panel = panel;
    const query = selector => panel.querySelector(selector);
    state.query = query;
    const caption = query('.caption-ElsTYI');
    caption.textContent = LABELS[state.input.action] || 'ChatGPT';
    query('summary').textContent = `原文：${state.input.selectedText.slice(0, 70)}`;
    query('details > div').textContent = state.input.selectedText;
    query('.cgp-context-note').textContent = state.input.context ? `背景：${state.input.context.scope}（${state.input.context.text.length} 字符，${state.input.context.truncated ? '已截断' : '未截断'}）` : '未附加网页背景';
    const pin = button('固定', () => {
      const rect = panel.getBoundingClientRect(); state.pinned = !state.pinned;
      panel.style.position = state.pinned ? 'fixed' : 'absolute';
      panel.style.left = `${rect.left + (state.pinned ? 0 : window.scrollX)}px`;
      panel.style.top = `${rect.top + (state.pinned ? 0 : window.scrollY)}px`;
      pin.setAttribute('aria-pressed', String(state.pinned)); pin.title = state.pinned ? '取消固定' : '固定浮窗';
      pin.innerHTML = UI_ICONS[state.pinned ? 'pin-on' : 'pin-off'];
    }, 'options-btn-dUYPEp');
    pin.setAttribute('aria-pressed', 'false');
    pin.setAttribute('aria-label', '固定浮窗'); pin.title = '固定浮窗'; pin.innerHTML = UI_ICONS['pin-off'];
    const closeButton = button('关闭', backToToolbar, 'options-btn-dUYPEp'); closeButton.setAttribute('aria-label', '关闭'); closeButton.title = state.returnToolbar ? '返回悬浮栏' : '关闭'; closeButton.innerHTML = UI_ICONS.close;
    query('.cgp-options').append(pin, closeButton);
    query('.cgp-send').innerHTML = UI_ICONS.send;
    state.copy = button('复制', async () => {
      try { await window.navigator.clipboard.writeText(state.text); state.copy.textContent = '已复制'; }
      catch { errorState(state, { message: '复制失败，请选择回答文本手动复制' }); }
    });
    state.retry = button('重试', () => retry());
    state.stop = button('停止', () => stop());
    query('.cgp-operations').append(state.copy, state.retry, state.stop);
    if(state.input.action==='translate'){query('.cgp-result').setAttribute('role','region');query('.cgp-result').setAttribute('aria-label','译文');}
    if (state.input.action === 'mindmap') {
      state.mindmap = createMindmapResult(document, {onError: error => {if(current === state) errorState(state,error);}});
      query('.cgp-result').after(state.mindmap.element);
    }
    const select = query('select');
    function updateModes(modes, unavailable = []) {
      const previous = state.mode; select.replaceChildren();
      for (const mode of modes) if (MODES[mode]) { const option = document.createElement('option'); option.value = mode; option.textContent = MODES[mode]; select.append(option); }
      for (const item of unavailable) if (MODES[item.mode] && !modes.includes(item.mode)) {
        const option = document.createElement('option'); option.value = item.mode; option.disabled = true;
        option.textContent = `${item.label || MODES[item.mode]}（${item.reason || '当前不可用'}）`; option.title = item.reason || '当前不可用'; select.append(option);
      }
      // Never silently change an unavailable requested mode.
      if (![...select.options].some(option => option.value === previous)) {
        const option = document.createElement('option'); option.value = previous; option.textContent = `${MODES[previous]}（当前不可用）`; option.disabled = true; select.prepend(option);
      }
      select.value = previous;
    }
    state.updateModes = updateModes; updateModes([], [{mode: state.mode, reason: '待网页确认'}]);
    const loadModes = async () => {
      if (state.loadingModes || current !== state || BUSY.has(state.state)) return;
      state.loadingModes = true;
      state.query('.cgp-availability').textContent = '正在读取 ChatGPT 网页实际档位…';
      const response = await send('GET_CAPABILITIES', { sessionId: state.sessionId });
      state.loadingModes = false;
      if (current !== state) return;
      const capabilities = response?.capabilities;
      if (response?.ok && Array.isArray(capabilities?.modes)) {
        state.updateModes(capabilities.modes, capabilities.unavailable);
        state.query('.cgp-availability').textContent = '已由 ChatGPT 网页确认可用档位';
      } else {
        state.query('.cgp-availability').textContent = response?.error?.message || '无法读取可用档位，请重新打开选单重试';
      }
    };
    select.addEventListener('pointerdown', loadModes);
    select.addEventListener('focus', loadModes);
    select.addEventListener('keydown', event => { if (event.key === 'ArrowDown' || event.key === ' ') loadModes(); });
    select.addEventListener('change', async () => {
      if (select.disabled || !MODES[select.value] || select.selectedOptions[0]?.disabled) { select.value = state.mode; return; }
      state.mode = select.value;
      const desiredMode = state.mode;
      const response = await send('UPDATE_SETTINGS', { patch: { manualMode: desiredMode } });
      if (response?.ok && state.mode === desiredMode) settings = { ...settings, ...response.settings };
      else if (current === state && !response?.ok) errorState(state, response?.error || { message: '无法保存思考偏好' });
    });
    const question = query('.cgp-form textarea'); question.placeholder = state.input.action === 'ask' ? '问 ChatGPT…' : '继续追问…';
    query('.cgp-form').addEventListener('submit', event => { event.preventDefault(); submit(question.value.trim()); });
    question.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(question.value.trim()); } });
    state.stopDragging = makeDraggable(panel, query('.cgp-popup-drag-handle'));
    shadow.append(panel);
    if (state.returnToolbar) placeAt(panel, state.returnToolbar);
    else viewportPosition(panel, state.rect);
    update(state);
    if (state.input.action === 'ask') question.focus();
  }
  function update(state) {
    state.panel.dataset.state = state.state;
    state.query('.cgp-state').textContent = state.state === 'draft' ? '输入问题后发送' : STATES[state.state] || state.state;
    const busy = BUSY.has(state.state);
    state.query('.cgp-form textarea').disabled = busy || Boolean(state.pending) || state.sessionUsable === false;
    state.query('.cgp-send').disabled = busy || Boolean(state.pending) || state.sessionUsable === false;
    state.query('select').disabled = (state.input.action !== 'ask' && !state.sessionId) || busy || Boolean(state.pending) || state.sessionUsable === false;
    state.stop.disabled = state.stopRequested || (!busy && !state.pending);
    state.copy.disabled = !state.text;
    state.retry.disabled = busy || Boolean(state.pending) || !state.lastRound;
    state.retry.textContent = state.sessionUsable === false ? '重新开始' : '重试';

  }
  function errorState(state, error) {
    const element = state.query('.cgp-error'); element.hidden = false; element.textContent = error?.message || '任务失败';
    const login = state.query('.cgp-login'); login.replaceChildren();
    const needsLogin = /LOGIN|AUTH|TEMPORARY_UNAVAILABLE/i.test(error?.code || '');
    login.hidden = !needsLogin;
    if (needsLogin) login.append(button('登录 ChatGPT', () => send('OPEN_LOGIN', { sessionId: state.sessionId })));
  }
  function open(input, rect = { left: 20, bottom: 20 }, error, returnToolbar = null) {
    close(); removeToolbar(); selection = null;
    if (!enabled()) return;
    const state = { input: structuredClone(input), rect, returnToolbar, state: 'draft', mode: resolveMode(input, settings), text: '', pinned: false, events: [], round: 0 };
    current = state; draw(state);
    if (error) { state.state = 'failed'; errorState(state, error); update(state); }
    else if (input.action !== 'ask') run(state, { type: 'START_TASK', input: { ...state.input, mode: state.mode } });
    return state;
  }
  async function run(state, round) {
    if (current !== state || state.pending) return;
    const roundId = ++state.round;
    state.lastRound = structuredClone(round); state.pending = true; state.state = 'preparing'; state.stopRequested = false;
    state.requestId = null; state.events = [];
    state.query('.cgp-error').hidden = true; delete state.query('.cgp-error').dataset.cgpDiagnostics;
    state.query('.cgp-login').hidden = true; update(state);
    const { type, ...payload } = round;
    const response = await send(type, payload);
    if (current !== state || state.round !== roundId) {
      if (response?.ok && response.sessionId) {
        await send('CLOSE_SESSION', { sessionId: response.sessionId });
      }
      return;
    }
    state.pending = false;
    if (!response?.ok) {
      state.state = 'failed';
      if (['EXECUTION_LOST', 'INVALID_SESSION', 'SESSION_NOT_STARTED'].includes(response?.error?.code)) state.sessionUsable = false;
      errorState(state, response?.error); update(state); return;
    }
    state.text = ''; state.query('.cgp-result').replaceChildren(); state.query('.cgp-result').hidden=false;
    state.query('.cgp-sources').replaceChildren(); state.mindmap?.reset();
    state.query('.cgp-form textarea').value = '';
    state.sessionId = response.sessionId; state.requestId = response.requestId;
    state.query('.cgp-form textarea').placeholder = '继续追问…';
    if (state.stopRequested) {
      state.events = []; const result = await send('STOP_TASK', { sessionId: state.sessionId }); confirmStop(state, result); return;
    }
    const queued = state.events; state.events = [];
    for (const event of queued) acceptEvent(event);
    update(state);
  }
  async function submit(question) {
    const state = current;
    if (!state || !question || state.pending || BUSY.has(state.state) || state.sessionUsable === false) return;
    if (state.sessionId) return run(state, { type: 'FOLLOW_UP', sessionId: state.sessionId, question, mode: state.mode });
    state.input.question = question;
    return run(state, { type: 'START_TASK', input: { ...state.input, question, mode: state.mode } });
  }
  async function retry() {
    const state = current;
    if (!state?.lastRound || state.pending || BUSY.has(state.state)) return;
    const round = state.sessionUsable === false
      ? { type: 'START_TASK', input: { ...state.input, mode: resolveMode(state.input, settings) } }
      : structuredClone(state.lastRound);
    if (round.type === 'START_TASK' && state.sessionId) {
      const id = state.sessionId; state.sessionId = null;
      state.pending = true; update(state);
      await send('CLOSE_SESSION', { sessionId: id });
      if (current !== state) return;
      state.pending = false;
    }
    state.sessionUsable = true;
    if (round.type === 'START_TASK') state.mode = round.input.mode;
    return run(state, round);
  }
  function confirmStop(state, response) {
    if (current !== state) return;
    if (response?.ok && response.stopped === true) {
      state.state = 'stopped';
      if (response.sessionUsable === false) {
        state.sessionUsable = false;
        errorState(state, { message: '原问题尚未确认发送，请点击“重新开始”。' });
      }
    }
    else {
      state.state = 'interrupted'; state.sessionUsable = false;
      errorState(state, response?.warning || response?.error || {code:'STOP_UNCONFIRMED',message:'无法确认 ChatGPT 已停止。本次会话不能继续，请重新划词发起任务。'});
    }
    update(state);
  }
  async function stop() {
    const state = current; if (!state) return;
    state.stopRequested = true; state.state = 'stopping'; update(state);
    if (!state.sessionId) return;
    const response = await send('STOP_TASK', { sessionId: state.sessionId });
    confirmStop(state, response);
  }
  function backToToolbar() {
    const previous = current?.returnToolbar;
    close();
    if (!previous || !enabled() || !previous.selection.getRangeAt(0).startContainer.isConnected) return;
    selection = previous.selection;
    drawToolbar(false, previous);
  }
  function close() {
    const state = current; current = null;
    state?.stopDragging?.();
    state?.panel.remove();
    state?.mindmap?.dispose();
    if(state){state.panel.querySelectorAll('textarea,input').forEach(element=>{element.value='';});state.panel.replaceChildren();}
    if (state?.sessionId) send('CLOSE_SESSION', { sessionId: state.sessionId });
    if (state) { state.input = null; state.returnToolbar = null; state.lastRound = null; state.events = []; state.text = ''; }
  }
  function acceptEvent(event) {
    const state = current;
    if (!state || event.channel !== 'cgp' || event.type !== 'TASK_EVENT') return false;
    if (state.pending && !state.requestId) { if (state.events.length >= 100) state.events.shift(); state.events.push(event); return true; }
    if (event.sessionId !== state.sessionId || event.requestId !== state.requestId || state.stopRequested) return false;
    state.state = event.state;
    if (event.state === 'interrupted' || ['SESSION_LOST', 'EXECUTION_LOST'].includes(event.error?.code)) state.sessionUsable = false;
    if (typeof event.text === 'string') { state.text = event.text; renderAnswer(state.query('.cgp-result'), state.text); }
    if (event.diagram && !state.mindmap) {
      state.mindmap=createMindmapResult(document,{onError:error=>{if(current===state)errorState(state,error);}});
      state.query('.cgp-result').after(state.mindmap.element);
    }
    if (state.mindmap && event.state === 'completed' && (event.diagram || state.input.action==='mindmap' && (state.lastRound?.type === 'START_TASK' || /```(?:mermaid|text)\b/.test(state.text)))) {
      const round=state.round;
      state.rendering = state.mindmap.update(state.text,event.diagram).then(success=>{if(current===state && state.round===round)state.query('.cgp-result').hidden=success && !event.diagram;});
    }
    if (event.sources) renderSources(state.query('.cgp-sources'), event.sources);
    if (event.mode && MODES[event.mode]) { state.mode = event.mode; state.query('select').value = event.mode; }
    const modes = event.capabilities?.modes;
    if (Array.isArray(modes)) { state.updateModes(modes, event.capabilities?.unavailable); state.query('.cgp-availability').textContent = '已由 ChatGPT 网页确认可用档位'; }
    const diagnostics = event.diagnostics || event.error?.diagnostics;
    if (diagnostics) state.query('.cgp-error').dataset.cgpDiagnostics = JSON.stringify(diagnostics);
    if (event.error) {
      errorState(state, event.error);
    }
    update(state); return true;
  }
  function handleMessage(message) {
    if (message?.channel !== 'cgp') return null;
    switch (message.type) {
      case 'TASK_EVENT': acceptEvent(message); return { ok: true };
      case 'SETTINGS_CHANGED': applySettings(message.settings); return { ok: true };
      case 'SIDEPANEL_STATE_CHANGED': ++sidebarStateVersion; setSidebarOpen(message.open); return { ok: true };
      case 'GET_PAGE_THEME': return {ok:true,...readPageTheme(document)};
      case 'EXTRACT_PAGE': try { return { ok: true, material: extractMaterial(document) }; } catch (error) { return { ok: false, error: { code: error.code, message: error.message } }; }
      case 'EXTRACT_SELECTION': try { return { ok: true, ...selectionContext(window.getSelection(), document, 'none') }; } catch (error) { return { ok: false, error: { code: error.code, message: error.message } }; }
      default: return null;
    }
  }
  const pointerDown = event => {
    const path = event.composedPath();
    if (path.includes(host)) {
      retainPageSelection();
      if (event.button === 0 && !path.some(node => node.matches?.('input,textarea,select,[contenteditable],.cgp-result'))) event.preventDefault();
    } else {
      if (toolbar || current || retainedRange) window.getSelection()?.removeAllRanges();
      selection = null;
      clearSelectionHighlight(); removeToolbar(); if (current && !current.pinned) close();
    }
  };
  const pointerUp = event => { if (!event.composedPath().includes(host)) showSelection(); };
  const keyUp = event => { if (!event.composedPath().includes(host) && event.key.startsWith('Arrow')) showSelection(); };
  const keyDown = event => { if (event.key === 'Escape') { close(); removeToolbar(); selection = null; clearSelectionHighlight(); } };
  document.addEventListener('pointerdown', pointerDown, true); document.addEventListener('pointerup', pointerUp);
  document.addEventListener('keyup', keyUp); document.addEventListener('keydown', keyDown);
  const unload = () => close(); window.addEventListener('pagehide', unload);
  const stopObservingTheme = observePageTheme(document, theme => {
    host.dataset.cgpTheme = theme.theme;
    send('PAGE_THEME_CHANGED', theme);
  });
  applySettings(settings);
  return {
    host, shadow, open, submit, retry, stop, close, acceptEvent, handleMessage, showSelection,
    get state() { return current; },
    async init() { const response = await send('GET_SETTINGS'); if (!disposed && response?.ok) applySettings(response.settings); },
    dispose() {
      disposed = true; stopObservingTheme(); close(); removeToolbar(); selection = null; clearSelectionHighlight(); suppression.dispose(); removeMathStyles(); host.remove();
      document.removeEventListener('pointerdown', pointerDown, true); document.removeEventListener('pointerup', pointerUp);
      document.removeEventListener('keyup', keyUp); document.removeEventListener('keydown', keyDown); window.removeEventListener('pagehide', unload);
    },
  };
}
