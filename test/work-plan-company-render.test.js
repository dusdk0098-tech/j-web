import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('실제 render와 검색 버튼 연결은 작업업체 입력을 재표시하고 전환·지연 응답을 처리한다',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),part=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
  const nodes=new Map(),calls=[],errors=[],pending=[],state={admin:{scope:'global'},page:'documents',siteId:1,type:'work_plan',types:{work_plan:'계획',tbm:'TBM'},query:'',documentFrom:'',documentTo:'',workPlanCompany:''};
  const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  function node(){return {value:'',textContent:'',children:[],classList:{toggle(){},remove(){}},setAttribute(){},before(){},after(){},append(){},click(){this.onclick?.();},parentElement:{after(){}},insertAdjacentHTML(_position,html){parse(html);}};}
  function parse(html){for(const match of html.matchAll(/<(input|select|button)[^>]*\bid="([^"]+)"[^>]*>/g)){const item=node();item.value=decode(match[0].match(/\bvalue="([^"]*)"/)?.[1]||'');if(match[2]==='type-filter')item.value=state.type;nodes.set('#'+match[2],item);}}
  const content={markup:'',get innerHTML(){return this.markup;},set innerHTML(html){this.markup=html;nodes.clear();parse(html);},querySelectorAll:()=>[],querySelector:()=>null};
  const get=key=>nodes.get(key)||(['#heading','#crumb','#sidebar','#menu-toggle'].includes(key)?node():null),siteSelect={value:'1'};
  let hold=false;
  const context={state,content,siteSelect,$:get,detailEpoch:0,workerListEpoch:0,sitePhotoEpoch:0,siteEducationCleanup:null,permitRoleCleanup:null,loadSites:async()=>{},dialog:{open:false},labels:{documents:'문서'},document:{querySelector:()=>null,querySelectorAll:()=>[],createElement:node},options:()=>'',esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),URLSearchParams,showError:error=>errors.push(error.message),flash:message=>errors.push(message),api:async path=>{calls.push(path);if(hold)return new Promise(resolve=>pending.push(resolve));return [];}};
  runInNewContext(part('function searchBar(','async function editWorker(')+part('async function loadDocuments()','function capturedFields(')+part('async function render(){','try {const session=await adminSession;')+part('siteSelect.onchange=','$(\'#site-add\').onclick=')+'\nglobalThis.render=render;',context);
  const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(errors,[]);};
  await context.render();assert.ok(get('#work-plan-company-filter'));get('#work-plan-company-filter').value="  가상 %_ &+ 업체  ";get('#query').value='가상 선택';get('#document-from').value='2026-11-01';get('#document-to').value='2026-11-02';get('#search').click();await settle();
  let params=new URL(calls.at(-1),'http://localhost').searchParams;assert.equal(params.get('workPlanCompany'),'가상 %_ &+ 업체');assert.equal(params.get('q'),'가상 선택');assert.equal(params.get('from'),'2026-11-01');assert.equal(get('#work-plan-company-filter').value,'가상 %_ &+ 업체');assert.equal(get('#query').value,'가상 선택');
  get('#work-plan-company-filter').value='변경 업체';get('#work-plan-company-filter').onkeydown({key:'Enter'});await settle();assert.equal(get('#work-plan-company-filter').value,'변경 업체');
  get('#type-filter').value='tbm';get('#search').click();await settle();assert.equal(get('#work-plan-company-filter'),null);assert.equal(state.workPlanCompany,'');
  get('#type-filter').value='work_plan';get('#search').click();await settle();assert.equal(get('#work-plan-company-filter').value,'');
  get('#work-plan-company-filter').value='현장 A 업체';get('#search').click();await settle();siteSelect.value='2';siteSelect.onchange();await settle();assert.equal(get('#work-plan-company-filter').value,'');assert.equal(new URL(calls.at(-1),'http://localhost').searchParams.get('siteId'),'2');
  hold=true;get('#work-plan-company-filter').value='A';get('#search').click();await settle();get('#work-plan-company-filter').value='B';get('#search').click();await settle();get('#work-plan-company-filter').value='A';get('#search').click();await settle();assert.equal(pending.length,3);
  pending[2]([]);await settle();const current=get('#work-plan-company-filter');pending[0]([]);pending[1]([]);await settle();assert.equal(get('#work-plan-company-filter'),current);assert.equal(current.value,'A');
});
