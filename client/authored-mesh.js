export const AUTHORED_MESH_LIMITS=Object.freeze({bytes:24*1024,materials:4,drawCalls:12,vertices:256,triangles:384,coordinates:256*3,indices:384*3});
export const AUTHORED_MESH_MATERIALS=Object.freeze(['weathered-ivory','dark-blue-green','mint-energy','coral-lavender']);
const topKeys=['version','name','materials','meshes'],meshKeys=['name','material','positions','indices'];
const fail=()=>{throw new TypeError('Invalid authored mesh manifest.');};
function descriptors(value,keys){
 if(value===null||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)return fail();
 const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some((key,index)=>typeof key!=='string'||key!==keys[index]))return fail();
 const found=Object.getOwnPropertyDescriptors(value);for(const key of keys){const descriptor=found[key];if(!descriptor||!('value'in descriptor)||!descriptor.enumerable||!descriptor.writable||!descriptor.configurable)return fail();}
 return found;
}
function denseArray(value,limit){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>limit)return fail();
 const keys=Reflect.ownKeys(value);if(keys.length!==value.length+1||keys.at(-1)!=='length')return fail();
 const found=Object.getOwnPropertyDescriptors(value);for(let index=0;index<value.length;index++){const descriptor=found[index];if(!descriptor||!('value'in descriptor)||!descriptor.enumerable||!descriptor.writable||!descriptor.configurable)return fail();}
 return found;
}
const safeName=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(value);
const canonicalNumber=value=>typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0)&&Math.abs(value)<=64&&Number(value.toFixed(6))===value;
function validateAuthoredMesh(value){
 const root=descriptors(value,topKeys);if(root.version.value!==1||!safeName(root.name.value))return fail();
 const materialDescriptors=denseArray(root.materials.value,AUTHORED_MESH_LIMITS.materials),materials=[];for(let index=0;index<root.materials.value.length;index++){const material=materialDescriptors[index].value;if(!AUTHORED_MESH_MATERIALS.includes(material)||materials.includes(material))return fail();materials.push(material);}if(!materials.length)return fail();
 const meshDescriptors=denseArray(root.meshes.value,AUTHORED_MESH_LIMITS.drawCalls),meshes=[];let vertices=0,triangles=0;if(!root.meshes.value.length)return fail();
 for(let meshIndex=0;meshIndex<root.meshes.value.length;meshIndex++){
  const part=descriptors(meshDescriptors[meshIndex].value,meshKeys),name=part.name.value,material=part.material.value;if(!safeName(name)||!materials.includes(material)||meshes.some(mesh=>mesh.name===name))return fail();
  const positionDescriptors=denseArray(part.positions.value,AUTHORED_MESH_LIMITS.coordinates),positions=[];if(part.positions.value.length<9||part.positions.value.length%3)return fail();for(let index=0;index<part.positions.value.length;index++){const coordinate=positionDescriptors[index].value;if(!canonicalNumber(coordinate))return fail();positions.push(coordinate);}const vertexCount=positions.length/3;vertices+=vertexCount;if(vertices>AUTHORED_MESH_LIMITS.vertices)return fail();
  const indexDescriptors=denseArray(part.indices.value,AUTHORED_MESH_LIMITS.indices),indices=[];if(part.indices.value.length<3||part.indices.value.length%3)return fail();for(let index=0;index<part.indices.value.length;index++){const vertex=indexDescriptors[index].value;if(!Number.isSafeInteger(vertex)||vertex<0||vertex>=vertexCount)return fail();indices.push(vertex);}triangles+=indices.length/3;if(triangles>AUTHORED_MESH_LIMITS.triangles)return fail();meshes.push({name,material,positions,indices});
 }
 return {version:1,name:root.name.value,materials,meshes};
}
export function decodeAuthoredMesh(value){
 if(typeof value!=='string'||new TextEncoder().encode(value).byteLength>AUTHORED_MESH_LIMITS.bytes)return fail();
 try{return validateAuthoredMesh(JSON.parse(value));}catch{return fail();}
}

export function disposeAuthoredMesh(object){object?.traverse?.(child=>child.geometry?.dispose?.());}

export function createAuthoredMeshObject(THREE,data,materialMap){
 const group=new THREE.Group();group.name=data.name;let vertices=0,triangles=0;const minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity];
 for(const part of data.meshes){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(part.positions,3));geometry.setIndex(part.indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();const object=new THREE.Mesh(geometry,materialMap[part.material]);object.name=part.name;object.castShadow=true;object.receiveShadow=true;group.add(object);vertices+=part.positions.length/3;triangles+=part.indices.length/3;for(let index=0;index<part.positions.length;index++)minimum[index%3]=Math.min(minimum[index%3],part.positions[index]),maximum[index%3]=Math.max(maximum[index%3],part.positions[index]);}
 group.userData={authoredAsset:data.name,vertices,triangles,drawCalls:data.meshes.length,materials:data.materials.length,bounds:{min:minimum,max:maximum}};return group;
}

async function readBoundedBody(response){
 if(!response.body?.getReader)return fail();
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array))return await reader.cancel(),fail();length+=value.byteLength;if(length>AUTHORED_MESH_LIMITS.bytes)return await reader.cancel(),fail();chunks.push(value);}}catch(error){try{await reader.cancel();}catch{}throw error;}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}

export async function loadAuthoredMesh({url,signal,fetchImpl=fetch,create,isCurrent}){
 if(url!=='/client/assets/broken-signal-ring.json'||typeof create!=='function'||typeof isCurrent!=='function')return null;
 try{const response=await fetchImpl(url,{cache:'no-store',credentials:'same-origin',signal});if(!response.ok)return null;const length=Number(response.headers?.get?.('content-length'));if(Number.isFinite(length)&&length>AUTHORED_MESH_LIMITS.bytes)return null;const bytes=await readBoundedBody(response),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),data=decodeAuthoredMesh(text),candidate=create(data);if(!isCurrent()){disposeAuthoredMesh(candidate);return null;}return candidate;}catch{return null;}
}
