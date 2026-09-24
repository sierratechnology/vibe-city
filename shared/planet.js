// Spherical coordinates are stored as equatorial arc metres (x=longitude, z=south latitude).
// Movement follows great circles, including pole and longitude-seam crossings.
export const CIRCUMFERENCE=145000,RADIUS=CIRCUMFERENCE/(2*Math.PI),TILES=256;
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function unit(x,z){const lon=x/RADIUS,lat=z/RADIUS,c=Math.cos(lat);return{x:Math.sin(lon)*c,y:Math.cos(lon)*c,z:Math.sin(lat)};}
export function coordinates(v){return{x:Math.atan2(v.x,v.y)*RADIUS,z:Math.asin(clamp(v.z/Math.hypot(v.x,v.y,v.z),-1,1))*RADIUS};}
export function point(x,z,h=0){const u=unit(x,z),r=RADIUS+h;return{x:u.x*r,y:u.y*r-RADIUS,z:u.z*r};}
export function basis(x,z){const l=x/RADIUS,t=z/RADIUS;return{east:{x:Math.cos(l),y:-Math.sin(l),z:0},up:unit(x,z),south:{x:-Math.sin(l)*Math.sin(t),y:-Math.cos(l)*Math.sin(t),z:Math.cos(t)}};}
export function travel(p,east,south){const d=Math.hypot(east,south);if(!d)return{x:p.x,z:p.z};const b=basis(p.x,p.z),a=d/RADIUS,c=Math.cos(a),s=Math.sin(a)/d;return coordinates({x:b.up.x*c+(b.east.x*east+b.south.x*south)*s,y:b.up.y*c+(b.east.y*east+b.south.y*south)*s,z:b.up.z*c+(b.east.z*east+b.south.z*south)*s});}
export function planetDistance(a,b){const u=unit(a.x,a.z),v=unit(b.x,b.z);return 2*RADIUS*Math.asin(Math.min(1,Math.hypot(u.x-v.x,u.y-v.y,u.z-v.z)/2));}
export function direction(a,b){const u=unit(b.x,b.z),v=basis(a.x,a.z);return{x:u.x*v.east.x+u.y*v.east.y+u.z*v.east.z,z:u.x*v.south.x+u.y*v.south.y+u.z*v.south.z};}
const BIOMES={baseline:{id:'quiet-basin',name:'Quiet Basin',palette:{high:0xa0b0b3,low:0x657e87,mid:0xa58a7d}},coral:{id:'coral-shelf',name:'Coral Shelf',palette:{high:0xb5a9bd,low:0x527f83,mid:0xb87570}}};
const biomeDescriptor=biome=>({id:biome.id,name:biome.name,palette:{...biome.palette}});
// travel/planetDistance can accumulate two scaled binary64 rounding steps at this boundary.
const PROTECTED_RADIUS=325,PROTECTED_RADIUS_EPSILON=PROTECTED_RADIUS*Number.EPSILON*2; // Machine-scale only; not gameplay range.
export function classifyBiome(x,z,seed){if(![x,z,seed].every(Number.isFinite)||planetDistance({x,z},{x:0,z:0})<=PROTECTED_RADIUS+PROTECTED_RADIUS_EPSILON)return biomeDescriptor(BIOMES.baseline);const u=unit(x,z),q=n=>Math.round(n*1e12)/1e12,phase=hash(`biome:${seed}`)/4294967296*Math.PI*2,field=Math.sin(q(u.x)*7+q(u.y)*11+q(u.z)*13+phase);return biomeDescriptor(field>.25?BIOMES.coral:BIOMES.baseline);}
function random(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
export function hash(text){let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
export function planetHeight(x,z,seed=7319){const old=Math.sin(x*.072+(seed%97)*.04)*1.25+Math.cos(z*.088-(seed%97)*.04)*1.05+Math.sin((x+z)*.13)*.32;if(Math.hypot(x,z)<80)return old;const u=unit(x,z),p=(seed%113)*.07;let h=0;for(const [freq,amp]of[[13,160],[43,55],[127,18],[509,3]])h+=(Math.sin(u.x*freq+p)*Math.cos(u.y*freq-p)+Math.sin(u.z*freq+p*.7))*.5*amp;const blend=clamp((Math.hypot(x,z)-80)/220,0,1);return old*(1-blend)+h*blend;}
// Cube-sphere tiles have no polar singularity and can be generated independently.
function faceUV(u){const a=[Math.abs(u.x),Math.abs(u.y),Math.abs(u.z)],axis=a.indexOf(Math.max(...a)),sign=[u.x,u.y,u.z][axis]>=0?1:-1,m=a[axis];return{face:axis*2+(sign<0?1:0),u:axis===0?u.y/m:u.x/m,v:axis===2?u.y/m:u.z/m};}
export function tileUnit(face,u,v){const axis=Math.floor(face/2),sign=face%2?-1:1,o=axis===0?{x:sign,y:u,z:v}:axis===1?{x:u,y:sign,z:v}:{x:u,y:v,z:sign};const n=Math.hypot(o.x,o.y,o.z);return{x:o.x/n,y:o.y/n,z:o.z/n};}
export function tileAt(x,z){const f=faceUV(unit(x,z));return{face:f.face,i:Math.min(TILES-1,Math.floor((f.u+1)*TILES/2)),j:Math.min(TILES-1,Math.floor((f.v+1)*TILES/2))};}
export function tileSample(t,a,b){return coordinates(tileUnit(t.face,(t.i+a)*2/TILES-1,(t.j+b)*2/TILES-1));}
export function nearbyTiles(p){const found=new Map();for(let a=-2;a<=2;a++)for(let b=-2;b<=2;b++){const q=travel(p,a*120,b*120),t=tileAt(q.x,q.z);found.set(`${t.face}:${t.i}:${t.j}`,t);}return [...found.values()];}
export function atmosphere(seed){const r=random(seed+901),profiles=[{name:'Thin nitrogen',oxygen:4,pressure:24,toxicity:0,temperature:-38},{name:'Cold breathable',oxygen:21,pressure:88,toxicity:0,temperature:-12},{name:'Corrosive haze',oxygen:12,pressure:102,toxicity:68,temperature:-24},{name:'Near vacuum',oxygen:0,pressure:.2,toxicity:0,temperature:-70}];return{...profiles[Math.floor(r()*profiles.length)]};}
export function breathable(air){return air.oxygen>=18&&air.oxygen<=25&&air.pressure>=60&&air.pressure<=120&&air.toxicity<5;}
export const MONUMENTS=[{id:'relay',kind:'relay',name:'Broken Relay',x:24,z:-24},{id:'cryowell',kind:'cryowell',name:'Cryowell Station',x:180,z:-90},{id:'graveyard',kind:'graveyard',name:'Crawler Graveyard',x:-220,z:100}];
const cache=new Map();
export function tileContent(seed,t){const key=`${seed}:${t.face}:${t.i}:${t.j}`;if(cache.has(key))return cache.get(key);const r=random(hash(key)),nodes=[];for(let n=0;n<10;n++){const p=tileSample(t,r(),r());if(planetDistance(p,{x:0,z:0})<65||MONUMENTS.some(m=>planetDistance(p,m)<12))continue;const type=['ferrite','fiber','crystal','ice','copper','silica','carbon','scrap'][Math.floor(r()*8)];nodes.push({id:`p:${key}:${n}`,type,...p,y:planetHeight(p.x,p.z,seed),amount:type==='scrap'?6:4+Math.floor(r()*5)});}const wrecks=[];if(r()<.05){const p=tileSample(t,.5,.5);if(planetDistance(p,{x:0,z:0})>100)wrecks.push({id:`wreck:${key}`,type:['scout','rover','crawler'][Math.floor(r()*3)],...p,yaw:r()*Math.PI*2,health:0,battery:0,modules:[],occupants:[],inventory:{scrap:3},owner:null});}const coral=tileSample(t,.5,.5);if(planetDistance(coral,{x:0,z:0})>PROTECTED_RADIUS+PROTECTED_RADIUS_EPSILON&&MONUMENTS.every(m=>planetDistance(coral,m)>=12)&&classifyBiome(coral.x,coral.z,seed).id===BIOMES.coral.id)nodes.push({id:`p:coral:${key}`,type:'crystal',...coral,y:planetHeight(coral.x,coral.z,seed),amount:6});const result={nodes,wrecks};cache.set(key,result);if(cache.size>512)cache.delete(cache.keys().next().value);return result;}
export function nearbyResources(seed,p,depleted={}){return nearbyTiles(p).flatMap(t=>tileContent(seed,t).nodes).filter(n=>planetDistance(p,n)<320).map(n=>({...n,amount:depleted[n.id]??n.amount}));}

export function nearbyWrecks(seed,p){return nearbyTiles(p).flatMap(t=>tileContent(seed,t).wrecks).filter(v=>planetDistance(v,p)<320);}
export function steering(input,p){if(![input.vx,input.vy,input.vz].every(Number.isFinite))return input;const b=basis(p.x,p.z),x=input.vx*b.east.x+input.vy*b.east.y+input.vz*b.east.z,z=input.vx*b.south.x+input.vy*b.south.y+input.vz*b.south.z,n=Math.max(1,Math.hypot(x,z));return{...input,x:x/n,z:z/n};}

// Gameplay world-generation rule, not a physical law: size and solar distance
// influence the generated rotation period. One shared clock for this milestone.
export function solarProfile(seed,circumference=CIRCUMFERENCE,solarDistanceAU){const r=random(hash('solar:'+seed));const distance=solarDistanceAU??Number((.7+r()*2.1).toFixed(2));const rotationSeconds=Math.round(clamp(900*Math.sqrt(circumference/CIRCUMFERENCE)*Math.pow(distance,.35),480,3600));const daySeconds=Math.floor(rotationSeconds/2);return{version:1,circumference,solarDistanceAU:distance,rotationSeconds,daySeconds,nightSeconds:rotationSeconds-daySeconds};}
