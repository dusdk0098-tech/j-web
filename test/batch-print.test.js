import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBatchDocuments } from '../public/batch-print.js';

test('문서 미리보기는 현재 목록의 중복 없는 선택만 허용한다',()=>{
  const documents=[{id:4},{id:7}];
  assert.deepEqual(selectBatchDocuments(documents,['7','4']),[7,4]);
  assert.throws(()=>selectBatchDocuments(documents,[]),/선택/);
  assert.throws(()=>selectBatchDocuments(documents,['4','4']),/확인/);
  assert.throws(()=>selectBatchDocuments(documents,['8']),/확인/);
  assert.throws(()=>selectBatchDocuments(documents,Array.from({length:21},()=>4)),/20개/);
});
