import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';
import { issueAccessQr,issueInvitationQr } from '../qr-issue.js';

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
