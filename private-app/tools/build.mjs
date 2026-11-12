import {spawn} from 'node:child_process';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const child=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'build','web','--outDir','../dist','--emptyOutDir'],{cwd:root,stdio:'inherit'});
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
if(code!==0)throw Error('Private application build failed');
await mkdir(join(root,'dist'),{recursive:true});
// Preserve stable Home Screen icon/manifest paths without touching public artwork.
for(const file of ['manifest.webmanifest','justelle-caricature.png'])await copyFile(join(root,'web',file),join(root,'dist',file));
const html=await readFile(join(root,'dist/index.html'),'utf8');
if(!html.includes('assets/')||html.includes('/main.mjs'))throw Error('Private build has unresolved source modules');
const worker=await readFile(join(root,'web/offline-shell-worker.js'),'utf8');
if(!worker.includes('__CACHE_VERSION__'))throw Error('Offline shell worker is missing its build version marker');
const cacheVersion=createHash('sha256').update(html).update(worker).digest('hex').slice(0,16);
await writeFile(join(root,'dist/offline-shell-worker.js'),worker.replaceAll('__CACHE_VERSION__',cacheVersion));
