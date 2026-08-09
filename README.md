# 大学思政复习平台

基于 Supabase 邮箱 OTP 登录和会员权限的思政课程复习网站。Cloudflare Pages 只发布 Vite 生成的 `dist/`；完整题库仅通过 Supabase Row Level Security 向有效会员返回。

## 本地开发

```powershell
npm install
Copy-Item .env.example .env
# 在 .env 中填写 SUPABASE_URL 与 SUPABASE_ANON_KEY
npm run dev
```

## 质量检查

```powershell
npm run audit
npm run verify:security
npm run verify:lazy-cache
npm run verify:knowledge
npm run verify:navigation
npm run verify:campus
npm run verify:analysis
npm run verify:payloads
npm run verify:editorial-migration
npm run verify:editorial-quality
npm run verify:quality-sync
# Requires local SUPABASE_SERVICE_ROLE_KEY; reads only.
npm run verify:database
npm run build
node scripts/verify-production-build.js
```

## 题库与会员管理

完整题库源数据位于本地的 `data/question-bank-source/`，仅供审计和一次性导入脚本使用。该目录被 `.gitignore` 排除，不会被 Vite 复制到 `dist/`，也不会推送到公开仓库。

题库维护时运行 `npm run verify:coverage` 查看每门课距离 500 道选择题、50 道大题的缺口，同时检查每章至少 10 道选择题、2 道大题的基础覆盖和未可靠归类题量。新增题应优先投向薄弱章节，且只有题干、答案和解析可核验的题目才能用于补齐缺口。正式发布前可运行 `node scripts/verify-question-coverage.js --strict` 作为硬性门槛。

题目章节归类分为三种状态：`verified` 为人工核验，`candidate` 为确定性关键词规则的候选结果，`unclassified` 为暂不归入单一章节。候选结果只用于辅助筛选，不能替代编辑核验。运行迁移后，先生成报告；确认规则适用时才写入候选元数据：

```powershell
# 不写入数据库，只统计可归类题目
npm run questions:chapters

# 执行 supabase/migrations/202608080004_question_chapter_assignments.sql 后，
# 只将数据库中仍为 unclassified 的题目写为 candidate，并同步题库版本缓存
npm run questions:chapters -- --apply-candidates
```

```powershell
# 不写入数据库，仅核对可导入的题目数量
node scripts/import-question-bank.js --dry-run

# 设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 后导入
npm run import:questions

# 仅同步“精选补充题/用户提供真题”的展示修订，不改动 questions.payload
npm run import:questions -- --sync-curated

# 生成不写数据库的全量质量清单与审计报告
npm run questions:audit-quality

# 先只读预览；执行 202608090005 migration 后才显式应用
npm run questions:sync-quality
npm run questions:sync-quality -- --apply

# 首个会员，30 天有效
npm run member:add -- student@example.com 30
```

`member:add` limits the site to 300 active, unexpired members. At capacity it refuses the new activation before creating an Auth user and directs the administrator to check Supabase Usage.

完整的 Supabase、Cloudflare Pages、SMTP、RLS 与会员管理操作见 [SUPABASE_DEPLOYMENT.md](SUPABASE_DEPLOYMENT.md)。

## 维护说明

题库首页只从 `question_bank_catalog` 读取每门课程的题量和版本。会员进入某门课程或随机选择该课程时，浏览器才分页读取该课程的题目，并按 `user_id + course_id + content_hash` 写入 IndexedDB。每次打开网站仍会重新核验会员状态；未通过核验时不会读取缓存。退出登录会删除该账号的题库缓存。

题库内容更新后执行导入脚本。脚本会为每门课程计算稳定 SHA-256 内容哈希，并且只在内容实际变化时更新目录版本；旧版本缓存会自然失效。

原始 `questions.payload` 现在由数据库触发器保护，不允许直接更新。题目答案、解析、题型或展示题干的审校结果写入 `question_revisions`，当前发布状态、来源和修订指针写入 `question_quality`；确定的重复题只标记为隐藏并关联主版本，跨课程错放或源文残缺的题目进入 `hidden_review` 人工队列，均不删除原始记录。已有题库禁止使用 `--replace`，新增题使用 `--append-curated`，修正使用 `--sync-curated` 或 `questions:sync-quality -- --apply`。

`npm run questions:audit-quality` 会在被 Git 忽略的 `data/question-bank-source/` 中生成全量清单和摘要报告。自动章节归类只能写为 `candidate`；低置信度归类和语义近重复继续进入人工队列。高风险限定词但缺少教材、教师答案或权威来源的题目会标记为 `needs_manual_review`，不会冒充已核验。

章节归类元数据同样参与版本哈希。候选或已核验章节发生变化时，重新打开该课程会下载带有新章节标签的题目，不会误用旧缓存。

已存在题目但尚未创建目录表记录的项目，可运行 `npm run import:questions -- --catalog-only`，该命令不会改写任何题目行。

题目页会在浏览器渲染时补齐过短的答案解析：选择题保留原解析并补充正确选项定位和记忆提示，大题保留原解析并补充作答组织与检查提示。该处理不修改题干、答案、题型、题目顺序或 Supabase 题库数据；可运行 `npm run verify:analysis` 复核这一约束。左侧“题集”折叠导航的静态契约可通过 `npm run verify:navigation` 检查。

五门课程共 55 章，每章至少包含 8 个结构化知识点。章节综合卡基于本章已有教材小节、已核验页码范围和原知识点生成，并通过 `derivedFrom` 保留追溯关系；不会新增无法核实的教材引文或页码。

## 校园推广页

公开落地页为 `/campus`，访客无需登录即可查看产品说明，并可体验《中国近现代史纲要》第一章、20 道既有选择题和 3 道既有大题。免费体验数据单独保存在 `src/campus-preview.js`，不读取 Supabase 完整题库或会员 IndexedDB；完整题库仍只允许有效会员通过 RLS 读取。

推广链接支持以下来源参数，参数会在首次访问时保存到浏览器，并在站内跳转期间保留：

```text
https://sizhengfuxi.pages.dev/campus?from=qq
https://sizhengfuxi.pages.dev/campus?from=wechat
https://sizhengfuxi.pages.dev/campus?from=forum
https://sizhengfuxi.pages.dev/campus?from=wall
https://sizhengfuxi.pages.dev/campus?from=xhs
https://sizhengfuxi.pages.dev/campus?from=douyin
https://sizhengfuxi.pages.dev/campus?from=friend
```

当前没有为渠道统计新增数据库表，也不收集姓名、学号或手机号。Cloudflare Pages 中可在项目的 `Analytics & Logs` 中启用 Web Analytics，用于查看 `/campus` 的访问量、来源站点、设备和地区趋势；Cloudflare 可能不会把查询参数作为独立页面维度，因此 `from` 的精确分渠道汇总不作为当前 MVP 的可靠指标。分享按钮始终复制 `?from=friend`，不会继续传播访客原始来源。

反馈入口会打开仓库的 GitHub Issues 新建页面，并预填问题类型、反馈正文和当前页面。联系方式为选填，不需要额外后端配置。
