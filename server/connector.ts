import { chromium, type Browser, type Page } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { dataDir } from './store.js';
import type { Job, Settings } from '../shared/types.js';
export const sessionFile=path.join(dataDir,'jobteaser-session.json');
export function isPortalUrl(value:string) { try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && !u.port && (u.hostname==='jobteaser.com'||u.hostname.endsWith('.jobteaser.com')); } catch { return false; } }
export const storageSchema=z.object({cookies:z.array(z.object({name:z.string(),value:z.string(),domain:z.string().refine(d=>d.replace(/^\./,'')==='jobteaser.com'||d.replace(/^\./,'').endsWith('.jobteaser.com')),path:z.string(),expires:z.number(),httpOnly:z.boolean(),secure:z.boolean(),sameSite:z.enum(['Strict','Lax','None'])})).max(500),origins:z.array(z.object({origin:z.string().refine(isPortalUrl),localStorage:z.array(z.object({name:z.string(),value:z.string()}))})).max(50)});
export function browserExecutable(){return process.env.CHROMIUM_EXECUTABLE_PATH || (existsSync(chromium.executablePath())?chromium.executablePath():(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath()));}
export function browserAvailable(){ return existsSync(browserExecutable()); }
async function launch():Promise<Browser> {
 let proxy;
 const proxyUrl=process.env.HTTPS_PROXY||process.env.https_proxy;
 if(proxyUrl) { const u=new URL(proxyUrl); proxy={server:`${u.protocol}//${u.hostname}:${u.port}`,username:decodeURIComponent(u.username),password:decodeURIComponent(u.password)}; }
 return chromium.launch({headless:true,proxy,executablePath:browserExecutable()});
}
async function sessionPage() {
 if(!existsSync(sessionFile)) throw new Error('请先在设置中导入 JobTeaser 登录连接文件。');
 if(!browserAvailable()) throw new Error('尚未安装 Chromium，请运行 npx playwright install chromium。');
 const browser=await launch();
 try {
  const context=await browser.newContext({storageState:storageSchema.parse(JSON.parse(readFileSync(sessionFile,'utf8'))),acceptDownloads:false});
  await context.route('**/*',async route=>{
   const request=route.request(); const u=new URL(request.url());
   if(u.protocol!=='https:' || (request.isNavigationRequest() && !isPortalUrl(u.href))) return route.abort();
   // Only JobTeaser and static asset hosts; never follow application redirects to external sites.
   if(!(isPortalUrl(u.href)||/\.(cloudfront\.net|jsdelivr\.net|googleapis\.com|gstatic\.com)$/.test(u.hostname))) return route.abort();
   return route.continue();
  });
  const page=await context.newPage(); page.setDefaultTimeout(10000);
  return {browser,page};
 } catch(e) {await browser.close(); throw e;}
}
async function navigate(page:Page,url:string) {
 if(!isPortalUrl(url)) throw new Error('连接地址必须是 HTTPS JobTeaser 页面。');
 const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
 if(!response?.ok()) throw new Error(`JobTeaser 页面无法读取（HTTP ${response?.status()??'未知'}）。请检查网络权限或登录。`);
 await page.waitForTimeout(700);
 if(/sign_in|sign-in|login|sso|auth\/|connexion/i.test(page.url())) throw new Error('JobTeaser 登录已过期，请重新连接。');
 const title=await page.title();
 if(/captcha|access denied|verify you are human|just a moment/i.test(title)) throw new Error('网站要求人工验证；请在自己的浏览器完成验证后重新连接。');
}
export async function verifyConnection(url:string) {
 const {browser,page}=await sessionPage();
 try { await navigate(page,url); const count=await page.locator('a[href*="/job-offers/"]').count(); if(!count) throw new Error('未识别到岗位列表。请确认列表网址、登录状态，或完成网站的人机验证。'); return `已识别到 ${count} 个岗位链接；完整采集会在每日任务中逐页检查。`; }
 finally { await browser.close(); }
}
export function parsePosted(value:unknown):string|null {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
 const calendar=new Date(value.slice(0,10));if(Number.isNaN(calendar.valueOf())||calendar.toISOString().slice(0,10)!==value.slice(0,10))return null;
 const date=new Date(value); return Number.isNaN(date.valueOf())?null:date.toISOString();
}
export async function extractJob(page:Page,url:string):Promise<Omit<Job,'mode'|'status'|'reason'|'match'|'resumeId'|'updatedAt'>|null> {
 const rawValue=await page.evaluate(`(() => {
  const objects=[];
  const visit=(v)=>{if(!v||typeof v!=='object')return; if(v['@type']==='JobPosting'||(Array.isArray(v['@type'])&&v['@type'].includes('JobPosting')))objects.push(v); if(Array.isArray(v))v.forEach(visit); else if(v['@graph'])visit(v['@graph']);};
  for(const el of document.querySelectorAll('script[type="application/ld+json"]')) {try{visit(JSON.parse(el.textContent||''));}catch{}}
  const d=objects[0];
  const clean=(v)=>{const el=document.createElement('div');el.innerHTML=v;return el.textContent?.trim()||'';};
  const location=d?.jobLocation; const loc=Array.isArray(location)?location[0]:location;
  const address=loc?.address;
  const main=document.querySelector('main');
  const text=main?.textContent||'';
  return {title:d?.title||document.querySelector('h1')?.textContent?.trim()||'',company:d?.hiringOrganization?.name||'',location:address?[address.addressLocality,address.addressCountry].filter(Boolean).join(', '):'',contract:Array.isArray(d?.employmentType)?d.employmentType.join(', '):d?.employmentType||'',date:d?.datePosted||document.querySelector('time[datetime]')?.getAttribute('datetime'),description:d?.description?clean(d.description):text.trim(),easyApply:/(easy apply|easy application|candidature simplifiée|postuler en un clic)/i.test(text)};
 })()`);
 const parsed=z.object({title:z.string(),company:z.string(),location:z.string(),contract:z.string(),date:z.unknown(),description:z.string().max(100000),easyApply:z.boolean()}).safeParse(rawValue);
 if(!parsed.success)return null;
 const raw=parsed.data;
 const publishedAt=parsePosted(raw.date);
 if(!raw.title||!raw.company||!publishedAt||raw.description.length<40)return null;
 return {id:'live-'+createHash('sha256').update(url).digest('hex').slice(0,24),company:raw.company,title:raw.title,location:raw.location,contract:raw.contract,url,publishedAt,description:raw.description,easyApply:raw.easyApply};
}
export async function scanPortal(config:Settings,onProgress:(message:string)=>void) {
 const {browser,page}=await sessionPage();
 const jobs:Awaited<ReturnType<typeof extractJob>>[]=[]; const seenPages=new Set<string>();const seenJobs=new Set<string>();
 let next:string|null=config.portalUrl; let partial=false;
 try {
  // Exhaust the visible listing, then sort by date locally. Never trust relevance order.
  while(next && seenPages.size<40) {
   if(seenPages.has(next)) {partial=true;break;}
   seenPages.add(next); await navigate(page,next);
   let previous=0,stable=0;
   for(let i=0;i<20 && stable<3;i++) { const count=await page.locator('a[href*="/job-offers/"]').count(); stable=count===previous?stable+1:0;previous=count;await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(450); }
   if(stable<3) partial=true;
   const links=await page.locator('a[href*="/job-offers/"]').evaluateAll(nodes=>nodes.map(n=>(n as HTMLAnchorElement).href));
   const unique=[...new Set(links)].filter(u=>isPortalUrl(u)&&/\/job-offers\/[^/?#]+/.test(new URL(u).pathname));
   if(!unique.length) throw new Error('未找到可识别的岗位链接，无法确认今天没有岗位；请检查登录或页面结构。');
   const nextLink=page.locator('a[rel="next"], a[aria-label="Next"], a[aria-label="Next page"], a[aria-label="Page suivante"], a[aria-label="Suivant"]').first();
   const href=await nextLink.count()?await nextLink.getAttribute('href'):null;
   const disabled=await nextLink.count()?await nextLink.getAttribute('aria-disabled'):null;
   next=href&&disabled!=='true'?new URL(href,page.url()).href:null;
   if(next&&!isPortalUrl(next)){partial=true;next=null;}
   const unhandled=await page.locator('button').filter({hasText:/^(load more|show more|next|suivant|voir plus|afficher plus)$/i}).count();
   if(unhandled&&!next)partial=true;
   for(const link of unique) {
    const u=new URL(link);u.hash='';u.search='';const url=u.href;
    if(seenJobs.has(url))continue;seenJobs.add(url);
    try { await navigate(page,url); const job=await extractJob(page,url); if(job)jobs.push(job);else {partial=true;onProgress(`无法可靠读取公司、发布日期或 JD，未参与自动投递：${url}`);} }
    catch(e){partial=true;onProgress(`岗位读取失败：${url}。${e instanceof Error?e.message:'请人工检查'}`);}
   }
   onProgress(`已检查 ${seenPages.size} 个列表页、${seenJobs.size} 个岗位链接。`);
  }
  if(next)partial=true;
  return {jobs:jobs.filter((j):j is NonNullable<typeof j>=>!!j).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)),partial,pages:seenPages.size};
 } finally {await browser.close();}
}
export function eligibleForAutomaticSubmit(job:Pick<Job,'mode'|'url'|'easyApply'>,form:{action:string;unknownRequired:boolean;submitCount:number}) {
 return job.mode==='live' && job.easyApply && isPortalUrl(job.url) && isPortalUrl(form.action) && new URL(job.url).origin===new URL(form.action).origin && !form.unknownRequired && form.submitCount===1;
}
export async function applyEasy(job:Job,resumePath:string):Promise<{submitted:boolean;reason:string}> {
 const {browser,page}=await sessionPage();
 try {
  await navigate(page,job.url);
  const entry=page.getByRole('button',{name:/^(easy apply|easy application|postuler en un clic|candidature simplifiée)$/i});
  if(await entry.count()!==1)return {submitted:false,reason:'未能唯一识别站内 Easy Application 入口，请人工投递。'};
  if(await entry.evaluate(el=>(el as HTMLButtonElement).type==='submit'&&!!el.closest('form')))return {submitted:false,reason:'入口可能直接提交已有资料，无法确认使用的简历，请人工处理。'};
  await entry.click();await page.waitForTimeout(700);
  if(!isPortalUrl(page.url())||new URL(page.url()).origin!==new URL(job.url).origin)return {submitted:false,reason:'申请跳转到了站外，请人工处理。'};
  if(await page.locator('iframe[src*="captcha"], [class*="captcha"], [id*="captcha"]').count())return {submitted:false,reason:'遇到验证码，需要人工处理。'};
  const forms=page.locator('form').filter({has:page.locator('input[type="file"]')});
  if(await forms.count()!==1)return {submitted:false,reason:'申请表结构无法确认，需要人工处理。'};
  const form=forms.first();const file=form.locator('input[type="file"]');
  if(await file.count()!==1)return {submitted:false,reason:'申请需要额外附件，请人工处理。'};
  const accept=await file.getAttribute('accept');const ext=path.extname(resumePath);
  if(accept&&!(accept.includes(ext)||accept.includes(ext==='.pdf'?'application/pdf':'officedocument')||accept==='*/*'))return {submitted:false,reason:'网站不接受当前简历格式，请人工转换并投递。'};
  await file.setInputFiles(resumePath);
  const rawAction=await form.getAttribute('action');
  const action=new URL(rawAction||page.url(),page.url()).href;
  // Never answer screening questions or accept unchecked agreements on the user's behalf.
  const unknownRequired=await form.evaluate(el=>Array.from(el.querySelectorAll('input,select,textarea')).some(n=>{
   const e=n as HTMLInputElement;if(e.disabled||e.type==='hidden'||e.type==='file'||e.type==='submit')return false;
   if((e.type==='checkbox'||e.type==='radio')&&!e.checked)return true;
   return e.required&&!e.value.trim();
  }));
  const submit=form.getByRole('button',{name:/^(submit application|send application|apply|envoyer ma candidature|envoyer la candidature|postuler)$/i});
  if(!eligibleForAutomaticSubmit(job,{action,unknownRequired,submitCount:await submit.count()}))return {submitted:false,reason:'申请表有待回答的问题、协议或无法确认的提交按钮，需要人工处理。'};
  const receipt=page.getByText(/application (has been |was )?(successfully )?(sent|submitted)|candidature (a bien été |a été )?(envoyée|transmise)/i).first();
  if(await receipt.isVisible())return {submitted:false,reason:'页面已经存在投递回执，请先核实历史申请；本次未重复提交。'};
  await submit.click();
  try { await receipt.waitFor({timeout:12000});return {submitted:true,reason:'JobTeaser 页面已显示申请提交成功。'}; }
  catch{return {submitted:false,reason:'已尝试提交，但未识别到成功回执。请到网站核实，系统不会重复提交。'};}
 } finally {await browser.close();}
}
