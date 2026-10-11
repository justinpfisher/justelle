import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cwd=fileURLToPath(new URL('../',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('Single pilot command boots Auth/Firestore/Storage, two fake accounts, mock gateway and web app', {timeout:125000},async()=>{
  const child=spawn(process.execPath,['tools/preview.mjs'],{cwd,stdio:['pipe','pipe','pipe']});
  const closed=new Promise(resolve=>child.once('close',resolve));
  let output='',error='';
  child.stdout.on('data',data=>{output+=data.toString();if(output.length>200000)output=output.slice(-200000);});
  child.stderr.on('data',data=>{error+=data.toString();if(error.length>200000)error=error.slice(-200000);});
  try {
    let ready=false;
    for(let i=0;i<170;i++){
      if(output.includes('Fictional local sign-in credentials')) {
        try {
          const app=await fetch('http://127.0.0.1:5173/');
          const gateway=await fetch('http://127.0.0.1:8787/respond');
          ready=app.ok && gateway.status===404;
          if(ready) {
            const html=await app.text();
            assert.match(html,/Justelle/);
            assert.match(output,/pilot-a@example.invalid/);
            assert.match(output,/pilot-b@example.invalid/);
            break;
          }
        }catch{}
      }
      if(child.exitCode!==null) break;
      await delay(500);
    }
    assert.equal(ready,true,'Local pilot command did not become ready (no production hosts were accessed).');
  } finally {
    if(child.exitCode===null)child.kill('SIGINT');
    await Promise.race([closed,delay(8000)]);
    if(child.exitCode===null)child.kill('SIGTERM');
  }
});
