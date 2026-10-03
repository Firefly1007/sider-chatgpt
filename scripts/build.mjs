import { build } from 'esbuild';
import { mkdir, readdir, copyFile, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const outdir = resolve(root, 'dist');
if (relative(root, outdir) !== 'dist') throw new Error('Build output must be the project dist directory');
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const inputs = new Set();
async function bundle(options) {
  const result = await build({ ...options, metafile: true });
  for (const input of Object.keys(result.metafile.inputs)) inputs.add(resolve(root, input));
  return result;
}
const base = { bundle: true, target: 'chrome120', platform: 'browser', sourcemap: false, logLevel: 'warning', legalComments: 'eof' };
await bundle({ ...base, entryPoints: [resolve(root, 'src/background/index.js')], outfile: resolve(outdir, 'background.js'), format: 'esm' });
await bundle({ ...base, entryPoints: [resolve(root, 'src/chatgpt/index.js')], outfile: resolve(outdir, 'chatgpt.js'), format: 'iife' });
await bundle({ ...base, entryPoints: [resolve(root, 'src/offscreen/index.js')], outfile: resolve(outdir, 'offscreen.js'), format: 'iife' });
await writeFile(resolve(outdir, 'content-loader.js'), "import(chrome.runtime.getURL('content.js')).catch(console.error);\n");
await bundle({ ...base, entryPoints: { content: resolve(root, 'src/content/index.js'), sidepanel: resolve(root, 'src/sidepanel/index.js'), options: resolve(root, 'src/options/index.js') }, outdir, format: 'esm', splitting: true, chunkNames: 'chunks/[name]-[hash]' }).then(async r => {
  await mkdir(resolve(root, 'docs/verification'), { recursive: true });
  await writeFile(resolve(root, 'docs/verification/build-meta.json'), JSON.stringify(r.metafile, null, 2));
});
for (const entry of await readdir(resolve(root, 'public'), { withFileTypes: true })) {
  await cp(resolve(root, 'public', entry.name), resolve(outdir, entry.name), { recursive: entry.isDirectory() });
}
const mathDir = resolve(outdir, 'math');
await mkdir(resolve(mathDir, 'fonts'), { recursive: true });
const mathCss = await readFile(resolve(root, 'node_modules/katex/dist/katex.min.css'), 'utf8');
const fontFaces = mathCss.match(/@font-face\s*\{[^}]*\}/g) || [];
if (!fontFaces.length) throw new Error('KaTeX font declarations are missing');
await writeFile(resolve(mathDir, 'fonts.css'), fontFaces.join('\n').replace(/src:([^;}]*);?/g, (_match, value) => {
  const woff2 = value.split(',').find(source => source.includes('.woff2'));
  if (!woff2) throw new Error('KaTeX WOFF2 font is missing');
  return `src:${woff2};`;
}));
await writeFile(resolve(mathDir, 'katex.css'), mathCss.replace(/@font-face\s*\{[^}]*\}/g, ''));
for (const name of await readdir(resolve(root, 'node_modules/katex/dist/fonts'))) {
  if (name.endsWith('.woff2')) await copyFile(resolve(root, 'node_modules/katex/dist/fonts', name), resolve(mathDir, 'fonts', name));
}
const licenses=[];
const packages = new Map();
for (const input of inputs) {
 if (!input.includes('node_modules')) continue;
 let directory = dirname(input);
 while (directory !== root && directory !== dirname(directory)) {
  try {
   const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
   if (manifest.name && manifest.version) { packages.set(directory, manifest); break; }
  } catch {}
  directory = dirname(directory);
 }
}
for(const [path,manifest] of [...packages].sort((a,b)=>a[1].name.localeCompare(b[1].name))) {
 const names=(await readdir(path)).filter(name=>/^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
 const texts=[];for(const name of names) {try{texts.push(await readFile(resolve(path,name),'utf8'));}catch{}}
 licenses.push(`${manifest.name} ${manifest.version}\n${manifest.license||''}\n${texts.join('\n')}`);
}
await writeFile(resolve(outdir,'THIRD-PARTY-NOTICES.txt'),licenses.join('\n\n----------\n\n'));
console.log(`Built extension: ${outdir}`);
