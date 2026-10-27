// Small conservative path policy; unknown runtime changes require hosted qualification.
import {execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const interfaceFiles=new Set([
  'styles.css','index.html','manifest.webmanifest','justelle-caricature.png',
  'planner-ui.mjs','booking-ui.mjs','journey-view.mjs',
  'today-essentials.mjs','adventure-feedback.mjs','instruction-core.mjs','topics.mjs'
].map(p=>'private-app/web/'+p));
const policyFiles=new Set(['.github/workflows/justelle-private-app.yml',
  'scripts/release-scope.mjs','scripts/release-scope.test.mjs',
  'scripts/hosted-qualification-policy.mjs','scripts/hosted-qualification-policy.test.mjs']);
export function releaseScope(paths){
  if(paths===null)return {code:true,windows:true,hosted:true};
  const relevant=paths.filter(p=>policyFiles.has(p)||p.startsWith('private-app/')&&!p.endsWith('.md'));
  return {
    code:relevant.length>0,
    windows:relevant.some(p=>policyFiles.has(p)||[
      'private-app/tools/preview.mjs','private-app/tests/preview.test.mjs',
      'private-app/package.json','private-app/package-lock.json','private-app/firebase/firebase.json'
    ].includes(p)),
    hosted:relevant.some(p=>policyFiles.has(p)||!interfaceFiles.has(p)&&!p.startsWith('private-app/tests/'))
  };
}
export function requireHostedEvidence(paths,hostedPassed){
  if(releaseScope(paths).hosted&&hostedPassed!==true)
    throw Error('Hosted qualification required for changes since the last verified release');
}
export function changedPaths(base,head='HEAD'){
  if(!/^[a-f0-9]{40}$/.test(base||'')||/^0+$/.test(base))return null;
  return execFileSync('git',['diff','--no-renames','--name-only','-z',base,head],{encoding:'utf8'})
    .split('\0').filter(Boolean);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  const base=event.pull_request?.base?.sha||event.before;
  let paths=null;
  if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'){
    try{paths=changedPaths(base);}catch{ /* Missing history fails safe to full checks. */ }
  }
  for(const [key,value] of Object.entries(releaseScope(paths))){
    console.log(key+'='+value);
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,key+'='+value+'\n');
  }
}
