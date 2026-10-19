import { NextResponse } from 'next/server';
import { requireTeacher } from './auth';
import { noStore, unauthorized } from './teacher-api';
import { getSupabase, safeDatabaseError } from './supabase';
import { UUID_RE } from './validation';
import { parseContact } from './contact-input';
import { noticeContactCandidates } from './notice-contacts';
import { matchesNoticeCandidate, noticeSnapshot, publicContactFields, publicContactId, publicNoticeHash, publicNoticeScope, validPublicContact, type ContactBatch, type PublicContact } from './public-notice-contacts';

type Context = { params: Promise<{ id: string }> };
const error = (message: string, code: string, status = 400) => NextResponse.json({ error: message, code }, { status, headers: noStore });
function failed(cause: unknown) {
  const code = (cause as { code?: string })?.code, message = (cause as { message?: string })?.message || '';
  if (['42703', 'PGRST202', 'PGRST204'].includes(code || '')) return error('公共通知联系人功能尚未部署，请执行 migration_public_notice_contacts.sql；现有私人联系人不会自动公开', 'PUBLIC_CONTACT_SCHEMA_REQUIRED', 503);
  if (message.startsWith('PUBLIC_CONTACT_')) return error('联系人审核版本或原文已变化，请重新读取并核对', message, 409);
  console.error('[public notice contacts]', safeDatabaseError(cause)); return error('联系人读取或保存失败，请重试', 'CONTACTS_UNAVAILABLE', 503);
}
async function load(id: string) {
  if (!UUID_RE.test(id)) throw new Error('PUBLIC_CONTACT_INVALID_ID');
  const db = getSupabase(), result = await db.from('knowledge_imports').select('*').eq('id', id).maybeSingle();
  if (result.error) throw result.error; if (!result.data) throw new Error('PUBLIC_CONTACT_NOT_FOUND');
  const batch = result.data as ContactBatch;
  const latest = batch.source_url ? await db.from('knowledge_imports').select('id,content_hash').eq('source_url', batch.source_url).not('content_hash', 'is', null).order('created_at', { ascending: false }).limit(1) : { data: [], error: null };
  if (latest.error) throw latest.error;
  const stale = !!latest.data?.[0] && latest.data[0].id !== batch.id && latest.data[0].content_hash !== batch.content_hash;
  return { db, batch, stale };
}
export async function getPublicContacts(_request: Request, context: Context) {
  if (!await requireTeacher()) return unauthorized();
  try {
    const { db, batch, stale } = await load((await context.params).id);
    const [contacts, privateHints] = await Promise.all([
      db.from('contacts').select(publicContactFields).eq('scope', 'import').eq('notice_import_id', batch.id).order('name'),
      batch.source_url ? db.from('contacts').select('name,role,email,phone,source_excerpt').eq('scope', 'notice').eq('source_url', batch.source_url) : Promise.resolve({ data: [], error: null }),
    ]);
    if (contacts.error || privateHints.error) throw contacts.error || privateHints.error;
    const rows = contacts.data as PublicContact[], candidates = noticeContactCandidates(batch.source_text).map(candidate => ({ ...candidate, id: publicContactId(batch.id, candidate),
      private_matches: (privateHints.data || []).filter(hint => matchesNoticeCandidate(batch, hint) && hint.name === candidate.name && hint.email === candidate.email && hint.phone === candidate.phone).length }));
    return NextResponse.json({ contacts: rows.map(contact => ({ ...contact, valid: !stale && validPublicContact(batch, contact) })), candidates,
      version: batch.contacts_version, source_hash: publicNoticeHash(batch), scope_label: publicNoticeScope(batch), source_changed: stale,
      status: stale || rows.some(contact => contact.review_status === 'confirmed' && !validPublicContact(batch, contact)) ? 'source_changed' : rows.some(contact => validPublicContact(batch, contact)) ? 'confirmed' : 'unreviewed' }, { headers: noStore });
  } catch (cause) { return failed(cause); }
}
export async function reviewPublicContact(request: Request, context: Context) {
  const teacher = await requireTeacher(); if (!teacher) return unauthorized();
  let input;
  try { input = await request.json(); } catch { return error('联系人请求格式无效', 'INVALID_INPUT'); }
  if (!input || !Number.isInteger(input.version) || input.confirm_source !== true || typeof input.source_hash !== 'string' || !['approve', 'revoke'].includes(input.action)) return error('请核对本通知原文、适用范围和联系人后明确确认', 'PUBLIC_CONTACT_REVIEW_REQUIRED');
  try {
    const { db, batch, stale } = await load((await context.params).id);
    if (stale || publicNoticeHash(batch) !== input.source_hash) return error('通知有新的原文快照，请打开最新批次重新核对联系人', 'PUBLIC_CONTACT_SOURCE_CHANGED', 409);
    let fields;
    if (input.action === 'approve') {
      try { fields = parseContact(input.contact); } catch (cause) { return error(cause instanceof Error ? cause.message : '联系人格式无效', 'INVALID_INPUT'); }
      if (!batch.source_url || !batch.content_hash || fields.office || fields.office_hours || typeof input.contact.source_excerpt !== 'string'
        || !matchesNoticeCandidate(batch, { ...fields, source_excerpt: input.contact.source_excerpt })) return error('联系人姓名、角色及邮箱/电话必须与公开原文候选和依据完全一致，不接受模型补写', 'PUBLIC_CONTACT_EVIDENCE');
      const category = await db.from('categories').select('id').eq('id', fields.category_id).maybeSingle(); if (category.error) throw category.error;
      if (!category.data) return error('类别不存在', 'INVALID_INPUT');
      fields = { ...fields, source_excerpt: input.contact.source_excerpt, id: publicContactId(batch.id, { ...fields, source_excerpt: input.contact.source_excerpt }) };
    } else {
      if (!UUID_RE.test(input.contact?.id || '')) return error('联系人编号无效', 'INVALID_INPUT'); fields = { id: input.contact.id };
    }
    const saved = await db.rpc('review_import_contact', { p_batch_id: batch.id, p_expected_version: input.version, p_snapshot: noticeSnapshot(batch), p_hash: publicNoticeHash(batch), p_scope: publicNoticeScope(batch), p_actor: teacher.id, p_contact: fields, p_action: input.action });
    if (saved.error) throw saved.error; return NextResponse.json(saved.data, { headers: noStore });
  } catch (cause) { return failed(cause); }
}
