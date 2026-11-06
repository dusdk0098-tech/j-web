import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {Store} from '../store.js';
const image=new PNG({width:1,height:1});image.data[3]=255;const png=PNG.sync.write(image),signature=`data:image/png;base64,${png.toString('base64')}`;
function fixture(){const store=new Store(':memory:'),site=store.createSite({name:'가상 현장'}),equipment=store.createEquipment({siteId:site.id,kind:'가상 장비',model:'가상',capacity:'',manufacturer:'',registration:''}),doc=store.createDocument({siteId:site.id,type:'work_plan',title:'가상 계획',date:'2026-11-06',details:{equipmentIds:[equipment.id]}});return {store,doc,input:{equipmentId:equipment.id,date:'2026-11-06',items:[{name:'시험 항목',result:'적정'}],inspector:'가상 점검자',signature}};}
test('점검 사진은 같은 트랜잭션에 저장하며 실패하면 점검과 사진 모두 취소된다',()=>{const {store,doc,input}=fixture();try{
 for(const photos of [[{name:'bad',data:Buffer.from('x')}],Array(11).fill({name:'가상.png',data:png}),[{name:'../가상.png',data:png}],[{name:'..'+String.fromCharCode(92)+'가상.png',data:png}],[{name:'가상'+String.fromCharCode(0)+'사진.png',data:png}]])assert.throws(()=>store.addEquipmentCheck(doc.id,input,()=>{},photos));assert.deepEqual(store.equipmentChecks(doc.id),[]);
 let count=0;assert.throws(()=>store.addEquipmentCheck(doc.id,input,()=>{if(++count===2)throw Error('세션 만료');},[{name:'가상.png',data:png}]),/세션 만료/);assert.deepEqual(store.equipmentChecks(doc.id),[]);
 const id=store.addEquipmentCheck(doc.id,input,()=>{},[{name:'가상.png',data:png}]),check=store.equipmentChecks(doc.id)[0];assert.equal(check.photos.length,1);assert.deepEqual(Buffer.from(store.equipmentCheckPhoto(doc.id,id,check.photos[0].id).data),png);assert.equal(store.equipmentCheckPhoto(doc.id+1,id,check.photos[0].id),null);
 }finally{store.close();}});
test('계획서 결재 사본 사진은 점검 삭제 후에도 보존되며 이전 사진 없는 기록 형태는 유지된다',()=>{const {store,doc,input}=fixture();try{
 const old=store.addEquipmentCheck(doc.id,{...input,date:'2026-11-05'});assert.equal(store.equipmentChecks(doc.id).find(row=>row.id===old).photos,undefined);
 const id=store.addEquipmentCheck(doc.id,input,()=>{},[{name:'가상.png',data:png}]),photo=store.equipmentCheckPhotos(doc.id,id)[0],version=store.planSignatureInfo(store.document(doc.id)).version;store.saveMeetingSignature(doc.id,signature,()=>{},version);store.transition(doc.id,'submit');const cycle=store.document(doc.id).approval_cycle_id;assert.deepEqual(Buffer.from(store.approvalCycleFile(doc.id,cycle,'equipment-check-photo',id,photo.id).data),png);store.deleteEquipmentCheck(doc.id,id);assert.equal(store.equipmentCheckPhoto(doc.id,id,photo.id),null);assert.deepEqual(Buffer.from(store.approvalCycleFile(doc.id,cycle,'equipment-check-photo',id,photo.id).data),png);
 }finally{store.close();}});
