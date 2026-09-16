import {spawnCreatures,stepCreatures,activeCreature,SPECIES,clearPath} from '../shared/ecology.js';
import {makeWorld,makePlayer,dist,RUIN,blocked,sheltered,powered,placementError,canAfford,pay,RECIPES,itemCount,freeSpace,CARGO_CAPACITY,height} from '../shared/world.js';
export class Game {
 constructor(world=makeWorld()){this.world=world;world.containers??={};world.nextDrop??=1;world.creatures??=spawnCreatures(world.seed);for(const p of Object.values(world.players)){p.inventory.meat??=0;p.inventory.ration??=0;p.flashlightOwned??=false;p.flashlightOn??=false;}this.inputs=new Map();this.inputAcks=new Map();this.online=new Set();this.cooldowns=new Map();}
 join(id,name){let p=this.world.players[id];if(!p)p=this.world.players[id]={...makePlayer(id,name),flashlightOwned:false,flashlightOn:false};else p.name=name;p.inventory.meat??=0;p.inventory.ration??=0;this.online.add(id);this.inputs.set(id,{x:0,z:0});this.inputAcks.set(id,null);return p;}
 leave(id){this.online.delete(id);this.inputs.delete(id);this.inputAcks.delete(id);this.cooldowns.delete(id);}
 inputAck(id){return this.inputAcks.get(id)??null;}
 input(id,m){if(!this.online.has(id)||!Number.isSafeInteger(m.sequence)||m.sequence<0)return false;const previous=this.inputAcks.get(id);if(previous!==null&&previous!==undefined&&m.sequence<=previous)return false;this.inputs.set(id,{x:Math.max(-1,Math.min(1,Number(m.x)||0)),z:Math.max(-1,Math.min(1,Number(m.z)||0)),yaw:Number.isFinite(m.yaw)?m.yaw:0,sprint:m.sprint===true,aimYaw:Number.isFinite(m.aimYaw)?m.aimYaw:0});this.inputAcks.set(id,m.sequence);return true;}
 tick(dt){
 this.world.time+=dt;stepCreatures(this.world,[...this.online].map(id=>this.world.players[id]),dt);
 for(const id of this.online){const p=this.world.players[id],v=this.inputs.get(id)||{x:0,z:0};let len=Math.hypot(v.x,v.z),speed=v.sprint&&p.charge>5?6.5:4.2;
 if(len>1){v.x/=len;v.z/=len;len=1;}
 const x=p.x+v.x*speed*dt,z=p.z+v.z*speed*dt;
 if(!blocked(this.world,x,p.z))p.x=x;if(!blocked(this.world,p.x,z))p.z=z;
 p.aimYaw=Number.isFinite(v.aimYaw)?v.aimYaw:p.yaw;
 if(len>.01)p.yaw=Math.atan2(v.x,v.z);
 const safe=sheltered(this.world,p),power=powered(this.world,p),storm=this.world.time%150>=105;
 p.charge=Math.max(0,Math.min(100,p.charge+dt*(power?7:safe?1.8:-(storm?1.3:.24)-(v.sprint&&len>.01?.5:0))-(p.flashlightOn?.65:0)*dt));
 if(p.charge<=0)p.flashlightOn=false;
 if(p.charge<=0)p.health=Math.max(0,p.health-dt*4);else if(safe||power)p.health=Math.min(100,p.health+dt*3);
 if(p.unlocked&&power&&safe)p.completed=true;
 if(p.health<=0){p.x=0;p.z=3;p.health=100;p.charge=65;this.inputs.set(id,{x:0,z:0});p.recovered=(p.recovered||0)+1;}
 }
 }
 action(id,m){const p=this.world.players[id];if(!p||!this.online.has(id))return{ok:false,message:'Join first.'};
 const now=this.world.time,ready=this.cooldowns.get(id)||0;
 if(now<ready&&['gather','build','dismantle','attack','eat'].includes(m.type))return{ok:false,message:'Tool cycling…'};
 const fail=message=>({ok:false,message});
 if(m.type==='gather'){
 const n=this.world.resources.find(n=>n.id===m.id);if(!n||n.amount<=0)return fail('This deposit is depleted.');if(dist(p,n)>3)return fail('Move closer to gather (3 m).');
 const amount=Math.min(n.amount,p.cutter?2:1,freeSpace(p.inventory));if(amount===0)return fail('Backpack full (60 items). Use a cargo locker.');n.amount-=amount;p.inventory[n.type]+=amount;this.cooldowns.set(id,now+(p.cutter?.35:.7));return{ok:true,message:`+${amount} ${n.type}`};
 }
 if(m.type==='craft'){
 if(!['cutter','flashlight','ration'].includes(m.recipe))return fail('Unknown recipe.');
 if(m.recipe==='cutter'&&p.cutter)return fail('Field cutter already equipped.');if(m.recipe==='flashlight'&&p.flashlightOwned)return fail('Flashlight already equipped.');
 if(m.recipe==='ration'&&itemCount(p.inventory)-2+1>60)return fail('Backpack full.');
 if(!canAfford(p,m.recipe))return fail('Not enough ingredients.');pay(p,m.recipe);if(m.recipe==='ration')p.inventory.ration++;else if(m.recipe==='cutter')p.cutter=true;else p.flashlightOwned=true;
 return{ok:true,message:`${RECIPES[m.recipe].name} crafted.`};
 }
 if(m.type==='light'){if(!p.flashlightOwned)return fail('Craft a suit flashlight in the field guide.');if(p.charge<=0)return fail('Suit battery empty.');p.flashlightOn=!p.flashlightOn;return{ok:true,message:p.flashlightOn?'Flashlight on · draining suit battery':'Flashlight off'};}
 if(m.type==='eat'){if(!p.inventory.ration)return fail('Prepare a field meal in the field guide.');if(p.health>=100)return fail('Health is already full.');p.inventory.ration--;p.health=Math.min(100,p.health+35);this.cooldowns.set(id,now+.6);return{ok:true,message:'Field meal eaten · +35 health'};}
 if(m.type==='attack'){
 const c=this.world.creatures.find(c=>c.id===m.id);if(!c||!activeCreature(c,now))return fail('No creature in reach.');if(dist(p,c)>2.8||!clearPath(this.world,p,c))return fail('Move closer with a clear path.');
 c.health=Math.max(0,c.health-(p.cutter?15:8));c.fleeUntil=now+8;this.cooldowns.set(id,now+.65);
 if(c.health===0){c.respawnAt=now+180;const type=c.type==='grazer'?'meat':c.type==='prowler'?'crystal':null;if(type){const take=Math.min(2,freeSpace(p.inventory));p.inventory[type]+=take;if(take<2)this.world.resources.push({id:`drop${this.world.nextDrop++}`,type,x:c.x,z:c.z,y:height(c.x,c.z,this.world.seed),amount:2-take});}return{ok:true,message:c.type==='grazer'?'Mossback harvested · collect any overflow on the ground':`${SPECIES[c.type].name} defeated`};}
 return{ok:true,message:`${SPECIES[c.type].name} · ${c.health} health`};
 }
 if(m.type==='scan'){
 if(dist(p,RUIN)>4)return fail('Get closer to the ruin console.');if(!p.cutter)return fail('Craft a field cutter to interface with the ruin.');if(p.unlocked)return{ok:true,message:'Archive: “We did not build the signal. We only taught it to wait.”'};
 p.unlocked=true;const take=Math.min(3,freeSpace(p.inventory));p.inventory.crystal+=take;if(take<3)this.world.resources.push({id:`drop${this.world.nextDrop++}`,type:'crystal',x:p.x,z:p.z,y:height(p.x,p.z,this.world.seed),amount:3-take});return{ok:true,message:'Resonance anchor unlocked. Recovered 3 flux crystals.'};
 }
 if(m.type==='build'){
 const piece={type:m.piece,x:m.x,z:m.z,rotation:m.rotation};const error=placementError(this.world,p,piece,[...this.online].map(id=>this.world.players[id]));if(error)return fail(error);
 if(!canAfford(p,piece.type))return fail('Not enough resources.');pay(p,piece.type);const structure={...piece,id:`s${this.world.nextStructure++}`,owner:id};this.world.structures.push(structure);if(piece.type==='cargo')this.world.containers[structure.id]={};this.cooldowns.set(id,now+.2);return{ok:true,message:`${RECIPES[piece.type].name} constructed.`};
 }
 if(m.type==='transfer'){
 const box=this.world.structures.find(s=>s.id===m.id&&s.type==='cargo');if(!box||dist(p,box)>3)return fail('Move within 3 m of the cargo locker.');if(!['ferrite','fiber','crystal','meat','ration'].includes(m.item)||!['deposit','withdraw'].includes(m.direction)||!Number.isInteger(m.amount)||m.amount<1||m.amount>200)return fail('Invalid transfer.');
 const inventory=this.world.containers[box.id]??={},from=m.direction==='deposit'?p.inventory:inventory,to=m.direction==='deposit'?inventory:p.inventory,cap=m.direction==='deposit'?CARGO_CAPACITY:60;
 if((from[m.item]||0)<m.amount)return fail('Not enough items.');if(itemCount(to)+m.amount>cap)return fail('Destination is full.');from[m.item]-=m.amount;to[m.item]=(to[m.item]||0)+m.amount;return{ok:true,message:`${m.amount} ${m.item} ${m.direction==='deposit'?'stored':'withdrawn'}.`};
 }
 if(m.type==='dismantle'){
 const i=this.world.structures.findIndex(s=>s.id===m.id),s=this.world.structures[i];if(!s||dist(p,s)>6)return fail('Move closer to the piece.');if(s.owner!==id)return fail('Only its builder can dismantle this piece.');
 if(s.type==='cargo'&&itemCount(this.world.containers[s.id]))return fail('Empty the cargo locker first.');
 if(itemCount(p.inventory)+itemCount(RECIPES[s.type].cost)>60)return fail('Make room in your backpack for the returned items.');
 if(['wall','perimeter'].includes(s.type)&&this.world.structures.some(b=>b.type==='lamp'&&b.x===s.x&&b.z===s.z&&b.rotation===s.rotation))return fail('Remove the wall light first.');
 if(s.type==='floor'&&this.world.structures.some(b=>b.x===s.x&&b.z===s.z&&b.type!=='floor'))return fail('Remove the pieces above this deck first.');
 for(const [k,v] of Object.entries(RECIPES[s.type].cost))p.inventory[k]+=v;this.world.structures.splice(i,1);delete this.world.containers[s.id];this.cooldowns.set(id,now+.2);return{ok:true,message:'Dismantled. Resources returned.'};
 }
 return fail('Unknown action.');
 }
 snapshot(){return{seed:this.world.seed,time:this.world.time,structures:this.world.structures,containers:this.world.containers,creatures:this.world.creatures.filter(c=>activeCreature(c,this.world.time)),resources:this.world.resources,players:[...this.online].map(id=>this.world.players[id])};}
}
