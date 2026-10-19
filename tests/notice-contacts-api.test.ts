import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getLocalDb } from '../lib/local-db';
import { MOCK_USERS, type CurrentUser } from '../lib/auth-core';
import { categoryContacts, sourceHash } from '../lib/contact-storage';

const state = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => state.user, requireTeacher: async () => state.user?.role === 'teacher' ? state.user : null }));
vi.mock('../lib/supabase', () => ({ getSupabase: () => getLocalDb(), safeDatabaseError: () => 'test error' }));
import { getSupabase } from '../lib/supabase';
import { GET as listContacts, POST as saveContact } from '../app/api/teacher/contacts/route';
import { GET as events } from '../app/api/events/route';
import { noticeContactCandidates } from '../lib/notice-contacts';

beforeAll(() => { process.env.LOCAL_SQLITE_PATH = ':memory:'; });
afterEach(() => { state.user = null; });
const category = '10000000-0000-4000-8000-000000000001';
const source = '演示通知，仅用于隔离测试。个人申请截止时间：10月18日17:30。联系人：王老师 邮箱：notice@example.org。某学院2026年10月13日';
const candidate = noticeContactCandidates(source)[0];
const request = (body: object) => new Request('http://localhost/api/teacher/contacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function event() {
  const result = await getLocalDb().from('events').insert({ title: '演示通知', device_id: MOCK_USERS['student-a'].id, source_text: source, category_id: category }).select('id').single();
  return (result.data as { id: string }).id;
}

describe('本通知联系人隔离与关联', () => {
  it('老师确认后存 contacts 并绑定单一事项，不进入类别负责人；原文改变会使关联待复核', async () => {
    const eventId = await event();
    const fields = { category_id: category, name: candidate.name, role: candidate.role, email: candidate.email, phone: null,
      scope: 'notice', notice_event_id: eventId, source_excerpt: candidate.source_excerpt, confirm_source: true };
    state.user = MOCK_USERS['student-a']; expect((await saveContact(request(fields))).status).toBe(403);
    state.user = MOCK_USERS.teacher;
    expect((await saveContact(request({ ...fields, confirm_source: false }))).status).toBe(400);
    expect((await saveContact(request({ ...fields, email: 'invented@example.org' }))).status).toBe(400);
    const created = await saveContact(request(fields)); expect(created.status).toBe(201); const id = (await created.json()).id;
    const stored = await getLocalDb().from('contacts').select('scope,notice_event_id,source_hash').eq('id', id).single();
    expect(stored.data).toEqual({ scope: 'notice', notice_event_id: eventId, source_hash: sourceHash(source) });
    const categories = await listContacts(); expect((await categories.json()).contacts.some((row: { id: string }) => row.id === id)).toBe(false);
    const scoped = await listContacts(new Request(`http://localhost/api/teacher/contacts?event_id=${eventId}`));
    expect((await scoped.json()).contacts[0].id).toBe(id);
    state.user = MOCK_USERS['student-a'];
    const owned = (await (await events()).json()).events.find((row: { id: string }) => row.id === eventId);
    expect(owned.notice_contacts[0].id).toBe(id); expect(owned.category_contacts).toEqual([]);
    await getLocalDb().from('events').update({ source_text: source + '原文已修改。' }).eq('id', eventId);
    const changed = (await (await events()).json()).events.find((row: { id: string }) => row.id === eventId);
    expect(changed.notice_contacts).toEqual([]); expect(changed.notice_contacts_error).toBe('NOTICE_CONTACT_SOURCE_CHANGED'); expect(changed.category_contacts.length).toBeGreaterThan(0);
    state.user = MOCK_USERS['student-b']; expect((await (await events()).json()).events).toEqual([]);
  });
  it('迁移前类别联系人继续可读，显式标记不支持通知关联；真正数据库故障不回退为空', async () => {
    let calls = 0;
    const db = { from: () => { let modern = false; const query = {
      select: (fields: string) => { modern = fields.includes('scope'); return query; }, eq: () => query, in: () => query, order: () => query,
      then: (resolve: (result: unknown) => unknown) => { calls++; return Promise.resolve(modern ? { data: null, error: { code: '42703' } } : { data: [], error: null }).then(resolve); },
    }; return query; } } as unknown as ReturnType<typeof getSupabase>;
    const result = await categoryContacts(db); expect(result.notice_supported).toBe(false); expect(result.data).toEqual([]); expect(calls).toBe(3);
  });
});
