import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractMaterial, selectionContext } from '../src/features/materials.js';

function page(content) {
  return new JSDOM(`<!doctype html><html><head><title>Structured article</title></head><body><main><article>${content}</article></main></body></html>`, { url: 'https://example.test/article' });
}
const prose = '<p>An article paragraph supplies enough meaningful context for article extraction. Its statements refer to the examples below and their actual relationships.</p>'.repeat(4);

test('article extraction preserves exact highlighted code whitespace, empty lines and code fences', () => {
  const code = 'def solve():\n\tif ready:\n        run()  \n\n\n    return "```"\n';
  const dom = page(`${prose}<pre><code class="language-python">def solve():\n\t<span>if ready:</span>\n        run()  \n\n\n    return "\`\`\`"\n</code></pre><p>After the example.</p>`);
  try {
    const material = extractMaterial(dom.window.document);
    assert.ok(material.text.includes(`\`\`\`\`python\n${code}\`\`\`\``));
    assert.ok(material.text.includes('\n\nAfter the example.'));
    assert.equal(material.truncated, false);
  } finally { dom.window.close(); }
});

test('paragraphs remain distinct while prose source indentation is normalized', () => {
  const dom = page('<p>First    paragraph <strong>with emphasis</strong>.</p>\n    <p>Second\n    paragraph.</p>');
  try {
    const text = extractMaterial(dom.window.document).text;
    assert.ok(text.includes('First paragraph with emphasis.\n\nSecond paragraph.'));
  } finally { dom.window.close(); }
});

test('ordered list start/value and nested unordered levels survive extraction', () => {
  const dom = page(`${prose}<ol start="3"><li>First item<ul><li>Nested one</li><li>Nested two</li></ul></li><li value="7">Second item</li><li>Third item</li></ol>`);
  try {
    const text = extractMaterial(dom.window.document).text;
    assert.ok(text.includes('3. First item\n  - Nested one\n  - Nested two\n7. Second item\n8. Third item'), text);
  } finally { dom.window.close(); }
});

test('table rows retain separate cells, empty cells, caption and span annotations', () => {
  const dom = page(`${prose}<table><caption>Results</caption><thead><tr><th>Model</th><th>Return</th><th>Risk</th></tr></thead><tbody><tr><td>A</td><td>12%</td><td>3%</td></tr><tr><td>B</td><td></td><td>5% | 6%</td></tr><tr><td colspan="2">Joint result</td><td rowspan="2">Low</td></tr><tr><td>C</td><td>8%</td></tr></tbody></table>`);
  try {
    const text = extractMaterial(dom.window.document).text;
    assert.ok(text.includes('Results\n| Model | Return | Risk |'), text);
    assert.ok(text.includes('| A | 12% | 3% |\n| B |  | 5% \\| 6% |'), text);
    assert.ok(text.includes('| Joint result（跨2列） | Low（跨2行） |'), text);
  } finally { dom.window.close(); }
});

test('nearby context uses same structural extraction without altering selected code', () => {
  const dom = page('<p>Before.</p><pre id="code"><code>if ready:\n    run()\n\nfinish()</code></pre><ul><li>First item</li><li>Second item</li></ul>');
  try {
    const document = dom.window.document;
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#code code'));
    const selection = dom.window.getSelection(); selection.addRange(range);
    const result = selectionContext(selection, document, 'nearby');
    assert.equal(result.selectedText, 'if ready:\n    run()\n\nfinish()');
    assert.ok(result.context.text.includes('```\nif ready:\n    run()\n\nfinish()\n```'));
    assert.ok(result.context.text.includes('- First item\n- Second item'));
  } finally { dom.window.close(); }
});

test('nearby context preserves standalone list numbering and table row/cell relationships', () => {
  const dom = page('<ol start="3"><li>One</li><li id="item">Two</li><li>Three</li></ol><table><tbody><tr><th>Model</th><th>Risk</th></tr><tr><td id="cell">A</td><td>3%</td></tr><tr><td>B</td><td>5%</td></tr></tbody></table>');
  try {
    const document = dom.window.document;
    const selection = dom.window.getSelection();
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#item')); selection.addRange(range);
    assert.equal(selectionContext(selection, document, 'nearby').context.text, '3. One\n4. Two\n5. Three');
    const cellRange = document.createRange(); cellRange.selectNodeContents(document.querySelector('#cell')); selection.removeAllRanges(); selection.addRange(cellRange);
    assert.equal(selectionContext(selection, document, 'nearby').context.text, '| Model | Risk |\n| A | 3% |\n| B | 5% |');
  } finally { dom.window.close(); }
});

test('list serialization preserves content order after a nested list', () => {
  const dom = page(`${prose}<ul><li>Before nested<ul><li>Nested</li></ul><p>After nested</p></li></ul>`);
  try {
    const text = extractMaterial(dom.window.document).text;
    assert.ok(text.indexOf('Before nested') < text.indexOf('Nested'));
    assert.ok(text.indexOf('Nested') < text.indexOf('After nested'));
  } finally { dom.window.close(); }
});
