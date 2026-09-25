import * as THREE from 'three';
import {vector} from './planet-renderer.js';
import {basis,travel} from '/shared/planet.js';
import {surface} from '/shared/world.js';
// Reuse a fixed particle pool instead of allocating meshes for every tool strike.
export function actionFeedback(scene,{reducedMotion=false}={}){
 const geometry=new THREE.IcosahedronGeometry(.025,0),material=new THREE.MeshBasicMaterial({color:0xc6fff1}),mesh=new THREE.InstancedMesh(geometry,material,64),particles=[],dummy=new THREE.Object3D();mesh.frustumCulled=false;mesh.count=0;scene.add(mesh);
 const colors={gather:0xf4bc82,build:0x8af5d1,dismantle:0xefa88b,repair:0x95daff,attack:0xffa887};
 return{emit(action,p,state){if(reducedMotion||!Object.hasOwn(colors,action)||!p||p.vehicle)return;const origin=travel(p,Math.sin(p.yaw)*.7,Math.cos(p.yaw)*.7),position=vector(origin.x,origin.z,surface(state,origin.x,origin.z)+.9),frame=basis(origin.x,origin.z);for(let i=0;i<8;i++){if(particles.length===64)particles.shift();const angle=i*Math.PI/4,velocity=new THREE.Vector3(frame.east.x*Math.cos(angle)+frame.south.x*Math.sin(angle)+frame.up.x*1.8,frame.east.y*Math.cos(angle)+frame.south.y*Math.sin(angle)+frame.up.y*1.8,frame.east.z*Math.cos(angle)+frame.south.z*Math.sin(angle)+frame.up.z*1.8);particles.push({position:position.clone(),velocity,life:.35,color:colors[action]});}},update(dt){for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;if(p.life<=0){particles.splice(i,1);continue;}p.position.addScaledVector(p.velocity,dt);}mesh.count=particles.length;for(let i=0;i<particles.length;i++){const p=particles[i];dummy.position.copy(p.position);dummy.scale.setScalar(p.life/.35);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,new THREE.Color(p.color));}if(particles.length){mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;}},dispose(){scene.remove(mesh);geometry.dispose();material.dispose();},get count(){return particles.length;}};
}
