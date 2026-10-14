import { describe, expect, it } from 'vitest';
import { passcodeMatches, signTeacherToken, verifyTeacherToken } from '../lib/teacher-auth';

describe('teacher token', () => {
  const secret = 'test-secret';
  const now = Date.UTC(2026, 9, 13);
  it('签名可验证且不包含口令', () => {
    const token = signTeacherToken(secret, now);
    expect(verifyTeacherToken(token, secret, now + 1000)).toBe(true);
    expect(token).not.toContain('teacher-passcode');
  });
  it('过期和篡改的令牌无效', () => {
    const token = signTeacherToken(secret, now);
    expect(verifyTeacherToken(token, secret, now + 8 * 60 * 60 * 1000)).toBe(false);
    expect(verifyTeacherToken(`${token}x`, secret, now)).toBe(false);
    expect(verifyTeacherToken(token, 'wrong-secret', now)).toBe(false);
  });
  it('口令比较结果正确', () => {
    expect(passcodeMatches('secret', 'secret')).toBe(true);
    expect(passcodeMatches('other', 'secret')).toBe(false);
  });
});
