import { describe, expect, it } from 'vitest';
import { getEventState, matchesScheduleFilter, scheduleFilters } from '../lib/schedule';

const now = Date.parse('2026-10-16T08:00:00Z');
const active = { status: 'active' as const, deadline: null };

describe('日程筛选', () => {
  it('没有截止时间的新增事项可以在全部、进行中和无截止时间中找到', () => {
    expect(scheduleFilters.filter(([filter]) => matchesScheduleFilter(active, filter, now)).map(([filter]) => filter))
      .toEqual(['all', 'active', 'no_deadline']);
  });
  it('超过7天的事项仍属于进行中，近期和过期筛选不误收录', () => {
    const item = { ...active, deadline: '2026-11-01T00:00:00Z' };
    expect(scheduleFilters.filter(([filter]) => matchesScheduleFilter(item, filter, now)).map(([filter]) => filter)).toEqual(['all', 'active']);
    expect(getEventState(item, now)).toBe('active');
  });
  it('截止当天和第7天边界归入近期，超过截止时刻后才过期', () => {
    expect(getEventState({ ...active, deadline: new Date(now).toISOString() }, now)).toBe('soon');
    expect(getEventState({ ...active, deadline: new Date(now + 7 * 86_400_000).toISOString() }, now)).toBe('soon');
    expect(getEventState({ ...active, deadline: new Date(now + 7 * 86_400_000 + 1).toISOString() }, now)).toBe('active');
    expect(getEventState({ ...active, deadline: new Date(now - 1).toISOString() }, now)).toBe('overdue');
  });
  it.each(['done', 'archived'] as const)('%s 事项不混入进行中、日期或无截止时间筛选', status => {
    for (const deadline of [null, new Date(now - 1).toISOString(), new Date(now + 1).toISOString()]) {
      const item = { status, deadline };
      expect(scheduleFilters.filter(([filter]) => matchesScheduleFilter(item, filter, now)).map(([filter]) => filter)).toEqual(['all', status]);
    }
  });
});
