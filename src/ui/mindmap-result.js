import { extractMindmap, renderMindmap } from '../features/mindmap.js';
import createDOMPurify from 'dompurify';

function sanitizeDiagram(document, source) {
  const fragment = createDOMPurify(document.defaultView).sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'], HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'image', 'use', 'img', 'a', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'animate', 'set'],
    FORBID_ATTR: ['href', 'xlink:href', 'src', 'srcset'], RETURN_DOM_FRAGMENT: true,
  });
  const svg = fragment.firstElementChild;
  if (fragment.childElementCount !== 1 || svg?.localName !== 'svg') throw Object.assign(new Error('缺少有效 SVG 图表'), {code:'DIAGRAM_INVALID'});
  const bounds = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const width = bounds.length === 4 ? bounds[2] : parseFloat(svg.getAttribute('width'));
  const height = bounds.length === 4 ? bounds[3] : parseFloat(svg.getAttribute('height'));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw Object.assign(new Error('图表尺寸无效'), {code:'DIAGRAM_INVALID'});
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
  svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));
  // Serialize detached, sanitized markup; never insert the SVG into the live page.
  return {svg:new document.defaultView.XMLSerializer().serializeToString(svg),width,height};
}

export function createMindmapResult(document, { render = renderMindmap, onError = () => {} } = {}) {
  const element = document.createElement('div'); element.className = 'cgp-mindmap-result'; element.hidden = true;
  element.innerHTML = '<div class="cgp-mindmap-tools" role="toolbar" aria-label="脑图操作"></div><div class="cgp-mindmap-canvas" aria-label="脑图"></div><details class="cgp-mindmap-source"><summary>查看 Mermaid 源码</summary><pre></pre></details>';
  const tools = element.querySelector('.cgp-mindmap-tools');
  const canvas = element.querySelector('.cgp-mindmap-canvas');
  let view;
  let generation = 0;
  let zoom = 1;
  let queue = Promise.resolve();
  let viewer;
  let expandButton;
  let placeholder;
  function setExpanded(expanded) {
    if (expanded === Boolean(placeholder)) return;
    if (expanded) {
      placeholder = document.createComment('mindmap-position');
      element.before(placeholder);
      element.getRootNode().append(element);
      element.classList.add('cgp-mindmap-expanded');
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-label', '脑图大图');
    } else {
      placeholder.replaceWith(element); placeholder = null;
      element.classList.remove('cgp-mindmap-expanded');
      element.removeAttribute('role'); element.removeAttribute('aria-label');
    }
    expandButton.textContent = expanded ? '收起大图' : '大图查看';
    if (view?.svg) { zoom = 1; fitChart(); }
    expandButton.focus();
  }
  element.addEventListener('keydown', event => {
    if (event.key === 'Escape' && placeholder) {
      event.stopPropagation();
      setExpanded(false);
    }
  });
  function addExpandButton() {
    expandButton = document.createElement('button');
    expandButton.type = 'button'; expandButton.className = 'actionButton-DxGdJm';
    expandButton.textContent = '大图查看';
    expandButton.addEventListener('click', () => setExpanded(!placeholder));
    tools.append(expandButton);
  }
  function report(error) {onError({code:error.code || 'MINDMAP_RENDER_FAILED',message:error.code?.startsWith('DIAGRAM')?`图表无法显示：${error.message}。可重试。`:`脑图无法显示：${error.message}。源码已保留，可重试。`});}
  function button(label, action, parent = tools) {
    const token=generation;
    const item=document.createElement('button');item.type='button';item.className='actionButton-DxGdJm';item.textContent=label;
    item.addEventListener('click',()=>{queue=queue.then(async()=>{if(token!==generation)return;item.disabled=true;try{await action();}catch(error){if(token===generation)report(error);}finally{item.disabled=false;}});});parent.append(item);return item;
  }
  function download(value, type, name) {
    const window=document.defaultView;const blob=value instanceof window.Blob ? value : new window.Blob([value],{type});
    const url=window.URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>window.URL.revokeObjectURL(url),0);
  }
  function fitChart() {
    view.fit();
    const bounds=view.svg.viewBox.baseVal;
    const width=canvas.clientWidth || 380;
    const height=placeholder ? canvas.clientHeight : 360;
    const scale=Math.min(width/bounds.width,height/bounds.height);
    view.svg.querySelectorAll('style').forEach(style=>style.classList.add('darkreader','cgp-mindmap-style'));
    view.svg.style.width=`${bounds.width*scale}px`;view.svg.style.height=`${bounds.height*scale}px`;
    view.svg.style.transformOrigin='top left';
    view.setZoom(zoom);
  }
  function imagePreview(chart, target, controls, expanded = false) {
    const image = document.createElement('img');image.alt='ChatGPT 图表预览';image.className='cgp-diagram-image';
    image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(chart.svg)}`;
    target.replaceChildren(image);
    let scale=1;
    function fit() {scale=Math.min((target.clientWidth || (expanded?document.defaultView.innerWidth-80:380))/chart.width,(expanded?Math.max(160,document.defaultView.innerHeight-140):360)/chart.height);}
    function resize() {image.style.width=`${chart.width*scale}px`;image.style.height=`${chart.height*scale}px`;}
    button('缩小',()=>{scale=Math.max(.01,scale/1.2);resize();},controls);
    button('放大',()=>{scale=Math.min(4,scale*1.2);resize();},controls);
    button('适配视图',()=>{fit();resize();},controls);
    fit();resize();return image;
  }
  function expand(chart) {
    viewer?.remove();viewer=document.createElement('div');viewer.className='cgp-diagram-viewer';viewer.setAttribute('role','dialog');viewer.setAttribute('aria-label','放大图表');
    const controls=document.createElement('div');controls.className='cgp-mindmap-tools';
    const target=document.createElement('div');target.className='cgp-diagram-expanded';
    const close=()=>{viewer?.remove();viewer=null;};
    button('关闭大图',close,controls);viewer.append(controls,target);element.append(viewer);
    imagePreview(chart,target,controls,true);
    viewer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});
    controls.firstElementChild.focus();
  }
  function reset() {if(placeholder)setExpanded(false);++generation;viewer?.remove();viewer=null;view?.dispose();view=null;expandButton=null;tools.replaceChildren();canvas.replaceChildren();element.querySelector('pre').textContent='';element.hidden=true;zoom=1;}
  return {
    element,
    get view(){return view;},
    async update(text, diagram) {
      reset();const token=generation;let candidate;
      try {
        element.querySelector('details').hidden=Boolean(diagram);
        if (diagram) {
          const chart=sanitizeDiagram(document,diagram.svg);element.hidden=false;
          const image=imagePreview(chart,canvas,tools);
          view={image,dispose:()=>image.removeAttribute('src')};
          try {if(image.decode) await image.decode();}
          catch {throw Object.assign(new Error('SVG 图像解码失败'),{code:'DIAGRAM_DECODE_FAILED'});}
          if(token!==generation)return false;
          button('放大查看',()=>expand(chart));
          button('导出 SVG',()=>download(chart.svg,'image/svg+xml;charset=utf-8','chatgpt-diagram.svg'));
          return true;
        }
        const code=extractMindmap(text);
        element.querySelector('pre').textContent=code;element.querySelector('details').open=false;
        element.hidden=false;
        const target=document.createElement('div');canvas.replaceChildren(target);
        candidate=await render(target,code);
        if(token!==generation){candidate.dispose();return false;}
        view=candidate;
        button('缩小',()=>{zoom=Math.max(.1,zoom-.2);view.setZoom(zoom);});
        button('放大',()=>{zoom=Math.min(4,zoom+.2);view.setZoom(zoom);});
        button('适配视图',()=>{zoom=1;fitChart();});
        addExpandButton();
        const nodes=document.createElement('select');nodes.setAttribute('aria-label','折叠节点');
        for(const node of view.tree.nodes.filter(node=>node.children.length)){
          const option=document.createElement('option');option.value=String(node.id);option.textContent=node.source;nodes.append(option);
        }
        tools.append(nodes);
        const fold=button('折叠节点',async()=>{const id=Number(nodes.value);await view.setCollapsed(id,!view.collapsed.has(id));fitChart();fold.textContent=view.collapsed.has(id)?'展开节点':'折叠节点';});
        fold.disabled=!nodes.options.length;nodes.disabled=!nodes.options.length;
        nodes.addEventListener('change',()=>{fold.textContent=view.collapsed.has(Number(nodes.value))?'展开节点':'折叠节点';});
        button('导出 Markdown',()=>download(view.exportMarkdown(),'text/markdown;charset=utf-8','selection-mindmap.md'));
        button('导出 SVG',()=>download(view.exportSVG(),'image/svg+xml;charset=utf-8','selection-mindmap.svg'));
        button('导出 PNG',async()=>download(await view.exportPNG(),'image/png','selection-mindmap.png'));
        fitChart();return true;
      } catch(error) {candidate?.dispose();if(token===generation){view?.dispose();view=null;element.hidden=true;report(error);}return false;}
    },
    reset,
    dispose:reset,
  };
}
