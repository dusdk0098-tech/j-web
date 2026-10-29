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
