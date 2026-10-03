import { DEFAULT_SETTINGS, validateSettings, resolveMode } from '../shared/settings.js';
import { buildPrompt } from '../features/prompts.js';
import { createSessionManager } from './session-manager.js';

const manager = createSessionManager(chrome, { defaultSettings: DEFAULT_SETTINGS, validateSettings, resolveMode, buildPrompt });
manager.initialized.catch((error) => console.error('ChatGPT extension initialization failed:', error.message));
const prewarm = () => manager.prewarm().catch((error) => console.error('ChatGPT prewarm failed:', error.message));
chrome.runtime.onStartup.addListener(prewarm);
chrome.runtime.onInstalled.addListener(prewarm);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.channel !== 'cgp' || message.target === 'offscreen') return false;
  manager.handle(message, sender).then(reply);
  return true;
});
chrome.runtime.onConnect.addListener(manager.connect);
chrome.tabs.onRemoved.addListener(manager.tabRemoved);
chrome.tabs.onUpdated.addListener(manager.tabUpdated);
chrome.webNavigation.onCommitted.addListener(manager.navigationCommitted);
chrome.sidePanel.onOpened?.addListener(manager.panelOpened);
chrome.sidePanel.onClosed?.addListener(manager.panelClosed);
chrome.action.onClicked.addListener((tab) => {
  if (Number.isInteger(tab.windowId) && tab.windowId >= 0) chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => console.error(error.message));
});
