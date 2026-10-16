-- 在现有各阶段迁移后运行；可重复执行，不导入或覆盖演示数据。
alter table knowledge_items drop constraint if exists knowledge_items_status_check;
alter table knowledge_items add constraint knowledge_items_status_check check (status in ('draft','confirmed','superseded','inactive'));
alter table knowledge_items add column if not exists aliases text[] not null default '{}';
alter table knowledge_items add column if not exists source_excerpt text;
alter table knowledge_items add column if not exists valid_from timestamptz;
alter table knowledge_items add column if not exists valid_until timestamptz;
alter table knowledge_items add column if not exists version integer not null default 1;
alter table knowledge_items add column if not exists reviewed_at timestamptz;
alter table knowledge_items add column if not exists reviewed_by text;
alter table knowledge_items add column if not exists origin_event_id uuid;
update knowledge_items set reviewed_at = coalesce(reviewed_at, updated_at)
where status = 'confirmed' and reviewed_at is null;
-- 历史确认者身份未知，reviewed_by 保持 NULL。
create table if not exists knowledge_item_versions (
  item_id uuid not null references knowledge_items(id), version integer not null,
  snapshot jsonb not null, archived_at timestamptz not null default now(),
  primary key (item_id, version)
);
create or replace function archive_knowledge_version() returns trigger language plpgsql as $$
begin
  if row(new.question,new.answer,new.category_id,new.aliases,new.source_name,new.source_url,new.source_excerpt,
         new.valid_from,new.valid_until,new.status,new.reviewed_at,new.reviewed_by)
     is distinct from
     row(old.question,old.answer,old.category_id,old.aliases,old.source_name,old.source_url,old.source_excerpt,
         old.valid_from,old.valid_until,old.status,old.reviewed_at,old.reviewed_by) then
    insert into knowledge_item_versions(item_id,version,snapshot)
    values (old.id,old.version,to_jsonb(old)) on conflict do nothing;
    new.version := old.version + 1;
  end if;
  return new;
end $$;
drop trigger if exists knowledge_version_archive on knowledge_items;
create trigger knowledge_version_archive before update on knowledge_items
for each row execute function archive_knowledge_version();

-- 保留旧工单沉淀入口，补齐原回复依据与审核时间；认证仍在服务端路由。
create or replace function confirm_ticket_knowledge(
  p_ticket_id uuid, p_question text, p_answer text, p_category_id uuid, p_supersedes uuid default null
) returns uuid language plpgsql as $$
declare v_ticket tickets%rowtype; v_old knowledge_items%rowtype; v_new_id uuid;
begin
  select * into v_ticket from tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket_not_found'; end if;
  if v_ticket.sedimented then raise exception 'already_sedimented'; end if;
  if v_ticket.status <> 'answered' or nullif(btrim(v_ticket.teacher_reply), '') is null then raise exception 'ticket_not_answered'; end if;
  if nullif(btrim(p_question), '') is null or length(p_question) > 500 or
     nullif(btrim(p_answer), '') is null or length(p_answer) > 4000 then raise exception 'invalid_knowledge'; end if;
  if p_supersedes is not null then
    select * into v_old from knowledge_items where id = p_supersedes for update;
    if not found or v_old.status <> 'confirmed' or v_old.category_id <> p_category_id then raise exception 'invalid_supersedes'; end if;
  end if;
  insert into knowledge_items(category_id,question,answer,source_level,source_name,status,supersedes,reviewed_at)
  values(p_category_id,btrim(p_question),btrim(p_answer),1,'老师确认回答','confirmed',p_supersedes,now())
  returning id into v_new_id;
  if p_supersedes is not null then update knowledge_items set status = 'superseded' where id = p_supersedes; end if;
  update tickets set sedimented = true, knowledge_item_id = v_new_id where id = p_ticket_id;
  return v_new_id;
end $$;

-- 只调整本应用对象，避免影响同一 public schema 中其他应用。
-- 浏览器角色不得直连业务表或 RPC；服务端使用 service_role，接口另验老师会话。
revoke all on categories, contacts, knowledge_items, knowledge_item_versions,
  tickets, chat_logs, conversations, events, teacher_login_attempts
  from public, anon, authenticated;
revoke all on function update_knowledge_item_timestamp(), update_event_timestamp(),
  update_conversation_timestamp(), archive_knowledge_version(),
  record_teacher_login_failure(text), confirm_ticket_knowledge(uuid,text,text,uuid,uuid)
  from public, anon, authenticated;
grant usage on schema public to service_role;
grant all on categories, contacts, knowledge_items, knowledge_item_versions,
  tickets, chat_logs, conversations, events, teacher_login_attempts to service_role;
grant execute on function update_knowledge_item_timestamp(), update_event_timestamp(),
  update_conversation_timestamp(), archive_knowledge_version(),
  record_teacher_login_failure(text), confirm_ticket_knowledge(uuid,text,text,uuid,uuid)
  to service_role;
alter table categories enable row level security;
alter table contacts enable row level security;
alter table knowledge_items enable row level security;
alter table knowledge_item_versions enable row level security;
alter table tickets enable row level security;
alter table chat_logs enable row level security;
alter table conversations enable row level security;
alter table events enable row level security;
alter table teacher_login_attempts enable row level security;

create or replace function publish_knowledge_item(p_id uuid) returns void language plpgsql as $$
declare v_item knowledge_items%rowtype; v_old knowledge_items%rowtype;
begin
  select * into v_item from knowledge_items where id = p_id for update;
  if not found or v_item.status <> 'draft' then raise exception 'invalid_draft'; end if;
  if v_item.supersedes is not null then
    select * into v_old from knowledge_items where id = v_item.supersedes and status = 'confirmed' for update;
    if not found or v_old.category_id <> v_item.category_id then raise exception 'invalid_supersedes'; end if;
    update knowledge_items set status = 'superseded' where id = v_item.supersedes;
  end if;
  update knowledge_items set status = 'confirmed', reviewed_at = now(), reviewed_by = null where id = p_id;
end $$;
revoke all on function publish_knowledge_item(uuid) from public, anon, authenticated;
grant execute on function publish_knowledge_item(uuid) to service_role;
