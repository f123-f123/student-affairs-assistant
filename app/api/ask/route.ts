import { NextResponse } from 'next/server';
import { askModel } from '@/lib/llm';
import { getSupabase, safeDatabaseError } from '@/lib/supabase';
import { qualifyAnswerScope, validateAnswer } from '@/lib/answer-validation';
import { retrieveKnowledge } from '@/lib/knowledge-search';
import type { AskResponse, Category, KnowledgeItem } from '@/lib/types';
import { withCurrentContacts } from '@/lib/answer-contacts';
import { UUID_RE } from '@/lib/validation';
import { getCurrentUser } from '@/lib/auth';
import { conversationError } from '@/lib/conversation-errors';
import { databaseFailure } from '@/lib/database-failure';
import { isTopicFollowup, retrievalQuestion, topicFromHistory } from '@/lib/followup-question';
import { stageTiming } from '@/lib/stage-timing';
import { shanghaiDateTime } from '@/lib/event-date';
import { assessKnowledgeScope, knowledgeScope } from '@/lib/knowledge-scope';
import { scopeClarification, scopeReply } from '@/lib/ask-scope';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };
type HistoryEntry = { question: string; created_at: string; response?: AskResponse; error?: string };

function serviceError(errorType: string, error?: unknown) {
  if ((error as { code?: string } | null)?.code === 'PGRST205') return databaseFailure(`ask.${errorType}`, error);
  console.error('[conversation history] service unavailable', { operation: errorType, detail: error ? safeDatabaseError(error) : undefined });
  const code = errorType === 'database_not_configured' || (error instanceof Error && error.message === 'database_not_configured') ? 'DATABASE_CONFIG_MISSING'
    : errorType.startsWith('model_') ? 'MODEL_UNAVAILABLE' : errorType.startsWith('database_') ? 'DATABASE_UNAVAILABLE' : 'SERVICE_UNAVAILABLE';
  return NextResponse.json({ error: conversationError(503, code).message, code }, { status: 503, headers });
}
const unauthenticated = () => NextResponse.json({ error: conversationError(401, 'UNAUTHENTICATED').message, code: 'UNAUTHENTICATED' }, { status: 401, headers });

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const params = new URL(request.url).searchParams;
  const deviceId = user.id;
  const conversationId = params.get('conversation_id');
  if (!conversationId || !UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: '对话标识无效', code: 'INVALID_INPUT' }, { status: 400, headers });
  }
  try {
    const db = getSupabase();
    const owner = await db.from('conversations').select('id').eq('id', conversationId).eq('device_id', deviceId).maybeSingle();
    if (owner.error) throw owner.error;
    if (!owner.data) return NextResponse.json({ error: '对话不存在', code: 'NOT_FOUND' }, { status: 404, headers });
    const result = await db.from('chat_logs')
      .select('question,response_json,error_type,created_at')
      .eq('device_id', deviceId).eq('conversation_id', conversationId)
      .order('created_at', { ascending: false }).limit(50);
    if (result.error) throw result.error;
    const history = (result.data ?? []).reverse().map<HistoryEntry>(row => {
      const saved = row.response_json;
      if (saved && typeof saved === 'object' && 'answerable' in saved) {
        return { question: row.question, response: saved as AskResponse, created_at: row.created_at };
      }
      if (typeof row.error_type === 'string' && /^(model_|database_|service_failed)/.test(row.error_type)) {
        return { question: row.question, error: '服务暂时不可用，请稍后重试', created_at: row.created_at };
      }
      return { question: row.question, error: '旧记录未保存回答内容', created_at: row.created_at };
    });
    const entries = history.filter((entry): entry is HistoryEntry & { response: AskResponse } => !!entry.response);
    const current = await withCurrentContacts(db, entries.map(entry => entry.response));
    entries.forEach((entry, index) => { entry.response = current[index]; });
    return NextResponse.json({ history }, { headers });
  } catch (error) { return serviceError('database_read_failed', error); }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  let payload: unknown;
  try { payload = await request.json(); } catch {
    return NextResponse.json({ error: '请输入问题', code: 'INVALID_INPUT' }, { status: 400, headers });
  }
  const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  const deviceId = user.id;
  const conversationId = typeof input.conversation_id === 'string' && UUID_RE.test(input.conversation_id)
    ? input.conversation_id : null;
  if (!question || question.length > 500) {
    return NextResponse.json({ error: '问题需为1到500字', code: 'INVALID_INPUT' }, { status: 400, headers });
  }
  if (!conversationId) {
    return NextResponse.json({ error: '对话标识无效', code: 'INVALID_INPUT' }, { status: 400, headers });
  }
  let db: ReturnType<typeof getSupabase>;
  try { db = getSupabase(); } catch (error) { return serviceError('database_connect_failed', error); }

  try {
    const owner = await db.from('conversations').select('*').eq('id', conversationId).eq('device_id', deviceId).maybeSingle();
    if (owner.error) throw owner.error;
    if (!owner.data) return NextResponse.json({ error: '对话不存在', code: 'NOT_FOUND' }, { status: 404, headers });
    const title = owner.data.title;
    return await answerInConversation(db, question, deviceId, conversationId, title, owner.data.topic_context, Object.hasOwn(owner.data, 'topic_context'));
  } catch (error) { return serviceError('database_read_failed', error); }
}

async function answerInConversation(db: ReturnType<typeof getSupabase>, question: string, deviceId: string, conversationId: string, currentTitle: string, topicContext?: AskResponse['topic_context'] | null, hasTopicColumn = false) {
  const timing = stageTiming('ask');
  let nextTopic: NonNullable<AskResponse['topic_context']> = { question: isTopicFollowup(question) && topicContext?.question ? topicContext.question : question };
  let categoryId: string | null = null;
  let citedIds: string[] = [];
  let answerable = false;
  try {
    // 每次请求实时读取；inactive 替换关系只用于阻止旧政策重新出现，从不作为回答候选。
    const readItems = async () => {
      const fields = 'id,category_id,question,answer,aliases,source_level,source_name,source_url,source_excerpt,valid_from,valid_until,supersedes,status,version,updated_at,categories(name)';
      const query = (select: string) => db.from('knowledge_items').select(select).in('status', ['confirmed', 'inactive']).order('source_level', { ascending: true }).order('updated_at', { ascending: false });
      const result = await query(`${fields},scope,facts`);
      return ['42703', 'PGRST204'].includes(String(result.error?.code)) ? await query(fields) : result;
    };
    const [categoriesResult, itemsResult, previousResult] = await timing.run('read', () => Promise.all([
      db.from('categories').select('id,name,description,sort_order').order('sort_order'),
      readItems(),
      topicContext?.question || !isTopicFollowup(question) ? Promise.resolve({ data: [], error: null }) : db.from('chat_logs').select('question,response_json').eq('device_id', deviceId).eq('conversation_id', conversationId)
        .order('created_at', { ascending: false }).limit(8),
    ]));
    if (categoriesResult.error || itemsResult.error || previousResult.error) throw categoriesResult.error || itemsResult.error || previousResult.error;
    const categories = (categoriesResult.data ?? []) as Category[];
    const previousQuestion = topicContext?.question || topicFromHistory(previousResult.data || []);
    const allItems = (itemsResult.data ?? []) as unknown as KnowledgeItem[];
    const reply = scopeReply(question, topicContext, allItems);
    const searchQuestion = reply?.query || retrievalQuestion(question, previousQuestion);
    nextTopic = { question: reply ? searchQuestion : searchQuestion === question ? question : previousQuestion! };
    // 先召回相关知识，再分别判断冲突、范围缺失和可直接使用的候选。
    const retrieved = retrieveKnowledge(searchQuestion, allItems, categories, new Date(), 32, 48000);
    const scoped = retrieved.map(item => ({ item, assessment: assessKnowledgeScope(searchQuestion, item) }));
    const compatible = scoped.filter(entry => entry.assessment.state !== 'conflict');
    const matched = compatible.filter(entry => entry.assessment.state === 'match');
    const needsScope = compatible[0]?.assessment.state === 'missing' && !matched.some(entry => knowledgeScope(entry.item));
    const items = needsScope ? [] : retrieveKnowledge(searchQuestion, matched.map(entry => entry.item), categories);
    const clarification = needsScope ? scopeClarification(compatible.filter(entry => entry.assessment.state === 'missing').map(entry => entry.item), searchQuestion) : null;
    if (clarification) nextTopic = { question: searchQuestion, scope_candidates: clarification.scope_candidates?.map(({ id, version }) => ({ id, version })) };
    const deadlines = items.filter(item => item.facts?.deadline);
    const onlyDeadline = deadlines.length && new Set(deadlines.map(i => i.facts!.deadline)).size === 1 ? deadlines[0] : null;
    const modelQuestion = reply?.accepted ? topicContext!.question : question;
    const deadlineQuestion = /什么时候截止|何时截止|截止时间|截止日期|截止了吗/.test(modelQuestion) || /^(?:那|现在)?还能申请(?:吗|么|不)?[？?]?$/.test(modelQuestion);
    const factual = onlyDeadline && deadlineQuestion ? { answerable: true,
      answer: `${onlyDeadline.scope ? [ ...onlyDeadline.scope.units, ...onlyDeadline.scope.cohorts, ...onlyDeadline.scope.years, ...onlyDeadline.scope.projects ].join('、') : '该通知'}的申请截止时间为${shanghaiDateTime(onlyDeadline.facts!.deadline).replace(/(\d{4})\/(\d{2})\/(\d{2})/, '$1年$2月$3日')}（上海时间）。${Date.now() > Date.parse(onlyDeadline.facts!.deadline) ? '该截止时间已过；不能据此推断允许补报，请核对原通知或咨询负责人。' : '是否符合申请条件仍需核对该通知的适用范围。'}`,
      citations: [onlyDeadline.id], category: onlyDeadline.category_id } : null;
    const raw = factual ? JSON.stringify(factual) : categories.length && items.length ? await timing.run('model', () => askModel(modelQuestion, categories, items, searchQuestion === question ? null : searchQuestion)) : JSON.stringify({ answerable: false, answer: '', citations: [], category: null });
    const result = validateAnswer(qualifyAnswerScope(raw, items), items, categories);
    categoryId = result.category || null;
    answerable = result.answerable;
    citedIds = result.citations;
    const status: NonNullable<AskResponse['status']> = needsScope ? 'needs_scope' : !items.length ? 'no_knowledge' : result.errorType ? 'validation_failed' : answerable ? 'answered' : 'model_refused';
    const reasonCode = { answered: 'ANSWERED', needs_scope: 'SCOPE_REQUIRED', no_knowledge: retrieved.length ? 'SCOPE_CONFLICT' : 'NO_RELEVANT_KNOWLEDGE', model_refused: 'MODEL_REFUSED', validation_failed: 'ANSWER_VALIDATION_FAILED' }[status];
    if (needsScope) { const ids = [...new Set(compatible.map(entry => entry.item.category_id))]; categoryId = ids.length === 1 ? ids[0] : null; }
    const citations = citedIds.map(id => {
      const { category_id, source_name, source_level, source_url, source_excerpt, updated_at, question, answer, version } = items.find(item => item.id === id)!;
      return { id, category_id, source_name, source_level, source_url, source_excerpt: source_excerpt ?? null, updated_at, question, answer, version: version ?? 1 };
    });
    const notice = clarification?.notice || (!categories.length ? '知识库尚未配置基础分类，请联系管理员。'
      : status === 'no_knowledge' ? retrieved.length ? '找到的相关通知与你明确提供的范围冲突，不能套用；目前没有适用的已审核知识，可提交工单咨询。' : '当前没有与该问题相关的有效已审核知识，可以提交工单请老师确认。'
        : status === 'model_refused' ? '已找到适用范围匹配的知识，但模型判断现有依据不足以回答这个具体问题；可以换一种问法或提交工单。'
          : status === 'validation_failed' ? '模型生成的回答未通过事实或引用校验，已拦截该回答；可以重试或提交工单。' : undefined);
    const [response] = await timing.run('contacts', () => withCurrentContacts(db, [{ answerable, status, reason_code: reasonCode,
      ...(result.errorType ? { validation_error: result.errorType } : {}), ...(answerable ? { answer: result.answer } : {}),
      ...(notice ? { notice } : {}), ...(clarification ? { scope_candidates: clarification.scope_candidates } : {}), citations, contacts: [], category_id: categoryId,
      topic_context: nextTopic,
    }], { categories, itemCategories: new Map(items.map(item => [item.id, item.category_id])) }));
    categoryId = response.category_id;
    const writes = await timing.run('write', () => Promise.all([db.from('chat_logs').insert({
      device_id: deviceId, conversation_id: conversationId, question, answerable, category_id: categoryId,
      cited_item_ids: citedIds, error_type: result.errorType || (status === 'answered' ? null : reasonCode.toLowerCase()), response_json: response,
    }),
    // 首问用问题命名，后续提问仅更新排序时间。
    db.from('conversations').update({
      updated_at: new Date().toISOString(),
      ...(hasTopicColumn ? { topic_context: response.topic_context } : {}),
      ...(currentTitle === '新对话' ? { title: question.slice(0, 30) } : {}),
    }).eq('id', conversationId).eq('device_id', deviceId)]));
    if (writes.some(write => write.error)) throw writes.find(write => write.error)!.error;
    return NextResponse.json(response, { headers: { ...headers, 'Server-Timing': timing.finish() } });
  } catch (error) {
    const errorType = error instanceof Error && /^(database_|model_)/.test(error.message)
      ? error.message : error && typeof error === 'object' && 'code' in error ? 'database_query_failed' : 'service_failed';
    // 故障也尽力记日志；日志失败不掩盖原始服务错误。
    await Promise.all([db.from('chat_logs').insert({
      device_id: deviceId, conversation_id: conversationId, question, answerable: false, category_id: categoryId,
      cited_item_ids: [], error_type: errorType,
    }), ...(hasTopicColumn ? [db.from('conversations').update({ topic_context: nextTopic, updated_at: new Date().toISOString() }).eq('id', conversationId).eq('device_id', deviceId)] : [])]).then(() => {}, () => {});
    return serviceError(errorType, error);
  }
}
