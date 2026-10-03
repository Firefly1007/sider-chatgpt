export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  suppressDoubao: true,
  targetLanguage: '中文',
  excludedHosts: Object.freeze([]),
  manualMode: 'high',
});

const MODES = new Set(['instant', 'medium', 'high', 'extra-high', 'pro']);
const KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_SETTINGS';
  throw error;
}

/** Validate a partial patch without changing the remembered manual preference. */
export function validateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) invalid('设置必须是对象');
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!KEYS.has(key)) invalid(`未知设置：${key}`);
    if (key === 'enabled' || key === 'suppressDoubao') {
      if (typeof value !== 'boolean') invalid(`${key} 必须是布尔值`);
      result[key] = value;
    } else if (key === 'manualMode') {
      if (!MODES.has(value)) invalid('思考模式无效');
      result[key] = value;
    } else if (key === 'targetLanguage') {
      if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\r\n\u0000-\u001f]/u.test(value)) invalid('目标语言无效');
      result[key] = value.trim();
    } else {
      if (!Array.isArray(value) || value.length > 200) invalid('排除站点必须是域名数组');
      result[key] = [...new Set(value.map((host) => {
        if (typeof host !== 'string') invalid('排除站点必须是域名');
        const normalized = host.trim().toLowerCase().replace(/\.$/u, '');
        const domain = normalized.startsWith('*.') ? normalized.slice(2) : normalized;
        if (domain.length > 253 || !/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/u.test(domain)) invalid(`无效域名：${host}`);
        return normalized;
      }))];
    }
  }
  return result;
}

/** An explicit mode on a manual round is honored; fixed actions never alter it. */
export function resolveMode(input, settings = DEFAULT_SETTINGS) {
  if (!input || typeof input !== 'object') invalid('缺少任务');
  if (input.origin === 'selection' && input.action !== 'ask' && !input.followup) return 'instant';
  const manual = input.followup || input.action === 'ask';
  if (manual) {
    const mode = input.mode ?? settings.manualMode ?? 'high';
    if (!MODES.has(mode)) invalid('思考模式无效');
    return mode;
  }
  return input.action === 'translate' || input.action === 'search' ? 'instant' : 'high';
}

export function isExcludedHost(hostname, settings = DEFAULT_SETTINGS) {
  const host = String(hostname).toLowerCase().replace(/\.$/u, '');
  return settings.excludedHosts.some((excluded) => excluded.startsWith('*.')
    ? host === excluded.slice(2) || host.endsWith(`.${excluded.slice(2)}`)
    : host === excluded);
}
