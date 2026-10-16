import { NextResponse } from 'next/server';
import { getCurrentUser, requireTeacher } from './auth';

export const noStore = { 'Cache-Control': 'no-store' };
export const unauthorized = async () => {
  const user = await getCurrentUser();
  return NextResponse.json({ error: user ? '没有权限' : '请先登录' }, { status: user ? 403 : 401, headers: noStore });
};
export const serviceUnavailable = () => NextResponse.json({ error: '服务暂时不可用' }, { status: 503, headers: noStore });
export const badRequest = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: noStore });
export async function teacherAuthorized() { return !!await requireTeacher(); }
