import { createHmac, timingSafeEqual } from 'node:crypto';

export type CurrentUser = {
  id: string;
  displayName: string;
  role: 'student' | 'teacher';
  authSource: 'mock' | 'passcode' | 'legacy_teacher' | 'campus';
  isMock: boolean;
};

export type PublicUser = Pick<CurrentUser, 'id' | 'displayName' | 'role'>;
export const publicUser = (user: CurrentUser | null): PublicUser | null => user && ({ id: user.id, displayName: user.displayName, role: user.role });

export const AUTH_COOKIE = 'student_affairs_session';
export const SESSION_SECONDS = 8 * 60 * 60;
type AuthConfig = { AUTH_MODE?: string; SESSION_SECRET?: string; TEACHER_PASSCODE?: string; NODE_ENV?: string; MOCK_AUTH_ALLOW_REMOTE?: string };

// 固定的评估身份无需初始化数据库；UUID 与旧匿名设备 ID 分离。
export const MOCK_USERS: Record<string, CurrentUser> = {
  'student-a': { id: 'a1000000-0000-4000-8000-000000000001', displayName: '学生A', role: 'student', authSource: 'mock', isMock: true },
  'student-b': { id: 'b1000000-0000-4000-8000-000000000002', displayName: '学生B', role: 'student', authSource: 'mock', isMock: true },
  teacher: { id: 'c1000000-0000-4000-8000-000000000003', displayName: '老师', role: 'teacher', authSource: 'mock', isMock: true },
};

export const PASSCODE_USERS: Record<string, CurrentUser> = Object.fromEntries(
  Object.entries(MOCK_USERS).map(([key, user]) => [key, { ...user, displayName: user.role === 'student' ? '学生' : '老师', authSource: 'passcode' }]),
) as Record<string, CurrentUser>;

export function passcodeEnabled(env: AuthConfig = process.env): boolean {
  return (!env.AUTH_MODE || env.AUTH_MODE === 'passcode') && !!env.TEACHER_PASSCODE &&
    !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;
}

const LEGACY_TEACHER: CurrentUser = {
  id: 'd1000000-0000-4000-8000-000000000004', displayName: '老师（兼容演示）',
  role: 'teacher', authSource: 'legacy_teacher', isMock: true,
};

export function mockEnabled(env: AuthConfig = process.env): boolean {
  return env.AUTH_MODE === 'mock' && !env.TEACHER_PASSCODE && !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32 &&
    (env.NODE_ENV !== 'production' || env.MOCK_AUTH_ALLOW_REMOTE === 'true');
}

export function mockEndpointEnabled(hostname: string, env: AuthConfig = process.env): boolean {
  return mockEnabled(env) && (env.MOCK_AUTH_ALLOW_REMOTE === 'true' ||
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1');
}

export function resolveIdentity(source: string, subject: string, env: AuthConfig = process.env): CurrentUser | null {
  if (source === 'passcode' && passcodeEnabled(env)) return Object.hasOwn(PASSCODE_USERS, subject) ? PASSCODE_USERS[subject] : null;
  if (source === 'mock' && mockEnabled(env)) return Object.hasOwn(MOCK_USERS, subject) ? MOCK_USERS[subject] : null;
  if (source === 'legacy_teacher' && env.AUTH_MODE === 'legacy_teacher' && subject === 'legacy-teacher' &&
      !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return LEGACY_TEACHER;
  return null;
}

export function signSession(source: CurrentUser['authSource'], subject: string, secret: string, now = Date.now()): string {
  const payload = `v1.${source}.${subject}.${now + SESSION_SECONDS * 1000}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySession(token: string | undefined, env: AuthConfig = process.env, now = Date.now()): CurrentUser | null {
  if (!token || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1' || !/^\d+$/.test(parts[3])) return null;
  const expiry = Number(parts[3]);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + SESSION_SECONDS * 1000) return null;
  const payload = parts.slice(0, 4).join('.');
  const expected = Buffer.from(createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url'));
  const actual = Buffer.from(parts[4]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return resolveIdentity(parts[1], parts[2], env);
}
