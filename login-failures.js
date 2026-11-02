export class LoginFailures {
  constructor(){this.peers=new Map();this.accounts=new Map();}
  check(peer,account,now){
    if(typeof peer!=='string'||!peer||peer.length>64)throw Object.assign(new Error('로그인 중계 설정을 확인해 주세요.'),{sessionStatus:503});
    for(const [map,limit,key] of [[this.peers,100,peer],[this.accounts,10,account]]){
      for(const [id,times] of map){const recent=times.filter(t=>t>now-300000);if(recent.length)map.set(id,recent);else map.delete(id);}
      // 포화 시 기존 제한을 축출하면 주소·아이디 회전으로 암호 추측 제한을 우회할 수 있다.
      if((map.get(key)?.length||0)>=limit||(!map.has(key)&&map.size>=10000))throw Object.assign(new Error('잠시 후 다시 로그인해 주세요.'),{sessionStatus:429});
    }
  }
  record(peer,account,now){
    this.check(peer,account,now);
    for(const [map,key] of [[this.peers,peer],[this.accounts,account]]){const times=map.get(key)||[];times.push(now);map.set(key,times);}
  }
}
