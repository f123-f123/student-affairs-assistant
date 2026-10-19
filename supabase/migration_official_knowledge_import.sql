-- 增量迁移。保留现有知识、工单、事项；不导入seed。
begin;
alter table public.knowledge_items add column if not exists scope jsonb;
alter table public.knowledge_items add column if not exists facts jsonb;
alter table public.knowledge_items add column if not exists import_draft_id uuid;
create unique index if not exists knowledge_import_draft_unique on public.knowledge_items(import_draft_id) where import_draft_id is not null;
alter table public.tickets add column if not exists reply_version integer not null default 0;
alter table public.conversations add column if not exists topic_context jsonb;

create table if not exists public.knowledge_imports (
  id uuid primary key default gen_random_uuid(), owner_id text not null, requested_url text not null,
  source_url text, title text not null, source_text text not null, published_date date,
  date_candidates jsonb not null default '[]', attachments jsonb not null default '[]',
  fetched_at timestamptz, content_hash text, status text not null check(status in ('failed','fetched','review','published')),
  error_code text, error_message text, version integer not null default 1,
  created_at timestamptz not null default now(), unique(source_url,content_hash)
);
create table if not exists public.knowledge_import_drafts (
  id uuid primary key, batch_id uuid not null references public.knowledge_imports(id), data jsonb not null,
  version integer not null default 1, status text not null default 'draft' check(status in ('draft','ignored','published')),
  published_item_id uuid references public.knowledge_items(id), reviewed_by text, reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists knowledge_import_batch_idx on public.knowledge_import_drafts(batch_id);
create table if not exists public.knowledge_import_publications (
  id uuid primary key, batch_id uuid not null references public.knowledge_imports(id),
  entries jsonb not null, result jsonb not null, reviewed_by text not null, created_at timestamptz not null default now()
);

create or replace function public.capture_knowledge_import(p_data jsonb) returns jsonb language plpgsql set search_path=public as $$
declare v_id uuid; v_existing uuid;
begin
  insert into knowledge_imports(owner_id,requested_url,source_url,title,source_text,published_date,date_candidates,attachments,fetched_at,content_hash,status,error_code,error_message)
  values(p_data->>'owner_id',p_data->>'requested_url',p_data->>'source_url',p_data->>'title',p_data->>'source_text',
    (p_data->>'published_date')::date,p_data->'date_candidates',p_data->'attachments',(p_data->>'fetched_at')::timestamptz,
    p_data->>'content_hash',p_data->>'status',p_data->>'error_code',p_data->>'error_message')
  on conflict(source_url,content_hash) do nothing returning id into v_id;
  if v_id is null then
    select id into v_existing from knowledge_imports where source_url=p_data->>'source_url' and content_hash=p_data->>'content_hash';
    return jsonb_build_object('id',v_existing,'existing',true);
  end if;
  return jsonb_build_object('id',v_id,'existing',false);
end $$;

create or replace function public.edit_knowledge_import(p_batch_id uuid,p_expected_version integer,p_mode text,p_drafts jsonb)
returns void language plpgsql set search_path=public as $$
declare b knowledge_imports%rowtype; d knowledge_import_drafts%rowtype; e jsonb;
begin
  select * into b from knowledge_imports where id=p_batch_id for update;
  if not found or b.version<>p_expected_version then raise exception 'IMPORT_CONFLICT:%:batch_version',p_batch_id; end if;
  if jsonb_array_length(p_drafts) not between 1 and 8 then raise exception 'IMPORT_CONFLICT:%:draft_limit',p_batch_id; end if;
  if p_mode='generate' then
    if exists(select 1 from knowledge_import_drafts where batch_id=p_batch_id) then raise exception 'IMPORT_CONFLICT:%:drafts_exist',p_batch_id; end if;
    for e in select * from jsonb_array_elements(p_drafts) loop
      insert into knowledge_import_drafts(id,batch_id,data) values((e->>'id')::uuid,p_batch_id,e->'data');
    end loop;
  elsif p_mode='edit' then
    for e in select * from jsonb_array_elements(p_drafts) loop
      select * into d from knowledge_import_drafts where id=(e->>'id')::uuid and batch_id=p_batch_id for update;
      if not found or d.status='published' or d.version<>(e->>'version')::integer then raise exception 'IMPORT_CONFLICT:%:draft_version',e->>'id'; end if;
      update knowledge_import_drafts set data=e->'data',status=e->>'status',version=version+1 where id=d.id;
    end loop;
  else raise exception 'IMPORT_CONFLICT:%:invalid_action',p_batch_id; end if;
  update knowledge_imports set version=version+1,status='review',error_code=null,error_message=null where id=p_batch_id;
end $$;

create or replace function public.publish_knowledge_import(p_batch_id uuid,p_request_id uuid,p_actor text,p_entries jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare b knowledge_imports%rowtype; d knowledge_import_drafts%rowtype; k knowledge_items%rowtype;
  receipt knowledge_import_publications%rowtype; e jsonb; x jsonb; target uuid; ids jsonb:='[]'; targets uuid[]:='{}'; excerpt text;
begin
  select * into b from knowledge_imports where id=p_batch_id for update;
  if not found then raise exception 'IMPORT_CONFLICT:%:batch_missing',p_batch_id; end if;
  select * into receipt from knowledge_import_publications where id=p_request_id;
  if found then
    if receipt.batch_id<>p_batch_id or receipt.entries<>p_entries or receipt.reviewed_by<>p_actor then raise exception 'IMPORT_CONFLICT:%:request_reused',p_request_id; end if;
    return receipt.result;
  end if;
  if jsonb_array_length(p_entries) not between 1 and 8 then raise exception 'IMPORT_CONFLICT:%:empty_selection',p_batch_id; end if;
  -- 锁顺序固定，替换目标在写入前锁定；任何冲突均回滚整批。
  perform id from knowledge_items where id in(select (value->'data'->>'supersedes')::uuid from jsonb_array_elements(p_entries)) order by id for update;
  for e in select * from jsonb_array_elements(p_entries) loop
    select * into d from knowledge_import_drafts where id=(e->>'id')::uuid and batch_id=p_batch_id for update;
    if not found or d.version<>(e->>'version')::integer or d.data<>e->'data' or d.status='ignored' then raise exception 'IMPORT_CONFLICT:%:draft_version',e->>'id'; end if;
    if d.status='published' then ids:=ids||jsonb_build_array(d.published_item_id); continue; end if;
    x:=d.data;
    if not exists(select 1 from categories where id=(x->>'category_id')::uuid) then raise exception 'IMPORT_CONFLICT:%:category',d.id; end if;
    if not coalesce((x->>'scope_confirmed')::boolean,false) or not coalesce((x->>'semantics_confirmed')::boolean,false) or coalesce((x->>'attachment_dependency')::boolean,true) then raise exception 'IMPORT_CONFLICT:%:unreviewed',d.id; end if;
    if jsonb_array_length(x->'excerpts')=0 or exists(select 1 from jsonb_array_elements_text(x->'excerpts') as quotes(value) where position(value in b.source_text)=0) then raise exception 'IMPORT_CONFLICT:%:evidence',d.id; end if;
    target:=(x->>'supersedes')::uuid;
    if target is not null then
      if target=any(targets) then raise exception 'IMPORT_CONFLICT:%:duplicate_replacement',d.id; end if;
      targets:=array_append(targets,target);
      select * into k from knowledge_items where id=target;
      if not found or k.status<>'confirmed' or k.version<>(x->>'replacement_version')::integer or k.category_id<>(x->>'category_id')::uuid then raise exception 'IMPORT_CONFLICT:%:replacement_version',d.id; end if;
      if k.scope is not null and exists(select 1 from unnest(array['units','cohorts','years','projects']) as keys(name) where
        jsonb_array_length(coalesce(k.scope->name,'[]'))>0 and jsonb_array_length(coalesce(x->'scope'->name,'[]'))>0 and not ((k.scope->name) <@ (x->'scope'->name) and (x->'scope'->name) <@ (k.scope->name)))
        then raise exception 'IMPORT_CONFLICT:%:replacement_scope',d.id; end if;
      if k.scope is null and exists(select 1 from unnest(array['units','cohorts','years','projects']) as keys(name),jsonb_array_elements_text(x->'scope'->name) as terms(value)
        where position(translate(value,'—–至','---') in translate(k.question||k.answer,'—–至','---'))=0) then raise exception 'IMPORT_CONFLICT:%:replacement_scope_unknown',d.id; end if;
    end if;
    select string_agg(value,E'\n\n') into excerpt from jsonb_array_elements_text(x->'excerpts');
    insert into knowledge_items(id,category_id,question,answer,aliases,source_level,source_name,source_url,source_excerpt,scope,facts,import_draft_id,status,reviewed_at,reviewed_by,supersedes,valid_from,valid_until)
    values(d.id,(x->>'category_id')::uuid,x->>'question',x->>'answer',array(select jsonb_array_elements_text(x->'aliases')),2,b.title,b.source_url,excerpt,x->'scope',e->'facts',d.id,'confirmed',now(),p_actor,target,null,null);
    if target is not null then update knowledge_items set status='superseded' where id=target; end if;
    update knowledge_import_drafts set status='published',published_item_id=d.id,reviewed_at=now(),reviewed_by=p_actor where id=d.id;
    ids:=ids||jsonb_build_array(d.id);
  end loop;
  insert into knowledge_import_publications(id,batch_id,entries,result,reviewed_by) values(p_request_id,p_batch_id,p_entries,jsonb_build_object('ids',ids,'count',jsonb_array_length(ids)),p_actor);
  update knowledge_imports set status=case when exists(select 1 from knowledge_import_drafts where batch_id=p_batch_id and status='draft') then 'review' else 'published' end where id=p_batch_id;
  return jsonb_build_object('ids',ids,'count',jsonb_array_length(ids));
end $$;

-- 来源范围等内容变化同样归档并递增版本，保留旧引用快照。
create or replace function public.archive_knowledge_version() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new)-'version'-'updated_at') is distinct from (to_jsonb(old)-'version'-'updated_at') then
    insert into knowledge_item_versions(item_id,version,snapshot) values(old.id,old.version,to_jsonb(old)) on conflict do nothing;
    new.version:=old.version+1;
  end if;
  return new;
end $$;

create or replace function public.confirm_ticket_knowledge_checked(p_ticket_id uuid,p_question text,p_answer text,p_category_id uuid,p_supersedes uuid,p_expected_reply_version integer,p_expected_reply text,p_actor text)
returns uuid language plpgsql set search_path=public as $$
declare t tickets%rowtype; result uuid;
begin
  select * into t from tickets where id=p_ticket_id for update;
  if not found then raise exception 'ticket_not_found'; end if;
  if p_expected_reply_version is null or t.reply_version<>p_expected_reply_version or t.teacher_reply is distinct from p_expected_reply then raise exception 'reply_version_conflict'; end if;
  result:=confirm_ticket_knowledge(p_ticket_id,p_question,p_answer,p_category_id,p_supersedes);
  update knowledge_items set reviewed_by=p_actor,source_excerpt=t.teacher_reply where id=result;
  return result;
end $$;

alter table public.knowledge_imports enable row level security;
alter table public.knowledge_import_drafts enable row level security;
alter table public.knowledge_import_publications enable row level security;
revoke all on public.knowledge_imports,public.knowledge_import_drafts,public.knowledge_import_publications from public,anon,authenticated;
grant all on public.knowledge_imports,public.knowledge_import_drafts,public.knowledge_import_publications to service_role;
revoke all on function public.capture_knowledge_import(jsonb),public.edit_knowledge_import(uuid,integer,text,jsonb),public.publish_knowledge_import(uuid,uuid,text,jsonb),public.confirm_ticket_knowledge_checked(uuid,text,text,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.capture_knowledge_import(jsonb),public.edit_knowledge_import(uuid,integer,text,jsonb),public.publish_knowledge_import(uuid,uuid,text,jsonb),public.confirm_ticket_knowledge_checked(uuid,text,text,uuid,uuid,integer,text,text) to service_role;
notify pgrst,'reload schema';
commit;
