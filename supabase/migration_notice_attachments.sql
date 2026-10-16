-- Run after migration_source_article_atomic.sql. Keep legacy snapshots as unknown attachment coverage.
begin;
alter table source_articles drop constraint if exists source_articles_completeness_check;
alter table source_articles add constraint source_articles_completeness_check check (completeness in ('complete','body_only'));
alter table source_articles add column if not exists attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array');
alter table source_article_versions add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table source_article_versions add column if not exists completeness text not null default 'legacy_unknown';

create or replace function save_source_article(
  p_owner_id uuid, p_source_id uuid, p_url text, p_title text, p_source_text text,
  p_published_date date, p_fetched_at timestamptz, p_content_hash text, p_completeness text,
  p_attachments jsonb default '[]'::jsonb
) returns jsonb language plpgsql as $$
declare v_article source_articles%rowtype; v_id uuid; v_archived_hash text;
begin
  if jsonb_typeof(p_attachments) is distinct from 'array' then raise exception 'invalid_attachments'; end if;
  perform 1 from information_sources where id = p_source_id and owner_id = p_owner_id for update;
  if not found then raise exception 'source_not_found'; end if;
  select * into v_article from source_articles where source_id = p_source_id and url = p_url for update;
  if found then
    if v_article.owner_id <> p_owner_id then raise exception 'source_not_found'; end if;
    if v_article.content_hash = p_content_hash then
      return jsonb_build_object('status','unchanged','id',v_article.id,'title',v_article.title);
    end if;
    select content_hash into v_archived_hash from source_article_versions where article_id = v_article.id and revision = v_article.revision;
    if found and v_archived_hash <> v_article.content_hash then raise exception 'archive_conflict'; end if;
    insert into source_article_versions(article_id,owner_id,revision,source_text,content_hash,fetched_at,attachments,completeness)
      values(v_article.id,p_owner_id,v_article.revision,v_article.source_text,v_article.content_hash,v_article.fetched_at,v_article.attachments,v_article.completeness)
      on conflict(article_id,revision) do nothing;
    update source_articles set title=p_title,source_text=p_source_text,published_date=p_published_date,
      fetched_at=p_fetched_at,content_hash=p_content_hash,completeness=p_completeness,attachments=p_attachments,
      revision=v_article.revision+1,updated_at=now() where id=v_article.id;
    return jsonb_build_object('status','updated','id',v_article.id,'title',p_title);
  end if;
  insert into source_articles(source_id,owner_id,url,title,source_text,published_date,fetched_at,content_hash,completeness,attachments)
    values(p_source_id,p_owner_id,p_url,p_title,p_source_text,p_published_date,p_fetched_at,p_content_hash,p_completeness,p_attachments)
    returning id into v_id;
  return jsonb_build_object('status','new','id',v_id,'title',p_title);
end $$;
drop function if exists save_source_article(uuid,uuid,text,text,text,date,timestamptz,text,text);
revoke all on function save_source_article(uuid,uuid,text,text,text,date,timestamptz,text,text,jsonb) from public, anon, authenticated;
grant execute on function save_source_article(uuid,uuid,text,text,text,date,timestamptz,text,text,jsonb) to service_role;
commit;
