import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.js';

test('지시 사진은 50MB까지 허용하고 초과 파일과 잘못된 형식을 거절한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),doc=store.createDocument({siteId:site.id,type:'instruction',title:'가상 지시',date:'2026-11-06'});store.transition(doc.id,'submit');store.transition(doc.id,'approve');store.addInstructionResult(doc.id,{date:'2026-11-06',actor:'가상',content:'가상 조치'});
    const max=50*1024*1024,bytes=Buffer.alloc(max);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);const id=store.addInstructionPhoto(doc.id,'before','가상.png',bytes);assert.equal(store.instructionPhotos(doc.id).find(x=>x.id===id).size,max);
    const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64'),gifId=store.addInstructionPhoto(doc.id,'after','가상.gif',gif);assert.deepEqual(Buffer.from(store.instructionPhoto(doc.id,gifId).data),gif);const invalid=Buffer.from(gif);invalid[invalid.length-1]=0;assert.throws(()=>store.addInstructionPhoto(doc.id,'after','잘못된.gif',invalid),/GIF/);const webp=Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64');assert.throws(()=>store.addInstructionPhoto(doc.id,'after','가상.webp',webp),/GIF/);
    assert.throws(()=>store.addInstructionPhoto(doc.id,'after','큰파일.png',Buffer.alloc(max+1)),/50MB/);assert.throws(()=>store.addInstructionPhoto(doc.id,'after','잘못된파일.png',Buffer.from('가상')),/PNG, JPEG 또는 GIF/);
  }finally{store.close();}
});

test('사진은 조치 전과 후 각각 10개까지 저장하고 이전 초과 기록을 보존한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),doc=store.createDocument({siteId:site.id,type:'instruction',title:'가상 지시',date:'2026-11-06'});store.transition(doc.id,'submit');store.transition(doc.id,'approve');store.addInstructionResult(doc.id,{date:'2026-11-06',actor:'가상',content:'가상 조치'});const bytes=Buffer.from('89504e470d0a1a0a','hex'),add=phase=>store.addAuthorizedInstructionPhoto(doc.id,phase,'가상.png',bytes);
    for(let i=0;i<10;i++)add('before');assert.throws(()=>add('before'),/각각 10개/);for(let i=0;i<10;i++)add('after');assert.throws(()=>add('after'),/각각 10개/);assert.equal(store.instructionPhotos(doc.id).length,20);
    const first=store.instructionPhotos(doc.id).find(photo=>photo.phase==='before');store.deleteInstructionPhoto(doc.id,first.id);add('before');assert.equal(store.instructionPhotos(doc.id).length,20);
    store.db.prepare('DELETE FROM instruction_photos WHERE document_id=? AND phase=?').run(doc.id,'after');store.db.prepare('INSERT INTO instruction_photos(document_id,phase,name,data) VALUES(?,?,?,?)').run(doc.id,'before','이전 기록.png',bytes);assert.equal(store.instructionPhotos(doc.id).filter(photo=>photo.phase==='before').length,11);assert.throws(()=>add('before'),/각각 10개/);assert.equal(store.instructionPhotos(doc.id).length,11);add('after');assert.equal(store.instructionPhotos(doc.id).length,12);
  }finally{store.close();}
});
