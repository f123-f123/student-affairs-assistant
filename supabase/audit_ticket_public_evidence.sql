-- 只读排查；在有权限的服务端/SQL Editor 执行。只输出 ID、版本和计数，绝不输出原始文本。
-- 非空依据仅表示需要审核，不等于已含个人信息；完整相等是旧自动复制的高置信信号。
begin read only;
with linked as (
  select t.id ticket_id,t.knowledge_item_id item_id,t.teacher_reply,k.source_excerpt
  from tickets t join knowledge_items k on k.id=t.knowledge_item_id
), current_risk as (
  select ticket_id,item_id,source_excerpt=teacher_reply exact_current_reply_copy
  from linked where nullif(btrim(source_excerpt),'') is not null
)
select * from current_risk order by ticket_id;

select v.item_id,v.version,
  count(*) filter(where nullif(btrim(v.snapshot->>'source_excerpt'),'') is not null) as snapshots_with_excerpt,
  bool_or(v.snapshot->>'source_excerpt'=t.teacher_reply) as exact_current_reply_copy
from knowledge_item_versions v join tickets t on t.knowledge_item_id=v.item_id
where nullif(btrim(v.snapshot->>'source_excerpt'),'') is not null
group by v.item_id,v.version order by v.item_id,v.version;

-- 同时检查引用的 question/answer/source_excerpt/最终回答；这里只列含关联引用的快照，内容须权限内人工审核。
select l.id chat_log_id,c->>'id' item_id,c->>'version' citation_version,
  nullif(btrim(c->>'source_excerpt'),'') is not null as has_excerpt,
  c->>'source_excerpt'=t.teacher_reply as exact_current_reply_copy
from chat_logs l
cross join lateral jsonb_array_elements(case when jsonb_typeof(l.response_json->'citations')='array' then l.response_json->'citations' else '[]'::jsonb end) c
join tickets t on t.knowledge_item_id::text=c->>'id'
order by l.id;
rollback;
