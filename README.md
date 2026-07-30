# 大学思政课程复习网页

这是一个用于大学思想政治理论课程期末复习的静态网页，按课程、章节和题型组织复习内容，支持直接通过 GitHub Pages 访问。

## 在线访问

[https://ryan-2727.github.io/sizhengfuxi/](https://ryan-2727.github.io/sizhengfuxi/)

## 包含课程

- 中国近现代史纲要
- 思想道德与法治
- 毛泽东思想和中国特色社会主义理论体系概论
- 习近平新时代中国特色社会主义思想概论
- 马克思主义基本原理

## 主要功能

- 首页提供 5 门课程入口。
- 每门课使用不同主题色区分。
- 课程页左侧提供章节导航。
- 每章包含关键词、重点内容、思维导图和考试提醒。
- 每门课包含选择题题库和大题题库。
- 选择题支持单选、多选、提交判分，并在按钮操作后显示答案解析。
- 支持错题本、收藏、大题逐段背诵和掌握状态，本地进度保存在浏览器中。
- 随机抽题前可选择课程，并可连续切换下一道随机题。
- 题库按“正式题库 / 待核验题库”分层，程序生成变式、错分课程、过时表述和结构异常题不会进入默认题集。
- 题目显示来源核验状态：教师答案表、教材/现行法律、权威公开文本或来源可追溯。
- 支持全局搜索、题型筛选和随机抽题。

## 文件结构

```text
.
├── index.html
├── styles.css
├── app.js
├── history-local-question-bank.js
├── morality-local-question-bank.js
├── mao-xi-local-question-bank.js
├── marx-local-question-bank.js
├── verified-question-overrides.js
├── question-audit-report.json
├── scripts/
│   └── audit-question-bank.js
├── docs/
│   └── question-bank-quality-review-2026-07-30.md
├── assets/
│   ├── alipay.jpg
│   └── wechat.jpg
└── README.md
```

## 本地预览

直接用浏览器打开 `index.html` 即可预览。这个项目不依赖后端服务，也不需要安装依赖。

运行题库结构审计：

```powershell
node scripts\audit-question-bank.js --write
```

审计结果写入 `question-audit-report.json`。报告区分四类核验状态，检查选项、答案、题型、解析长度、题干拼接、来源和核对依据，并列出被排除记录。详细复查记录见 [docs/question-bank-quality-review-2026-07-30.md](docs/question-bank-quality-review-2026-07-30.md)。

GitHub Actions 会在每次推送和拉取请求时运行语法检查与题库审计。

## 部署说明

当前项目通过 GitHub Pages 发布：

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/root`

修改网页后，提交并推送到 `main` 分支，GitHub Pages 会自动重新构建。

## 说明

本项目用于课程复习辅助。不同学校、不同教师的考试范围可能不同，复习时应结合任课教师要求、最新版教材和课堂资料进行核对。
