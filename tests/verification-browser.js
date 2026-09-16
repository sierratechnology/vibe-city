// Real account/token flow; only email delivery is captured locally.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startTestServer,mailbox} from './auth-helper.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-verification-'));
const app=startTestServer({port:0,host:'127.0.0.1',saveFile:path.join(dir,'world.json')});
await new Promise(r=>app.server.once('listening',r));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext(),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const base=`http://127.0.0.1:${app.server.address().port}`;
try {
 await page.goto(base);
 await page.locator('#username').fill('verification_test');
 await page.locator('#password').fill('test-password-verification');
 await page.locator('#signupEmail').fill('verification@example.invalid');
 await page.locator('#signupTerms').check();
 await page.locator('#registerAccount').click();
 await page.locator('#verificationStatus').waitFor({state:'visible'});
 assert.equal(await page.locator('#verificationHeading').innerText(),'Check your email.');
 assert.match(await page.locator('#verificationInstructions').innerText(),/verification@example.invalid/);
 assert.equal(await page.locator('#verifyForm').isVisible(),false);
 // Email opened in a different browser with no login cookie.
 const other=await browser.newContext(),link=await other.newPage();
 await link.goto(base+'/?verify='+mailbox.get('verification@example.invalid'));
 await link.waitForFunction(()=>document.querySelector('#verificationHeading').textContent==='Email verified.');
 assert.equal(new URL(link.url()).search,'');
 await link.locator('#continueVerification').click();
 assert.equal(await link.locator('#accountForm').isVisible(),true);
 await page.bringToFront();
 await page.waitForFunction(()=>document.querySelector('#verificationHeading').textContent==='Email verified.');
 await page.locator('#continueVerification').click();
 await page.locator('#findGame').waitFor({state:'visible'});
 await page.reload();
 await page.locator('#findGame').waitFor({state:'visible'});
 // Expired/reused links must not show a false success screen.
 await link.goto(base+'/?verify='+mailbox.get('verification@example.invalid'));
 await link.waitForFunction(()=>document.querySelector('#accountFeedback').textContent.includes('expired'));
 assert.equal(await link.locator('#verificationStatus').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: email-sent screen, signed-out verification link, automatic original-tab update, continue, reload, and expired-link error. No email sent externally.');
} finally {await browser.close();await app.close();fs.rmSync(dir,{recursive:true,force:true});}
