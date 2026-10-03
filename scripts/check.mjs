import { readFile, readdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await readFile(resolve(root,'dist/manifest.json'),'utf8'));
if(manifest.manifest_version!==3)throw new Error('Manifest V3 required');
if(manifest.action.default_title!=='')throw new Error('Action must have no extra brand title');
const refs=[manifest.background.service_worker,manifest.side_panel.default_path,manifest.options_ui.page,...manifest.content_scripts.flatMap(s=>s.js),...Object.values(manifest.icons || {}),...Object.values(manifest.action.default_icon || {})];
if(!manifest.permissions.includes('offscreen'))throw new Error('Offscreen permission required');
refs.push('offscreen.html','offscreen.js');
await Promise.all(refs.map(f=>access(resolve(root,'dist',f))));
const fontCss=await readFile(resolve(root,'dist/math/fonts.css'),'utf8');
const fontFaces=fontCss.match(/@font-face\{[^{}]+\}/g)||[];
const originalCss=await readFile(resolve(root,'node_modules/katex/dist/katex.min.css'),'utf8');
if(!fontFaces.length||fontFaces.length!==(originalCss.match(/@font-face/g)||[]).length)throw new Error('KaTeX font declarations were lost during build');
for(const face of fontFaces) {
 const urls=[...face.matchAll(/url\(([^)]+)\)/g)].map(match=>match[1]);
 if(urls.length!==1||!/^fonts\/[^/]+\.woff2$/.test(urls[0]))throw new Error('KaTeX font must use one bundled WOFF2 file');
 await access(resolve(root,'dist/math',urls[0]));
}
await access(resolve(root,'dist/math/katex.css'));
const files=await readdir(resolve(root,'src'),{recursive:true});let count=0;
for(const file of files.filter(f=>/\.js$/.test(f))) {
 const source=await readFile(resolve(root,'src',file),'utf8');count++;
 if(/\/api\/(?:auth|conversation)|backend-api|api\.openai\.com|document\.cookie|chrome\.cookies|localStorage\.getItem\([^)]*(?:token|auth)/i.test(source))throw new Error(`Forbidden native-account/API access in ${file}`);
 if(/\beval\s*\(|new Function\s*\(/.test(source))throw new Error(`Executable response risk in ${file}`);
}
console.log(`Manifest references valid; ${count} source files scanned for prohibited direct API/account access. This is a static check, not proof of live behavior.`);
