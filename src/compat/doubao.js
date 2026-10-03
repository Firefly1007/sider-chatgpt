// Exact observed Doubao 1.38.0 hosts and shadow structure; never match "doubao" broadly.
const NAMES = ['doubao-ai-csui', 'doubao-ai-assistant', 'doubao-ai-translate-image-assistant', 'doubao-ai-mail-assistant', 'doubao-ai-vocabruary-popup-card', 'doubao-ai-collection-assistant', 'doubao-ai-podcast-assistant', 'doubao-ai-skill-assistant'];
const HOSTS = NAMES.flatMap(name => [`#${name}`, name]).join(',');
const SHADOW_MARKERS = 'body#cici-inline-container > .cici-ext-container, .cici-ext-container[id]';

export function createDoubaoSuppression(document) {
  const hidden = new Map();
  let active = false;
  let observer;
  function hide(host) {
    if (!host || host.closest('[data-cgp-ui]')) return;
    if (!hidden.has(host)) {
      hidden.set(host, { value: host.style.getPropertyValue('display'), priority: host.style.getPropertyPriority('display') });
      // Doubao rewrites the host's inline display when its UI becomes visible.
      // Watch only hosts identified by the exact names or shadow structure above.
      observer.observe(host, { attributes: true, attributeFilter: ['style'] });
    }
    if (host.style.getPropertyValue('display') !== 'none' || host.style.getPropertyPriority('display') !== 'important') {
      host.style.setProperty('display', 'none', 'important');
    }
  }
  function scan(root = document) {
    if (!active) return;
    const inspect = host => {
      if (host.hasAttribute('data-cgp-ui')) return;
      if (host.matches(HOSTS) || host.shadowRoot?.querySelector(SHADOW_MARKERS)) hide(host);
    };
    if (root.nodeType === 1) inspect(root);
    root.querySelectorAll?.('*').forEach(inspect);
  }
  function restore() {
    observer?.disconnect(); observer = null;
    for (const [host, previous] of hidden) {
      if (host.style.getPropertyValue('display') === 'none' && host.style.getPropertyPriority('display') === 'important') {
        if (previous.value) host.style.setProperty('display', previous.value, previous.priority);
        else host.style.removeProperty('display');
      }
    }
    hidden.clear();
  }
  return {
    setEnabled(value) {
      const next = Boolean(value);
      if (next === active) return;
      active = next;
      if (!active) return restore();
      observer = new document.defaultView.MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes') hide(record.target);
          else for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      scan();
    },
    scan,
    dispose() { active = false; restore(); },
  };
}
