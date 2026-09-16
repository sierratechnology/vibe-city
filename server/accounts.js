import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback),hash=s=>createHash('sha256').update(s).digest('hex');
export const COOKIE='vibe_session';
export function cookieToken(req){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';}
const profile=a=>({username:a.username,characters:a.characters});
export class Accounts {
 constructor(store){this.store=store;this.prefix=store.key+':auth';}
 async get(key){const s=await this.store.command(['GET',key]);return s?JSON.parse(s):null;}
 async session(token){if(!/^[a-f0-9]{64}$/.test(token||''))return null;const ref=await this.get(`${this.prefix}:session:${hash(token)}`);if(!ref)return null;const account=await this.get(ref.key);return account?{account,key:ref.key}:null;}
 async attempt(ip){const key=`${this.prefix}:limit:${hash(ip||'unknown')}`;const n=await this.store.command(['INCR',key]);if(n===1)await this.store.command(['EXPIRE',key,900]);if(n>30)throw Error('Too many sign-in attempts. Try again in 15 minutes.');}
 async authenticate(action,username,password,ip){await this.attempt(ip);username=String(username||'').trim().toLowerCase();if(!/^[a-z0-9_]{3,24}$/.test(username))throw Error('Use 3–24 letters, numbers or underscores for the username.');if(typeof password!=='string'||password.length<10||password.length>128)throw Error('Password must be 10–128 characters.');const key=`${this.prefix}:account:${hash(username)}`;
 let account=await this.get(key);if(action==='register'){if(account)throw Error('Username unavailable.');const salt=randomBytes(16).toString('hex'),digest=(await scrypt(password,salt,64)).toString('hex');account={username,salt,digest,characters:[]};const set=await this.store.command(['SET',key,JSON.stringify(account),'NX']);if(set!=='OK')throw Error('Username unavailable.');}else{const salt=account?.salt||'invalid-account',digest=await scrypt(password,salt,64);if(!account||!timingSafeEqual(digest,Buffer.from(account.digest,'hex')))throw Error('Incorrect username or password.');}
 const token=randomBytes(32).toString('hex');await this.store.command(['SET',`${this.prefix}:session:${hash(token)}`,JSON.stringify({key}),'EX',7*86400]);return{token,profile:profile(account)};
 }
 async createCharacter(token,name){const session=await this.session(token);if(!session)throw Error('Sign in first.');name=String(name||'').trim();if(!/^[\p{L}\p{N} _-]{2,20}$/u.test(name))throw Error('Character names need 2–20 letters, numbers, spaces or dashes.');for(let i=0;i<10;i++){const before=await this.store.command(['GET',session.key]),account=JSON.parse(before);if(account.characters.length>=3)throw Error('This account already has three characters.');if(account.characters.some(c=>c.name.toLowerCase()===name.toLowerCase()))throw Error('Choose a different character name.');account.characters.push({id:randomUUID(),name});const ok=await this.store.command(['EVAL',"if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2]); return 1 end; return 0",1,session.key,before,JSON.stringify(account)]);if(ok===1)return profile(account);}throw Error('Account busy. Please try again.');}
 async character(token,id){const session=await this.session(token);return session?.account.characters.find(c=>c.id===id)||null;}
 async logout(token){if(token)await this.store.command(['DEL',`${this.prefix}:session:${hash(token)}`]);}
 async handle(req,res){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');const secure=req.headers['x-forwarded-proto']==='https'||!!process.env.VERCEL;
 const setCookie=(token,maxAge)=>res.setHeader('Set-Cookie',`${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`);
 const respond=(code,body)=>{res.statusCode=code;res.end(JSON.stringify(body));};
 try{const token=cookieToken(req);if(req.method==='GET'){const s=await this.session(token);return respond(200,{profile:s?profile(s.account):null});}if(req.method!=='POST')return respond(405,{error:'Method not allowed.'});if(!req.headers['content-type']?.startsWith('application/json'))return respond(415,{error:'JSON required.'});if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return respond(403,{error:'Origin not allowed.'});
 let body=req.body;if(!body){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return respond(413,{error:'Request too large.'});}body=JSON.parse(raw);}if(typeof body==='string')body=JSON.parse(body);
 if(['register','login'].includes(body.action)){const result=await this.authenticate(body.action,body.username,body.password,String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0]);setCookie(result.token,7*86400);return respond(200,{profile:result.profile});}
 if(body.action==='character')return respond(200,{profile:await this.createCharacter(token,body.name)});
 if(body.action==='logout'){await this.logout(token);setCookie('',0);return respond(200,{profile:null});}return respond(400,{error:'Unknown account action.'});
 }catch(e){return respond(400,{error:e.message==='Unexpected end of JSON input'?'Invalid request.':e.message});}}
}
