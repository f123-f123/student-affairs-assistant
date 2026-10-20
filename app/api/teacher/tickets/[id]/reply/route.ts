import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE, textField } from '@/lib/validation';
import { badRequest, noStore, teacherAuthorized, unauthorized } from '@/lib/teacher-api';
import { replyVersion, record } from '@/lib/ticket-contract';
import { ticketConflict, ticketDatabaseError, ticketResponseError } from '@/lib/ticket-api';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await teacherAuthorized()) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return badRequest('工单编号无效');
  let input: unknown;
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest('请求格式无效');
  const reply = textField((input as Record<string, unknown>).reply, 4000);
  const version = (input as Record<string, unknown>).reply_version;
  if (!reply) return badRequest('回复需为1到4000字');
  if (!replyVersion(version)) return ticketConflict('请重新读取工单获取合法回复版本');
  try {
    const db = getSupabase();
    const result = await db.from('tickets').update({ teacher_reply: reply, reply_version: Number(version) + 1, status: 'answered', answered_at: new Date().toISOString() })
      .eq('id', id).eq('reply_version', version).select('id,teacher_reply,reply_version,answered_at').maybeSingle();
    if (result.error) return ticketDatabaseError(result.error);
    if (!result.data) return ticketConflict();
    if (!record(result.data) || !replyVersion(result.data.reply_version) || typeof result.data.teacher_reply !== 'string' || typeof result.data.answered_at !== 'string') return ticketResponseError();
    return NextResponse.json({ ok: true, ...result.data }, { headers: noStore });
  } catch (error) { return ticketDatabaseError(error); }
}
