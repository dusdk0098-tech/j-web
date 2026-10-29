import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

test('가입 QR 이미지를 판독하면 원래 가입 주소가 나온다', async () => {
  const link='http://127.0.0.1:4173/join?token=abcdefghijklmnopqrstuvwxyz_0123456789ABCDEFG';
  const image=await QRCode.toDataURL(link,{errorCorrectionLevel:'M',margin:2,width:256});
  const png=PNG.sync.read(Buffer.from(image.split(',')[1],'base64'));
  assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,link);
});
