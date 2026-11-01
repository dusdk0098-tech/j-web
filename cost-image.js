export function costImageType(data){
  const bytes=Buffer.from(data);
  if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
  if(bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))return 'image/jpeg';
  if(bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.readUInt32LE(4)===bytes.length-8&&bytes.toString('ascii',8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16)))return 'image/webp';
  return null;
}
