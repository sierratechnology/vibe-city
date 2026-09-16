import * as THREE from 'three';
import {accountUI} from './account.js';
import {daylight,SPECIES} from '/shared/ecology.js';
import {wildlifeRenderer} from './wildlife.js';
import {bindControls} from './controls.js';
import {height,surface,generate,rng,RUIN,RECIPES,RESOURCES,shape,dist,placementError,canAfford,itemCount,sheltered,powered,blocked} from '/shared/world.js';
const account=accountUI();
const $=id=>document.getElementById(id),canvas=$('world');
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});}catch(e){$('joinError').textContent='This browser needs WebGL 2 enabled to render the world.';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
const scene=new THREE.Scene();scene.background=new THREE.Color('#718f96');scene.fog=new THREE.FogExp2('#819da0',.012);
const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,230);
const skyLight=new THREE.HemisphereLight(0xc4e5e0,0x573746,1.8);scene.add(skyLight);const sun=new THREE.DirectionalLight(0xffd4a6,2.5);sun.position.set(-24,48,18);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-45,right:45,top:45,bottom:-45,near:1,far:110});sun.shadow.bias=-.001;scene.add(sun);
const wildlife=wildlifeRenderer(scene);
const mat=(color,opts={})=>new THREE.MeshStandardMaterial({color,roughness:.85,flatShading:true,...opts});
const materials={cargo:mat(0x5d8790),perimeter:mat(0x65746c),lamp:mat(0xffdfa0,{emissive:0xffce7e,emissiveIntensity:2}),deck:mat(0x4d666c),wall:mat(0xd3d0b7),roof:mat(0x8fa99a),heater:mat(0x384e59),trim:mat(0xf4b28f),glow:mat(0x9effd5,{emissive:0x57bb9e,emissiveIntensity:1}),dark:mat(0x203c48)};
function mesh(g,m,parent=scene){const obj=new THREE.Mesh(g,m);parent.add(obj);return obj;}
function box(w,h,d,m,parent){const o=mesh(new THREE.BoxGeometry(w,h,d),m,parent);o.castShadow=true;o.receiveShadow=true;return o;}
let worldGroup=new THREE.Group();scene.add(worldGroup);let state={seed:7319,time:0,structures:[],resources:generate(7319),players:[]},id=null,ws=null,joined=false;
let terrain,ruinPulse,resourceMeshes={},resourceKey='',structureKey='',structuresGroup=new THREE.Group(),preview=new THREE.Group();scene.add(structuresGroup,preview);
const dummy=new THREE.Object3D();
function buildEnvironment(seed){
 scene.remove(worldGroup);worldGroup.traverse(o=>{if(o.geometry)o.geometry.dispose();});worldGroup=new THREE.Group();scene.add(worldGroup);
 const g=new THREE.PlaneGeometry(145,145,96,96);g.rotateX(-Math.PI/2);const pos=g.attributes.position,colors=[];
 for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),y=height(x,z,seed);pos.setY(i,y);const c=new THREE.Color().lerpColors(new THREE.Color('#ad685d'),new THREE.Color('#c1977c'),(y+2.7)/5.4);colors.push(c.r,c.g,c.b);}
 g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();terrain=mesh(g,mat(0xffffff,{vertexColors:true}),worldGroup);terrain.receiveShadow=true;
 const rand=rng(seed+6),mountains=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,5),mat(0x755f70),30);for(let i=0;i<30;i++){const a=i/30*Math.PI*2,r=76+rand()*10;dummy.position.set(Math.sin(a)*r,rand()*2+4,Math.cos(a)*r);dummy.scale.set(10+rand()*12,10+rand()*15,10+rand()*12);dummy.rotation.set(0,rand()*6,0);dummy.updateMatrix();mountains.setMatrixAt(i,dummy.matrix);}worldGroup.add(mountains);
 const pebbles=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),mat(0x907e74),90);for(let i=0;i<90;i++){const x=(rand()-.5)*112,z=(rand()-.5)*112;dummy.position.set(x,height(x,z,seed)-.05,z);dummy.scale.set(.2+rand()*.4,.1+rand()*.2,.2+rand()*.4);dummy.rotation.set(0,rand()*6,0);dummy.updateMatrix();pebbles.setMatrixAt(i,dummy.matrix);}worldGroup.add(pebbles);
 for(const type of ['ferrite','fiber','crystal','meat']){const geo=type==='fiber'?new THREE.ConeGeometry(.65,1.9,5):type==='crystal'?new THREE.OctahedronGeometry(.85,0):new THREE.DodecahedronGeometry(.85,0);const m=mat(RESOURCES[type].color,type==='crystal'?{emissive:0x4b3d95,emissiveIntensity:.5}:{});const inst=new THREE.InstancedMesh(geo,m,150);inst.castShadow=true;worldGroup.add(inst);resourceMeshes[type]=inst;}
 const y=height(RUIN.x,RUIN.z,seed),ruin=new THREE.Group();ruin.position.set(RUIN.x,y,RUIN.z);worldGroup.add(ruin);
 for(const [x,z] of [[-3,-3],[3,-3],[-3,3],[3,3]]){const col=box(.95,5,.95,materials.dark,ruin);col.position.set(x,2.5,z);const tip=box(1.15,.15,1.15,materials.trim,ruin);tip.position.set(x,5,z);}
 const ring=mesh(new THREE.TorusGeometry(3.6,.22,5,40,Math.PI*1.65),materials.wall,ruin);ring.position.set(0,6.4,0);ring.rotation.z=.3;
 const console=box(1.2,.8,1,materials.dark,ruin);console.position.y=.4;ruinPulse=mesh(new THREE.OctahedronGeometry(.5),materials.glow,ruin);ruinPulse.position.y=1.6;
 const pad=mesh(new THREE.CylinderGeometry(1.8,2,.1,8),materials.dark,worldGroup);pad.position.set(0,height(0,0,seed)+.05,0);
 const moon=mesh(new THREE.IcosahedronGeometry(11,2),mat(0xf1d1ae),worldGroup);moon.position.set(-50,46,-91);const moonring=mesh(new THREE.TorusGeometry(18,.35,5,64),mat(0xf0d5bc),worldGroup);moonring.position.copy(moon.position);moonring.rotation.set(1,.3,.4);
 resourceKey='';structureKey='';updateGeometry();
}
function pieceMesh(piece,ghost=false){const group=new THREE.Group(),s=shape(piece,state.seed);group.position.set(s.x,s.y,s.z);const color=ghost?new THREE.MeshBasicMaterial({color:0xb9f1c7,transparent:true,opacity:.48,depthWrite:false}):materials[piece.type==='floor'?'deck':piece.type];box(s.w,s.h,s.d,color,group);
 if(!ghost){if(piece.type==='heater'){const core=mesh(new THREE.OctahedronGeometry(.4),materials.glow,group);core.position.y=.6;const aura=mesh(new THREE.RingGeometry(6.8,7,48),new THREE.MeshBasicMaterial({color:0xa6eccb,side:THREE.DoubleSide,transparent:true,opacity:.22,depthWrite:false}),group);aura.rotation.x=-Math.PI/2;aura.position.y=-.65;}else if(piece.type==='floor'){for(const x of [-1.35,1.35]){const rail=box(.07,.04,2.8,materials.trim,group);rail.position.set(x,.11,0);}}else if(piece.type==='cargo'){const seam=box(1.52,.06,1.02,materials.dark,group);seam.position.y=.22;const latch=box(.25,.3,.06,materials.glow,group);latch.position.set(0,.05,.53);}else if(piece.type==='wall'){const stripe=box(s.w>.2?s.w:.2,.08,s.d>.2?s.d:.2,materials.trim,group);stripe.position.y=.7;}}
 return group;
}
function clearGroup(group){for(const obj of [...group.children]){obj.traverse(o=>{if(o.geometry)o.geometry.dispose();});group.remove(obj);}}
function updateGeometry(){const rk=state.resources.map(n=>n.amount).join(',');if(rk!==resourceKey){resourceKey=rk;for(const type of ['ferrite','fiber','crystal','meat']){let i=0;for(const n of state.resources.filter(n=>n.type===type&&n.amount>0)){const size=.6+n.amount*.1;dummy.position.set(n.x,n.y+(type==='fiber'?.8:.6),n.z);dummy.rotation.set(0,n.x*1.7,type==='crystal'?.12:0);dummy.scale.setScalar(size);dummy.updateMatrix();resourceMeshes[type].setMatrixAt(i++,dummy.matrix);}resourceMeshes[type].count=i;resourceMeshes[type].instanceMatrix.needsUpdate=true;resourceMeshes[type].computeBoundingSphere();}}
 const sk=state.structures.map(s=>s.id).join(',');if(sk!==structureKey){structureKey=sk;clearGroup(structuresGroup);for(const s of state.structures)structuresGroup.add(pieceMesh(s));}}
function astronaut(color){const group=new THREE.Group(),suit=mat(color);const torso=box(.62,.75,.4,suit,group);torso.position.y=1.05;const head=mesh(new THREE.IcosahedronGeometry(.36,1),materials.wall,group);head.position.y=1.65;const visor=box(.47,.19,.11,materials.dark,group);visor.position.set(0,1.66,.3);const pack=box(.45,.55,.25,materials.trim,group);pack.position.set(0,1.08,-.3);const legs=[];for(const x of [-.18,.18]){const leg=box(.2,.58,.22,materials.dark,group);leg.position.set(x,.38,0);legs.push(leg);const arm=box(.17,.68,.2,suit,group);arm.position.set(x*2.3,1.02,0);}group.userData.legs=legs;return group;}
const avatars=new Map();let localPos=new THREE.Vector3(0,0,3),yaw=0,pitch=.42,distance=5.5,keys={},buildMode=false,selected='floor',rotation=0,piece=null,lastInput=0,lastGather=0,guide=false,toastTimer;
function me(){return state.players.find(p=>p.id===id);}
function send(m){if(ws?.readyState===1&&joined)ws.send(JSON.stringify(m));}
function notify(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);}
function guideOpen(open){controls.reset();moveTarget=null;guide=open;$('guide').classList.toggle('hidden',!open);keys={};send({type:'input',x:0,z:0});if(open){document.exitPointerLock?.();renderRecipes();}}
function capture(){canvas.requestPointerLock?.()?.catch?.(()=>notify('Mouse capture unavailable. Drag on the world to orbit.'));}
$('menuButton').onclick=()=>guideOpen(true);$('closeGuide').onclick=()=>guideOpen(false);
let recipeState='';
let reconnectWanted=false,reconnectTimer=null;
$('leave').onclick=()=>{reconnectWanted=false;clearTimeout(reconnectTimer);send({type:'input',x:0,z:0});ws?.close();location.reload();};
function connectExplorer(){$('enter').disabled=true;$('joinError').textContent='Connecting to the expedition server…';
 const character=$('character').value;if(!character){$('joinError').textContent='Create or select a character first.';$('enter').disabled=false;return;}localStorage.setItem('vc-selected-character',character);
 ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/ws`);
 ws.onopen=()=>ws.send(JSON.stringify({type:'join',character,server:'quiet-basin'}));
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='error'){notify(m.message);$('joinError').textContent=m.message;$('enter').disabled=false;ws.close();return;}
 if(m.type==='notice')notify(m.message);
 if(m.type==='welcome'){reconnectWanted=true;id=m.id;state=m.state;joined=true;localPos.set(me().x,surface(state,me().x,me().z),me().z);buildEnvironment(state.seed);$('landing').classList.add('hidden');$('hud').classList.remove('hidden');notify('Drag to look. Tap terrain or use the movement pad to walk.');}
 if(m.type==='state'){state=m.state;const p=me();if(p&&Math.hypot(localPos.x-p.x,localPos.z-p.z)>1){localPos.x=p.x;localPos.z=p.z;}updateGeometry();if(storageId)renderStorage();if(guide){const key=JSON.stringify([p?.inventory,p?.cutter,p?.flashlightOwned,p?.unlocked]);if(key!==recipeState){recipeState=key;renderRecipes();}}$('saveStatus').textContent=m.saveError||`Saved · ${m.lastSaved?new Date(m.lastSaved).toLocaleTimeString():'pending'}`;}
 if(m.type==='result'){notify(m.message);if(guide)renderRecipes();}
 updateHUD();};
 ws.onclose=()=>{$('enter').disabled=false;joined=false;keys={};controls.reset();moveTarget=null;$('network').textContent='RECONNECTING';if(reconnectWanted){notify('Reconnecting to the expedition…');clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connectExplorer,4000);}else if(!$('joinError').textContent)$('joinError').textContent='Server unavailable. Please try again.';};ws.onerror=()=>{$('joinError').textContent='Could not reach the expedition server.';};
}

async function showServers(){ $('findGame').classList.add('hidden');$('serverBrowser').classList.remove('hidden');$('serverInfo').textContent='Checking server…';try{const res=await fetch('/api/servers',{cache:'no-store'});if(!res.ok)throw Error();const data=await res.json(),server=data.servers[0];$('serverInfo').textContent=`${server.players} / ${server.maxPlayers} explorers online · Seeded planetary expedition`;$('enter').disabled=server.players>=server.maxPlayers||!$('character').value;}catch{$('serverInfo').textContent='Unable to check occupancy. You can still try joining.';$('enter').disabled=!$('character').value;}}
$('findGame').onclick=showServers;$('backTitle').onclick=()=>{$('serverBrowser').classList.add('hidden');$('findGame').classList.remove('hidden');};

$('joinForm').onsubmit=e=>{e.preventDefault();connectExplorer();};
function renderRecipes(){const p=me();if(!p)return;$('backpack').textContent=Object.entries(p.inventory).map(([k,v])=>`${RESOURCES[k].name}: ${v}`).join(' · ');$('recipes').replaceChildren();for(const [key,r] of Object.entries(RECIPES)){const div=document.createElement('div');div.className='recipe';const button=document.createElement('button');const craftable=['cutter','flashlight','ration'].includes(key),owned=key==='cutter'?p.cutter:key==='flashlight'?p.flashlightOwned:false;button.textContent=craftable?(owned?'EQUIPPED':'CRAFT'):r.unlock&&!p.unlocked?'LOCKED':'SELECT';button.disabled=(craftable&&(owned||!canAfford(p,key)))||(r.unlock&&!p.unlocked);button.onclick=()=>{if(craftable)send({type:'craft',recipe:key});else{selected=key;buildMode=true;guideOpen(false);updateHUD();}};const title=document.createElement('b');title.textContent=r.name;const cost=document.createElement('small');cost.textContent=Object.entries(r.cost).map(([k,v])=>`${v} ${RESOURCES[k].name}`).join(' + ');const desc=document.createElement('p');desc.textContent=r.description;div.append(button,title,cost,desc);$('recipes').append(div);}}
const pieces=['floor','wall','roof','heater','perimeter','lamp','cargo'];pieces.forEach((key,i)=>{const b=document.createElement('button');b.innerHTML=`<b>${i+1}</b>${RECIPES[key].name}<small>${Object.entries(RECIPES[key].cost).map(([k,v])=>v+' '+k).join(' / ')}</small>`;b.onclick=()=>{selected=key;buildMode=true;updateHUD();};b.dataset.piece=key;$('hotbar').append(b);});
function nearest(){const p=me();if(!p)return null;return state.resources.filter(n=>n.amount>0&&dist(n,p)<=3).sort((a,b)=>dist(a,p)-dist(b,p))[0];}
function attack(){const p=me();if(!p)return;const c=(state.creatures||[]).filter(c=>dist(c,p)<2.8).sort((a,b)=>dist(a,p)-dist(b,p))[0];if(c)send({type:'attack',id:c.id});else notify('No creature in reach. Move closer.');}
$('attackAction').onclick=attack;$('lightAction').onclick=()=>send({type:'light'});$('eatAction').onclick=()=>send({type:'eat'});
function interact(){const p=me();if(!p)return;if(dist(p,RUIN)<4)send({type:'scan'});else{const n=nearest();if(n)send({type:'gather',id:n.id});}}
function updateHUD(){const p=me();if(!p)return;$('network').textContent=`${state.players.length} EXPLORER${state.players.length===1?'':'S'} ONLINE`;
 const day=daylight(state.time);$('dayClock').textContent=`DAY ${day.day} · ${day.night?'NIGHT':'DAYLIGHT'} · ${day.remaining}s`;const storm=state.time%150>=105;$('weather').textContent=storm?`ION WIND · ${Math.ceil(150-state.time%150)}s`:`CALM · WIND IN ${Math.ceil(105-state.time%150)}s`;
 $('charge').value=p.charge;$('health').value=p.health;$('chargeText').textContent=`${Math.ceil(p.charge)}%`;$('healthText').textContent=`${Math.ceil(p.health)}%`;$('protection').textContent=powered(state,p)?'ANCHOR FIELD · RECHARGING':sheltered(state,p)?'SHELTERED · RECHARGING':storm?'ION WIND · FIND SHELTER':'EXPOSED · SLOW DRAIN';
 $('inventory').textContent=`${itemCount(p.inventory)}/60 · ${p.inventory.ferrite} Ferrite   ·   ${p.inventory.fiber} Fiber   ·   ${p.inventory.crystal} Flux · ${p.inventory.ration||0} Meals`;$('lightAction').textContent=p.flashlightOn?'Light: ON':'Light';
 $('coords').textContent=`${Math.round(p.x)} / ${Math.round(p.z)} · SEED ${state.seed}`;
 const bearing=Math.atan2(RUIN.x-p.x,-(RUIN.z-p.z))*180/Math.PI;$('bearing').textContent=`${Math.round(dist(p,RUIN))} m · ${Math.round((bearing+360)%360)}°`;
 const roof=state.structures.some(s=>s.type==='roof'),anchor=state.structures.some(s=>s.type==='heater');
 const stages=[['Craft a field cutter',p.cutter],['Read the signal ruin',p.unlocked],['Build a canopy over a deck',roof],['Power an outpost',p.completed]];
 $('steps').replaceChildren(...stages.map(([label,done])=>{const d=document.createElement('div');d.className=done?'done':'';d.textContent=`${done?'✓':'○'} ${label}`;return d;}));
 $('objective').textContent=p.completed?'A foothold among the stars.':!p.cutter?'Start with what you find.':!p.unlocked?'Follow the broken ring.':!roof?'Make shelter.':!anchor?'Bring the signal home.':'Stand beneath your powered canopy.';
 $('objectiveDetail').textContent=p.completed?'First Signal complete. Keep exploring and expand your shared outpost.':!p.cutter?'Gather 3 ferrite and 2 ribbon fiber. Open C to fabricate your cutter.':!p.unlocked?'Seek the ring northeast of the landing point. Press E at its console.':'Build a deck, canopy and resonance anchor. A powered shelter is your first home.';
 $('lore').textContent=p.unlocked?'“We did not build the signal. We only taught it to wait.” — fragment recovered from the broken ring':'The broken ring on the ridge carries a faint repeating signal. A field cutter might let you read it.';
 for(const b of $('hotbar').children)b.classList.toggle('active',buildMode&&b.dataset.piece===selected);
 $('placeAction').disabled=!buildMode;$('rotateAction').disabled=!buildMode;$('buildAction').textContent=buildMode?'Exit build':'Build';$('buildHint').classList.toggle('hidden',!buildMode);const n=nearest();const nearby=(state.creatures||[]).filter(c=>dist(c,p)<5).sort((a,b)=>dist(a,p)-dist(b,p))[0];$('interaction').textContent=buildMode?'':dist(p,RUIN)<4?'[E] Read signal console':n?`[E] Gather ${RESOURCES[n.type].name} · ${n.amount} remaining`:nearby?`${SPECIES[nearby.type].name} · ${nearby.type==='grazer'?'neutral · hunt for meat':'hostile'} · Attack within 2.8 m`:'Tap terrain to walk · Drag to look';
}
window.addEventListener('keydown',e=>{if(!joined||['INPUT','SELECT'].includes(document.activeElement.tagName))return;if(['Tab','Space','KeyW','KeyA','KeyS','KeyD'].includes(e.code))e.preventDefault();if(e.repeat)return;
 if(e.code==='KeyC'){guideOpen(!guide);return;}if(e.code==='Escape'){if(storageId){$('closeStorage').click();return;}if(guide)guideOpen(false);else if(buildMode){buildMode=false;updateHUD();}return;}if(guide)return;keys[e.code]=true;
 if(e.code==='KeyF')send({type:'light'});if(e.code==='KeyH')send({type:'eat'});if(e.code==='Space')attack();
 if(e.code==='KeyB'){buildMode=!buildMode;updateHUD();}if(/^Digit[1-7]$/.test(e.code)){selected=pieces[+e.code.slice(-1)-1];buildMode=true;updateHUD();}if(e.code==='KeyR')rotation=(rotation+1)%4;if(e.code==='KeyE'){interact();lastGather=performance.now();}
 if(e.code==='KeyX'){const p=me(),s=state.structures.filter(s=>s.owner===id&&dist(s,p)<6).sort((a,b)=>dist(a,p)-dist(b,p)||Number(a.type==='floor')-Number(b.type==='floor'))[0];if(s)send({type:'dismantle',id:s.id});}
});window.addEventListener('keyup',e=>keys[e.code]=false);window.addEventListener('blur',()=>{keys={};send({type:'input',x:0,z:0});});document.addEventListener('visibilitychange',()=>{if(document.hidden){keys={};send({type:'input',x:0,z:0});}});
let moveTarget=null,stuckTime=0;
function dismantleNearest(){const p=me();if(!p)return;const s=state.structures.filter(s=>s.owner===id&&dist(s,p)<6).sort((a,b)=>dist(a,p)-dist(b,p)||Number(a.type==='floor')-Number(b.type==='floor'))[0];if(s)send({type:'dismantle',id:s.id});else notify('No nearby piece belongs to you.');}

let storageId=null,storageState='';
$('storageAction').onclick=()=>{const p=me();const s=state.structures.filter(s=>s.type==='cargo'&&dist(s,p)<3).sort((a,b)=>dist(a,p)-dist(b,p))[0];if(!s){notify('Move within 3 m of a cargo locker.');return;}storageId=s.id;storageState='';guide=true;controls.reset();moveTarget=null;keys={};$('storagePanel').classList.remove('hidden');renderStorage();};
$('closeStorage').onclick=()=>{storageId=null;guide=false;$('storagePanel').classList.add('hidden');};
function renderStorage(){const p=me(),s=state.structures.find(s=>s.id===storageId);if(!p||!s||dist(s,p)>3){$('closeStorage').click();return;}const inv=state.containers?.[storageId]||{},key=JSON.stringify([inv,p.inventory]);if(key===storageState)return;storageState=key;$('storageCapacity').textContent=`Locker: ${itemCount(inv)}/200 · Backpack: ${itemCount(p.inventory)}/60`;$('storageItems').replaceChildren();for(const item of ['ferrite','fiber','crystal','meat','ration']){const row=document.createElement('div');row.className='storage-row';const label=document.createElement('span');label.textContent=`${RESOURCES[item].name} · bag ${p.inventory[item]||0} / locker ${inv[item]||0}`;row.append(label);for(const direction of ['deposit','withdraw']){const button=document.createElement('button');button.textContent=direction==='deposit'?'Store →':'← Take';button.onclick=()=>send({type:'transfer',id:storageId,item,direction,amount:Number($('transferAmount').value)});row.append(button);}$('storageItems').append(row);}}

const groundRay=new THREE.Raycaster();
const controls=bindControls({canvas,
 orbit:(dx,dy)=>{if(!joined||guide)return;yaw-=dx*.003;pitch=Math.max(-.08,Math.min(1.1,pitch+dy*.003));},
 groundClick:(x,y)=>{if(!joined||guide)return;if(buildMode){send({type:'build',piece:selected,x:piece?.x,z:piece?.z,rotation});return;}groundRay.setFromCamera(new THREE.Vector2(x/innerWidth*2-1,1-y/innerHeight*2),camera);const hit=groundRay.intersectObject(terrain)[0];if(hit){moveTarget={x:hit.point.x,z:hit.point.z};stuckTime=0;}},
 interact:()=>{if(joined&&!guide){interact();lastGather=performance.now();}},
 build:()=>{if(!joined||guide)return;buildMode=!buildMode;moveTarget=null;updateHUD();},
 rotate:()=>rotation=(rotation+1)%4,
 place:()=>{if(joined&&!guide&&buildMode&&piece)send({type:'build',piece:selected,x:piece.x,z:piece.z,rotation});},
 dismantle:()=>{if(joined&&!guide)dismantleNearest();},
 zoom:step=>distance=Math.max(2.5,Math.min(12,distance+step))
});
canvas.addEventListener('wheel',e=>{distance=Math.max(2.5,Math.min(12,distance+e.deltaY*.01));e.preventDefault();},{passive:false});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
const cameraRay=new THREE.Raycaster();
let last=performance.now(),frameCount=0,fpsTime=last,fps=0,previewKey='';
function animate(now){requestAnimationFrame(animate);const dt=Math.min(.05,(now-last)/1000);last=now;frameCount++;if(now-fpsTime>1000){fps=Math.round(frameCount*1000/(now-fpsTime));frameCount=0;fpsTime=now;}
 const p=me();if(joined&&p){let mx=0,mz=0;if(!guide){const f=Number(!!keys.KeyW)-Number(!!keys.KeyS)-controls.input.z,r=Number(!!keys.KeyD)-Number(!!keys.KeyA)+controls.input.x;if(Math.abs(f)+Math.abs(r)>.05)moveTarget=null;mx=-Math.sin(yaw)*f+Math.cos(yaw)*r;mz=-Math.cos(yaw)*f-Math.sin(yaw)*r;const len=Math.hypot(mx,mz);if(len>1){mx/=len;mz/=len;}}
 if(!guide&&moveTarget){const dx=moveTarget.x-localPos.x,dz=moveTarget.z-localPos.z,len=Math.hypot(dx,dz);if(len<.3)moveTarget=null;else{mx=dx/len;mz=dz/len;}}
 const beforeMove=localPos.clone();
 const sprint=!!(keys.ShiftLeft||keys.ShiftRight||controls.input.sprint),speed=sprint&&p.charge>5?6.5:4.2;
 if(!blocked(state,localPos.x+mx*dt*speed,localPos.z))localPos.x+=mx*dt*speed;if(!blocked(state,localPos.x,localPos.z+mz*dt*speed))localPos.z+=mz*dt*speed;
 if(moveTarget){stuckTime=localPos.distanceTo(beforeMove)<.001?stuckTime+dt:0;if(stuckTime>.7){moveTarget=null;notify('Path blocked. Steer around the obstacle.');}}
 if(!mx&&!mz){localPos.x=THREE.MathUtils.lerp(localPos.x,p.x,dt*12);localPos.z=THREE.MathUtils.lerp(localPos.z,p.z,dt*12);}
 localPos.y=surface(state,localPos.x,localPos.z);if(now-lastInput>50){send({type:'input',x:mx,z:mz,sprint,yaw,aimYaw:yaw+Math.PI});lastInput=now;}
 if((keys.KeyE||controls.input.gather)&&!guide&&now-lastGather>(p.cutter?420:800)){interact();lastGather=now;}
 const focus=new THREE.Vector3(localPos.x,localPos.y+1.4,localPos.z);const desired=new THREE.Vector3(localPos.x+Math.sin(yaw)*distance*Math.cos(pitch),localPos.y+1.4+distance*Math.sin(pitch),localPos.z+Math.cos(yaw)*distance*Math.cos(pitch));desired.y=Math.max(desired.y,height(desired.x,desired.z,state.seed)+.45);
 const arm=desired.clone().sub(focus);cameraRay.set(focus,arm.clone().normalize());cameraRay.far=arm.length();const obstruction=cameraRay.intersectObjects([...structuresGroup.children,terrain],true).find(h=>h.distance>.15&&h.object.geometry?.type!=='RingGeometry');if(obstruction)desired.copy(focus).addScaledVector(arm.normalize(),Math.max(.4,obstruction.distance-.3));
 if(obstruction||camera.position.distanceTo(desired)>15)camera.position.copy(desired);else camera.position.lerp(desired,1-Math.exp(-14*dt));camera.lookAt(focus);camera.fov=THREE.MathUtils.lerp(camera.fov,sprint?61:55,1-Math.exp(-4*dt));camera.updateProjectionMatrix();

 if(buildMode&&!guide){piece={type:selected,x:Math.round((localPos.x-Math.sin(yaw)*4.5)/3)*3,z:Math.round((localPos.z-Math.cos(yaw)*4.5)/3)*3,rotation};const err=placementError(state,p,piece,state.players)||(!canAfford(p,selected)?'Not enough resources.':'');const pk=JSON.stringify(piece)+!!err;if(pk!==previewKey){previewKey=pk;clearGroup(preview);const obj=pieceMesh(piece,true);obj.traverse(o=>{if(o.material)o.material.color.set(err?0xff766d:0xb9f1c7);});preview.add(obj);}$('buildHint').textContent=`${RECIPES[selected].name} · ${err||'VALID — click to place'} · Rotate / Place buttons`;preview.visible=true;}else preview.visible=false;
 }else if(!id){const t=now*.000025;camera.position.set(16+Math.sin(t)*8,13,26);camera.lookAt(7,1,-9);}
 const online=new Set(state.players.map(p=>p.id));for(const [key,a] of avatars)if(!online.has(key)){scene.remove(a);avatars.delete(key);}
 for(const player of state.players){let a=avatars.get(player.id);if(!a){a=astronaut(player.id===id?0xb6d4c2:0xebac87);if(player.id!==id){const tag=document.createElement('canvas');tag.width=256;tag.height=64;const ctx=tag.getContext('2d');ctx.fillStyle='#132a31d9';ctx.fillRect(0,0,256,64);ctx.fillStyle='#e6f7e8';ctx.font='bold 26px sans-serif';ctx.textAlign='center';ctx.fillText(player.name,128,41,240);const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(tag),depthTest:false}));label.position.y=2.4;label.scale.set(2.3,.575,1);a.add(label);}scene.add(a);avatars.set(player.id,a);a.position.set(player.x,surface(state,player.x,player.z),player.z);}
 const target=player.id===id?localPos:new THREE.Vector3(player.x,surface(state,player.x,player.z),player.z);const moving=a.position.distanceTo(target)>.03;a.position.lerp(target,player.id===id?1:Math.min(1,dt*12));a.rotation.y=player.yaw;for(let i=0;i<a.userData.legs.length;i++)a.userData.legs[i].rotation.x=moving?Math.sin(now*.012+i*Math.PI)*.4:0;
 }
 if(ruinPulse){ruinPulse.rotation.y=now*.001;ruinPulse.position.y=1.7+Math.sin(now*.002)*.15;}
 const phase=daylight(state.time),sunFade=phase.phase<360?Math.min(1,phase.phase/25,(360-phase.phase)/25):0;skyLight.intensity=.22+sunFade*1.58;sun.intensity=.06+sunFade*2.44;scene.background.set('#0c142b').lerp(new THREE.Color('#718f96'),sunFade);const orbit=phase.phase/360*Math.PI;sun.position.set(-Math.cos(orbit)*40,Math.max(3,Math.sin(orbit)*48),18);scene.fog.color.copy(scene.background);wildlife.update(state,dt,id,yaw,shape);
 const storm=joined&&state.time%150>=105;scene.fog.density=storm?.026:.012;renderer.render(scene,camera);
}
buildEnvironment(state.seed);requestAnimationFrame(animate);
// Read-only diagnostics for repeatable browser verification; no gameplay mutation API.
Object.defineProperty(window,'vibeDiagnostics',{get:()=>({connected:joined,id,player:me()?structuredClone(me()):null,state:structuredClone(state),fps,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,avatars:avatars.size,creatures:wildlife.count(),night:daylight(state.time).night,webgl:renderer.capabilities.isWebGL2,buildMode,selected,preview:piece?{...piece}:null})});
