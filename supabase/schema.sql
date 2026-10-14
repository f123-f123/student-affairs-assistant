create extension if not exists pgcrypto;

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null,
  sort_order integer not null default 0
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  name text not null,
  role text not null check (role in ('teacher', 'student_leader')),
  phone text,
  email text,
  office text,
  office_hours text
);

create table if not exists knowledge_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  question text not null,
  answer text not null,
  source_level integer not null check (source_level between 1 and 3),
  source_name text not null,
  source_url text,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'superseded')),
  supersedes uuid references knowledge_items(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  question text not null,
  category_id uuid references categories(id),
  status text not null default 'open' check (status in ('open', 'answered')),
  teacher_reply text,
  sedimented boolean not null default false,
  knowledge_item_id uuid references knowledge_items(id),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create table if not exists chat_logs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid,
  question text not null,
  answerable boolean not null,
  category_id uuid references categories(id),
  cited_item_ids uuid[] not null default '{}',
  error_type text,
  created_at timestamptz not null default now()
);

create index if not exists contacts_category_idx on contacts(category_id);
create index if not exists knowledge_confirmed_priority_idx on knowledge_items(source_level, updated_at desc) where status = 'confirmed';
create index if not exists knowledge_category_status_idx on knowledge_items(category_id, status);
create index if not exists tickets_device_created_idx on tickets(device_id, created_at desc);
create index if not exists tickets_status_idx on tickets(status, created_at desc);
create index if not exists chat_logs_device_created_idx on chat_logs(device_id, created_at desc);

create or replace function update_knowledge_item_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists knowledge_items_updated_at on knowledge_items;
create trigger knowledge_items_updated_at before update on knowledge_items
for each row execute function update_knowledge_item_timestamp();
