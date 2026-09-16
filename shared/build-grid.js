import {RADIUS,TILES,point,unit,basis,coordinates,tileAt,tileSample,planetHeight,planetDistance} from './planet.js';
export function validSite(s){return s&&Number.isInteger(s.face)&&s.face>=0&&s.face<6&&Number.isInteger(s.i)&&s.i>=0&&s.i<TILES&&Number.isInteger(s.j)&&s.j>=0&&s.j<TILES;}
export const siteName=s=>s?`${s.face}:${s.i}:${s.j}`:'landing';
export function anchor(s){return s?tileSample(s,.5,.5):{x:0,z:0};}
export function gridPoint(site,gx,gz,seed,dy=0){const a=anchor(site),b=basis(a.x,a.z),h=planetHeight(a.x,a.z,seed),v=point(a.x,a.z,h+dy),dx=gx*3,dz=gz*3;v.x+=b.east.x*dx+b.south.x*dz;v.y+=b.east.y*dx+b.south.y*dz;v.z+=b.east.z*dx+b.south.z*dz;const p=coordinates({x:v.x,y:v.y+RADIUS,z:v.z});return{...p,y:Math.hypot(v.x,v.y+RADIUS,v.z)-RADIUS};}
export function localOffset(origin,p,frame=origin){const a=point(origin.x,origin.z,0),v=point(p.x,p.z,0),b=basis(frame.x,frame.z),dx=v.x-a.x,dy=v.y-a.y,dz=v.z-a.z;return{x:dx*b.east.x+dy*b.east.y+dz*b.east.z,z:dx*b.south.x+dy*b.south.y+dz*b.south.z};}
export function snapBuild(world,target){if(planetDistance(target,{x:0,z:0})<70)return{x:Math.round(target.x/3)*3,z:Math.round(target.z/3)*3};const nearest=world.structures.filter(s=>s.site&&planetDistance(s,target)<100).sort((a,b)=>planetDistance(a,target)-planetDistance(b,target))[0],site=nearest?.site||tileAt(target.x,target.z),a=anchor(site),o=localOffset(a,target,a),factor=(RADIUS+planetHeight(a.x,a.z,world.seed))/RADIUS,gx=Math.round(o.x*factor/3),gz=Math.round(o.z*factor/3),position=gridPoint(site,gx,gz,world.seed);return{x:position.x,z:position.z,site,gx,gz};}
export function buildingCell(s){return{site:s.site||null,x:s.site?s.gx:Math.round(s.x/3),z:s.site?s.gz:Math.round(s.z/3)};}
export function cellKey(c){return`${siteName(c.site)}|${c.x},${c.z}`;}
export function withinTile(s,p){if(planetDistance(s,p)>3)return false;const o=localOffset(s,p,s.site?anchor(s.site):s);return Math.abs(o.x)<=1.5&&Math.abs(o.z)<=1.5;}
export function floorHeight(s,p,seed){if(!s.site)return planetHeight(s.x,s.z,seed)+.27;const a=anchor(s.site),u=unit(p.x,p.z),normal=unit(a.x,a.z);return(RADIUS+planetHeight(a.x,a.z,seed)+.27)/(u.x*normal.x+u.y*normal.y+u.z*normal.z)-RADIUS;}
