import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import { Store } from '../store.js';

const png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),signature=`data:image/png;base64,${bytes.toString('base64')}`;

test('장비 점검의 별도 결재는 순서와 사본을 보존한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),make=(siteId,loginId)=>s.createReviewer({siteId,loginId,name:loginId,password:'virtual-password-123'});
    const first=make(site.id,'check_first'),second=make(site.id,'check_second'),foreign=make(other.id,'check_foreign'),equipment=s.createEquipment({siteId:site.id,kind:'가상 장비',model:'가상 모델',capacity:'',manufacturer:'',registration:''});
    const doc=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{equipmentIds:[equipment.id]}}),input={equipmentId:equipment.id,date:'2026-10-30',items:[{name:'가상 항목',result:'적정'}]},unsigned=s.addEquipmentCheck(doc.id,input),check=s.addEquipmentCheck(doc.id,{...input,date:'2026-10-31',inspector:'가상 점검자',signature});
    assert.throws(()=>s.requestEquipmentCheckApproval(doc.id,unsigned,{reviewerIds:[first.id],expectedCycleId:null}),/서명/);
    assert.throws(()=>s.requestEquipmentCheckApproval(doc.id,check,{reviewerIds:[foreign.id],expectedCycleId:null}),/현장/);
    assert.throws(()=>s.requestEquipmentCheckApproval(doc.id,check,{reviewerIds:[first.id,first.id],expectedCycleId:null}),/결재자/);
    assert.throws(()=>s.requestEquipmentCheckApproval(doc.id,check,{reviewerIds:[first.id],expectedCycleId:null},()=>{throw Error('세션 만료');}),/세션 만료/);assert.deepEqual(s.equipmentCheckApprovals(doc.id,check),[]);
    const cycle=s.requestEquipmentCheckApproval(doc.id,check,{reviewerIds:[first.id,second.id],expectedCycleId:null});assert.equal(cycle.status,'pending');assert.deepEqual(s.reviewerEquipmentChecks(first.id).map(row=>row.id),[check]);assert.deepEqual(s.reviewerEquipmentChecks(second.id),[]);
    assert.throws(()=>s.reviewEquipmentCheck(second.id,check,'approve','',signature,cycle.id),/차례/);assert.throws(()=>s.reviewEquipmentCheck(first.id,check,'approve','',null,cycle.id),/서명/);assert.throws(()=>s.reviewEquipmentCheck(first.id,check,'approve','',signature,cycle.id,()=>{throw Error('세션 만료');}),/세션 만료/);
    const version=s.planSignatureInfo(s.document(doc.id)).version;s.saveMeetingSignature(doc.id,signature,()=>{},version);s.db.exec("CREATE TRIGGER fail_check_review BEFORE UPDATE ON equipment_check_approval_steps WHEN NEW.state='approved' BEGIN SELECT RAISE(ABORT,'시험 결재 저장 실패'); END");assert.throws(()=>s.reviewEquipmentCheck(first.id,check,'approve','',signature,cycle.id),/시험 결재 저장 실패/);assert.equal(s.equipmentCheckApprovals(doc.id,check)[0].steps[0].state,'pending');assert.equal(s.planSignatureInfo(s.document(doc.id)).stale,false);s.db.exec('DROP TRIGGER fail_check_review');s.reviewEquipmentCheck(first.id,check,'approve','가상 승인',signature,cycle.id);assert.equal(s.planSignatureInfo(s.document(doc.id)).stale,true);
    const ready=s.planSignatureInfo(s.document(doc.id));s.saveMeetingSignature(doc.id,signature,()=>{},ready.version);s.transition(doc.id,'submit');const planCycle=s.document(doc.id).approval_cycle_id,frozen=s.approvalCycle(doc.id,planCycle);
    assert.deepEqual(frozen.linked.checks.find(row=>row.id===check).approval.steps.map(row=>row.state),['approved','pending']);assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,planCycle,'equipment-review-signature',check,1).data),bytes);
    assert.deepEqual(Buffer.from(s.reviewerEquipmentCheckSignature(second.id,check,cycle.id,1)),bytes);s.reviewEquipmentCheck(second.id,check,'approve','',signature,cycle.id);assert.equal(s.equipmentCheckApprovals(doc.id,check)[0].status,'approved');assert.equal(s.approvalCycleFile(doc.id,planCycle,'equipment-review-signature',check,2),null);
    s.deleteEquipmentCheck(doc.id,check);assert.deepEqual(Buffer.from(s.approvalCycleFile(doc.id,planCycle,'equipment-review-signature',check,1).data),bytes);assert.deepEqual(s.reviewerEquipmentChecks(second.id),[]);
  }finally{s.close();}
});

test('삭제 후 점검 번호가 재사용돼도 이전 결재 회차는 적용되지 않는다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),reviewer=s.createReviewer({siteId:site.id,loginId:'check_reuse',name:'가상 결재자',password:'virtual-password-123'}),equipment=s.createEquipment({siteId:site.id,kind:'가상 장비',model:'모델',capacity:'',manufacturer:'',registration:''}),doc=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{equipmentIds:[equipment.id]}}),input={equipmentId:equipment.id,date:'2026-10-30',items:[{name:'가상 항목',result:'적정'}],inspector:'가상 점검자',signature};
    const oldCheck=s.addEquipmentCheck(doc.id,input),old=s.requestEquipmentCheckApproval(doc.id,oldCheck,{reviewerIds:[reviewer.id],expectedCycleId:null});s.deleteEquipmentCheck(doc.id,oldCheck);const newCheck=s.addEquipmentCheck(doc.id,input),current=s.requestEquipmentCheckApproval(doc.id,newCheck,{reviewerIds:[reviewer.id],expectedCycleId:null});
    assert.equal(newCheck,oldCheck);assert.notEqual(current.id,old.id);assert.equal(s.reviewerEquipmentInspectorSignature(reviewer.id,newCheck,old.id),null);assert.deepEqual(Buffer.from(s.reviewerEquipmentInspectorSignature(reviewer.id,newCheck,current.id)),bytes);assert.throws(()=>s.reviewEquipmentCheck(reviewer.id,newCheck,'approve','',signature,old.id),error=>error.sessionStatus===409);assert.equal(s.equipmentCheckApprovals(doc.id,newCheck)[0].status,'pending');
  }finally{s.close();}
});

test('결재 대상이 조회 도중 변경돼도 한 회차의 자료만 보여 준다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-check-read-')),file=join(dir,'test.sqlite');let firstStore=new Store(file),secondStore;
  try{
    firstStore.db.exec('PRAGMA journal_mode=WAL');secondStore=new Store(file);const site=firstStore.createSite({name:'가상 현장'}),make=loginId=>firstStore.createReviewer({siteId:site.id,loginId,name:loginId,password:'virtual-password-123'}),first=make('check_read_first'),second=make('check_read_second'),equipment=firstStore.createEquipment({siteId:site.id,kind:'가상 장비',model:'모델',capacity:'',manufacturer:'',registration:''}),doc=firstStore.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{equipmentIds:[equipment.id]}}),check=firstStore.addEquipmentCheck(doc.id,{equipmentId:equipment.id,date:'2026-10-30',items:[{name:'가상 항목',result:'적정'}],inspector:'가상 점검자',signature});
    const old=firstStore.requestEquipmentCheckApproval(doc.id,check,{reviewerIds:[first.id],expectedCycleId:null}),lookup=firstStore.reviewerEquipmentChecks.bind(firstStore);let changed=false,current;
    firstStore.reviewerEquipmentChecks=id=>{const rows=lookup(id);if(!changed){changed=true;secondStore.withdrawEquipmentCheckApproval(doc.id,check,old.id);current=secondStore.requestEquipmentCheckApproval(doc.id,check,{reviewerIds:[second.id],expectedCycleId:old.id});}return rows;};
    const view=firstStore.reviewerEquipmentCheck(first.id,check);assert.equal(view.approval.id,old.id);assert.equal(view.approval.steps[0].reviewer_id,first.id);assert.equal(firstStore.reviewerEquipmentCheck(first.id,check),null);assert.equal(secondStore.reviewerEquipmentCheck(second.id,check).approval.id,current.id);
    firstStore.close();firstStore=null;secondStore.close();secondStore=null;firstStore=new Store(file);assert.equal(firstStore.reviewerEquipmentCheck(second.id,check).approval.id,current.id);
  }finally{firstStore?.close();secondStore?.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('반려와 취소한 점검 결재는 이력을 보존하고 최신 회차만 처리한다',()=>{
  const s=new Store(':memory:');try{
    const site=s.createSite({name:'가상 현장'}),reviewer=s.createReviewer({siteId:site.id,loginId:'check_history',name:'가상 결재자',password:'virtual-password-123'}),equipment=s.createEquipment({siteId:site.id,kind:'가상 장비',model:'모델',capacity:'',manufacturer:'',registration:''}),doc=s.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{equipmentIds:[equipment.id]}}),check=s.addEquipmentCheck(doc.id,{equipmentId:equipment.id,date:'2026-10-30',items:[{name:'가상 항목',result:'적정'}],inspector:'가상 점검자',signature});
    const first=s.requestEquipmentCheckApproval(doc.id,check,{reviewerIds:[reviewer.id],expectedCycleId:null});s.reviewEquipmentCheck(reviewer.id,check,'reject','가상 반려',null,first.id);assert.equal(s.equipmentCheckApprovals(doc.id,check)[0].status,'rejected');
    const next=s.requestEquipmentCheckApproval(doc.id,check,{reviewerIds:[reviewer.id],expectedCycleId:first.id});assert.throws(()=>s.withdrawEquipmentCheckApproval(doc.id,check,first.id),error=>error.sessionStatus===409);
    assert.throws(()=>s.withdrawEquipmentCheckApproval(doc.id,check,next.id,()=>{throw Error('세션 만료');}),/세션 만료/);s.withdrawEquipmentCheckApproval(doc.id,check,next.id);assert.deepEqual(s.equipmentCheckApprovals(doc.id,check).map(row=>row.status),['withdrawn','rejected']);assert.deepEqual(s.reviewerEquipmentChecks(reviewer.id),[]);
    const third=s.requestEquipmentCheckApproval(doc.id,check,{reviewerIds:[reviewer.id],expectedCycleId:next.id});assert.throws(()=>s.reviewEquipmentCheck(reviewer.id,check,'approve','',signature,next.id),error=>error.sessionStatus===409);assert.equal(s.reviewerEquipmentCheckSignature(reviewer.id,check,next.id,1),null);assert.equal(s.equipmentCheckApprovals(doc.id,check)[0].status,'pending');s.reviewEquipmentCheck(reviewer.id,check,'approve','',signature,third.id);assert.equal(s.equipmentCheckApprovals(doc.id,check)[0].status,'approved');
  }finally{s.close();}
});

test('장비 점검 결재 API는 현재 차례만 허용하고 계획서 사본을 유지한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-check-approval-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,send=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const admin=(await send('/api/login','POST',{password:'virtual-admin-password'})).headers.get('set-cookie').split(';')[0],site=await (await send('/api/sites','POST',{name:'가상 현장'},admin)).json();
    const make=async loginId=>(await (await send('/api/reviewers','POST',{siteId:site.id,loginId,name:loginId,password:'virtual-password-123'},admin)).json()),first=await make('check_api_first'),second=await make('check_api_second'),planReviewer=await make('check_api_plan');
    const equipment=await (await send('/api/equipment','POST',{siteId:site.id,kind:'가상 장비',model:'가상 모델',capacity:'',manufacturer:'',registration:''},admin)).json(),doc=await (await send('/api/documents','POST',{siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-10-30',details:{equipmentIds:[equipment.id]}},admin)).json(),path=`/api/documents/${doc.id}`;
    const check=(await (await send(path+'/equipment-checks','POST',{equipmentId:equipment.id,date:'2026-10-30',items:[{name:'가상 점검',result:'적정'}],inspector:'가상 점검자',signature},admin)).json()).id,approvals=`${path}/equipment-checks/${check}/approvals`,review=`/api/reviewer/equipment-checks/${check}`;
    assert.equal((await send(approvals,'POST',{reviewerIds:[first.id,second.id],expectedCycleId:null})).status,401);const request=await send(approvals,'POST',{reviewerIds:[first.id,second.id],expectedCycleId:null},admin);assert.equal(request.status,201);const approval=await request.json();
    const login=async loginId=>(await send('/api/reviewer/login','POST',{loginId,password:'virtual-password-123'})).headers.get('set-cookie').split(';')[0],one=await login(first.login_id),two=await login(second.login_id),plan=await login(planReviewer.login_id);
    assert.equal((await send(review)).status,401);assert.equal((await send(review,'GET',undefined,two)).status,404);assert.equal((await send(review,'GET',undefined,one)).status,200);assert.equal((await send(review+`/cycles/${approval.id+1}/inspector-signature`,'GET',undefined,one)).status,404);assert.deepEqual(Buffer.from(await (await send(review+`/cycles/${approval.id}/inspector-signature`,'GET',undefined,one)).arrayBuffer()),bytes);
    assert.equal((await send(review+'/decision','POST',{action:'approve',expectedCycleId:approval.id},one)).status,400);assert.equal((await send(review+'/decision','POST',{action:'approve',signature,expectedCycleId:approval.id},one)).status,200);assert.equal((await send(review,'GET',undefined,one)).status,404);assert.deepEqual(Buffer.from(await (await send(review+`/cycles/${approval.id}/signatures/1`,'GET',undefined,two)).arrayBuffer()),bytes);
    assert.equal((await send(path+'/approval-line','PUT',{reviewerIds:[planReviewer.id]},admin)).status,200);const info=await (await send(path+'/meeting-signature','GET',undefined,admin)).json();assert.equal((await send(path+'/meeting-signature','POST',{signature,expectedVersion:info.version},admin)).status,200);assert.equal((await send(path+'/transition','POST',{action:'submit'},admin)).status,200);
    const frozen=await (await send(`/api/reviewer/documents/${doc.id}`,'GET',undefined,plan)).json(),planCycle=frozen.document.approval_cycle_id,planSig=`/api/reviewer/documents/${doc.id}/equipment-checks/${check}/review-signatures/1`;assert.deepEqual(Buffer.from(await (await send(planSig,'GET',undefined,plan)).arrayBuffer()),bytes);
    assert.equal((await send(review+'/decision','POST',{action:'approve',signature,expectedCycleId:approval.id},two)).status,200);assert.equal((await send(`/api/reviewer/documents/${doc.id}/equipment-checks/${check}/review-signatures/2`,'GET',undefined,plan)).status,404);
    assert.equal((await send(`${path}/equipment-checks/${check}`,'DELETE',undefined,admin)).status,200);assert.deepEqual(Buffer.from(await (await send(planSig,'GET',undefined,plan)).arrayBuffer()),bytes);assert.equal((await send(`${path}/approval-cycles/${planCycle}/files/equipment-review-signature/${check}/1`,'GET',undefined,admin)).status,200);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
