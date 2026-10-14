import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { parseEventInput } from '@/lib/event-input';
import { UUID_RE } from '@/lib/validation';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers });

export async function GET(request: Request) {
  const deviceId = new URL(request.url).searchParams.get('device_id');
  if (!deviceId || !UUID_RE.test(deviceId)) return error('设备标识无效');
  try {
    const db = getSupabase();
    const result = await db.from('events').select('*').eq('device_id', deviceId)
      .order('deadline', { ascending: true, nullsFirst: false });
    if (result.error) throw result.error;
    return NextResponse.json({ events: result.data }, { headers });
  } catch { return error('服务暂时不可用', 503); }
}

export async function POST(request: Request) {
  let input: unknown;
  try { input = await request.json(); } catch { return error('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return error('请求格式无效');
  const fields = input as Record<string, unknown>;
  if (typeof fields.device_id !== 'string' || !UUID_RE.test(fields.device_id)) return error('设备标识无效');
  let event;
  try { event = parseEventInput(fields.event); } catch (err) { return error(err instanceof Error ? err.message : '事项内容无效'); }
  if (event.deadline ? fields.deadline_confirmed !== true : fields.no_deadline_confirmed !== true) return error('请先确认截止时间，或明确选择无截止时间');
  try {
    const db = getSupabase();
    const result = await db.from('events').insert({ ...event, device_id: fields.device_id }).select('id').single();
    if (result.error) throw result.error;
    return NextResponse.json({ id: result.data.id }, { status: 201, headers });
  } catch { return error('服务暂时不可用', 503); }
}
