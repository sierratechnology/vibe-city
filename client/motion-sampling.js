import {planetDistance,direction,travel} from '../shared/planet.js';
// Visual interpolation only. Server snapshots remain the gameplay authority.
export function createMotionSampler(){
 let previous=null,current=null,received=0,interval=250;
 return{push(state,now){previous=current;current=state;interval=Math.max(50,Math.min(500,now-received||250));received=now;},sample(now){
  if(!current)return null;const t=Math.max(0,Math.min(1,(now-received)/interval));
  const blend=(a,b)=>a+(b-a)*t;
  const collection=(key)=>current[key].map(item=>{const old=previous?.[key]?.find(p=>p.id===item.id);if(!old||old.vehicle!==item.vehicle||planetDistance(old,item)>20)return item;
   const d=planetDistance(old,item),v=direction(old,item),length=Math.hypot(v.x,v.z)||1,position=d<.00001?item:travel(old,v.x/length*d*t,v.z/length*d*t);
   const angle=(item.yaw||0)-(old.yaw||0),yaw=(old.yaw||0)+Math.atan2(Math.sin(angle),Math.cos(angle))*t;
   return{...item,x:position.x,z:position.z,yaw,jumpHeight:blend(old.jumpHeight||0,item.jumpHeight||0)};
  });
  return{...current,vehicles:collection('vehicles'),players:collection('players')};
 }};
}
