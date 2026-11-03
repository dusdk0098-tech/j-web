import test from 'node:test';
import assert from 'node:assert/strict';
import { instructionRecipientAudit } from '../public/instruction-recipients.js';
import { mountInstructionRecipientAudit } from '../public/instruction-recipient-audit.js';

test('기존 수신자 비교는 현재 정보가 다르거나 확인 불가능한 기록을 반환한다',()=>{
  const make=(id,details)=>({id,title:`가상 ${id}`,date:'2026-01-01',status:'approved',details});
  const docs=[make(1,JSON.stringify({recipientId:1,companyId:1})),make(2,JSON.stringify({recipientId:2,companyId:1})),make(3,JSON.stringify({recipientId:3,companyId:1})),make(4,JSON.stringify({recipientId:99,companyId:1})),make(5,JSON.stringify({recipientId:1,companyId:99})),make(6,'{'),make(7,JSON.stringify({recipientId:'bad'})),make(8,'{}')];
  const before=JSON.stringify(docs),rows=instructionRecipientAudit(docs,[{id:1,company_id:1},{id:2,company_id:2},{id:3,company_id:null}],[{id:1}]);
  assert.deepEqual(rows.map(row=>[row.id,row.reason]),[[2,'담당자의 현재 업체가 다름'],[3,'담당자의 등록 업체 미연결'],[4,'현재 담당자 정보 없음'],[5,'현재 등록 업체 정보 없음'],[6,'기록 형식 확인 필요'],[7,'수신자 번호 확인 필요']]);
  assert.equal(JSON.stringify(docs),before);
});

test('조회 화면은 결과를 열고 실패나 화면 변경 시 오래된 결과를 표시하지 않는다',async()=>{
  class Element{constructor(doc){this.ownerDocument=doc;this.children=[];this.isConnected=true;this.textContent='';}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(){}}
  const doc={createElement:()=>new Element(doc)},host=new Element(doc);let current=true,opened=0,fail=false;
  const api=async path=>{if(fail)throw Error('조회 실패');if(path.includes('/documents'))return [{id:7,title:'가상 지시',date:'2026-01-01',details:'{'}];return [];};
  mountInstructionRecipientAudit(host,{siteId:1,api,current:()=>current,onOpen:id=>{opened=id;}});
  const [, ,button,status,list]=host.children[0].children;await button.onclick();assert.equal(list.children.length,1);list.children[0].children[0].onclick();assert.equal(opened,7);
  fail=true;await button.onclick();assert.equal(list.children.length,0);assert.equal(status.textContent,'조회 실패');
  current=false;await button.onclick();assert.equal(list.children.length,0);
});
