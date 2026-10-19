import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getLocalDb } from '../lib/local-db';
import { MOCK_USERS, type CurrentUser } from '../lib/auth-core';
import { withCurrentContacts } from '../lib/answer-contacts';
import { parseContact } from '../lib/contact-input';

const state = vi.hoisted(() => ({ user: null as CurrentUser | null, contactsMode: '', contactQueries: 0, citation: '' }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => state.user, requireTeacher: async () => state.user?.role === 'teacher' ? state.user : null }));
vi.mock('../lib/llm', () => ({ askModel: async () => JSON.stringify({ answerable: true, answer: '进入演示报修记录查看。', citations: [state.citation], category: '10000000-0000-4000-8000-000000000001' }) }));
vi.mock('../lib/supabase', () => ({
  safeDatabaseError: () => 'test database error',
  getSupabase: () => ({ from: (table: string) => {
    if (table === 'contacts') {
      state.contactQueries++;
      if (state.contactsMode) {
        const q = { select: () => q, eq: () => q, in: () => q, order: () => q, then: (resolve: (value: object) => unknown) => Promise.resolve({ data: [], error: state.contactsMode === 'error' ? { code: 'TEST_DB_ERROR' } : null }).then(resolve) };
        return q;
      }
    }
    return getLocalDb().from(table);
  } }),
}));
import { getSupabase } from '../lib/supabase';
import { GET, POST } from '../app/api/ask/route';
import { GET as getContacts, POST as createContact, PATCH as updateContact } from '../app/api/teacher/contacts/route';

const dorm = '10000000-0000-4000-8000-000000000004';
const awards = '10000000-0000-4000-8000-000000000001';
const request = (body: object) => new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeAll(() => { process.env.LOCAL_SQLITE_PATH = ':memory:'; });
afterEach(() => { state.user = null; state.contactsMode = ''; state.contactQueries = 0; });
async function ask() {
  state.user = MOCK_USERS['student-a'];
  const db = getLocalDb();
  const knowledge = await db.from('knowledge_items').insert({ category_id: dorm, question: '宿舍报修进度如何查询', answer: '进入演示报修记录查看。', source_name: '测试依据（虚构）', source_level: 2, status: 'confirmed' }).select('id').single();
  state.citation = (knowledge.data as { id: string }).id;
  const conversation = await db.from('conversations').insert({ device_id: state.user.id }).select('id').single();
  const id = (conversation.data as { id: string }).id;
  const response = await POST(request({ question: '宿舍报修进度如何查询', conversation_id: id }));
  return { response, body: await response.json(), id };
}

describe('负责人维护与实时问答链路', () => {
  it('未登录和学生不能读取老师维护接口或写 contacts', async () => {
    expect((await getContacts()).status).toBe(401);
    for (const user of [null, MOCK_USERS['student-a']]) {
      state.user = user;
      expect((await createContact(request({}))).status).toBe(user ? 403 : 401);
      expect((await updateContact(request({}))).status).toBe(user ? 403 : 401);
    }
    state.user = MOCK_USERS['student-a']; expect((await getContacts()).status).toBe(403);
  });
  it('老师新增和修改联系人后，新问答和重开旧对话显示当前资料，不改历史快照', async () => {
    state.user = MOCK_USERS.teacher;
    const fields = { category_id: dorm, name: '测试负责人（虚构）', role: 'teacher', phone: '', email: '', office: '', office_hours: '演示时段' };
    const created = await createContact(request(fields)); expect(created.status).toBe(201);
    const contactId = (await created.json()).id;
    const { body, id } = await ask();
    expect(body).toMatchObject({ answerable: true, category_id: dorm });
    expect(body.contacts.some((contact: { id: string }) => contact.id === contactId)).toBe(true);
    expect(body.contacts.some((contact: { id: string }) => contact.id === '20000000-0000-4000-8000-000000000001')).toBe(false);
    const before = (await getLocalDb().from('chat_logs').select('response_json').eq('conversation_id', id)).data;
    state.user = MOCK_USERS.teacher;
    expect((await updateContact(request({ ...fields, id: contactId, name: '更新负责人（虚构）' }))).status).toBe(200);
    state.user = MOCK_USERS['student-a']; state.contactQueries = 0;
    const reopened = await GET(new Request(`http://localhost/api/ask?conversation_id=${id}`));
    const history = (await reopened.json()).history;
    expect(history[0].response.contacts.find((contact: { id: string }) => contact.id === contactId).name).toBe('更新负责人（虚构）');
    expect(history[0].response.answer).toBe(body.answer); expect(history[0].response.citations).toEqual(body.citations);
    expect(state.contactQueries).toBe(1);
    expect((await getLocalDb().from('chat_logs').select('response_json').eq('conversation_id', id)).data).toEqual(before);
    const fresh = await POST(request({ question: '宿舍报修进度如何查询', conversation_id: id }));
    expect((await fresh.json()).contacts.find((contact: { id: string }) => contact.id === contactId).name).toBe('更新负责人（虚构）');
    state.user = MOCK_USERS['student-b']; expect((await GET(new Request(`http://localhost/api/ask?conversation_id=${id}`))).status).toBe(404);
  });
  it.each(['empty', 'error'])('无负责人和数据库故障分别显示，回答和工单类别仍取宿舍引用：%s', async mode => {
    state.contactsMode = mode;
    const { response, body, id } = await ask();
    expect(response.status).toBe(200); expect(body.category_id).toBe(dorm); expect(body.answerable).toBe(true); expect(body.contacts).toEqual([]);
    expect(body.contacts_error).toBe(mode === 'error' ? 'CONTACTS_UNAVAILABLE' : undefined);
    const reopened = await GET(new Request(`http://localhost/api/ask?conversation_id=${id}`));
    expect((await reopened.json()).history[0].response.contacts_error).toBe(mode === 'error' ? 'CONTACTS_UNAVAILABLE' : undefined);
  });
  it('历史批量查询、不重写答案，旧引用缺类别时一次映射；跨类使用可解释主类别，不可答保留工单分类', async () => {
    const { body } = await ask();
    const legacy = { ...body, category_id: awards, citations: body.citations.map(({ category_id: _category, ...citation }: { category_id: string }) => citation) };
    state.contactQueries = 0;
    const result = await withCurrentContacts(getSupabase(), [legacy, legacy, { ...body, answerable: false, citations: [], category_id: awards }]);
    expect(state.contactQueries).toBe(1); expect(result[0].category_id).toBe(dorm); expect(result[2].category_id).toBe(awards);
    const mixed = await withCurrentContacts(getSupabase(), [{ ...body, citations: [...body.citations, { ...body.citations[0], category_id: awards }] }]);
    expect(mixed[0].category_id).toBe(dorm); expect(mixed[0].contact_scope_note).toContain('首条有效引用');
  });
  it('负责人查询失败不会伪装为空状态；验证输入和不存在的类别', async () => {
    state.user = MOCK_USERS.teacher; state.contactsMode = 'error';
    expect((await getContacts()).status).toBe(503);
    expect((await createContact(request({ name: '老师' }))).status).toBe(400);
    expect(() => parseContact({ category_id: dorm, name: '示例', role: 'teacher', phone: 'javascript:alert(1)' })).toThrow();
    expect((await createContact(request({ category_id: 'eeeeeeee-0000-4000-8000-000000000001', name: '测试', role: 'teacher' }))).status).toBe(400);
  });
});
