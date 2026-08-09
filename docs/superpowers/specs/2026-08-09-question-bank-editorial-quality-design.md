# 思政题库与章节内容编辑质量设计

日期：2026-08-09

## 背景

当前网站已经具备 Supabase 邮箱 OTP、会员校验、RLS、按课程懒加载、IndexedDB 按账号缓存、错题本、收藏、背诵和题目解析展示。现有质量报告覆盖 3332 道题，其中 3129 道选择题、203 道大题；题量和章节分布不均，约 2036 道题尚未可靠定位到教材章节。五门课程共有 55 章、165 个结构化知识点，平均每章约 3 个知识点。

本设计完成以下五项质量升级：

1. 章节归类、精确重复与语义近重复治理。
2. 选择题答案、解析、错误项辨析和记忆提示审校。
3. 大题标准答案、得分点、关键词和常见失分审校。
4. 五门课程 55 章的结构化知识点扩充。
5. 题目与知识点的结构化来源、核验状态和审计历史。

## 核心约束

- 不删除原始题目记录，不改写 `questions.payload` 中的原题、原答案和原解析。
- 修订内容通过独立覆盖层提供，原始内容始终可追溯。
- 重复题或错误题只改变发布状态，不物理删除。
- 自动规则只能生成候选结果，不能标记为人工核验。
- 没有教材或权威依据时必须标记为待人工核验，不伪造来源、页码或核验结论。
- 不把完整题库重新打包到静态部署产物。
- 保持现有会员鉴权、Cloudflare Pages 部署、懒加载和本地学习数据功能。
- 不新增面向用户的复杂后台管理系统。

## 方案选择

采用“原始题库 + 质量覆盖层 + 审计历史”的非破坏性方案。

直接改写 `questions.payload` 虽然实现简单，但会丢失原始证据，无法回答某条答案何时、依据什么被修订。只生成本地报告则无法由 RLS 阻止已确认的问题题目继续返回给会员。质量覆盖层兼顾可追溯性、服务端权限控制和题库缓存版本管理。

## 数据模型

### `question_quality`

每道题一条当前质量记录：

- `question_id uuid primary key references questions(id)`
- `publication_status text`：`published`、`hidden_duplicate`、`hidden_error`、`hidden_review`
- `review_status text`：`unreviewed`、`structural_checked`、`source_verified`、`needs_manual_review`
- `canonical_question_id uuid null`：重复题指向保留的主版本
- `chapter_confidence numeric null`：自动章节候选置信度
- `verification_status text`：沿用 `teacher-key-verified`、`textbook-law-verified`、`authoritative-source-verified`、`source-backed`、`pending`
- `source_kind text null`
- `source_title text null`
- `source_edition text null`
- `source_chapter text null`
- `source_page text null`
- `source_url text null`
- `verification_reference text null`
- `current_revision_id uuid null`
- `verified_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`

迁移时先为全部现有题目建立 `published + unreviewed` 记录，再切换题目读取策略，避免部署过程中整库不可见。

### `question_revisions`

保存经过审校的展示覆盖，不修改原题：

- `id uuid primary key`
- `question_id uuid references questions(id)`
- `revision_no integer`
- `display_question text null`
- `display_answer text null`
- `display_analysis text null`
- `question_type_override text null`
- `scoring_points jsonb`
- `keywords jsonb`
- `common_mistakes jsonb`
- `revision_note text`
- `verification_reference text`
- `created_at timestamptz`

空字段表示继续使用原始 `payload`。`question_quality.current_revision_id` 指向当前生效版本。

### `question_quality_events`

记录发布状态、章节归类、主版本关联、来源和当前修订的变化。该表仅供管理员脚本写入和读取，不提供给普通用户。

## RLS 与安全

- `questions`、`question_quality`、`question_revisions` 继续启用 RLS。
- 匿名用户不能读取任何题目或质量数据。
- 有效会员只能读取 `publication_status = 'published'` 的题目及其当前修订。
- 停用、过期或未开通会员不能读取题目、修订或 IndexedDB 缓存。
- 普通 `authenticated` 用户不能新增、修改或删除质量记录、修订和审计事件。
- 所有写入操作只允许本地管理员脚本使用 `SUPABASE_SERVICE_ROLE_KEY`。
- 浏览器代码和构建产物不得出现 `service_role` 密钥。

题目 RLS 使用服务端可判断的发布状态，不能只在前端过滤。已确认重复或错误的题目即使直接调用 Supabase REST API 也不能读取。

## 前端读取与缓存

会员打开课程时，题目查询同时读取当前质量记录和当前修订。前端在写入 IndexedDB 前按以下顺序合并：

1. 读取原始 `payload`。
2. 使用当前修订中的非空展示字段覆盖题干、答案、解析或题型。
3. 附加得分点、关键词、常见失分和核验状态。
4. 保持原始数据库题目 ID 和题目顺序，用于错题、收藏和学习进度兼容。

`question_bank_catalog` 只统计已发布题目。课程 `content_hash` 必须包含：

- 已发布题目的原始 payload；
- 章节归类元数据；
- 当前修订内容；
- 发布状态和当前修订 ID。

发布状态、章节归类或修订变化后，课程哈希变化，原 IndexedDB 缓存自动失效。

## 章节归类与重复治理

### 章节归类

- 继续使用课程专属关键词规则产生候选章节。
- 增加标题、人物、会议、事件、理论术语和教材小节的加权匹配。
- 同分、低分或跨章通用概念保持 `unclassified`。
- 自动结果写为 `candidate`，人工或有明确修订清单的结果才写为 `verified`。
- 报告分别统计 `verified`、`candidate`、`unclassified`，不把候选数伪装成人工完成数。

### 重复检测

分三层执行：

1. 规范化题干完全一致：忽略编号、空白、全半角和常见标点。
2. 题干与选项集合一致：允许选项顺序变化，但要求答案映射一致。
3. 语义近重复：同课程、同题型、同章节内按关键词集合和字符相似度聚类。

只有第一、第二层且答案一致的高置信度重复可以自动建议主版本。语义近重复只进入人工队列。确认后从题干完整、答案明确、解析充分、来源等级高的版本中选择主版本，其余记录标记 `hidden_duplicate` 并关联 `canonical_question_id`。

## 选择题编辑标准

每道已发布选择题必须满足：

- 明确标记单选题或多选题。
- 答案字母存在于选项中，多选答案去重并排序。
- 解析保留与题目直接相关的事实或理论依据。
- 说明正确项为什么符合题干。
- 对容易混淆的错误项说明错误所在；不机械重复所有明显无关选项。
- 提供与考点对应的记忆提示，不使用跨课程通用套话代替解析。
- 时间、会议、人物、法律和“根本、首要、核心、标志”等高风险题必须有可追溯核验依据。

自动脚本只补充结构性提示。涉及事实判断的新增句子必须来自教材、教师答案或权威公开文本，并记录核验依据。

## 大题编辑标准

全部 203 道现有大题建立独立修订记录，至少包含：

- 直接回答题目的完整标准答案，而不是只说明“从哪些方面回答”。
- 5 至 8 个可核对的得分点；答案较短时可以少于 5 个，但不得拆分同义句凑数。
- 必写关键词。
- 常见失分或概念混淆。
- 解析与答案分区：答案给规范表述，解析说明设问定位、组织顺序和材料对应关系。
- 教材版本、章节或其他权威依据。

得分点必须能在完整答案中找到对应句，校验脚本检查两者一致性。

## 章节知识点扩充

五门课程 55 章均提升到每章至少 8 个非重复结构化知识点。内容继续放在统一课程数据层，不散落到页面组件。

每章覆盖：

- 章节主线和核心问题；
- 教材小节对应的概念、事件或理论；
- 时间、人物、会议、事件经过或理论形成条件；
- 性质、原因、意义、作用、影响和经验；
- 易混概念或历史事件比较；
- 选择题陷阱；
- 大题标准表达或材料题角度；
- 关键词、重要等级和来源。

内容以自主归纳为主。短引文最多两句话，只有确认真实页码后才保留。不得用通用模板句跨章填充数量。

## 来源与核验规则

优先级如下：

1. 用户提供的五本对应版本教材 PDF。
2. 教育部、高等教育出版社、中央政府网站、新华网等权威公开文本。
3. 教师发布资料和带答案的高校公开真题。
4. 其他公开题库仅作为线索，不能单独支持“已核验”状态。

结构化来源至少记录来源类型、标题、版本、章节和核验状态。页码无法确认时留空，不写推测页码。网络内容记录直接页面 URL 和核验日期。

## 本地质量流水线

新增或扩展以下脚本：

- `audit-question-quality`：检查结构、答案、解析、来源和高风险表述。
- `classify-question-chapters`：生成章节候选和置信度报告。
- `detect-question-duplicates`：生成精确重复、选项重排重复和语义近重复分组。
- `sync-question-quality`：非破坏性写入质量记录、修订和审计事件。
- `verify:editorial-quality`：验证发布题目的质量门槛和原始 payload 不变。
- `verify:course-depth`：验证 55 章知识点数量、非重复性和来源字段。

默认命令只生成本地报告，不写 Supabase。写入数据库必须显式使用 `--apply`，并要求 `SUPABASE_SERVICE_ROLE_KEY`。

## 执行阶段

### 第一阶段：安全基础

- 创建 migration、RLS 和质量覆盖表。
- 修改导入、目录哈希和前端合并逻辑。
- 验证未登录、无效会员和直接 API 请求均不能读取题库。

### 第二阶段：全量审计

- 为 3332 道题建立质量记录。
- 生成章节候选、重复分组、结构问题和高风险事实报告。
- 只自动处理可证明的精确重复；其余进入人工队列。

### 第三阶段：题目编辑

- 按风险优先级审校选择题。
- 为全部 203 道大题建立标准答案与得分点覆盖。
- 修订内容写入覆盖层，原题 payload 哈希保持不变。

### 第四阶段：章节内容

- 按五本教材目录扩充 55 章知识点。
- 逐章校验来源、重复 ID、通用模板和页码。

### 第五阶段：部署

- 执行 migration。
- 运行质量数据同步。
- 重新生成目录哈希。
- 部署 Cloudflare Pages 前端。
- 完成有效会员、无效会员、缓存失效和生产安全验收。

## 验收标准

- 3332 道原始题目的 payload 哈希在迁移前后完全一致。
- 每道题都有一条 `question_quality` 记录。
- 所有确认重复题均有关联主版本；低置信度题不被自动隐藏。
- 已发布选择题通过题型、答案、选项、解析和来源校验。
- 203 道大题均有完整答案、得分点、关键词、解析和来源状态。
- 55 章每章至少 8 个非重复结构化知识点，并通过来源校验。
- 自动章节归类只显示为候选；无法可靠判断的题目继续显示为待人工核验。
- 已确认错误或重复题不能通过 Supabase API 读取。
- 原有刷题、答案解析、随机题、错题本、收藏、搜索和背诵功能正常。
- `npm run build` 和生产安全扫描通过，产物不含完整题库或 `service_role` 密钥。

## 回滚

- migration 不删除 `questions` 表数据。
- 前端可以暂时忽略质量覆盖层并恢复读取原始 payload。
- 发布状态和当前修订变化均有审计事件，可以由管理员脚本回退。
- 目录哈希在回退后重新计算，使客户端缓存获得一致版本。

## 明确不做

- 不建立面向普通用户的题库编辑后台。
- 不用随机网络题目批量填充数量。
- 不承诺自动化脚本可以替代教材或人工事实核验。
- 不把“待人工核验”改名包装成“已核验”。
- 不复制教材全文或整章原文。
