import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Store } from '../store.js';
import { scheduleTimeOptions, validScheduleTime } from '../public/schedule.js';

test('실제 일정 폼의 시간 렌더러는 24:00과 기존 분 값을 선택한 상태로 만든다',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),line=source.split('\n').find(line=>line.includes('const timeField=')&&line.includes('scheduleTimeOptions(value)'));
  assert.ok(line);
  const render=runInNewContext(`${line}\ntimeField`,{scheduleTimeOptions,esc:String});
  for(const value of ['','09:17','24:00']){
    const html=render('startTime','시작 시각',value);
    assert.ok(html.includes(`<option value="${value}" selected>`));assert.ok(html.includes('<select name="startTime">'));
    assert.ok(!html.includes('type="time"'));assert.equal((html.match(/ selected>/g)||[]).length,1);
  }
  assert.ok(source.includes("timeField('startTime'"));assert.ok(source.includes("timeField('endTime'"));
});

test('시간 선택은 미지정, 10분 간격, 24:00과 기존 분 값을 손실 없이 제공한다',()=>{
  const values=scheduleTimeOptions();
  assert.equal(values.length,146);assert.equal(values[0],'');assert.equal(values.at(-1),'24:00');
  for(let minute=0;minute<1440;minute+=10)assert.ok(values.includes(`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`));
  for(const value of ['00:01','09:17','23:59']){assert.equal(scheduleTimeOptions(value).filter(item=>item===value).length,1);assert.equal(validScheduleTime(value),true);}
  assert.equal(scheduleTimeOptions('24:00').length,146);
  for(const value of ['24:01','24:10','24:50','25:00','9:00','00:60',null,0,'<script>']){assert.equal(validScheduleTime(value),false);assert.throws(()=>scheduleTimeOptions(value));}
});

test('24:00 경계·역날짜·월 포함·저장 순서와 기존 분 수정은 날짜 기준 호환을 유지한다',()=>{
  const store=new Store(':memory:');
  try{
    const site=store.createSite({name:'가상 시간 시험'}),person=store.createReviewer({siteId:site.id,loginId:'virtual_time',name:'가상 시간 대상',password:'virtual-password-123'});
    const input={siteId:site.id,kind:'회의',startDate:'2026-10-31',endDate:'2026-10-31',startTime:'09:17',endTime:'24:00',content:'가상 자정 일정',targetId:person.id};
    const row=store.saveSchedule(input);assert.equal(row.start_time,'09:17');assert.equal(row.end_time,'24:00');
    const edited=store.saveSchedule({...input,content:'가상 내용 수정'},row.id);assert.equal(edited.start_time,'09:17');assert.equal(edited.end_time,'24:00');
    assert.deepEqual(store.schedules(site.id,'2026-10').map(r=>r.id),[row.id]);assert.deepEqual(store.schedules(site.id,'2026-11'),[]);
    assert.equal(store.reviewerSchedules(person.id,'2026-10')[0].end_time,'24:00');
    const midnight=store.saveSchedule({...input,startTime:'24:00',endDate:'2026-11-01',endTime:'00:00'});
    assert.deepEqual(store.schedules(site.id,'2026-11').map(r=>r.id),[midnight.id]);
    const next=store.saveSchedule({...input,startDate:'2026-11-01',endDate:'2026-11-01',startTime:'00:00',endTime:'00:00'});
    assert.deepEqual(store.schedules(site.id,'2026-11').map(r=>r.id),[midnight.id,next.id]);
    assert.equal(store.saveSchedule({...input,startTime:'24:00',endTime:'24:00'}).start_time,'24:00');
    assert.equal(store.saveSchedule({...input,startTime:'',endTime:'24:00'}).start_time,'');
    for(const change of [{startTime:'24:00',endTime:'23:59'},{startTime:'24:00',endTime:'00:00'},{startDate:'2026-11-01',startTime:'00:00',endTime:'24:00'},{endTime:'24:10'},{endTime:'24:50'}])assert.throws(()=>store.saveSchedule({...input,...change}),/기간과 시간/);
    const leap=store.saveSchedule({...input,startDate:'2024-02-29',endDate:'2024-03-01',startTime:'24:00',endTime:'00:00'});assert.equal(leap.end_time,'00:00');
    const year=store.saveSchedule({...input,startDate:'2026-12-31',endDate:'2027-01-01',startTime:'24:00',endTime:'00:00'});assert.equal(year.start_time,'24:00');
  }finally{store.close();}
});
