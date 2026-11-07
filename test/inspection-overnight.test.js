import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('안전점검은 밤샘 시간과 같은 시간대의 분 순서를 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),base={siteId:site.id,type:'inspection',title:'가상 점검',date:'2026-11-01'},row={inspector:'가상 점검자',hazard:'가상 상태',action:''};
    const doc=s.createDocument({...base,details:{rows:[{...row,timeFrom:'23:30',timeTo:'01:00'},{...row,timeFrom:'10:45',timeTo:'10:10'},{...row,timeFrom:'12:00',timeTo:'12:00'}]}}),rows=JSON.parse(doc.details).rows;
    assert.deepEqual(rows.map(r=>[r.timeFrom,r.timeTo]),[['23:30','01:00'],['10:10','10:45'],['12:00','12:00']]);
    assert.throws(()=>s.updateDocument(doc.id,{...base,details:{rows:[{...row,timeFrom:'23:30',timeTo:''}]}}),/점검시간/);
    assert.deepEqual(JSON.parse(s.document(doc.id).details).rows,rows);
    s.transition(doc.id,'submit');const saved=s.document(doc.id),snapshot=s.approvalCycle(doc.id,saved.approval_cycle_id);assert.deepEqual(JSON.parse(snapshot.document.details).rows,rows);
  }finally{s.close();}
});

test('밤샘 안전점검은 관리자 HTTP 저장과 조회에서 유지된다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-inspection-night-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const call=(path,method='GET',data,cookie)=>fetch(`http://127.0.0.1:${port}`+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const admin=(await call('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),input={siteId:site.id,type:'inspection',title:'가상 점검',date:'2026-11-01',details:{rows:[{inspector:'가상 점검자',hazard:'가상 상태',timeFrom:'23:30',timeTo:'01:00'},{inspector:'다른 점검자',hazard:'',timeFrom:'09:00',timeTo:'09:30'}]}};
    const created=await call('/api/documents','POST',input,admin);assert.equal(created.status,201);const doc=await created.json(),loaded=await (await call(`/api/documents/${doc.id}`,'GET',null,admin)).json();const rows=JSON.parse(loaded.details).rows;assert.deepEqual(rows.map(r=>[r.timeFrom,r.timeTo]),[['23:30','01:00'],['09:00','09:30']]);assert.equal(rows[1].hazard,'없음');
  }finally{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}rmSync(dir,{recursive:true,force:true});}
});

test('불안전 상태가 없는 점검도 없음으로 저장하고 결재 사본에 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),base={siteId:site.id,type:'inspection',title:'가상 점검',date:'2026-11-01'},row={inspector:'가상 점검자',timeFrom:'09:00',timeTo:'09:30',hazard:'   ',action:''};
    const doc=s.createDocument({...base,details:{rows:[row]}});assert.equal(JSON.parse(doc.details).rows[0].hazard,'없음');
    assert.throws(()=>s.createDocument({...base,details:{rows:[{...row,inspector:''}]}}),/점검자/);
    s.transition(doc.id,'submit');const saved=s.document(doc.id);assert.equal(JSON.parse(s.approvalCycle(doc.id,saved.approval_cycle_id).document.details).rows[0].hazard,'없음');
  }finally{s.close();}
});
