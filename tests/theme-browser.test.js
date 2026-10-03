import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('actual browser detects Dark Reader mode and sidebar palette overrides opposite system theme', { timeout: 90000 }, async () => {
  const bundle = await build({ stdin: { contents: 'export * from "./src/shared/theme.js";', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'Theme' });
  const hasEdge = process.platform === 'win32' && existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
  const browser = await chromium.launch({ headless: true, ...(hasEdge ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ colorScheme: 'dark' });
    await page.setContent('<!doctype html><html><head><style>html{color-scheme:dark}</style></head><body><button>工具</button></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const results = await page.evaluate(() => {
      const style = document.createElement('style'); style.className = 'darkreader darkreader--user-agent'; style.textContent = 'body{background:#fff}'; document.head.append(style);
      const light = Theme.readPageTheme(document);
      style.textContent = 'html{color-scheme:dark!important}'; const dark = Theme.readPageTheme(document);
      style.media = 'not all'; const inactive = Theme.readPageTheme(document); style.remove();
      return { light, dark, inactive };
    });
    assert.deepEqual(results, { light: { theme: 'light', source: 'darkreader' }, dark: { theme: 'dark', source: 'darkreader' }, inactive: { theme: 'dark', source: 'system' } });
    await page.addStyleTag({ content: readFileSync(new URL('../public/sidepanel.css', import.meta.url), 'utf8').replace(/^@import[^;]+;/u, '') });
    const light = await page.evaluate(() => { document.documentElement.dataset.cgpTheme = 'light'; return { background: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color, scheme: getComputedStyle(document.documentElement).colorScheme }; });
    assert.deepEqual(light, { background: 'rgb(255, 255, 255)', text: 'rgb(36, 36, 36)', scheme: 'light' });
    await page.emulateMedia({ colorScheme: 'light' });
    const dark = await page.evaluate(() => { document.documentElement.dataset.cgpTheme = 'dark'; return { background: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color, scheme: getComputedStyle(document.documentElement).colorScheme }; });
    assert.deepEqual(dark, { background: 'rgb(32, 33, 35)', text: 'rgb(238, 238, 238)', scheme: 'dark' });
  } finally { await browser.close(); }
});
