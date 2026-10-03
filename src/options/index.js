import { validateSettings } from '../shared/settings.js';

export function createOptions(document, runtime) {
  const get = (id) => document.getElementById(id);
  const labels = { instant: '即时', medium: '标准', high: '高', 'extra-high': '扩展', pro: 'Pro' };
  async function rpc(type, payload = {}) {
    const result = await runtime.sendMessage({ channel: 'cgp', type, ...payload });
    if (!result?.ok) throw new Error(result?.error?.message || '扩展后台未响应');
    return result;
  }
  function populate(settings) {
    get('enabled').checked = settings.enabled;
    get('suppressDoubao').checked = settings.suppressDoubao;
    get('targetLanguage').value = settings.targetLanguage;
    get('excludedHosts').value = settings.excludedHosts.join('\n');
    get('manualMode').textContent = labels[settings.manualMode] || settings.manualMode;
  }
  async function save(event) {
    event?.preventDefault();
    get('save-settings').disabled = true;
    try {
      const patch = validateSettings({
        enabled: get('enabled').checked,
        suppressDoubao: get('suppressDoubao').checked,
        targetLanguage: get('targetLanguage').value,
        excludedHosts: get('excludedHosts').value.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean),
      });
      const result = await rpc('UPDATE_SETTINGS', { patch });
      populate(result.settings); get('settings-status').textContent = '设置已保存';
    } catch (error) { get('settings-status').textContent = error.message; }
    finally { get('save-settings').disabled = false; }
  }
  get('settings-form').addEventListener('submit', save);
  const ready = (async () => {
    try { populate((await rpc('GET_SETTINGS')).settings); get('save-settings').disabled = false; }
    catch (error) { get('settings-status').textContent = error.message; }
  })();
  return { ready, save, dispose() { get('settings-form').removeEventListener('submit', save); } };
}

if (typeof chrome !== 'undefined' && typeof document !== 'undefined' && document.getElementById('settings-form')) createOptions(document, chrome.runtime);
