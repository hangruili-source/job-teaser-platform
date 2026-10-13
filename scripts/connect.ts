import { chromium } from 'playwright';
import { createInterface } from 'node:readline/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// Run on your own computer, where you can complete ESCP SSO and verification yourself.
const url=process.env.JOBTEASER_URL||'https://escp.jobteaser.com/en/job-offers';
const u=new URL(url);if(u.protocol!=='https:'||!(u.hostname==='jobteaser.com'||u.hostname.endsWith('.jobteaser.com')))throw new Error('Use a JobTeaser HTTPS URL.');
const browser=await chromium.launch({headless:false});const context=await browser.newContext();const page=await context.newPage();
try {
 await page.goto(url);
 const rl=createInterface({input:process.stdin,output:process.stdout});
 await rl.question('请在打开的浏览器中完成登录，确认已看到岗位列表，然后回到这里按回车。');rl.close();
 const state=await context.storageState();
 state.cookies=state.cookies.filter(c=>c.domain.replace(/^\./,'')==='jobteaser.com'||c.domain.endsWith('.jobteaser.com'));
 state.origins=state.origins.filter(o=>new URL(o.origin).hostname.endsWith('.jobteaser.com'));
 if(!state.cookies.length)throw new Error('未获得 JobTeaser 会话。');
 const directory=path.resolve('data');mkdirSync(directory,{recursive:true,mode:0o700});
 writeFileSync(path.join(directory,'jobteaser-session.json'),JSON.stringify(state),{mode:0o600});
 console.log('连接文件已保存到 data/jobteaser-session.json。请在 Daylight 设置页导入。此文件相当于登录凭证，勿发送到聊天或提交到 Git。');
}finally{await browser.close();}
