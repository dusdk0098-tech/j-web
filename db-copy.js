import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { chmodSync, linkSync, lstatSync, mkdtempSync, realpathSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));

function exists(path){
  try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}
}

function available(path){
  if(['','-wal','-shm','-journal'].some(suffix=>exists(path+suffix)))throw new Error('대상 파일이나 SQLite 보조 파일이 이미 있습니다. 다른 위치를 선택해 주세요.');
}

function copyDatabase(source,destination,resetAccess=false){
  const sourcePath=realpathSync(resolve(source)),requested=resolve(destination),parent=realpathSync(dirname(requested));
  if(!statSync(sourcePath).isFile()||!statSync(parent).isDirectory()||!basename(requested).toLowerCase().endsWith('.sqlite'))throw new Error('데이터베이스와 .sqlite 대상 경로를 확인해 주세요.');
  const output=join(parent,basename(requested));available(output);
  const temporary=mkdtempSync(join(parent,'.jweb-copy-'));
  if(dirname(temporary)!==parent||!basename(temporary).startsWith('.jweb-copy-'))throw new Error('임시 폴더 경로를 확인해 주세요.');
  const staged=join(temporary,'snapshot.sqlite');
  try{
    const original=new DatabaseSync(sourcePath,{readOnly:true});
    try{original.exec('PRAGMA busy_timeout=3000');original.prepare('VACUUM INTO ?').run(staged);}finally{original.close();}
    const snapshot=new DatabaseSync(staged);
    try{
      const tables=new Set(snapshot.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
      if(!['sites','workers','documents','attachments'].every(name=>tables.has(name)))throw new Error('J웹 데이터베이스 형식을 확인해 주세요.');
      const check=snapshot.prepare('PRAGMA integrity_check').all();
      if(check.length!==1||Object.values(check[0])[0]!=='ok'||snapshot.prepare('PRAGMA foreign_key_check').all().length)throw new Error('데이터베이스 무결성 검사가 실패했습니다.');
      const protectedTables=['worker_sessions','reviewer_sessions','client_sessions',...(resetAccess?['site_access','site_registration','invitations']:[])];
      if(snapshot.prepare("SELECT tbl_name FROM sqlite_schema WHERE type='trigger'").all().some(row=>protectedTables.includes(row.tbl_name)))throw new Error('로그인 세션 테이블 또는 접속 설정의 추가 동작을 확인해 주세요.');
      snapshot.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; BEGIN IMMEDIATE');
      try{
        for(const table of ['worker_sessions','reviewer_sessions','client_sessions'])if(tables.has(table))snapshot.exec(`DELETE FROM ${table}`);
        if(resetAccess){
          if(tables.has('invitations'))snapshot.exec('UPDATE invitations SET revoked=1');
          if(tables.has('site_registration'))snapshot.exec('DELETE FROM site_registration');
          if(tables.has('site_access')){const update=snapshot.prepare('UPDATE site_access SET access_key=? WHERE site_id=?');for(const row of snapshot.prepare('SELECT site_id FROM site_access').all())update.run(randomBytes(32).toString('base64url'),row.site_id);}
        }
        snapshot.exec('COMMIT');
      }catch(error){snapshot.exec('ROLLBACK');throw error;}
      if(snapshot.prepare('PRAGMA foreign_key_check').all().length)throw new Error('복사본의 데이터 연결을 확인해 주세요.');
    }finally{snapshot.close();}
    chmodSync(staged,0o600);available(output);linkSync(staged,output);
    return output;
  }finally{
    for(const suffix of ['','-wal','-shm','-journal'])try{unlinkSync(staged+suffix);}catch(error){if(error.code!=='ENOENT')throw error;}
    rmdirSync(temporary);
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [action,...args]=process.argv.slice(2);
    let source,destination;
    if(action==='backup'&&args.length===1){source=join(process.env.JWEB_DATA_DIR||join(root,'data'),'jweb.sqlite');destination=args[0];}
    else if(action==='restore'&&args.length===2){source=args[0];destination=join(args[1],'jweb.sqlite');}
    else throw new Error('사용법: npm run backup -- 백업파일.sqlite 또는 npm run restore -- 백업파일.sqlite 새데이터폴더');
    const output=copyDatabase(source,destination,action==='restore');
    console.log(`데이터 사본을 만들었습니다: ${output}\n사본을 사용할 때는 다시 로그인해 주세요.`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
