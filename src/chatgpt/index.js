import { ChatGPTAdapter, AdapterError } from './adapter.js';
import { installSidebarAttachment } from './sidebar-attachment.js';

// Tasks stay on extension runtime/Ports. A bound extension parent may only
// request reconnection after its background worker has restarted.
export function installAdapter(document, runtime) {
  let port = null, disposed = false, bound = false, previousTheme = null, ownThemeLock = null;
  let desiredTheme = null, themeObserver = null;
  let sidebarFrame = false;
  let sidebarAttachment;
  const adapter = new ChatGPTAdapter(document, { emit: event => {
    if (disposed) return;
    if (port) { try { port.postMessage(event); return; } catch { port = null; } }
    Promise.resolve(runtime.sendMessage(event)).catch(() => {});
  } });
  let token = new URLSearchParams(document.location.hash.slice(1)).get('cgp-frame');
  const root = document.documentElement;
  const applyTheme = () => {
    if (!desiredTheme) return;
    // Native hydration and route changes can reapply the account's light theme.
    // Write only differences so our observer does not trigger a mutation loop.
    for (const name of ['data-theme', 'data-appearance-theme']) {
      if (root.getAttribute(name) !== desiredTheme) root.setAttribute(name, desiredTheme);
    }
    const opposite = desiredTheme === 'dark' ? 'light' : 'dark';
    if (root.classList.contains(opposite)) root.classList.remove(opposite);
    if (!root.classList.contains(desiredTheme)) root.classList.add(desiredTheme);
    if (root.style.colorScheme !== desiredTheme) root.style.colorScheme = desiredTheme;
  };
  const restoreTheme = () => {
    themeObserver?.disconnect(); themeObserver = null; desiredTheme = null;
    if (!previousTheme) return;
    for (const [name, value] of previousTheme.attributes) {
      if (value === null) root.removeAttribute(name); else root.setAttribute(name, value);
    }
    root.classList.toggle('dark', previousTheme.dark); root.classList.toggle('light', previousTheme.light);
    root.style.colorScheme = previousTheme.colorScheme;
    ownThemeLock?.remove(); ownThemeLock = null; previousTheme = null;
  };
  const handle = async (message, fromPort = false) => {
    if (message?.channel !== 'cgp') return undefined;
    try {
      switch (message.type) {
        case 'ADAPTER_PROBE': return { ok: true, state: adapter.probe() };
        case 'ADAPTER_CAPABILITIES': return await adapter.discoverCapabilities();
        case 'ADAPTER_SIDEBAR_INPUT': {
          if (!fromPort || !bound || !token || document.defaultView.top === document.defaultView) return { ok: false, error: { code: 'INVALID_FRAME', message: '只能操作已绑定的侧栏输入框。' } };
          return await adapter.sidebarInput(message);
        }
        case 'ADAPTER_SIDEPANEL_CONTROLS': {
          if (!fromPort || !bound || !sidebarFrame) return { ok: false, error: { code: 'INVALID_FRAME', message: '只有已绑定的侧栏可设置附加按钮。' } };
          sidebarAttachment?.setEnabled(message.enabled);
          return { ok: true };
        }
        case 'ADAPTER_RUN': return adapter.start(message);
        case 'ADAPTER_STOP': return await adapter.stop(message);
        case 'ADAPTER_DISPOSE': return await adapter.dispose(message);
        case 'ADAPTER_THEME': {
          if (!fromPort || !bound || !token || document.defaultView.top === document.defaultView) return { ok: false, error: { code: 'THEME_CONTEXT_INVALID', message: '主题仅作用于已绑定的侧栏 ChatGPT iframe。' } };
          if (!['dark', 'light'].includes(message.theme)) return { ok: false, error: { code: 'INVALID_THEME', message: '主题必须为 dark 或 light。' } };
          previousTheme ||= { attributes: ['data-theme', 'data-appearance-theme'].map(name => [name, root.getAttribute(name)]), dark: root.classList.contains('dark'), light: root.classList.contains('light'), colorScheme: root.style.colorScheme };
          if (!document.querySelector('meta[name="darkreader-lock"]')) {
            ownThemeLock = document.createElement('meta'); ownThemeLock.name = 'darkreader-lock'; document.head.append(ownThemeLock);
          }
          desiredTheme = message.theme;
          if (!themeObserver) {
            themeObserver = new document.defaultView.MutationObserver(applyTheme);
            themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-appearance-theme', 'class', 'style'] });
          }
          applyTheme();
          return { ok: true };
        }
        default: return undefined;
      }
    } catch (error) {
      return { ok: false, error: { code: error instanceof AdapterError ? error.code : 'ADAPTER_FAILURE', message: error.message } };
    }
  };
  const runtimeListener = (message, sender, respond) => {
    // Same extension runtime only. Background further validates tab/frame and
    // exact request identity; a website cannot invoke this listener directly.
    if (sender?.id && sender.id !== runtime.id) return false;
    if (message?.channel !== 'cgp' || !message.type?.startsWith('ADAPTER_')) return false;
    handle(message).then(result => respond(result));
    return true;
  };
  runtime.onMessage.addListener(runtimeListener);
  function connectFrame() {
    if (disposed || port || !token) return;
    try {
      const connection = runtime.connect({ name: 'cgp-adapter' });
      port = connection;
      connection.onMessage.addListener(async message => {
        if (port !== connection || message?.channel !== 'cgp') return;
        if (message.type === 'FRAME_BOUND') {
          bound = message.ok === true; sidebarFrame = bound && message.hostType === 'sidepanel' && Boolean(token) && document.defaultView.top !== document.defaultView;
          if (sidebarFrame && !sidebarAttachment) sidebarAttachment = installSidebarAttachment(document, () => {
            if (!bound || !port) return;
            try { port.postMessage({ channel: 'cgp', type: 'SIDEPANEL_ATTACH_CURRENT_PAGE' }); }
            catch { bound = false; port = null; sidebarAttachment.setEnabled(false); }
          });
          if (!sidebarFrame) { sidebarAttachment?.dispose(); sidebarAttachment = null; }
          return;
        }
        if (typeof message?.rpcId !== 'string') return;
        const result = await handle(message, true);
        if (result && port === connection) connection.postMessage({ channel: 'cgp', type: 'PORT_RESPONSE', rpcId: message.rpcId, result });
      });
      connection.onDisconnect.addListener(() => {
        if (port !== connection) return;
        port = null; bound = false;
        sidebarAttachment?.setEnabled(false);
        // A sidebar keeps the same native conversation while its coordinator
        // sleeps/restarts. Retain its theme until the frame itself is disposed.
        if (!sidebarFrame) restoreTheme();
        // Loss of coordination ends observation and attempts only our own stop.
        if (adapter.active) adapter.dispose({ sessionId: adapter.active.sessionId });
      });
      connection.postMessage({ channel: 'cgp', type: 'FRAME_READY', token });
    } catch { port = null; }
  }
  const reconnect = event => {
    if (disposed || document.defaultView.parent === document.defaultView
      || event.source !== document.defaultView.parent || event.origin !== `chrome-extension://${runtime.id}`
      || event.data?.type !== 'CGP_REBIND') return;
    if (!token) {
      // A real navigation can drop the hash. Only our verified extension parent
      // may restore the identity; background still checks its registered owner.
      if (!event.isTrusted || typeof event.data.token !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(event.data.token)) return;
      token = event.data.token;
    }
    if (event.data.token !== token) return;
    // A frozen renderer can miss the old Port's disconnect notification.
    // Probe it before treating its presence as a live connection.
    if (port) {
      try { port.postMessage({ channel: 'cgp', type: 'FRAME_READY', token }); return; }
      catch { port = null; bound = false; sidebarAttachment?.setEnabled(false); }
    }
    connectFrame();
  };
  document.defaultView.addEventListener('message', reconnect);
  if (token) connectFrame();
  else Promise.resolve(runtime.sendMessage({ channel: 'cgp', type: 'FRAME_READY' })).catch(() => {});
  const onPageHide = () => {
    disposed = true;
    sidebarAttachment?.dispose(); sidebarAttachment = null;
    restoreTheme(); bound = false;
    if (adapter.active) adapter.dispose({ sessionId: adapter.active.sessionId });
    runtime.onMessage.removeListener?.(runtimeListener);
    document.defaultView.removeEventListener('message', reconnect);
    port?.disconnect(); port = null;
  };
  document.defaultView.addEventListener('pagehide', onPageHide, { once: true });
  return { adapter, handle, dispose: onPageHide };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof document !== 'undefined') installAdapter(document, chrome.runtime);
