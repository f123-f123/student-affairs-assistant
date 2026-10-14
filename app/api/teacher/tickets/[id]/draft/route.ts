import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { draftFromTeacherReply } from '@/lib/llm';
import { parseDraft } from '@/lib/draft';
import { UUID_RE } from '@/lib/validation';
import { badRequest, noStore, serviceUnavailable, teacherAuthorized, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await teacherAuthorized()) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return badRequest('工单编号无效');
  try {
    const db = getSupabase();
    const result = await db.from('tickets').select('question,teacher_reply,status,sedimented').eq('id', id).maybeSingle();
    if (result.error) return serviceUnavailable();
    if (!result.data) return badRequest('工单不存在', 404);
    if (result.data.status !== 'answered' || !result.data.teacher_reply) return badRequest('请先回复工单');
    if (result.data.sedimented) return badRequest('该工单已入库', 409);
    const raw = await draftFromTeacherReply(result.data.question, result.data.teacher_reply);
    return NextResponse.json({ draft: parseDraft(raw) }, { headers: noStore });
  } catch { return serviceUnavailable(); }
}
