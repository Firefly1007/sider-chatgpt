import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createContentController } from '../src/content/controller.js';
import { createDoubaoSuppression } from '../src/compat/doubao.js';
import { renderAnswer, renderSources } from '../src/ui/markdown.js';
import { createMindmapResult } from '../src/ui/mindmap-result.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(handler) {
  const dom = new JSDOM('<!doctype html><title>示例</title><main><p>前文指代介绍。</p><p>需要理解的目标。</p><p>后文补充解释。</p></main><input type=password value=secret>', { url: 'https://example.com/article', pretendToBeVisual: true });
  const messages = [];
  let counter = 0;
  const chrome = { runtime: { sendMessage: async message => {
    messages.push(message);
    if (handler) { const result = handler(message); if (result !== undefined) return result; }
    if (message.type === 'START_TASK') return { ok: true, sessionId: `s${++counter}`, requestId: `r${counter}` };
    if (message.type === 'FOLLOW_UP') return { ok: true, sessionId: message.sessionId, requestId: `r${++counter}` };
    if (message.type === 'UPDATE_SETTINGS') return { ok: true, settings: {manualMode: message.patch.manualMode} };
    if (message.type === 'STOP_TASK' || message.type === 'CLOSE_SESSION') return {ok:true,stopped:true};
    return { ok: true };
  } } };
  const controller = createContentController({ document: dom.window.document, chrome });
  return { dom, messages, controller };
}
const input = (action = 'explain') => ({action, origin: 'selection', selectedText: '目标', context: {text: '背景', scope: '选区附近文本', title: '示例', url: 'https://example.com', truncated: false}, targetLanguage: '中文'});
function emit(controller, state, text = '回答', extra = {}) {
  return controller.acceptEvent({ channel: 'cgp', type: 'TASK_EVENT', sessionId: controller.state.sessionId, requestId: controller.state.requestId, state, text, ...extra });
}

test('selection shows migrated toolbar without sending, and excludes password/UI selection', () => {
  const {dom, messages, controller} = fixture();
  const selection = dom.window.getSelection();
  const range = dom.window.document.createRange(); range.selectNodeContents(dom.window.document.querySelectorAll('p')[1]); selection.addRange(range);
  controller.showSelection();
  assert.equal(controller.shadow.querySelectorAll('[role=toolbar]').length, 1);
  assert.equal(messages.some(message=>message.type==='START_TASK'), false);
  range.selectNodeContents(controller.host); selection.removeAllRanges(); selection.addRange(range); controller.showSelection();
  assert.equal(controller.shadow.querySelectorAll('[role=toolbar]').length, 0);
  assert.equal(dom.window.document.querySelector('input').value, 'secret');
  controller.dispose();
});

test('selection toolbar directly starts mindmap without More or pasted translation', async () => {
  const {dom,controller,messages}=fixture();
  const selection=dom.window.getSelection();const range=dom.window.document.createRange();range.selectNodeContents(dom.window.document.querySelector('p'));selection.addRange(range);controller.showSelection();
  const toolbar=controller.shadow.querySelector('[role=toolbar]');
  assert.deepEqual([...toolbar.querySelectorAll('button')].map(button=>button.textContent),['问AI','翻译','解释','总结','AI 搜索','脑图']);
  assert.equal(toolbar.querySelector('[role=menu]'),null);
  assert.equal(messages.some(message=>message.type==='START_TASK'),false);
  toolbar.querySelector('[data-action=mindmap]').click();await tick();
  const sent=messages.find(message=>message.type==='START_TASK').input;
  assert.equal(sent.action,'mindmap');assert.equal(sent.mode,'instant');assert.equal(sent.origin,'selection');assert.equal(sent.selectedText,'前文指代介绍。');
  controller.dispose();
});

test('sidebar selection extraction reads only a current safe selection and errors when absent', () => {
  const {dom,controller,messages}=fixture();
  const request={channel:'cgp',type:'EXTRACT_SELECTION'};
  assert.equal(controller.handleMessage(request).error.code,'EMPTY_SELECTION');
  const selection=dom.window.getSelection(),range=dom.window.document.createRange();
  range.selectNodeContents(dom.window.document.querySelector('p'));selection.addRange(range);
  assert.equal(controller.handleMessage(request).selectedText,'前文指代介绍。');
  selection.removeAllRanges();
  assert.equal(controller.handleMessage(request).error.code,'EMPTY_SELECTION');
  assert.equal(messages.some(message=>message.type==='START_TASK'),false);
  controller.dispose();
});

test('selection attachment follows sidebar lifecycle, preserves selection and never starts a task', async () => {
  let resolveAppend;
  const {dom,controller,messages}=fixture(message => {
    if (message.type === 'GET_SIDEPANEL_STATE') return {ok:true,open:false};
    if (message.type === 'APPEND_SELECTION') return new Promise(resolve => {resolveAppend=resolve;});
  });
  const range=dom.window.document.createRange();range.selectNodeContents(dom.window.document.querySelector('p'));
  dom.window.getSelection().addRange(range);controller.showSelection();await tick();
  assert.equal(controller.shadow.querySelector('[data-action="append-selection"]'),null);
  controller.handleMessage({channel:'cgp',type:'SIDEPANEL_STATE_CHANGED',open:true});
  const action=controller.shadow.querySelector('[data-action="append-selection"]');
  assert.equal(action.textContent,'附加');
  const down=new dom.window.Event('pointerdown',{bubbles:true,cancelable:true});action.dispatchEvent(down);
  assert.equal(down.defaultPrevented,true);assert.equal(dom.window.getSelection().toString(),'前文指代介绍。');
  action.click();action.click();
  assert.equal(messages.filter(message=>message.type==='APPEND_SELECTION').length,1);
  assert.deepEqual(messages.find(message=>message.type==='APPEND_SELECTION'),{channel:'cgp',type:'APPEND_SELECTION'});
  resolveAppend({ok:true});await tick();assert.equal(action.textContent,'已附加');
  assert.equal(controller.state,null);assert.equal(messages.some(message=>message.type==='START_TASK'),false);
  action.click();resolveAppend({ok:false,error:{message:'ChatGPT 侧栏网页尚未连接'}});await tick();
  assert.match(controller.shadow.querySelector('[role="status"]').textContent,/尚未连接/);
  assert.equal(action.disabled,false);
  controller.handleMessage({channel:'cgp',type:'SIDEPANEL_STATE_CHANGED',open:false});
  assert.equal(controller.shadow.querySelector('[data-action="append-selection"]'),null);
  controller.dispose();
});

test('late sidebar status cannot restore attachment after a close event or removed selection', async () => {
  let resolveState;
  const {dom,controller}=fixture(message => message.type==='GET_SIDEPANEL_STATE' ? new Promise(resolve=>{resolveState=resolve;}) : undefined);
  const range=dom.window.document.createRange();range.selectNodeContents(dom.window.document.querySelector('p'));
  dom.window.getSelection().addRange(range);controller.showSelection();
  controller.handleMessage({channel:'cgp',type:'SIDEPANEL_STATE_CHANGED',open:false});
  resolveState({ok:true,open:true});await tick();
  assert.equal(controller.shadow.querySelector('[data-action="append-selection"]'),null);
  controller.showSelection();dom.window.getSelection().removeAllRanges();controller.showSelection();
  resolveState({ok:true,open:true});await tick();
  assert.equal(controller.shadow.querySelector('[role="toolbar"]'),null);controller.dispose();
});

test('selection mindmap uses instant temporary task protocol; invalid response retains code and retry', async () => {
  const {controller,messages}=fixture();controller.open(input('mindmap'));await tick();
  const sent=messages.find(message=>message.type==='START_TASK').input;assert.equal(sent.action,'mindmap');assert.equal(sent.mode,'instant');assert.equal(sent.origin,'selection');
  emit(controller,'completed','```mermaid\nflowchart TD\n A-->B\n```');await controller.state.rendering;
  assert.match(controller.state.query('.cgp-error').textContent,/脑图无法显示.*源码已保留/);assert.match(controller.state.query('.cgp-result').textContent,/flowchart TD/);assert.equal(controller.state.query('.cgp-result').hidden,false);assert.equal(controller.state.retry.disabled,false);
  await controller.retry();assert.equal(messages.filter(message=>message.type==='START_TASK').length,2);
  controller.dispose();
});

test('closing a mindmap while renderer is pending clears source and disposes late view', async () => {
  const dom=new JSDOM('<!doctype html>');let resolve;let disposals=0;
  const result=createMindmapResult(dom.window.document,{render:()=>new Promise(done=>{resolve=done;})});
  dom.window.document.body.append(result.element);
  const pending=result.update('```mermaid\nmindmap\n  主题\n    子项\n```');
  result.dispose();resolve({dispose:()=>{disposals++;}});
  assert.equal(await pending,false);assert.equal(disposals,1);assert.equal(result.element.querySelector('pre').textContent,'');assert.equal(result.view,null);assert.equal(result.element.hidden,true);
});

test('native diagram event previews sanitized inert SVG for an ordinary task and clears it on replacement', async () => {
  const {controller,dom}=fixture();controller.open(input());await tick();
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 240"><script>top.compromised=true</script><rect width="800" height="240" fill="white" onclick="alert(1)"/><foreignObject x="20" y="20" width="300" height="80"><div xmlns="http://www.w3.org/1999/xhtml">Neutral label<script>alert(1)</script><img src="https://invalid.example/tracker" onerror="alert(1)"/></div></foreignObject><a href="javascript:alert(1)"><text>link</text></a></svg>';
  emit(controller,'completed','A diagram accompanies this explanation.',{diagram:{svg}});await controller.state.rendering;
  const image=controller.state.mindmap.view.image;const clean=decodeURIComponent(image.getAttribute('src').split(',')[1]);
  assert.match(clean,/foreignObject/);assert.match(clean,/Neutral label/);assert.doesNotMatch(clean,/<script|onclick|onerror|javascript:|<img|<a\s|tracker/);
  assert.equal(controller.state.mindmap.element.querySelector('svg'),null);assert.equal(controller.state.query('.cgp-result').hidden,false);
  const show=[...controller.shadow.querySelectorAll('button')].find(button=>button.textContent==='放大查看');show.click();await tick();
  assert.ok(controller.shadow.querySelector('[aria-label="放大图表"] img'));
  controller.open(input('ask'));assert.equal(image.getAttribute('src'),null);assert.equal(controller.shadow.querySelector('[aria-label="放大图表"]'),null);
  assert.equal(dom.window.compromised,undefined);controller.dispose();
});

test('invalid native SVG leaves response and retry visible rather than reporting a rendered chart', async () => {
  const {controller}=fixture();controller.open(input('mindmap'));await tick();
  emit(controller,'completed','Neutral diagram description',{diagram:{svg:'<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"/>'}});await controller.state.rendering;
  assert.equal(controller.state.mindmap.element.hidden,true);assert.equal(controller.state.query('.cgp-result').hidden,false);
  assert.match(controller.state.query('.cgp-error').textContent,/图表尺寸无效.*可重试/);assert.equal(controller.state.retry.disabled,false);controller.dispose();
});

test('popup theme follows system then active Dark Reader and notifies changes; disposal stops observer', async () => {
  const dom=new JSDOM('<!doctype html><head></head><body><p>文章</p></body>',{url:'https://example.com'});
  const callbacks=new Set();const media={matches:false,addEventListener:(_,callback)=>callbacks.add(callback),removeEventListener:(_,callback)=>callbacks.delete(callback)};
  dom.window.matchMedia=()=>media;const messages=[];
  const controller=createContentController({document:dom.window.document,chrome:{runtime:{sendMessage:async message=>{messages.push(message);return {ok:true};}}}});
  assert.equal(controller.host.dataset.cgpTheme,'light');
  assert.deepEqual(controller.handleMessage({channel:'cgp',type:'GET_PAGE_THEME'}),{ok:true,theme:'light',source:'system'});
  assert.equal(controller.shadow.querySelector('style').classList.contains('darkreader'),true);
  media.matches=true;callbacks.forEach(callback=>callback());await tick();assert.equal(controller.host.dataset.cgpTheme,'dark');
  const style=dom.window.document.createElement('style');style.className='darkreader darkreader--user-agent';style.textContent='html{background:white}';dom.window.document.head.append(style);await tick();
  assert.equal(controller.host.dataset.cgpTheme,'light');assert.equal(controller.handleMessage({channel:'cgp',type:'GET_PAGE_THEME'}).source,'darkreader');
  style.textContent='html{color-scheme:dark}';await tick();assert.equal(controller.host.dataset.cgpTheme,'dark');
  style.remove();await tick();assert.equal(controller.handleMessage({channel:'cgp',type:'GET_PAGE_THEME'}).source,'system');
  const notices=messages.filter(message=>message.type==='PAGE_THEME_CHANGED');assert.deepEqual(notices.map(({theme,source})=>({theme,source})),[{theme:'light',source:'system'},{theme:'dark',source:'system'},{theme:'light',source:'darkreader'},{theme:'dark',source:'darkreader'},{theme:'dark',source:'system'}]);
  controller.dispose();assert.equal(callbacks.size,0);const count=messages.length;
  style.textContent='html{color-scheme:dark}';dom.window.document.head.append(style);await tick();assert.equal(messages.length,count);
});

test('confirmed sending waits for the answer with retry disabled and stop available', async () => {
  const {controller, messages} = fixture();
  controller.open(input()); await tick();
  emit(controller, 'waiting', '');
  assert.equal(controller.state.query('.cgp-state').textContent, '已发送，等待回答');
  assert.equal(controller.state.retry.disabled, true);
  assert.equal(controller.state.query('.cgp-send').disabled, true);
  assert.equal(controller.state.stop.disabled, false);
  await controller.submit('Must not submit while awaiting an answer');
  assert.equal(messages.some(message => message.type === 'FOLLOW_UP'), false);
  await controller.stop();
  assert.equal(messages.filter(message => message.type === 'STOP_TASK').length, 1);
  assert.equal(controller.state.state, 'stopped');
  controller.dispose();
});

test('timeout diagnostics remain in the current popup only and clear on the next round', async () => {
  const {controller} = fixture(); controller.open(input()); await tick();
  const diagnostics = { userConnected: true, stopVisible: false, messages: [] };
  emit(controller, 'waiting', '', { diagnostics });
  assert.equal(controller.state.state, 'waiting');
  assert.equal(controller.state.query('.cgp-error').textContent, '');
  assert.deepEqual(JSON.parse(controller.state.query('.cgp-error').dataset.cgpDiagnostics), diagnostics);
  emit(controller, 'failed', '', { error: { code: 'RESPONSE_NOT_CONFIRMED', message: '回答超时', diagnostics } });
  const error = controller.state.query('.cgp-error');
  assert.equal(error.textContent, '回答超时');
  assert.deepEqual(JSON.parse(error.dataset.cgpDiagnostics), diagnostics);
  await controller.submit('Next question');
  assert.equal(error.dataset.cgpDiagnostics, undefined);
  controller.dispose();
});

test('stop keeps text and same session for followup; close clears and invalidates late events', async () => {
  const {controller, messages} = fixture();
  controller.open(input()); await tick();
  emit(controller, 'streaming', '部分回答');
  const session = controller.state.sessionId;
  await controller.stop();
  assert.equal(controller.state.text, '部分回答');
  assert.equal(controller.state.sessionId, session);
  const oldRequest = controller.state.requestId;
  await controller.submit('继续');
  assert.equal(messages.find(message => message.type === 'FOLLOW_UP').sessionId, session);
  assert.notEqual(controller.state.requestId, oldRequest);
  controller.close();
  assert.equal(controller.state, null);
  assert.equal(controller.shadow.querySelector('[role=dialog]'), null);
  assert.equal(controller.acceptEvent({channel:'cgp',type:'TASK_EVENT',sessionId:session,requestId:oldRequest,state:'completed',text:'迟到'}), false);
  assert.equal(messages.at(-1).type, 'CLOSE_SESSION');
  controller.dispose();
});

test('interruption retains the answer and draft, blocks followup and restarts the original task explicitly', async () => {
  const { controller, messages } = fixture();
  controller.open(input('ask')); await controller.submit('original question');
  emit(controller, 'completed', 'First answer');
  await controller.submit('followup question');
  emit(controller, 'streaming', 'Keep this partial answer');
  controller.state.query('textarea').value = 'Keep this draft';
  controller.acceptEvent({ channel: 'cgp', type: 'TASK_EVENT', sessionId: controller.state.sessionId,
    requestId: controller.state.requestId, state: 'interrupted', error: { code: 'EXECUTION_LOST', message: 'Frame lost' } });
  assert.equal(controller.state.query('.cgp-send').disabled, true);
  assert.equal(controller.state.retry.textContent, '重新开始');
  assert.equal(controller.state.retry.disabled, false);
  await controller.submit('must not send');
  assert.equal(messages.filter(m => m.type === 'FOLLOW_UP').length, 1);
  assert.equal(controller.state.text, 'Keep this partial answer');
  assert.equal(controller.state.query('textarea').value, 'Keep this draft');
  await controller.retry();
  assert.equal(messages.filter(m => m.type === 'START_TASK').length, 2);
  assert.equal(messages.filter(m => m.type === 'START_TASK').at(-1).input.question, 'original question');
  assert.equal(controller.state.query('.cgp-send').disabled, true);
  controller.dispose();
});

test('a rejected followup preserves the displayed answer and input until a new task is accepted', async () => {
  const { controller } = fixture(m => m.type === 'FOLLOW_UP'
    ? { ok: false, error: { code: 'INVALID_SESSION', message: 'Session expired' } } : undefined);
  controller.open(input('ask')); await controller.submit('original question');
  emit(controller, 'completed', 'Saved answer');
  controller.state.query('textarea').value = 'Unsent followup';
  await controller.submit('Unsent followup');
  assert.equal(controller.state.text, 'Saved answer');
  assert.equal(controller.state.query('textarea').value, 'Unsent followup');
  assert.equal(controller.state.retry.textContent, '重新开始');
  assert.equal(controller.state.query('.cgp-send').disabled, true);
  controller.dispose();
});

test('new action replaces single popup and filters old session output', async () => {
  const {controller, messages} = fixture();
  controller.open(input('translate')); await tick();
  const old = {sessionId:controller.state.sessionId,requestId:controller.state.requestId};
  controller.open({...input('search'), selectedText:'新目标'}); await tick();
  assert.equal(controller.shadow.querySelectorAll('[role=dialog]').length, 1);
  assert.equal(controller.acceptEvent({channel:'cgp',type:'TASK_EVENT',...old,state:'completed',text:'旧回答'}), false);
  assert.equal(controller.state.text, '');
  assert.equal(messages.filter(message => message.type === 'START_TASK')[0].input.mode, 'instant');
  assert.equal(messages.some(message => message.type === 'CLOSE_SESSION' && message.sessionId === old.sessionId), true);
  controller.dispose();
});

test('close or replace while awaiting START_TASK ACK disposes returned stale session', async () => {
  let resolveFirst; let starts = 0;
  const {controller, messages} = fixture(message => {
    if (message.type === 'START_TASK' && ++starts === 1) return new Promise(resolve => {resolveFirst = resolve;});
  });
  controller.open(input()); controller.close();
  controller.open(input('translate')); await tick();
  resolveFirst({ok:true,sessionId:'stale',requestId:'old'}); await tick();
  assert.equal(controller.state.input.action, 'translate');
  assert.ok(messages.some(message => message.type === 'CLOSE_SESSION' && message.sessionId === 'stale'));
  controller.dispose();
});

test('stop before task ACK stops returned session while preserving popup', async () => {
  let resolve;
  const {controller,messages} = fixture(message => message.type === 'START_TASK' ? new Promise(done => {resolve = done;}) : undefined);
  controller.open(input()); await controller.stop();
  resolve({ok:true,sessionId:'pending',requestId:'pending-r'}); await tick();
  assert.equal(controller.state.state, 'stopped');
  assert.equal(controller.state.sessionId, 'pending');
  assert.ok(messages.some(message => message.type === 'STOP_TASK' && message.sessionId === 'pending'));
  controller.dispose();
});

test('events before ACK are replayed only for matching returned identity', async () => {
  let resolve;
  const {controller} = fixture(message => message.type === 'START_TASK' ? new Promise(done => {resolve = done;}) : undefined);
  controller.open(input());
  controller.acceptEvent({channel:'cgp',type:'TASK_EVENT',sessionId:'wrong',requestId:'wrong',state:'completed',text:'别人的回答'});
  controller.acceptEvent({channel:'cgp',type:'TASK_EVENT',sessionId:'s',requestId:'r',state:'completed',text:'正确回答'});
  resolve({ok:true,sessionId:'s',requestId:'r'}); await tick();
  assert.equal(controller.state.text, '正确回答'); assert.equal(controller.state.state, 'completed');
  controller.dispose();
});

test('unconfirmed native stop stays inside the task and blocks followup; close creates no toast', async () => {
  const {controller,messages} = fixture(message => ['STOP_TASK','CLOSE_SESSION'].includes(message.type)
    ? {ok:true,stopped:false,warning:{code:'STOP_UNCONFIRMED',message:'网页停止未确认'}} : undefined);
  controller.open(input());await tick();emit(controller,'streaming','部分回答');
  await controller.stop();assert.equal(controller.state.state,'interrupted');assert.equal(controller.state.text,'部分回答');
  assert.match(controller.state.query('.cgp-error').textContent,/网页停止未确认/);
  await controller.submit('继续');assert.equal(messages.some(message=>message.type==='FOLLOW_UP'),false);
  controller.close();await tick();assert.equal(controller.state,null);assert.equal(controller.shadow.querySelector('[role=alert]'),null);assert.equal(controller.shadow.querySelector('.cgp-notice'),null);
  controller.dispose();
});

test('unpinned outside click closes; pinned stays until explicit close', async () => {
  const {controller,dom,messages} = fixture();
  controller.open(input('ask'));
  assert.equal(messages.some(message => message.type === 'START_TASK'), false);
  controller.state.query('.cgp-options button').click();
  dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true})); assert.ok(controller.state);
  controller.state.query('.cgp-options button').click();
  dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown',{bubbles:true})); assert.equal(controller.state,null);
  controller.dispose();
});

test('actual capabilities and manual followup modes unlock after the quick first round; unavailable and busy choices remain blocked', async () => {
  const {controller,dom,messages} = fixture(message => {
    if (message.type === 'GET_CAPABILITIES') return {ok:true,capabilities:{modes:['instant','high'],unavailable:[{mode:'pro',label:'Pro',reason:'额度已用完'}]}};
  });
  controller.open(input('ask'));
  const selector = controller.state.query('select');
  assert.equal(selector.options.length,1);
  selector.dispatchEvent(new dom.window.Event('focus')); await tick();
  assert.deepEqual([...selector.options].map(option => option.value),['instant','high','pro']);
  assert.equal(selector.options[2].disabled,true); assert.match(selector.options[2].textContent,/额度已用完/);
  selector.value='instant'; selector.dispatchEvent(new dom.window.Event('change')); await tick();
  await controller.submit('问题'); emit(controller,'completed');
  assert.equal(selector.disabled,false);
  controller.open(input('explain')); await tick();
  assert.equal(messages.filter(message => message.type==='UPDATE_SETTINGS').length,1);
  assert.equal(messages.filter(message => message.type==='START_TASK').at(-1).input.mode,'instant');
  assert.equal(controller.state.query('select').disabled,true);
  emit(controller,'completed');
  const followup = controller.state.query('select');
  assert.equal(followup.disabled,false);
  followup.dispatchEvent(new dom.window.Event('focus')); await tick();
  followup.value='pro';followup.dispatchEvent(new dom.window.Event('change'));await tick();
  assert.equal(controller.state.mode,'instant');
  followup.value='high';followup.dispatchEvent(new dom.window.Event('change'));await tick();
  assert.equal(controller.state.mode,'high');assert.equal(messages.filter(message => message.type==='UPDATE_SETTINGS').length,2);
  await controller.submit('更深入解释');
  assert.equal(messages.filter(message => message.type==='FOLLOW_UP').at(-1).mode,'high');
  assert.equal(followup.disabled,true);
  followup.value='instant';followup.dispatchEvent(new dom.window.Event('change'));await tick();
  assert.equal(controller.state.mode,'high');
  emit(controller,'completed'); assert.equal(followup.disabled,false);
  controller.open(input('ask')); assert.equal(controller.state.mode,'high');
  controller.dispose();
});

test('safe markdown/source renderer strips script, handlers, images and dangerous URLs', () => {
  const dom = new JSDOM('<div id=answer></div><div id=sources></div>');
  const answer = dom.window.document.querySelector('#answer');
  renderAnswer(answer,'<script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">bad</a>\n\n**good** [valid](https://example.com/a)');
  assert.equal(answer.querySelector('script,img,[onerror]'),null);
  assert.equal(answer.querySelector('a').hasAttribute('href'),false);
  assert.equal(answer.querySelector('strong').textContent,'good');
  const sources=dom.window.document.querySelector('#sources');
  renderSources(sources,[{title:'bad',url:'javascript:x'},{title:'ok',url:'https://example.com'}]);
  assert.equal(sources.children.length,1); assert.equal(sources.firstElementChild.rel,'noopener noreferrer');
});

test('failed task exposes explicit login recovery, retry starts new request, extraction excludes UI', async () => {
  let attempts=0;
  const {controller,messages} = fixture(message => {
    if(message.type==='START_TASK' && ++attempts===1)return {ok:false,error:{code:'LOGIN_REQUIRED',message:'请登录 ChatGPT 后重试'}};
  });
  controller.open(input('translate'));await tick();
  assert.equal(controller.state.state,'failed');
  assert.equal(controller.state.query('.cgp-error').textContent,'请登录 ChatGPT 后重试');
  controller.state.query('.cgp-login button').click();await tick();
  assert.equal(messages.at(-1).type,'OPEN_LOGIN');
  assert.equal(controller.shadow.textContent.includes('转到侧栏'),false);
  await controller.retry();assert.equal(controller.state.sessionId,'s1');
  const material=controller.handleMessage({channel:'cgp',type:'EXTRACT_PAGE'});assert.equal(material.ok,true);assert.equal(material.material.text.includes('思考程度'),false);
  controller.handleMessage({channel:'cgp',type:'SETTINGS_CHANGED',settings:{enabled:false}});assert.equal(controller.state,null);
  controller.dispose();
});

test('Doubao suppression inspects new subtrees without rescanning the document on ordinary updates', async () => {
  const dom = new JSDOM('<main><p>text</p></main>');
  const doc = dom.window.document, query = doc.querySelectorAll.bind(doc); let fullScans = 0;
  doc.querySelectorAll = selector => { if (selector === '*') ++fullScans; return query(selector); };
  const suppression = createDoubaoSuppression(doc); suppression.setEnabled(true);
  assert.equal(fullScans, 1);
  for (let i = 0; i < 5; i++) { doc.querySelector('p').textContent = `update ${i}`; await tick(); }
  const subtree = doc.createElement('section'); subtree.innerHTML = '<div><doubao-ai-csui></doubao-ai-csui></div>';
  doc.body.append(subtree); await tick();
  assert.equal(subtree.querySelector('doubao-ai-csui').style.display, 'none');
  suppression.setEnabled(true);
  assert.equal(fullScans, 1);
  suppression.dispose(); dom.window.close();
});

test('Doubao suppression restores exact original styles and ignores similar page classes and our UI', async () => {
  const dom=new JSDOM('<div id=doubao-ai-csui style="display:flex!important"></div><div class=doubao-banner>网页</div><div data-cgp-ui id=own></div>');
  const doc=dom.window.document;
  const extra=doc.createElement('div'); const root=extra.attachShadow({mode:'open'}); const body=doc.createElement('body');body.id='cici-inline-container';body.innerHTML='<div class=cici-ext-container></div>';root.append(body);doc.body.append(extra);
  const own=doc.querySelector('#own'); own.attachShadow({mode:'open'}).innerHTML='<div id=x class=cici-ext-container></div>';
  const suppression=createDoubaoSuppression(doc); suppression.setEnabled(true);
  assert.equal(doc.querySelector('#doubao-ai-csui').style.display,'none'); assert.equal(extra.style.display,'none');
  assert.equal(doc.querySelector('.doubao-banner').style.display,''); assert.equal(own.style.display,'');
  const added=doc.createElement('doubao-ai-translate-image-assistant');doc.body.append(added);await tick();assert.equal(added.style.display,'none');
  // Real installed Doubao rewrites a recognized host to display:block on showing it.
  const known=doc.querySelector('#doubao-ai-csui');known.style.cssText='display:block;color:red';
  await tick();assert.equal(known.style.display,'none');assert.equal(known.style.getPropertyPriority('display'),'important');assert.equal(known.style.color,'red');
  const closed=doc.createElement('doubao-ai-csui');closed.attachShadow({mode:'closed'});doc.body.append(closed);await tick();assert.equal(closed.style.display,'none');
  closed.style.setProperty('display','block','important');await tick();assert.equal(closed.style.display,'none');
  const replacements=doc.createElement('doubao-ai-csui');added.replaceWith(replacements);await tick();assert.equal(replacements.style.display,'none');
  suppression.setEnabled(false);assert.equal(doc.querySelector('#doubao-ai-csui').style.display,'flex');assert.equal(doc.querySelector('#doubao-ai-csui').style.getPropertyPriority('display'),'important');assert.equal(extra.style.display,'');
  known.style.display='grid';await tick();assert.equal(known.style.display,'grid');assert.equal(closed.style.display,'');assert.equal(replacements.style.display,'');
  suppression.dispose();
});
