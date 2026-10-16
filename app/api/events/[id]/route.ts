import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { parseEventInput } from '@/lib/event-input';
import { UUID_RE } from '@/lib/validation';
import { getCurrentUser } from '@/lib/auth';
import { unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return error('事项编号无效');
  let input: unknown;
  try { input = await request.json(); } catch { return error('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return error('请求格式无效');
  const fields = input as Record<string, unknown>;
  let changes: Record<string, unknown> = {};
  if (fields.event !== undefined) {
    try { changes = parseEventInput(fields.event); } catch (err) { return error(err instanceof Error ? err.message : '事项内容无效'); }
    if (changes.deadline ? fields.deadline_confirmed !== true : fields.no_deadline_confirmed !== true) return error('请先确认截止时间，或明确选择无截止时间');
  } else if (fields.materials !== undefined) {
    if (!Array.isArray(fields.materials) || fields.materials.length > 100 || fields.materials.some(item =>
      !item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 ||
      typeof item.done !== 'boolean' || typeof item.source_text !== 'string' || item.source_text.length > 1000)) return error('材料内容无效');
    changes = { materials: fields.materials };
  } else if (fields.status === 'active' || fields.status === 'done' || fields.status === 'archived') {
    changes = { status: fields.status };
  } else return error('没有可更新的内容');
  try {
    const db = getSupabase();
    const result = await db.from('events').update(changes).eq('id', id).eq('device_id', user.id).select('id').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return error('事项不存在', 404);
    return NextResponse.json({ ok: true }, { headers });
  } catch { return error('服务暂时不可用', 503); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return error('事项标识无效');
  try {
    const db = getSupabase();
    const result = await db.from('events').delete().eq('id', id).eq('device_id', user.id).select('id').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return error('事项不存在', 404);
    return NextResponse.json({ ok: true }, { headers });
  } catch { return error('服务暂时不可用', 503); }
}
