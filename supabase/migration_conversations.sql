-- 在已执行的阶段一至三脚本之后运行；旧问答按设备归入一个历史对话。
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  title text not null default '新对话' check (length(title) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table chat_logs add column if not exists response_json jsonb;
alter table chat_logs add column if not exists conversation_id uuid references conversations(id);
create index if not exists conversations_device_updated_idx on conversations(device_id, updated_at desc);
create index if not exists chat_logs_conversation_created_idx on chat_logs(conversation_id, created_at desc);

create or replace function update_conversation_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists conversations_updated_at on conversations;
create trigger conversations_updated_at before update on conversations
for each row execute function update_conversation_timestamp();

do $$
begin
  create temporary table legacy_conversations on commit drop as
  select device_id, gen_random_uuid() as id, min(created_at) as first_at, max(created_at) as last_at
  from chat_logs where device_id is not null and conversation_id is null group by device_id;

  insert into conversations (id, device_id, title, created_at, updated_at)
  select id, device_id, '历史对话', first_at, last_at from legacy_conversations;

  update chat_logs log set conversation_id = legacy.id
  from legacy_conversations legacy
  where log.device_id = legacy.device_id and log.conversation_id is null;
end;
$$;
