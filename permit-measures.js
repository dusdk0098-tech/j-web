import { randomUUID } from 'node:crypto';

const conflict=()=>Object.assign(new Error('장비 안전대책 목록이 변경되었습니다. 입력 내용은 유지됩니다. 다시 조회하거나 목록 연결을 해제해 주세요.'),{sessionStatus:409});
function equipment(db,siteId,equipmentId){
  if(!Number.isSafeInteger(Number(siteId))||Number(siteId)<1||!Number.isSafeInteger(Number(equipmentId))||Number(equipmentId)<1||!db.prepare('SELECT 1 FROM equipment WHERE id=? AND site_id=?').get(Number(equipmentId),Number(siteId)))throw Error('같은 현장의 장비를 선택해 주세요.');
}
export function listPermitMeasures(db,siteId,equipmentId){equipment(db,siteId,equipmentId);return db.prepare('SELECT * FROM permit_equipment_measures WHERE equipment_id=? ORDER BY id').all(Number(equipmentId));}
export function savePermitMeasure(db,siteId,equipmentId,id,input,remove,authorize){
  db.exec('BEGIN IMMEDIATE');try{
    authorize();equipment(db,siteId,equipmentId);
    if(id){const row=db.prepare('SELECT * FROM permit_equipment_measures WHERE id=? AND equipment_id=?').get(Number(id),Number(equipmentId));if(!row||row.version!==input.expectedVersion)throw conflict();}
    if(remove){db.prepare('DELETE FROM permit_equipment_measures WHERE id=?').run(Number(id));db.exec('COMMIT');return {ok:true};}
    const values=['accidentType','hazard','measure'].map(key=>{const value=input[key];if(typeof value!=='string'||value.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw Error('안전대책 각 항목은 2000자 이내로 입력해 주세요.');return value.trim();});
    if(!values[2])throw Error('안전대책을 입력해 주세요.');
    const version=randomUUID();
    if(id)db.prepare('UPDATE permit_equipment_measures SET accidentType=?,hazard=?,measure=?,version=? WHERE id=?').run(...values,version,Number(id));
    else {if(listPermitMeasures(db,siteId,equipmentId).length>=100)throw Error('장비별 안전대책은 100개까지 등록할 수 있습니다.');id=db.prepare('INSERT INTO permit_equipment_measures(equipment_id,accidentType,hazard,measure,version) VALUES(?,?,?,?,?)').run(Number(equipmentId),...values,version).lastInsertRowid;}
    const result=db.prepare('SELECT * FROM permit_equipment_measures WHERE id=?').get(Number(id));db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function validatePermitMeasureSources(db,input){
  if(input.permitMeasureSources===undefined)return;
  const sources=input.permitMeasureSources;
  if(!['permit','work_plan'].includes(input.type)||!Array.isArray(sources)||sources.length>100)throw Error('적용한 장비 안전대책을 확인해 주세요.');
  for(const source of sources){
    if(!source||!Number.isSafeInteger(source.id)||!Number.isSafeInteger(source.equipmentId)||typeof source.version!=='string')throw Error('적용한 장비 안전대책을 확인해 주세요.');
    equipment(db,input.siteId,source.equipmentId);
    const row=db.prepare('SELECT version FROM permit_equipment_measures WHERE id=? AND equipment_id=?').get(source.id,source.equipmentId);
    if(!row||row.version!==source.version)throw conflict();
  }
}
