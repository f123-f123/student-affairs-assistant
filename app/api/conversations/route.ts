import { NextResponse } from 'next/server';
import { getSupabase, safeDatabaseError } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
import { conversationError } from '@/lib/conversation-errors';
import { databaseFailure } from '@/lib/database-failure';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const failure = (status: number, code: 'UNAUTHENTICATED' | 'DATABASE_CONFIG_MISSING' | 'DATABASE_UNAVAILABLE') => {
  const { message } = conversationError(status, code);
  return NextResponse.json({ code, error: message }, { status, headers });
};
const unavailable = (operation: string, error: unknown) => {
  if ((error as { code?: string } | null)?.code === 'PGRST205') return databaseFailure(`conversations.${operation}`, error);
  console.error(`[conversations] ${operation} failed`, safeDatabaseError(error));
  return failure(503, error instanceof Error && error.message === 'database_not_configured' ? 'DATABASE_CONFIG_MISSING' : 'DATABASE_UNAVAILABLE');
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return failure(401, 'UNAUTHENTICATED');
  try {
    const result = await getSupabase().from('conversations')
      .select('id,title,created_at,updated_at').eq('device_id', user.id).order('updated_at', { ascending: false });
    if (result.error) throw result.error;
    return NextResponse.json({ conversations: result.data }, { headers });
  } catch (error) { return unavailable('list', error); }
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return failure(401, 'UNAUTHENTICATED');
  try {
    const result = await getSupabase().from('conversations')
      .insert({ device_id: user.id, title: '新对话' }).select('id,title,created_at,updated_at').single();
    if (result.error) throw result.error;
    return NextResponse.json({ conversation: result.data }, { status: 201, headers });
  } catch (error) { return unavailable('create', error); }
}
