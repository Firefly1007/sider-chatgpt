import createDOMPurify from 'dompurify';

export const MAX_MINDMAP_NODES = 300;
export const MAX_MINDMAP_CHARS = 20000;
let sequence = 0;

function fail(message, code = 'INVALID_MINDMAP') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/** Plain text fences carry the same validated source without a native widget. */
export function extractMindmap(text) {
  if (typeof text !== 'string') fail('脑图回答必须是文本');
  const blocks = [...text.matchAll(/^```(?:mermaid|text)[ \t]*\r?\n([\s\S]*?)^```[ \t]*(?=\r?$)/gmu)];
  if (blocks.length !== 1) fail('回答需要包含一个完整的脑图源码代码块');
  const code = blocks[0][1].trimEnd();
  validateMindmap(code);
  return code;
}

/** Validate the intentionally restricted, two-space hierarchical format. */
export function validateMindmap(code) {
  if (typeof code !== 'string' || !code.trim() || code.length > MAX_MINDMAP_CHARS) fail('脑图为空或过大');
  if (/[\t\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(code)) fail('脑图不能包含 Tab 或控制字符');
  if (/%%|::|<|>|`|javascript\s*:|data\s*:|vbscript\s*:/iu.test(code)) fail('脑图包含不允许的配置、HTML 或交互内容');
  const lines = code.replace(/\r\n/gu, '\n').split('\n');
  if (lines.shift()?.trim() !== 'mindmap') fail('代码第一行必须是 mindmap');
  const nodes = [];
  let baseIndent;
  let lastDepth = 0;
  const parents = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.match(/^ */u)[0].length;
    baseIndent ??= indent;
    if (indent < baseIndent || (indent - baseIndent) % 2) fail('层级必须每级增加两个空格');
    const depth = (indent - baseIndent) / 2;
    if (nodes.length && depth === 0) fail('脑图必须只有一个根节点');
    if (depth > lastDepth + 1) fail('脑图层级不能跳级');
    const source = line.trim();
    if (/^(?:---|flowchart\b|graph\b|mindmap\b|[-*+]\s|#)/iu.test(source)) fail('节点不是合法脑图标签');
    if (source.length > 500) fail('节点标签过长');
    // Balanced shape delimiters are supported; Mermaid remains final syntax authority.
    const stack = [];
    const matching = { ')': '(', ']': '[', '}': '{' };
    for (const character of source) {
      if ('([{'.includes(character)) stack.push(character);
      else if (')]}'.includes(character) && stack.pop() !== matching[character]) fail('节点形状括号不完整');
    }
    if (stack.length) fail('节点形状括号不完整');
    const node = { id: nodes.length, depth, source, parent: depth ? parents[depth - 1] : null, children: [] };
    if (depth && node.parent == null) fail('节点没有父节点');
    if (depth) nodes[node.parent].children.push(node.id);
    nodes.push(node);
    parents[depth] = node.id;
    parents.length = depth + 1;
    lastDepth = depth;
    if (nodes.length > MAX_MINDMAP_NODES) fail(`脑图最多 ${MAX_MINDMAP_NODES} 个节点`);
  }
  if (!nodes.length) fail('脑图缺少根节点');
  return { code: code.trimEnd(), nodes, root: 0 };
}

function visibleCode(tree, collapsed) {
  const lines = ['mindmap'];
  function visit(id) {
    const node = tree.nodes[id];
    lines.push(`${'  '.repeat(node.depth + 1)}${node.source}`);
    if (!collapsed.has(id)) node.children.forEach(visit);
  }
  visit(tree.root);
  return lines.join('\n');
}

export function exportMindmapMarkdown(code) {
  validateMindmap(code);
  return `\`\`\`mermaid\n${code.trimEnd()}\n\`\`\`\n`;
}

export function exportMindmapSVG(svgElement) {
  if (!svgElement || svgElement.localName !== 'svg') fail('没有可导出的 SVG');
  const clone = svgElement.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const window = svgElement.ownerDocument.defaultView;
  const purify = createDOMPurify(window);
  return purify.sanitize(new window.XMLSerializer().serializeToString(clone), {
    USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script', 'foreignObject'],
  });
}

export async function exportMindmapPNG(svgElement, options = {}) {
  const svg = exportMindmapSVG(svgElement);
  const window = svgElement.ownerDocument.defaultView;
  const viewBox = svgElement.viewBox?.baseVal;
  const bounds = svgElement.getBoundingClientRect();
  const width = Math.ceil(viewBox?.width || bounds.width || Number.parseFloat(svgElement.getAttribute('width')) || 1000);
  const height = Math.ceil(viewBox?.height || bounds.height || Number.parseFloat(svgElement.getAttribute('height')) || 600);
  const scale = options.scale ?? 2;
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 4 || width * height * scale * scale > 32000000) fail('PNG 导出尺寸过大');
  const canvas = svgElement.ownerDocument.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext('2d');
  if (!context) fail('浏览器不支持 PNG 导出', 'EXPORT_UNAVAILABLE');
  const blob = new window.Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  try {
    const image = new window.Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('SVG 图像加载失败')); image.src = url; });
    context.fillStyle = options.background || '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG 导出失败')), 'image/png'));
  } finally { window.URL.revokeObjectURL(url); }
}

/** Local rendering only. Collapse rerenders from a validated tree, never executes code. */
export async function renderMindmap(container, code) {
  if (!container?.ownerDocument?.defaultView) fail('缺少脑图容器');
  const tree = validateMindmap(code);
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'default', htmlLabels: false, flowchart: { htmlLabels: false } });
  const collapsed = new Set();
  const purify = createDOMPurify(container.ownerDocument.defaultView);
  let disposed = false;
  let generation = 0;
  let zoom = 1;
  let svg;
  async function draw() {
    const current = ++generation;
    const source = visibleCode(tree, collapsed);
    const result = await mermaid.render(`cgp-mindmap-${++sequence}`, source);
    if (disposed || current !== generation) return;
    container.innerHTML = purify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script', 'foreignObject'] });
    svg = container.querySelector('svg');
    if (!svg) fail('脑图渲染没有生成 SVG');
    svg.style.transformOrigin = 'center center';
    svg.style.transform = `scale(${zoom})`;
    svg.style.maxWidth = 'none';
  }
  await draw();
  return {
    code: tree.code, tree,
    get svg() { return svg; },
    get collapsed() { return new Set(collapsed); },
    async setCollapsed(id, value = true) {
      if (!Number.isInteger(id) || !tree.nodes[id]) fail('节点不存在');
      if (value) collapsed.add(id); else collapsed.delete(id);
      await draw();
    },
    setZoom(value) {
      if (!Number.isFinite(value) || value < 0.1 || value > 4) fail('缩放必须在 0.1 到 4 之间');
      zoom = value; if (svg) svg.style.transform = `scale(${zoom})`;
    },
    fit() { zoom = 1; if (svg) { svg.style.transform = 'scale(1)'; svg.style.maxWidth = '100%'; svg.style.height = 'auto'; } },
    exportMarkdown: () => exportMindmapMarkdown(tree.code),
    exportSVG: () => exportMindmapSVG(svg),
    exportPNG: (options) => exportMindmapPNG(svg, options),
    dispose() { disposed = true; ++generation; container.replaceChildren(); },
  };
}
