import type { Category, KnowledgeItem } from './types';
import { namedProjects, normalizeProjectText } from './knowledge-scope';

const synonyms = [
  ['缓考', '延期考试', '推迟考试'], ['请假', '休假', '病假'],
  ['在读证明', '学籍证明', '学生证明'], ['宿舍报修', '寝室维修', '宿舍维修'],
  ['校园卡', '一卡通', '饭卡'], ['奖学金', '奖助学金', '奖助'],
];
const genericTerms = new Set(['请问', '如何', '怎么', '怎么办', '办理', '申请', '什么', '哪些', '需要', '提交', '材料', '条件', '流程', '如何申请', '怎么申请', '怎么办理', '申请流程', '办理流程']);

function terms(value: string): string[] {
  const cleaned = normalizeProjectText(value).replace(/[\s，。？！、：；,.?!:;（）()]/g, '');
  const result = new Set<string>();
  for (const group of synonyms) if (group.some(word => cleaned.includes(word))) group.forEach(word => result.add(word));
  const searchable = cleaned.replace(/如何申请|怎么申请|怎么办理|办理流程|申请流程|需要什么|需要哪些/g, ' ');
  for (const word of searchable.match(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu) ?? []) {
    result.add(word);
    if (/^[\p{Script=Han}]+$/u.test(word)) for (let n = 2; n <= Math.min(3, word.length); n++)
      for (let i = 0; i <= word.length - n; i++) result.add(word.slice(i, i + n));
  }
  return [...result].filter(term => !genericTerms.has(term));
}

export function retrieveKnowledge(question: string, items: KnowledgeItem[], categories: Category[], now = new Date(), maxItems = 8, textBudget = 12000): KnowledgeItem[] {
  const query = terms(question);
  const projects = namedProjects(question);
  const categoryNames = new Map(categories.map(c => [c.id, `${c.name} ${c.description}`]));
  const replaced = new Set(items.filter(item => item.supersedes && (!item.status || item.status === 'confirmed' || item.status === 'inactive')
    && (!item.valid_from || Date.parse(item.valid_from) <= now.getTime()))
    .map(item => item.supersedes!));
  const ranked = items.filter(item => {
    const from = item.valid_from ? Date.parse(item.valid_from) : -Infinity;
    const until = item.valid_until ? Date.parse(item.valid_until) : Infinity;
    return (!item.status || item.status === 'confirmed') && !replaced.has(item.id) && from <= now.getTime() && now.getTime() < until;
  }).map(item => {
    const heading = normalizeProjectText(`${item.question} ${(item.aliases ?? []).join(' ')}`);
    const category = normalizeProjectText(categoryNames.get(item.category_id) ?? '');
    const body = normalizeProjectText(`${item.answer} ${item.source_excerpt ?? ''}`);
    if (projects.length && !namedProjects(`${heading} ${body}`).length && !item.scope?.projects.length) return { item, score: 0 };
    const exact = [item.question, ...(item.aliases || [])].some(alias => normalizeProjectText(alias) === normalizeProjectText(question));
    const score = query.reduce((sum, word) => sum + (heading.includes(word) ? 5 : 0) + (category.includes(word) ? 2 : 0) + (body.includes(word) ? 1 : 0), exact ? 50 : 0);
    return { item, score };
  }).filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.source_level - b.item.source_level || Date.parse(b.item.updated_at) - Date.parse(a.item.updated_at));
  const result: KnowledgeItem[] = [];
  let used = 0;
  for (const { item } of ranked) {
    const size = item.question.length + item.answer.length + (item.source_excerpt?.length ?? 0);
    if (result.length >= maxItems) break;
    if (used + size > textBudget) continue;
    result.push(item); used += size;
  }
  return result;
}
