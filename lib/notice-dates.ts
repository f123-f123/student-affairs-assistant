import { isDateOnly } from './validation';
import type { PublicationDateCandidate } from './types';

export function signatureDates(source: string): PublicationDateCandidate[] {
  const tail = source.trimEnd().slice(-500);
  const result: PublicationDateCandidate[] = [];
  for (const match of tail.matchAll(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/g)) {
    const before = tail.slice(0, match.index);
    const prefix = before.slice(Math.max(before.lastIndexOf('。'), before.lastIndexOf('\n'), before.lastIndexOf('；')) + 1).trim();
    const after = tail.slice(match.index! + match[0].length).trim();
    // 只接受文末机构署名日期，不把正文中的实施年、截止日期或第一个日期当发布日期。
    if (!/(?:委员会|学园|学院|学校|办公室|中心|处|部|团委|学生会)$/.test(prefix) || prefix.length > 120 ||
        /截止|截至|申请时间|实施时间/.test(prefix) || after && !/^(?:附件|打印|关闭|返回|浏览|阅读|来源|审核)/.test(after) && !/^[^。；]{2,100}(?:学院|委员会|办公室|中心)\s*\d{4}年/.test(after)) continue;
    const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    if (isDateOnly(date)) result.push({ date, kind: 'signature', evidence: `${prefix}${before.endsWith(prefix) ? '' : before.slice(before.lastIndexOf(prefix) + prefix.length)}${match[0]}` });
  }
  return result;
}

export function publicationDates(source: string, page: PublicationDateCandidate[] = []): PublicationDateCandidate[] {
  return [...page.filter(candidate => candidate.kind === 'page' && isDateOnly(candidate.date)), ...signatureDates(source)]
    .filter((candidate, index, all) => all.findIndex(other => other.date === candidate.date && other.kind === candidate.kind && other.evidence === candidate.evidence) === index);
}

export function selectPublicationDate(candidates: PublicationDateCandidate[], userDate: string | null) {
  if (userDate && isDateOnly(userDate)) return { date: userDate, kind: 'user' as const, conflict: false };
  const dates = [...new Set(candidates.map(candidate => candidate.date))];
  return { date: dates.length === 1 ? dates[0] : null, kind: dates.length === 1 ? candidates[0].kind : 'unknown' as const, conflict: dates.length > 1 };
}

export function deadlineEvidenceCandidates(source: string): string[] {
  return source.split(/[。；\n]/).map(sentence => sentence.trim()).filter(sentence =>
    sentence.length <= 500 && /截止|截至|请.{0,30}于.{0,50}前/.test(sentence) && /\d{1,2}[月./-]\d{1,2}|本周|下周|下月/.test(sentence));
}
