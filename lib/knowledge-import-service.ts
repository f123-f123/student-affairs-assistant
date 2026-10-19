import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireTeacher } from './auth';
import { noStore, unauthorized } from './teacher-api';
import { getSupabase } from './supabase';
import { fetchNotice } from './safe-fetch';
import { NoticeFetchError } from './fetch-errors';
import { generateOfficialKnowledge } from './llm';
import { checkImportDraft, completeImportScope, duplicateCandidates, ImportError, parseImportData, parseImportGeneration, type ImportBatch, type ImportDraft } from './knowledge-import';
import type { Category, KnowledgeItem } from './types';
import { UUID_RE } from './validation';
import { stageTiming } from './stage-timing';

type Db = ReturnType<typeof getSupabase>;
type Context = { params: Promise<{ id: string }> };
async function body(request: Request) {
  try { const data = await request.json(); if (!data || typeof data !== 'object' || Array.isArray(data)) throw 0; return data as Record<string, unknown>; }
  catch { throw new ImportError('请求格式无效'); }
}
function checked<T extends { error: unknown; data: unknown }>(result: T): T['data'] { if (result.error) throw result.error; return result.data; }
function failure(cause: unknown) {
  if (cause instanceof ImportError) return NextResponse.json({ error: cause.message, code: cause.code, details: cause.details }, { status: cause.status, headers: noStore });
  const code = String((cause as { code?: string })?.code || '');
  const message = String((cause as { message?: string })?.message || '');
  if (['PGRST202', 'PGRST204', 'PGRST205', '42703'].includes(code)) return NextResponse.json({ error: '官网导入尚未部署，请执行 migration_official_knowledge_import.sql；既有知识未改变', code: 'IMPORT_SCHEMA_REQUIRED' }, { status: 503, headers: noStore });
  if (message.includes('IMPORT_CONFLICT:')) {
    const match = /IMPORT_CONFLICT:([^:]+):(.+)/.exec(message);
    const reasons: Record<string, string> = { batch_version: '批次版本已变化，请先保留编辑并重新读取批次', draft_version: '草稿已被编辑、忽略或发布，请核对当前版本',
      replacement_version: '替换目标已更新或停用，当前操作未停用旧知识', replacement_scope: '替换目标的学院、年级、年度或项目不同，请保留为独立知识',
      replacement_scope_unknown: '旧条目范围无法核实，请保留为独立知识，不能跨范围替换', duplicate_replacement: '不能在同一批选择中重复替换同一旧条目',
      request_reused: '本次操作编号已用于其他内容，请刷新核对已发布结果', evidence: '原文依据缺失或已变化', unreviewed: '人工核对未完成或仍依赖未解析附件' };
    return NextResponse.json({ error: '本次操作未新增知识，请核对具体冲突；已保存内容保持不变', code: 'IMPORT_CONFLICT',
      details: match ? [{ id: match[1], reasons: [reasons[match[2]] || match[2]] }] : [] }, { status: 409, headers: noStore });
  }
  if (code === '23505') return NextResponse.json({ error: '该发布操作或条目已存在，请刷新核对，未重复创建知识', code: 'IMPORT_CONFLICT' }, { status: 409, headers: noStore });
  return NextResponse.json({ error: /^model_/.test(message) ? '模型整理暂时失败，原文及已保存草稿保留，可重试整理' : '导入服务暂时不可用，已保存内容保留，请重试当前步骤', code: /^model_/.test(message) ? 'IMPORT_MODEL_UNAVAILABLE' : 'IMPORT_UNAVAILABLE' }, { status: 503, headers: noStore });
}
async function load(db: Db, id: string) {
  if (!UUID_RE.test(id)) throw new ImportError('批次编号无效');
  const [batch, drafts, categories] = await Promise.all([
    db.from('knowledge_imports').select('*').eq('id', id).maybeSingle(),
    db.from('knowledge_import_drafts').select('*').eq('batch_id', id).order('created_at').order('id'),
    db.from('categories').select('id,name').order('sort_order'),
  ]);
  checked(batch); checked(drafts); checked(categories);
  if (!batch.data) throw new ImportError('批次不存在', 'IMPORT_NOT_FOUND', 404);
  return { batch: batch.data as ImportBatch, drafts: drafts.data as ImportDraft[], categories: categories.data as Category[] };
}
export async function listImports() {
  if (!await requireTeacher()) return unauthorized();
  try {
    const result = await getSupabase().from('knowledge_imports').select('id,title,source_url,requested_url,status,error_message,created_at,version').order('created_at', { ascending: false }).limit(50);
    return NextResponse.json({ batches: checked(result) }, { headers: noStore });
  } catch (cause) { return failure(cause); }
}
export async function captureImport(request: Request) {
  const user = await requireTeacher(); if (!user) return unauthorized();
  const timing = stageTiming('official.capture');
  try {
    const input = await body(request);
    if (typeof input.url !== 'string' || input.url.length > 2000) throw new ImportError('请输入单篇官网文章链接');
    let fetchUrl: string;
    try { const url = new URL(input.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw 0; url.hash = ''; fetchUrl = url.href; } catch { throw new ImportError('仅支持无凭据的HTTP/HTTPS官网文章链接'); }
    const db = getSupabase();
    // 先确认部署能力；不会先抓取后悄悄丢失原文快照。
    checked(await db.from('knowledge_imports').select('id').limit(1));
    let snapshot;
    try {
      const domains = (process.env.ALLOWED_FETCH_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      snapshot = await timing.run('fetch', () => fetchNotice(fetchUrl, domains));
    } catch (cause) {
      if (!(cause instanceof NoticeFetchError)) throw cause;
      const saved = await db.rpc('capture_knowledge_import', { p_data: { owner_id: user.id, requested_url: input.url, source_url: null,
        title: '', source_text: '', published_date: null, date_candidates: [], attachments: [], content_hash: null, fetched_at: null,
        status: 'failed', error_code: cause.code, error_message: cause.message } });
      const data = checked(saved) as { id: string };
      return NextResponse.json({ ...data, error: cause.message, code: cause.code, stage: cause.stage, url: input.url }, { status: cause.status, headers: noStore });
    }
    const content = { source_url: snapshot.sourceUrl, title: snapshot.title, source_text: snapshot.sourceText, published_date: snapshot.publishedDate,
      date_candidates: snapshot.dateCandidates, attachments: snapshot.attachments };
    const saved = await timing.run('save', () => db.rpc('capture_knowledge_import', { p_data: { ...content, requested_url: input.url, owner_id: user.id,
      content_hash: createHash('sha256').update(JSON.stringify(content)).digest('hex'), fetched_at: snapshot.fetchedAt, status: 'fetched', error_code: null, error_message: null } }));
    return NextResponse.json({ ...checked(saved) as object, timings: timing.timings }, { headers: { ...noStore, 'Server-Timing': timing.finish() } });
  } catch (cause) { return failure(cause); }
}
export async function readImport(_request: Request, context: Context) {
  if (!await requireTeacher()) return unauthorized();
  try {
    const db = getSupabase(), { id } = await context.params;
    const state = await load(db, id);
    const items = await db.from('knowledge_items').select('id,category_id,question,answer,aliases,status,source_level,source_name,source_url,source_excerpt,scope,version,updated_at').in('status', ['confirmed', 'draft', 'inactive']);
    checked(items);
    return NextResponse.json({ ...state, drafts: state.drafts.map(d => {
      const validation = checkImportDraft(state.batch, d.data, state.categories);
      return { ...d, data: { ...d.data, issues: validation.issues }, validation,
        duplicates: duplicateCandidates(d.data, items.data as KnowledgeItem[], state.batch.source_url).map(item => ({ ...item, same_source: item.source_url === state.batch.source_url })) };
    }) }, { headers: noStore });
  } catch (cause) { return failure(cause); }
}
export async function generateImport(request: Request, context: Context) {
  if (!await requireTeacher()) return unauthorized();
  const timing = stageTiming('official.generate');
  let failedBatch: { id: string; version: number } | null = null;
  try {
    const input = await body(request), db = getSupabase(), { id } = await context.params;
    if (!Number.isInteger(input.version)) throw new ImportError('缺少批次版本');
    const state = await timing.run('read', () => load(db, id));
    if (state.batch.version !== input.version) throw new ImportError('批次已更新，请刷新', 'IMPORT_CONFLICT', 409);
    if (state.drafts.length) return NextResponse.json({ preserved: true, message: '已有草稿已保留，请继续审核；不会重新生成覆盖人工编辑' }, { headers: noStore });
    if (!state.batch.content_hash || !state.batch.source_text) throw new ImportError('请先成功抓取正文', 'IMPORT_FETCH_REQUIRED', 409);
    failedBatch = { id, version: state.batch.version };
    const raw = await timing.run('model', () => generateOfficialKnowledge(state.batch, state.categories));
    const drafts = await timing.run('validate', () => parseImportGeneration(raw).map(data => completeImportScope(state.batch, data)));
    // 未知类别属于结构错误；其他事实问题保存为可编辑、不可发布的草稿。
    if (drafts.some(d => !state.categories.some(c => c.id === d.category_id))) throw new ImportError('模型使用了不存在的类别，请重试整理', 'IMPORT_MODEL_CATEGORY', 422);
    const saved = await timing.run('save', () => db.rpc('edit_knowledge_import', { p_batch_id: id, p_expected_version: input.version, p_mode: 'generate',
      p_drafts: drafts.map(data => ({ id: randomUUID(), data })) })); checked(saved);
    return NextResponse.json({ count: drafts.length, timings: timing.timings }, { headers: { ...noStore, 'Server-Timing': timing.finish() } });
  } catch (cause) {
    if (failedBatch) {
      try { await getSupabase().from('knowledge_imports').update({ error_code: cause instanceof ImportError ? cause.code : 'IMPORT_MODEL_UNAVAILABLE', error_message: '整理失败，原文及已有编辑保留，请重试整理' }).eq('id', failedBatch.id).eq('version', failedBatch.version); }
      catch { console.info('[import] could not persist failure status'); }
    }
    timing.finish();
    return failure(cause);
  }
}
export async function editImport(request: Request, context: Context) {
  if (!await requireTeacher()) return unauthorized();
  try {
    const input = await body(request), { id } = await context.params;
    if (!UUID_RE.test(id) || !Number.isInteger(input.version) || !Array.isArray(input.drafts) || !input.drafts.length || input.drafts.length > 8) throw new ImportError('草稿编辑内容无效');
    const drafts = input.drafts.map(row => {
      if (!row || !UUID_RE.test(row.id) || !Number.isInteger(row.version) || !['draft', 'ignored'].includes(row.status)) throw new ImportError('草稿编号、版本或状态无效');
      return { id: row.id, version: row.version, status: row.status, data: parseImportData(row.data) };
    });
    if (new Set(drafts.map(d => d.id)).size !== drafts.length) throw new ImportError('重复的草稿编号');
    checked(await getSupabase().rpc('edit_knowledge_import', { p_batch_id: id, p_expected_version: input.version, p_mode: 'edit', p_drafts: drafts }));
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (cause) { return failure(cause); }
}
export async function publishImport(request: Request, context: Context) {
  const user = await requireTeacher(); if (!user) return unauthorized();
  const timing = stageTiming('official.publish');
  try {
    const input = await body(request), { id } = await context.params, db = getSupabase();
    if (typeof input.request_id !== 'string' || !UUID_RE.test(input.request_id) || !Array.isArray(input.drafts) || !input.drafts.length || input.drafts.length > 8) throw new ImportError('发布操作编号或选择无效');
    if (input.drafts.some(row => !row || typeof row.id !== 'string' || !UUID_RE.test(row.id) || !Number.isInteger(row.version))) throw new ImportError('发布草稿编号或版本无效');
    const state = await timing.run('read', () => load(db, id));
    const failures: { id: string; reasons: string[] }[] = [], targets = new Set<string>();
    const entries = input.drafts.map(row => {
      const draft = state.drafts.find(d => d.id === row.id);
      if (!draft || draft.version !== row.version || draft.status === 'ignored') { failures.push({ id: row.id, reasons: ['草稿版本或状态已变化'] }); return null; }
      const validation = checkImportDraft(state.batch, draft.data, state.categories, true);
      if (draft.data.supersedes) {
        if (targets.has(draft.data.supersedes)) validation.errors.push('本次选择重复替换同一旧条目');
        targets.add(draft.data.supersedes);
        if (!draft.data.replacement_version) validation.errors.push('缺少替换目标版本');
      }
      if (validation.errors.length) failures.push({ id: draft.id, reasons: validation.errors });
      return { id: draft.id, version: draft.version, data: draft.data, facts: validation.facts };
    });
    if (new Set(input.drafts.map(d => d.id)).size !== input.drafts.length) throw new ImportError('不能重复选择同一草稿');
    if (failures.length) throw new ImportError('部分草稿未通过校验，整批未发布', 'IMPORT_VALIDATION_FAILED', 422, failures);
    const published = await timing.run('publish', () => db.rpc('publish_knowledge_import', { p_batch_id: id, p_request_id: input.request_id, p_actor: user.id, p_entries: entries }));
    return NextResponse.json({ result: checked(published), timings: timing.timings }, { headers: { ...noStore, 'Server-Timing': timing.finish() } });
  } catch (cause) { return failure(cause); }
}
