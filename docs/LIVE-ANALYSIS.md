# 真实岗位与模型体验（不投递）

APPLICATIONS_ENABLED 默认关闭；接口和工作流均阻止真实投递。界面只允许准备和导出。

## Render 更新

在 Blueprint 页面同步最新版 daylight-demo，确认构建命令包含 `npx playwright install chromium`，环境变量 PLAYWRIGHT_BROWSERS_PATH 为 `/opt/render/project/src/.playwright`、APPLICATIONS_ENABLED 为 `false`。如同步没有触发部署，手动 Deploy latest commit。浏览器下载成功不代表运行库或真实网站连接已验证；以设置页验证结果为准。

在服务 Environment 添加 DAYLIGHT_OPENAI_KEY，值为你在 OpenAI API 平台创建的密钥。不要发到聊天、GitHub 或前端代码。API 额度与 ChatGPT 会员分开。保存并重新部署，在网站设置保存有权限使用的模型（默认 gpt-4.1-mini），点击“验证模型连接”。验证发送极短测试文本，会有少量 API 用量，不发送简历。

## JobTeaser 登录

在自己电脑安装 Node.js 24，下载 GitHub 的 daylight-demo 分支 ZIP 并解压。在项目文件夹打开终端，依次运行：

```
npm ci
npx playwright install chromium
npm run connect
```

在弹出的浏览器登录 ESCP，完成学校登录/验证码，看到岗位列表后回到终端按回车。将 data/jobteaser-session.json 上传到网站设置里的“导入登录连接文件”，再点击“验证连接”。该文件是登录凭证，不要发到聊天。云端若被要求重新验证或拒绝访问，停止自动采集，使用下述手动添加流程，不绕过验证。

## 验收

切换真实空间，重新上传两份 PDF（演示空间的简历不自动迁移）。先从 JobTeaser 复制一个真实实习岗位的公司、标题、地区、发布日期、网址和完整 JD，点击“添加一个真实岗位”，再“仅匹配已添加岗位”。选中的日期必须与岗位一致。40–69% 调用模型精选原文；语言不同则生成翻译待确认；70%以上且同语言沿用原简历，低于40%跳过，不会每个岗位都调用模型。

当前定制方式为提取与 JD 相关的真实原文放在简历前面，并按需要翻译，不是整份简历的自由改写。界面显示版本及命中关键词，可下载 DOCX 和 Excel。连接验证成功后尝试当日岗位检索，日志会报告页数和缺失信息，不能仅凭连接成功保证覆盖所有岗位。

Render 免费服务休眠时不运行定时任务，重新部署可能丢失文件。此阶段先手动运行并下载结果，持续每日监测需另行配置持久存储与持续运行服务。
