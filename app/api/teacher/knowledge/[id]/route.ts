import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE } from '@/lib/validation';
import { KnowledgeInputError, parseKnowledgeInput, validateKnowledgeReferences } from '@/lib/knowledge-input';
import { badRequest, noStore, serviceUnavailable, teacherAuthorized, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  if (!await teacherAuthorized()) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return badRequest('条目编号无效');
  try {
    const db = getSupabase();
    const [item, history] = await Promise.all([
      db.from('knowledge_items').select('*').eq('id', id).maybeSingle(),
      db.from('knowledge_item_versions').select('version,snapshot,archived_at').eq('item_id', id).order('version', { ascending: false }),
    ]);
    if (item.error || history.error) return serviceUnavailable();
    if (!item.data) return badRequest('条目不存在', 404);
    return NextResponse.json({ item: item.data, history: history.data }, { headers: noStore });
  } catch { return serviceUnavailable(); }
}

export async function PATCH(request: Request, context: Context) {
  if (!await teacherAuthorized()) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return badRequest('条目编号无效');
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest('请求格式无效');
  const action = input.action;
  try {
    const db = getSupabase();
    const current = await db.from('knowledge_items').select('*').eq('id', id).maybeSingle();
    if (current.error) return serviceUnavailable();
    if (!current.data) return badRequest('条目不存在', 404);
    if (input.version !== current.data.version) return badRequest('条目已更新，请刷新', 409);
    if (action === 'publish') {
      if (current.data.status !== 'draft') return badRequest('只能审核发布草稿', 409);
      await validateKnowledgeReferences(db, parseKnowledgeInput(current.data));
      const result = await db.rpc('publish_knowledge_item', { p_id: id, p_expected_version: input.version });
      if (result.error?.message.includes('version_conflict')) return badRequest('条目已更新，请刷新', 409);
      if (result.error?.message.includes('invalid_')) return badRequest('草稿或替换目标已失效', 409);
      if (result.error) return serviceUnavailable();
    } else if (action === 'disable') {
      if (current.data.status !== 'confirmed') return badRequest('只能停用已发布条目', 409);
      const result = await db.from('knowledge_items').update({ status: 'inactive' }).eq('id', id).eq('status', 'confirmed').eq('version', input.version).select('id');
      if (result.error) return serviceUnavailable();
      if (!result.data?.length) return badRequest('条目已更新，请刷新', 409);
    } else if (action === 'edit') {
      if (current.data.status !== 'draft') return badRequest('已发布条目请创建替换草稿', 409);
      // 编辑保留创建时的来源与替换关系，并重新核对依据。
      const fields = parseKnowledgeInput({ ...input, supersedes: current.data.supersedes, origin_event_id: current.data.origin_event_id });
      await validateKnowledgeReferences(db, fields);
      const result = await db.from('knowledge_items').update(fields)
        .eq('id', id).eq('status', 'draft').eq('version', input.version).select('id');
      if (result.error) return serviceUnavailable();
      if (!result.data?.length) return badRequest('条目已更新，请刷新', 409);
    } else return badRequest('操作无效');
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) { return error instanceof KnowledgeInputError ? badRequest(error.message, error.status) : serviceUnavailable(); }
}
