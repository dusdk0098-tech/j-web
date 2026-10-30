import writeExcelFile from 'write-excel-file/node';
import { salaryDay } from './public/salary-summary.js';

export function workerSpreadsheet(workers) {
  const rows=[['이름','구분','소속','직종'],...workers.map(w=>[w.name,w.category,w.company,w.occupation])];
  return writeExcelFile(rows,{sheet:'출입자'}).toBuffer();
}

export function wageSpreadsheet(records,month,daily) {
  if(!month||!Array.isArray(daily))throw new Error('날짜별 출역 정보를 확인해 주세요.');
  const rows=[['근로자','소속','직종','노임','소득세','주민세','건강보험','요양보험','국민연금','고용보험','공제 합계','차액','조회 시 출역일','기록된 시험 공수','공수 미기록 일수','시험 일당 계산액 합계','일당 계산 제외 일수','기록 당시 구분'],...records.map(r=>[r.name,r.company,r.occupation,r.gross,r.deductions.income,r.deductions.local,r.deductions.health,r.deductions.care,r.deductions.pension,r.deductions.employment,r.total,r.net,r.attendance_days,r.units_hundredths==null?'미기록':r.units_hundredths/100,r.units_missing,r.estimated_pay==null?'미기록':r.estimated_pay,r.pay_missing,r.category??'기록 없음'])];
  const [year,number]=month.split('-').map(Number),days=new Date(Date.UTC(year,number,0)).getUTCDate(),byWorker=new Map(daily.map(row=>[row.worker_id,new Map(row.days.map(day=>[day.date,day]))]));if(records.some(record=>!byWorker.has(record.worker_id)))throw new Error('날짜별 출역 정보를 확인해 주세요.');for(let day=1;day<=days;day++){const date=`${month}-${String(day).padStart(2,'0')}`;rows[0].push(`${day}일 공수`,`${day}일 시험 계산액`);records.forEach((record,i)=>{const entry=byWorker.get(record.worker_id).get(date);rows[i+1].push(!entry?'미출역':entry.units_hundredths===null?'미기록':entry.units_hundredths/100,!entry?'미출역':entry.estimated_pay===null?'미기록':entry.estimated_pay);});}
  for(let day=1;day<=days;day++){const date=`${month}-${String(day).padStart(2,'0')}`;rows[0].push(`${day}일 시험 급여 종류`,`${day}일 시험 급여 금액`);records.forEach((record,i)=>{const value=salaryDay(byWorker.get(record.worker_id).get(date));rows[i+1].push(value.kind,value.amount);});}
  rows[0].push('기록 당시 가상 생년월일','가상 비고');records.forEach((record,i)=>rows[i+1].push(record.birth_date_snapshot??'미기록',record.remark??'미기록'));
  rows[0].push('노임 입력 방식','출역 기준 상태');records.forEach((record,i)=>rows[i+1].push(record.gross_mode==='attendance'?'출역 기준':'직접 입력',record.gross_status==='changed'?'재확인 필요':record.gross_status==='current'?'확인됨':'해당 없음'));
  rows[0].push('항목별 공제 합계','공제 합계 적용 방식');records.forEach((record,i)=>rows[i+1].push(record.detail_total,record.manual_total===null?'항목 합계':'직접 입력'));
  return writeExcelFile(rows,{sheet:'가상 노임'}).toBuffer();
}
