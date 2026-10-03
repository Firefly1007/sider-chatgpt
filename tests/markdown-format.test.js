import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { extractAnswerText } from '../src/chatgpt/adapter.js';
import { renderAnswer } from '../src/ui/markdown.js';

const native = `<h2>格式保留</h2><p><strong>重要结论（说明）</strong>不能丢失，<em>斜体</em>和<del>删除线</del>也一样。</p>
<h5>五级标题</h5><h6>六级标题</h6><blockquote><p>引用中的<strong>重点</strong></p></blockquote>
<ol start="3"><li>第三步<ul><li>嵌套项目</li></ul></li><li>第四步</li></ol>
<ul><li><input type="checkbox" checked disabled>已完成</li><li><input type="checkbox" disabled>未完成</li></ul>
<table><thead><tr><th>名称</th><th align="right">值</th></tr></thead><tbody><tr><td>甲</td><td align="right">42</td></tr></tbody></table>
<p>行内 <code>**不要加粗** $x$</code> 和 <a href="https://example.com/">链接</a>。</p>
<pre><code class="language-js">const value = "**原样代码**";\n  console.log(value);</code></pre><hr>`;

test('native rich text survives library conversion and Markdown rendering with its semantics', () => {
  const dom = new JSDOM(`<div class="markdown">${native}</div><div id="answer"></div>`);
  const document = dom.window.document, answer = document.getElementById('answer');
  try {
    renderAnswer(answer, extractAnswerText(document.querySelector('.markdown')));
    assert.equal(answer.querySelector('strong').textContent, '重要结论（说明）');
    assert.equal(answer.querySelector('em').textContent, '斜体');
    assert.equal(answer.querySelector('del').textContent, '删除线');
    assert.equal(answer.querySelector('h5').textContent, '五级标题');
    assert.equal(answer.querySelector('h6').textContent, '六级标题');
    assert.equal(answer.querySelector('blockquote strong').textContent, '重点');
    assert.equal(answer.querySelector('ol').start, 3);
    assert.equal(answer.querySelector('ol ul li').textContent, '嵌套项目');
    assert.deepEqual([...answer.querySelectorAll('input')].map(input => [input.checked, input.disabled]), [[true, true], [false, true]]);
    assert.equal(answer.querySelector('table tbody td:last-child').textContent, '42');
    assert.equal(answer.querySelector('th:last-child').getAttribute('align'), 'right');
    assert.equal(answer.querySelector('p code').textContent, '**不要加粗** $x$');
    assert.equal(answer.querySelector('pre code').textContent.trimEnd(), 'const value = "**原样代码**";\n  console.log(value);');
    assert.equal(answer.querySelector('.katex'), null);
    assert.equal(answer.querySelector('a').getAttribute('rel'), 'noopener noreferrer');
    assert.ok(answer.querySelector('hr'));
  } finally { dom.window.close(); }
});

test('native literal HTML and entity text survive conversion without creating elements', () => {
  const dom = new JSDOM('<div class="markdown"></div><div id="answer"></div>');
  const document = dom.window.document, source = document.querySelector('.markdown'), answer = document.getElementById('answer');
  const text = '显示 <div>、<script> 和 &lt;span&gt;，保留 A & B。';
  source.textContent = text;
  renderAnswer(answer, extractAnswerText(source));
  assert.equal(answer.textContent.trim(), text);
  assert.equal(answer.querySelector('div,script,span'), null);
  dom.window.close();
});

test('CJK extension handles the actual raw-star sentence, nested emphasis, and streaming completion', () => {
  const dom = new JSDOM('<div id="answer"></div>'), answer = dom.window.document.getElementById('answer');
  try {
    renderAnswer(answer, '**Zero Reinforcement Learning（Zero-RL，零强化学习）**就是：这是*斜体（说明）*内容。');
    assert.equal(answer.querySelector('strong').textContent, 'Zero Reinforcement Learning（Zero-RL，零强化学习）');
    assert.equal(answer.querySelector('em').textContent, '斜体（说明）');
    assert.ok(!answer.textContent.includes('*'));
    renderAnswer(answer, '***同时强调（中文）***内容');
    assert.ok(answer.querySelector('em strong, strong em'));
    renderAnswer(answer, '**未完成'); assert.equal(answer.textContent.trim(), '**未完成');
    renderAnswer(answer, '**未完成（现已补齐）**继续'); assert.equal(answer.querySelector('strong').textContent, '未完成（现已补齐）');
    renderAnswer(answer, '\\*原样星号\\* 和 \\_原样下划线\\_，以及 `**代码**`');
    assert.equal(answer.querySelector('em,strong'), null); assert.ok(answer.textContent.includes('*原样星号*'));
    renderAnswer(answer, '<input type="file"><input type="checkbox" checked><img src="https://example.com/x" onerror="alert(1)">');
    assert.equal(answer.querySelector('input[type=file],img,[onerror]'), null); assert.equal(answer.querySelector('input').disabled, true);
  } finally { dom.window.close(); }
});

test('formatted native reply has visible typography in the actual popup', async () => {
  const bundle = await build({ stdin: { contents: `import {createContentController} from './src/content/controller.js';
    import {extractAnswerText} from './src/chatgpt/adapter.js';
    window.nativeText=extractAnswerText;
    window.controller=createContentController({document,chrome:{runtime:{sendMessage:async message=>message.type==='START_TASK'?{ok:true,sessionId:'s',requestId:'r'}:{ok:true}}}});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1350 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><main><p>Markdown rendering preview</p></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async html => {
      const holder = document.createElement('div'); holder.className = 'markdown'; holder.innerHTML = html;
      window.controller.open({ action: 'ask', origin: 'selection', selectedText: '格式预览' });
      await window.controller.submit('Preview');
      window.controller.acceptEvent({ channel: 'cgp', type: 'TASK_EVENT', sessionId: 's', requestId: 'r', state: 'completed', text: window.nativeText(holder) });
    }, native);
    const result = page.locator('.cgp-result');
    assert.equal(await result.locator('strong').first().evaluate(el => getComputedStyle(el).fontWeight), '700');
    assert.equal(await result.locator('em').evaluate(el => getComputedStyle(el).fontStyle), 'italic');
    assert.match(await result.locator('del').evaluate(el => getComputedStyle(el).textDecorationLine), /line-through/);
    assert.equal(await result.locator('blockquote').evaluate(el => getComputedStyle(el).borderLeftWidth), '3px');
    assert.equal(await result.locator('ol').evaluate(el => getComputedStyle(el).listStyleType), 'decimal');
    assert.equal(await result.locator('table th').first().evaluate(el => getComputedStyle(el).borderTopWidth), '1px');
    assert.ok(await result.locator('h2').evaluate(el => parseFloat(getComputedStyle(el).fontSize) > parseFloat(getComputedStyle(el.parentElement).fontSize)));
    assert.ok(await result.locator('pre code').evaluate(el => /Consolas|monospace/.test(getComputedStyle(el).fontFamily)));
    await page.screenshot({ path: 'docs/verification/markdown-format.png' });
  } finally { await browser.close(); }
});
