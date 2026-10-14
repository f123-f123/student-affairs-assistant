import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE } from '@/lib/validation';
import { badRequest, noStore, serviceUnavailable, teacherAuthorized, unauthorized } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await teacherAuthorized()) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return badRequest('工单编号无效');
  try {
    const db = getSupabase();
    const [ticket, categories, items] = await Promise.all([
      db.from('tickets').select('id,question,category_id,status,teacher_reply,sedimented,knowledge_item_id,created_at,answered_at').eq('id', id).maybeSingle(),
      db.from('categories').select('id,name').order('sort_order'),
      db.from('knowledge_items').select('id,category_id,question,answer,updated_at').eq('status', 'confirmed').order('updated_at', { ascending: false }),
    ]);
    if (ticket.error || categories.error || items.error) return serviceUnavailable();
    if (!ticket.data) return badRequest('工单不存在', 404);
    return NextResponse.json({ ticket: ticket.data, categories: categories.data, items: items.data }, { headers: noStore });
  } catch { return serviceUnavailable(); }
}
