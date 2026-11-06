import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';

test('지시 사진은 50MB까지 허용하고 초과 파일과 잘못된 형식을 거절한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),doc=store.createDocument({siteId:site.id,type:'instruction',title:'가상 지시',date:'2026-11-06'});store.transition(doc.id,'submit');store.transition(doc.id,'approve');store.addInstructionResult(doc.id,{date:'2026-11-06',actor:'가상',content:'가상 조치'});
    const max=50*1024*1024,bytes=Buffer.alloc(max);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);const id=store.addInstructionPhoto(doc.id,'before','가상.png',bytes);assert.equal(store.instructionPhotos(doc.id).find(x=>x.id===id).size,max);
    assert.throws(()=>store.addInstructionPhoto(doc.id,'after','큰파일.png',Buffer.alloc(max+1)),/50MB/);assert.throws(()=>store.addInstructionPhoto(doc.id,'after','잘못된파일.png',Buffer.from('가상')),/PNG 또는 JPEG/);
  }finally{store.close();}
});
