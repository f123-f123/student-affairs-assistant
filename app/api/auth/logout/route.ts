import { NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/auth-core';
import { noStore } from '@/lib/teacher-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: '来源无效' }, { status: 403, headers: noStore });
  const response = NextResponse.json({ ok: true }, { headers: noStore });
  response.cookies.delete(AUTH_COOKIE);
  response.cookies.delete('teacher_session');
  return response;
}
