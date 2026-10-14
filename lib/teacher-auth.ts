import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const TEACHER_COOKIE = 'teacher_session';
const DURATION_MS = 8 * 60 * 60 * 1000;

function signature(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function passcodeMatches(input: string, expected: string): boolean {
  const left = createHmac('sha256', 'passcode-compare').update(input).digest();
  const right = createHmac('sha256', 'passcode-compare').update(expected).digest();
  return timingSafeEqual(left, right);
}

export function signTeacherToken(secret: string, now = Date.now()): string {
  const payload = `v1.${now + DURATION_MS}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyTeacherToken(token: string | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d+$/.test(parts[1])) return false;
  const expiry = Number(parts[1]);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + DURATION_MS) return false;
  const expected = signature(`${parts[0]}.${parts[1]}`, secret);
  const actual = Buffer.from(parts[2]);
  const correct = Buffer.from(expected);
  return actual.length === correct.length && timingSafeEqual(actual, correct);
}

export async function isTeacher(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyTeacherToken(cookieStore.get(TEACHER_COOKIE)?.value, process.env.SESSION_SECRET);
}
