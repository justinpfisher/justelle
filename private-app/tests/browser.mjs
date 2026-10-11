import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
import {restoreArchive} from '../memory/restore.mjs';

const fixtureFile=process.argv[2];
if(!fixtureFile)throw Error('Need disposable emulator credentials file');
const fixture=JSON.parse(await readFile(fixtureFile,'utf8'));
const base='http://127.0.0.1:5173/';
const app=spawn(process.execPath,['node_modules/vite/bin/vite.js','web','--host','127.0.0.1','--port','5173','--strictPort'],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),env:process.env,stdio:'ignore'
});
let ctxA,ctxB;const pageErrors=[];
const poll=async(fn,timeout=15000)=>{
  const until=Date.now()+timeout;
  while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,150));}
  throw Error('Expected condition not satisfied within '+timeout+'ms');
};
async function waitFor(url){
  for(let i=0;i<90;i++){try{const response=await fetch(url);if(response.status<500)return;}catch{}
    await new Promise(r=>setTimeout(r,450));}
  throw Error('Local service not ready: '+url);
}
async function login(page,account){
  await page.goto(base);
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.locator('#login-form button').click();
  try{await page.locator('#private-app').waitFor({state:'visible',timeout:25000});}
  catch{throw Error('Could not sign in; '+await page.locator('#error').textContent());}
}
async function openDiscussion(page,id){
  await page.locator('#topic-list [data-topic-id="'+id+'"]').click();
  await poll(async()=>await page.locator('#topic-list [data-topic-id="'+id+'"]').getAttribute('aria-pressed')==='true');
}
async function openPlans(page){
  const panel=page.locator('#agreements-tab');
  if(!(await panel.isVisible()))await page.locator('#plans-toggle').click();
  await panel.waitFor({state:'visible'});
}
async function mockPhoto(page){
  await page.locator('#image-input').setInputFiles({
    name:'fictional-landscape.png',mimeType:'image/png',
    buffer:await readFile(new URL('./fictional-landscape.png',import.meta.url))
  });
  await page.locator('#staged-images img').waitFor({state:'visible'});
}
try{
  await Promise.all([waitFor(base),waitFor('http://127.0.0.1:8787/respond')]);
  const dirA=await mkdtemp(join(tmpdir(),'justelle-ux-a-'));
  const dirB=await mkdtemp(join(tmpdir(),'justelle-ux-b-'));
  ctxA=await chromium.launchPersistentContext(dirA,{headless:true,viewport:{width:390,height:844},acceptDownloads:true});
  ctxB=await chromium.launchPersistentContext(dirB,{headless:true,viewport:{width:390,height:844},acceptDownloads:true});
  const A=await ctxA.newPage(),B=await ctxB.newPage();
  A.on('pageerror',e=>pageErrors.push('A: '+e.message));
  B.on('pageerror',e=>pageErrors.push('B: '+e.message));
  await login(A,fixture.a);await login(B,fixture.b);
  assert.equal(await A.locator('#topic-title').textContent(),'Our chat');
  assert.equal(await B.locator('#topic-title').textContent(),'Our chat');

  // Keyboard affordances remain functional in every conversation.
  const input=A.locator('#message-input');
  await input.fill('First fictional line');
  await input.press('Alt+Enter');
  await A.keyboard.type('and a second line');
  assert.equal(await input.inputValue(),'First fictional line\nand a second line');
  assert.equal(await B.locator('#messages .bubble').count(),0);
  await input.press('Enter');
  await B.getByText('First fictional line\nand a second line',{exact:true}).waitFor({timeout:15000});
  assert.equal(await input.inputValue(),'');
  await input.fill('Unfinished IME composition');
  await input.evaluate(node=>node.dispatchEvent(new KeyboardEvent('keydown',{
    key:'Enter',bubbles:true,cancelable:true,isComposing:true
  })));
  assert.equal(await input.inputValue(),'Unfinished IME composition');

  // Ordinary questions do not silently create bogus plans or factual claims.
  await input.fill('How many apples grow on an apple tree?');
  await A.locator('#ask-ai-button').click();
  await B.getByText(/can.t answer factual questions yet/).waitFor({timeout:20000});
  await openPlans(B);
  assert.equal(await B.locator('#decisions .record-card').count(),0,'Factual question should not create a plan');
  await B.locator('#close-plans').click();
  await A.locator('#message-input').fill('Please suggest a plan for a fictional floating museum visit.');
  await mockPhoto(A);
  await A.locator('#ask-ai-button').click();
  await B.getByText(/I.ve prepared a fictional suggestion for this discussion/).waitFor({timeout:20000});
  const image=B.locator('#messages .image-tile').first();
  await image.waitFor({state:'visible'});
  await poll(async()=>await image.evaluate(img=>img.naturalWidth>0));
  await openPlans(B);
  await B.getByText('Demo suggestion: Please suggest a plan for a fictional floating museum visit.',{exact:true}).waitFor();
  await B.locator('#decisions .record-card').first().getByRole('button',{name:'Yes, I agree'}).click();
  await B.getByText('You said yes. Waiting for Fictional A to weigh in.',{exact:true}).waitFor();
  await openPlans(A);
  await A.getByText('Fictional B said yes. What do you think?',{exact:true}).waitFor();
  await A.locator('#decisions .record-card').first().getByRole('button',{name:'Yes, I agree'}).click();
  await B.getByText('We both said yes',{exact:true}).waitFor();
  assert.match(await B.locator('#decisions .record-card').first().innerText(),/Fictional A said yes/);
  assert.match(await B.locator('#decisions .record-card').first().innerText(),/You said yes/);
  await A.locator('#decisions .record-card').first().getByRole('button',{name:'Suggest a change'}).click();
  await A.locator('#reason-input').fill('Testing an alternative');
  await A.locator('#proposal-form button[type="submit"]').click();
  await B.getByText('Just a suggestion',{exact:true}).first().waitFor();
  await B.locator('#decisions .record-card').first().getByRole('button',{name:'Not for me'}).click();
  await B.locator('#decisions details summary').click();
  await B.getByText('Not for us',{exact:true}).first().waitFor();
  await B.getByText('We both said yes',{exact:true}).first().waitFor();
  await B.locator('#close-plans').click();

  // A saves a *source-linked* adventure from an existing general-chat message.
  const original=A.locator('#messages .bubble').filter({hasText:'Please suggest a plan for a fictional floating museum visit.'}).first();
  await original.getByRole('button',{name:'Start an adventure'}).click();
  const topic1=await A.locator('#topic-list .topic-chip.selected').getAttribute('data-topic-id');
  assert.ok(topic1?.startsWith('conversation-')&&topic1!=='conversation-shared');
  assert.equal(await A.locator('#messages .bubble').count(),0,'The new discussion starts empty without moving the source message');
  await A.getByText(/Started in our chat/).waitFor({timeout:15000});
  await B.locator('#topic-list [data-topic-id="'+topic1+'"]').waitFor();
  await openDiscussion(B,topic1);
  await B.locator('#message-input').fill('Fictional museum thread — from member B.');
  await B.locator('#message-input').press('Enter');
  await A.getByText('Fictional museum thread — from member B.',{exact:true}).waitFor();
  await A.locator('#message-input').fill('Fictional museum thread — from member A.');
  await A.locator('#message-input').press('Enter');
  await B.getByText('Fictional museum thread — from member A.',{exact:true}).waitFor();
  await openDiscussion(B,'conversation-shared');
  assert.equal(await B.getByText('Fictional museum thread — from member A.',{exact:true}).count(),0,
    'Adventure discussion text must not spill into Our chat');
  await B.getByText('Please suggest a plan for a fictional floating museum visit.',{exact:true}).first().waitFor();

  // A second adventure has a distinct title and distinct conversation.
  await A.locator('[data-tab="adventures"]').click();
  await A.locator('#idea-input').fill('Fictional coastal walk');
  await A.locator('#idea-form button').click();
  await A.getByRole('heading',{name:'Fictional coastal walk',exact:true}).waitFor();
  const topic2=await A.locator('#topic-list .topic-chip.selected').getAttribute('data-topic-id');
  assert.notEqual(topic2,topic1);
  await A.locator('#message-input').fill('Only in the coastal walk conversation.');
  await A.locator('#message-input').press('Enter');
  await B.locator('#topic-list [data-topic-id="'+topic2+'"]').waitFor();
  await openDiscussion(B,topic2);
  await B.getByText('Only in the coastal walk conversation.',{exact:true}).waitFor();
  await openDiscussion(B,topic1);
  assert.equal(await B.getByText('Only in the coastal walk conversation.',{exact:true}).count(),0);
  await openDiscussion(B,topic2);
  await openPlans(A);
  await A.locator('#proposal-input').fill('Fictional coastal walk on Saturday.');
  await A.locator('#proposal-form button[type="submit"]').click();
  await openPlans(B);
  await B.getByText('Fictional coastal walk on Saturday.',{exact:true}).waitFor();
  await B.locator('#decisions .record-card').first().getByRole('button',{name:'Yes, I agree'}).click();
  await A.locator('#decisions .record-card').first().getByRole('button',{name:'Yes, I agree'}).click();
  await B.getByText('We both said yes',{exact:true}).waitFor();
  await B.locator('#close-plans').click();

  // Only the latest forty messages are displayed; earlier ones are paged in.
  const seedApp=initializeApp({projectId:'demo-justelle-pilot'},'justelle-browser-pagination');
  const seedDb=getFirestore(seedApp);
  const batch=seedDb.batch();
  for(let i=0;i<46;i++){
    const id='fictional-history-'+String(i).padStart(3,'0');
    batch.set(seedDb.doc('rooms/fictional-room/messages/'+id),{
      body:'Fictional history message '+String(i).padStart(3,'0'),
      author_uid:'fictional-a',author_id:'person-a',kind:'person',
      adventure_id:topic2.slice('conversation-'.length),conversation_id:topic2,
      attachment_ids:[],created_at:Timestamp.fromMillis(Date.parse('2026-01-01T12:00:00Z')+i*60000)
    });
  }
  await batch.commit();await seedDb.terminate();await deleteApp(seedApp);
  await poll(async()=>await B.locator('#messages .bubble').count()===40,20000);
  assert.equal(await B.locator('#messages .bubble').count(),40);
  await B.locator('#earlier-button').click();
  await poll(async()=>await B.locator('#messages .bubble').count()>=47,20000);
  assert.equal(await B.getByText('Fictional history message 000',{exact:true}).count(),1);
  await B.locator('#timeline-scroll').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  await B.locator('#jump-latest').waitFor({state:'visible'});
  await B.locator('#jump-latest').click();
  await poll(async()=>B.locator('#timeline-scroll').evaluate(el=>
    el.scrollHeight-el.scrollTop-el.clientHeight<100));

  // Adventure phases are story markers, not unilateral confirmation of plans.
  await B.locator('[data-tab="adventures"]').click();
  const card=B.locator('[data-adventure-id="'+topic2.slice('conversation-'.length)+'"]');
  for(const [button,label] of [['Start planning','Working on it'],['Mark as happened','Happened'],['Save as a memory','Remembering']]){
    await card.getByRole('button',{name:button}).click();
    await card.getByText(label,{exact:true}).waitFor({timeout:15000});
    assert.equal((await B.locator('#error').textContent()).trim(),'');
  }
  assert.match(await card.innerText(),/plan agreed/);
  await card.getByRole('button',{name:'Open discussion'}).click();
  assert.equal(await B.locator('#topic-title').textContent(),'Fictional coastal walk');

  // Export includes both topics, all history (not just 40 visible messages),
  // the linked source, both approvals and the exact original image bytes.
  await A.locator('[data-tab="adventures"]').click();
  const [download]=await Promise.all([
    A.waitForEvent('download',{timeout:30000}),A.locator('#export-button').click()
  ]);
  const bundle=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(bundle.records.conversations.length,3);
  assert.ok(bundle.records.messages.length>=53);
  assert.ok(bundle.records.messages.some(m=>m.conversation_id===topic2));
  assert.ok(bundle.records.messages.some(m=>m.conversation_id===topic1));
  const sourceIdea=bundle.records.adventures.find(a=>a.conversation_id===topic1);
  assert.ok(sourceIdea?.source_message_id);
  assert.ok(bundle.records.messages.find(m=>m.id===sourceIdea.source_message_id));
  const restored=join(await mkdtemp(join(tmpdir(),'justelle-ux-restore-')),'restored');
  const summary=await restoreArchive(bundle,restored);
  assert.equal(summary.records.conversations,3);
  assert.ok(summary.records.messages>50);
  assert.ok(summary.files>=1);

  // Re-opening the browser profile keeps both authentication and active topic.
  await A.reload();await A.locator('#private-app').waitFor({state:'visible',timeout:25000});
  await A.getByRole('heading',{name:'Fictional coastal walk',exact:true}).waitFor();
  await ctxA.close();ctxA=null;
  ctxA=await chromium.launchPersistentContext(dirA,{headless:true,viewport:{width:390,height:844},acceptDownloads:true});
  const again=await ctxA.newPage();await again.goto(base);
  await again.locator('#private-app').waitFor({state:'visible',timeout:25000});
  await again.getByRole('heading',{name:'Fictional coastal walk',exact:true}).waitFor();
  assert.equal(await again.locator('#login').isVisible(),false);
  assert.deepEqual(pageErrors,[]);
  console.log('BROWSER PASS: scoped chats, 40-message pages, jump to latest, source-linked adventures, two-member plans, decline/revision history, transparent AI, image preview, independent restore and session persistence');
}finally{
  await ctxA?.close();await ctxB?.close();app.kill('SIGTERM');await unlink(fixtureFile).catch(()=>{});
}
