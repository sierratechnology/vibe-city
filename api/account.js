import {Accounts} from '../server/accounts.js';import {RedisStore} from '../server/cloud-store.js';
export default async function handler(req,res){try{return await new Accounts(new RedisStore()).handle(req,res);}catch{res.status(503).json({error:'Account service unavailable. Please try again.'});}}
