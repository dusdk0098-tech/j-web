import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

test('현장 및 가입 QR은 주소를 판독하고 네 칸의 여백을 포함한다',{timeout:30000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jweb-qr-border-')),reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),JWEB_DATA_DIR:dir,JWEB_ADMIN_PASSWORD:'virtual-admin-password'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('시험 서버가 종료됐습니다.');})]);
    const base='http://127.0.0.1:'+port,post=(path,data,cookie)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)}),login=await post('/api/login',{password:'virtual-admin-password'}),cookie=login.headers.get('set-cookie').split(';')[0],site=await (await post('/api/sites',{name:'가상 현장'},cookie)).json();
    for(const [suffix,status] of [['access',200],['invitation',201]]){
      const response=await post('/api/sites/'+site.id+'/'+suffix,{},cookie);assert.equal(response.status,status);const result=await response.json(),png=PNG.sync.read(Buffer.from(result.image.split(',')[1],'base64'));
      const modules=QRCode.create(result.link,{errorCorrectionLevel:'M'}).modules.size,quietPixels=Math.floor(4*png.width/(modules+8));let left=png.width,top=png.height,right=-1,bottom=-1;
      for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const i=(y*png.width+x)*4;if(png.data[i+3]>127&&png.data[i]<32&&png.data[i+1]<32&&png.data[i+2]<32){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}}
      assert.ok(left>=quietPixels&&top>=quietPixels&&right<png.width-quietPixels&&bottom<png.height-quietPixels,'네 방향에 네 칸의 흰색 여백이 필요합니다.');
      assert.equal(png.width,512);assert.equal(png.height,512);assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,result.link);
    }
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
