-- 阶段三：事项由学生确认后保存；通知原文最长 20000 字。
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 300),
  summary text not null default '',
  eligibility text not null default '',
  deadline timestamptz,
  deadline_source_text text,
  deadline_inferred boolean not null default false,
  submit_to text not null default '',
  materials jsonb not null default '[]'::jsonb check (jsonb_typeof(materials) = 'array'),
  source_url text check (source_url is null or length(source_url) <= 2000),
  source_text text not null check (length(source_text) between 1 and 20000),
  publish_date date,
  status text not null default 'active' check (status in ('active','done','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_device_deadline_idx on events(device_id, deadline asc nulls last);

create or replace function update_event_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_updated_at on events;
create trigger events_updated_at before update on events
for each row execute function update_event_timestamp();
