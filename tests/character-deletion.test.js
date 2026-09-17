import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Accounts} from '../server/accounts.js';
import {LocalAccountStore} from '../server/local-accounts.js';

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-character-deletion-'));
 const deliveries=[];
 const accounts=new Accounts(new LocalAccountStore(path.join(dir,'accounts.json')),{mailer:async(email,url)=>deliveries.push({email,url}),baseURL:'http://127.0.0.1:4173'});
 return{dir,deliveries,accounts};
}

async function verifiedAccount(accounts,deliveries,username='explorer'){
 const auth=await accounts.authenticate('register',username,'character password 123',`${username}-ip`);
 await accounts.enroll(auth.token,{email:`${username}@example.invalid`,terms:true,marketing:false});
 await accounts.sendCode(auth.token);
 await accounts.verify(new URL(deliveries.pop().url).searchParams.get('verify'));
 return auth;
}

async function post(accounts,token,body){
 const headers={};let output='';
 const req={method:'POST',headers:{'content-type':'application/json',host:'127.0.0.1',cookie:`vibe_session=${token}`},body,socket:{remoteAddress:'127.0.0.1'}};
 const res={statusCode:200,setHeader(name,value){headers[name.toLowerCase()]=value;},end(value){output=value;}};
 await accounts.handle(req,res);
 return{status:res.statusCode,body:JSON.parse(output)};
}

test('authenticated deletion durably unlinks one owned character and prevents its future identity',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries);
  const before=await accounts.createCharacter(user.token,'Retired Explorer');
  const id=before.characters[0].id;
  const after=await accounts.deleteCharacter(user.token,id);
  assert.deepEqual(after.characters,[]);
  assert.equal(await accounts.character(user.token,id),null);
  assert.equal(await accounts.identity(user.token,id),null);
  const restored=new Accounts(new LocalAccountStore(path.join(dir,'accounts.json')));
  assert.equal(await restored.character(user.token,id),null);
  assert.equal(await restored.identity(user.token,id),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('account API deletes the session owner\'s selected character',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries);
  const created=await accounts.createCharacter(user.token,'API Explorer');
  const response=await post(accounts,user.token,{action:'delete-character',id:created.characters[0].id});
  assert.equal(response.status,200);
  assert.deepEqual(response.body.profile.characters,[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('account API rejects an action accessor without invoking it or mutating session state',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries);
  await accounts.createCharacter(user.token,'Accessor Explorer');
  const before=await accounts.session(user.token),beforeRoster=structuredClone(before.account.characters);let actionReads=0;
  const body={};Object.defineProperty(body,'action',{enumerable:true,get(){actionReads++;return'logout';}});
  const response=await post(accounts,user.token,body);
  assert.equal(response.status,400);
  assert.deepEqual(response.body,{error:'Invalid request.'});
  assert.equal(actionReads,0);
  const after=await accounts.session(user.token);
  assert.deepEqual(after,before);
  assert.deepEqual(after.account.characters,beforeRoster);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('delete API rejects client authority claims without mutating the roster',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const owner=await verifiedAccount(accounts,deliveries,'owner');
  const before=await accounts.createCharacter(owner.token,'Owner Explorer');
  const response=await post(accounts,owner.token,{action:'delete-character',id:before.characters[0].id,username:'owner'});
  assert.equal(response.status,400);
  assert.deepEqual((await accounts.session(owner.token)).account.characters,before.characters);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('deletion cannot remove another account\'s character',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const owner=await verifiedAccount(accounts,deliveries,'owner');
  const neighbor=await verifiedAccount(accounts,deliveries,'neighbor');
  const ownerProfile=await accounts.createCharacter(owner.token,'Owner Explorer');
  const neighborProfile=await accounts.createCharacter(neighbor.token,'Neighbor Explorer');
  await assert.rejects(accounts.deleteCharacter(owner.token,neighborProfile.characters[0].id),/Character not found/);
  assert.deepEqual((await accounts.session(owner.token)).account.characters,ownerProfile.characters);
  assert.deepEqual((await accounts.session(neighbor.token)).account.characters,neighborProfile.characters);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('malformed character identifiers are rejected before account mutation work',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const owner=await verifiedAccount(accounts,deliveries);
  await accounts.createCharacter(owner.token,'Owner Explorer');
  const originalCommand=accounts.store.command.bind(accounts.store);let accountReads=0;
  accounts.store.command=async command=>{if(command[0]==='GET'&&command[1].includes(':account:'))accountReads++;return originalCommand(command);};
  await assert.rejects(accounts.deleteCharacter(owner.token,'not-a-character'),/Character not found/);
  assert.equal(accountReads,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('malformed character deletion leaves the roster unchanged',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const owner=await verifiedAccount(accounts,deliveries);
  const before=await accounts.createCharacter(owner.token,'Owner Explorer');
  await assert.rejects(accounts.deleteCharacter(owner.token,'not-a-character'),/Character not found/);
  assert.deepEqual((await accounts.session(owner.token)).account.characters,before.characters);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('unknown character deletion leaves the roster unchanged',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const owner=await verifiedAccount(accounts,deliveries);
  const before=await accounts.createCharacter(owner.token,'Owner Explorer');
  await assert.rejects(accounts.deleteCharacter(owner.token,'00000000-0000-4000-8000-000000000000'),/Character not found/);
  assert.deepEqual((await accounts.session(owner.token)).account.characters,before.characters);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('replayed character deletion cannot mutate the surviving roster',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const owner=await verifiedAccount(accounts,deliveries);
  const departing=await accounts.createCharacter(owner.token,'Departing Explorer');
  const withSurvivor=await accounts.createCharacter(owner.token,'Surviving Explorer');
  const deletedId=departing.characters[0].id;
  await accounts.deleteCharacter(owner.token,deletedId);
  await assert.rejects(accounts.deleteCharacter(owner.token,deletedId),/Character not found/);
  assert.deepEqual((await accounts.session(owner.token)).account.characters,[withSurvivor.characters[1]]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('concurrent character creation survives deletion without resurrecting the deleted character',{timeout:2000},async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries);
  const initial=await accounts.createCharacter(user.token,'Departing Explorer');
  const deletedId=initial.characters[0].id,originalCommand=accounts.store.command.bind(accounts.store);
  let accountReads=0,releaseDelete;
  const deleteRead=new Promise(resolve=>{accounts.store.command=async command=>{
   if(command[0]==='GET'&&command[1].includes(':account:')&&++accountReads===2){const before=await originalCommand(command);resolve();await new Promise(release=>{releaseDelete=release;});return before;}
   return originalCommand(command);
  };});
  const deleting=accounts.deleteCharacter(user.token,deletedId);
  await deleteRead;
  await accounts.createCharacter(user.token,'Arriving Explorer');
  releaseDelete();
  await deleting;
  const roster=(await accounts.session(user.token)).account.characters;
  assert.equal(roster.some(character=>character.id===deletedId),false);
  assert.deepEqual(roster.map(character=>character.name),['Arriving Explorer']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
