import fs from 'node:fs';
import path from 'node:path';
import {makeWorld,VERSION} from '../shared/world.js';
export function loadWorld(file,seed){if(!fs.existsSync(file))return makeWorld(seed);const w=JSON.parse(fs.readFileSync(file,'utf8'));if(w.version!==VERSION||!Array.isArray(w.resources)||!Array.isArray(w.structures)||typeof w.players!=='object'||!Number.isFinite(w.seed)||!Number.isFinite(w.time))throw Error('Unsupported or damaged save. Back it up and restore a valid world.json.');return w;}
export function saveWorld(file,world){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(world,null,2));fs.renameSync(tmp,file);}
