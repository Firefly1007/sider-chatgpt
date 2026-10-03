import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import katex from 'katex';
import { extractAnswerText } from '../src/chatgpt/adapter.js';

const render = (tex, displayMode = false, output = 'htmlAndMathml') => katex.renderToString(tex, { displayMode, output });
function extract(html, prepare = () => {}) {
  const dom = new JSDOM(`<div data-markdown-text-style="assistant-message">${html}</div>`);
  prepare(dom.window.document);
  const text = extractAnswerText(dom.window.document.body);
  dom.window.close();
  return text;
}

test('native KaTeX inline math preserves TeX once with surrounding prose before hidden markup cleanup', () => {
  const tex = String.raw`\frac{a}{b} + x^2`;
  assert.equal(extract(`Before ${render(tex)} after.`, document => {
    document.querySelector('.katex-mathml').setAttribute('aria-hidden', 'true');
  }), `Before \\(${tex}\\) after.`);
});

test('native display KaTeX and standalone block MathML preserve separate display delimiters', () => {
  const tex = String.raw`\sum_{i=1}^{n} i`;
  for (const output of ['htmlAndMathml', 'mathml']) {
    assert.equal(extract(`Before${render(tex, true, output)}After`), `Before\n\n\\[${tex}\\]\n\nAfter`);
  }
});

test('mixed native inline and display formulas retain order without HTML/MathML duplicates', () => {
  const inline = 'x+y', block = String.raw`E=mc^2`;
  assert.equal(extract(`<p>Inline ${render(inline)}.</p>${render(block, true)}<p>Then ${render('z')}.</p>`),
    `Inline \\(${inline}\\).\n\n\\[${block}\\]\n\nThen \\(z\\).`);
});

test('code and pre math examples are not promoted into native formulas', () => {
  const tex = String.raw`\frac{1}{2}`;
  const text = extract(`<p>Literal <code>$x$</code>.</p><pre><code class="language-html">${render(tex)}</code></pre>`);
  assert.ok(text.startsWith('Literal `$x$`.'));
  assert.ok(text.includes('```html\n')); assert.ok(text.includes(tex));
  assert.equal(text.includes('\\('), false); assert.equal(text.includes('\\['), false);
});

test('native math without explicit TeX source retains existing readable fallback', () => {
  assert.equal(extract(`Before ${render('x+y')} after.`, document => {
    document.querySelector('annotation').remove();
  }), 'Before x+y after.');
});
