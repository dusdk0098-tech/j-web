import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.js';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';

test('위험신고 처리 변경은 저장 잠금 뒤 권한을 확인하고 거절 시 기존 값을 보존한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'}),id=store.createHazardReport(site.id,{title:'가상 신고',body:'가상 내용',reporter:'가상 신고자'}),change={status:'resolved',response:'가상 조치'};
    assert.throws(()=>store.updateHazardReport(site.id,id,change,()=>{throw Error('가상 권한 만료');}),/권한 만료/);
    assert.equal(store.hazardReports(site.id)[0].status,'received');assert.equal(store.hazardReports(site.id)[0].response,'');
    assert.equal(store.hazardReports(site.id)[0].history.length,0);
    assert.throws(()=>store.updateHazardReport(other.id,id,change),/현장/);
    store.updateHazardReport(site.id,id,change);assert.equal(store.hazardReports(site.id)[0].response,'가상 조치');
    const history=store.hazardReports(site.id)[0].history;assert.equal(history.length,1);assert.equal(history[0].previous_status,'received');assert.equal(history[0].previous_response,'');assert.equal(history[0].status,'resolved');assert.equal(history[0].response,'가상 조치');
    store.updateHazardReport(site.id,id,change);assert.equal(store.hazardReports(site.id)[0].history.length,1);
    assert.throws(()=>store.updateHazardReport(site.id,id,{status:'reviewing',response:'이전 입력',expectedHistoryId:0}),error=>error.sessionStatus===409);assert.equal(store.hazardReports(site.id)[0].response,'가상 조치');
    assert.throws(()=>store.updateHazardReport(site.id,id,{...change,expectedHistoryId:-1}),/이력/);
    assert.throws(()=>store.updateHazardReport(site.id,id,{status:'reviewing',response:'가상 변경'},()=>{throw Error('권한 거절');}),/권한 거절/);assert.equal(store.hazardReports(site.id)[0].history.length,1);
    assert.deepEqual(store.hazardReports(other.id),[]);
  }finally{store.close();}
});

test('처리 이력은 데이터베이스를 다시 열어도 보존된다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-hazard-history-')),path=join(dir,'data.sqlite');let store=new Store(path);
  try{const site=store.createSite({name:'가상'}),id=store.createHazardReport(site.id,{title:'가상',body:'가상',reporter:'가상'});store.updateHazardReport(site.id,id,{status:'reviewing',response:'가상 검토'});store.close();store=new Store(path);assert.equal(store.hazardReports(site.id)[0].history[0].response,'가상 검토');}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('관리자 화면은 처리 이력과 이력이 없는 기록을 텍스트로 표시한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split(/\r?\n/).find(line=>line.includes("heading.textContent='시험 처리 이력'"));assert.ok(source);
  const node=()=>({children:[],textContent:'',append(...children){this.children.push(...children);}}),articles=[node(),node()],reports=[{history:[{created_at:'가상 날짜',previous_status:'received',status:'resolved',response:'<가상 조치>'}]},{history:[]}];
  runInNewContext(source,{content:{querySelectorAll:()=>articles},reports,document:{createElement:node},hazardStatuses:{received:'접수',resolved:'조치 완료'}});
  assert.match(articles[0].children[0].children[1].textContent,/접수 → 조치 완료.*<가상 조치>/);assert.match(articles[1].children[0].children[1].textContent,/이전 변경 내용은 확인할 수 없습니다/);
});

test('관리자 처리 화면은 조회한 마지막 이력 번호를 변경 요청에 보낸다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split(/\r?\n/).find(line=>line.includes('const hazardStatuses='));assert.ok(source);
  const article={children:[],heading:{},querySelector:()=>article.heading,append(node){this.children.push(node);}},report={id:9,title:'가상',status:'reviewing',response:'기존 조치',history:[{id:5},{id:8}]};let handler,request;
  runInNewContext(source,{content:{querySelectorAll:()=>[article]},reports:[report],document:{createElement:()=>({})},esc:String,siteId:3,showDialog:(_title,_html,submit)=>{handler=submit;},api:(path,options)=>{request={path,options};}});
  article.children.find(node=>node.type==='button').onclick();handler({status:'resolved',response:'새 조치'});assert.equal(request.path,'/api/sites/3/hazard-reports/9');assert.equal(JSON.parse(request.options.body).expectedHistoryId,8);
});
