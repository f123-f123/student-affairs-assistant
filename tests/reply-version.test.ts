import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb } from '../lib/local-db';
import { MOCK_USERS } from '../lib/auth-core';
const model = vi.hoisted(() => vi.fn());
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => MOCK_USERS.teacher, requireTeacher: async () => MOCK_USERS.teacher }));
vi.mock('../lib/supabase', () => ({ getSupabase: () => getLocalDb() }));
vi.mock('../lib/llm', () => ({ draftFromTeacherReply: model }));
import { POST as draft } from '../app/api/teacher/tickets/[id]/draft/route';
import { PUT as reply } from '../app/api/teacher/tickets/[id]/reply/route';
import { POST as confirm } from '../app/api/teacher/tickets/[id]/confirm/route';
const request = (body: object) => new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const category = '10000000-0000-4000-8000-000000000008';
beforeAll(() => { process.env.LOCAL_SQLITE_PATH = ':memory:'; });
beforeEach(() => { model.mockReset(); model.mockResolvedValue(JSON.stringify({ question: '如何办理演示业务', answer: '请按演示说明提交材料。' })); });
async function ticket() { const result = await getLocalDb().from('tickets').insert({ device_id: MOCK_USERS['student-a'].id, question: '测试', teacher_reply: '已保存回复', status: 'answered' }).select('id').single(); return (result.data as any).id; }
describe('老师回复与草稿版本绑定', () => {
  it('未保存回复不静默使用旧回复；保存时CAS保护并使旧版本失效', async () => {
    const id = await ticket();
    expect((await draft(request({ reply: '未保存的新回复', reply_version: 0 }), context(id))).status).toBe(409); expect(model).not.toHaveBeenCalled();
    expect((await reply(request({ reply: '新回复', reply_version: 0 }), context(id))).status).toBe(200);
    expect((await reply(request({ reply: '过时回复', reply_version: 0 }), context(id))).status).toBe(409);
    expect((await getLocalDb().from('tickets').select('teacher_reply,reply_version').eq('id', id).single()).data).toMatchObject({ teacher_reply: '新回复', reply_version: 1 });
  });
  it('模型生成期间被另一请求修改时不返回旧草稿', async () => {
    const id = await ticket();
    model.mockImplementationOnce(async () => { await reply(request({ reply: '并发修改', reply_version: 0 }), context(id)); return JSON.stringify({ question: '旧问题', answer: '旧答案' }); });
    expect((await draft(request({ reply: '已保存回复', reply_version: 0 }), context(id))).status).toBe(409);
  });
  it('生成后被另一请求修改，旧指纹不能入库；原子RPC也再次检查版本', async () => {
    const id = await ticket(), db = getLocalDb();
    const generated = await draft(request({ reply: '已保存回复', reply_version: 0 }), context(id)); expect(generated.status).toBe(200); const data = await generated.json();
    await reply(request({ reply: '并发新回复', reply_version: 0 }), context(id));
    expect((await confirm(request({ ...data.draft, reply_version: data.reply_version, reply_fingerprint: data.reply_fingerprint, category_id: category }), context(id))).status).toBe(409);
    const stale = await db.rpc('confirm_ticket_knowledge_checked', { p_ticket_id: id, p_question: '旧问题', p_answer: '旧答案', p_category_id: category, p_expected_reply_version: 0, p_actor: MOCK_USERS.teacher.id }); expect(stale.error?.message).toContain('reply_version_conflict');
    const fresh = await (await draft(request({ reply: '并发新回复', reply_version: 1 }), context(id))).json();
    const saved = await confirm(request({ ...fresh.draft, reply_version: fresh.reply_version, reply_fingerprint: fresh.reply_fingerprint, category_id: category }), context(id)); expect(saved.status).toBe(201);
    const item = await db.from('knowledge_items').select('source_excerpt,source_level,reviewed_by').eq('id', (await saved.json()).knowledge_item_id).single();
    expect(item.data).toMatchObject({ source_excerpt: '并发新回复', source_level: 1, reviewed_by: MOCK_USERS.teacher.id });
  });
});
