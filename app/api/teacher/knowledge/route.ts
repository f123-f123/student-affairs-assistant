import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { KnowledgeInputError, parseKnowledgeInput, validateKnowledgeReferences } from '@/lib/knowledge-input';
import { badRequest, noStore, serviceUnavailable, teacherAuthorized, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  if (!await teacherAuthorized()) return unauthorized();
  try {
    const db = getSupabase();
    const params = new URL(request?.url || 'http://localhost').searchParams;
    const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1));
    const status = params.get('status') || 'all';
    let query = db.from('knowledge_items').select('id,category_id,question,answer,aliases,source_name,source_level,source_url,source_excerpt,valid_from,valid_until,supersedes,origin_event_id,version,reviewed_at,reviewed_by,status,updated_at,categories(name)', { count: 'exact' });
    if (status !== 'all') query = query.in('status', status === 'inactive' ? ['inactive', 'superseded'] : status === 'confirmed' ? ['confirmed'] : ['draft']);
    const [categories, items] = await Promise.all([
      db.from('categories').select('id,name').order('sort_order'),
      query.order('updated_at', { ascending: false }).order('id').range((page - 1) * 20, page * 20 - 1),
    ]);
    if (categories.error || items.error) return serviceUnavailable();
    return NextResponse.json({ categories: categories.data, items: items.data, total: items.count, page, page_size: 20 }, { headers: noStore });
  } catch { return serviceUnavailable(); }
}

export async function POST(request: Request) {
  if (!await teacherAuthorized()) return unauthorized();
  let input: unknown;
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  try {
    const fields = parseKnowledgeInput(input);
    const db = getSupabase();
    await validateKnowledgeReferences(db, fields);
    const saved = await db.from('knowledge_items').insert({ ...fields, source_level: 1, status: 'draft' }).select('id').single();
    if (saved.error) return serviceUnavailable();
    return NextResponse.json({ id: saved.data.id }, { status: 201, headers: noStore });
  } catch (error) { return error instanceof KnowledgeInputError ? badRequest(error.message, error.status) : serviceUnavailable(); }
}
