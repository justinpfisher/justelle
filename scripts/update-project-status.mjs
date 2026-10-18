// Mirrors evidence recorded in milestone GitHub issues; it never claims to run a live deployment test.
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const BEGIN='<!-- JUSTELLE_MILESTONE_STATUS_START -->';
const END='<!-- JUSTELLE_MILESTONE_STATUS_END -->';
const gh='https://github.com/justinpfisher/justelle';

export function acceptanceItems(body) {
  const section=String(body||'').match(/^## Acceptance checklist\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if(!section)throw Error('Milestone issue is missing the expected acceptance checklist heading');
  const rows=[...section[1].matchAll(/^\s*- \[([ xX])\] (.+)$/gm)]
    .map(x=>({done:x[1].toLowerCase()==='x',text:x[2].trim()}));
  if(!rows.length)throw Error('Milestone issue has no checkable acceptance criteria');
  return rows;
}

export function calculateMilestones(config,issues,pr) {
  if(config.schema!==1||!Array.isArray(config.milestones)||!config.milestones.length)
    throw Error('Invalid milestone configuration');
  const rows=config.milestones.map(m=>{
    const issue=issues.get(m.issue);
    if(!issue||typeof issue.body!=='string')throw Error('Missing milestone issue #'+m.issue);
    if(!issue.title.startsWith(m.id+' — '))throw Error('Milestone #'+m.issue+' has an unexpected title');
    const items=acceptanceItems(issue.body),done=items.filter(x=>x.done).length,total=items.length;
    const complete=issue.state==='closed'&&done===total;
    const needsReview=issue.state==='closed'&&done!==total;
    return {...m,done,total,complete,needsReview,checked:done===total,
      next:items.find(x=>!x.done)?.text||null};
  });
  if(new Set(rows.map(x=>x.issue)).size!==rows.length||new Set(rows.map(x=>x.id)).size!==rows.length)
    throw Error('Duplicate milestone ID/issue');
  const first=rows.find(x=>!x.complete);
  const styled=rows.map(m=>({...m,status:m.complete?'Complete':m.needsReview?'Review needed':
    m.checked?'Ready for review':m.id===first?.id?'Current':m.done>0?'In progress':'Upcoming'}));
  const v1=rows.filter(x=>x.release==='V1');
  const ready=v1.length>0&&v1.every(x=>x.complete);
  const pr5=pr?.merged_at?'Merged source (not proof of deployment)':
    pr?.state==='closed'?'Closed without merging':
    pr?.draft?'Draft development PR':pr?.state==='open'?'Open development PR':'Unknown';
  return {rows:styled,next:styled.find(x=>x.id===first?.id)||null,
    completed:rows.filter(x=>x.complete).length,
    ready,v1Completed:v1.filter(x=>x.complete).length,v1Count:v1.length,pr5};
}
function link(m){return '['+m.id+' — '+m.title+']('+gh+'/issues/'+m.issue+')';}
function table(data){return data.rows.map(m=>
  '| '+link(m)+' | '+m.release+' | '+m.done+'/'+m.total+' | '+m.status+' |').join('\n');}

export function renderFrontPage(data){
  const live=data.ready?
    '**Private app:** V1 milestones accepted (consult the real release evidence in M4).':
    '**Private app: NOT VERIFIED LIVE.** Source and emulator tests do not constitute hosted/iPhone acceptance.';
  const now=data.next?
    '**Now:** '+link(data.next)+'. Next acceptance: '+(data.next.next||'Verify and close the milestone.') :
    '**Now:** All tracked milestone acceptance criteria are recorded as complete.';
  return [BEGIN,'','## Where we are — Justelle project','',
    live+' **'+data.completed+'/'+data.rows.length+' milestones accepted**, including a development-only foundation; **'+
    data.v1Completed+'/'+data.v1Count+' V1 delivery milestones accepted**.','',now,'',
    '| Milestone | Horizon | Criteria | Status |','| --- | --- | ---: | --- |',table(data),'',
    '**[Detailed status and verification boundaries](docs/WHERE-WE-ARE.md)** · '+
      '[Release issue #4]('+gh+'/issues/4) · [Private-app PR #5]('+gh+'/pull/5) ('+data.pr5+')','',
    'Updated automatically from evidence checklists and milestone issue state. Recorded acceptance is not a separate live-system test. '+
      'The public [justelle.life](https://justelle.life/) homepage is unchanged.','',END].join('\n');
}

export function renderDetails(data){
  const now=data.next?
    '## Immediate next evidence\n\n**'+link(data.next)+'** is the first incomplete milestone. '+
    'Next unchecked acceptance criterion:\n\n> '+(data.next.next||'Attach evidence and close the milestone issue.')+
    '\n\nOnly check this when verified. See [implementation Issue #4]('+gh+'/issues/4).':
    '## Immediate next evidence\n\nAll tracked milestones are accepted. Reassess the product vision before expanding scope.';
  const m1Complete=data.rows.find(m=>m.id==='M1')?.complete===true;
  const live=data.ready?
    'V1 milestone criteria accepted; verify actual production state in M4 before saying the service is live.':
    m1Complete?
      'NOT VERIFIED LIVE. Shared adventures and recoverable history passed source, emulator and iPhone-sized browser checks; hosted qualification and real-member production remain unverified.':
      'NOT VERIFIED LIVE. The earlier private chat pilot and itinerary data model have development tests, not a qualified public-facing private planner.';
  return ['# Justelle — Where we are','',
    '**Private application:** '+live,'',
    '**Accepted milestones:** '+data.completed+'/'+data.rows.length+'. **V1 release milestones:** '+
      data.v1Completed+'/'+data.v1Count+'. **Private-app PR #5:** '+data.pr5+'.','',
    'This page is generated from issues #20–#27. Checkboxes are evidence-tracking controls, not proof of a live app.','',
    '## Roadmap','',
    '| Milestone | Horizon | Criteria | Recorded status |','| --- | --- | ---: | --- |',table(data),'',
    now,'',
    '## Verified evidence versus outstanding work','',
    '- **M0:** Fictional two-member browser/emulator checks, encrypted independent recovery, prepared hosting/AI source, '+
      'and a pure itinerary model were exercised. This is a **development** milestone, not a hosted pass.',
    m1Complete?
      '- **M1 (development):** Two-member shared records, immutable booking/history, original media and encrypted independent recovery passed fictional emulator/browser tests. '+ 
        '[Merged PR #29]('+gh+'/pull/29) · [Passing CI]('+gh+'/actions/runs/39061319556). This is not hosted or production evidence.':
      '- **M1:** New authenticated plan/booking history and independently restorable record types still need qualification.',
    '- **M2–M3:** The complete journey-first visual experience and bounded AI assistance remain future acceptance work; the M1 planner is a small functional slice.',
    '- **M4:** Real Firebase environments, protected original media, cloud B2 restoration, physical iPhone Home Screen, '+
      'production access and tested rollback must pass before the app is called live.',
    '- **M5–M7:** Today/offline/research, Windows/OneDrive permanent archives and mature usability follow the first launch. '+
      '[The archive policy](BACKUP-ARCHIVE-POLICY.md) is approved, but its automation is not live.','',
    '## Keeping this view current','',
    'Each milestone has one issue with an **Acceptance checklist**. Developers and AI agents must link verified evidence '+
      'and check off criteria as they are met; close the issue only when every criterion passes. '+
      '[The status workflow](../.github/workflows/project-status.yml) reads checklist and issue open/closed state '+
      'and regenerates the repository README and this document on acceptance/PR-state changes and daily recovery fallback. '+
      'It never triggers a deployment, expands access or spends money.','',
    'A closed issue with unchecked criteria appears as **Review needed**, while an all-checked open issue appears '+
      'as **Ready for review**. If the update workflow fails, the displayed page may be stale: '+
      '[check its runs]('+gh+'/actions/workflows/project-status.yml) and read the issues directly.','',
    '**Related:** [Issue #4]('+gh+'/issues/4) · [PR #5]('+gh+'/pull/5) · '+
      '[Archive implementation #19]('+gh+'/issues/19) · [Product vision](PRODUCT-VISION.md).',''].join('\n');
}

export function replaceReadmeStatus(readme,block){
  const a=readme.indexOf(BEGIN),b=readme.indexOf(END);
  if(a!==-1||b!==-1){
    if(a<0||b<a||readme.indexOf(BEGIN,a+1)!==-1||readme.indexOf(END,b+1)!==-1)
      throw Error('Malformed README status markers');
    return readme.slice(0,a)+block+readme.slice(b+END.length);
  }
  const first=readme.match(/^# [^\n]+\n/);
  if(!first)throw Error('README is missing its original title');
  return first[0]+'\n'+block+'\n'+readme.slice(first[0].length);
}
async function getApi(path,repo,token){
  const response=await fetch('https://api.github.com/repos/'+repo+'/'+path,{
    headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,
      'X-GitHub-Api-Version':'2022-11-28','User-Agent':'justelle-milestone-view'}});
  if(!response.ok)throw Error('GitHub API '+path+': HTTP '+response.status);
  return response.json();
}
export async function run(){
  const repo=process.env.GITHUB_REPOSITORY||'justinpfisher/justelle',token=process.env.GH_TOKEN;
  if(repo!=='justinpfisher/justelle')throw Error('Unexpected repository: refusing status update');
  if(!token)throw Error('GH_TOKEN required; no silent unauthenticated fallback');
  const config=JSON.parse(await readFile(new URL('../.github/justelle-milestones.json',import.meta.url),'utf8'));
  const [list,pr]=await Promise.all([
    Promise.all(config.milestones.map(m=>getApi('issues/'+m.issue,repo,token))),
    getApi('pulls/5',repo,token)]);
  const data=calculateMilestones(config,new Map(list.map(i=>[i.number,i])),pr);
  const readmePath=new URL('../README.md',import.meta.url),docPath=new URL('../docs/WHERE-WE-ARE.md',import.meta.url);
  const original=await readFile(readmePath,'utf8'),readme=replaceReadmeStatus(original,renderFrontPage(data));
  if(original!==readme)await writeFile(readmePath,readme);
  let old='';try{old=await readFile(docPath,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  const details=renderDetails(data);
  if(old!==details)await writeFile(docPath,details);
  process.stdout.write('Status: '+data.completed+'/'+data.rows.length+' milestones; next '+(data.next?.id||'none')+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  run().catch(e=>{console.error(e);process.exitCode=1;});
}
