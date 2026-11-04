import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=name=>readFile(path.join(root,name),'utf8');
const [html,css,content,app]=await Promise.all(['index.html','style.css','content.js','app.js'].map(read));
const names=[...new Set([...content.matchAll(/['"]([^'"\n]+\.webp)['"]/g)].map(m=>m[1]))];
const assets={};
for(const name of names)assets[name]='data:image/webp;base64,'+(await readFile(path.join(root,'assets',name))).toString('base64');
const logo='data:image/svg+xml;base64,'+(await readFile(path.join(root,'assets/firelink.svg'))).toString('base64');
const safe=code=>code.replaceAll('</script','<\\/script');
const result=html
 .replace('href="assets/firelink.svg"',`href="${logo}"`)
 .replace('<link rel="stylesheet" href="style.css">',`<style>${css}</style>`)
 .replace('<script src="content.js" defer></script>','')
 .replace('<script src="app.js" defer></script>','')
 .replace('</body>',`<script>window.FIRELINK_ASSETS=${JSON.stringify(assets)};\n${safe(content)}\n${safe(app)}</script>\n</body>`);
const output=path.join(root,'FireLink-结题汇报.html');
await writeFile(output,result);
console.log(`Built offline presentation (${(Buffer.byteLength(result)/1024/1024).toFixed(2)} MiB): ${output}`);
