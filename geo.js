export function verifyWorkerLocation(policy,position,now=Date.now()){
  if(!position||typeof position!=='object'||Array.isArray(position)||![position.latitude,position.longitude,position.accuracyMeters,position.timestamp].every(Number.isFinite)||position.latitude < -90||position.latitude > 90||position.longitude < -180||position.longitude > 180||position.accuracyMeters<0)throw new Error('시험 위치를 확인해 주세요. 현장 화면을 다시 열어 주세요.');
  if(position.timestamp<now-120000||position.timestamp>now+30000)throw new Error('위치 측정 시각을 확인해 주세요.');
  if(position.accuracyMeters>policy.maxAccuracyMeters)throw new Error('위치 정확도가 부족합니다. 다시 확인해 주세요.');
  const radians=degrees=>degrees*Math.PI/180,latitude1=radians(policy.latitude),latitude2=radians(position.latitude),deltaLatitude=latitude2-latitude1,deltaLongitude=radians(position.longitude-policy.longitude);
  const a=Math.sin(deltaLatitude/2)**2+Math.cos(latitude1)*Math.cos(latitude2)*Math.sin(deltaLongitude/2)**2,distance=2*6371008.8*Math.asin(Math.sqrt(Math.max(0,Math.min(1,a))));
  if(distance>policy.radiusMeters)throw new Error('시험 현장의 위치 반경 밖입니다.');
  return {latitude:position.latitude,longitude:position.longitude,accuracyMeters:position.accuracyMeters,capturedAt:position.timestamp,distanceMeters:Math.round(distance)};
}
