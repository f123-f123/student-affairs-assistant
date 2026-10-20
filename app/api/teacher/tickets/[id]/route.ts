import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE } from '@/lib/validation';
import { badRequest, noStore, teacherAuthorized, unauthorized } from '@/lib/teacher-api';
import { isTicketDetail } from '@/lib/ticket-contract';
import { ticketDatabaseError, ticketResponseError } from '@/lib/ticket-api';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await teacherAuthorized()) return unauthorized();
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return badRequest('工单编号无效');
  try {
    const db = getSupabase();
    const [ticket, categories] = await Promise.all([
      db.from('tickets').select('id,question,category_id,status,teacher_reply,reply_version,sedimented,knowledge_item_id,created_at,answered_at').eq('id', id).maybeSingle(),
      db.from('categories').select('id,name').order('sort_order'),
    ]);
    if (ticket.error || categories.error) return ticketDatabaseError(ticket.error || categories.error);
    if (!ticket.data) return badRequest('工单不存在', 404);
    const detail = { ticket: ticket.data, categories: categories.data };
    if (!isTicketDetail(detail)) return ticketResponseError();
    return NextResponse.json(detail, { headers: noStore });
  } catch (error) { return ticketDatabaseError(error); }
}
