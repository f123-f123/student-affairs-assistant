-- Run after migration_knowledge_publish_version.sql. Approval is immediate; replacement takes effect at valid_from.
-- Repair any future-dated replacement published by the previous function without touching unrelated rows.
update knowledge_items old_item set status = 'confirmed'
from knowledge_items replacement
where replacement.supersedes = old_item.id and replacement.status = 'confirmed'
  and replacement.valid_from > now() and old_item.status = 'superseded';

create or replace function publish_knowledge_item(p_id uuid, p_expected_version integer)
returns void language plpgsql as $$
declare v_item knowledge_items%rowtype; v_old knowledge_items%rowtype;
begin
  select * into v_item from knowledge_items where id = p_id for update;
  if not found or v_item.status <> 'draft' then raise exception 'invalid_draft'; end if;
  if p_expected_version is null or v_item.version <> p_expected_version then raise exception 'version_conflict'; end if;
  if v_item.supersedes is not null then
    select * into v_old from knowledge_items where id = v_item.supersedes and status = 'confirmed' for update;
    if not found or v_old.category_id <> v_item.category_id then raise exception 'invalid_supersedes'; end if;
    if v_item.valid_from is null or v_item.valid_from <= now() then
      update knowledge_items set status = 'superseded' where id = v_item.supersedes;
    end if;
  end if;
  update knowledge_items set status = 'confirmed', reviewed_at = now(), reviewed_by = null where id = p_id;
end $$;
revoke all on function publish_knowledge_item(uuid, integer) from public, anon, authenticated;
grant execute on function publish_knowledge_item(uuid, integer) to service_role;
