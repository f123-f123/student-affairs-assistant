-- 增量迁移：不修改私人事项联系人，不导入 seed，不自动公开联系人。
begin;
alter table public.contacts add column if not exists notice_import_id uuid references public.knowledge_imports(id);
alter table public.contacts add column if not exists reviewed_by text;
alter table public.contacts add column if not exists reviewed_at timestamptz;
alter table public.contacts add column if not exists reviewed_scope text;
alter table public.contacts add column if not exists review_status text not null default 'pending';
alter table public.knowledge_imports add column if not exists contacts_version integer not null default 0;
alter table public.contacts drop constraint if exists contacts_notice_scope_check;
alter table public.contacts add constraint contacts_notice_scope_check check (
 (scope='category' and notice_event_id is null and notice_import_id is null) or
 (scope='notice' and notice_event_id is not null and notice_import_id is null and nullif(btrim(source_excerpt),'') is not null and source_hash is not null) or
 (scope='import' and notice_event_id is null and notice_import_id is not null and nullif(btrim(source_excerpt),'') is not null
  and source_hash is not null and source_url is not null and reviewed_by is not null and reviewed_at is not null and reviewed_scope is not null
  and review_status in ('confirmed','revoked'))
);
create index if not exists contacts_public_import_idx on public.contacts(notice_import_id) where scope='import';
create unique index if not exists contacts_public_identity_idx on public.contacts(notice_import_id,lower(coalesce(email,'')),coalesce(phone,''),name) where scope='import';
create or replace function public.review_import_contact(p_batch_id uuid,p_expected_version integer,p_snapshot jsonb,p_hash text,p_actor text,p_scope text,p_contact jsonb,p_action text)
returns jsonb language plpgsql set search_path=public as $$
declare b knowledge_imports%rowtype; c contacts%rowtype; cid uuid;
begin
 select * into b from knowledge_imports where id=p_batch_id for update;
 if not found or b.contacts_version<>p_expected_version then raise exception 'PUBLIC_CONTACT_CONFLICT'; end if;
 if jsonb_build_object('source_url',b.source_url,'title',b.title,'source_text',b.source_text,'published_date',b.published_date,
   'date_candidates',b.date_candidates,'attachments',b.attachments)<>p_snapshot then raise exception 'PUBLIC_CONTACT_SOURCE_CHANGED'; end if;
 cid:=(p_contact->>'id')::uuid;
 if p_action='revoke' then
   update contacts set review_status='revoked',reviewed_by=p_actor,reviewed_at=now() where id=cid and scope='import' and notice_import_id=b.id;
   if not found then raise exception 'PUBLIC_CONTACT_NOT_FOUND'; end if;
 elsif p_action='approve' then
   if nullif(btrim(p_contact->>'source_excerpt'),'') is null or position(p_contact->>'source_excerpt' in b.source_text)=0
     or position((p_contact->>'name') in (p_contact->>'source_excerpt'))=0
     or (p_contact->>'email' is not null and position((p_contact->>'email') in (p_contact->>'source_excerpt'))=0)
     or (p_contact->>'phone' is not null and position((p_contact->>'phone') in (p_contact->>'source_excerpt'))=0) then raise exception 'PUBLIC_CONTACT_EVIDENCE'; end if;
   select * into c from contacts where id=cid for update;
   if found and (c.scope<>'import' or c.notice_import_id<>b.id) then raise exception 'PUBLIC_CONTACT_CONFLICT'; end if;
   insert into contacts(id,category_id,name,role,email,phone,office,office_hours,scope,notice_import_id,source_url,source_excerpt,source_hash,reviewed_scope,reviewed_by,reviewed_at,review_status)
   values(cid,(p_contact->>'category_id')::uuid,p_contact->>'name',p_contact->>'role',p_contact->>'email',p_contact->>'phone',null,null,'import',b.id,b.source_url,p_contact->>'source_excerpt',p_hash,p_scope,p_actor,now(),'confirmed')
   on conflict(id) do update set category_id=excluded.category_id,name=excluded.name,role=excluded.role,email=excluded.email,phone=excluded.phone,office=null,office_hours=null,source_url=excluded.source_url,source_excerpt=excluded.source_excerpt,
     source_hash=excluded.source_hash,reviewed_scope=excluded.reviewed_scope,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,review_status='confirmed';
 else raise exception 'PUBLIC_CONTACT_ACTION'; end if;
 update knowledge_imports set contacts_version=contacts_version+1 where id=b.id;
 return jsonb_build_object('id',cid,'contacts_version',b.contacts_version+1);
end $$;
revoke all on function public.review_import_contact(uuid,integer,jsonb,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.review_import_contact(uuid,integer,jsonb,text,text,text,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
