// Local-only preview runner. Two disposable fictional accounts, no cloud services.
import {spawn} from 'node:child_process';
import {readFile,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env,FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',
  FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9199'};
const children=[];
let temporaryCredentials=null,ending=false;
function launch(command,args,options={}) {
  const child=spawn(command,args,{cwd:root,env,stdio:'inherit',...options});
  children.push(child);
  child.on('error',err=>{console.error('Local service failed:',err.message);void finish(1);});
  return child;
}
async function finish(exitCode=0) {
  if(ending)return;
  ending=true;
  for(const child of children.reverse()) if(child.exitCode===null) child.kill('SIGTERM');
  if(temporaryCredentials) await unlink(temporaryCredentials).catch(()=>{});
  process.stdin.pause();
  process.exitCode=exitCode;
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(url) {
  for(let attempt=0;attempt<90;attempt++) {
    try { const response=await fetch(url);if(response.status<500)return; } catch{}
    await pause(450);
  }
  throw Error('Local service could not start: '+url);
}
async function createFictionalAccounts() {
  const processSeed=launch(process.execPath,['tests/seed-emulator.mjs'],{stdio:['ignore','pipe','inherit']});
  const completion=new Promise(resolve=>processSeed.once('close',resolve));
  let output='';
  for await (const chunk of processSeed.stdout) output+=chunk.toString('utf8');
  const code=await completion;
  if(code!==0)throw Error('Fictional emulator account seeding failed');
  temporaryCredentials=output.trim();
  return JSON.parse(await readFile(temporaryCredentials,'utf8'));
}
try {
  console.log('Justelle private local preview. Fictional data only.');
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
  launch(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'web','--host','127.0.0.1','--port','5173','--strictPort']);
  await Promise.all([waitFor('http://127.0.0.1:8787/respond'),waitFor('http://127.0.0.1:5173/')]);
  console.log('\nOpen http://127.0.0.1:5173/\n');
  console.log('Fictional local sign-in credentials (not committed):');
  for(const [key,person] of Object.entries(people)) console.log('  '+key.toUpperCase()+' : '+person.email+' / '+person.password);
  console.log('\nUse a different browser profile for each person. Ctrl+C stops the pilot.\n');
  process.once('SIGINT',()=>void finish(0));
  process.once('SIGTERM',()=>void finish(0));
  process.stdin.resume();
} catch(err) {
  console.error('Preview failed: '+err.message);
  await finish(1);
}
