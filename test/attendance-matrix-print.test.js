import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {attendanceMatrix,attendanceMatrixMarkup} from '../public/attendance-matrix.js';

const dates=['2024-02-28','2024-02-29'],rows=[{units:[{date:dates[0],category:'직영',company:'<가상 소속>',occupation:'가상 직종'},{date:dates[1],category:'직영',company:'가상 업체',occupation:'가상 직종'}]}];
test('월별 집계 미리보기는 선택한 표만 출력하고 명칭을 이스케이프한다',()=>{
 const all=attendanceMatrixMarkup(rows,dates),one=attendanceMatrixMarkup(rows,dates,'company');assert.match(all,/data-matrix-preview="company"/);assert.match(one,/&lt;가상 소속&gt;/);assert.doesNotMatch(one,/<가상 소속>|data-matrix-preview|월별 직종 출역/);assert.match(one,/월별 소속 출역/);
});
function setup(){
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('function showAttendanceMatrixPrint('),end=source.indexOf('async function showSiteAttendanceDetail(',start);assert.ok(start>=0&&end>start);
 let resolve;const waiting=new Promise(r=>{resolve=r;}),state={active:true},nodes={'#dialog-form':{},'#dialog-form button[type=submit]':{},'#matrix-print':{disabled:false},'#matrix-print-status':{}},calls=[],prints=[],dialogs=[],dialog={open:false,close(){this.open=false;}},context={attendanceMatrix,attendanceMatrixMarkup,siteSelect:{selectedOptions:[{textContent:'<가상 현장>'}]},esc:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),$:key=>nodes[key],dialog,window:{print:()=>prints.push(true)},api:(path,options,current)=>{calls.push({path,current});return waiting;},encodeURIComponent,showDialog:(title,html)=>{dialogs.push({title,html});dialog.open=true;}};
 runInNewContext(source.slice(start,end),context);return {...context,state,resolve,calls,prints,dialogs,nodes};
}
test('인쇄 전에 같은 현장과 월의 집계를 다시 확인한다',async()=>{
 const ui=setup();ui.showAttendanceMatrixPrint('company',7,'2024-02',dates,rows,()=>ui.state.active);assert.match(ui.dialogs[0].html,/&lt;가상 현장&gt;/);const task=ui.nodes['#matrix-print'].onclick();await ui.nodes['#matrix-print'].onclick();assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].path,'/api/attendance/month?siteId=7&month=2024-02');ui.resolve(rows);await task;assert.equal(ui.prints.length,1);
 const changed=setup();changed.showAttendanceMatrixPrint('company',7,'2024-02',dates,rows,()=>changed.state.active);const pending=changed.nodes['#matrix-print'].onclick();changed.resolve([{units:[]}]);await pending;assert.equal(changed.prints.length,0);assert.match(changed.nodes['#matrix-print-status'].textContent,/변경/);
 const stale=setup();stale.showAttendanceMatrixPrint('company',7,'2024-02',dates,rows,()=>stale.state.active);const old=stale.nodes['#matrix-print'].onclick();stale.state.active=false;stale.resolve(rows);await old;assert.equal(stale.prints.length,0);
});
