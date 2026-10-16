import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AUTH_COOKIE, SESSION_SECONDS, signSession, type CurrentUser } from './auth-core';
import { getSupabase } from './supabase';
import { passcodeMatches } from './teacher-auth';
import { badRequest, noStore, serviceUnavailable } from './teacher-api';

export async function teacherLoginFailure(request: Request, passcode: string): Promise<NextResponse | null> {
  const expected = process.env.TEACHER_PASSCODE;
  if (!expected) return serviceUnavailable();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = createHash('sha256').update(ip).digest('hex');
  try {
    const db = getSupabase();
    const current = await db.from('teacher_login_attempts').select('attempts,window_start').eq('key', key).maybeSingle();
    if (current.error) return serviceUnavailable();
    if (current.data && Date.parse(current.data.window_start) > Date.now() - 15 * 60_000 && current.data.attempts >= 5) {
      return badRequest('尝试次数过多，请15分钟后重试', 429);
    }
    if (!passcodeMatches(passcode, expected)) {
      const recorded = await db.rpc('record_teacher_login_failure', { p_key: key });
      return recorded.error ? serviceUnavailable() : badRequest('口令错误', 401);
    }
    const cleared = await db.from('teacher_login_attempts').delete().eq('key', key);
    return cleared.error ? serviceUnavailable() : null;
  } catch { return serviceUnavailable(); }
}

export function sessionResponse(source: CurrentUser['authSource'], subject: string, body: object) {
  const response = NextResponse.json(body, { headers: noStore });
  response.cookies.set(AUTH_COOKIE, signSession(source, subject, process.env.SESSION_SECRET!), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_SECONDS,
  });
  response.cookies.delete('teacher_session');
  return response;
}
