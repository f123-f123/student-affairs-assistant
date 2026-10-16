import { NextResponse } from 'next/server';
import { AUTH_COOKIE, MOCK_USERS, SESSION_SECONDS, mockEndpointEnabled, signSession } from '@/lib/auth-core';
import { badRequest, noStore } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!mockEndpointEnabled(new URL(request.url).hostname)) return NextResponse.json({ error: '模拟身份未启用' }, { status: 403, headers: noStore });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: '来源无效' }, { status: 403, headers: noStore });
  let input: unknown;
  try { input = await request.json(); } catch { return badRequest('请求格式无效'); }
  const identity = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>).identity : null;
  if (typeof identity !== 'string' || !Object.hasOwn(MOCK_USERS, identity)) return badRequest('测试身份无效');
  const user = MOCK_USERS[identity];
  const response = NextResponse.json({ user }, { headers: noStore });
  response.cookies.set(AUTH_COOKIE, signSession('mock', identity, process.env.SESSION_SECRET!), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_SECONDS,
  });
  response.cookies.delete('teacher_session');
  return response;
}
