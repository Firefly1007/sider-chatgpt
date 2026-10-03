export function rebindChatGPTFrame(frame, token) {
  const target = frame?.contentWindow;
  if (!target) return false;
  try {
    // Setting src does not immediately replace the initial about:blank
    // document, which still inherits this extension's origin.
    if (target.location.origin !== 'https://chatgpt.com') return false;
  } catch (error) {
    // The loaded ChatGPT document is cross-origin. Keep the exact recipient
    // origin below; never use a wildcard to get past an origin mismatch.
    if (error.name !== 'SecurityError') throw error;
  }
  target.postMessage({ type: 'CGP_REBIND', token }, 'https://chatgpt.com');
  return true;
}
