import { NextResponse } from 'next/server';
import { PASSCODE_USERS, passcodeEnabled } from '@/lib/auth-core';
import { sessionResponse, teacherLoginFailure } from '@/lib/login';
import { badRequest, noStore } from '@/lib/teacher-api';

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
    const failure = await teacherLoginFailure(request, passcode);
    if (failure) return failure;
    identity = 'teacher';
  } else {
    if (account !== 'student-a' && account !== 'student-b') return NextResponse.json({ error: '账号或口令错误' }, { status: 401, headers: noStore });
    identity = account;
  }

  const user = PASSCODE_USERS[identity];
  return sessionResponse('passcode', identity, { role: user.role });
}
