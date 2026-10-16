import type { StudentEvent } from './types';

export const scheduleFilters = [
  ['all', '全部'], ['active', '进行中'], ['soon', '7 天内截止'], ['overdue', '已过期'],
  ['no_deadline', '无截止时间'], ['done', '已完成'], ['archived', '已归档'],
] as const;
export type ScheduleFilter = typeof scheduleFilters[number][0];
type EventState = Exclude<ScheduleFilter, 'all'>;

export const eventStateLabels: Record<EventState, string> = {
  active: '进行中', soon: '7 天内截止', overdue: '已过期', no_deadline: '无截止时间', done: '已完成', archived: '已归档',
};

export function getEventState(item: Pick<StudentEvent, 'status' | 'deadline'>, now: number): EventState {
  if (item.status === 'done' || item.status === 'archived') return item.status;
  if (!item.deadline) return 'no_deadline';
  const deadline = Date.parse(item.deadline);
  if (deadline < now) return 'overdue';
  return deadline <= now + 7 * 86_400_000 ? 'soon' : 'active';
}

export function matchesScheduleFilter(item: Pick<StudentEvent, 'status' | 'deadline'>, filter: ScheduleFilter, now: number): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return item.status === 'active';
  return getEventState(item, now) === filter;
}
