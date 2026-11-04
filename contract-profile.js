import {randomBytes} from 'node:crypto';

const fields=['employer','address','phone','representative','workplace'];

export class ContractProfile {
  constructor(db){this.db=db;db.exec("CREATE TABLE IF NOT EXISTS contract_profiles(site_id INTEGER PRIMARY KEY REFERENCES sites(id),employer TEXT NOT NULL,address TEXT NOT NULL,phone TEXT NOT NULL,representative TEXT NOT NULL,workplace TEXT NOT NULL,version TEXT NOT NULL)");}
  get(siteId){
    const site=this.db.prepare('SELECT id,name FROM sites WHERE id=?').get(Number(siteId));
    if(!site)throw Error('현장을 확인해 주세요.');
    const profile=this.db.prepare('SELECT employer,address,phone,representative,workplace,version FROM contract_profiles WHERE site_id=?').get(site.id);
    return {site,profile:profile||Object.fromEntries([...fields.map(key=>[key,'']),['version','']])};
  }
  save(siteId,input,authorize=()=>{}){
    if(!input||typeof input.version!=='string'||fields.some(key=>typeof input[key]!=='string'||input[key].length>300||/[\x00-\x1f\x7f]/.test(input[key])))throw Error('사업체 정보를 확인해 주세요.');
    const values=fields.map(key=>input[key].trim()),version=randomBytes(16).toString('hex');
    this.db.exec('BEGIN IMMEDIATE');try{
      authorize();const current=this.get(siteId);if(input.version!==current.profile.version)throw Object.assign(Error('정보가 변경되었습니다. 다시 조회해 주세요.'),{sessionStatus:409});
      this.db.prepare('INSERT INTO contract_profiles(site_id,employer,address,phone,representative,workplace,version) VALUES(?,?,?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET employer=excluded.employer,address=excluded.address,phone=excluded.phone,representative=excluded.representative,workplace=excluded.workplace,version=excluded.version').run(current.site.id,...values,version);
      this.db.exec('COMMIT');return this.get(siteId);
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
