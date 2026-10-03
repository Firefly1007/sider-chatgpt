import { rebindChatGPTFrame } from '../shared/frame-rebind.js';

export function installOffscreen(document, runtime) {
  const frames = new Map();
  let port;
  let disposed = false;
  let heartbeat;
  const stopHeartbeat = () => {
    if (heartbeat !== undefined) document.defaultView.clearInterval(heartbeat);
    heartbeat = undefined;
  };
  function updateHeartbeat() {
    // An open Port alone does not keep MV3 alive during a quiet native reply.
    // Keep coordination only while a claimed conversation is still owned.
    if (disposed || !port || ![...frames.values()].some(record => record.used)) { stopHeartbeat(); return; }
    if (heartbeat !== undefined) return;
    heartbeat = document.defaultView.setInterval(() => {
      if (disposed || !port) { stopHeartbeat(); return; }
      try { port.postMessage({ channel: 'cgp', type: 'OFFSCREEN_KEEPALIVE' }); }
      catch { stopHeartbeat(); }
    }, 20000);
  }
  function command(message) {
    if (message.type === 'OFFSCREEN_SYNC') {
      let unused;
      for (const [token, record] of frames) {
        if (record.used || unused) { record.frame.remove(); frames.delete(token); }
        else unused = token;
      }
      return { ok: true, frames: unused ? [{ token: unused }] : [] };
    }
    const token = message.token;
    if (typeof token !== 'string' || !token.trim()) return { ok: false, error: { code: 'INVALID_TOKEN', message: 'Offscreen frame token is required.' } };
    if (message.type === 'OFFSCREEN_CREATE') {
      if (!frames.has(token)) {
        const frame = document.createElement('iframe');
        frame.dataset.cgpToken = token;
        frame.width = '1280'; frame.height = '900';
        Object.assign(frame.style, { position: 'absolute', top: '0', left: '0', width: '1280px', height: '900px', border: '0' });
        frame.src = `https://chatgpt.com/?temporary-chat=true#cgp-frame=${encodeURIComponent(token)}`;
        frames.set(token, { frame, used: false });
        document.body.append(frame);
      }
      return { ok: true };
    }
    const record = frames.get(token);
    if (!record) return { ok: false, error: { code: 'UNKNOWN_TOKEN', message: 'Offscreen frame token is not registered.' } };
    if (message.type === 'OFFSCREEN_CLAIM') record.used = true;
    else if (message.type === 'OFFSCREEN_REMOVE') { record.frame.remove(); frames.delete(token); }
    else if (message.type === 'OFFSCREEN_REBIND') rebindChatGPTFrame(record.frame, token);
    else return { ok: false, error: { code: 'INVALID_COMMAND', message: 'Unsupported offscreen host command.' } };
    return { ok: true };
  }
  function connect() {
    const previous = port;
    const connection = runtime.connect({ name: 'cgp-offscreen-host' });
    port = connection;
    previous?.disconnect();
    connection.onMessage.addListener((message) => {
      if (disposed || port !== connection || message?.channel !== 'cgp' || typeof message.rpcId !== 'string' || !message.rpcId) return;
      let result;
      try { result = command(message); }
      catch (error) { result = { ok: false, error: { code: 'OFFSCREEN_HOST_FAILED', message: error.message } }; }
      updateHeartbeat();
      if (port === connection) connection.postMessage({ channel: 'cgp', type: 'PORT_RESPONSE', rpcId: message.rpcId, result });
    });
    connection.onDisconnect.addListener(() => { if (port === connection) { port = null; stopHeartbeat(); } });
    updateHeartbeat();
  }
  function reconnect(message, sender, reply) {
    if (disposed || sender?.id !== runtime.id || message?.channel !== 'cgp' || message.target !== 'offscreen' || message.type !== 'OFFSCREEN_CONNECT') return false;
    connect(); reply?.({ ok: true }); return false;
  }
  runtime.onMessage.addListener(reconnect);
  connect();
  return () => {
    disposed = true; runtime.onMessage.removeListener(reconnect);
    stopHeartbeat();
    port?.disconnect(); port = null;
    for (const { frame } of frames.values()) frame.remove();
    frames.clear();
  };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof document !== 'undefined') installOffscreen(document, chrome.runtime);
