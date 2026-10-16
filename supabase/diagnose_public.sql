-- 在已确认目标项目的 SQL Editor 中运行。全部只读，不创建或修改对象。
select current_database() as database_name, current_user as sql_role,
       to_regnamespace('public') is not null as public_exists;

-- 权限迁移会处理 public 下的所有表和函数；先确认是否还有其他应用对象。
select c.relname as object_name, c.relkind as object_kind
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
order by c.relname;

select p.proname as function_name, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, arguments;

with required(table_name) as (
  values ('categories'), ('contacts'), ('knowledge_items'), ('tickets'),
         ('chat_logs'), ('conversations'), ('events'), ('teacher_login_attempts'),
         ('information_sources'), ('source_links'), ('source_articles'),
         ('source_article_versions')
)
select table_name, to_regclass(format('public.%I', table_name)) is not null as physically_exists
from required order by table_name;

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name in (
  'categories', 'contacts', 'knowledge_items', 'tickets', 'chat_logs',
  'conversations', 'events', 'teacher_login_attempts', 'information_sources',
  'source_links', 'source_articles', 'source_article_versions'
)
order by table_name, ordinal_position;

select to_regprocedure('public.record_teacher_login_failure(text)') is not null as phase2_rpc,
       to_regprocedure('public.confirm_ticket_knowledge(uuid,text,text,uuid,uuid)') is not null as knowledge_rpc,
       to_regprocedure('public.publish_knowledge_item(uuid,integer)') is not null as version_checked_publish_rpc;
