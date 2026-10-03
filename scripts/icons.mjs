import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const svg=await readFile(resolve(root,'public/icons/assistant.svg'),'utf8');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 for(const size of [16,32,48,128]) {
  const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
  await page.screenshot({path:resolve(root,`public/icons/assistant-${size}.png`),omitBackground:true});
  await page.close();
 }
} finally {await browser.close();}
console.log('Created original speech/code icon at 16, 32, 48 and 128 pixels.');
