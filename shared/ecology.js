import {rng,dist,blocked} from './world.js';
export const CYCLE=600;
export function daylight(time){const phase=((time%CYCLE)+CYCLE)%CYCLE;return {night:phase>=360,phase,day:Math.floor(time/CYCLE)+1,remaining:Math.ceil((phase<360?360:600)-phase)};}
export const SPECIES={grazer:{name:'Mossback',health:30,speed:1.5,damage:0,color:0xa3bf8e,scale:.85},skitter:{name:'Bristletick',health:24,speed:2.5,damage:5,color:0xd58d68,scale:.45},prowler:{name:'Veilstalker',health:70,speed:2.1,damage:12,color:0x71648f,scale:1.2}};
export function spawnCreatures(seed){const random=rng(seed+440),out=[];for(const [type,count] of [['grazer',6],['skitter',4],['prowler',2]])for(let i=0;i<count;i++){const angle=random()*Math.PI*2,r=16+random()*25,x=Math.cos(angle)*r,z=Math.sin(angle)*r;out.push({id:`c${out.length}`,type,x,z,homeX:x,homeZ:z,health:SPECIES[type].health,yaw:angle,attackAt:0,respawnAt:0,fleeUntil:0});}return out;}
export function activeCreature(c,time){return c.health>0&&(c.type!=='prowler'||daylight(time).night);}
export function clearPath(world,a,b){const n=Math.ceil(dist(a,b)/.25);for(let i=1;i<n;i++)if(blocked(world,a.x+(b.x-a.x)*i/n,a.z+(b.z-a.z)*i/n))return false;return true;}
export function stepCreatures(world,players,dt){if(!players.length)return;for(const c of world.creatures){const spec=SPECIES[c.type];if(c.health<=0){if(world.time>=c.respawnAt&&!blocked(world,c.homeX,c.homeZ)){c.x=c.homeX;c.z=c.homeZ;c.health=spec.health;}else continue;}if(!activeCreature(c,world.time))continue;
 const target=players.filter(p=>Math.hypot(p.x,p.z)>8).sort((a,b)=>dist(c,a)-dist(c,b))[0];let dx=0,dz=0,speed=.45;
 if(target&&dist(c,target)<11&&spec.damage){const d=dist(c,target);if(d<1.5&&world.time>=c.attackAt&&clearPath(world,c,target)){target.health=Math.max(0,target.health-spec.damage);c.attackAt=world.time+1.5;}if(d>1.1){dx=target.x-c.x;dz=target.z-c.z;speed=spec.speed;}}
 else if(target&&c.fleeUntil>world.time){dx=c.x-target.x;dz=c.z-target.z;speed=spec.speed;}
 else{const angle=world.time*.18+Number(c.id.slice(1))*2;dx=c.homeX+Math.sin(angle)*3-c.x;dz=c.homeZ+Math.cos(angle)*3-c.z;}
 const length=Math.hypot(dx,dz);if(length>.1){dx/=length;dz/=length;c.yaw=Math.atan2(dx,dz);const x=c.x+dx*speed*dt,z=c.z+dz*speed*dt;if(!blocked(world,x,c.z)&&Math.hypot(x,c.z)>9)c.x=x;if(!blocked(world,c.x,z)&&Math.hypot(c.x,z)>9)c.z=z;}
 }}
