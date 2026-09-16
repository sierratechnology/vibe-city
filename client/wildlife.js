import * as THREE from 'three';
import {SPECIES,daylight} from '/shared/ecology.js';
import {surface} from '/shared/world.js';
export function wildlifeRenderer(scene){
 const actors=new Map(),beams=new Map();const lampPool=Array.from({length:6},()=>{const l=new THREE.PointLight(0xffdca1,0,9,1.3);scene.add(l);return l;});
 function creature(c){const spec=SPECIES[c.type],g=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:spec.color,flatShading:true,roughness:.9});const add=(geo,x,y,z,mat=material)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;g.add(m);return m;};
 const body=add(new THREE.IcosahedronGeometry(1,1),0,.8,0);body.scale.set(.6,.55,1);add(new THREE.IcosahedronGeometry(.43,0),0,1,1);
 for(const x of [-.4,.4])for(const z of [-.6,.6])add(new THREE.CylinderGeometry(.09,.14,.65,5),x,.33,z);
 if(c.type==='grazer'){const shell=add(new THREE.IcosahedronGeometry(.8,0),0,1.15,-.2);shell.scale.set(.9,.5,1.3);}else for(const x of [-.18,.18]){const eye=add(new THREE.OctahedronGeometry(.07),x,1.12,1.38,new THREE.MeshBasicMaterial({color:c.type==='prowler'?0xe7adff:0xffcf73}));}
 g.scale.setScalar(spec.scale);g.userData.geometryMaterial=material;return g;
 }
 return {update(state,dt,self,yaw,shape){
 const active=new Set((state.creatures||[]).map(c=>c.id));for(const [id,g] of actors)if(!active.has(id)){scene.remove(g);g.traverse(o=>{o.geometry?.dispose();});g.userData.geometryMaterial.dispose();actors.delete(id);}
 for(const c of state.creatures||[]){let g=actors.get(c.id);if(!g){g=creature(c);g.position.set(c.x,surface(state,c.x,c.z),c.z);scene.add(g);actors.set(c.id,g);}g.position.lerp(new THREE.Vector3(c.x,surface(state,c.x,c.z),c.z),Math.min(1,dt*10));g.rotation.y=c.yaw;}
 const ids=new Set(state.players.map(p=>p.id));for(const [id,b] of beams)if(!ids.has(id)){scene.remove(b,b.target);b.dispose();beams.delete(id);}
 for(const p of state.players){let b=beams.get(p.id);if(!b){b=new THREE.SpotLight(0xd7f4ff,0,25,.48,.55,1);scene.add(b,b.target);beams.set(p.id,b);}const on=p.flashlightOn&&p.charge>0;b.intensity=on?35:0;b.position.set(p.x,surface(state,p.x,p.z)+1.4,p.z);const angle=p.id===self?yaw+Math.PI:(p.aimYaw??p.yaw);b.target.position.set(p.x+Math.sin(angle)*14,surface(state,p.x,p.z)+.4,p.z+Math.cos(angle)*14);}
 const near=state.structures.filter(s=>s.type==='lamp').map(s=>shape(s,state.seed)).sort((a,b)=>a.x*a.x+a.z*a.z-b.x*b.x-b.z*b.z); // Render a bounded light pool on mobile.
 const p=state.players.find(p=>p.id===self);if(p)near.sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z));
 lampPool.forEach((l,i)=>{l.intensity=near[i]?12:0;if(near[i])l.position.set(near[i].x,near[i].y,near[i].z);});
 },count:()=>actors.size};
}
