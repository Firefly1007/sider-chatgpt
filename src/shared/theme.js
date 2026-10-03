export function readPageTheme(document) {
  const window = document.defaultView;
  const styles = [...document.querySelectorAll('style.darkreader')].filter((style) => {
    if (style.disabled || !style.sheet || style.sheet.disabled || (style.media && !window.matchMedia?.(style.media).matches)) return false;
    return style.sheet.cssRules.length > 0;
  });
  if (styles.length) {
    const declared = document.documentElement.getAttribute('data-darkreader-scheme');
    if (declared === 'light' || declared === 'dark') return { theme: declared, source: 'darkreader' };
    const userAgent = styles.find((style) => style.classList.contains('darkreader--user-agent'));
    if (userAgent) {
      // Dark Reader's dynamic light mode omits the html color-scheme rule.
      const dark = [...userAgent.sheet.cssRules].some((rule) => rule.selectorText === 'html' && rule.style?.getPropertyValue('color-scheme').trim() === 'dark');
      return { theme: dark ? 'dark' : 'light', source: 'darkreader' };
    }
  }
  return { theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', source: 'system' };
}

export function observePageTheme(document, callback) {
  let previous;
  const update = () => {
    const result = readPageTheme(document);
    const key = `${result.source}:${result.theme}`;
    if (key !== previous) { previous = key; callback(result); }
  };
  const observer = new document.defaultView.MutationObserver(update);
  if (document.head) observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'media', 'disabled'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-darkreader-scheme'] });
  const media = document.defaultView.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener('change', update);
  update();
  return () => { observer.disconnect(); media?.removeEventListener('change', update); };
}
