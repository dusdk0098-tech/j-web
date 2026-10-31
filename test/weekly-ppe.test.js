import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { Store } from '../store.js';
import { weeklyPpeMarkup } from '../public/weekly-ppe.js';

test('주간 보호구 품목별 집계는 수량과 서명된 지급 기록을 현장 및 날짜별로 분리한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 현장'}),other=store.createSite({name:'다른 현장'});
    const person=siteId=>store.createWorker({siteId,name:'가상 근로자',category:'직영',company:'가상 업체',occupation:'가상 직종'}),worker=person(site.id),foreign=person(other.id);
    const issue=(siteId,workerId,date,item,quantity)=>store.addPpeIssue({siteId,workerId,date,item,quantity});
    const signed=issue(site.id,worker.id,'2024-02-29','가상 안전모','3');
    issue(site.id,worker.id,'2024-02-29','가상 안전모','2');
    issue(site.id,worker.id,'2024-03-01','가상 안전모','4');
    issue(site.id,worker.id,'2024-03-01','<가상 장갑>','1');
    issue(site.id,worker.id,'2024-03-05','가상 안전모','9');
    issue(other.id,foreign.id,'2024-02-29','가상 안전모','7');
    const png=new PNG({width:1,height:1});png.data[3]=255;
    const signature=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    const version=store.workerPpeIssues(site.id,worker.id).find(row=>row.id===signed).version;
    store.confirmPpeReceipt(site.id,worker.id,signed,version,signature);
    const days=store.weeklyActivity(site.id,'2024-02-27');
    assert.deepEqual(days[2].ppeIssues,[{item:'가상 안전모',quantity:5}]);
    assert.deepEqual(days[2].ppeReceiptsByItem,[{item:'가상 안전모',confirmed:1,total:2}]);
    assert.deepEqual(days[2].ppeReceipts,{confirmed:1,total:2});
    assert.deepEqual(days[0].ppeReceiptsByItem,[]);
    assert.deepEqual(store.weeklyActivity(other.id,'2024-02-27')[2].ppeReceiptsByItem,[{item:'가상 안전모',confirmed:0,total:1}]);
    const markup=weeklyPpeMarkup(days);
    assert.match(markup,/<td>가상 안전모<\/td><td>9<\/td><td>1 \/ 3건<\/td>/);
    assert.match(markup,/<td>&lt;가상 장갑&gt;<\/td><td>1<\/td><td>0 \/ 1건<\/td>/);
    assert.doesNotMatch(markup,/<가상 장갑>/);
    assert.match(weeklyPpeMarkup(store.weeklyActivity(other.id,'2024-03-10')),/지급 기록이 없습니다/);
    const current=store.workerPpeIssues(site.id,worker.id).find(row=>row.id===signed);
    store.updatePpeIssue(signed,{siteId:site.id,workerId:worker.id,date:'2024-02-29',item:'가상 안전모',quantity:'4',expectedVersion:current.version});
    assert.deepEqual(store.weeklyActivity(site.id,'2024-02-27')[2].ppeReceiptsByItem,[{item:'가상 안전모',confirmed:0,total:2}]);
  }finally{store.close();}
});
