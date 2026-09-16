import {randomUUID} from 'node:crypto';
export async function browserAccount(page,name='Explorer'){
 const profile=await page.request.get(new URL('/api/account',page.url()).href).then(r=>r.json());
 if(!profile.profile){await page.locator('#username').fill('test_'+randomUUID().replaceAll('-','').slice(0,16));await page.locator('#password').fill(randomUUID());await page.locator('#registerAccount').click();await page.locator('#characterPanel').waitFor({state:'visible'});await page.locator('#characterName').fill(name);await page.locator('#createCharacter').click();}
 await page.waitForFunction(()=>document.querySelector('#character').options.length>0);await page.locator('#enter').waitFor({state:'visible'});
}
export async function apiAccount(base,n){const r=await fetch(base+'/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'register',username:'test_'+randomUUID().replaceAll('-','').slice(0,16),password:randomUUID()})});if(!r.ok)throw Error(await r.text());const cookie=r.headers.get('set-cookie').split(';')[0];const c=await fetch(base+'/api/account',{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify({action:'character',name:'Explorer '+n})}).then(r=>r.json());return{cookie,character:c.profile.characters[0].id};}
