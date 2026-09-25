import {solarProfile} from './planet.js';
import {gravityForSeed} from './physics.js';
import {isFurniture,onPlacementGrid,validSite,gridPoint,localOffset,anchor,withinTile,floorHeight,stairFootprint} from './build-grid.js';
import {planetHeight,planetDistance,direction,travel} from './planet.js';
// Shared deterministic world and collision rules. No renderer or network dependencies.
export const VERSION = 1;
export const LIMIT = 58;
export const RUIN = {x:24,z:-24};
export const RESOURCES = {
  ice:{name:'Ice',color:0x9bdcea},water:{name:'Water canister',color:0x5bacdc},copper:{name:'Conductive ore',color:0xc98052},silica:{name:'Silica',color:0xe9d8ab},carbon:{name:'Carbon mineral',color:0x454953},scrap:{name:'Salvaged alloy',color:0x869094},
  ferrite:{name:'Ferrite',color:0xf5ae76},
  fiber:{name:'Ribbon fiber',color:0x80c7b6},
  meat:{name:'Mossback meat',color:0xc48678},
  ration:{name:'Field meal',color:0xd9b873},
  crystal:{name:'Flux crystal',color:0x9b9afa}
};
export const RECIPES = {
  fabricator:{name:'Fabrication driver',cost:{},description:'Starter construction multitool. Build, rotate previews, and reclaim authorized pieces. B: build. V: reclaim.'},
  rifle:{name:'Arc carbine',cost:{ferrite:6,copper:3,crystal:2},description:'Ranged weapon. Each shot consumes one flux crystal.'},
  repair:{name:'Arc welder',cost:{ferrite:3,copper:1},description:'Repairs nearby structures using ferrite.'},
  door:{name:'Sealed door',cost:{ferrite:3,fiber:1},description:'An airtight outer door. Open using Operate.'},
  airlock:{name:'Airlock door',cost:{ferrite:4,copper:2},description:'Inner door between a sealed chamber and a habitable base.'},
  lifeSupport:{name:'Life support',cost:{ferrite:5,copper:2,crystal:2},description:'Makes a sealed room habitable. Refuel with flux crystals.'},
  bed:{name:'Bunk',cost:{ferrite:2,fiber:4},description:'Claim your own bunk as a recovery point. Sleep indoors with your suit removed.'},
  iceProcessor:{name:'Ice processor',cost:{ferrite:4,copper:2},description:'Melt ice into a water tank, then fill canisters.'},
  garden:{name:'Hydroponic bed',cost:{ferrite:3,fiber:2,silica:2},description:'Grows food and fiber with water inside a habitable room.'},
  cutter:{name:'Field cutter',cost:{ferrite:3,fiber:2},description:'Gather twice as fast. Required to scan the ruin.'},
  cargo:{name:'Cargo locker',cost:{ferrite:6,fiber:2},description:'Freestanding shared storage. Holds 200 item units. Approach and use Action to store or take supplies.'},
  workbench:{name:'Workbench',cost:{ferrite:6,fiber:2},description:'A nearby fabrication station with one active job and two pending jobs.'},
  flashlight:{name:'Suit flashlight',cost:{ferrite:2,crystal:1},description:'Craft once; toggle Light. Uses 0.65 suit charge per second.'},
  ration:{name:'Field meal',cost:{meat:1,fiber:1},description:'Prepare gathered meat. Eat to restore 35 health.'},
  perimeter:{name:'Camp barrier',cost:{ferrite:3,fiber:1},description:'Freestanding perimeter wall. No deck needed. R rotates its edge.'},
  campGate:{name:'Camp gate',cost:{ferrite:3,fiber:1},description:'Freestanding perimeter opening. Operate toggles it. R rotates its edge.'},
  lamp:{name:'Wall lumen',cost:{ferrite:1,crystal:1},description:'A permanent wall light. Requires a bulkhead or camp barrier on the same edge.'},
  floor:{name:'Deck',cost:{ferrite:2,fiber:1},description:'A 3 m foundation. Snap to the ground grid.'},
  wall:{name:'Bulkhead',cost:{ferrite:2},description:'An edge wall. R rotates to another edge.'},
  windowedBulkhead:{name:'Windowed bulkhead',cost:{ferrite:2},description:'A full-height sealed barrier with a transparent visual-only pane. R rotates to another edge.'},
  doorway:{name:'Doorway frame',cost:{ferrite:2},description:'A passable opening on a deck edge. R rotates to another edge.'},
  roof:{name:'Canopy',cost:{fiber:3,ferrite:1},description:'Requires a deck; shelters the tile beneath it.'},
  angledCanopy:{name:'Angled canopy',cost:{fiber:3,ferrite:1},description:'A sloped canopy. Requires a deck; R changes the slope direction.'},
  stairs:{name:'Deck stair',cost:{ferrite:2,fiber:1},description:'A low-rise stair from terrain to one supported deck edge. R rotates to another edge.'},
  railing:{name:'Deck railing',cost:{ferrite:1},description:'A low barrier on a supported Deck edge. R rotates to another edge.'},
  deckGate:{name:'Deck gate',cost:{ferrite:2,fiber:1},description:'A low operable gate on a supported Deck edge. R rotates to another edge.'},
  heater:{name:'Resonance anchor',cost:{ferrite:4,crystal:3},unlock:true,description:'Ruin technology. Restores suit charge within 7 m.'}
};
export function rng(seed) { let a=seed>>>0; return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}; }
export const height=planetHeight;
export function generate(seed){
 const rand=rng(seed), nodes=[];
 const add=(type,x,z)=>nodes.push({id:`r${nodes.length}`,type,x,z,y:height(x,z,seed),amount:type==='crystal'?3:4});
 // A guaranteed starter ring, with seeded geology across the basin beyond it.
 add('ferrite',3,-3);add('fiber',-3,-3);add('crystal',0,-7);
 add('ferrite',6,-5);add('fiber',-6,-5);add('ferrite',-6,3);add('fiber',5,4);
 for(let i=0;i<112;i++){let x=(rand()-.5)*104,z=(rand()-.5)*104;if(Math.hypot(x,z)<10||Math.hypot(x-RUIN.x,z-RUIN.z)<5)continue;add(['ferrite','fiber','crystal'][Math.floor(rand()*3)],x,z);}
 return nodes;
}
export const dist=planetDistance;
export const GATHER_RANGE=3,GATHER_RANGE_TOLERANCE=GATHER_RANGE*Number.EPSILON*16;
export const withinGatherRange=distance=>Number.isFinite(distance)&&distance<=GATHER_RANGE+GATHER_RANGE_TOLERANCE;
const WHOLE_EDGE_TYPES=new Set(['wall','windowedBulkhead','doorway','door','airlock','perimeter','campGate','stairs','railing','deckGate']);
export function makeWorld(seed=7319){return {version:VERSION,seed,planet:{...solarProfile(seed),gravity:gravityForSeed(seed)},time:0,structures:[],resources:generate(seed),players:{},nextStructure:1};}
export function makePlayer(id,name){return {id,name,x:0,z:3,yaw:0,health:100,charge:100,inventory:{ferrite:0,fiber:0,crystal:0},cutter:false,unlocked:false,completed:false};}
export function shape(piece,seed){
 const r=((piece.rotation||0)%4+4)%4;let dx=0,dz=0,dy=.17,w=3,d=3,h=.18;
 if(['lifeSupport','iceProcessor','garden','bed'].includes(piece.type)){dy=.85;w=piece.type==='bed'?1.2:1.5;d=piece.type==='bed'?2:1.2;h=1.2;}
 if(piece.type==='cargo'){dy=.8;w=1.5;d=1;h=1.1;}
 if(piece.type==='workbench'){dy=.65;w=1.8;d=1.1;h=.9;}
 if(piece.type==='lamp'){dx=[0,1.3,0,-1.3][r];dz=[-1.3,0,1.3,0][r];dy=2.1;w=.28;d=.28;h=.45;}
 if(['wall','windowedBulkhead','doorway','perimeter','campGate','door','airlock','railing','deckGate'].includes(piece.type)){dx=[0,1.5,0,-1.5][r];dz=[-1.5,0,1.5,0][r];dy=piece.type==='railing'?.72:1.55;w=r%2?.18:3;d=r%2?3:.18;h=piece.type==='railing'?1.1:2.6;}
 if(['roof','angledCanopy'].includes(piece.type)){dy=3;w=d=3.15;h=.18;}
 if(piece.type==='heater'){dy=.95;w=d=.65;h=1.4;}
 const centre=piece.site?gridPoint(piece.site,piece.gx+dx/3,piece.gz+dz/3,seed,dy):{x:piece.x+dx,z:piece.z+dz,y:height(piece.x,piece.z,seed)+dy};return{...centre,w,d,h,frame:piece.site?anchor(piece.site):{x:piece.x,z:piece.z}};
}
export function doorParts(piece,seed){const s=shape(piece,seed),alongX=s.w>s.d,parts=[];for(const side of[-1,1])parts.push({kind:'post',w:alongX?.3:s.w,h:s.h,d:alongX?s.d:.3,x:alongX?side*1.35:0,y:0,z:alongX?0:side*1.35});parts.push({kind:'lintel',w:s.w,h:.35,d:s.d,x:0,y:s.h/2-.175,z:0});parts.push({kind:'leaf',w:alongX?(piece.open?.12:2.4):(piece.open?2.4:s.w),h:2.2,d:alongX?(piece.open?2.4:s.d):(piece.open?.12:2.4),x:piece.open?(alongX?-1.2:1.2):0,y:-.2,z:piece.open?(alongX?1.2:-1.2):0});return parts;}

export function blocked(world,x,z,ignoredStructureId=null){
 if(!Number.isFinite(x)||!Number.isFinite(z))return true;
 // Ruin columns; its open central console is reachable.
 for(const [dx,dz] of [[-3,-3],[3,-3],[-3,3],[3,3]])if(Math.hypot(x-RUIN.x-dx,z-RUIN.z-dz)<.95)return true;
 return world.structures.some(s=>{if(s.id===ignoredStructureId||!['wall','windowedBulkhead','doorway','perimeter','campGate','deckGate','door','airlock','railing','heater','cargo','workbench','lifeSupport','iceProcessor','garden','bed'].includes(s.type)||(s.open&&s.type!=='door'))return false;const b=shape(s,world.seed);if(dist(b,{x,z})>4)return false;const o=localOffset(b,{x,z},b.frame);if(s.type==='door')return doorParts(s,world.seed).filter(part=>part.kind!=='lintel').some(part=>Math.abs(o.x-part.x)<part.w/2+.32&&Math.abs(o.z-part.z)<part.d/2+.32);const inside=Math.abs(o.x)<b.w/2+.32&&Math.abs(o.z)<b.d/2+.32;if(s.type==='doorway')return inside&&Math.abs(b.w>b.d?o.x:o.z)>.65;return inside;});
}
function clearDoorPath(world,p,s){const target=shape(s,world.seed),distance=dist(p,target),heading=direction(p,target),length=Math.hypot(heading.x,heading.z);for(let travelled=.4;travelled<distance-.35;travelled+=.2){const sample=travel(p,heading.x/length*travelled,heading.z/length*travelled);if(blocked(world,sample.x,sample.z,s.id))return false;}return true;}
export function nearestOperableDoor(world,p,range=4,types=['door','airlock']){return world.structures.filter(s=>types.includes(s.type)&&dist(p,shape(s,world.seed))<=range&&clearDoorPath(world,p,s)).sort((a,b)=>dist(p,shape(a,world.seed))-dist(p,shape(b,world.seed))||String(a.id).localeCompare(String(b.id)))[0]||null;}
export function interactionTarget(world,p){const resource=world.resources.filter(n=>n.amount>0&&withinGatherRange(dist(n,p))).sort((a,b)=>dist(a,p)-dist(b,p)||String(a.id).localeCompare(String(b.id)))[0],door=nearestOperableDoor(world,p,4,['door']),campGate=nearestOperableDoor(world,p,4,['campGate']),deckGate=nearestOperableDoor(world,p,4,['deckGate']),wallLumen=world.structures.filter(s=>s.type==='lamp'&&dist(shape(s,world.seed),p)<=4).sort((a,b)=>dist(shape(a,world.seed),p)-dist(shape(b,world.seed),p)||String(a.id).localeCompare(String(b.id)))[0],choices=[];if(resource)choices.push({type:'gather',id:resource.id,distance:dist(resource,p)});if(door)choices.push({type:'door',id:door.id,distance:dist(shape(door,world.seed),p)});if(campGate)choices.push({type:'campGate',id:campGate.id,distance:dist(shape(campGate,world.seed),p)});if(deckGate)choices.push({type:'deckGate',id:deckGate.id,distance:dist(shape(deckGate,world.seed),p)});if(wallLumen)choices.push({type:'wallLumen',id:wallLumen.id,distance:dist(shape(wallLumen,world.seed),p)});const target=choices.sort((a,b)=>a.distance-b.distance||a.type.localeCompare(b.type)||String(a.id).localeCompare(String(b.id)))[0];return target?{type:target.type,id:target.id}:null;}
function stairPoint(stairs,along,seed){const r=((stairs.rotation||0)%4+4)%4,[outX,outZ]=[[0,-1],[1,0],[0,1],[-1,0]][r];return stairs.site?gridPoint(stairs.site,stairs.gx+outX*along/3,stairs.gz+outZ*along/3,seed):{x:stairs.x+outX*along,z:stairs.z+outZ*along};}
export function stairProfile(world,stairs){const deck=world.structures.find(s=>s.type==='floor'&&dist(s,stairs)<.05)||{...stairs,type:'floor'},outer=stairPoint(stairs,3,world.seed),inner=stairPoint(stairs,1.5,world.seed),centre=stairPoint(stairs,2.25,world.seed);outer.y=height(outer.x,outer.z,world.seed);inner.y=floorHeight(deck,inner,world.seed);centre.y=(outer.y+inner.y)/2;const rise=inner.y-outer.y;return{outer,inner,centre,rise,length:Math.hypot(1.5,rise),angle:Math.atan2(rise,1.5),frame:stairs.site?anchor(stairs.site):stairs};}
export function surface(world,x,z){const point={x,z},terrain=height(x,z,world.seed);let y=terrain;for(const s of world.structures)if(s.type==='floor'&&withinTile(s,point))y=Math.max(y,floorHeight(s,point,world.seed));for(const stairs of world.structures.filter(s=>s.type==='stairs')){const footprint=stairFootprint(stairs,point);if(!footprint.inside)continue;const profile=stairProfile(world,stairs);y=Math.max(y,profile.outer.y+(profile.inner.y-profile.outer.y)*footprint.progress);}return y;}
export function sheltered(world,p){return world.structures.some(s=>['roof','angledCanopy'].includes(s.type)&&withinTile(s,p));}
export function powered(world,p){return world.structures.some(s=>s.type==='heater'&&dist(s,p)<7);}
export function placementError(world,p,piece,people=[]){
 if(!['floor','wall','windowedBulkhead','doorway','roof','angledCanopy','stairs','railing','deckGate','heater','perimeter','campGate','lamp','cargo','workbench','door','airlock','lifeSupport','iceProcessor','garden','bed'].includes(piece.type))return 'Choose a construction piece.';
 if(!Number.isFinite(piece.x)||!Number.isFinite(piece.z)||!Number.isInteger(piece.rotation)||piece.rotation<0||piece.rotation>3)return 'Invalid placement.';
 if(piece.site){if(!validSite(piece.site)||!onPlacementGrid(piece.gx,piece.type,true)||!onPlacementGrid(piece.gz,piece.type,true)||Math.abs(piece.gx)>128||Math.abs(piece.gz)>128)return 'Invalid local construction grid.';const expected=gridPoint(piece.site,piece.gx,piece.gz,world.seed);if(dist(piece,expected)>.01)return 'Invalid grid position.';if(Math.abs(expected.y-height(piece.x,piece.z,world.seed))>2)return 'Terrain too steep for this foundation. Choose flatter ground.';}else if(!onPlacementGrid(piece.x,piece.type)||!onPlacementGrid(piece.z,piece.type))return 'Use the 3 m construction grid.';

 if(dist(p,piece)>7)return 'Move closer (within 7 m).';
 if(dist(piece,RUIN)<7||Math.hypot(piece.x,piece.z)<3)return 'Keep the ruin and landing point clear.';
 if(piece.type==='heater'&&!p.unlocked)return 'Scan the distant ruin first.';
 const same=world.structures.filter(s=>dist(s,piece)<.05);if(piece.type==='floor'&&world.structures.some(s=>s.type==='floor'&&dist(s,piece)<2.85))return 'A foundation already occupies this space.';
 if(['roof','angledCanopy'].includes(piece.type)&&same.some(s=>['roof','angledCanopy'].includes(s.type)))return 'This slot is occupied.';
 if(same.some(s=>s.type===piece.type&&(!['wall','windowedBulkhead','doorway','perimeter','campGate','door','airlock','stairs','railing','deckGate','lamp'].includes(s.type)||s.rotation===piece.rotation))&&piece.type!=='stairs')return 'This slot is occupied.';
 // Opposite edges on neighboring tiles represent the same physical wall.
 const b=shape(piece,world.seed);
 if(WHOLE_EDGE_TYPES.has(piece.type)){const edge=shape({...piece,type:'wall'},world.seed);if(world.structures.some(s=>WHOLE_EDGE_TYPES.has(s.type)&&dist(shape({...s,type:'wall'},world.seed),edge)<.1))return 'This edge is occupied.';}
 if(piece.type==='lamp'&&!same.some(s=>['wall','windowedBulkhead','perimeter','door','airlock'].includes(s.type)&&s.rotation===piece.rotation))return 'A wall is required on this edge.';
 if(!['floor','perimeter','campGate','lamp','cargo','workbench'].includes(piece.type)&&!world.structures.some(s=>s.type==='floor'&&(isFurniture(piece.type)?withinTile(s,piece):dist(s,piece)<.05)))return 'Place a deck underneath first.';
 // Equipment uses a fine grid; its entire footprint must fit on a supporting deck.
 if(isFurniture(piece.type)){
  const floors=world.structures.filter(s=>s.type==='floor'&&withinTile(s,piece));
  if(floors.length&&!floors.some(s=>{const o=localOffset(s,piece,b.frame);return Math.abs(o.x)+b.w/2<=1.501&&Math.abs(o.z)+b.d/2<=1.501;}))return 'Keep the whole object on the deck.';
 }
 const solid=['wall','windowedBulkhead','doorway','perimeter','campGate','door','airlock','railing','deckGate'];
 if((isFurniture(piece.type)||solid.includes(piece.type))&&world.structures.some(s=>{
  if(!(isFurniture(piece.type)&&(isFurniture(s.type)||solid.includes(s.type))||isFurniture(s.type)&&solid.includes(piece.type)))return false;
  const other=shape(s,world.seed);if(dist(b,other)>5)return false;const o=localOffset(b,other,b.frame);
  return Math.abs(o.x)<(b.w+other.w)/2-.01&&Math.abs(o.z)<(b.d+other.d)/2-.01;
 }))return 'Another object occupies this space.';
 if(piece.type!=='stairs'&&['floor','wall','windowedBulkhead','doorway','perimeter','campGate','door','airlock','railing','heater','cargo','workbench','lifeSupport','iceProcessor','garden','bed'].includes(piece.type)&&world.structures.some(s=>s.type==='stairs'&&stairFootprint(s,b,Math.max(b.w,b.d)/2).inside))return 'The stair path is occupied.';
 if(piece.type==='stairs'){const profile=stairProfile(world,piece);if(!Number.isFinite(profile.rise)||profile.rise<=0)return 'The terrain outside the deck must be lower.';const occupied=world.structures.some(s=>{if(s.type==='floor'&&dist(s,piece)<.05)return false;if(!['floor','stairs','wall','doorway','perimeter','campGate','door','airlock','railing','heater','cargo','lifeSupport','iceProcessor','garden','bed'].includes(s.type))return false;if(s.type==='stairs')return stairFootprint(piece,stairProfile(world,s).centre,.8).inside;const obstacle=shape(s,world.seed);return stairFootprint(piece,obstacle,Math.max(obstacle.w,obstacle.d)/2).inside;});if(occupied)return 'The stair path is occupied.';if(people.some(q=>stairFootprint(piece,q,.5).inside))return 'A player is in the way.';if(world.resources.some(n=>n.amount>0&&stairFootprint(piece,n,.15).inside))return 'Gather the resources on the stair path first.';}
 if(['wall','windowedBulkhead','doorway','perimeter','campGate','door','airlock','railing','deckGate','heater','cargo','workbench','lifeSupport','iceProcessor','garden','bed'].includes(piece.type))if(people.some(q=>{if(dist(q,b)>5)return false;const o=localOffset(b,q,b.frame),inside=Math.abs(o.x)<b.w/2+.5&&Math.abs(o.z)<b.d/2+.5;return inside&&(piece.type!=='doorway'||Math.abs(b.w>b.d?o.x:o.z)>.65);}))return 'A player is in the way.';
 if(['deckGate','windowedBulkhead'].includes(piece.type)&&world.resources.some(n=>n.amount>0&&dist(n,b)<5&&Math.abs(localOffset(b,n,b.frame).x)<b.w/2+.15&&Math.abs(localOffset(b,n,b.frame).z)<b.d/2+.15))return 'Gather the resources on this edge first.';
 if(piece.type==='floor'&&world.resources.some(n=>n.amount>0&&Math.abs(n.x-piece.x)<1.7&&Math.abs(n.z-piece.z)<1.7))return 'Gather the resources on this tile first.';
 return '';
}
export function canAfford(p,type){return Object.entries(RECIPES[type].cost).every(([k,v])=>p.inventory[k]>=v);}
export function pay(p,type){for(const [k,v] of Object.entries(RECIPES[type].cost))p.inventory[k]-=v;}

export const INVENTORY_CAPACITY=60;
export const CARGO_CAPACITY=200;
export const itemCount=inventory=>Object.values(inventory||{}).reduce((sum,n)=>sum+Math.max(0,Number(n)||0),0);
export const freeSpace=inventory=>Math.max(0,INVENTORY_CAPACITY-itemCount(inventory));
