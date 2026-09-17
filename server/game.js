import {initExpedition,initPlayer,stepExpedition,expeditionAction,resourcesFor,canAccess,skill} from './expedition.js';
import {travel,direction,steering,MONUMENTS,CIRCUMFERENCE} from '../shared/planet.js';
import {roomStatus} from '../shared/rooms.js';
import {spawnCreatures,stepCreatures,activeCreature,SPECIES,clearPath} from '../shared/ecology.js';
import {makeWorld,makePlayer,dist,RUIN,blocked,sheltered,powered,placementError,canAfford,pay,RECIPES,itemCount,freeSpace,CARGO_CAPACITY,height} from '../shared/world.js';
export class Game {
 constructor(world=makeWorld()){this.world=world;initExpedition(world);world.containers??={};world.nextDrop??=1;world.creatures??=spawnCreatures(world.seed);for(const p of Object.values(world.players)){p.inventory.meat??=0;p.inventory.ration??=0;p.flashlightOwned??=false;p.flashlightOn??=false;}this.inputs=new Map();this.inputAcks=new Map();this.online=new Set();this.cooldowns=new Map();}
 join(id,name){let p=this.world.players[id];if(!p)p=this.world.players[id]={...makePlayer(id,name),flashlightOwned:false,flashlightOn:false};else p.name=name;p.inventory.meat??=0;p.inventory.ration??=0;initPlayer(p);this.online.add(id);this.inputs.set(id,{x:0,z:0});this.inputAcks.set(id,null);return p;}
 leave(id){this.online.delete(id);this.inputs.delete(id);this.inputAcks.delete(id);this.cooldowns.delete(id);}
 inputAck(id){return this.inputAcks.get(id)??null;}
 input(id,m){if(!this.online.has(id)||!Number.isSafeInteger(m.sequence)||m.sequence<0)return false;const previous=this.inputAcks.get(id);if(previous!==null&&previous!==undefined&&m.sequence<=previous)return false;this.inputs.set(id,{x:Math.max(-1,Math.min(1,Number(m.x)||0)),z:Math.max(-1,Math.min(1,Number(m.z)||0)),yaw:Number.isFinite(m.yaw)?m.yaw:0,sprint:m.sprint===true,aimYaw:Number.isFinite(m.aimYaw)?m.aimYaw:0,...([m.vx,m.vy,m.vz].every(Number.isFinite)?{vx:Math.max(-1,Math.min(1,m.vx)),vy:Math.max(-1,Math.min(1,m.vy)),vz:Math.max(-1,Math.min(1,m.vz))}:{})});this.inputAcks.set(id,m.sequence);return true;}
 tick(dt){
 this.world.time+=dt;stepExpedition(this,dt);stepCreatures(this.world,[...this.online].map(id=>this.world.players[id]),dt);
 for(const id of this.online){const p=this.world.players[id],v=steering(this.inputs.get(id)||{x:0,z:0},p);let len=Math.hypot(v.x,v.z),speed=v.sprint&&p.stamina>5&&p.charge>5?6.5:4.2;
 if(len>1){v.x/=len;v.z/=len;len=1;}
 if(!p.vehicle&&!p.sleeping){const next=travel(p,v.x*speed*dt,v.z*speed*dt);if(!blocked(this.world,next.x,next.z)){p.x=next.x;p.z=next.z;}}

 p.aimYaw=Number.isFinite(v.aimYaw)?v.aimYaw:p.yaw;
 if(len>.01)p.yaw=Math.atan2(v.x,v.z);
 const safe=sheltered(this.world,p),power=powered(this.world,p),storm=this.world.time%150>=105;
 p.charge=Math.max(0,Math.min(100,p.charge+dt*(power?7:safe?1.8:-(storm?1.3:.24)-(v.sprint&&len>.01?.5:0))-(p.flashlightOn?.65:0)*dt));
 if(p.charge<=0)p.flashlightOn=false;
 if(p.charge<=0)p.health=Math.max(0,p.health-dt*4);else if(safe||power)p.health=Math.min(100,p.health+dt*3);
 if(p.unlocked&&power&&safe)p.completed=true;
 if(p.health<=0){p.x=0;p.z=3;p.health=100;p.charge=65;p.oxygen=100;p.water=75;p.food=75;p.stamina=100;p.suit=true;p.sleeping=false;p.vehicle=null;this.inputs.set(id,{x:0,z:0});p.recovered=(p.recovered||0)+1;}
 }
 }
 action(id,m){const p=this.world.players[id];if(!p||!this.online.has(id))return{ok:false,message:'Join first.'};
 if(p.sleeping&&m.type!=='sleep')return{ok:false,message:'Wake up before taking an action.'};
 const special=expeditionAction(this,p,m);if(special)return special;
 const now=this.world.time,ready=this.cooldowns.get(id)||0;
 if(now<ready&&['gather','build','dismantle','attack','eat'].includes(m.type))return{ok:false,message:'Tool cycling…'};
 const fail=message=>({ok:false,message});
 if(m.type==='gather'){
 const n=resourcesFor(this.world,p).find(n=>n.id===m.id);if(!n||n.amount<=0)return fail('This deposit is depleted.');if(dist(p,n)>3)return fail('Move closer to gather (3 m).');
 const amount=Math.min(n.amount,(p.cutter?2:1)*this.world.settings.gatherRate,freeSpace(p.inventory));if(amount===0)return fail('Backpack full (60 items). Use a cargo locker.');n.amount-=amount;if(n.id.startsWith('p:'))this.world.depleted[n.id]=n.amount;p.inventory[n.type]+=amount;skill(p,'mining');this.cooldowns.set(id,now+(p.cutter?.35:.7)/(1+Math.min(.2,Math.sqrt(p.skills.mining)*.01)));return{ok:true,message:`+${amount} ${n.type}`};
 }
 if(m.type==='craft'){
 if(!['cutter','flashlight','ration','rifle','repair'].includes(m.recipe))return fail('Unknown recipe.');
 if(['rifle','repair'].includes(m.recipe)&&p[m.recipe])return fail('Tool already equipped.');if(m.recipe==='cutter'&&p.cutter)return fail('Field cutter already equipped.');if(m.recipe==='flashlight'&&p.flashlightOwned)return fail('Flashlight already equipped.');
 if(m.recipe==='ration'&&itemCount(p.inventory)-2+1>60)return fail('Backpack full.');
 if(!canAfford(p,m.recipe))return fail('Not enough ingredients.');pay(p,m.recipe);if(m.recipe==='ration')p.inventory.ration++;else if(m.recipe==='cutter')p.cutter=true;else if(m.recipe==='flashlight')p.flashlightOwned=true;else p[m.recipe]=true;
 return{ok:true,message:`${RECIPES[m.recipe].name} crafted.`};
 }
 if(m.type==='light'){if(!p.flashlightOwned)return fail('Craft a suit flashlight in the field guide.');if(p.charge<=0)return fail('Suit battery empty.');p.flashlightOn=!p.flashlightOn;return{ok:true,message:p.flashlightOn?'Flashlight on · draining suit battery':'Flashlight off'};}
 if(m.type==='eat'){if(!p.inventory.ration)return fail('Prepare a field meal in the field guide.');if(p.health>=100&&p.food>=95)return fail('Health is already full.');p.inventory.ration--;p.food=Math.min(100,p.food+35);p.health=Math.min(100,p.health+35);this.cooldowns.set(id,now+.6);return{ok:true,message:'Field meal eaten · +35 health'};}
 if(m.type==='repair'){const s=this.world.structures.find(s=>s.id===m.id);if(!p.repair||!s||dist(p,s)>4||!p.inventory.ferrite)return fail('Equip a repair tool and bring ferrite within 4 m.');p.inventory.ferrite--;s.health=Math.min(200,(s.health??200)+40);return{ok:true,message:'Structure repaired.'};}
 if(m.type==='attack'){
 const target=this.world.players[m.id],structure=this.world.structures.find(s=>s.id===m.id),vehicle=this.world.vehicles.find(v=>v.id===m.id),enemy=target||structure||vehicle;
 if(enemy){if(target?.id===id)return fail('Invalid target.');if(target&&!this.world.settings.pvp)return fail('Player damage is disabled.');if(!target&&!this.world.settings.structureDamage)return fail('Structure damage is disabled.');if(!target&&!this.world.settings.offlineRaiding&&enemy.owner&&!this.online.has(enemy.owner))return fail('Offline raiding is disabled.');const ranged=m.ranged===true&&p.rifle;if(dist(p,enemy)>(ranged?35:2.8))return fail('Target out of reach.');const aim=direction(p,enemy),aimLength=Math.hypot(aim.x,aim.z)||1,end=travel(p,aim.x/aimLength*dist(p,enemy)*.85,aim.z/aimLength*dist(p,enemy)*.85);if(!clearPath(this.world,p,end))return fail('Target obstructed.');if(ranged&&!p.inventory.crystal)return fail('The carbine needs flux crystals.');if(!ranged&&p.stamina<8)return fail('Not enough stamina.');if(ranged)p.inventory.crystal--;else p.stamina-=8;enemy.health=(enemy.health??200)-(ranged?25:p.cutter?15:8)*(1+Math.min(.15,Math.sqrt(p.skills.combat)*.005));enemy.lastDamage=now;enemy.sleeping=false;this.cooldowns.set(id,now+.65);skill(p,'combat');if(enemy.health<=0&&!target){if(structure){this.world.structures=this.world.structures.filter(s=>s.id!==structure.id);const cargo=this.world.containers[structure.id]||{};for(const[type,amount]of Object.entries(cargo))if(amount>0)this.world.resources.push({id:'drop'+this.world.nextDrop++,type,amount,x:structure.x,z:structure.z,y:height(structure.x,structure.z,this.world.seed)});delete this.world.containers[structure.id];delete this.world.locks[structure.id];}if(vehicle){for(const rider of vehicle.occupants){if(this.world.players[rider])this.world.players[rider].vehicle=null;}vehicle.occupants=[];}}return{ok:true,message:enemy.health<=0?'Target destroyed.':'Hit confirmed.'};}

 const c=this.world.creatures.find(c=>c.id===m.id);if(!c||!activeCreature(c,now,this.world.settings))return fail('No creature in reach.');const ranged=m.ranged===true&&p.rifle;if(dist(p,c)>(ranged?35:2.8)||!clearPath(this.world,p,c))return fail('Move closer with a clear path.');if(ranged&&!p.inventory.crystal)return fail('The carbine needs flux crystals.');if(!ranged&&p.stamina<8)return fail('Not enough stamina.');if(ranged)p.inventory.crystal--;else p.stamina-=8;skill(p,'combat');
 c.health=Math.max(0,c.health-(ranged?25:p.cutter?15:8));c.fleeUntil=now+8;this.cooldowns.set(id,now+.65);
 if(c.health===0){c.respawnAt=now+180;const type=c.type==='grazer'?'meat':c.type==='prowler'?'crystal':null;if(type){const take=Math.min(2,freeSpace(p.inventory));p.inventory[type]+=take;if(take<2)this.world.resources.push({id:`drop${this.world.nextDrop++}`,type,x:c.x,z:c.z,y:height(c.x,c.z,this.world.seed),amount:2-take});}return{ok:true,message:c.type==='grazer'?'Mossback harvested · collect any overflow on the ground':`${SPECIES[c.type].name} defeated`};}
 return{ok:true,message:`${SPECIES[c.type].name} · ${c.health} health`};
 }
 if(m.type==='scan'){
 if(dist(p,RUIN)>4)return fail('Get closer to the ruin console.');if(!p.cutter)return fail('Craft a field cutter to interface with the ruin.');if(p.unlocked)return{ok:true,message:'Archive: “We did not build the signal. We only taught it to wait.”'};
 p.unlocked=true;const take=Math.min(3,freeSpace(p.inventory));p.inventory.crystal+=take;if(take<3)this.world.resources.push({id:`drop${this.world.nextDrop++}`,type:'crystal',x:p.x,z:p.z,y:height(p.x,p.z,this.world.seed),amount:3-take});return{ok:true,message:'Resonance anchor unlocked. Recovered 3 flux crystals.'};
 }
 if(m.type==='build'){
 const piece={type:m.piece,x:m.x,z:m.z,rotation:m.rotation,...(m.site?{site:m.site,gx:m.gx,gz:m.gz}:{})};const error=placementError(this.world,p,piece,[...this.online].map(id=>this.world.players[id]));if(error)return fail(error);
 if(this.world.structures.length>=5000)return fail('Server structure limit reached.');if(!canAfford(p,piece.type))return fail('Not enough resources.');pay(p,piece.type);skill(p,'construction');const structure={...piece,health:200,...(piece.type==='lifeSupport'?{power:20}:{}),id:`s${this.world.nextStructure++}`,owner:id};this.world.structures.push(structure);if(piece.type==='cargo')this.world.containers[structure.id]={};this.cooldowns.set(id,now+.2);return{ok:true,message:`${RECIPES[piece.type].name} constructed.`};
 }
 if(m.type==='transfer'){
 const box=this.world.structures.find(s=>s.id===m.id&&s.type==='cargo');if(!box||dist(p,box)>3)return fail('Move within 3 m of the cargo locker.');if(!Object.hasOwn(p.inventory,m.item)||!['deposit','withdraw'].includes(m.direction)||!Number.isInteger(m.amount)||m.amount<1||m.amount>200)return fail('Invalid transfer.');
 if(!canAccess(this.world,p,box.id))return fail('Locker locked. Enter its PIN.');
 const inventory=this.world.containers[box.id]??={},from=m.direction==='deposit'?p.inventory:inventory,to=m.direction==='deposit'?inventory:p.inventory,cap=m.direction==='deposit'?CARGO_CAPACITY:60;
 if((from[m.item]||0)<m.amount)return fail('Not enough items.');if(itemCount(to)+m.amount>cap)return fail('Destination is full.');from[m.item]-=m.amount;to[m.item]=(to[m.item]||0)+m.amount;return{ok:true,message:`${m.amount} ${m.item} ${m.direction==='deposit'?'stored':'withdrawn'}.`};
 }
 if(m.type==='dismantle'){
 const i=this.world.structures.findIndex(s=>s.id===m.id),s=this.world.structures[i];if(!s||dist(p,s)>6)return fail('Move closer to the piece.');if(s.owner!==id)return fail('Only its builder can dismantle this piece.');
 if(s.type==='cargo'&&!canAccess(this.world,p,s.id))return fail('Unlock the locker first.');if(s.type==='cargo'&&itemCount(this.world.containers[s.id]))return fail('Empty the cargo locker first.');
 if(itemCount(p.inventory)+itemCount(RECIPES[s.type].cost)>60)return fail('Make room in your backpack for the returned items.');
 if(['wall','perimeter'].includes(s.type)&&this.world.structures.some(b=>b.type==='lamp'&&b.x===s.x&&b.z===s.z&&b.rotation===s.rotation))return fail('Remove the wall light first.');
 if(s.type==='floor'&&this.world.structures.some(b=>b.x===s.x&&b.z===s.z&&b.type!=='floor'))return fail('Remove the pieces above this deck first.');
 for(const [k,v] of Object.entries(RECIPES[s.type].cost))p.inventory[k]+=v;this.world.structures.splice(i,1);delete this.world.containers[s.id];this.cooldowns.set(id,now+.2);return{ok:true,message:'Dismantled. Resources returned.'};
 }
 return fail('Unknown action.');
 }
 snapshot(viewer=null){const p=this.world.players[viewer];const resources=p?resourcesFor(this.world,p):this.world.resources;return{planet:this.world.planet,settings:this.world.settings,circumference:CIRCUMFERENCE,monuments:MONUMENTS,vehicles:this.world.vehicles.map(v=>({...v})),locks:Object.fromEntries(Object.keys(this.world.locks).map(key=>[key,{locked:!p||!canAccess(this.world,p,key)}])),seed:this.world.seed,time:this.world.time,structures:this.world.structures,containers:Object.fromEntries(Object.entries(this.world.containers).filter(([key])=>!this.world.locks[key]||(p&&canAccess(this.world,p,key)))),creatures:this.world.creatures.filter(c=>activeCreature(c,this.world.time,this.world.settings)),resources,playerCount:this.online.size,players:[...this.online].map(id=>{const q=this.world.players[id];if(viewer&&id!==viewer)return{id:q.id,name:q.name,x:q.x,z:q.z,yaw:q.yaw,aimYaw:Number.isFinite(q.aimYaw)?q.aimYaw:q.yaw,health:q.health,charge:q.charge,flashlightOn:q.flashlightOn,vehicle:q.vehicle,suit:q.suit};return{...q,room:roomStatus(this.world,q)};})};}
}
