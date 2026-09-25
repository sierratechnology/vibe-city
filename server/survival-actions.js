import {types} from 'node:util';
import {RESOURCES,dist,itemCount,blocked,height} from '../shared/world.js';
import {travel} from '../shared/planet.js';
import {canAccess} from './expedition.js';
const fail=message=>({ok:false,message}),ok=message=>({ok:true,message});
const validInventory=inv=>{if(!inv||typeof inv!=='object'||types.isProxy(inv)||Object.getPrototypeOf(inv)!==Object.prototype)return false;const entries=Object.getOwnPropertyDescriptors(inv);let total=0;return Reflect.ownKeys(entries).every(key=>{const d=entries[key];if(typeof key!=='string'||!Object.hasOwn(RESOURCES,key)||!Object.hasOwn(d,'value')||!d.enumerable||!d.writable||!d.configurable||!Number.isSafeInteger(d.value)||d.value<0)return false;total+=d.value;return Number.isSafeInteger(total);});};
export function respawnPoint(world,p){
 const bed=world.structures.find(s=>s.id===p.homeBed&&s.type==='bed'&&s.owner===p.id&&(s.health??200)>0);
 if(bed)for(const [x,z]of [[0,2],[2,0],[0,-2],[-2,0],[2,2],[-2,-2]]){const point=travel(bed,x,z);if(!blocked(world,point.x,point.z))return point;}
 return{x:0,z:3};
}
export function survivalAction(game,p,m){const w=game.world;
 if(m.type==='transferBulk'){
  if(Object.keys(m).sort().join(',')!=='id,mode,type'||typeof m.id!=='string'||!['deposit','matching','withdraw'].includes(m.mode))return fail('Choose a locker transfer.');
  const box=w.structures.find(s=>s.id===m.id&&s.type==='cargo');if(!box||dist(p,box)>3)return fail('Move within 3 m of the cargo locker.');if(!canAccess(w,p,box.id))return fail('Locker locked. Enter its PIN.');
  const container=w.containers[box.id]||{},from=m.mode==='withdraw'?container:p.inventory,to=m.mode==='withdraw'?p.inventory:container,cap=m.mode==='withdraw'?60:200;
  if(!validInventory(from)||!validInventory(to)||itemCount(to)>cap)return fail('Invalid inventory state.');let space=cap-itemCount(to),count=0;const moves=[];
  for(const item of Object.keys(RESOURCES)){if(m.mode==='matching'&&!(to[item]>0))continue;const amount=Math.min(from[item]||0,space);if(amount>0){moves.push([item,amount]);space-=amount;count+=amount;}}
  if(!count)return fail(space?'No matching items to transfer.':'Destination is full.');
  for(const[item,amount]of moves){from[item]-=amount;to[item]=(to[item]||0)+amount;}w.containers[box.id]=container;return ok(`${count} items ${m.mode==='withdraw'?'taken':'stored'}.`);
 }
 if(m.type==='drop'){
  if(Object.keys(m).sort().join(',')!=='amount,item,type'||!Object.hasOwn(RESOURCES,m.item)||!Number.isSafeInteger(m.amount)||m.amount<1||m.amount>60)return fail('Choose an item and quantity from 1 to 60.');
  if(!validInventory(p.inventory)||(p.inventory[m.item]||0)<m.amount)return fail('Not enough carried items.');
  if(w.resources.filter(n=>String(n.id).startsWith('drop')&&n.amount>0).length>=1000)return fail('Too many dropped stacks. Use a locker.');
  const position=travel(p,Math.sin(p.yaw||0)*1.2,Math.cos(p.yaw||0)*1.2);if(blocked(w,position.x,position.z))return fail('Clear space in front of you first.');
  if(!Number.isSafeInteger(w.nextDrop)||w.nextDrop<1||w.nextDrop>=Number.MAX_SAFE_INTEGER)return fail('Drop storage unavailable.');w.resources=w.resources.filter(n=>!String(n.id).startsWith('drop')||n.amount>0);const id=`drop${w.nextDrop++}`;p.inventory[m.item]-=m.amount;w.resources.push({id,type:m.item,...position,y:height(position.x,position.z,w.seed),amount:m.amount});return ok(`Dropped ${m.amount} ${RESOURCES[m.item].name}.`);
 }
 if(m.type==='home'){
  if(Object.keys(m).sort().join(',')!=='id,type'||(m.id!==null&&typeof m.id!=='string'))return fail('Choose your nearby bunk.');
  if(m.id===null){delete p.homeBed;return ok('Landing point selected for recovery.');}
  const bed=w.structures.find(s=>s.id===m.id&&s.type==='bed');if(!bed||bed.owner!==p.id||dist(p,bed)>3)return fail('Only your own bunk within 3 m can be your home.');if((bed.health??200)<=0)return fail('Repair this bunk first.');
  p.homeBed=bed.id;return ok('Home bunk claimed. You will recover nearby when space is clear.');
 }
 return null;
}
