import { AsyncLocalStorage } from 'node:async_hooks';

// SQLite BEFORE 트리거는 쓰기 잠금 획득 뒤 실행되어 대기 중 폐기된 세션도 거절한다.
export function adminWriteGuard(db){
  const requests=new AsyncLocalStorage();let checking=false;
  db.function('jweb_admin_write_allowed',()=>{
    const req=requests.getStore();if(!req?.adminProtected||checking)return 1;
    checking=true;try{const failure=req.checkSession();if(failure){req.adminWriteFailure=failure;return 0;}return 1;}finally{checking=false;}
  });
  for(const {name} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('admin_accounts','admin_sessions')").all()){
    const table='"'+name.replaceAll('"','""')+'"';
    for(const action of ['INSERT','UPDATE','DELETE']){
      const trigger='"admin_guard_'+action+'_'+name.replaceAll('"','""')+'"';
      // 로그아웃 뒤에도 아직 활성화하지 않은 초대의 실패 정리는 허용한다.
      const cleanup=name==='invitations'&&action==='DELETE'?' WHEN OLD.pending<>1':'';
      db.exec('CREATE TEMP TRIGGER '+trigger+' BEFORE '+action+' ON main.'+table+cleanup+" BEGIN SELECT CASE WHEN jweb_admin_write_allowed()=0 THEN RAISE(ABORT,'관리자 세션이 변경되었습니다.') END; END");
    }
  }
  return requests;
}
