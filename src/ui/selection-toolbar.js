// DOM structure and classes migrated from Doubao 1.38.0 select-bar module.
// Business callbacks replace React/Zustand/remote-skill/telemetry dependencies.
import { UI_ICONS } from './neutral-icons.js';
export const SELECTION_ACTIONS = [
  ['ask', '问AI'], ['translate', '翻译'], ['explain', '解释'],
  ['summarize', '总结'], ['search', 'AI 搜索'], ['mindmap', '脑图'],
];

export function createSelectionToolbar(document, onAction, sidebarOpen = false) {
  const root = document.createElement('div');
  root.className = 'rootContainer-YnW249';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', '选中文字操作');
  const content = document.createElement('div');
  content.className = 'contentContainer-K4iWxu';
  const row = document.createElement('div');
  row.className = 'container-XupkMZ';
  const grip = document.createElement('span');
  grip.className = 'cgp-drag-handle';
  grip.setAttribute('role', 'img'); grip.setAttribute('aria-label', '拖动悬浮栏');
  grip.title = '按住拖动悬浮栏'; grip.innerHTML = UI_ICONS.drag;
  const actions = document.createElement('div');
  actions.className = 'actions-pdxL43';
  const available = sidebarOpen ? [...SELECTION_ACTIONS, ['append-selection', '附加']] : SELECTION_ACTIONS;
  for (const [action, label] of available) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btnArea-GIIUrK';
    button.dataset.action = action;
    button.textContent = label;
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', () => onAction(action));
    actions.append(button);
  }
  row.append(actions, grip);
  content.append(row);
  root.append(content);
  return root;
}
