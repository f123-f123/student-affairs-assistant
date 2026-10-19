import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { teacherAuthorized, unauthorized, noStore } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';
export async function GET() {
  if (!await teacherAuthorized()) return unauthorized();
  try {
    const result = await getSupabase().from('events').select('id,title').order('updated_at', { ascending: false }).limit(100);
    if (result.error) throw result.error;
    return NextResponse.json({ events: result.data }, { headers: noStore });
  } catch { return NextResponse.json({ error: '通知事项读取失败' }, { status: 503, headers: noStore }); }
}
