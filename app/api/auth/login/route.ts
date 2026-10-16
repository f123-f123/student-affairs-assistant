import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { passcodeMatches } from '@/lib/teacher-auth';
import { AUTH_COOKIE, PASSCODE_USERS, SESSION_SECONDS, passcodeEnabled, signSession } from '@/lib/auth-core';
import { badRequest, noStore, serviceUnavailable } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!passcodeEnabled()) return NextResponse.json({ error: '登录方式未配置' }, { status: 503, headers: noStore });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: '来源无效' }, { status: 403, headers: noStore });
  let input: unknown;
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest('请求格式无效');
  const { account, passcode } = input as Record<string, unknown>;
  if (typeof account !== 'string' || typeof passcode !== 'string') return badRequest('请求格式无效');

  let identity: string;
  if (passcode) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const key = createHash('sha256').update(ip).digest('hex');
    try {
      const db = getSupabase();
      const current = await db.from('teacher_login_attempts').select('attempts,window_start').eq('key', key).maybeSingle();
      if (current.error) return serviceUnavailable();
      if (current.data && new Date(current.data.window_start).getTime() > Date.now() - 15 * 60_000 && current.data.attempts >= 5) {
        return NextResponse.json({ error: '尝试次数过多，请15分钟后重试' }, { status: 429, headers: noStore });
      }
      if (!passcodeMatches(passcode, process.env.TEACHER_PASSCODE!)) {
        const recorded = await db.rpc('record_teacher_login_failure', { p_key: key });
        if (recorded.error) return serviceUnavailable();
        return NextResponse.json({ error: '口令错误' }, { status: 401, headers: noStore });
      }
      await db.from('teacher_login_attempts').delete().eq('key', key);
    } catch { return serviceUnavailable(); }
    identity = 'teacher';
  } else {
    if (account !== 'student-a' && account !== 'student-b') return NextResponse.json({ error: '账号或口令错误' }, { status: 401, headers: noStore });
    identity = account;
  }

  const user = PASSCODE_USERS[identity];
  const response = NextResponse.json({ role: user.role }, { headers: noStore });
  response.cookies.set(AUTH_COOKIE, signSession('passcode', identity, process.env.SESSION_SECRET!), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_SECONDS,
  });
  response.cookies.delete('teacher_session');
  return response;
}
