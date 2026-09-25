import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Accounts,COOKIE} from '../server/accounts.js';import {LocalAccountStore} from '../server/local-accounts.js';import {adminHandler} from '../server/admin.js';import {Game} from '../server/game.js';import {makeWorld} from '../shared/world.js';

test('owner delegates distinct roles; fresh authorization, spawning and free placement preserve boundaries',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-admin-tools-')),old=process.env.MASTER_ADMIN_EMAIL;process.env.MASTER_ADMIN_EMAIL='owner@example.invalid';
 try{
  let code;const accounts=new Accounts(new LocalAccountStore(path.join(dir,'accounts.json')),{mailer:async(_,url)=>code=new URL(url).searchParams.get('verify')});
  const users={};const game=new Game(makeWorld());
  for(const name of ['owner','builder','moderator','player']){
   const auth=await accounts.authenticate('register',name,'fixture password 123',name);await accounts.enroll(auth.token,{email:name+'@example.invalid',terms:true});await accounts.sendCode(auth.token);await accounts.verify(code);const profile=await accounts.createCharacter(auth.token,name);const id=profile.characters[0].id;const p=game.join(id,name);p.account=name;p.x=12;p.z=0;users[name]={...auth,id};
  }
  const handler=adminHandler(accounts,async fn=>fn(game.world));
  async function call(name,body,headers={}){const res={setHeader(){},end(value){this.data=JSON.parse(value);}};await handler({method:'POST',headers:{cookie:`${COOKIE}=${users[name].token}`,'content-type':'application/json',host:'localhost',...headers},body:{...body,character:body.character||users[name].id}},res);return res;}
  assert.equal((await call('owner',{action:'role',username:'builder',role:'admin'})).statusCode,200);
  assert.equal((await call('owner',{action:'role',username:'moderator',role:'moderator'})).statusCode,200);
  assert.equal(await accounts.role(users.moderator.token),'moderator');
  assert.equal((await call('moderator',{action:'spawn',item:'ferrite',amount:5,destination:'inventory'})).statusCode,403);
  assert.equal((await call('builder',{action:'role',username:'player',role:'admin'})).statusCode,403);
  assert.equal((await call('moderator',{action:'ban',username:'builder'})).statusCode,403);
  assert.equal((await call('moderator',{action:'ban',username:'player'})).statusCode,200);
  await assert.rejects(accounts.identity(users.player.token,users.player.id),/banned/);
  assert.equal((await call('moderator',{action:'unban',username:'player'})).statusCode,200);
  assert.equal((await call('builder',{action:'spawn',character:users.player.id,item:'ferrite',amount:5,destination:'inventory'})).statusCode,403);
  for(const amount of [-1,0,1.5,201])assert.equal((await call('builder',{action:'spawn',item:'ferrite',amount,destination:'inventory'})).statusCode,400);
  assert.equal((await call('builder',{action:'spawn',item:'__proto__',amount:1,destination:'inventory'})).statusCode,400);
  assert.equal((await call('builder',{action:'spawn',item:'ferrite',amount:5,destination:'inventory'})).statusCode,200);
  assert.equal(game.world.players[users.builder.id].inventory.ferrite,5);
  assert.equal((await call('builder',{action:'spawn',item:'fiber',amount:60,destination:'inventory'})).statusCode,400);
  assert.equal((await call('builder',{action:'spawn',item:'fiber',amount:20,destination:'ground'})).statusCode,200);
  assert.equal(game.world.resources.at(-1).amount,20);
  game.world.resources=[];
  const before=structuredClone(game.world.players[users.builder.id].inventory);
  assert.equal((await call('builder',{action:'build',piece:{piece:'floor',x:15,z:0,rotation:0}})).statusCode,200);
  assert.deepEqual(game.world.players[users.builder.id].inventory,before);
  assert.equal((await call('builder',{action:'build',piece:{piece:'floor',x:15,z:0,rotation:0}})).statusCode,400);
  assert.equal((await call('builder',{action:'build',piece:{piece:'floor',x:150,z:0,rotation:0}})).statusCode,400);
  assert.equal((await call('builder',{action:'spawn',item:'ice',amount:1,destination:'ground'},{origin:'https://evil.invalid'})).statusCode,403);
  const driver=game.world.players[users.builder.id];driver.x=30;driver.z=0;
  const vehicleInventory=structuredClone(driver.inventory);
  assert.equal((await call('moderator',{action:'vehicle',vehicle:'scout'})).statusCode,403);
  assert.equal((await call('builder',{action:'vehicle',vehicle:'scout',character:users.player.id})).statusCode,403);
  assert.equal((await call('builder',{action:'vehicle',vehicle:'__proto__'})).statusCode,400);
  assert.equal(game.action(driver.id,{type:'vehicleBuild',vehicle:'scout',freeBuild:true}).ok,false,'wire flag cannot grant free vehicles');
  assert.equal((await call('builder',{action:'vehicle',vehicle:'scout'})).statusCode,200);
  assert.deepEqual(driver.inventory,vehicleInventory);
  assert.equal(game.world.vehicles.at(-1).owner,driver.id);
  assert.equal((await call('builder',{action:'vehicle',vehicle:'scout'})).statusCode,400,'occupied spawn rejected');
  driver.x=50;assert.equal((await call('builder',{action:'vehicle',vehicle:'rover'})).statusCode,200);
  driver.x=70;assert.equal((await call('builder',{action:'vehicle',vehicle:'crawler'})).statusCode,200);
  assert.deepEqual(driver.inventory,vehicleInventory);
  assert.ok(game.world.audit.some(a=>a.action==='vehicle'));
  assert.equal((await call('owner',{action:'role',username:'builder',role:'player'})).statusCode,200);
  assert.equal((await call('builder',{action:'spawn',item:'ice',amount:1,destination:'ground'})).statusCode,403);
  assert.ok(game.world.audit.some(a=>a.action==='build'));assert.ok(game.world.audit.some(a=>a.action==='role'&&a.role==='moderator'));
 }finally{if(old===undefined)delete process.env.MASTER_ADMIN_EMAIL;else process.env.MASTER_ADMIN_EMAIL=old;fs.rmSync(dir,{recursive:true});}
});
