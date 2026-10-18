import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const version=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const result=await build({entryPoints:[resolve(root,'hosting/functions/index.mjs')],outfile:resolve(root,'hosting/functions/lib/index.mjs'),
  bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',
  define:{__JUSTELLE_VERSION__:JSON.stringify(version)},metafile:true});
if(Object.values(result.metafile.outputs).some(o=>o.imports.some(i=>i.path.startsWith('.'))))
  throw Error('Functions package still refers to files outside the deployment package');
