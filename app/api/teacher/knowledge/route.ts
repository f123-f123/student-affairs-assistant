import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE, textField } from '@/lib/validation';
import { badRequest, noStore, serviceUnavailable, teacherAuthorized, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await teacherAuthorized()) return unauthorized();
  try {
    const db = getSupabase();
    const [categories, items] = await Promise.all([
      db.from('categories').select('id,name').order('sort_order'),
      db.from('knowledge_items').select('id,category_id,question,answer,aliases,source_name,source_level,source_url,source_excerpt,valid_from,valid_until,version,reviewed_at,reviewed_by,status,updated_at,categories(name)')
        .order('updated_at', { ascending: false }),
    ]);
    if (categories.error || items.error) return serviceUnavailable();
    return NextResponse.json({ categories: categories.data, items: items.data }, { headers: noStore });
  } catch { return serviceUnavailable(); }
}

export async function POST(request: Request) {
  if (!await teacherAuthorized()) return unauthorized();
  let input: unknown;
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest('请求格式无效');
  const fields = input as Record<string, unknown>;
  const question = textField(fields.question, 500);
  const answer = textField(fields.answer, 4000);
  const categoryId = fields.category_id;
  const rawUrl = fields.source_url;
  const sourceName = textField(fields.source_name, 200);
  const sourceExcerpt = typeof fields.source_excerpt === 'string' ? fields.source_excerpt.trim() : '';
  const aliases = Array.isArray(fields.aliases) && fields.aliases.every(alias => typeof alias === 'string' && alias.trim().length <= 100)
    ? fields.aliases.map(alias => (alias as string).trim()).filter(Boolean).slice(0, 20) : null;
  const validFrom = fields.valid_from === null || fields.valid_from === '' ? null : fields.valid_from;
  const validUntil = fields.valid_until === null || fields.valid_until === '' ? null : fields.valid_until;
  const supersedes = fields.supersedes == null || fields.supersedes === '' ? null : fields.supersedes;
  const originEventId = fields.origin_event_id == null || fields.origin_event_id === '' ? null : fields.origin_event_id;
  if (!question || !answer || !sourceName || sourceExcerpt.length > 10000 || !aliases ||
      (validFrom !== null && (typeof validFrom !== 'string' || !Number.isFinite(Date.parse(validFrom)))) ||
      (validUntil !== null && (typeof validUntil !== 'string' || !Number.isFinite(Date.parse(validUntil)))) ||
      (validFrom && validUntil && Date.parse(validFrom as string) >= Date.parse(validUntil as string)) ||
      (supersedes !== null && (typeof supersedes !== 'string' || !UUID_RE.test(supersedes))) ||
      (originEventId !== null && (typeof originEventId !== 'string' || !UUID_RE.test(originEventId))) ||
      typeof categoryId !== 'string' || !UUID_RE.test(categoryId) ||
      !(rawUrl === null || rawUrl === undefined || typeof rawUrl === 'string')) return badRequest('知识内容无效');
  const sourceUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!sourceUrl && !sourceExcerpt) return badRequest('请填写来源链接或原文依据');
  if (sourceUrl) {
    try { if (sourceUrl.length > 2000 || !['http:', 'https:'].includes(new URL(sourceUrl).protocol)) return badRequest('来源链接无效'); }
    catch { return badRequest('来源链接无效'); }
  }
  try {
    const db = getSupabase();
    const category = await db.from('categories').select('id').eq('id', categoryId).maybeSingle();
    if (category.error) return serviceUnavailable();
    if (!category.data) return badRequest('类别不存在');
    if (originEventId) {
      const event = await db.from('events').select('id,source_text').eq('id', originEventId).maybeSingle();
      if (event.error) return serviceUnavailable();
      if (!event.data) return badRequest('通知不存在');
      if (!sourceExcerpt || !event.data.source_text.includes(sourceExcerpt)) return badRequest('原文依据须摘自该通知');
    }
    if (supersedes) {
      const previous = await db.from('knowledge_items').select('id').eq('id', supersedes).eq('status', 'confirmed').eq('category_id', categoryId).maybeSingle();
      if (previous.error) return serviceUnavailable();
      if (!previous.data) return badRequest('替换条目已失效', 409);
    }
    const saved = await db.from('knowledge_items').insert({
      category_id: categoryId, question, answer, source_level: 1,
      source_name: sourceName, source_url: sourceUrl || null, source_excerpt: sourceExcerpt || null,
      aliases, valid_from: validFrom, valid_until: validUntil, supersedes, origin_event_id: originEventId, status: 'draft',
    }).select('id').single();
    if (saved.error) return serviceUnavailable();
    return NextResponse.json({ id: saved.data.id }, { status: 201, headers: noStore });
  } catch { return serviceUnavailable(); }
}
