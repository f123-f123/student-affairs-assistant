-- 阶段二迁移：先执行阶段一 schema.sql 和 seed.sql，再执行本文件。
create table if not exists teacher_login_attempts (
  key text primary key,
  attempts integer not null default 0,
  window_start timestamptz not null default now()
);

create or replace function record_teacher_login_failure(p_key text)
returns integer language plpgsql as $$
declare v_attempts integer;
begin
  insert into teacher_login_attempts (key, attempts, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    attempts = case when teacher_login_attempts.window_start < now() - interval '15 minutes'
      then 1 else teacher_login_attempts.attempts + 1 end,
    window_start = case when teacher_login_attempts.window_start < now() - interval '15 minutes'
      then now() else teacher_login_attempts.window_start end
  returning attempts into v_attempts;
  return v_attempts;
end;
$$;

create or replace function confirm_ticket_knowledge(
  p_ticket_id uuid,
  p_question text,
  p_answer text,
  p_category_id uuid,
  p_supersedes uuid default null
)
returns uuid language plpgsql as $$
declare
  v_ticket tickets%rowtype;
  v_old knowledge_items%rowtype;
  v_new_id uuid;
begin
  -- 行锁串行化同一工单的重复确认；函数内任一步失败会整体回滚。
  select * into v_ticket from tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket_not_found'; end if;
  if v_ticket.sedimented then raise exception 'already_sedimented'; end if;
  if v_ticket.status <> 'answered' or nullif(btrim(v_ticket.teacher_reply), '') is null then
    raise exception 'ticket_not_answered';
  end if;
  if nullif(btrim(p_question), '') is null or length(p_question) > 500
    or nullif(btrim(p_answer), '') is null or length(p_answer) > 4000 then
    raise exception 'invalid_knowledge';
  end if;
  if p_supersedes is not null then
    select * into v_old from knowledge_items where id = p_supersedes for update;
    if not found or v_old.status <> 'confirmed' or v_old.category_id <> p_category_id then
      raise exception 'invalid_supersedes';
    end if;
  end if;
  insert into knowledge_items (category_id, question, answer, source_level, source_name, status, supersedes)
  values (p_category_id, btrim(p_question), btrim(p_answer), 1, '老师确认回答', 'confirmed', p_supersedes)
  returning id into v_new_id;
  if p_supersedes is not null then
    update knowledge_items set status = 'superseded' where id = p_supersedes;
  end if;
  update tickets set sedimented = true, knowledge_item_id = v_new_id where id = p_ticket_id;
  return v_new_id;
end;
$$;

-- 仅由持有 service role 的服务端调用，不向浏览器角色开放 RPC。
revoke all on function record_teacher_login_failure(text) from public, anon, authenticated;
revoke all on function confirm_ticket_knowledge(uuid,text,text,uuid,uuid) from public, anon, authenticated;
grant execute on function record_teacher_login_failure(text) to service_role;
grant execute on function confirm_ticket_knowledge(uuid,text,text,uuid,uuid) to service_role;

create index if not exists teacher_login_attempts_window_idx on teacher_login_attempts(window_start);
