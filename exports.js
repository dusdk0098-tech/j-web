import writeExcelFile from 'write-excel-file/node';

export function workerSpreadsheet(workers) {
  const rows=[['이름','구분','소속','직종'],...workers.map(w=>[w.name,w.category,w.company,w.occupation])];
  return writeExcelFile(rows,{sheet:'출입자'}).toBuffer();
}

export function wageSpreadsheet(records) {
  const rows=[['근로자','소속','직종','노임','소득세','주민세','건강보험','요양보험','국민연금','고용보험','공제 합계','차액'],...records.map(r=>[r.name,r.company,r.occupation,r.gross,r.deductions.income,r.deductions.local,r.deductions.health,r.deductions.care,r.deductions.pension,r.deductions.employment,r.total,r.net])];
  return writeExcelFile(rows,{sheet:'가상 노임'}).toBuffer();
}
