import { createContentController } from './controller.js';

if (['http:', 'https:'].includes(location.protocol) && location.hostname !== 'chatgpt.com' && !document.getElementById('cgp-selection-root')) {
  const controller = createContentController({ document, chrome });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    const result = controller.handleMessage(message);
    if (result !== null) respond(result);
    return false;
  });
  controller.init();
}
