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
import {syntheticBookingPdf} from './synthetic-booking-pdf.mjs';

const fixtureFile=process.argv[2];
if(!fixtureFile)throw Error('Need disposable emulator credentials file');
const fixture=JSON.parse(await readFile(fixtureFile,'utf8'));
const base='http://127.0.0.1:5173/?test-session-races=1';
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
async function signInOnCurrentPage(page,account){
  const authResponse=page.waitForResponse(response=>
    response.url().includes('/accounts:signInWithPassword'),{timeout:15000});
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.locator('#login-form button').click();
  const response=await authResponse;
  if(response.status()!==200)
    throw Error('Fictional Auth sign-in returned HTTP '+response.status());
  try{await page.locator('#private-app').waitFor({state:'visible',timeout:25000});}
  catch{throw Error('Could not open the fictional member session after Auth HTTP '+
    response.status()+'; login visible: '+await page.locator('#login').isVisible()+
    '; private app visible: '+await page.locator('#private-app').isVisible()+
    '; notice: '+await page.locator('#notice').textContent()+
    '; error: '+await page.locator('#error').textContent()+'; '+pageErrors.join('; '));}
}
async function login(page,account){
  await page.goto(base);
  await signInOnCurrentPage(page,account);
}
async function openDiscussion(page,id){
  await page.locator('#topic-list [data-topic-id="'+id+'"]').click();
  await poll(async()=>await page.locator('#topic-list [data-topic-id="'+id+'"]').getAttribute('aria-pressed')==='true');
}
async function holdFirstRequest(page,url,method){
  let captured=false,releaseResolve,startedResolve,continuedResolve;
  let responseStatus=null,responseFinished=false;
  const gate=new Promise(resolve=>{releaseResolve=resolve;});
  const started=new Promise(resolve=>{startedResolve=resolve;});
  const continued=new Promise(resolve=>{continuedResolve=resolve;});
  await page.route(url,async route=>{
    if(!captured&&route.request().method()===method){
      captured=true;startedResolve();
      await gate;
      try{
        await route.continue();
        const response=await route.request().response();
        if(response){
          responseStatus=response.status();
          responseFinished=!(await response.finished());
        }
      }catch{}finally{continuedResolve();}
      return;
    }
    await route.continue();
  });
  return {started,continued,release:releaseResolve,captured:()=>captured,
    get responseStatus(){return responseStatus;},get responseFinished(){return responseFinished;}};
}
async function assertPrivateUiCleared(page){
  assert.equal(await page.locator('#private-app').isVisible(),false);
  assert.doesNotMatch(await page.locator('#private-app').textContent(),
    /Fictional correction source|Fictional Shared Coast|Fictional spontaneous memory/,
    'the hidden shell must not retain prior member content');
  for(const selector of ['#messages .bubble','#decisions .record-card','#adventures .record-card',
    '#planner-list .planner-card','#planner-stays .planner-stay','#messages img'])
    assert.equal(await page.locator(selector).count(),0,selector+' must not retain signed-in content');
  assert.equal(await page.locator('#image-viewer').isVisible(),false);
  assert.equal(await page.locator('#full-image').getAttribute('src'),null);
  assert.equal(await page.locator('#planner-booking-source').textContent(),'');
  assert.deepEqual(await page.locator('#planner-booking-stop option').allTextContents(),['No specific place']);
  assert.equal(await page.locator('#planner-edit-status').textContent(),'');
  assert.equal(await page.locator('#planner-experience-edit-status').textContent(),'');
  assert.equal(await page.locator('#planner-edit-stay').isVisible(),false);
  assert.equal(await page.locator('#planner-edit-experience').isVisible(),false);
  const tripDataset=await page.locator('#planner-trip-form').evaluate(form=>({...form.dataset}));
  for(const key of ['planId','baseRevision','dirty'])assert.equal(tripDataset[key],undefined,key+' must clear on sign-out');
}
async function openTripBasics(page){
  const section=page.locator('#planner-detail > details').first();
  if(!(await section.evaluate(node=>node.open)))await section.locator('summary').click();
  await section.locator('#planner-trip-title').waitFor({state:'visible'});
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
  await A.goto(base);
  assert.equal(await A.locator('#login').isVisible(),true,'an unauthenticated visitor sees the sign-in screen');
  assert.equal(await A.locator('#private-app').isVisible(),false,'an unauthenticated visitor cannot see private panels');
  await login(A,fixture.a);await login(B,fixture.b);
  assert.equal(await A.locator('.pilot').isVisible(),true);
  assert.match(await A.locator('.pilot').textContent(),/Local fictional-data pilot/);
  assert.equal(await A.locator('#topic-title').textContent(),'Our chat');
  assert.equal(await B.locator('#topic-title').textContent(),'Our chat');
  // Session clearing must not erase non-private HTML defaults on either device.
  for(const page of [A,B]){
    for(const [id,defaultValue] of [
      ['planner-days','21'],['planner-experience-day','1'],
      ['planner-from','1'],['planner-nights','2']
    ])assert.equal(await page.locator('#'+id).inputValue(),defaultValue,
      'fresh member session must retain the '+id+' default');
  }
  // M1 iPhone-sized journey slice: direct member edits, realtime visibility, Undo.
  await A.locator('[data-tab="adventures"]').click();
  await B.locator('[data-tab="adventures"]').click();
  await A.locator('#planner-title').fill('Fictional default-value check');
  assert.equal(await A.locator('#planner-create').evaluate(form=>form.checkValidity()),true,
    'a title alone must be valid with the ordinary default duration');
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
  await A.locator('#planner-day-detail').getByText('Fictional Harbour',{exact:true}).waitFor();
  await A.locator('#planner-feedback').click();
  await A.locator('#planner-feedback-results').getByRole('button',{name:'Open day 1'}).click();
  await A.locator('#planner-day-detail h4').getByText('Day 1',{exact:false}).waitFor();
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
  await A.locator('#planner-day-detail').getByText('Fictional Harbour Revised',{exact:true}).waitFor();
  await A.locator('#planner-stays .planner-stay').getByRole('button',{name:'Show on map'}).click();
  assert.equal(await A.locator('#planner-map .planner-map-pin').getAttribute('aria-pressed'),'true',
    'The itinerary must be able to focus its saved map location');
  await B.locator('#planner-map .planner-map-pin').waitFor({timeout:15000});
  assert.equal(await B.locator('#planner-map .planner-map-pin').count(),1);
  assert.match(await B.locator('#planner-map').textContent(),/not a navigational map or confirmed travel route/i);
  await B.locator('#planner-map .planner-map-pin').click();
  assert.equal(await B.locator('#planner-map .planner-map-pin').getAttribute('aria-pressed'),'true');
  await B.locator('#planner-day-detail').getByText('Fictional Harbour Revised',{exact:true}).waitFor();
  await B.locator('.planner-week').first().getByRole('button',{name:/Day 4/}).click();
  assert.equal(await B.locator('#planner-map .planner-map-pin').getAttribute('data-in-day'),'false',
    'Selecting a different day must not imply an overnight stay at this pinned place');
  // Ordinary day activities/ideas are not booking confirmations. Members can
  // edit them immediately, with the other member seeing the same day entry.
  await A.locator('#planner-experience-title').fill('Fictional museum');
  assert.equal(await A.locator('#planner-experience-day').inputValue(),'2');
  await A.locator('#planner-experience-notes').fill('Flexible afternoon');
  await A.locator('#planner-add-experience button[type=submit]').click();
  if(!(await B.locator('.journey-days').evaluate(n=>n.open)))
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

  // Establish a planned stay as the overlap baseline for the delayed add_stop
  // regression below. Earlier steps exercised Undo and restored it to possible.
  await B.locator('#planner-stays .planner-stay').getByRole('button',{name:'Mark planned'}).click();
  await A.locator('#planner-stays .planner-stay').getByRole('button',{name:'Keep as possible'}).waitFor();

  // Test the entire source-backed planner AI boundary on two fictional phones.
  // This uses only a deterministic local interpreter; it never calls a model.
  assert.equal(await A.locator('#planner-ask-ai').isVisible(),true);
  await A.locator('#planner-instruction').fill('Consider a visit to Fictional lookout on day 6');
  await A.locator('#planner-ask-ai').click();
  await A.locator('#planner-instruction-apply').waitFor({state:'visible',timeout:15000});
  assert.match(await A.locator('#planner-instruction-message').textContent(),/Review before Apply/);
  assert.equal(await B.locator('#planner-experiences').getByText('Fictional lookout').count(),0,
    'AI has no automatic record-writing authority');
  await A.locator('#planner-instruction-apply').click();
  await B.locator('#planner-experiences').getByText('Fictional lookout').waitFor({timeout:15000});
  await poll(async()=>await A.locator('#planner-history').textContent()
    .then(t=>t.includes('Member note: Consider a visit to Fictional lookout on day 6')));
  await A.locator('#planner-undo').click();
  await poll(async()=>await B.locator('#planner-experiences').getByText('Fictional lookout').count()===0);
  assert.match(await A.locator('#planner-history').textContent(),/Original planning source retained/);

  // A stale deterministic local gateway response must not restore Preview or Apply
  // after newer input, or after closing and reopening the same plan.
  const delayedPlanReplies=[];
  const planSuggestionUrl='http://127.0.0.1:8787/plan/suggest';
  const installDelayedPlanRoute=async page=>page.route(planSuggestionUrl,async route=>{
    if(route.request().method()!=='POST')return route.continue();
    const response=await route.fetch();
    const payload=await response.json();
    assert.equal(response.status(),200,'the local deterministic gateway must return a successful response');
    assert.ok(['preview','needs_detail'].includes(payload.kind),
      'the delayed reply must come from the fictional planner gateway');
    let release,finish;
    const gate=new Promise(resolve=>{release=resolve;});
    const completed=new Promise(resolve=>{finish=resolve;});
    const entry={release,payload,fail:false,responseStatus:null,response:completed};
    delayedPlanReplies.push(entry);
    await gate;
    try{
      if(entry.fail){
        const responseHeaders=response.headers();
        const corsHeaders=Object.fromEntries(['access-control-allow-origin',
          'access-control-allow-credentials','vary'].filter(name=>responseHeaders[name])
          .map(name=>[name,responseHeaders[name]]));
        await route.fulfill({status:500,headers:{...corsHeaders,
          'content-type':'application/json; charset=utf-8'},
          body:JSON.stringify({error:'Synthetic local gateway failure'})});
        entry.responseStatus=500;
      }else{
        await route.fulfill({response});
        entry.responseStatus=response.status();
      }
    }finally{finish();}
  });
  await installDelayedPlanRoute(A);
  await installDelayedPlanRoute(B);
  const startDelayedPlanRequest=async(page=A,expectedKind='preview')=>{
    const index=delayedPlanReplies.length;
    await page.locator('#planner-ask-ai').click();
    await poll(async()=>delayedPlanReplies.length>index);
    const entry=delayedPlanReplies[index];
    assert.equal(entry.payload.kind,expectedKind);
    return entry;
  };

  await A.locator('#planner-instruction').fill('Consider a visit to Fictional lookout on day 6');
  const afterNewInput=await startDelayedPlanRequest();
  await A.locator('#planner-instruction').fill('A newer fictional planning request');
  assert.equal(await A.locator('#planner-instruction-apply').isVisible(),false);
  afterNewInput.release();
  await afterNewInput.response;
  await poll(async()=>await A.locator('#planner-ask-ai').isEnabled());
  assert.equal(await A.locator('#planner-instruction-apply').isVisible(),false,
    'an old response cannot restore Apply after the instruction changes');
  assert.equal(await A.locator('#planner-instruction-result').isVisible(),false,
    'an old response cannot restore the preview after the instruction changes');

  await A.locator('#planner-instruction').fill('Plan 1 night in Fictional Annex starting day 2');
  const afterLocalPreviewDiscard=await startDelayedPlanRequest();
  await A.locator('#planner-instruction-form button[type="submit"]').click();
  await A.locator('#planner-instruction-apply').waitFor({state:'visible'});
  assert.match(await A.locator('#planner-instruction-message').textContent(),/Nothing has changed yet/);
  await A.locator('#planner-instruction-cancel').click();
  afterLocalPreviewDiscard.release();
  await afterLocalPreviewDiscard.response;
  assert.equal(await A.locator('#planner-instruction-apply').isVisible(),false,
    'a discarded local preview cannot be replaced by an older AI response');
  assert.equal(await A.locator('#planner-instruction-result').isVisible(),false,
    'discarding the local preview also invalidates the older AI result');

  // A delayed AI response also cannot replace a newer local preview created by
  // submitting an overlapping stop and then explicitly discarding that preview.
  await A.locator('#planner-instruction').fill('Add 1 night in Fictional Annex starting day 2');
  const beforeLocalDiscard=await startDelayedPlanRequest();
  assert.equal(beforeLocalDiscard.payload.change?.type,'add_stop',
    'the held fictional AI reply must propose an add_stop');
  assert.equal(beforeLocalDiscard.payload.change.stop.title,'Fictional Annex');
  assert.ok(beforeLocalDiscard.payload.change.stop.from_day<4&&
    beforeLocalDiscard.payload.change.stop.through_day>2,
    'the held AI stop must overlap the existing planned Fictional Harbour stay');
  await A.locator('#planner-instruction-form button[type="submit"]').click();
  await A.locator('#planner-instruction-apply').waitFor({state:'visible'});
  assert.match(await A.locator('#planner-instruction-message').textContent(),/Fictional Annex/);
  await A.locator('#planner-instruction-cancel').click();
  beforeLocalDiscard.release();
  await beforeLocalDiscard.response;
  assert.equal(await A.locator('#planner-instruction-apply').isVisible(),false,
    'discarding a newer local overlapping-stop preview invalidates the earlier AI response');
  assert.equal(await A.locator('#planner-instruction-result').isVisible(),false,
    'the discarded local preview remains cleared after the old AI response completes');

  // Replacing an uploaded fictional screenshot invalidates a pending clarification.
  await B.locator('#planner-instruction').fill('What can this fictional image tell us?');
  const screenshotBytes=await readFile(new URL('./fictional-landscape.png',import.meta.url));
  await B.locator('#planner-ai-screenshot').setInputFiles({
    name:'synthetic-first.png',mimeType:'image/png',buffer:screenshotBytes
  });
  const afterScreenshotReplacement=await startDelayedPlanRequest(B,'needs_detail');
  await B.locator('#planner-ai-screenshot').setInputFiles({
    name:'synthetic-replacement.png',mimeType:'image/png',buffer:screenshotBytes
  });
  afterScreenshotReplacement.release();
  await afterScreenshotReplacement.response;
  assert.equal(await B.locator('#planner-instruction-result').isVisible(),false,
    'replacing the screenshot cannot restore a response tied to the earlier image');

  // An older successful reply cannot overwrite a newer request, and its finally
  // cannot re-enable Ask AI while that newer request is still pending.
  await B.locator('#planner-ai-screenshot').setInputFiles([]);
  await B.locator('#planner-instruction').fill('Consider 1 night in Fictional Earlier Cove starting day 6');
  const olderSuccess=await startDelayedPlanRequest(B);
  await B.locator('#planner-instruction').fill('Consider 1 night in Fictional Current Cove starting day 7');
  const currentSuccess=await startDelayedPlanRequest(B);
  olderSuccess.release();
  await olderSuccess.response;
  assert.equal(await B.locator('#planner-ask-ai').isDisabled(),true,
    'an older request cannot enable the control while a newer request is pending');
  assert.equal(await B.locator('#planner-instruction-apply').isVisible(),false,
    'an older success cannot show Apply while a newer request is pending');
  currentSuccess.release();
  await currentSuccess.response;
  await B.locator('#planner-instruction-apply').waitFor({state:'visible'});
  assert.match(await B.locator('#planner-instruction-message').textContent(),/Fictional Current Cove/);

  // A stale failure after the newer success must not replace its preview or surface an error.
  await B.locator('#planner-instruction').fill('Consider 1 night in Fictional Error Cove starting day 6');
  const olderFailure=await startDelayedPlanRequest(B);
  await B.locator('#planner-instruction').fill('Consider 1 night in Fictional Latest Cove starting day 7');
  const latestSuccess=await startDelayedPlanRequest(B);
  latestSuccess.release();
  await latestSuccess.response;
  await B.locator('#planner-instruction-apply').waitFor({state:'visible'});
  olderFailure.fail=true;
  olderFailure.release();
  await olderFailure.response;
  assert.equal(await olderFailure.responseStatus,500,
    'the delayed stale-error fixture must actually return the synthetic gateway failure');
  assert.equal((await B.locator('#error').textContent()).trim(),'',
    'a stale gateway error cannot surface in the member error area');
  assert.equal(await B.locator('#planner-instruction-apply').isVisible(),true,
    'an older failure cannot discard a newer preview');
  assert.match(await B.locator('#planner-instruction-message').textContent(),/Fictional Latest Cove/);

  // Hold one Firestore Commit RPC so UI intent can change while an already
  // authorized transaction save is in flight. The emulator request resumes unchanged.
  const holdNextPlannerSave=async page=>{
    let waiting=true,startedResolve,committedResolve,releaseResolve;
    const started=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Timed out waiting for the fictional Firestore save')),15000);
      startedResolve=url=>{clearTimeout(timeout);resolve(url);};
    });
    const committed=new Promise(resolve=>{committedResolve=resolve;});
    const held=new Promise(resolve=>{releaseResolve=resolve;});
    await page.route('http://127.0.0.1:8081/**',async route=>{
      const request=route.request();
      if(waiting&&request.method()==='POST'&&request.url().includes(':commit')){
        waiting=false;startedResolve(request.url());
        // Let the emulator commit while holding only the browser's response.
        // This keeps subsequent membership reads available during re-login.
        const response=await route.fetch();
        committedResolve(response.status());
        await held;
        await route.fulfill({response});
        return;
      }
      await route.continue();
    });
    return {started,committed,release:releaseResolve,remove:()=>page.unroute('http://127.0.0.1:8081/**')};
  };
  const releaseAndWaitForPlannerSave=async(page,held)=>{
    const requestUrl=await held.started;
    const responsePromise=page.waitForResponse(response=>
      response.url()===requestUrl&&response.request().method()==='POST',{timeout:15000});
    held.release();
    const response=await responsePromise;
    assert.equal(response.status(),200,'the held fictional Firestore Commit must complete successfully');
    assert.equal(await response.finished(),null,'the held Commit response body must finish cleanly');
    // Let the browser process the completed response and application continuations
    // before asserting that a stale completion left newer UI untouched.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
  };

  await A.locator('#planner-instruction').fill('Plan 1 night in Fictional Annex starting day 2');
  await A.locator('#planner-instruction-form button[type="submit"]').click();
  await A.locator('#planner-instruction-apply').waitFor({state:'visible'});
  const saveThenNewInput=await holdNextPlannerSave(A);
  await A.locator('#planner-instruction-apply').click();
  assert.match(await saveThenNewInput.started,/\/documents:commit(?:\?|$)/,
    'the gate must hold the transaction Commit RPC, not a WebChannel request');
  await A.locator('#planner-instruction').fill('Keep this newer fictional request for later');
  await releaseAndWaitForPlannerSave(A,saveThenNewInput);
  await B.locator('#planner-stays').getByText('Fictional Annex').waitFor({timeout:15000});
  assert.equal(await A.locator('#planner-instruction').inputValue(),
    'Keep this newer fictional request for later',
    'completion of an older Apply cannot clear a newer instruction');
  assert.equal(await A.locator('#planner-instruction-message').textContent().then(t=>t.includes('Saved:')),false,
    'completion of an older Apply cannot replace the newer request status');
  await saveThenNewInput.remove();

  await A.locator('#planner-title').fill('Fictional Alternate Coast');
  await A.locator('#planner-date').fill('2026-12-01');
  await A.locator('#planner-days').fill('5');
  await A.locator('#planner-create button[type="submit"]').click();
  await A.locator('#planner-list .planner-card').filter({hasText:'Fictional Alternate Coast'}).waitFor();
  await A.locator('#planner-list .planner-card').filter({hasText:'Fictional Shared Coast'})
    .getByRole('button',{name:'Open plan'}).click();
  await A.locator('#planner-detail-title').getByText('Fictional Shared Coast',{exact:true}).waitFor();
  await A.locator('#planner-instruction').fill('Plan 1 night in Fictional Peninsula starting day 3');
  await A.locator('#planner-instruction-form button[type="submit"]').click();
  await A.locator('#planner-instruction-apply').waitFor({state:'visible'});
  const saveThenSwitchPlan=await holdNextPlannerSave(A);
  await A.locator('#planner-instruction-apply').click();
  assert.match(await saveThenSwitchPlan.started,/\/documents:commit(?:\?|$)/,
    'the plan-switch race must hold the transaction Commit RPC');
  await A.locator('#planner-list .planner-card').filter({hasText:'Fictional Alternate Coast'})
    .getByRole('button',{name:'Open plan'}).click();
  await A.locator('#planner-detail-title').getByText('Fictional Alternate Coast',{exact:true}).waitFor();
  await A.locator('#planner-instruction').fill('Draft for the alternate fictional plan');
  await releaseAndWaitForPlannerSave(A,saveThenSwitchPlan);
  await B.locator('#planner-stays').getByText('Fictional Peninsula').waitFor({timeout:15000});
  assert.equal(await A.locator('#planner-detail-title').textContent(),'Fictional Alternate Coast',
    'completion of an older Apply cannot switch the currently selected plan');
  assert.equal(await A.locator('#planner-instruction').inputValue(),
    'Draft for the alternate fictional plan',
    'completion of an older Apply cannot erase the new plan’s draft');
  await saveThenSwitchPlan.remove();
  await A.locator('#planner-list .planner-card').filter({hasText:'Fictional Shared Coast'})
    .getByRole('button',{name:'Open plan'}).click();
  await A.locator('#planner-detail-title').getByText('Fictional Shared Coast',{exact:true}).waitFor();

  await A.locator('#planner-instruction').fill('Consider a visit to Fictional lookout on day 6');
  const afterCloseReopen=await startDelayedPlanRequest();
  await A.locator('#planner-close').click();
  await A.locator('#planner-list .planner-card').filter({hasText:'Fictional Shared Coast'})
    .getByRole('button',{name:'Open plan'}).click();
  await A.locator('#planner-detail').waitFor({state:'visible'});
  afterCloseReopen.release();
  await afterCloseReopen.response;
  assert.equal(await A.locator('#planner-instruction-apply').isVisible(),false,
    'closing and reopening the same plan invalidates its earlier response');
  assert.equal(await A.locator('#planner-instruction-result').isVisible(),false,
    'closing and reopening the same plan cannot restore its earlier preview');
  await A.unroute(planSuggestionUrl);
  await B.unroute(planSuggestionUrl);

  // A saved screenshot is protected and retained but the fictional interpreter
  // explicitly declines to describe pixels or manufacture a booking.
  await A.locator('#planner-instruction').fill('What can this fictional image tell us?');
  await A.locator('#planner-instruction-form .planner-coordinates summary').click();
  await A.locator('#planner-ai-screenshot').setInputFiles({
    name:'synthetic-idea.png',mimeType:'image/png',
    buffer:await readFile(new URL('./fictional-landscape.png',import.meta.url))
  });
  await A.locator('#planner-ask-ai').click();
  try{
    await A.locator('#planner-instruction-result').getByText(/fictional provider cannot interpret/i)
      .waitFor({timeout:10000});
  }catch(failure){
    throw Error('Private screenshot clarification failed: '+failure.message+
      ' | error: '+(await A.locator('#error').textContent())+
      ' | status: '+(await A.locator('#planner-instruction-result').textContent())+
      ' | button disabled: '+await A.locator('#planner-ask-ai').isDisabled()+
      ' | page: '+pageErrors.join(' / '));
  }
  assert.equal(await A.locator('#planner-instruction-apply').isVisible(),false);
  assert.equal((await B.locator('#planner-stays').textContent()).includes('Fictional lookout'),false);

  // A records a fictional supplier anchor and PDF; B opens the exact protected
  // original through the shared itinerary. No supplier booking is amended.
  await A.getByText('Booking anchors',{exact:true}).click();
  await B.getByText('Booking anchors',{exact:true}).click();
  await A.locator('#planner-booking-file').setInputFiles({
    name:'synthetic-booking.pdf',mimeType:'application/pdf',
    buffer:syntheticBookingPdf('Hotel: Synthetic Waterfront Inn\nCheck-in: 2026-11-02\nCheck-out: 2026-11-05\nBooking reference: FICT-BOOKING-1')
  });
  await A.locator('#planner-booking-pdf-extract').click();
  await poll(async()=>await A.locator('#planner-booking-title').inputValue()==='Synthetic Waterfront Inn');
  assert.equal(await A.locator('#planner-booking-start').inputValue(),'2026-11-02');
  assert.equal(await A.locator('#planner-booking-end').inputValue(),'2026-11-05');
  assert.match(await A.locator('#planner-booking-extraction-feedback').textContent(),/read locally/);
  assert.equal(await B.locator('#planner-bookings .planner-booking-entry').count(),0,
    'Reading a PDF only fills editable suggestions; it does not save a booking');
  await A.locator('#planner-booking-file').setInputFiles([]);
  await A.locator('#planner-booking-reference').fill('');
  await A.locator('#planner-booking-title').fill('Fictional inn confirmation');
  await A.locator('#planner-booking-kind').selectOption('stay');
  const relatedStop=await A.locator('#planner-booking-stop option').filter({hasText:'Fictional Harbour Revised'})
    .getAttribute('value');
  assert.ok(relatedStop,'Booking can be anchored to a saved place');
  await A.locator('#planner-booking-stop').selectOption(relatedStop);
  await A.locator('#planner-booking-start').fill('2026-11-02');
  await A.locator('#planner-booking-end').fill('2026-11-05');
  await A.locator('#planner-booking-supplier').fill('Test-only supplier');
  await A.locator('#planner-booking-state').selectOption('confirmed');
  await A.locator('#planner-add-booking button[type=submit]').click();
  await poll(async()=>/Add an original document, pasted confirmation or booking reference/
    .test(await A.locator('#error').textContent()));
  assert.equal(await B.locator('#planner-bookings .planner-booking-entry')
    .filter({hasText:'Fictional inn confirmation'}).count(),0,
    'An unsubstantiated confirmation never enters the shared plan');
  await A.locator('#planner-booking-reference').fill('SYNTHETIC-REF');
  await A.locator('#planner-booking-file').setInputFiles({
    name:'synthetic-source.pdf',mimeType:'application/pdf',
    buffer:syntheticBookingPdf('Fictional original booking record')
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
  await B.locator('#planner-feedback').click();
  await B.locator('#planner-feedback-results').getByRole('button',{name:'View related booking'}).first().click();
  await B.locator('#planner-booking-source').getByText('SYNTHETIC-REF',{exact:false}).waitFor();
  await A.locator('#planner-stays .planner-stay').getByRole('button',{name:/Booking: Fictional inn confirmation/}).click();
  await A.locator('#planner-booking-source').getByText('SYNTHETIC-REF',{exact:false}).waitFor();
  if(!(await B.locator('.journey-days').evaluate(n=>n.open)))
    await B.getByText('Explore days',{exact:true}).click();
  await B.locator('.planner-week').first().getByRole('button',{name:/Day 2/}).click();
  await B.locator('#planner-day-detail').getByRole('button',{name:/View booking · Fictional inn confirmation/}).click();
  assert.equal(await B.locator('#planner-booking-source').textContent(),'',
    'opening a new booking clears the previous source while current details load');
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
  // A pastes a second fictional supplier note. Extraction runs only in the
  // browser, does not mark a booking confirmed, and keeps the exact original
  // text for B behind normal member authentication.
  await A.getByText('Paste booking text (optional)',{exact:true}).click();
  const pasted=['Booking title: Synthetic Bay Crossing','Ferry: Fictional route',
    'Departure: 4 November 2026','Arrival: 2026-11-04',
    'Booking reference: FICT-FERRY-47'].join('\n');
  await A.locator('#planner-booking-paste').fill(pasted);
  await A.locator('#planner-booking-extract').click();
  assert.equal(await A.locator('#planner-booking-title').inputValue(),'Synthetic Bay Crossing');
  assert.equal(await A.locator('#planner-booking-kind').inputValue(),'transport');
  assert.equal(await A.locator('#planner-booking-start').inputValue(),'2026-11-04');
  assert.equal(await A.locator('#planner-booking-end').inputValue(),'2026-11-04');
  assert.equal(await A.locator('#planner-booking-state').inputValue(),'unverified',
    'Text recognition must not claim that a supplier confirmed a booking');
  assert.match(await A.locator('#planner-booking-extraction-feedback').textContent(),/No booking was confirmed/);
  await A.locator('#planner-add-booking button[type=submit]').click();
  const pastedCard=B.locator('#planner-bookings .planner-booking-entry')
    .filter({hasText:'Synthetic Bay Crossing'});
  await pastedCard.waitFor({timeout:15000});
  assert.match(await pastedCard.textContent(),/Possible or unverified/);
  await pastedCard.getByRole('button',{name:'Show original details'}).click();
  await B.locator('#planner-booking-source')
    .getByText('Booking reference: FICT-FERRY-47',{exact:false}).waitFor({timeout:15000});
  assert.match(await B.locator('#planner-booking-source').textContent(),
    /Ferry: Fictional route/);
  // Check the same connected planner in a desktop viewport, not merely the
  // previous pilot chat: the map, source and selected day remain available.
  await B.setViewportSize({width:1280,height:900});
  assert.equal(await B.locator('#planner-map .planner-map-pin').isVisible(),true);
  assert.equal(await B.locator('#planner-map .planner-map-selected').isVisible(),true);
  assert.equal(await B.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,
    'The planner must not overflow a desktop viewport');
  await B.setViewportSize({width:390,height:844});
  // A stay edit drafted before another member's save must not overwrite their
  // newer changes, even when live updates arrive during the draft.
  await A.locator('#planner-stays .planner-stay').filter({hasText:'Fictional Harbour Revised'})
    .getByRole('button',{name:'Edit details'}).click();
  await A.locator('#planner-edit-title').fill('Unsaved outdated name');
  await B.locator('#planner-stays .planner-stay').filter({hasText:'Fictional Harbour Revised'})
    .getByRole('button',{name:'Edit details'}).click();
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
  await A.locator('#planner-lessons-panel').waitFor({state:'visible'});
  assert.equal(await A.locator('#planner-lessons').getByText(/No lessons saved yet/).count(),1);
  const lesson='Fictional lesson: keep extra time between the coastal stops.';
  await B.locator('#planner-lesson-text').fill(lesson);
  await B.locator('#planner-add-lesson button[type=submit]').click();
  await A.locator('#planner-lessons').getByText(lesson,{exact:true}).waitFor({timeout:15000});
  await poll(async()=>await A.locator('#planner-history').textContent()
    .then(v=>v.includes('add lesson')));
  await A.locator('#planner-undo').click();
  await poll(async()=>await B.locator('#planner-lessons').getByText(lesson,{exact:true}).count()===0);
  await B.locator('#planner-lesson-text').fill(lesson);
  await B.locator('#planner-add-lesson button[type=submit]').click();
  await A.locator('#planner-lessons').getByText(lesson,{exact:true}).waitFor({timeout:15000});
  await B.locator('#planner-archive').click();
  await poll(async()=>await A.locator('#planner-archive').textContent()==='Move to archive');
  assert.equal(await A.locator('#planner-lessons-panel').isVisible(),true,
    'Earlier lessons remain available for reference when an adventure returns to planning');
  await A.locator('#planner-bookings').getByText('Fictional inn confirmation',{exact:true}).waitFor({timeout:15000});

  // Month-only adventures are first-class, explicitly uncertain records.
  // The second member can choose a precise date and Undo without losing the
  // original approximate month or inventing a calendar day.
  await A.locator('#planner-title').fill('Fictional December possibility');
  await A.locator('#planner-month').fill('2027-12');
  assert.equal(await A.locator('#planner-date').inputValue(),'');
  await A.locator('#planner-days').fill('8');
  await A.locator('#planner-create button[type=submit]').click();
  const monthCard=B.locator('#planner-list .planner-card')
    .filter({hasText:'Fictional December possibility'});
  await monthCard.waitFor({timeout:15000});
  await monthCard.getByText('Around December 2027',{exact:false}).waitFor();
  await monthCard.getByRole('button',{name:'Open plan'}).click();
  await B.locator('#planner-summary')
    .getByText('Approximate December 2027 (no day chosen)',{exact:false})
    .waitFor({timeout:15000});
  assert.equal((await B.locator('#planner-days-view').textContent()).includes('2027-12-01'),
    false,'No invented first-of-month day may appear in an undated journey');
  if(!(await B.locator('#planner-trip-form').isVisible()))
    await B.getByText('Dates and trip basics',{exact:true}).click();
  assert.equal(await B.locator('#planner-trip-month').inputValue(),'2027-12');
  assert.equal(await B.locator('#planner-trip-date').inputValue(),'');
  await B.locator('#planner-trip-date').fill('2027-12-11');
  assert.equal(await B.locator('#planner-trip-month').inputValue(),'',
    'Choosing a precise day must clear the approximate month');
  await B.locator('#planner-trip-form button[type=submit]').click();
  await poll(async()=>await A.locator('#planner-summary').textContent()
    .then(v=>v.includes('2027-12-11')));
  await B.locator('#planner-undo').click();
  await poll(async()=>await A.locator('#planner-summary').textContent()
    .then(v=>v.includes('Approximate December 2027 (no day chosen)')));
  await B.locator('#planner-today').click();
  await B.locator('#planner-today-result')
    .getByText('An approximate month is not a travel date.',{exact:false}).waitFor();
  assert.equal((await B.locator('#planner-today-result').textContent())
    .includes('Recorded travel and booking essentials'),false,
    'Month-only plans cannot manufacture dated travel commitments');

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
  // Complete a real emulator page read, then defer only its UI continuation.
  // Switching away and back must not strand the shared pagination button.
  await B.evaluate(()=>window.__justelleTestSessionRaces.installEarlierPageGate());
  await B.locator('#earlier-button').click();
  await B.waitForFunction(()=>window.__justelleTestSessionRaces.gates.earlierPage.fetched,
    undefined,{timeout:15000});
  await openDiscussion(B,topic1);
  await openDiscussion(B,topic2);
  await B.locator('#earlier-button').waitFor({state:'visible'});
  assert.equal(await B.locator('#earlier-button').isEnabled(),true,
    'switching conversations resets a stale earlier-page loading button');
  await B.evaluate(()=>window.__justelleTestSessionRaces.gates.earlierPage.release());
  await B.waitForTimeout(100);
  assert.equal(await B.locator('#earlier-button').isEnabled(),true,
    'completion of the old topic request cannot disable the new topic button');
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
  assert.equal(bundle.records.adventure_plans.length,3);
  const roughMonth=bundle.records.adventure_plans.find(p=>
    p.state.title==='Fictional December possibility');
  assert.ok(roughMonth,'Month-only adventures remain in a portable export');
  assert.equal(roughMonth.state.starts_month,'2027-12');
  assert.equal(roughMonth.state.starts_on,null);
  assert.ok(bundle.records.plan_events.some(e=>
    e.adventure_id===roughMonth.id&&e.after_state.starts_month==='2027-12'));
  assert.equal(bundle.records.plan_documents.length,3,
    'Both protected supplier PDF and original AI screenshot remain in the portable archive');
  assert.ok(bundle.media.some(f=>f.mime==='application/pdf'));
  assert.ok(bundle.media.some(f=>f.mime==='image/png'));

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
  await again.locator('[data-tab="conversation"]').click();

  // Signing out clears rendered private content and image URLs, not just the
  // visibility of the app shell.
  await again.locator('[data-topic-id="conversation-shared"]').click();
  const privateImage=again.locator('#messages .image-preview-button').first();
  await privateImage.waitFor({state:'visible'});
  await poll(async()=>privateImage.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0));
  await privateImage.click();
  await again.locator('#image-viewer').waitFor({state:'visible'});
  await poll(async()=>Boolean(await again.locator('#full-image').getAttribute('src')));
  await again.locator('#close-image').click();
  await again.locator('#image-viewer').waitFor({state:'hidden'});
  await again.locator('#sign-out').click();
  await again.locator('#login').waitFor({state:'visible'});
  await assertPrivateUiCleared(again);

  // Hold a member bootstrap read, then switch to an unprivileged fictional
  // account. Releasing the old response must not reopen the previous session.
  const oldMemberRead=await holdFirstRequest(again,'http://127.0.0.1:8081/**','POST');
  await again.locator('#email').fill(fixture.a.email);
  await again.locator('#password').fill(fixture.a.password);
  await again.locator('#login-form button').click();
  await poll(async()=>oldMemberRead.captured(),15000);
  await again.locator('#sign-out').waitFor({state:'visible'});
  await again.locator('#sign-out').click();
  await again.locator('#login').waitFor({state:'visible'});
  await again.locator('#email').fill(fixture.outsider.email);
  await again.locator('#password').fill(fixture.outsider.password);
  const outsiderAuthResponse=again.waitForResponse(response=>
    response.url().includes('/accounts:signInWithPassword'),{timeout:15000});
  await again.locator('#login-form button').click();
  assert.equal((await outsiderAuthResponse).status(),200,
    'the synthetic outsider must authenticate before membership rejection is tested');
  await poll(async()=>{
    const message=(await again.locator('#error').textContent()).toLowerCase();
    return await again.locator('#login').isVisible()&&
      !(await again.locator('#private-app').isVisible())&&
      /permission|access|member|claim/.test(message);
  });
  const outsiderError=(await again.locator('#error').textContent()).toLowerCase();
  const denialCategory=outsiderError.includes('permission')?'permission':
    /access|member|claim/.test(outsiderError)?'access':outsiderError?'other':'empty';
  assert.ok(['access','permission'].includes(denialCategory),
    'outsider rejection category should identify an access denial; received '+denialCategory);
  await assertPrivateUiCleared(again);
  oldMemberRead.release();await oldMemberRead.continued;
  await again.unroute('http://127.0.0.1:8081/**');
  await assertPrivateUiCleared(again);

  // Revoking one fictional member's auth_time invalidates the next protected
  // request. An already-started image response is released only after logout
  // and must not restore its image into the new unauthenticated UI.
  const delayedImage=await holdFirstRequest(again,'http://127.0.0.1:9199/**','GET');
  await again.locator('#email').fill(fixture.a.email);
  await again.locator('#password').fill(fixture.a.password);
  await again.locator('#login-form button').click();
  await again.locator('#private-app').waitFor({state:'visible',timeout:25000});
  await poll(async()=>delayedImage.captured(),15000);
  const revokeApp=initializeApp({projectId:'demo-justelle-pilot'},'justelle-browser-session-revocation');
  const revokeDb=getFirestore(revokeApp);
  try{
    await revokeDb.doc('rooms/fictional-room').update({
      revoked_auth_before:{'fictional-a':Math.floor(Date.now()/1000)+120}
    });
  }finally{await revokeDb.terminate();await deleteApp(revokeApp);}
  await again.locator('#message-input').fill('Fictional request after membership revocation');
  await again.locator('#send-button').click();
  await again.locator('#login').waitFor({state:'visible',timeout:15000});
  await assertPrivateUiCleared(again);
  delayedImage.release();await delayedImage.continued;
  await again.unroute('http://127.0.0.1:9199/**');
  await assertPrivateUiCleared(again);
  assert.equal(await B.locator('#private-app').isVisible(),true,
    'revoking Fictional A does not sign out the other fictional room member');

  // An already accepted Firestore write may finish after sign-out, but its
  // stale completion must not repopulate the signed-out UI. The emulator response
  // is released before re-authentication so membership bootstrap can complete.
  await B.locator('[data-tab="adventures"]').click();
  const sharedCard=B.locator('#planner-list .planner-card').filter({hasText:'Fictional Coast Updated'});
  await sharedCard.getByRole('button',{name:'Open plan'}).click();
  await openTripBasics(B);
  await B.locator('#planner-trip-title').fill('Fictional unsaved session draft');
  assert.equal(await B.locator('#planner-trip-form').evaluate(form=>form.dataset.dirty),'true');
  const oldStay=B.locator('#planner-stays .planner-stay').filter({hasText:'Fictional Coast Harbour'});
  await oldStay.getByRole('button',{name:'Edit details'}).click();
  await B.locator('#planner-edit-title').fill('Fictional old-session save');
  await B.evaluate(()=>window.__justelleTestSessionRaces.installEditGate('old'));
  await B.locator('#planner-edit-stay button[type=submit]').click();
  await B.waitForFunction(()=>window.__justelleTestSessionRaces?.gates.old?.committed===true,
    null,{timeout:15000});
  await B.locator('#sign-out').click();
  await B.locator('#login').waitFor({state:'visible'});
  await poll(async()=>/Sign in once on a trusted browser/.test(await B.locator('#notice').textContent()));
  await assertPrivateUiCleared(B);

  await signInOnCurrentPage(B,fixture.b);
  await B.locator('[data-tab="adventures"]').click();
  await B.locator('#planner-list .planner-card').filter({hasText:'Fictional Coast Updated'})
    .getByRole('button',{name:'Open plan'}).click();
  await openTripBasics(B);
  assert.equal(await B.locator('#planner-trip-title').inputValue(),'Fictional Coast Updated',
    'reopening the same plan repopulates trip details after clearing the old dirty draft');
  assert.equal(await B.locator('#planner-trip-form').evaluate(form=>form.dataset.dirty),'false');
  const committedStay=B.locator('#planner-stays .planner-stay').filter({hasText:'Fictional old-session save'});
  await committedStay.getByRole('button',{name:'Edit details'}).click();
  await B.locator('#planner-edit-title').fill('Fictional new-session draft');
  await B.evaluate(()=>window.__justelleTestSessionRaces.installEditGate('new'));
  await B.locator('#planner-edit-stay button[type=submit]').click();
  await B.waitForFunction(()=>window.__justelleTestSessionRaces?.gates.new?.committed===true,
    null,{timeout:15000});
  await B.evaluate(()=>window.__justelleTestSessionRaces.gates.old.release());
  assert.equal(await B.locator('#planner-edit-stay').isVisible(),true,
    'old-session completion cannot close the new session editor');
  assert.equal(await B.locator('#planner-edit-title').inputValue(),'Fictional new-session draft',
    'old-session completion cannot clear the newer session draft');
  assert.equal(await B.locator('#planner-edit-stay button[type=submit]').isDisabled(),true,
    'old-session finally cannot re-enable the newer pending save');
  await B.evaluate(()=>window.__justelleTestSessionRaces.gates.new.release());
  await poll(async()=>!await B.locator('#planner-edit-stay button[type=submit]').isDisabled());
  await poll(async()=>!await B.locator('#planner-edit-stay').isVisible());

  // Closing a session during a protected-original read suppresses the
  // completion, clears member-recorded source fields/options and creates no download.
  await B.getByText('Booking anchors',{exact:true}).click();
  const originalEntry=B.locator('#planner-bookings .planner-booking-entry')
    .filter({hasText:'Fictional inn confirmation'});
  await originalEntry.getByRole('button',{name:'Show original details'}).click();
  await B.getByRole('button',{name:'Open protected original'}).waitFor({state:'visible'});
  const delayedOriginal=await holdFirstRequest(B,'http://127.0.0.1:9199/**','GET');
  let staleDownloadCount=0;
  const recordStaleDownload=()=>{staleDownloadCount++;};
  B.on('download',recordStaleDownload);
  await B.getByRole('button',{name:'Open protected original'}).click();
  await poll(async()=>delayedOriginal.captured(),15000);
  await B.locator('#sign-out').click();
  await B.locator('#login').waitFor({state:'visible'});
  await poll(async()=>/Sign in once on a trusted browser/.test(await B.locator('#notice').textContent()));
  await assertPrivateUiCleared(B);
  delayedOriginal.release();
  await delayedOriginal.continued;
  assert.ok([200,206].includes(delayedOriginal.responseStatus),
    'the protected original request completed successfully before checking stale-download suppression');
  assert.equal(delayedOriginal.responseFinished,true,
    'the protected original response body completed without a network error');
  await B.waitForTimeout(250);
  B.off('download',recordStaleDownload);
  assert.equal(staleDownloadCount,0,
    'a protected original response from the signed-out session cannot trigger a download');
  await B.unroute('http://127.0.0.1:9199/**');
  assert.deepEqual(pageErrors,[]);
  console.log('BROWSER PASS: scoped chats, two-member plans, stale AI protection, archive restore, outsider denial, session revocation, sign-out clearing, stale auth/image response suppression and persistence');
}finally{
  await ctxA?.close();await ctxB?.close();app.kill('SIGTERM');await unlink(fixtureFile).catch(()=>{});
}
