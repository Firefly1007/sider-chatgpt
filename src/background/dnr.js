export const FRAME_RULE_ID = 74001;

// Chrome does not match extension-initiated subframes against an
// initiatorDomains condition, so a rule scoped that way never fires for the
// offscreen host and the hidden ChatGPT frame stays ERR_BLOCKED_BY_RESPONSE.
// Scope by the ChatGPT URL and the sub_frame type instead: only this
// extension's own pages embed that origin, and an ordinary webpage embedding
// chatgpt.com keeps its own blocking headers.
export function frameRule() {
  return {
    id: FRAME_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'content-security-policy', operation: 'remove' },
        { header: 'x-frame-options', operation: 'remove' },
      ],
    },
    condition: {
      regexFilter: '^https://chatgpt\\.com/',
      resourceTypes: ['sub_frame'],
    },
  };
}

export async function configureFrameRule(chrome, enabled) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [FRAME_RULE_ID],
    addRules: enabled ? [frameRule()] : [],
  });
}
