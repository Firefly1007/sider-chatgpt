import { Marked } from 'marked';
import markedCjkFriendly from 'marked-cjk-friendly';
import createDOMPurify from 'dompurify';
import katex from 'katex';

function escaped(text, index) {
  let count = 0;
  while (index > 0 && text[--index] === '\\') count++;
  return count % 2 === 1;
}
function mathToken(src, block = false) {
  const pairs = block ? [['$$', '$$'], ['\\[', '\\]']] : [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']];
  const pair = pairs.find(([open]) => src.startsWith(open));
  if (!pair) return;
  const [open, close] = pair, display = open === '$$' || open === '\\[';
  if (open === '$' && (!src[1] || /\s|\$/u.test(src[1]))) return;
  let end = open.length;
  while ((end = src.indexOf(close, end)) !== -1) {
    if (escaped(src, end) || open === '$' && (/\s/u.test(src[end - 1]) || /\d/u.test(src[end + 1] || ''))) { end += close.length; continue; }
    const tex = src.slice(open.length, end);
    if (open === '$' && tex.includes('\n')) return;
    return { type: block ? 'mathBlock' : 'mathInline', raw: src.slice(0, end + close.length), tex, display };
  }
  // Preserve unfinished streaming TeX literally; Marked must not consume its
  // backslashes or interpret its underscores as emphasis before it closes.
  if (open !== '$') return { type: block ? 'mathBlock' : 'mathInline', raw: src, tex: null, display };
}
function mathStart(src) {
  const pattern = /\$|\\[([]/gu;
  for (const match of src.matchAll(pattern)) if (!escaped(src, match.index)) return match.index;
}

export function installMathStyles(shadow, runtime) {
  if (!runtime?.getURL) return () => {};
  const document = shadow.ownerDocument;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = runtime.getURL('math/katex.css'); shadow.append(stylesheet);
  // Font faces belong to the document font set; the layout CSS stays inside
  // our shadow root and cannot restyle a site's own math.
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet'; fonts.href = runtime.getURL('math/fonts.css');
  (document.head || document.documentElement).append(fonts);
  return () => { stylesheet.remove(); fonts.remove(); };
}

export function safeHttpUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function renderAnswer(container, text) {
  const formulas = [];
  const renderMath = token => {
    const index = formulas.push(token) - 1, tag = token.type === 'mathBlock' ? 'div' : 'span';
    return `<${tag} data-cgp-math="${index}"></${tag}>`;
  };
  const markdown = new Marked({ extensions: [
    { name: 'mathBlock', level: 'block', start: src => src.search(/^(?:\$\$|\\\[)/mu), tokenizer: src => mathToken(src, true), renderer: renderMath },
    { name: 'mathInline', level: 'inline', start: mathStart, tokenizer: src => mathToken(src), renderer: renderMath },
  ] });
  markdown.use(markedCjkFriendly());
  const purify = createDOMPurify(container.ownerDocument.defaultView);
  container.innerHTML = purify.sanitize(markdown.parse(String(text || ''), { async: false }), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'hr', 'span', 'div', 'input'],
    ALLOWED_ATTR: ['href', 'title', 'data-cgp-math', 'start', 'align', 'type', 'checked', 'disabled'], ALLOW_DATA_ATTR: false,
  });
  for (const input of container.querySelectorAll('input')) {
    if (input.type !== 'checkbox') input.remove();
    else { input.disabled = true; input.tabIndex = -1; }
  }
  for (const slot of container.querySelectorAll('[data-cgp-math]')) {
    const formula = formulas[Number(slot.getAttribute('data-cgp-math'))];
    slot.removeAttribute('data-cgp-math');
    if (!formula) continue;
    slot.className = formula.display ? 'cgp-math cgp-math-display' : 'cgp-math';
    try {
      if (formula.tex === null) throw new Error('Incomplete formula');
      slot.innerHTML = katex.renderToString(formula.tex, { displayMode: formula.display, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml' });
    } catch { slot.textContent = formula.raw; }
  }
  for (const link of container.querySelectorAll('a')) {
    const href = safeHttpUrl(link.getAttribute('href'));
    if (!href) link.removeAttribute('href');
    else { link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  }
}

export function renderSources(container, sources = []) {
  container.replaceChildren();
  for (const [index, source] of sources.entries()) {
    const url = safeHttpUrl(source.url);
    if (!url) continue;
    const link = container.ownerDocument.createElement('a');
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = `[${index + 1}] ${source.title || new URL(url).hostname}`;
    container.append(link);
  }
}
