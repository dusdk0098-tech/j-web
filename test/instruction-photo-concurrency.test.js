import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';
import {AdminAccounts} from '../admin-accounts.js';

async function port(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
test('두 서버의 동시 사진 저장은 구분별 한도를 넘지 않는다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-instruction-photo-')),password='virtual-admin-password',store=new Store(join(dir,'jweb.sqlite')),auth=new AdminAccounts(store.db);auth.bootstrap(password);const site=store.createSite({name:'가상 현장'}),doc=store.createDocument({siteId:site.id,type:'instruction',title:'가상 지시',date:'2026-11-06'});store.transition(doc.id,'submit');store.transition(doc.id,'approve');store.addInstructionResult(doc.id,{date:'2026-11-06',actor:'가상',content:'가상 조치'});const bytes=Buffer.from('89504e470d0a1a0a','hex');for(let i=0;i<9;i++)store.addInstructionPhoto(doc.id,'before','가상.png',bytes);store.close();
  const children=[];try{
    const bases=[];for(let i=0;i<2;i++){const p=await port(),child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(p),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});children.push(child);await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('가상 서버 시작 실패');})]);bases.push(`http://127.0.0.1:${p}`);}
    const cookies=await Promise.all(bases.map(async base=>{const response=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];}));
    const results=await Promise.all(bases.map((base,i)=>fetch(base+`/api/documents/${doc.id}/instruction-photos?phase=before`,{method:'POST',headers:{cookie:cookies[i],'x-file-name':encodeURIComponent('가상.png')},body:bytes})));assert.deepEqual(results.map(response=>response.status).sort(),[201,400]);
    const list=await fetch(bases[0]+`/api/documents/${doc.id}/instruction-photos`,{headers:{cookie:cookies[0]}});assert.equal(list.status,200);assert.equal((await list.json()).filter(photo=>photo.phase==='before').length,10);
  }finally{for(const child of children)if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(dir,{recursive:true,force:true});}
});
