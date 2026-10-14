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
      db.from('knowledge_items').select('id,category_id,question,answer,source_name,source_level,source_url,updated_at,categories(name)')
        .eq('status', 'confirmed').order('updated_at', { ascending: false }),
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
  if (!question || !answer || typeof categoryId !== 'string' || !UUID_RE.test(categoryId) ||
      !(rawUrl === null || rawUrl === undefined || typeof rawUrl === 'string')) return badRequest('知识内容无效');
  const sourceUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (sourceUrl) {
    try { if (sourceUrl.length > 2000 || !['http:', 'https:'].includes(new URL(sourceUrl).protocol)) return badRequest('来源链接无效'); }
    catch { return badRequest('来源链接无效'); }
  }
  try {
    const db = getSupabase();
    const category = await db.from('categories').select('id').eq('id', categoryId).maybeSingle();
    if (category.error) return serviceUnavailable();
    if (!category.data) return badRequest('类别不存在');
    const duplicate = await db.from('knowledge_items').select('id').eq('status', 'confirmed').eq('question', question).maybeSingle();
    if (duplicate.error) return serviceUnavailable();
    if (duplicate.data) return badRequest('该问题已有已确认条目，请通过工单替换旧条目', 409);
    // 老师手工确认的内容立即成为问答依据，所有密钥和联系人都留在服务端。
    const saved = await db.from('knowledge_items').insert({
      category_id: categoryId, question, answer, source_level: 1,
      source_name: '老师确认回答', source_url: sourceUrl || null, status: 'confirmed',
    }).select('id').single();
    if (saved.error) return serviceUnavailable();
    return NextResponse.json({ id: saved.data.id }, { status: 201, headers: noStore });
  } catch { return serviceUnavailable(); }
}
