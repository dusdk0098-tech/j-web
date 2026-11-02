import { createHmac, createHash } from 'node:crypto';

const origin='https://sens.apigw.ntruss.com';
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=1000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
export const sensSignature=(method,uri,timestamp,accessKey,secretKey)=>createHmac('sha256',secretKey).update(`${method} ${uri}\n${timestamp}\n${accessKey}`).digest('base64');

export function sensAlimtalk(env=process.env,fetchRequest=globalThis.fetch){
  const service=env.JWEB_SENS_SERVICE_ID,channel=env.JWEB_SENS_CHANNEL_ID,code=env.JWEB_SENS_TEMPLATE_CODE,template=env.JWEB_SENS_TEMPLATE_CONTENT,access=env.JWEB_SENS_ACCESS_KEY,secret=env.JWEB_SENS_SECRET_KEY;
  const configured=env.JWEB_NOTIFICATION_PROVIDER==='ncp-sens'&&typeof service==='string'&&/^ncp:kkobizmsg:[A-Za-z0-9:_-]{1,150}$/.test(service)&&typeof channel==='string'&&/^@[^\s\x00-\x1f]{1,100}$/.test(channel)&&identifier(code)&&text(template)&&typeof access==='string'&&/^[A-Za-z0-9_-]{5,200}$/.test(access)&&typeof secret==='string'&&/^[A-Za-z0-9+/=_-]{5,200}$/.test(secret);
  const fingerprint=configured?createHash('sha256').update(JSON.stringify([service,channel,code,template])).digest('hex'):'';
  const path=`/alimtalk/v2/services/${service}/messages`;
  const requireConfigured=()=>{if(!configured)throw Error('알림톡 업체 연결과 검수된 템플릿 설정이 필요합니다.');};
  // 일반 텍스트 템플릿만 지원한다. 버튼·강조·이미지형은 해당 규격을 구현한 뒤 사용한다.
  const variableNames=configured?[...new Set([...template.matchAll(/#{([^{}\r\n]{1,100})}/g)].map(match=>match[1]))]:[];
  const matches=(content,variables)=>text(content)&&variables&&typeof variables==='object'&&!Array.isArray(variables)&&Object.keys(variables).length===variableNames.length&&variableNames.every(name=>Object.hasOwn(variables,name)&&text(variables[name]))&&template.replace(/#{([^{}\r\n]{1,100})}/g,(_,name)=>variables[name])===content;
  async function request(method,uri,body){
    requireConfigured();const timestamp=String(Date.now());
    const response=await fetchRequest(origin+uri,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','x-ncp-apigw-timestamp':timestamp,'x-ncp-iam-access-key':access,'x-ncp-apigw-signature-v2':sensSignature(method,uri,timestamp,access,secret)},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw Error('업체 응답을 확인하지 못했습니다.');
    const reader=response.body.getReader();let size=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>512*1024)throw Error('업체 응답을 확인하지 못했습니다.');chunks.push(value);}}finally{await reader.cancel();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  return Object.freeze({
    status:()=>({configured:!!configured,provider:configured?'ncp-sens':null,templateCode:configured?code:null,template:configured?template:null,variables:variableNames}),
    fingerprint,
    validate(input){requireConfigured();if(!input||!Array.isArray(input.recipients)||input.recipients.length<1||input.recipients.length>100||input.recipients.some(number=>typeof number!=='string'||!/^01[016789]\d{7,8}$/.test(number))||new Set(input.recipients).size!==input.recipients.length)throw Error('서로 다른 국내 휴대전화 번호를 숫자만 1~100개 입력해 주세요.');const variables=input.variables??{};if(!matches(input.content,variables))throw Error('검수된 일반 텍스트 템플릿과 변수에 맞는 본문을 입력해 주세요.');return {recipients:[...input.recipients].sort(),content:input.content,variables:{...variables}};},
    async send(input){
      const {recipients,content}=this.validate(input);let response;
      try{response=await request('POST',path,{plusFriendId:channel,templateCode:code,messages:recipients.map(to=>({countryCode:'82',to,content,useSmsFailover:false}))});}catch{return recipients.map(()=>({state:'unknown',messageId:null,code:null}));}
      return recipients.map(to=>{const rows=Array.isArray(response?.messages)?response.messages.filter(row=>row?.to===to):[];if(String(response?.statusCode)!=='202'||rows.length!==1)return {state:'unknown',messageId:null,code:null};const row=rows[0],messageId=identifier(row.messageId)&&response.messages.filter(item=>item?.messageId===row.messageId).length===1?row.messageId:null,requestCode=typeof row.requestStatusCode==='string'&&/^[A-Z][0-9]{3}$/.test(row.requestStatusCode)?row.requestStatusCode:null;return {state:requestCode==='A000'&&messageId?'accepted':requestCode&&requestCode!=='A000'?'failed':'unknown',messageId,code:requestCode};});
    },
    async result(messageId){
      requireConfigured();if(!identifier(messageId))throw Error('발송 결과 식별자가 없습니다.');
      let row;try{row=await request('GET',path+'/'+messageId);}catch{return null;}
      if(!row||typeof row!=='object'||Array.isArray(row)||row.messageId!==messageId||row.plusFriendId!==channel||row.templateCode!==code)return null;
      const resultCode=typeof row.messageStatusCode==='string'&&/^[A-Z0-9]{4}$/.test(row.messageStatusCode)?row.messageStatusCode:null;
      if(resultCode==='0000'&&row.requestStatusCode==='A000')return {state:'delivered',code:resultCode};
      if(['3005','4000','4001'].includes(resultCode))return {state:'unknown',code:resultCode};
      if(resultCode&&row.messageStatusName==='fail')return {state:'failed',code:resultCode};
      return row.messageStatusName==='processing'&&row.requestStatusCode==='A000'?{state:'accepted',code:null}:null;
    }
  });
}
