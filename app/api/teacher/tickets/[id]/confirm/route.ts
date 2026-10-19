import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE, textField } from '@/lib/validation';
import { replyFingerprint } from '@/lib/reply-fingerprint';
import { requireTeacher } from '@/lib/auth';
import { badRequest, noStore, serviceUnavailable, teacherAuthorized, unauthorized } from '@/lib/teacher-api';

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
  if (!question || !answer || typeof categoryId !== 'string' || !UUID_RE.test(categoryId) ||
      !(supersedes === null || supersedes === undefined || (typeof supersedes === 'string' && UUID_RE.test(supersedes)))) {
    return badRequest('入库内容无效');
  }
  try {
    const db = getSupabase();
    const ticket = await db.from('tickets').select('teacher_reply,reply_version').eq('id', id).maybeSingle();
    if (ticket.error) return serviceUnavailable();
    if (!ticket.data || !ticket.data.teacher_reply || fields.reply_version !== ticket.data.reply_version ||
      fields.reply_fingerprint !== replyFingerprint(id, ticket.data.reply_version, ticket.data.teacher_reply)) return badRequest('回复已变化或草稿未绑定已保存回复，请重新生成并审核', 409);
    const result = await db.rpc('confirm_ticket_knowledge_checked', {
      p_ticket_id: id, p_question: question, p_answer: answer, p_category_id: categoryId,
      p_supersedes: supersedes ?? null,
      p_expected_reply_version: fields.reply_version, p_actor: user.id,
      p_expected_reply: ticket.data.teacher_reply,
    });
    if (result.error?.message.includes('reply_version_conflict')) return badRequest('回复已被另一请求修改，请重新生成草稿', 409);
    if (result.error?.message.includes('already_sedimented')) return badRequest('该工单已入库，请勿重复提交', 409);
    if (result.error?.message.includes('invalid_supersedes')) return badRequest('替换条目已失效，请刷新后重选', 409);
    if (result.error?.message.includes('ticket_not_answered')) return badRequest('请先回复工单', 409);
    if (result.error?.message.includes('ticket_not_found')) return badRequest('工单不存在', 404);
    if (result.error) return serviceUnavailable();
    return NextResponse.json({ knowledge_item_id: result.data }, { status: 201, headers: noStore });
  } catch { return serviceUnavailable(); }
}
