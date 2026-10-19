import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getLocalDb } from '../lib/local-db';
import { MOCK_USERS, type CurrentUser } from '../lib/auth-core';
import { noticeContactCandidates } from '../lib/notice-contacts';
import { withCurrentContacts } from '../lib/answer-contacts';
import type { AskResponse, KnowledgeItem } from '../lib/types';

const state = vi.hoisted(() => ({ user: null as CurrentUser | null, mode: '', tables: [] as string[], contactQueries: 0 }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => state.user, requireTeacher: async () => state.user?.role === 'teacher' ? state.user : null }));
vi.mock('../lib/llm', () => ({ askModel: async (_q: string, _categories: unknown, items: KnowledgeItem[]) => JSON.stringify({ answerable: true, answer: items[0].answer, citations: [items[0].id], category: items[0].category_id }) }));
vi.mock('../lib/supabase', () => ({ safeDatabaseError: () => 'isolated contact test error', getSupabase: () => ({
  rpc: (...args: Parameters<ReturnType<typeof getLocalDb>['rpc']>) => getLocalDb().rpc(...args),
  from: (table: string) => {
    state.tables.push(table); const query = getLocalDb().from(table);
    if (table === 'contacts') {
      state.contactQueries++; let scope = ''; const eq = query.eq.bind(query), then = query.then.bind(query);
      query.eq = (field, value) => { if (field === 'scope') scope = String(value); return eq(field, value); };
      query.then = (resolve: any, reject: any) => state.mode === 'category-error' && scope === 'category' ? Promise.resolve({ data: [], error: { code: 'TEST_ERROR' } }).then(resolve, reject)
        : state.mode === 'empty' && scope === 'category' ? Promise.resolve({ data: [], error: null }).then(resolve, reject)
        : ['error', 'schema'].includes(state.mode) && scope === 'import' ? Promise.resolve({ data: [], error: { code: state.mode === 'schema' ? '42703' : 'TEST_ERROR' } }).then(resolve, reject) : then(resolve, reject);
    }
    return query;
  },
}) }));
import { getSupabase } from '../lib/supabase';
import { getPublicContacts, reviewPublicContact } from '../lib/public-contact-api';
import { publishImport } from '../lib/knowledge-import-service';
import { POST as ask, GET as history } from '../app/api/ask/route';

const category = '10000000-0000-4000-8000-000000000001', prefix = '云峰学园2025级2025-2026学年演示奖学金';
const text = '隔离演示，非真实政策。各位云峰学园2025级同学：现发布2025-2026学年演示奖学金通知。请登录演示平台提交申请。申请者须获得2项荣誉。联系人：王老师 邮箱：zjuwangxu@zju.edu.cn。云峰学园办公室2026年10月13日';
const scope = { units: ['云峰学园'], cohorts: ['2025级'], years: ['2025-2026学年'], projects: ['演示奖学金'], conditions: [] };
const candidate = noticeContactCandidates(text)[0];
const req = (body: object) => new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
beforeAll(() => { process.env.LOCAL_SQLITE_PATH = ':memory:'; });
beforeEach(() => { state.user = MOCK_USERS.teacher; state.mode = ''; state.tables = []; state.contactQueries = 0; });
async function fixture(url = `https://example.org/${randomUUID()}`) {
  const db = getLocalDb();
  const captured = await db.rpc('capture_knowledge_import', { p_data: { owner_id: MOCK_USERS.teacher.id, requested_url: url, source_url: url, title: '云峰学园2025-2026学年演示奖学金通知', source_text: text,
    published_date: '2026-10-13', date_candidates: [], attachments: [], content_hash: randomUUID(), fetched_at: new Date().toISOString(), status: 'fetched', error_code: null, error_message: null } });
  const id = (captured.data as any).id as string;
  const drafts = ['如何申请？', '需要什么条件？'].map((suffix, i) => ({ id: randomUUID(), data: { question: prefix + suffix, answer: prefix + (i ? '：申请者须获得2项荣誉。' : '：请登录演示平台提交申请。'), category_id: category,
    aliases: [], scope, excerpts: [text], issues: [], attachment_dependency: false, publication_date: null, date_confirmed: false, scope_confirmed: true, semantics_confirmed: true, supersedes: null, replacement_version: null } }));
  expect((await db.rpc('edit_knowledge_import', { p_batch_id: id, p_expected_version: 1, p_mode: 'generate', p_drafts: drafts })).error).toBeNull();
  const published = await publishImport(req({ request_id: randomUUID(), drafts: drafts.map(d => ({ id: d.id, version: 1 })) }), ctx(id)); expect(published.status).toBe(200);
  const items = (await db.from('knowledge_items').select('*').in('id', drafts.map(d => d.id))).data as KnowledgeItem[];
  const response: AskResponse = { answerable: true, status: 'answered', answer: items[0].answer, citations: items.map(item => ({ ...item, version: item.version!, source_excerpt: text })), category_id: category, contacts: [] };
  return { id, items, response, db, url };
}
async function review(id: string, action = 'approve', contactId?: string) {
  const response = await getPublicContacts(new Request('http://localhost'), ctx(id)); expect(response.status).toBe(200); const data = await response.json();
  const saved = await reviewPublicContact(req({ action, version: data.version, source_hash: data.source_hash, confirm_source: true,
    contact: action === 'approve' ? { ...candidate, category_id: category } : { id: contactId } }), ctx(id));
  expect(saved.status).toBe(200); return { ...(await saved.json()), before: data };
}

describe('公共通知联系人审核及实时问答', () => {
  it('私人同URL记录仅作老师线索；明确审核后候选和正式回答读到联系人，历史实时更新且不改原快照', async () => {
    const f = await fixture(); const privateIds: string[] = [];
    for (const user of ['student-a', 'student-b']) {
      const event = await f.db.from('events').insert({ device_id: MOCK_USERS[user].id, title: '私人事项', source_text: text, source_url: f.url }).select('id').single();
      const contact = await f.db.from('contacts').insert({ ...candidate, category_id: category, scope: 'notice', notice_event_id: (event.data as any).id, source_url: f.url, source_hash: 'private-original' }).select('id').single(); privateIds.push((contact.data as any).id);
    }
    const beforeContacts = (await f.db.from('contacts').select('*').in('id', privateIds)).data;
    const teacherView = await (await getPublicContacts(new Request('http://localhost'), ctx(f.id))).json();
    expect(teacherView.candidates[0].private_matches).toBe(2); expect(JSON.stringify(teacherView)).not.toContain('notice_event_id');
    state.user = MOCK_USERS['student-a'];
    const conversation = await f.db.from('conversations').insert({ device_id: state.user.id }).select('id').single(), conversation_id = (conversation.data as any).id;
    const pending = await (await ask(req({ question: '演示奖学金怎么申请', conversation_id }))).json();
    expect(pending.status).toBe('needs_scope'); expect(pending.contacts).toEqual([]);
    expect(pending.scope_candidates[0].notice_contact_groups[0]).toMatchObject({ state: 'unreviewed', contacts: [] });
    const oldLog = (await f.db.from('chat_logs').select('response_json').eq('conversation_id', conversation_id)).data;
    state.user = MOCK_USERS.teacher; const saved = await review(f.id);
    expect(saved.id).not.toBe(privateIds[0]);
    expect((await f.db.from('contacts').select('*').in('id', privateIds)).data).toEqual(beforeContacts);
    expect((await f.db.from('contacts').select('scope,notice_event_id,notice_import_id,reviewed_by').eq('id', saved.id).single()).data).toMatchObject({ scope: 'import', notice_event_id: null, notice_import_id: f.id, reviewed_by: MOCK_USERS.teacher.id });
    state.user = MOCK_USERS['student-a']; state.tables = [];
    const reopened = await (await history(new Request(`http://localhost/api/ask?conversation_id=${conversation_id}`))).json();
    const group = reopened.history[0].response.scope_candidates[0].notice_contact_groups[0]; expect(group).toMatchObject({ state: 'confirmed', contacts: [{ name: '王老师', email: candidate.email }] });
    expect((await f.db.from('chat_logs').select('response_json').eq('conversation_id', conversation_id)).data).toEqual(oldLog);
    const confirmed = await (await ask(req({ question: '是的', conversation_id }))).json();
    expect(confirmed.answerable).toBe(true); expect(confirmed.notice_contact_groups[0].contacts[0].email).toBe(candidate.email); expect(confirmed.notice_contact_groups[0].category_contacts).toEqual([]);
    const snapshots = (await f.db.from('chat_logs').select('response_json').eq('conversation_id', conversation_id)).data;
    state.user = MOCK_USERS.teacher; await review(f.id, 'revoke', saved.id); state.user = MOCK_USERS['student-a'];
    const revoked = await (await history(new Request(`http://localhost/api/ask?conversation_id=${conversation_id}`))).json();
    expect(revoked.history[1].response.notice_contact_groups[0].state).toBe('unreviewed'); expect(revoked.history[1].response.answer).toBe(confirmed.answer); expect(revoked.history[1].response.citations).toEqual(confirmed.citations);
    expect((await f.db.from('chat_logs').select('response_json').eq('conversation_id', conversation_id)).data).toEqual(snapshots); expect(state.tables).not.toContain('events');
  });
  it('没有审核、空类别及读取故障不同；源正文变化或同URL新快照要求重新核对', async () => {
    const f = await fixture(); state.mode = 'empty';
    let [current] = await withCurrentContacts(getSupabase(), [f.response]); expect(current.notice_contact_groups![0]).toMatchObject({ state: 'unreviewed', contacts: [], category_contacts: [] });
    state.mode = ''; await review(f.id);
    const [approved] = await withCurrentContacts(getSupabase(), [f.response]);
    state.contactQueries = 0; await withCurrentContacts(getSupabase(), [approved, approved, approved]); expect(state.contactQueries).toBe(2);
    state.mode = 'category-error'; const [unavailable] = await withCurrentContacts(getSupabase(), [approved]);
    expect(unavailable.notice_contact_groups![0].contacts).toEqual([]); expect(unavailable.notice_contact_groups![0].state).toBe('unavailable');
    state.mode = 'error'; [current] = await withCurrentContacts(getSupabase(), [f.response]); expect(current.notice_contact_groups![0].state).toBe('unavailable'); expect(current.notice_contact_groups![0].contacts).toEqual([]);
    state.mode = ''; await f.db.from('knowledge_imports').update({ source_text: text + '公开原文已修改。' }).eq('id', f.id);
    [current] = await withCurrentContacts(getSupabase(), [f.response]); expect(current.notice_contact_groups![0].state).toBe('source_changed'); expect(current.notice_contact_groups![0].contacts).toEqual([]);
    const another = await fixture(); await review(another.id);
    await another.db.rpc('capture_knowledge_import', { p_data: { owner_id: MOCK_USERS.teacher.id, requested_url: another.url, source_url: another.url, title: '新的公开快照', source_text: text + '新的正文。', published_date: '2026-10-13', date_candidates: [], attachments: [], content_hash: randomUUID(), fetched_at: new Date().toISOString(), status: 'fetched', error_code: null, error_message: null } });
    [current] = await withCurrentContacts(getSupabase(), [another.response]); expect(current.notice_contact_groups![0].state).toBe('source_changed');
  });
  it('学生无权读取或审核；伪造联系方式、漏确认、旧版本及重复确认不会覆盖或重复创建', async () => {
    const f = await fixture(), view = await (await getPublicContacts(new Request('http://localhost'), ctx(f.id))).json();
    const body = { action: 'approve', version: view.version, source_hash: view.source_hash, confirm_source: true, contact: { ...candidate, category_id: category } };
    state.user = MOCK_USERS['student-a']; expect((await getPublicContacts(req({}), ctx(f.id))).status).toBe(403); expect((await reviewPublicContact(req(body), ctx(f.id))).status).toBe(403);
    state.user = MOCK_USERS.teacher;
    expect((await reviewPublicContact(req({ ...body, confirm_source: false }), ctx(f.id))).status).toBe(400);
    expect((await reviewPublicContact(req({ ...body, contact: { ...body.contact, email: 'invented@example.org' } }), ctx(f.id))).status).toBe(400);
    expect((await reviewPublicContact(req(body), ctx(f.id))).status).toBe(200); expect((await reviewPublicContact(req(body), ctx(f.id))).status).toBe(409);
    const saved = await review(f.id); expect((await f.db.from('contacts').select('id').eq('notice_import_id', f.id)).data).toHaveLength(1);
    expect(saved.id).toBe(view.candidates[0].id);
    state.mode = 'schema'; const unavailable = await getPublicContacts(req({}), ctx(f.id)); expect(unavailable.status).toBe(503); expect((await unavailable.json()).code).toBe('PUBLIC_CONTACT_SCHEMA_REQUIRED');
  });
  it('同批多知识共享一个联系人分组；不同通知/学院/年度及仅同URL的未关联知识不继承联系人', async () => {
    const one = await fixture(); await review(one.id); const two = await fixture();
    let [result] = await withCurrentContacts(getSupabase(), [one.response]); expect(result.notice_contact_groups).toHaveLength(1); expect(result.notice_contact_groups![0].item_ids).toHaveLength(2);
    const merged = { ...one.response, citations: [...one.response.citations, ...two.response.citations] };
    [result] = await withCurrentContacts(getSupabase(), [merged]); expect(result.notice_contact_groups).toHaveLength(2); expect(result.notice_contact_groups![1].contacts).toEqual([]);
    await two.db.from('knowledge_items').update({ scope: { ...scope, units: ['医学院'], years: ['2024-2025学年'] } }).in('id', two.items.map(i => i.id));
    [result] = await withCurrentContacts(getSupabase(), [two.response]); expect(result.notice_contact_groups!.every(group => group.contacts.length === 0)).toBe(true);
    const legacy = await one.db.from('knowledge_items').insert({ category_id: category, question: prefix + '历史条目', answer: '旧答案', source_level: 2, source_name: '旧通知', source_url: one.url, scope, status: 'confirmed' }).select('id').single();
    [result] = await withCurrentContacts(getSupabase(), [{ ...one.response, citations: [{ ...one.response.citations[0], id: (legacy.data as any).id }] }]);
    expect(result.notice_contact_groups![0]).toMatchObject({ state: 'unlinked', contacts: [] });
  });
});
