# 学生事务智能助手

## 对话数据库只读诊断

`DB_PROVIDER=supabase` 时，服务端必须配置 `SUPABASE_URL` 和 `SUPABASE_SECRET_KEY`（或旧版 `SUPABASE_SERVICE_ROLE_KEY`）。缺少密钥会返回稳定的 `DATABASE_CONFIG_MISSING`（HTTP 503），服务端日志只列缺失变量名；不会自动切换 SQLite，也不会生成示例对话。配置完成后运行 `node scripts/check-conversations-schema.mjs`，以真实 GET 只读核对 `public` REST 暴露、对话及依赖表字段；脚本不执行迁移、不写入数据。若返回 `PGRST205`，先确认项目 URL，再在该项目 SQL Editor 运行只读的 `supabase/diagnose_public.sql`：物理表不存在时按迁移顺序补齐，物理表存在时检查 PostgREST schema cache，不要重复初始化。正式数据和演示 seed 分开处理；`seed.sql` 只适用于已确认的空白演示库。迁移后再次运行真实 GET 诊断，并用 `node scripts/check-business-apis.mjs` 验证本地学生登录后的四个业务 API；两项都成功才算数据库可用。

## 当前身份登录（未接入校园认证）

`AUTH_MODE=passcode`（或在保留旧配置时留空）且设置服务端 `TEACHER_PASSCODE` 与长度至少 32 字符的 `SESSION_SECRET` 后，`/login` 提供账号与口令表单。评估账号 `student-a` 和 `student-b` 留空口令进入各自学生工作区；老师可填任意账号及 `TEACHER_PASSCODE` 进入老师工作台。`AUTH_MODE=mock` 且未配置 `TEACHER_PASSCODE` 时，登录页改为固定的学生 A、学生 B、老师选择框；此入口默认仅限本地，远程受控评估还需 `MOCK_AUTH_ALLOW_REMOTE=true`。两种模式均明确标注“模拟接入，仅用于评估”；未启用的模式不会自动回退。账号仅选择固定测试身份，不能提交任意用户 ID 或自行声明角色。服务端验证口令后才签发老师会话，错误口令不会退回学生身份。校园认证端点尚未接入，不要输入校园账号、密码或验证码。登录使用有效期 8 小时的签名 httpOnly Cookie；退出和切换身份会清理前端当前对话并整页重载。固定评估账号没有学生密码，只适用于本地或受控评估环境，不适合公开部署。

个人数据接口从服务端会话取得归属 ID，忽略请求中的旧 `device_id` 参数。A、B 和老师各有固定内部 UUID；旧浏览器匿名设备数据仍保留在原 ID 下，不会自动归属任何人。老师接口要求当前会话为老师，学生收到 403，未登录收到 401。旧 `AUTH_MODE=legacy_teacher` 路由仅为兼容保留；当前登录入口使用 `/api/auth/login`。

统一内部身份见 `lib/auth-core.ts` 的 `CurrentUser`，服务端读取与老师校验见 `lib/auth.ts`。以后接入真实校园认证时，只替换身份适配与会话签发/验证层，映射到同一 `CurrentUser`；具体参数以正式文档为准。当前接口不是学校官方接口，未采集校园账号、密码、验证码或 Cookie，也没有访问校园认证端点。

`supabase/seed.sql` 与本地 SQLite 自动初始化的条目、联系人均为虚构演示数据，不是学校正式规定。共享部署使用 Supabase；只有显式设置 `DB_PROVIDER=sqlite` 才运行本地演示模式。

## 先用本机 SQLite 演示（无需 Supabase）

项目在 Node.js 26 下可用内置 SQLite。将 `.env.example` 复制为 `.env.local`，设置 `DB_PROVIDER=sqlite`、`AUTH_MODE=passcode`、`LLM_PROVIDER=deepseek`、`LLM_MODEL=deepseek-flash`，填写 `TEACHER_PASSCODE`、长 `SESSION_SECRET` 和自己的 `LLM_API_KEY`。首次访问 API 会自动建立 `data/demo.sqlite`，执行 `local/schema.sql`，并导入 `supabase/seed.sql` 中的虚构类别、联系人和 15 条知识。数据库文件保留已有问答、工单、老师回复和日程；旧匿名问答仍保留在原设备 ID 下，不自动认领。不要把演示规则当作真实学校规定。

SQLite 模式下 `SUPABASE_URL`、`SUPABASE_SECRET_KEY` 可留空。运行 `npm install`、`npm run dev`，打开 http://localhost:3000 。没有模型 API Key 时页面可以启动，但问答、草稿生成和通知提取会返回服务不可用。

本地 SQLite 模式供单机演示使用。将来改用 Supabase 时，把 `DB_PROVIDER` 设为 `supabase`，按下一节建表并配置两个 Supabase 变量；本地 SQLite 数据不会自动迁移到 Supabase。

## 改用 Supabase 时建表与导入数据

新 Supabase 项目在 SQL Editor 依次执行 `supabase/schema.sql`、`supabase/migration_phase2.sql`、`supabase/migration_phase3.sql`、`supabase/migration_chat_history.sql`、`supabase/migration_conversations.sql`、`supabase/migration_knowledge_library.sql`、`supabase/migration_knowledge_publish_version.sql`、`supabase/migration_information_sources.sql`、`supabase/migration_future_knowledge_effective.sql`、`supabase/migration_source_article_atomic.sql`。已有数据库只运行缺失迁移，再执行最后两个新增迁移；均为可重复执行的增量脚本，不清表。`migration_future_knowledge_effective.sql` 会把旧发布函数误停用、但替换知识尚未生效的原条目恢复为 confirmed；请先核对目标知识记录。`migration_source_article_atomic.sql` 安装文章版本的事务 RPC，应用更新前必须部署，否则信息源抓取会报错而不会回退到非事务写入。**正式环境不要执行 `supabase/seed.sql`**；仅空白演示环境可手动导入。旧的 confirmed 知识保留，审核时间回填为旧更新时间，审核人保持空白，不能将其解释为某位老师审核。服务端使用 Secret key（或旧版 service_role key），所有老师写接口仍校验老师 cookie；迁移只撤销 anon/authenticated 对本应用业务表和函数的直接权限，并开启相应 RLS，不触碰 `public` 下其他应用对象。

### SQLite → Supabase

先在目标项目执行上述 SQL 迁移，再在 PowerShell 设置 `SUPABASE_URL` 与 `SUPABASE_SECRET_KEY` 环境变量（旧版 `SUPABASE_SERVICE_ROLE_KEY` 也可用）。运行 `node scripts/sqlite-to-supabase.mjs --sqlite=E:\\path\\to\\demo.sqlite` 预览源表数量、目标已存在数量与待导入数量；不设置目标配置也能离线预览源数量。核对后附加 `--apply` 才写入。脚本只读打开 SQLite，按依赖顺序导入、保留原 UUID，冲突时跳过目标已有 ID 而不覆盖，并逐表核对所有源 ID 的存在数量。重复执行不会产生重复行。目标有同 ID 但内容不同的记录会保留目标内容，请人工审查这类冲突；不迁移登录限流表。迁移正式数据前备份两端数据库。2026-10-15，项目 `ujbflooavhhbtdezrteo` 的八个结构脚本已由项目维护者在 SQL Editor 执行；随后 12 张业务表真实 GET 及学生登录后的四个业务 API 均返回 200。各业务列表目前为 0 条；尚未导入 SQLite 数据或执行演示 seed。

## 配置和启动

复制 `.env.example` 为 `.env.local`。使用 Supabase 时填入 Project URL（形如 `https://<project-ref>.supabase.co`）和 Secret key（`sb_secret_...`）；当前服务端连接不使用 Publishable key 或 JWKS URL。DeepSeek 使用 Chat Completions 的 JSON 模式；如使用 Anthropic，改为 `LLM_PROVIDER=anthropic` 并填写对应模型名和密钥。设置 `ALLOWED_FETCH_DOMAINS`，例如 `school.edu.cn,notice.school.edu.cn`。`SESSION_SECRET` 用于签名会话，`TEACHER_PASSCODE` 用于老师身份验证。所有变量仅供服务端读取，不添加 `NEXT_PUBLIC_` 前缀。

运行 `npm install`、`npm run dev`，打开 http://localhost:3000 。

## 本地验证

运行 `npm run typecheck` 和相关测试。选择学生A在首页提问并提交工单，切换老师身份在 `/teacher` 回复并沉淀知识，再切回学生A查看工单；切换学生B应看不到A的个人记录。`/my` 每 5 秒更新当前身份的工单状态。确认入库重复提交返回 409。未登录访问老师页面会跳转登录，老师接口返回 401，学生访问返回 403。

老师登录后可在 `/teacher/knowledge` 新建和编辑草稿、审核发布、停用已发布条目、创建替换草稿并查看旧版本。草稿和旧版本不会进入公共问答；审核发布后下一次提问实时读取。出处名称、链接、原文依据、类别、别名和适用时间随条目保存。历史未具名审核人与旧兼容口令操作不伪造具体姓名；模拟老师仅为评估身份。

工单提交限制为同一内部用户 ID 滚动一分钟最多 3 张、UTC 自然日最多 20 张。该限制使用数据库计数，适合演示，不保证并发请求下严格原子性。

访问 `/add`，粘贴通知正文并依据原文填写发布日期，或输入白名单内的公开文章链接。网页会尝试读取发布日期；无法确认时保持未知，不以获取当天推算“下周”等相对日期。超过 20000 字的网页明确报错，不把截断正文当完整通知。提取后逐项核对，确认截止时间或明确选择无截止时间，再加入日程。事项保留发布时间、获取时间、用户确认时间及文章关联。`/schedule` 可勾选材料、编辑、完成、归档、删除和导出 `.ics`。默认只导出进行中且有截止时间的事项，提醒不会晚于截止时刻；UID 基于事项 ID 保持稳定。

### 我的常用信息源

`/sources` 可按当前会话保存、修改、删除最多 5 个私人来源。单篇文章的“检查更新”直接保存完整原文快照；栏目先解析列表，选择最多 5 篇后才获取正文，每批并发不超过 2。重复内容标记“未变”，变化内容保存上一版供对照；失败不清空旧快照。点击“整理事项”才进入模型提取，已确认事项不会随着原文更新自动覆盖。来源、文章和历史版本均按服务端会话隔离，不进入公共知识库，也不用于私人资料问答。收藏 URL 不能扩展 `ALLOWED_FETCH_DOMAINS`，每次抓取继续校验 DNS 和重定向。栏目解析目前只有通用 HTML 列表夹具测试，尚无指定真实校园栏目样例联调，不保证所有站点可用。PDF、登录页和动态渲染页面暂不支持。

学生保存的通知只属于个人事项，不自动成为公共问答依据。老师可摘录通知原文、填写事项 ID 和出处，保存为知识草稿，再审核发布。通知原文依据必须确实出自该事项。问答每次从有效的 `confirmed` 知识检索中文关键词、别名与类别，最多给模型 8 条候选、约 12000 字；没有候选时直接不可答。引用保存当次条目版本、答案和依据快照，知识更新后仍可回看历史回答。联系方式只从 `contacts` 表读取。

## 导入开源日历

1. **Fossify Calendar（Android）**：下载 `.ics` 到手机，在应用的设置中找到“Import events from an .ics file / 从 .ics 文件导入事项”，选择文件和目标日历，然后检查事项与提醒。[项目主页](https://github.com/FossifyOrg/Calendar)
2. **Etar（Android）**：先创建或选择可写日历；从文件管理器打开 `.ics` 并选择 Etar 导入，或在应用的导入功能中选择文件，再检查目标日历。Etar 官方说明支持 ICS 导入，但也标注该功能仍有已知问题，导入前建议用测试日历。[Etar 官方说明](https://github.com/Etar-Group/Etar-Calendar)
3. **Thunderbird（桌面）**：打开“工具 → 导入 → 从文件导入 → 导入日历”，选择 `.ics` 和目标日历，再检查三个提醒。[Thunderbird 支持说明](https://support.mozilla.org/en-US/questions/1590822)

不同 App 对重复导入同一 UID 的处理可能不同；导入更新前先在目标 App 检查是否出现重复事项。提醒是否实际触发**未经真机验证**。

## 已知限制

提示词与字段校验不能从技术上保证生成文本零无依据内容。金额、日期及签字审批的肯否会与当次引用条目核对，联系方式由联系人表提供；资格、材料等复杂语义仍需人工核对。每条回答均可提交工单请老师确认；历史对话只用于理解追问，不能作为政策依据。若演示要求更强的可追溯性，可直接展示被引用条目原文。草稿会删除常见数字标识和邮箱，姓名及上下文中的个人信息仍需老师人工核对。旧匿名 `device_id` 数据仍在数据库中，当前模拟身份不会读取或认领；不要提交个人信息。修改已入库工单的回复不会自动修改知识条目。网页抓取仅处理 HTML，不处理 PDF；登录或 JavaScript 渲染的官网页面可能无法提取，可改为粘贴正文。材料依据缺失会标红，仍须学生核对原通知。
