import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { ticketLimit, ticketWindow } from '@/lib/ticket-limit';
import { textField } from '@/lib/validation';
import { getCurrentUser } from '@/lib/auth';
import { noStore, badRequest, serviceUnavailable, unauthorized } from '@/lib/teacher-api';
import { databaseFailure } from '@/lib/database-failure';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  try {
    const db = getSupabase();
    const result = await db.from('tickets')
      .select('id,question,status,teacher_reply,sedimented,created_at,answered_at,categories(name)')
      .eq('device_id', user.id).order('created_at', { ascending: false });
    if (result.error) return databaseFailure('tickets.list', result.error);
    return NextResponse.json({ tickets: result.data }, { headers: noStore });
  } catch (cause) { return databaseFailure('tickets.list', cause); }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  let input: unknown;
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest('请求格式无效');
  const fields = input as Record<string, unknown>;
  const question = textField(fields.question, 500);
  if (!question) return badRequest('问题需为1到500字');
  try {
    const db = getSupabase();
    const now = new Date();
    const { minuteStart, dayStart } = ticketWindow(now);
    const [minute, day, categories] = await Promise.all([
      db.from('tickets').select('id', { count: 'exact', head: true }).eq('device_id', user.id).gte('created_at', minuteStart),
      db.from('tickets').select('id', { count: 'exact', head: true }).eq('device_id', user.id).gte('created_at', dayStart),
      db.from('categories').select('id,name'),
    ]);
    if (minute.error || day.error || categories.error) return serviceUnavailable();
    if (!categories.data?.length) return NextResponse.json({ code: 'CATEGORIES_NOT_INITIALIZED', error: '尚未配置基础分类，请由管理员先初始化分类后再提交工单' }, { status: 503, headers: noStore });
    const limit = ticketLimit(minute.count ?? 0, day.count ?? 0);
    if (limit) return NextResponse.json({ error: limit === 'minute' ? '每分钟最多提交3张工单' : '每天最多提交20张工单', error_type: 'rate_limited' }, { status: 429, headers: noStore });
    const fallback = categories.data.find(c => c.name === '综合事务')?.id;
    const categoryId = categories.data.some(c => c.id === fields.category_id) ? fields.category_id : fallback;
    if (!categoryId) return serviceUnavailable();
    const result = await db.from('tickets').insert({ device_id: user.id, question, category_id: categoryId })
      .select('id').single();
    if (result.error) return serviceUnavailable();
    return NextResponse.json({ id: result.data.id }, { status: 201, headers: noStore });
  } catch { return serviceUnavailable(); }
}
