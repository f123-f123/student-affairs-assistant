-- 前置：migration_knowledge_library.sql、migration_official_knowledge_import.sql。
-- 仅更新函数和权限；不修改历史知识、版本或聊天快照。旧应用应先停止工单入库。
begin;
-- 发布时的回复快照与版本仅留在受保护的工单，后续编辑回复不改变此追溯记录。
alter table public.tickets add column if not exists knowledge_reply_version integer;
alter table public.tickets add column if not exists knowledge_reply_snapshot text;
create or replace function public.confirm_ticket_knowledge_public_checked(
  p_ticket_id uuid,p_question text,p_answer text,p_category_id uuid,p_supersedes uuid,
  p_expected_reply_version integer,p_expected_reply text,p_actor text,
  p_public_excerpt text,p_public_reviewed boolean
) returns uuid language plpgsql set search_path=public as $$
declare t tickets%rowtype; result uuid;
begin
  if p_public_reviewed is distinct from true or nullif(btrim(p_actor),'') is null then raise exception 'public_review_required'; end if;
  if length(p_public_excerpt)>4000 then raise exception 'invalid_public_excerpt'; end if;
  select * into t from tickets where id=p_ticket_id for update;
  if not found then raise exception 'ticket_not_found'; end if;
  if p_expected_reply_version is null or p_expected_reply_version<0 or t.reply_version<>p_expected_reply_version or t.teacher_reply is distinct from p_expected_reply then raise exception 'reply_version_conflict'; end if;
  if not exists(select 1 from categories where id=p_category_id) then raise exception 'invalid_category'; end if;
  result:=confirm_ticket_knowledge(p_ticket_id,p_question,p_answer,p_category_id,p_supersedes);
  update knowledge_items set reviewed_by=p_actor,source_excerpt=nullif(btrim(p_public_excerpt),'') where id=result;
  update tickets set knowledge_reply_version=t.reply_version,knowledge_reply_snapshot=t.teacher_reply where id=p_ticket_id;
  return result;
end $$;

-- 关闭旧入口的原文复制行为；旧客户端必须更新，禁止无声退回旧发布。
create or replace function public.confirm_ticket_knowledge_checked(
  p_ticket_id uuid,p_question text,p_answer text,p_category_id uuid,p_supersedes uuid,
  p_expected_reply_version integer,p_expected_reply text,p_actor text
) returns uuid language plpgsql set search_path=public as $$
begin
  raise exception 'public_review_required';
end $$;
revoke all on function public.confirm_ticket_knowledge_public_checked(uuid,text,text,uuid,uuid,integer,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.confirm_ticket_knowledge_public_checked(uuid,text,text,uuid,uuid,integer,text,text,text,boolean) to service_role;
revoke all on function public.confirm_ticket_knowledge_checked(uuid,text,text,uuid,uuid,integer,text,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
