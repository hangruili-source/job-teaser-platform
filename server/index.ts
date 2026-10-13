import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { all, currentResume, events, get, log, newId, put, saveSettings, settings } from './store.js';
import { browserAvailable, isPortalUrl, sessionFile, storageSchema, verifyConnection } from './connector.js';
import { seedDemo } from './demo.js';
import { dayInTimezone } from './matching.js';
import { applicationsEnabled, dispatch, isRunning, startRun, startScheduler } from './workflow.js';
import { extractResume, renderResume, resumePath, saveOriginal } from './resumes.js';
import { exportWorkbook } from './export.js';
import type { Job, Mode, Resume, Run } from '../shared/types.js';
const app=express();const port=Number(process.env.PORT||3000);const host=process.env.HOST||'127.0.0.1';
if(!['127.0.0.1','localhost','::1'].includes(host)&&!process.env.APP_PASSWORD)throw new Error('对外监听时必须设置 APP_PASSWORD，并通过 HTTPS 访问。');
app.disable('x-powered-by');
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');if(req.path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');next();});
app.get('/health',(_req,res)=>res.json({ok:true}));
app.use((req,res,next)=>{
 if(process.env.APP_PASSWORD){const raw=req.headers.authorization||'';const [user,...rest]=Buffer.from(raw.replace(/^Basic /,''),'base64').toString().split(':');const password=rest.join(':');const hash=(s:string)=>createHash('sha256').update(s).digest();if(user!=='daylight'||!timingSafeEqual(hash(password),hash(process.env.APP_PASSWORD))){res.setHeader('WWW-Authenticate','Basic realm="Daylight", charset="UTF-8"');res.status(401).send('请使用用户名 daylight 和你设置的工作台密码登录。');return;}}
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){res.status(403).json({error:'请求来源不匹配。'});return;}
 next();
});
app.use(express.json({limit:'1mb'}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1}});
function modeOf(v:unknown):Mode{return z.enum(['demo','live']).parse(v||'demo');}
function dayOf(v:unknown){return z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s);return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===s;}).parse(v||dayInTimezone(new Date(),settings().timezone));}
let portal:'unverified'|'verified'|'failed'='unverified';let portalMessage='尚未验证连接';
seedDemo(settings().timezone);
app.get('/api/state',(req,res)=>{
 const mode=modeOf(req.query.mode);const day=dayOf(req.query.day);if(mode==='demo')seedDemo(settings().timezone);
 const runs=all<Run>('run',mode).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));const ids=new Set(runs.filter(r=>r.day===day).map(r=>r.id));
 res.json({mode,day,jobs:all<Job>('job',mode).filter(j=>(dayInTimezone(new Date(j.publishedAt),settings().timezone)===day||j.processingDay===day)).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)),resumes:all<Resume>('resume',mode).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),events:events(mode).filter(e=>e.runId?ids.has(e.runId):dayInTimezone(new Date(e.at),settings().timezone)===day),runs:runs.filter(r=>r.day===day),settings:settings(),connection:{applicationsEnabled:applicationsEnabled(),session:existsSync(sessionFile),apiKey:!!(process.env.DAYLIGHT_OPENAI_KEY || process.env.OPENAI_API_KEY),browser:browserAvailable(),portal,portalMessage},running:isRunning()});
});
app.post('/api/runs',(req,res)=>{res.status(202).json(startRun(modeOf(req.body.mode),dayOf(req.body.day),z.enum(['portal','saved']).parse(req.body.source||'portal')));});
const settingsSchema=z.object({portalUrl:z.string().refine(isPortalUrl),roles:z.string().max(500),locations:z.string().max(500),contract:z.string().max(200),timezone:z.string().refine(s=>{try{new Intl.DateTimeFormat('en',{timeZone:s});return true;}catch{return false;}}),dailyTime:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),scheduleEnabled:z.boolean(),autoApply:z.boolean(),model:z.string().min(1).max(100)});
app.put('/api/settings',(req,res)=>{const s=settingsSchema.parse(req.body);if(s.autoApply&&!applicationsEnabled())throw new Error('当前为仅分析模式，不能开启真实投递。');if(s.portalUrl!==settings().portalUrl){portal='unverified';portalMessage='网址已改变，请验证连接。';}saveSettings(s);log('live','settings','已更新求职偏好、连接或任务设置。');res.json({ok:true});});
app.post('/api/model/verify',async(_req,res)=>{
 const key=process.env.DAYLIGHT_OPENAI_KEY||process.env.OPENAI_API_KEY;
 if(!key)throw new Error('请在 Render 的 Environment 中设置 DAYLIGHT_OPENAI_KEY。');
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(60000),body:JSON.stringify({model:settings().model,store:false,input:'Reply with OK.',max_output_tokens:32})});
 if(!response.ok)throw new Error(`模型验证失败（HTTP ${response.status}）。401 请检查密钥；429 请检查 API 额度或速率限制；403/404 请检查模型访问权限。`);
 const result=await response.json() as any;
 if(!(result.output??[]).some((o:any)=>(o.content??[]).some((c:any)=>c.type==='output_text'&&c.text)))throw new Error('模型未返回可用文本，请检查模型配置。');
 log('live','model_verified',`模型 ${settings().model} 连接验证成功；未发送简历。`,'success');res.json({ok:true});
});
app.post('/api/connection',upload.single('file'),(req,res)=>{if(!req.file)throw new Error('请选择登录连接文件。');if(isRunning())throw new Error('请等待任务结束后更新连接。');const state=storageSchema.parse(JSON.parse(req.file.buffer.toString('utf8')));if(!state.cookies.length)throw new Error('连接文件没有 JobTeaser 登录信息。');writeFileSync(sessionFile,JSON.stringify(state),{mode:0o600});portal='unverified';portalMessage='文件已保存，请验证连接。';res.json({ok:true});});
app.delete('/api/connection',(_req,res)=>{if(isRunning())throw new Error('请等待任务结束后断开连接。');if(existsSync(sessionFile))unlinkSync(sessionFile);portal='unverified';portalMessage='已断开连接';const c=settings();saveSettings({...c,scheduleEnabled:false,autoApply:false});res.json({ok:true});});
app.post('/api/connection/verify',async(_req,res)=>{try{portalMessage=await verifyConnection(settings().portalUrl);portal='verified';res.json({ok:true,message:portalMessage});}catch(e){portal='failed';portalMessage=e instanceof Error?e.message:'连接失败';throw e;}});
app.post('/api/resumes',upload.single('file'),async(req,res)=>{const mode=modeOf(req.body.mode);if(isRunning())throw new Error('请等待任务结束后更换简历。');const text=req.file?await extractResume(req.file.buffer,req.file.originalname):z.string().parse(req.body.text);const name=req.file?.originalname||z.string().min(1).max(150).parse(req.body.name||'我的原始简历');const r=await saveOriginal(mode,name,text,req.file?{buffer:req.file.buffer,ext:path.extname(req.file.originalname).toLowerCase()}:undefined);log(mode,'resume_uploaded',`已保存原始简历 ${r.id}。`);res.status(201).json(r);});
app.post('/api/resumes/:id/approve',(req,res)=>{if(isRunning())throw new Error('请等待任务结束。');const r=get<Resume>('resume',String(req.params.id));if(!r||r.mode!=='live'||!r.needsReview)throw new Error('没有待确认的翻译版本。');put('resume',{...r,needsReview:false});log('live','translation_approved',`已人工确认翻译版本 ${r.id}。`,'success',null,r.jobId);res.json({ok:true});});
app.get('/api/resumes/:id/download',async(req,res)=>{const r=get<Resume>('resume',String(req.params.id));if(!r){res.status(404).json({error:'简历不存在。'});return;}await renderResume(r);res.download(resumePath(r.id),`resume-${r.id.slice(0,8)}.docx`);});
app.post('/api/jobs', (req,res)=>{const input=z.object({company:z.string().min(1).max(150),title:z.string().min(1).max(200),url:z.url().refine(u=>{const v=new URL(u);return v.protocol==='https:'&&!v.username&&!v.password;}),location:z.string().max(200),contract:z.string().max(100),description:z.string().min(40).max(50000),day:z.string()}).parse(req.body);const day=dayOf(input.day);const job:Job={id:newId(),mode:'live',company:input.company,title:input.title,url:input.url,location:input.location,contract:input.contract,description:input.description,publishedAt:day+'T12:00:00Z',easyApply:false,status:'new',reason:'手动添加，申请方式需人工确认。',match:null,resumeId:null,updatedAt:new Date().toISOString()};put('job',job);log('live','job_imported','手动添加岗位，未标记为可自动投递。','info',null,job.id);res.status(201).json(job);});
app.post('/api/jobs/:id/submit',async(req,res)=>{if(isRunning())throw new Error('任务正在运行，请等待结束。');const job=get<Job>('job',String(req.params.id));if(!job||job.mode!=='live'||job.status!=='ready')throw new Error('仅可提交真实模式中已准备好的岗位。');res.json(await dispatch(job));});
app.post('/api/jobs/:id/manual',(req,res)=>{if(isRunning())throw new Error('请等待任务完成。');const job=get<Job>('job',String(req.params.id));if(!job||job.mode!=='live')throw new Error('仅可更新真实岗位的人工投递结果。');const body=z.object({status:z.enum(['submitted','needs_manual']),note:z.string().min(1).max(1000)}).parse(req.body);const updated={...job,status:body.status,reason:'人工更新：'+body.note,updatedAt:new Date().toISOString()};put('job',updated);log('live','manual_update',updated.reason,'success',null,job.id);res.json(updated);});
app.get('/api/export',async(req,res)=>{const mode=modeOf(req.query.mode);const day=dayOf(req.query.day);res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="daylight-${mode}-${day}.xlsx"`);res.send(Buffer.from(await exportWorkbook(mode,day)));});
app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在。'}));
if(process.env.NODE_ENV==='production'){app.use(express.static(path.resolve('dist')));app.get('/{*path}',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));}
else {const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true,hmr:{port:24678}},appType:'spa'});app.use(vite.middlewares);}
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const message=error instanceof ZodError?'输入格式不正确，请检查网址、日期或必填内容。':error instanceof Error?error.message:'请求失败，请重试。';res.status(400).json({error:message});});
startScheduler();
app.listen(port,host,(error?:Error)=>{if(error){console.error(`Daylight could not listen: ${error.message}`);process.exit(1);}console.log(`Daylight listening on ${host}:${port}; mode=${process.env.NODE_ENV||'development'}`);});
