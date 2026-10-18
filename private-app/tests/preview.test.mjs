import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';

const cwd=fileURLToPath(new URL('../',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function portFree(port){
  return new Promise(resolve=>{
    const server=createServer();
    server.once('error',()=>resolve(false));
    server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));
  });
}
test('Local pilot boots and q-to-quit releases all Firebase/AI/web ports', {timeout:130000},async()=>{
  const child=spawn(process.execPath,['tools/preview.mjs'],{
    cwd,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'
  });
  const closed=new Promise(resolve=>child.once('close',resolve));
  let output='',error='';
  child.stdout.on('data',d=>{output+=d.toString();if(output.length>200000)output=output.slice(-200000);});
  child.stderr.on('data',d=>{error+=d.toString();if(error.length>200000)error=error.slice(-200000);});
  let stoppedCleanly=false;
  try {
    let ready=false;
    for(let i=0;i<170;i++){
      if(output.includes('Fictional local sign-in credentials')){
        try{
          const app=await fetch('http://127.0.0.1:5173/');
          const gateway=await fetch('http://127.0.0.1:8787/respond');
          ready=app.ok&&gateway.status===404;
          if(ready){
            assert.match(await app.text(),/Justelle/);
            assert.match(output,/pilot-a@example.invalid/);
            assert.match(output,/pilot-b@example.invalid/);
            break;
          }
        }catch{}
      }
      if(child.exitCode!==null)break;
      await delay(500);
    }
    if(!ready){
      const diagnostic=(output+'\n'+error).split('\n')
        .filter(line=>/Error|failed|emulators:|firebase|Cannot find|not ready/i.test(line))
        .filter(line=>!line.includes('@example.invalid')).slice(-12).join(' | ').slice(0,1500);
      assert.fail('Pilot did not start. Diagnostic: '+diagnostic);
    }
    // This path is cross-platform, including the Windows/npm batch-job case.
    // Do not send OS-level SIGINT to the subprocess: that masks Java-child leaks.
    child.stdin.write('q\n');
    const code=await Promise.race([closed,delay(15000).then(()=>undefined)]);
    assert.equal(code,0,'Pilot must exit cleanly when q is entered');
    stoppedCleanly=true;
    const ports=[8081,9099,9199,8787,5173,4400];
    let allFree=false;
    for(let i=0;i<30;i++){
      allFree=(await Promise.all(ports.map(portFree))).every(Boolean);
      if(allFree)break;
      await delay(250);
    }
    assert.equal(allFree,true,'Pilot shutdown left a Firebase or application port occupied');
  } finally {
    if(!stoppedCleanly){
      if(process.platform!=='win32'){try{process.kill(-child.pid,'SIGKILL');}catch{}}
      else if(child.exitCode===null)child.kill('SIGTERM');
    }
    await Promise.race([closed,delay(8000)]);
    if(child.exitCode===null)child.kill('SIGKILL');
  }
});
