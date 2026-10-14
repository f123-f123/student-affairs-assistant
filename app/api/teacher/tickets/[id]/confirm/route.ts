import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE, textField } from '@/lib/validation';
import { badRequest, noStore, serviceUnavailable, teacherAuthorized, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await teacherAuthorized()) return unauthorized();
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
    const result = await db.rpc('confirm_ticket_knowledge', {
      p_ticket_id: id, p_question: question, p_answer: answer, p_category_id: categoryId,
      p_supersedes: supersedes ?? null,
    });
    if (result.error?.message.includes('already_sedimented')) return badRequest('该工单已入库，请勿重复提交', 409);
    if (result.error?.message.includes('invalid_supersedes')) return badRequest('替换条目已失效，请刷新后重选', 409);
    if (result.error?.message.includes('ticket_not_answered')) return badRequest('请先回复工单', 409);
    if (result.error?.message.includes('ticket_not_found')) return badRequest('工单不存在', 404);
    if (result.error) return serviceUnavailable();
    return NextResponse.json({ knowledge_item_id: result.data }, { status: 201, headers: noStore });
  } catch { return serviceUnavailable(); }
}
