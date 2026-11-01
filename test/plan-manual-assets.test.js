import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('가상 HTTP: 관리자 app 및 PDF/수기 출력 의존성은 200과 올바른 MIME으로 제공',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jweb-manual-assets-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']}),observed=[];
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);
  const base=`http://127.0.0.1:${port}`,paths=new Set(['/plan-manual-print.js','/plan-manual-print.css','/plan-print-lock.js','/app.js','/plan-pdf.js']);
  for(const entry of ['app.js','plan-pdf.js','plan-manual-print.js'])for(const match of readFileSync(`public/${entry}`,'utf8').matchAll(/from\s+['"]\.\/([^'"]+)['"]/g))paths.add('/'+match[1]);
  for(const path of paths){const response=await fetch(base+path),body=await response.text(),mime=response.headers.get('content-type');observed.push({path,status:response.status,mime,bytes:Buffer.byteLength(body)});assert.equal(response.status,200,path);assert.equal(mime,path.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8',path);assert.equal(body,readFileSync('public'+path,'utf8'),path);}
  const index=await (await fetch(base)).text();assert.match(index,/href="\/plan-manual-print.css"/);assert.match(index,/src="\/app.js"/);
  mkdirSync('.omo/evidence/plan-manual-print',{recursive:true});writeFileSync('.omo/evidence/plan-manual-print/http-assets.json',JSON.stringify(observed,null,2));
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
