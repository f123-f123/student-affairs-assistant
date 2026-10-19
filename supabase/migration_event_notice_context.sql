-- 增量迁移：保留既有事项、知识和类别负责人；不运行 seed.sql。
begin;
alter table public.events add column if not exists date_context jsonb;
alter table public.events add column if not exists category_id uuid references public.categories(id) on delete set null;
alter table public.contacts add column if not exists scope text not null default 'category';
alter table public.contacts add column if not exists notice_event_id uuid references public.events(id) on delete cascade;
alter table public.contacts add column if not exists source_excerpt text;
alter table public.contacts add column if not exists source_url text;
alter table public.contacts add column if not exists source_hash text;
alter table public.contacts drop constraint if exists contacts_notice_scope_check;
alter table public.contacts add constraint contacts_notice_scope_check check (
  (scope = 'category' and notice_event_id is null) or
  (scope = 'notice' and notice_event_id is not null and nullif(btrim(source_excerpt), '') is not null and source_hash is not null)
);
create index if not exists contacts_notice_event_idx on public.contacts(notice_event_id) where scope = 'notice';
create unique index if not exists contacts_notice_identity_idx on public.contacts(notice_event_id, lower(coalesce(email,'')), coalesce(phone,''), name) where scope = 'notice';
-- contacts/events 已由原迁移启用 RLS，浏览器角色无写权限；继续仅由鉴权服务端写入。
notify pgrst, 'reload schema';
commit;
