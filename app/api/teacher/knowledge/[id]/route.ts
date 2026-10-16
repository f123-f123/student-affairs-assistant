import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE, textField } from '@/lib/validation';
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
    const current = await db.from('knowledge_items').select('id,status,version').eq('id', id).maybeSingle();
    if (current.error) return serviceUnavailable();
    if (!current.data) return badRequest('条目不存在', 404);
    if (input.version !== current.data.version) return badRequest('条目已更新，请刷新', 409);
    if (action === 'publish') {
      if (current.data.status !== 'draft') return badRequest('只能审核发布草稿', 409);
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
      const question = textField(input.question, 500);
      const answer = textField(input.answer, 4000);
      const sourceName = textField(input.source_name, 200);
      const rawUrl = input.source_url;
      const validFrom = input.valid_from === '' || input.valid_from === null ? null : input.valid_from;
      const validUntil = input.valid_until === '' || input.valid_until === null ? null : input.valid_until;
      if (!question || !answer || !sourceName || typeof input.source_excerpt !== 'string' || input.source_excerpt.length > 10000 ||
          !Array.isArray(input.aliases) || !input.aliases.every(a => typeof a === 'string' && a.length <= 100) ||
          !(rawUrl === null || rawUrl === '' || (typeof rawUrl === 'string' && rawUrl.length <= 2000 && /^https?:\/\//.test(rawUrl))) ||
          (validFrom !== null && (typeof validFrom !== 'string' || !Number.isFinite(Date.parse(validFrom)))) ||
          (validUntil !== null && (typeof validUntil !== 'string' || !Number.isFinite(Date.parse(validUntil)))) ||
          (validFrom && validUntil && Date.parse(validFrom as string) >= Date.parse(validUntil as string)) ||
          typeof input.category_id !== 'string' || !UUID_RE.test(input.category_id)) return badRequest('知识内容无效');
      if (!rawUrl && !input.source_excerpt) return badRequest('请填写来源链接或原文依据');
      const result = await db.from('knowledge_items').update({ question, answer, source_name: sourceName,
        source_url: rawUrl || null, source_excerpt: input.source_excerpt || null, aliases: input.aliases,
        valid_from: validFrom, valid_until: validUntil, category_id: input.category_id })
        .eq('id', id).eq('status', 'draft').eq('version', input.version).select('id');
      if (result.error) return serviceUnavailable();
      if (!result.data?.length) return badRequest('条目已更新，请刷新', 409);
    } else return badRequest('操作无效');
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch { return serviceUnavailable(); }
}
