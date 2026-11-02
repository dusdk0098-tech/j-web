import { adminSitePolicy, adminAttendanceRows, adminEquipmentRows } from './admin-site-policy.js';
import { adminWriteGuard } from './admin-write-guard.js';
import http from 'node:http';
import { isIP } from 'node:net';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { PersonalNotes } from './personal-notes.js';
import { StickerRequests } from './sticker-requests.js';
import { CommonWork } from './common-work.js';
import { Messages } from './messages.js';
import { EmploymentCertificates } from './employment-certificates.js';
import { ReviewerProfile } from './reviewer-profile.js';
import { AdminAccounts } from './admin-accounts.js';
import { ClientAccounts } from './client-accounts.js';
import { LoginFailures } from './login-failures.js';
import { passwordRequests } from './password-hashing.js';
import { types } from './domain.js';
import QRCode from 'qrcode';
import { issueAccessQr,issueInvitationQr } from './qr-issue.js';
import { workerSpreadsheet, wageSpreadsheet } from './exports.js';
import { sessionToken, WorkerSessions, ReviewerSessions } from './auth.js';
import { workerSitePath } from './public/worker-link.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { costImageType } from './cost-image.js';
import { AiChat, AI_BODY_LIMIT } from './ai-chat.js';
import { sensAlimtalk } from './sens-alimtalk.js';
import { NotificationOutbox } from './notification-outbox.js';

const root = dirname(fileURLToPath(import.meta.url));
let publicOrigin='';
if(process.env.JWEB_PUBLIC_ORIGIN){
  let parsed;try{parsed=new URL(process.env.JWEB_PUBLIC_ORIGIN);}catch{throw new Error('HTTPS 공개 주소를 확인해 주세요.');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.origin!==process.env.JWEB_PUBLIC_ORIGIN)throw new Error('HTTPS 공개 주소는 경로 없이 입력해 주세요.');
  publicOrigin=parsed.origin;
}
const proxySecret=process.env.JWEB_PROXY_SECRET;
if(proxySecret!==undefined&&!/^[a-zA-Z0-9_-]{32,256}$/.test(proxySecret))throw new Error('중계 공유 비밀은 영문·숫자·밑줄·하이픈 32~256자로 설정해 주세요.');
const proxySecretHash=proxySecret?createHash('sha256').update(proxySecret).digest():null;
function workerPeer(req){
  const peer=req.socket.remoteAddress,secret=req.headers['x-jweb-proxy-secret'],address=req.headers['x-jweb-client-address'];
  if(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)&&(secret!==undefined||address!==undefined)){
    if(!proxySecretHash||typeof secret!=='string'||typeof address!=='string'||!isIP(address)||!timingSafeEqual(proxySecretHash,createHash('sha256').update(secret).digest()))return null;
    return address.replace(/^::ffff:(?=\d+\.)/,'');
  }
  return peer?.replace(/^::ffff:(?=\d+\.)/,'');
}
const secureCookie=publicOrigin?'; Secure':'';
const dataDir = process.env.JWEB_DATA_DIR || join(root, 'data');

mkdirSync(dataDir, { recursive: true });
const store = new Store(join(dataDir, 'jweb.sqlite'));
const auth=new AdminAccounts(store.db);auth.bootstrap(process.env.JWEB_ADMIN_PASSWORD);
const aiChat = new AiChat(store.db);
const notificationOutbox = new NotificationOutbox(store.db,sensAlimtalk(),{systemWrite:fn=>adminRequests.exit(fn)});
const personalNotes = new PersonalNotes(store.db);
const stickerRequests = new StickerRequests(store.db);
const commonWork = new CommonWork(store.db);
const messages = new Messages(store.db);
const employment = new EmploymentCertificates(store.db);
const reviewerProfile = new ReviewerProfile(store.db);
const clients = new ClientAccounts(store.db);
const workerSessions=new WorkerSessions(store.db);
const reviewerSessions=new ReviewerSessions(store.db),reviewerLoginFailures=new LoginFailures(),reviewerAccountFailures=reviewerLoginFailures.accounts;
const workerLoginFailures=new LoginFailures(),workerAccountFailures=workerLoginFailures.accounts;
const workerKey=raw=>typeof raw==='string' && /^[\w-]{43}$/.test(raw)?createHash('sha256').update(raw).digest('hex'):'';
const workerReportContext=(key,worker)=>({workerId:worker.id,siteId:worker.site_id,generation:createHash('sha256').update('worker-report:'+key).digest('hex')});
function checkWorkerReport(req,key,session,input){checkRequestSession(req);if(input===undefined){try{input={reportContext:JSON.parse(req.headers['x-worker-report-context']||'null')};}catch{input={};}}const expected=workerReportContext(key,session.worker),actual=input.reportContext;if(!actual||actual.workerId!==expected.workerId||actual.siteId!==expected.siteId||actual.generation!==expected.generation)throw Object.assign(new Error('로그인 계정 또는 현장 세션이 변경되었습니다. 입력 내용을 복사한 뒤 다시 로그인해 주세요.'),{sessionStatus:409,sessionChanged:true});}
function workerSessionError(raw,expected){const now=new Date(),session=workerSessions.get(workerKey(raw));if(session!==expected||!session||session.expires<=now.getTime())return {status:401,error:'근로자 로그인이 필요합니다.'};const date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);return store.workerAccessBlocked(session.worker.site_id,date)?{status:403,error:'해당 현장은 오늘 근로자 접속이 차단되었습니다.'}:null;}
delete process.env.JWEB_ADMIN_PASSWORD;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
const assets = new Set(['/','/app.js','/office-template.js','/common-work-view.js','/rich-text.js','/rich-editor.js','/reviewer-office.js','/reviewer-profile.js','/employment-view.js','/employment-certificate','/employment-certificate.js','/messages-view.js','/board-view.js','/faq-pages.js','/schedule.js','/batch-print.js','/batch-images.js','/date-range.js','/daily-quantities.js','/risk-scale.js','/musculoskeletal.js','/worker-link.js','/worker-location.js','/remember-worker.js','/worker-documents.js','/worker-loads.js','/join-choices.js','/join-flow.js','/worker-fields.js','/site-qr.js','/tbm-sources.js','/training-groups.js','/site-statistics.js','/restaurant-price.js','/salary-summary.js','/attendance-meals.js','/joint-examples.js','/safety-log-sources.js','/style.css','/jweb-icon.svg','/jweb-icon-192.png','/jweb-icon-512.png','/worker-guide.html','/offline-forms.html','/join','/join.js','/login','/login.js','/review','/review.js']);
const json = (res, code, value) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(value)); };
assets.add('/admin-session.js');
assets.add('/notification-view.js');
assets.add('/client');assets.add('/client.js');
assets.add('/common-work-print.js');
assets.add('/personal-notes-tools.js');
assets.add('/sticker-requests.js');
assets.add('/daily-report-photos.js');
assets.add('/plan-pdf.js');assets.add('/plan-pdf-worker.js');
assets.add('/plan-manual-print.js');assets.add('/plan-manual-print.css');assets.add('/plan-print-lock.js');
const pdfAssets=new Map(['pdf.mjs','pdf.worker.mjs'].map(name=>[`/pdfjs/${name}`,join(root,'node_modules/pdfjs-dist/legacy/build',name)]));
for(const folder of ['cmaps','standard_fonts','wasm'])for(const name of readdirSync(join(root,'node_modules/pdfjs-dist',folder)))if(/\.(bcmap|pfb|ttf|wasm)$/.test(name))pdfAssets.set(`/pdfjs/${folder}/${name}`,join(root,'node_modules/pdfjs-dist',folder,name));
assets.add('/site-photo-viewer.js');
assets.add('/board-comments.js');
assets.add('/board-create.js');
assets.add('/board-inline-image.js');
assets.add('/worker-preview.js');
assets.add('/reviewer-login.js');
assets.add('/worker-identity-remember.js');
assets.add('/worker-list.js');
assets.add('/attendance-matrix.js');
assets.add('/restricted-month-editor.js');
assets.add('/education-kinds.js');
assets.add('/training-detail.js');
assets.add('/risk-detail.js');
assets.add('/risk-activity-mode.js');
assets.add('/plan-detail.js');
assets.add('/reviewer-education.js');
assets.add('/education-reference.js');
assets.add('/checklist-copy.js');
assets.add('/permit-sources.js');
assets.add('/permit-measures.js');
assets.add('/safety-cost.js');
assets.add('/weekly-ppe.js');
assets.add('/reviewer-manager-check.js');
assets.add('/basic-samples.js');
assets.add('/reviewer-basic-documents.js');
assets.add('/permit-roles.js');
assets.add('/ai-chat.js');assets.add('/ai-chat.css');
function checkRequestSession(req){const failure=req.checkSession?.();if(failure)throw Object.assign(new Error(failure.error),{sessionStatus:failure.status});}
async function boardAttachmentRequest(req,res,url,match,actor){
  const [,id,fileId]=match,version=url.searchParams.get('version'),authorize=()=>checkRequestSession(req);
  if(!fileId&&req.method==='GET')return json(res,200,store.boardAttachments(id,version,actor,authorize));
  if(!fileId&&req.method==='POST'){let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}return json(res,201,store.addBoardAttachment(id,version,name,Buffer.concat(chunks),actor,authorize));}
  if(fileId&&req.method==='DELETE'){store.deleteBoardAttachment(id,fileId,version,url.searchParams.get('fileVersion'),actor,authorize);return json(res,200,{ok:true});}
  if(fileId&&req.method==='GET'){const file=store.boardAttachment(id,fileId,version,url.searchParams.get('fileVersion'),actor,authorize),name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`),preview=url.searchParams.get('preview')==='1',type=preview?costImageType(file.data):'application/octet-stream';if(!type)return json(res,415,{error:'미리 볼 수 없는 파일입니다.'});res.writeHead(200,{'Content-Type':type,...(preview?{}:{'Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${name}`}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
  return json(res,405,{error:'지원하지 않는 요청입니다.'});
}
function instructionPhotoResponse(res,photo,preview){
  const bytes=Buffer.from(photo.data),type=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':null;
  if(preview&&!type)return json(res,415,{error:'미리 볼 수 없는 사진입니다.'});
  const name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  res.writeHead(200,{'Content-Type':preview?type:'application/octet-stream',...(preview?{}:{'Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
}
function dailyReportPhoto(doc,kind,id){
  const file=kind==='site'?store.sitePhoto(doc.site_id,id):store.attachment(id);
  if(!file||(kind==='site'?file.date!==doc.date:file.document_id!==doc.id))return null;
  const bytes=Buffer.from(file.data),type=kind==='site'?costImageType(bytes):bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':null;if(!type)return null;
  const version=createHash('sha256').update(JSON.stringify([doc.id,doc.site_id,doc.date,kind,file.id,file.name,file.description||''])).update(bytes).digest('hex');
  return {id:file.id,kind,name:file.name,description:kind==='site'?file.description:'',type,version,bytes};
}
async function body(req,max=65536,allowEmpty=false) {
  const chunks=[];let size=0;
  for await (const chunk of req) { size+=chunk.length;if(size>max)throw new Error('입력 내용이 너무 깁니다.');chunks.push(chunk); }
  checkRequestSession(req);
  let parsed;try { const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));const value = raw===''&&allowEmpty?{}:JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); parsed=value; } catch { throw new Error('입력 형식이 올바르지 않습니다.'); }
  req.adminInput=parsed;checkRequestSession(req);return parsed;
}
async function handleCommonWork(req,res,url,prefix,actor=null){
  if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
  const site=input=>actor?actor.site_id:input?.siteId||url.searchParams.get('siteId'),authorize=()=>checkRequestSession(req),parts=url.pathname.slice(prefix.length).split('/').filter(Boolean);
  if(parts.length===1&&parts[0]==='authors'&&req.method==='GET'){const authors=commonWork.authors(site(),actor);checkRequestSession(req);json(res,200,authors);return true;}
  if(parts.length===1&&parts[0]==='preview'&&req.method==='POST'){const input=await body(req),result=commonWork.preview(site(input),input.items,actor);checkRequestSession(req);json(res,200,result);return true;}
  if(!parts.length&&req.method==='GET'){json(res,200,commonWork.list(site(),Object.fromEntries(url.searchParams),actor));return true;}
  if(!parts.length&&req.method==='POST'){const input=await body(req);json(res,201,commonWork.create(site(input),input,authorize,actor));return true;}
  if(!/^\d+$/.test(parts[0]||'')){json(res,404,{error:'요청한 경로가 없습니다.'});return true;}const id=parts[0];
  if(parts.length===1&&req.method==='PUT'){const input=await body(req);json(res,200,commonWork.update(site(input),id,input,authorize,actor));return true;}
  if(parts.length===1&&req.method==='DELETE'){const input=await body(req);commonWork.remove(site(input),id,input.version,authorize,actor);json(res,200,{ok:true});return true;}
  if(parts[1]==='comments'&&parts.length===2&&req.method==='POST'){const input=await body(req);json(res,201,commonWork.addComment(site(input),id,input,authorize,actor));return true;}
  if(parts[1]==='comments'&&parts.length===3&&/^\d+$/.test(parts[2])&&['PUT','DELETE'].includes(req.method)){const input=await body(req);commonWork.changeComment(site(input),id,parts[2],input,req.method==='DELETE',authorize,actor);json(res,200,{ok:true});return true;}
  if(parts[1]==='files'&&parts.length===2&&req.method==='POST'){const raw=url.searchParams.get('commentId');if(raw&&!/^\d+$/.test(raw))throw Error('의견을 확인해 주세요.');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw Error('파일 이름을 확인해 주세요.');}json(res,201,commonWork.addFile(site(),id,raw?Number(raw):null,url.searchParams.get('version'),name,Buffer.concat(chunks),authorize,actor));return true;}
  if(parts[1]==='files'&&parts.length===3&&/^\d+$/.test(parts[2])&&req.method==='GET'){const file=commonWork.file(site(),id,parts[2],actor);if(!file){json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});return true;}const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(file.data);return true;}
  if(parts[1]==='files'&&parts.length===3&&/^\d+$/.test(parts[2])&&req.method==='DELETE'){const input=await body(req);commonWork.removeFile(site(input),id,parts[2],input.version,authorize,actor);json(res,200,{ok:true});return true;}
  json(res,404,{error:'요청한 경로가 없습니다.'});return true;
}
const adminRequests=adminWriteGuard(store.db);
const server = http.createServer((req,res)=>passwordRequests.run(true,()=>adminRequests.run(req,async()=>{
  try {
    const host = req.headers.host || '';
    if (publicOrigin ? host!==new URL(publicOrigin).host : !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(res,403,{error:'허용된 접속 주소가 아닙니다.'});
    const origin = req.headers.origin;
    const requestOrigin=publicOrigin||`http://${host}`;
    if (origin && origin !== requestOrigin) return json(res,403,{error:'다른 출처의 요청은 허용되지 않습니다.'});
    const url = new URL(req.url, requestOrigin);
    const token=sessionToken(req.headers.cookie);
    if(url.pathname==='/api/session' && req.method==='GET')return json(res,200,{enabled:true,authenticated:auth.valid(token),admin:auth.session(token),context:auth.context(token)});
    if(url.pathname==='/api/login' && req.method==='POST'){
      const input=await body(req),peer=workerPeer(req);if(peer===null)return json(res,503,{error:'로그인 중계 설정을 확인해 주세요.'});
      const newToken=await auth.loginAsync(input.loginId,input.password,token,peer);
      if(!newToken)return json(res,401,{error:'암호가 올바르지 않거나 잠시 로그인할 수 없습니다.'});
      auth.logout(token);res.setHeader('Set-Cookie',`jweb_session=${newToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie}`);return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/logout' && req.method==='POST'){
      if((req.headers['x-admin-context']||req.headers.origin||req.headers['sec-fetch-site'])&&req.headers['x-admin-context']!==auth.context(token))return json(res,409,{error:'관리자 세션이 변경되었습니다. 새로고침해 주세요.'});
      auth.logout(token);res.setHeader('Set-Cookie',`jweb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);return json(res,200,{ok:true});
    }
    const clientToken=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('jweb_client='))?.slice(12)||'';
    if(url.pathname==='/api/client/id-check'&&req.method==='POST'){const input=await body(req);return json(res,200,{available:clients.available(input.loginId)});}
    if(url.pathname==='/api/client/register'&&req.method==='POST'){const input=await body(req);return json(res,201,await clients.registerAsync(input,workerPeer(req)));}
    if(url.pathname==='/api/client/login'&&req.method==='POST'){
      const input=await body(req),peer=workerPeer(req);if(peer===null)return json(res,503,{error:'로그인 중계 설정을 확인해 주세요.'});
      const next=await clients.loginAsync(input.loginId,input.password,clientToken,peer);if(!next)return json(res,401,{error:'아이디 또는 암호가 올바르지 않습니다.'});
      res.setHeader('Set-Cookie','jweb_client='+next+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+secureCookie);return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/client/logout'&&req.method==='POST'){clients.logout(clientToken);res.setHeader('Set-Cookie','jweb_client=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+secureCookie);return json(res,200,{ok:true});}
    if(url.pathname==='/api/client/session'&&req.method==='GET'){const client=clients.session(clientToken);return client?json(res,200,{client}):json(res,401,{error:'발주처 시험 로그인이 필요합니다.'});}
    const reviewerToken=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('jweb_reviewer='))?.slice(14)||'';
    if(url.pathname==='/api/reviewer/login'&&req.method==='POST'){
      const input=await body(req),now=Date.now(),accountKey=typeof input.loginId==='string'&&/^[A-Za-z0-9_]{3,40}$/.test(input.loginId)?input.loginId:'invalid',peer=workerPeer(req);
      if(input.keepLogin!==undefined&&typeof input.keepLogin!=='boolean')return json(res,400,{error:'로그인 유지 선택을 확인해 주세요.'});
      if(peer===null)return json(res,503,{error:'로그인 중계 설정을 확인해 주세요.'});
      const release=reviewerLoginFailures.reserve(peer,accountKey,now);let authenticated;
      try{authenticated=await store.authenticateReviewerAsync(input.loginId,input.password,true,peer);}finally{release();}
      if(!authenticated){reviewerLoginFailures.record(peer,accountKey,Date.now());return json(res,401,{error:'아이디 또는 암호가 올바르지 않습니다.'});}
      const raw=randomBytes(32).toString('base64url'),session={id:authenticated.reviewer.id,expires:now+8*60*60*1000};if(!reviewerSessions.issue(workerKey(raw),session,authenticated.credentialHash,authenticated.authVersion,workerKey(reviewerToken)))return json(res,401,{error:'아이디 또는 암호가 올바르지 않습니다.'});
      reviewerAccountFailures.delete(accountKey);for(const [key,item] of reviewerSessions)if(item.expires<=now)reviewerSessions.delete(key);res.setHeader('Set-Cookie',`jweb_reviewer=${raw}; HttpOnly; SameSite=Strict; Path=/${input.keepLogin===false?'':'; Max-Age=28800'}${secureCookie}`);return json(res,200,{ok:true});
    }
    if(url.pathname.startsWith('/api/reviewer/')){
      const key=workerKey(reviewerToken),session=reviewerSessions.get(key),reviewer=session&&session.expires>Date.now()?store.reviewer(session.id):null;
      if(!reviewer){reviewerSessions.delete(key);return json(res,401,{error:'결재자 로그인이 필요합니다.'});}
      if(url.pathname==='/api/reviewer/logout'&&req.method==='POST'){reviewerSessions.delete(key);res.setHeader('Set-Cookie',`jweb_reviewer=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);return json(res,200,{ok:true});}
      req.checkSession=()=>reviewerSessions.get(key)===session&&session.expires>Date.now()&&store.reviewer(session.id)?.site_id===reviewer.site_id?null:{status:401,error:'결재자 로그인이 필요합니다.'};
      if(await handleCommonWork(req,res,url,'/api/reviewer/common-work',reviewer))return;
      if(url.pathname==='/api/reviewer/session'&&req.method==='GET')return json(res,200,{reviewer});
      const reviewerEducation=url.pathname.match(/^\/api\/reviewer\/education(?:\/(\d+)(?:\/attachments\/(\d+))?)?$/);
      if(reviewerEducation&&req.method==='GET'){
        const [,id,fileId]=reviewerEducation,result=fileId?store.reviewerEducationAttachment(reviewer.id,id,fileId):store.reviewerEducation(reviewer.id,id);checkRequestSession(req);
        if(!result)return json(res,404,{error:'교육 자료를 찾을 수 없습니다.'});if(!fileId)return json(res,200,result);
        const name=encodeURIComponent(result.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(result.data);
      }
      const reviewerBasic=url.pathname.match(/^\/api\/reviewer\/basic-documents\/(\d+)(?:\/attachments\/(\d+))?$/);
      if((reviewerBasic||url.pathname==='/api/reviewer/basic-documents')&&req.method==='GET'){
        const [,id,fileId]=reviewerBasic||[],result=!id?{documents:store.reviewerBasicDocuments(reviewer.id)}:fileId?store.reviewerBasicAttachment(reviewer.id,id,fileId):store.reviewerBasicDocument(reviewer.id,id);checkRequestSession(req);
        if(store.reviewer(reviewer.id)?.site_id!==reviewer.site_id)return json(res,401,{error:'결재자 로그인이 필요합니다.'});
        if(!result)return json(res,404,{error:'기본 서류를 찾을 수 없습니다.'});if(!fileId)return json(res,200,result);
        const name=encodeURIComponent(result.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(result.data);
      }
      if(url.pathname==='/api/reviewer/manager-checks'){
        if(req.method==='GET'){const now=new Date(),today=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10),records=store.reviewerManagerChecks(reviewer.id,()=>checkRequestSession(req));return json(res,200,{today,records});}
        if(req.method==='POST'){const input=await body(req),now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);if(input.expectedDate!==date)throw Object.assign(new Error('오늘 날짜가 바뀌었습니다. 다시 조회해 주세요.'),{sessionStatus:409});store.saveReviewerManagerCheck(reviewer.id,date,input,()=>{checkRequestSession(req);const current=new Date(),today=new Date(current.getTime()-current.getTimezoneOffset()*60000).toISOString().slice(0,10);if(today!==date)throw Object.assign(new Error('오늘 날짜가 바뀌었습니다. 다시 조회해 주세요.'),{sessionStatus:409});});return json(res,201,{ok:true});}
      }
      if(url.pathname==='/api/reviewer/manager-checks/signature'&&req.method==='GET'){const signature=store.siteReviewerManagerSignature(reviewer.site_id,reviewer.id,url.searchParams.get('date'));checkRequestSession(req);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
      if(url.pathname==='/api/reviewer/board-permissions'&&req.method==='GET'){const canWriteNotice=store.reviewerCanWriteNotice(reviewer.id);checkRequestSession(req);return json(res,200,{canWriteNotice});}
      if(url.pathname==='/api/reviewer/profile'){
        if(req.method==='GET'){const result=reviewerProfile.get(reviewer.id);checkRequestSession(req);return json(res,200,result);}
        if(req.method==='PUT'){const input=await body(req,120000),result=await reviewerProfile.updateAsync(reviewer.id,input,()=>checkRequestSession(req),workerPeer(req));if(result.passwordChanged)res.setHeader('Set-Cookie',`jweb_reviewer=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);return json(res,200,result);}
      }
      if(url.pathname==='/api/reviewer/profile/signature'&&req.method==='GET'){const signature=reviewerProfile.signature(reviewer.id);checkRequestSession(req);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
      if(url.pathname==='/api/reviewer/employment'){
        if(req.method==='GET'){const status=employment.status(reviewer.id),certificates=employment.list(reviewer.id);checkRequestSession(req);return json(res,200,{...status,certificates});}
        if(req.method==='POST'){const input=await body(req);return json(res,201,employment.issue(reviewer.id,input,()=>checkRequestSession(req)));}
      }
      const employmentCertificate=url.pathname.match(/^\/api\/reviewer\/employment\/(\d+)$/);
      if(employmentCertificate&&req.method==='GET'){const result=employment.get(reviewer.id,employmentCertificate[1]);checkRequestSession(req);return result?json(res,200,result):json(res,404,{error:'발급 기록을 찾을 수 없습니다.'});}
      if(url.pathname==='/api/reviewer/office-documents/options'&&req.method==='GET')return json(res,200,store.reviewerOfficeOptions(reviewer.id));
      if(url.pathname==='/api/reviewer/office-reference-preview'&&req.method==='GET'){const result=store.reviewerOfficeReferencePreview(reviewer.id,url.searchParams.get('id'));checkRequestSession(req);return json(res,200,result);}
      if(url.pathname==='/api/reviewer/office-approval-default'&&req.method==='GET'){const result=store.officeApprovalDefault(reviewer.site_id,url.searchParams.get('kind'),url.searchParams.get('otherKind')||'',reviewer.id);checkRequestSession(req);return json(res,200,result);}
      if(url.pathname==='/api/reviewer/office-documents'){
        if(req.method==='GET')return json(res,200,store.reviewerOfficeDocuments(reviewer.id));
        if(req.method==='POST'){const input=await body(req,220000),doc=store.createReviewerOfficeDocument(reviewer.id,input,()=>checkRequestSession(req));return json(res,201,store.reviewerOfficeDetail(reviewer.id,doc.id));}
      }
      const reviewerOffice=url.pathname.match(/^\/api\/reviewer\/office-documents\/(\d+)(?:\/(line|references|signature|transition|attachments)(?:\/(\d+))?)?$/);
      if(reviewerOffice){
        const [,id,part,fileId]=reviewerOffice,doc=store.reviewerOfficeDocument(reviewer.id,id),authorize=version=>{checkRequestSession(req);return store.reviewerOfficeAuthorize(reviewer.id,id,version);},detail=()=>store.reviewerOfficeDetail(reviewer.id,id);
        if(!part&&req.method==='GET')return json(res,200,detail());
        if(!part&&req.method==='PUT'){const input=await body(req,220000);store.updateReviewerOfficeDocument(reviewer.id,id,input,input.version,()=>checkRequestSession(req));return json(res,200,detail());}
        if(['line','references','signature','transition'].includes(part)&&!fileId&&req.method==='POST'){
          const input=await body(req,120000),check=()=>authorize(input.version);
          if(part==='line')store.setApprovalLine(id,input.ids,check);
          if(part==='references')store.setOfficeReferences(id,input.ids,check);
          if(part==='signature')store.saveMeetingSignature(id,input.signature,()=>{const current=check();store.reviewerOfficeReference(reviewer.id,JSON.parse(current.details||'{}'));},input.expectedVersion);
          if(part==='transition')store.transitionReviewerOfficeDocument(reviewer.id,id,input.action,input.version,()=>checkRequestSession(req));
          return json(res,200,detail());
        }
        if(part==='signature'&&!fileId&&req.method==='GET'){const signature=store.meetingSignature(id);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature.signature);}
        if(part==='attachments'&&!fileId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}store.addAttachment(id,name,Buffer.concat(chunks),'general',()=>authorize(url.searchParams.get('version')));return json(res,201,detail());}
        if(part==='attachments'&&fileId&&['GET','DELETE'].includes(req.method)){const file=store.attachment(fileId);if(!file||file.document_id!==doc.id)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});if(req.method==='DELETE'){const input=await body(req);store.deleteAttachment(fileId,()=>{authorize(input.version);const current=store.attachment(fileId);if(!current||current.document_id!==Number(id))throw new Error('첨부파일을 찾을 수 없습니다.');});return json(res,200,detail());}const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
      }
      if(url.pathname==='/api/reviewer/faq-posts'&&req.method==='GET'){const rows=store.faqPosts(url.searchParams.get('q')||'',url.searchParams.get('category')||'',reviewer);checkRequestSession(req);return json(res,200,rows);}
      if(url.pathname==='/api/reviewer/board-posts'){if(req.method==='GET'){const rows=store.reviewerBoardPosts(reviewer,url.searchParams.get('kind'),url.searchParams.get('q')||'',url.searchParams.get('category')||'');checkRequestSession(req);return json(res,200,rows);}if(req.method==='POST'){const input=await body(req,29*1024*1024);return json(res,201,store.saveReviewerBoardPost(reviewer,input,null,()=>checkRequestSession(req)));}}
      const reviewerBoardComment=url.pathname.match(/^\/api\/reviewer\/board-posts\/(\d+)\/comments(?:\/(\d+))?$/);
      const reviewerBoardAttachment=url.pathname.match(/^\/api\/reviewer\/board-posts\/(\d+)\/attachments(?:\/(\d+))?$/);if(reviewerBoardAttachment)return await boardAttachmentRequest(req,res,url,reviewerBoardAttachment,reviewer);
      if(reviewerBoardComment){const [,id,commentId]=reviewerBoardComment;if(!commentId&&req.method==='GET')return json(res,200,store.boardComments(id,url.searchParams.get('version'),reviewer,()=>checkRequestSession(req)));if(!commentId&&req.method==='POST')return json(res,201,store.addBoardComment(id,await body(req),reviewer,()=>checkRequestSession(req)));if(commentId&&req.method==='DELETE'){store.deleteBoardComment(id,commentId,await body(req),reviewer,()=>checkRequestSession(req));return json(res,200,{ok:true});}}
      const reviewerBoard=url.pathname.match(/^\/api\/reviewer\/board-posts\/(\d+)$/);
      if(reviewerBoard&&req.method==='PUT'){const input=await body(req);return json(res,200,store.saveReviewerBoardPost(reviewer,input,reviewerBoard[1],()=>checkRequestSession(req)));}
      if(reviewerBoard&&req.method==='DELETE'){const input=await body(req);store.deleteReviewerBoardPost(reviewer,input.kind,reviewerBoard[1],input.version,()=>checkRequestSession(req));return json(res,200,{ok:true});}
      if(url.pathname==='/api/reviewer/messages/recipients'&&req.method==='GET'){const result=messages.recipients(reviewer);checkRequestSession(req);return json(res,200,result);}
      if(url.pathname==='/api/reviewer/messages'){if(req.method==='GET'){const result=messages.list(reviewer,url.searchParams.get('box')||'inbox',url.searchParams.get('q')||'');checkRequestSession(req);return json(res,200,result);}if(req.method==='POST'){const input=await body(req,7100000);return json(res,201,messages.send(reviewer,input,()=>checkRequestSession(req)));}}
      const reviewerMessage=url.pathname.match(/^\/api\/reviewer\/messages\/(\d+)(?:\/(read|files\/(\d+)))?$/);
      if(reviewerMessage){const [,id,part,fileId]=reviewerMessage;if(!part&&req.method==='GET'){const item=messages.get(reviewer,id);checkRequestSession(req);return item?json(res,200,item):json(res,404,{error:'쪽지를 찾을 수 없습니다.'});}if(!part&&req.method==='DELETE'){await body(req);messages.remove(reviewer,id,()=>checkRequestSession(req));return json(res,200,{ok:true});}if(part==='read'&&req.method==='POST'){await body(req);return json(res,200,messages.read(reviewer,id,()=>checkRequestSession(req)));}if(fileId&&req.method==='GET'){const file=messages.file(reviewer,id,fileId);checkRequestSession(req);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}}
      if(url.pathname==='/api/reviewer/schedules'&&req.method==='GET'){const result=store.reviewerSchedules(reviewer.id,url.searchParams.get('month'),url.searchParams.get('q')||'');checkRequestSession(req);return json(res,200,result);}
      if(url.pathname==='/api/reviewer/personal-supervisor'&&req.method==='GET')return json(res,200,personalNotes.supervisor(reviewer.site_id));
      if(url.pathname==='/api/reviewer/personal-notes/preview'&&req.method==='POST'){const input=await body(req),result=personalNotes.preview(reviewer.site_id,input.items,reviewer);checkRequestSession(req);return json(res,200,result);}
      if(url.pathname==='/api/reviewer/personal-notes'){
        if(req.method==='GET')return json(res,200,personalNotes.list(reviewer.site_id,url.searchParams.get('from')||'',url.searchParams.get('to')||'',url.searchParams.get('q')||'',reviewer));
        if(req.method==='POST'){const input=await body(req);return json(res,201,personalNotes.create({...input,siteId:reviewer.site_id},()=>checkRequestSession(req),reviewer));}
      }
      const reviewerPersonalFile=url.pathname.match(/^\/api\/reviewer\/personal-notes\/(\d+)\/files(?:\/(\d+))?$/);
      if(reviewerPersonalFile){
        const [,id,fileId]=reviewerPersonalFile,siteId=reviewer.site_id;
        if(!fileId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw Error('파일 이름을 확인해 주세요.');}return json(res,201,personalNotes.addFile(siteId,id,url.searchParams.get('version'),name,Buffer.concat(chunks),()=>checkRequestSession(req),reviewer));}
        if(fileId&&req.method==='GET'){const file=personalNotes.file(siteId,id,fileId,reviewer);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
        if(fileId&&req.method==='DELETE'){const input=await body(req);personalNotes.removeFile(siteId,id,fileId,input.version,()=>checkRequestSession(req),reviewer);return json(res,200,{ok:true});}
      }
      const reviewerPersonal=url.pathname.match(/^\/api\/reviewer\/personal-notes\/(\d+)(?:\/(check))?$/);
      if(reviewerPersonal){const [,id,action]=reviewerPersonal;
        if(!action&&req.method==='PUT'){const input=await body(req);return json(res,200,personalNotes.update(reviewer.site_id,id,input,()=>checkRequestSession(req),reviewer));}
        if(!action&&req.method==='DELETE'){const input=await body(req);personalNotes.remove(reviewer.site_id,id,input.version,()=>checkRequestSession(req),reviewer);return json(res,200,{ok:true});}
        if(action==='check'&&req.method==='POST'){const input=await body(req);return json(res,200,personalNotes.check(reviewer.site_id,id,input.version,()=>checkRequestSession(req),reviewer));}
      }
      if(url.pathname==='/api/reviewer/documents'&&req.method==='GET')return json(res,200,store.reviewerDocuments(reviewer.id));
      if(url.pathname==='/api/reviewer/references'&&req.method==='GET')return json(res,200,store.officeReferenceDocuments(reviewer.id));
      if(url.pathname==='/api/reviewer/equipment-checks'&&req.method==='GET')return json(res,200,store.reviewerEquipmentChecks(reviewer.id));
      const reviewerEquipmentSignature=url.pathname.match(/^\/api\/reviewer\/equipment-checks\/(\d+)\/cycles\/(\d+)\/signatures\/(\d+)$/);
      if(reviewerEquipmentSignature&&req.method==='GET'){const [,checkId,cycleId,position]=reviewerEquipmentSignature,signature=store.reviewerEquipmentCheckSignature(reviewer.id,checkId,cycleId,position);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
      const reviewerEquipmentInspector=url.pathname.match(/^\/api\/reviewer\/equipment-checks\/(\d+)\/cycles\/(\d+)\/inspector-signature$/);
      if(reviewerEquipmentInspector&&req.method==='GET'){const [,checkId,cycleId]=reviewerEquipmentInspector,signature=store.reviewerEquipmentInspectorSignature(reviewer.id,checkId,cycleId);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
      const reviewerEquipment=url.pathname.match(/^\/api\/reviewer\/equipment-checks\/(\d+)(?:\/(decision))?$/);
      if(reviewerEquipment){const [,checkId,part]=reviewerEquipment,view=store.reviewerEquipmentCheck(reviewer.id,checkId);if(!view)return json(res,404,{error:'결재할 시험 점검을 찾을 수 없습니다.'});
        if(!part&&req.method==='GET')return json(res,200,view);
        if(part==='decision'&&req.method==='POST'){const input=await body(req);return json(res,200,store.reviewEquipmentCheck(reviewer.id,checkId,input.action,input.opinion,input.signature,input.expectedCycleId,()=>checkRequestSession(req)));}
      }
      const reference=url.pathname.match(/^\/api\/reviewer\/references\/(\d+)(?:\/(attachments\/(\d+)|linked\/office-reference\/(\d+)\/(\d+)|signatures\/author\/0))?$/);
      if(reference&&req.method==='GET'){
        const [,id,part,fileId,parentId,linkedId]=reference,doc=store.officeReferenceDocument(reviewer.id,id);if(!doc)return json(res,404,{error:'참조 문서를 찾을 수 없습니다.'});
        const payload=store.reviewerPayload(doc);if(!part)return json(res,200,payload);
        if(part==='signatures/author/0'){const signature=store.reviewerLinkedSignature(doc,'author',0);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
        const file=fileId?(payload.attachments.some(item=>item.id===Number(fileId))&&store.reviewerAttachment(doc,fileId)):store.reviewerLinkedFile(doc,'office-reference',parentId,linkedId);if(!file)return json(res,404,{error:'참조 파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);
      }
      const priorSignature=url.pathname.match(/^\/api\/reviewer\/documents\/(\d+)\/prior-signatures\/(\d+)$/);
      if(priorSignature&&req.method==='GET'){const [,id,eventId]=priorSignature,doc=store.reviewerDocument(reviewer.id,id),permitted=doc&&store.priorReviewerEvents(doc,reviewer.id).some(event=>event.id===Number(eventId)&&event.has_signature),signature=permitted&&store.eventSignature(id,eventId);if(!signature)return json(res,404,{error:'시험 결재 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
      const planEquipmentSignature=url.pathname.match(/^\/api\/reviewer\/documents\/(\d+)\/equipment-checks\/(\d+)\/review-signatures\/(\d+)$/);
      if(planEquipmentSignature&&req.method==='GET'){const [,id,checkId,position]=planEquipmentSignature,doc=store.reviewerDocument(reviewer.id,id),signature=doc&&store.reviewerPlanEquipmentSignature(doc,checkId,position);if(!signature)return json(res,404,{error:'점검 결재 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
      const linkedSignature=url.pathname.match(/^\/api\/reviewer\/documents\/(\d+)\/signatures\/(permit|training|author|equipment-check|risk-activity)\/(\d+)$/);
      if(linkedSignature&&req.method==='GET'){const [,id,kind,recordId]=linkedSignature,doc=store.reviewerDocument(reviewer.id,id),signature=doc&&store.reviewerLinkedSignature(doc,kind,recordId);if(!signature)return json(res,404,{error:'연결된 시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
      const linkedFile=url.pathname.match(/^\/api\/reviewer\/documents\/(\d+)\/linked\/(equipment|rigging|place|risk|office-reference|cost-photo)\/(\d+)\/(\d+)$/);
      if(linkedFile&&req.method==='GET'){const [,id,kind,parentId,fileId]=linkedFile,doc=store.reviewerDocument(reviewer.id,id),file=doc&&store.reviewerLinkedFile(doc,kind,parentId,fileId);if(!file)return json(res,404,{error:'연결된 시험 파일을 찾을 수 없습니다.'});const bytes=Buffer.from(file.data);if(url.searchParams.get('preview')==='1'){const type=kind==='cost-photo'?costImageType(bytes):(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':null);if(!type)return json(res,415,{error:'미리 볼 수 없는 파일입니다.'});res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);}const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);}
      const reviewDoc=url.pathname.match(/^\/api\/reviewer\/documents\/(\d+)(?:\/(decision|attachments|comments)(?:\/(\d+))?)?$/);
      if(reviewDoc){const [,id,part,fileId]=reviewDoc,doc=store.reviewerDocument(reviewer.id,id);if(!doc)return json(res,404,{error:'결재할 문서를 찾을 수 없습니다.'});
        if(!part&&req.method==='GET'){const canFinalApprove=doc.type==='office'&&store.reviewerCanFinalApprove(reviewer.id),line=canFinalApprove?store.approvalLine(id):[],position=line.findIndex(step=>step.reviewer_id===reviewer.id);return json(res,200,{...store.reviewerPayload(doc),priorReviews:store.priorReviewerEvents(doc,reviewer.id),canFinalApprove,remainingApprovers:position<0?[]:line.slice(position+1).map(step=>step.name)});}
        if(part==='comments'&&!fileId&&req.method==='POST'){const input=await body(req);store.reviewerComment(id,reviewer.id,input.opinion,()=>checkRequestSession(req),input.expectedCycleId??null);return json(res,201,{ok:true});}
        if(part==='decision'&&!fileId&&req.method==='POST'){const input=await body(req);return json(res,200,store.reviewerTransition(id,reviewer.id,input.action,input.opinion,input.signature,()=>checkRequestSession(req),input.expectedCycleId??null));}
        if(part==='attachments'&&fileId&&req.method==='GET'){const payload=store.reviewerPayload(doc),file=payload.attachments.some(item=>item.id===Number(fileId))&&store.reviewerAttachment(doc,fileId);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
      }
      return json(res,404,{error:'요청한 경로가 없습니다.'});
    }
    const workerToken=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('jweb_worker='))?.slice(12)||'';
    if(url.pathname.startsWith('/api/worker/')&&!['/api/worker/site','/api/worker/login','/api/worker/logout','/api/worker/departure'].includes(url.pathname)){
      const session=workerSessions.get(workerKey(workerToken)),now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      if(session&&session.expires>now.getTime()&&store.workerAccessBlocked(session.worker.site_id,date))return json(res,403,{error:'해당 현장은 오늘 근로자 접속이 차단되었습니다.'});
      if(session&&session.expires>now.getTime())req.checkSession=()=>workerSessionError(workerToken,session);
    }
    if(url.pathname==='/api/worker/departure'&&['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now())return json(res,401,{error:'근로자 로그인이 필요합니다.'});const check=()=>{const current=workerSessions.get(key);if(!current||current!==session||current.expires<=Date.now())throw Object.assign(new Error('근로자 로그인이 필요합니다.'),{sessionStatus:401});};if(req.method==='GET'){const policy=store.siteLocationPolicy(session.worker.site_id);check();return json(res,200,{locationRequired:policy.enabled});}const input=await body(req);return json(res,200,store.recordWorkerDeparture(session.worker.site_id,session.worker.id,key,input.location,()=>{check();checkWorkerReport(req,key,session,input);}));
    }
    if(url.pathname==='/worker.webmanifest'&&req.method==='GET'){
      const key=url.searchParams.get('site');if(!store.siteFromAccess(key))return json(res,404,{error:'현장 접속 주소를 확인해 주세요.'});
      const start=workerSitePath(key);res.writeHead(200,{'Content-Type':'application/manifest+json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});return res.end(JSON.stringify({name:'J웹 현장 출입',short_name:'J웹',id:start,start_url:start,scope:'/join',display:'standalone',background_color:'#f4f6fa',theme_color:'#213c80',icons:[{src:'/jweb-icon.svg',sizes:'any',type:'image/svg+xml'},{src:'/jweb-icon-192.png',sizes:'192x192',type:'image/png'},{src:'/jweb-icon-512.png',sizes:'512x512',type:'image/png'}]}));
    }
    if(url.pathname==='/api/worker/site'&&req.method==='GET'){const site=store.siteFromAccess(url.searchParams.get('key'));if(!site)return json(res,404,{error:'현장 접속 주소를 확인해 주세요.'});const canSignup=store.siteRegistrationOpen(site.id);return json(res,200,{...site,canSignup,locationRequired:store.siteLocationPolicy(site.id).enabled,...(canSignup?{companies:store.companies(site.id).map(c=>c.name),occupations:store.siteOccupations(site.id).map(o=>o.name)}:{})});}
    if(url.pathname==='/api/worker/login' && req.method==='POST'){
      const input=await body(req),now=Date.now(),site=input.siteKey?store.siteFromAccess(input.siteKey):store.invitation(input.token),identityMode=input.method==='identity',identity=identityMode&&site?store.workerLoginIdentity(site.id,input.name,input.birthDigits):null,loginId=identityMode?identity?.login_id:input.loginId,accountKey=site&&typeof loginId==='string'&&/^[a-zA-Z0-9_]{3,40}$/.test(loginId)?`${site.id}:${loginId}`:identityMode&&site?`${site.id}:identity:${createHash('sha256').update(JSON.stringify([input.name,input.birthDigits])).digest('hex')}`:'invalid';
      const peer=workerPeer(req);if(peer===null)return json(res,503,{error:'로그인 중계 설정을 확인해 주세요.'});
      const release=workerLoginFailures.reserve(peer,accountKey,now);let authenticated;
      try{authenticated=await store.authenticateWorkerAsync(input.token,loginId,input.password,input.siteKey,true,peer);}finally{release();}
      if(!authenticated){workerLoginFailures.record(peer,accountKey,Date.now());return json(res,401,{error:'가입 링크 또는 로그인 정보를 확인해 주세요.'});}
      const {worker,credentialHash}=authenticated;
      const current=new Date(),date=new Date(current.getTime()-current.getTimezoneOffset()*60000).toISOString().slice(0,10);
      if(store.workerAccessBlocked(worker.site_id,date))return json(res,403,{error:'해당 현장은 오늘 근로자 접속이 차단되었습니다.'});
      if(store.workerAccountBlock(worker.site_id,worker.id).blocked)return json(res,403,{error:'시험 계정의 접속이 차단되었습니다.'});
      const raw=randomBytes(32).toString('base64url');store.recordWorkerLogin(worker.id,date,credentialHash,()=>{const currentSite=input.siteKey?store.siteFromAccess(input.siteKey):store.invitation(input.token);if(!currentSite||currentSite.id!==worker.site_id||identityMode&&store.workerLoginIdentity(currentSite.id,input.name,input.birthDigits)?.worker_id!==worker.id){const error=new Error('가입 링크 또는 로그인 정보를 확인해 주세요.');error.sessionStatus=401;throw error;}workerSessions.delete(workerKey(workerToken));workerSessions.set(workerKey(raw),{worker,expires:now+8*60*60*1000});},input.location);
      workerAccountFailures.delete(accountKey);
      for(const [key,session] of workerSessions)if(session.expires<=now)workerSessions.delete(key);
      res.setHeader('Set-Cookie',`jweb_worker=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie}`);return json(res,200,{worker,reportContext:workerReportContext(workerKey(raw),worker),siteKey:store.siteAccessKey(worker.site_id)});
    }
    if(url.pathname==='/api/worker/session' && req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key),now=new Date();
      if(!session || session.expires<=now.getTime()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10),nextDay=new Date(now);
      nextDay.setHours(24,0,0,0);
      return json(res,200,{worker:session.worker,reportContext:workerReportContext(key,session.worker),date,nextDayAt:nextDay.toISOString(),serverNow:now.toISOString()});
    }
    if(url.pathname==='/api/worker/access' && req.method==='POST'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const input=await body(req),site=input.siteKey?store.siteFromAccess(input.siteKey):store.invitation(input.token);if(!Number.isSafeInteger(input.siteId)||input.siteId!==session.worker.site_id||!site||site.id!==session.worker.site_id)return json(res,400,{error:'유효한 현장 접속 주소를 확인해 주세요.'});
      const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);store.recordWorkerLogin(session.worker.id,date,null,()=>{checkWorkerReport(req,key,session,input);const failure=workerSessionError(workerToken,session);if(failure)throw Object.assign(new Error(failure.error),{sessionStatus:failure.status});const currentSite=input.siteKey?store.siteFromAccess(input.siteKey):store.invitation(input.token);if(!currentSite||currentSite.id!==session.worker.site_id)throw new Error('유효한 현장 접속 주소를 확인해 주세요.');},input.location);return json(res,200,{ok:true,siteKey:store.siteAccessKey(session.worker.site_id)});
    }
    if(url.pathname==='/api/worker/permissions'&&req.method==='GET'){
      const session=workerSessions.get(workerKey(workerToken));if(!session||session.expires<=Date.now())return json(res,401,{error:'근로자 로그인이 필요합니다.'});return json(res,200,store.workerPermissions(session.worker.site_id,session.worker.id));
    }
    if(url.pathname==='/api/worker/muscle-references'&&req.method==='GET'){
      const session=workerSessions.get(workerKey(workerToken));if(!session||session.expires<=Date.now())return json(res,401,{error:'근로자 로그인이 필요합니다.'});
      const result=store.workerMuscleReferences(session.worker.site_id,session.worker.id,url.searchParams.get('scale')??'');checkRequestSession(req);
      if(!store.workerPermissions(session.worker.site_id,session.worker.id).includes('risk'))return json(res,403,{error:'위험성평가 작성 권한이 필요합니다.'});return json(res,200,result);
    }
    if(url.pathname==='/api/worker/document-options'&&req.method==='GET'){
      const session=workerSessions.get(workerKey(workerToken));if(!session||session.expires<=Date.now())return json(res,401,{error:'근로자 로그인이 필요합니다.'});return json(res,200,store.workerDocumentOptions(session.worker.site_id,session.worker.id,url.searchParams.get('type')));
    }
    if(url.pathname==='/api/worker/documents'&&['GET','POST'].includes(req.method)){
      const session=workerSessions.get(workerKey(workerToken));if(!session||session.expires<=Date.now())return json(res,401,{error:'근로자 로그인이 필요합니다.'});if(req.method==='GET')return json(res,200,store.workerDocuments(session.worker.site_id,session.worker.id));const input=await body(req,120000),failure=workerSessionError(workerToken,session);if(failure)return json(res,failure.status,{error:failure.error});return json(res,201,store.createWorkerDocument(session.worker.site_id,session.worker.id,input,()=>checkWorkerReport(req,workerKey(workerToken),session,input)));
    }
    const workerPlanSignature=url.pathname.match(/^\/api\/worker\/documents\/(\d+)\/author-signature(?:\/(image))?$/);
    if(workerPlanSignature){
      const session=workerSessions.get(workerKey(workerToken));if(!session||session.expires<=Date.now())return json(res,401,{error:'근로자 로그인이 필요합니다.'});
      const [,id,image]=workerPlanSignature,siteId=session.worker.site_id,workerId=session.worker.id,authorize=()=>{checkRequestSession(req);const doc=store.workerDocument(siteId,workerId,id);if(doc.type!=='work_plan')throw new Error('작업계획서를 확인해 주세요.');return doc;};
      const doc=authorize();
      if(req.method==='POST'&&!image){const input=await body(req);store.saveMeetingSignature(id,input.signature,()=>{checkWorkerReport(req,workerKey(workerToken),session,input);authorize();},input.expectedVersion,input.expectedEditVersion??null);return json(res,200,{ok:true});}
      if(req.method==='GET'){const info=store.planSignatureInfo(doc);if(!image){authorize();return json(res,200,info);}const saved=store.meetingSignature(id);authorize();if(!saved)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(saved.signature);}
    }
    const workerTraining=url.pathname.match(/^\/api\/worker\/documents\/(\d+)\/training(?:\/(signature))?$/);
    if(workerTraining){
      const session=workerSessions.get(workerKey(workerToken));if(!session||session.expires<=Date.now())return json(res,401,{error:'근로자 로그인이 필요합니다.'});
      const [,id,signature]=workerTraining,authorize=()=>{checkRequestSession(req);const doc=store.workerDocument(session.worker.site_id,session.worker.id,id);if(!['tbm','education'].includes(doc.type))throw new Error('교육 문서를 확인해 주세요.');return doc;},doc=authorize();
      if(signature&&doc.type!=='tbm')throw new Error('TBM 문서를 확인해 주세요.');
      if(req.method==='GET'){if(signature){const saved=store.tbmSignature(id);authorize();if(!saved)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(saved.signature);}const state=store.trainingState(id,authorize),{managers,...targets}=state.targets;return json(res,200,{...state,targets});}
      if((req.method==='PUT'&&!signature)||(req.method==='POST'&&signature)){const input=await body(req),check=()=>{checkWorkerReport(req,workerKey(workerToken),session,input);authorize();if(input.managerIds!==undefined)throw Object.assign(new Error('관리자 교육 대상은 현장 관리자가 지정합니다.'),{sessionStatus:403});if(typeof input.expectedVersion!=='string'||input.expectedVersion!==store.trainingStateVersion(id))throw Object.assign(new Error('교육 문서 또는 대상이 변경되었습니다. 다시 확인해 주세요.'),{sessionStatus:409});};if(signature)store.saveTbmSignature(id,input.signature,check);else store.setTrainingTargets(id,input.workerIds,check);return json(res,200,{ok:true});}
    }
    const workerDocument=url.pathname.match(/^\/api\/worker\/documents\/(\d+)(?:\/(transition|attachments)(?:\/(\d+))?)?$/);
    if(workerDocument){
      const session=workerSessions.get(workerKey(workerToken));if(!session||session.expires<=Date.now())return json(res,401,{error:'근로자 로그인이 필요합니다.'});const [,id,part,fileId]=workerDocument,siteId=session.worker.site_id,workerId=session.worker.id,doc=store.workerDocument(siteId,workerId,id);
      if(!part&&req.method==='GET')return json(res,200,doc);if(!part&&req.method==='PUT'){const input=await body(req,120000);if(!Number.isSafeInteger(input.expectedEditVersion))throw Object.assign(new Error('문서 버전이 없습니다. 입력 내용을 복사한 뒤 화면을 새로고침해 주세요.'),{sessionStatus:409});const failure=workerSessionError(workerToken,session);if(failure)return json(res,failure.status,{error:failure.error});return json(res,200,store.updateWorkerDocument(siteId,workerId,id,input,()=>checkWorkerReport(req,workerKey(workerToken),session,input)));}
      if(part==='transition'&&req.method==='POST'&&!fileId){const input=await body(req),failure=workerSessionError(workerToken,session);if(failure)return json(res,failure.status,{error:failure.error});return json(res,200,store.transitionWorkerDocument(siteId,workerId,id,input.action,()=>checkWorkerReport(req,workerKey(workerToken),session,input),input.expectedEditVersion??null));}
      if(part==='attachments'&&!fileId&&req.method==='GET')return json(res,200,store.attachments(id));
      if(part==='attachments'&&!fileId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}const failure=workerSessionError(workerToken,session);if(failure)return json(res,failure.status,{error:failure.error});store.workerDocument(siteId,workerId,id);return json(res,201,{id:store.addAttachment(id,name,Buffer.concat(chunks),url.searchParams.get('category')||'general',()=>{checkWorkerReport(req,workerKey(workerToken),session);store.workerDocument(siteId,workerId,id);})});}
      if(part==='attachments'&&fileId&&['GET','DELETE'].includes(req.method)){const file=store.attachment(fileId);if(!file||file.document_id!==doc.id)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});if(req.method==='DELETE'){const input=await body(req);store.deleteAttachment(fileId,()=>{checkWorkerReport(req,workerKey(workerToken),session,input);store.workerDocument(siteId,workerId,id);const current=store.attachment(fileId);if(!current||current.document_id!==Number(id))throw new Error('첨부파일을 찾을 수 없습니다.');});return json(res,200,{ok:true});}const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
    }
    if(url.pathname==='/api/worker/managed-attendance'&&['GET','PUT'].includes(req.method)){
      const session=workerSessions.get(workerKey(workerToken));if(!session||session.expires<=Date.now())return json(res,401,{error:'근로자 로그인이 필요합니다.'});const {site_id:siteId,id:workerId}=session.worker;
      if(!store.workerPermissions(siteId,workerId).includes('attendance'))return json(res,403,{error:'출역 관리 시험 권한이 필요합니다.'});
      if(req.method==='GET')return json(res,200,store.delegatedAttendance(siteId,workerId,url.searchParams.get('date')));
      const input=await body(req);if(!store.workerPermissions(siteId,workerId).includes('attendance'))return json(res,403,{error:'출역 관리 시험 권한이 필요합니다.'});const now=new Date();if(input.date!==new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10))return json(res,400,{error:'출역은 오늘 날짜만 변경할 수 있습니다.'});store.setDelegatedAttendance(siteId,workerId,input,()=>{checkWorkerReport(req,workerKey(workerToken),session,input);const current=new Date(),today=new Date(current.getTime()-current.getTimezoneOffset()*60000).toISOString().slice(0,10);if(input.date!==today)throw Object.assign(new Error('오늘 날짜가 바뀌었습니다. 다시 조회해 주세요.'),{sessionStatus:409});});return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/worker/attendance' && req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      return json(res,200,{days:store.workerAttendance(session.worker.id,url.searchParams.get('month')),units:store.workerAttendanceUnits(session.worker.id,url.searchParams.get('month'))});
    }
    if(url.pathname==='/api/worker/ppe-issues'&&req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      return json(res,200,store.workerPpeIssues(session.worker.site_id,session.worker.id));
    }
    const workerPpeReceipt=url.pathname.match(/^\/api\/worker\/ppe-issues\/(\d+)\/receipt$/);
    if(workerPpeReceipt){
      const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const id=workerPpeReceipt[1],siteId=session.worker.site_id,workerId=session.worker.id;
      if(req.method==='POST'){const input=await body(req);store.confirmPpeReceipt(siteId,workerId,id,input.version,input.signature,()=>checkWorkerReport(req,key,session,input));return json(res,200,{ok:true});}
      if(req.method==='GET'){const signature=store.ppeReceipt(siteId,workerId,id);checkRequestSession(req);if(!signature)return json(res,404,{error:'시험 수령 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="test-ppe-receipt.png"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
    }
    const workerArticleFile=url.pathname.match(/^\/api\/worker\/articles\/(\d+)\/files\/(\d+)$/);
    if(workerArticleFile&&req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      let file=store.workerArticleFile(session.worker.id,workerArticleFile[1],workerArticleFile[2]);checkRequestSession(req);if(file)file=store.workerArticleFile(session.worker.id,workerArticleFile[1],workerArticleFile[2]);checkRequestSession(req);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});
      const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);
    }
    if(url.pathname==='/api/worker/articles' && req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const items=store.workerArticles(session.worker.id);checkRequestSession(req);return json(res,200,items);
    }
    if(url.pathname==='/api/worker/notices' && req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      return json(res,200,store.workerNotices(session.worker.id,date));
    }
    const workerNoticeFile=url.pathname.match(/^\/api\/worker\/notices\/(\d+)\/files\/(\d+)$/);
    if(workerNoticeFile&&req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10),file=store.workerNoticeFile(session.worker.id,workerNoticeFile[1],workerNoticeFile[2],date);
      if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});
      const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);
    }
    if(url.pathname==='/api/worker/instructions' && ['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      if(req.method==='GET'){if(req.headers['x-worker-report-context']!==undefined)checkWorkerReport(req,key,session);return json(res,200,store.workerInstructions(session.worker.id));}
      const input=await body(req);return json(res,201,store.respondInstruction(session.worker.id,input.documentId,input,()=>checkWorkerReport(req,key,session,input)));
    }
    const workerInstructionAttachments=url.pathname.match(/^\/api\/worker\/instructions\/(\d+)\/attachments(?:\/(\d+))?$/);
    if(workerInstructionAttachments && req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      if(req.headers['x-worker-report-context']!==undefined)checkWorkerReport(req,key,session);
      const [,id,fileId]=workerInstructionAttachments,files=store.workerInstructionAttachments(session.worker.id,id);
      if(!fileId)return json(res,200,files);
      if(!files.some(file=>file.id===Number(fileId)))return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});
      const file=store.attachment(fileId),name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);
    }
    const workerInstructionPhotos=url.pathname.match(/^\/api\/worker\/instructions\/(\d+)\/photos(?:\/(\d+))?$/);
    if(workerInstructionPhotos && ['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const [,id,photoId]=workerInstructionPhotos;
      if(req.method==='GET'){
        if(req.headers['x-worker-report-context']!==undefined)checkWorkerReport(req,key,session);
        const photos=store.workerInstructionPhotos(session.worker.id,id);
        if(!photoId)return json(res,200,photos);
        if(!photos.some(photo=>photo.id===Number(photoId)))return json(res,404,{error:'시험 사진을 찾을 수 없습니다.'});
        const photo=store.instructionPhoto(id,photoId);return instructionPhotoResponse(res,photo,url.searchParams.get('preview')==='1');
      }
      if(photoId)return json(res,404,{error:'요청을 찾을 수 없습니다.'});
      store.workerInstructionPhotos(session.worker.id,id);
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);
      const failure=workerSessionError(workerToken,session);if(failure)return json(res,failure.status,{error:failure.error});
      let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('사진 이름을 확인해 주세요.');}
      return json(res,201,{id:store.addWorkerInstructionPhoto(session.worker.id,id,url.searchParams.get('phase'),name,Buffer.concat(chunks),()=>checkWorkerReport(req,key,session))});
    }
    const workerMeetingFile=url.pathname.match(/^\/api\/worker\/meetings\/(\d+)\/attachments\/(\d+)$/);
    if(workerMeetingFile&&req.method==='GET'){const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}const file=store.workerMeetingAttachment(session.worker.id,workerMeetingFile[1],workerMeetingFile[2]);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
    if(url.pathname==='/api/worker/meetings'&&['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      if(req.method==='GET')return json(res,200,store.workerMeetings(session.worker.id));
      const input=await body(req);store.confirmWorkerMeeting(session.worker.id,input.documentId,input.signature,()=>checkWorkerReport(req,workerKey(workerToken),session,input));return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/worker/self-check' && ['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const input=req.method==='POST'?await body(req):null,now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      if(req.method==='GET')return json(res,200,{check:store.workerSelfCheck(session.worker.id,date)});
      return json(res,200,{check:store.createWorkerSelfCheck(session.worker.id,date,input.answers,input.signature,()=>checkWorkerReport(req,workerKey(workerToken),session,input))});
    }
    if(url.pathname==='/api/worker/daily-training' && ['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const input=req.method==='POST'?await body(req):null,now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      if(req.method==='GET')return json(res,200,store.dailyTraining(session.worker.id,date));
      return json(res,200,store.confirmDailyTraining(session.worker.id,date,input.kinds,input.rightsConfirmed,input.signature,()=>checkWorkerReport(req,workerKey(workerToken),session,input)));
    }
    const workerTrainingFile=url.pathname.match(/^\/api\/worker\/training\/(\d+)\/attachments\/(\d+)$/);
    if(workerTrainingFile&&req.method==='GET'){const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10),file=store.workerTrainingAttachment(session.worker.id,workerTrainingFile[1],workerTrainingFile[2],date);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
    if(url.pathname==='/api/worker/training' && ['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const input=req.method==='POST'?await body(req):null,now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      if(req.method==='GET')return json(res,200,store.workerTraining(session.worker.id,date));
      store.confirmWorkerTraining(session.worker.id,input.documentId,date,input.rightsConfirmed,input.signature,()=>checkWorkerReport(req,workerKey(workerToken),session,input));return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/worker/hazard-reports' && ['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      if(req.method==='GET')return json(res,200,store.workerHazardReports(session.worker.id));
      const input=await body(req,2805000);return json(res,201,{id:store.createWorkerHazardReport(session.worker.id,input,()=>checkWorkerReport(req,key,session,input))});
    }
    const workerHazardPhoto=url.pathname.match(/^\/api\/worker\/hazard-reports\/(\d+)\/photo$/);
    if(workerHazardPhoto&&req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const photo=store.workerHazardPhoto(session.worker.id,workerHazardPhoto[1]);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});const bytes=Buffer.from(photo),type=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':'image/jpeg';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
    }
    if(url.pathname==='/api/worker/work-stops' && req.method==='POST'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const input=await body(req,2805000);store.createWorkStop(session.worker.id,input,()=>checkWorkerReport(req,key,session,input));return json(res,201,{ok:true});
    }
    const workerNotice=url.pathname.match(/^\/api\/worker\/notices\/(\d+)\/confirm$/);
    if(workerNotice && req.method==='POST'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const input=await body(req),now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);store.confirmWorkerNotice(session.worker.id,workerNotice[1],input.signature,date,input.version,()=>{checkWorkerReport(req,key,session,input);const current=new Date();if(new Date(current.getTime()-current.getTimezoneOffset()*60000).toISOString().slice(0,10)!==date)throw Object.assign(new Error('날짜가 변경되었습니다. 공지를 다시 확인해 주세요.'),{sessionStatus:409});});return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/worker/logout' && req.method==='POST'){
      workerSessions.delete(workerKey(workerToken));res.setHeader('Set-Cookie',`jweb_worker=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);return json(res,200,{ok:true});
    }
    if(url.pathname.startsWith('/api/') && url.pathname!=='/api/join' && !auth.valid(token))return json(res,401,{error:'관리자 로그인이 필요합니다.'});
    if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/join'){
      req.checkSession=()=>{if(!auth.valid(token))return {status:401,error:'관리자 로그인이 필요합니다.'};if((req.headers['x-admin-context']||!['GET','HEAD'].includes(req.method)&&(req.headers.origin||req.headers['sec-fetch-site']))&&req.headers['x-admin-context']!==auth.context(token))return {status:409,error:'관리자 세션이 변경되었습니다. 입력 내용을 복사하고 새로고침해 주세요.'};return adminSitePolicy(store.db,req,url,()=>auth.session(token));};checkRequestSession(req);req.adminProtected=true;const writeHead=res.writeHead;res.writeHead=function(...args){if(args[0]<400&&!url.pathname.startsWith('/api/admin-accounts'))checkRequestSession(req);return writeHead.apply(this,args);};
    }
    if(url.pathname==='/api/notifications/status'&&req.method==='GET'){auth.requireGlobal(token);return json(res,200,notificationOutbox.status());}
    const notificationRoute=url.pathname.match(/^\/api\/sites\/([1-9]\d*)\/notifications(?:\/(preview|[\w-]{43})(?:\/(send|results\/(\d{1,2})))?)?$/);
    if(notificationRoute){
      const [,site,part,action,index]=notificationRoute,siteId=Number(site),authorize=()=>{checkRequestSession(req);auth.requireGlobal(token);};authorize();
      if(!part&&req.method==='GET')return json(res,200,notificationOutbox.list(siteId,authorize));
      if(part==='preview'&&!action&&req.method==='POST')return json(res,200,notificationOutbox.prepare(siteId,await body(req),token,authorize));
      if(part&&action==='send'&&req.method==='POST')return json(res,200,await notificationOutbox.send(siteId,part,await body(req),token,authorize));
      if(part&&index!==undefined&&req.method==='POST'){await body(req);return json(res,200,await notificationOutbox.refresh(siteId,part,Number(index),authorize));}
      return json(res,405,{error:'지원하지 않는 요청입니다.'});
    }
    if(url.pathname==='/api/admin-accounts'&&req.method==='GET'){let rows;store.db.exec('BEGIN IMMEDIATE');try{checkRequestSession(req);auth.requireGlobal(token);rows=auth.list();store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}checkRequestSession(req);return json(res,200,rows);}
    if(url.pathname==='/api/admin-accounts'&&req.method==='POST')return json(res,201,await auth.createAsync(await body(req),()=>{checkRequestSession(req);auth.requireGlobal(token);},workerPeer(req)));
    const adminAccount=url.pathname.match(/^\/api\/admin-accounts\/(\d+)$/);
    if(adminAccount&&req.method==='PUT')return json(res,200,await auth.updateAsync(adminAccount[1],await body(req),()=>{checkRequestSession(req);auth.requireGlobal(token);},workerPeer(req)));
    if(url.pathname.startsWith('/api/ai/')){
      try{
        if(url.pathname==='/api/ai/status'&&req.method==='GET')return json(res,200,aiChat.status());
        if(url.pathname==='/api/ai/chat'&&req.method==='POST')return json(res,200,await aiChat.chat(await body(req,AI_BODY_LIMIT),token,()=>checkRequestSession(req)));
        if(url.pathname==='/api/ai/feedback'&&req.method==='POST')return json(res,200,aiChat.feedback(await body(req),token,()=>checkRequestSession(req)));
      }catch(error){if(error.aiStatus)return json(res,error.aiStatus,{error:error.message});throw error;}
    }
    const stickerRoute=url.pathname.match(/^\/api\/sites\/(\d+)\/sticker-requests(?:\/(\d+))?$/);
    if(stickerRoute){const [,siteId,id]=stickerRoute;
      if(!id&&req.method==='GET'){const rows=stickerRequests.list(siteId);checkRequestSession(req);return json(res,200,rows);}
      if(!id&&req.method==='POST')return json(res,201,stickerRequests.create(siteId,await body(req),()=>checkRequestSession(req)));
      if(id&&['PUT','DELETE'].includes(req.method))return json(res,200,stickerRequests.change(siteId,id,await body(req),req.method==='DELETE',()=>checkRequestSession(req)));
    }
    if(await handleCommonWork(req,res,url,'/api/common-work'))return;
    if(req.method==='GET'&&pdfAssets.has(url.pathname)){
      res.writeHead(200,{'Content-Type':url.pathname.endsWith('.mjs')?'text/javascript; charset=utf-8':url.pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});return res.end(readFileSync(pdfAssets.get(url.pathname)));
    }
    const planPdf=url.pathname.match(/^\/api\/documents\/(\d+)\/print-pdfs(?:\/(\d+))?$/);
    if(planPdf&&req.method==='GET'){
      const doc=store.document(planPdf[1]);if(!doc||doc.type!=='work_plan')return json(res,404,{error:'작업계획서를 찾을 수 없습니다.'});
      const files=store.attachments(doc.id).filter(file=>/\.pdf$/i.test(file.name)).sort((a,b)=>a.id-b.id);
      const version=createHash('sha256').update(JSON.stringify(doc)).update(store.planSignatureVersion(doc)).update(store.meetingSignature(doc.id)?.signature||'').digest('hex');
      if(url.searchParams.has('version')&&url.searchParams.get('version')!==version)return json(res,409,{error:'계획서 또는 연결 자료가 변경되었습니다. 다시 조회해 주세요.'});
      checkRequestSession(req);
      if(!planPdf[2])return json(res,200,{document:doc,version,files:files.map(({id,name})=>({id,name}))});
      if(url.searchParams.get('version')!==version)return json(res,409,{error:'계획서를 다시 조회해 주세요.'});
      const file=files.some(item=>item.id===Number(planPdf[2]))&&store.attachment(planPdf[2]);
      if(!file||file.document_id!==doc.id)return json(res,404,{error:'이 계획서의 PDF 첨부를 찾을 수 없습니다.'});
      const bytes=Buffer.from(file.data);if(bytes.length>2*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')return json(res,415,{error:'2MB 이하의 올바른 PDF 파일을 사용해 주세요.'});
      res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment'});return res.end(bytes);
    }
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const path = url.pathname === '/' ? '/index.html' : url.pathname === '/join' ? '/join.html' : url.pathname === '/login' ? '/login.html' : url.pathname === '/review' ? '/review.html' : url.pathname === '/client' ? '/client.html' : url.pathname === '/employment-certificate' ? '/employment-certificate.html' : url.pathname;
      res.writeHead(200, {'Content-Type':mime[extname(path)],'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'self'; img-src 'self' data: blob:; style-src 'self'${url.pathname==='/offline-forms.html'?" 'unsafe-inline'":''}; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'`});
      return res.end(readFileSync(join(root,'public',path.slice(1))));
    }
    const dailyPrintPhotos=url.pathname.match(/^\/api\/sites\/(\d+)\/daily-reports\/(\d+)\/print-photos(?:\/(attachment|site)\/(\d+))?$/);
    if(dailyPrintPhotos&&req.method==='GET'){
      const [,siteId,id,kind,fileId]=dailyPrintPhotos,doc=store.document(id);if(!doc||doc.type!=='daily_report'||doc.site_id!==Number(siteId))return json(res,404,{error:'작업일보를 찾을 수 없습니다.'});
      if(!kind){const metadata=(kind,file)=>{const photo=dailyReportPhoto(doc,kind,file.id);if(!photo)return null;const {bytes,...item}=photo;return item;},files=[...store.attachments(doc.id).map(file=>metadata('attachment',file)),...store.sitePhotos(doc.site_id,doc.date,doc.date).map(file=>metadata('site',file))].filter(Boolean);checkRequestSession(req);return json(res,200,files);}
      const file=dailyReportPhoto(doc,kind,fileId);if(!file)return json(res,404,{error:'일치하는 사진을 찾을 수 없습니다.'});if(url.searchParams.get('version')!==file.version)return json(res,409,{error:'사진이 변경되었습니다. 다시 조회해 주세요.'});checkRequestSession(req);res.writeHead(200,{'Content-Type':file.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.bytes);
    }
    if(url.pathname==='/api/personal-supervisor'){
      if(req.method==='GET')return json(res,200,personalNotes.supervisor(url.searchParams.get('siteId')));
      if(req.method==='PUT'){const input=await body(req);return json(res,200,personalNotes.setSupervisor(input.siteId,input.reviewerId,()=>checkRequestSession(req)));}
    }
    if(url.pathname==='/api/personal-notes/preview'&&req.method==='POST'){const input=await body(req),result=personalNotes.preview(input.siteId,input.items);checkRequestSession(req);return json(res,200,result);}
    if(url.pathname==='/api/personal-notes'){
      if(req.method==='GET')return json(res,200,personalNotes.list(url.searchParams.get('siteId'),url.searchParams.get('from')||'',url.searchParams.get('to')||'',url.searchParams.get('q')||''));
      if(req.method==='POST'){const input=await body(req);return json(res,201,personalNotes.create(input,()=>checkRequestSession(req)));}
    }
    const personalFile=url.pathname.match(/^\/api\/personal-notes\/(\d+)\/files(?:\/(\d+))?$/);
    if(personalFile){
      const [,id,fileId]=personalFile,siteId=url.searchParams.get('siteId');
      if(!fileId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw Error('파일 이름을 확인해 주세요.');}return json(res,201,personalNotes.addFile(siteId,id,url.searchParams.get('version'),name,Buffer.concat(chunks),()=>checkRequestSession(req)));}
      if(fileId&&req.method==='GET'){const file=personalNotes.file(siteId,id,fileId);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
      if(fileId&&req.method==='DELETE'){const input=await body(req);personalNotes.removeFile(siteId,id,fileId,input.version,()=>checkRequestSession(req));return json(res,200,{ok:true});}
    }
    const personalNote=url.pathname.match(/^\/api\/personal-notes\/(\d+)(?:\/(check))?$/);
    if(personalNote){
      const [,id,action]=personalNote;
      if(!action&&req.method==='PUT'){const input=await body(req);return json(res,200,personalNotes.update(input.siteId,id,input,()=>checkRequestSession(req)));}
      if(!action&&req.method==='DELETE'){const input=await body(req);personalNotes.remove(input.siteId,id,input.version,()=>checkRequestSession(req));return json(res,200,{ok:true});}
      if(action==='check'&&req.method==='POST'){const input=await body(req);return json(res,200,personalNotes.check(input.siteId,id,input.version,()=>checkRequestSession(req)));}
    }
    if (url.pathname === '/api/types' && req.method === 'GET') return json(res,200,types);
    if(url.pathname==='/api/client-accounts'&&req.method==='GET'){const result=clients.list();checkRequestSession(req);return json(res,200,result);}
    const clientAccount=url.pathname.match(/^\/api\/client-accounts\/(\d+)$/);
    if(clientAccount&&req.method==='PUT'){const input=await body(req);return json(res,200,await clients.updateAsync(clientAccount[1],input,()=>checkRequestSession(req),workerPeer(req)));}
    const employmentProfile=url.pathname.match(/^\/api\/reviewers\/(\d+)\/employment$/);
    if(employmentProfile){if(req.method==='GET'){const result=employment.profile(url.searchParams.get('siteId'),employmentProfile[1]);checkRequestSession(req);return json(res,200,result);}if(req.method==='PUT'){const input=await body(req);return json(res,200,employment.saveProfile(input.siteId,employmentProfile[1],input,()=>checkRequestSession(req)));}}
    if(url.pathname==='/api/reviewers'){if(req.method==='GET')return json(res,200,store.reviewers(url.searchParams.get('siteId')));if(req.method==='POST')return json(res,201,await store.createReviewerAsync(await body(req),()=>checkRequestSession(req),workerPeer(req)));}
    const reviewerAccount=url.pathname.match(/^\/api\/reviewers\/(\d+)$/);
    if(reviewerAccount&&req.method==='PUT'){const input=await body(req),account=await store.updateReviewerAsync(input.siteId,reviewerAccount[1],input,()=>checkRequestSession(req),workerPeer(req));if(input.password!==undefined){reviewerAccountFailures.delete(account.login_id);}return json(res,200,account);}
    const reviewerNoticeWrite=url.pathname.match(/^\/api\/reviewers\/(\d+)\/notice-write$/);
    if(reviewerNoticeWrite&&req.method==='PUT'){const input=await body(req);return json(res,200,store.setReviewerNoticeWrite(input.siteId,reviewerNoticeWrite[1],input,()=>checkRequestSession(req)));}
    const reviewerFinalApproval=url.pathname.match(/^\/api\/reviewers\/(\d+)\/final-approval$/);
    if(reviewerFinalApproval&&req.method==='PUT'){const input=await body(req);return json(res,200,store.setReviewerFinalApproval(input.siteId,reviewerFinalApproval[1],input,()=>checkRequestSession(req)));}
    const workerAccessBlocks=url.pathname.match(/^\/api\/sites\/(\d+)\/worker-access-blocks$/);
    if(workerAccessBlocks){if(req.method==='GET')return json(res,200,store.workerAccessBlocks(workerAccessBlocks[1],url.searchParams.get('month')));if(req.method==='PUT'){const input=await body(req);store.setWorkerAccessBlock(workerAccessBlocks[1],input.date,input.kind,input.blocked,()=>{checkRequestSession(req);const now=new Date(),today=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);if(input.kind==='ended'&&input.date!==today)throw new Error('작업 종료는 오늘만 설정할 수 있습니다.');},input.expectedBlocked);return json(res,200,{ok:true});}}
    const managerChecks=url.pathname.match(/^\/api\/sites\/(\d+)\/manager-checks$/);
    const managerDayOff=url.pathname.match(/^\/api\/sites\/(\d+)\/manager-checks\/day-off$/);
    if(managerDayOff && req.method==='POST'){const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);store.saveManagerDayOff(managerDayOff[1],date,()=>checkRequestSession(req));return json(res,201,{ok:true});}
    if(managerChecks && req.method==='GET')return json(res,200,store.managerChecks(managerChecks[1]));
    const staffChecks=url.pathname.match(/^\/api\/sites\/(\d+)\/reviewer-manager-checks$/);
    if(staffChecks&&req.method==='GET'){const rows=store.siteReviewerManagerChecks(staffChecks[1],url.searchParams.get('date'));checkRequestSession(req);return json(res,200,rows);}
    const staffSignature=url.pathname.match(/^\/api\/sites\/(\d+)\/reviewer-manager-checks\/(\d+)\/signature$/);
    if(staffSignature&&req.method==='GET'){const signature=store.siteReviewerManagerSignature(staffSignature[1],staffSignature[2],url.searchParams.get('date'));checkRequestSession(req);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
    if(managerChecks && req.method==='POST'){
      const input=await body(req);const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      store.saveManagerCheck(managerChecks[1],date,input.answers,input.signature,()=>checkRequestSession(req));return json(res,201,{ok:true});
    }
    const siteChecks=url.pathname.match(/^\/api\/sites\/(\d+)\/self-checks$/);
    const dailySignature=url.pathname.match(/^\/api\/sites\/(\d+)\/daily-training\/(\d+)\/signature$/);
    if(dailySignature && req.method==='GET'){
      const signature=store.dailyTrainingSignature(dailySignature[1],dailySignature[2],url.searchParams.get('date'),url.searchParams.get('kind'));
      if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="test-training-signature.png"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);
    }
    if(siteChecks && req.method==='GET')return json(res,200,store.siteSelfChecks(siteChecks[1],url.searchParams.get('date')));
    const checkSignature=url.pathname.match(/^\/api\/sites\/(\d+)\/self-checks\/(\d+)\/signature$/);
    if(checkSignature && req.method==='GET'){
      const signature=store.selfCheckSignature(checkSignature[1],checkSignature[2],url.searchParams.get('date'));
      if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});
      const preview=url.searchParams.get('preview')==='1';res.writeHead(200,{'Content-Type':preview?'image/png':'application/octet-stream',...(preview?{}:{'Content-Disposition':'attachment; filename="test-signature.png"'}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);
    }
    const siteStops=url.pathname.match(/^\/api\/sites\/(\d+)\/work-stops$/);
    const hazardReply=url.pathname.match(/^\/api\/sites\/(\d+)\/hazard-reports\/(\d+)\/replies(?:\/(\d+))?$/);
    if(hazardReply){const [,siteId,reportId,replyId]=hazardReply;if(!replyId&&req.method==='POST'){const input=await body(req);checkRequestSession(req);return json(res,201,{id:store.addHazardReply(siteId,reportId,input)});}if(replyId&&req.method==='DELETE'){checkRequestSession(req);store.deleteHazardReply(siteId,reportId,replyId);return json(res,200,{ok:true});}}
    const hazardStatus=url.pathname.match(/^\/api\/sites\/(\d+)\/hazard-reports\/(\d+)$/);
    if(hazardStatus&&req.method==='PUT'){store.updateHazardReport(hazardStatus[1],hazardStatus[2],await body(req));return json(res,200,{ok:true});}
    const hazardReports=url.pathname.match(/^\/api\/sites\/(\d+)\/hazard-reports(?:\/(\d+)\/photo)?$/);
    if(hazardReports){const [,siteId,id]=hazardReports;
      if(!id&&req.method==='GET')return json(res,200,store.hazardReports(siteId,url.searchParams.get('q')||'',url.searchParams.get('from')||'',url.searchParams.get('to')||''));
      if(!id&&req.method==='POST')return json(res,201,{id:store.createHazardReport(siteId,await body(req,2805000))});
      if(id&&req.method==='GET'){const photo=store.hazardReportPhoto(siteId,id);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});const bytes=Buffer.from(photo),preview=url.searchParams.get('preview')==='1',type=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':null;if(preview&&!type)return json(res,415,{error:'미리 볼 수 없는 사진입니다.'});res.writeHead(200,{'Content-Type':preview?type:'application/octet-stream',...(preview?{}:{'Content-Disposition':'attachment; filename="test-hazard-photo"'}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);}
    }
    if(siteStops && req.method==='GET')return json(res,200,store.workStops(siteStops[1],url.searchParams.get('q')||''));
    const stopResponse=url.pathname.match(/^\/api\/sites\/(\d+)\/work-stops\/(\d+)$/);
    if(stopResponse&&req.method==='PUT'){const input=await body(req);store.updateWorkStopResponse(stopResponse[1],stopResponse[2],input,()=>checkRequestSession(req));return json(res,200,{ok:true});}
    if(stopResponse&&req.method==='DELETE'){const input=await body(req);store.deleteWorkStop(stopResponse[1],stopResponse[2],input,()=>checkRequestSession(req));return json(res,200,{ok:true});}
    const stopPhoto=url.pathname.match(/^\/api\/sites\/(\d+)\/work-stops\/(\d+)\/photo$/);
    if(stopPhoto && req.method==='GET'){
      const photo=store.workStopPhoto(stopPhoto[1],stopPhoto[2],url.searchParams.get('version'));checkRequestSession(req);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="work-stop-photo"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo);
    }
    const inviteStatus=url.pathname.match(/^\/api\/sites\/(\d+)\/invitation\/status$/);
    if(inviteStatus&&req.method==='POST'){const input=await body(req,65536,true),invite=store.invitation(input.token);checkRequestSession(req);const valid=!!invite&&invite.id===Number(inviteStatus[1]);return json(res,200,{valid,...(valid?{expiresAt:invite.expires_at}:{})});}
    const inviteSite=url.pathname.match(/^\/api\/sites\/(\d+)\/invitation$/);
    const locationPolicy=url.pathname.match(/^\/api\/sites\/(\d+)\/location-policy$/),locationEvents=url.pathname.match(/^\/api\/sites\/(\d+)\/location-events(?:\/(\d+))?$/);
    const workerDepartures=url.pathname.match(/^\/api\/sites\/(\d+)\/worker-departures(?:\/(\d+))?$/);
    const workerArrivals=url.pathname.match(/^\/api\/sites\/(\d+)\/worker-arrivals(?:\/(\d+))?$/);
    const workerAccessReport=url.pathname.match(/^\/api\/sites\/(\d+)\/worker-access-report$/);
    if(workerAccessReport&&req.method==='GET')return json(res,200,store.workerAccessReport(workerAccessReport[1],url.searchParams.get('date'),()=>checkRequestSession(req)));
    if(workerArrivals){if(!workerArrivals[2]&&req.method==='GET'){const records=store.workerArrivals(workerArrivals[1],url.searchParams.get('date'));checkRequestSession(req);return json(res,200,records);}if(workerArrivals[2]&&req.method==='DELETE'){store.deleteWorkerArrival(workerArrivals[1],workerArrivals[2],url.searchParams.get('date'),url.searchParams.get('version'),()=>checkRequestSession(req));return json(res,200,{ok:true});}}
    if(workerDepartures){if(!workerDepartures[2]&&req.method==='GET'){const records=store.workerDepartures(workerDepartures[1],url.searchParams.get('date'));checkRequestSession(req);return json(res,200,records);}if(workerDepartures[2]&&req.method==='DELETE'){store.deleteWorkerDeparture(workerDepartures[1],workerDepartures[2],url.searchParams.get('version'),()=>checkRequestSession(req));return json(res,200,{ok:true});}}
    if(locationPolicy){if(req.method==='GET')return json(res,200,store.siteLocationPolicy(locationPolicy[1]));if(req.method==='PUT'){const input=await body(req);return json(res,200,store.setSiteLocationPolicy(locationPolicy[1],input,()=>checkRequestSession(req)));}}
    if(locationEvents){if(!locationEvents[2]&&req.method==='GET'){const events=store.workerLocationEvents(locationEvents[1],url.searchParams.get('date'));checkRequestSession(req);return json(res,200,events);}if(locationEvents[2]&&req.method==='DELETE'){store.deleteWorkerLocationEvent(locationEvents[1],locationEvents[2],url.searchParams.get('version'),()=>checkRequestSession(req));return json(res,200,{ok:true});}}
    const registrationSite=url.pathname.match(/^\/api\/sites\/(\d+)\/access\/registration$/);
    const accessSite=url.pathname.match(/^\/api\/sites\/(\d+)\/access(?:\/(rotate))?$/);
    const accessStatus=url.pathname.match(/^\/api\/sites\/(\d+)\/access\/status$/);
    if(req.adminRestricted&&((registrationSite||accessSite||inviteSite)&&['POST','DELETE'].includes(req.method)))await body(req,65536,true);
    if(accessStatus&&req.method==='GET'){const key=store.siteAccessForIssue(accessStatus[1]),registrationExpiresAt=store.siteRegistrationExpiry(accessStatus[1]);checkRequestSession(req);return json(res,200,{accessFingerprint:key?createHash('sha256').update(key).digest('hex'):null,registrationExpiresAt});}
    if(registrationSite&&req.method==='POST')return json(res,200,{expiresAt:store.openSiteRegistration(registrationSite[1],()=>checkRequestSession(req))});
    if(accessSite&&req.method==='POST'){const result=await issueAccessQr(store,accessSite[1],requestOrigin,!!accessSite[2],link=>QRCode.toDataURL(link,{errorCorrectionLevel:'M',margin:4,width:512}),()=>checkRequestSession(req));checkRequestSession(req);return result?json(res,200,result):json(res,409,{error:'현장 주소가 변경되었습니다. QR을 다시 열어 주세요.'});}
    if (inviteSite && req.method === 'POST') {
      const result=await issueInvitationQr(store,inviteSite[1],requestOrigin,link=>QRCode.toDataURL(link,{errorCorrectionLevel:'M',margin:4,width:512}),()=>checkRequestSession(req));checkRequestSession(req);
      return result?json(res,201,result):json(res,409,{error:'가입 QR이 중지되었습니다. 다시 발급해 주세요.'});
    }
    if (inviteSite && req.method === 'DELETE') return json(res,200,{revoked:store.revokeInvitations(inviteSite[1],()=>checkRequestSession(req))});
    if (url.pathname === '/api/join') {
      if (req.method === 'GET') {const invite=store.invitation(url.searchParams.get('token'));return invite?json(res,200,{id:invite.id,name:invite.name,siteKey:store.siteAccessKey(invite.id),locationRequired:store.siteLocationPolicy(invite.id).enabled,companies:store.companies(invite.id).map(c=>c.name),occupations:store.siteOccupations(invite.id).map(o=>o.name)}):json(res,404,{error:'유효하지 않거나 만료된 가입 링크입니다.'});}
      if (req.method === 'POST') {const input=await body(req),worker=await store.joinAsync(input.token,input,workerPeer(req));return json(res,201,{ok:true,siteKey:store.siteAccessKey(worker.site_id)});}
    }
    if (url.pathname === '/api/sites') {
      if (req.method === 'GET') {const actor=auth.session(token),rows=store.sites();checkRequestSession(req);return json(res,200,actor.scope==='global'?rows:rows.filter(site=>actor.siteIds.includes(site.id)));}
      if (req.method === 'POST') return json(res,201,store.createSite(await body(req)));
    }
    const placeCopy=url.pathname.match(/^\/api\/work-places\/(\d+)\/copy$/);
    if(placeCopy&&req.method==='GET')return json(res,200,store.workPlaceCopySource(url.searchParams.get('siteId'),placeCopy[1]));
    if(placeCopy&&req.method==='POST'){const input=await body(req);return json(res,201,store.copyWorkPlace(input.siteId,placeCopy[1],input,()=>checkRequestSession(req)));}
    if(url.pathname==='/api/work-places'){
      if(req.method==='GET')return json(res,200,store.workPlaces(url.searchParams.get('siteId')));
      if(req.method==='POST')return json(res,201,store.createWorkPlace(await body(req)));
    }
    const placeId=url.pathname.match(/^\/api\/work-places\/(\d+)$/);
    if(placeId&&req.method==='PUT'){const input=await body(req);return json(res,200,store.createWorkPlace(input,placeId[1],()=>checkRequestSession(req)));}
    const riggingCopy=url.pathname.match(/^\/api\/rigging\/(\d+)\/copy$/);
    if(riggingCopy&&req.method==='GET')return json(res,200,store.riggingCopySource(url.searchParams.get('siteId'),riggingCopy[1]));
    if(riggingCopy&&req.method==='POST'){const input=await body(req);return json(res,201,store.copyRigging(input.siteId,riggingCopy[1],input,()=>checkRequestSession(req)));}
    if(url.pathname==='/api/rigging'){
      if(req.method==='GET')return json(res,200,store.rigging(url.searchParams.get('siteId')));
      if(req.method==='POST')return json(res,201,store.createRigging(await body(req)));
    }
    const riggingId=url.pathname.match(/^\/api\/rigging\/(\d+)$/);
    if(riggingId&&req.method==='PUT')return json(res,200,store.createRigging(await body(req),riggingId[1]));
    const riggingPhotos=url.pathname.match(/^\/api\/rigging\/(\d+)\/photos(?:\/(\d+))?$/);
    if(riggingPhotos){
      const siteId=url.searchParams.get('siteId'),id=riggingPhotos[1],photoId=riggingPhotos[2];
      if(!photoId&&req.method==='GET')return json(res,200,store.riggingPhotos(siteId,id));
      if(!photoId&&req.method==='POST'){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);
        let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('사진 이름을 확인해 주세요.');}
        return json(res,201,{id:store.addRiggingPhoto(siteId,id,name,Buffer.concat(chunks))});
      }
      if(photoId&&req.method==='DELETE'){store.deleteRiggingPhoto(siteId,id,photoId);return json(res,200,{ok:true});}
      if(photoId&&req.method==='GET'){
        const photo=store.riggingPhoto(siteId,id,photoId);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});
        if(url.searchParams.get('preview')==='1'){
          const bytes=Buffer.from(photo.data),type=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':null;
          if(!type)return json(res,415,{error:'미리 볼 수 없는 사진입니다.'});
          res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
        }
        const name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo.data);
      }
    }
    const placePhotos=url.pathname.match(/^\/api\/work-places\/(\d+)\/photos(?:\/(\d+))?$/);
    if(placePhotos){
      const siteId=url.searchParams.get('siteId'),id=placePhotos[1],photoId=placePhotos[2];
      if(!photoId&&req.method==='GET')return json(res,200,store.workPlacePhotos(siteId,id));
      if(!photoId&&req.method==='POST'){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);
        let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('사진 이름을 확인해 주세요.');}
        return json(res,201,{id:store.addWorkPlacePhoto(siteId,id,name,Buffer.concat(chunks))});
      }
      if(photoId&&req.method==='DELETE'){store.deleteWorkPlacePhoto(siteId,id,photoId);return json(res,200,{ok:true});}
      if(photoId&&req.method==='GET'){
        const photo=store.workPlacePhoto(siteId,id,photoId);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});
        const name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo.data);
      }
    }
    const equipmentAttendance=url.pathname.match(/^\/api\/equipment-attendance(?:\/(\d+))?$/);
    if(equipmentAttendance){const id=equipmentAttendance[1];if(!id&&req.method==='GET')return json(res,200,adminEquipmentRows(req,store.equipmentAttendance(url.searchParams.get('siteId'),url.searchParams.get('month')),true));if(!id&&req.method==='POST')return json(res,201,store.saveEquipmentAttendance(await body(req),null,()=>checkRequestSession(req),!!req.adminRestricted));if(id&&req.method==='PUT')return json(res,200,store.saveEquipmentAttendance(await body(req),id,()=>checkRequestSession(req),!!req.adminRestricted));if(id&&req.method==='DELETE'){const input=await body(req);store.deleteEquipmentAttendance(input.siteId,id,input.expectedVersion,()=>checkRequestSession(req));req.adminDeletedEquipment={id:Number(id),siteId:Number(input.siteId)};return json(res,200,{ok:true});}}
    const permitMeasure=url.pathname.match(/^\/api\/equipment\/(\d+)\/permit-measures(?:\/(\d+))?$/);
    if(permitMeasure){const [,equipmentId,id]=permitMeasure,siteId=url.searchParams.get('siteId');
      if(!id&&req.method==='GET'){const rows=store.permitMeasures(siteId,equipmentId);checkRequestSession(req);return json(res,200,rows);}
      if(!id&&req.method==='POST')return json(res,201,store.savePermitMeasure(siteId,equipmentId,null,await body(req),false,()=>checkRequestSession(req)));
      if(id&&['PUT','DELETE'].includes(req.method))return json(res,200,store.savePermitMeasure(siteId,equipmentId,id,await body(req),req.method==='DELETE',()=>checkRequestSession(req)));
    }
    const equipmentCopy=url.pathname.match(/^\/api\/equipment\/(\d+)\/copy$/);
    if(equipmentCopy&&req.method==='GET')return json(res,200,store.equipmentCopySource(url.searchParams.get('siteId'),equipmentCopy[1]));
    if(equipmentCopy&&req.method==='POST'){const input=await body(req);return json(res,201,store.copyEquipment(input.siteId,equipmentCopy[1],input,()=>checkRequestSession(req)));}
    if(url.pathname==='/api/equipment'){
      if(req.method==='GET')return json(res,200,adminEquipmentRows(req,store.equipment(url.searchParams.get('siteId'))));
      if(req.method==='POST')return json(res,201,store.createEquipment(await body(req)));
    }
    const equipmentId=url.pathname.match(/^\/api\/equipment\/(\d+)$/);
    if(equipmentId && req.method==='PUT')return json(res,200,store.updateEquipment(equipmentId[1],await body(req)));
    const equipmentFiles=url.pathname.match(/^\/api\/equipment\/(\d+)\/attachments(?:\/(\d+))?$/);
    if(equipmentFiles){
      const siteId=url.searchParams.get('siteId'),id=equipmentFiles[1],fileId=equipmentFiles[2];
      if(!fileId && req.method==='GET')return json(res,200,store.equipmentAttachments(siteId,id));
      if(!fileId && req.method==='POST'){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);
        let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}
        return json(res,201,{id:store.addEquipmentAttachment(siteId,id,url.searchParams.get('category'),name,Buffer.concat(chunks))});
      }
      if(fileId && req.method==='DELETE'){store.deleteEquipmentAttachment(siteId,id,fileId);return json(res,200,{ok:true});}
      if(fileId && req.method==='GET'){
        const file=store.equipmentAttachment(siteId,id,fileId);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});
        if(url.searchParams.get('preview')==='1'){
          const bytes=Buffer.from(file.data),type=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':null;
          if(!type)return json(res,415,{error:'미리보기는 PNG 또는 JPEG 파일만 지원합니다.'});
          res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
        }
        const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);
      }
    }
    const sitePhoto=url.pathname.match(/^\/api\/site-photos(?:\/(\d+))?$/);
    if(sitePhoto){
      const id=sitePhoto[1],siteId=url.searchParams.get('siteId');
      if(!id&&req.method==='GET'){store.db.exec('BEGIN');try{const rows=store.sitePhotos(siteId,url.searchParams.get('from')||'',url.searchParams.get('to')||'',url.searchParams.get('q')||'').map(item=>{const photo=store.sitePhoto(siteId,item.id);return photo?{id:photo.id,name:photo.name,date:photo.date,description:photo.description,version:store.sitePhotoVersion(photo)}:null;}).filter(Boolean);checkRequestSession(req);store.db.exec('COMMIT');return json(res,200,rows);}catch(error){store.db.exec('ROLLBACK');throw error;}}
      if(!id&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);let name,description;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('사진 이름을 확인해 주세요.');}const encoded=req.headers['x-photo-description'];if(encoded!==undefined){if(typeof encoded!=='string'||encoded.length>8000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw new Error('사진 설명을 확인해 주세요.');try{description=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(encoded,'base64'));}catch{throw new Error('사진 설명을 확인해 주세요.');}}return json(res,201,{id:store.addSitePhoto(siteId,name,Buffer.concat(chunks),()=>checkRequestSession(req),{date:req.headers['x-photo-date'],description})});}
      if(id&&req.method==='PUT'){store.updateSitePhoto(siteId,id,await body(req),()=>checkRequestSession(req));return json(res,200,{ok:true});}
      if(id&&req.method==='DELETE'){store.deleteSitePhoto(siteId,id,url.searchParams.get('version'),()=>checkRequestSession(req));return json(res,200,{ok:true});}
      if(id&&req.method==='GET'){const photo=store.sitePhoto(siteId,id);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});if(url.searchParams.has('version')&&url.searchParams.get('version')!==store.sitePhotoVersion(photo))return json(res,409,{error:'사진이 변경되었습니다. 다시 조회해 주세요.'});const bytes=Buffer.from(photo.data),type=costImageType(bytes);if(!type)return json(res,415,{error:'미리 볼 수 없는 사진입니다.'});const download=url.searchParams.get('download')==='1',name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);checkRequestSession(req);res.writeHead(200,{'Content-Type':type,...(download?{'Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`}:{ }),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);}
    }
    const articleFile=url.pathname.match(/^\/api\/site-articles\/(\d+)\/files(?:\/(\d+))?$/);
    if(articleFile){
      const [,articleId,fileId]=articleFile,siteId=url.searchParams.get('siteId');
      if(!fileId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}return json(res,201,{id:store.addArticleFile(siteId,articleId,name,Buffer.concat(chunks))});}
      if(fileId&&req.method==='DELETE'){store.deleteArticleFile(siteId,articleId,fileId);return json(res,200,{ok:true});}
      if(fileId&&req.method==='GET'){const file=store.articleFile(siteId,articleId,fileId);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
    }
    if(url.pathname==='/api/faq-posts'&&req.method==='GET')return json(res,200,store.faqPosts(url.searchParams.get('q')||'',url.searchParams.get('category')||''));
    if(url.pathname==='/api/board-posts'){
      if(req.method==='GET')return json(res,200,store.boardPosts(url.searchParams.get('kind'),url.searchParams.get('q')||'',url.searchParams.get('category')||''));
      if(req.method==='POST')return json(res,201,store.saveBoardPost(await body(req,29*1024*1024),null,()=>checkRequestSession(req)));
    }
    const boardComment=url.pathname.match(/^\/api\/board-posts\/(\d+)\/comments(?:\/(\d+))?$/);
    const boardAttachment=url.pathname.match(/^\/api\/board-posts\/(\d+)\/attachments(?:\/(\d+))?$/);if(boardAttachment)return await boardAttachmentRequest(req,res,url,boardAttachment,null);
    if(boardComment){const [,id,commentId]=boardComment;if(!commentId&&req.method==='GET')return json(res,200,store.boardComments(id,url.searchParams.get('version'),null,()=>checkRequestSession(req)));if(!commentId&&req.method==='POST')return json(res,201,store.addBoardComment(id,await body(req),null,()=>checkRequestSession(req)));if(commentId&&req.method==='DELETE'){store.deleteBoardComment(id,commentId,await body(req),null,()=>checkRequestSession(req));return json(res,200,{ok:true});}}
    const boardPost=url.pathname.match(/^\/api\/board-posts\/(\d+)$/);
    if(boardPost&&req.method==='PUT')return json(res,200,store.saveBoardPost(await body(req),boardPost[1],()=>checkRequestSession(req)));
    if(boardPost&&req.method==='DELETE'){const input=await body(req);store.deleteBoardPost(input.kind,boardPost[1],()=>checkRequestSession(req),input.expectedVersion);return json(res,200,{ok:true});}
    if(url.pathname==='/api/schedules'){
      if(req.method==='GET')return json(res,200,store.schedules(url.searchParams.get('siteId'),url.searchParams.get('month'),url.searchParams.get('q')||''));
      if(req.method==='POST')return json(res,201,store.saveSchedule(await body(req),null,()=>checkRequestSession(req)));
    }
    const schedule=url.pathname.match(/^\/api\/schedules\/(\d+)$/);
    if(schedule&&req.method==='PUT')return json(res,200,store.saveSchedule(await body(req),schedule[1],()=>checkRequestSession(req)));
    if(schedule&&req.method==='DELETE'){const input=await body(req);store.deleteSchedule(input.siteId,schedule[1]);return json(res,200,{ok:true});}
    if(url.pathname==='/api/site-articles'){
      if(req.method==='GET'){const items=store.siteArticles(url.searchParams.get('siteId'),url.searchParams.get('category')||'',url.searchParams.get('q')||'');checkRequestSession(req);return json(res,200,items);}
      if(req.method==='POST')return json(res,201,store.saveSiteArticle(await body(req),null,()=>checkRequestSession(req)));
    }
    const siteArticle=url.pathname.match(/^\/api\/site-articles\/(\d+)$/);
    if(siteArticle&&req.method==='PUT')return json(res,200,store.saveSiteArticle(await body(req),siteArticle[1],()=>checkRequestSession(req)));
    if(url.pathname==='/api/wages/estimate'&&req.method==='GET')return json(res,200,store.wageEstimate(url.searchParams.get('siteId'),url.searchParams.get('workerId'),url.searchParams.get('month')));
    if(url.pathname==='/api/wages/summary'&&req.method==='GET')return json(res,200,store.wageSummary(url.searchParams.get('siteId'),url.searchParams.get('month'),Object.fromEntries(url.searchParams)));
    if(url.pathname==='/api/wages/daily'&&req.method==='GET')return json(res,200,store.wageDailyRecords(url.searchParams.get('siteId'),url.searchParams.get('month'),Object.fromEntries(url.searchParams)));
    if(url.pathname==='/api/wages/export'&&req.method==='GET'){
      const siteId=url.searchParams.get('siteId'),month=url.searchParams.get('month'),filters=Object.fromEntries(url.searchParams),data=await wageSpreadsheet(store.wageRecords(siteId,month,filters),month,store.wageDailyRecords(siteId,month,filters));
      res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename=wages.xlsx','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(data);
    }
    if(url.pathname==='/api/wages'){
      if(req.method==='GET')return json(res,200,store.wageRecords(url.searchParams.get('siteId'),url.searchParams.get('month'),Object.fromEntries(url.searchParams)));
      if(req.method==='POST'){store.saveWageRecord(await body(req),false,()=>checkRequestSession(req));return json(res,200,{ok:true});}
      if(req.method==='PUT'){store.saveWageRecord(await body(req),true,()=>checkRequestSession(req));return json(res,200,{ok:true});}
    }
    if(url.pathname==='/api/meal-checks/month'&&req.method==='GET')return json(res,200,store.monthlyMealChecks(url.searchParams.get('siteId'),url.searchParams.get('month')));
    if(url.pathname==='/api/meal-checks/statement'&&req.method==='GET')return json(res,200,store.mealStatement(url.searchParams.get('siteId'),url.searchParams.get('month'),url.searchParams.get('category')||''));
    if(url.pathname==='/api/meal-checks/month/worker'&&req.method==='GET')return json(res,200,store.workerMonthlyMealChecks(url.searchParams.get('siteId'),url.searchParams.get('workerId'),url.searchParams.get('month')));
    if(url.pathname==='/api/meal-checks/month/worker'&&req.method==='POST')return json(res,200,{changed:store.setWorkerMonthlyMeals(await body(req))});
    if(url.pathname==='/api/meal-checks'){
      if(req.method==='GET')return json(res,200,store.mealChecks(url.searchParams.get('siteId'),url.searchParams.get('date')));
      if(req.method==='POST'){store.saveMealCheck(await body(req));return json(res,200,{ok:true});}
      if(req.method==='DELETE'){store.deleteMealCheck(url.searchParams.get('siteId'),url.searchParams.get('id'));return json(res,200,{ok:true});}
    }
    if(url.pathname==='/api/meal-defaults'){
      if(req.method==='GET')return json(res,200,store.mealDefaults(url.searchParams.get('siteId'),url.searchParams.get('group')??'direct'));
      if(req.method==='PUT'){const input=await body(req);return json(res,200,store.saveMealDefaults(input.siteId,input.items,input.group??'direct',()=>checkRequestSession(req)));}
    }
    if(url.pathname==='/api/restaurants'){
      if(req.method==='GET')return json(res,200,store.restaurants(url.searchParams.get('siteId')));
      if(req.method==='POST')return json(res,201,store.saveRestaurant(await body(req)));
    }
    const restaurant=url.pathname.match(/^\/api\/restaurants\/(\d+)$/);
    if(restaurant&&req.method==='PUT')return json(res,200,store.saveRestaurant(await body(req),restaurant[1]));
    if(url.pathname==='/api/site-occupations'){
      if(req.method==='GET')return json(res,200,store.siteOccupations(url.searchParams.get('siteId')));
      if(req.method==='POST'){const input=await body(req);return json(res,201,{id:store.addSiteOccupation(input.siteId,input.name)});}
      if(req.method==='DELETE'){store.deleteSiteOccupation(url.searchParams.get('siteId'),url.searchParams.get('id'));return json(res,200,{ok:true});}
    }
    if(url.pathname==='/api/basic-categories'){
      const siteId=url.searchParams.get('siteId');
      if(req.method==='GET'){const rows=store.basicCategories(siteId);checkRequestSession(req);return json(res,200,rows);}
      if(req.method==='POST')return json(res,201,{id:store.saveBasicCategory(siteId,await body(req))});
      if(req.method==='PUT'){const input=await body(req);store.orderBasicCategories(siteId,input);return json(res,200,{ok:true});}
    }
    const basicSample=url.pathname.match(/^\/api\/basic-categories\/(\d+)\/samples(?:\/(\d+))?$/);
    if(basicSample){
      const [,categoryId,fileId]=basicSample,siteId=url.searchParams.get('siteId');
      if(!fileId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}return json(res,201,{id:store.addBasicCategorySample(siteId,categoryId,name,Buffer.concat(chunks),url.searchParams.get('expectedVersion'),()=>checkRequestSession(req))});}
      if(fileId&&req.method==='DELETE'){store.deleteBasicCategorySample(siteId,categoryId,fileId,()=>checkRequestSession(req));return json(res,200,{ok:true});}
      if(fileId&&req.method==='GET'){const file=store.basicCategorySample(siteId,categoryId,fileId);checkRequestSession(req);if(!file)return json(res,404,{error:'샘플 파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="sample"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
    }
    const basicCategory=url.pathname.match(/^\/api\/basic-categories\/(\d+)$/);
    if(basicCategory){
      const siteId=url.searchParams.get('siteId');
      if(req.method==='PUT')return json(res,200,{id:store.saveBasicCategory(siteId,await body(req),basicCategory[1])});
      if(req.method==='DELETE'){store.deleteBasicCategory(siteId,basicCategory[1],await body(req,2097152),()=>checkRequestSession(req));return json(res,200,{ok:true});}
    }
    if (url.pathname === '/api/companies') {
      if(req.method==='GET'){const siteId=url.searchParams.get('siteId'),companies=store.companies(siteId);if(url.searchParams.get('withUsage')!=='1')return json(res,200,companies);const usage=store.companyUsage(siteId);return json(res,200,companies.map(company=>({...company,in_use:usage.ids.has(company.id)||usage.names.has(company.name)})));}
      if(req.method==='POST')return json(res,201,store.createCompany(await body(req)));
    }
    if(url.pathname==='/api/safety-costs'){
      if(req.method==='GET')return json(res,200,store.safetyCosts(url.searchParams.get('siteId'),url.searchParams.get('month')));
      if(req.method==='POST')return json(res,201,store.createSafetyCost(await body(req)));
    }
    const costItem=url.pathname.match(/^\/api\/safety-costs\/(\d+)$/);
    if(costItem&&req.method==='PUT')return json(res,200,store.updateSafetyCost(costItem[1],await body(req),()=>checkRequestSession(req)));
    if(url.pathname==='/api/safety-cost-reports'&&req.method==='POST')return json(res,201,store.createSafetyCostReport(await body(req),()=>checkRequestSession(req)));
    const costMonthFile=url.pathname.match(/^\/api\/safety-cost-month-files(?:\/(\d+))?$/);
    if(costMonthFile){const siteId=url.searchParams.get('siteId'),month=url.searchParams.get('month'),id=costMonthFile[1];
      if(!id&&req.method==='GET')return json(res,200,store.safetyCostMonthFiles(siteId,month));
      if(!id&&req.method==='POST'){const date=url.searchParams.get('date')||'',note=url.searchParams.get('note')||'';if(date.slice(0,7)!==month)throw new Error('선택한 월의 날짜를 입력해 주세요.');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}return json(res,201,{id:store.addSafetyCostMonthFile(siteId,date,note,name,Buffer.concat(chunks),()=>checkRequestSession(req))});}
      if(id&&req.method==='DELETE'){store.deleteSafetyCostMonthFile(siteId,id,()=>checkRequestSession(req));return json(res,200,{ok:true});}
      if(id&&req.method==='GET'){const file=store.safetyCostMonthFile(siteId,id);if(!file)return json(res,404,{error:'파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
    }
    const costPhotos=url.pathname.match(/^\/api\/safety-costs\/(\d+)\/photos(?:\/(\d+))?$/);
    if(costPhotos){
      const siteId=url.searchParams.get('siteId'),id=costPhotos[1],photoId=costPhotos[2],expectedVersion=url.searchParams.get('version');
      if(!photoId&&req.method==='GET')return json(res,200,store.safetyCostPhotos(siteId,id));
      if(!photoId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('사진 이름을 확인해 주세요.');}return json(res,201,{id:store.addSafetyCostPhoto(siteId,id,name,Buffer.concat(chunks),req.headers['x-cost-photo-kind']||'photo',()=>checkRequestSession(req))});}
      if(photoId&&req.method==='DELETE'){store.deleteSafetyCostPhoto(siteId,id,photoId,()=>checkRequestSession(req),expectedVersion);return json(res,200,{ok:true});}
      if(photoId&&req.method==='GET'){const photo=store.safetyCostPhoto(siteId,id,photoId);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});if(expectedVersion!==null&&photo.version!==expectedVersion)return json(res,409,{error:'사진이 변경되었습니다. 다시 조회해 주세요.'});const name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo.data);}
    }
    const costReportPhotos=url.pathname.match(/^\/api\/safety-cost-reports\/(\d+)\/photos(?:\/(\d+))?$/);
    if(costReportPhotos&&req.method==='GET'){
      const id=costReportPhotos[1],photoId=costReportPhotos[2];if(!photoId)return json(res,200,store.safetyCostReportPhotos(id));
      const photo=store.safetyCostReportPhoto(id,photoId);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});if(url.searchParams.get('preview')==='1'){const bytes=Buffer.from(photo.data),type=costImageType(bytes);if(!type)return json(res,415,{error:'미리 볼 수 없는 파일입니다.'});res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);}const name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo.data);
    }
    const company=url.pathname.match(/^\/api\/companies\/(\d+)$/);
    if(company && req.method==='PUT'){const input=await body(req);return json(res,200,store.updateCompany(company[1],input,()=>checkRequestSession(req)));}
    if(company && req.method==='DELETE'){const input=await body(req);store.archiveCompany(company[1],input,()=>checkRequestSession(req));return json(res,200,{ok:true});}
    if(url.pathname==='/api/ppe-issues/batch'&&req.method==='POST'){const input=await body(req);return json(res,201,{ids:store.addPpeIssues(input,()=>checkRequestSession(req))});}
    if(url.pathname==='/api/ppe-issues'){
      if(req.method==='GET')return json(res,200,store.ppeIssues(url.searchParams.get('siteId'),url.searchParams.get('month')));
      if(req.method==='POST')return json(res,201,{id:store.addPpeIssue(await body(req))});
    }
    const ppeReceipt=url.pathname.match(/^\/api\/ppe-issues\/(\d+)\/receipt$/);
    if(ppeReceipt&&req.method==='GET'){const signature=store.ppeReceipt(url.searchParams.get('siteId'),null,ppeReceipt[1]);checkRequestSession(req);if(!signature)return json(res,404,{error:'시험 수령 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="test-ppe-receipt.png"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
    const ppeIssue=url.pathname.match(/^\/api\/ppe-issues\/(\d+)$/);
    if(ppeIssue&&req.method==='PUT'){store.updatePpeIssue(ppeIssue[1],await body(req),()=>checkRequestSession(req));return json(res,200,{ok:true});}
    if(ppeIssue&&req.method==='DELETE'){store.deletePpeIssue(url.searchParams.get('siteId'),ppeIssue[1],url.searchParams.has('expectedVersion')?url.searchParams.get('expectedVersion'):undefined,()=>checkRequestSession(req));return json(res,200,{ok:true});}
    if(url.pathname==='/api/workers/list'&&req.method==='GET'){const result=store.workerListing(url.searchParams.get('siteId'),url.searchParams.get('q')||'',Object.fromEntries(url.searchParams),()=>checkRequestSession(req),null,!req.adminRestricted);return json(res,200,result);}
    if (url.pathname === '/api/workers') {
      if (req.method === 'GET'){const rows=store.workers(url.searchParams.get('siteId'),url.searchParams.get('q') || '',Object.fromEntries(url.searchParams),!req.adminRestricted);checkRequestSession(req);return json(res,200,rows);}
      if (req.method === 'POST') return json(res,201,store.createWorker(await body(req),()=>checkRequestSession(req)));
    }
    if(url.pathname==='/api/workers/joined-on'&&req.method==='GET'){if(req.adminRestricted)return json(res,403,{error:'전역 관리자 권한이 필요합니다.'});return json(res,200,store.joinedWorkersForDay(url.searchParams.get('siteId'),url.searchParams.get('date'),()=>checkRequestSession(req)));}
    if(url.pathname==='/api/workers/preview'&&req.method==='POST'){const input=await body(req),result=store.previewWorkers(input.siteId,input.items,()=>checkRequestSession(req));return json(res,200,result);}
    const worker=url.pathname.match(/^\/api\/workers\/(\d+)$/);
    const workerRegistration=url.pathname.match(/^\/api\/workers\/(\d+)\/registration\/general$/);
    if(workerRegistration&&req.method==='POST'){const input=await body(req);return json(res,200,store.convertWorkerRegistration(workerRegistration[1],input,()=>checkRequestSession(req)));}
    const workerPermissions=url.pathname.match(/^\/api\/workers\/(\d+)\/permissions$/);
    if(workerPermissions){if(req.method==='GET')return json(res,200,store.workerPermissions(url.searchParams.get('siteId'),workerPermissions[1]));if(req.method==='PUT'){const input=await body(req);return json(res,200,store.setWorkerPermissions(input.siteId,workerPermissions[1],input.permissions,()=>checkRequestSession(req),input.expectedPermissions));}}
    const workerPermissionOverview=url.pathname.match(/^\/api\/sites\/(\d+)\/worker-permissions$/);
    if(workerPermissionOverview&&req.method==='GET'){const result=store.workerPermissionOverview(workerPermissionOverview[1]);checkRequestSession(req);return json(res,200,result);}
    const workerActivity=url.pathname.match(/^\/api\/workers\/(\d+)\/activities$/);
    if(workerActivity&&req.method==='GET'){const raw=url.searchParams.get('offset')||'0';if(!/^\d+$/.test(raw))throw new Error('활동 검색 조건을 확인해 주세요.');return json(res,200,store.workerActivities(url.searchParams.get('siteId'),workerActivity[1],url.searchParams.getAll('kind'),Number(raw)));}
    const workerAccountBlock=url.pathname.match(/^\/api\/workers\/(\d+)\/access-block$/);
    if(workerAccountBlock){if(req.method==='GET')return json(res,200,store.workerAccountBlock(url.searchParams.get('siteId'),workerAccountBlock[1]));if(req.method==='PUT'){const input=await body(req),result=store.setWorkerAccountBlock(input.siteId,workerAccountBlock[1],input,()=>checkRequestSession(req));return json(res,200,result);}}
    const workerPassword=url.pathname.match(/^\/api\/workers\/(\d+)\/password$/);
    if(workerPassword&&req.method==='PUT'){const input=await body(req),siteId=Number(input.siteId),id=Number(workerPassword[1]),loginId=await store.resetWorkerPasswordAsync(siteId,id,input.password,()=>checkRequestSession(req),workerPeer(req));for(const [key,session] of workerSessions)if(session.worker.id===id&&session.worker.site_id===siteId)Map.prototype.delete.call(workerSessions,key);workerAccountFailures.delete(`${siteId}:${loginId}`);return json(res,200,{ok:true});}
    const workerFiles=url.pathname.match(/^\/api\/workers\/(\d+)\/files(?:\/(\d+))?$/);
    if(workerFiles){
      const [,workerId,fileId]=workerFiles,siteId=url.searchParams.get('siteId');
      if(!fileId&&req.method==='GET')return json(res,200,store.workerFiles(siteId,workerId));
      if(!fileId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}return json(res,201,{id:store.addWorkerFile(siteId,workerId,url.searchParams.get('category'),name,Buffer.concat(chunks))});}
      if(fileId&&req.method==='DELETE'){store.deleteWorkerFile(siteId,workerId,fileId);return json(res,200,{ok:true});}
      if(fileId&&req.method==='GET'){const file=store.workerFile(siteId,workerId,fileId);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
    }
    const workerPpe=url.pathname.match(/^\/api\/workers\/(\d+)\/ppe-issues$/);
    if(workerPpe&&req.method==='GET')return json(res,200,store.workerPpeIssues(url.searchParams.get('siteId'),workerPpe[1]));
    const workerJoin=url.pathname.match(/^\/api\/workers\/(\d+)\/join-record(?:\/(signature))?$/);
    if(workerJoin&&req.method==='GET'){
      const siteId=url.searchParams.get('siteId');
      if(!workerJoin[2])return json(res,200,store.joinAcknowledgement(siteId,workerJoin[1]));
      const signature=store.joinSignature(siteId,workerJoin[1]);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="test-join-signature.png"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);
    }
    if(worker && req.method==='GET'){const row=store.workers(url.searchParams.get('siteId')).find(row=>row.id===Number(worker[1]));return json(res,row?200:404,row||{error:'근로자를 찾을 수 없습니다.'});}
    if(worker && req.method==='PUT')return json(res,200,store.updateWorker(worker[1],await body(req),()=>checkRequestSession(req)));
    if (url.pathname === '/api/workers/export' && req.method === 'GET') {
      const data=await workerSpreadsheet(store.workers(url.searchParams.get('siteId'),url.searchParams.get('q') || '',Object.fromEntries(url.searchParams),!req.adminRestricted));
      res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename=workers.xlsx",'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return res.end(data);
    }
    if (url.pathname === '/api/attendance/month' && req.method === 'GET') return json(res,200,adminAttendanceRows(req,store.monthlyAttendance(url.searchParams.get('siteId'),url.searchParams.get('month'))));
    if (url.pathname === '/api/education/report' && req.method === 'GET') return json(res,200,store.educationReport(url.searchParams.get('siteId'),url.searchParams.get('from'),url.searchParams.get('to')));
    if (url.pathname === '/api/education/daily-report' && req.method === 'GET') return json(res,200,store.dailyTrainingReport(url.searchParams.get('siteId'),url.searchParams.get('from'),url.searchParams.get('to')));
    if (url.pathname === '/api/monthly-site-activity' && req.method === 'GET') return json(res,200,store.monthlySiteActivity(url.searchParams.get('month')));
    if (url.pathname === '/api/weekly-activity' && req.method === 'GET') return json(res,200,store.weeklyActivity(url.searchParams.get('siteId'),url.searchParams.get('start')));
    if(url.pathname==='/api/attendance/month/cells'&&req.method==='PUT')return json(res,200,{updated:store.updateMonthlyAttendanceCells(await body(req,262144),()=>checkRequestSession(req))});
    if(url.pathname==='/api/attendance/units'&&req.method==='PUT'){store.changeAttendance('units',await body(req),()=>checkRequestSession(req));return json(res,200,{ok:true});}
    if(url.pathname==='/api/attendance/daily-rate'&&req.method==='PUT'){store.changeAttendance('dailyRate',await body(req),()=>checkRequestSession(req));return json(res,200,{ok:true});}
    if(url.pathname==='/api/attendance/salary'&&req.method==='PUT'){store.changeAttendance('salary',await body(req),()=>checkRequestSession(req));return json(res,200,{ok:true});}
    if(url.pathname==='/api/attendance/month/details'&&req.method==='PUT')return json(res,200,{updated:store.updateMonthlyAttendanceDetails(await body(req),()=>checkRequestSession(req))});
    if (url.pathname === '/api/attendance') {
      if (req.method === 'GET') return json(res,200,adminAttendanceRows(req,store.attendance(url.searchParams.get('siteId'),url.searchParams.get('date'))));
      if (req.method === 'POST') {store.changeAttendance('presence',await body(req),()=>checkRequestSession(req));return json(res,200,{ok:true});}
    }
    if (url.pathname === '/api/attendance/report' && req.method === 'GET') return json(res,200,store.attendanceReport(url.searchParams.get('siteId'),url.searchParams.get('from'),url.searchParams.get('to'),url.searchParams.get('group')));
    if (url.pathname === '/api/attendance/sites-report' && req.method === 'GET') return json(res,200,store.attendanceSitesReport(url.searchParams.get('from'),url.searchParams.get('to')));
    if (url.pathname === '/api/attendance/delegated-events' && req.method === 'GET') return json(res,200,store.delegatedAttendanceEvents(url.searchParams.get('siteId'),url.searchParams.get('date')));
    if(url.pathname==='/api/office-approval-default'&&req.method==='GET'){const result=store.officeApprovalDefault(url.searchParams.get('siteId'),url.searchParams.get('kind'),url.searchParams.get('otherKind')||'');checkRequestSession(req);return json(res,200,result);}
    if(url.pathname==='/api/office-reference-preview'&&req.method==='GET'){const siteId=Number(url.searchParams.get('siteId')),id=Number(url.searchParams.get('id'));if(!Number.isSafeInteger(siteId)||siteId<1||!Number.isSafeInteger(id)||id<1)throw new Error('현장과 참조 문서를 확인해 주세요.');const result=store.officeReferenceInfo(siteId,id);checkRequestSession(req);return json(res,200,result);}
    if (url.pathname === '/api/documents') {
      if (req.method === 'GET') {const rows=store.documents(url.searchParams.get('siteId'),url.searchParams.get('type') || '',url.searchParams.get('q') || '',url.searchParams.get('from') || '',url.searchParams.get('to') || '',url.searchParams.get('riskKind') || '',url.searchParams.get('riskContractorId') || '',url.searchParams.get('instructionCompanyId') || '',url.searchParams.get('permitCompany') || '',url.searchParams.get('permitFrom') || '',url.searchParams.get('permitTo') || '',url.searchParams.get('educationKind') || '',url.searchParams.get('workPlanCompany') || '',url.searchParams.get('checklistCategory') || '');checkRequestSession(req);const actor=auth.session(token);return json(res,200,actor.scope==='global'?rows:rows.filter(row=>actor.siteIds.includes(row.site_id)));}
      if (req.method === 'POST') {const input=await body(req,220000);return json(res,201,input.officeSetup===undefined?store.createAuthorizedDocument(input,()=>checkRequestSession(req)):store.createOfficeDraft(input,()=>checkRequestSession(req)));}
    }
    const copyWorkPlan=url.pathname.match(/^\/api\/documents\/(\d+)\/copy-work-plan$/);
    if(copyWorkPlan&&req.method==='POST')return json(res,201,store.copyWorkPlan(copyWorkPlan[1],await body(req)));
    const copyOffice=url.pathname.match(/^\/api\/documents\/(\d+)\/copy-office$/);
    if(copyOffice&&req.method==='POST')return json(res,201,store.copyOfficeDocument(copyOffice[1],await body(req)));
    if (url.pathname === '/api/daily-report/previous' && req.method === 'GET') return json(res,200,store.previousDailyReport(url.searchParams.get('siteId'),url.searchParams.get('before')));
    if (url.pathname === '/api/joint-inspection/previous' && req.method === 'GET') return json(res,200,store.previousJointInspection(url.searchParams.get('siteId'),url.searchParams.get('before')));
    if (url.pathname === '/api/inspection/previous' && req.method === 'GET') return json(res,200,store.previousInspections(url.searchParams.get('siteId'),url.searchParams.get('before'),url.searchParams.get('excludeId')));
    if(url.pathname==='/api/muscle-references'){
      if(req.method==='GET'){const result=store.muscleReferences(url.searchParams.get('siteId'),url.searchParams.get('scale')??'');checkRequestSession(req);return json(res,200,result);}
      if(req.method==='POST'){const input=await body(req,220000);return json(res,201,store.saveMuscleReference(input,()=>checkRequestSession(req)));}
    }
    const muscleReference=url.pathname.match(/^\/api\/muscle-references\/(\d+)$/);
    if(muscleReference&&req.method==='DELETE')return json(res,200,store.deleteMuscleReference(url.searchParams.get('siteId'),muscleReference[1],()=>checkRequestSession(req)));
    if (url.pathname === '/api/risk/previous' && req.method === 'GET') return json(res,200,store.previousRiskAssessments(url.searchParams.get('siteId'),url.searchParams.get('before'),url.searchParams.get('kind'),url.searchParams.get('scale'),url.searchParams.get('excludeId')));
    if (url.pathname === '/api/daily-report/sources' && req.method === 'GET') return json(res,200,store.dailySourceDocuments(url.searchParams.get('siteId'),url.searchParams.get('date')));
    if (url.pathname === '/api/safety-log/sources' && req.method === 'GET') return json(res,200,store.safetyLogSources(url.searchParams.get('siteId'),url.searchParams.get('date')));
    const equipmentChecks=url.pathname.match(/^\/api\/documents\/(\d+)\/equipment-checks$/);
    if(equipmentChecks){
      if(req.method==='GET')return json(res,200,store.equipmentChecks(equipmentChecks[1]));
      if(req.method==='POST')return json(res,201,{id:store.addEquipmentCheck(equipmentChecks[1],await body(req),()=>checkRequestSession(req))});
    }
    const equipmentCheck=url.pathname.match(/^\/api\/documents\/(\d+)\/equipment-checks\/(\d+)$/);
    if(equipmentCheck&&req.method==='DELETE'){store.deleteEquipmentCheck(equipmentCheck[1],equipmentCheck[2],()=>checkRequestSession(req));return json(res,200,{ok:true});}
    const equipmentApprovalSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/equipment-checks\/(\d+)\/approvals\/(\d+)\/signatures\/(\d+)$/);
    if(equipmentApprovalSignature&&req.method==='GET'){const [,id,checkId,cycleId,position]=equipmentApprovalSignature,signature=store.equipmentCheckApprovalSignature(id,checkId,cycleId,position);if(!signature)return json(res,404,{error:'시험 결재 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
    const equipmentApproval=url.pathname.match(/^\/api\/documents\/(\d+)\/equipment-checks\/(\d+)\/approvals(?:\/(withdraw))?$/);
    if(equipmentApproval){const [,id,checkId,action]=equipmentApproval;if(!action&&req.method==='GET')return json(res,200,store.equipmentCheckApprovals(id,checkId));if(!action&&req.method==='POST'){const input=await body(req);return json(res,201,store.requestEquipmentCheckApproval(id,checkId,input,()=>checkRequestSession(req)));}if(action==='withdraw'&&req.method==='POST'){const input=await body(req);store.withdrawEquipmentCheckApproval(id,checkId,input.expectedCycleId,()=>checkRequestSession(req));return json(res,200,{ok:true});}}
    const equipmentCheckSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/equipment-checks\/(\d+)\/signature$/);
    if(equipmentCheckSignature&&req.method==='GET'){const signature=store.equipmentCheckSignature(equipmentCheckSignature[1],equipmentCheckSignature[2]);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
    const instructionSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/instruction-signature$/);
    if(instructionSignature && req.method==='GET'){
      const signature=store.instructionSignature(instructionSignature[1]);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});
      const preview=url.searchParams.get('preview')==='1';res.writeHead(200,{'Content-Type':preview?'image/png':'application/octet-stream',...(preview?{}:{'Content-Disposition':'attachment; filename="test-instruction-signature.png"'}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);
    }
    const instructionResult=url.pathname.match(/^\/api\/documents\/(\d+)\/instruction-result$/);
    if(instructionResult){
      if(req.method==='GET')return json(res,200,store.instructionResult(instructionResult[1]));
      if(req.method==='POST')return json(res,201,store.addAuthorizedInstructionResult(instructionResult[1],await body(req),()=>checkRequestSession(req)));
    }
    const instructionPhotos=url.pathname.match(/^\/api\/documents\/(\d+)\/instruction-photos(?:\/(\d+))?$/);
    if(instructionPhotos){
      const id=instructionPhotos[1],photoId=instructionPhotos[2];
      if(!photoId&&req.method==='GET')return json(res,200,store.instructionPhotos(id));
      if(!photoId&&req.method==='POST'){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);
        let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('사진 이름을 확인해 주세요.');}
        return json(res,201,{id:store.addInstructionPhoto(id,url.searchParams.get('phase'),name,Buffer.concat(chunks))});
      }
      if(photoId&&req.method==='DELETE'){store.deleteInstructionPhoto(id,photoId);return json(res,200,{ok:true});}
      if(photoId&&req.method==='GET'){const photo=store.instructionPhoto(id,photoId);if(!photo)return json(res,404,{error:'시험 사진을 찾을 수 없습니다.'});return instructionPhotoResponse(res,photo,url.searchParams.get('preview')==='1');}
    }
    const meetingChecks=url.pathname.match(/^\/api\/documents\/(\d+)\/meeting-checks(?:\/(\d+)\/signature)?$/);
    if(meetingChecks&&req.method==='GET'){const [,id,workerId]=meetingChecks;if(!workerId)return json(res,200,store.meetingChecks(id));const signature=store.meetingWorkerSignature(id,workerId);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
    const checklistSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/checklist-signature(?:\/(image))?$/);
    if(checklistSignature){const [,id,image]=checklistSignature;if(req.method==='POST'&&!image){const input=await body(req);store.saveChecklistSignature(id,input.signature,()=>checkRequestSession(req),input.expectedEditVersion??null);return json(res,200,{ok:true});}if(req.method==='GET'){const saved=store.checklistSignature(id);if(!image)return json(res,200,{hasSignature:!!saved,createdAt:saved?.created_at||null});if(!saved)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(saved.signature);}}
    const tbmSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/tbm-signature(?:\/(image))?$/);
    if(tbmSignature){const [,id,image]=tbmSignature;if(req.method==='POST'&&!image){const input=await body(req);store.saveTbmSignature(id,input.signature,()=>checkRequestSession(req),input.expectedEditVersion??null);return json(res,200,{ok:true});}if(req.method==='GET'){const saved=store.tbmSignature(id);if(!image)return json(res,200,{hasSignature:!!saved,createdAt:saved?.created_at||null});if(!saved)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(saved.signature);}}
    const jointSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/joint-signature(?:\/(image))?$/);
    if(jointSignature){const [,id,image]=jointSignature;if(req.method==='POST'&&!image){const input=await body(req);store.saveJointSignature(id,input.signature,()=>checkRequestSession(req),input.expectedEditVersion??null);return json(res,200,{ok:true});}if(req.method==='GET'){const saved=store.jointSignature(id);if(!image)return json(res,200,{hasSignature:!!saved,createdAt:saved?.created_at||null});if(!saved)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(saved.signature);}}
    const meetingSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/meeting-signature(?:\/(image))?$/);
    if(meetingSignature){const [,id,image]=meetingSignature;if(req.method==='POST'&&!image){const input=await body(req);store.saveMeetingSignature(id,input.signature,()=>checkRequestSession(req),input.expectedVersion,input.expectedEditVersion??null);return json(res,200,{ok:true});}if(req.method==='GET'){const saved=store.meetingSignature(id),doc=store.document(id);if(!image)return json(res,200,doc.type==='work_plan'?store.planSignatureInfo(doc):doc.type==='office'?store.officeSignatureInfo(doc):{hasSignature:!!saved,createdAt:saved?.created_at||null});if(!saved)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(saved.signature);}}
    const attachList=url.pathname.match(/^\/api\/documents\/(\d+)\/attachments$/);
    if(attachList){
      if(req.method==='GET') return json(res,200,store.attachments(attachList[1]));
      if(req.method==='POST'){
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);
        let name;try{name=decodeURIComponent(req.headers['x-file-name'] || '');}catch{throw new Error('파일 이름을 확인해 주세요.');}
        const id=store.addAttachment(attachList[1],name,Buffer.concat(chunks),url.searchParams.get('category')||'general',()=>checkRequestSession(req));return json(res,201,{id});
      }
    }
    const checklistPhoto=url.pathname.match(/^\/api\/documents\/(\d+)\/checklist-photos\/(\d+)$/);
    if(checklistPhoto&&req.method==='GET'){
      const doc=store.document(checklistPhoto[1]),file=store.attachment(checklistPhoto[2]);
      if(!doc||doc.type!=='checklist'||JSON.parse(doc.details).kind!=='morning'||!file||file.document_id!==doc.id||file.category!=='morning_hazard_photo')return json(res,404,{error:'점검 항목 사진을 찾을 수 없습니다.'});
      const mime=Buffer.from(file.data).subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':'image/png';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);
    }
    const planDiagram=url.pathname.match(/^\/api\/documents\/(\d+)\/plan-diagrams\/(\d+)$/);
    if(planDiagram&&req.method==='GET'){
      const doc=store.document(planDiagram[1]),file=store.attachment(planDiagram[2]);
      if(!doc||doc.type!=='work_plan'||!file||file.document_id!==doc.id||file.category!=='plan_diagram')return json(res,404,{error:'시험 계획도를 찾을 수 없습니다.'});
      const mime=Buffer.from(file.data).subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':'image/png';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);
    }
    const documentAttach=url.pathname.match(/^\/api\/documents\/(\d+)\/attachments\/(\d+)$/);
    const attach=url.pathname.match(/^\/api\/attachments\/(\d+)$/)|| (documentAttach&&req.method==='GET'?[documentAttach[0],documentAttach[2]]:null);
    if(attach){
      if(req.method==='DELETE'){store.deleteAttachment(attach[1],()=>checkRequestSession(req));return json(res,200,{ok:true});}
      if(req.method==='GET'){
        const file=store.attachment(attach[1]);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});
        if(documentAttach&&file.document_id!==Number(documentAttach[1]))return json(res,404,{error:'이 문서의 첨부파일을 찾을 수 없습니다.'});
        const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);
      }
    }
    const riskSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/risk-activities\/(\d+)\/signature$/);
    if(riskSignature){const [,docId,activityId]=riskSignature;if(req.method==='POST'){const input=await body(req);store.saveRiskActivitySignature(docId,activityId,input.signature,()=>checkRequestSession(req),input.expectedRevision??null);return json(res,200,{ok:true});}if(req.method==='GET'){const saved=store.riskActivitySignature(docId,activityId);if(!saved)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(saved.signature);}}
    const riskPhotos=url.pathname.match(/^\/api\/documents\/(\d+)\/risk-activities\/(\d+)\/photos(?:\/(\d+))?$/);
    if(riskPhotos){const [,docId,activityId,photoId]=riskPhotos;
      if(!photoId&&req.method==='GET')return json(res,200,store.riskActivityPhotos(docId,activityId));
      if(!photoId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}checkRequestSession(req);let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}return json(res,201,{id:store.addRiskActivityPhoto(docId,activityId,name,Buffer.concat(chunks),url.searchParams.get('purpose')||'photo',req.headers['x-risk-revision']??null,()=>checkRequestSession(req))});}
      if(photoId&&req.method==='DELETE'){store.deleteRiskActivityPhoto(docId,activityId,photoId,req.headers['x-risk-revision']??null,()=>checkRequestSession(req));return json(res,200,{ok:true});}
      if(photoId&&req.method==='GET'){const photo=store.riskActivityPhoto(docId,activityId,photoId);if(!photo)return json(res,404,{error:'시험 사진을 찾을 수 없습니다.'});const name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo.data);}
    }
    const permitCheck=url.pathname.match(/^\/api\/documents\/(\d+)\/permit-checks(?:\/(\d+))?$/);
    const permitRoles=url.pathname.match(/^\/api\/documents\/(\d+)\/permit-roles$/);
    if(permitRoles){if(req.method==='GET'){const result=store.permitRoles(permitRoles[1]);checkRequestSession(req);return json(res,200,result);}if(req.method==='PUT'){const input=await body(req);return json(res,200,store.setPermitRoles(permitRoles[1],input,()=>checkRequestSession(req)));}}
    if(permitCheck){const [,id,checkId]=permitCheck;if(!checkId&&req.method==='GET')return json(res,200,store.permitChecks(id));if(!checkId&&req.method==='POST')return json(res,201,{id:store.savePermitCheck(id,await body(req,120000),null,()=>checkRequestSession(req))});if(checkId&&req.method==='PUT')return json(res,200,{id:store.savePermitCheck(id,await body(req,120000).then(input=>({...input,expectedVersion:input?.expectedVersion??null})),checkId,()=>checkRequestSession(req))});if(checkId&&req.method==='DELETE'){store.deletePermitCheck(id,checkId,()=>checkRequestSession(req),(await body(req,65536,true)).expectedVersion??null);return json(res,200,{ok:true});}}
    const permitExtension=url.pathname.match(/^\/api\/documents\/(\d+)\/permit-extensions(?:\/(\d+))?(?:\/(signature))?$/);
    if(permitExtension){const [,id,extensionId,signature]=permitExtension;if(!extensionId&&!signature&&req.method==='GET')return json(res,200,store.permitExtensions(id));if(!extensionId&&!signature&&req.method==='POST')return json(res,201,{id:store.savePermitExtension(id,await body(req),null,()=>checkRequestSession(req))});if(extensionId&&!signature&&req.method==='PUT')return json(res,200,{id:store.savePermitExtension(id,await body(req).then(input=>({...input,expectedVersion:input?.expectedVersion??null})),extensionId,()=>checkRequestSession(req))});if(extensionId&&!signature&&req.method==='DELETE'){store.deletePermitExtension(id,extensionId,()=>checkRequestSession(req),(await body(req,65536,true)).expectedVersion??null);return json(res,200,{ok:true});}if(extensionId&&signature&&req.method==='GET'){const image=store.permitExtensionSignature(id,extensionId,url.searchParams.get('expectedVersion'));if(!image)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(image);}}
    const riskImprovement=url.pathname.match(/^\/api\/documents\/(\d+)\/risk-improvement$/);
    if(riskImprovement&&req.method==='PUT')return json(res,200,store.updateRiskImprovement(riskImprovement[1],await body(req),()=>checkRequestSession(req)));
    const riskActivity=url.pathname.match(/^\/api\/documents\/(\d+)\/risk-activities(?:\/(\d+))?$/);
    if(riskActivity){const [,id,activityId]=riskActivity;if(!activityId&&req.method==='GET')return json(res,200,store.riskActivities(id));if(!activityId&&req.method==='POST')return json(res,201,{id:store.saveRiskActivity(id,await body(req),null,()=>checkRequestSession(req))});if(activityId&&req.method==='PUT')return json(res,200,{id:store.saveRiskActivity(id,{...await body(req),expectedRevision:req.headers['x-risk-revision']??null},activityId,()=>checkRequestSession(req))});if(activityId&&req.method==='DELETE'){store.deleteRiskActivity(id,activityId,req.headers['x-risk-revision']??null,()=>checkRequestSession(req));return json(res,200,{ok:true});}}
    if(url.pathname==='/api/documents/batch-approve'&&req.method==='POST'){const input=await body(req);return json(res,200,store.approveDocuments(input.siteId,input.ids,input.signature,()=>checkRequestSession(req),input.expectedCycleIds??null));}
    const previousApproval=url.pathname.match(/^\/api\/documents\/(\d+)\/previous-approval-line$/);
    if(previousApproval&&req.method==='GET')return json(res,200,store.previousApprovalLine(previousApproval[1]));
    const approvalLine=url.pathname.match(/^\/api\/documents\/(\d+)\/approval-line$/);
    if(approvalLine){if(req.method==='GET'){if(!store.document(approvalLine[1]))return json(res,404,{error:'문서를 찾을 수 없습니다.'});return json(res,200,store.approvalLine(approvalLine[1]));}if(req.method==='PUT'){const input=await body(req);return json(res,200,store.setApprovalLine(approvalLine[1],input.reviewerIds,()=>checkRequestSession(req)));}}
    const officeReferences=url.pathname.match(/^\/api\/documents\/(\d+)\/office-references$/);
    if(officeReferences){if(req.method==='GET')return json(res,200,store.officeReferences(officeReferences[1]));if(req.method==='PUT'){const input=await body(req);return json(res,200,store.setOfficeReferences(officeReferences[1],input.reviewerIds,()=>checkRequestSession(req)));}}
    const officeReferenceAccess=url.pathname.match(/^\/api\/documents\/(\d+)\/office-reference-access$/);
    if(officeReferenceAccess&&req.method==='PUT')return json(res,200,store.changeOfficeReferenceAccess(officeReferenceAccess[1],await body(req),()=>checkRequestSession(req)));
    const approvalCycle=url.pathname.match(/^\/api\/documents\/(\d+)\/approval-cycles\/(\d+)(?:\/files\/(document|equipment|rigging|place|risk|office-reference|cost-photo|permit-signature|training-signature|author-signature|equipment-check-signature|equipment-review-signature|risk-activity-signature)\/(\d+)\/(\d+))?$/);
    if(approvalCycle&&req.method==='GET'){const [,id,cycleId,kind,parentId,fileId]=approvalCycle;if(!kind){const cycle=store.approvalCycle(id,cycleId);return cycle?json(res,200,cycle):json(res,404,{error:'결재 자료를 찾을 수 없습니다.'});}const file=store.approvalCycleFile(id,cycleId,kind,parentId,fileId);if(!file)return json(res,404,{error:'결재 파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="file"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
    const eventSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/events\/(\d+)\/signature$/);
    if(eventSignature&&req.method==='GET'){const signature=store.eventSignature(eventSignature[1],eventSignature[2]);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
    const trainingCheckSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/training-checks\/(\d+)\/signature$/);
    if(trainingCheckSignature&&req.method==='GET'){const signature=store.trainingCheckSignature(trainingCheckSignature[1],trainingCheckSignature[2]);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
    const documentTrainingSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/training-signatures\/(\d+)$/);
    if(documentTrainingSignature&&req.method==='GET'){const signature=store.documentTrainingSignature(documentTrainingSignature[1],documentTrainingSignature[2]);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
    const noticeEditSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/notice-edits\/(\d+)\/reads\/(\d+)\/signature$/);
    if(noticeEditSignature&&req.method==='GET'){const signature=store.noticeEditSignature(noticeEditSignature[1],noticeEditSignature[2],noticeEditSignature[3]);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});const preview=url.searchParams.get('preview')==='1';res.writeHead(200,{'Content-Type':preview?'image/png':'application/octet-stream',...(preview?{}:{'Content-Disposition':'attachment; filename="test-notice-signature.png"'}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);}
    const noticeEdits=url.pathname.match(/^\/api\/documents\/(\d+)\/notice-edits$/);
    if(noticeEdits&&req.method==='GET')return json(res,200,store.noticeEditHistory(noticeEdits[1]));
    if(noticeEdits&&req.method==='PUT'){const input=await body(req),now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);return json(res,200,store.editPublishedNotice(noticeEdits[1],input,date,()=>{checkRequestSession(req);const current=new Date();if(new Date(current.getTime()-current.getTimezoneOffset()*60000).toISOString().slice(0,10)!==date)throw Object.assign(new Error('날짜가 변경되었습니다. 공지를 다시 확인해 주세요.'),{sessionStatus:409});}));}
    const match = url.pathname.match(/^\/api\/documents\/(\d+)(?:\/(events|transition|publish-notice|copy-notice-files|notice-reads|training-checks|training-targets))?$/);
    const noticeSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/notice-reads\/(\d+)\/signature$/);
    if(noticeSignature && req.method==='GET'){
      const signature=store.noticeSignature(noticeSignature[1],noticeSignature[2]);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});
      const preview=url.searchParams.get('preview')==='1';res.writeHead(200,{'Content-Type':preview?'image/png':'application/octet-stream',...(preview?{}:{'Content-Disposition':'attachment; filename="test-notice-signature.png"'}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);
    }
    if (match) {
      const [,id,part] = match;
      if (req.method === 'GET' && part === 'events') return json(res,200,store.events(id));
      if (req.method === 'POST' && part === 'publish-notice') return json(res,200,store.publishNotice(id,()=>checkRequestSession(req)));
      if (req.method === 'POST' && part === 'copy-notice-files') {const input=await body(req);return json(res,200,store.copyNoticeAttachments(id,input.sourceId));}
      if (req.method === 'GET' && part === 'notice-reads') return json(res,200,store.noticeReads(id));
      if (req.method === 'GET' && part === 'training-checks') return json(res,200,store.trainingChecks(id));
      if (req.method === 'GET' && part === 'training-targets') return json(res,200,store.trainingTargets(id));
      if (req.method === 'PUT' && part === 'training-targets') {const input=await body(req);store.setTrainingTargets(id,input.workerIds,()=>{checkRequestSession(req);if((input.managerIds!==undefined||input.expectedEditVersion!==undefined)&&(!Number.isSafeInteger(input.expectedEditVersion)||store.document(id)?.edit_version!==input.expectedEditVersion))throw Object.assign(new Error('교육 문서 또는 대상이 변경되었습니다. 다시 확인해 주세요.'),{sessionStatus:409});},input.managerIds);return json(res,200,{ok:true});}
      if (req.method === 'GET' && !part) { const d=store.document(id); return d ? json(res,200,d) : json(res,404,{error:'문서를 찾을 수 없습니다.'}); }
      if (req.method === 'PUT' && !part) {const input=await body(req,220000);if(!Number.isSafeInteger(input.expectedEditVersion))throw Object.assign(new Error('문서 버전이 없습니다. 입력 내용을 복사한 뒤 화면을 새로고침해 주세요.'),{sessionStatus:409});return json(res,200,store.updateDocument(id,input,()=>checkRequestSession(req)));}
      if (req.method === 'DELETE' && !part) {const input=await body(req);store.deleteBasicDocument(input.siteId,id,input.expectedVersion);return json(res,200,{ok:true});}
      if (req.method === 'POST' && part === 'transition') {const input=await body(req);return json(res,200,store.managedTransition(id,{...input,expectedEditVersion:input.expectedEditVersion??null},()=>checkRequestSession(req),input.expectedCycleId??null));}
    }
    return json(res,404,{error:'요청한 경로가 없습니다.'});
  } catch (e) {
    if(e.retryAfter===1)res.setHeader('Retry-After','1');
    if(req.adminWriteFailure)return json(res,req.adminWriteFailure.status,{error:req.adminWriteFailure.error});
    // 의도한 오류는 일반 Error나 코드가 있는 오류(SQLite, URL)로 던져지고, TypeError 등 코드 없는 오류는 버그다.
    if(!(e instanceof Error)||e.constructor!==Error&&!e.code){console.error(e);return json(res,500,{error:'요청을 처리하지 못했습니다.'});}
    if(e.code==='ERR_SQLITE_ERROR'&&Number.isInteger(e.errcode)&&[5,6].includes(e.errcode&255))return json(res,503,{error:'데이터베이스가 사용 중입니다. 잠시 후 다시 시도해 주세요.'});return json(res,[401,403,409,429,503].includes(e.sessionStatus)?e.sessionStatus:400,{error:e.message || '요청을 처리하지 못했습니다.',...(e.sessionChanged?{sessionChanged:true}:{})}); }
})));
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => console.log(`J웹: http://127.0.0.1:${port} (관리자 로그인 활성)`));
function stop() { server.close(() => { store.close(); process.exit(0); }); }
process.on('SIGINT',stop); process.on('SIGTERM',stop);
