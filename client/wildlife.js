import {fieldModel,fieldArtReady,animateFieldModel} from './field-art.js';
import {vector,orient} from './planet-renderer.js';
import {travel} from '/shared/planet.js';
import * as THREE from 'three';
import {SPECIES,daylight} from '/shared/ecology.js';
import {surface} from '/shared/world.js';
export function wildlifeRenderer(scene){
 const actors=new Map(),beams=new Map();const lampPool=Array.from({length:6},()=>{const l=new THREE.PointLight(0xffdca1,0,9,1.3);scene.add(l);return l;});
 function creature(c){const imported=fieldModel(c.type);if(imported){imported.scale.setScalar(SPECIES[c.type].scale);return imported;}const spec=SPECIES[c.type],g=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:spec.color,flatShading:true,roughness:.9});const add=(geo,x,y,z,mat=material)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;g.add(m);return m;};
 const body=add(new THREE.IcosahedronGeometry(1,1),0,.8,0);body.scale.set(.6,.55,1);add(new THREE.IcosahedronGeometry(.43,0),0,1,1);
 for(const x of [-.4,.4])for(const z of [-.6,.6])add(new THREE.CylinderGeometry(.09,.14,.65,5),x,.33,z);
 if(c.type==='grazer'){const shell=add(new THREE.IcosahedronGeometry(.8,0),0,1.15,-.2);shell.scale.set(.9,.5,1.3);}else for(const x of [-.18,.18]){const eye=add(new THREE.OctahedronGeometry(.07),x,1.12,1.38,new THREE.MeshBasicMaterial({color:c.type==='prowler'?0xe7adff:0xffcf73}));}
 g.scale.setScalar(spec.scale);g.userData.geometryMaterial=material;return g;
 }
 return {update(state,dt,self,yaw,shape){
 const active=new Set((state.creatures||[]).map(c=>c.id));for(const [id,g] of actors)if(!active.has(id)){scene.remove(g);g.traverse(o=>{if(!o.userData.sharedArt)o.geometry?.dispose();});g.userData.geometryMaterial?.dispose();actors.delete(id);}
 for(const c of state.creatures||[]){let g=actors.get(c.id);if(g&&fieldArtReady()&&!g.userData.art){scene.remove(g);g.traverse(o=>o.geometry?.dispose());g.userData.geometryMaterial?.dispose();actors.delete(c.id);g=null;}if(!g){g=creature(c);g.position.copy(vector(c.x,c.z,surface(state,c.x,c.z)));scene.add(g);actors.set(c.id,g);}const target=vector(c.x,c.z,surface(state,c.x,c.z)),speed=Math.min(4,g.position.distanceTo(target)*Math.min(1,dt*10)/Math.max(dt,.001));animateFieldModel(g,{dt,time:state.time,speed});g.position.lerp(target,Math.min(1,dt*10));orient(g,c.x,c.z);g.rotateY(c.yaw);}
 const selfPlayer=state.players.find(p=>p.id===self),litPlayers=state.players.filter(p=>p.flashlightOn).sort((a,b)=>Math.hypot(a.x-(selfPlayer?.x||0),a.z-(selfPlayer?.z||0))-Math.hypot(b.x-(selfPlayer?.x||0),b.z-(selfPlayer?.z||0))).slice(0,4);const ids=new Set(litPlayers.map(p=>p.id));for(const [id,b] of beams)if(!ids.has(id)){scene.remove(b,b.target);b.dispose();beams.delete(id);}
 for(const p of litPlayers){let b=beams.get(p.id);if(!b){b=new THREE.SpotLight(0xd7f4ff,0,25,.48,.55,1);scene.add(b,b.target);beams.set(p.id,b);}const on=p.flashlightOn&&p.charge>0;b.intensity=on?35:0;b.position.copy(vector(p.x,p.z,surface(state,p.x,p.z)+(p.jumpHeight||0)+1.4));const angle=p.yaw||0;const aim=travel(p,Math.sin(angle)*14,Math.cos(angle)*14);b.target.position.copy(vector(aim.x,aim.z,surface(state,p.x,p.z)+(p.jumpHeight||0)+.4));}
 const near=state.structures.filter(s=>s.type==='lamp').map(s=>shape(s,state.seed)).sort((a,b)=>a.x*a.x+a.z*a.z-b.x*b.x-b.z*b.z); // Render a bounded light pool on mobile.
 const p=state.players.find(p=>p.id===self);if(p)near.sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z));
 lampPool.forEach((l,i)=>{l.intensity=near[i]?12:0;if(near[i])l.position.copy(vector(near[i].x,near[i].z,near[i].y));});
 },count:()=>actors.size};
}
