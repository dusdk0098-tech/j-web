import { createHash, randomUUID } from 'node:crypto';
import { costImageType } from './cost-image.js';

const fail=(status,message)=>Object.assign(new Error(message),{aiStatus:status});
export const AI_BODY_LIMIT=7*1024*1024+16384;
export class AiChat {
  constructor(db,env=process.env){
    this.db=db;this.pending=new Set();this.config=null;
    db.exec(`CREATE TABLE IF NOT EXISTS ai_feedback (id TEXT PRIMARY KEY,owner TEXT NOT NULL,rating TEXT CHECK(rating IN ('good','bad')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    if(env.JWEB_AI_ENABLED==='1'){
      try{
        const url=new URL(env.JWEB_AI_ENDPOINT);
        if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))||url.username||url.password||url.hash||url.search||!env.JWEB_AI_MODEL?.trim()||!env.JWEB_AI_API_KEY?.trim())throw Error();
        this.config={url:url.href,model:env.JWEB_AI_MODEL,key:env.JWEB_AI_API_KEY};
      }catch{this.configError=true;}
    }
  }
  status(){return {configured:!!this.config,message:this.config?'입력한 질문과 사진만 설정한 AI 제공업체로 전송합니다. 대화 내용은 이 서버에 저장하지 않으며 평가는 로컬 DB에만 저장합니다.':this.configError?'AI 연결 설정이 올바르지 않습니다. 관리자에게 문의해 주세요.':'AI 제공업체가 설정되지 않았습니다. 관리자에게 문의해 주세요.'};}
  owner(token){return createHash('sha256').update(token).digest('hex');}
  async chat(input,token,authorize){
    authorize();
    if(!this.config)throw fail(503,this.status().message);
    if(typeof input.text!=='string'||input.text.length>4000)throw fail(400,'질문은 4,000자 이내로 입력해 주세요.');
    const content=[];
    if(input.text.trim())content.push({type:'text',text:input.text.trim()});
    if(input.image!==undefined){
      const image=input.image;
      if(!image||typeof image!=='object'||typeof image.data!=='string'||image.data.length>Math.ceil(5*1024*1024/3)*4||!image.data.length||image.data.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(image.data))throw fail(400,'사진은 JPEG, PNG, WebP 형식의 5MB 이하 파일 한 장만 가능합니다.');
      const bytes=Buffer.from(image.data,'base64'),type=costImageType(bytes);
      if(bytes.length>5*1024*1024||!type||type!==image.mimeType||bytes.toString('base64')!==image.data)throw fail(400,'사진 형식과 파일 내용을 확인해 주세요.');
      content.push({type:'image_url',image_url:{url:`data:${type};base64,${image.data}`}});
    }
    if(!content.length)throw fail(400,'질문 또는 사진을 입력해 주세요.');
    const owner=this.owner(token);
    if(this.pending.has(owner)||this.pending.size>=4)throw fail(429,'답변을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
    this.pending.add(owner);
    try{
      authorize();
      const response=await fetch(this.config.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.config.key}`},body:JSON.stringify({model:this.config.model,messages:[{role:'user',content}],max_tokens:2048})});
      if(!response.ok){await response.body?.cancel();throw fail(502,'AI 제공업체가 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>256*1024)throw fail(502,'AI 응답이 너무 깁니다. 질문을 줄여 다시 시도해 주세요.');chunks.push(chunk);}
      let answer;try{answer=JSON.parse(Buffer.concat(chunks).toString('utf8')).choices?.[0]?.message?.content;}catch{}
      if(typeof answer!=='string'||!answer.trim()||answer.length>32000)throw fail(502,'AI 응답 형식이 올바르지 않습니다.');
      this.db.exec('BEGIN IMMEDIATE');
      let id;
      try{authorize();id=randomUUID();this.db.prepare('INSERT INTO ai_feedback(id,owner) VALUES(?,?)').run(id,owner);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
      return {id,answer};
    }catch(error){
      if(error.aiStatus||error.sessionStatus)throw error;
      throw fail(error.name==='TimeoutError'?504:502,error.name==='TimeoutError'?'AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.':'AI 연결에 실패했습니다. 관리자에게 문의해 주세요.');
    }finally{this.pending.delete(owner);}
  }
  feedback(input,token,authorize){
    if(typeof input.id!=='string'||!['good','bad'].includes(input.rating))throw fail(400,'평가 정보를 확인해 주세요.');
    this.db.exec('BEGIN IMMEDIATE');
    try{authorize();const result=this.db.prepare('UPDATE ai_feedback SET rating=? WHERE id=? AND owner=?').run(input.rating,input.id,this.owner(token));if(!result.changes)throw fail(404,'이 로그인에서 받은 답변을 찾을 수 없습니다.');this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
    return {ok:true};
  }
}
