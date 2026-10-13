import { all, currentResume, dataDir, db, events, get, log, newId, put, settings, updateJob } from './store.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { exportWorkbook } from './export.js';
import { decision, dayInTimezone, matchResume, normalize, previousDay, scheduleSlot } from './matching.js';
import { applyEasy, scanPortal } from './connector.js';
import { originalFile, renderResume, resumePath, tailorResume } from './resumes.js';
import { seedDemo } from './demo.js';
import { detectLanguage } from './languages.js';
import type { Job, Mode, Resume, Run } from '../shared/types.js';
let running=false;
export const isRunning=()=>running;
const regions:Record<string,string[]>={
 france:['france','fr','法国','paris','lyon','marseille','toulouse','bordeaux','lille'],
 germany:['germany','de','deutschland','allemagne','德国','berlin','munich','münchen','frankfurt','hamburg','düsseldorf'],
 luxembourg:['luxembourg','lu','卢森堡'],
 'united kingdom':['united kingdom','uk','gb','royaume-uni','英国','london','manchester','edinburgh','birmingham'],
 belgium:['belgium','be','belgique','belgië','比利时','brussels','bruxelles','antwerp'],
 netherlands:['netherlands','nl','pays-bas','nederland','荷兰','amsterdam','rotterdam','the hague'],
 europe:['europe','europa','欧洲','ireland','dublin','spain','madrid','barcelona','italy','milan','rome','switzerland','zurich','geneva','austria','vienna','sweden','stockholm','denmark','copenhagen','portugal','lisbon','poland','warsaw','finland','helsinki','norway','oslo','czechia','prague']
};
export function relevant(job:Job,config:ReturnType<typeof settings>) {
 const match=(filter:string,text:string)=>!filter.trim()||filter.split(/[,，\n]/).filter(Boolean).some(w=>normalize(text).includes(normalize(w)));
 const location=normalize(job.location);
 const locationMatch=!config.locations.trim()||config.locations.split(/[,，\n]/).some(w=>{
  const term=normalize(w);const canonical=Object.keys(regions).find(k=>k===term||regions[k].includes(term));
  return (canonical?regions[canonical]:[term]).some(alias=>alias.length<=2?location.split(/[,\s]+/).includes(alias):location.includes(alias));
 });
 return match(config.roles,job.title+' '+job.description)&&locationMatch&&match(config.contract,job.contract||job.title+' '+job.description);
}
export function selectResume(job:Job,resumes:Resume[]) {
 const language=detectLanguage(job.description);
 const originals=resumes.filter(r=>!r.parentId);
 const personal=originals.filter(r=>!r.sample);
 const candidates=(personal.length?personal:originals).map(resume=>({resume,match:matchResume(resume.text,job.description)})).sort((a,b)=>b.match.score-a.match.score||Number((b.resume.language||detectLanguage(b.resume.text))===language)-Number((a.resume.language||detectLanguage(a.resume.text))===language)||b.resume.createdAt.localeCompare(a.resume.createdAt));
 return {best:candidates[0],comparisons:candidates.map(c=>({resumeId:c.resume.id,name:c.resume.name,score:c.match.score,language:c.resume.language||detectLanguage(c.resume.text)}))};
}
export async function dispatch(job:Job,runId:string|null=null) {
 if(job.mode==='demo')return updateJob(job,{status:'ready',reason:'演示已完成：模拟达到提交条件，未发送任何真实申请。'});
 if(!job.easyApply)return updateJob(job,{status:'needs_manual',reason:'站外或无法确认的申请方式，请打开官网处理后更新状态。'});
 if(!job.resumeId)throw new Error('没有可投递的简历版本。');
 if(db.prepare('SELECT jobId FROM dispatches WHERE jobId=?').get(job.id))return updateJob(job,{status:'needs_manual',reason:'此岗位已有提交尝试，请先核实网站中的记录，系统不会重复提交。'});
 const resume=get<Resume>('resume',job.resumeId);if(!resume||resume.mode!==job.mode)throw new Error('简历版本不存在。');
 if(resume.needsReview)throw new Error('请先对照原文确认翻译版本。');
 await renderResume(resume);
 db.prepare('INSERT INTO dispatches(jobId,state,at) VALUES(?,?,?)').run(job.id,'pending',new Date().toISOString());
 log(job.mode,'submit_started','开始提交站内申请；已启用防重复锁。','info',runId,job.id);
 try {
  const result=await applyEasy(job,resume.parentId?resumePath(resume.id):originalFile(resume));
  db.prepare('UPDATE dispatches SET state=? WHERE jobId=?').run(result.submitted?'submitted':'review',job.id);
  log(job.mode,result.submitted?'submitted':'manual',result.reason,result.submitted?'success':'warning',runId,job.id);
  return updateJob(job,{status:result.submitted?'submitted':'needs_manual',reason:result.reason});
 } catch(e) {
  const reason='投递过程异常，提交结果需人工核实：'+(e instanceof Error?e.message:'未知错误');
  db.prepare('UPDATE dispatches SET state=? WHERE jobId=?').run('review',job.id);
  log(job.mode,'submit_error',reason,'error',runId,job.id);return updateJob(job,{status:'needs_manual',reason});
 }
}
export async function processJob(input:Job,runId:string) {
 if(input.status==='submitted'||db.prepare('SELECT jobId FROM dispatches WHERE jobId=?').get(input.id))return;
 const {best,comparisons}=selectResume(input,all<Resume>('resume',input.mode));if(!best)throw new Error('请先上传简历。');
 const {resume:original,match}=best;
 const config=settings();
 log(input.mode,'inspected',`${input.company} · ${input.title}；发布日期 ${input.publishedAt}。`,'info',runId,input.id);
 if(!relevant(input,config)){updateJob(input,{status:'skipped',reason:'不符合设置中的岗位、地区或合同类型筛选。'});log(input.mode,'filtered','不符合求职偏好，已跳过。','info',runId,input.id);return;}
 let job=updateJob(input,{match,resumeId:null,comparisons});
 log(job.mode,'resume_selected',`已比较 ${comparisons.length} 份原始简历，选择「${original.name}」作为事实来源。`,'info',runId,job.id);
 log(job.mode,'matched',`关键词匹配 ${match.score}%（${match.matched.length}/${match.total}）。命中：${match.matched.join('、')||'无'}；缺失：${match.missing.join('、')||'无'}。`,'info',runId,job.id);
 if(!match.total){updateJob(job,{status:'needs_manual',reason:'JD 中没有足够可识别的关键词，不能据此判断匹配程度。'});return;}
 if(decision(match.score)==='skip'){updateJob(job,{status:'skipped',reason:'关键词匹配低于 40%，按规则跳过。'});log(job.mode,'skipped','低于 40% 阈值，跳过投递。','info',runId,job.id);return;}
 if(decision(match.score)==='tailor'||detectLanguage(job.description)!==(original.language||detectLanguage(original.text))) {
  try {
   const existing=all<Resume>('resume',job.mode).find(r=>r.parentId===original.id&&r.jobId===job.id);
   const resume=existing||await tailorResume(job,config.model,original,decision(match.score)==='tailor');
   job=updateJob(job,{resumeId:resume.id});
   if(resume.needsReview){updateJob(job,{status:'needs_resume',reason:'JD 与原简历语言不同，已生成翻译版本。请在简历工作室对照确认，再重新匹配已有岗位。'});log(job.mode,'translation_review','已生成跟随 JD 语言的版本，等待人工对照确认。','warning',runId,job.id);return;}
   log(job.mode,'tailored',`已${existing?'复用':'生成'}简历版本 ${resume.id}，精选原文 ${resume.highlights.length} 段；保留原始事实。${job.mode==='demo'?'（演示：未调用模型）':''}`,'success',runId,job.id);
  } catch(e){const reason=e instanceof Error?e.message:'简历生成失败';updateJob(job,{status:'needs_resume',reason});log(job.mode,'tailoring_blocked',reason,'warning',runId,job.id);return;}
 } else job=updateJob(job,{resumeId:original.id});
 if(!job.easyApply){updateJob(job,{status:'needs_manual',reason:'需要跳转官网或人工确认申请方式。请打开岗位链接，使用对应简历投递。'});log(job.mode,'manual','已列入人工申请清单。','warning',runId,job.id);return;}
 job=updateJob(job,{status:'ready',reason:job.mode==='demo'?'演示流程已完成，没有发送真实申请。':'简历已准备好，可单独投递或在设置中启用自动投递。'});
 if(config.autoApply&&job.mode==='live')await dispatch(job,runId);
 else log(job.mode,'ready',job.reason,'success',runId,job.id);
}
export function startRun(mode:Mode,day:string,source:'portal'|'saved'|'scheduled'='portal') {
 if(running)throw new Error('已有任务正在运行，请等待完成。');
 if(!currentResume(mode))throw new Error('请先上传或粘贴一份简历。');
 running=true;
 const run:Run={id:newId(),mode,day,startedAt:new Date().toISOString(),finishedAt:null,status:'running',summary:'正在开始…'};
 put('run',run);
 void (async()=>{
  let partial=false;
  try {
   const config=settings();
   log(mode,'run_started',`${mode==='demo'?'演示':'真实'}任务开始：${day}，时区 ${config.timezone}，按发布日期筛选。`,'info',run.id);
   if(mode==='demo')seedDemo(config.timezone);
   else if(source==='portal'||source==='scheduled') {
    const result=await scanPortal(config,message=>log(mode,'scan',message,'info',run.id));partial=result.partial;
    for(const item of result.jobs) {
     const posted=dayInTimezone(new Date(item.publishedAt),config.timezone);
     if(posted!==day&&!(source==='scheduled'&&posted===previousDay(day)))continue;
     if(!get<Job>('job',item.id))put<Job>('job',{...item,mode,processingDay:day,status:'new',reason:'来自 JobTeaser',match:null,resumeId:null,updatedAt:new Date().toISOString()});
    }
    log(mode,'scan_finished',`读取 ${result.pages} 个列表页、${result.jobs.length} 个结构完整的岗位。${partial?'部分页面或岗位未能读取，本次不自动提交。':'已遍历当前可识别的列表分页。'}`,partial?'warning':'success',run.id);
   }
   const jobs=all<Job>('job',mode).filter(j=>(dayInTimezone(new Date(j.publishedAt),config.timezone)===day||j.processingDay===day));
   if(partial) {
    for(const job of jobs) {if(job.status==='submitted')continue; const chosen=selectResume(job,all<Resume>('resume',mode));updateJob(job,{match:chosen.best?.match||null,comparisons:chosen.comparisons,status:'needs_manual',reason:'本轮采集不完整，已暂停自动提交；请查看日志并人工核实。'});}
   } else for(const job of jobs)await processJob(job,run.id);
   const warnings=events(mode).filter(e=>e.runId===run.id&&(e.level==='warning'||e.level==='error')).length;
   const summary=`检查 ${jobs.length} 个当日岗位${warnings?`，${warnings} 项需要处理`:''}。${partial?'采集不完整，未自动提交。':''}${mode==='demo'?'演示未发送真实申请。':''}`;
   put('run',{...run,status:partial?'partial':'complete',finishedAt:new Date().toISOString(),summary});log(mode,'run_finished',summary,partial?'warning':'success',run.id);
  } catch(e) {const message=e instanceof Error?e.message:'任务失败';put('run',{...run,status:'failed',finishedAt:new Date().toISOString(),summary:message});log(mode,'run_failed',message,'error',run.id);}
  finally {
   try {
    const directory=path.join(dataDir,'reports');mkdirSync(directory,{recursive:true,mode:0o700});
    writeFileSync(path.join(directory,`${mode}-${day}.xlsx`),Buffer.from(await exportWorkbook(mode,day)),{mode:0o600});
    log(mode,'report_saved',`已生成 ${day} 的 Excel 日报，包含岗位、日志和简历版本。`,'success',run.id);
   } catch(e) {
    log(mode,'report_error','Excel 日报生成失败：'+(e instanceof Error?e.message:'未知错误'),'error',run.id);
    const saved=get<Run>('run',run.id);if(saved&&saved.status==='complete')put('run',{...saved,status:'partial',summary:saved.summary+' Excel 日报生成失败，请查看日志。'});
   }
   running=false;
  }
 })();
 return run;
}
export function startScheduler() {
 const timer=setInterval(()=>{
  const c=settings();if(!c.scheduleEnabled||running||!currentResume('live'))return;
  const now=new Date();const day=dayInTimezone(now,c.timezone);
  const slot=scheduleSlot(now,c.timezone,c.dailyTime);
  if(!slot||db.prepare('SELECT day FROM scheduled WHERE day=?').get(slot))return;
  db.prepare('INSERT INTO scheduled(day,at) VALUES(?,?)').run(slot,now.toISOString());
  try{startRun('live',day,'scheduled');}catch(e){log('live','schedule_error',e instanceof Error?e.message:'定时任务失败','error');}
 },30000);timer.unref();return timer;
}
