// Shared deterministic world and collision rules. No renderer or network dependencies.
export const VERSION = 1;
export const LIMIT = 58;
export const RUIN = {x:24,z:-24};
export const RESOURCES = {
  ferrite:{name:'Ferrite',color:0xf5ae76},
  fiber:{name:'Ribbon fiber',color:0x80c7b6},
  crystal:{name:'Flux crystal',color:0x9b9afa}
};
export const RECIPES = {
  cutter:{name:'Field cutter',cost:{ferrite:3,fiber:2},description:'Gather twice as fast. Required to scan the ruin.'},
  floor:{name:'Deck',cost:{ferrite:2,fiber:1},description:'A 3 m foundation. Snap to the ground grid.'},
  wall:{name:'Bulkhead',cost:{ferrite:2},description:'An edge wall. R rotates to another edge.'},
  roof:{name:'Canopy',cost:{fiber:3,ferrite:1},description:'Requires a deck; shelters the tile beneath it.'},
  heater:{name:'Resonance anchor',cost:{ferrite:4,crystal:3},unlock:true,description:'Ruin technology. Restores suit charge within 7 m.'}
};
export function rng(seed) { let a=seed>>>0; return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}; }
export function height(x,z,seed=7319){const p=(seed%97)*.04;return Math.sin(x*.072+p)*1.25+Math.cos(z*.088-p)*1.05+Math.sin((x+z)*.13)*.32;}
export function generate(seed){
 const rand=rng(seed), nodes=[];
 const add=(type,x,z)=>nodes.push({id:`r${nodes.length}`,type,x,z,y:height(x,z,seed),amount:type==='crystal'?3:4});
 // A guaranteed starter ring, with seeded geology across the basin beyond it.
 add('ferrite',3,-3);add('fiber',-3,-3);add('crystal',0,-7);
 add('ferrite',6,-5);add('fiber',-6,-5);add('ferrite',-6,3);add('fiber',5,4);
 for(let i=0;i<112;i++){let x=(rand()-.5)*104,z=(rand()-.5)*104;if(Math.hypot(x,z)<10||Math.hypot(x-RUIN.x,z-RUIN.z)<5)continue;add(['ferrite','fiber','crystal'][Math.floor(rand()*3)],x,z);}
 return nodes;
}
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function makeWorld(seed=7319){return {version:VERSION,seed,time:0,structures:[],resources:generate(seed),players:{},nextStructure:1};}
export function makePlayer(id,name){return {id,name,x:0,z:3,yaw:0,health:100,charge:100,inventory:{ferrite:0,fiber:0,crystal:0},cutter:false,unlocked:false,completed:false};}
export function shape(piece,seed){
 const x=piece.x,z=piece.z,y=height(x,z,seed)+.25,r=((piece.rotation||0)%4+4)%4;
 if(piece.type==='wall') return {x:x+[0,1.5,0,-1.5][r],z:z+[-1.5,0,1.5,0][r],y:y+1.3,w:r%2?.18:3,d:r%2?3:.18,h:2.6};
 if(piece.type==='roof')return{x,z,y:y+2.75,w:3.15,d:3.15,h:.18};
 if(piece.type==='heater')return{x,z,y:y+.7,w:.65,d:.65,h:1.4};
 return{x,z,y:y-.08,w:3,d:3,h:.18};
}
export function blocked(world,x,z){
 if(Math.abs(x)>LIMIT||Math.abs(z)>LIMIT)return true;
 // Ruin columns; its open central console is reachable.
 for(const [dx,dz] of [[-3,-3],[3,-3],[-3,3],[3,3]])if(Math.hypot(x-RUIN.x-dx,z-RUIN.z-dz)<.95)return true;
 return world.structures.some(s=>{if(s.type!=='wall'&&s.type!=='heater')return false;const b=shape(s,world.seed);return Math.abs(x-b.x)<b.w/2+.32&&Math.abs(z-b.z)<b.d/2+.32;});
}
export function surface(world,x,z){let y=height(x,z,world.seed);for(const s of world.structures)if(s.type==='floor'&&Math.abs(x-s.x)<=1.5&&Math.abs(z-s.z)<=1.5)y=Math.max(y,height(s.x,s.z,world.seed)+.27);return y;}
export function sheltered(world,p){return world.structures.some(s=>s.type==='roof'&&Math.abs(p.x-s.x)<1.5&&Math.abs(p.z-s.z)<1.5);}
export function powered(world,p){return world.structures.some(s=>s.type==='heater'&&dist(s,p)<7);}
export function placementError(world,p,piece,people=[]){
 if(!['floor','wall','roof','heater'].includes(piece.type))return 'Choose a construction piece.';
 if(!Number.isFinite(piece.x)||!Number.isFinite(piece.z)||!Number.isInteger(piece.rotation)||piece.rotation<0||piece.rotation>3)return 'Invalid placement.';
 if(piece.x%3||piece.z%3)return 'Use the 3 m construction grid.';
 if(Math.abs(piece.x)>LIMIT-3||Math.abs(piece.z)>LIMIT-3)return 'Outside the survey boundary.';
 if(dist(p,piece)>7)return 'Move closer (within 7 m).';
 if(dist(piece,RUIN)<7||Math.hypot(piece.x,piece.z)<3)return 'Keep the ruin and landing point clear.';
 if(piece.type==='heater'&&!p.unlocked)return 'Scan the distant ruin first.';
 const same=world.structures.filter(s=>s.x===piece.x&&s.z===piece.z);
 if(same.some(s=>s.type===piece.type&&(s.type!=='wall'||s.rotation===piece.rotation)))return 'This slot is occupied.';
 // Opposite edges on neighboring tiles represent the same physical wall.
 const b=shape(piece,world.seed);
 if(piece.type==='wall'&&world.structures.some(s=>s.type==='wall'&&dist(shape(s,world.seed),b)<.1))return 'This edge is occupied.';
 if(piece.type!=='floor'&&!same.some(s=>s.type==='floor'))return 'Place a deck underneath first.';
 if(piece.type==='wall'||piece.type==='heater')if(people.some(q=>Math.abs(q.x-b.x)<b.w/2+.5&&Math.abs(q.z-b.z)<b.d/2+.5))return 'A player is in the way.';
 if(piece.type==='floor'&&world.resources.some(n=>n.amount>0&&Math.abs(n.x-piece.x)<1.7&&Math.abs(n.z-piece.z)<1.7))return 'Gather the resources on this tile first.';
 return '';
}
export function canAfford(p,type){return Object.entries(RECIPES[type].cost).every(([k,v])=>p.inventory[k]>=v);}
export function pay(p,type){for(const [k,v] of Object.entries(RECIPES[type].cost))p.inventory[k]-=v;}
