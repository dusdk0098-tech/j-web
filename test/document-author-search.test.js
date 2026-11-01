import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Store} from '../store.js';

test('문서 목록은 연결된 가상 작성자의 현재 이름만 제공한다',()=>{
  const s=new Store(':memory:');try{
    const a=s.createSite({name:'가상 A'}),b=s.createSite({name:'가상 B'}),make=(site,name,loginId)=>s.join(s.createInvitation(site.id).token,{name,category:'직영',company:'가상 업체',occupation:'목공',loginId,password:'virtual-password-123',acknowledged:true,profile:{birthDate:'2000-01-01',phone:'010-0000-0000'}}),worker=make(a,'가상 작성자','author_one'),foreign=make(b,'다른 작성자','author_two'),input={type:'tbm',title:'가상 문서',date:'2026-11-01',details:{weather:'맑음'}};
    s.setWorkerPermissions(a.id,worker.id,['training']);s.setWorkerPermissions(b.id,foreign.id,['training']);const authored=s.createWorkerDocument(a.id,worker.id,input),unknown=s.createDocument({...input,siteId:a.id}),other=s.createWorkerDocument(b.id,foreign.id,input);
    const rows=s.documents(a.id,'tbm');assert.equal(rows.find(row=>row.id===authored.id).author_name,'가상 작성자');assert.equal(rows.find(row=>row.id===unknown.id).author_name,null);assert.equal(rows.some(row=>row.id===other.id),false);
    s.db.prepare('UPDATE workers SET name=? WHERE id=?').run('변경된 가상 이름',worker.id);assert.equal(s.documents(a.id,'tbm').find(row=>row.id===authored.id).author_name,'변경된 가상 이름');
  }finally{s.close();}
});

test('작성자 검색은 문서와 가상 신고를 각각 해당 이름으로 제한한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),documentLine=source.split(/\r?\n/).find(line=>line.includes("const author=state.page==='documents'")),reportLine=source.split(/\r?\n/).find(line=>line.includes('if(author)reports=reports.filter'));assert.ok(documentLine&&reportLine);
  const context={state:{page:'documents',documentAuthor:'작성자'},docs:[{id:1,author_name:'가상 작성자'},{id:2,author_name:null},{id:3,author_name:'다른 사람'}],reports:[{id:4,reporter:'가상 작성자'},{id:5,reporter:'다른 사람'}]};
  const result=runInNewContext(`${documentLine}\n${reportLine}\n({filtered,reports})`,context);assert.deepEqual(Array.from(result.filtered,row=>row.id),[1]);assert.deepEqual(Array.from(result.reports,row=>row.id),[4]);
});
