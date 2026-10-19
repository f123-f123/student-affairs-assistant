import { createHash } from 'node:crypto';
import type { getSupabase } from './supabase';
import type { Contact, StudentEvent } from './types';

type Db = ReturnType<typeof getSupabase>;
export const contactFields = 'id,category_id,name,role,phone,email,office,office_hours';
export const noticeContactFields = `${contactFields},scope,notice_event_id,source_excerpt,source_url,source_hash`;
export const noticeSchemaMissing = (error: unknown) => ['42703', 'PGRST204'].includes(String((error as { code?: string } | null)?.code));
export const sourceHash = (text: string) => createHash('sha256').update(text).digest('hex');

// 迁移前只有旧的类别记录；明确返回能力标志。通知专属写入必须先确认迁移，不能退化成类别负责人。
export async function categoryContacts(db: Db, ids?: string[]) {
  let query = db.from('contacts').select(noticeContactFields).eq('scope', 'category');
  if (ids) query = query.in('category_id', ids);
  const result = await query.order('role').order('name');
  if (!noticeSchemaMissing(result.error)) return { ...result, notice_supported: !result.error };
  let scoped = db.from('contacts').select(`${contactFields},scope`).eq('scope', 'category');
  if (ids) scoped = scoped.in('category_id', ids);
  const partial = await scoped.order('role').order('name');
  if (!noticeSchemaMissing(partial.error)) return { ...partial, notice_supported: false };
  let legacy = db.from('contacts').select(contactFields);
  if (ids) legacy = legacy.in('category_id', ids);
  return { ...await legacy.order('role').order('name'), notice_supported: false };
}

export async function attachEventContacts(db: Db, events: StudentEvent[]) {
  if (!events.length) return events;
  try {
    const notice = await db.from('contacts').select(noticeContactFields).eq('scope', 'notice').in('notice_event_id', events.map(event => event.id));
    if (notice.error) {
      if (noticeSchemaMissing(notice.error)) return events.map(event => ({ ...event, notice_contacts: [], category_contacts: [], notice_contacts_error: 'NOTICE_CONTACT_SCHEMA_REQUIRED' }));
      throw notice.error;
    }
    const ids = [...new Set(events.flatMap(event => event.category_id ? [event.category_id] : []))];
    const categories = ids.length ? await categoryContacts(db, ids) : { data: [], error: null };
    if (categories.error) throw categories.error;
    return events.map(event => {
      const rows = (notice.data || []).filter(contact => contact.notice_event_id === event.id);
      const current = rows.filter(contact => contact.source_hash === sourceHash(event.source_text) && event.source_text.includes(contact.source_excerpt));
      return { ...event, notice_contacts: current as Contact[], category_contacts: current.length ? [] : (categories.data || []).filter(contact => contact.category_id === event.category_id) as Contact[],
        ...(rows.length !== current.length ? { notice_contacts_error: 'NOTICE_CONTACT_SOURCE_CHANGED' } : {}) };
    });
  } catch { return events.map(event => ({ ...event, notice_contacts: [], category_contacts: [], notice_contacts_error: 'CONTACTS_UNAVAILABLE' })); }
}
