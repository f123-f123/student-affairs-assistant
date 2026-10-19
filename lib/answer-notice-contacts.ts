import type { getSupabase } from './supabase';
import type { AskResponse, KnowledgeItem, NoticeContactGroup } from './types';
import type { ImportBatch, ImportDraft, KnowledgeScope } from './knowledge-import';
import { contactCard, publicContactFields, publicNoticeScope, validPublicContact, type PublicContact } from './public-notice-contacts';
import { describeScope, normalizeProjectText } from './knowledge-scope';

const dimensions = ['units', 'cohorts', 'years', 'projects'] as const;
function sameScope(left: KnowledgeScope | null | undefined, right: KnowledgeScope | null | undefined) {
  return !!left && !!right && dimensions.every(key => left[key].map(normalizeProjectText).sort().join('|') === right[key].map(normalizeProjectText).sort().join('|'));
}
export function mergeNoticeGroups(groups: NoticeContactGroup[]) {
  const merged = new Map<string, NoticeContactGroup>();
  for (const group of groups) {
    const key = group.import_id || group.item_ids[0], old = merged.get(key);
    if (old) {
      old.item_ids = [...new Set([...old.item_ids, ...group.item_ids])];
      if (['unavailable', 'source_changed'].includes(group.state)) { old.state = group.state; old.contacts = []; }
    } else merged.set(key, { ...group, item_ids: [...group.item_ids] });
  }
  return [...merged.values()];
}
export async function answerNoticeContacts(db: ReturnType<typeof getSupabase>, responses: AskResponse[]) {
  const refs = responses.flatMap(response => [...response.citations.map(c => ({ id: c.id, title: c.source_name, source_url: c.source_url, scope_label: '' })),
    ...(response.status === 'needs_scope' ? (response.scope_candidates || []).map(c => ({ id: c.id, title: c.source_name, source_url: c.source_url, scope_label: c.label })) : [])]);
  const publicRefs = refs.filter(ref => !!ref.source_url), ids = [...new Set(publicRefs.map(ref => ref.id))], result = new Map<string, NoticeContactGroup>();
  for (const ref of publicRefs) if (!result.has(ref.id)) result.set(ref.id, { import_id: null, item_ids: [ref.id], title: ref.title, source_url: ref.source_url, scope_label: ref.scope_label,
    state: 'unlinked', contacts: [], category_contacts: [], category_id: null });
  if (!ids.length) return result;
  try {
    const items = await db.from('knowledge_items').select('id,category_id,scope,source_url,source_name,import_draft_id,version').in('id', ids);
    if (items.error) throw items.error;
    const rows = (items.data || []) as KnowledgeItem[], draftIds = rows.flatMap(item => item.import_draft_id ? [item.import_draft_id] : []);
    rows.forEach(item => { const group = result.get(item.id)!; group.category_id = item.category_id; group.scope_label ||= describeScope(item); });
    if (!draftIds.length) return result;
    const drafts = await db.from('knowledge_import_drafts').select('id,batch_id,published_item_id,status,data').in('id', draftIds);
    if (drafts.error) throw drafts.error;
    const imports = [...new Set((drafts.data || []).map(d => d.batch_id))];
    if (!imports.length) return result;
    const [batches, contacts] = await Promise.all([
      db.from('knowledge_imports').select('*').in('id', imports),
      db.from('contacts').select(publicContactFields).eq('scope', 'import').in('notice_import_id', imports).order('name'),
    ]);
    if (batches.error || contacts.error) throw batches.error || contacts.error;
    const urls = [...new Set((batches.data || []).flatMap(b => b.source_url ? [b.source_url] : []))];
    const latest = urls.length ? await db.from('knowledge_imports').select('id,source_url,content_hash,created_at').in('source_url', urls).not('content_hash', 'is', null).order('created_at', { ascending: false }) : { data: [], error: null };
    if (latest.error) throw latest.error;
    for (const item of rows) {
      const group = result.get(item.id)!, draft = (drafts.data as ImportDraft[]).find(d => d.id === item.import_draft_id && d.status === 'published' && d.published_item_id === item.id);
      const batch = draft && (batches.data as ImportBatch[]).find(b => b.id === draft.batch_id);
      if (!draft || !batch) continue;
      group.import_id = batch.id; group.title = batch.title; group.scope_label = publicNoticeScope(batch);
      if (item.source_url !== batch.source_url || !sameScope(item.scope, draft.data.scope)) { group.state = 'source_changed'; group.category_id = null; group.scope_label = '引用范围已变化，需老师复核'; continue; }
      const current = (latest.data || []).find(row => row.source_url === batch.source_url);
      const stale = !!current && current.id !== batch.id && current.content_hash !== batch.content_hash;
      const stored = (contacts.data as PublicContact[]).filter(contact => contact.notice_import_id === batch.id && contact.review_status === 'confirmed');
      const valid = stale ? [] : stored.filter(contact => validPublicContact(batch, contact));
      group.state = stale || valid.length !== stored.length ? 'source_changed' : valid.length ? 'confirmed' : 'unreviewed';
      const seen = new Set<string>();
      group.contacts = valid.filter(contact => { const key = JSON.stringify([contact.name, contact.email?.toLowerCase(), contact.phone]); if (seen.has(key)) return false; seen.add(key); return true; }).map(contactCard);
    }
  } catch { for (const group of result.values()) if (group.source_url) { group.state = 'unavailable'; group.contacts = []; } }
  return result;
}
