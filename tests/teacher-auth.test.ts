import { describe, expect, it } from 'vitest';
import { passcodeMatches } from '../lib/teacher-auth';
import { MOCK_USERS, mockEnabled, mockEndpointEnabled, passcodeEnabled, resolveIdentity, signSession, verifySession } from '../lib/auth-core';

describe('统一会话与模拟身份', () => {
  const secret = 'test-only-session-secret-at-least-32-chars';
  const now = Date.UTC(2026, 9, 13);
  const env = { AUTH_MODE: 'mock', SESSION_SECRET: secret, NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  it('只解析服务端预定义身份，不能自行声明老师角色', () => {
    expect(resolveIdentity('mock', 'student-a', env)).toEqual(MOCK_USERS['student-a']);
    expect(resolveIdentity('mock', 'attacker', env)).toBeNull();
    expect(resolveIdentity('mock', 'toString', env)).toBeNull();
    expect(resolveIdentity('mock', '__proto__', env)).toBeNull();
    expect(resolveIdentity('real', 'student-a', env)).toBeNull();
  });
  it('过期、篡改与关闭 mock 后令牌无效', () => {
    const token = signSession('mock', 'student-a', secret, now);
    expect(verifySession(token, env, now + 1000)?.id).toBe(MOCK_USERS['student-a'].id);
    expect(verifySession(token, env, now + 8 * 60 * 60 * 1000)).toBeNull();
    expect(verifySession(`${token}x`, env, now)).toBeNull();
    expect(verifySession(token, { ...env, AUTH_MODE: 'real' }, now)).toBeNull();
  });
  it('配置缺失及生产环境未额外许可时关闭 mock', () => {
    expect(mockEnabled({ SESSION_SECRET: secret })).toBe(false);
    expect(mockEnabled({ ...env, NODE_ENV: 'production' })).toBe(false);
    expect(mockEnabled({ ...env, NODE_ENV: 'production', MOCK_AUTH_ALLOW_REMOTE: 'true' })).toBe(true);
    expect(mockEndpointEnabled('school.example.edu', env)).toBe(false);
    expect(mockEndpointEnabled('localhost', env)).toBe(true);
  });
  it('管理口令配置签发独立会话，且关闭无口令的老师选择', () => {
    const passcodeEnv = { SESSION_SECRET: secret, TEACHER_PASSCODE: 'teacher-secret', NODE_ENV: 'test' };
    expect(passcodeEnabled(passcodeEnv)).toBe(true);
    expect(passcodeEnabled({ ...passcodeEnv, AUTH_MODE: 'real' })).toBe(false);
    expect(resolveIdentity('passcode', 'teacher', passcodeEnv)?.role).toBe('teacher');
    expect(resolveIdentity('passcode', 'student-a', passcodeEnv)?.role).toBe('student');
    expect(resolveIdentity('passcode', 'constructor', passcodeEnv)).toBeNull();
    expect(verifySession(signSession('passcode', 'teacher', secret, now), passcodeEnv, now)?.role).toBe('teacher');
    expect(mockEnabled({ ...passcodeEnv, AUTH_MODE: 'mock' })).toBe(false);
  });
  it('口令比较结果正确', () => {
    expect(passcodeMatches('secret', 'secret')).toBe(true);
    expect(passcodeMatches('other', 'secret')).toBe(false);
    expect(resolveIdentity('legacy_teacher', 'legacy-teacher', env)).toBeNull();
    expect(resolveIdentity('legacy_teacher', 'legacy-teacher', { ...env, AUTH_MODE: 'legacy_teacher' })?.role).toBe('teacher');
  });
});
