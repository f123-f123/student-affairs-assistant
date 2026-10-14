import type { Category, KnowledgeItem } from './types';

export type ValidatedAnswer = {
  answerable: boolean;
  answer: string;
  citations: string[];
  category: string;
  errorType: string | null;
};

function numbers(text: string, pattern: RegExp): string[] {
  return Array.from(text.matchAll(pattern), match => match[0].replace(/[\s,，]/g, ''));
}

export function validateAnswer(raw: string, items: KnowledgeItem[], categories: Category[]): ValidatedAnswer {
  const fallback = categories.find(category => category.name === '综合事务')?.id ?? categories[0]?.id ?? '';
  const invalid = (errorType: string, category = fallback): ValidatedAnswer =>
    ({ answerable: false, answer: '', citations: [], category, errorType });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    return invalid('invalid_json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalid('invalid_fields');
  const value = parsed as Record<string, unknown>;
  const category = typeof value.category === 'string' && categories.some(c => c.id === value.category)
    ? value.category : fallback;
  if (typeof value.answerable !== 'boolean' || typeof value.answer !== 'string' ||
      !Array.isArray(value.citations) || !value.citations.every(id => typeof id === 'string') ||
      !(value.category === null || typeof value.category === 'string')) return invalid('invalid_fields', category);
  if (!value.answerable) return { answerable: false, answer: '', citations: [], category, errorType: null };
  const citations = value.citations as string[];
  if (!value.answer.trim()) return invalid('empty_answer', category);
  if (!citations.length) return invalid('missing_citations', category);
  const byId = new Map(items.map(item => [item.id, item]));
  if (citations.some(id => !byId.has(id))) return invalid('unknown_citation', category);
  const citedText = citations.map(id => {
    const item = byId.get(id)!;
    return `${item.question} ${item.answer}`;
  }).join(' ');
  // 手机号和金额逐个核对，仅允许从被引用的条目原文取值。
  const answerPhones = numbers(value.answer, /(?<!\d)1[3-9]\d{9}(?!\d)/g);
  const sourcePhones = new Set(numbers(citedText, /(?<!\d)1[3-9]\d{9}(?!\d)/g));
  if (answerPhones.some(phone => !sourcePhones.has(phone))) return invalid('unsupported_phone', category);
  const amountPattern = /(?:[¥￥]\s*\d[\d,，]*(?:\.\d+)?|\d[\d,，]*(?:\.\d+)?\s*(?:元|块|万元|人民币))/g;
  const answerAmounts = numbers(value.answer, amountPattern);
  const sourceAmounts = new Set(numbers(citedText, amountPattern));
  if (answerAmounts.some(amount => !sourceAmounts.has(amount))) return invalid('unsupported_amount', category);
  return { answerable: true, answer: value.answer.trim(), citations: [...new Set(citations)], category, errorType: null };
}
