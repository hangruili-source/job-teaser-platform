import type { Match } from '../shared/types.js';
const families: Record<string, string[]> = {
 'Excel': ['excel', 'spreadsheet', 'spreadsheets'], 'SQL': ['sql', 'postgresql', 'mysql'],
 'Python': ['python'], 'Power BI': ['power bi', 'powerbi'], 'Tableau': ['tableau'],
 'Financial modeling': ['financial modeling', 'financial modelling', 'financial models'],
 'Valuation': ['valuation', 'valuations'], 'Accounting': ['accounting'],
 'Data analysis': ['data analysis', 'data analytics', 'analyse de données', 'analyse des données', 'datenanalyse', '数据分析'],
 'Market research': ['market research', 'market analysis', 'étude de marché', 'études de marché', 'marktforschung'],
 'Project management': ['project management', 'gestion de projet', 'projektmanagement', '项目管理'],
 'Communication': ['communication', 'communicate', 'communications', 'kommunikation'],
 'English': ['english', 'anglais', '英语'], 'French': ['french', 'français', '法语'],
 'German': ['german', 'deutsch', 'allemand', '德语'],
 'Strategy': ['strategy', 'strategic', 'stratégie', 'strategie'], 'Consulting': ['consulting', 'consultancy', 'conseil', 'beratung'],
 'Marketing': ['marketing'], 'SEO': ['seo', 'search engine optimization'],
 'Sales': ['sales', 'vente'], 'CRM': ['crm', 'salesforce', 'hubspot'],
 'Leadership': ['leadership', 'team leadership'], 'Stakeholder management': ['stakeholder management', 'stakeholders'],
 'Financial analysis': ['financial analysis', 'financial analytics', 'analyse financière', 'finanzanalyse'],
 'Investment banking': ['investment banking'], 'Due diligence': ['due diligence'],
 'React': ['react', 'reactjs'], 'JavaScript': ['javascript', 'js'], 'TypeScript': ['typescript'],
 'Java': ['java'], 'C++': ['c++'], 'Figma': ['figma'], 'Product management': ['product management'],
 'Machine learning': ['machine learning', '机器学习'], 'Statistics': ['statistics', 'statistical'],
 'Supply chain': ['supply chain'], 'Operations': ['operations', 'operational'],
 'Risk management': ['risk management'], 'Sustainability': ['sustainability', 'esg'],
 'Presentation': ['presentation', 'presentations', 'powerpoint'], 'Teamwork': ['teamwork', 'team player', 'collaboration'],
};
const stop = new Set(('the and for with that this you your our are will have from into who work working role team company join about more can has all not any position internship intern opportunity responsibilities requirements skills experience candidate ideal ability strong excellent including business knowledge looking support within across new plus must required degree master bachelor job learn development apply their they years year minimum university student fluent proficiency related such using well responsibilities required preferred qualification qualifications des les une pour dans avec est vous nous sur par aux du de et un en la le à a au ce ces son ses ou d l').split(' '));
export function normalize(s: string) { return s.normalize('NFKC').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim(); }
export function contains(text: string, term: string) {
 const esc = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'u').test(normalize(text));
}
export function matchResume(resume: string, jd: string): Match {
 const known = Object.entries(families).filter(([, words]) => words.some(w => contains(jd, w)));
 const terms: [string, string[]][] = [...known];
 // Include repeated domain terms when the curated vocabulary alone cannot describe a JD.
 if (terms.length < 5) {
  const counts = new Map<string, number>();
  for (const word of normalize(jd).match(/[\p{L}][\p{L}\d+#.-]{2,}/gu) ?? []) {
   if (!stop.has(word) && !known.some(([, words]) => words.some(w => contains(w, word)))) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  for (const [word] of [...counts].filter(([,n]) => n >= 2).sort((a,b) => b[1]-a[1]).slice(0,12-terms.length)) terms.push([word,[word]]);
 }
 const matched = terms.filter(([,ws]) => ws.some(w => contains(resume,w))).map(([name])=>name);
 const missing = terms.filter(([name])=>!matched.includes(name)).map(([name])=>name);
 return { score: terms.length ? Math.round(matched.length / terms.length * 100) : 0, matched, missing, total: terms.length };
}
export function decision(score: number) { return score < 40 ? 'skip' : score < 70 ? 'tailor' : 'original'; }
export function dayInTimezone(date: Date, timezone: string) { return new Intl.DateTimeFormat('en-CA', {timeZone: timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
export function scheduleTime(date: Date, timezone: string) { return new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date); }

export function previousDay(day:string){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10);}
export function scheduleSlot(now:Date,timezone:string,startTime:string):string|null{const current=scheduleTime(now,timezone);const minutes=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3));const elapsed=minutes(current)-minutes(startTime);return elapsed<0?null:dayInTimezone(now,timezone)+'-'+Math.floor(elapsed/60);}
