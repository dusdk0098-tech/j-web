import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store} from '../store.js';
import {costImageType} from '../cost-image.js';

test('자료실 목록은 파일 앞부분과 전체 길이로 WebP를 판별한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),article=store.saveSiteArticle({siteId:site.id,category:'기타',title:'가상 문서',body:'가상 내용',visible:true}),webp=Buffer.alloc(1024*1024);webp.write('RIFF',0,'ascii');webp.writeUInt32LE(webp.length-8,4);webp.write('WEBPVP8X',8,'ascii');
    const id=store.addArticleFile(site.id,article.id,'가상.webp',webp),file=store.siteArticles(site.id)[0].files[0];assert.equal(file.id,id);assert.equal(file.size,webp.length);assert.equal(file.imageType,'image/webp');assert.equal('data' in file,false);assert.equal('header' in file,false);
    assert.equal(costImageType(webp.subarray(0,20),webp.length),'image/webp');assert.equal(costImageType(webp.subarray(0,20),webp.length+1),null);assert.equal(costImageType(webp.subarray(0,19),webp.length),null);
  }finally{store.close();}
});

test('첨부 저장과 삭제는 잠금 안에서 권한을 확인하고 실패 시 보존한다',()=>{
  const store=new Store(':memory:');try{
    const site=store.createSite({name:'가상 현장'}),article=store.saveSiteArticle({siteId:site.id,category:'기타',title:'가상 문서',body:'가상 내용',visible:true}),deny=()=>{throw Error('세션 만료');};
    assert.throws(()=>store.addArticleFile(site.id,article.id,'시험.txt',Buffer.from('시험'),deny),/세션 만료/);assert.equal(store.articleFiles(article.id).length,0);
    const id=store.addArticleFile(site.id,article.id,'시험.txt',Buffer.from('시험'));assert.throws(()=>store.deleteArticleFile(site.id,article.id,id,deny),/세션 만료/);assert.equal(store.articleFiles(article.id).length,1);
    store.deleteArticleFile(site.id,article.id,id);assert.equal(store.articleFiles(article.id).length,0);
  }finally{store.close();}
});

test('같은 게시글의 동시 첨부는 최대 20개를 넘지 않는다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-article-atomic-')),path=join(dir,'db.sqlite'),store=new Store(path);let children=[],locked=false;
  try{
    const site=store.createSite({name:'가상 현장'}),article=store.saveSiteArticle({siteId:site.id,category:'기타',title:'가상 문서',body:'가상 내용',visible:true});
    for(let i=0;i<19;i++)store.addArticleFile(site.id,article.id,`시험${i}.txt`,Buffer.from('시험'));
    const module=pathToFileURL(join(process.cwd(),'store.js')).href,script=`import {Store} from ${JSON.stringify(module)};const s=new Store(process.argv[1]);process.stdout.write('READY\\n');process.stdin.once('data',()=>{try{s.addArticleFile(Number(process.argv[2]),Number(process.argv[3]),'동시.txt',Buffer.from('test'));process.stdout.write('OK\\n');}catch(e){process.stdout.write(/20개/.test(e.message)?'FULL\\n':'ERROR\\n');}finally{s.close();}});`;
    children=Array.from({length:2},()=>spawn(process.execPath,['--input-type=module','-e',script,path,String(site.id),String(article.id)],{stdio:['pipe','pipe','pipe']}));
    await Promise.all(children.map(child=>once(child.stdout,'data')));const results=children.map(child=>{let text='';child.stdout.on('data',chunk=>{text+=chunk.toString();});return {done:once(child,'exit'),read:()=>text};});
    store.db.exec('BEGIN IMMEDIATE');locked=true;children.forEach(child=>child.stdin.end('go'));await new Promise(resolve=>setTimeout(resolve,100));store.db.exec('COMMIT');locked=false;
    await Promise.all(results.map(result=>result.done));assert.deepEqual(results.map(result=>result.read().trim()).sort(),['FULL','OK']);assert.equal(store.articleFiles(article.id).length,20);
  }finally{if(locked)store.db.exec('ROLLBACK');children.forEach(child=>{if(child.exitCode===null)child.kill();});store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
