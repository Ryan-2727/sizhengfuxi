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
# Requires local SUPABASE_SERVICE_ROLE_KEY; reads only.
npm run verify:database
npm run build
node scripts/verify-production-build.js
```

## 题库与会员管理

完整题库源数据位于本地的 `data/question-bank-source/`，仅供审计和一次性导入脚本使用。该目录被 `.gitignore` 排除，不会被 Vite 复制到 `dist/`，也不会推送到公开仓库。

```powershell
# 不写入数据库，仅核对可导入的题目数量
node scripts/import-question-bank.js --dry-run

# 设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 后导入
npm run import:questions

# 仅同步“精选补充题/用户提供真题”的答案、解析或题型修正，不改动原题库行
npm run import:questions -- --sync-curated

# 首个会员，30 天有效
npm run member:add -- student@example.com 30
```

`member:add` limits the site to 300 active, unexpired members. At capacity it refuses the new activation before creating an Auth user and directs the administrator to check Supabase Usage.

完整的 Supabase、Cloudflare Pages、SMTP、RLS 与会员管理操作见 [SUPABASE_DEPLOYMENT.md](SUPABASE_DEPLOYMENT.md)。

## 维护说明

题库首页只从 `question_bank_catalog` 读取每门课程的题量和版本。会员进入某门课程或随机选择该课程时，浏览器才分页读取该课程的题目，并按 `user_id + course_id + content_hash` 写入 IndexedDB。每次打开网站仍会重新核验会员状态；未通过核验时不会读取缓存。退出登录会删除该账号的题库缓存。

题库内容更新后执行导入脚本。脚本会为每门课程计算稳定 SHA-256 内容哈希，并且只在内容实际变化时更新目录版本；旧版本缓存会自然失效。

已存在题目但尚未创建目录表记录的项目，可运行 `npm run import:questions -- --catalog-only`，该命令不会改写任何题目行。
