import { normalize } from './matching.js';
import { z } from 'zod';
export const languageNames:Record<string,string>={en:'English',fr:'Français',de:'Deutsch',nl:'Nederlands',es:'Español',it:'Italiano',zh:'中文'};
export function detectLanguage(text:string):string {
 if((text.match(/[\u4e00-\u9fff]/g)||[]).length>text.length*.15)return 'zh';
 const sets:Record<string,string[]>={en:['the','and','with','your','you','experience','skills','education'],fr:['le','la','les','des','une','nous','vous','avec','recherche','stage','expérience'],de:['und','der','die','das','wir','sie','mit','für','ein','praktikum','erfahrung'],nl:['het','een','van','voor','wij','jouw','ervaring'],es:['los','las','para','una','con','experiencia','buscamos'],it:['della','delle','per','con','esperienza','cerchiamo']};
 const words=normalize(text).match(/[\p{L}]+/gu)||[];
 return Object.entries(sets).map(([language,terms])=>({language,score:words.filter(w=>terms.includes(w)).length})).sort((a,b)=>b.score-a.score)[0]?.language||'en';
}
export function validateTranslation(sourceLines:string[],translated:unknown):string[] {
 const lines=z.array(z.string().max(8000)).parse(translated);
 if(lines.length!==sourceLines.length)throw new Error('翻译未保留原简历段落数量，已拒绝此版本。');
 for(let i=0;i<lines.length;i++) {
  if(sourceLines[i].trim()&&!lines[i].trim())throw new Error('翻译遗漏原文，已拒绝此版本。');
  const digits=(s:string)=>(s.match(/\d+/g)||[]).sort().join('|');
  if(digits(sourceLines[i])!==digits(lines[i]))throw new Error('翻译改变了原文数字或日期，已拒绝此版本。');
  for(const token of sourceLines[i].match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/\S+/gi)||[])if(!lines[i].includes(token))throw new Error('翻译改变了联系方式，已拒绝此版本。');
 }
 return lines;
}
