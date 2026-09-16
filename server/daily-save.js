export async function dailyBackup(store,now=new Date()){
 const raw=await store.read();if(!raw)return {saved:false,reason:'No world created yet'};
 const date=now.toISOString().slice(0,10),key=`${store.key}:daily:${date}`;
 const result=await store.command(['SET',key,raw,'NX','EX',8*86400]);
 return {saved:result==='OK',alreadySaved:result!=='OK',date,schedule:'00:00 UTC',retentionDays:8};
}
