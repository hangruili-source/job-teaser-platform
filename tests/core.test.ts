import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decision, contains, dayInTimezone, matchResume, previousDay, scheduleSlot } from '../server/matching.js';
import { detectLanguage, validateTranslation } from '../server/languages.js';
import type { Job, Resume, Run } from '../shared/types.js';
process.env.DATA_DIR=mkdtempSync(path.join(os.tmpdir(),'daylight-test-'));
delete process.env.DAYLIGHT_OPENAI_KEY;delete process.env.OPENAI_API_KEY;
const { all, db, get, put, settings, saveSettings, events }=await import('../server/store.js');
const { relevant, selectResume, startRun, isRunning, dispatch }=await import('../server/workflow.js');
const { isPortalUrl, eligibleForAutomaticSubmit, parsePosted, storageSchema, extractJob, browserAvailable, browserExecutable }=await import('../server/connector.js');
const { saveOriginal, renderResume, extractResume, validateHighlights }=await import('../server/resumes.js');
const { exportWorkbook, spreadsheetText }=await import('../server/export.js');
const { default:ExcelJS }=await import('exceljs');
const today=dayInTimezone(new Date(),settings().timezone);
const makeJob=(id:string,description:string,extra:Partial<Job>={}):Job=>({id,mode:'live',title:'Business Analyst Intern',company:'Test Company',location:'Paris, France',contract:'Internship',url:'https://escp.jobteaser.com/en/job-offers/'+id,publishedAt:today+'T12:00:00Z',description,easyApply:true,status:'new',reason:'',match:null,resumeId:null,updatedAt:new Date().toISOString(),...extra});
test('40 and 70 percent boundaries follow the agreed rules',()=>{assert.equal(decision(39),'skip');assert.equal(decision(40),'tailor');assert.equal(decision(69),'tailor');assert.equal(decision(70),'original');});
test('matching uses distinct keyword evidence, case and language aliases; no substring inflation',()=>{
 const result=matchResume('EXCEL, SQL, financial modelling, English','Excel SQL financial modeling Python French English');
 assert.equal(result.score,67);assert.deepEqual(result.matched,['Excel','SQL','Financial modeling','English']);assert.deepEqual(result.missing,['Python','French']);
 assert.equal(contains('JavaScript and no other language','Java'),false);assert.equal(contains('I use C++.','C++'),true);
 assert.equal(matchResume('Datenanalyse, Projektmanagement','Data analysis and project management').score,100);
});
test('unknown vocabulary is distinguished from a low match',()=>{assert.equal(matchResume('Excellent background','A fantastic opportunity for your next career move').total,0);});
test('dates use the task timezone, including midnight and invalid dates',()=>{assert.equal(dayInTimezone(new Date('2026-10-13T23:30:00Z'),'Europe/Paris'),'2026-10-14');assert.equal(parsePosted('yesterday'),null);assert.equal(parsePosted('not-a-date'),null);assert.equal(parsePosted('2026-10-13'),'2026-10-13T00:00:00.000Z');});
test('hourly schedule respects start time, calendar rollover, and DST without dropping the previous day',()=>{assert.equal(previousDay('2026-03-01'),'2026-02-28');assert.equal(previousDay('2026-01-01'),'2025-12-31');assert.equal(scheduleSlot(new Date('2026-10-13T07:15:00Z'),'Europe/Paris','09:30'),null);assert.equal(scheduleSlot(new Date('2026-10-13T07:45:00Z'),'Europe/Paris','09:30'),'2026-10-13-0');assert.equal(scheduleSlot(new Date('2026-10-13T08:31:00Z'),'Europe/Paris','09:30'),'2026-10-13-1');assert.equal(parsePosted('2026-02-30'),null);});
test('only real JobTeaser HTTPS destinations are eligible',()=>{
 assert.ok(isPortalUrl('https://escp.jobteaser.com/en/job-offers'));for(const url of ['http://escp.jobteaser.com','https://jobteaser.com.evil.test','https://escp.jobteaser.com@evil.test','https://127.0.0.1'])assert.equal(isPortalUrl(url),false);
 const job=makeJob('guard','Excel');const form={action:'https://escp.jobteaser.com/applications',unknownRequired:false,submitCount:1};assert.ok(eligibleForAutomaticSubmit(job,form));assert.equal(eligibleForAutomaticSubmit({...job,mode:'demo'},form),false);assert.equal(eligibleForAutomaticSubmit(job,{...form,unknownRequired:true}),false);assert.equal(eligibleForAutomaticSubmit(job,{...form,action:'https://company.example/apply'}),false);assert.equal(eligibleForAutomaticSubmit(job,{...form,submitCount:2}),false);
});
test('session imports reject credentials scoped to unrelated sites',()=>{assert.equal(storageSchema.safeParse({cookies:[{name:'token',value:'secret',domain:'.example.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]}).success,false);});
test('Europe and internship filters accept city/country synonyms and reject full-time jobs',()=>{
 assert.ok(relevant(makeJob('a','JD',{location:'Berlin, DE'}),settings()));assert.ok(relevant(makeJob('b','JD',{location:'London, UK'}),settings()));assert.ok(relevant(makeJob('c','JD',{location:'Bruxelles, Belgique',contract:'Stage'}),settings()));assert.ok(!relevant(makeJob('d','JD',{location:'New York, USA'}),settings()));assert.ok(!relevant(makeJob('e','JD',{contract:'Full-time'}),settings()));
});
test('language detection and translation checks preserve numbers and contacts',()=>{
 assert.equal(detectLanguage('Nous recherchons une personne avec une expérience dans la gestion de projet pour notre stage.'),'fr');assert.equal(detectLanguage('Wir suchen für das Praktikum Erfahrung mit Datenanalyse und Kommunikation.'),'de');
 assert.deepEqual(validateTranslation(['Managed 3 projects in 2024'],['Gestion de 3 projets en 2024']),['Gestion de 3 projets en 2024']);assert.throws(()=>validateTranslation(['Managed 3 projects'],['Managed 30 projects']));assert.throws(()=>validateTranslation(['one','two'],['un']));assert.throws(()=>validateTranslation(['me@example.com'],['you@example.com']));
});
test('tailored highlights must be actual source excerpts',()=>{const source='Built financial models in Excel during an internship.';assert.deepEqual(validateHighlights(source,[source]),[source]);assert.throws(()=>validateHighlights(source,['Led 100 people and increased revenue by 30%.']));});
test('multi-resume matching chooses the strongest original, excludes tailored copies',()=>{
 const base={mode:'live' as const,createdAt:new Date().toISOString(),parentId:null,jobId:null,highlights:[],source:'original' as const};
 const resumes:Resume[]=[{...base,id:'finance',name:'Finance',text:'Excel valuation accounting English'},{...base,id:'tech',name:'Tech',text:'Python SQL JavaScript React English'},{...base,id:'fake',name:'Tailored',parentId:'finance',text:'Excel valuation accounting Python SQL JavaScript React English'}];
 const chosen=selectResume(makeJob('multi','Python SQL JavaScript React English'),resumes);assert.equal(chosen.best.resume.id,'tech');assert.equal(chosen.comparisons.length,2);
});
test('uploaded resumes exclude built-in examples from personal experiments',()=>{
 const base={mode:'demo' as const,createdAt:new Date().toISOString(),parentId:null,jobId:null,highlights:[],source:'original' as const};
 const sample:Resume={...base,id:'sample',name:'Sample',text:'Excel SQL Python English',sample:true};
 const personal:Resume={...base,id:'personal',name:'Uploaded PDF',text:'Excel English'};
 const job=makeJob('personal-experiment','Excel SQL Python English',{mode:'demo'});
 const selected=selectResume(job,[sample,personal]);assert.equal(selected.best.resume.id,'personal');assert.equal(selected.comparisons.length,1);assert.equal(selected.best.match.score,50);
 assert.equal(selectResume(job,[sample]).best.resume.id,'sample');
});
test('resume DOCX renders and parses actual text',async()=>{const resume=await saveOriginal('demo','Roundtrip','Alex Example\nEDUCATION\nMaster of Management.\nEXPERIENCE\nConducted market research and financial analysis using Excel.');const file=await renderResume(resume);const text=await extractResume(readFileSync(file),'resume.docx');assert.match(text,/market research/);assert.match(text,/Alex Example/);});
test('PDF resumes are parsed as text with the installed PDF.js version',async()=>{
 const content='BT /F1 12 Tf 40 700 Td (Alex Example - Excel SQL English market research and data analysis.) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 const result=await extractResume(Buffer.from(pdf),'sample.pdf');assert.match(result,/Alex Example/);assert.match(result,/Excel SQL/);
});
test('browser extracts actual JobPosting structured data and rejects missing dates',{skip:!browserAvailable()},async()=>{
 const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true,executablePath:browserExecutable()});
 try{const page=await browser.newPage();const data={'@context':'https://schema.org','@type':'JobPosting',title:'Analyst Intern',hiringOrganization:{name:'Fixture Company'},datePosted:'2026-10-13',jobLocation:{address:{addressLocality:'Paris',addressCountry:'FR'}},employmentType:'INTERN',description:'<p>Use Excel and SQL for data analysis. Strong English skills are required.</p>'};await page.setContent(`<main><h1>Analyst Intern</h1><button>Easy Apply</button></main><script type="application/ld+json">${JSON.stringify(data)}</script>`);const job=await extractJob(page,'https://escp.jobteaser.com/en/job-offers/example');assert.equal(job?.company,'Fixture Company');assert.equal(job?.easyApply,true);assert.equal(job?.publishedAt,'2026-10-13T00:00:00.000Z');assert.match(job?.description||'',/data analysis/);await page.setContent('<main><h1>Unknown date</h1></main>');assert.equal(await extractJob(page,'https://escp.jobteaser.com/en/job-offers/unknown'),null);}finally{await browser.close();}
});
test('daily workflow persists skip, tailor-blocked, ready, manual and no-keyword outcomes, and exports real XLSX',async()=>{
 const original=await saveOriginal('live','Analyst English','Alex Example\nEDUCATION\nMaster of Management.\nEXPERIENCE\nConducted data analysis using Excel and SQL in English.\nSKILLS\nExcel, SQL, English, data analysis.');
 const jobs=[makeJob('low','Python React JavaScript TypeScript French German Excel English'),makeJob('mid','Excel SQL English Python React JavaScript'),makeJob('high','Excel SQL English data analysis'),makeJob('external','Excel SQL English data analysis',{easyApply:false}),makeJob('unknown','A fantastic opportunity for your next career move')];
 jobs.forEach(j=>put('job',j));
 const run=startRun('live',today,'saved');assert.throws(()=>startRun('live',today,'saved'),/运行/);
 while(isRunning())await new Promise(r=>setTimeout(r,20));
 assert.equal(get<Run>('run',run.id)?.status,'complete');assert.equal(get<Job>('job','low')?.status,'skipped');assert.equal(get<Job>('job','mid')?.status,'needs_resume');assert.equal(get<Job>('job','high')?.status,'ready');assert.equal(get<Job>('job','external')?.status,'needs_manual');assert.equal(get<Job>('job','unknown')?.status,'needs_manual');assert.equal(get<Job>('job','high')?.resumeId,original.id);assert.ok(events('live').some(e=>e.action==='matched'));assert.ok(existsSync(path.join(process.env.DATA_DIR!,'reports',`live-${today}.xlsx`)));
 const xlsx=await exportWorkbook('live',today);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(xlsx as any);assert.equal(workbook.worksheets.length,3);assert.equal(workbook.getWorksheet('岗位与投递')?.rowCount,6);assert.ok((workbook.getWorksheet('当日日志')?.rowCount||0)>5);assert.ok((workbook.getWorksheet('简历版本')?.rowCount||0)>1);
});
test('ambiguous submissions cannot be automatically retried',async()=>{const job=get<Job>('job','high')!;db.prepare('INSERT INTO dispatches(jobId,state,at) VALUES(?,?,?)').run(job.id,'review',new Date().toISOString());const result=await dispatch(job);assert.equal(result.status,'needs_manual');assert.match(result.reason,/不会重复提交/);});
test('Excel export escapes formula payloads from untrusted company or job text',()=>{assert.equal(spreadsheetText('=HYPERLINK("https://bad.test")'),'\'=HYPERLINK("https://bad.test")');assert.equal(spreadsheetText('@SUM(1)'),"'@SUM(1)");assert.equal(spreadsheetText('Normal Company'),'Normal Company');});
test.after(()=>{db.close();rmSync(process.env.DATA_DIR!,{recursive:true,force:true});});
