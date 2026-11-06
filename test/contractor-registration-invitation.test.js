import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';
import {Store} from '../store.js';
import {issueWorkerInvitationQr} from '../qr-issue.js';

test('사전 등록한 출입자는 개인 QR 가입 후 같은 명부에 연결된다',async()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),company=store.createCompany({siteId:site.id,name:'가상 업체',trade:'가상'}),invite=store.createInvitation(site.id).token;
    const manager=store.join(invite,{siteId:site.id,name:'가상 관리자',category:'협력업체 관리자',company:company.name,companyId:company.id,occupation:'가상 직종',loginId:'virtual_manager',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}});
    store.setWorkerPermissions(site.id,manager.id,['attendance']);
    const registered=store.createContractorWorker(site.id,manager.id,{requestId:'00000000-0000-4000-8000-000000000001',name:'가상 출입자',occupation:'가상 직종',phone:'010-0000-0000',address:'',payKind:'',payAmount:''});
    const worker=store.workers(site.id).find(row=>row.id===registered.id);
    const qr=await issueWorkerInvitationQr(store,site.id,worker.id,worker.version,'https://example.test',link=>QRCode.toDataURL(link));
    const png=PNG.sync.read(Buffer.from(qr.image.split(',')[1],'base64'));
    assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,qr.link);
    const token=new URL(qr.link).searchParams.get('token');
    const joined=store.join(token,{name:worker.name,loginId:'virtual_member',password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2001-01-01',phone:'010-0000-0000'}});
    assert.equal(joined.id,worker.id);
    assert.equal(store.invitation(token),null);
    assert.equal(store.workers(site.id).filter(row=>row.name===worker.name).length,1);
    assert.equal(store.contractorWorkers(site.id,manager.id).find(row=>row.id===worker.id).name,worker.name);
  }finally{store.close();}
});
