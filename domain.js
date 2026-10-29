import { riskScaleOptions, riskScore } from './public/risk-scale.js';

export const types = {
  notice: '유해·위험 공지', tbm: 'TBM', education: '안전 교육 서류',
  inspection: '안전 점검 일지', patrol: '순회 점검 일지', safety_log: '안전 업무 일지',
  basic: '안전 기본 서류', checklist: '체크리스트', work_plan: '작업 계획서',
  permit: '작업 허가서', instruction: '작업 지시서', cost: '산업안전보건관리비',
  incident: '재해 발생 보고서', risk: '위험성평가', safety_meeting: '안전간담회', work_council: '노사협의체', joint_inspection: '합동 안전점검 일지', daily_report: '작업일보',
  site_photo: '현장사진', partner: '협력사 관리', archive: '현장별 자료실',
  attendance: '출역 관리', meal: '식대 관리', wage: '노임 명세서', ppe: '보호구 지급'
};

export const transitions = {
  draft: { submit: 'pending' },
  pending: { approve: 'approved', reject: 'rejected', withdraw: 'draft' },
  rejected: { revise: 'draft' },
  approved: {}
};
export const permitKinds=['가설공사(1.5m이상)','토목공사','건축공사','철골구조물 공사','습식공사(미장/방수)','금속창호공사','마감공사(내부/외부)','설비공사(전기/통신/소방)','추락위험작업(2m이상)','낙하위험작업','전도위험작업','붕괴위험작업','화재,특별위험작업','유해위험물취급작업(중독)','유해위험기계기구작업(협착/절단)','차량계 하역운반기계','차량계 건설기계 사용작업','중량물의 취급작업(기중기/인력)','관리대상물질취급작업','굴착작업(1.5m이상)','건물 해체작업','타워크레인 설치·조립·해체','화학설비 사용작업','특고압작업','터널굴착작업','교량 설치·해체·변경작업','채석작업','궤도설비보수·점검작업','열차 입환작업','화기작업','밀폐공간작업'];

export function text(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${name}을 확인해 주세요.`);
  return value.trim();
}

export function dateValue(value) {
  const date = text(value, '날짜');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('날짜를 확인해 주세요.');
  return date;
}

export function recordInput(input) {
  const type = text(input.type, '문서 유형');
  if (!Object.hasOwn(types, type)) throw new Error('지원하지 않는 문서 유형입니다.');
  const date = dateValue(input.date);
  let details = {};
  if(type==='checklist'){
    const value=input.details??{};if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('체크리스트를 확인해 주세요.');const kind=value.kind??'';if(!['','rain','wind','thaw','heat','cold','wet_season','heavy_rain','electrical','fire','formwork','falling','confined','excavation','semiannual','morning','afternoon','evening'].includes(kind))throw new Error('체크리스트 종류를 확인해 주세요.');details.kind=kind;
    if(['wind','thaw','heat','cold','wet_season','heavy_rain','electrical','fire','formwork','falling','confined','excavation'].includes(kind)){const answers=value.answers,lengths={wind:9,thaw:15,heat:8,cold:10,wet_season:6,heavy_rain:11,electrical:12,fire:5,formwork:7,falling:8,confined:4,excavation:8};if(!Array.isArray(answers)||answers.length!==lengths[kind])throw new Error('체크리스트 문항을 확인해 주세요.');details.answers=answers.map((item,i)=>{const na=kind==='heat'?[2,5,6,7].includes(i):kind==='heavy_rain'?i>0:true;if(!item||!['','O','X',...(na?['해당없음']:[])].includes(item.answer)||typeof item.note!=='string'||item.note.length>1000)throw new Error('체크리스트 답변을 확인해 주세요.');return {answer:item.answer,note:item.note.trim()};});}
    if(kind==='rain'){const answers=value.answers;if(!Array.isArray(answers)||answers.length!==7)throw new Error('체크리스트 문항을 확인해 주세요.');details.answers=answers.map((item,i)=>{if(!item||!['','O','X',...(i>=2?['해당없음']:[])].includes(item.answer)||typeof item.note!=='string'||item.note.length>1000)throw new Error('체크리스트 답변을 확인해 주세요.');return {answer:item.answer,note:item.note.trim()};});}
    if(kind==='semiannual'){const answers=value.answers;if(!Array.isArray(answers)||answers.length!==11)throw new Error('체크리스트 문항을 확인해 주세요.');details.answers=answers.map((item,i)=>{if(!item||typeof item.answer!=='string'||item.answer.length>2000||typeof item.note!=='string'||item.note.length>1000||![0,1,2,10].includes(i)&&!['','예','아니오'].includes(item.answer))throw new Error('체크리스트 답변을 확인해 주세요.');return {answer:item.answer.trim(),note:item.note.trim()};});}
    if(kind==='morning'){const answers=value.answers;if(!Array.isArray(answers)||answers.length!==9)throw new Error('체크리스트 문항을 확인해 주세요.');details.answers=answers.map((item,i)=>{if(!item||typeof item.answer!=='string'||item.answer.length>2000||typeof item.note!=='string'||item.note.length>1000)throw new Error('체크리스트 답변을 확인해 주세요.');if([1,2,3,4,6].includes(i)&&!['','O','X',...(i===6?['해당없음']:[])].includes(item.answer))throw new Error('체크리스트 답변을 확인해 주세요.');if(i===5&&item.answer!=='')throw new Error('사진은 첨부파일로 등록해 주세요.');return {answer:item.answer.trim(),note:item.note.trim()};});}
    if(['afternoon','evening'].includes(kind)){const answers=value.answers,length=kind==='afternoon'?7:10,textIndices=kind==='afternoon'?[0,6]:[9],naIndices=kind==='afternoon'?[4]:[4,5,6,7];if(!Array.isArray(answers)||answers.length!==length)throw new Error('체크리스트 문항을 확인해 주세요.');details.answers=answers.map((item,i)=>{if(!item||typeof item.answer!=='string'||item.answer.length>2000||typeof item.note!=='string'||item.note.length>1000||!textIndices.includes(i)&&!['','O','X',...(naIndices.includes(i)?['해당없음']:[])].includes(item.answer))throw new Error('체크리스트 답변을 확인해 주세요.');return {answer:item.answer.trim(),note:item.note.trim()};});}
  }
  if(type==='basic'){
    const value=input.details??{};if(!value||typeof value!=='object'||Array.isArray(value)||typeof (value.category??'')!=='string'||(value.category??'').length>200||value.shared!==undefined&&typeof value.shared!=='boolean')throw new Error('기본 서류 분류와 공유 범위를 확인해 주세요.');details.category=(value.category??'').trim();details.shared=value.shared??false;
  }
  if(type==='safety_log'){
    const value=input.details??{};if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('안전 업무 일지 항목을 확인해 주세요.');
    for(const key of ['weather','todayWork','tomorrowWork','notices','training','inspection','notes','supplies','inspectionKind','inspector','participants','inspectionResult','findings']){const v=value[key]??'';if(typeof v!=='string'||v.length>4000)throw new Error('안전 업무 일지 항목을 확인해 주세요.');details[key]=v.trim();}
    if(details.inspectionKind&&!['수시점검','장비점검','가시설점검','특별점검','합동점검(자율안전)','정기점검','발주처점검','외주점검'].includes(details.inspectionKind))throw new Error('안전점검 종류를 확인해 주세요.');
  }
  if(type==='patrol'){
    const value=input.details??{};if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('순회 점검 항목을 확인해 주세요.');
    for(const key of ['other','notes','instruction']){const v=value[key]??'';if(typeof v!=='string'||v.length>2000)throw new Error('순회 점검 항목을 확인해 주세요.');details[key]=v.trim();}
    const items=value.items??[];if(!Array.isArray(items)||items.length>100)throw new Error('순회 점검 내용을 확인해 주세요.');details.items=items.map(item=>{if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>500||!['O','X','해당없음'].includes(item.result)||typeof item.note!=='string'||item.note.length>2000)throw new Error('순회 점검 내용을 확인해 주세요.');return {name:item.name.trim(),result:item.result,note:item.note.trim()};});
  }
  if(type==='inspection'){
    const value=input.details??{};if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('안전 점검 항목을 확인해 주세요.');
    for(const key of ['meeting','event','other','instruction']){const v=value[key]??'';if(typeof v!=='string'||v.length>2000)throw new Error('안전 점검 항목을 확인해 주세요.');details[key]=v.trim();}
    const rows=value.rows??[];if(!Array.isArray(rows)||rows.length>100)throw new Error('안전 점검 내용을 확인해 주세요.');
    details.rows=rows.map(row=>{if(!row||typeof row!=='object')throw new Error('안전 점검 내용을 확인해 주세요.');const result={};for(const key of ['inspector','hazard','action']){const v=row[key]??'';if(typeof v!=='string'||v.length>2000)throw new Error('안전 점검 내용을 확인해 주세요.');result[key]=v.trim();}if(!result.inspector||!result.hazard)throw new Error('점검자와 불안전 상태를 입력해 주세요.');for(const key of ['timeFrom','timeTo']){const v=row[key]??'';if(typeof v!=='string'||v&&!/^(?:[01]\d|2[0-3]):(?:00|05|10|15|20|25|30|35|40|45|50|55)$|^24:00$/.test(v))throw new Error('점검시간을 확인해 주세요.');result[key]=v;}if((result.timeFrom||result.timeTo)&&(!result.timeFrom||!result.timeTo||result.timeFrom>=result.timeTo))throw new Error('점검시간을 확인해 주세요.');return result;});
  }
  if(['safety_meeting','work_council','joint_inspection'].includes(type)){
    const value=input.details??{};if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('안전간담회 항목을 확인해 주세요.');
    for(const key of ['place','remarks']){if(typeof (value[key]??'')!=='string'||(value[key]??'').length>2000)throw new Error('안전간담회 항목을 확인해 주세요.');details[key]=(value[key]??'').trim();}
    for(const key of ['timeFrom','timeTo']){const time=value[key]??'';if(typeof time!=='string'||time&&!/^(?:[01]\d|2[0-3]):(?:00|05|10|15|20|25|30|35|40|45|50|55)$|^24:00$/.test(time))throw new Error('회의시간을 확인해 주세요.');details[key]=time;}
    if((details.timeFrom||details.timeTo)&&(!details.timeFrom||!details.timeTo||details.timeFrom>=details.timeTo))throw new Error('회의시간을 확인해 주세요.');
    const ids=value.workerIds??[];if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)throw new Error('참석자를 확인해 주세요.');details.workerIds=ids;
    if(type!=='joint_inspection'){const names=value.employerParticipants??[];if(!Array.isArray(names)||names.length>100||names.some(name=>typeof name!=='string'||!name.trim()||name.trim().length>200||/[\x00-\x1f\x7f]/.test(name)))throw new Error('사용자 측 참석자를 확인해 주세요.');details.employerParticipants=names.map(name=>name.trim());}
    if(type==='work_council'){
      if(!['임시 회의','정기 회의'].includes(value.kind))throw new Error('회의 종류를 확인해 주세요.');details.kind=value.kind;
      for(const key of ['host','decisions','discussion']){if(typeof (value[key]??'')!=='string'||(value[key]??'').length>2000)throw new Error('노사협의체 항목을 확인해 주세요.');details[key]=(value[key]??'').trim();}
    }
    if(type==='joint_inspection'){
      for(const key of ['improvements','result','other']){if(typeof (value[key]??'')!=='string'||(value[key]??'').length>2000)throw new Error('합동 점검 항목을 확인해 주세요.');details[key]=(value[key]??'').trim();}
      const items=value.items??[];if(!Array.isArray(items)||items.length>100)throw new Error('점검 항목을 확인해 주세요.');
      details.items=items.map(item=>{if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>500||!['양호','보완사항','N/A'].includes(item.result))throw new Error('점검 항목을 확인해 주세요.');return {name:item.name.trim(),result:item.result};});
    }
  }
  if(type==='work_plan'){
    const value=input.details ?? {};
    if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('작업계획서 항목을 확인해 주세요.');
    for(const key of ['company','personnel','place','equipment','hazards','measures']){
      if(value[key]!==undefined && (typeof value[key]!=='string' || value[key].length>2000))throw new Error('작업계획서 항목을 확인해 주세요.');
      details[key]=(value[key] ?? '').trim();
    }
    for(const key of ['routeDescription','workSequence'])if(value[key]!==undefined){
      if(typeof value[key]!=='string'||value[key].length>4000)throw new Error('운행경로와 작업순서를 확인해 주세요.');
      details[key]=value[key].trim();
    }
    for(const key of ['consultedAt','periodFrom','periodTo']){
      if(value[key]!==undefined && typeof value[key]!=='string')throw new Error('작업계획서 날짜를 확인해 주세요.');
      details[key]=value[key]?dateValue(value[key]):'';
    }
    if(details.periodFrom && details.periodTo && details.periodFrom>details.periodTo)throw new Error('작업기간을 확인해 주세요.');
    if(value.workKinds!==undefined){const allowed=['차량계 건설기계','차량계 하역운반기계','중량물 취급','기타'];if(!Array.isArray(value.workKinds)||value.workKinds.some(kind=>!allowed.includes(kind))||new Set(value.workKinds).size!==value.workKinds.length)throw new Error('작업구분을 확인해 주세요.');details.workKinds=value.workKinds;}
    if(value.timeFrom!==undefined||value.timeTo!==undefined){
      const from=value.timeFrom??'',to=value.timeTo??'',valid=time=>typeof time==='string'&&/^(?:[01]\d|2[0-3]):(?:00|30)$|^24:00$/.test(time);
      if((from||to)&&(!valid(from)||!valid(to)||!details.periodFrom||!details.periodTo||details.periodFrom===details.periodTo&&from>to))throw new Error('작업시간을 확인해 주세요.');
      if(typeof from!=='string'||typeof to!=='string')throw new Error('작업시간을 확인해 주세요.');details.timeFrom=from;details.timeTo=to;
    }
    if(value.equipmentIds!==undefined){
      if(!Array.isArray(value.equipmentIds) || value.equipmentIds.length>100 || value.equipmentIds.some(id=>!Number.isSafeInteger(id) || id<1) || new Set(value.equipmentIds).size!==value.equipmentIds.length)throw new Error('장비 선택을 확인해 주세요.');
      details.equipmentIds=value.equipmentIds;
    }
    if(value.workPlaceId!==undefined){if(!Number.isSafeInteger(value.workPlaceId) || value.workPlaceId<0)throw new Error('작업장소를 확인해 주세요.');details.workPlaceId=value.workPlaceId;}
    if(value.riggingIds!==undefined){if(!Array.isArray(value.riggingIds)||value.riggingIds.length>100||value.riggingIds.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(value.riggingIds).size!==value.riggingIds.length)throw new Error('장구 선택을 확인해 주세요.');details.riggingIds=value.riggingIds;}
    if(value.workers!==undefined){
      if(!Array.isArray(value.workers)||value.workers.length>100)throw new Error('작업자 항목을 확인해 주세요.');
      details.workers=value.workers.map(row=>{
        if(!row||!Number.isSafeInteger(row.workerId)||row.workerId<1||!['운전원','유도자','작업지휘자'].includes(row.role)||typeof row.training!=='string'||row.training.length>500||typeof row.qualification!=='string'||row.qualification.length>500)throw new Error('작업자 항목을 확인해 주세요.');
        return {workerId:row.workerId,role:row.role,training:row.training.trim(),qualification:row.qualification.trim()};
      });
    }
  }
  if(type==='incident'){
    const value=input.details??{};if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('재해 보고서 항목을 확인해 주세요.');
    const fields=['severity','recipient','sender','contractor','contractorRepresentative','subcontractor','subcontractorRepresentative','siteName','siteAddress','client','constructionType','constructionAmount','workerCount','progress','technicalGuidance','preventionPlan','occurredAt','location','incidentType','causeObject','circumstances','measures','other','prevention'];
    for(const key of fields)if(value[key]!==undefined){if(typeof value[key]!=='string'||value[key].length>2000)throw new Error('재해 보고서 항목을 확인해 주세요.');details[key]=value[key].trim();}
    if(details.severity&&!['불휴상','경상','중상','사망'].includes(details.severity))throw new Error('사고유형을 확인해 주세요.');
    if(details.technicalGuidance&&!['계약','미계약','해당없음'].includes(details.technicalGuidance))throw new Error('기술지도관계를 확인해 주세요.');
    if(details.preventionPlan&&!['대상','비대상'].includes(details.preventionPlan))throw new Error('방지계획서관계를 확인해 주세요.');
    if(details.progress&&!/^\d{1,3}(?:\.\d{1,2})?$/.test(details.progress)||details.progress&&Number(details.progress)>100)throw new Error('공정률을 확인해 주세요.');
    for(const key of ['periodFrom','periodTo'])if(value[key]!==undefined){if(typeof value[key]!=='string')throw new Error('공사기간을 확인해 주세요.');details[key]=value[key]?dateValue(value[key]):'';}
    if(details.periodFrom&&details.periodTo&&details.periodFrom>details.periodTo)throw new Error('공사기간을 확인해 주세요.');
    if(value.victims!==undefined){if(!Array.isArray(value.victims)||value.victims.length>100)throw new Error('재해자 항목을 확인해 주세요.');details.victims=value.victims.map(row=>{if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('재해자 항목을 확인해 주세요.');const item={};for(const key of ['name','company','occupation','career','outcome','treatment']){if(typeof row[key]!=='string'||row[key].length>2000)throw new Error('재해자 항목을 확인해 주세요.');item[key]=row[key].trim();}if(!item.name||!['부상','사망'].includes(item.outcome))throw new Error('재해자 항목을 확인해 주세요.');if(row.joinedAt!==undefined){if(typeof row.joinedAt!=='string')throw new Error('입사일을 확인해 주세요.');item.joinedAt=row.joinedAt?dateValue(row.joinedAt):'';}return item;});}
    if(value.inspections!==undefined){if(!Array.isArray(value.inspections)||value.inspections.length>100)throw new Error('점검실적을 확인해 주세요.');details.inspections=value.inspections.map(row=>{if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.name!=='string'||!row.name.trim()||row.name.length>200||typeof row.date!=='string')throw new Error('점검실적을 확인해 주세요.');return {name:row.name.trim(),date:dateValue(row.date)};});}
  }
  if(type==='instruction'){
    const value=input.details??{};if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('작업지시서 항목을 확인해 주세요.');
    if(value.companyId!==undefined){if(!Number.isSafeInteger(value.companyId)||value.companyId<0)throw new Error('협력사를 확인해 주세요.');details.companyId=value.companyId;}
    if(value.recipientId!==undefined){if(!Number.isSafeInteger(value.recipientId)||value.recipientId<0)throw new Error('수신 담당자를 확인해 주세요.');details.recipientId=value.recipientId;}
    if(value.recipient!==undefined){if(typeof value.recipient!=='string'||value.recipient.length>200)throw new Error('수신 담당자를 확인해 주세요.');details.recipient=value.recipient.trim();}
  }
  if(type==='permit'){
    const value=input.details??{};if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('작업허가서 항목을 확인해 주세요.');
    if(value.kinds!==undefined){if(!Array.isArray(value.kinds)||value.kinds.some(kind=>!permitKinds.includes(kind))||new Set(value.kinds).size!==value.kinds.length)throw new Error('위험작업 종류를 확인해 주세요.');details.kinds=value.kinds;}
    for(const key of ['company','personnel','place','work']){if(value[key]!==undefined){if(typeof value[key]!=='string'||value[key].length>2000)throw new Error('작업허가서 항목을 확인해 주세요.');details[key]=value[key].trim();}}
    for(const key of ['periodFrom','periodTo']){if(value[key]!==undefined){if(typeof value[key]!=='string')throw new Error('작업기간을 확인해 주세요.');details[key]=value[key]?dateValue(value[key]):'';}}
    if(details.periodFrom&&details.periodTo&&details.periodFrom>details.periodTo)throw new Error('작업기간을 확인해 주세요.');
    if(value.timeFrom!==undefined||value.timeTo!==undefined){const from=value.timeFrom??'',to=value.timeTo??'',valid=time=>typeof time==='string'&&/^(?:[01]\d|2[0-3]):(?:00|30)$|^24:00$/.test(time);if(typeof from!=='string'||typeof to!=='string'||(from||to)&&(!valid(from)||!valid(to)||!details.periodFrom||!details.periodTo||details.periodFrom===details.periodTo&&from>to))throw new Error('작업시간을 확인해 주세요.');details.timeFrom=from;details.timeTo=to;}
  }
  if(type==='education'){
    const value=input.details ?? {};
    if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('교육 항목을 확인해 주세요.');
    const kinds=['new','regular','risk','special','changed','supervisor','msds','other'];
    if(value.kind!==undefined && value.kind!=='' && !kinds.includes(value.kind))throw new Error('교육 종류를 확인해 주세요.');
    for(const key of ['kind','otherTitle','audience']){
      if(value[key]!==undefined){if(typeof value[key]!=='string' || value[key].length>2000)throw new Error('교육 항목을 확인해 주세요.');details[key]=value[key].trim();}
    }
    if(details.kind==='other' && !details.otherTitle)throw new Error('기타 교육명을 입력해 주세요.');
  }
  if (type === 'daily_report') {
    const value = input.details ?? {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('작업일보 항목을 확인해 주세요.');
    for (const key of ['weather','todayWork','tomorrowWork','remarks']) {
      if (value[key] != null && (typeof value[key] !== 'string' || value[key].length > 2000)) throw new Error('작업일보 항목을 확인해 주세요.');
      details[key] = (value[key] ?? '').trim();
    }
    for (const key of ['labor','equipment','materials']) {
      const rows=value[key] ?? [];
      if (typeof rows==='string') {if(rows.length>2000) throw new Error('작업일보 항목을 확인해 주세요.');details[key]=rows;continue;}
      if (!Array.isArray(rows) || rows.length>100) throw new Error('작업일보 항목을 확인해 주세요.');
      details[key]=rows.map(row=>{
        if (!row || typeof row!=='object' || Array.isArray(row) || typeof row.name!=='string' || !row.name.trim() || row.name.length>200 || typeof row.quantity!=='string' || row.quantity.length>100) throw new Error('인력·장비·자재의 항목과 수량을 확인해 주세요.');
        return {name:row.name.trim(),quantity:row.quantity.trim()};
      });
    }
    const progress = value.progress ?? '';
    if (typeof progress !== 'string' || (progress !== '' && (!/^\d+(\.\d{1,2})?$/.test(progress) || Number(progress)>100))) throw new Error('공정률은 0부터 100 사이로 입력해 주세요.');
    details.progress = progress;
  }
  if (type === 'risk') {
    const value=input.details ?? {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('위험성평가 항목을 확인해 주세요.');
    const validate=item=>{
      if(!item || typeof item!=='object' || Array.isArray(item)) throw new Error('위험성평가 항목을 확인해 주세요.');
      const row={};for(const key of ['task','hazard','existingMeasures','additionalMeasures']){
        if(item[key]!=null && (typeof item[key]!=='string' || item[key].length>2000)) throw new Error('위험성평가 항목을 확인해 주세요.');
        row[key]=(item[key] ?? '').trim();
      }
      for(const key of ['riskCategory','riskType','legalBasis','responsible']){
        if(item[key]!==undefined){if(typeof item[key]!=='string' || item[key].length>2000)throw new Error('위험성평가 항목을 확인해 주세요.');row[key]=item[key].trim();}
      }
      for(const key of ['grade','likelihood','severity'])if(item[key]!==undefined){
        if(typeof item[key]!=='string')throw new Error('위험성 척도 입력을 확인해 주세요.');
        const v=item[key],scale=value.scale||'';
        if(v&&!riskScaleOptions(scale,key).includes(v))throw new Error('위험성 척도 입력을 확인해 주세요.');
        row[key]=v;
      }
      const score=riskScore(value.scale||'',row.likelihood,row.severity);if(score!==null)row.score=score;
      for(const key of ['dueDate','completionDate']){
        if(item[key]!==undefined){if(typeof item[key]!=='string')throw new Error('위험성평가 날짜를 확인해 주세요.');row[key]=item[key]?dateValue(item[key]):'';}
      }
      return row;
    };
    if(value.items!==undefined){if(!Array.isArray(value.items) || value.items.length>100)throw new Error('위험성평가 항목을 확인해 주세요.');details.items=value.items.map(validate);}
    else details=validate(value);
    if(value.kind!==undefined && value.kind!==''){
      if(!['initial','regular','occasional','continuous'].includes(value.kind))throw new Error('위험성평가 종류를 확인해 주세요.');
      details.kind=value.kind;
    }
    if(value.scale!==undefined && value.scale!==''){
      if(!['three-level','3x3','5x4'].includes(value.scale))throw new Error('위험성평가 척도를 확인해 주세요.');
      details.scale=value.scale;
    }
    for(const key of ['periodFrom','periodTo']){
      if(value[key]!==undefined){if(typeof value[key]!=='string')throw new Error('관리기간을 확인해 주세요.');details[key]=value[key]?dateValue(value[key]):'';}
    }
    if(details.periodFrom && details.periodTo && details.periodFrom>details.periodTo)throw new Error('관리기간 시작일은 종료일보다 늦을 수 없습니다.');
  }
  const body = input.body ?? '';
  if (typeof body !== 'string' || body.length > 20000) throw new Error('문서 내용은 20,000자 이내로 입력해 주세요.');
  return { type, siteId: Number(input.siteId), title: text(input.title, '제목'), date, body, details };
}
