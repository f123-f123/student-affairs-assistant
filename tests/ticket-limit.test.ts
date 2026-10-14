import { describe, expect, it } from 'vitest';
import { ticketLimit, ticketWindow } from '../lib/ticket-limit';

describe('ticket limit', () => {
  it('每分钟最多3张', () => { expect(ticketLimit(2, 19)).toBeNull(); expect(ticketLimit(3, 3)).toBe('minute'); });
  it('每天最多20张', () => { expect(ticketLimit(0, 20)).toBe('day'); });
  it('按 UTC 当日及滚动一分钟计算', () => {
    expect(ticketWindow(new Date('2026-10-13T00:00:30Z'))).toEqual({ minuteStart: '2026-10-12T23:59:30.000Z', dayStart: '2026-10-13T00:00:00.000Z' });
  });
});
