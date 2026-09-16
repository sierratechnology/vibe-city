import {makeWorld,makePlayer,dist,RUIN,blocked,sheltered,powered,placementError,canAfford,pay,RECIPES} from '../shared/world.js';
export class Game {
 constructor(world=makeWorld()){this.world=world;this.inputs=new Map();this.online=new Set();this.cooldowns=new Map();}
 join(id,name){let p=this.world.players[id];if(!p)p=this.world.players[id]=makePlayer(id,name);else p.name=name;this.online.add(id);this.inputs.set(id,{x:0,z:0});return p;}
 leave(id){this.online.delete(id);this.inputs.delete(id);this.cooldowns.delete(id);}
 input(id,m){if(!this.online.has(id))return;this.inputs.set(id,{x:Math.max(-1,Math.min(1,Number(m.x)||0)),z:Math.max(-1,Math.min(1,Number(m.z)||0)),yaw:Number.isFinite(m.yaw)?m.yaw:0,sprint:m.sprint===true});}
 tick(dt){
 this.world.time+=dt;
 for(const id of this.online){const p=this.world.players[id],v=this.inputs.get(id)||{x:0,z:0};let len=Math.hypot(v.x,v.z),speed=v.sprint&&p.charge>5?6.5:4.2;
 if(len>1){v.x/=len;v.z/=len;len=1;}
 const x=p.x+v.x*speed*dt,z=p.z+v.z*speed*dt;
 if(!blocked(this.world,x,p.z))p.x=x;if(!blocked(this.world,p.x,z))p.z=z;
 if(len>.01)p.yaw=Math.atan2(v.x,v.z);
 const safe=sheltered(this.world,p),power=powered(this.world,p),storm=this.world.time%150>=105;
 p.charge=Math.max(0,Math.min(100,p.charge+dt*(power?7:safe?1.8:-(storm?1.3:.24)-(v.sprint&&len>.01?.5:0))));
 if(p.charge<=0)p.health=Math.max(0,p.health-dt*4);else if(safe||power)p.health=Math.min(100,p.health+dt*3);
 if(p.unlocked&&power&&safe)p.completed=true;
 if(p.health<=0){p.x=0;p.z=3;p.health=100;p.charge=65;this.inputs.set(id,{x:0,z:0});p.recovered=(p.recovered||0)+1;}
 }
 }
 action(id,m){const p=this.world.players[id];if(!p||!this.online.has(id))return{ok:false,message:'Join first.'};
 const now=this.world.time,ready=this.cooldowns.get(id)||0;
 if(now<ready&&['gather','build','dismantle'].includes(m.type))return{ok:false,message:'Tool cycling…'};
 const fail=message=>({ok:false,message});
 if(m.type==='gather'){
 const n=this.world.resources.find(n=>n.id===m.id);if(!n||n.amount<=0)return fail('This deposit is depleted.');if(dist(p,n)>3)return fail('Move closer to gather (3 m).');
 const amount=Math.min(n.amount,p.cutter?2:1);n.amount-=amount;p.inventory[n.type]+=amount;this.cooldowns.set(id,now+(p.cutter?.35:.7));return{ok:true,message:`+${amount} ${n.type}`};
 }
 if(m.type==='craft'){
 if(m.recipe!=='cutter')return fail('Unknown recipe.');if(p.cutter)return fail('Field cutter already equipped.');if(!canAfford(p,'cutter'))return fail('Need 3 ferrite and 2 fiber.');pay(p,'cutter');p.cutter=true;return{ok:true,message:'Field cutter equipped. Seek the signal ruin.'};
 }
 if(m.type==='scan'){
 if(dist(p,RUIN)>4)return fail('Get closer to the ruin console.');if(!p.cutter)return fail('Craft a field cutter to interface with the ruin.');if(p.unlocked)return{ok:true,message:'Archive: “We did not build the signal. We only taught it to wait.”'};
 p.unlocked=true;p.inventory.crystal+=3;return{ok:true,message:'Resonance anchor unlocked. Recovered 3 flux crystals.'};
 }
 if(m.type==='build'){
 const piece={type:m.piece,x:m.x,z:m.z,rotation:m.rotation};const error=placementError(this.world,p,piece,[...this.online].map(id=>this.world.players[id]));if(error)return fail(error);
 if(!canAfford(p,piece.type))return fail('Not enough resources.');pay(p,piece.type);this.world.structures.push({...piece,id:`s${this.world.nextStructure++}`,owner:id});this.cooldowns.set(id,now+.2);return{ok:true,message:`${RECIPES[piece.type].name} constructed.`};
 }
 if(m.type==='dismantle'){
 const i=this.world.structures.findIndex(s=>s.id===m.id),s=this.world.structures[i];if(!s||dist(p,s)>6)return fail('Move closer to the piece.');if(s.owner!==id)return fail('Only its builder can dismantle this piece.');
 if(s.type==='floor'&&this.world.structures.some(b=>b.x===s.x&&b.z===s.z&&b.type!=='floor'))return fail('Remove the pieces above this deck first.');
 for(const [k,v] of Object.entries(RECIPES[s.type].cost))p.inventory[k]+=v;this.world.structures.splice(i,1);this.cooldowns.set(id,now+.2);return{ok:true,message:'Dismantled. Resources returned.'};
 }
 return fail('Unknown action.');
 }
 snapshot(){return{seed:this.world.seed,time:this.world.time,structures:this.world.structures,resources:this.world.resources,players:[...this.online].map(id=>this.world.players[id])};}
}
