import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoticeFetchError, type FetchErrorCode } from '../lib/fetch-errors';
import { getLocalDb } from '../lib/local-db';
import NoticeCoverage from '../app/components/NoticeCoverage';
import { sourceFailure } from '../lib/source-errors';

const state = vi.hoisted(() => ({ loggedIn: true, error: '' as string, modelFail: false }));
const attachment = { name: '申请表.docx', url: 'https://school.example/a.docx', format: 'docx', status: 'unparsed' as const };
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => state.loggedIn ? { id: 'a1000000-0000-4000-8000-000000000001', role: 'student' } : null }));
vi.mock('../lib/supabase', () => ({ getSupabase: () => getLocalDb() }));
vi.mock('../lib/safe-fetch', () => ({ fetchNotice: vi.fn(async () => {
  if (state.error) throw new NoticeFetchError(state.error as FetchErrorCode);
  return { title: '通知', sourceText: '这是一条需要核对附件的通知正文，具体材料以附件为准。', sourceUrl: 'https://school.example/a',
    publishedDate: '2026-10-13', fetchedAt: '2026-10-16T00:00:00Z', completeness: 'body_only', attachments: [attachment],
    warning: '附件尚未解析', diagnostics: { dns_mode: 'doh', http_status: 200, hops: [{ host: 'school.example', address: '8.8.8.8' }] } };
}) }));
vi.mock('../lib/llm', () => ({ extractEventModel: async () => {
  if (state.modelFail) throw new Error('model_not_configured');
  return JSON.stringify({ title: '通知事项', summary: '', eligibility: '', submit_to: '', deadline: null, deadline_source_text: null, materials: [] });
} }));
import { POST as diagnose } from '../app/api/sources/diagnose/route';
import { POST as extract } from '../app/api/events/extract/route';
import { fetchNotice } from '../lib/safe-fetch';

beforeAll(() => { process.env.LOCAL_SQLITE_PATH = ':memory:'; });
afterEach(() => { state.loggedIn = true; state.error = ''; state.modelFail = false; vi.clearAllMocks(); });
const request = (body: object) => new Request('http://localhost/api/sources/diagnose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('真实链路诊断与附件覆盖契约', () => {
  it.each([
    { code: '42703', message: 'column source_articles.attachments does not exist' },
    { code: 'PGRST202', message: 'Could not find function public.save_source_article(p_attachments)' },
  ])('缺少附件列或 RPC 时明确要求迁移，不丢弃附件保存 %j', async cause => {
    const response = sourceFailure(cause);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'SOURCE_SCHEMA_MIGRATION_REQUIRED', stage: 'storage' });
  });
  it('诊断需要登录，未登录不能触发对外抓取', async () => {
    state.loggedIn = false;
    expect((await diagnose(request({ url: 'https://school.example/a' }))).status).toBe(401);
    expect(fetchNotice).not.toHaveBeenCalled();
  });
  it.each(['FETCH_ALLOWLIST_EMPTY', 'FETCH_DOMAIN_NOT_ALLOWED', 'FETCH_DNS_NON_PUBLIC', 'FETCH_DNS_FAILED', 'FETCH_NETWORK_FAILED', 'FETCH_TIMEOUT'] as FetchErrorCode[])('诊断和 URL 整理都保留具体抓取错误码 %s', async code => {
    state.error = code;
    for (const handler of [diagnose, extract]) {
      const response = await handler(request({ url: 'https://school.example/a' }));
      expect(response.status).toBe(new NoticeFetchError(code).status);
      expect(await response.json()).toMatchObject({ code, stage: new NoticeFetchError(code).stage });
    }
  });
  it('诊断不调用模型，URL 整理成功或模型失败都保留附件未解析提示', async () => {
    const diagnostic = await (await diagnose(request({ url: 'https://school.example/a' }))).json();
    expect(diagnostic).toMatchObject({ code: 'FETCH_OK', article: { completeness: 'body_only', attachments: [attachment] } });
    for (const modelFail of [false, true]) {
      state.modelFail = modelFail;
      const response = await extract(request({ url: 'https://school.example/a' }));
      expect(response.status).toBe(modelFail ? 503 : 200);
      expect((await response.json()).source).toMatchObject({ completeness: 'body_only', attachments: [attachment] });
    }
  });
  it('已保存的仅正文文章可以整理，但不能丢失附件状态', async () => {
    const db = getLocalDb();
    const source = await db.from('information_sources').insert({ owner_id: 'a1000000-0000-4000-8000-000000000001', name: '来源', url: 'https://school.example/a', kind: 'article' }).select('id').single();
    const article = await db.from('source_articles').insert({ source_id: (source.data as { id: string }).id, owner_id: 'a1000000-0000-4000-8000-000000000001',
      url: 'https://school.example/a', title: '通知', source_text: '正文', fetched_at: new Date().toISOString(), content_hash: 'hash', completeness: 'body_only', attachments: [attachment] }).select('id').single();
    const response = await extract(request({ article_id: (article.data as { id: string }).id }));
    expect(response.status).toBe(200);
    expect((await response.json()).source).toMatchObject({ completeness: 'body_only', attachments: [attachment] });
  });
  it('界面明确展示附件未解析，不把正文称为整份通知完整', () => {
    const html = renderToStaticMarkup(<NoticeCoverage attachments={[attachment]} />);
    expect(html).toContain('整份通知资料完整性未核验');
    expect(html).toContain('申请表.docx'); expect(html).toContain('未解析');
  });
});
