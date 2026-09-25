import {RESOURCES,RECIPES} from '/shared/world.js';
const BUILD_PIECES=['floor','wall','doorway','roof','angledCanopy','stairs','railing','heater','perimeter','campGate','lamp','cargo','workbench','door','airlock','lifeSupport','iceProcessor','garden','bed'];
export function adminTools({character,selectPiece,notify}){
 const $=id=>document.getElementById(id);let role=null,quick=false,busy=false;
 const status=$('adminStatus');
 async function request(body){
  const r=await fetch('/api/admin',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Admin service unavailable.');return data;
 }
 async function run(body){if(busy)return;busy=true;status.textContent='Working…';try{const data=await request({...body,character:character()?.id});status.textContent=data.message;notify(data.message);}catch(e){status.textContent=e.message;notify(e.message);}finally{busy=false;}}
 function select(id,entries){const el=$(id);for(const[value,label]of entries){const option=document.createElement('option');option.value=value;option.textContent=label;el.append(option);}return el;}
 const items=select('adminItem',Object.entries(RESOURCES).map(([key,item])=>[key,item.name]));
 $('adminSearch').oninput=()=>{const query=$('adminSearch').value.trim().toLowerCase();for(const o of items.options)o.hidden=!o.textContent.toLowerCase().includes(query);const first=[...items.options].find(o=>!o.hidden);if(first)items.value=first.value;};
 select('adminPiece',BUILD_PIECES.map(key=>[key,RECIPES[key].name]));
 $('adminQuickBuild').onchange=()=>{quick=$('adminQuickBuild').checked&&['owner','admin'].includes(role);};
 $('adminSelectPiece').onclick=()=>selectPiece($('adminPiece').value);
 $('adminSpawn').onclick=()=>run({action:'spawn',item:items.value,amount:Number($('adminAmount').value),destination:$('adminDestination').value});
 $('adminRefill').onclick=()=>run({action:'refill'});
 $('adminAssign').onclick=()=>run({action:'role',username:$('adminUsername').value,role:$('adminRole').value});
 $('adminBan').onclick=()=>{const username=$('adminUsername').value.trim();if(username&&confirm(`Ban ${username} from this server?`))run({action:'ban',username});};
 $('adminUnban').onclick=()=>run({action:'unban',username:$('adminUsername').value});
 return {
  async refresh(){try{role=(await request()).role;}catch{role=null;quick=false;}
   const allowed=['owner','admin','moderator'].includes(role);$('guideTab-admin').classList.toggle('hidden',!allowed);
   $('adminWorld').classList.toggle('hidden',!['owner','admin'].includes(role));$('adminRoles').classList.toggle('hidden',role!=='owner');$('adminModeration').classList.toggle('hidden',!allowed);
   if(!['owner','admin'].includes(role)){quick=false;$('adminQuickBuild').checked=false;}
   status.textContent=allowed?`Your role: ${role}. Actions are checked and recorded by the server.`:'Staff access is not available for this account.';
  },
  role:()=>role,
  quickBuild:()=>quick&&['owner','admin'].includes(role),
  vehicle:vehicle=>run({action:'vehicle',vehicle}),
  build:piece=>run({action:'build',piece})
 };
}
