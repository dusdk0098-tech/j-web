const denied=()=>({status:403,error:'이 관리자에게 허용되지 않은 현장 또는 기능입니다.'});
const positive=value=>(typeof value==='string'||typeof value==='number')&&/^[1-9]\d*$/.test(String(value))&&Number.isSafeInteger(Number(value));

// 검증된 메서드와 정확한 경로만 열고, 추가 기능은 소유 관계 검증 후 등록한다.
export function adminSitePolicy(db,req,url,session){
  const actor=session();if(!actor)return {status:401,error:'관리자 로그인이 필요합니다.'};
  if(actor.scope==='global')return null;
  req.adminRestricted=true;
  const allowed=value=>positive(value)&&actor.siteIds.includes(Number(value));
  const site=value=>allowed(value)?null:denied();
  const doc=id=>db.prepare('SELECT id,site_id,type FROM documents WHERE id=?').get(Number(id));
  const owned=row=>row&&allowed(row.site_id)?null:denied();
  const method=req.method,path=url.pathname,input=req.adminInput;
  if(url.searchParams.getAll('siteId').length>1)return denied();
  if(url.searchParams.has('siteId')&&!allowed(url.searchParams.get('siteId')))return denied();
  if(input?.siteId!==undefined&&!allowed(input.siteId))return denied();
  if(input?.siteId!==undefined&&url.searchParams.has('siteId')&&Number(input.siteId)!==Number(url.searchParams.get('siteId')))return denied();
  const worker=path.match(/^\/api\/workers\/([1-9]\d*)$/);
  const fields=keys=>input&&Object.keys(input).every(key=>keys.includes(key));
  if(path==='/api/equipment-check-count'&&method==='GET')return [...url.searchParams.keys()].every(key=>['siteId','date'].includes(key))&&url.searchParams.getAll('date').length===1?site(url.searchParams.get('siteId')):denied();
  if(path==='/api/companies'&&method==='GET')return [...url.searchParams.keys()].every(key=>key==='siteId')?site(url.searchParams.get('siteId')):denied();
  if(path==='/api/equipment'&&method==='GET')return [...url.searchParams.keys()].every(key=>key==='siteId')?site(url.searchParams.get('siteId')):denied();
  const equipmentAttendance=path.match(/^\/api\/equipment-attendance(?:\/([1-9]\d*))?$/);
  if(equipmentAttendance){
    const id=equipmentAttendance[1];
    if(!id&&method==='GET')return [...url.searchParams.keys()].every(key=>['siteId','month'].includes(key))&&url.searchParams.getAll('month').length===1&&/^\d{4}-(0[1-9]|1[0-2])$/.test(url.searchParams.get('month'))?site(url.searchParams.get('siteId')):denied();
    if(!(!id&&method==='POST'||id&&['PUT','DELETE'].includes(method))||[...url.searchParams.keys()].some(key=>key!=='siteId'))return denied();
    // 삭제 응답 재검증은 잠금 안에서 삭제를 완료한 요청의 현장만 재사용한다.
    const row=id?(db.prepare('SELECT site_id FROM equipment_attendance WHERE id=?').get(Number(id))||(method==='DELETE'&&req.adminDeletedEquipment?.id===Number(id)?{site_id:req.adminDeletedEquipment.siteId}:null)):null;
    if(id&&owned(row))return denied();
    if(input===undefined)return null;
    const keys=method==='DELETE'?['siteId','expectedVersion']:['siteId','date','driverName','note',id?'expectedVersion':'equipmentId'];
    if(!fields(keys)||!allowed(input.siteId)||id&&Number(input.siteId)!==row.site_id)return denied();
    if(id&&(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1))return denied();
    if(!id&&(!positive(input.equipmentId)||!db.prepare('SELECT 1 FROM equipment WHERE id=? AND site_id=?').get(Number(input.equipmentId),Number(input.siteId))))return denied();
    if(method!=='DELETE'&&(typeof input.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!Number.isFinite(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date||['driverName','note'].some(key=>typeof input[key]!=='string'||input[key].length>200||/[\x00-\x1f\x7f]/.test(input[key]))))return denied();
    return null;
  }
  const workerSite=(id,siteId)=>positive(id)&&allowed(siteId)&&db.prepare('SELECT 1 FROM workers WHERE id=? AND site_id=?').get(Number(id),Number(siteId));
  const workerInvitation=path.match(/^\/api\/workers\/([1-9]\d*)\/invitation$/);
  if(workerInvitation){
    if(method!=='POST'||url.search)return denied();
    if(input===undefined)return owned(db.prepare('SELECT site_id FROM workers WHERE id=?').get(Number(workerInvitation[1])));
    return fields(['siteId','version'])&&workerSite(workerInvitation[1],input.siteId)&&typeof input.version==='string'&&/^[a-f0-9]{64}$/.test(input.version)?null:denied();
  }
  const training=path.match(/^\/api\/documents\/([1-9]\d*)\/training-targets$/);
  if(training){
    const row=doc(training[1]);if(owned(row)||row.type!=='education'||url.search)return denied();
    if(method==='GET')return null;
    if(method!=='PUT')return denied();if(input===undefined)return null;
    return fields(['workerIds','managerIds','expectedEditVersion'])&&(input.workerIds===undefined?Array.isArray(input.managerIds):Array.isArray(input.workerIds)&&input.workerIds.every(id=>Number.isSafeInteger(id)&&workerSite(id,row.site_id)))&&Number.isSafeInteger(input.expectedEditVersion)&&input.expectedEditVersion>=0?null:denied();
  }
  const qr=path.match(/^\/api\/sites\/([1-9]\d*)\/(access(?:\/(?:status|rotate|registration))?|invitation(?:\/status)?)$/);
  if(qr){
    if([...url.searchParams.keys()].some(key=>key!=='siteId'))return denied();
    if(!allowed(qr[1])||url.searchParams.has('siteId')&&Number(url.searchParams.get('siteId'))!==Number(qr[1]))return denied();
    const valid=qr[2]==='access/status'?method==='GET':qr[2]==='invitation'?['POST','DELETE'].includes(method):method==='POST';
    return valid&&(input===undefined||(qr[2]==='invitation/status'?fields(['token'])&&typeof input.token==='string'&&/^[\w-]{43}$/.test(input.token):fields([])))?null:denied();
  }
  if(path==='/api/attendance/month'&&method==='GET'&&([...url.searchParams.keys()].some(key=>!['siteId','month'].includes(key))||url.searchParams.getAll('month').length!==1))return denied();
  if(path==='/api/attendance/month/cells'&&method==='PUT'){
    if([...url.searchParams.keys()].some(key=>key!=='siteId'))return denied();
    if(input===undefined)return null;
    if(!fields(['siteId','month','changes'])||!allowed(input.siteId)||typeof input.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)||!Array.isArray(input.changes)||!input.changes.length||input.changes.length>1000)return denied();
    const seen=new Set();
    return input.changes.every(row=>{
      if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['workerId','date','present','units','expectedDayVersion','expectedVersion'].includes(key))||!workerSite(row.workerId,input.siteId)||typeof row.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!row.date.startsWith(input.month+'-')||!Number.isFinite(Date.parse(row.date))||new Date(row.date).toISOString().slice(0,10)!==row.date||typeof row.present!=='boolean'||!Number.isSafeInteger(row.expectedDayVersion)||row.expectedDayVersion<0||typeof row.expectedVersion!=='string'||!/^([a-f0-9]{64})$/.test(row.expectedVersion)||row.units!==undefined&&(!row.present||typeof row.units!=='string'||!/^$|^\d(?:\.\d{1,2})?$/.test(row.units)))return false;
      const key=Number(row.workerId)+':'+row.date;if(seen.has(key))return false;seen.add(key);return true;
    })?null:denied();
  }
  if(path==='/api/attendance/month/details'&&method==='PUT'){
    if([...url.searchParams.keys()].some(key=>key!=='siteId'))return denied();
    if(input===undefined)return null;
    return fields(['siteId','workerId','month','expectedVersion','category','company','occupation'])&&workerSite(input.workerId,input.siteId)&&typeof input.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)&&typeof input.expectedVersion==='string'&&/^[a-f0-9]{64}$/.test(input.expectedVersion)?null:denied();
  }
  if(method==='GET'&&['/api/workers','/api/workers/list','/api/attendance','/api/attendance/month'].includes(path))return site(url.searchParams.get('siteId'));
  if(worker&&method==='GET')return workerSite(worker[1],url.searchParams.get('siteId'))?null:denied();
  if(path==='/api/workers'&&method==='POST'||worker&&method==='PUT'){
    if(input===undefined)return worker?owned(db.prepare('SELECT site_id FROM workers WHERE id=?').get(Number(worker[1]))):null;
    if(!fields(['siteId','name','category','company','occupation','memo','licenses','version','companyId'])||!allowed(input.siteId)||input.companyId!==undefined&&(!Number.isSafeInteger(input.companyId)||input.companyId<0))return denied();
    if(worker&&(!workerSite(worker[1],input.siteId)||typeof input.version!=='string'||!/^[a-f0-9]{64}$/.test(input.version)))return denied();
    return null;
  }
  if(path==='/api/attendance'&&method==='POST'||path==='/api/attendance/units'&&method==='PUT'){
    if(input===undefined)return null;
    const value=path==='/api/attendance'?'present':'units';
    return fields(['siteId','workerId','date',value,'expectedDayVersion'])&&workerSite(input.workerId,input.siteId)&&Number.isSafeInteger(input.expectedDayVersion)&&input.expectedDayVersion>=0?null:denied();
  }
  if(method==='GET'&&['/api/sites','/api/types'].includes(path))return null;
  if(path==='/api/documents'){
    if(method==='GET')return site(url.searchParams.get('siteId'));
    if(method==='POST')return input===undefined?null:input.officeSetup===undefined?site(input.siteId):denied();
  }
  const document=path.match(/^\/api\/documents\/(\d+)(?:\/(events|attachments))?$/);
  if(document){
    const row=doc(document[1]),failure=owned(row);if(failure)return failure;
    if(input?.siteId!==undefined&&Number(input.siteId)!==row.site_id)return denied();
    if(method==='GET')return null;
    if(method==='PUT'&&!document[2])return input===undefined?null:input.type===row.type&&input.officeSetup===undefined&&Number(input.siteId)===row.site_id?null:denied();
  }
  const documentAttachment=path.match(/^\/api\/documents\/(\d+)\/attachments\/(\d+)$/);
  if(documentAttachment&&method==='GET'){
    const row=doc(documentAttachment[1]),file=db.prepare('SELECT document_id FROM attachments WHERE id=?').get(Number(documentAttachment[2]));
    return owned(row)||!['tbm','education','work_plan','work_council','safety_meeting','joint_inspection','checklist'].includes(row.type)||file?.document_id!==row.id?denied():null;
  }
  const attachment=path.match(/^\/api\/attachments\/(\d+)$/);
  if(method==='GET'&&attachment)return owned(db.prepare('SELECT d.site_id FROM attachments a JOIN documents d ON d.id=a.document_id WHERE a.id=?').get(Number(attachment[1])));
  return denied();
}

// 제한 관리자의 출역 조회에는 연락처 및 급여 정보를 포함하지 않는다.
export function adminAttendanceRows(req,rows){
  if(!req.adminRestricted)return rows;
  const pick=(row,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
  return rows.map(row=>({...pick(row,['id','name','category','company','occupation','present','day_version','source','units_hundredths','attendance_category','attendance_company','attendance_occupation','days','version','dayVersions']),...(row.units?{units:row.units.map(unit=>pick(unit,['date','units_hundredths','category','company','occupation']))}:{})}));
}

export function adminEquipmentRows(req,rows,attendance=false){
  if(!req.adminRestricted)return rows;
  const pick=(row,keys)=>Object.fromEntries(keys.map(key=>[key,row[key]]));
  const equipment=row=>pick(row,['id','kind','model','registration']);
  return rows.map(row=>attendance?{...pick(row,['id','site_id','equipment_id','date','driver_name','note','version']),equipment_snapshot:equipment(row.equipment_snapshot)}:equipment(row));
}
