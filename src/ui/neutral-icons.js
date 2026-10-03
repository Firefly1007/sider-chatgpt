// Original neutral line icons drawn for this extension; no third-party logo/path.
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const UI_ICONS = Object.freeze({
  drag: svg('<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3"/>'),
  'pin-off': svg('<path d="M8 4h8l-1 7 3 3H6l3-3-1-7M12 14v6"/>'),
  'pin-on': svg('<path d="M8 4h8l-1 7 3 3H6l3-3-1-7M12 14v6"/><path d="m18 5 2 2 3-3"/>'),
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  send: svg('<path d="M12 19V5m-6 6 6-6 6 6"/>'),
});
