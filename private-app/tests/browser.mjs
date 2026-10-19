import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,unlink,mkdir} from 'node:fs/promises';
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
  catch{throw Error('Could not sign in; '+await page.locator('#error').textContent()+'; '+pageErrors.join('; '));}
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
  // M1 iPhone-sized journey slice: direct member edits, realtime visibility, Undo.
  await A.locator('[data-tab="adventures"]').click();
  await B.locator('[data-tab="adventures"]').click();
  await A.locator('#planner-title').fill('Fictional Shared Coast');
  await A.locator('#planner-date').fill('2026-11-01');
  await A.locator('#planner-days').fill('10');
  await A.locator('#planner-create button[type="submit"]').click();
  try{
    await Promise.all([
      A.locator('#planner-list .planner-card').filter({hasText:'Fictional Shared Coast'}).waitFor({timeout:15000}),
      B.locator('#planner-list .planner-card').filter({hasText:'Fictional Shared Coast'}).waitFor({timeout:15000})
    ]);
  }catch(e){
    throw Error('Shared planner not visible: '+e.message+
      ' | A: '+await A.locator('#error').textContent()+
      ' | B: '+await B.locator('#error').textContent()+
      ' | JS: '+pageErrors.join(' / ')+
      ' | A cards: '+await A.locator('#planner-list').textContent()+
      ' | B cards: '+await B.locator('#planner-list').textContent()+
      ' | Form valid: '+await A.locator('#planner-create').evaluate(f=>f.checkValidity())+
      ' | Button disabled: '+await A.locator('#planner-create button').isDisabled()+
      ' | Tabs: '+await A.locator('#adventures-tab').isVisible());
  }
  await A.locator('#planner-list .planner-card').filter({hasText:'Fictional Shared Coast'}).getByRole('button',{name:'Open plan'}).click();
  await A.locator('#planner-stay-title').fill('Fictional Harbour');
  await A.locator('#planner-from').fill('2');
  await A.locator('#planner-nights').fill('3');
  await A.locator('#planner-state').selectOption('possible');
  await A.locator('#planner-add-stay button[type="submit"]').click();
  await poll(async()=>await B.locator('#planner-list .planner-card').filter({hasText:'Fictional Shared Coast'})
    .getByText('1 possibilities').count()>0);
  await B.locator('#planner-list .planner-card').filter({hasText:'Fictional Shared Coast'})
    .getByRole('button',{name:'Open plan'}).click();
  await B.locator('#planner-stays .planner-stay').getByRole('button',{name:'Mark planned'}).click();
  await poll(async()=>await A.locator('#planner-stays .planner-stay').getByText('planned',{exact:false}).count()>0);
  await poll(async()=>await A.locator('#planner-stays .planner-stay').getByRole('button',{name:'Keep as possible'}).count()>0);
  await B.locator('#planner-undo').click();
  await poll(async()=>await A.locator('#planner-stays .planner-stay').getByRole('button',{name:'Mark planned'}).count()>0);
  await A.getByText('Previous edits',{exact:true}).click();
  await poll(async()=>await A.locator('#planner-history li').count()===4);
  await A.getByText('Explore days',{exact:true}).click();
  assert.equal(await A.locator('.planner-week').count(),2,'Ten-day trip is displayed in two weeks');
  assert.equal(await A.locator('.planner-week').first().evaluate(n=>n.open),true);
  await A.locator('.planner-week').first().getByRole('button',{name:/Day 2/}).click();
  await A.locator('#planner-day-detail').getByText('Fictional Harbour').waitFor();
  // Stay details use the existing atomic revision chain, with touch/keyboard
  // controls and immediate subscription updates on the second member's phone.
  await A.locator('#planner-stays .planner-stay').getByRole('button',{name:'Edit details'}).click();
  await A.locator('#planner-edit-title').fill('Fictional Harbour Revised');
  await A.locator('#planner-edit-nights').fill('2');
  await A.locator('#planner-edit-stay .planner-coordinates summary').click();
  await A.locator('#planner-edit-latitude').fill('49.2827');
  await A.locator('#planner-edit-longitude').fill('-123.1207');
  await A.locator('#planner-edit-stay button[type=submit]').click();
  await B.locator('#planner-stays').getByText('Fictional Harbour Revised').waitFor({timeout:15000});
  await A.locator('#planner-edit-stay').waitFor({state:'hidden',timeout:15000});
  await A.locator('#planner-stays .planner-stay').getByRole('button',{name:'Show day 2'}).click();
  await A.locator('#planner-day-detail').getByText('Fictional Harbour Revised').waitFor();
  await B.locator('#planner-map .planner-map-pin').waitFor({timeout:15000});
  assert.equal(await B.locator('#planner-map .planner-map-pin').count(),1);
  assert.match(await B.locator('#planner-map').textContent(),/not a navigational map or confirmed travel route/i);
  await B.locator('#planner-map .planner-map-pin').click();
  assert.equal(await B.locator('#planner-map .planner-map-pin').getAttribute('aria-pressed'),'true');
  await B.locator('#planner-day-detail').getByText('Fictional Harbour Revised').waitFor();
  await B.locator('.planner-week').first().getByRole('button',{name:/Day 4/}).click();
  assert.equal(await B.locator('#planner-map .planner-map-pin').getAttribute('data-in-day'),'false',
    'Selecting a different day must not imply an overnight stay at this pinned place');
  // Ordinary day activities/ideas are not booking confirmations. Members can
  // edit them immediately, with the other member seeing the same day entry.
  await A.locator('#planner-experience-title').fill('Fictional museum');
  assert.equal(await A.locator('#planner-experience-day').inputValue(),'2');
  await A.locator('#planner-experience-notes').fill('Flexible afternoon');
  await A.locator('#planner-add-experience button[type=submit]').click();
  await B.getByText('Explore days',{exact:true}).click();
  await B.locator('#planner-experiences').getByText('Fictional museum').waitFor({timeout:15000});
  await B.locator('#planner-experiences .planner-stay').getByRole('button',{name:'Edit experience'}).click();
  await B.locator('#planner-experience-edit-title').fill('Fictional gallery');
  await B.locator('#planner-experience-edit-state').selectOption('planned');
  await B.locator('#planner-edit-experience button[type=submit]').click();
  await A.locator('#planner-experiences').getByText('Fictional gallery').waitFor({timeout:15000});
  await A.locator('#planner-experiences .planner-stay').getByRole('button',{name:'Show day 2'}).click();
  await A.locator('#planner-day-detail').getByText('Planned experience · Fictional gallery',{exact:false}).waitFor();
  assert.equal((await A.locator('#planner-day-detail').textContent()).includes('booking confirmation'),false);
  assert.equal(await A.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),true,
    'The journey must not require horizontal scrolling on a 390px phone');

  // A records a fictional supplier anchor and PDF; B opens the exact protected
  // original through the shared itinerary. No supplier booking is amended.
  await A.getByText('Booking anchors',{exact:true}).click();
  await B.getByText('Booking anchors',{exact:true}).click();
  await A.locator('#planner-booking-title').fill('Fictional inn confirmation');
  await A.locator('#planner-booking-kind').selectOption('stay');
  const relatedStop=await A.locator('#planner-booking-stop option').filter({hasText:'Fictional Harbour Revised'})
    .getAttribute('value');
  assert.ok(relatedStop,'Booking can be anchored to a saved place');
  await A.locator('#planner-booking-stop').selectOption(relatedStop);
  await A.locator('#planner-booking-start').fill('2026-11-02');
  await A.locator('#planner-booking-end').fill('2026-11-05');
  await A.locator('#planner-booking-supplier').fill('Test-only supplier');
  await A.locator('#planner-booking-reference').fill('SYNTHETIC-REF');
  await A.locator('#planner-booking-state').selectOption('confirmed');
  await A.locator('#planner-booking-file').setInputFiles({
    name:'synthetic-source.pdf',mimeType:'application/pdf',
    buffer:Buffer.from('%PDF-1.4\\n1 0 obj\\n<< /Type /Catalog >>\\nendobj\\n%%EOF\\n')
  });
  await A.locator('#planner-add-booking button[type=submit]').click();
  await B.locator('#planner-bookings .planner-booking-entry').filter({hasText:'Fictional inn confirmation'})
    .waitFor({timeout:15000});
  await B.locator('#planner-bookings .planner-booking-entry').filter({hasText:'Fictional inn confirmation'})
    .getByRole('button',{name:'Show original details'}).click();
  await B.getByText('SYNTHETIC-REF',{exact:false}).waitFor({timeout:15000});
  await B.locator('#planner-map .planner-map-places button').filter({hasText:'Fictional Harbour Revised'}).click();
  await B.locator('#planner-map .planner-map-selected').getByRole('button',{name:/Booking details · Fictional inn confirmation/}).waitFor({timeout:15000});
  assert.match(await B.locator('#planner-map .planner-map-selected').textContent(),/different dates/i);
  await B.locator('#planner-map .planner-map-selected').getByRole('button',{name:/Booking details/}).click();
  await B.locator('#planner-booking-source').getByText('SYNTHETIC-REF',{exact:false}).waitFor();
  await A.locator('#planner-stays .planner-stay').getByRole('button',{name:/Booking: Fictional inn confirmation/}).click();
  await A.locator('#planner-booking-source').getByText('SYNTHETIC-REF',{exact:false}).waitFor();
  if(!(await B.locator('.journey-days').evaluate(n=>n.open)))
    await B.getByText('Explore days',{exact:true}).click();
  await B.locator('.planner-week').first().getByRole('button',{name:/Day 2/}).click();
  await B.locator('#planner-day-detail').getByRole('button',{name:/View booking · Fictional inn confirmation/}).click();
  await B.locator('#planner-booking-source').getByText('SYNTHETIC-REF',{exact:false}).waitFor();
  const downloadPromise=B.waitForEvent('download',{timeout:12000});
  await B.getByRole('button',{name:'Open protected original'}).click();
  let bookingDownload;
  try{bookingDownload=await downloadPromise;}
  catch(e){throw Error('Protected original did not open: '+e.message+
    ' | B UI: '+await B.locator('#error').textContent()+
    ' | source: '+await B.locator('#planner-booking-source').textContent()+
    ' | browser: '+pageErrors.join('; '));}
  assert.equal(bookingDownload.suggestedFilename(),'synthetic-source.pdf');
  assert.equal((await B.locator('#planner-bookings').textContent()).includes('Member-recorded confirmation'),true);
  // A stay edit drafted before another member's save must not overwrite their
  // newer changes, even when live updates arrive during the draft.
  await A.locator('#planner-stays .planner-stay').getByRole('button',{name:'Edit details'}).click();
  await A.locator('#planner-edit-title').fill('Unsaved outdated name');
  await B.locator('#planner-stays .planner-stay').getByRole('button',{name:'Edit details'}).click();
  await B.locator('#planner-edit-title').fill('Fictional Coast Harbour');
  await B.locator('#planner-edit-stay button[type=submit]').click();
  await A.locator('#planner-stays').getByText('Fictional Coast Harbour').waitFor({timeout:15000});
  assert.equal(await A.locator('#planner-edit-title').inputValue(),'Unsaved outdated name');
  await A.locator('#planner-edit-stay button[type=submit]').click();
  await A.getByText(/shared plan changed while you were editing/i).first().waitFor();
  await A.locator('#planner-edit-refresh').click();
  assert.equal(await A.locator('#planner-edit-title').inputValue(),'Fictional Coast Harbour');
  await A.locator('#planner-edit-cancel').click();
  // A precise member instruction saves one attributable edit; an instruction
  // affecting confirmed dates must show a preview without moving the booking.
  await A.locator('#planner-instruction').fill('Change trip start to 2026-11-09');
  await A.locator('#planner-instruction-form button[type=submit]').click();
  await A.locator('#planner-instruction-apply').waitFor({state:'visible'});
  assert.match(await A.locator('#planner-instruction-message').textContent(),/Nothing has changed yet/);
  assert.match(await A.locator('#planner-summary').textContent(),/2026-11-01/);
  await A.locator('#planner-instruction-cancel').click();
  await A.locator('#planner-instruction').fill('Consider 1 night in Mirror Bay starting day 7');
  await A.locator('#planner-instruction-form button[type=submit]').click();
  await B.locator('#planner-stays').getByText('Mirror Bay').waitFor({timeout:15000});
  await poll(async()=>await A.locator('#planner-history').textContent()
    .then(x=>x.includes('Original instruction: Consider 1 night in Mirror Bay starting day 7')));
  assert.match(await A.locator('#planner-instruction-result').textContent(),/Saved/);
  // One member changing a trip must not silently overwrite another member's
  // unsaved draft, even if the live subscription receives a newer revision.
  await A.getByText('Dates and trip basics',{exact:true}).click();
  await B.getByText('Dates and trip basics',{exact:true}).click();
  await A.locator('#planner-trip-title').fill('Old unsaved fictional draft');
  await B.locator('#planner-trip-title').fill('Fictional Coast Updated');
  await B.locator('#planner-trip-date').fill('2026-11-02');
  await B.locator('#planner-trip-form button[type=submit]').click();
  await poll(async()=>await A.locator('#planner-detail-title').textContent()==='Fictional Coast Updated');
  await A.locator('#planner-trip-form button[type=submit]').click();
  await A.getByText(/shared plan changed while you were editing/i).waitFor({timeout:15000});
  await A.locator('#planner-trip-refresh').click();
  assert.equal(await A.locator('#planner-trip-title').inputValue(),'Fictional Coast Updated');
  assert.equal(await A.locator('#planner-trip-date').inputValue(),'2026-11-02');
  await B.locator('#planner-archive').click();
  await poll(async()=>await A.locator('#planner-archive').textContent()==='Return to planning');
  await B.locator('#planner-archive').click();
  await poll(async()=>await A.locator('#planner-archive').textContent()==='Move to archive');
  await A.locator('#planner-bookings').getByText('Fictional inn confirmation',{exact:true}).waitFor({timeout:15000});


  await A.locator('[data-tab="conversation"]').click();
  await B.locator('[data-tab="conversation"]').click();


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
  const newSelectedTopic=A.locator('#topic-list .topic-chip.selected:not([data-topic-id="conversation-shared"])');
  await newSelectedTopic.waitFor({state:'visible',timeout:15000});
  const topic1=await newSelectedTopic.getAttribute('data-topic-id');
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
  await poll(async()=>await A.locator('#topic-title').textContent()==='Fictional coastal walk',15000);
  const secondSelectedTopic=A.locator('#topic-list .topic-chip.selected:not([data-topic-id="'+topic1+'"])');
  await secondSelectedTopic.waitFor({state:'visible',timeout:15000});
  const topic2=await secondSelectedTopic.getAttribute('data-topic-id');
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
  assert.equal(bundle.records.adventure_plans.length,1);
  assert.equal(bundle.records.plan_documents.length,1);
  assert.ok(bundle.media.some(f=>f.id==='doc-'+bundle.records.plan_documents[0].id&&f.mime==='application/pdf'));

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
  // New mobile flows: per-topic drafts/images, enlarged previews and preserved corrections.
  await again.locator('[data-topic-id="conversation-shared"]').click();
  await again.locator('#message-input').fill('Fictional unsent draft');await mockPhoto(again);
  await again.locator('[data-topic-id="'+topic2+'"]').click();
  assert.equal(await again.locator('#message-input').inputValue(),'');
  assert.equal(await again.locator('#staged-images .queued').count(),0);
  await again.locator('[data-topic-id="conversation-shared"]').click();
  assert.equal(await again.locator('#message-input').inputValue(),'Fictional unsent draft');
  assert.equal(await again.locator('#staged-images .queued').count(),1);
  await again.locator('#message-input').fill('Fictional correction source');await again.locator('#send-button').click();
  const sourceBubble=again.locator('#messages .bubble').filter({hasText:'Fictional correction source'});
  await sourceBubble.getByRole('button',{name:'Add a correction'}).click();
  await again.locator('#correction-note').waitFor({state:'visible'});
  await again.locator('#message-input').fill('Fictional corrected detail');await again.locator('#send-button').click();
  await again.getByText('Fictional corrected detail',{exact:true}).waitFor();
  assert.equal(await again.getByText('Fictional correction source',{exact:true}).count(),1);
  await sourceBubble.locator('.image-tile').waitFor({state:'visible'});
  await poll(async()=>sourceBubble.locator('.image-tile').evaluate(img=>img.naturalWidth>0));
  await sourceBubble.locator('.image-preview-button').click();await again.locator('#image-viewer').waitFor({state:'visible'});
  await poll(async()=>again.locator('#full-image').evaluate(img=>img.naturalWidth>0));await again.locator('#close-image').click();
  await again.locator('[data-tab="adventures"]').click();
  await again.locator('#idea-input').fill('Fictional spontaneous memory');await again.locator('#idea-kind').selectOption('memory');
  await again.locator('#idea-form button[type="submit"]').click();
  // The same title appears in the optimistic adventure card before the save
  // completes. Wait for the promised conversation transition before changing tabs.
  await again.locator('#topic-title').filter({hasText:'Fictional spontaneous memory'}).waitFor({state:'visible'});
  await again.locator('[data-tab="adventures"]').click();
  const memoryCard=again.locator('#adventures .record-card').filter({hasText:'Fictional spontaneous memory'});
  await memoryCard.getByText('Remembering',{exact:true}).waitFor();
  await memoryCard.getByText('Change how we’re keeping this',{exact:true}).click();
  await memoryCard.getByRole('button',{name:'Exploring',exact:true}).click();
  await memoryCard.locator('.tag').getByText('Exploring',{exact:true}).waitFor();
  const screenshots=fileURLToPath(new URL('../screenshots/',import.meta.url));await mkdir(screenshots,{recursive:true});
  assert.ok(await again.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Phone layout should fit its viewport');
  await again.screenshot({path:join(screenshots,'fictional-phone.png'),fullPage:true});
  await again.setViewportSize({width:1280,height:900});
  assert.ok(await again.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Desktop layout should fit its viewport');
  await again.screenshot({path:join(screenshots,'fictional-desktop.png'),fullPage:true});
  assert.deepEqual(pageErrors,[]);
  console.log('BROWSER PASS: scoped chats, 40-message pages, jump to latest, source-linked adventures, two-member plans, decline/revision history, transparent AI, image preview, independent restore and session persistence');
}finally{
  await ctxA?.close();await ctxB?.close();app.kill('SIGTERM');await unlink(fixtureFile).catch(()=>{});
}
