import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {safetyCostAmount,bindSafetyCostAmount} from '../public/safety-cost.js';

test('사용금액은 정수 연산으로 계산하고 잘못된 입력을 거부한다',()=>{
  assert.equal(safetyCostAmount('1200','1.25'),'1500');assert.equal(safetyCostAmount('999999999999','99999999'),'99999998999900000001');assert.equal(safetyCostAmount('0','0.001'),'0');
  for(const [price,quantity] of [['-1','1'],['1','1.0000'],['1',''],['1000000000000','1']])assert.throws(()=>safetyCostAmount(price,quantity),/단가와 수량/);
  assert.throws(()=>safetyCostAmount('1','0.5'),/원 단위/);
});

test('입력 화면은 수정할 때마다 같은 금액 또는 오류를 표시한다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("    $('#new-cost').onclick="),end=source.indexOf('\n',start);assert.ok(start>=0);
  const nodes={'#new-cost':{},'#dialog-form [name=unitPrice]':{value:''},'#dialog-form [name=quantity]':{value:''},'#cost-amount':{textContent:''}},context={$:key=>nodes[key],showDialog(){},costCategories:[],esc:String,field:()=>'',today:()=>'',api(){},siteId:1,bindSafetyCostAmount};
  runInNewContext(source.slice(start,end),context);nodes['#new-cost'].onclick();const price=nodes['#dialog-form [name=unitPrice]'],quantity=nodes['#dialog-form [name=quantity]'],output=nodes['#cost-amount'];
  price.value='1200';quantity.value='1.25';quantity.oninput();assert.equal(output.textContent,'1,500원');price.value='1';price.oninput();assert.match(output.textContent,/원 단위/);quantity.value='';quantity.oninput();assert.match(output.textContent,/입력/);
});

test('서버는 계산 모듈을 제공한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-cost-amount-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);const response=await fetch(`http://127.0.0.1:${port}/safety-cost.js`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);assert.match(await response.text(),/export function safetyCostAmount/);}
  finally{if(child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});

test('새 사용내역은 항목을 선택하기 전 첫 분류를 자동 지정하지 않는다',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf("    $('#new-cost').onclick="),end=source.indexOf('\n',start),nodes={'#new-cost':{},'#dialog-form [name=unitPrice]':{value:''},'#dialog-form [name=quantity]':{value:''},'#cost-amount':{textContent:''}};let markup;const context={$:key=>nodes[key],showDialog:(_title,html)=>{markup=html;},costCategories:['분류 하나','분류 둘'],esc:String,field:()=>'',today:()=>'',api(){},siteId:1,bindSafetyCostAmount};runInNewContext(source.slice(start,end),context);nodes['#new-cost'].onclick();assert.match(markup,/<select name="category" required><option value="">항목 선택<\/option><option value="1">/);assert.match(markup,/분류 둘/);
});
