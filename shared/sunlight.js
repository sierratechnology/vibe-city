import {unit} from './planet.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
// One nearest sun, fixed in inertial space; the planet rotates below it.
// All observers share this direction, so opposite hemispheres see opposite phases.
export function sunlight(time,planet,position={x:0,z:0}){
 const period=planet?.rotationSeconds||900;
 const angle=((time%period)+period)%period/period*Math.PI*2;
 const direction={x:-Math.cos(angle),y:Math.sin(angle),z:0};
 const up=unit(position.x,position.z),elevation=up.x*direction.x+up.y*direction.y+up.z*direction.z;
 const daylight=smooth(-.2,.35,elevation),direct=smooth(-.015,.18,elevation);
 const distance=planet?.solarDistanceAU||1,irradiance=clamp(1/(distance*distance),.4,1.6);
 const twilight=(1-smooth(.02,.4,Math.abs(elevation)))*smooth(-.25,-.02,elevation);
 return{direction,elevation,daylight,direct,irradiance,twilight,label:elevation<-.2?'NIGHT':elevation<.2?'TWILIGHT':'DAYLIGHT'};
}
