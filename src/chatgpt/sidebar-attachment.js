import { findComposer, isVisible } from './adapter.js';

// This control belongs to the native composer; it is never positioned against
// the browser viewport. Only the bound sidebar adapter installs it.
export function installSidebarAttachment(document, onAttach) {
  const host = document.createElement('span');
  host.setAttribute('data-cgp-attach-page-host', '');
  host.style.cssText = 'display:inline-flex;position:relative;vertical-align:middle;flex:0 0 auto;margin-left:2px;color:inherit';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{font:inherit}button{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:7px;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;box-sizing:border-box}
    button:hover:not(:disabled){background:light-dark(#0000000d,#ffffff1a)}button:focus-visible{outline:2px solid #5b9bff;outline-offset:1px}button:disabled{opacity:.4;cursor:default}
    svg{width:22px;height:22px;pointer-events:none} [role=tooltip]{display:none;position:absolute;bottom:calc(100% + 8px);left:0;padding:6px 9px;border:1px solid light-dark(#ddd,#555);border-radius:7px;background:light-dark(#fff,#303030);color:inherit;font:12px/1.5 system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 8px #0002;z-index:100;pointer-events:none}
    button:hover+[role=tooltip],button:focus-visible+[role=tooltip]{display:block}
  </style><button type="button" data-cgp-attach-page title="附加当前网页" aria-label="附加当前网页" aria-describedby="attach-page-tip" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg></button><span id="attach-page-tip" role="tooltip">附加当前网页</span>`;
  const button = shadow.querySelector('button');
  let enabled = false;
  button.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    if (!enabled || button.disabled) return;
    // Lock immediately, before the Port round trip updates the shared state.
    button.disabled = true;
    onAttach();
  });
  function mount() {
    const composer = findComposer(document);
    const scope = composer?.closest('form') || composer?.closest('[data-testid="composer"]');
    const plus = scope && [...scope.querySelectorAll('button#composer-plus-btn, button[data-testid="composer-plus-btn"], button[data-testid="composer-tools-button"], button[aria-label="添加文件等内容"], button[aria-label="Add files and more"]')].find(isVisible);
    if (!plus) { host.remove(); return; }
    if (plus.nextSibling !== host) plus.after(host);
  }
  const observer = new document.defaultView.MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mount();
  return {
    setEnabled(value) { enabled = value === true; button.disabled = !enabled; },
    dispose() { observer.disconnect(); host.remove(); },
  };
}
