import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { draftFromTeacherReply } from '@/lib/llm';
import { parseDraft } from '@/lib/draft';
import { UUID_RE } from '@/lib/validation';
import { replyFingerprint } from '@/lib/reply-fingerprint';
import { badRequest, noStore, serviceUnavailable, teacherAuthorized, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await teacherAuthorized()) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return badRequest('工单编号无效');
  let input: { reply?: unknown; reply_version?: unknown };
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.reply !== 'string' || !Number.isInteger(input.reply_version)) return badRequest('请提供当前已保存回复及版本');
  try {
    const db = getSupabase();
    const result = await db.from('tickets').select('question,teacher_reply,reply_version,status,sedimented').eq('id', id).maybeSingle();
    if (result.error) return serviceUnavailable();
    if (!result.data) return badRequest('工单不存在', 404);
    if (result.data.status !== 'answered' || !result.data.teacher_reply) return badRequest('请先回复工单');
    if (result.data.sedimented) return badRequest('该工单已入库', 409);
    if (input?.reply !== result.data.teacher_reply || input?.reply_version !== result.data.reply_version) return badRequest('回复尚未保存或已被修改，请先保存并刷新后生成草稿', 409);
    const raw = await draftFromTeacherReply(result.data.question, result.data.teacher_reply);
    const current = await db.from('tickets').select('teacher_reply,reply_version').eq('id', id).maybeSingle();
    if (current.error) return serviceUnavailable();
    if (!current.data || current.data.reply_version !== result.data.reply_version || current.data.teacher_reply !== result.data.teacher_reply) return badRequest('整理期间回复已被另一请求修改，请刷新后重新生成', 409);
    return NextResponse.json({ draft: parseDraft(raw), reply_version: result.data.reply_version, reply_fingerprint: replyFingerprint(id, result.data.reply_version, result.data.teacher_reply) }, { headers: noStore });
  } catch { return serviceUnavailable(); }
}
