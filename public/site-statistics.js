export function summarizeSiteAttendance(rows){
  const summarize=categories=>({
    direct:categories.filter(item=>item.label==='직영').reduce((sum,item)=>sum+item.days,0),
    external:categories.filter(item=>item.label==='외주').reduce((sum,item)=>sum+item.days,0),
    other:categories.filter(item=>item.label!=='직영'&&item.label!=='외주'),
    total:categories.reduce((sum,item)=>sum+item.days,0)
  });
  const categories=new Map();for(const row of rows)for(const item of row.categories)categories.set(item.label,(categories.get(item.label)||0)+item.days);
  return {sites:rows.map(row=>({...row,...summarize(row.categories)})),totals:summarize([...categories].map(([label,days])=>({label,days})))};
}
