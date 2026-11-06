import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {freezeBatchImages} from '../public/batch-images.js';

test('용량 초과 출력 사진을 거절하면 HTTP 전송도 중단한다', async () => {
  let closed;
  const disconnected = new Promise(resolve => { closed = resolve; });
  const server = createServer((req, res) => {
    res.on('close', closed);
    res.writeHead(200, {'content-type': 'image/png', 'content-length': 51 * 1024 * 1024});
    res.flushHeaders();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const source = '/api/documents/1/instruction-photos/1?preview=1';
    const image = {dataset: {batchSource: source}};
    await assert.rejects(freezeBatchImages([image], () => true, {
      fetchImage: (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options)
    }), /크기/);
    let timer;
    try {
      await Promise.race([disconnected, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('HTTP 연결이 종료되지 않았습니다.')), 3000); })]);
    } finally { clearTimeout(timer); }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
