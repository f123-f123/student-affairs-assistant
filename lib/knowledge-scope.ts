import type { KnowledgeItem } from './types';
import type { KnowledgeScope } from './knowledge-import';

export type ScopeField = 'units' | 'cohorts' | 'years' | 'projects';
export const scopeFieldNames: Record<ScopeField, string> = { units: '学院/学园', cohorts: '年级', years: '年度/学年', projects: '项目' };
const fields = Object.keys(scopeFieldNames) as ScopeField[];
const normalize = (text: string) => text.replace(/[—–至]/g, '-').replace(/\s/g, '').toLowerCase();

export function normalizeProjectText(text: string): string {
  return normalize(text).replace(/浙江大学/g, '').replace(/([一二三特])奖(?!学金)/g, '$1等奖学金');
}
export const namedProjects = (text: string): string[] => [...new Set(normalizeProjectText(text).match(/[一二三特]等奖学金|国家(?:励志)?奖学金|sqtp/g) || [])];

export function knowledgeScope(item: Pick<KnowledgeItem, 'scope'> & Partial<KnowledgeItem>): KnowledgeScope | null {
  if (item.scope) return item.scope;
  if (item.source_level !== 2) return null;
  const text = `${item.source_name || ''} ${item.question || ''} ${item.answer || ''}`;
  const units = [...text.matchAll(/(?:^|[\s。；])(?:关于|各位|面向|适用于)?([\p{Script=Han}]{1,16}(?:学院|学园))/gu)].map(m => m[1]).filter(v => !/^(?:本|外|其他|各|所在)学院$/.test(v));
  if (!units.length) return null;
  return { units: [...new Set(units)], cohorts: text.match(/20\d{2}级/g) || [], years: text.match(/20\d{2}[-—–至]20\d{2}学年|20\d{2}年度/g) || [],
    projects: [...new Set(text.match(/(?:浙江大学)?[一二三特]等奖学金|国家(?:励志)?奖学金|SQTP/gi) || [])], conditions: [] };
}

function mentionedScope(question: string, scope: KnowledgeScope): Record<ScopeField, string[]> {
  const q = normalizeProjectText(question);
  const units = [...question.matchAll(/[\p{Script=Han}]{1,24}(?:学院|学园)/gu)].map(m => m[0]
    .replace(/^(?:(?:请问|一下|我是|我在|我们|我想(?:了解|申请|咨询|问|知道)?|想问|咨询|关于|那么|那|来自|就读于|属于|的))+/g, '')).filter(unit => !/不是|不在|并非|不属于/.test(unit));
  return { units, cohorts: q.match(/20\d{2}级/g) || [], years: q.match(/20\d{2}-20\d{2}学年|20\d{2}年度/g) || [],
    projects: [...new Set([...namedProjects(q),
      ...scope.projects.map(normalizeProjectText).filter(p => q.includes(p)), ...(/另一个项目|其他项目/.test(q) ? ['其他项目'] : [])])] };
}

export function assessKnowledgeScope(question: string, item: Pick<KnowledgeItem, 'scope'> & Partial<KnowledgeItem>): { state: 'match' | 'missing' | 'conflict'; missing: ScopeField[] } {
  const scope = knowledgeScope(item);
  if (!scope) {
    const actual = namedProjects(question), expected = namedProjects(`${item.question || ''} ${item.answer || ''} ${(item.aliases || []).join(' ')}`);
    return { state: actual.length && expected.length && !actual.some(term => expected.includes(term)) ? 'conflict' : 'match', missing: [] };
  }
  const mentioned = mentionedScope(question, scope), missing: ScopeField[] = [];
  for (const field of fields) {
    const expected = scope[field].map(normalizeProjectText);
    if (!expected.length) continue;
    const actual = mentioned[field].map(normalizeProjectText);
    if (actual.some(term => !expected.includes(term))) return { state: 'conflict', missing: [] };
    if (!actual.length) missing.push(field);
  }
  if (scope.units.some(unit => new RegExp(`(?:不是|不在|并非|不属于)${unit}`).test(question))) return { state: 'conflict', missing: [] };
  return { state: missing.length ? 'missing' : 'match', missing };
}

export function describeScope(item: KnowledgeItem): string {
  const scope = knowledgeScope(item);
  return scope ? fields.flatMap(field => scope[field]).join('、') : item.source_name;
}
