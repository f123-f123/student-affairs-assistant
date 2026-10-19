import type { NoticeContactCandidate } from './types';

// 只匹配原文，不调用模型；姓名无法可靠定位时保留为空，交由老师核对。
export function noticeContactCandidates(source: string): NoticeContactCandidate[] {
  const matches = [...source.matchAll(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|(?<![\d@])(?:1[3-9]\d{9}|0\d{2,3}[-－]?\d{7,8})(?!\d)/g)];
  const candidates: NoticeContactCandidate[] = [];
  const starts: number[] = [];
  for (const match of matches) {
    const start = match.index!;
    if (!match[0].includes('@') && source.slice(Math.max(0, start - 30), start).match(/[\w.]+@[^\s，；]*$/)) continue;
    const before = source.slice(Math.max(0, start - 100), start);
    const names = [...before.matchAll(/(?:^|[：:，,；;。\s])([\p{Script=Han}]{1,6}(?:老师|同学))(?=[\s，,：:]|邮箱|电话|$)/gu)];
    const named = names.at(-1);
    const name = named?.[1] || '';
    const from = named ? Math.max(0, start - 100) + named.index! + named[0].indexOf(name) : Math.max(0, start - 20);
    const excerpt = source.slice(from, start + match[0].length);
    const candidate = { name, role: name.endsWith('老师') ? 'teacher' as const : name.endsWith('同学') ? 'student_leader' as const : null,
      email: match[0].includes('@') ? match[0] : null, phone: match[0].includes('@') ? null : match[0], source_excerpt: excerpt };
    const index = name ? starts.findIndex((position, index) => position === from && candidates[index].name === name) : -1;
    if (index >= 0 && !(candidate.email && candidates[index].email) && !(candidate.phone && candidates[index].phone)) {
      candidates[index] = { ...candidates[index], email: candidate.email || candidates[index].email, phone: candidate.phone || candidates[index].phone, source_excerpt: excerpt };
    } else if (!candidates.some(other => other.email === candidate.email && other.phone === candidate.phone && other.name === name)) { candidates.push(candidate); starts.push(from); }
  }
  return candidates;
}
