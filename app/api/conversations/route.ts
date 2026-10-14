import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE } from '@/lib/validation';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const invalid = () => NextResponse.json({ error: '设备标识无效' }, { status: 400, headers });
const unavailable = () => NextResponse.json({ error: '服务暂时不可用' }, { status: 503, headers });

export async function GET(request: Request) {
  const deviceId = new URL(request.url).searchParams.get('device_id');
  if (!deviceId || !UUID_RE.test(deviceId)) return invalid();
  try {
    const result = await getSupabase().from('conversations')
      .select('id,title,created_at,updated_at').eq('device_id', deviceId).order('updated_at', { ascending: false });
    if (result.error) throw result.error;
    return NextResponse.json({ conversations: result.data }, { headers });
  } catch { return unavailable(); }
}

export async function POST(request: Request) {
  let data: unknown;
  try { data = await request.json(); } catch { return invalid(); }
  const deviceId = data && typeof data === 'object' && 'device_id' in data ? data.device_id : null;
  if (typeof deviceId !== 'string' || !UUID_RE.test(deviceId)) return invalid();
  try {
    const result = await getSupabase().from('conversations')
      .insert({ device_id: deviceId, title: '新对话' }).select('id,title,created_at,updated_at').single();
    if (result.error) throw result.error;
    return NextResponse.json({ conversation: result.data }, { status: 201, headers });
  } catch { return unavailable(); }
}
