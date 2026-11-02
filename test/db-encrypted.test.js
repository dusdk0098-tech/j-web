import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createHash, scryptSync } from 'node:crypto';
import { Store } from '../store.js';
import { WorkerSessions } from '../auth.js';

const password='virtual-backup-password-123';
const cleanup=dir=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});};
const env=(dataDir,temp,pass=password)=>({...process.env,JWEB_DATA_DIR:dataDir,JWEB_BACKUP_PASSWORD:pass,TEMP:temp,TMP:temp,TMPDIR:temp});
const run=(dataDir,temp,pass,...args)=>spawnSync(process.execPath,['db-copy.js',...args],{cwd:process.cwd(),env:env(dataDir,temp,pass),encoding:'utf8',timeout:30000});
const npmCli=process.env.npm_execpath||join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
const documented=(dataDir,temp,action,...args)=>existsSync(npmCli)?spawnSync(process.execPath,[npmCli,'run',action,'--',...args],{cwd:process.cwd(),env:env(dataDir,temp),encoding:'utf8',timeout:30000}):run(dataDir,temp,password,action,...args);

test('암호화 백업을 별도 폴더에 복원하고 문서·첨부와 새 현장 접속을 확인한다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-encrypted-')),source=join(dir,'기존 자료'),backup=join(dir,'백업'),restore=join(dir,'복원'),temp=join(dir,'임시');
  for(const path of [source,backup,restore,temp])mkdirSync(path);
  const store=new Store(join(source,'jweb.sqlite'));let child;
  try{
    const site=store.createSite({name:'가상 암호화 현장'}),doc=store.createDocument({siteId:site.id,type:'tbm',title:'가상 암호화 문서',date:'2026-10-01',body:'가상 비밀 내용'}),attachment=store.addAttachment(doc.id,'가상.txt',Buffer.from('가상 첨부 내용'));
    const invitation=store.createInvitation(site.id),oldKey=store.siteAccessKey(site.id);store.openSiteRegistration(site.id);
    const worker=store.createWorker({siteId:site.id,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),salt=Buffer.alloc(16,1),token='A'.repeat(43),hash=createHash('sha256').update(token).digest('hex');
    store.db.prepare('INSERT INTO worker_accounts(worker_id,site_id,login_id,salt,password_hash) VALUES(?,?,?,?,?)').run(worker.id,site.id,'virtual_worker',salt,scryptSync('virtual-password-123',salt,32));
    new WorkerSessions(store.db).set(hash,{worker:{id:worker.id,site_id:site.id},expires:Date.now()+3600000});
    const archive=join(backup,'snapshot.jwbk'),second=join(backup,'second.jwbk'),first=documented(source,temp,'backup-encrypted',archive);
    assert.equal(first.status,0,first.stderr);assert.equal((first.stdout+first.stderr).includes(password),false);
    const bytes=readFileSync(archive);assert.equal(bytes.subarray(0,8).toString(),'JWEBBK01');
    for(const value of ['SQLite format 3','가상 암호화 현장','가상 비밀 내용','가상 첨부 내용',oldKey,password])assert.equal(bytes.includes(Buffer.from(value)),false);
    const next=run(source,temp,password,'backup-encrypted',second);assert.equal(next.status,0,next.stderr);assert.notDeepEqual(readFileSync(second),bytes);
    const result=documented(source,temp,'restore-encrypted',archive,restore);assert.equal(result.status,0,result.stderr);assert.equal((result.stdout+result.stderr).includes(password),false);
    const restored=new Store(join(restore,'jweb.sqlite'));try{
      assert.equal(restored.document(doc.id).title,'가상 암호화 문서');assert.deepEqual(Buffer.from(restored.attachment(attachment).data),Buffer.from('가상 첨부 내용'));
      assert.equal(restored.db.prepare('SELECT count(*) AS n FROM worker_sessions').get().n,0);
      assert.equal(restored.siteFromAccess(oldKey),null);assert.notEqual(restored.siteAccessKey(site.id),oldKey);assert.equal(restored.invitation(invitation.token),null);assert.equal(restored.siteRegistrationOpen(site.id),false);
    }finally{restored.close();}
    assert.equal(store.siteFromAccess(oldKey).id,site.id);assert.equal(store.invitation(invitation.token).id,site.id);assert.equal(store.siteRegistrationOpen(site.id),true);assert.equal(store.db.prepare('SELECT count(*) AS n FROM worker_sessions').get().n,1);
    const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...env(restore,temp),PORT:String(port),JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('복원 시험 서버가 종료됐습니다.');})]);
    const root=`http://127.0.0.1:${port}`,login=await fetch(root+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'virtual-admin-password'})}),cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal(login.status,200);assert.equal((await (await fetch(root+'/api/sites',{headers:{cookie}})).json())[0].name,'가상 암호화 현장');
    assert.equal((await fetch(root+'/api/worker/session',{headers:{cookie:`jweb_worker=${token}`}})).status,401);assert.equal((await fetch(root+`/api/join?token=${invitation.token}`)).status,404);assert.equal((await fetch(root+`/api/worker/site?key=${oldKey}`)).status,404);
    assert.deepEqual(readdirSync(temp).filter(name=>name.startsWith('jweb-private-')),[]);assert.deepEqual(readdirSync(backup).sort(),['second.jwbk','snapshot.jwbk']);
  }finally{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}store.close();cleanup(dir);}
});

test('틀린 암호와 변조된 파일은 복원하지 않고 기존 파일도 덮어쓰지 않는다',{timeout:60000},()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-encrypted-errors-')),source=join(dir,'source'),temp=join(dir,'temp'),target=join(dir,'target');
  for(const path of [source,temp,target])mkdirSync(path);
  const store=new Store(join(source,'jweb.sqlite'));
  try{
    store.createSite({name:'가상 현장'});const archive=join(target,'valid.jwbk');
    assert.notEqual(run(source,temp,'짧은 암호','backup-encrypted',archive).status,0);
    assert.notEqual(run(source,temp,password,'backup-encrypted',join(target,'wrong.sqlite')).status,0);
    assert.equal(run(source,temp,password,'backup-encrypted',archive).status,0);const original=readFileSync(archive);
    assert.notEqual(run(source,temp,password,'backup-encrypted',archive).status,0);assert.deepEqual(readFileSync(archive),original);
    const cases=[['wrong-password',original,'incorrect-password-123'],['magic',Buffer.from(original),password],['salt',Buffer.from(original),password],['ciphertext',Buffer.from(original),password],['tag',Buffer.from(original),password],['truncated',original.subarray(0,original.length-10),password]];
    cases[1][1][0]^=1;cases[2][1][8]^=1;cases[3][1][40]^=1;cases[4][1][original.length-1]^=1;
    for(const [name,bytes,pass] of cases){
      const file=join(target,`${name}.jwbk`),dest=join(dir,name);writeFileSync(file,bytes);mkdirSync(dest);
      const result=run(source,temp,pass,'restore-encrypted',file,dest);assert.notEqual(result.status,0,name);assert.equal(existsSync(join(dest,'jweb.sqlite')),false,name);assert.deepEqual(readdirSync(dest),[],name);assert.equal((result.stdout+result.stderr).includes(pass),false,name);
    }
    const existing=join(dir,'existing');mkdirSync(existing);writeFileSync(join(existing,'jweb.sqlite'),'기존 데이터');
    assert.notEqual(run(source,temp,password,'restore-encrypted',archive,existing).status,0);assert.equal(readFileSync(join(existing,'jweb.sqlite'),'utf8'),'기존 데이터');
    assert.deepEqual(readdirSync(temp).filter(name=>name.startsWith('jweb-private-')),[]);assert.equal(readdirSync(target).some(name=>name.startsWith('.jweb-')),false);
  }finally{store.close();cleanup(dir);}
});

test('동시에 같은 이름으로 암호화 백업해도 하나만 저장된다',{timeout:60000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-encrypted-race-')),source=join(dir,'source'),temp=join(dir,'temp'),target=join(dir,'target'),restore=join(dir,'restore');
  for(const path of [source,temp,target,restore])mkdirSync(path);
  try{
    const store=new Store(join(source,'jweb.sqlite'));store.createSite({name:'가상 동시 백업'});store.close();
    const archive=join(target,'same.jwbk'),children=[1,2].map(()=>spawn(process.execPath,['db-copy.js','backup-encrypted',archive],{cwd:process.cwd(),env:env(source,temp),stdio:'ignore'}));
    const codes=await Promise.all(children.map(child=>once(child,'exit').then(([code])=>code)));assert.deepEqual(codes.slice().sort(),[0,1]);
    const result=run(source,temp,password,'restore-encrypted',archive,restore);assert.equal(result.status,0,result.stderr);
    const restored=new Store(join(restore,'jweb.sqlite'));try{assert.equal(restored.db.prepare('SELECT name FROM sites').get().name,'가상 동시 백업');}finally{restored.close();}
    assert.deepEqual(readdirSync(temp).filter(name=>name.startsWith('jweb-private-')),[]);assert.deepEqual(readdirSync(target),['same.jwbk']);
  }finally{cleanup(dir);}
});
