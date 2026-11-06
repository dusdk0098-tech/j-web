export function costImageType(data,totalLength=data.length){
  const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
  if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
  if(bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))return 'image/jpeg';
  if(bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.readUInt32LE(4)===totalLength-8&&bytes.toString('ascii',8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16)))return 'image/webp';
  return null;
}
export function safetyCostImageType(data){
  const bytes=Buffer.isBuffer(data)?data:Buffer.from(data),known=costImageType(bytes);
  if(known)return known;
  if(bytes.length>=14&&(bytes.subarray(0,6).equals(Buffer.from('GIF87a'))||bytes.subarray(0,6).equals(Buffer.from('GIF89a')))&&bytes.readUInt16LE(6)>0&&bytes.readUInt16LE(8)>0&&bytes.at(-1)===0x3b)return 'image/gif';
  return null;
}

export function instructionPhotoType(data){
  const type=safetyCostImageType(data);return type==='image/webp'?null:type;
}
