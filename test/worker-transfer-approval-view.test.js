import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('결재 교육 명단과 보존된 서명은 전환 전 기록자를 안전하게 표시한다',()=>{
 const review=readFileSync(new URL('../public/review.js',import.meta.url),'utf8'),start=review.indexOf('function planLinks('),end=review.indexOf('async function openEquipmentCheck(',start),context={esc};assert.ok(start>=0&&end>start);runInNewContext(review.slice(start,end),context);
 const worker={id:3,name:'대상',company:'가상',daily_confirmed:1,daily_has_signature:1,transferOrigin:{name:'<원래 작성자>'}},check={name:'대상',company:'가상',created_at:'가상 시각',transferOrigin:{name:'<이전 확인자>'}},linked={type:'training',configured:true,workers:[worker],checks:[check]};
 const html=context.planLinks(1,linked,true);assert.match(html,/전환 전 기록자: &lt;원래 작성자&gt;/);assert.match(html,/전환 전 기록자: &lt;이전 확인자&gt;/);assert.doesNotMatch(html,/<원래 작성자>/);
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),a=app.indexOf('function capturedFiles('),b=app.indexOf('async function renderDetail(',a),admin={esc};assert.ok(a>=0&&b>a);runInNewContext(app.slice(a,b),admin);const captured=admin.capturedFiles({documentId:1,id:2,attachments:[],linked:{type:'training',signedWorkers:[worker]}});assert.match(captured,/전환 전 기록자: &lt;원래 작성자&gt;/);assert.doesNotMatch(captured,/<원래 작성자>/);
});
