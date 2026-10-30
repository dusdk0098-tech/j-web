import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBatchDocuments, selectBatchItems } from '../public/batch-print.js';

test('문서 미리보기는 현재 목록의 중복 없는 선택만 허용한다',()=>{
  const documents=[{id:4},{id:7}];
  assert.deepEqual(selectBatchDocuments(documents,['7','4']),[7,4]);
  assert.throws(()=>selectBatchDocuments(documents,[]),/선택/);
  assert.throws(()=>selectBatchDocuments(documents,['4','4']),/확인/);
  assert.throws(()=>selectBatchDocuments(documents,['8']),/확인/);
  assert.throws(()=>selectBatchDocuments(documents,Array.from({length:21},()=>4)),/20개/);
});

test('문서와 신고는 종류별 목록을 검증하며 함께 20개까지 선택한다',()=>{
  const docs=[{id:4},{id:7}],reports=[{id:4},{id:8}];
  assert.deepEqual(selectBatchItems(docs,reports,['4'],['4','8']),{documents:[4],reports:[4,8]});
  assert.deepEqual(selectBatchItems(docs,reports,[],['8']),{documents:[],reports:[8]});
  assert.throws(()=>selectBatchItems(docs,reports,[],[]),/선택/);
  assert.throws(()=>selectBatchItems(docs,reports,['4'],['7']),/확인/);
  assert.throws(()=>selectBatchItems(docs,reports,['4'],['8','8']),/확인/);
  assert.throws(()=>selectBatchItems(docs,reports,Array(11).fill('4'),Array(10).fill('8')),/20개/);
});
