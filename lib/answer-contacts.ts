import { safeDatabaseError, type getSupabase } from './supabase';
import type { AskResponse, Category, Contact } from './types';
import { categoryContacts } from './contact-storage';
import { answerNoticeContacts, mergeNoticeGroups } from './answer-notice-contacts';

type Db = ReturnType<typeof getSupabase>;
type CategoryName = Pick<Category, 'id' | 'name'>;

// 首条有效引用决定主类别；跨类别时明确说明，模型分类不覆盖引用类别。
export async function withCurrentContacts(db: Db, responses: AskResponse[], context?: {
  categories: CategoryName[]; itemCategories: Map<string, string>;
}): Promise<AskResponse[]> {
  if (!responses.length) return [];
  let scoped = responses.map(response => ({ ...response, category_id: response.answerable ? null : response.category_id }));
  try {
    if (!context) {
      const ids = [...new Set(responses.flatMap(response => response.citations.map(item => item.id)))];
      const [categories, items] = await Promise.all([
        db.from('categories').select('id,name'),
        ids.length ? db.from('knowledge_items').select('id,category_id').in('id', ids) : Promise.resolve({ data: [], error: null }),
      ]);
      if (categories.error || items.error) throw categories.error || items.error;
      context = { categories: categories.data || [], itemCategories: new Map((items.data || []).map(item => [item.id, item.category_id])) };
    }
    const names = new Map(context.categories.map(category => [category.id, category.name]));
    const scopes = responses.map(response => {
      if (!response.answerable) return { id: response.category_id && names.has(response.category_id) ? response.category_id : null, note: undefined };
      const ids = [...new Set(response.citations.map(citation => citation.category_id || context!.itemCategories.get(citation.id)).filter((id): id is string => !!id && names.has(id)))];
      return { id: ids[0] || null, note: !ids.length ? '引用所属类别无法确认，请通过工单咨询。'
        : ids.length > 1 ? `引用涉及多个类别；当前负责人按首条有效引用所属的「${names.get(ids[0])}」展示。`
          : `当前负责人对应引用知识所属的「${names.get(ids[0])}」。` };
    });
    const noticeMap = await answerNoticeContacts(db, responses);
    const ids = [...new Set([...scopes.flatMap(scope => scope.id ? [scope.id] : []), ...[...noticeMap.values()].flatMap(group => group.category_id ? [group.category_id] : [])])];
    scoped = responses.map((response, index) => ({ ...response, category_id: scopes[index].id, contact_scope_note: scopes[index].note }));
    const result = ids.length ? await categoryContacts(db, ids) : { data: [], error: null };
    if (result.error) throw result.error;
    return responses.map((response, index) => {
      const { contacts_error: _error, contact_scope_note: _note, ...saved } = response;
      const scope = scopes[index];
      const category = (id: string | null) => (result.data || []).filter(contact => contact.category_id === id).map(({ category_id: _category, ...contact }) => contact as Contact);
      const groups = (ids: string[]) => mergeNoticeGroups(ids.flatMap(id => noticeMap.has(id) ? [{ ...noticeMap.get(id)!, category_contacts: noticeMap.get(id)!.contacts.length ? [] : category(noticeMap.get(id)!.category_id) }] : []));
      const noticeGroups = response.answerable ? groups(response.citations.map(c => c.id)) : [];
      const publicContacts = noticeGroups.flatMap(group => group.contacts.length ? group.contacts : group.category_contacts);
      const seen = new Set<string>();
      const contacts = (noticeGroups.length ? publicContacts : category(scope.id)).filter(contact => { const key = JSON.stringify([contact.name, contact.email?.toLowerCase() || '', contact.phone || '']); if (seen.has(key)) return false; seen.add(key); return true; });
      return { ...saved, category_id: scope.id, contacts: response.status === 'needs_scope' ? [] : contacts,
        notice_contact_groups: noticeGroups,
        ...(response.status === 'needs_scope' ? { scope_candidates: response.scope_candidates?.map(candidate => ({ ...candidate, notice_contact_groups: groups([candidate.id]) })) } : {}),
        ...(noticeGroups.length ? { contact_scope_note: '按引用通知分别展示本通知联系人；尚无有效通知联系人时展示类别咨询负责人。' } : scope.note ? { contact_scope_note: scope.note } : {}) };
    });
  } catch (error) {
    console.error('[contacts] current contacts unavailable', safeDatabaseError(error));
    const unavailable = (group: NonNullable<AskResponse['notice_contact_groups']>[number]) => ({ ...group, state: 'unavailable' as const, contacts: [], category_contacts: [], category_error: true });
    return scoped.map(response => ({ ...response, contacts: [], contacts_error: 'CONTACTS_UNAVAILABLE',
      notice_contact_groups: response.notice_contact_groups?.map(unavailable),
      scope_candidates: response.scope_candidates?.map(candidate => ({ ...candidate, notice_contact_groups: candidate.notice_contact_groups?.map(unavailable) })),
    }));
  }
}
