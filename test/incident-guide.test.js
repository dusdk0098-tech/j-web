import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.js';

test('사고 정도별 가상 보고서는 각각 저장하고 재시작 후 보존한다',()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-incident-guide-')),path=join(dir,'data.sqlite');let s;try{
    s=new Store(path);const site=s.createSite({name:'가상 현장'}),other=s.createSite({name:'다른 현장'}),created=['경상','중상','사망'].map(severity=>s.createDocument({siteId:site.id,type:'incident',title:`가상 ${severity} 보고`,date:'2026-10-30',details:{severity}}));
    assert.deepEqual(created.map(doc=>JSON.parse(doc.details).severity),['경상','중상','사망']);assert.throws(()=>s.createDocument({siteId:site.id,type:'incident',title:'잘못된 유형',date:'2026-10-30',details:{severity:'임의 유형'}}),/사고유형/);assert.equal(s.documents(other.id,'incident').length,0);s.close();s=new Store(path);assert.deepEqual(s.documents(site.id,'incident').map(doc=>JSON.parse(doc.details).severity).sort(),['경상','사망','중상']);
  }finally{if(s)s.close();rmSync(dir,{recursive:true,force:true});}
});

test('사고 대응 안내에 공식 자료 링크와 사고 정도별 가상 문서 이동이 있다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("  if(state.page==='incident-guide'){"),end=source.indexOf("  if(state.page==='hazards'){",start);assert.ok(start>=0&&end>start);
  let guidance='',opened;const buttons=['경상','중상','사망'].map(value=>({dataset:{incidentReport:value}})),list={},content={innerHTML:'',querySelector:()=>({insertAdjacentHTML:(_where,html)=>{guidance=html;}}),querySelectorAll:()=>buttons},context={state:{page:'incident-guide'},content,$:()=>list,editDocument:async(_doc,details,type)=>{opened={severity:details.severity,type};},showError(){},render:async()=>{}};
  await runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
  assert.match(guidance,/www\.kosha\.or\.kr/);assert.match(guidance,/href="tel:119"/);assert.match(guidance,/무리하게 진입하지/);assert.match(guidance,/1350\.moel\.go\.kr/);assert.match(guidance,/신고하거나 보고하지 않습니다/);buttons[1].onclick();await Promise.resolve();assert.equal(opened.severity,'중상');assert.equal(opened.type,'incident');list.onclick();assert.equal(context.state.type,'incident');assert.equal(context.state.page,'documents');
});
