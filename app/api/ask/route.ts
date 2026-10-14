import { NextResponse } from 'next/server';
import { askModel } from '@/lib/llm';
import { getSupabase } from '@/lib/supabase';
import { validateAnswer } from '@/lib/answer-validation';
import { noticeEvidence } from '@/lib/notice-evidence';
import type { AskResponse, Category, Contact, KnowledgeItem, StudentEvent } from '@/lib/types';
import { UUID_RE } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };
type HistoryEntry = { question: string; created_at: string; response?: AskResponse; error?: string };

function serviceError(errorType: string) {
  return NextResponse.json({ error: '服务暂时不可用，请稍后重试', error_type: errorType }, { status: 503, headers });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const deviceId = params.get('device_id');
  const conversationId = params.get('conversation_id');
  if (!deviceId || !UUID_RE.test(deviceId) || !conversationId || !UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: '设备或对话标识无效' }, { status: 400, headers });
  }
  try {
    const db = getSupabase();
    const owner = await db.from('conversations').select('id').eq('id', conversationId).eq('device_id', deviceId).maybeSingle();
    if (owner.error) throw owner.error;
    if (!owner.data) return NextResponse.json({ error: '对话不存在' }, { status: 404, headers });
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
  } catch { return serviceError('database_read_failed'); }
}

export async function POST(request: Request) {
  let payload: unknown;
  try { payload = await request.json(); } catch {
    return NextResponse.json({ error: '请输入问题', error_type: 'invalid_input' }, { status: 400, headers });
  }
  const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  const deviceId = typeof input.device_id === 'string' && UUID_RE.test(input.device_id)
    ? input.device_id : null;
  const conversationId = typeof input.conversation_id === 'string' && UUID_RE.test(input.conversation_id)
    ? input.conversation_id : null;
  if (!question || question.length > 500) {
    return NextResponse.json({ error: '问题需为1到500字', error_type: 'invalid_input' }, { status: 400, headers });
  }
  if (!deviceId || !conversationId) {
    return NextResponse.json({ error: '设备或对话标识无效', error_type: 'invalid_input' }, { status: 400, headers });
  }
  let db: ReturnType<typeof getSupabase>;
  try { db = getSupabase(); } catch { return serviceError('database_not_configured'); }

  try {
    const owner = await db.from('conversations').select('id,title').eq('id', conversationId).eq('device_id', deviceId).maybeSingle();
    if (owner.error) throw owner.error;
    if (!owner.data) return NextResponse.json({ error: '对话不存在', error_type: 'conversation_not_found' }, { status: 404, headers });
    const title = owner.data.title;
    return await answerInConversation(db, question, deviceId, conversationId, title);
  } catch { return serviceError('database_read_failed'); }
}

async function answerInConversation(db: ReturnType<typeof getSupabase>, question: string, deviceId: string, conversationId: string, currentTitle: string) {
  let categoryId: string | null = null;
  let citedIds: string[] = [];
  let answerable = false;
  try {
    // 每次请求实时读取；查询明确排除 draft 和 superseded。
    const [categoriesResult, itemsResult, eventsResult] = await Promise.all([
      db.from('categories').select('id,name,description,sort_order').order('sort_order'),
      db.from('knowledge_items').select('id,category_id,question,answer,source_level,source_name,source_url,updated_at,categories(name)')
        .eq('status', 'confirmed').order('source_level', { ascending: true }).order('updated_at', { ascending: false }),
      db.from('events').select('id,title,source_text,source_url,status,updated_at').neq('status', 'archived'),
    ]);
    if (categoriesResult.error || itemsResult.error || eventsResult.error) throw new Error('database_read_failed');
    const categories = (categoriesResult.data ?? []) as Category[];
    const items = [...(itemsResult.data ?? []) as unknown as KnowledgeItem[],
      ...noticeEvidence((eventsResult.data ?? []) as StudentEvent[])];
    if (!categories.length) throw new Error('database_read_failed');
    const raw = await askModel(question, categories, items);
    const result = validateAnswer(raw, items, categories);
    categoryId = result.category;
    answerable = result.answerable;
    citedIds = result.citations;
    const contactsResult = await db.from('contacts')
      .select('id,name,role,phone,email,office,office_hours')
      .eq('category_id', categoryId).order('role');
    if (contactsResult.error) throw new Error('database_read_failed');
    const contacts = (contactsResult.data ?? []) as Contact[];
    const citations = citedIds.map(id => {
      const { source_name, source_level, source_url, updated_at, source_type, answer } = items.find(item => item.id === id)!;
      return { id, source_name, source_level, source_url, updated_at, source_type,
        ...(source_type === 'saved_notice' ? { source_text: answer } : {}) };
    });
    const response = { answerable, ...(answerable ? { answer: result.answer } : {}), citations, contacts, category_id: categoryId };
    const logResult = await db.from('chat_logs').insert({
      device_id: deviceId, conversation_id: conversationId, question, answerable, category_id: categoryId,
      cited_item_ids: citedIds, error_type: result.errorType, response_json: response,
    });
    if (logResult.error) throw new Error('database_write_failed');
    // 首问用问题命名，后续提问仅更新排序时间。
    await db.from('conversations').update({
      updated_at: new Date().toISOString(),
      ...(currentTitle === '新对话' ? { title: question.slice(0, 30) } : {}),
    }).eq('id', conversationId).eq('device_id', deviceId);
    return NextResponse.json(response, { headers });
  } catch (error) {
    const errorType = error instanceof Error && /^(database_|model_)/.test(error.message)
      ? error.message : 'service_failed';
    // 故障也尽力记日志；日志失败不掩盖原始服务错误。
    await db.from('chat_logs').insert({
      device_id: deviceId, conversation_id: conversationId, question, answerable: false, category_id: categoryId,
      cited_item_ids: [], error_type: errorType,
    }).then(() => {}, () => {});
    return serviceError(errorType);
  }
}
