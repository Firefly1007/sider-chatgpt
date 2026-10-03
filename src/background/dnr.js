export const FRAME_RULE_ID = 74001;

export function frameRule(extensionId) {
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
      initiatorDomains: [extensionId],
      resourceTypes: ['sub_frame'],
    },
  };
}

export async function configureFrameRule(chrome, enabled) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [FRAME_RULE_ID],
    addRules: enabled ? [frameRule(chrome.runtime.id)] : [],
  });
}
