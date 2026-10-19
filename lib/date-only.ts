export function parseDisplayDate(value: string): string | null {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yy, mm, dd] = match;
  const year = Number(yy), month = Number(mm), day = Number(dd);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? `${yy}-${mm}-${dd}` : null;
}
export function displayDate(value: string | null | undefined): string {
  return value && parseDisplayDate(value.replaceAll('-', '/')) ? value.replaceAll('-', '/') : '未知';
}
