import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createSelectionToolbar } from '../src/ui/selection-toolbar.js';
import { DOUBAO_STYLES } from '../src/ui/doubao-styles.js';

test('default content controller keeps rewritten Doubao hosts hidden and positions toolbar above with edge flip', async () => {
  const bundled = await build({stdin:{contents:`import {createContentController} from './src/content/controller.js';
    window.controller=createContentController({document,chrome:{runtime:{sendMessage:async message=>({ok:true,settings:{enabled:true,suppressDoubao:true}})}}});
    window.controller.init();`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1000,height:600}});
    await page.setContent('<!doctype html><style>body{margin:0;font:18px/30px Arial;background:#202124;color:#eee}main{padding:120px 60px}p{margin:0}</style><main><p id=target>Zero Reinforcement Learning</p><p>Following paragraph remains visible below the selection.</p></main><doubao-ai-csui style="display:block"></doubao-ai-csui>');
    await page.evaluate(()=>document.querySelector('doubao-ai-csui').attachShadow({mode:'open'}).innerHTML='<body id="cici-inline-container"><div class="cici-ext-container">豆包划词条</div></body>');
    await page.addScriptTag({content:bundled.outputFiles[0].text});
    assert.equal(await page.locator('doubao-ai-csui').evaluate(el=>getComputedStyle(el).display),'none');
    await page.evaluate(()=>document.querySelector('doubao-ai-csui').style.cssText='display:block;position:absolute');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('doubao-ai-csui')).display==='none');
    const select=()=>page.evaluate(()=>{getSelection().removeAllRanges();const r=document.createRange();r.selectNodeContents(document.querySelector('#target'));getSelection().addRange(r);window.controller.showSelection();const b=r.getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,width:b.width};});
    const selection=await select();
    const toolbar=await page.getByRole('toolbar').boundingBox();
    assert.equal(Math.round(selection.top-(toolbar.y+toolbar.height)),9);
    assert.ok(toolbar.y+toolbar.height<selection.top);
    assert.ok(toolbar.x>=20 && toolbar.x+toolbar.width<=980);
    await page.screenshot({path:new URL('../docs/verification/toolbar-top-and-suppression.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
    await page.evaluate(()=>document.querySelector('main').style.paddingTop='0px');
    const nearTop=await select();const flipped=await page.getByRole('toolbar').boundingBox();
    assert.equal(Math.round(flipped.y-nearTop.bottom),9);
    await page.evaluate(()=>{document.querySelector('main').style.paddingTop='120px';document.querySelector('main').style.paddingLeft='900px';});
    await select();const right=await page.getByRole('toolbar').boundingBox();assert.ok(right.x+right.width<=980);
    await page.evaluate(()=>window.controller.handleMessage({channel:'cgp',type:'SETTINGS_CHANGED',settings:{enabled:false}}));
    assert.equal(await page.locator('doubao-ai-csui').evaluate(el=>el.style.display),'block');
    await page.evaluate(()=>document.querySelector('doubao-ai-csui').style.display='inline');
    assert.equal(await page.locator('doubao-ai-csui').evaluate(el=>el.style.display),'inline');
    await page.evaluate(()=>window.controller.dispose());
  } finally {await browser.close();}
});

test('selection toolbar runs independently with the compact production geometry', async () => {
  const dom = new JSDOM('<!doctype html>');
  const clicked = [];
  const toolbar = createSelectionToolbar(dom.window.document, action => clicked.push(action));
  toolbar.querySelector('[data-action=translate]').click();
  assert.deepEqual(clicked, ['translate']);
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  try {
    const page = await browser.newPage({viewport: {width: 1000, height: 350}});
    await page.setContent(`<style>*{box-sizing:border-box}body{padding:60px;--cgp-bg:#fff;--cgp-text:#202124;--cgp-border:#e4e6e9;--cgp-soft:#f3f4f6;font-family:Arial,sans-serif}${DOUBAO_STYLES}</style>${toolbar.outerHTML}`);
    assert.equal(await page.locator('.contentContainer-K4iWxu').evaluate(el => getComputedStyle(el).height), '30px');
    assert.equal(await page.locator('.btnArea-GIIUrK').first().evaluate(el => getComputedStyle(el).height), '24px');
    assert.equal(await page.locator('.contentContainer-K4iWxu').evaluate(el => getComputedStyle(el).borderRadius), '13px');
    await mkdir(new URL('../docs/verification/', import.meta.url), {recursive: true});
    await page.screenshot({path: new URL('../docs/verification/doubao-toolbar-independent.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')});
  } finally { await browser.close(); }
});

test('native SVG preview decodes foreignObject labels safely, zooms and opens a larger view in Edge', async () => {
  const bundled=await build({stdin:{contents:`import {createContentController} from './src/content/controller.js';window.controller=createContentController({document,chrome:{runtime:{sendMessage:async message=>message.type==='START_TASK'?{ok:true,sessionId:'s',requestId:'r'}:{ok:true,stopped:true}}}});window.controller.open({action:'mindmap',origin:'selection',selectedText:'Neutral example'},{left:120,bottom:80});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:850}});const remote=[];page.on('request',request=>{if(request.url().startsWith('https://invalid.example/'))remote.push(request.url());});
    await page.setContent('<!doctype html><title>Neutral diagram fixture</title><main>Local fixture</main>');await page.addScriptTag({content:bundled.outputFiles[0].text});
    await page.evaluate(async()=>{
      window.compromised=0;
      const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 240"><style>@import url("https://invalid.example/import.css");.label{font:28px Arial;color:#112244}</style><script>top.compromised++</script><rect width="800" height="240" fill="white" onload="top.compromised++"/><rect x="20" y="20" width="330" height="100" rx="12" fill="#dbeafe"/><foreignObject x="40" y="40" width="300" height="80"><div xmlns="http://www.w3.org/1999/xhtml" class="label" onclick="top.compromised++">Neutral diagram<img src="https://invalid.example/image" onerror="top.compromised++"/></div></foreignObject><path d="M350 70H440" stroke="#334155" stroke-width="3"/><text x="455" y="80" font-size="28" fill="#112244">Example branch</text><image href="https://invalid.example/svg-image"/><a href="javascript:top.compromised++"><text>danger</text></a></svg>';
      window.controller.acceptEvent({channel:'cgp',type:'TASK_EVENT',sessionId:'s',requestId:'r',state:'completed',text:'A neutral diagram is available below.',diagram:{svg}});await window.controller.state.rendering;
      await window.controller.state.mindmap.view.image.decode();
    });
    const image=page.locator('.cgp-mindmap-canvas img');const original=await image.boundingBox();
    assert.equal(await image.evaluate(el=>el.naturalWidth),800);assert.equal(await page.locator('.cgp-mindmap-canvas svg').count(),0);
    const clean=await image.evaluate(el=>decodeURIComponent(el.src.split(',')[1]));assert.match(clean,/foreignObject/);assert.match(clean,/Neutral diagram/);assert.doesNotMatch(clean,/<script|onload|onclick|onerror|<image|<img|javascript:/);
    await page.getByRole('button',{name:'放大',exact:true}).click();await page.waitForFunction(()=>parseFloat(window.controller.state.mindmap.view.image.style.width)>400);assert.ok((await image.boundingBox()).width>original.width);
    await page.getByRole('button',{name:'放大查看',exact:true}).click();const viewer=page.getByRole('dialog',{name:'放大图表',exact:true});await viewer.waitFor();await viewer.locator('img').evaluate(el=>el.decode());
    assert.ok((await viewer.locator('img').boundingBox()).width>original.width);
    await viewer.getByRole('button',{name:'放大',exact:true}).click();await page.screenshot({path:new URL('../docs/verification/native-diagram-expanded.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
    await viewer.getByRole('button',{name:'关闭大图',exact:true}).click();await viewer.waitFor({state:'detached'});
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 SVG',exact:true}).click();assert.doesNotMatch((await readFile(await (await download).path())).toString(),/<script|onclick|onerror/);
    assert.equal(await page.evaluate(()=>window.compromised),0);assert.deepEqual(remote,[]);
    await page.getByRole('button',{name:'放大查看',exact:true}).click();await page.evaluate(()=>window.controller.close());assert.equal(await page.getByRole('dialog').count(),0);
  } finally {await browser.close();}
});

test('migrated result popup works in isolated Edge with stream, source, pin and close', async () => {
  const bundled = await build({ stdin: { contents: `import {createContentController} from './src/content/controller.js';
    window.controller=createContentController({document,chrome:{runtime:{sendMessage:async message=>{
      if(message.type==='START_TASK')return {ok:true,sessionId:'s',requestId:'r'};
      if(message.type==='GET_CAPABILITIES')return {ok:true,capabilities:{modes:['instant','high'],unavailable:[{mode:'pro',reason:'额度已用完'}]}};
      return {ok:true};}}}});
    window.controller.open({action:'ask',origin:'selection',selectedText:'围绕所选文本提问。',context:{text:'页面邻近段落说明。',scope:'选区附近文本',truncated:false}},{left:120,bottom:80});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1000,height:720}});
    await page.setContent('<!doctype html><title>示例网页</title><main style="padding:60px;font:16px Arial"><h1>示例文章</h1><p>围绕所选文本提问。</p></main>');
    await page.addScriptTag({content:bundled.outputFiles[0].text});
    await page.getByLabel('问题或追问').fill('说明这个概念');
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.evaluate(()=>window.controller.acceptEvent({channel:'cgp',type:'TASK_EVENT',sessionId:'s',requestId:'r',state:'completed',text:'这是 **简短回答**。\n\n- 关键要点一\n- 关键要点二',sources:[{title:'原始资料',url:'https://example.com/source'}],mode:'high',capabilities:{modes:['instant','high'],unavailable:[{mode:'pro',reason:'额度已用完'}]}}));
    assert.equal(await page.locator('strong').textContent(),'简短回答');
    assert.equal(await page.getByRole('link',{name:'[1] 原始资料'}).getAttribute('href'),'https://example.com/source');
    await page.getByRole('button',{name:'固定浮窗'}).click();
    assert.equal(await page.getByRole('dialog').evaluate(el=>getComputedStyle(el).position),'fixed');
    await page.screenshot({path:new URL('../docs/verification/doubao-result-independent.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    assert.equal(await page.getByRole('dialog').count(),0);
  } finally {await browser.close();}
});

test('direct selection mindmap renders, expands, collapses, zooms and exports in Edge', async () => {
  const bundled=await build({stdin:{contents:`import {createContentController} from './src/content/controller.js';
    window.messages=[];let n=0;window.controller=createContentController({document,chrome:{runtime:{sendMessage:async message=>{
      window.messages.push(message);if(message.type==='START_TASK')return {ok:true,sessionId:'s'+(++n),requestId:'r'+n};return {ok:true,stopped:true};}}}});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:850},acceptDownloads:true});
    await page.setContent('<!doctype html><title>文章</title><main style="padding:60px"><p id=target>学习目标文本以及它的层级关系。</p></main>');await page.addScriptTag({content:bundled.outputFiles[0].text});
    await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#target'));getSelection().addRange(range);window.controller.showSelection();});
    assert.equal(await page.getByRole('button',{name:'更多',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'粘贴文本翻译',exact:true}).count(),0);
    await page.getByRole('button',{name:'脑图',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.messages.filter(message=>message.type==='START_TASK').at(-1).input.mode),'instant');
    await page.evaluate(async()=>{window.controller.acceptEvent({channel:'cgp',type:'TASK_EVENT',sessionId:'s1',requestId:'r1',state:'completed',text:'```mermaid\nmindmap\n  主题\n    分支\n      细节\n    另一项\n```'});await window.controller.state.rendering;});
    assert.equal(await page.locator('.cgp-mindmap-canvas svg').count(),1);assert.ok((await page.locator('.cgp-mindmap-canvas').textContent()).includes('细节'));
    await page.getByLabel('折叠节点',{exact:true}).selectOption('1');await page.getByRole('button',{name:'折叠节点',exact:true}).click();
    await page.getByRole('button',{name:'展开节点',exact:true}).waitFor();assert.equal((await page.locator('.cgp-mindmap-canvas').textContent()).includes('细节'),false);
    await page.getByRole('button',{name:'展开节点',exact:true}).click();await page.getByRole('button',{name:'折叠节点',exact:true}).waitFor();
    await page.getByRole('button',{name:'放大',exact:true}).click();await page.waitForFunction(()=>window.controller.state.mindmap.view.svg.style.transform==='scale(1.2)');
    await page.getByRole('button',{name:'适配视图',exact:true}).click();await page.waitForFunction(()=>window.controller.state.mindmap.view.svg.style.transform==='scale(1)');
    assert.ok(await page.locator('.cgp-mindmap-canvas svg').evaluate(svg=>svg.getBoundingClientRect().height<=361));
    await page.getByRole('button',{name:'大图查看',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#cgp-selection-root').shadowRoot.querySelector('.cgp-mindmap-expanded'));
    const expanded=await page.locator('.cgp-mindmap-result').boundingBox();
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    assert.equal(expanded.x,0);assert.equal(expanded.y,0);
    assert.equal(expanded.width,viewport.width);assert.equal(expanded.height,viewport.height);
    assert.equal(await page.evaluate(()=>document.fullscreenElement),null);
    assert.ok((await page.locator('.cgp-mindmap-canvas').boundingBox()).height>360);
    await page.screenshot({path:new URL('../docs/verification/mindmap-page-expanded.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
    await page.getByRole('button',{name:'折叠节点',exact:true}).click();
    await page.getByRole('button',{name:'展开节点',exact:true}).waitFor();
    assert.equal((await page.locator('.cgp-mindmap-canvas').textContent()).includes('细节'),false);
    await page.getByRole('button',{name:'收起大图',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#cgp-selection-root').shadowRoot.querySelector('.cgp-mindmap-expanded'));
    assert.equal(await page.evaluate(()=>document.fullscreenElement),null);
    assert.equal(await page.getByRole('dialog').count(),1);
    assert.equal((await page.locator('.cgp-mindmap-canvas').textContent()).includes('细节'),false);
    await page.getByRole('button',{name:'展开节点',exact:true}).click();
    await page.getByRole('button',{name:'折叠节点',exact:true}).waitFor();
    await page.getByRole('button',{name:'大图查看',exact:true}).click();
    await page.getByRole('button',{name:'收起大图',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('#cgp-selection-root').shadowRoot.querySelector('.cgp-mindmap-expanded'));
    assert.equal(await page.evaluate(()=>document.fullscreenElement),null);
    assert.equal(await page.getByRole('dialog').count(),1);
    for(const format of ['Markdown','SVG','PNG']){
      const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 '+format,exact:true}).click();const artifact=await download;const bytes=await readFile(await artifact.path());
      if(format==='PNG')assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);else assert.match(bytes.toString(),format==='SVG'?/<svg/:/```mermaid/);
    }
    await page.screenshot({path:new URL('../docs/verification/doubao-selection-mindmap.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
    await page.getByRole('button',{name:'大图查看',exact:true}).click();
    await page.getByRole('button',{name:'收起大图',exact:true}).waitFor();
    await page.evaluate(()=>window.controller.close());
    await page.waitForFunction(()=>!document.querySelector('#cgp-selection-root').shadowRoot.querySelector('.cgp-mindmap-expanded'));
    assert.equal(await page.evaluate(()=>document.fullscreenElement),null);
    assert.equal(await page.getByRole('dialog').count(),0);
  } finally {await browser.close();}
});

test('popup uses actual light/dark palettes and active Dark Reader overrides system dynamically in Edge', async () => {
  const bundled=await build({stdin:{contents:`import {createContentController} from './src/content/controller.js';
    let n=0;window.messages=[];window.controller=createContentController({document,chrome:{runtime:{sendMessage:async message=>{
      window.messages.push(message);if(message.type==='START_TASK')return {ok:true,sessionId:'theme-s'+(++n),requestId:'theme-r'+n};return {ok:true,stopped:true};}}}});
    window.controller.open({action:'ask',origin:'selection',selectedText:'主题测试原文。'},{left:120,bottom:80});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:800},colorScheme:'light'});
    await page.setContent('<!doctype html><title>主题测试</title><main style="padding:60px"><p id=target>当前阅读网页。</p></main>');await page.addScriptTag({content:bundled.outputFiles[0].text});
    await page.getByLabel('问题或追问').fill('测试主题');await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.evaluate(()=>window.controller.acceptEvent({channel:'cgp',type:'TASK_EVENT',sessionId:'theme-s1',requestId:'theme-r1',state:'completed',text:'**回答**和来源。\n\n```js\nconst theme = "auto";\n```',sources:[{title:'资料',url:'https://example.com'}]}));
    const background=()=>page.getByRole('dialog').evaluate(element=>getComputedStyle(element).backgroundColor);
    assert.equal(await background(),'rgb(255, 255, 255)');
    await page.screenshot({path:new URL('../docs/verification/popup-theme-light.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
    await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>window.controller.host.dataset.cgpTheme==='dark');
    assert.equal(await background(),'rgb(32, 35, 40)');assert.equal(await page.getByLabel('问题或追问').evaluate(element=>getComputedStyle(element).color),'rgb(237, 240, 244)');
    assert.equal(await page.locator('.cgp-result pre').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(45, 50, 58)');
    await page.screenshot({path:new URL('../docs/verification/popup-theme-dark.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
    await page.evaluate(()=>{const style=document.createElement('style');style.id='theme-dr';style.className='darkreader darkreader--user-agent';style.textContent='html{background-color:white}';document.head.append(style);});
    await page.waitForFunction(()=>window.controller.host.dataset.cgpTheme==='light');assert.equal(await background(),'rgb(255, 255, 255)');
    assert.deepEqual(await page.evaluate(()=>window.controller.handleMessage({channel:'cgp',type:'GET_PAGE_THEME'})),{ok:true,theme:'light',source:'darkreader'});
    await page.emulateMedia({colorScheme:'light'});
    await page.evaluate(()=>document.querySelector('#theme-dr').textContent='html{color-scheme:dark}');await page.waitForFunction(()=>window.controller.host.dataset.cgpTheme==='dark');assert.equal(await background(),'rgb(32, 35, 40)');
    await page.evaluate(()=>{getSelection().removeAllRanges();const range=document.createRange();range.selectNodeContents(document.querySelector('#target'));getSelection().addRange(range);window.controller.showSelection();});
    await page.getByRole('button',{name:'脑图',exact:true}).click();
    await page.waitForFunction(()=>Boolean(window.controller.state.requestId));
    await page.evaluate(async()=>{const state=window.controller.state;window.controller.acceptEvent({channel:'cgp',type:'TASK_EVENT',sessionId:state.sessionId,requestId:state.requestId,state:'completed',text:'```mermaid\nmindmap\n  主题\n    内容\n```'});await state.rendering;});
    assert.equal(await page.locator('.cgp-mindmap-canvas').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(32, 35, 40)');
    assert.equal(await page.locator('.cgp-mindmap-canvas svg text').first().evaluate(element=>getComputedStyle(element).fill),'rgb(237, 240, 244)');
    assert.equal(await page.locator('.cgp-mindmap-canvas svg style').first().getAttribute('class'),'darkreader cgp-mindmap-style');
    await page.evaluate(()=>document.querySelector('#theme-dr').remove());await page.waitForFunction(()=>window.controller.host.dataset.cgpTheme==='light');assert.equal(await background(),'rgb(255, 255, 255)');
    assert.ok(await page.evaluate(()=>window.messages.some(message=>message.type==='PAGE_THEME_CHANGED' && message.theme==='dark' && message.source==='darkreader')));
    await page.evaluate(()=>window.controller.dispose());
  } finally {await browser.close();}
});
