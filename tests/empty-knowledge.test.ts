import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MOCK_USERS } from '../lib/auth-core';
import { getLocalDb } from '../lib/local-db';

const state = vi.hoisted(() => ({ categoriesEmpty: false, itemsEmpty: false }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => MOCK_USERS['student-a'] }));
vi.mock('../lib/llm', () => ({ askModel: vi.fn(async () => { throw new Error('model_must_not_be_called'); }) }));
vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({ from: (table: string) => {
    const query = getLocalDb().from(table);
    return table === 'categories' && state.categoriesEmpty || table === 'knowledge_items' && state.itemsEmpty
      ? query.eq('id', 'not-an-existing-record') : query;
  } }),
  safeDatabaseError: (error: Error) => error.message,
}));

import { POST, GET } from '../app/api/ask/route';
import { POST as submitTicket } from '../app/api/tickets/route';
import { askModel } from '../lib/llm';

beforeAll(() => { process.env.LOCAL_SQLITE_PATH = ':memory:'; });
afterEach(() => { state.categoriesEmpty = false; state.itemsEmpty = false; vi.clearAllMocks(); });
const request = (path: string, body: object) => new Request(`http://localhost${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
async function conversation() {
  const result = await getLocalDb().from('conversations').insert({ device_id: MOCK_USERS['student-a'].id }).select('id').single();
  return (result.data as { id: string }).id;
}

describe('空知识库属于业务状态', () => {
  it('没有分类时返回知识不足，保存真实回答快照，不伪造分类或误报数据库故障', async () => {
    state.categoriesEmpty = true; state.itemsEmpty = true;
    const id = await conversation();
    const response = await POST(request('/api/ask', { question: '如何办理证明', conversation_id: id }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ answerable: false, citations: [], contacts: [], category_id: null });
    expect(body.notice).toContain('尚未配置基础分类');
    expect(body.code).toBeUndefined();
    expect(askModel).not.toHaveBeenCalled();
    const history = await GET(new Request(`http://localhost/api/ask?conversation_id=${id}`));
    expect((await history.json()).history[0]).toMatchObject({ response: body });
    expect((await getLocalDb().from('chat_logs').select('error_type,category_id').eq('conversation_id', id)).data)
      .toEqual([{ error_type: null, category_id: null }]);
  });
  it('已有分类但没有有效知识时可以正常问答并获得工单分类，不调用模型', async () => {
    state.itemsEmpty = true;
    const response = await POST(request('/api/ask', { question: '如何办理证明', conversation_id: await conversation() }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answerable).toBe(false);
    expect(body.category_id).toBe('10000000-0000-4000-8000-000000000008');
    expect(body.notice).toContain('有效已审核知识');
    expect(askModel).not.toHaveBeenCalled();
  });
  it('分类缺失时工单明确说明初始化要求', async () => {
    state.categoriesEmpty = true;
    const response = await submitTicket(request('/api/tickets', { question: '请老师确认办理办法' }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('CATEGORIES_NOT_INITIALIZED');
  });
  it('分类初始化后，即使知识为空也可以提交工单', async () => {
    state.itemsEmpty = true;
    const response = await submitTicket(request('/api/tickets', { question: '请老师确认办理办法', category_id: null }));
    expect(response.status).toBe(201);
    expect((await response.json()).id).toEqual(expect.any(String));
  });
});
