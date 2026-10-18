import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
test('Cloud upload package loads and routes real HTTP requests without any parent-directory source',async()=>{
  await run(process.execPath,[join(root,'tools/package-functions.mjs')],{cwd:root});
  const isolated=await mkdtemp(join(tmpdir(),'justelle-functions-package-'));
  try{
    for(const name of ['lib','package.json','package-lock.json'])await cp(join(root,'hosting/functions',name),join(isolated,name),{recursive:true});
    await run(process.platform==='win32'?'npm.cmd':'npm',['ci','--offline','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:isolated});
    const script=`import assert from 'node:assert/strict';
      const {privateApi,encryptedBackup}=await import('./lib/index.mjs');
      assert.equal(privateApi.__endpoint.platform,'gcfv2');
      assert.equal(encryptedBackup.__endpoint.platform,'gcfv2');
      const response=()=>({headersSent:false,writeHead(s,h){this.status=s;this.headers=h;},end(b){this.body=b;}});
      const health=response();await privateApi({url:'/api/healthz',originalUrl:'/api/healthz',method:'GET',headers:{}},health);
      assert.equal(health.status,200);assert.match(JSON.parse(health.body).version,/^[a-f0-9]{40}$/);
      const denied=response();await privateApi({url:'/api/respond',method:'POST',headers:{'content-type':'application/json'},rawBody:Buffer.from('{}')},denied);
      assert.equal(denied.status,401);
      console.log('Isolated deployment package passed');`;
    await writeFile(join(isolated,'verify.mjs'),script);
    const env={...process.env,JUSTELLE_MODE:'hosted-fictional',JUSTELLE_ROOM_ID:'fictional-room',JUSTELLE_ORIGIN:'https://fictional-qualification.web.app',
      FIREBASE_CONFIG:JSON.stringify({projectId:'fictional-qualification',storageBucket:'fictional-qualification.firebasestorage.app'})};
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    for(const k of Object.keys(env))if(k.endsWith('_EMULATOR_HOST')||k.includes('AI_KEY')||k.includes('BACKUP_CONFIG'))delete env[k];
    const result=await run(process.execPath,['verify.mjs'],{cwd:isolated,env});assert.match(result.stdout,/passed/);
  }finally{await rm(isolated,{recursive:true,force:true});}
});
