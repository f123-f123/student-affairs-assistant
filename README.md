# 校园办事猿

老师可在“知识库 → 类别负责人维护”新增或修改类别负责人；发布知识不会自动关联当前登录老师。学生回答的联系人只来自 `contacts`，可答问题按有效引用类别选取负责人，跨类别按首条有效引用并说明范围。重新打开历史对话会批量读取当前负责人，保留原回答和引用快照。没有真实资料时保留空状态并走工单；查询失败会单独提示。姓名明确标注演示、或使用仓库固定演示联系人 ID 的记录，会显示“演示联系人，非真实联系方式”，不提供拨号、邮件入口；不要运行完整种子来补联系人。

## 项目结构与维护约定

| 层次 | 位置 | 职责 |
| --- | --- | --- |
| 页面与交互 | `app/**/page.tsx`、`app/components` | 学生问答、个人资料、老师审核与界面状态 |
| HTTP 接口 | `app/api/**/route.ts` | 服务端身份、数据归属、请求与响应；不信任前端提交的用户 ID |
| 业务规则 | `lib/*-input.ts`、`knowledge-search.ts`、`answer-validation.ts`、`event-date.ts` | 输入规范、有效知识筛选、回答依据校验和日期推算 |
| 外部服务与存储 | `lib/llm.ts`、`safe-fetch.ts`、`supabase.ts`、`local-db.ts`、`source-storage.ts` | 模型调用、安全抓取、两种数据库适配及文章版本事务 |
| 数据结构与验证 | `local/`、`supabase/`、`tests/`、`scripts/` | 本地结构、增量迁移、回归测试和运维诊断 |

知识的主流程是“草稿 → 审核发布 → 有效期检索 → 回答校验 → 引用快照”；私人通知的主流程是“获取原文 → 整理草稿 → 用户确认 → 个人日程”。两者通过老师整理和审核衔接。

新建与编辑知识共用 `lib/knowledge-input.ts`，包括链接、别名、有效期、类别、通知依据和替换关系校验。草稿编辑保留原关联，再核对原文，不能通过清空请求中的关联字段绕过检查。事项创建与材料更新共用 `lib/event-input.ts`。新增规则时优先修改共享校验，避免在不同路由复制实现。

审核发布前再次检查当前草稿及其引用。日期字段拒绝不存在的日期和缺少时区的日期时间；网页发布日期无效时保持未知。`lib/login.ts` 统一口令限流和会话 Cookie 签发，模型超时或网络错误通过 `MODEL_UNAVAILABLE` 与数据库故障区分。SQLite 新生成的知识快照保留有效期、来源关联和数组别名，已有历史快照保持原样。

外部网页请求总时限为 10 秒，单次模型请求时限为 30 秒；通知提取仅在模型空响应或无效提取结果时重试一次。信息源接口区分可识别的抓取失败（422）与服务故障（503），不向客户端透传数据库错误。批量文章先统一核对栏目链接，再以最多两个并发获取；界面按栏目分别保存选择。

## 对话数据库只读诊断

`DB_PROVIDER=supabase` 时，服务端必须配置 `SUPABASE_URL` 和 `SUPABASE_SECRET_KEY`（或旧版 `SUPABASE_SERVICE_ROLE_KEY`）。缺少密钥会返回稳定的 `DATABASE_CONFIG_MISSING`（HTTP 503），服务端日志只列缺失变量名；不会自动切换 SQLite，也不会生成示例对话。配置完成后运行 `node scripts/check-conversations-schema.mjs`，以真实 GET 只读核对 `public` REST 暴露、对话及依赖表字段；脚本不执行迁移、不写入数据。若返回 `PGRST205`，先确认项目 URL，再在该项目 SQL Editor 运行只读的 `supabase/diagnose_public.sql`：物理表不存在时按迁移顺序补齐，物理表存在时检查 PostgREST schema cache，不要重复初始化。正式数据和演示 seed 分开处理；`seed.sql` 只适用于已确认的空白演示库。迁移后再次运行真实 GET 诊断，并用 `node scripts/check-business-apis.mjs` 验证本地学生登录后的四个业务 API；两项都成功才算数据库可用。

## 当前身份登录（未接入校园认证）

### 空白数据库的基础分类初始化

正式空库建表后，运行 `node scripts/initialize-categories.mjs` 只读预览，再用 `node scripts/initialize-categories.mjs --apply` 补齐 `lib/base-categories.json` 中的 8 个基础分类。脚本按 ID 或名称跳过已存在分类，不覆盖配置，不导入演示知识、联系人或个人记录；可重复执行。老师随后在知识库页面录入真实依据并审核发布。

没有分类或没有适用的已审核知识属于“知识不足”，问答返回 HTTP 200 并保存真实状态，不再误报数据库故障；分类缺失时不编造分类 ID，也不显示无法提交的工单按钮。单独调用工单接口时会收到 `CATEGORIES_NOT_INITIALIZED`，初始化分类后即可正常提交。空库不会调用模型补造办事规定。

`AUTH_MODE=passcode`（或在保留旧配置时留空）且设置服务端 `TEACHER_PASSCODE` 与长度至少 32 字符的 `SESSION_SECRET` 后，`/login` 提供账号与口令表单。评估账号 `student-a` 和 `student-b` 留空口令进入各自学生工作区；老师可填任意账号及 `TEACHER_PASSCODE` 进入老师工作台。`AUTH_MODE=mock` 且未配置 `TEACHER_PASSCODE` 时，登录页改为固定的学生 A、学生 B、老师选择框；此入口默认仅限本地，远程受控评估还需 `MOCK_AUTH_ALLOW_REMOTE=true`。两种模式均明确标注“模拟接入，仅用于评估”；未启用的模式不会自动回退。账号仅选择固定测试身份，不能提交任意用户 ID 或自行声明角色。服务端验证口令后才签发老师会话，错误口令不会退回学生身份。校园认证端点尚未接入，不要输入校园账号、密码或验证码。登录使用有效期 8 小时的签名 httpOnly Cookie；退出和切换身份会清理前端当前对话并整页重载。固定评估账号没有学生密码，只适用于本地或受控评估环境，不适合公开部署。

个人数据接口从服务端会话取得归属 ID，忽略请求中的旧 `device_id` 参数。A、B 和老师各有固定内部 UUID；旧浏览器匿名设备数据仍保留在原 ID 下，不会自动归属任何人。老师接口要求当前会话为老师，学生收到 403，未登录收到 401。旧 `AUTH_MODE=legacy_teacher` 路由仅为兼容保留；当前登录入口使用 `/api/auth/login`。

统一内部身份见 `lib/auth-core.ts` 的 `CurrentUser`，服务端读取与老师校验见 `lib/auth.ts`。以后接入真实校园认证时，只替换身份适配与会话签发/验证层，映射到同一 `CurrentUser`；具体参数以正式文档为准。当前接口不是学校官方接口，未采集校园账号、密码、验证码或 Cookie，也没有访问校园认证端点。

`supabase/seed.sql` 与本地 SQLite 自动初始化的条目、联系人均为虚构演示数据，不是学校正式规定。共享部署使用 Supabase；只有显式设置 `DB_PROVIDER=sqlite` 才运行本地演示模式。

## 先用本机 SQLite 演示（无需 Supabase）

项目在 Node.js 26 下可用内置 SQLite。将 `.env.example` 复制为 `.env.local`，设置 `DB_PROVIDER=sqlite`、`AUTH_MODE=passcode`、`LLM_PROVIDER=deepseek`、`LLM_MODEL=deepseek-flash`，填写 `TEACHER_PASSCODE`、长 `SESSION_SECRET` 和自己的 `LLM_API_KEY`。首次访问 API 会自动建立 `data/demo.sqlite`，执行 `local/schema.sql`，并导入 `supabase/seed.sql` 中的虚构类别、联系人和 15 条知识。数据库文件保留已有问答、工单、老师回复和日程；旧匿名问答仍保留在原设备 ID 下，不自动认领。不要把演示规则当作真实学校规定。

SQLite 模式下 `SUPABASE_URL`、`SUPABASE_SECRET_KEY` 可留空。运行 `npm install`、`npm run dev`，打开 http://localhost:3000 。没有模型 API Key 时页面可以启动，但问答、草稿生成和通知提取会返回服务不可用。

本地 SQLite 模式供单机演示使用。将来改用 Supabase 时，把 `DB_PROVIDER` 设为 `supabase`，按下一节建表并配置两个 Supabase 变量；本地 SQLite 数据不会自动迁移到 Supabase。

## 改用 Supabase 时建表与导入数据

新 Supabase 项目在 SQL Editor 依次执行 `supabase/schema.sql`、`supabase/migration_phase2.sql`、`supabase/migration_phase3.sql`、`supabase/migration_chat_history.sql`、`supabase/migration_conversations.sql`、`supabase/migration_knowledge_library.sql`、`supabase/migration_knowledge_publish_version.sql`、`supabase/migration_information_sources.sql`、`supabase/migration_future_knowledge_effective.sql`、`supabase/migration_source_article_atomic.sql`、`supabase/migration_notice_attachments.sql`。已有数据库只运行缺失迁移；均为可重复执行的增量脚本，不清表。`migration_future_knowledge_effective.sql` 会把旧发布函数误停用、但替换知识尚未生效的原条目恢复为 confirmed；请先核对目标知识记录。`migration_source_article_atomic.sql` 安装文章版本的事务 RPC，应用更新前必须部署，否则信息源抓取会报错而不会回退到非事务写入。**正式环境不要执行 `supabase/seed.sql`**；仅空白演示环境可手动导入。旧的 confirmed 知识保留，审核时间回填为旧更新时间，审核人保持空白，不能将其解释为某位老师审核。服务端使用 Secret key（或旧版 service_role key），所有老师写接口仍校验老师 cookie；迁移只撤销 anon/authenticated 对本应用业务表和函数的直接权限，并开启相应 RLS，不触碰 `public` 下其他应用对象。

### SQLite → Supabase

先在目标项目执行上述 SQL 迁移，再在 PowerShell 设置 `SUPABASE_URL` 与 `SUPABASE_SECRET_KEY` 环境变量（旧版 `SUPABASE_SERVICE_ROLE_KEY` 也可用）。运行 `node scripts/sqlite-to-supabase.mjs --sqlite=E:\\path\\to\\demo.sqlite` 预览源表数量、目标已存在数量与待导入数量；不设置目标配置也能离线预览源数量。核对后附加 `--apply` 才写入。脚本只读打开 SQLite，按依赖顺序导入、保留原 UUID，冲突时跳过目标已有 ID 而不覆盖，并逐表核对所有源 ID 的存在数量。迁移范围包含个人信息源、栏目链接、文章快照和历史版本，并先于关联事项导入。重复执行不会产生重复行。目标有同 ID 但内容不同的记录会保留目标内容，请人工审查这类冲突；不迁移登录限流表。迁移正式数据前备份两端数据库。2026-10-15，项目 `ujbflooavhhbtdezrteo` 的八个结构脚本已由项目维护者在 SQL Editor 执行；随后 12 张业务表真实 GET 及学生登录后的四个业务 API 均返回 200。各业务列表目前为 0 条；尚未导入 SQLite 数据或执行演示 seed。

## 配置和启动

### 抓取诊断、白名单与 Fake-IP

本机已将 `yunfeng.zju.edu.cn` 加入 `ALLOWED_FETCH_DOMAINS`。空白名单会返回 `FETCH_ALLOWLIST_EMPTY`，未允许的域名返回 `FETCH_DOMAIN_NOT_ALLOWED`；收藏网址和重定向不能扩展白名单。

默认 `FETCH_DNS_MODE=system`。系统 DNS 返回私网、回环或 `198.18.0.0/15` 等保留地址时返回 `FETCH_DNS_NON_PUBLIC`，不发起目标连接，也不自动切换解析器。Fake-IP 环境可显式配置 `FETCH_DNS_MODE=doh`、`FETCH_DOH_PROVIDER=alidns`（也支持 `cloudflare`）。本机已明确启用 alidns DoH。解析请求使用预定义 HTTPS 域名和固定公网引导 IP，验证 DNS 响应的查询域名、类型及 CNAME 链；所有目标 A/AAAA 地址均须通过公网检查。每次重定向重新校验，目标连接固定到已验证 IP，Host/SNI 与 TLS 证书验证保持原域名。应用不读取系统代理，不通过代理委托未经校验的目标解析；若公网 IP 路由仍不可达，会明确报告连接失败。

已登录用户可 `POST /api/sources/diagnose`，JSON 为 `{"url":"https://yunfeng.zju.edu.cn/on/2026/1013/c53544a3213848/page.psp"}`。此接口调用与信息源保存、通知整理相同的 `fetchNotice`，返回最终地址、HTTP 状态、DNS 模式、每跳固定 IP、正文长度及附件清单；不写库、不调用模型，也不下载附件。主要错误码：

| 错误码 | 含义 |
| --- | --- |
| `FETCH_ALLOWLIST_EMPTY` / `FETCH_DOMAIN_NOT_ALLOWED` | 白名单未配置 / 域名不允许 |
| `FETCH_DNS_CONFIG` / `FETCH_DNS_FAILED` | DNS 配置无效 / 解析失败 |
| `FETCH_DNS_NON_PUBLIC` | 含非公网或保留地址，继续拦截 |
| `FETCH_NETWORK_FAILED` / `FETCH_HTTP_FAILED` | 公网连接失败 / 上游 HTTP 非成功 |
| `FETCH_TIMEOUT` / `FETCH_REDIRECT_LIMIT` | 总时限 10 秒 / 重定向超限 |
| `FETCH_UNSUPPORTED` / `FETCH_TOO_LARGE` / `FETCH_TOO_LONG` | 非支持页面 / 响应超限 / 正文超长 |
| `SOURCE_SCHEMA_MIGRATION_REQUIRED` | 抓取存储所需附件字段或 RPC 未部署，须先执行增量迁移 |

网页快照标记为 `body_only`，不代表整份通知资料完整。DOC、DOCX 等附件只识别名称、URL、格式并保存 `unparsed` 状态，既不下载，也不用于模型整理；列表、文章预览及事项整理均提示人工核对附件。附件清单变化会创建文章新版本。历史 `complete` 仅表示旧版本保存了网页正文，界面明确标记附件覆盖未知，不补造完整性结论。

**已有 Supabase 必须先执行 `supabase/migration_notice_attachments.sql`**（接在 `migration_source_article_atomic.sql` 后），安装附件字段、状态约束及兼容默认参数的新版事务 RPC，再部署应用；应用不会在迁移缺失时回退到丢失附件的写入。SQLite 首次访问自动增量升级，保留原文章、历史版本及引用。

构建并启动本地应用后，可运行 `node scripts/check-notice-fetch.mjs --base=http://127.0.0.1:3100` 验收上述真实网址，将结果保存到 `artifacts/notice-fetch-diagnostic.json`。脚本默认只登录本地评估身份并调用只读诊断，不写业务数据；附加 `--system-base`、`--empty-base` 可检查分别启动的系统 DNS、空白名单实例。`--with-isolated-storage` 仅供显式使用 `DB_PROVIDER=sqlite`、`LOCAL_SQLITE_PATH=:memory:` 且关闭模型密钥的独立实例使用，验证保存、重抓去重和附件状态传递；不得对正式数据库使用该选项。`--supabase-base` 只读检查配置中 Supabase 的附件迁移状态。

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

### 老师从官网导入知识

入口为“老师工作台 → 知识库 → 从官网导入”，路径 `/teacher/knowledge/import`，原有手工录入保留。每篇新通知只整理一版综合问答，别名覆盖常见提问。旧批次一次只展示一条，可“仅保留当前草稿待审核”，其余草稿以已忽略状态保留原有编辑内容。核对后勾选一次审核确认，保存校验，再发布；缺少核对或存在校验阻碍时禁用发布并明确提示。抓取、模型整理、保存草稿和审核发布分别请求；相同最终URL及内容指纹复用批次，正文变化保存新快照。导入批次和草稿持久化，刷新后可继续审核；编辑会撤销人工核对状态。仅老师明确勾选并审核发布的条目进入学生问答。

官网知识正文截止日期省略年份时，若有唯一的通知发布日期或落款依据，日期、星期及正文截止句一致，则自动补全年份并展示依据，不额外要求确认年份。旧草稿中已被这些依据解决的单纯缺年提示也不再阻止发布；原始草稿数据保留。日期依据缺失、冲突、跨年不明或其他人工问题仍需核对，不使用电脑当前年份猜测。

学生问答先检索相关的已发布知识，再判断适用范围。明确的学院、年级、学年或项目冲突才排除，缺失的范围返回具体通知供确认，不自行认定申请资格。支持“二奖/二等奖学金/浙江大学二等奖学金”等规范化及已配置别名；确认后的同项目追问保留上下文，切换学院或项目更新主题。API 的 `status` 区分 `answered`、`no_knowledge`、`needs_scope`、`model_refused`、`validation_failed`，并返回 `reason_code`；校验失败另含 `validation_error`。澄清候选和版本存于既有会话 JSON，过期版本重新确认，历史回答与引用快照不改写。本轮无需新增迁移。

公共通知联系人由 `migration_public_notice_contacts.sql` 增量部署。在官网导入审核页的“本通知联系人”独立核对公开原文、联系人和通知范围并确认保存；`contacts.scope='import'` 通过 `notice_import_id` 关联公开导入快照，多条已发布知识通过导入草稿共享同一通知联系人。`scope='notice'` 仍只用于私人事项，不自动公开、不修改为类别负责人，同 URL 仅作为老师端匹配线索。公共问答和历史对话实时读取已审核有效的通知联系人，按通知分组，缺少通知联系人时显示有明确范围说明的类别咨询负责人。`needs_scope` 在各候选下显示联系人并提示资格仍待核对，不展示混合的全局负责人。原文、快照或引用范围变化会使通知联系人待重新核对；查询失败、尚未审核及类别空状态分别显示。公共查询不读取学生 events；本功能不接入个人日程问答。

已有Supabase先在SQL Editor执行 `supabase/migration_official_knowledge_import.sql`（接在既有知识版本、工单、会话迁移之后）。这是本功能新增的迁移，与此前的事项联系人迁移不同；只新增表、列、索引和受服务端鉴权约束的事务函数，不执行seed或清空数据。未部署时导入接口明确返回 `IMPORT_SCHEMA_REQUIRED`。SQLite适配执行同样的版本、原子发布及替换检查；不会因Supabase迁移缺失退回SQLite。

官网条目保持 `source_level=2` 和真实通知名称，审核人/时间单独记录。手工老师回答仍为等级1。范围独立进入每条问题、答案、结构化字段、检索和模型上下文；不同学院/年级/学年/项目不混用，缺失范围先澄清。发布日期不当作生效日期，截止时间不当作失效时间。附件仅列出“未解析”，依赖附件的答案不能发布；不自动导入events或联系人。

`Server-Timing`及服务端`[timing]`记录抓取、整理、问答和发布的阶段耗时。老师首页使用精确数量查询，知识列表每页20条。追问只沿用当前主题；已审核知识的明确截止时间从结构化字段回答，不增加回答缓存或个人事项问答。

共享库真实通知不得用于自动发布测试。`scripts/verify-official-import.test.ts` 默认跳过，仅设置 `VERIFY_OFFICIAL_IMPORT_LIVE=1` 后进行真实抓取/模型整理和共享库只读检查；不保存或发布共享知识。`node scripts/check-official-import.mjs --isolated-db=artifacts/明确的测试.sqlite` 仅用于已经显式启动的本机mock鉴权、隔离SQLite测试实例，会写入测试发布记录和问答日志，禁止对共享服务使用。
