import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE, textField } from '@/lib/validation';
import { badRequest, noStore, serviceUnavailable, teacherAuthorized, unauthorized } from '@/lib/teacher-api';

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
  if (!Number.isInteger(version)) return badRequest('请刷新工单获取回复版本', 409);
  try {
    const db = getSupabase();
    const result = await db.from('tickets').update({ teacher_reply: reply, reply_version: Number(version) + 1, status: 'answered', answered_at: new Date().toISOString() })
      .eq('id', id).eq('reply_version', version).select('id').maybeSingle();
    if (result.error) return serviceUnavailable();
    if (!result.data) return badRequest('工单或回复版本已变化，请刷新，当前编辑未覆盖新回复', 409);
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch { return serviceUnavailable(); }
}
