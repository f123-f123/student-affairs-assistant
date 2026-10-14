export function ticketLimit(countLastMinute: number, countToday: number): 'minute' | 'day' | null {
  if (countLastMinute >= 3) return 'minute';
  if (countToday >= 20) return 'day';
  return null;
}

export function ticketWindow(now: Date) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { minuteStart: new Date(now.getTime() - 60_000).toISOString(), dayStart: dayStart.toISOString() };
}
