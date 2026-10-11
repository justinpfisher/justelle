import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const fixtureFile=process.argv[2];
if(!fixtureFile) throw Error('Require path to ephemeral fixture credentials');
const fixture=JSON.parse(await readFile(fixtureFile,'utf8'));
const base='http://127.0.0.1:5173/';
const app=spawn(process.execPath,['node_modules/vite/bin/vite.js','web','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'ignore',env:process.env,cwd:fileURLToPath(new URL('../',import.meta.url))});
let browserA,browserB;
const wait=async()=>{for(let i=0;i<60;i++){try{const r=await fetch(base);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Web pilot did not start');};
async function login(page,info){
 await page.goto(base);
 await page.locator('#email').fill(info.email);
 await page.locator('#password').fill(info.password);
 await page.locator('#login-form button').click();
 await page.getByText('Signed in; persistent local session enabled').waitFor({timeout:15000});
 await page.locator('#app').waitFor({state:'visible'});
}
try {
 await wait();
 const d1=await mkdtemp(join(tmpdir(),'justelle-browser-a-'));
 const d2=await mkdtemp(join(tmpdir(),'justelle-browser-b-'));
 browserA=await chromium.launchPersistentContext(d1,{headless:true,viewport:{width:390,height:844}});
 browserB=await chromium.launchPersistentContext(d2,{headless:true,viewport:{width:390,height:844}});
 const A=await browserA.newPage(),B=await browserB.newPage();
 A.on('pageerror',e=>process.stderr.write(`A page error: ${e.message}\n`));
 B.on('pageerror',e=>process.stderr.write(`B page error: ${e.message}\n`));
 await login(A,fixture.a);await login(B,fixture.b);
 await A.locator('#message').fill('Fictional: perhaps explore a floating museum.');
 await A.locator('#chat-form button').click();
 await B.getByText('Fictional: perhaps explore a floating museum.',{exact:false}).waitFor({timeout:15000});
 await A.locator('#proposal').fill('Fictional AI-style suggestion: visit the floating museum.');
 await A.locator('#proposal-form button').click();
 await B.getByText('Fictional AI-style suggestion: visit the floating museum.',{exact:false}).waitFor({timeout:15000});
 assert.match(await B.locator('#decisions').innerText(),/proposed/);
 const aBtn=A.locator('#decisions button').first(), bBtn=B.locator('#decisions button').first();
 await aBtn.click();
 await B.getByText('1/2 approvals',{exact:false}).waitFor({timeout:15000});
 assert.match(await B.locator('#decisions').innerText(),/proposed/);
 await bBtn.click();
 await A.getByText('locked (2/2 approvals)',{exact:false}).waitFor({timeout:15000});
 await A.reload();
 await A.getByText('Signed in; persistent local session enabled').waitFor({timeout:15000});
 assert.equal(await A.locator('#login').isVisible(),false);
 await browserA.close();browserA=null;
 browserA=await chromium.launchPersistentContext(d1,{headless:true,viewport:{width:390,height:844}});
 const Aagain=await browserA.newPage();await Aagain.goto(base);
 await Aagain.getByText('Signed in; persistent local session enabled').waitFor({timeout:15000});
 assert.equal(await Aagain.locator('#login').isVisible(),false);
 console.log('BROWSER ACCEPTANCE PASSED: separate accounts, two-way chat, two approvals, session after reload and browser relaunch at 390px viewport');
} finally {
 await browserA?.close();await browserB?.close(); app.kill('SIGTERM');await unlink(fixtureFile).catch(()=>{});
}
