import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {restoreArchive} from '../memory/restore.mjs';

const fixtureFile=process.argv[2];
if(!fixtureFile)throw Error('Need disposable emulator credentials file');
const fixture=JSON.parse(await readFile(fixtureFile,'utf8'));
const base='http://127.0.0.1:5173/';
const app=spawn(process.execPath,['node_modules/vite/bin/vite.js','web','--host','127.0.0.1','--port','5173','--strictPort'],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),env:process.env,stdio:'ignore'
});
let ctxA,ctxB;const pagesErrors=[];
async function waitFor(url) {
  for(let i=0;i<90;i++) {
    try {const response=await fetch(url);if(response.status<500)return;}
    catch{}await new Promise(resolve=>setTimeout(resolve,450));
  }
  throw Error('Local service not ready: '+url);
}
async function login(page,account) {
  await page.goto(base);
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.locator('#login-form button').click();
  try {await page.locator('#private-app').waitFor({state:'visible',timeout:25000});}
  catch(e){throw Error('Member sign-in did not reach the private app; visible diagnostic: '+(await page.locator('#error').textContent())+' / '+(await page.locator('#notice').textContent()));}
}
try {
  await Promise.all([waitFor(base),waitFor('http://127.0.0.1:8787/respond')]);
  const dirA=await mkdtemp(join(tmpdir(),'justelle-profile-a-'));
  const dirB=await mkdtemp(join(tmpdir(),'justelle-profile-b-'));
  ctxA=await chromium.launchPersistentContext(dirA,{headless:true,viewport:{width:390,height:844},acceptDownloads:true});
  ctxB=await chromium.launchPersistentContext(dirB,{headless:true,viewport:{width:390,height:844},acceptDownloads:true});
  const A=await ctxA.newPage(),B=await ctxB.newPage();
  A.on('pageerror',e=>pagesErrors.push('A: '+e.message));
  B.on('pageerror',e=>pagesErrors.push('B: '+e.message));
  await login(A,fixture.a);await login(B,fixture.b);
  await A.locator('#message-input').fill('Could we plan a fictional floating museum visit?');
  await A.locator('#image-input').setInputFiles({name:'fictional-landscape.png',mimeType:'image/png',buffer:await readFile(new URL('./fictional-landscape.png',import.meta.url))});
  await A.locator('#staged-images img').waitFor();
  await A.locator('#ask-ai-button').click();
  await B.getByText('Could we plan a fictional floating museum visit?',{exact:true}).waitFor({timeout:20000});
  await B.locator('#message-input').fill('Fictional member B replies with a new thought.');
  await B.locator('#send-button').click();
  await A.getByText('Fictional member B replies with a new thought.',{exact:true}).waitFor({timeout:15000});
  await B.locator('.image-tile').first().waitFor();
  await B.waitForFunction(()=>document.querySelector('.image-tile')?.naturalWidth>0,{timeout:15000});
  await B.getByText(/I received 1 original image securely/).waitFor({timeout:20000});
  await B.locator('[data-tab="agreements"]').click();
  await B.getByText(/Fictional suggestion to explore/).waitFor({timeout:15000});
  const agreeB=B.locator('.record-card button').filter({hasText:'I agree'}).first();
  await agreeB.click();
  await B.getByText('Proposed · 1/2 approvals',{exact:false}).waitFor({timeout:15000});
  await A.locator('[data-tab="agreements"]').click();
  await A.locator('.record-card button').filter({hasText:'I agree'}).first().click();
  await B.getByText('Locked · 2/2 approvals',{exact:false}).waitFor({timeout:15000});
  await A.locator('.record-card button').filter({hasText:'Suggest revision'}).first().click();
  await A.locator('#reason-input').fill('Fictional new information');
  await A.locator('#proposal-form button[type="submit"]').click();
  await A.getByText(/Proposed replacement of earlier agreement/).waitFor({timeout:15000});
  await A.locator('[data-tab="adventures"]').click();
  await A.locator('#idea-input').fill('Fictional coastal walk');
  await A.locator('#idea-form button').click();
  await B.locator('[data-tab="adventures"]').click();
  await B.getByRole('heading',{name:'Fictional coastal walk',exact:true}).waitFor({timeout:15000});
  for(const label of ['Move to plan','Move to experience','Move to memory']) {
    await B.getByRole('button',{name:label}).first().click();
  }
  await B.getByText(/idea → plan → experience → memory/).waitFor({timeout:15000});
  const [download]=await Promise.all([A.waitForEvent('download',{timeout:30000}),A.locator('#export-button').click()]);
  const bundle=JSON.parse(await readFile(await download.path(),'utf8'));
  const restored=join(await mkdtemp(join(tmpdir(),'justelle-browser-restore-')),'restored');
  const summary=await restoreArchive(bundle,restored);
  assert.ok(summary.records.messages>=2);
  assert.ok(summary.records.decisions>=2);
  assert.ok(summary.files>=1);
  assert.ok(summary.records.adventures>=1);
  await A.reload();
  await A.locator('#private-app').waitFor({state:'visible',timeout:25000});
  assert.equal(await A.locator('#login').isVisible(),false);
  await ctxA.close();ctxA=null;
  ctxA=await chromium.launchPersistentContext(dirA,{headless:true,viewport:{width:390,height:844},acceptDownloads:true});
  const again=await ctxA.newPage();await again.goto(base);
  await again.locator('#private-app').waitFor({state:'visible',timeout:25000});
  assert.equal(await again.locator('#login').isVisible(),false);
  assert.deepEqual(pagesErrors,[]);
  console.log('BROWSER PASS: 390px independent accounts, two-way snapshots, image preview, secured mock vision bytes, two approvals, revisions, adventures, independent export/restore, persistent browser-profile login');
} finally {
  await ctxA?.close();await ctxB?.close();app.kill('SIGTERM');await unlink(fixtureFile).catch(()=>{});
}
