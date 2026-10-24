// Owner-controlled paper recovery key entry for one-time setup and independent restore.
// No file, argument, environment variable, shell history or console echo carries the key.
// Use only in an uncaptured local terminal, never in CI or an agent-run shell.
import {timingSafeEqual} from 'node:crypto';

/**
 * Decode a cryptographically generated 32-byte recovery key printed as hex
 * (64 digits, optional spaces/dashes) or canonical Base64 (44 characters).
 * This validates length and encoding, not the entropy of its generation.
 * Never print or log the argument or the returned Buffer.
 */
export function decodePrintedRecoveryKey(value){
  if(typeof value!=='string')throw Error('A printed 32-byte recovery key is required');
  const hex=value.replace(/[\s-]/g,'');
  if(/^[a-fA-F0-9]{64}$/.test(hex))return Buffer.from(hex,'hex');
  const b64=value.replace(/\s/g,'');
  if(/^[A-Za-z0-9+/]{43}=$/.test(b64)){
    const bytes=Buffer.from(b64,'base64');
    if(bytes.length===32&&bytes.toString('base64')===b64)return bytes;
    bytes.fill(0);
  }
  throw Error('Printed recovery key must be 64 hexadecimal characters or 44 canonical Base64 characters');
}

// Input is intentionally read in raw mode: readline/Read-Host can echo the
// secret or place it in history. Only a genuine owner-controlled local TTY
// can be used, never redirected stdin or a captured agent execution.
function hiddenTTYLine(input,output,prompt){
  return new Promise((resolve,reject)=>{
    const chars=[];
    let finished=false;
    function finish(error){
      if(finished)return;
      finished=true;
      input.off('data',onData);
      input.off('end',onEnd);
      output.write('\n');
      const entered=error?null:chars.join('');
      chars.fill('');
      if(error)reject(error);else resolve(entered);
    }
    function onEnd(){finish(Error('Private recovery key entry was interrupted'));}
    function onData(data){
      for(const ch of data.toString('utf8')){
        if(ch==='\r'||ch==='\n'){finish(null);return;}
        if(ch==='\x03'||ch==='\x04'||ch==='\x1b'){
          finish(Error('Private recovery key entry was cancelled'));return;
        }
        if(ch==='\b'||ch==='\x7f'){chars.pop();continue;}
        if(ch<' '||ch>'~'||chars.length>=128){
          finish(Error('Invalid recovery key input; nothing was installed'));return;
        }
        chars.push(ch);
      }
    }
    input.on('data',onData);
    input.once('end',onEnd);
    output.write(prompt);
  });
}

export async function readPaperRecoveryKey({input=process.stdin,output=process.stderr}={}){
  // Injected fictional TTYs enable deterministic tests in CI. The real CLI
  // can never use its actual stdin from a CI environment.
  if((input===process.stdin&&(process.env.CI||process.env.GITHUB_ACTIONS))||
     input?.isTTY!==true||output?.isTTY!==true||typeof input.setRawMode!=='function')
    throw Error('Paper recovery entry requires a private owner-controlled interactive terminal');
  const priorRaw=Boolean(input.isRaw);
  let first,second;
  try{
    input.setRawMode(true);
    input.resume();
    const firstText=await hiddenTTYLine(input,output,'Enter printed Justelle recovery key (input hidden): ');
    first=decodePrintedRecoveryKey(firstText);
    const secondText=await hiddenTTYLine(input,output,'Re-enter the printed key to verify (input hidden): ');
    second=decodePrintedRecoveryKey(secondText);
    if(!timingSafeEqual(first,second))throw Error('Printed key entries do not match; nothing was installed');
    return first;
  }catch(error){
    first?.fill(0);
    throw error;
  }finally{
    second?.fill(0);
    input.setRawMode(priorRaw);
    input.pause();
  }
}
