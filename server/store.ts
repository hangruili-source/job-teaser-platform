import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Event, Job, Mode, Resume, Run, Settings } from '../shared/types.js';
export const dataDir = path.resolve(process.env.DATA_DIR || 'data');
mkdirSync(dataDir,{recursive:true, mode:0o700});
chmodSync(dataDir,0o700);
export const db = new DatabaseSync(path.join(dataDir,'daylight.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, mode TEXT, body TEXT NOT NULL, PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT, runId TEXT, jobId TEXT, at TEXT, level TEXT, action TEXT, message TEXT);
CREATE TABLE IF NOT EXISTS dispatches (jobId TEXT PRIMARY KEY, state TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scheduled (day TEXT PRIMARY KEY, at TEXT NOT NULL);`);
export function all<T>(kind:string,mode:Mode):T[] { return (db.prepare('SELECT body FROM records WHERE kind=? AND mode=?').all(kind,mode) as {body:string}[]).map(r=>JSON.parse(r.body)); }
export function get<T>(kind:string,id:string):T|undefined { const r=db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id) as {body:string}|undefined; return r ? JSON.parse(r.body) : undefined; }
export function put<T extends {id:string,mode:Mode}>(kind:string,value:T):T { db.prepare('INSERT INTO records(kind,id,mode,body) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind,value.id,value.mode,JSON.stringify(value)); return value; }
export function log(mode:Mode, action:string, message:string, level:Event['level']='info',runId:string|null=null,jobId:string|null=null) { db.prepare('INSERT INTO events(mode,runId,jobId,at,level,action,message) VALUES(?,?,?,?,?,?,?)').run(mode,runId,jobId,new Date().toISOString(),level,action,message); }
export function events(mode:Mode):Event[] { return db.prepare('SELECT * FROM events WHERE mode=? ORDER BY id DESC').all(mode) as unknown as Event[]; }
const defaults:Settings={portalUrl:'https://escp.jobteaser.com/en/job-offers',roles:'',locations:'France, Germany, Luxembourg, United Kingdom, Belgium, Netherlands, Europe',contract:'Internship, Intern, Stage, Praktikum, 实习',timezone:'Europe/Paris',dailyTime:'09:00',scheduleEnabled:false,autoApply:false,model:'gpt-4.1-mini'};
export function settings():Settings { const r=db.prepare('SELECT body FROM settings WHERE id=?').get('main') as {body:string}|undefined; return {...defaults,...(r?JSON.parse(r.body):{})}; }
export function saveSettings(value:Settings) { db.prepare('INSERT INTO settings(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run('main',JSON.stringify(value)); }
export function currentResume(mode:Mode) { return all<Resume>('resume',mode).filter(r=>!r.parentId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]; }
export function newId() { return randomUUID(); }
export function updateJob(job:Job,patch:Partial<Job>) { return put('job',{...job,...patch,updatedAt:new Date().toISOString()}); }
export function activeRun(mode:Mode) { return all<Run>('run',mode).find(r=>r.status==='running'); }
// A crashed submission is deliberately not retried: the external site may have received it.
for(const mode of ['demo','live'] as Mode[]) {
 for(const r of all<Run>('run',mode).filter(r=>r.status==='running')) put('run',{...r,status:'failed',finishedAt:new Date().toISOString(),summary:'服务重启中断任务；请重新运行。状态不明的投递须人工核实。'});
 for(const row of db.prepare("SELECT jobId FROM dispatches WHERE state='pending'").all() as {jobId:string}[]) {
  const job=get<Job>('job',row.jobId); if(job && job.mode===mode) updateJob(job,{status:'needs_manual',reason:'上次提交被中断，结果未知。请先到网站核实，系统不会重复提交。'});
 }
}
