import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { noStore, serviceUnavailable, teacherAuthorized, unauthorized } from '@/lib/teacher-api';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!await teacherAuthorized()) return unauthorized();
  try {
    const db = getSupabase();
    const [manual, imported] = await Promise.all([db.from('knowledge_items').select('id', { count: 'exact', head: true }).eq('status', 'draft'), db.from('knowledge_import_drafts').select('id', { count: 'exact', head: true }).eq('status', 'draft')]);
    if (manual.error || imported.error && !['PGRST205', '42P01'].includes(imported.error.code)) return serviceUnavailable();
    return NextResponse.json({ draft_count: manual.count, import_draft_count: imported.error ? null : imported.count }, { headers: noStore });
  } catch { return serviceUnavailable(); }
}
