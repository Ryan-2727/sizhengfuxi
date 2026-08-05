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

# 首个会员，30 天有效
npm run member:add -- student@example.com 30
```

完整的 Supabase、Cloudflare Pages、SMTP、RLS 与会员管理操作见 [SUPABASE_DEPLOYMENT.md](SUPABASE_DEPLOYMENT.md)。
