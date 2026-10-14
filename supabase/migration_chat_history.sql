-- 已执行旧 schema.sql 的 Supabase 项目只需运行一次本迁移。
alter table chat_logs add column if not exists response_json jsonb;
