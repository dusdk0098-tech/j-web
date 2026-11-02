import { DatabaseSync } from 'node:sqlite';
import { createCipheriv,createDecipheriv,randomBytes,scryptSync } from 'node:crypto';
import { appendFileSync,chmodSync,closeSync,createReadStream,createWriteStream,fstatSync,fsyncSync,linkSync,lstatSync,mkdtempSync,openSync,readSync,realpathSync,rmdirSync,statSync,unlinkSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const magic=Buffer.from('JWEBBK01'),saltLength=16,ivLength=12,tagLength=16,headerLength=magic.length+saltLength+ivLength,maxPlaintext=2**36-32;

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
      const protectedTables=['worker_sessions','reviewer_sessions','client_sessions','admin_sessions','reviewer_recovery','client_recovery',...(resetAccess?['site_access','site_registration','invitations']:[])];
      if(snapshot.prepare("SELECT tbl_name FROM sqlite_schema WHERE type='trigger'").all().some(row=>protectedTables.includes(row.tbl_name)))throw new Error('로그인 세션 테이블 또는 접속 설정의 추가 동작을 확인해 주세요.');
      snapshot.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; BEGIN IMMEDIATE');
      try{
        for(const table of ['worker_sessions','reviewer_sessions','client_sessions','admin_sessions','reviewer_recovery','client_recovery'])if(tables.has(table))snapshot.exec(`DELETE FROM ${table}`);
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

function backupPassword(){
  const value=process.env.JWEB_BACKUP_PASSWORD;
  if(typeof value!=='string'||value.length<12||value.length>1024)throw new Error('JWEB_BACKUP_PASSWORD에 12자 이상 1024자 이하의 백업 암호를 설정해 주세요.');
  return value;
}

function removeTemporary(dir,name){
  if(!dir)return;
  for(const suffix of ['','-wal','-shm','-journal'])try{unlinkSync(join(dir,name)+suffix);}catch(error){if(error.code!=='ENOENT')throw error;}
  rmdirSync(dir);
}

async function encryptedBackup(source,destination,password){
  const requested=resolve(destination),parent=realpathSync(dirname(requested));
  if(!statSync(parent).isDirectory()||!basename(requested).toLowerCase().endsWith('.jwbk'))throw new Error('백업 대상은 기존 폴더의 .jwbk 파일로 지정해 주세요.');
  const output=join(parent,basename(requested));available(output);
  const privateDir=mkdtempSync(join(realpathSync(tmpdir()),'jweb-private-'));let encryptedDir,key;
  try{
    const plain=join(privateDir,'snapshot.sqlite');copyDatabase(source,plain);
    if(statSync(plain).size>maxPlaintext)throw new Error('암호화 백업에 사용할 수 있는 데이터 크기를 초과했습니다.');
    encryptedDir=mkdtempSync(join(parent,'.jweb-encrypted-'));const staged=join(encryptedDir,'backup.jwbk');
    const salt=randomBytes(saltLength),iv=randomBytes(ivLength),header=Buffer.concat([magic,salt,iv]);
    key=scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
    const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header);
    writeFileSync(staged,header,{flag:'wx',mode:0o600});await pipeline(createReadStream(plain),cipher,createWriteStream(staged,{flags:'a'}));appendFileSync(staged,cipher.getAuthTag());
    const fd=openSync(staged,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}chmodSync(staged,0o600);available(output);linkSync(staged,output);return output;
  }finally{
    key?.fill(0);
    try{removeTemporary(encryptedDir,'backup.jwbk');}finally{removeTemporary(privateDir,'snapshot.sqlite');}
  }
}

function readExact(fd,length,position){
  const bytes=Buffer.alloc(length);let read=0;
  while(read<length){const count=readSync(fd,bytes,read,length-read,position+read);if(!count)throw new Error('암호화 백업이 잘렸습니다.');read+=count;}
  return bytes;
}

async function encryptedRestore(source,destination,password){
  const input=realpathSync(resolve(source)),fd=openSync(input,'r');let header,tag,size;
  try{
    const info=fstatSync(fd);size=info.size;
    if(!info.isFile()||!Number.isSafeInteger(size)||size<=headerLength+tagLength||size-headerLength-tagLength>maxPlaintext)throw new Error('암호화 백업 형식을 확인해 주세요.');
    header=readExact(fd,headerLength,0);tag=readExact(fd,tagLength,size-tagLength);
    if(!header.subarray(0,magic.length).equals(magic))throw new Error('지원하는 암호화 백업 형식이 아닙니다.');
  }finally{closeSync(fd);}
  const privateDir=mkdtempSync(join(realpathSync(tmpdir()),'jweb-private-'));let key;
  try{
    const plain=join(privateDir,'snapshot.sqlite'),salt=header.subarray(magic.length,magic.length+saltLength),iv=header.subarray(magic.length+saltLength);
    key=scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
    const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(header);decipher.setAuthTag(tag);
    try{await pipeline(createReadStream(input,{start:headerLength,end:size-tagLength-1}),decipher,createWriteStream(plain,{flags:'wx',mode:0o600}));}catch(error){if(error.code)throw error;throw new Error('백업 암호를 확인하거나 백업 파일의 손상 여부를 확인해 주세요.');}
    return copyDatabase(plain,destination,true);
  }finally{key?.fill(0);removeTemporary(privateDir,'snapshot.sqlite');}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [action,...args]=process.argv.slice(2);
    let source,destination;
    if(['backup','backup-encrypted'].includes(action)&&args.length===1){source=join(process.env.JWEB_DATA_DIR||join(root,'data'),'jweb.sqlite');destination=args[0];}
    else if(['restore','restore-encrypted'].includes(action)&&args.length===2){source=args[0];destination=join(args[1],'jweb.sqlite');}
    else throw new Error('사용법: npm run backup -- 백업파일.sqlite, npm run restore -- 백업파일.sqlite 새데이터폴더, npm run backup-encrypted -- 백업파일.jwbk 또는 npm run restore-encrypted -- 백업파일.jwbk 새데이터폴더');
    const output=action==='backup-encrypted'?await encryptedBackup(source,destination,backupPassword()):action==='restore-encrypted'?await encryptedRestore(source,destination,backupPassword()):copyDatabase(source,destination,action==='restore');
    console.log(`데이터 사본을 만들었습니다: ${output}\n사본을 사용할 때는 다시 로그인해 주세요.`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
