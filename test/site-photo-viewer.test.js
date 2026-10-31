import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import { Store } from '../store.js';
import { showSitePhotoViewer } from '../public/site-photo-viewer.js';

function fakeDocument(){
  const state={last:null},doc={body:{append(dialog){state.last=dialog;}},querySelector(){return state.last?.open?state.last:null;},createElement(){const controls={};for(const key of ['image','status','previous','next','download','close','name','date','description'])controls[`[data-photo-view-${key}]`]={};return {controls,open:false,removed:false,setAttribute(){},querySelector(selector){return controls[selector];},addEventListener(type,callback){if(type==='close')this.onclose=callback;},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},remove(){this.removed=true;}};}};return {doc,state};
}

test('현장사진 보기는 검색된 사진을 이동하고 안전한 내려받기 주소를 제공한다',()=>{
  const {doc,state}=fakeDocument(),photos=[{id:1,name:'<가상 사진>.png',date:'2026-10-30',description:'<설명>',version:'a'.repeat(64)},{id:2,name:'다음.png',date:'2026-10-31',description:'',version:'b'.repeat(64)}];let active=true;
  const dialog=showSitePhotoViewer(doc,{photos,index:0,siteId:3,active:()=>active}),c=dialog.controls;assert.equal(dialog.open,true);assert.equal(c['[data-photo-view-name]'].textContent,'<가상 사진>.png');assert.equal(c['[data-photo-view-description]'].textContent,'<설명>');assert.equal(c['[data-photo-view-previous]'].disabled,true);assert.match(c['[data-photo-view-download]'].href,/siteId=3&version=a{64}&download=1$/);
  assert.throws(()=>showSitePhotoViewer(doc,{photos,index:0,siteId:3}),/먼저 닫아/);c['[data-photo-view-next]'].onclick();assert.equal(c['[data-photo-view-name]'].textContent,'다음.png');assert.equal(c['[data-photo-view-next]'].disabled,true);assert.equal(c['[data-photo-view-description]'].textContent,'설명 없음');assert.match(c['[data-photo-view-image]'].src,/\/2\?siteId=3&version=b{64}$/);c['[data-photo-view-image]'].onerror();assert.match(c['[data-photo-view-status]'].textContent,/불러오지 못/);active=false;c['[data-photo-view-previous]'].onclick();assert.equal(state.last.removed,true);
  assert.throws(()=>showSitePhotoViewer(doc,{photos:[{...photos[0],version:'잘못된 값'}],index:0,siteId:3}),/다시 조회/);
});

test('현장사진 쓰기는 잠금 후 세션 확인 실패 시 저장하지 않는다',()=>{
  const store=new Store(':memory:');try{const site=store.createSite({name:'가상 현장'}),png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),fail=()=>{throw Error('시험 세션 만료');};assert.throws(()=>store.addSitePhoto(site.id,'가상.png',bytes,fail),/세션 만료/);assert.deepEqual(store.sitePhotos(site.id),[]);const id=store.addSitePhoto(site.id,'가상.png',bytes),before=store.sitePhoto(site.id,id),version=store.sitePhotoVersion(before);assert.throws(()=>store.updateSitePhoto(site.id,id,{date:'2026-10-30',description:'변경',version},fail),/세션 만료/);assert.equal(store.sitePhotoVersion(store.sitePhoto(site.id,id)),version);assert.throws(()=>store.deleteSitePhoto(site.id,id,version,fail),/세션 만료/);assert.ok(store.sitePhoto(site.id,id));}finally{store.close();}
});

test('현장사진 내려받기와 변경은 현장·계정·사진 버전을 확인한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-site-photo-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'test-password-12345'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const base=`http://127.0.0.1:${port}`,call=(path,method='GET',data,cookie)=>fetch(base+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})}),admin=(await call('/api/login','POST',{password:'test-password-12345'})).headers.get('set-cookie').split(';')[0],site=await (await call('/api/sites','POST',{name:'가상 현장'},admin)).json(),other=await (await call('/api/sites','POST',{name:'다른 현장'},admin)).json();
    const png=new PNG({width:1,height:1});png.data[3]=255;const bytes=PNG.sync.write(png),path=`/api/site-photos?siteId=${site.id}`,upload=async()=>{const r=await fetch(base+path,{method:'POST',headers:{cookie:admin,'x-file-name':encodeURIComponent('가상(사진).png')},body:bytes});assert.equal(r.status,201);return (await r.json()).id;},id=await upload(),item=`/api/site-photos/${id}?siteId=${site.id}`,list=await (await call(path,'GET',null,admin)).json(),version=list[0].version;assert.match(version,/^[a-f0-9]{64}$/);
    assert.equal((await call(path)).status,401);assert.equal((await call(`${item}&version=${version}`)).status,401);assert.equal((await call(`/api/site-photos/${id}?siteId=${other.id}&version=${version}`,'GET',null,admin)).status,404);const preview=await call(`${item}&version=${version}`,'GET',null,admin);assert.equal(preview.headers.get('content-type'),'image/png');assert.equal(preview.headers.get('content-disposition'),null);assert.deepEqual(Buffer.from(await preview.arrayBuffer()),bytes);
    const download=await call(`${item}&version=${version}&download=1`,'GET',null,admin);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment; filename="photo"; filename\*=UTF-8''/);assert.match(download.headers.get('content-disposition'),/%28사진%29|%28%EC%82%AC%EC%A7%84%29/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);assert.equal((await call('/site-photo-viewer.js')).status,200);
    assert.equal((await call(item,'PUT',{date:'2026-10-30',description:'가상 설명',version},admin)).status,200);assert.equal((await call(`${item}&version=${version}`,'GET',null,admin)).status,409);assert.equal((await call(item,'PUT',{date:'2026-10-31',description:'오래된 수정',version},admin)).status,409);assert.equal((await call(`${item}&version=${version}`,'DELETE',null,admin)).status,409);const changed=(await (await call(path,'GET',null,admin)).json())[0];assert.equal(changed.description,'가상 설명');assert.notEqual(changed.version,version);
    assert.equal((await call(`${item}&version=${changed.version}`,'DELETE',null,admin)).status,200);assert.equal(await upload(),id);assert.equal((await call(`${item}&version=${changed.version}`,'GET',null,admin)).status,409);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
