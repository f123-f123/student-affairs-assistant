export type ResolvedDeadline = { deadline: string | null; inferred: boolean; evidence: string | null };

export function shanghaiToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shanghaiDateTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export function shanghaiInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function fromShanghaiInput(input: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input);
  if (!match) return null;
  const [, yy, mm, dd, hh, min] = match;
  const year = Number(yy), month = Number(mm), day = Number(dd), hour = Number(hh), minute = Number(min);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute)).toISOString();
}

function timeInSentence(sentence: string): [number, number] {
  const clock = /(?:上午|下午|晚上|中午)?\s*(\d{1,2})(?::|：)(\d{2})/.exec(sentence);
  const hourWord = /(上午|下午|晚上|中午)\s*(\d{1,2})\s*点(?:半)?/.exec(sentence);
  if (clock) {
    const prefix = sentence.slice(Math.max(0, clock.index - 4), clock.index);
    let hour = Number(clock[1]);
    if (/(下午|晚上|中午)/.test(prefix) && hour < 12) hour += 12;
    return [hour, Number(clock[2])];
  }
  if (hourWord) {
    let hour = Number(hourWord[2]);
    if (/(下午|晚上|中午)/.test(hourWord[1]) && hour < 12) hour += 12;
    return [hour, hourWord[0].includes('半') ? 30 : 0];
  }
  return [23, 59];
}

export function resolveDeadline(sourceText: string, evidence: string | null, publishDate: string): ResolvedDeadline {
  if (!evidence || !sourceText.includes(evidence)) return { deadline: null, inferred: false, evidence: null };
  // 截断的时分不能按“只有日期”处理，否则会生成错误的 23:59 截止时间。
  if (/\d{1,2}[:：]\d(?!\d)/.test(evidence)) return { deadline: null, inferred: false, evidence };
  const published = /^\d{4}-\d{2}-\d{2}$/.test(publishDate) ? new Date(`${publishDate}T00:00:00Z`) : null;
  if (!published || Number.isNaN(published.getTime())) return { deadline: null, inferred: false, evidence };
  let year: number, month: number, day: number;
  let inferred = false;
  const relativeWeek = /(本周|下周)([一二三四五六日天])/.exec(evidence);
  const nextMonth = /下月\s*(\d{1,2})\s*[日号]/.exec(evidence);
  const absolutePattern = /(?:(\d{4})[年./-])?\s*(\d{1,2})[月./-]\s*(\d{1,2})\s*[日号]?/g;
  const absoluteDates = [...evidence.matchAll(absolutePattern)];
  const absolute = absoluteDates.length === 1 ? absoluteDates[0] : null;
  if (relativeWeek) {
    const weekday = '一二三四五六日天'.indexOf(relativeWeek[2]) + 1;
    const current = published.getUTCDay() || 7;
    const offset = weekday - current + (relativeWeek[1] === '下周' ? 7 : 0);
    const date = new Date(published.getTime() + offset * 86_400_000);
    year = date.getUTCFullYear(); month = date.getUTCMonth() + 1; day = date.getUTCDate(); inferred = true;
  } else if (nextMonth) {
    const date = new Date(Date.UTC(published.getUTCFullYear(), published.getUTCMonth() + 1, 1));
    year = date.getUTCFullYear(); month = date.getUTCMonth() + 1; day = Number(nextMonth[1]); inferred = true;
  } else if (absolute) {
    year = absolute[1] ? Number(absolute[1]) : published.getUTCFullYear();
    month = Number(absolute[2]); day = Number(absolute[3]); inferred = !absolute[1];
  } else return { deadline: null, inferred: false, evidence };
  const [hour, minute] = timeInSentence(evidence);
  const deadline = fromShanghaiInput(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  return { deadline, inferred: !!deadline && inferred, evidence };
}
