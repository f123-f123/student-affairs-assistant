import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { UUID_RE } from '@/lib/validation';
import { badRequest, noStore, teacherAuthorized, unauthorized } from '@/lib/teacher-api';
import { isTicketCandidate } from '@/lib/ticket-contract';
import { ticketDatabaseError, ticketResponseError } from '@/lib/ticket-api';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!await teacherAuthorized()) return unauthorized();
  const params = new URL(request.url).searchParams;
  const category = params.get('category_id') || '';
  const page = Number(params.get('page') || '1');
  if (!UUID_RE.test(category) || !Number.isInteger(page) || page < 1 || page > 10000) return badRequest('类别或页码无效');
  try {
    const result = await getSupabase().from('knowledge_items').select('id,category_id,question,answer,updated_at', { count: 'exact' })
      .eq('status', 'confirmed').eq('category_id', category).order('updated_at', { ascending: false }).order('id').range((page - 1) * 10, page * 10 - 1);
    if (result.error) return ticketDatabaseError(result.error);
    if (!Array.isArray(result.data) || !result.data.every(isTicketCandidate) || !Number.isSafeInteger(result.count)) return ticketResponseError();
    return NextResponse.json({ items: result.data, category_id: category, page, page_size: 10, total: result.count }, { headers: noStore });
  } catch (error) { return ticketDatabaseError(error); }
}
