// Local-only preview runner. Two disposable fictional accounts, no cloud services.
// Handles entire subprocess trees so Windows does not leave Java emulators running.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env,FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',
  FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9199'};
const isWindows=process.platform==='win32';
const children=[];
let temporaryCredentials=null,ending=false;
function launch(command,args,options={}) {
  const child=spawn(command,args,{
    cwd:root,env,stdio:['ignore','inherit','inherit'],
    detached:!isWindows,...options
  });
  children.push(child);
  child.on('error',err=>{
    if(!ending)console.error('Local service failed:',err.message);
    void finish(1);
  });
  return child;
}
async function stopTree(child) {
  if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;
  if(isWindows){
    // Terminating just firebase's Node wrapper can strand its Java children.
    // taskkill /T targets this runner's child process tree, not other programs.
    await new Promise(resolve=>{
      const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],
        {stdio:'ignore',windowsHide:true});
      killer.once('error',()=>{
        try{child.kill('SIGTERM');}catch{}
        resolve();
      });
      killer.once('close',resolve);
    });
  }else{
    // Each non-Windows child owns its process group (including Java subprocesses).
    try{process.kill(-child.pid,'SIGTERM');}
    catch{try{child.kill('SIGTERM');}catch{}}
  }
}
async function finish(exitCode=0) {
  if(ending)return;
  ending=true;
  console.log('\nStopping the fictional Justelle pilot and its local emulators…');
  for(const child of children.slice().reverse())await stopTree(child);
  if(temporaryCredentials)await unlink(temporaryCredentials).catch(()=>{});
  process.stdin.pause();
  process.exitCode=exitCode;
}
// Install handlers immediately, including while emulators are still starting.
process.once('SIGINT',()=>void finish(0));
process.once('SIGTERM',()=>void finish(0));
// In Windows PowerShell, Ctrl+C can interrupt a batch job before Java is cleaned up.
// Giving input only to this runner avoids npm's "Terminate batch job?" prompt.
process.stdin.setEncoding('utf8');
process.stdin.on('data',text=>{
  if(text.trim().toLowerCase()==='q')void finish(0);
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verifyFreePort(port) {
  await new Promise((resolve,reject)=>{
    const server=createServer();
    server.once('error',err=>{
      reject(err.code==='EADDRINUSE'
        ?Error('Port '+port+' is occupied. A previous emulator may still be running. Stop it before restarting Justelle.')
        :err);
    });
    server.listen(port,'127.0.0.1',()=>server.close(resolve));
  });
}
async function waitFor(url) {
  for(let attempt=0;attempt<90;attempt++){
    if(ending)throw Error('Emulator process ended before services became ready');
    try{await fetch(url);return;}catch{}
    await pause(450);
  }
  throw Error('Local service could not start: '+url);
}
async function createFictionalAccounts() {
  const seed=launch(process.execPath,['tests/seed-emulator.mjs'],
    {stdio:['ignore','pipe','inherit']});
  const completion=new Promise(resolve=>seed.once('close',resolve));
  let output='';
  for await(const chunk of seed.stdout)output+=chunk.toString('utf8');
  const code=await completion;
  if(code!==0)throw Error('Fictional emulator account seeding failed');
  temporaryCredentials=output.trim();
  return JSON.parse(await readFile(temporaryCredentials,'utf8'));
}
try{
  console.log('Justelle private local preview. Fictional data only.');
  // Fail with a useful explanation rather than connecting to an unrelated process.
  for(const port of [8081,9099,9199,4400,5173,8787]){
    if(ending)break;
    await verifyFreePort(port);
  }
  if(ending)throw Error('Preview stopped before startup');
  const emulators=launch(process.execPath,[
    join(root,'node_modules/firebase-tools/lib/bin/firebase.js'),
    'emulators:start','--project','demo-justelle-pilot','--only','auth,firestore,storage'
  ],{cwd:join(root,'firebase')});
  emulators.on('exit',()=>{if(!ending)void finish(1);});
  await Promise.all([
    waitFor('http://127.0.0.1:9099/'),
    waitFor('http://127.0.0.1:8081/'),
    waitFor('http://127.0.0.1:9199/')
  ]);
  const people=await createFictionalAccounts();
  launch(process.execPath,['ai/server.mjs']);
  launch(process.execPath,[
    join(root,'node_modules/vite/bin/vite.js'),
    'web','--host','127.0.0.1','--port','5173','--strictPort'
  ]);
  await Promise.all([
    waitFor('http://127.0.0.1:8787/respond'),
    waitFor('http://127.0.0.1:5173/')
  ]);
  console.log('\nOpen http://127.0.0.1:5173/\n');
  console.log('Fictional local sign-in credentials (not committed):');
  for(const [key,person] of Object.entries(people))
    console.log('  '+key.toUpperCase()+' : '+person.email+' / '+person.password);
  console.log('\nUse a different browser profile for each person.');
  console.log('To stop safely, type q and press Enter. Ctrl+C is also supported.\n');
  process.stdin.resume();
}catch(err){
  if(!ending)console.error('Preview failed:',err.message);
  await finish(1);
}
