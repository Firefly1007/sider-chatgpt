import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('local mindmap renders, collapses, fits and exports SVG/PNG/Markdown in an isolated browser', { timeout: 90000 }, async () => {
  const bundle = await build({
    stdin: { contents: 'export * from "./src/features/mindmap.js";', resolveDir: process.cwd(), sourcefile: 'features-browser-entry.js' },
    bundle: true, write: false, format: 'iife', globalName: 'FeatureSmoke', platform: 'browser',
  });
  // Existing Edge is Chromium-based; no browser install or user profile is used.
  const hasEdge = process.platform === 'win32' && existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
  const browser = await chromium.launch({ headless: true, ...(hasEdge ? { channel: 'msedge' } : {}) });
  try {
    const context = await browser.newContext();
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><body><div id="map" style="width:900px;height:600px"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const evidence = await page.evaluate(async () => {
      const code = 'mindmap\n  root((Topic))\n    First\n      Detail\n    click 事件\n    CSS style 属性';
      const view = await FeatureSmoke.renderMindmap(document.querySelector('#map'), code);
      const initialText = view.svg.textContent;
      await view.setCollapsed(1, true);
      const collapsedText = view.svg.textContent;
      await view.setCollapsed(1, false);
      const restoredText = view.svg.textContent;
      view.setZoom(1.5);
      const zoomed = view.svg.style.transform;
      view.fit();
      const fitted = view.svg.style.maxWidth;
      const svg = view.exportSVG();
      const png = await view.exportPNG({ scale: 1 });
      const markdown = view.exportMarkdown();
      const image = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('SVG export did not open')); image.src = url; });
      const dimensions = [image.naturalWidth, image.naturalHeight];
      URL.revokeObjectURL(url);
      const bytes = [...new Uint8Array(await png.slice(0, 8).arrayBuffer())];
      view.dispose();
      return { initialText, collapsedText, restoredText, zoomed, fitted, pngType: png.type, pngSize: png.size, bytes, markdown, svgHasScript: svg.includes('<script'), dimensions, disposed: document.querySelector('#map').children.length === 0 };
    });
    assert.ok(evidence.initialText.includes('Detail'));
    assert.ok(evidence.initialText.includes('click 事件'));
    assert.ok(evidence.initialText.includes('CSS style 属性'));
    assert.ok(!evidence.collapsedText.includes('Detail'));
    assert.ok(evidence.restoredText.includes('Detail'));
    assert.equal(evidence.zoomed, 'scale(1.5)');
    assert.equal(evidence.fitted, '100%');
    assert.equal(evidence.pngType, 'image/png');
    assert.ok(evidence.pngSize > 100);
    assert.deepEqual(evidence.bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(evidence.markdown.startsWith('```mermaid\nmindmap'));
    assert.equal(evidence.svgHasScript, false);
    assert.ok(evidence.dimensions.every((dimension) => dimension > 0));
    assert.equal(evidence.disposed, true);
  } finally { await browser.close(); }
});
