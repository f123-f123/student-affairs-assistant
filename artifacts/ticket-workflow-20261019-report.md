# 老师工单回复与知识入库修复

代码已实现；共享数据库尚未部署本轮增量迁移。共享库写入为 0，没有调用真实模型、创建测试工单或发布测试知识。原有未提交文件与历史交付物保留。

## 根因与处理

- 工单详情 SELECT 漏掉 `reply_version`，导致合法版本 0 被前端误认为缺迁移。详情现在返回真实版本，并在服务端、客户端复用运行时响应校验；缺失或非法值不补 0。数据库明确缺列、缺安全 RPC、响应异常、数据库不可用、模型异常及版本冲突分别返回安全错误码，不回显数据库错误原文或工单内容。
- 旧 `confirm_ticket_knowledge_checked` 自动将内部 `teacher_reply` 复制到公开 `source_excerpt`。新 RPC 只接收老师单独审核的公开依据，允许 null；不从回复、模型输出或答案自动补全依据。旧 checked RPC 在新迁移后明确拒绝旧调用，不能继续公开原文。
- 审核页面明确分开内部回复与将向学生公开的问题、答案及依据。公开内容变动须重新勾选人工审核。模型与常见标识规则只是辅助，不声称完整匿名化；个人批准、例外不能推广为通用规则。缺少可复用规则时返回单独的 422 状态。
- 发布所依据的回复版本和原文快照仅存入受保护的 `tickets.knowledge_reply_version`、`tickets.knowledge_reply_snapshot`，通过工单原有关联追溯知识；不进入公共知识字段、学生检索或引用。发布后修改回复不改变已发布知识或内部发布快照。
- 保存、生成、入库、对照读取期间锁定相关编辑控件，并使用同步操作锁。修改回复立即取消草稿绑定；服务端保留保存 CAS、生成前后校验和发布事务内版本复核。保存成功直接接收新版本，无整页重载覆盖输入；入库成功但刷新失败明确提示不要重复发布。409 保留输入，支持读取最新回复并对照、保留当前输入采用新版本或采用最新回复。不使用 localStorage 存放工单文本。
- 详情只查询工单与类别；替换候选按需按类别查询，每页 10 条，支持重试。候选失败不影响回复；类别变化清空选择，取消并丢弃旧查询。替换有效性仍由入库事务检查。

## 修改文件

| 文件 | 内容 |
|---|---|
| `app/api/teacher/tickets/[id]/route.ts` | 轻量详情、真实版本、运行时契约 |
| `app/api/teacher/tickets/[id]/reply/route.ts` | CAS、保存返回真实新版本、安全错误 |
| `app/api/teacher/tickets/[id]/draft/route.ts` | 前后版本核对、区分模型/格式/不可复用错误 |
| `app/api/teacher/tickets/[id]/confirm/route.ts` | 人工公开审核、新安全 RPC、版本及业务冲突 |
| `app/api/teacher/ticket-candidates/route.ts` | 老师权限、类别过滤、分页候选 |
| `app/teacher/(protected)/tickets/[id]/page.tsx` | 编辑锁、公开审核、冲突对照、候选分页 |
| `lib/ticket-contract.ts`、`lib/ticket-api.ts` | 共用响应契约与安全错误映射 |
| `lib/draft.ts`、`lib/llm.ts` | 辅助整理及缺少通用规则提示 |
| `lib/local-db.ts`、`local/schema.sql` | SQLite 事务及内部追溯字段适配 |
| `supabase/migration_ticket_public_evidence.sql` | 本轮增量迁移，仅新字段、函数及权限 |
| `supabase/audit_ticket_public_evidence.sql` | 历史依据、知识版本、聊天引用的只读排查 |
| `tests/reply-version.test.ts`、`tests/ticket-editor.test.tsx` | 完整链路、并发、隐私、权限、编辑竞争、候选错误 |
| `scripts/verify-ticket-contract-shared.test.ts` | 显式启用的共享库只读部署核查 |
| `artifacts/ticket-contract-20261019-shared.json` | 本轮真实只读核查结果，不含正文或密钥 |

## 验证

针对性测试命令：

```powershell
npx vitest run tests/reply-version.test.ts tests/ticket-editor.test.tsx tests/mock-auth-api.test.ts tests/local-db.test.ts tests/draft.test.ts tests/llm.test.ts --cache=false
npx tsc --noEmit --incremental false
git -c core.safecrlf=false diff --check
```

60 项测试通过，类型检查和差异格式检查通过。使用内存 SQLite、模拟模型和 jsdom；覆盖详情 GET 获取版本后保存、生成、编辑审核、发布；同版本并发、生成前后及事务前竞争、重复发布、替换失败、发布后修改回复、虚构个人信息不会重新进入公开知识/知识版本/学生响应/引用/问答模型输入、401/403、错误分类、页面锁定/对照和候选过时响应。没有使用真实模型。

共享库只读验证于 `2026-10-20T00:00:35.354Z` 完成：项目 `ujbflooavhhbtdezrteo`，读取到 5 条工单，版本均为合法整数 0；旧 checked RPC 在 API 目录存在，新安全 RPC 不存在。抽样工单关联的知识条目为 0；这不代表已经审计所有历史版本或聊天快照。

## 部署顺序及前置条件

1. 前置为现有知识库及官网导入迁移已部署，服务端使用当前老师鉴权和 service_role，浏览器角色无业务表/RPC 写权限。本轮已确认回复版本字段存在，不要因旧接口漏字段重跑旧迁移或 seed。
2. 暂停工单确认入库，管理员执行 `supabase/migration_ticket_public_evidence.sql`。该文件新增两个仅内部追溯字段、新安全 RPC，并关闭旧 checked RPC 的自动公开路径，不修复或删除历史记录。
3. 部署本轮服务端与老师页面，确认新函数出现在 PostgREST 目录后恢复入库。旧客户端在迁移后会明确失败，需刷新使用新页面；新代码在迁移前返回 `TICKET_PUBLIC_RPC_MISSING`，不会回退旧不安全入口。

本轮没有执行共享迁移或数据修复。Supabase 新函数的真实事务、线上老师会话完整读写链路与真实浏览器操作尚未验收；隔离测试通过不能等同线上已修复。

## 历史风险与可审阅处置方案

旧函数具有将内部回复公开的确定性代码风险。已发布的 `knowledge_items.source_excerpt`、归档 `knowledge_item_versions.snapshot`、`chat_logs.response_json` 引用及回答可能保留旧内容；只修当前知识不会清理已有快照。此次抽查未发现已关联知识，不能据此认定全量历史安全。

提供 `supabase/audit_ticket_public_evidence.sql`：只读事务，仅输出条目/日志 ID、版本、是否存在依据及完整复制标志，不输出正文。非空依据只是人工复核候选，不等于已泄露；当前回复可能已编辑，所以“未完整相等”也不是无风险证明。该审计脚本本轮未在共享库执行。

建议管理员在受限环境执行审计，逐条核对公开问题、答案、依据、旧知识版本及关联聊天回答/引用；形成具体 ID、版本、涉及字段和审核后替代内容的清单。确认存在敏感信息时，先决定对应知识停用及历史展示限制，再单独审批精确修复脚本；必须连同历史快照一并评审，避免更新触发器再次归档敏感旧值。本轮未批量修改、隐藏或删除真实历史数据。

未生成需要清理的临时文件；测试使用内存数据库、禁用测试缓存及 TypeScript 增量缓存，交付清单和报告保留。
