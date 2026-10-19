import { NextResponse } from 'next/server';
import { getSupabase, safeDatabaseError } from '@/lib/supabase';
import { teacherAuthorized, unauthorized, noStore } from '@/lib/teacher-api';
import { parseContact } from '@/lib/contact-input';
import { UUID_RE } from '@/lib/validation';
import { categoryContacts, noticeContactFields, noticeSchemaMissing, sourceHash } from '@/lib/contact-storage';
import { noticeContactCandidates } from '@/lib/notice-contacts';

export const dynamic = 'force-dynamic';
const failure = (error: unknown) => {
  console.error('[teacher contacts]', safeDatabaseError(error));
  return NextResponse.json({ error: '负责人信息暂时无法读取或保存，请重试', code: 'CONTACTS_UNAVAILABLE' }, { status: 503, headers: noStore });
};
const migrationRequired = () => NextResponse.json({ error: '请先部署 migration_event_notice_context.sql，通知联系人不会退化成类别负责人', code: 'NOTICE_CONTACT_SCHEMA_REQUIRED' }, { status: 503, headers: noStore });
export async function GET(request?: Request) {
  if (!await teacherAuthorized()) return unauthorized();
  try {
    const db = getSupabase();
    const eventId = request ? new URL(request.url).searchParams.get('event_id') : null;
    if (eventId) {
      if (!UUID_RE.test(eventId)) return NextResponse.json({ error: '事项编号无效' }, { status: 400, headers: noStore });
      const event = await db.from('events').select('id,title,source_text,source_url').eq('id', eventId).maybeSingle();
      if (event.error) return failure(event.error);
      if (!event.data) return NextResponse.json({ error: '事项不存在' }, { status: 404, headers: noStore });
      const result = await db.from('contacts').select(noticeContactFields).eq('scope', 'notice').eq('notice_event_id', eventId).order('name');
      if (noticeSchemaMissing(result.error)) return migrationRequired();
      if (result.error) return failure(result.error);
      return NextResponse.json({ contacts: result.data, event: { id: event.data.id, title: event.data.title, source_url: event.data.source_url }, candidates: noticeContactCandidates(event.data.source_text), notice_supported: true }, { headers: noStore });
    }
    const result = await categoryContacts(db);
    if (result.error) return failure(result.error);
    return NextResponse.json({ contacts: result.data, notice_supported: result.notice_supported }, { headers: noStore });
  } catch (error) { return failure(error); }
}
async function save(request: Request, update: boolean) {
  if (!await teacherAuthorized()) return unauthorized();
  let input: unknown, fields: ReturnType<typeof parseContact>;
  try { input = await request.json(); fields = parseContact(input); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '负责人信息无效', code: 'INVALID_INPUT' }, { status: 400, headers: noStore }); }
  const id = (input as Record<string, unknown>).id;
  if (update && (typeof id !== 'string' || !UUID_RE.test(id))) return NextResponse.json({ error: '负责人 ID 无效' }, { status: 400, headers: noStore });
  try {
    const db = getSupabase();
    const data = input as Record<string, unknown>;
    let extra: Record<string, unknown> = {};
    if (data.scope === 'notice') {
      const capability = await db.from('contacts').select('scope,notice_event_id,source_excerpt,source_hash').limit(1);
      if (noticeSchemaMissing(capability.error)) return migrationRequired();
      if (capability.error) return failure(capability.error);
      if (typeof data.notice_event_id !== 'string' || !UUID_RE.test(data.notice_event_id) || data.confirm_source !== true || typeof data.source_excerpt !== 'string') return NextResponse.json({ error: '请核对本通知联系人及原文依据后确认' }, { status: 400, headers: noStore });
      const event = await db.from('events').select('id,source_text,source_url').eq('id', data.notice_event_id).maybeSingle();
      if (event.error) return failure(event.error);
      const candidate = event.data && event.data.source_text.includes(data.source_excerpt) && noticeContactCandidates(data.source_excerpt).some(candidate =>
        candidate.name === fields.name && candidate.email === fields.email && candidate.phone === fields.phone && candidate.role === fields.role);
      if (!candidate || fields.office || fields.office_hours) return NextResponse.json({ error: '姓名、角色和联系方式必须与所选通知原文候选一致；不得补写办公信息' }, { status: 400, headers: noStore });
      extra = { scope: 'notice', notice_event_id: data.notice_event_id, source_excerpt: data.source_excerpt, source_url: event.data!.source_url, source_hash: sourceHash(event.data!.source_text) };
    } else if (data.scope !== undefined && data.scope !== 'category') return NextResponse.json({ error: '联系人作用范围无效' }, { status: 400, headers: noStore });
    if (update) {
      const previous = await db.from('contacts').select('id,scope,notice_event_id').eq('id', id as string).maybeSingle();
      if (previous.error && !noticeSchemaMissing(previous.error)) return failure(previous.error);
      if (!previous.error && previous.data && (previous.data.scope !== (data.scope || 'category') || previous.data.notice_event_id !== (data.notice_event_id || null))) return NextResponse.json({ error: '不能更换已有联系人的作用范围或通知，请新增对应记录' }, { status: 409, headers: noStore });
    }
    const category = await db.from('categories').select('id').eq('id', fields.category_id).maybeSingle();
    if (category.error) return failure(category.error);
    if (!category.data) return NextResponse.json({ error: '类别不存在' }, { status: 400, headers: noStore });
    const result = await (update ? db.from('contacts').update({ ...fields, ...extra }).eq('id', id as string) : db.from('contacts').insert({ ...fields, ...extra })).select('id').maybeSingle();
    if (result.error?.code === '23505') return NextResponse.json({ error: '该通知联系人已存在，请编辑已有记录' }, { status: 409, headers: noStore });
    if (result.error) return failure(result.error);
    if (!result.data) return NextResponse.json({ error: '负责人不存在' }, { status: 404, headers: noStore });
    return NextResponse.json({ id: result.data.id }, { status: update ? 200 : 201, headers: noStore });
  } catch (error) { return failure(error); }
}
export const POST = (request: Request) => save(request, false);
export const PATCH = (request: Request) => save(request, true);
