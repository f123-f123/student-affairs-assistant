import { cookies } from 'next/headers';
import { AUTH_COOKIE, verifySession, type CurrentUser } from './auth-core';

// 真实认证接入时只替换此处的身份适配；业务层继续使用 CurrentUser。
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  return verifySession(store.get(AUTH_COOKIE)?.value);
}

export async function requireTeacher(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  return user?.role === 'teacher' ? user : null;
}
