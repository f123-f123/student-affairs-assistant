# 学生事务智能助手（阶段一至三）

演示用学生问答页。知识条目和联系人均为虚构数据，真实使用前须替换。

## 先用本机 SQLite 演示（无需 Supabase）

项目在 Node.js 26 下可用内置 SQLite。将 `.env.example` 复制为 `.env.local`，设置 `DB_PROVIDER=sqlite`、`LLM_PROVIDER=deepseek`、`LLM_MODEL=deepseek-flash`，并填写自己的 `LLM_API_KEY`。首次访问 API 会自动建立 `data/demo.sqlite`，执行 `local/schema.sql`，并导入 `supabase/seed.sql` 中的虚构类别、联系人和 15 条知识。数据库文件会保留本机的问答记录、工单、老师回复和日程；首页按浏览器设备显示独立对话列表，每个对话恢复最近 50 条问答。旧问答会归入该设备的“历史对话”；早期未保存回答快照的记录仍可查看问题。不要把其中的演示规则当作真实学校规定。

本地老师登录还需填写 `TEACHER_PASSCODE` 和随机长字符串 `SESSION_SECRET`。`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 此时保持空白即可。运行 `npm install`、`npm run dev`，打开 http://localhost:3000 。没有 DeepSeek API Key 时，页面可以启动，但问答、草稿生成和通知提取会返回服务不可用。DeepSeek 的 API Key 可在[开放平台](https://platform.deepseek.com/)创建；当前模型名见[官方接口文档](https://api-docs.deepseek.com/guides/anthropic_api/)。

本地 SQLite 模式供单机演示使用。将来改用 Supabase 时，把 `DB_PROVIDER` 设为 `supabase`，按下一节建表并配置两个 Supabase 变量；本地 SQLite 数据不会自动迁移到 Supabase。

## 改用 Supabase 时建表与导入数据

新项目在 Supabase SQL Editor 中依次执行 `supabase/schema.sql`、`supabase/seed.sql`、`supabase/migration_phase2.sql`、`supabase/migration_phase3.sql`、`supabase/migration_chat_history.sql`、`supabase/migration_conversations.sql`。已有阶段三数据库执行尚未运行的迁移，最后执行 `supabase/migration_conversations.sql`；原有问答按设备归入“历史对话”。种子脚本使用固定 UUID，可重复执行；请勿把演示数据当作学校正式规定。服务端使用 service role 密钥访问数据库，无浏览器直连数据库。

## 配置和启动

复制 `.env.example` 为 `.env.local`。使用 Supabase 时填入项目 URL 和 service role 密钥；DeepSeek 使用 Chat Completions 的 JSON 模式。如需使用 Anthropic，改为 `LLM_PROVIDER=anthropic` 并填写对应模型名和密钥。设置 `ALLOWED_FETCH_DOMAINS`，例如 `school.edu.cn,notice.school.edu.cn`。只写允许抓取的准确域名，不含协议或路径；跳转目标也必须在白名单内。`TEACHER_PASSCODE` 用于老师登录，`SESSION_SECRET` 用于签名有效期 8 小时的 cookie。所有变量仅供服务端读取，不添加 `NEXT_PUBLIC_` 前缀。

运行 `npm install`、`npm run dev`，打开 http://localhost:3000 。

## 本地验证

运行 `npm run typecheck`、`npm test`、`npm run build`。配置真实密钥后，在首页问“缓考怎么申请”，提交给老师；访问 `/teacher/login` 登录，在 `/teacher` 回复并生成、编辑草稿，确认入库；再回到首页换一种说法提问。`/my` 每 5 秒更新该设备的工单状态。确认入库重复提交返回 409。未登录访问老师页面会跳转登录，老师接口返回 401。

老师也可登录后访问 `/teacher/knowledge`，手工填写类别、通用问题和确认后的答案，直接新增已确认条目。保存后无需刷新数据库或运行导入脚本，学生下次提问会实时读取。

工单提交限制为同一 device_id 滚动一分钟最多 3 张、UTC 自然日最多 20 张。该限制使用数据库计数，适合演示，不保证并发请求下严格原子性。

阶段三：访问 `/add`，粘贴评奖通知正文并填写发布日期，或输入白名单内的官网链接。提取后逐项核对，确认截止时间或明确选择无截止时间，再加入日程。`/schedule` 可勾选材料、编辑、完成、归档、删除和导出单个或全部 `.ics`。只有带截止时间、未归档的事项会导出。日期按上海时间显示；仅有日期时默认为当天 23:59。导出带截止前 3 天、前 1 天及截止当天上海时间 09:00 三次提醒，UID 基于事项 ID 保持稳定。

加入日程后的通知原文供所有学生问答引用，回答的出处会标明“未经老师核验”。归档的通知不进入新的问答。知识条目仍只读取 `confirmed` 状态。请勿粘贴含个人信息的通知；通知过多时，全文进入模型会增加延迟和用量。

## 导入开源日历

1. **Fossify Calendar（Android）**：下载 `.ics` 到手机，在应用的设置中找到“Import events from an .ics file / 从 .ics 文件导入事项”，选择文件和目标日历，然后检查事项与提醒。[项目主页](https://github.com/FossifyOrg/Calendar)
2. **Etar（Android）**：先创建或选择可写日历；从文件管理器打开 `.ics` 并选择 Etar 导入，或在应用的导入功能中选择文件，再检查目标日历。Etar 官方说明支持 ICS 导入，但也标注该功能仍有已知问题，导入前建议用测试日历。[Etar 官方说明](https://github.com/Etar-Group/Etar-Calendar)
3. **Thunderbird（桌面）**：打开“工具 → 导入 → 从文件导入 → 导入日历”，选择 `.ics` 和目标日历，再检查三个提醒。[Thunderbird 支持说明](https://support.mozilla.org/en-US/questions/1590822)

不同 App 对重复导入同一 UID 的处理可能不同；导入更新前先在目标 App 检查是否出现重复事项。提醒是否实际触发**未经真机验证**。

## 已知限制

提示词与字段校验不能从技术上保证生成文本零无依据内容。金额和手机号会逐项核对被引用条目，但其他语义仍需模型遵守约束。若演示要求更强的可追溯性，可将回答改为直接展示被引用条目原文。草稿会删除常见数字标识和邮箱，姓名及上下文中的个人信息仍需老师人工核对。device_id 保存在浏览器本地存储中，清除浏览器数据后无法找回此前工单；持有设备 ID 的人可查询对应工单和事项，因此不要提交个人信息。修改已入库工单的回复不会自动修改知识条目。网页抓取仅处理 HTML，不处理 PDF；登录或 JavaScript 渲染的官网页面可能无法提取，可改为粘贴正文。材料依据缺失会标红，仍须学生核对原通知。
