import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderAnswer } from '../src/ui/markdown.js';

function render(text) {
  const dom = new JSDOM('<div id="answer"></div>');
  const answer = dom.window.document.getElementById('answer');
  renderAnswer(answer, text); return answer;
}
test('Markdown and all four math delimiters render with accessible original TeX', () => {
  const answer = render(String.raw`**公式** $x_1^2$ 和 \(\frac{a}{b}\)。

$$\sum_{i=1}^n i$$

\[\begin{bmatrix}1 & 2\\3 & 4\end{bmatrix}\]

| 值 | 公式 |
|---|---|
| A | $\sqrt{x}$ |`);
  assert.equal(answer.querySelector('strong').textContent, '公式');
  assert.equal(answer.querySelectorAll('.katex').length, 5);
  assert.equal(answer.querySelectorAll('.katex-display').length, 2);
  assert.equal(answer.querySelectorAll('table .katex').length, 1);
  assert.equal(answer.querySelector('annotation').textContent, 'x_1^2');
});
test('code, escaped dollars and ordinary currency remain text', () => {
  const answer = render('`$x^2$` and `\\(x\\)`\n\n```latex\n$$x^2$$\n```\n\n\\$5 and $20 to $30.');
  assert.equal(answer.querySelectorAll('.katex').length, 0);
  assert.equal(answer.querySelector('pre code').textContent.trim(), '$$x^2$$');
  assert.ok(answer.textContent.includes('$5 and $20 to $30.'));
});
test('incomplete streaming and invalid TeX are readable and subsequent complete updates render', () => {
  const answer = render(String.raw`等待 \(\frac{a_1}{`);
  assert.ok(answer.textContent.includes(String.raw`\(\frac{a_1}{`));
  assert.equal(answer.querySelectorAll('.katex').length, 0);
  renderAnswer(answer, String.raw`完成 \(\frac{a_1}{b}\)`);
  assert.equal(answer.querySelectorAll('.katex').length, 1);
  renderAnswer(answer, String.raw`坏公式 $$\unknownCommand{x}$$ 后续 **文字**`);
  assert.ok(answer.textContent.includes(String.raw`$$\unknownCommand{x}$$`));
  assert.equal(answer.querySelector('strong').textContent, '文字');
});
test('math cannot inject HTML, navigation, external images or endless macro expansion', () => {
  const answer = render(String.raw`<img src=x onerror=alert(1)><script>alert(2)</script>
\(\href{javascript:alert(1)}{X}\)
\(\includegraphics{https://example.test/private}\)
\(\htmlStyle{position:fixed}{X}\)
\(\def\a{\a}\a\)
**Still readable**`);
  assert.equal(answer.querySelector('script,img,iframe,[onerror],a[href^="javascript:"]'), null);
  assert.equal(answer.querySelector('strong').textContent, 'Still readable');
  assert.ok(answer.textContent.includes(String.raw`\def\a{\a}\a`));
});
