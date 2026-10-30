import test from 'node:test';
import assert from 'node:assert/strict';
import { workerFieldRequirements } from '../public/worker-fields.js';
import { Store } from '../store.js';

test('출입자 구분에 따라 소속과 직종의 필수 여부를 구분한다',()=>{
  assert.deepEqual(workerFieldRequirements('직영'),{company:false,occupation:true});
  assert.deepEqual(workerFieldRequirements('근로를 제공하지 않는 사람'),{company:false,occupation:false});
  for(const category of ['협력업체 근로자','협력업체 관리자','기타 출입자','별도 구분'])assert.deepEqual(workerFieldRequirements(category),{company:true,occupation:true});
});

test('가입과 관리자 수정에서 선택 항목을 보존하고 필수 항목을 검사한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),invite=store.createInvitation(site.id),input={name:'가상 출입자',category:'직영',company:'',occupation:'가상 직종',loginId:'worker_direct',password:'virtual-password-123',acknowledged:true};
    const direct=store.join(invite.token,input);assert.equal(direct.company,'');assert.equal(direct.occupation,'가상 직종');
    const visitor=store.join(invite.token,{...input,category:'근로를 제공하지 않는 사람',occupation:'',loginId:'worker_visitor'});assert.equal(visitor.company,'');assert.equal(visitor.occupation,'');
    assert.throws(()=>store.join(invite.token,{...input,category:'협력업체 근로자',loginId:'worker_missing'}),/소속/);
    assert.throws(()=>store.join(invite.token,{...input,occupation:'',loginId:'worker_missing'}),/직종/);
    assert.throws(()=>store.updateWorker(visitor.id,{siteId:site.id,name:'가상 출입자',category:'협력업체 관리자',company:'',occupation:'가상 직종'}),/소속/);
    assert.equal(store.updateWorker(visitor.id,{siteId:site.id,name:'가상 출입자',category:visitor.category,company:'',occupation:''}).occupation,'');
  }finally{store.close();}
});
