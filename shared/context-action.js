import {depositKind,depositLabels} from './resource-deposits.js';
import {dist,interactionTarget,RESOURCES,RECIPES,RUIN,shape} from './world.js';
import {MONUMENTS,direction} from './planet.js';
import {SPECIES} from './ecology.js';
export function readableActionLabel(world,action){if(action?.message?.type==='wallLumen'){const lamp=world.structures.find(s=>s.id===action.message.id&&s.type==='lamp');return lamp?`Wall lumen ${lamp.on===false?'off':'on'} · ${action.label}`:action.label;}if(action?.message?.type!=='deckGate')return action?.label||null;const gate=world.structures.find(s=>s.id===action.message.id&&s.type==='deckGate');return gate?`Deck gate ${gate.open?'open':'closed'} · ${action.label}`:action.label;}
export function contextAction(world,p,{buildMode=false,reclaimMode=false,yaw=0}={}){
 if(!p)return null;if(p.vehicle)return{kind:'message',message:{type:'vehicle',id:p.vehicle},label:'Exit vehicle',repeat:false};if(reclaimMode){const supportsDependent=s=>s.type==='floor'&&world.structures.some(b=>b.type!=='floor'&&b.x===s.x&&b.z===s.z)||['wall','windowedBulkhead'].includes(s.type)&&world.structures.some(b=>b.type==='lamp'&&b.x===s.x&&b.z===s.z&&b.rotation===s.rotation),s=world.structures.filter(s=>(s.canDismantle||s.owner===p.id)&&dist(p,s)<=6).sort((a,b)=>dist(p,a)-dist(p,b)||Number(supportsDependent(a))-Number(supportsDependent(b)))[0];return s?{kind:'message',message:{type:'dismantle',id:s.id},label:`Reclaim ${RECIPES[s.type]?.name||s.type}`,repeat:false}:null;}if(buildMode)return{kind:'place',label:'Place',repeat:false};
 const choices=[];
 const add=(object,range,action)=>{const distance=dist(p,object);if(distance<=range)choices.push({...action,distance});};
 const target=interactionTarget(world,p);
 if(target){const resource=target.type==='gather',object=resource?world.resources.find(n=>n.id===target.id):world.structures.find(s=>s.id===target.id);if(object)add(resource?object:shape(object,world.seed),resource?3:4,{kind:'message',message:target,label:resource?`${depositLabels[depositKind(object)]||'Gather'} ${RESOURCES[object.type].name}`:target.type==='wallLumen'?`${object.on===false?'Turn on':'Turn off'} Wall lumen`:`${object.open?'Close':'Open'} ${RECIPES[object.type].name}`,repeat:resource});}
 add(RUIN,4,{kind:'message',message:{type:'scan'},label:'Read signal',repeat:false});
 for(const m of MONUMENTS.filter(m=>m.id!=='relay'))add(m,8,{kind:'message',message:{type:'salvage',id:m.id},label:'Salvage monument',repeat:true});
 for(const s of world.structures){if(s.type==='cargo')add(s,3,{kind:'storage',label:'Open cargo',repeat:false});if(s.type==='workbench')add(s,3,{kind:'fabrication',label:'Use workbench',repeat:false});if(['airlock','bed','lifeSupport','iceProcessor','garden'].includes(s.type))add(s,3,{kind:'habitat',label:`Use ${RECIPES[s.type].name}`,repeat:false});}
 for(const v of world.vehicles||[])add(v,4,{kind:'message',message:{type:'vehicle',id:v.id},label:'Enter vehicle',repeat:false});
 const candidates=[...(world.creatures||[]),...(world.settings?.pvp?world.players.filter(q=>q.id!==p.id):[])];
 for(const enemy of candidates){const d=dist(p,enemy),aim=direction(p,enemy),length=Math.hypot(aim.x,aim.z);if(d>.1&&length&&(aim.x*-Math.sin(yaw)+aim.z*-Math.cos(yaw))/length>.65)add(enemy,p.rifle?35:2.8,{kind:'message',message:{type:'attack',id:enemy.id,ranged:!!p.rifle},label:`Attack ${SPECIES[enemy.type]?.name||enemy.name}`,repeat:true});}
 return choices.sort((a,b)=>a.distance-b.distance||a.label.localeCompare(b.label))[0]||null;
}
