export function captureWorkerLocation(geolocation=globalThis.navigator?.geolocation){
  if(!geolocation||typeof geolocation.getCurrentPosition!=='function')return Promise.reject(new Error('이 기기에서 위치 확인을 사용할 수 없습니다.'));
  return new Promise((resolve,reject)=>{
    try{geolocation.getCurrentPosition(position=>{if(!position?.coords){reject(new Error('위치를 확인하지 못했습니다. 다시 시도해 주세요.'));return;}resolve({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracyMeters:position.coords.accuracy,timestamp:position.timestamp});},error=>reject(new Error(error?.code===1?'기기의 위치 사용 권한을 허용해 주세요.':'위치를 확인하지 못했습니다. 다시 시도해 주세요.')),{enableHighAccuracy:true,timeout:15000,maximumAge:0});}
    catch{reject(new Error('위치를 확인하지 못했습니다. 다시 시도해 주세요.'));}
  });
}
