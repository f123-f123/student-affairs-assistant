import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { noStore, serviceUnavailable, teacherAuthorized, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await teacherAuthorized()) return unauthorized();
  try {
    const db = getSupabase();
    const result = await db.from('tickets').select('id,question,status,sedimented,created_at,categories(name)')
      .order('created_at', { ascending: false });
    if (result.error) return serviceUnavailable();
    const tickets = (result.data ?? []).sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open'));
    return NextResponse.json({ tickets }, { headers: noStore });
  } catch { return serviceUnavailable(); }
}
