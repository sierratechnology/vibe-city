// Durable optimistic transactions. All instances share one authoritative room.
import {makeWorld} from '../shared/world.js';
export class RedisStore {
 constructor({url=process.env.KV_REST_API_URL||process.env.UPSTASH_REDIS_REST_URL,token=process.env.KV_REST_API_TOKEN||process.env.UPSTASH_REDIS_REST_TOKEN,key=process.env.WORLD_KEY||`vibe:first-signal:${process.env.VERCEL_ENV||'local'}:v1`}={}){this.url=url;this.token=token;this.key=key;if(!url||!token)throw Error('Persistent world storage is not configured.');}
 async command(args){const response=await fetch(this.url,{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(6000)});if(!response.ok)throw Error('World storage is temporarily unavailable.');const data=await response.json();if(data.error)throw Error('World storage rejected the request.');return data.result;}
 async read(){return await this.command(['GET',this.key]);}
 async compareAndSet(before,after){return await this.command(['EVAL',"local current = redis.call('GET', KEYS[1]); if (not current and ARGV[1] == '') or current == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]); return 1 end; return 0",1,this.key,before||'',after])===1;}
}
export async function transaction(store,change){for(let i=0;i<12;i++){const before=await store.read();const room=before?JSON.parse(before):{version:1,world:makeWorld(7319),leases:{},inputs:{},at:Date.now()};if(room.version!==1||room.world.version!==1)throw Error('Unsupported world save version.');const result=change(room);if(await store.compareAndSet(before,JSON.stringify(room)))return{room,result};await new Promise(r=>setTimeout(r,10+Math.random()*25));}throw Error('World busy; please try again.');}
