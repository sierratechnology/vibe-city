import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {AUTHORED_MESH_LIMITS,createAuthoredMeshObject,decodeAuthoredMesh,loadAuthoredMesh} from '../client/authored-mesh.js';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture=()=>({version:1,name:'broken-signal-ring',materials:['weathered-ivory'],meshes:[{name:'ring-segment',material:'weathered-ivory',positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2]}]});

test('authored mesh decoder accepts only a closed ordinary schema and returns detached data',()=>{
 const source=fixture(),decoded=decodeAuthoredMesh(JSON.stringify(source));
 assert.deepEqual(decoded,source);assert.notEqual(decoded,source);assert.notEqual(decoded.meshes,source.meshes);assert.notEqual(decoded.meshes[0].positions,source.meshes[0].positions);
 source.meshes[0].positions[0]=99;assert.equal(decoded.meshes[0].positions[0],0);
 for(const malformed of [{...fixture(),extra:true},{...fixture(),version:2},{...fixture(),name:'https://bad.invalid/model'},{...fixture(),materials:['unknown']},{...fixture(),meshes:[{...fixture().meshes[0],script:'alert(1)'}]}])assert.throws(()=>decodeAuthoredMesh(JSON.stringify(malformed)),/authored mesh/i);
 const accessor=fixture();let reads=0;Object.defineProperty(accessor,'name',{get(){reads++;return 'broken-signal-ring';},enumerable:true});assert.throws(()=>decodeAuthoredMesh(accessor),/authored mesh/i);assert.equal(reads,0);
 assert.throws(()=>decodeAuthoredMesh(new Proxy(fixture(),{})),/authored mesh/i);
 assert.throws(()=>decodeAuthoredMesh(Object.setPrototypeOf(fixture(),{unsafe:true})),/authored mesh/i);
});

test('authored mesh decoder rejects unsafe numbers indices and budget overflow before returning data',()=>{
 for(const positions of [[0,0,NaN,1,0,0,0,1,0],[0,0,0,1.0000000000000002,0,0,0,1,0]])assert.throws(()=>decodeAuthoredMesh(JSON.stringify({...fixture(),meshes:[{...fixture().meshes[0],positions}]})),/authored mesh/i);
 const negativeZero=JSON.stringify(fixture()).replace('"positions":[0,0,0,1','"positions":[0,-0,0,1');assert.throws(()=>decodeAuthoredMesh(negativeZero),/authored mesh/i);
 for(const indices of [[0,1,3],[0,1,1.5],[0,1,-1]])assert.throws(()=>decodeAuthoredMesh(JSON.stringify({...fixture(),meshes:[{...fixture().meshes[0],indices}]})),/authored mesh/i);
 const tooMany={...fixture(),meshes:Array.from({length:AUTHORED_MESH_LIMITS.drawCalls+1},(_,i)=>({...fixture().meshes[0],name:`part-${i}`}))};assert.throws(()=>decodeAuthoredMesh(JSON.stringify(tooMany)),/authored mesh/i);
});

test('authored mesh decoder rejects a Proxy without executing any trap',()=>{
 let traps=0;const trap=()=>{traps++;throw new Error('trap executed');};
 const hostile=new Proxy(fixture(),{getPrototypeOf:trap,ownKeys:trap,getOwnPropertyDescriptor:trap,get:trap});
 assert.throws(()=>decodeAuthoredMesh(hostile),/authored mesh/i);assert.equal(traps,0);
});

test('checked-in broken signal ring is accepted within explicit file and geometry budgets',()=>{
 const file=path.join(root,'client/assets/broken-signal-ring.json'),bytes=fs.statSync(file).size,data=decodeAuthoredMesh(fs.readFileSync(file,'utf8')),vertices=data.meshes.reduce((n,m)=>n+m.positions.length/3,0),triangles=data.meshes.reduce((n,m)=>n+m.indices.length/3,0);
 assert.ok(bytes<=AUTHORED_MESH_LIMITS.bytes,{bytes});assert.ok(data.materials.length<=AUTHORED_MESH_LIMITS.materials);assert.ok(data.meshes.length<=AUTHORED_MESH_LIMITS.drawCalls);assert.ok(vertices<=AUTHORED_MESH_LIMITS.vertices,{vertices});assert.ok(triangles<=AUTHORED_MESH_LIMITS.triangles,{triangles});assert.equal(data.name,'broken-signal-ring');
});

test('decoded data builds a named deterministic bounded Three object without mutating input',()=>{
 const data=decodeAuthoredMesh(JSON.stringify(fixture())),before=structuredClone(data),material=new THREE.MeshBasicMaterial(),object=createAuthoredMeshObject(THREE,data,{'weathered-ivory':material}),bounds=new THREE.Box3().setFromObject(object);
 assert.equal(object.name,'broken-signal-ring');assert.deepEqual(object.userData,{authoredAsset:'broken-signal-ring',vertices:3,triangles:1,drawCalls:1,materials:1,bounds:{min:[0,0,0],max:[1,1,0]}});assert.equal(object.children.length,1);assert.equal(object.children[0].name,'ring-segment');assert.deepEqual(bounds.min.toArray(),[0,0,0]);assert.deepEqual(bounds.max.toArray(),[1,1,0]);assert.deepEqual(data,before);object.traverse(child=>child.geometry?.dispose());material.dispose();
});

test('bounded local loader accepts current data and disposes a stale candidate while failures return null',async()=>{
 const text=JSON.stringify(fixture()),made=[],create=data=>{const object={data,disposed:false,traverse(visitor){visitor({geometry:{dispose:()=>{object.disposed=true;}}});}};made.push(object);return object;},response=(body=text,ok=true)=>new Response(body,{status:ok?200:500,headers:{'content-length':String(Buffer.byteLength(body))}});
 const current=await loadAuthoredMesh({url:'/client/assets/broken-signal-ring.json',fetchImpl:async()=>response(),create,isCurrent:()=>true});assert.equal(current,made[0]);
 const stale=await loadAuthoredMesh({url:'/client/assets/broken-signal-ring.json',fetchImpl:async()=>response(),create,isCurrent:()=>false});assert.equal(stale,null);assert.equal(made[1].disposed,true);
 for(const fetchImpl of[async()=>response('',false),async()=>response('{'),async()=>response(JSON.stringify({...fixture(),extra:true})),async()=>response('x'.repeat(AUTHORED_MESH_LIMITS.bytes+1))])assert.equal(await loadAuthoredMesh({url:'/client/assets/broken-signal-ring.json',fetchImpl,create,isCurrent:()=>true}),null);
 assert.equal(await loadAuthoredMesh({url:'https://bad.invalid/model.json',fetchImpl:async()=>response(),create,isCurrent:()=>true}),null);
});

test('bounded local loader cancels a no-length stream at the first oversized chunk',async()=>{
 const chunk=new Uint8Array(1024).fill(120);let pulls=0,cancelled=false,created=false;
 const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(chunk);if(pulls===480)controller.close();},cancel(){cancelled=true;}},{highWaterMark:0});
 const result=await loadAuthoredMesh({url:'/client/assets/broken-signal-ring.json',fetchImpl:async()=>new Response(body),create:()=>{created=true;},isCurrent:()=>true});
 assert.equal(result,null);assert.equal(cancelled,true);assert.ok(pulls<=AUTHORED_MESH_LIMITS.bytes/chunk.byteLength+1,{pulls});assert.equal(created,false);
});

test('environment keeps an independent primitive fallback and generation-safe authored replacement',()=>{
 const source=fs.readFileSync(path.join(root,'client/main.js'),'utf8');assert.match(source,/from '.\/authored-mesh\.js'/);assert.match(source,/new AbortController\(\)/);assert.match(source,/loadAuthoredMesh\(/);assert.match(source,/createAuthoredMeshObject\(/);assert.match(source,/broken-signal-ring-fallback/);assert.match(source,/assetGeneration===generation/);assert.match(source,/disposeAuthoredMesh\(fallback\)/);
});
