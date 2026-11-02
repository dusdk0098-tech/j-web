import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('빈 시험 서식은 외부 파일 없이 열세 개의 인쇄 구역과 빈 기록란을 제공한다',()=>{
  const html=readFileSync(new URL('../public/offline-forms.html',import.meta.url),'utf8');assert.equal((html.match(/<section>/g)||[]).length,13);assert.equal((html.match(/J웹 시험용 빈 서식/g)||[]).length,13);assert.match(html,/@media print/);assert.match(html,/@page\{size:A4;margin:15mm\}/);assert.match(html,/tr\{break-inside:avoid\}/);assert.match(html,/section:last-child\{break-after:auto\}/);assert.doesNotMatch(html,/<script\b|<link\b|<img\b|<iframe\b|\bsrc\s*=|url\s*\(/i);assert.match(html,/공식 서식이나 실제 안전 업무 기록으로 사용할 수 없습니다/);
  const cells=[...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)];assert.ok(cells.length>0);for(const cell of cells)assert.equal(cell[1].trim(),'');
});

test('회의·교육 명단과 일일 기록은 독립된 빈 서식과 설명 가능한 표를 제공한다',()=>{
  const html=readFileSync(new URL('../public/offline-forms.html',import.meta.url),'utf8'),sections=new Map([...html.matchAll(/<section><h2>([^<]+)<\/h2>([\s\S]*?)<\/section>/g)].map(([,title,body])=>[title,body]));
  const required={
    '가상 건설 일용근로계약 기록':['가상 사업주','가상 근로자','가상 사업장 주소','가상 근로자 주소','가상 사업주 연락처','가상 근로자 연락처','근로 시작일','근로 종료일','가상 근무장소','가상 업무','근로 시작 시간','근로 종료 시간','휴게시간','휴일','연차휴가','사회보험','가상 일급','가상 수당','임금 지급일','임금 지급 방법','작성일','사업주 시험 서명','근로자 시험 서명'],
    '가상 작업 전 안전회의':['가상 현장','날짜','진행자','참여 인원','날씨','가상 작업 내용','가상 위험요인','가상 대책','가상 교육 내용','교육 사진 부착란'],
    '가상 작업 전 안전회의 참여자 명단':['가상 현장','날짜','가상 작업 내용','가상 성명','소속','직종','시험 서명'],
    '가상 안전교육 기록':['가상 현장','날짜','교육 종류','진행자','교육 장소','교육 대상','시작 시간','종료 시간','교육 시간','참여 인원','교육 방법','사용교재','가상 교육 내용','교육 사진 부착란','교육자료 부착란'],
    '가상 안전교육 참여자 명단':['가상 현장','날짜','교육 종류','교육 장소','가상 성명','소속','직종','시험 서명'],
    '가상 현장 점검 기록':['가상 현장','날짜','점검자','장소','구분','관리자','직영 근로자','외주 근로자','합계','당일','누계','가상 점검 항목','점검 시간','가상 위험 상황','시험 판정','가상 조치 내용','가상 회의','가상 행사','기타 활동','가상 지시사항','점검 사진 부착란'],
    '가상 순회 점검 일지':['가상 현장','점검일','점검자','장소','가상 점검 항목','주요 점검사항','시험 결과','가상 개선대책','가상 특기사항','가상 안전 지시사항','점검 사진 부착란'],
    '가상 보호구 지급대장':['가상 현장','지급일','담당자','번호','가상 성명','소속','직종','보호구 품목','수량','시험 서명'],
    '가상 출역일보':['가상 현장','출역일','작성자','총 출역 인원','가상 성명','소속','직종','가상 작업 내용','시험 확인','시험 서명'],
    '가상 안전업무일지':['가상 현장','기록일','점검일','점검자','날씨','가상 작업 내용','관리자','직영 근로자','외주 근로자','합계','가상 점검 항목','시험 점검 결과','가상 조치 내용','시험 확인'],
    '가상 안전업무일지 세부 기록':['가상 현장','기록일','가상 당일 업무','가상 다음 날 계획','가상 공지사항','가상 안전교육 및 회의','교육 구분','교육 인원','교육 시간','가상 교육 특기사항','안전용품 반입','시험 검수','점검 종류','점검 주체','참여자','시험 점검 결과','가상 지적사항','가상 사고 개요','가상 조치 내용'],
  };
  for(const [title,fields] of Object.entries(required)){
    const section=sections.get(title);assert.ok(section,title);const headers=[...section.matchAll(/<th scope="(?:row|col)">([^<]+)<\/th>/g)].map(([,text])=>text);for(const field of fields)assert.ok(headers.includes(field),`${title}: ${field}`);
    for(const [,table] of section.matchAll(/<table>([\s\S]*?)<\/table>/g)){
      assert.match(table,/<caption>[^<]+<\/caption>/);assert.doesNotMatch(table,/<th>/);
      const widths=[...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([,row])=>[...row.matchAll(/<t[hd]\b([^>]*)>/g)].reduce((sum,[,attributes])=>sum+Number(attributes.match(/colspan="(\d+)"/)?.[1]||1),0));assert.ok(widths[0]>0);assert.equal(new Set(widths).size,1,`${title}: 표 행의 열 수`);
    }
  }
  for(const title of ['가상 작업 전 안전회의 참여자 명단','가상 안전교육 참여자 명단'])assert.match(sections.get(title),/<thead>[\s\S]*?<\/thead><tbody>[\s\S]*?<\/tbody>/);
});

test('시험 서버는 별도 저장 가능한 서식과 제한된 페이지별 정책을 제공한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-offline-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버 종료');})]);const base=`http://127.0.0.1:${port}`,response=await fetch(`${base}/offline-forms.html`),body=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);assert.match(response.headers.get('content-security-policy'),/style-src 'self' 'unsafe-inline'/);assert.match(body,/오프라인 빈 시험 서식/);const regular=await fetch(`${base}/worker-guide.html`);assert.doesNotMatch(regular.headers.get('content-security-policy'),/unsafe-inline/);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
