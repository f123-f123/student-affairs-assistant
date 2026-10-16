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

function dates(text: string): string[] {
  return Array.from(text.matchAll(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g),
    match => `${match[1] ? `${match[1]}年` : ''}${Number(match[2])}月${Number(match[3])}日`);
}

function clockTimes(text: string): string[] {
  return Array.from(text.matchAll(/(上午|中午|下午|晚上)?\s*(\d{1,2})\s*(?::|：|点|时)\s*(\d{1,2})?\s*(?:分|半)?/g), match => {
    let hour = Number(match[2]);
    if (/(下午|晚上)/.test(match[1] ?? '') && hour < 12) hour += 12;
    const minute = match[0].includes('半') ? 30 : Number(match[3] ?? 0);
    return `${hour}:${minute}`;
  });
}

function policyPolarity(text: string, term: RegExp): Set<string> {
  const facts = new Set<string>();
  for (const clause of text.split(/[。；;，,\n]/)) {
    const hit = term.exec(clause);
    if (!hit) continue;
    const polarity = /无需|无须|不需要|不用|免于|不必|不得|禁止/.test(clause) ? 'no' : 'yes';
    facts.add(`${hit[0]}:${polarity}`);
  }
  return facts;
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
  // 联系方式只由服务端 contacts 表提供，模型正文不得输出。
  const answerPhones = numbers(value.answer, /(?<!\d)1[3-9]\d{9}(?!\d)/g);
  if (answerPhones.length || /(?<!\d)0\d{2,3}[-－]?\d{7,8}(?!\d)/.test(value.answer) ||
      /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value.answer)) return invalid('contact_from_model', category);
  const amountPattern = /(?:[¥￥]\s*\d[\d,，]*(?:\.\d+)?|\d[\d,，]*(?:\.\d+)?\s*(?:元|块|万元|人民币))/g;
  const answerAmounts = numbers(value.answer, amountPattern);
  const sourceAmounts = new Set(numbers(citedText, amountPattern));
  if (answerAmounts.some(amount => !sourceAmounts.has(amount))) return invalid('unsupported_amount', category);
  const sourceDates = new Set(dates(citedText).flatMap(date => [date, date.replace(/^\d{4}年/, '')]));
  if (dates(value.answer).some(date => !sourceDates.has(date))) return invalid('unsupported_date', category);
  const sourceTimes = new Set(clockTimes(citedText));
  if (clockTimes(value.answer).some(time => !sourceTimes.has(time))) return invalid('unsupported_time', category);
  for (const term of ['本院', '外院', '本科生', '研究生', '全日制', '非全日制']) {
    if (value.answer.includes(term) && !citedText.includes(term)) return invalid('unsupported_eligibility', category);
  }
  const materialPhrases = Array.from(value.answer.matchAll(/(?:提交|提供|准备|携带)([\p{Script=Han}]{2,12}材料)/gu), match => match[1]);
  if (materialPhrases.some(phrase => !citedText.includes(phrase))) return invalid('unsupported_material', category);
  for (const clause of value.answer.split(/[。；;，,\n]/)) {
    if (!/(材料|证明|资格|条件|提交|截止)/.test(clause)) continue;
    const clean = clause.replace(/\s/g, '');
    if (clean.length >= 4 && !Array.from({ length: clean.length - 3 }, (_, index) => clean.slice(index, index + 4))
      .some(fragment => citedText.includes(fragment))) return invalid('unsupported_policy_fact', category);
  }
  for (const term of [/导师.{0,3}(?:签字|签名)/, /(?:签字|签名|盖章|审批|审核)/]) {
    const supported = policyPolarity(citedText, term);
    if ([...policyPolarity(value.answer, term)].some(fact => !supported.has(fact)))
      return invalid('unsupported_procedure', category);
  }
  return { answerable: true, answer: value.answer.trim(), citations: [...new Set(citations)], category, errorType: null };
}
