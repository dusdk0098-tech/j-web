import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../store.js';
import { CommonWork } from '../common-work.js';
import { mountCommonWork } from '../public/common-work-view.js';
import { showCommonWorkPreview } from '../public/common-work-print.js';

const input={date:'2026-11-01',category:'공정회의',process:'가상 공정',title:'가상 업무',content:'가상 내용',status:'published'};
const details={participants:'가상 참여팀',instructor:'가상 지시팀',location:'가상 구역'};
const keys=Object.keys(details);
const pick=row=>Object.fromEntries(keys.map(key=>[key,row[key]]));

test('공통업무 추가 항목은 선택 입력·수정 보존·명시적 삭제·길이 경계를 검증한다',()=>{
  const store=new Store(':memory:');try{
    const work=new CommonWork(store.db),site=store.createSite({name:'가상 현장'});
    const legacy=work.create(site.id,input);assert.deepEqual(pick(legacy),{participants:'',instructor:'',location:''});
    let row=work.create(site.id,{...input,...Object.fromEntries(keys.map(key=>[key,' '+details[key]+' ']))});assert.deepEqual(pick(row),details);
    row=work.update(site.id,row.id,{...input,title:'구형 요청 수정',version:row.version});assert.deepEqual(pick(row),details);
    for(const key of keys){
      assert.deepEqual(work.list(site.id,{q:details[key]}).map(item=>item.id),[row.id]);
      const before=work.get(site.id,row.id);
      for(const invalid of ['가'.repeat(201),null,1,[],{}]){
        assert.throws(()=>work.create(site.id,{...input,[key]:invalid}),/200자/);
        assert.throws(()=>work.update(site.id,row.id,{...input,[key]:invalid,version:row.version}),/200자/);
        assert.deepEqual(work.get(site.id,row.id),before);
      }
      row=work.update(site.id,row.id,{...input,[key]:'가'.repeat(200),version:row.version});assert.equal(row[key].length,200);
      row=work.update(site.id,row.id,{...input,[key]:'  ',version:row.version});assert.equal(row[key],'');
    }
    assert.equal(work.list(site.id).length,2);
    const version=row.version;row=work.update(site.id,row.id,{...input,...details,version});
    assert.throws(()=>work.update(site.id,row.id,{...input,location:'오래된 가상 위치',version}),error=>error.sessionStatus===409);
    assert.deepEqual(pick(work.get(site.id,row.id)),details);
    assert.throws(()=>work.update(site.id,row.id,{...input,location:'거절된 가상 위치',version:row.version},()=>{throw Error('세션 만료');}),/세션 만료/);
    assert.deepEqual(pick(work.get(site.id,row.id)),details);
  }finally{store.close();}
});

test('이전 공통업무 DB 마이그레이션 및 실제 백업·복원 CLI는 모든 기록을 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-work-details-')),source=join(dir,'source'),restored=join(dir,'restored');mkdirSync(source);mkdirSync(restored);let store;
  try{
    store=new Store(join(source,'jweb.sqlite'));const site=store.createSite({name:'가상 현장'});
    store.db.exec("CREATE TABLE common_work (id INTEGER PRIMARY KEY,site_id INTEGER NOT NULL REFERENCES sites(id),author_id INTEGER REFERENCES reviewers(id),date TEXT NOT NULL,category TEXT NOT NULL,process TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','published')),version TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    store.db.prepare("INSERT INTO common_work(site_id,date,category,process,title,content,status,version) VALUES(?,?,?,?,?,?,?,'legacy')").run(site.id,input.date,input.category,input.process,input.title,input.content,input.status);
    const before={...store.db.prepare('SELECT * FROM common_work').get()};let work=new CommonWork(store.db),legacy=work.get(site.id,1);for(const [key,value] of Object.entries(before))assert.equal(legacy[key],value);assert.deepEqual(pick(legacy),{participants:'',instructor:'',location:''});
    const comment=work.addComment(site.id,1,{content:'가상 의견',version:legacy.version});legacy=work.get(site.id,1);const attachment=work.addFile(site.id,1,comment.id,legacy.version,'가상.txt',Buffer.from('가상 첨부'));legacy=work.get(site.id,1);
    const row=work.update(site.id,1,{...input,...details,version:legacy.version});new CommonWork(store.db);assert.deepEqual(work.get(site.id,1),row);store.close();store=null;
    const backup=join(dir,'backup.sqlite'),run=args=>{const result=spawnSync(process.execPath,[resolve('db-copy.js'),...args],{encoding:'utf8',env:{...process.env,JWEB_DATA_DIR:source}});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/사본을 만들었습니다/);};
    run(['backup',backup]);run(['restore',backup,restored]);store=new Store(join(restored,'jweb.sqlite'));work=new CommonWork(store.db);
    assert.deepEqual(work.get(site.id,1),row);assert.equal(work.comments(site.id,1)[0].content,'가상 의견');assert.equal(Buffer.from(work.file(site.id,1,attachment.id).data).toString(),'가상 첨부');assert.equal(work.preview(site.id,[{id:1,version:row.version}]).items[0].location,details.location);assert.equal(Object.values(store.db.prepare('PRAGMA integrity_check').get())[0],'ok');assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{store?.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});

test('공통업무 DOM 대역은 세 입력·수정 복원·전송·상세 및 인쇄 HTML 이스케이프를 확인한다',async()=>{
  const row={id:1,version:'virtual-version',...input,...Object.fromEntries(keys.map(key=>[key,'<'+details[key]+'>'])),author_id:null,files:[],comments:[],rich_content:null};
  let controls,html,posted,prints=0;const elements=Object.fromEntries(['date','category','process','title','status',...keys].map(key=>[key,{value:'',focus(){},querySelector(){return {};}}]));const edit={};
  const doc={body:{append(){}},querySelector(){return null;},defaultView:{print(){prints++;}},createElement(){return {setAttribute(){},querySelector(){return {};},addEventListener(){},showModal(){}};}};
  const form={elements,reset(){for(const element of Object.values(elements))element.value='';},querySelector(){return {};}};
  const target={isConnected:true,ownerDocument:doc,set innerHTML(value){html=value;controls=Object.fromEntries(['work-status','work-cancel','rich-toolbar','work-search','work-select-all','work-preview','work-print'].map(name=>['[data-'+name+']',{}]));controls['[data-work-form]']=form;controls['[data-rich-editor]']={ownerDocument:doc,childNodes:[],replaceChildren(){}};},querySelector(selector){if(selector==='[data-work-id="1"]')return {querySelector:selector=>selector==='[data-work-edit]'?edit:null,querySelectorAll:()=>[]};return controls[selector];},querySelectorAll(){return [];}};
  const api=async(path,options)=>{if(options){posted={path,body:JSON.parse(options.body)};return row;}return path.includes('/authors')?[]:[row];};
  await mountCommonWork({target,base:'/api/common-work',siteId:1,api});
  for(const key of keys){assert.match(html,new RegExp('name="'+key+'" maxlength="200"'));assert.ok(html.includes('&lt;'+details[key]+'&gt;'));}
  assert.doesNotMatch(html,/<가상 참여팀>/);edit.onclick();for(const key of keys)assert.equal(elements[key].value,row[key]);
  const original=globalThis.FormData;globalThis.FormData=class{constructor(value){assert.equal(value,form);return Object.entries(elements).map(([key,element])=>[key,element.value]);}};
  try{elements.location.value='수정 가상 위치';form.onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));assert.equal(posted.path,'/api/common-work/1?siteId=1');assert.deepEqual(pick(posted.body),{...pick(row),location:'수정 가상 위치'});assert.equal(posted.body.version,row.version);controls['[data-work-cancel]'].onclick();for(const key of keys)assert.equal(elements[key].value,'');form.onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));assert.equal(posted.path,'/api/common-work?siteId=1');assert.deepEqual(pick(posted.body),{participants:'',instructor:'',location:''});}finally{globalThis.FormData=original;}
  const dialog=showCommonWorkPreview(doc,{siteName:'가상 현장',items:[row]});for(const key of keys)assert.ok(dialog.innerHTML.includes('&lt;'+details[key]+'&gt;'));assert.doesNotMatch(dialog.innerHTML,/<가상/);assert.equal(prints,0);
});
