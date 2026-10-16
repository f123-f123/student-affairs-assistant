import { NextResponse } from 'next/server';
import { sessionResponse, teacherLoginFailure } from '@/lib/login';
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
  const failure = await teacherLoginFailure(request, passcode);
  return failure || sessionResponse('legacy_teacher', 'legacy-teacher', { ok: true });
}
