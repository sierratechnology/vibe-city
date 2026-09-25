import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {AUTHORED_MESH_LIMITS,createAuthoredMeshObject,createCampGateAuthoredObject,decodeAuthoredMesh,disposeAuthoredMesh,loadAuthoredMesh} from '../client/authored-mesh.js';

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

test('authored mesh decoder rejects repeated-index and exact canonical collinear triangles',()=>{
 for(const mesh of [
  {...fixture().meshes[0],indices:[0,0,1]},
  {...fixture().meshes[0],positions:[0,0,0,1,0,0,2,0,0]},
  {...fixture().meshes[0],positions:[.123456,.234567,0,.246912,.469134,0,.370368,.703701,0]}
 ])assert.throws(()=>decodeAuthoredMesh(JSON.stringify({...fixture(),meshes:[mesh]})),/authored mesh/i);
});

test('authored mesh decoder preserves both windings and small finite nonzero triangles',()=>{
 const clockwise={...fixture(),meshes:[{...fixture().meshes[0],indices:[0,2,1]}]},small={...fixture(),meshes:[{...fixture().meshes[0],positions:[0,0,0,.000001,0,0,0,.000001,0]}]};
 assert.deepEqual(decodeAuthoredMesh(JSON.stringify(clockwise)),clockwise);assert.deepEqual(decodeAuthoredMesh(JSON.stringify(small)),small);
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

test('checked-in Workbench authored manifest is valid and its literal local path is loadable',async()=>{
 const file=path.join(root,'client/assets/workbench.json'),text=fs.readFileSync(file,'utf8'),bytes=fs.statSync(file).size,data=decodeAuthoredMesh(text),vertices=data.meshes.reduce((n,m)=>n+m.positions.length/3,0),triangles=data.meshes.reduce((n,m)=>n+m.indices.length/3,0);
 assert.ok(bytes<=AUTHORED_MESH_LIMITS.bytes,{bytes});assert.ok(data.materials.length<=AUTHORED_MESH_LIMITS.materials);assert.ok(data.meshes.length<=AUTHORED_MESH_LIMITS.drawCalls);assert.ok(vertices<=AUTHORED_MESH_LIMITS.vertices,{vertices});assert.ok(triangles<=AUTHORED_MESH_LIMITS.triangles,{triangles});assert.equal(data.name,'workbench');
 const candidate={data};assert.equal(await loadAuthoredMesh({url:'/client/assets/workbench.json',fetchImpl:async()=>new Response(text,{headers:{'content-length':String(bytes)}}),create:decoded=>Object.assign(candidate,{decoded}),isCurrent:()=>true}),candidate);assert.equal(candidate.decoded.name,'workbench');
});

test('Camp gate retains its primitive renderer while adding the literal authored asset path',async()=>{
 const source=fs.readFileSync(path.join(root,'client/main.js'),'utf8'),renderer=source.match(/else if\(piece\.type==='campGate'\)\{(?<body>.*?)\}else if\(piece\.type===/s)?.groups.body;
 assert.ok(renderer);assert.match(renderer,/\[-1,1\]/);assert.match(renderer,/piece\.open/);
 const file=path.join(root,'client/assets/camp-gate.json'),text=fs.readFileSync(file,'utf8'),data=decodeAuthoredMesh(text),candidate={data},vertices=data.meshes.reduce((count,mesh)=>count+mesh.positions.length/3,0),triangles=data.meshes.reduce((count,mesh)=>count+mesh.indices.length/3,0);
 assert.equal(fs.statSync(file).size,1855);assert.equal(data.name,'camp-gate');assert.deepEqual(data.materials,['dark-blue-green','weathered-ivory']);assert.deepEqual(data.meshes.map(mesh=>mesh.name),['gate-frame','gate-leaf']);assert.equal(vertices,56);assert.equal(triangles,84);assert.equal(await loadAuthoredMesh({url:'/client/assets/camp-gate.json',fetchImpl:async()=>new Response(text),create:decoded=>Object.assign(candidate,{decoded}),isCurrent:()=>true}),candidate);
 assert.match(source,/createCampGateAuthoredObject/);assert.match(source,/camp-gate-fallback/);
});

test('decoded data builds a named deterministic bounded Three object without mutating input',()=>{
 const data=decodeAuthoredMesh(JSON.stringify(fixture())),before=structuredClone(data),material=new THREE.MeshBasicMaterial(),object=createAuthoredMeshObject(THREE,data,{'weathered-ivory':material}),bounds=new THREE.Box3().setFromObject(object);
 assert.equal(object.name,'broken-signal-ring');assert.deepEqual(object.userData,{authoredAsset:'broken-signal-ring',vertices:3,triangles:1,drawCalls:1,materials:1,bounds:{min:[0,0,0],max:[1,1,0]}});assert.equal(object.children.length,1);assert.equal(object.children[0].name,'ring-segment');assert.deepEqual(bounds.min.toArray(),[0,0,0]);assert.deepEqual(bounds.max.toArray(),[1,1,0]);assert.deepEqual(data,before);object.traverse(child=>child.geometry?.dispose());material.dispose();
});

test('Camp gate authored instances have independent server-state transforms diagnostics and disposal',()=>{
 const data=decodeAuthoredMesh(fs.readFileSync(path.join(root,'client/assets/camp-gate.json'),'utf8')),before=structuredClone(data),materials={'dark-blue-green':new THREE.MeshBasicMaterial(),'weathered-ivory':new THREE.MeshBasicMaterial()},closed=createCampGateAuthoredObject(THREE,data,materials,false),open=createCampGateAuthoredObject(THREE,data,materials,true),closedLeaf=closed.getObjectByName('gate-leaf'),openLeaf=open.getObjectByName('gate-leaf');
 assert.deepEqual(closed.userData,{authoredAsset:'camp-gate',vertices:56,triangles:84,drawCalls:2,materials:2,bounds:{min:[-1.46,-1.2,-.12],max:[1.46,1.2,.12]},presentation:'authored',open:false});assert.equal(closedLeaf.rotation.y,0);assert.deepEqual(closedLeaf.position.toArray(),[0,0,0]);assert.equal(open.userData.open,true);assert.equal(openLeaf.rotation.y,Math.PI/2);assert.deepEqual(openLeaf.position.toArray(),[-1.2,0,1.2]);assert.notEqual(openLeaf,closedLeaf);assert.notEqual(openLeaf.geometry,closedLeaf.geometry);
 openLeaf.position.x=9;assert.equal(closedLeaf.position.x,0);assert.deepEqual(data,before);disposeAuthoredMesh(open);assert.equal(closedLeaf.geometry.attributes.position.array.length,96);disposeAuthoredMesh(closed);for(const material of Object.values(materials))material.dispose();assert.equal(createCampGateAuthoredObject(THREE,null,materials,false),null);
});

test('bounded local loader accepts current data and disposes a stale candidate while failures return null',async()=>{
 const text=JSON.stringify(fixture()),made=[],create=data=>{const object={data,disposed:false,traverse(visitor){visitor({geometry:{dispose:()=>{object.disposed=true;}}});}};made.push(object);return object;},response=(body=text,ok=true)=>new Response(body,{status:ok?200:500,headers:{'content-length':String(Buffer.byteLength(body))}});
 const current=await loadAuthoredMesh({url:'/client/assets/broken-signal-ring.json',fetchImpl:async()=>response(),create,isCurrent:()=>true});assert.equal(current,made[0]);
 const stale=await loadAuthoredMesh({url:'/client/assets/broken-signal-ring.json',fetchImpl:async()=>response(),create,isCurrent:()=>false});assert.equal(stale,null);assert.equal(made[1].disposed,true);
 for(const fetchImpl of[async()=>response('',false),async()=>response('{'),async()=>response(JSON.stringify({...fixture(),extra:true})),async()=>response('x'.repeat(AUTHORED_MESH_LIMITS.bytes+1))])assert.equal(await loadAuthoredMesh({url:'/client/assets/broken-signal-ring.json',fetchImpl,create,isCurrent:()=>true}),null);
 assert.equal(await loadAuthoredMesh({url:'https://bad.invalid/model.json',fetchImpl:async()=>response(),create,isCurrent:()=>true}),null);
});

test('bounded local loader uses the caller disposer exactly once for a stale Workbench candidate',async()=>{
 const text=fs.readFileSync(path.join(root,'client/assets/workbench.json'),'utf8'),materials=Object.fromEntries(['weathered-ivory','dark-blue-green','mint-energy','coral-lavender'].map(name=>[name,new THREE.MeshBasicMaterial()])),materialDisposals=new Map(Object.values(materials).map(material=>[material,0])),geometryDisposals=[];
 for(const material of materialDisposals.keys())material.addEventListener('dispose',()=>materialDisposals.set(material,materialDisposals.get(material)+1));
 const create=data=>{const object=createAuthoredMeshObject(THREE,data,materials);object.traverse(child=>{if(child.geometry){geometryDisposals.push(0);const index=geometryDisposals.length-1;child.geometry.addEventListener('dispose',()=>geometryDisposals[index]++);}if(child.material)child.userData.workbenchMaterial=true;});return object;},dispose=object=>object.traverse(child=>{child.geometry?.dispose();if(child.userData?.workbenchMaterial)child.material?.dispose();});
 const result=await loadAuthoredMesh({url:'/client/assets/workbench.json',fetchImpl:async()=>new Response(text),create,isCurrent:()=>false,dispose});
 assert.equal(result,null);assert.deepEqual(geometryDisposals,[1,1,1,1]);assert.deepEqual([...materialDisposals.values()],[1,1,1,1]);
});

test('bounded local loader fetches only the three literal approved same-origin authored assets',async()=>{
 const calls=[],response=()=>new Response(JSON.stringify(fixture())),fetchImpl=async(url,options)=>{calls.push({url,options});return response();},create=data=>data;
 for(const url of ['/client/assets/broken-signal-ring.json','/client/assets/camp-gate.json','/client/assets/workbench.json'])assert.equal((await loadAuthoredMesh({url,fetchImpl,create,isCurrent:()=>true}))?.name,'broken-signal-ring');
 assert.deepEqual(calls.map(call=>call.url),['/client/assets/broken-signal-ring.json','/client/assets/camp-gate.json','/client/assets/workbench.json']);for(const call of calls)assert.deepEqual({cache:call.options.cache,credentials:call.options.credentials},{cache:'no-store',credentials:'same-origin'});
 for(const url of ['/client/assets/../main.js','/client/assets/%2e%2e/main.js','/client/assets/camp-gate.json?x=1','/client/assets/camp-gate.json#x','/client/assets/unknown.json','https://bad.invalid/client/assets/camp-gate.json',new String('/client/assets/camp-gate.json'),new Proxy({}, {})])assert.equal(await loadAuthoredMesh({url,fetchImpl,create,isCurrent:()=>true}),null);
 assert.equal(calls.length,3);
});

test('bounded local loader rejects an already-aborted or revoked signal before fetch or construction',async()=>{
 const controller=new AbortController();controller.abort();let fetchCalls=0,createCalls=0;const options={url:'/client/assets/camp-gate.json',fetchImpl:async()=>{fetchCalls++;return new Response(JSON.stringify(fixture()));},create:()=>{createCalls++;return {};},isCurrent:()=>true};
 assert.equal(await loadAuthoredMesh({...options,signal:controller.signal}),null);const {proxy,revoke}=Proxy.revocable({},{});revoke();const [settled]=await Promise.allSettled([loadAuthoredMesh({...options,signal:proxy})]);assert.deepEqual({status:settled.status,value:settled.value,fetchCalls,createCalls},{status:'fulfilled',value:null,fetchCalls:0,createCalls:0});
});

test('bounded local loader disposes a candidate exactly once across abort and currentness failures',async()=>{
 for(const mode of ['abort','throwing-currentness','stale-throwing-disposer']){const controller=new AbortController();let disposeCalls=0;const candidate={traverse(visitor){visitor({geometry:{dispose(){disposeCalls++;if(mode==='stale-throwing-disposer')throw Error('dispose failed');}}});}},result=await loadAuthoredMesh({url:'/client/assets/camp-gate.json',signal:controller.signal,fetchImpl:async()=>new Response(JSON.stringify(fixture())),create:()=>{if(mode==='abort')controller.abort();return candidate;},isCurrent:()=>{if(mode==='throwing-currentness'){controller.abort();throw Error('currentness failed');}return false;}});assert.equal(result,null,mode);assert.equal(disposeCalls,1,mode);}
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

test('Workbench renderer keeps one primitive fallback until a generation-safe independent authored replacement',()=>{
 const source=fs.readFileSync(path.join(root,'client/main.js'),'utf8');assert.match(source,/\/client\/assets\/workbench\.json/);assert.match(source,/workbench-fallback/);assert.match(source,/structureAssetGeneration===generation/);assert.match(source,/group\.remove\(fallback\);disposeWorkbenchAsset\(fallback\)/);assert.match(source,/materials\.wall\.clone\(\)/);assert.match(source,/disposeWorkbenchAsset/);
});
