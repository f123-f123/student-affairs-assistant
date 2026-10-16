import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { passcodeMatches } from '@/lib/teacher-auth';
import { AUTH_COOKIE, SESSION_SECONDS, signSession } from '@/lib/auth-core';
import { badRequest, noStore, serviceUnavailable } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (process.env.AUTH_MODE !== 'legacy_teacher') return NextResponse.json({ error: '口令兼容演示未启用' }, { status: 403, headers: noStore });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: '来源无效' }, { status: 403, headers: noStore });
  let input: unknown;
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest('请求格式无效');
  const passcode = (input as Record<string, unknown>).passcode;
  if (typeof passcode !== 'string' || !passcode) return badRequest('请输入口令');
  const expected = process.env.TEACHER_PASSCODE;
  const secret = process.env.SESSION_SECRET;
  if (!expected || !secret || secret.length < 32) return serviceUnavailable();
  try {
    const db = getSupabase();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const key = createHash('sha256').update(ip).digest('hex');
    const current = await db.from('teacher_login_attempts').select('attempts,window_start').eq('key', key).maybeSingle();
    if (current.error) return serviceUnavailable();
    if (current.data && new Date(current.data.window_start).getTime() > Date.now() - 15 * 60_000 && current.data.attempts >= 5) {
      return NextResponse.json({ error: '尝试次数过多，请15分钟后重试' }, { status: 429, headers: noStore });
    }
    if (!passcodeMatches(passcode, expected)) {
      const recorded = await db.rpc('record_teacher_login_failure', { p_key: key });
      if (recorded.error) return serviceUnavailable();
      return NextResponse.json({ error: '口令错误' }, { status: 401, headers: noStore });
    }
    await db.from('teacher_login_attempts').delete().eq('key', key);
    const response = NextResponse.json({ ok: true }, { headers: noStore });
    response.cookies.set(AUTH_COOKIE, signSession('legacy_teacher', 'legacy-teacher', secret), {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      path: '/', maxAge: SESSION_SECONDS,
    });
    response.cookies.delete('teacher_session');
    return response;
  } catch { return serviceUnavailable(); }
}
