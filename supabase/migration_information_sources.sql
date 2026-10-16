-- Run after migration_knowledge_publish_version.sql. Re-runnable and additive.
create table if not exists information_sources (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null,
  name text not null, url text not null, kind text not null check (kind in ('article','column')),
  last_checked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,url)
);
create table if not exists source_links (
  id uuid primary key default gen_random_uuid(), source_id uuid not null references information_sources(id) on delete cascade,
  owner_id uuid not null, url text not null, title text not null, discovered_at timestamptz not null,
  unique(source_id,url)
);
create table if not exists source_articles (
  id uuid primary key default gen_random_uuid(), source_id uuid not null references information_sources(id) on delete cascade,
  owner_id uuid not null, url text not null, title text not null, source_text text not null,
  published_date date, fetched_at timestamptz not null, content_hash text not null,
  completeness text not null check (completeness = 'complete'), revision integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(source_id,url)
);
create table if not exists source_article_versions (
  id uuid primary key default gen_random_uuid(), article_id uuid not null references source_articles(id) on delete cascade,
  owner_id uuid not null, revision integer not null, source_text text not null, content_hash text not null,
  fetched_at timestamptz not null, unique(article_id,revision)
);
alter table events add column if not exists source_article_id uuid references source_articles(id) on delete set null;
alter table events add column if not exists source_fetched_at timestamptz;
alter table events add column if not exists source_confirmed_at timestamptz;
alter table events add column if not exists publish_date_source text;
create index if not exists information_sources_owner_idx on information_sources(owner_id);
create index if not exists source_articles_owner_idx on source_articles(owner_id,source_id);
create or replace function enforce_information_source_limit() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 0));
  if (select count(*) from information_sources where owner_id = new.owner_id) >= 5 then
    raise exception 'source_limit';
  end if;
  return new;
end $$;
drop trigger if exists information_sources_limit on information_sources;
create trigger information_sources_limit before insert on information_sources
for each row execute function enforce_information_source_limit();
alter table information_sources enable row level security;
alter table source_links enable row level security;
alter table source_articles enable row level security;
alter table source_article_versions enable row level security;
revoke all on information_sources, source_links, source_articles, source_article_versions from public, anon, authenticated;
grant select, insert, update, delete on information_sources, source_links, source_articles, source_article_versions to service_role;
