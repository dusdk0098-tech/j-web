import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { types } from './domain.js';
import QRCode from 'qrcode';
import { workerSpreadsheet, wageSpreadsheet } from './exports.js';
import { LocalAuth, sessionToken } from './auth.js';
import { workerSitePath } from './public/worker-link.js';
import { createHash, randomBytes } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
let publicOrigin='';
if(process.env.JWEB_PUBLIC_ORIGIN){
  let parsed;try{parsed=new URL(process.env.JWEB_PUBLIC_ORIGIN);}catch{throw new Error('HTTPS 공개 주소를 확인해 주세요.');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.origin!==process.env.JWEB_PUBLIC_ORIGIN)throw new Error('HTTPS 공개 주소는 경로 없이 입력해 주세요.');
  publicOrigin=parsed.origin;
}
const secureCookie=publicOrigin?'; Secure':'';
const dataDir = process.env.JWEB_DATA_DIR || join(root, 'data');
const auth=new LocalAuth(process.env.JWEB_ADMIN_PASSWORD);
mkdirSync(dataDir, { recursive: true });
const store = new Store(join(dataDir, 'jweb.sqlite'));
const workerSessions=new Map();
let workerFailures=[];
const workerAccountFailures=new Map();
const workerKey=raw=>typeof raw==='string' && /^[\w-]{43}$/.test(raw)?createHash('sha256').update(raw).digest('hex'):'';
delete process.env.JWEB_ADMIN_PASSWORD;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
const assets = new Set(['/','/app.js','/batch-print.js','/risk-scale.js','/worker-link.js','/style.css','/jweb-icon.svg','/jweb-icon-192.png','/jweb-icon-512.png','/join','/join.js','/login','/login.js']);
const json = (res, code, value) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(value)); };
async function body(req,max=65536) {
  const chunks=[];let size=0;
  for await (const chunk of req) { size+=chunk.length;if(size>max)throw new Error('입력 내용이 너무 깁니다.');chunks.push(chunk); }
  try { const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { throw new Error('입력 형식이 올바르지 않습니다.'); }
}
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    if (publicOrigin ? host!==new URL(publicOrigin).host : !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(res,403,{error:'허용된 접속 주소가 아닙니다.'});
    const origin = req.headers.origin;
    const requestOrigin=publicOrigin||`http://${host}`;
    if (origin && origin !== requestOrigin) return json(res,403,{error:'다른 출처의 요청은 허용되지 않습니다.'});
    const url = new URL(req.url, requestOrigin);
    const token=sessionToken(req.headers.cookie);
    if(url.pathname==='/api/session' && req.method==='GET')return json(res,200,{enabled:true,authenticated:auth.valid(token)});
    if(url.pathname==='/api/login' && req.method==='POST'){
      const input=await body(req),newToken=auth.login(input.password);
      if(!newToken)return json(res,401,{error:'암호가 올바르지 않거나 잠시 로그인할 수 없습니다.'});
      auth.logout(token);res.setHeader('Set-Cookie',`jweb_session=${newToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie}`);return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/logout' && req.method==='POST'){
      auth.logout(token);res.setHeader('Set-Cookie',`jweb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);return json(res,200,{ok:true});
    }
    const workerToken=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('jweb_worker='))?.slice(12)||'';
    if(url.pathname==='/worker.webmanifest'&&req.method==='GET'){
      const key=url.searchParams.get('site');if(!store.siteFromAccess(key))return json(res,404,{error:'현장 접속 주소를 확인해 주세요.'});
      const start=workerSitePath(key);res.writeHead(200,{'Content-Type':'application/manifest+json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});return res.end(JSON.stringify({name:'J웹 현장 출입',short_name:'J웹',id:start,start_url:start,scope:'/join',display:'standalone',background_color:'#f4f6fa',theme_color:'#213c80',icons:[{src:'/jweb-icon.svg',sizes:'any',type:'image/svg+xml'},{src:'/jweb-icon-192.png',sizes:'192x192',type:'image/png'},{src:'/jweb-icon-512.png',sizes:'512x512',type:'image/png'}]}));
    }
    if(url.pathname==='/api/worker/site'&&req.method==='GET'){const site=store.siteFromAccess(url.searchParams.get('key'));if(!site)return json(res,404,{error:'현장 접속 주소를 확인해 주세요.'});const canSignup=store.siteRegistrationOpen(site.id);return json(res,200,{...site,canSignup,...(canSignup?{companies:store.companies(site.id).map(c=>c.name),occupations:store.siteOccupations(site.id).map(o=>o.name)}:{})});}
    if(url.pathname==='/api/worker/login' && req.method==='POST'){
      const now=Date.now(),input=await body(req),site=input.siteKey?store.siteFromAccess(input.siteKey):store.invitation(input.token),accountKey=site&&typeof input.loginId==='string'&&/^[a-zA-Z0-9_]{3,40}$/.test(input.loginId)?`${site.id}:${input.loginId}`:'invalid';
      workerFailures=workerFailures.filter(t=>t>now-5*60*1000);for(const [key,times] of workerAccountFailures){const recent=times.filter(t=>t>now-5*60*1000);if(recent.length)workerAccountFailures.set(key,recent);else workerAccountFailures.delete(key);}
      const failures=workerAccountFailures.get(accountKey)||[];if(workerFailures.length>=100||failures.length>=10)return json(res,429,{error:'잠시 후 다시 로그인해 주세요.'});
      const worker=store.authenticateWorker(input.token,input.loginId,input.password,input.siteKey);
      if(!worker){workerFailures.push(now);failures.push(now);workerAccountFailures.set(accountKey,failures);return json(res,401,{error:'가입 링크 또는 로그인 정보를 확인해 주세요.'});}
      const current=new Date(now),date=new Date(now-current.getTimezoneOffset()*60000).toISOString().slice(0,10);
      store.recordWorkerLogin(worker.id,date);
      workerAccountFailures.delete(accountKey);workerSessions.delete(workerKey(workerToken));
      for(const [key,session] of workerSessions)if(session.expires<=now)workerSessions.delete(key);
      const raw=randomBytes(32).toString('base64url');workerSessions.set(workerKey(raw),{worker,expires:now+8*60*60*1000});
      res.setHeader('Set-Cookie',`jweb_worker=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie}`);return json(res,200,{worker});
    }
    if(url.pathname==='/api/worker/session' && req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      return json(res,200,{worker:session.worker});
    }
    if(url.pathname==='/api/worker/access' && req.method==='POST'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const input=await body(req);if(!Number.isSafeInteger(input.siteId)||input.siteId!==session.worker.site_id)return json(res,400,{error:'로그인한 현장을 확인해 주세요.'});
      const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);store.recordWorkerLogin(session.worker.id,date);return json(res,200,{ok:true});
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
    const workerArticleFile=url.pathname.match(/^\/api\/worker\/articles\/(\d+)\/files\/(\d+)$/);
    if(workerArticleFile&&req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const file=store.workerArticleFile(session.worker.id,workerArticleFile[1],workerArticleFile[2]);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});
      const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);
    }
    if(url.pathname==='/api/worker/articles' && req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      return json(res,200,store.workerArticles(session.worker.id));
    }
    if(url.pathname==='/api/worker/notices' && req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      return json(res,200,store.workerNotices(session.worker.id,date));
    }
    if(url.pathname==='/api/worker/instructions' && ['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      if(req.method==='GET')return json(res,200,store.workerInstructions(session.worker.id));
      const input=await body(req);return json(res,201,store.respondInstruction(session.worker.id,input.documentId,input));
    }
    const workerInstructionAttachments=url.pathname.match(/^\/api\/worker\/instructions\/(\d+)\/attachments(?:\/(\d+))?$/);
    if(workerInstructionAttachments && req.method==='GET'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
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
        const photos=store.workerInstructionPhotos(session.worker.id,id);
        if(!photoId)return json(res,200,photos);
        if(!photos.some(photo=>photo.id===Number(photoId)))return json(res,404,{error:'시험 사진을 찾을 수 없습니다.'});
        const photo=store.instructionPhoto(id,photoId),name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo.data);
      }
      if(photoId)return json(res,404,{error:'요청을 찾을 수 없습니다.'});
      store.workerInstructionPhotos(session.worker.id,id);
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}
      let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('사진 이름을 확인해 주세요.');}
      return json(res,201,{id:store.addWorkerInstructionPhoto(session.worker.id,id,url.searchParams.get('phase'),name,Buffer.concat(chunks))});
    }
    if(url.pathname==='/api/worker/self-check' && ['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      if(req.method==='GET')return json(res,200,{check:store.workerSelfCheck(session.worker.id,date)});
      const input=await body(req);return json(res,200,{check:store.createWorkerSelfCheck(session.worker.id,date,input.answers,input.signature)});
    }
    if(url.pathname==='/api/worker/daily-training' && ['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      if(req.method==='GET')return json(res,200,store.dailyTraining(session.worker.id,date));
      const input=await body(req);return json(res,200,store.confirmDailyTraining(session.worker.id,date,input.kinds,input.rightsConfirmed,input.signature));
    }
    if(url.pathname==='/api/worker/training' && ['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      if(req.method==='GET')return json(res,200,store.workerTraining(session.worker.id,date));
      const input=await body(req);store.confirmWorkerTraining(session.worker.id,input.documentId,date,input.rightsConfirmed);return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/worker/hazard-reports' && ['GET','POST'].includes(req.method)){
      const key=workerKey(workerToken),session=workerSessions.get(key);if(!session||session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      if(req.method==='GET')return json(res,200,store.workerHazardReports(session.worker.id));
      return json(res,201,{id:store.createWorkerHazardReport(session.worker.id,await body(req,2805000))});
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
      store.createWorkStop(session.worker.id,await body(req,2805000));return json(res,201,{ok:true});
    }
    const workerNotice=url.pathname.match(/^\/api\/worker\/notices\/(\d+)\/confirm$/);
    if(workerNotice && req.method==='POST'){
      const key=workerKey(workerToken),session=workerSessions.get(key);
      if(!session || session.expires<=Date.now()){workerSessions.delete(key);return json(res,401,{error:'근로자 로그인이 필요합니다.'});}
      const input=await body(req),now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);store.confirmWorkerNotice(session.worker.id,workerNotice[1],input.signature,date);return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/worker/logout' && req.method==='POST'){
      workerSessions.delete(workerKey(workerToken));res.setHeader('Set-Cookie',`jweb_worker=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);return json(res,200,{ok:true});
    }
    if(url.pathname.startsWith('/api/') && url.pathname!=='/api/join' && !auth.valid(token))return json(res,401,{error:'관리자 로그인이 필요합니다.'});
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const path = url.pathname === '/' ? '/index.html' : url.pathname === '/join' ? '/join.html' : url.pathname === '/login' ? '/login.html' : url.pathname;
      res.writeHead(200, {'Content-Type':mime[extname(path)],'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'"});
      return res.end(readFileSync(join(root,'public',path.slice(1))));
    }
    if (url.pathname === '/api/types' && req.method === 'GET') return json(res,200,types);
    const managerChecks=url.pathname.match(/^\/api\/sites\/(\d+)\/manager-checks$/);
    const managerDayOff=url.pathname.match(/^\/api\/sites\/(\d+)\/manager-checks\/day-off$/);
    if(managerDayOff && req.method==='POST'){const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);store.saveManagerDayOff(managerDayOff[1],date);return json(res,201,{ok:true});}
    if(managerChecks && req.method==='GET')return json(res,200,store.managerChecks(managerChecks[1]));
    if(managerChecks && req.method==='POST'){
      const input=await body(req);const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
      store.saveManagerCheck(managerChecks[1],date,input.answers,input.signature);return json(res,201,{ok:true});
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
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="test-signature.png"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);
    }
    const siteStops=url.pathname.match(/^\/api\/sites\/(\d+)\/work-stops$/);
    const hazardStatus=url.pathname.match(/^\/api\/sites\/(\d+)\/hazard-reports\/(\d+)$/);
    if(hazardStatus&&req.method==='PUT'){store.updateHazardReport(hazardStatus[1],hazardStatus[2],await body(req));return json(res,200,{ok:true});}
    const hazardReports=url.pathname.match(/^\/api\/sites\/(\d+)\/hazard-reports(?:\/(\d+)\/photo)?$/);
    if(hazardReports){const [,siteId,id]=hazardReports;
      if(!id&&req.method==='GET')return json(res,200,store.hazardReports(siteId,url.searchParams.get('q')||''));
      if(!id&&req.method==='POST')return json(res,201,{id:store.createHazardReport(siteId,await body(req,2805000))});
      if(id&&req.method==='GET'){const photo=store.hazardReportPhoto(siteId,id);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="test-hazard-photo"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo);}
    }
    if(siteStops && req.method==='GET')return json(res,200,store.workStops(siteStops[1],url.searchParams.get('q')||''));
    const stopPhoto=url.pathname.match(/^\/api\/sites\/(\d+)\/work-stops\/(\d+)\/photo$/);
    if(stopPhoto && req.method==='GET'){
      const photo=store.workStopPhoto(stopPhoto[1],stopPhoto[2]);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="work-stop-photo"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo);
    }
    const inviteSite=url.pathname.match(/^\/api\/sites\/(\d+)\/invitation$/);
    const registrationSite=url.pathname.match(/^\/api\/sites\/(\d+)\/access\/registration$/);
    const accessSite=url.pathname.match(/^\/api\/sites\/(\d+)\/access(?:\/(rotate))?$/);
    if(registrationSite&&req.method==='POST')return json(res,200,{expiresAt:store.openSiteRegistration(registrationSite[1])});
    if(accessSite&&req.method==='POST'){const key=accessSite[2]?store.rotateSiteAccess(accessSite[1]):store.ensureSiteAccess(accessSite[1]),link=`${requestOrigin}/join?site=${encodeURIComponent(key)}`;return json(res,200,{link,registrationExpiresAt:store.siteRegistrationExpiry(accessSite[1]),image:await QRCode.toDataURL(link,{errorCorrectionLevel:'M',margin:2,width:256})});}
    if (inviteSite && req.method === 'POST') {
      const invite=store.createInvitation(inviteSite[1]);
      const link=`${requestOrigin}/join?token=${encodeURIComponent(invite.token)}`;
      return json(res,201,{link,expiresAt:invite.expiresAt,image:await QRCode.toDataURL(link,{errorCorrectionLevel:'M',margin:2,width:256})});
    }
    if (inviteSite && req.method === 'DELETE') return json(res,200,{revoked:store.revokeInvitations(inviteSite[1])});
    if (url.pathname === '/api/join') {
      if (req.method === 'GET') {const invite=store.invitation(url.searchParams.get('token'));return invite?json(res,200,{id:invite.id,name:invite.name,siteKey:store.siteAccessKey(invite.id),companies:store.companies(invite.id).map(c=>c.name),occupations:store.siteOccupations(invite.id).map(o=>o.name)}):json(res,404,{error:'유효하지 않거나 만료된 가입 링크입니다.'});}
      if (req.method === 'POST') {const input=await body(req);store.join(input.token,input);return json(res,201,{ok:true});}
    }
    if (url.pathname === '/api/sites') {
      if (req.method === 'GET') return json(res,200,store.sites());
      if (req.method === 'POST') return json(res,201,store.createSite(await body(req)));
    }
    if(url.pathname==='/api/work-places'){
      if(req.method==='GET')return json(res,200,store.workPlaces(url.searchParams.get('siteId')));
      if(req.method==='POST')return json(res,201,store.createWorkPlace(await body(req)));
    }
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
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}
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
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}
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
    if(url.pathname==='/api/equipment'){
      if(req.method==='GET')return json(res,200,store.equipment(url.searchParams.get('siteId')));
      if(req.method==='POST')return json(res,201,store.createEquipment(await body(req)));
    }
    const equipmentId=url.pathname.match(/^\/api\/equipment\/(\d+)$/);
    if(equipmentId && req.method==='PUT')return json(res,200,store.updateEquipment(equipmentId[1],await body(req)));
    const equipmentFiles=url.pathname.match(/^\/api\/equipment\/(\d+)\/attachments(?:\/(\d+))?$/);
    if(equipmentFiles){
      const siteId=url.searchParams.get('siteId'),id=equipmentFiles[1],fileId=equipmentFiles[2];
      if(!fileId && req.method==='GET')return json(res,200,store.equipmentAttachments(siteId,id));
      if(!fileId && req.method==='POST'){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}
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
      if(!id&&req.method==='GET')return json(res,200,store.sitePhotos(siteId,url.searchParams.get('from')||'',url.searchParams.get('to')||'',url.searchParams.get('q')||''));
      if(!id&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('사진 이름을 확인해 주세요.');}return json(res,201,{id:store.addSitePhoto(siteId,name,Buffer.concat(chunks))});}
      if(id&&req.method==='PUT'){store.updateSitePhoto(siteId,id,await body(req));return json(res,200,{ok:true});}
      if(id&&req.method==='DELETE'){store.deleteSitePhoto(siteId,id);return json(res,200,{ok:true});}
      if(id&&req.method==='GET'){const photo=store.sitePhoto(siteId,id);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});const bytes=Buffer.from(photo.data),type=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':'image/jpeg';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);}
    }
    const articleFile=url.pathname.match(/^\/api\/site-articles\/(\d+)\/files(?:\/(\d+))?$/);
    if(articleFile){
      const [,articleId,fileId]=articleFile,siteId=url.searchParams.get('siteId');
      if(!fileId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}return json(res,201,{id:store.addArticleFile(siteId,articleId,name,Buffer.concat(chunks))});}
      if(fileId&&req.method==='DELETE'){store.deleteArticleFile(siteId,articleId,fileId);return json(res,200,{ok:true});}
      if(fileId&&req.method==='GET'){const file=store.articleFile(siteId,articleId,fileId);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);}
    }
    if(url.pathname==='/api/site-articles'){
      if(req.method==='GET')return json(res,200,store.siteArticles(url.searchParams.get('siteId'),url.searchParams.get('category')||'',url.searchParams.get('q')||''));
      if(req.method==='POST')return json(res,201,store.saveSiteArticle(await body(req)));
    }
    const siteArticle=url.pathname.match(/^\/api\/site-articles\/(\d+)$/);
    if(siteArticle&&req.method==='PUT')return json(res,200,store.saveSiteArticle(await body(req),siteArticle[1]));
    if(url.pathname==='/api/wages/summary'&&req.method==='GET')return json(res,200,store.wageSummary(url.searchParams.get('siteId'),url.searchParams.get('month'),Object.fromEntries(url.searchParams)));
    if(url.pathname==='/api/wages/daily'&&req.method==='GET')return json(res,200,store.wageDailyRecords(url.searchParams.get('siteId'),url.searchParams.get('month'),Object.fromEntries(url.searchParams)));
    if(url.pathname==='/api/wages/export'&&req.method==='GET'){
      const siteId=url.searchParams.get('siteId'),month=url.searchParams.get('month'),filters=Object.fromEntries(url.searchParams),data=await wageSpreadsheet(store.wageRecords(siteId,month,filters),month,store.wageDailyRecords(siteId,month,filters));
      res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename=wages.xlsx','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(data);
    }
    if(url.pathname==='/api/wages'){
      if(req.method==='GET')return json(res,200,store.wageRecords(url.searchParams.get('siteId'),url.searchParams.get('month'),Object.fromEntries(url.searchParams)));
      if(req.method==='POST'){store.saveWageRecord(await body(req));return json(res,200,{ok:true});}
      if(req.method==='PUT'){store.saveWageRecord(await body(req),true);return json(res,200,{ok:true});}
    }
    if(url.pathname==='/api/meal-checks/month'&&req.method==='GET')return json(res,200,store.monthlyMealChecks(url.searchParams.get('siteId'),url.searchParams.get('month')));
    if(url.pathname==='/api/meal-checks/statement'&&req.method==='GET')return json(res,200,store.mealStatement(url.searchParams.get('siteId'),url.searchParams.get('month')));
    if(url.pathname==='/api/meal-checks/month/worker'&&req.method==='GET')return json(res,200,store.workerMonthlyMealChecks(url.searchParams.get('siteId'),url.searchParams.get('workerId'),url.searchParams.get('month')));
    if(url.pathname==='/api/meal-checks/month/worker'&&req.method==='POST')return json(res,200,{changed:store.setWorkerMonthlyMeals(await body(req))});
    if(url.pathname==='/api/meal-checks'){
      if(req.method==='GET')return json(res,200,store.mealChecks(url.searchParams.get('siteId'),url.searchParams.get('date')));
      if(req.method==='POST'){store.saveMealCheck(await body(req));return json(res,200,{ok:true});}
      if(req.method==='DELETE'){store.deleteMealCheck(url.searchParams.get('siteId'),url.searchParams.get('id'));return json(res,200,{ok:true});}
    }
    if(url.pathname==='/api/meal-defaults'){
      if(req.method==='GET')return json(res,200,store.mealDefaults(url.searchParams.get('siteId')));
      if(req.method==='PUT'){const input=await body(req);return json(res,200,store.saveMealDefaults(input.siteId,input.items));}
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
    if (url.pathname === '/api/companies') {
      if(req.method==='GET')return json(res,200,store.companies(url.searchParams.get('siteId')));
      if(req.method==='POST')return json(res,201,store.createCompany(await body(req)));
    }
    if(url.pathname==='/api/safety-costs'){
      if(req.method==='GET')return json(res,200,store.safetyCosts(url.searchParams.get('siteId'),url.searchParams.get('month')));
      if(req.method==='POST')return json(res,201,store.createSafetyCost(await body(req)));
    }
    if(url.pathname==='/api/safety-cost-reports'&&req.method==='POST')return json(res,201,store.createSafetyCostReport(await body(req)));
    const costPhotos=url.pathname.match(/^\/api\/safety-costs\/(\d+)\/photos(?:\/(\d+))?$/);
    if(costPhotos){
      const siteId=url.searchParams.get('siteId'),id=costPhotos[1],photoId=costPhotos[2];
      if(!photoId&&req.method==='GET')return json(res,200,store.safetyCostPhotos(siteId,id));
      if(!photoId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('사진 이름을 확인해 주세요.');}return json(res,201,{id:store.addSafetyCostPhoto(siteId,id,name,Buffer.concat(chunks))});}
      if(photoId&&req.method==='DELETE'){store.deleteSafetyCostPhoto(siteId,id,photoId);return json(res,200,{ok:true});}
      if(photoId&&req.method==='GET'){const photo=store.safetyCostPhoto(siteId,id,photoId);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});const name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo.data);}
    }
    const costReportPhotos=url.pathname.match(/^\/api\/safety-cost-reports\/(\d+)\/photos(?:\/(\d+))?$/);
    if(costReportPhotos&&req.method==='GET'){
      const id=costReportPhotos[1],photoId=costReportPhotos[2];if(!photoId)return json(res,200,store.safetyCostReportPhotos(id));
      const photo=store.safetyCostReportPhoto(id,photoId);if(!photo)return json(res,404,{error:'사진을 찾을 수 없습니다.'});const name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo.data);
    }
    const company=url.pathname.match(/^\/api\/companies\/(\d+)$/);
    if(company && req.method==='PUT')return json(res,200,store.updateCompany(company[1],await body(req)));
    if(url.pathname==='/api/ppe-issues'){
      if(req.method==='GET')return json(res,200,store.ppeIssues(url.searchParams.get('siteId'),url.searchParams.get('month')));
      if(req.method==='POST')return json(res,201,{id:store.addPpeIssue(await body(req))});
    }
    const ppeIssue=url.pathname.match(/^\/api\/ppe-issues\/(\d+)$/);
    if(ppeIssue&&req.method==='PUT'){store.updatePpeIssue(ppeIssue[1],await body(req));return json(res,200,{ok:true});}
    if(ppeIssue&&req.method==='DELETE'){store.deletePpeIssue(url.searchParams.get('siteId'),ppeIssue[1]);return json(res,200,{ok:true});}
    if (url.pathname === '/api/workers') {
      if (req.method === 'GET') return json(res,200,store.workers(url.searchParams.get('siteId'),url.searchParams.get('q') || '',Object.fromEntries(url.searchParams)));
      if (req.method === 'POST') return json(res,201,store.createWorker(await body(req)));
    }
    const worker=url.pathname.match(/^\/api\/workers\/(\d+)$/);
    const workerPassword=url.pathname.match(/^\/api\/workers\/(\d+)\/password$/);
    if(workerPassword&&req.method==='PUT'){const input=await body(req),siteId=Number(input.siteId),id=Number(workerPassword[1]),loginId=store.resetWorkerPassword(siteId,id,input.password);for(const [key,session] of workerSessions)if(session.worker.id===id&&session.worker.site_id===siteId)workerSessions.delete(key);workerAccountFailures.delete(`${siteId}:${loginId}`);return json(res,200,{ok:true});}
    const workerFiles=url.pathname.match(/^\/api\/workers\/(\d+)\/files(?:\/(\d+))?$/);
    if(workerFiles){
      const [,workerId,fileId]=workerFiles,siteId=url.searchParams.get('siteId');
      if(!fileId&&req.method==='GET')return json(res,200,store.workerFiles(siteId,workerId));
      if(!fileId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}return json(res,201,{id:store.addWorkerFile(siteId,workerId,url.searchParams.get('category'),name,Buffer.concat(chunks))});}
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
    if(worker && req.method==='PUT')return json(res,200,store.updateWorker(worker[1],await body(req)));
    if (url.pathname === '/api/workers/export' && req.method === 'GET') {
      const data=await workerSpreadsheet(store.workers(url.searchParams.get('siteId'),url.searchParams.get('q') || '',Object.fromEntries(url.searchParams)));
      res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename=workers.xlsx",'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return res.end(data);
    }
    if (url.pathname === '/api/attendance/month' && req.method === 'GET') return json(res,200,store.monthlyAttendance(url.searchParams.get('siteId'),url.searchParams.get('month')));
    if (url.pathname === '/api/education/report' && req.method === 'GET') return json(res,200,store.educationReport(url.searchParams.get('siteId'),url.searchParams.get('from'),url.searchParams.get('to')));
    if (url.pathname === '/api/weekly-activity' && req.method === 'GET') return json(res,200,store.weeklyActivity(url.searchParams.get('siteId'),url.searchParams.get('start')));
    if(url.pathname==='/api/attendance/units'&&req.method==='PUT'){store.setAttendanceUnits(await body(req));return json(res,200,{ok:true});}
    if(url.pathname==='/api/attendance/daily-rate'&&req.method==='PUT'){store.setAttendanceDailyRate(await body(req));return json(res,200,{ok:true});}
    if(url.pathname==='/api/attendance/month/details'&&req.method==='PUT')return json(res,200,{updated:store.updateMonthlyAttendanceDetails(await body(req))});
    if (url.pathname === '/api/attendance') {
      if (req.method === 'GET') return json(res,200,store.attendance(url.searchParams.get('siteId'),url.searchParams.get('date')));
      if (req.method === 'POST') {store.setAttendance(await body(req));return json(res,200,{ok:true});}
    }
    if (url.pathname === '/api/attendance/report' && req.method === 'GET') return json(res,200,store.attendanceReport(url.searchParams.get('siteId'),url.searchParams.get('from'),url.searchParams.get('to'),url.searchParams.get('group')));
    if (url.pathname === '/api/documents') {
      if (req.method === 'GET') return json(res,200,store.documents(url.searchParams.get('siteId'),url.searchParams.get('type') || '',url.searchParams.get('q') || '',url.searchParams.get('from') || '',url.searchParams.get('to') || ''));
      if (req.method === 'POST') return json(res,201,store.createDocument(await body(req)));
    }
    if (url.pathname === '/api/daily-report/previous' && req.method === 'GET') return json(res,200,store.previousDailyReport(url.searchParams.get('siteId'),url.searchParams.get('before')));
    if (url.pathname === '/api/joint-inspection/previous' && req.method === 'GET') return json(res,200,store.previousJointInspection(url.searchParams.get('siteId'),url.searchParams.get('before')));
    if (url.pathname === '/api/inspection/previous' && req.method === 'GET') return json(res,200,store.previousInspections(url.searchParams.get('siteId'),url.searchParams.get('before'),url.searchParams.get('excludeId')));
    if (url.pathname === '/api/risk/previous' && req.method === 'GET') return json(res,200,store.previousRiskAssessments(url.searchParams.get('siteId'),url.searchParams.get('before'),url.searchParams.get('kind'),url.searchParams.get('scale'),url.searchParams.get('excludeId')));
    if (url.pathname === '/api/daily-report/sources' && req.method === 'GET') return json(res,200,store.dailySourceDocuments(url.searchParams.get('siteId'),url.searchParams.get('date')));
    if (url.pathname === '/api/safety-log/sources' && req.method === 'GET') return json(res,200,store.safetyLogSources(url.searchParams.get('siteId'),url.searchParams.get('date')));
    const equipmentChecks=url.pathname.match(/^\/api\/documents\/(\d+)\/equipment-checks$/);
    if(equipmentChecks){
      if(req.method==='GET')return json(res,200,store.equipmentChecks(equipmentChecks[1]));
      if(req.method==='POST')return json(res,201,{id:store.addEquipmentCheck(equipmentChecks[1],await body(req))});
    }
    const instructionSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/instruction-signature$/);
    if(instructionSignature && req.method==='GET'){
      const signature=store.instructionSignature(instructionSignature[1]);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="test-instruction-signature.png"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);
    }
    const instructionResult=url.pathname.match(/^\/api\/documents\/(\d+)\/instruction-result$/);
    if(instructionResult){
      if(req.method==='GET')return json(res,200,store.instructionResult(instructionResult[1]));
      if(req.method==='POST')return json(res,201,store.addInstructionResult(instructionResult[1],await body(req)));
    }
    const instructionPhotos=url.pathname.match(/^\/api\/documents\/(\d+)\/instruction-photos(?:\/(\d+))?$/);
    if(instructionPhotos){
      const id=instructionPhotos[1],photoId=instructionPhotos[2];
      if(!photoId&&req.method==='GET')return json(res,200,store.instructionPhotos(id));
      if(!photoId&&req.method==='POST'){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('사진은 2MB 이하여야 합니다.');chunks.push(chunk);}
        let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('사진 이름을 확인해 주세요.');}
        return json(res,201,{id:store.addInstructionPhoto(id,url.searchParams.get('phase'),name,Buffer.concat(chunks))});
      }
      if(photoId&&req.method==='DELETE'){store.deleteInstructionPhoto(id,photoId);return json(res,200,{ok:true});}
      if(photoId&&req.method==='GET'){const photo=store.instructionPhoto(id,photoId);if(!photo)return json(res,404,{error:'시험 사진을 찾을 수 없습니다.'});const name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo.data);}
    }
    const checklistSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/checklist-signature(?:\/(image))?$/);
    if(checklistSignature){const [,id,image]=checklistSignature;if(req.method==='POST'&&!image){const input=await body(req);store.saveChecklistSignature(id,input.signature);return json(res,200,{ok:true});}if(req.method==='GET'){const saved=store.checklistSignature(id);if(!image)return json(res,200,{hasSignature:!!saved,createdAt:saved?.created_at||null});if(!saved)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(saved.signature);}}
    const attachList=url.pathname.match(/^\/api\/documents\/(\d+)\/attachments$/);
    if(attachList){
      if(req.method==='GET') return json(res,200,store.attachments(attachList[1]));
      if(req.method==='POST'){
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}
        let name;try{name=decodeURIComponent(req.headers['x-file-name'] || '');}catch{throw new Error('파일 이름을 확인해 주세요.');}
        const id=store.addAttachment(attachList[1],name,Buffer.concat(chunks),url.searchParams.get('category')||'general');return json(res,201,{id});
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
    const attach=url.pathname.match(/^\/api\/attachments\/(\d+)$/);
    if(attach){
      if(req.method==='DELETE'){store.deleteAttachment(attach[1]);return json(res,200,{ok:true});}
      if(req.method==='GET'){
        const file=store.attachment(attach[1]);if(!file)return json(res,404,{error:'첨부파일을 찾을 수 없습니다.'});
        const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file.data);
      }
    }
    const riskPhotos=url.pathname.match(/^\/api\/documents\/(\d+)\/risk-activities\/(\d+)\/photos(?:\/(\d+))?$/);
    if(riskPhotos){const [,docId,activityId,photoId]=riskPhotos;
      if(!photoId&&req.method==='GET')return json(res,200,store.riskActivityPhotos(docId,activityId));
      if(!photoId&&req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('파일은 2MB 이하여야 합니다.');chunks.push(chunk);}let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('파일 이름을 확인해 주세요.');}return json(res,201,{id:store.addRiskActivityPhoto(docId,activityId,name,Buffer.concat(chunks),url.searchParams.get('purpose')||'photo')});}
      if(photoId&&req.method==='DELETE'){store.deleteRiskActivityPhoto(docId,activityId,photoId);return json(res,200,{ok:true});}
      if(photoId&&req.method==='GET'){const photo=store.riskActivityPhoto(docId,activityId,photoId);if(!photo)return json(res,404,{error:'시험 사진을 찾을 수 없습니다.'});const name=encodeURIComponent(photo.name).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="photo"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(photo.data);}
    }
    const permitCheck=url.pathname.match(/^\/api\/documents\/(\d+)\/permit-checks(?:\/(\d+))?$/);
    if(permitCheck){const [,id,checkId]=permitCheck;if(!checkId&&req.method==='GET')return json(res,200,store.permitChecks(id));if(!checkId&&req.method==='POST')return json(res,201,{id:store.savePermitCheck(id,await body(req,120000))});if(checkId&&req.method==='PUT')return json(res,200,{id:store.savePermitCheck(id,await body(req,120000),checkId)});if(checkId&&req.method==='DELETE'){store.deletePermitCheck(id,checkId);return json(res,200,{ok:true});}}
    const permitExtension=url.pathname.match(/^\/api\/documents\/(\d+)\/permit-extensions(?:\/(\d+))?(?:\/(signature))?$/);
    if(permitExtension){const [,id,extensionId,signature]=permitExtension;if(!extensionId&&!signature&&req.method==='GET')return json(res,200,store.permitExtensions(id));if(!extensionId&&!signature&&req.method==='POST')return json(res,201,{id:store.savePermitExtension(id,await body(req))});if(extensionId&&!signature&&req.method==='PUT')return json(res,200,{id:store.savePermitExtension(id,await body(req),extensionId)});if(extensionId&&!signature&&req.method==='DELETE'){store.deletePermitExtension(id,extensionId);return json(res,200,{ok:true});}if(extensionId&&signature&&req.method==='GET'){const image=store.permitExtensionSignature(id,extensionId);if(!image)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(image);}}
    const riskActivity=url.pathname.match(/^\/api\/documents\/(\d+)\/risk-activities(?:\/(\d+))?$/);
    if(riskActivity){const [,id,activityId]=riskActivity;if(!activityId&&req.method==='GET')return json(res,200,store.riskActivities(id));if(!activityId&&req.method==='POST')return json(res,201,{id:store.saveRiskActivity(id,await body(req))});if(activityId&&req.method==='PUT')return json(res,200,{id:store.saveRiskActivity(id,await body(req),activityId)});if(activityId&&req.method==='DELETE'){store.deleteRiskActivity(id,activityId);return json(res,200,{ok:true});}}
    if(url.pathname==='/api/documents/batch-approve'&&req.method==='POST'){const input=await body(req);return json(res,200,store.approveDocuments(input.siteId,input.ids));}
    const match = url.pathname.match(/^\/api\/documents\/(\d+)(?:\/(events|transition|notice-reads|training-checks|training-targets))?$/);
    const noticeSignature=url.pathname.match(/^\/api\/documents\/(\d+)\/notice-reads\/(\d+)\/signature$/);
    if(noticeSignature && req.method==='GET'){
      const signature=store.noticeSignature(noticeSignature[1],noticeSignature[2]);if(!signature)return json(res,404,{error:'시험 서명을 찾을 수 없습니다.'});
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="test-notice-signature.png"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(signature);
    }
    if (match) {
      const [,id,part] = match;
      if (req.method === 'GET' && part === 'events') return json(res,200,store.events(id));
      if (req.method === 'GET' && part === 'notice-reads') return json(res,200,store.noticeReads(id));
      if (req.method === 'GET' && part === 'training-checks') return json(res,200,store.trainingChecks(id));
      if (req.method === 'GET' && part === 'training-targets') return json(res,200,store.trainingTargets(id));
      if (req.method === 'PUT' && part === 'training-targets') {const input=await body(req);store.setTrainingTargets(id,input.workerIds);return json(res,200,{ok:true});}
      if (req.method === 'GET' && !part) { const d=store.document(id); return d ? json(res,200,d) : json(res,404,{error:'문서를 찾을 수 없습니다.'}); }
      if (req.method === 'PUT' && !part) return json(res,200,store.updateDocument(id,await body(req)));
      if (req.method === 'POST' && part === 'transition') {const input=await body(req);return json(res,200,store.transition(id,input.action,input.opinion));}
    }
    return json(res,404,{error:'요청한 경로가 없습니다.'});
  } catch (e) { return json(res,400,{error:e.message || '요청을 처리하지 못했습니다.'}); }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => console.log(`J웹: http://127.0.0.1:${port} (관리자 로그인 활성)`));
function stop() { server.close(() => { store.close(); process.exit(0); }); }
process.on('SIGINT',stop); process.on('SIGTERM',stop);
