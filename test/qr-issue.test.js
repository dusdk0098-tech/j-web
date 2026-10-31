import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { issueAccessQr,issueInvitationQr } from '../qr-issue.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('QR 생성 중 현장 주소 교체나 초대 중지가 발생하면 무효 QR을 반환하지 않는다',async()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),origin='https://example.test';let release;
    const render=()=>new Promise(resolve=>{release=resolve;}),pendingAccess=issueAccessQr(store,site.id,origin,false,render);
    store.rotateSiteAccess(site.id);release('가상 이미지');assert.equal(await pendingAccess,null);
    const pendingInvite=issueInvitationQr(store,site.id,origin,render);store.revokeInvitations(site.id);release('가상 이미지');assert.equal(await pendingInvite,null);
    const pendingRegistration=issueAccessQr(store,site.id,origin,false,render),expiresAt=store.openSiteRegistration(site.id);release('가상 이미지');
    const valid=await pendingRegistration;assert.equal(valid.image,'가상 이미지');assert.equal(valid.registrationExpiresAt,expiresAt);assert.equal(store.siteFromAccess(new URL(valid.link).searchParams.get('site')).id,site.id);
    const invitation=await issueInvitationQr(store,site.id,origin,async()=> '가상 이미지');assert.equal(store.invitation(new URL(invitation.link).searchParams.get('token')).id,site.id);
  }finally{store.close();}
});

test('현장 QR 생성이나 권한 검사가 실패하면 기존 주소를 유지한다',async()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),old=store.ensureSiteAccess(site.id),failure=()=>{throw new Error('가상 실패');};
    await assert.rejects(issueAccessQr(store,site.id,'https://example.test',true,async()=>failure()),/가상 실패/);assert.equal(store.siteAccessKey(site.id),old);
    await assert.rejects(issueAccessQr(store,site.id,'https://example.test',true,async()=> '이미지',failure),/가상 실패/);assert.equal(store.siteAccessKey(site.id),old);
  }finally{store.close();}
});

test('새 현장의 접속 QR은 이미지와 권한 확인이 성공한 뒤에만 주소를 만든다',async()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'새 가상 현장'}),failure=()=>{throw Error('가상 실패');};
    let release;const pending=issueAccessQr(store,site.id,'https://example.test',false,()=>new Promise(resolve=>{release=resolve;}));
    assert.equal(store.siteAccessKey(site.id),null);release('이미지');const first=await pending;assert.equal(store.siteAccessKey(site.id),new URL(first.link).searchParams.get('site'));
    const empty=store.createSite({name:'다른 가상 현장'});
    await assert.rejects(issueAccessQr(store,empty.id,'https://example.test',false,async()=>failure()),/가상 실패/);assert.equal(store.siteAccessKey(empty.id),null);
    await assert.rejects(issueAccessQr(store,empty.id,'https://example.test',true,async()=> '이미지',failure),/가상 실패/);assert.equal(store.siteAccessKey(empty.id),null);
    const rotated=await issueAccessQr(store,empty.id,'https://example.test',true,async()=> '이미지');assert.equal(store.siteAccessKey(empty.id),new URL(rotated.link).searchParams.get('site'));
    let rendered=false;await assert.rejects(issueAccessQr(store,99999,'https://example.test',false,async()=>{rendered=true;return '이미지';}),/현장/);assert.equal(rendered,false);
  }finally{store.close();}
});

test('새 현장의 가입 QR이 취소되거나 실패하면 접속 주소도 생기지 않는다',async()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'새 가상 현장'});let token,release;
    const pending=issueInvitationQr(store,site.id,'https://example.test',link=>{token=new URL(link).searchParams.get('token');return new Promise(resolve=>{release=resolve;});});
    assert.equal(store.siteAccessKey(site.id),null);assert.equal(store.invitation(token),null);store.revokeInvitations(site.id);release('이미지');
    assert.equal(await pending,null);assert.equal(store.siteAccessKey(site.id),null);assert.equal(store.invitation(token),null);
    await assert.rejects(issueInvitationQr(store,site.id,'https://example.test',async()=>{throw Error('이미지 실패');}),/이미지 실패/);assert.equal(store.siteAccessKey(site.id),null);
    await assert.rejects(issueInvitationQr(store,site.id,'https://example.test',async()=> '이미지',()=>{throw Error('권한 만료');}),/권한 만료/);assert.equal(store.siteAccessKey(site.id),null);
    const issued=await issueInvitationQr(store,site.id,'https://example.test',async()=> '이미지'),access=store.siteAccessKey(site.id);
    assert.ok(access);assert.equal(store.siteFromAccess(access).id,site.id);assert.equal(store.invitation(new URL(issued.link).searchParams.get('token')).id,site.id);
  }finally{store.close();}
});

test('새 접속 QR을 준비하는 동안 가입 QR이 먼저 완성되면 기존 주소를 덮어쓰지 않는다',async()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'새 가상 현장'});let release;
    const pending=issueAccessQr(store,site.id,'https://example.test',false,()=>new Promise(resolve=>{release=resolve;}));
    assert.equal(store.siteAccessKey(site.id),null);const invitation=await issueInvitationQr(store,site.id,'https://example.test',async()=> '이미지'),winner=store.siteAccessKey(site.id);
    assert.ok(store.invitation(new URL(invitation.link).searchParams.get('token')));release('이미지');assert.equal(await pending,null);assert.equal(store.siteAccessKey(site.id),winner);
  }finally{store.close();}
});

test('가입 QR 활성화 중 접속 주소 저장이 실패하면 초대도 활성화되지 않는다',async()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'새 가상 현장'});let token;
    store.db.exec("CREATE TRIGGER fail_access BEFORE INSERT ON site_access BEGIN SELECT RAISE(ABORT,'가상 저장 실패'); END");
    await assert.rejects(issueInvitationQr(store,site.id,'https://example.test',async link=>{token=new URL(link).searchParams.get('token');return '이미지';}),/가상 저장 실패/);
    assert.equal(store.siteAccessKey(site.id),null);assert.equal(store.invitation(token),null);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE site_id=?').get(site.id).n,0);
    store.db.exec('DROP TRIGGER fail_access');const issued=await issueInvitationQr(store,site.id,'https://example.test',async()=> '이미지');assert.ok(store.invitation(new URL(issued.link).searchParams.get('token')));assert.ok(store.siteAccessKey(site.id));
  }finally{store.close();}
});

test('가입 QR 준비 중에는 초대가 유효하지 않고 실패 후에도 사용할 수 없다',async()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'});let token,release;
    const pending=issueInvitationQr(store,site.id,'https://example.test',link=>{token=new URL(link).searchParams.get('token');return new Promise(resolve=>{release=resolve;});});
    assert.equal(store.invitation(token),null);release('가상 이미지');const issued=await pending;assert.equal(store.invitation(token).id,site.id);assert.equal(new URL(issued.link).searchParams.get('token'),token);
    let failedToken;await assert.rejects(issueInvitationQr(store,site.id,'https://example.test',async link=>{failedToken=new URL(link).searchParams.get('token');throw Error('가상 오류');}),/가상 오류/);assert.equal(store.invitation(failedToken),null);assert.equal(store.invitation(token).id,site.id);
    let unauthorized;await assert.rejects(issueInvitationQr(store,site.id,'https://example.test',async link=>{unauthorized=new URL(link).searchParams.get('token');return '이미지';},()=>{throw Error('권한 만료');}),/권한 만료/);assert.equal(store.invitation(unauthorized),null);
  }finally{store.close();}
});

test('동시 주소 교체에서 먼저 완료된 주소를 보존한다',async()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),old=store.ensureSiteAccess(site.id);let release;
    const pending=issueAccessQr(store,site.id,'https://example.test',true,()=>new Promise(resolve=>{release=resolve;}));
    assert.equal(store.siteAccessKey(site.id),old);const winner=store.rotateSiteAccess(site.id);release('이미지');
    assert.equal(await pending,null);assert.equal(store.siteAccessKey(site.id),winner);
  }finally{store.close();}
});

test('기존 데이터베이스의 초대는 업데이트 후에도 유지된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-qr-')),path=join(dir,'test.sqlite');let store;
  try{
    store=new Store(path);const site=store.createSite({name:'가상 현장'}),invite=store.createInvitation(site.id);store.close();store=null;
    const legacy=new DatabaseSync(path);legacy.exec('ALTER TABLE invitations DROP COLUMN pending');legacy.close();
    store=new Store(path);assert.equal(store.invitation(invite.token).id,site.id);assert.equal(store.revokeInvitations(site.id),1);
  }finally{if(store)store.close();rmSync(dir,{recursive:true,force:true});}
});
