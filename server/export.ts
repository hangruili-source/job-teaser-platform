import ExcelJS from 'exceljs';
import { all, events, settings } from './store.js';
import { dayInTimezone } from './matching.js';
import type { Job, Mode, Resume, Run } from '../shared/types.js';
export const statusLabels={new:'待匹配',skipped:'已跳过',needs_resume:'待定制简历',ready:'待投递',needs_manual:'需要人工处理',submitted:'已投递',failed:'失败'};
export function spreadsheetText(value:unknown):string {const s=String(value??'');return /^[=+@\-\t\r]/.test(s)?"'"+s:s;}
export async function exportWorkbook(mode:Mode,day:string) {
 const workbook=new ExcelJS.Workbook();workbook.creator='Daylight';workbook.created=new Date();
 const config=settings();
 const jobs=all<Job>('job',mode).filter(j=>(dayInTimezone(new Date(j.publishedAt),config.timezone)===day||j.processingDay===day)).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
 const sheet=workbook.addWorksheet('岗位与投递');
 const columns=['数据模式','公司名称','岗位名称','地区','合同类型','发布日期','投递链接','匹配度 (%)','投递状态','处理说明','命中关键词','缺失关键词','简历版本','最后处理时间'];
 sheet.addRow(columns);
 for(const j of jobs)sheet.addRow([mode==='demo'?'演示（非真实投递）':'真实',j.company,j.title,j.location,j.contract,j.publishedAt,j.url,j.match?.score??'',statusLabels[j.status],j.reason,j.match?.matched.join(', '),j.match?.missing.join(', '),j.resumeId,j.updatedAt].map(spreadsheetText));
 const runIds=new Set(all<Run>('run',mode).filter(r=>r.day===day).map(r=>r.id));
 const audit=workbook.addWorksheet('当日日志');audit.addRow(['时间','级别','动作','岗位 ID','任务 ID','内容']);
 for(const e of events(mode).filter(e=>e.runId?runIds.has(e.runId):dayInTimezone(new Date(e.at),config.timezone)===day).reverse())audit.addRow([e.at,e.level,e.action,e.jobId,e.runId,e.message].map(spreadsheetText));
 const versions=workbook.addWorksheet('简历版本');versions.addRow(['版本 ID','名称','来源','对应岗位','创建时间','精选原文','完整原文']);
 const ids=new Set(jobs.map(j=>j.resumeId));
 for(const r of all<Resume>('resume',mode).filter(r=>ids.has(r.id)))versions.addRow([r.id,r.name,r.source,r.jobId,r.createdAt,r.highlights.join('\n'),r.text].map(spreadsheetText));
 for(const ws of workbook.worksheets){ws.views=[{state:'frozen',ySplit:1}];ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF145C48'}};ws.getRow(1).height=28;ws.columns.forEach((c,i)=>c.width=i===0?25:32);ws.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,ws.rowCount),column:ws.columnCount}};}
 return workbook.xlsx.writeBuffer();
}
