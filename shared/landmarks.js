import {classifyBiome,hash,RADIUS,travel} from './planet.js';

const ORIGIN={x:0,z:0};
// At 3,200 m the 7x+13z sweep is wider than sin's longest <=.25 phase gap.
const RING_RADII=[500,850,1200,1550,3200],TAU=Math.PI*2,TRANSVERSE_NORM=Math.hypot(7,13),TRANSVERSE_PHASE=Math.atan2(13,7);

export function coralShelfLandmark(seed){
 if(!Number.isFinite(seed))throw new TypeError('World seed must be finite');
 const phase=hash(`biome:${seed}`)/4294967296*TAU,side=hash(`landmark:${seed}`)&1?-1:1;
 for(const radius of RING_RADII){
  const capAngle=radius/RADIUS,center=11*Math.cos(capAngle),amplitude=TRANSVERSE_NORM*Math.sin(capAngle),lower=center-amplitude,upper=center+amplitude;
  const peak=Math.ceil((lower+phase-Math.PI/2)/TAU)*TAU+Math.PI/2-phase;
  const target=peak<=upper?peak:Math.sin(lower+phase)>Math.sin(upper+phase)?lower:upper;
  const angle=TRANSVERSE_PHASE+side*Math.acos(Math.max(-1,Math.min(1,(target-center)/amplitude)));
  const position=travel(ORIGIN,Math.cos(angle)*radius,Math.sin(angle)*radius);
  if(classifyBiome(position.x,position.z,seed).id==='coral-shelf')return{id:'coral-crown',kind:'landmark',name:'Coral Crown',x:position.x,z:position.z,proximity:28};
 }
 throw new RangeError('No Coral Shelf landmark placement found');
}
