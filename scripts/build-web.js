import fs from 'node:fs';
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist',{recursive:true});
for(const folder of ['client','shared'])fs.cpSync(folder,`dist/${folder}`,{recursive:true});
fs.copyFileSync('client/index.html','dist/index.html');fs.mkdirSync('dist/node_modules/three/build',{recursive:true});
for(const file of ['three.module.js','three.core.js'])fs.copyFileSync(`node_modules/three/build/${file}`,`dist/node_modules/three/build/${file}`);
console.log('Built browser assets. No save files, credentials or server sources included.');
