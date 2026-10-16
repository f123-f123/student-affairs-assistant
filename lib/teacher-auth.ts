import { createHmac, timingSafeEqual } from 'node:crypto';

export function passcodeMatches(input: string, expected: string): boolean {
  const left = createHmac('sha256', 'passcode-compare').update(input).digest();
  const right = createHmac('sha256', 'passcode-compare').update(expected).digest();
  return timingSafeEqual(left, right);
}
