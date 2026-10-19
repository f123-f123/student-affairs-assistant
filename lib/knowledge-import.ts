import type { Category, KnowledgeItem, NoticeAttachment, PublicationDateCandidate } from './types';
import { noticeAudience } from './notice-scope';
import { isDateOnly, UUID_RE } from './validation';
import { analyzeNoticeDeadline, shanghaiDateTime } from './event-date';
import { deadlineEvidenceCandidates } from './notice-dates';
import { validateAnswer } from './answer-validation';
import { assessKnowledgeScope } from './knowledge-scope';

export type KnowledgeScope = { units: string[]; cohorts: string[]; years: string[]; projects: string[]; conditions: string[] };
export type ImportData = {
  question: string; answer: string; category_id: string; aliases: string[]; scope: KnowledgeScope;
  excerpts: string[]; issues: string[]; attachment_dependency: boolean; publication_date: string | null;
  date_confirmed: boolean; scope_confirmed: boolean; semantics_confirmed: boolean;
  supersedes: string | null; replacement_version: number | null;
};
export type ImportBatch = { id: string; owner_id: string; requested_url: string; source_url: string | null; title: string; source_text: string;
  published_date: string | null; date_candidates: PublicationDateCandidate[]; attachments: NoticeAttachment[];
  fetched_at: string | null; content_hash: string | null; status: string; error_code: string | null; error_message: string | null; version: number };
export type ImportDraft = { id: string; batch_id: string; version: number; status: 'draft' | 'ignored' | 'published'; data: ImportData; published_item_id: string | null };
export class ImportError extends Error {
  constructor(message: string, public code = 'IMPORT_INVALID', public status = 400, public details?: unknown) { super(message); }
}
const string = (v: unknown, max: number) => { if (typeof v !== 'string' || v.length > max) throw new ImportError('草稿字段类型或长度无效'); return v.trim(); };
function strings(v: unknown, max: number, length: number): string[] {
  if (!Array.isArray(v) || v.length > max) throw new ImportError('草稿数组字段无效');
  return [...new Set(v.map(value => string(value, length)).filter(Boolean))];
}
export function parseImportData(value: unknown): ImportData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ImportError('草稿结构无效');
  const d = value as Record<string, unknown>, s = d.scope as Record<string, unknown>;
  if (!s || typeof s !== 'object' || Array.isArray(s) || typeof d.attachment_dependency !== 'boolean') throw new ImportError('适用范围或附件依赖字段无效');
  const scope = Object.fromEntries(['units', 'cohorts', 'years', 'projects', 'conditions'].map(key => [key, strings(s[key], 12, 150)])) as KnowledgeScope;
  if (d.publication_date != null && !isDateOnly(d.publication_date)) throw new ImportError('日期依据无效');
  if (d.supersedes != null && (typeof d.supersedes !== 'string' || !UUID_RE.test(d.supersedes))) throw new ImportError('替换目标无效');
  const excerpts = strings(d.excerpts, 12, 3000);
  if (excerpts.join('\n\n').length > 6000) throw new ImportError('单条原文依据总长不能超过6000字，请选择直接支持本问题的片段');
  return { question: string(d.question, 500), answer: string(d.answer, 4000), category_id: string(d.category_id, 36),
    aliases: strings(d.aliases, 8, 100), scope, excerpts, issues: strings(d.issues ?? [], 12, 300),
    attachment_dependency: d.attachment_dependency, publication_date: d.publication_date as string | null ?? null,
    date_confirmed: d.date_confirmed === true, scope_confirmed: d.scope_confirmed === true, semantics_confirmed: d.semantics_confirmed === true,
    supersedes: d.supersedes as string | null ?? null, replacement_version: Number.isInteger(d.replacement_version) ? Number(d.replacement_version) : null };
}
export function parseImportGeneration(raw: string): ImportData[] {
  let result: unknown;
  try { result = JSON.parse(raw.trim()); } catch { throw new ImportError('模型未返回合法JSON，请重试整理', 'IMPORT_MODEL_JSON', 422); }
  const rows = (result as { drafts?: unknown })?.drafts;
  if (!Array.isArray(rows) || rows.length !== 1) throw new ImportError('本次仅整理一条综合草稿，模型返回数量不符，请重试整理', 'IMPORT_MODEL_JSON', 422);
  // 日期依据选择和审核字段不由模型决定；有冲突的候选必须留给老师明确选择。
  const drafts = rows.map(row => parseImportData({ ...row, publication_date: null, date_confirmed: false, scope_confirmed: false, semantics_confirmed: false, supersedes: null, replacement_version: null }));
  return drafts;
}
export function requiredNoticeScope(batch: Pick<ImportBatch, 'source_text' | 'title'>): string[] {
  const audience = noticeAudience(batch.source_text)?.replace(/^各位/, '') || '';
  const units = audience.match(/[\p{Script=Han}]{2,20}(?:学院|学园)/gu) || [];
  const cohorts = audience.match(/20\d{2}级/g) || [];
  const years = `${batch.title} ${batch.source_text.slice(0, 350)}`.match(/20\d{2}\s*[-—–至]\s*20\d{2}\s*学年|20\d{2}年度/g) || [];
  return [...new Set([...units, ...cohorts, ...years].map(v => v.replace(/\s/g, '')))];
}
const normalize = (v: string) => v.replace(/[—–至]/g, '-').replace(/％/g, '%').replace(/：/g, ':').replace(/\s/g, '');
// 必要条件由模型摘取原词，逐字包含会把仅标点、括号或连接词不同的已写明要求误判为缺失。
const conditionText = (v: string) => normalize(v).replace(/[，。、；,;．.！!？?：:（）()「」“”‘’"'《》【】\[\]~]/g, '');
function conditionCovered(text: string, condition: string) {
  const haystack = conditionText(text), needle = conditionText(condition);
  if (!needle || haystack.includes(needle)) return true;
  // 短语被连接词（如“为”）隔开时比较字词重合度；短条件词仍须逐字出现，避免放宽过猛。
  if (needle.length < 8) return false;
  const grams = [...new Set(Array.from(needle, (_, index) => needle.slice(index, index + 2)).filter(gram => gram.length === 2))];
  return grams.filter(gram => haystack.includes(gram)).length / grams.length >= 0.8;
}
function draftDeadline(batch: ImportBatch, data: ImportData) {
  const evidence = data.excerpts.flatMap(deadlineEvidenceCandidates).find(text => batch.source_text.includes(text)) || null;
  return analyzeNoticeDeadline(batch.source_text, evidence, data.publication_date, batch.date_candidates);
}
function importDateReview(batch: ImportBatch, data: ImportData, deadline = draftDeadline(batch, data)) {
  const dates = [...new Set(deadline.context.candidates.map(candidate => candidate.date))];
  const evidence = deadline.evidence || '';
  const autoYear = !!deadline.deadline && deadline.inferred && dates.length === 1 && deadline.publishDate === dates[0]
    && !/\d{4}[年./-]|本周|下周|下月/.test(evidence) && /\d{1,2}[月./-]\s*\d{1,2}/.test(evidence)
    && shanghaiDateTime(deadline.deadline).slice(0, 10).replaceAll('/', '-') >= dates[0]
    && deadlineEvidenceCandidates(batch.source_text).every(quote => analyzeNoticeDeadline(batch.source_text, quote, null, batch.date_candidates).deadline === deadline.deadline);
  const issues = data.issues.filter(issue => !(autoYear
    && /(?:未|没|缺|省略|不含|不带|没有).{0,8}(?:年|年份)|(?:年份|年度).{0,8}(?:未明确|不明|待确认|待核对)/.test(issue)
    && !/附件|材料|资格|条件|金额|比例|联系|适用|范围|年级|开始|跨年|时区|时刻|不一致|矛盾|多[个处]|日期冲突|年份冲突/.test(issue)));
  const candidate = deadline.context.candidates.find(c => c.date === dates[0] && c.kind === 'signature') || deadline.context.candidates[0];
  const dateNote = autoYear ? `根据${candidate.kind === 'signature' ? '正文落款' : '网页发布日期'} ${dates[0].replaceAll('-', '/')} 自动补全年份：${shanghaiDateTime(deadline.deadline!)}（上海时间），无需单独确认年份。依据：${candidate.evidence}` : null;
  return { autoYear, issues, dateNote };
}
export function completeImportScope(batch: ImportBatch, original: ImportData): ImportData {
  const scope = Object.fromEntries(Object.entries(original.scope).map(([key, values]) => [key, [...values]])) as KnowledgeScope;
  for (const term of requiredNoticeScope(batch)) {
    const key = /级$/.test(term) ? 'cohorts' : /学年|年度/.test(term) ? 'years' : 'units';
    if (!scope[key].some(value => normalize(value) === normalize(term))) scope[key].push(term);
  }
  const terms = [...scope.units, ...scope.cohorts, ...scope.years, ...scope.projects];
  const qualify = (text: string) => terms.every(term => normalize(text).includes(normalize(term))) ? text : `【${terms.join(' · ')}】${text}`;
  const excerpts = [...original.excerpts];
  const audience = noticeAudience(batch.source_text);
  if (audience && !excerpts.some(text => text.includes(audience))) excerpts.push(audience);
  let answer = qualify(original.answer);
  if (/什么时候|何时|截止/.test(`${original.question}\n${original.answer}`)) {
    const resolved = draftDeadline(batch, { ...original, excerpts });
    if (resolved.deadline && resolved.evidence && excerpts.some(text => text.includes(resolved.evidence!)) && !/\d{4}年\d{1,2}月\d{1,2}日/.test(answer)) {
      answer += `\n按通知日期依据补全的截止时间：${shanghaiDateTime(resolved.deadline).replace(/(\d{4})\/(\d{2})\/(\d{2})/, '$1年$2月$3日')}（上海时间）。`;
    }
  }
  const data = parseImportData({ ...original, scope, question: qualify(original.question), answer, excerpts });
  return { ...data, issues: importDateReview(batch, data).issues };
}
export function checkImportDraft(batch: ImportBatch, data: ImportData, categories: Pick<Category, 'id' | 'name'>[], publishing = false) {
  const errors: string[] = [], warnings: string[] = [];
  if (!data.question || !data.answer) errors.push('问题和答案不能为空');
  if (!categories.some(c => c.id === data.category_id)) errors.push('类别不在当前数据库中');
  if (!data.excerpts.length || data.excerpts.some(e => !batch.source_text.includes(e))) errors.push('每段原文依据必须能够在保存的正文中精确定位');
  const excerpt = data.excerpts.join('\n');
  const scopeTerms = Object.values(data.scope).flat();
  const document = normalize(`${batch.title}\n${batch.source_text}`);
  const scopeInSource = [...data.scope.units, ...data.scope.cohorts, ...data.scope.years, ...data.scope.projects]
    .every(term => document.includes(normalize(term))) && data.scope.conditions.every(term => conditionCovered(document, term));
  if (!scopeInSource) errors.push('适用范围包含原文未明确的限定条件');
  const required = requiredNoticeScope(batch);
  for (const term of [...new Set([...required, ...data.scope.units, ...data.scope.cohorts, ...data.scope.years, ...data.scope.projects])]) {
    if (!normalize(JSON.stringify(data.scope)).includes(normalize(term)) || !normalize(data.question).includes(normalize(term)) || !normalize(data.answer).includes(normalize(term))) errors.push(`问题、答案和结构化范围须各自保留：${term}`);
  }
  for (const term of data.scope.conditions) if (!conditionCovered(data.answer, term)) errors.push(`答案缺少必要条件：${term}`);
  if (!scopeTerms.length) warnings.push('原文适用范围不明确，需老师核对，不得推定为全校通用');
  if (!data.scope.projects.length) errors.push('请保留本条对应的项目，避免跨项目使用');
  const namedProjects = batch.title.match(/(?:浙江大学)?[一二三特]等奖学金|国家(?:励志)?奖学金|SQTP/gi) || [];
  if (namedProjects.length && !data.scope.projects.some(project => namedProjects.some(name => normalize(project).includes(normalize(name.replace(/^浙江大学/, '')))))) errors.push('项目范围过于笼统，须保留通知明确的奖学金或项目名称');
  const deadline = draftDeadline(batch, data);
  const dateReview = importDateReview(batch, data, deadline);
  const hasDate = /截止|申请时间/.test(data.question) || /\d{1,2}月\d{1,2}日/.test(data.answer);
  if (data.publication_date && !batch.date_candidates.some(c => c.date === data.publication_date)) errors.push('补全年份只能选择有原文依据的发布日期候选');
  if (hasDate && ['conflict', 'year_required', 'invalid'].includes(deadline.context.state)) errors.push('日期冲突、年份缺失或时间不完整，不能发布日期结论');
  const facts = { deadline: deadline.deadline, deadline_evidence: deadline.evidence };
  const derived = deadline.deadline && deadline.evidence && excerpt.includes(deadline.evidence) ? shanghaiDateTime(deadline.deadline).replace(/(\d{4})\/(\d{2})\/(\d{2})/, '$1年$2月$3日') : '';
  const support = `${excerpt}\n${derived}`;
  const critical = (text: string) => text.match(/\d+(?:\.\d+)?\s*(?:%|％|元|万元|项|份|级|年|月|日|号)|\d{1,2}[:：]\d{2}/g)?.map(normalize) || [];
  const supported = new Set(critical(support));
  if (critical(data.answer).some(fact => !supported.has(fact))) errors.push('答案中的金额、比例、数量或日期缺乏所选摘录支持');
  // 有明确分项标题时，金额和比例还须属于当前项目，不能从另一奖项借用数字。
  for (const scopedProject of data.scope.projects) {
    const project = scopedProject.replace(/^浙江大学/, '');
    const start = batch.source_text.indexOf(`${project}参评条件`);
    if (start >= 0) {
      const ends = namedProjects.map(p => p.replace(/^浙江大学/, '')).filter(p => p !== project)
        .map(p => batch.source_text.indexOf(p, start + project.length)).filter(i => i > start);
      const block = batch.source_text.slice(start, ends.length ? Math.min(...ends) : undefined);
      const factsForProject = new Set(critical(block));
      const answerBlock = data.scope.projects.length === 1 ? data.answer : data.answer.split('\n').filter(line => line.includes(project) && !data.scope.projects.some(other => other !== scopedProject && line.includes(other.replace(/^浙江大学/, '')))).join('\n');
      if (critical(answerBlock).filter(f => /%|％|元|项|份/.test(f)).some(f => !factsForProject.has(f))) errors.push('答案借用了其他项目的金额、比例或数量，请核对本项目分项原文');
    }
  }
  if (deadline.deadline && /截止/.test(`${data.question}\n${data.answer}`)) {
    const [date, time] = shanghaiDateTime(deadline.deadline).split(' '), [year, month, day] = date.split('/').map(Number);
    for (const clause of data.answer.split(/[。；，,\n]/).filter(c => c.includes('截止'))) {
      for (const d of clause.matchAll(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g)) if (d[1] && Number(d[1]) !== year || Number(d[2]) !== month || Number(d[3]) !== day) errors.push('答案中的截止日期与原文截止句不一致');
      for (const t of clause.matchAll(/(\d{1,2})[:：](\d{2})/g)) if (`${t[1].padStart(2, '0')}:${t[2]}` !== time) errors.push('答案中的截止时刻与原文截止句不一致');
    }
  }
  const checked = validateAnswer(JSON.stringify({ answerable: true, answer: data.answer, citations: ['evidence'], category: data.category_id }),
    [{ id: 'evidence', category_id: data.category_id, question: '', answer: support, source_level: 2, source_name: batch.title, source_url: batch.source_url, updated_at: '', categories: null }], categories as Category[]);
  if (!checked.answerable) errors.push(`答案事实或联系方式校验未通过：${checked.errorType}`);
  for (const term of ['开始', '开放', '补报', '撤回', '同时申请']) {
    const statements = data.answer.split(/[。；，,\n]/).filter(clause => clause.includes(term));
    const sourceClauses = excerpt.split(/[。；，,\n]/).filter(clause => clause.includes(term));
    const negative = (text: string) => /不(?:能|得|可|予|允许)|禁止|无需|不能|不可|尚未|未(?:规定|说明|明确|提供)/.test(text);
    if (statements.some(clause => !sourceClauses.some(s => negative(s) === negative(clause) && critical(clause).every(f => critical(s).includes(f))))) errors.push(`“${term}”结论或对应日期缺少一致原文依据`);
  }
  if (/(?:联系|咨询|找).{0,12}(?:老师|辅导员|同学)/.test(data.answer)) errors.push('知识答案不生成具体联系人，请使用contacts负责人卡片');
  if (data.attachment_dependency || /(?:详见|按照|根据|以).{0,12}附件|附件.{0,10}(?:要求|规定|填写|条件)/.test(data.answer)) errors.push('该答案依赖未解析附件，请补齐正文依据后再发布');
  if (hasDate && deadline.inferred && !dateReview.autoYear && !data.date_confirmed) warnings.push('日期推算依据仍有歧义，须老师确认');
  if (dateReview.issues.length) warnings.push(...dateReview.issues);
  if (publishing) {
    if (!data.scope_confirmed) errors.push('尚未确认适用范围，请核对学院、年级、年度和项目');
    if (!data.semantics_confirmed) errors.push('尚未确认原文支持关系，请核对答案并勾选审核确认');
    if (hasDate && deadline.inferred && !dateReview.autoYear && !data.date_confirmed) errors.push('推算的日期尚未确认');
    if (dateReview.issues.length) errors.push('仍有待人工处理的问题，请解决并更新草稿后发布');
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], issues: dateReview.issues, date_note: hasDate ? dateReview.dateNote : null,
    facts: hasDate && facts.deadline && facts.deadline_evidence && excerpt.includes(facts.deadline_evidence) ? facts : null };
}
export function duplicateCandidates(data: ImportData, items: KnowledgeItem[], sourceUrl?: string | null) {
  const grams = (s: string) => { const text = normalize(s); return new Set(Array.from(text, (_, i) => text.slice(i, i + 2))); };
  const query = grams(data.question);
  return items.filter(i => i.category_id === data.category_id).map(item => {
    const words = grams(item.question); const similarity = [...query].filter(w => words.has(w)).length / Math.max(1, Math.min(query.size, words.size));
    const scope = item.scope;
    const differentScope = scope && ['units', 'cohorts', 'years', 'projects'].some(key => {
      const a = data.scope[key as keyof KnowledgeScope], b = scope[key as keyof KnowledgeScope];
      return a.length && b?.length && !a.some(v => b.some(w => normalize(v) === normalize(w)));
    });
    return { ...item, similarity, different_scope: !!differentScope };
  }).filter(i => i.similarity >= .3 || sourceUrl && i.source_url === sourceUrl).sort((a, b) => Number(a.different_scope) - Number(b.different_scope) || b.similarity - a.similarity).slice(0, 5);
}
export function scopeAllowsQuestion(question: string, item: Pick<KnowledgeItem, 'scope'> & Partial<KnowledgeItem>) {
  return assessKnowledgeScope(question, item).state !== 'conflict';
}
