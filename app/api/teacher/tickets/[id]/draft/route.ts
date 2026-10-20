import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { draftFromTeacherReply } from '@/lib/llm';
import { parseDraft } from '@/lib/draft';
import { UUID_RE } from '@/lib/validation';
import { replyFingerprint } from '@/lib/reply-fingerprint';
import { badRequest, noStore, teacherAuthorized, unauthorized } from '@/lib/teacher-api';
import { replyVersion } from '@/lib/ticket-contract';
import { ticketError, ticketConflict, ticketDatabaseError, ticketResponseError } from '@/lib/ticket-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await teacherAuthorized()) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return badRequest('工单编号无效');
  let input: { reply?: unknown; reply_version?: unknown };
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.reply !== 'string' || !replyVersion(input.reply_version)) return badRequest('请提供当前已保存回复及版本');
  try {
    const db = getSupabase();
    const result = await db.from('tickets').select('question,teacher_reply,reply_version,status,sedimented').eq('id', id).maybeSingle();
    if (result.error) return ticketDatabaseError(result.error);
    if (!result.data) return badRequest('工单不存在', 404);
    if (!replyVersion(result.data.reply_version) || typeof result.data.question !== 'string') return ticketResponseError();
    if (result.data.status !== 'answered' || !result.data.teacher_reply) return badRequest('请先回复工单');
    if (result.data.sedimented) return badRequest('该工单已入库', 409);
    if (input.reply !== result.data.teacher_reply || input.reply_version !== result.data.reply_version) return ticketConflict('回复尚未保存或已被修改，请先核对最新回复');
    let raw: string;
    try { raw = await draftFromTeacherReply(result.data.question, result.data.teacher_reply); }
    catch { return ticketError('TICKET_MODEL_UNAVAILABLE', '草稿整理服务暂时不可用，已保存回复不受影响'); }
    const current = await db.from('tickets').select('teacher_reply,reply_version').eq('id', id).maybeSingle();
    if (current.error) return ticketDatabaseError(current.error);
    if (current.data && !replyVersion(current.data.reply_version)) return ticketResponseError();
    if (!current.data || current.data.reply_version !== result.data.reply_version || current.data.teacher_reply !== result.data.teacher_reply) return ticketConflict('整理期间回复已被另一请求修改，请读取最新回复并重新生成');
    let draft;
    try { draft = parseDraft(raw); } catch (error) {
      if (error instanceof Error && error.message === 'draft_not_reusable') return ticketError('TICKET_DRAFT_NOT_REUSABLE', '回复缺少可复用的通用规则，请核对内部回复；个人批准结果不能直接沉淀为通用知识', 422);
      return ticketError('TICKET_DRAFT_INVALID', '模型草稿格式异常，请重试生成');
    }
    return NextResponse.json({ draft, reply_version: result.data.reply_version, reply_fingerprint: replyFingerprint(id, result.data.reply_version, result.data.teacher_reply) }, { headers: noStore });
  } catch (error) { return ticketDatabaseError(error); }
}
