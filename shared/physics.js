// Gravity is a creation-time property, in metres per second squared.
export const DEFAULT_GRAVITY=9.81,JUMP_SPEED=5.6,JUMP_COST=12;
export function gravityForSeed(seed){let x=(seed^0x6a09e667)>>>0;x=Math.imul(x^(x>>>16),0x45d9f3b);return Math.round((4+(x>>>0)/4294967296*8)*100)/100;}
export function stepJump(player,gravity,dt,ceiling=Infinity){
 if(player.vehicle||player.sleeping){player.jumpHeight=0;player.jumpVelocity=0;return;}
 if(!(player.jumpHeight>0||player.jumpVelocity>0))return;
 const next=player.jumpHeight+player.jumpVelocity*dt-.5*gravity*dt*dt;
 player.jumpVelocity-=gravity*dt;
 player.jumpHeight=Math.min(ceiling,Math.max(0,next));
 if(next>=ceiling)player.jumpVelocity=Math.min(0,player.jumpVelocity);
 if(next<=0){player.jumpHeight=0;player.jumpVelocity=0;}
}
