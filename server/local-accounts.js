import fs from 'node:fs';import path from 'node:path';
// Single-process local persistence implementing only the account store's operations.
export class LocalAccountStore {
 constructor(file){this.file=file;this.key='local';this.data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};}
 async command([cmd,key,...args]){let result;const read=k=>{const v=this.data[k];if(v?.expires&&v.expires<=Date.now()){delete this.data[k];return null;}return v?.value??null;};if(cmd==='GET')return read(key);
 if(cmd==='GETDEL'){result=read(key);delete this.data[key];}
 if(cmd==='SET'){if(args.includes('NX')&&read(key)!==null)return null;const index=args.indexOf('EX');this.data[key]={value:args[0],expires:index>=0?Date.now()+Number(args[index+1])*1000:0};result='OK';}
 if(cmd==='DEL'){result=Number(!!this.data[key]);delete this.data[key];}
 if(cmd==='INCR'){result=Number(read(key)||0)+1;this.data[key]={value:String(result),expires:this.data[key]?.expires||0};}
 if(cmd==='EXPIRE'){if(this.data[key])this.data[key].expires=Date.now()+Number(args[0])*1000;result=1;}
 if(cmd==='EVAL'){const [count,actualKey,before,after,seconds]=args;if(read(actualKey)!==before)return 0;if(after===undefined)delete this.data[actualKey];else this.data[actualKey]={value:after,expires:seconds?Date.now()+Number(seconds)*1000:0};result=1;}
 fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);return result;}
}
