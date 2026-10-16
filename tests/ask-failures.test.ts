import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MOCK_USERS } from '../lib/auth-core';
import { getLocalDb } from '../lib/local-db';
import { readConversationError } from '../lib/conversation-errors';

const state = vi.hoisted(() => ({ modelError: 'model_timeout', databaseError: '' }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => MOCK_USERS['student-a'] }));
vi.mock('../lib/llm', () => ({ askModel: async () => { throw new Error(state.modelError); } }));
vi.mock('../lib/supabase', () => ({
  getSupabase: () => {
    if (state.databaseError) throw Object.assign(new Error(state.databaseError), state.databaseError === 'PGRST205' ? { code: 'PGRST205' } : {});
    return getLocalDb();
  },
  safeDatabaseError: (error: Error) => error.message,
}));
import { POST } from '../app/api/ask/route';

beforeAll(() => { process.env.LOCAL_SQLITE_PATH = ':memory:'; });
afterEach(() => { state.databaseError = ''; state.modelError = 'model_timeout'; });

const request = (id: string) => new Request('http://localhost/api/ask', { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: '在读证明怎么开？', conversation_id: id }) });

describe('问答故障归因', () => {
  it.each(['model_timeout', 'model_request_failed'])('模型故障 %s 不提示数据库故障，并保留失败记录', async modelError => {
    state.modelError = modelError;
    const db = getLocalDb();
    const created = await db.from('conversations').insert({ device_id: MOCK_USERS['student-a'].id }).select('id').single();
    const id = (created.data as { id: string }).id;
    const response = await POST(request(id));
    expect(response.status).toBe(503);
    const failure = await readConversationError(response);
    expect(failure.code).toBe('MODEL_UNAVAILABLE');
    expect(failure.message).toBe('模型服务暂时不可用，请稍后重试');
    expect((await db.from('chat_logs').select('error_type,answerable').eq('conversation_id', id)).data)
      .toEqual([{ error_type: modelError, answerable: false }]);
  });
  it.each([['PGRST205', 'DATABASE_TABLE_NOT_VISIBLE'], ['connection_refused', 'DATABASE_UNAVAILABLE'],
    ['database_not_configured', 'DATABASE_CONFIG_MISSING']])('连接失败 %s 保留具体错误类别', async (cause, code) => {
    state.databaseError = cause;
    const response = await POST(request('a1000000-0000-4000-8000-000000000001'));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe(code);
  });
});
