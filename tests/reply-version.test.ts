import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb } from '../lib/local-db';
import { MOCK_USERS, type CurrentUser } from '../lib/auth-core';
import { ticketDatabaseError } from '../lib/ticket-api';
import { isTicketDetail } from '../lib/ticket-contract';
const mocks = vi.hoisted(() => ({ model: vi.fn(), ask: vi.fn(), user: null as CurrentUser | null, db: null as any }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => mocks.user, requireTeacher: async () => mocks.user?.role === 'teacher' ? mocks.user : null }));
vi.mock('../lib/supabase', () => ({ getSupabase: () => mocks.db || getLocalDb(), safeDatabaseError: () => 'safe_error' }));
vi.mock('../lib/llm', () => ({ draftFromTeacherReply: mocks.model, askModel: mocks.ask }));
import { GET as detail } from '../app/api/teacher/tickets/[id]/route';
import { POST as draft } from '../app/api/teacher/tickets/[id]/draft/route';
import { PUT as reply } from '../app/api/teacher/tickets/[id]/reply/route';
import { POST as confirm } from '../app/api/teacher/tickets/[id]/confirm/route';
import { GET as candidates } from '../app/api/teacher/ticket-candidates/route';
import { POST as ask, GET as history } from '../app/api/ask/route';
const request = (body: object) => new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const category = '10000000-0000-4000-8000-000000000008';
beforeAll(() => { process.env.LOCAL_SQLITE_PATH = ':memory:'; });
beforeEach(() => { mocks.db = null; mocks.user = MOCK_USERS.teacher; mocks.model.mockReset(); mocks.ask.mockReset(); mocks.model.mockResolvedValue(JSON.stringify({ question: '演示凭证如何办理', answer: '请按演示说明提交申请表。' })); });
afterEach(() => vi.restoreAllMocks());
async function ticket() { const result = await getLocalDb().from('tickets').insert({ device_id: MOCK_USERS['student-a'].id, question: '演示凭证如何办理', category_id: category, teacher_reply: '已保存回复', status: 'answered' }).select('id').single(); return (result.data as any).id as string; }
async function read(id: string) {
  const res = await detail(new Request('http://localhost'), context(id)); expect(res.status).toBe(200);
  const value = await res.json(); expect(isTicketDetail(value)).toBe(true); expect(value).not.toHaveProperty('items'); return value.ticket;
}
async function generate(id: string) { const t = await read(id); const res = await draft(request({ reply: t.teacher_reply, reply_version: t.reply_version }), context(id)); expect(res.status).toBe(200); return res.json(); }
const publication = (generated: any, extra: object = {}) => ({ ...generated.draft, reply_version: generated.reply_version, reply_fingerprint: generated.reply_fingerprint, category_id: category, public_excerpt: null, public_reviewed: true, ...extra });

describe('工单详情 → 保存 → 草稿 → 审核 → 入库', () => {
  it('GET 的真实 0 及后续版本可保存；两个同版本保存仅一个成功', async () => {
    const id = await ticket(), initial = await read(id); expect(initial.reply_version).toBe(0);
    const results = await Promise.all(['甲的新回复', '乙的新回复'].map(text => reply(request({ reply: text, reply_version: initial.reply_version }), context(id))));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await results.find(r => r.status === 409)!.json()).code).toBe('REPLY_VERSION_CONFLICT');
    const fresh = await read(id); expect(fresh.reply_version).toBe(1);
    expect((await reply(request({ reply: '再次保存', reply_version: fresh.reply_version }), context(id))).status).toBe(200);
    expect((await read(id)).reply_version).toBe(2);
    expect((await reply(request({ reply: '缺版本' }), context(id))).status).toBe(409);
  });
  it('未保存回复不能静默使用旧回复', async () => {
    const id = await ticket(), t = await read(id);
    expect((await draft(request({ reply: '未保存的新回复', reply_version: t.reply_version }), context(id))).status).toBe(409); expect(mocks.model).not.toHaveBeenCalled();
  });
  it('生成期间并发保存使过时响应失败', async () => {
    const id = await ticket(), t = await read(id);
    mocks.model.mockImplementationOnce(async () => { await reply(request({ reply: '并发修改', reply_version: t.reply_version }), context(id)); return JSON.stringify({ question: '旧问题', answer: '旧答案' }); });
    expect((await draft(request({ reply: t.teacher_reply, reply_version: t.reply_version }), context(id))).status).toBe(409);
  });
  it('生成后回复改变，指纹及事务再次复核均拦截旧版本；旧RPC不能公开原文', async () => {
    const id = await ticket(), generated = await generate(id), t = await read(id);
    await reply(request({ reply: '并发新回复', reply_version: t.reply_version }), context(id));
    expect((await confirm(request(publication(generated)), context(id))).status).toBe(409);
    const stale = await getLocalDb().rpc('confirm_ticket_knowledge_public_checked', { p_ticket_id: id, p_question: '旧问题', p_answer: '旧答案', p_category_id: category, p_expected_reply_version: t.reply_version, p_expected_reply: t.teacher_reply, p_actor: MOCK_USERS.teacher.id, p_public_reviewed: true, p_public_excerpt: null });
    expect(stale.error?.message).toBe('reply_version_conflict');
    expect((await getLocalDb().rpc('confirm_ticket_knowledge_checked', {})).error?.message).toBe('public_review_required');
  });
  it('路由前置读取后、事务前另一请求修改回复也会失败', async () => {
    const id = await ticket(), generated = await generate(id), t = await read(id), db = getLocalDb();
    const original = db.rpc.bind(db);
    vi.spyOn(db, 'rpc').mockImplementationOnce(async (name, params) => {
      await reply(request({ reply: '事务前变化', reply_version: t.reply_version }), context(id)); return original(name, params);
    });
    expect((await confirm(request(publication(generated)), context(id))).status).toBe(409);
    expect((await read(id)).sedimented).toBe(false);
  });
  it.each([null, '老师审核的通用说明：请按演示说明提交申请表。'])('人工审核后公开依据为 %s，原始回复只在内部保留', async public_excerpt => {
    const db = getLocalDb(), id = await ticket(), initial = await read(id);
    const privateReply = '虚构学生钱某，学号202601234567，电话13912345678，邮箱private-person@example.test，已单独批准。';
    const saved = await reply(request({ reply: privateReply, reply_version: initial.reply_version }), context(id)); expect(saved.status).toBe(200);
    const generated = await generate(id);
    expect((await confirm(request(publication(generated, { public_reviewed: false })), context(id))).status).toBe(400);
    const body = publication(generated, { question: '演示凭证如何办理', answer: '办理演示凭证，请按演示说明提交申请表。', public_excerpt });
    const published = await confirm(request(body), context(id)); expect(published.status).toBe(201);
    const itemId = (await published.json()).knowledge_item_id;
    const item = (await db.from('knowledge_items').select('*').eq('id', itemId).single()).data as any;
    expect(item).toMatchObject({ question: body.question, answer: body.answer, source_excerpt: public_excerpt, source_level: 1, reviewed_by: MOCK_USERS.teacher.id });
    expect((await read(id)).teacher_reply).toBe(privateReply);
    const snapshots = (await db.from('knowledge_item_versions').select('snapshot').eq('item_id', itemId)).data;
    for (const text of ['钱某', '202601234567', '13912345678', 'private-person@example.test']) { expect(JSON.stringify(item)).not.toContain(text); expect(JSON.stringify(snapshots)).not.toContain(text); }
    expect((await confirm(request(body), context(id))).status).toBe(409);
    const current = await read(id); await reply(request({ reply: '内部后续回复', reply_version: current.reply_version }), context(id));
    expect((await db.from('knowledge_items').select('*').eq('id', itemId).single()).data).toEqual(item);
    expect((await db.from('tickets').select('knowledge_reply_version,knowledge_reply_snapshot').eq('id', id).single()).data).toEqual({ knowledge_reply_version: generated.reply_version, knowledge_reply_snapshot: privateReply });
    expect(await read(id)).not.toHaveProperty('knowledge_reply_snapshot');
    const conversation = (await db.from('conversations').insert({ device_id: MOCK_USERS['student-a'].id }).select('id').single()).data as any;
    mocks.user = MOCK_USERS['student-a'];
    mocks.ask.mockImplementation(async (_q, _c, items) => { const found = items.find((i: any) => i.id === itemId); expect(found).toBeTruthy(); return JSON.stringify({ answerable: true, answer: found.answer, citations: [found.id], category }); });
    const response = await ask(request({ question: '演示凭证如何办理', conversation_id: conversation.id })); expect(response.status).toBe(200);
    const answer = await response.json(); expect(answer.answerable).toBe(true); expect(answer.citations[0].source_excerpt).toBe(public_excerpt);
    const reopened = await history(new Request(`http://localhost/api/ask?conversation_id=${conversation.id}`)); expect(reopened.status).toBe(200);
    const publicData = JSON.stringify([answer, await reopened.json(), mocks.ask.mock.calls]);
    for (const text of ['钱某', '202601234567', '13912345678', 'private-person@example.test']) expect(publicData).not.toContain(text);
  });
  it('替换条目类别或状态变化时事务失败，工单和旧知识均保留', async () => {
    const db = getLocalDb(), id = await ticket(), generated = await generate(id);
    const old = (await db.from('knowledge_items').insert({ category_id: category, question: '旧问题', answer: '旧答案', source_level: 1, source_name: '演示', status: 'confirmed' }).select('id').single()).data as any;
    await db.from('knowledge_items').update({ status: 'inactive' }).eq('id', old.id);
    expect((await confirm(request(publication(generated, { supersedes: old.id })), context(id))).status).toBe(409);
    expect((await read(id)).sedimented).toBe(false);
    expect((await db.from('knowledge_items').select('status').eq('id', old.id).single()).data).toEqual({ status: 'inactive' });
  });
});

describe('详情契约、错误和候选隔离', () => {
  it('详情不读取知识；候选按类别分页且故障不阻断详情/回复', async () => {
    const db = getLocalDb(), id = await ticket(); const from = vi.spyOn(db, 'from');
    await read(id); expect(from.mock.calls.map(args => args[0])).toEqual(['tickets', 'categories']); from.mockRestore();
    const newCategory = (await db.from('categories').insert({ name: '隔离分页类别', description: '测试' }).select('id').single()).data as any;
    for (let n = 0; n < 12; n++) await db.from('knowledge_items').insert({ category_id: newCategory.id, question: `分页${n}`, answer: '答案', source_level: 1, source_name: '测试', status: 'confirmed' });
    for (const [page, length] of [[1, 10], [2, 2]]) {
      const res = await candidates(new Request(`http://localhost/api?category_id=${newCategory.id}&page=${page}`)); expect(res.status).toBe(200);
      const data = await res.json(); expect(data.total).toBe(12); expect(data.items).toHaveLength(length); expect(data.items.every((i: any) => i.category_id === newCategory.id)).toBe(true);
    }
    const original = db.from.bind(db);
    vi.spyOn(db, 'from').mockImplementation((table: string) => { if (table === 'knowledge_items') throw new Error('network'); return original(table); });
    expect((await candidates(new Request(`http://localhost/api?category_id=${category}`))).status).toBe(503);
    const t = await read(id); expect((await reply(request({ reply: '仍可保存', reply_version: t.reply_version }), context(id))).status).toBe(200);
  });
  it.each([
    [{ code: '42703', message: 'column tickets.reply_version does not exist' }, 'TICKET_VERSION_COLUMN_MISSING'],
    [{ code: 'PGRST202', message: 'Could not find public.confirm_ticket_knowledge_public_checked' }, 'TICKET_PUBLIC_RPC_MISSING'],
    [{ code: '42703', message: 'other_column does not exist' }, 'TICKET_DATABASE_UNAVAILABLE'],
    [{ code: 'PGRST202', message: 'unrelated_function' }, 'TICKET_DATABASE_UNAVAILABLE'],
    [new Error('network private data should not escape'), 'TICKET_DATABASE_UNAVAILABLE'],
  ])('只由明确数据库缺失报告提示对应迁移：%s', async (error, code) => {
    const res = ticketDatabaseError(error), text = await res.text(); expect(res.status).toBe(503); expect(JSON.parse(text).code).toBe(code); expect(text).not.toContain('private data');
  });
  it.each([undefined, null, '0', -1])('GET 缺失/非法版本 %s 不补0、不误报迁移', async value => {
    const id = await ticket(), t = await read(id);
    const query: any = { select() { return this; }, eq() { return this; }, order() { return this; }, maybeSingle() { return this; }, then(resolve: any) { return Promise.resolve({ data: { ...t, reply_version: value }, error: null }).then(resolve); } };
    mocks.db = { from: (table: string) => table === 'tickets' ? query : getLocalDb().from(table) };
    const res = await detail(new Request('http://localhost'), context(id)); expect(res.status).toBe(503); expect((await res.json()).code).toBe('TICKET_RESPONSE_INVALID');
  });
  it('真实路由区分缺列、缺安全RPC、网络异常及模型异常，均不回显原始内容', async () => {
    const id = await ticket(), generated = await generate(id), db = getLocalDb();
    mocks.db = { from: () => { throw { code: '42703', message: 'column tickets.reply_version does not exist' }; } };
    const missingColumn = await detail(new Request('http://localhost'), context(id)); expect((await missingColumn.json()).code).toBe('TICKET_VERSION_COLUMN_MISSING');
    mocks.db = { from: db.from.bind(db), rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find public.confirm_ticket_knowledge_public_checked' } }) };
    const missingRpc = await confirm(request(publication(generated)), context(id)); expect((await missingRpc.json()).code).toBe('TICKET_PUBLIC_RPC_MISSING');
    expect((await db.from('tickets').select('sedimented').eq('id', id).single()).data).toEqual({ sedimented: false });
    mocks.db = { from: () => { throw new Error('network contains virtual private information'); } };
    const network = await detail(new Request('http://localhost'), context(id)); expect(await network.json()).toEqual({ code: 'TICKET_DATABASE_UNAVAILABLE', error: '工单数据库暂时不可用，请稍后重试' });
    mocks.db = null;
    mocks.model.mockRejectedValueOnce(new Error('model failure'));
    const t = await read(id);
    const input = { reply: t.teacher_reply, reply_version: t.reply_version };
    expect((await (await draft(request(input), context(id))).json()).code).toBe('TICKET_MODEL_UNAVAILABLE');
    mocks.model.mockResolvedValueOnce('{broken');
    expect((await (await draft(request(input), context(id))).json()).code).toBe('TICKET_DRAFT_INVALID');
    mocks.model.mockResolvedValueOnce('{"question":"","answer":""}');
    const personalOnly = await draft(request(input), context(id)); expect(personalOnly.status).toBe(422); expect((await personalOnly.json()).code).toBe('TICKET_DRAFT_NOT_REUSABLE');
  });
  it.each([null, MOCK_USERS['student-a']])('未登录及学生不能读取或写老师工单接口', async user => {
    const id = await ticket(); mocks.user = user;
    const expected = user ? 403 : 401;
    for (const res of await Promise.all([detail(new Request('http://localhost'), context(id)), reply(request({ reply: 'x' }), context(id)), draft(request({}), context(id)), confirm(request({}), context(id)), candidates(new Request(`http://localhost/api?category_id=${category}`))])) expect(res.status).toBe(expected);
    expect(mocks.model).not.toHaveBeenCalled();
  });
});
