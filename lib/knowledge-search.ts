import type { Category, KnowledgeItem } from './types';

const synonyms = [
  ['缓考', '延期考试', '推迟考试'], ['请假', '休假', '病假'],
  ['在读证明', '学籍证明', '学生证明'], ['宿舍报修', '寝室维修', '宿舍维修'],
  ['校园卡', '一卡通', '饭卡'], ['奖学金', '奖助学金', '奖助'],
];

function terms(value: string): string[] {
  const cleaned = value.toLowerCase().replace(/[\s，。？！、：；,.?!:;（）()]/g, '');
  const result = new Set<string>();
  for (const group of synonyms) if (group.some(word => cleaned.includes(word))) group.forEach(word => result.add(word));
  for (const word of cleaned.match(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu) ?? []) {
    result.add(word);
    if (/^[\p{Script=Han}]+$/u.test(word)) for (let n = 2; n <= Math.min(3, word.length); n++)
      for (let i = 0; i <= word.length - n; i++) result.add(word.slice(i, i + n));
  }
  return [...result];
}

export function retrieveKnowledge(question: string, items: KnowledgeItem[], categories: Category[], now = new Date(), maxItems = 8, textBudget = 12000): KnowledgeItem[] {
  const query = terms(question);
  const categoryNames = new Map(categories.map(c => [c.id, `${c.name} ${c.description}`]));
  const replaced = new Set(items.filter(item => item.supersedes && (!item.status || item.status === 'confirmed' || item.status === 'inactive')
    && (!item.valid_from || Date.parse(item.valid_from) <= now.getTime()))
    .map(item => item.supersedes!));
  const ranked = items.filter(item => {
    const from = item.valid_from ? Date.parse(item.valid_from) : -Infinity;
    const until = item.valid_until ? Date.parse(item.valid_until) : Infinity;
    return (!item.status || item.status === 'confirmed') && !replaced.has(item.id) && from <= now.getTime() && now.getTime() < until;
  }).map(item => {
    const heading = `${item.question} ${(item.aliases ?? []).join(' ')}`.toLowerCase();
    const category = (categoryNames.get(item.category_id) ?? '').toLowerCase();
    const body = `${item.answer} ${item.source_excerpt ?? ''}`.toLowerCase();
    const score = query.reduce((sum, word) => sum + (heading.includes(word) ? 5 : 0) + (category.includes(word) ? 2 : 0) + (body.includes(word) ? 1 : 0), 0);
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
