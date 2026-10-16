import { NextResponse } from 'next/server';
import { MOCK_USERS, mockEndpointEnabled } from '@/lib/auth-core';
import { sessionResponse } from '@/lib/login';
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
  return sessionResponse('mock', identity, { user });
}
