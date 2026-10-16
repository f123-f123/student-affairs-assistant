import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../lib/auth-core';
import { MOCK_USERS } from '../lib/auth-core';
import { getLocalDb } from '../lib/local-db';

const state = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock('../lib/auth', () => ({
  getCurrentUser: async () => state.user,
  requireTeacher: async () => state.user?.role === 'teacher' ? state.user : null,
}));
vi.mock('../lib/supabase', () => ({ getSupabase: () => getLocalDb() }));

import * as conversations from '../app/api/conversations/route';
import * as ask from '../app/api/ask/route';
import * as tickets from '../app/api/tickets/route';
import * as events from '../app/api/events/route';
import * as eventDetail from '../app/api/events/[id]/route';
import * as teacherTickets from '../app/api/teacher/tickets/route';
import * as teacherReply from '../app/api/teacher/tickets/[id]/reply/route';
import * as teacherKnowledge from '../app/api/teacher/knowledge/route';
import * as teacherKnowledgeItem from '../app/api/teacher/knowledge/[id]/route';
import { POST as mockLogin } from '../app/api/auth/mock-login/route';
import { POST as passcodeLogin } from '../app/api/auth/login/route';
import { POST as logout } from '../app/api/auth/logout/route';
import { GET as currentUser } from '../app/api/auth/me/route';

const url = (path: string) => `http://localhost:3000${path}`;
const jsonRequest = (path: string, value: object, method = 'POST') => new Request(url(path), {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
});

beforeAll(() => { process.env.LOCAL_SQLITE_PATH = ':memory:'; });
afterEach(() => { state.user = null; vi.unstubAllEnvs(); });

describe('模拟身份业务隔离', () => {
  it('A 创建对话和工单、退出重选 A 可见；B 无法用参数读取 A', async () => {
    state.user = MOCK_USERS['student-a'];
    const created = await conversations.POST();
    expect(created.status).toBe(201);
    const conversationId = ((await created.json()) as { conversation: { id: string } }).conversation.id;
    const ticket = await tickets.POST(jsonRequest('/api/tickets', { question: 'A 的问题', device_id: MOCK_USERS['student-b'].id }));
    expect(ticket.status).toBe(201);
    state.user = MOCK_USERS['student-b'];
    expect(((await (await conversations.GET()).json()) as { conversations: unknown[] }).conversations).toEqual([]);
    expect(((await (await tickets.GET()).json()) as { tickets: unknown[] }).tickets).toEqual([]);
    expect((await ask.GET(new Request(url(`/api/ask?conversation_id=${conversationId}&device_id=${MOCK_USERS['student-a'].id}`)))).status).toBe(404);
    state.user = null;
    expect((await conversations.GET()).status).toBe(401);
    state.user = MOCK_USERS['student-a'];
    expect(((await (await conversations.GET()).json()) as { conversations: unknown[] }).conversations).toHaveLength(1);
    expect(((await (await tickets.GET()).json()) as { tickets: unknown[] }).tickets).toHaveLength(1);
  });

  it('事项读取和修改由会话限定，学生不能使用老师接口', async () => {
    state.user = MOCK_USERS['student-a'];
    const db = getLocalDb();
    const inserted = await db.from('events').insert({ device_id: MOCK_USERS['student-a'].id, title: 'A 的事项', source_text: 'A 的通知正文' }).select('id').single();
    const eventId = (inserted.data as { id: string }).id;
    state.user = MOCK_USERS['student-b'];
    expect(((await (await events.GET()).json()) as { events: unknown[] }).events).toEqual([]);
    expect((await eventDetail.PATCH(jsonRequest(`/api/events/${eventId}`, { status: 'done', device_id: MOCK_USERS['student-a'].id }, 'PATCH'), { params: Promise.resolve({ id: eventId }) })).status).toBe(404);
    expect((await teacherTickets.GET()).status).toBe(403);
    state.user = MOCK_USERS.teacher;
    expect((await teacherTickets.GET()).status).toBe(200);
  });

  it('老师能回复工单并管理知识，学生无法调用相同接口', async () => {
    const db = getLocalDb();
    state.user = MOCK_USERS['student-a'];
    const ticket = await db.from('tickets').insert({ device_id: MOCK_USERS['student-a'].id, question: '测试办理问题' }).select('id').single();
    const ticketId = (ticket.data as { id: string }).id;
    const replyRequest = () => jsonRequest(`/api/teacher/tickets/${ticketId}/reply`, { reply: '请查看办理说明' }, 'PUT');
    expect((await teacherReply.PUT(replyRequest(), { params: Promise.resolve({ id: ticketId }) })).status).toBe(403);
    expect((await teacherKnowledge.GET()).status).toBe(403);
    state.user = MOCK_USERS.teacher;
    expect((await teacherReply.PUT(replyRequest(), { params: Promise.resolve({ id: ticketId }) })).status).toBe(200);
    const category = (await db.from('categories').select('id').limit(1)).data as { id: string }[];
    const created = await teacherKnowledge.POST(jsonRequest('/api/teacher/knowledge', {
      category_id: category[0].id, question: '测试知识问题', answer: '测试知识答案', source_name: '评估来源',
      source_excerpt: '评估依据', source_url: null, aliases: [], valid_from: null, valid_until: null,
    }));
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const draft = await db.from('knowledge_items').select('version,status').eq('id', id).single();
    expect((draft.data as { status: string }).status).toBe('draft');
    await db.from('knowledge_items').update({ answer: '审核前新增的内容' }).eq('id', id);
    expect((await teacherKnowledgeItem.PATCH(jsonRequest(`/api/teacher/knowledge/${id}`, {
      action: 'publish', version: (draft.data as { version: number }).version,
    }, 'PATCH'), { params: Promise.resolve({ id }) })).status).toBe(409);
    expect((await db.from('knowledge_items').select('status').eq('id', id).single()).data).toMatchObject({ status: 'draft' });
    const latest = await db.from('knowledge_items').select('version').eq('id', id).single();
    expect((await teacherKnowledgeItem.PATCH(jsonRequest(`/api/teacher/knowledge/${id}`, {
      action: 'publish', version: (latest.data as { version: number }).version,
    }, 'PATCH'), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((await db.from('knowledge_items').select('status').eq('id', id).single()).data).toMatchObject({ status: 'confirmed' });
  });

  it('mock 关闭时 API 拒绝；启用后只接受固定身份并签发 httpOnly Cookie', async () => {
    vi.stubEnv('AUTH_MODE', 'real');
    vi.stubEnv('SESSION_SECRET', 'test-only-session-secret-at-least-32-chars');
    expect((await mockLogin(jsonRequest('/api/auth/mock-login', { identity: 'teacher' }))).status).toBe(403);
    vi.stubEnv('AUTH_MODE', 'mock');
    expect((await mockLogin(jsonRequest('/api/auth/mock-login', { identity: 'arbitrary', role: 'teacher' }))).status).toBe(400);
    const response = await mockLogin(jsonRequest('/api/auth/mock-login', { identity: 'student-a', role: 'teacher' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=lax');
    expect(((await response.json()) as { user: CurrentUser }).user.role).toBe('student');
    expect((await logout(new Request(url('/api/auth/logout'), { method: 'POST' }))).headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
  });
  it('管理口令仅在匹配时授予老师，学生身份保持固定且独立', async () => {
    vi.stubEnv('AUTH_MODE', 'passcode');
    vi.stubEnv('SESSION_SECRET', 'test-only-session-secret-at-least-32-chars');
    vi.stubEnv('TEACHER_PASSCODE', 'configured-teacher-code');
    const student = await passcodeLogin(jsonRequest('/api/auth/login', { account: 'student-b', passcode: '', role: 'teacher' }));
    expect(student.status).toBe(200);
    expect(await student.json()).toEqual({ role: 'student' });
    expect((await passcodeLogin(jsonRequest('/api/auth/login', { account: 'student-a', passcode: 'wrong' }))).status).toBe(401);
    const teacher = await passcodeLogin(jsonRequest('/api/auth/login', { account: 'teacher', passcode: 'configured-teacher-code' }));
    expect(teacher.status).toBe(200);
    expect(teacher.headers.get('set-cookie')).toContain('HttpOnly');
    expect(await teacher.json()).toEqual({ role: 'teacher' });
    expect((await passcodeLogin(jsonRequest('/api/auth/login', { account: 'arbitrary', passcode: '' }))).status).toBe(401);
    vi.stubEnv('TEACHER_PASSCODE', '');
    expect((await passcodeLogin(jsonRequest('/api/auth/login', { account: 'student-a', passcode: '' }))).status).toBe(503);
  });
  it('当前用户接口只返回服务端解析的身份', async () => {
    state.user = MOCK_USERS['student-b'];
    const response = await currentUser(new Request(url('/api/auth/me')));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(((await response.json()) as { user: Pick<CurrentUser, 'id' | 'displayName' | 'role'> }).user).toEqual({ id: MOCK_USERS['student-b'].id, displayName: MOCK_USERS['student-b'].displayName, role: 'student' });
  });
});
