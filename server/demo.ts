import { all, currentResume, newId, put } from './store.js';
import { dayInTimezone } from './matching.js';
import type { Job, Resume } from '../shared/types.js';
export function seedDemo(timezone:string) {
 const day=dayInTimezone(new Date(),timezone);
 for(const r of all<Resume>('resume','demo')) if(!r.parentId&&!r.sample&&['Alex Chen · 示例简历','Alex Chen · 金融方向示例'].includes(r.name)&&r.text.startsWith('Alex Chen')) put('resume',{...r,sample:true});
 if(!currentResume('demo')) put<Resume>('resume',{id:newId(),mode:'demo',name:'Alex Chen · 示例简历',text:'Alex Chen\nESCP Business School · Master in Management\n\nEDUCATION\nMaster in Management, ESCP Business School. Coursework in strategy and financial analysis.\n\nEXPERIENCE\nBusiness Analyst Intern — Sample Consulting\nConducted market research and data analysis using Excel and SQL. Prepared presentations with findings for project teams. Supported consulting projects through stakeholder management and communication.\n\nSKILLS\nExcel, SQL, data analysis, market research, strategy, consulting, financial analysis, presentation, communication, teamwork.\n\nLANGUAGES\nEnglish (fluent), French (working proficiency).',createdAt:new Date().toISOString(),parentId:null,jobId:null,highlights:[],source:'original',sample:true});
 if(!all<Resume>('resume','demo').some(r=>r.name==='Alex Chen · 金融方向示例')) put<Resume>('resume',{id:newId(),mode:'demo',name:'Alex Chen · 金融方向示例',text:'Alex Chen\nESCP Business School — Master in Management\n\nEDUCATION\nMaster in Management with coursework in accounting, valuation and financial analysis.\n\nEXPERIENCE\nFinance Intern — Sample Finance Group\nUsed Excel to support financial analysis and prepared valuation summaries for the team.\n\nSKILLS\nExcel, valuation, accounting, financial analysis.\n\nLANGUAGES\nEnglish (fluent).',createdAt:new Date().toISOString(),parentId:null,jobId:null,highlights:[],source:'original',sample:true,language:'en'});
 const templates=[
  ['Atelier Strategy','Junior Strategy Analyst','Paris, France','实习',true,'Support strategy and consulting projects through market research, data analysis, Excel, presentation, English and teamwork.'],
  ['Northstar Capital','Investment Analyst Intern','London, UK','实习',true,'Financial analysis, Excel, communication and English are essential. You will perform financial modeling, valuation, accounting, investment banking and due diligence.'],
  ['Maison Horizon','Marketing & Insights Intern','Paris, France','实习',false,'Use market research, data analysis, Excel and communication. Work in English and French. Marketing, SEO and CRM experience are preferred.'],
  ['Orbit Labs','Machine Learning Engineer','Berlin, Germany','实习',true,'Python, machine learning, statistics, Java, C++, German, SQL, English, React and TypeScript are essential.'],
  ['Terra Partners','Business Operations Associate','Amsterdam, Netherlands','实习',true,'We value communication, teamwork, Excel, strategy, English, data analysis and stakeholder management. Operations and project management are a plus.'],
  ['Studio Lumen','Product Analyst Intern','Remote, Europe','实习',false,'Data analysis, SQL, Excel, presentation, English, communication, product management and statistics are required.'],
 ] as const;
 for(const [i,t] of templates.entries()) {
  const id=`demo-${day}-${i}`; if(all<Job>('job','demo').some(j=>j.id===id)) continue;
  put<Job>('job',{id,mode:'demo',company:t[0],title:t[1],location:t[2],contract:t[3],easyApply:t[4],description:t[5]+'\n\nThis is a fictional demonstration vacancy, not a live job advertisement.',url:`https://example.com/demo/${i}`,publishedAt:`${day}T08:${String(50-i*8).padStart(2,'0')}:00+02:00`,status:'new',reason:'示例岗位，尚未执行匹配',match:null,resumeId:null,updatedAt:new Date().toISOString()});
 }
}
