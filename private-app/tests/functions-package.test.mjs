import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assertAuthorizedEndpointRoster,validateGeneratedFunctionsScope} from '../hosting/functions-scope.mjs';
const run=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
test('Cloud upload package loads and routes real HTTP requests without any parent-directory source',async()=>{
  await run(process.execPath,[join(root,'tools/package-functions.mjs')],{cwd:root});
  const isolated=await mkdtemp(join(tmpdir(),'justelle-functions-package-'));
  try{
    const functionsDirectory=join(isolated,'functions');
    await mkdir(functionsDirectory);
    for(const name of ['lib','package.json','package-lock.json'])await cp(join(root,'hosting/functions',name),join(functionsDirectory,name),{recursive:true});
    const npmArgs=['ci','--offline','--omit=dev','--ignore-scripts','--no-audit','--no-fund'];
    await run(process.platform==='win32'?(process.env.ComSpec||'cmd.exe'):'npm',process.platform==='win32'?['/d','/s','/c','npm.cmd '+npmArgs.join(' ')]:npmArgs,{cwd:functionsDirectory});
    const configPath=join(isolated,'firebase.json');
    await writeFile(configPath,JSON.stringify({functions:[{source:'functions',codebase:'gateway',runtime:'nodejs22'}]}));
    const scope=await validateGeneratedFunctionsScope({configPath,projectId:'justelle-qualification'});
    assert.deepEqual(scope,{codebase:'gateway',endpointCount:2});
    assert.throws(()=>assertAuthorizedEndpointRoster([{id:'privateApi'},{id:'otherEndpoint'}]),
      error=>error.scopeCode==='ENDPOINT_ROSTER_MISMATCH');
    assert.throws(()=>assertAuthorizedEndpointRoster([{id:'privateApi'}]),
      error=>error.scopeCode==='ENDPOINT_ROSTER_MISMATCH');
    assert.throws(()=>assertAuthorizedEndpointRoster([{id:'encryptedBackup'}]),
      error=>error.scopeCode==='ENDPOINT_ROSTER_MISMATCH');
    assert.throws(()=>assertAuthorizedEndpointRoster([{id:'privateApi'},{id:'encryptedBackup'},{id:'extraEndpoint'}]),
      error=>error.scopeCode==='ENDPOINT_ROSTER_MISMATCH');
    const extraCodebasePath=join(isolated,'extra-codebase.firebase.json');
    await writeFile(extraCodebasePath,JSON.stringify({functions:[
      {source:'functions',codebase:'gateway',runtime:'nodejs22'},
      {source:'other',codebase:'other',runtime:'nodejs22'}
    ]}));
    await assert.rejects(validateGeneratedFunctionsScope({configPath:extraCodebasePath,projectId:'justelle-qualification'}),
      error=>error.scopeCode==='CODEBASE_COUNT_MISMATCH');
    const missingFunctionsPath=join(isolated,'missing-functions.firebase.json');
    await writeFile(missingFunctionsPath,JSON.stringify({functions:[{source:'functions',codebase:'other',runtime:'nodejs22'}]}));
    await assert.rejects(validateGeneratedFunctionsScope({configPath:missingFunctionsPath,projectId:'justelle-qualification'}),
      error=>error.scopeCode==='CODEBASE_CONFIG_MISMATCH');
    const script=`import assert from 'node:assert/strict';
      const {privateApi,encryptedBackup}=await import('./functions/lib/index.mjs');
      assert.equal(privateApi.__endpoint.platform,'gcfv2');
      assert.equal(encryptedBackup.__endpoint.platform,'gcfv2');
      const response=()=>({headersSent:false,writeHead(s,h){this.status=s;this.headers=h;},end(b){this.body=b;}});
      const health=response();await privateApi({url:'/api/healthz',originalUrl:'/api/healthz',method:'GET',headers:{}},health);
      assert.equal(health.status,200);assert.match(JSON.parse(health.body).version,/^[a-f0-9]{40}$/);
      const denied=response();await privateApi({url:'/api/respond',method:'POST',headers:{'content-type':'application/json'},rawBody:Buffer.from('{}')},denied);
      assert.equal(denied.status,401);
      const logged=[],originalError=console.error;
      process.env.JUSTELLE_ORIGIN='invalid-runtime-origin';
      try{
        console.error=message=>logged.push(message);
        await assert.rejects(encryptedBackup.run({}),/Encrypted backup failed; review private provider monitoring/);
      }finally{console.error=originalError;}
      assert.equal(logged.length,1);
      assert.equal(JSON.parse(logged[0]).event,'encrypted_backup_failed');
      assert.equal(logged[0].includes('invalid-runtime-origin'),false);
      console.log('Isolated deployment package passed');`;
    await writeFile(join(isolated,'verify.mjs'),script);
    const env={...process.env,JUSTELLE_MODE:'hosted-fictional',JUSTELLE_ROOM_ID:'fictional-room',JUSTELLE_ORIGIN:'https://fictional-qualification.web.app',
      FIREBASE_CONFIG:JSON.stringify({projectId:'fictional-qualification',storageBucket:'fictional-qualification.firebasestorage.app'})};
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    for(const k of Object.keys(env))if(k.endsWith('_EMULATOR_HOST')||k.includes('AI_KEY')||k.includes('BACKUP_CONFIG'))delete env[k];
    const result=await run(process.execPath,['verify.mjs'],{cwd:isolated,env});assert.match(result.stdout,/passed/);
  }finally{await rm(isolated,{recursive:true,force:true});}
});
