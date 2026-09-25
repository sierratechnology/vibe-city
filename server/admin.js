import {cookieToken} from './accounts.js';
import {validateSettings} from '../shared/settings.js';
import {createHash} from 'node:crypto';
import {Game} from './game.js';
import {RESOURCES,freeSpace,height} from '../shared/world.js';

const staff = role => ['owner','admin','moderator'].includes(role);
function audit(world,actor,action,details={}) {
 world.audit??=[];
 world.audit.push({at:Date.now(),actor,action,...details});
 world.audit=world.audit.slice(-200);
}
export function adminHandler(accounts,updateWorld) {
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  const respond=(code,data)=>{res.statusCode=code;res.end(JSON.stringify(data));};
  try {
   const token=cookieToken(req),session=await accounts.session(token),role=await accounts.role(token);
   if(!session||!staff(role))return respond(403,{error:'Server staff access required.'});
   const bans=await accounts.get(accounts.prefix+':bans')||[];
   if(bans.includes(session.account.username))return respond(403,{error:'Account is banned.'});
   if(req.method==='GET')return respond(200,{role});
   if(req.method!=='POST')return respond(405,{error:'Use GET or POST.'});
   if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return respond(403,{error:'Origin not allowed.'});
   if(!req.headers['content-type']?.startsWith('application/json'))return respond(415,{error:'JSON required.'});
   let body=req.body;
   if(!body){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)return respond(413,{error:'Request too large.'});}body=JSON.parse(raw);}
   if(typeof body==='string')body=JSON.parse(body);
   if(!body||typeof body!=='object'||Array.isArray(body))return respond(400,{error:'Invalid request.'});
   const actor=session.account.username;
   if(['build','spawn','refill','settings'].includes(body.action)) {
    if(role==='moderator')return respond(403,{error:'Building, items and world settings require admin access.'});
    if(body.action==='settings'){
     validateSettings(body.settings);
     await updateWorld(w=>{w.settings=validateSettings(body.settings,w.settings);audit(w,actor,'settings');});
     return respond(200,{message:'Server settings saved.'});
    }
    const identity=await accounts.identity(token,body.character);
    if(!identity)return respond(403,{error:'Select one of your own characters.'});
    if(body.action==='spawn'&&(!Object.hasOwn(RESOURCES,body.item)||!Number.isSafeInteger(body.amount)||body.amount<1||body.amount>200||!['inventory','ground'].includes(body.destination)))return respond(400,{error:'Choose an item, 1–200 units, and a destination.'});
    await updateWorld(w=>{
     const p=w.players[identity.id];if(!p||p.account!==actor)throw Error('Join the world with this character first.');
     if(body.action==='build') {
      if(!body.piece||typeof body.piece!=='object')throw Error('Choose a construction piece.');
      const game=new Game(w);game.online=new Set(Object.keys(w.players));
      const result=game.action(p.id,{...body.piece,type:'build'},{freeBuild:true});
      if(!result.ok)throw Error(result.message);
      audit(w,actor,'build',{structure:w.structures.at(-1).id});
     } else if(body.action==='spawn') {
      if(body.destination==='inventory'){
       if(freeSpace(p.inventory)<body.amount)throw Error('Not enough backpack space. Reduce the quantity or drop nearby.');
       p.inventory[body.item]=(p.inventory[body.item]||0)+body.amount;
      }else{
       if(w.resources.length>=20000)throw Error('World resource limit reached.');
       w.resources.push({id:`drop${w.nextDrop++}`,type:body.item,x:p.x,z:p.z,y:height(p.x,p.z,w.seed),amount:body.amount});
      }
      audit(w,actor,'spawn',{item:body.item,amount:body.amount,destination:body.destination,character:p.id});
     }else{
      p.health=100;p.charge=100;p.oxygen=100;p.food=100;p.water=100;p.stamina=100;
      audit(w,actor,'refill',{character:p.id});
     }
    });
    return respond(200,{message:body.action==='build'?'Admin construction placed.':body.action==='spawn'?'Items spawned.':'Survival meters refilled.'});
   }
   if(!['grant','revoke','role','ban','unban'].includes(body.action))return respond(400,{error:'Unknown admin action.'});
   const roleChange=['grant','revoke','role'].includes(body.action);
   if(roleChange&&role!=='owner')return respond(403,{error:'Only the owner can assign roles.'});
   const assigned=body.action==='grant'?'admin':body.action==='revoke'?'player':body.role;
   if(roleChange&&!['player','moderator','admin'].includes(assigned))return respond(400,{error:'Choose player, moderator or admin.'});
   const username=String(body.username||'').trim().toLowerCase();
   if(!/^[a-z0-9_]{3,24}$/.test(username))return respond(400,{error:'Enter an account username.'});
   const key=accounts.prefix+':account:'+createHash('sha256').update(username).digest('hex'),target=await accounts.get(key);
   if(!target)return respond(404,{error:'Account not found.'});
   if(target.emailVerified&&target.email===process.env.MASTER_ADMIN_EMAIL?.trim().toLowerCase())return respond(403,{error:'The owner cannot be changed or moderated here.'});
   const legacyAdmins=await accounts.get(accounts.prefix+':admins')||[];
   const targetRole=Object.hasOwn(target,'staffRole')?target.staffRole:legacyAdmins.includes(username)?'admin':'player';
   if(!roleChange&&role!=='owner'&&['admin','moderator'].includes(targetRole))return respond(403,{error:'Only the owner can moderate staff.'});
   if(roleChange){
    if(assigned!=='player'&&!target.emailVerified)return respond(400,{error:'The account must verify its email first.'});
    await accounts.mutate(key,a=>{a.staffRole=assigned;});
   }else{
    const listKey=accounts.prefix+':bans';await accounts.store.command(['SET',listKey,'[]','NX']);
    await accounts.mutate(listKey,list=>{const i=list.indexOf(username);if(body.action==='ban'&&i<0)list.push(username);if(body.action==='unban'&&i>=0)list.splice(i,1);});
   }
   await updateWorld(w=>{for(const p of Object.values(w.players))if(p.account===username&&roleChange)p.role=assigned;audit(w,actor,roleChange?'role':body.action,{target:username,...(roleChange?{role:assigned}:{})});});
   return respond(200,{message:roleChange?`${username} is now ${assigned}.`:'Moderation updated. Active bans take effect within 30 seconds.'});
  }catch(e){return respond(e.statusCode===503?503:400,{error:e.message});}
 };
}
