import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startTestServer,mailbox,recoveryMailbox} from './auth-helper.js';
import {launchBrowser,resolveBrowserEngine} from './browser-engine.js';

const engine=process.argv[2]||process.env.BROWSER_ENGINE||'chromium';
resolveBrowserEngine(engine);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),`vibe-recovery-browser-${engine}-`));
const app=startTestServer({port:0,host:'127.0.0.1',saveFile:path.join(dir,'world.json')});
await new Promise(resolve=>app.server.once('listening',resolve));
const browser=await launchBrowser(engine),base=`http://127.0.0.1:${app.server.address().port}`;
const oldContext=await browser.newContext(),oldPage=await oldContext.newPage(),errors=[],consoleMessages=[];
const username='recovery_player',email='recovery@example.invalid',oldPassword='old browser password',newPassword='new browser password';
const watch=page=>{page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>consoleMessages.push(`${message.type()}: ${message.text()}`));};
async function tabTo(page,id){for(let i=0;i<20&&await page.evaluate(target=>document.activeElement?.id!==target,id);i++)await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.id),id);}
try{
 watch(oldPage);
 await oldPage.goto(base);
 await oldPage.locator('#username').fill(username);
 await oldPage.locator('#password').fill(oldPassword);
 await oldPage.locator('#signupEmail').fill(email);
 await oldPage.locator('#signupTerms').check();
 await oldPage.locator('#registerAccount').click();
 await oldPage.locator('#verificationStatus').waitFor({state:'visible'});
 const verify=await oldPage.request.post(base+'/api/account',{data:{action:'verify',code:mailbox.get(email)}});
 assert.equal(verify.ok(),true,await verify.text());
 await oldPage.locator('#checkVerification').click();
 await oldPage.locator('#continueVerification').click();
 await oldPage.locator('#findGame').waitFor({state:'visible'});

 const requestContext=await browser.newContext(),requestPage=await requestContext.newPage();
 watch(requestPage);
 await requestPage.goto(base);
 await tabTo(requestPage,'forgotPassword');
 await requestPage.keyboard.press('Enter');
 assert.equal(await requestPage.evaluate(()=>document.activeElement?.id),'recoveryEmail');
 assert.equal(await requestPage.locator('label[for="recoveryEmail"]').count(),1);
 assert.equal(await requestPage.locator('#recoveryEmail').getAttribute('autocomplete'),'email');
 await requestPage.locator('#recoveryEmail').fill(email);
 await requestPage.keyboard.press('Enter');
 assert.equal(await requestPage.locator('#requestRecovery').isDisabled(),true);
 await requestPage.locator('#recoveryStatus').waitFor({state:'visible'});
 assert.equal(await requestPage.locator('#requestRecovery').isDisabled(),false);
 const knownMessage=await requestPage.locator('#recoveryStatus').innerText();
 assert.match(knownMessage,/If that email can receive recovery messages/);
 const captured=recoveryMailbox.get(email);
 assert.ok(captured,'Recovery fixture did not receive a link');
 assert.equal(new URL(captured).origin,'https://vibe-city.net');

 const unknownContext=await browser.newContext(),unknownPage=await unknownContext.newPage();
 watch(unknownPage);
 await unknownPage.goto(base);
 await unknownPage.locator('#forgotPassword').click();
 await unknownPage.locator('#recoveryEmail').fill('missing@example.invalid');
 await unknownPage.locator('#requestRecovery').click();
 await unknownPage.locator('#recoveryStatus').waitFor({state:'visible'});
 assert.equal(await unknownPage.locator('#recoveryStatus').innerText(),knownMessage);

 const resetContext=await browser.newContext(),resetPage=await resetContext.newPage();
 watch(resetPage);
 const capturedURL=new URL(captured);await resetPage.goto(base+'/?recover='+capturedURL.searchParams.get('recover'));
 await resetPage.locator('#resetPassword').waitFor({state:'visible'});
 assert.equal(await resetPage.evaluate(()=>document.activeElement?.id),'newPassword');
 assert.equal(await resetPage.locator('label[for="newPassword"]').count(),1);
 assert.equal(await resetPage.locator('label[for="confirmPassword"]').count(),1);
 assert.equal(await resetPage.locator('#newPassword').getAttribute('autocomplete'),'new-password');
 await resetPage.locator('#newPassword').fill(newPassword);
 await resetPage.keyboard.press('Tab');
 assert.equal(await resetPage.evaluate(()=>document.activeElement?.id),'confirmPassword');
 await resetPage.locator('#confirmPassword').fill(newPassword);
 await resetPage.keyboard.press('Tab');
 assert.equal(await resetPage.evaluate(()=>document.activeElement?.id),'resetPassword');
 await resetPage.keyboard.press('Enter');
 await resetPage.locator('#accountForm').waitFor({state:'visible'});
 assert.equal(new URL(resetPage.url()).search,'');

 await oldPage.reload();
 await oldPage.locator('#accountForm').waitFor({state:'visible'});
 await oldPage.locator('#username').fill(username);
 await oldPage.locator('#password').fill(oldPassword);
 await oldPage.locator('#loginAccount').click();
 await oldPage.locator('#accountError').filter({hasText:'Incorrect username or password.'}).waitFor();
 await oldPage.locator('#password').fill(newPassword);
 await oldPage.locator('#loginAccount').click();
 await oldPage.locator('#findGame').waitFor({state:'visible'});

 const replayContext=await browser.newContext(),replayPage=await replayContext.newPage();
 watch(replayPage);
 await replayPage.goto(base+'/?recover='+capturedURL.searchParams.get('recover'));
 await replayPage.locator('#newPassword').fill('replay browser password');
 await replayPage.locator('#confirmPassword').fill('replay browser password');
 await replayPage.locator('#resetPassword').click();
 await replayPage.locator('#recoveryError').filter({hasText:/invalid or expired/i}).waitFor();
 assert.deepEqual(errors,[]);
 for(const secret of [capturedURL.searchParams.get('recover'),email,oldPassword,newPassword])assert.equal(consoleMessages.some(message=>message.includes(secret)),false);
 console.log(`PASS ${engine}: keyboard recovery is non-enumerating; reset focus and labels are deterministic; pending controls disable; reset succeeds once; old password/session fail; new password succeeds; token leaves URL; replay and raw console output fail closed.`);
}finally{await browser.close();await app.close();fs.rmSync(dir,{recursive:true,force:true});mailbox.clear();recoveryMailbox.clear();}
