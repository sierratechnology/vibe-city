import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Accounts} from '../server/accounts.js';
import {LocalAccountStore} from '../server/local-accounts.js';

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-recovery-'));
 const file=path.join(dir,'accounts.json');
 const deliveries=[];
 const accounts=new Accounts(new LocalAccountStore(file),{mailer:async(email,url)=>deliveries.push({email,url}),baseURL:'http://127.0.0.1:4173'});
 return{dir,file,deliveries,accounts};
}

async function verifiedAccount(accounts,deliveries,{username='explorer',email='Explorer@Example.invalid',password='old password 123'}={}){
 const auth=await accounts.authenticate('register',username,password,'register-ip');
 await accounts.enroll(auth.token,{email,terms:true,marketing:false});
 await accounts.sendCode(auth.token);
 const code=new URL(deliveries.pop().url).searchParams.get('verify');
 await accounts.verify(code);
 return{...auth,email:email.trim().toLowerCase(),password};
}

async function post(accounts,body,ip='127.0.0.1'){
 const headers={};let output='';
 const req={method:'POST',headers:{'content-type':'application/json','x-forwarded-for':ip,host:'127.0.0.1'},body,socket:{remoteAddress:ip}};
 const res={statusCode:200,setHeader(name,value){headers[name.toLowerCase()]=value;},end(value){output=value;}};
 await accounts.handle(req,res);
 return{status:res.statusCode,headers,body:JSON.parse(output)};
}

test('password recovery request sends a same-origin link only for a verified normalized email without changing its public result',async()=>{
 const {dir,file,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries);
  const unknown=await accounts.requestRecovery('missing@example.invalid','request-ip-1');
  assert.deepEqual(deliveries,[]);
  const known=await accounts.requestRecovery(`  ${user.email.toUpperCase()}  `,'request-ip-2');
  assert.deepEqual(known,unknown);
  assert.equal(deliveries.length,1);
  assert.equal(deliveries[0].email,user.email);
  const link=new URL(deliveries[0].url);
  assert.equal(link.origin,'http://127.0.0.1:4173');
  const token=link.searchParams.get('recover');assert.match(token,/^[a-f0-9]{64}$/);
  const persisted=fs.readFileSync(file,'utf8');assert.equal(persisted.includes(token),false);assert.equal(persisted.includes(user.password),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('a delivered recovery link cannot consume pending state or be resurrected by activation',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries);
  let token,early,pendingSurvived;
  accounts.recoveryMailer=async(_email,url)=>{
   token=new URL(url).searchParams.get('recover');
   early=await accounts.resetPassword(token,'too early replacement').then(()=>null,error=>error.message);
   pendingSurvived=Object.keys(accounts.store.data).some(key=>key.includes(':recover:'));
  };
  await accounts.requestRecovery(user.email,'activation-race-ip');
  assert.match(early,/invalid or expired/i);
  assert.equal(pendingSurvived,true);
  await accounts.resetPassword(token,'valid replacement password');
  await assert.rejects(accounts.resetPassword(token,'resurrected password'),/invalid or expired/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('password recovery token resets the password exactly once',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries);
  await accounts.requestRecovery(user.email,'reset-ip');
  const token=new URL(deliveries.pop().url).searchParams.get('recover');
  await accounts.resetPassword(token,'new password 456');
  await assert.rejects(accounts.authenticate('login','explorer',user.password,'old-password-ip'),/Incorrect/);
  assert.ok((await accounts.authenticate('login','explorer','new password 456','new-password-ip')).token);
  await assert.rejects(accounts.resetPassword(token,'another password 789'),/invalid or expired/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('password reset invalidates all older sessions without affecting another account and permits a new session',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries);
  const second=await accounts.authenticate('login','explorer',user.password,'second-session-ip');
  const other=await accounts.authenticate('register','neighbor','neighbor password 123','neighbor-ip');
  await accounts.requestRecovery(user.email,'invalidate-ip');
  const token=new URL(deliveries.pop().url).searchParams.get('recover');
  await accounts.resetPassword(token,'replacement password 456');
  assert.equal(await accounts.session(user.token),null);
  assert.equal(await accounts.session(second.token),null);
  assert.ok(await accounts.session(other.token));
  const fresh=await accounts.authenticate('login','explorer','replacement password 456','fresh-session-ip');
  assert.ok(await accounts.session(fresh.token));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('account API exposes non-enumerating recovery request and one-time reset actions',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries);
  const unknown=await post(accounts,{action:'recover',email:'missing@example.invalid'},'api-ip-1');
  const known=await post(accounts,{action:'recover',email:user.email},'api-ip-2');
  assert.equal(unknown.status,200);
  assert.deepEqual(known,unknown);
  const token=new URL(deliveries.pop().url).searchParams.get('recover');
  const reset=await post(accounts,{action:'reset',token,password:'api replacement password'},'api-ip-3');
  assert.equal(reset.status,200);
  assert.deepEqual(reset.body,{profile:null,message:'Password reset. Sign in with your new password.'});
  assert.match(reset.headers['set-cookie'],/Max-Age=0/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('recovery requests reject invalid input cheaply and bound attempts by source and normalized identifier',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries);
  const before=Object.keys(accounts.store.data).length;
  await assert.rejects(accounts.requestRecovery('not-an-email','edge-ip'),/complete email/i);
  await assert.rejects(accounts.requestRecovery('x'.repeat(255)+'@example.invalid','edge-ip'),/complete email/i);
  assert.equal(Object.keys(accounts.store.data).length,before);
  await accounts.requestRecovery(user.email,'bounded-ip');
  assert.equal(deliveries.length,1);
  await accounts.requestRecovery(user.email.toUpperCase(),'bounded-ip');
  assert.equal(deliveries.length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('reset rejects malformed tokens and password bounds before consuming a valid token',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries);
  await accounts.requestRecovery(user.email,'bounds-ip');
  const token=new URL(deliveries.pop().url).searchParams.get('recover');
  await assert.rejects(accounts.resetPassword('not-a-token','replacement password'),/invalid or expired/i);
  await assert.rejects(accounts.resetPassword(token,'too short'),/10–128/);
  await assert.rejects(accounts.resetPassword(token,'x'.repeat(129)),/10–128/);
  await accounts.resetPassword(token,'bounded replacement password');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('malformed and non-exact persisted recovery records fail closed with one generic public error',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries,{username:'corrupt',email:'corrupt@example.invalid'});
  await accounts.requestRecovery(user.email,'corrupt-ip');
  const token=new URL(deliveries.pop().url).searchParams.get('recover');
  const tokenKey=Object.keys(accounts.store.data).find(key=>key.includes(':recover:'));
  const valid=JSON.parse(await accounts.store.command(['GET',tokenKey]));
  const invalidRecords=['{','[]',JSON.stringify({...valid,key:123}),JSON.stringify({...valid,extra:true})];
  for(const raw of invalidRecords){
   await accounts.store.command(['SET',tokenKey,raw,'EX',1800]);
   const response=await post(accounts,{action:'reset',token,password:'corrupt record password'});
   assert.equal(response.status,400);
   assert.deepEqual(response.body,{error:'Recovery link is invalid or expired.'});
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('unknown, unverified, missing-provider, and failed-delivery recovery requests stay indistinguishable and leave no usable token',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const unverified=await accounts.authenticate('register','unverified','unverified password','unverified-register');
  await accounts.enroll(unverified.token,{email:'unverified@example.invalid',terms:true,marketing:false});
  const unknown=await accounts.requestRecovery('unknown@example.invalid','generic-ip-1');
  const pending=await accounts.requestRecovery('unverified@example.invalid','generic-ip-2');
  assert.deepEqual(pending,unknown);
  assert.deepEqual(deliveries,[]);
  const user=await verifiedAccount(accounts,deliveries,{username:'deliverfail',email:'deliverfail@example.invalid'});
  let missingToken;accounts.recoveryMailer=async(_email,url)=>{missingToken=new URL(url).searchParams.get('recover');throw Error('Password recovery email is not configured.');};
  const missing=await accounts.requestRecovery(user.email,'generic-ip-3');
  assert.deepEqual(missing,unknown);
  await assert.rejects(accounts.resetPassword(missingToken,'must not become password'),/invalid or expired/i);
  const cleanupUser=await verifiedAccount(accounts,deliveries,{username:'cleanupfail',email:'cleanupfail@example.invalid'});
  let failedToken;accounts.recoveryMailer=async(_email,url)=>{failedToken=new URL(url).searchParams.get('recover');throw Error('private provider detail');};
  const command=accounts.store.command.bind(accounts.store);accounts.store.command=async args=>{if(args[0]==='EVAL'&&args.length===5&&args[3].includes(':recover:'))throw Error('cleanup unavailable');return command(args);};
  const failed=await accounts.requestRecovery(cleanupUser.email,'generic-ip-4');
  assert.deepEqual(failed,unknown);
  accounts.store.command=command;
  await assert.rejects(accounts.resetPassword(failedToken,'must not become password'),/invalid or expired/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('recovery API preserves origin, JSON content-type, and body-size protections',async()=>{
 const {dir,accounts}=fixture();
 const rawPost=async({headers={},chunks=[]})=>{
  const responseHeaders={};let output='';
  const req={method:'POST',headers:{host:'127.0.0.1',...headers},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield* chunks;}};
  const res={statusCode:200,setHeader(name,value){responseHeaders[name.toLowerCase()]=value;},end(value){output=value;}};
  await accounts.handle(req,res);
  return{status:res.statusCode,body:JSON.parse(output)};
 };
 try{
  assert.deepEqual(await rawPost({headers:{'content-type':'application/json',origin:'https://attacker.invalid'},chunks:['{}']}),{status:403,body:{error:'Origin not allowed.'}});
  assert.deepEqual(await rawPost({headers:{'content-type':'text/plain'},chunks:['{}']}),{status:415,body:{error:'JSON required.'}});
  assert.deepEqual(await rawPost({headers:{'content-type':'application/json'},chunks:['x'.repeat(4097)]}),{status:413,body:{error:'Request too large.'}});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('verified-only recovery persistence failures remain generic and leave no usable token',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries,{username:'storagefail',email:'storagefail@example.invalid'});
  const unknown=await post(accounts,{action:'recover',email:'unknown-storage@example.invalid'},'storage-generic-ip-1');
  const command=accounts.store.command.bind(accounts.store);
  accounts.store.command=async args=>{
   if(args[0]==='SET'&&args[1].includes(':recover:')){const error=Error('private storage detail');error.statusCode=503;error.code='STORAGE_UNAVAILABLE';throw error;}
   return command(args);
  };
  const initialFailure=await post(accounts,{action:'recover',email:user.email},'storage-generic-ip-2');
  assert.deepEqual(initialFailure,unknown);
  let token;
  accounts.recoveryMailer=async(_email,url)=>{token=new URL(url).searchParams.get('recover');};
  accounts.store.command=async args=>{
   if(args[0]==='EVAL'&&String(args[5]).includes('"state":"active"'))throw Error('private activation detail');
   return command(args);
  };
  const activationFailure=await post(accounts,{action:'recover',email:user.email},'storage-generic-ip-3');
  assert.deepEqual(activationFailure,unknown);
  await assert.rejects(accounts.resetPassword(token,'must remain unusable'),/invalid or expired/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('unknown, unverified, and verified recovery requests share a bounded completion window independent of mailer duration',async()=>{
 const {dir,deliveries,accounts}=fixture();
 try{
  const user=await verifiedAccount(accounts,deliveries,{username:'timing',email:'timing@example.invalid'});
  const unverified=await accounts.authenticate('register','timing_pending','timing pending password','timing-register-ip');
  await accounts.enroll(unverified.token,{email:'timing-pending@example.invalid',terms:true,marketing:false});
  accounts.recoveryMailer=async()=>new Promise(resolve=>setTimeout(resolve,250));
  const duration=async(email,ip)=>{const started=performance.now();await accounts.requestRecovery(email,ip);return performance.now()-started;};
  const unknown=await duration('timing-unknown@example.invalid','timing-ip-1');
  const pending=await duration('timing-pending@example.invalid','timing-ip-2');
  const verified=await duration(user.email,'timing-ip-3');
  for(const elapsed of [unknown,pending,verified])assert.ok(elapsed>=20&&elapsed<120,`outside bounded response window: ${elapsed}ms`);
  assert.ok(Math.max(unknown,pending,verified)-Math.min(unknown,pending,verified)<40,`response spread too large: ${unknown}, ${pending}, ${verified}`);
  await new Promise(resolve=>setTimeout(resolve,260));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('expired, concurrent, and stale recovery tokens fail closed',async()=>{
 const {dir,deliveries,accounts}=fixture();
 const realNow=Date.now;let now=realNow();Date.now=()=>now;
 try{
  const user=await verifiedAccount(accounts,deliveries);
  await accounts.requestRecovery(user.email,'expiry-ip');
  const expired=new URL(deliveries.pop().url).searchParams.get('recover');
  now+=1800001;
  await assert.rejects(accounts.resetPassword(expired,'expired replacement password'),/invalid or expired/i);
  await accounts.requestRecovery(user.email,'concurrent-ip');
  const concurrent=new URL(deliveries.pop().url).searchParams.get('recover');
  const attempts=await Promise.allSettled([accounts.resetPassword(concurrent,'concurrent password one'),accounts.resetPassword(concurrent,'concurrent password two')]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  now+=61000;
  await accounts.requestRecovery(user.email,'stale-ip-1');
  const first=new URL(deliveries.pop().url).searchParams.get('recover');
  now+=61000;
  await accounts.requestRecovery(user.email,'stale-ip-2');
  const second=new URL(deliveries.pop().url).searchParams.get('recover');
  await accounts.resetPassword(first,'latest valid password');
  await assert.rejects(accounts.resetPassword(second,'stale token password'),/invalid or expired/i);
 }finally{Date.now=realNow;fs.rmSync(dir,{recursive:true,force:true});}
});
