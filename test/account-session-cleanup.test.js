import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { AdminAccounts } from '../admin-accounts.js';
import { ClientAccounts } from '../client-accounts.js';

const password='virtual-password-123';
const hash=token=>createHash('sha256').update(token).digest('hex');
for(const [kind,Accounts] of [['admin',AdminAccounts],['client',ClientAccounts]]){
  function setup(){
    const db=new DatabaseSync(':memory:');let now=1000;
    const accounts=new Accounts(db,()=>now);
    for(const loginId of ['first_user','second_user']){
      if(kind==='admin')accounts.create({loginId,name:'가상 관리자',password});
      else accounts.register({kind:'individual',acknowledged:true,loginId,password,confirmPassword:password,name:'가상 발주처',email:'test@example.invalid',phone:'01000000000'});
    }
    const rows=()=>db.prepare(`SELECT * FROM ${kind}_sessions ORDER BY token_hash`).all();
    return {db,accounts,rows,setNow:value=>{now=value;}};
  }

  test(`${kind} successful login removes expired sessions including exact boundary and preserves other devices`,()=>{
    const {db,accounts,rows,setNow}=setup();
    try{
      const expired=accounts.login('second_user',password);
      setNow(1001);const boundary=accounts.login('first_user',password);
      setNow(1002);const otherDevice=accounts.login('first_user',password),otherAccount=accounts.login('second_user',password);
      setNow(28801001);
      assert.equal(rows().length,4);
      assert.equal(accounts.login('first_user','incorrect'),null);
      assert.equal(rows().length,4);
      const fresh=accounts.login('first_user',password);
      assert.deepEqual(new Set(rows().map(row=>row.token_hash)),new Set([otherDevice,otherAccount,fresh].map(hash)));
      assert.equal(accounts.session(expired),null);assert.equal(accounts.session(boundary),null);
      assert.ok(accounts.session(otherDevice));assert.ok(accounts.session(otherAccount));assert.ok(accounts.session(fresh));
      const concurrentDevice=accounts.login('first_user',password);
      assert.ok(accounts.session(fresh));assert.ok(accounts.session(concurrentDevice));
      assert.equal(rows().length,4);
    }finally{db.close();}
  });

  test(`${kind} failed session insertion rolls back cleanup and old-token replacement`,()=>{
    const {db,accounts,rows,setNow}=setup();
    try{
      accounts.login('second_user',password);
      setNow(1002);const oldToken=accounts.login('first_user',password);
      setNow(28801000);const before=rows();
      db.exec(`CREATE TRIGGER reject_session BEFORE INSERT ON ${kind}_sessions BEGIN SELECT RAISE(ABORT,'synthetic insertion failure'); END`);
      assert.throws(()=>accounts.login('first_user',password,oldToken),/synthetic insertion failure/);
      assert.deepEqual(rows(),before);assert.ok(accounts.session(oldToken));
      db.exec('DROP TRIGGER reject_session');
      const fresh=accounts.login('first_user',password,oldToken);
      assert.equal(rows().length,1);assert.equal(accounts.session(oldToken),null);assert.ok(accounts.session(fresh));
    }finally{db.close();}
  });

  test(`${kind} credential change before transaction recheck issues no session and performs no cleanup`,()=>{
    const {db,accounts,rows,setNow}=setup();
    try{
      accounts.login('second_user',password);setNow(28801000);const before=rows();
      let changed=false;
      accounts.db={
        prepare:sql=>db.prepare(sql),
        exec:sql=>{
          if(sql==='BEGIN IMMEDIATE'&&!changed){
            changed=true;
            db.prepare(`UPDATE ${kind}_accounts SET auth_version='changed-before-lock' WHERE login_id=?`).run('first_user');
          }
          return db.exec(sql);
        },
      };
      assert.equal(accounts.login('first_user',password),null);
      assert.equal(changed,true);assert.deepEqual(rows(),before);
      accounts.db=db;
      assert.ok(accounts.login('first_user',password));assert.equal(rows().length,1);
    }finally{db.close();}
  });
}
