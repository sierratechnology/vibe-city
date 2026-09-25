import * as THREE from 'three';
import {GLTFLoader} from './vendor/loaders/GLTFLoader.js';
import {mergeGeometries} from './vendor/utils/BufferGeometryUtils.js';

const expected=['explorer','grazer','skitter','prowler','scout','rover','crawler',...['ice','water','copper','silica','carbon','scrap','ferrite','fiber','meat','ration','crystal'].map(s=>'resource_'+s),...['cargo','workbench','lifeSupport','iceProcessor','garden','bed','heater'].map(s=>'prop_'+s)];
let library=null,status='loading';const baked=new Map();
export const fieldArtState=()=>({status,models:library?expected.length:0,source:'original-local-blender'});
export const fieldArtReady=()=>!!library;
export async function loadFieldArt(){try{const response=await fetch('/client/assets/field-kit.glb');if(!response.ok)throw Error('Model download failed');const bytes=await response.arrayBuffer();if(bytes.byteLength>5*1024*1024)throw Error('Asset budget exceeded');const gltf=await new GLTFLoader().parseAsync(bytes,'');if(expected.some(name=>!gltf.scene.getObjectByName(name)))throw Error('Incomplete field kit');gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.userData.sharedArt=true;}});library=gltf.scene;library.updateMatrixWorld(true);status='ready';return true;}catch(error){status='fallback';console.warn('Field art unavailable; retaining playable fallback.',error.message);return false;}}
export function fieldModel(name){const source=library?.getObjectByName(name);if(!source)return null;const model=source.clone(true);model.userData.art=true;model.userData.model=name;return model;}
export function fieldResource(type){const name='resource_'+type;if(!library)return null;if(baked.has(name))return baked.get(name).clone();const root=library.getObjectByName(name),pieces=[];root.updateWorldMatrix(true,true);root.traverse(o=>{if(!o.isMesh)return;const g=o.geometry.clone();g.applyMatrix4(o.matrixWorld);pieces.push(g.index?g.toNonIndexed():g);});const merged=mergeGeometries(pieces,false);for(const g of pieces)g.dispose();if(!merged)return null;merged.computeBoundingBox();merged.translate(0,(type==='fiber'?-.8:-.6)-merged.boundingBox.min.y,0);merged.computeBoundingSphere();baked.set(name,merged);return merged.clone();}
export function fieldProp(type,dimensions){const model=fieldModel('prop_'+type);if(!model)return null;const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),centre=box.getCenter(new THREE.Vector3());const holder=new THREE.Group();model.position.sub(centre);holder.add(model);holder.scale.set(dimensions.w/size.x,dimensions.h/size.y,dimensions.d/size.z);holder.userData.art=true;return holder;}

// Smooth joint animation on imported rigid-part rigs. It follows accepted movement;
// no mesh animation changes collisions, authoritative position, or jump physics.
export function animateFieldModel(model,{dt,time,speed=0,jump=0,action=0,sprint=false,sleeping=false,fabricator=false,cutter=false,rifle=false}={}){
 if(!model?.userData.art)return;const data=model.userData;data.motion??={blend:0,phase:0};const motion=data.motion,target=Math.min(1,speed/.9);motion.blend=THREE.MathUtils.damp(motion.blend,target,9,dt);motion.phase+=dt*(sprint?12:8)*Math.min(1.7,Math.max(.3,speed/2.5));
 const name=data.model;data.joints??=Object.fromEntries((()=>{const a=[];model.traverse(o=>{if(!o.isMesh){o.userData.restPosition??=o.position.clone();o.userData.restQuaternion??=o.quaternion.clone();a.push([o.name,o]);}});return a;})());
 const pose=(key,x=0,y=0,z=0)=>{const joint=data.joints[key];if(joint)joint.quaternion.copy(joint.userData.restQuaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z)));};
 if(name==='explorer'){const tool=model.getObjectByName('explorer_tool'),weapon=model.getObjectByName('explorer_rifle');const driver=model.getObjectByName('explorer_fabricator');if(driver)driver.visible=fabricator;if(tool)tool.visible=cutter&&!rifle&&!fabricator;if(weapon)weapon.visible=rifle&&!fabricator;
  const gait=Math.sin(motion.phase)*motion.blend,air=jump>.02,bend=air?.38:0;
  pose('explorer_leg_l',air?-.35:gait*.62);pose('explorer_leg_r',air?.20:-gait*.62);pose('explorer_shin_l',bend+Math.max(0,-gait)*.8);pose('explorer_shin_r',bend+Math.max(0,gait)*.8);
  pose('explorer_arm_l',air?-.5:-gait*.48,0,.06);pose('explorer_arm_r',action>0?-Math.sin(action*Math.PI)*1.25:air?-.5:gait*.48,0,-.06);
  pose('explorer_forearm_l',-.12-Math.max(0,gait)*.25);pose('explorer_forearm_r',action>0?-.12-Math.sin(action*Math.PI)*.7:-.12-Math.max(0,-gait)*.25);
  const body=data.joints.explorer_body;if(body){body.position.copy(body.userData.restPosition);body.position.y+=Math.sin(time*2)*.008+Math.abs(Math.sin(motion.phase))*motion.blend*.035;pose('explorer_body',sleeping?-.25:sprint?.09:0,Math.sin(time*.65)*.025,Math.sin(motion.phase)*motion.blend*.035);}pose('explorer_head',Math.sin(time*.7)*.025,-Math.sin(time*.65)*.035);
 }else if(['grazer','skitter','prowler'].includes(name)){
  for(const key of Object.keys(data.joints))if(key.includes('_leg_')){const side=key.includes('_l')?1:-1,j=Number(key.slice(-1));pose(key,Math.sin(motion.phase*1.1+j*Math.PI+side)*motion.blend*.48,0,Math.sin(motion.phase+j)*motion.blend*.035);}
  pose(name+'_tail',0,Math.sin(time*2)*.25);const body=data.joints[name+'_body'];if(body){body.position.copy(body.userData.restPosition);body.position.y+=Math.sin(time*2)*.012+Math.abs(Math.sin(motion.phase))*motion.blend*.035;}
 }else if(['scout','rover','crawler'].includes(name)){
  motion.wheel=(motion.wheel||0)+speed*dt/.46;for(const key of Object.keys(data.joints))if(key.includes('_wheel_'))pose(key,motion.wheel);const body=data.joints[name+'_body'];if(body){body.position.copy(body.userData.restPosition);body.position.y+=Math.sin(time*15)*Math.min(.022,speed*.003);}
 }
 data.animation=jump>.02?'jump':action>0?'action':speed>.2?(sprint?'run':'walk'):'idle';
}
