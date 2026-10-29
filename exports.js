import writeExcelFile from 'write-excel-file/node';

export function workerSpreadsheet(workers) {
  const rows=[['이름','구분','소속','직종'],...workers.map(w=>[w.name,w.category,w.company,w.occupation])];
  return writeExcelFile(rows,{sheet:'출입자'}).toBuffer();
}

export function wageSpreadsheet(records) {
  const rows=[['근로자','소속','직종','노임','소득세','주민세','건강보험','요양보험','국민연금','고용보험','공제 합계','차액','조회 시 출역일','기록된 시험 공수','공수 미기록 일수','시험 계산액 합계','일당 또는 공수 미기록 일수'],...records.map(r=>[r.name,r.company,r.occupation,r.gross,r.deductions.income,r.deductions.local,r.deductions.health,r.deductions.care,r.deductions.pension,r.deductions.employment,r.total,r.net,r.attendance_days,r.units_hundredths==null?'미기록':r.units_hundredths/100,r.units_missing,r.estimated_pay==null?'미기록':r.estimated_pay,r.pay_missing])];
  return writeExcelFile(rows,{sheet:'가상 노임'}).toBuffer();
}
