import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getLocalDb } from '../lib/local-db';
import { MOCK_USERS, type CurrentUser } from '../lib/auth-core';
import { checkImportDraft, parseImportData, parseImportGeneration, scopeAllowsQuestion, type ImportData, type ImportBatch } from '../lib/knowledge-import';
import { retrieveKnowledge } from '../lib/knowledge-search';
import type { Category, KnowledgeItem } from '../lib/types';
import { NoticeFetchError } from '../lib/fetch-errors';
import { assessKnowledgeScope } from '../lib/knowledge-scope';

const mocks = vi.hoisted(() => ({ user: null as CurrentUser | null, fetch: vi.fn(), generate: vi.fn(), ask: vi.fn() }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => mocks.user, requireTeacher: async () => mocks.user?.role === 'teacher' ? mocks.user : null }));
vi.mock('../lib/supabase', () => ({ getSupabase: () => getLocalDb(), safeDatabaseError: () => 'isolated database error' }));
vi.mock('../lib/safe-fetch', () => ({ fetchNotice: mocks.fetch }));
vi.mock('../lib/llm', () => ({ generateOfficialKnowledge: mocks.generate, askModel: mocks.ask }));
import { captureImport, editImport, generateImport, listImports, publishImport, readImport } from '../lib/knowledge-import-service';
import { POST as ask, GET as askHistory } from '../app/api/ask/route';

const category = '10000000-0000-4000-8000-000000000001';
const title = '云峰学园2025-2026学年演示奖学金通知';
const intro = '各位云峰学园2025级同学：现发布2025-2026学年演示奖学金通知。';
const deadline = '申请截止时间：10月18日（周日）17：30';
const source = `${intro}申请者须获得2项荣誉。${deadline}。请登录演示平台提交申请。二奖与三奖可以同时申请。附件申请表.docx仅供人工核对。云峰学园奖学金评审委员会2026年10月13日`;
const scope = { units: ['云峰学园'], cohorts: ['2025级'], years: ['2025-2026学年'], projects: ['演示奖学金'], conditions: [] };
const prefix = '云峰学园2025级2025-2026学年演示奖学金';
const fixture = (suffix = '如何申请？', answer = '请登录演示平台提交申请。'): ImportData => ({
  question: prefix + suffix, answer: prefix + '：' + answer, category_id: category, aliases: [], scope,
  excerpts: [source], issues: [], attachment_dependency: false, publication_date: '2026-10-13',
  date_confirmed: true, scope_confirmed: true, semantics_confirmed: true, supersedes: null, replacement_version: null,
});
const request = (data: object) => new Request('http://localhost/api/teacher/imports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
let categories: Category[];
beforeAll(async () => { process.env.LOCAL_SQLITE_PATH = ':memory:'; categories = (await getLocalDb().from('categories').select('*')).data as Category[]; });
beforeEach(() => {
  mocks.user = MOCK_USERS.teacher; mocks.generate.mockReset(); mocks.ask.mockReset(); mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (url: string) => ({ sourceUrl: url, title, sourceText: source, publishedDate: '2026-10-13',
    dateCandidates: [{ date: '2026-10-13', kind: 'signature', evidence: '云峰学园奖学金评审委员会2026年10月13日' }],
    fetchedAt: '2026-10-19T01:00:00Z', attachments: [{ name: '申请表.docx', url: 'https://example.org/form.docx', format: 'docx', status: 'unparsed' }] }));
  mocks.ask.mockImplementation(async (_q: string, _c: Category[], items: KnowledgeItem[]) => JSON.stringify({ answerable: true, answer: items[0].answer, citations: [items[0].id], category: items[0].category_id }));
});
async function capture(url = `https://example.org/${randomUUID()}.psp`) {
  const response = await captureImport(request({ url })); expect(response.status).toBe(200); return (await response.json()).id as string;
}
async function read(id: string) { const response = await readImport(new Request('http://localhost'), context(id)); expect(response.status).toBe(200); return response.json(); }
async function prepare(rows: ImportData[] = [fixture()]) {
  const id = await capture(); mocks.generate.mockResolvedValue(JSON.stringify({ drafts: rows }));
  if (rows.length === 1) {
    const generated = await generateImport(request({ version: 1 }), context(id)); expect(generated.status).toBe(200);
  } else {
    // 旧版多草稿批次仍须支持编辑、事务发布和并发保护；新版生成入口只允许一条。
    const legacy = await getLocalDb().rpc('edit_knowledge_import', { p_batch_id: id, p_expected_version: 1, p_mode: 'generate', p_drafts: rows.map(data => ({ id: randomUUID(), data })) });
    expect(legacy.error).toBeNull();
  }
  let state = await read(id);
  const response = await editImport(request({ version: state.batch.version, drafts: state.drafts.map((d: any, i: number) => ({ ...d, data: rows[i] })) }), context(id));
  expect(response.status).toBe(200); state = await read(id); return { id, state };
}
const selection = (state: any) => state.drafts.map((d: any) => ({ id: d.id, version: d.version }));

describe('官网导入确定性检查', () => {
  const batch = { title, source_text: source, source_url: 'https://example.org/notice', date_candidates: [{ date: '2026-10-13', kind: 'signature', evidence: '云峰学园奖学金评审委员会2026年10月13日' }], attachments: [] } as unknown as ImportBatch;
  it('正文支持的独立草稿可发布，附件未解析不阻止独立正文知识；不把发布日期当有效期', () => {
    expect(checkImportDraft(batch, fixture(), categories, true).errors).toEqual([]);
    const d = fixture('什么时候截止？', '申请截止时间为2026年10月18日17:30（上海时间）。');
    expect(checkImportDraft(batch, d, categories, true)).toMatchObject({ errors: [], facts: { deadline: '2026-10-18T09:30:00.000Z' } });
  });
  it('必要条件只在标点、括号或连接词上有差异时不再误报缺失', () => {
    const notice = `${intro}${deadline}。注意：二奖、三奖同时开放申请，且同时截止申请。`;
    const document = { ...batch, source_text: notice };
    const data = { ...fixture('什么时候截止？', '申请截止时间为10月18日（周日）17：30，二奖、三奖同时开放申请且同时截止申请。'),
      excerpts: [notice], scope: { ...scope, conditions: ['二奖、三奖同时开放申请，且同时截止申请', '个人申请截止时间：10月18日（周日）17：30'] } };
    expect(checkImportDraft(document, data, categories, true).errors).toEqual([]);
    expect(checkImportDraft(document, { ...data, answer: data.answer.replace('同时截止申请', '') }, categories, true).errors.join()).toContain('答案缺少必要条件');
    expect(checkImportDraft(document, { ...data, scope: { ...scope, conditions: ['所有学院都可以申请'] } }, categories, true).errors.join()).toContain('适用范围包含原文未明确的限定条件');
  });
  it('唯一落款可补全缺失年份，不再要求确认或重复处理旧模型的缺年提示', () => {
    const data = { ...fixture('什么时候截止？', '申请截止时间为2026年10月18日17:30（上海时间）。'), publication_date: null, date_confirmed: false,
      issues: ['正文仅写“10月18日（周日）”，未写明年份，需老师确认具体年度'] };
    const result = checkImportDraft(batch, data, categories, true);
    expect(result.errors).toEqual([]); expect(result.issues).toEqual([]); expect(result.warnings).toEqual([]);
    expect(result.date_note).toContain('根据正文落款 2026/10/13 自动补全年份：2026/10/18 17:30');
    expect(result.date_note).toContain('无需单独确认年份'); expect(data.issues).toHaveLength(1);
    const unrelated = checkImportDraft(batch, { ...data, issues: [...data.issues, '附件材料未核对', '未写明适用年度及年级范围，需老师确认'] }, categories, true);
    expect(unrelated.issues).toEqual(['附件材料未核对', '未写明适用年度及年级范围，需老师确认']); expect(unrelated.errors).toContain('仍有待人工处理的问题，请解决并更新草稿后发布');
  });
  it('缺少年份且没有日期依据、候选冲突或星期矛盾时，仍阻止发布并保留人工问题', () => {
    const issue = '正文未写明年份，需老师确认具体年度';
    const data = { ...fixture('什么时候截止？', '申请截止时间为10月18日17:30。'), publication_date: null, date_confirmed: false, issues: [issue] };
    for (const document of [
      { ...batch, source_text: source.replace('云峰学园奖学金评审委员会2026年10月13日', ''), date_candidates: [] },
      { ...batch, date_candidates: [...batch.date_candidates, { date: '2025-10-13', kind: 'page' as const, evidence: '网页发布日期' }] },
      { ...batch, source_text: source.replace('周日', '周一') },
    ]) {
      const checked = checkImportDraft(document, { ...data, excerpts: [document.source_text] }, categories, true);
      expect(checked.errors.join()).toContain('日期冲突'); expect(checked.issues).toEqual([issue]); expect(checked.date_note).toBeNull();
    }
  });
  it('伪造摘录、非法类别、附件依赖、范围缺失、无依据的开始时间和金额均被阻止', () => {
    for (const data of [{ ...fixture(), excerpts: ['不存在的句子'] }, { ...fixture(), category_id: randomUUID() }, { ...fixture(), attachment_dependency: true },
      { ...fixture(), answer: '所有学院均可申请。' }, fixture('何时开始？', '申请从2026年10月13日开始。'), fixture('奖励多少？', '奖励9000元。'), fixture('是否同时申请？', '二奖与三奖不可以同时申请。')]) {
      expect(checkImportDraft(batch, data, categories, true).errors.length).toBeGreaterThan(0);
    }
    const conflict = { ...batch, date_candidates: [...batch.date_candidates, { date: '2025-10-13', kind: 'page' as const, evidence: '网页时间' }] };
    expect(checkImportDraft(conflict, { ...fixture('什么时候截止？', '申请截止时间为10月18日17:30。'), publication_date: null }, categories, true).errors.join()).toContain('日期冲突');
  });
  it('JSON、数量、类型和日期严格校验；模型不能替老师确认', () => {
    expect(() => parseImportGeneration('```json\n{}\n```')).toThrow();
    expect(() => parseImportGeneration(JSON.stringify({ drafts: Array(9).fill(fixture()) }))).toThrow();
    expect(() => parseImportGeneration(JSON.stringify({ drafts: [fixture(), fixture('谁能申请？')] }))).toThrow('仅整理一条');
    expect(() => parseImportGeneration(JSON.stringify({ drafts: [{ ...fixture(), aliases: '错误' }] }))).toThrow();
    expect(() => parseImportData({ ...fixture(), publication_date: '2026-02-29' })).toThrow();
    expect(parseImportGeneration(JSON.stringify({ drafts: [{ ...fixture(), publication_date: '2026-02-29' }] }))[0].publication_date).toBeNull();
    expect(parseImportGeneration(JSON.stringify({ drafts: [fixture()] }))[0]).toMatchObject({ date_confirmed: false, semantics_confirmed: false, scope_confirmed: false });
  });
  it('截止日期必须对应截止句，金额比例必须对应分项项目，不能借用同页的其他数字', () => {
    const wrongDate = fixture('什么时候截止？', '申请截止时间为2026年10月13日17:30（上海时间）。');
    expect(checkImportDraft(batch, wrongDate, categories, true).errors.join()).toContain('截止日期与原文截止句不一致');
    expect(checkImportDraft(batch, { ...wrongDate, question: prefix + '如何申请？' }, categories, true).errors.join()).toContain('截止日期与原文截止句不一致');
    const awards = { ...batch, title: '云峰学园2025-2026学年浙江大学二等奖学金和三等奖学金通知', source_text: `${intro}浙江大学二等奖学金参评条件：成绩排名前50%，奖励4000元。浙江大学三等奖学金参评条件：成绩排名前60%，奖励2000元。` };
    const mixed = { ...fixture(), question: '云峰学园2025级2025-2026学年浙江大学二等奖学金奖励多少？', answer: '云峰学园2025级2025-2026学年浙江大学二等奖学金奖励2000元。', scope: { ...scope, projects: ['浙江大学二等奖学金'] }, excerpts: [awards.source_text] };
    expect(checkImportDraft(awards, mixed, categories, true).errors.join()).toContain('借用了其他项目');
    const combined = { ...mixed, question: mixed.question + '浙江大学三等奖学金', answer: '云峰学园2025级2025-2026学年：\n浙江大学二等奖学金：奖励4000元。\n浙江大学三等奖学金：奖励2000元。', scope: { ...scope, projects: ['浙江大学二等奖学金', '浙江大学三等奖学金'] } };
    expect(checkImportDraft(awards, combined, categories, true).errors).toEqual([]);
    expect(checkImportDraft(awards, { ...combined, answer: combined.answer.replace('奖励4000元', '奖励2000元') }, categories, true).errors.join()).toContain('借用了其他项目');
  });
  it('明确冲突排除；缺范围保留为澄清候选，兼顾旧文件显式学院范围', () => {
    expect(scopeAllowsQuestion(prefix + '如何申请', { scope })).toBe(true);
    for (const q of ['医学院2025级2025-2026学年演示奖学金如何申请', '云峰学园2024级2025-2026学年演示奖学金如何申请', '云峰学园2025级2024-2025学年演示奖学金如何申请', '云峰学园2025级2025-2026学年另一个项目如何申请']) expect(scopeAllowsQuestion(q, { scope })).toBe(false);
    expect(scopeAllowsQuestion('奖学金怎么申请', { scope })).toBe(true);
    expect(assessKnowledgeScope('奖学金怎么申请', { scope }).state).toBe('missing');
    expect(scopeAllowsQuestion('医学院2025级如何申请', { source_level: 2, source_name: title, question: prefix + '如何申请', answer: '' })).toBe(false);
  });
});

describe('隔离数据库完整审核链路', () => {
  it('审核发布后普通问法及配置别名可澄清，确认后回答与追问；各失败状态可区分', async () => {
    const project = '浙江大学二等奖学金', heading = prefix.replace('演示奖学金', project);
    const text = source.replaceAll('演示奖学金', project);
    mocks.fetch.mockImplementationOnce(async (url: string) => ({ sourceUrl: url, title: title.replace('演示奖学金', project), sourceText: text, publishedDate: '2026-10-13',
      dateCandidates: [{ date: '2026-10-13', kind: 'signature', evidence: '云峰学园奖学金评审委员会2026年10月13日' }], fetchedAt: '2026-10-19T01:00:00Z', attachments: [] }));
    const data = { ...fixture(), question: heading + '如何申请？', answer: heading + '：请登录演示平台提交申请。申请截止时间为2026年10月18日17:30（上海时间）。',
      scope: { ...scope, projects: [project] }, excerpts: [text], aliases: ['云峰二奖申报办法', '二奖咋申请'] };
    const { id, state } = await prepare([data]), draft = state.drafts[0];
    async function conversation() {
      mocks.user = MOCK_USERS['student-a'];
      const saved = await getLocalDb().from('conversations').insert({ device_id: mocks.user.id }).select('id').single(); return (saved.data as any).id as string;
    }
    async function question(query: string, conversationId?: string) {
      const conversation_id = conversationId || await conversation();
      const response = await ask(request({ question: query, conversation_id })); expect(response.status).toBe(200);
      return { body: await response.json(), conversation_id };
    }
    const before = (await question('云峰学园2025级2025-2026学年二奖怎么申请')).body;
    expect(before.citations.some((citation: any) => citation.id === draft.id)).toBe(false);
    mocks.user = MOCK_USERS.teacher;
    expect((await publishImport(request({ request_id: randomUUID(), drafts: selection(state) }), context(id))).status).toBe(200);
    mocks.ask.mockClear();
    for (const query of ['二奖怎么申请', '二等奖学金怎么申请', '浙江大学二等奖学金怎么申请', ...data.aliases]) {
      const { body, conversation_id } = await question(query);
      expect(body).toMatchObject({ answerable: false, status: 'needs_scope', reason_code: 'SCOPE_REQUIRED', citations: [] });
      expect(body.scope_candidates.some((c: any) => c.id === draft.id)).toBe(true); expect(body.notice).toContain('2025级'); expect(body.notice).toContain('2025-2026学年');
      expect(body.notice).not.toContain('没有');
      const stored = await getLocalDb().from('conversations').select('topic_context').eq('id', conversation_id).single();
      expect((stored.data as any).topic_context.scope_candidates[0].id).toBe(draft.id);
      const restored = await askHistory(new Request(`http://localhost/api/ask?conversation_id=${conversation_id}`));
      expect((await restored.json()).history[0].response.status).toBe('needs_scope');
      const confirmed = await question('是的', conversation_id);
      expect(confirmed.body).toMatchObject({ status: 'answered', answerable: true }); expect(confirmed.body.citations[0].id).toBe(draft.id); expect(confirmed.body.citations[0].source_level).toBe(2);
      expect(confirmed.body.topic_context.question).toContain('咨询范围：云峰学园');
      const cutoff = await question('什么时候截止', conversation_id); expect(cutoff.body.status).toBe('answered'); expect(cutoff.body.answer).toContain('2026年10月18日');
    }
    expect(mocks.ask).toHaveBeenCalledTimes(5);
    const complete = await question('云峰学园2025级2025—2026学年二奖咋申请'); expect(complete.body.status).toBe('answered');
    const other = await question('医学院2025级2025-2026学年二奖怎么申请'); expect(other.body).toMatchObject({ status: 'no_knowledge', reason_code: 'SCOPE_CONFLICT', citations: [] });
    const none = await question('星际跃迁锂同位素'); expect(none.body).toMatchObject({ status: 'no_knowledge', reason_code: 'NO_RELEVANT_KNOWLEDGE' });
    mocks.ask.mockResolvedValueOnce(JSON.stringify({ answerable: false, answer: '', citations: [], category }));
    expect((await question(heading + '何时开始？')).body).toMatchObject({ status: 'model_refused', reason_code: 'MODEL_REFUSED' });
    mocks.ask.mockResolvedValueOnce(JSON.stringify({ answerable: true, answer: heading + '奖励9000元。', citations: [draft.id], category }));
    const invalid = (await question(heading + '奖励多少？')).body;
    expect(invalid).toMatchObject({ status: 'validation_failed', reason_code: 'ANSWER_VALIDATION_FAILED', validation_error: 'unsupported_amount', citations: [] }); expect(invalid.answer).toBeUndefined();
    const pending = await question('二奖怎么申请');
    await getLocalDb().from('knowledge_items').update({ aliases: [...data.aliases, '二奖补充测试问法'] }).eq('id', draft.id);
    const changed = await question('是的', pending.conversation_id); expect(changed.body.status).toBe('needs_scope');
    expect(changed.body.scope_candidates[0].version).toBeGreaterThan(pending.body.scope_candidates[0].version);
  });
  it('旧草稿重新打开后不再反复提示缺年，不改写原始草稿且可按通知依据发布', async () => {
    const issue = '正文仅写“10月18日（周日）”，未写明年份，需老师确认具体年度';
    const data = { ...fixture('什么时候截止？', '申请截止时间为2026年10月18日17:30（上海时间）。'), publication_date: null, date_confirmed: false, issues: [issue] };
    const { id, state } = await prepare([data]), draft = state.drafts[0];
    expect(draft.data.issues).toEqual([]); expect(draft.validation.date_note).toContain('自动补全年份'); expect(draft.data.date_confirmed).toBe(false);
    const stored = await getLocalDb().from('knowledge_import_drafts').select('data').eq('id', draft.id).single();
    expect((stored.data as any).data.issues).toEqual([issue]); expect((stored.data as any).data.answer).toBe(data.answer);
    const published = await publishImport(request({ request_id: randomUUID(), drafts: selection(state) }), context(id));
    expect(published.status).toBe(200); expect((await published.json()).result.count).toBe(1);
  });
  it('新版只生成一版综合草稿，未审核不能发布，保存确认后可发布且重试不重复生成', async () => {
    const id = await capture(), data = fixture('如何申请？', '申请者须获得2项荣誉。请登录演示平台提交申请。申请截止时间为2026年10月18日17:30（上海时间）。');
    mocks.generate.mockResolvedValue(JSON.stringify({ drafts: [data] }));
    expect((await generateImport(request({ version: 1 }), context(id))).status).toBe(200);
    const saved = await read(id); expect(saved.drafts).toHaveLength(1);
    const failed = await publishImport(request({ request_id: randomUUID(), drafts: selection(saved) }), context(id));
    expect(failed.status).toBe(422);
    expect((await failed.json()).details[0].reasons).toEqual(expect.arrayContaining(['尚未确认适用范围，请核对学院、年级、年度和项目', '尚未确认原文支持关系，请核对答案并勾选审核确认']));
    const draft = saved.drafts[0];
    expect((await getLocalDb().from('knowledge_items').select('id').eq('id', draft.id)).data).toEqual([]);
    expect((await editImport(request({ version: saved.batch.version, drafts: [{ ...draft, data }] }), context(id))).status).toBe(200);
    const reviewed = await read(id);
    expect((await publishImport(request({ request_id: randomUUID(), drafts: selection(reviewed) }), context(id))).status).toBe(200);
    expect((await generateImport(request({ version: (await read(id)).batch.version }), context(id))).status).toBe(200);
    expect((await read(id)).drafts).toHaveLength(1); expect(mocks.generate).toHaveBeenCalledOnce();
  });
  it('抓取和整理后学生不可检索；逐条审核发布后实时检索，刷新可恢复且来源等级为2', async () => {
    const rows = [fixture(), fixture('哪些学生可以申请？', '申请者须获得2项荣誉。'), fixture('什么时候截止？', '申请截止时间为2026年10月18日17:30（上海时间）。')];
    const { id, state } = await prepare(rows); const db = getLocalDb(), ids = state.drafts.map((d: any) => d.id);
    expect((await db.from('knowledge_items').select('id').in('id', ids)).data).toEqual([]);
    const generated = await generateImport(request({ version: state.batch.version }), context(id)); expect((await generated.json()).preserved).toBe(true);
    expect((await read(id)).drafts).toHaveLength(3);
    const published = await publishImport(request({ request_id: randomUUID(), drafts: selection(state) }), context(id));
    expect(published.status).toBe(200); expect((await published.json()).result.count).toBe(3);
    const items = (await db.from('knowledge_items').select('*').in('id', ids)).data as KnowledgeItem[];
    expect(items.every(i => i.source_level === 2 && i.source_name === title && i.status === 'confirmed' && !i.valid_from && !i.valid_until && i.scope)).toBe(true);
    expect(retrieveKnowledge(prefix + '如何申请', items, categories)).toHaveLength(3);
    const recalled = retrieveKnowledge('医学院如何申请奖学金', items, categories);
    expect(recalled).toHaveLength(3); expect(recalled.every(item => assessKnowledgeScope('医学院如何申请奖学金', item).state === 'conflict')).toBe(true);
    expect((await read(id)).drafts.every((d: any) => d.status === 'published')).toBe(true);
    mocks.user = MOCK_USERS['student-a'];
    const conversation = await db.from('conversations').insert({ device_id: mocks.user.id }).select('id').single(); const conversationId = (conversation.data as any).id;
    const first = await ask(request({ conversation_id: conversationId, question: prefix + '什么时候截止？' })); const firstData = await first.json();
    expect(first.status).toBe(200); expect(firstData.answerable).toBe(true); expect(firstData.answer).toContain('截止时间已过'); expect(firstData.citations[0].source_level).toBe(2);
    const followup = await (await ask(request({ conversation_id: conversationId, question: '还能申请吗？' }))).json();
    expect(followup.answerable).toBe(true); expect(followup.answer).toContain('不能据此推断允许补报'); expect(followup.topic_context.question).toBe(prefix + '什么时候截止？');
    const contact = await (await ask(request({ conversation_id: conversationId, question: '找谁？' }))).json(); expect(contact.category_id).toBe(category);
    const other = await (await ask(request({ conversation_id: conversationId, question: '那医学院奖学金怎么办理？' }))).json();
    expect(other.citations.every((citation: any) => !ids.includes(citation.id))).toBe(true); expect(other.answer || '').not.toContain('云峰学园'); expect(other.topic_context.question).toContain('医学院');
  });
  it('同URL同指纹复用批次；内容变化新建快照，不覆盖旧依据；重复发布只有同一组ID', async () => {
    const url = `https://example.org/${randomUUID()}`; const id = await capture(url); expect(await capture(url)).toBe(id);
    mocks.fetch.mockResolvedValueOnce({ ...(await mocks.fetch(url)), sourceText: source.replace('2项', '3项') });
    expect(await capture(url)).not.toBe(id); expect((await read(id)).batch.source_text).toBe(source);
    const ready = await prepare(); const requestId = randomUUID(), data = { request_id: requestId, drafts: selection(ready.state) };
    const one = await (await publishImport(request(data), context(ready.id))).json();
    const two = await (await publishImport(request(data), context(ready.id))).json();
    expect(two.result).toEqual(one.result);
    expect((await getLocalDb().from('knowledge_items').select('id').in('id', one.result.ids)).data).toHaveLength(1);
  });
  it('半批目标冲突整批回滚；未发布、失败替换均不提前停用旧知识，旧范围不同也阻止替换', async () => {
    const db = getLocalDb();
    const old = await db.from('knowledge_items').insert({ category_id: category, question: prefix + '如何申请', answer: prefix + '请登录演示平台提交申请。', source_level: 2, source_name: title, scope, status: 'confirmed' }).select('id,version').single();
    const target = old.data as { id: string; version: number };
    const { id, state } = await prepare([fixture(), { ...fixture('哪些学生可以申请？', '申请者须获得2项荣誉。'), supersedes: target.id, replacement_version: target.version }]);
    expect((await db.from('knowledge_items').select('status').eq('id', target.id).single()).data).toMatchObject({ status: 'confirmed' });
    await db.from('knowledge_items').update({ answer: prefix + '新版本答案' }).eq('id', target.id);
    const failed = await publishImport(request({ request_id: randomUUID(), drafts: selection(state) }), context(id)); expect(failed.status).toBe(409);
    expect((await db.from('knowledge_items').select('id').in('id', state.drafts.map((d: any) => d.id))).data).toEqual([]);
    expect((await db.from('knowledge_items').select('status').eq('id', target.id).single()).data).toMatchObject({ status: 'confirmed' });
    const changed = await db.from('knowledge_items').update({ scope: { ...scope, units: ['医学院'] } }).eq('id', target.id).select('version').single();
    const cross = await prepare([{ ...fixture(), supersedes: target.id, replacement_version: (changed.data as any).version }]);
    expect((await publishImport(request({ request_id: randomUUID(), drafts: selection(cross.state) }), context(cross.id))).status).toBe(409);
    const success = await prepare([{ ...fixture(), supersedes: target.id, replacement_version: (changed.data as any).version }]);
    await db.from('knowledge_items').update({ scope }).eq('id', target.id);
    const current = await db.from('knowledge_items').select('version').eq('id', target.id).single();
    const s = success.state; s.drafts[0].data.replacement_version = (current.data as any).version;
    expect((await editImport(request({ version: s.batch.version, drafts: s.drafts.map((d: any) => ({ id: d.id, status: d.status, version: d.version, data: d.data })) }), context(success.id))).status).toBe(200);
    const latest = await read(success.id); expect((await publishImport(request({ request_id: randomUUID(), drafts: selection(latest) }), context(success.id))).status).toBe(200);
    expect((await db.from('knowledge_items').select('status').eq('id', target.id).single()).data).toMatchObject({ status: 'superseded' });
  });
  it('并发编辑及同批重复替换不覆盖新版本；保存非法草稿不等于可以发布', async () => {
    const { id, state } = await prepare(); const row = state.drafts[0];
    const edit = { version: state.batch.version, drafts: [{ id: row.id, version: row.version, status: 'draft', data: { ...row.data, answer: prefix + '捏造9000元' } }] };
    expect((await editImport(request(edit), context(id))).status).toBe(200);
    expect((await editImport(request(edit), context(id))).status).toBe(409);
    const latest = await read(id);
    expect((await publishImport(request({ request_id: randomUUID(), drafts: selection(latest) }), context(id))).status).toBe(422);
    const old = await getLocalDb().from('knowledge_items').insert({ category_id: category, question: prefix, answer: prefix, source_level: 2, source_name: title, scope, status: 'confirmed' }).select('id,version').single();
    const target = old.data as any, replacement = { supersedes: target.id, replacement_version: target.version };
    const duplicates = await prepare([{ ...fixture(), ...replacement }, { ...fixture('哪些学生可以申请？', '申请者须获得2项荣誉。'), ...replacement }]);
    expect((await publishImport(request({ request_id: randomUUID(), drafts: selection(duplicates.state) }), context(duplicates.id))).status).toBe(422);
  });
  it('PDF或安全抓取错误保留链接和具体错误；模型失败原文保留，重试不丢人工编辑', async () => {
    mocks.fetch.mockRejectedValueOnce(new NoticeFetchError('FETCH_UNSUPPORTED'));
    const failed = await captureImport(request({ url: 'https://example.org/notice.pdf' })); expect(failed.status).toBe(422);
    const saved = await failed.json(); expect((await read(saved.id)).batch.requested_url).toBe('https://example.org/notice.pdf');
    const id = await capture(); mocks.generate.mockRejectedValueOnce(new Error('model_timeout'));
    expect((await generateImport(request({ version: 1 }), context(id))).status).toBe(503);
    const state = await read(id); expect(state.batch.source_text).toBe(source); expect(state.batch.error_code).toBe('IMPORT_MODEL_UNAVAILABLE');
    mocks.generate.mockResolvedValueOnce(JSON.stringify({ drafts: [fixture()] }));
    expect((await generateImport(request({ version: 1 }), context(id))).status).toBe(200);
  });
  it('学生不能调用任何导入、生成、编辑、发布或读取接口', async () => {
    mocks.user = MOCK_USERS['student-a']; const id = randomUUID();
    for (const call of [() => listImports(), () => captureImport(request({ url: 'https://example.org' })), () => readImport(request({}), context(id)), () => generateImport(request({ version: 1 }), context(id)), () => editImport(request({}), context(id)), () => publishImport(request({}), context(id))]) expect((await call()).status).toBe(403);
  });
});
