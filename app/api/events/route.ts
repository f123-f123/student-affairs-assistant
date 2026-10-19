import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { parseEventInput } from '@/lib/event-input';
import { getCurrentUser } from '@/lib/auth';
import { unauthorized } from '@/lib/teacher-api';
import { UUID_RE } from '@/lib/validation';
import { databaseFailure } from '@/lib/database-failure';
import { attachEventContacts, noticeSchemaMissing } from '@/lib/contact-storage';
import type { StudentEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  try {
    const db = getSupabase();
    const result = await db.from('events').select('*').eq('device_id', user.id)
      .order('deadline', { ascending: true, nullsFirst: false });
    if (result.error) throw result.error;
    return NextResponse.json({ events: await attachEventContacts(db, (result.data || []) as StudentEvent[]) }, { headers });
  } catch (cause) { return databaseFailure('events.list', cause); }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  let input: unknown;
  try { input = await request.json(); } catch { return error('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return error('请求格式无效');
  const fields = input as Record<string, unknown>;
  let event;
  try { event = parseEventInput(fields.event); } catch (err) { return error(err instanceof Error ? err.message : '事项内容无效'); }
  if (event.deadline ? fields.deadline_confirmed !== true : fields.no_deadline_confirmed !== true) return error('请先确认截止时间，或明确选择无截止时间');
  try {
    const db = getSupabase();
    let sourceArticleId: string | null = null;
    let sourceFetchedAt: string | null = null;
    if (fields.source_article_id !== undefined) {
      if (typeof fields.source_article_id !== 'string' || !UUID_RE.test(fields.source_article_id)) return error('文章编号无效');
      const article = await db.from('source_articles').select('id,source_text,fetched_at').eq('id', fields.source_article_id).eq('owner_id', user.id).maybeSingle();
      if (article.error) throw article.error;
      if (!article.data || article.data.source_text !== event.source_text) return error('文章原文已变化，请重新核对', 409);
      sourceArticleId = article.data.id;
      sourceFetchedAt = article.data.fetched_at;
    }
    const fetchedAt = sourceFetchedAt || (typeof fields.source_fetched_at === 'string' && Number.isFinite(Date.parse(fields.source_fetched_at)) ? fields.source_fetched_at : null);
    if (event.category_id) {
      const category = await db.from('categories').select('id').eq('id', event.category_id).maybeSingle();
      if (category.error) throw category.error;
      if (!category.data) return error('事项类别不存在');
    }
    const dateSource = event.date_context?.basis || (['page', 'signature', 'user'].includes(String(fields.publish_date_source)) ? fields.publish_date_source : 'unknown');
    const result = await db.from('events').insert({ ...event, device_id: user.id, source_article_id: sourceArticleId,
      source_fetched_at: fetchedAt, source_confirmed_at: new Date().toISOString(), publish_date_source: dateSource }).select('id').single();
    if (noticeSchemaMissing(result.error)) return NextResponse.json({ error: '日期依据和通知联系人持久化需要先部署 migration_event_notice_context.sql', code: 'EVENT_NOTICE_SCHEMA_REQUIRED' }, { status: 503, headers });
    if (result.error) throw result.error;
    return NextResponse.json({ id: result.data.id }, { status: 201, headers });
  } catch { return error('服务暂时不可用', 503); }
}
