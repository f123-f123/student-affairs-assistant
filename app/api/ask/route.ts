import { NextResponse } from 'next/server';
import { askModel } from '@/lib/llm';
import { getSupabase, safeDatabaseError } from '@/lib/supabase';
import { validateAnswer } from '@/lib/answer-validation';
import { retrieveKnowledge } from '@/lib/knowledge-search';
import type { AskResponse, Category, Contact, KnowledgeItem } from '@/lib/types';
import { UUID_RE } from '@/lib/validation';
import { getCurrentUser } from '@/lib/auth';
import { conversationError } from '@/lib/conversation-errors';
import { databaseFailure } from '@/lib/database-failure';
import { retrievalQuestion } from '@/lib/followup-question';

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
    const owner = await db.from('conversations').select('id,title').eq('id', conversationId).eq('device_id', deviceId).maybeSingle();
    if (owner.error) throw owner.error;
    if (!owner.data) return NextResponse.json({ error: '对话不存在', code: 'NOT_FOUND' }, { status: 404, headers });
    const title = owner.data.title;
    return await answerInConversation(db, question, deviceId, conversationId, title);
  } catch (error) { return serviceError('database_read_failed', error); }
}

async function answerInConversation(db: ReturnType<typeof getSupabase>, question: string, deviceId: string, conversationId: string, currentTitle: string) {
  let categoryId: string | null = null;
  let citedIds: string[] = [];
  let answerable = false;
  try {
    // 每次请求实时读取；inactive 替换关系只用于阻止旧政策重新出现，从不作为回答候选。
    const [categoriesResult, itemsResult, previousResult] = await Promise.all([
      db.from('categories').select('id,name,description,sort_order').order('sort_order'),
      db.from('knowledge_items').select('id,category_id,question,answer,aliases,source_level,source_name,source_url,source_excerpt,valid_from,valid_until,supersedes,status,version,updated_at,categories(name)')
        .in('status', ['confirmed', 'inactive']).order('source_level', { ascending: true }).order('updated_at', { ascending: false }),
      db.from('chat_logs').select('question').eq('device_id', deviceId).eq('conversation_id', conversationId)
        .order('created_at', { ascending: false }).limit(3),
    ]);
    if (categoriesResult.error || itemsResult.error || previousResult.error) throw categoriesResult.error || itemsResult.error || previousResult.error;
    const categories = (categoriesResult.data ?? []) as Category[];
    const previousQuestion = previousResult.data?.length
      ? previousResult.data.map(row => row.question as string).reverse().join('；') : null;
    const searchQuestion = retrievalQuestion(question, previousQuestion);
    const items = retrieveKnowledge(searchQuestion, (itemsResult.data ?? []) as unknown as KnowledgeItem[], categories);
    const raw = categories.length && items.length ? await askModel(question, categories, items, searchQuestion === question ? null : previousQuestion) : JSON.stringify({ answerable: false, answer: '', citations: [], category: null });
    const result = validateAnswer(raw, items, categories);
    categoryId = result.category || null;
    answerable = result.answerable;
    citedIds = result.citations;
    const contactsResult = categoryId ? await db.from('contacts')
      .select('id,name,role,phone,email,office,office_hours')
      .eq('category_id', categoryId).order('role') : { data: [], error: null };
    if (contactsResult.error) throw contactsResult.error;
    const contacts = (contactsResult.data ?? []) as Contact[];
    const citations = citedIds.map(id => {
      const { source_name, source_level, source_url, source_excerpt, updated_at, question, answer, version } = items.find(item => item.id === id)!;
      return { id, source_name, source_level, source_url, source_excerpt: source_excerpt ?? null, updated_at, question, answer, version: version ?? 1 };
    });
    const response: AskResponse = { answerable, ...(answerable ? { answer: result.answer } : {}), citations, contacts, category_id: categoryId,
      ...(!categories.length ? { notice: '知识库尚未配置基础分类，暂时无法提供办事依据，请由管理员初始化分类。' }
        : !items.length ? { notice: '当前没有与该问题匹配的有效已审核知识，暂时无法给出有依据的回答；可以提交工单请老师确认。' } : {}),
    };
    const logResult = await db.from('chat_logs').insert({
      device_id: deviceId, conversation_id: conversationId, question, answerable, category_id: categoryId,
      cited_item_ids: citedIds, error_type: result.errorType, response_json: response,
    });
    if (logResult.error) throw logResult.error;
    // 首问用问题命名，后续提问仅更新排序时间。
    await db.from('conversations').update({
      updated_at: new Date().toISOString(),
      ...(currentTitle === '新对话' ? { title: question.slice(0, 30) } : {}),
    }).eq('id', conversationId).eq('device_id', deviceId);
    return NextResponse.json(response, { headers });
  } catch (error) {
    const errorType = error instanceof Error && /^(database_|model_)/.test(error.message)
      ? error.message : error && typeof error === 'object' && 'code' in error ? 'database_query_failed' : 'service_failed';
    // 故障也尽力记日志；日志失败不掩盖原始服务错误。
    await db.from('chat_logs').insert({
      device_id: deviceId, conversation_id: conversationId, question, answerable: false, category_id: categoryId,
      cited_item_ids: [], error_type: errorType,
    }).then(() => {}, () => {});
    return serviceError(errorType, error);
  }
}
