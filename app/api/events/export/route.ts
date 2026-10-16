import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { generateEventsIcs } from '@/lib/event-ics';
import { UUID_RE } from '@/lib/validation';
import type { StudentEvent } from '@/lib/types';
import { getCurrentUser } from '@/lib/auth';
import { unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  if (id && !UUID_RE.test(id)) return NextResponse.json({ error: '事项标识无效' }, { status: 400, headers });
  try {
    const db = getSupabase();
    let query = db.from('events').select('*').eq('device_id', user.id).not('deadline', 'is', null).eq('status', 'active');
    if (id) query = query.eq('id', id);
    const result = await query;
    if (result.error) throw result.error;
    if (!result.data?.length) return NextResponse.json({ error: '没有可导出的截止事项' }, { status: 400, headers });
    const file = generateEventsIcs(result.data as StudentEvent[]);
    return new Response(file, {
      headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${id ? 'student-event' : 'student-schedule'}.ics"` },
    });
  } catch { return NextResponse.json({ error: '导出失败，请稍后重试' }, { status: 503, headers }); }
}
