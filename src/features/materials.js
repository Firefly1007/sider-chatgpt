import { Readability } from '@mozilla/readability';

export const MAX_MATERIAL_CHARS = 120000;
const REMOVE = 'script,style,noscript,template,iframe,canvas,svg,form,input,textarea,select,button,[contenteditable], [data-cgp-ui], [data-cgp-owned], #cgp-root, #cgp-selection-root, #cgp-screenshot-root';

function error(message, code) {
  const result = new Error(message);
  result.code = code;
  throw result;
}
function cleanDocument(document) {
  const clone = document.cloneNode(true);
  clone.querySelectorAll(REMOVE).forEach((element) => element.remove());
  clone.querySelectorAll('[hidden],[aria-hidden="true"]').forEach((element) => element.remove());
  return clone;
}

/** Preserve basic article structure while normalizing only ordinary prose. */
function plainText(element) {
  let clone = element.cloneNode(true);
  let listDepth = 0;
  if (element.localName === 'li' && ['ol', 'ul'].includes(element.parentElement?.localName)) {
    const parent = element.parentElement;
    const wrapper = parent.cloneNode(false);
    const reversed = parent.hasAttribute('reversed');
    let number = parent.hasAttribute('start') ? Number(parent.getAttribute('start')) : reversed ? parent.children.length : 1;
    for (const sibling of parent.children) {
      if (sibling.hasAttribute('value')) number = Number(sibling.getAttribute('value'));
      if (sibling === element) break;
      number += reversed ? -1 : 1;
    }
    if (parent.localName === 'ol') wrapper.setAttribute('start', String(number));
    for (let ancestor = parent.parentElement; ancestor; ancestor = ancestor.parentElement) if (['ol', 'ul'].includes(ancestor.localName)) ++listDepth;
    wrapper.append(clone); clone = wrapper;
  }
  clone.querySelectorAll(REMOVE).forEach((node) => node.remove());
  const codeBlocks = [];
  const marker = `CGP_CODE_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}_`;
  const protect = (text) => {
    const token = `${marker}${codeBlocks.length}_END`;
    codeBlocks.push({ token, text });
    return token;
  };
  const children = (node, depth = 0) => [...node.childNodes].map((child) => read(child, depth)).join('');
  function read(node, depth = 0) {
    if (node.nodeType === 3) return node.textContent.replace(/[\t\r\n\u00a0 ]+/gu, ' ');
    if (node.nodeType !== 1) return '';
    const tag = node.localName;
    if (tag === 'br') return '\n';
    if (tag === 'pre') {
      const text = node.textContent.replace(/\r\n?/gu, '\n');
      const language = [...(node.querySelector('code') || node).classList].find((value) => /^language-[a-z0-9+#.-]+$/iu.test(value))?.slice(9) || '';
      const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length + 1)));
      return `\n\n${protect(`${fence}${language}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}`)}\n\n`;
    }
    if (tag === 'code') {
      const text = node.textContent;
      const fence = '`'.repeat(Math.max(1, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length + 1)));
      return protect(`${fence}${text}${fence}`);
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = [...node.children].filter((child) => child.localName === 'li');
      const reversed = tag === 'ol' && node.hasAttribute('reversed');
      let number = node.hasAttribute('start') ? Number(node.getAttribute('start')) : reversed ? items.length : 1;
      const lines = items.map((item) => {
        if (item.hasAttribute('value')) number = Number(item.getAttribute('value'));
        const prefix = `${'  '.repeat(depth)}${tag === 'ol' ? `${number}.` : '-'} `;
        if (tag === 'ol') number += reversed ? -1 : 1;
        const lines = [];
        let body = '';
        let first = true;
        function flush() {
          if (!body.trim()) return;
          lines.push(...body.trim().split('\n').map((line, index) => `${first && !index ? prefix : ' '.repeat(prefix.length)}${line}`));
          first = false; body = '';
        }
        for (const child of item.childNodes) {
          if (['ul', 'ol'].includes(child.localName)) {
            flush();
            if (first) { lines.push(prefix.trimEnd()); first = false; }
            lines.push(read(child, depth + 1).replace(/^\n|\n$/gu, ''));
          } else body += read(child, depth + 1);
        }
        flush();
        return lines.length ? lines.join('\n') : prefix.trimEnd();
      });
      return `\n${lines.join('\n')}\n`;
    }
    if (tag === 'table') {
      const caption = node.querySelector(':scope > caption');
      const rows = [...node.querySelectorAll('tr')].filter((row) => row.closest('table') === node);
      const lines = rows.map((row) => read(row, depth));
      return `\n\n${caption ? `${children(caption).trim()}\n` : ''}${lines.join('\n')}\n\n`;
    }
    if (tag === 'tr') {
      const cells = [...node.children].filter((cell) => ['td', 'th'].includes(cell.localName));
      const values = cells.map((cell) => {
        const text = children(cell, depth).trim().replace(/\n+/gu, ' / ').replace(/\|/gu, '\\|');
        const spans = [['colspan', '列'], ['rowspan', '行']].filter(([attribute]) => Number(cell.getAttribute(attribute)) > 1)
          .map(([attribute, unit]) => `跨${cell.getAttribute(attribute)}${unit}`);
        return `${text}${spans.length ? `（${spans.join('、')}）` : ''}`;
      });
      return `| ${values.join(' | ')} |`;
    }
    const content = children(node, depth);
    if (/^(?:p|div|section|article|main|header|footer|h[1-6]|blockquote|dl|dt|dd)$/u.test(tag)) return `\n\n${content.trim()}\n\n`;
    return content;
  }
  // Code placeholders keep all code indentation, blank lines and trailing spaces
  // outside the prose cleanup, including syntax-highlighted span descendants.
  let text = read(clone, listDepth).replace(/[ \t]+\n/gu, '\n').replace(/\n[ \t]+(?=\n)/gu, '\n').replace(/\n{3,}/gu, '\n\n').trimEnd().replace(/^\n+/u, '');
  for (const code of codeBlocks) text = text.replace(code.token, () => code.text);
  return text;
}
function checked(text) {
  if (!text.trim()) error('没有提取到可用网页正文', 'EMPTY_MATERIAL');
  if (text.length > MAX_MATERIAL_CHARS) error(`网页正文超过 ${MAX_MATERIAL_CHARS} 字符，请选取较小范围；正文未截断或发送`, 'MATERIAL_TOO_LARGE');
  return text;
}

export function extractMaterial(document, url = document?.location?.href || '') {
  if (!document?.body) error('页面没有正文', 'EMPTY_MATERIAL');
  const clone = cleanDocument(document);
  let article;
  const codeClasses = [...new Set([...clone.querySelectorAll('pre,code')].flatMap((node) => [...node.classList].filter((value) => /^language-[a-z0-9+#.-]+$/iu.test(value))))];
  try { article = new Readability(clone.cloneNode(true), { classesToPreserve: codeClasses }).parse(); } catch { /* explicit fallback below */ }
  let text;
  let scope;
  if (article?.content) {
    const container = clone.createElement('div');
    container.innerHTML = article.content;
    text = plainText(container);
    scope = '提取后的网页正文';
  } else {
    const body = clone.querySelector('main,article,[role="main"]') || clone.body;
    body.querySelectorAll('nav,aside,footer,[role="navigation"]').forEach((node) => node.remove());
    text = plainText(body);
    scope = '网页可见正文（通用提取）';
  }
  return {
    id: globalThis.crypto?.randomUUID?.() || `material-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: article?.title?.trim() || document.title || '',
    url: String(url), text: checked(text), scope, truncated: false,
  };
}

function asElement(node) { return node?.nodeType === 1 ? node : node?.parentElement; }
function excluded(node) { return Boolean(asElement(node)?.closest(REMOVE)); }

/** Return exactly the user's selection plus separately named auxiliary context. */
export function selectionContext(selection, document, scope = 'nearby') {
  if (!selection || selection.rangeCount < 1 || selection.isCollapsed) error('请先选择文本', 'EMPTY_SELECTION');
  const range = selection.getRangeAt(0);
  if (excluded(range.startContainer) || excluded(range.endContainer)) error('不能读取表单或插件界面的选区', 'INVALID_SELECTION');
  for (const element of document.querySelectorAll(REMOVE)) {
    try { if (range.intersectsNode(element)) error('选区包含表单或插件界面，请重新选择正文', 'INVALID_SELECTION'); }
    catch (failure) { if (failure.code === 'INVALID_SELECTION') throw failure; }
  }
  const selectedText = selection.toString();
  checked(selectedText);
  if (scope === 'none') return { selectedText };
  if (scope === 'body') {
    const material = extractMaterial(document);
    return { selectedText, context: { title: material.title, url: material.url, text: material.text, scope: material.scope, truncated: false } };
  }
  if (scope !== 'nearby') error('未知背景范围', 'INVALID_CONTEXT_SCOPE');
  const block = (node) => {
    const element = asElement(node);
    return element?.closest('td,th')?.closest('tr')
      || element?.closest('p,li,blockquote,pre,h1,h2,h3,h4,h5,h6,section,article,main,div');
  };
  const first = block(range.startContainer) || document.body;
  const last = block(range.endContainer) || first;
  const nodes = [];
  // For a multiline selection gather intersecting blocks; avoid whole-body fallback.
  if (first === last) nodes.push(first.previousElementSibling, first, first.nextElementSibling);
  else {
    const candidates = [...document.querySelectorAll('p,li,blockquote,pre,h1,h2,h3,h4,h5,h6,tr')].filter((node) => !node.closest('td,th'));
    const intersecting = candidates.filter((node) => { try { return range.intersectsNode(node); } catch { return false; } });
    if (intersecting.length) nodes.push(intersecting[0].previousElementSibling, ...intersecting, intersecting.at(-1).nextElementSibling);
    else nodes.push(first, last);
  }
  const unique = [...new Set(nodes.filter((node) => node && !excluded(node)))];
  const text = checked(unique.map(plainText).filter(Boolean).join('\n'));
  return { selectedText, context: { title: document.title || '', url: document.location?.href || '', text, scope: '选区附近文本', truncated: false } };
}
