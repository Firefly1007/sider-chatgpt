import { rebindChatGPTFrame } from '../shared/frame-rebind.js';

export function createSidepanel(document, chrome, dependencies = {}) {
  const get = (id) => document.getElementById(id);
  const pending = new Map();
  const removers = [];
  let disposed = false;
  let enabled = false;
  let busy = false;
  let port;
  let heartbeat;
  let frameToken;
  let frameReady = false;
  let connecting;
  let reconnectTimer;
  let frameRetryTimer;
  let reconnectAttempts = 0;
  let settingsKnown = false;
  let themeRequest = 0;
  const rpc = dependencies.rpc || ((type, payload = {}) => new Promise((resolve, reject) => {
    if (disposed || !port) {
      reject(Object.assign(new Error('侧栏连接正在恢复，请稍后再试'), { code: 'SIDEPANEL_DISCONNECTED' }));
      return;
    }
    const rpcId = document.defaultView.crypto.randomUUID();
    pending.set(rpcId, { resolve, reject });
    const connection = port;
    try { connection.postMessage({ channel: 'cgp', type, ...payload, rpcId }); }
    catch (error) {
      pending.delete(rpcId); reject(error);
      if (port === connection) disconnect();
    }
  }));
  const currentTab = dependencies.currentTab || (async () => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs.find((item) => Number.isInteger(item.id) && /^https?:\/\//u.test(item.url || '') && !/^https:\/\/chatgpt\.com(?:\/|$)/u.test(item.url));
    if (!tab) throw new Error('请先打开要处理的普通网页');
    return tab;
  });
  const systemTheme = document.defaultView.matchMedia?.('(prefers-color-scheme: dark)');
  document.documentElement.dataset.cgpTheme = systemTheme?.matches ? 'dark' : 'light';

  function status(message = '') {
    const element = get('panel-status');
    element.textContent = message;
    element.hidden = !message;
  }
  function updateButtons() {
    if (!disposed && port && frameReady) void rpc('SET_SIDEPANEL_CONTROLS', { enabled: enabled && !busy }).catch(() => {});
  }
  function rejectPending(error) {
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
  }
  function stopHeartbeat() {
    if (heartbeat !== undefined) document.defaultView.clearInterval(heartbeat);
    heartbeat = undefined;
  }
  function clearReconnectTimer() {
    if (reconnectTimer !== undefined) document.defaultView.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  function clearFrameRetry() {
    if (frameRetryTimer !== undefined) document.defaultView.clearTimeout(frameRetryTimer);
    frameRetryTimer = undefined;
  }
  function rebindFrame() {
    clearFrameRetry();
    if (disposed || !enabled || !port || !frameToken || frameReady) return;
    rebindChatGPTFrame(get('cgp-chatgpt-frame'), frameToken);
    // The iframe may resume after its parent and deliver its old Port's
    // disconnect later. Retry the handshake, never the user's operation.
    frameRetryTimer = document.defaultView.setTimeout(rebindFrame, 1000);
  }
  function scheduleReconnect() {
    if (disposed || port || reconnectTimer !== undefined || settingsKnown && !enabled) return;
    reconnectTimer = document.defaultView.setTimeout(() => {
      reconnectTimer = undefined; void reconnect();
    }, Math.min(1000 * 2 ** Math.min(reconnectAttempts++, 5), 30000));
  }
  function updateHeartbeat() {
    if (disposed || !enabled || !port) { stopHeartbeat(); return; }
    if (heartbeat !== undefined) return;
    // An open Port alone does not keep MV3 coordination alive while the user
    // reads or chats directly in the embedded page. Only the mounted sidebar
    // needs this lease; the unused hidden prewarm still permits worker sleep.
    heartbeat = document.defaultView.setInterval(() => {
      if (disposed || !enabled || !port) { stopHeartbeat(); return; }
      try { port.postMessage({ channel: 'cgp', type: 'SIDEPANEL_KEEPALIVE' }); }
      catch { disconnect(); }
    }, 20000);
  }
  function applySettings(settings) {
    enabled = settings?.enabled !== false;
    settingsKnown = true;
    if (!enabled) { clearReconnectTimer(); clearFrameRetry(); }
    updateHeartbeat();
    updateButtons();
    if (!enabled) status('扩展已关闭；可从设置中重新启用');
  }
  function receive(message) {
    if (disposed || !port) return;
    if (message?.channel === 'cgp' && message.type === 'PORT_RESPONSE') {
      const waiting = pending.get(message.rpcId);
      if (!waiting) return;
      pending.delete(message.rpcId);
      if (message.result?.ok) waiting.resolve(message.result);
      else waiting.reject(Object.assign(new Error(message.result?.error?.message || '扩展后台未响应'), { code: message.result?.error?.code }));
      return;
    }
    if (message?.channel === 'cgp' && message.type === 'SETTINGS_CHANGED') applySettings(message.settings);
    if (message?.channel === 'cgp' && message.type === 'SIDEPANEL_ATTACH_CURRENT_PAGE') void runAction('ATTACH_CURRENT_PAGE');
    if (message?.channel === 'cgp' && message.type === 'SIDEPANEL_FRAME_BOUND') {
      frameReady = true; reconnectAttempts = 0; clearFrameRetry(); updateButtons();
      if (get('panel-status').textContent === '侧栏连接正在恢复…') status();
      void refreshTheme();
    }
    if (message?.channel === 'cgp' && message.type === 'SIDEPANEL_FRAME_LOST') {
      frameReady = false; updateButtons(); status('侧栏连接正在恢复…'); rebindFrame();
    }
  }
  function disconnect() {
    stopHeartbeat();
    clearFrameRetry();
    port = null;
    frameReady = false;
    rejectPending(Object.assign(new Error('侧栏连接曾中断，本次操作结果未确认，未重复提交'), { code: 'SIDEPANEL_DISCONNECTED' }));
    if (!disposed) { updateButtons(); status(enabled ? '侧栏连接正在恢复…' : '扩展已关闭；可从设置中重新启用'); scheduleReconnect(); }
  }

  async function refreshTheme() {
    const request = ++themeRequest;
    let theme = systemTheme?.matches ? 'dark' : 'light';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        const result = await chrome.tabs.sendMessage(tab.id, { channel: 'cgp', type: 'GET_PAGE_THEME' }, { frameId: 0 });
        if (result?.ok && ['dark', 'light'].includes(result.theme)) theme = result.theme;
      }
    } catch { /* Restricted pages follow the system preference. */ }
    if (disposed || request !== themeRequest) return;
    document.documentElement.dataset.cgpTheme = theme;
    try { await rpc('SET_SIDEPANEL_THEME', { theme }); } catch { /* The frame will receive the next theme update when available. */ }
  }
  const pageThemeChanged = (message, sender) => {
    if (message?.channel === 'cgp' && message.type === 'PAGE_THEME_CHANGED' && sender?.tab?.id !== undefined) void refreshTheme();
  };
  chrome.runtime.onMessage?.addListener(pageThemeChanged);
  chrome.tabs?.onActivated?.addListener(refreshTheme);
  chrome.tabs?.onUpdated?.addListener(refreshTheme);
  systemTheme?.addEventListener('change', refreshTheme);
  removers.push(() => {
    chrome.runtime.onMessage?.removeListener(pageThemeChanged);
    chrome.tabs?.onActivated?.removeListener(refreshTheme);
    chrome.tabs?.onUpdated?.removeListener(refreshTheme);
    systemTheme?.removeEventListener('change', refreshTheme);
  });

  async function runAction(type) {
    if (disposed || !enabled || busy || !port || !frameReady) return;
    busy = true;
    updateButtons();
    status();
    try {
      const tab = await currentTab();
      if (!Number.isInteger(tab?.id)) throw new Error('找不到当前网页');
      await rpc(type, { tabId: tab.id });
    } catch (error) {
      if (!disposed) status(error?.message || '操作失败');
    } finally {
      busy = false;
      updateButtons();
    }
  }

  async function initialize() {
    let connection;
    try {
      connection = chrome.runtime.connect({ name: 'cgp-sidepanel-host' });
      port = connection;
      connection.onMessage.addListener(message => { if (port === connection) receive(message); });
      connection.onDisconnect.addListener(() => { if (port === connection) disconnect(); });
      const { id: windowId } = await chrome.windows.getCurrent();
      if (disposed || port !== connection) return;
      const ready = await rpc('SIDEPANEL_READY', { windowId, ...(frameToken ? { token: frameToken } : {}) });
      if (disposed || port !== connection) return;
      if (!ready.token || !/^[a-zA-Z0-9-]{16,100}$/u.test(ready.token)) throw new Error('侧栏连接身份无效');
      if (frameToken && ready.token !== frameToken) throw new Error('侧栏连接身份发生变化，未刷新原会话');
      frameReady ||= Boolean(ready.frameReady);
      if (!frameToken) {
        frameToken = ready.token;
        get('cgp-chatgpt-frame').src = `https://chatgpt.com/#cgp-frame=${encodeURIComponent(frameToken)}`;
      }
      const settingsResponse = await rpc('GET_SETTINGS');
      if (disposed || port !== connection) return;
      applySettings(settingsResponse.settings);
      rebindFrame();
      await refreshTheme();
    } catch (error) {
      if (!disposed && (!connection || port === connection)) {
        status(error.message);
        if (port === connection) { disconnect(); connection?.disconnect(); }
      }
    }
  }
  function reconnect() {
    if (disposed || port || connecting) return connecting || Promise.resolve();
    clearReconnectTimer();
    const attempt = initialize();
    connecting = attempt;
    attempt.finally(() => {
      if (connecting === attempt) connecting = null;
      if (!disposed && !port) scheduleReconnect();
    });
    return attempt;
  }
  const resume = () => {
    if (disposed) return;
    // A resumed renderer can observe the stale Port before its disconnect
    // callback is delivered. Probe it immediately instead of waiting for a timer.
    if (port && enabled) {
      try { port.postMessage({channel:'cgp',type:'SIDEPANEL_KEEPALIVE'}); }
      catch { disconnect(); }
    }
    if (!port) void reconnect(); else rebindFrame();
  };
  const visibility = () => { if (!document.hidden) resume(); };
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('resume', resume);
  document.defaultView.addEventListener('focus', resume);
  document.defaultView.addEventListener('pageshow', resume);
  get('cgp-chatgpt-frame').addEventListener('load', rebindFrame);
  removers.push(() => {
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('resume', resume);
    document.defaultView.removeEventListener('focus', resume);
    document.defaultView.removeEventListener('pageshow', resume);
    get('cgp-chatgpt-frame').removeEventListener('load', rebindFrame);
  });
  updateButtons();
  const ready = reconnect();
  return {
    ready,
    dispose() {
      disposed = true;
      stopHeartbeat();
      clearReconnectTimer(); clearFrameRetry();
      ++themeRequest;
      removers.forEach((remove) => remove());
      const connection = port;
      port = null;
      rejectPending(Object.assign(new Error('侧栏已关闭'), { code: 'SIDEPANEL_DISCONNECTED' }));
      connection?.disconnect();
    },
  };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof document !== 'undefined' && document.getElementById('cgp-chatgpt-frame')) {
  const panel = createSidepanel(document, chrome);
  window.addEventListener('pagehide', () => panel.dispose(), { once: true });
}
