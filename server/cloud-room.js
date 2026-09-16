import {Game} from './game.js';
// Advance once from persisted time, in collision-safe steps, then apply new input.
export function advance(room,now=Date.now()){
 for(const [id,lease] of Object.entries(room.leases))if(lease.until<=now){delete room.leases[id];delete room.inputs[id];}
 const game=new Game(room.world);game.online=new Set(Object.keys(room.leases));game.inputs=new Map(Object.entries(room.inputs).map(([id,v])=>[id,now-v.at<500?v:{x:0,z:0}]));game.inputAcks=new Map(Object.entries(room.inputs).map(([id,v])=>[id,Number.isSafeInteger(v.sequence)&&v.sequence>=0?v.sequence:null]));
 let elapsed=Math.min(.25,Math.max(0,(now-room.at)/1000));while(elapsed>0){const step=Math.min(.05,elapsed);game.tick(step);elapsed-=step;}room.at=now;
 // Action cooldowns must survive transactions and cannot be bypassed across instances.
 game.cooldowns=new Map(Object.entries(room.cooldowns||{}));return game;
}
export function finish(room,game){room.world=game.world;room.cooldowns=Object.fromEntries(game.cooldowns);}
export function joinRoom(room,{id,session,name},now=Date.now()){
 const game=advance(room,now);if(room.leases[id])return{ok:false,message:'This explorer is already online. Select a different character.'};if(Object.keys(room.leases).length>=10)return{ok:false,message:'Server full (10 explorers).'};
 // Bound a public prototype's finite save. Existing explorers can always return.
 if(!room.world.players[id]&&Object.keys(room.world.players).length>=500)return{ok:false,message:'This expedition has reached its saved-explorer limit.'};
 game.join(id,name);room.leases[id]={session,until:now+8000};room.inputs[id]={x:0,z:0,at:now};finish(room,game);return{ok:true,state:game.snapshot()};
}
export function frameRoom(room,clients,actions,now=Date.now()){
 const game=advance(room,now),results=[];
 for(const c of clients){if(room.leases[c.id]?.session!==c.session)continue;room.leases[c.id].until=now+8000;if(c.input===null){game.inputs.set(c.id,{x:0,z:0});room.inputs[c.id]={...game.inputs.get(c.id),sequence:game.inputAck(c.id),at:now};}else if(game.input(c.id,c.input))room.inputs[c.id]={...game.inputs.get(c.id),sequence:game.inputAck(c.id),at:now};}
 for(const a of actions){if(room.leases[a.id]?.session!==a.session){results.push({key:a.key,ok:false,message:'Session expired. Reconnecting…'});continue;}results.push({key:a.key,...game.action(a.id,a.message)});}
 finish(room,game);return{results,state:game.snapshot(),inputAcks:Object.fromEntries([...game.online].map(id=>[id,game.inputAck(id)]))};
}
export function leaveRoom(room,id,session){const game=advance(room);if(room.leases[id]?.session===session){game.leave(id);delete room.leases[id];delete room.inputs[id];}finish(room,game);}
