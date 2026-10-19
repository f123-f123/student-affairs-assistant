// 显式启用：仅隔离内存 SQLite 写入，调用真实模型；不接触共享 Supabase。
import { expect, it, vi } from 'vitest';
import { loadEnvConfig } from '@next/env';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getLocalDb } from '../lib/local-db';
import { MOCK_USERS, type CurrentUser } from '../lib/auth-core';
import type { ImportData } from '../lib/knowledge-import';

const state = vi.hoisted(() => ({ user: null as CurrentUser | null, model_outputs: [] as string[] }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => state.user, requireTeacher: async () => state.user?.role === 'teacher' ? state.user : null }));
vi.mock('../lib/supabase', () => ({ getSupabase: () => getLocalDb(), safeDatabaseError: () => 'isolated test database error' }));
vi.mock('../lib/llm', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/llm')>();
  return { ...actual, askModel: async (...args: Parameters<typeof actual.askModel>) => { const raw = await actual.askModel(...args); state.model_outputs.push(raw); return raw; } };
});
import { POST as ask, GET as history } from '../app/api/ask/route';
import { publishImport } from '../lib/knowledge-import-service';
const request = (data: object) => new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

it.skipIf(process.env.VERIFY_SCOPE_QA_LIVE !== '1')('隔离发布 → 普通问法/别名澄清 → 确认 → 真实模型回答 → 追问', async () => {
  vi.stubEnv('NODE_ENV', 'development'); loadEnvConfig(process.cwd(), true); process.env.LOCAL_SQLITE_PATH = ':memory:';
  const db = getLocalDb(), category = '10000000-0000-4000-8000-000000000001';
  const prefix = '云峰学园2025级2025-2026学年浙江大学二等奖学金';
  const source = `演示办事指南（虚构，非学校正式规定）。各位云峰学园2025级同学：现发布2025-2026学年浙江大学二等奖学金演示规则。请登录演示平台提交申请。个人申请截止时间：10月18日（周日）17：30。云峰学园办公室2026年10月13日`;
  const saved = await db.rpc('capture_knowledge_import', { p_data: { owner_id: MOCK_USERS.teacher.id, requested_url: 'https://example.org/isolated-demo', source_url: 'https://example.org/isolated-demo', title: '演示办事指南（虚构，非学校正式规定）', source_text: source,
    published_date: '2026-10-13', date_candidates: [], attachments: [], content_hash: randomUUID(), fetched_at: new Date().toISOString(), status: 'fetched', error_code: null, error_message: null } });
  expect(saved.error).toBeNull(); const batchId = (saved.data as any).id, id = randomUUID();
  const data: ImportData = { question: prefix + '如何申请？', answer: prefix + '：请登录演示平台提交申请。截止时间为2026年10月18日17:30（上海时间）。', category_id: category,
    aliases: ['云峰二奖申报办法'], scope: { units: ['云峰学园'], cohorts: ['2025级'], years: ['2025-2026学年'], projects: ['浙江大学二等奖学金'], conditions: [] },
    excerpts: [source], issues: [], attachment_dependency: false, publication_date: null, date_confirmed: false, scope_confirmed: true, semantics_confirmed: true, supersedes: null, replacement_version: null };
  expect((await db.rpc('edit_knowledge_import', { p_batch_id: batchId, p_expected_version: 1, p_mode: 'generate', p_drafts: [{ id, data }] })).error).toBeNull();
  state.user = MOCK_USERS.teacher;
  const published = await publishImport(request({ request_id: randomUUID(), drafts: [{ id, version: 1 }] }), { params: Promise.resolve({ id: batchId }) });
  expect(published.status).toBe(200);
  state.user = MOCK_USERS['student-a']; const transcript: object[] = [];
  for (const question of ['二奖怎么申请', '云峰二奖申报办法']) {
    const conversation = await db.from('conversations').insert({ device_id: state.user.id }).select('id').single(); const conversation_id = (conversation.data as any).id;
    async function send(question: string) { const started = performance.now(), response = await ask(request({ question, conversation_id })); const body = await response.json();
      transcript.push({ question, status: response.status, duration_ms: Math.round(performance.now() - started), response: body });
      writeFileSync('artifacts/scope-qa-20261019-live.json', JSON.stringify({ checked_at: new Date().toISOString(), environment: 'isolated in-memory SQLite, fictional approved test knowledge, real configured LLM', shared_writes: 0, transcript, model_outputs: state.model_outputs }, null, 2) + '\n');
      expect(response.status).toBe(200); return body; }
    const clarification = await send(question); expect(clarification.status).toBe('needs_scope'); expect(clarification.scope_candidates.some((c: any) => c.id === id)).toBe(true);
    const restored = await history(new Request(`http://localhost/api/ask?conversation_id=${conversation_id}`)); expect((await restored.json()).history[0].response.status).toBe('needs_scope');
    const confirmed = await send('是的'); expect(confirmed.status).toBe('answered'); expect(confirmed.answer).toContain('演示平台'); expect(confirmed.citations[0].id).toBe(id);
    expect(confirmed.citations[0].source_name).toContain('虚构'); expect(confirmed.citations[0].source_level).toBe(2);
    const deadline = await send('二奖什么时候截止'); expect(deadline.status).toBe('answered'); expect(deadline.answer).toContain('2026年10月18日');
    const other = await send('医学院2025级2025-2026学年二奖怎么申请'); expect(other.answerable).toBe(false); expect(other.citations).toEqual([]);
  }
}, 90_000);
