import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_USERS } from '../lib/auth-core';
import { readConversationError } from '../lib/conversation-errors';

const state = vi.hoisted(() => ({ authenticated: false, databaseError: 'database_not_configured' }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => state.authenticated ? MOCK_USERS['student-a'] : null }));
vi.mock('../lib/supabase', () => ({ getSupabase: () => {
  throw Object.assign(new Error(state.databaseError), state.databaseError === 'PGRST205' ? { code: 'PGRST205' } : {});
}, safeDatabaseError: (error: Error) => error.message }));

import * as conversations from '../app/api/conversations/route';
import { GET as history } from '../app/api/ask/route';

afterEach(() => { state.authenticated = false; state.databaseError = 'database_not_configured'; });

describe('对话错误契约', () => {
  it('未登录时先返回 401，不访问数据库', async () => {
    expect((await conversations.GET()).status).toBe(401);
    expect((await conversations.POST()).status).toBe(401);
    const response = await history(new Request('http://localhost/api/ask?conversation_id=a1000000-0000-4000-8000-000000000001'));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  });

  it('配置缺失时返回稳定的 503 错误码，不创建对话', async () => {
    state.authenticated = true;
    for (const response of [await conversations.GET(), await conversations.POST(), await history(new Request('http://localhost/api/ask?conversation_id=a1000000-0000-4000-8000-000000000001'))]) {
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe('DATABASE_CONFIG_MISSING');
    }
  });

  it('其他数据库故障与配置缺失分开，客户端识别 HTTP 和网络错误', async () => {
    state.authenticated = true;
    state.databaseError = 'connection_refused';
    const response = await conversations.GET();
    expect((await response.json()).code).toBe('DATABASE_UNAVAILABLE');
    for (const [status, code] of [[401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [503, 'DATABASE_UNAVAILABLE']] as const) {
      expect((await readConversationError(new Response('{}', { status }))).code).toBe(code);
    }
  });

  it('PostgREST 未暴露业务表时保留具体错误码', async () => {
    state.authenticated = true;
    state.databaseError = 'PGRST205';
    const response = await conversations.GET();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('DATABASE_TABLE_NOT_VISIBLE');
  });
});
