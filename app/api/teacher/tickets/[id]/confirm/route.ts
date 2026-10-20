import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE, textField } from '@/lib/validation';
import { replyFingerprint } from '@/lib/reply-fingerprint';
import { requireTeacher } from '@/lib/auth';
import { badRequest, noStore, unauthorized } from '@/lib/teacher-api';
import { replyVersion } from '@/lib/ticket-contract';
import { ticketError, ticketConflict, ticketDatabaseError, ticketResponseError } from '@/lib/ticket-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireTeacher(); if (!user) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return badRequest('工单编号无效');
  let input: unknown;
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest('请求格式无效');
  const fields = input as Record<string, unknown>;
  const question = textField(fields.question, 500);
  const answer = textField(fields.answer, 4000);
  const categoryId = fields.category_id;
  const supersedes = fields.supersedes;
  if (fields.public_reviewed !== true) return ticketError('TICKET_PUBLIC_REVIEW_REQUIRED', '请核对将向学生公开的问题、答案及依据后确认', 400);
  if (!(fields.public_excerpt === null || typeof fields.public_excerpt === 'string') || (typeof fields.public_excerpt === 'string' && fields.public_excerpt.length > 4000)) return badRequest('公开依据需为空或不超过4000字');
  const publicExcerpt = typeof fields.public_excerpt === 'string' ? fields.public_excerpt.trim() || null : null;
  if (!replyVersion(fields.reply_version) || typeof fields.reply_fingerprint !== 'string') return ticketConflict('草稿缺少合法回复绑定，请重新生成');
  if (!question || !answer || typeof categoryId !== 'string' || !UUID_RE.test(categoryId) ||
      !(supersedes === null || supersedes === undefined || (typeof supersedes === 'string' && UUID_RE.test(supersedes)))) {
    return badRequest('入库内容无效');
  }
  try {
    const db = getSupabase();
    const ticket = await db.from('tickets').select('teacher_reply,reply_version').eq('id', id).maybeSingle();
    if (ticket.error) return ticketDatabaseError(ticket.error);
    if (ticket.data && !replyVersion(ticket.data.reply_version)) return ticketResponseError();
    if (!ticket.data || !ticket.data.teacher_reply || fields.reply_version !== ticket.data.reply_version ||
      fields.reply_fingerprint !== replyFingerprint(id, ticket.data.reply_version, ticket.data.teacher_reply)) return ticketConflict('回复已变化或草稿未绑定已保存回复，请重新生成并审核');
    const result = await db.rpc('confirm_ticket_knowledge_public_checked', {
      p_ticket_id: id, p_question: question, p_answer: answer, p_category_id: categoryId,
      p_supersedes: supersedes ?? null,
      p_expected_reply_version: fields.reply_version, p_actor: user.id,
      p_expected_reply: ticket.data.teacher_reply,
      p_public_excerpt: publicExcerpt, p_public_reviewed: true,
    });
    if (result.error?.message.includes('reply_version_conflict')) return ticketConflict();
    if (result.error?.message.includes('already_sedimented')) return ticketError('TICKET_ALREADY_PUBLISHED', '该工单已入库，请勿重复提交', 409);
    if (result.error?.message.includes('invalid_supersedes')) return ticketError('TICKET_REPLACEMENT_CONFLICT', '替换条目已失效或类别变化，请重新查询候选', 409);
    if (result.error?.message.includes('ticket_not_answered')) return ticketError('TICKET_NOT_ANSWERED', '请先回复工单', 409);
    if (result.error?.message.includes('ticket_not_found')) return ticketError('TICKET_NOT_FOUND', '工单不存在', 404);
    if (result.error?.message.includes('invalid_category')) return ticketError('TICKET_CATEGORY_INVALID', '类别不存在，请重新选择', 400);
    if (result.error) return ticketDatabaseError(result.error);
    if (typeof result.data !== 'string' || !UUID_RE.test(result.data)) return ticketResponseError();
    return NextResponse.json({ knowledge_item_id: result.data }, { status: 201, headers: noStore });
  } catch (error) { return ticketDatabaseError(error); }
}
