import { NextResponse } from 'next/server';
import { isTeacher } from './teacher-auth';

export const noStore = { 'Cache-Control': 'no-store' };
export const unauthorized = () => NextResponse.json({ error: '请先登录' }, { status: 401, headers: noStore });
export const serviceUnavailable = () => NextResponse.json({ error: '服务暂时不可用' }, { status: 503, headers: noStore });
export const badRequest = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: noStore });
export async function teacherAuthorized() { return isTeacher(); }
