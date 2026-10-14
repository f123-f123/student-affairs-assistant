import { describe, expect, it } from 'vitest';
import { validateAnswer } from '../lib/answer-validation';
import type { Category, KnowledgeItem } from '../lib/types';

const categoryId = '10000000-0000-4000-8000-000000000008';
const itemId = '30000000-0000-4000-8000-000000000001';
const categories: Category[] = [{ id: categoryId, name: '综合事务', description: '', sort_order: 1 }];
const items: KnowledgeItem[] = [{
  id: itemId, category_id: categoryId, question: '费用是多少？', answer: '费用为20元，电话13800000001。',
  source_level: 1, source_name: '老师确认', source_url: null, updated_at: '2026-01-01T00:00:00Z', categories: { name: '综合事务' },
}];
const valid = { answerable: true, answer: '费用为20元，电话13800000001。', citations: [itemId], category: categoryId };
const check = (value: unknown) => validateAnswer(JSON.stringify(value), items, categories);

describe('validateAnswer', () => {
  it('解析带 JSON 围栏的输出', () => {
    expect(validateAnswer(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, items, categories).answerable).toBe(true);
  });
  it('字段类型错误时降级', () => {
    expect(check({ ...valid, answerable: 'true' }).errorType).toBe('invalid_fields');
  });
  it('引用不存在时降级', () => {
    expect(check({ ...valid, citations: ['unknown'] }).errorType).toBe('unknown_citation');
  });
  it('可答但没有引用时降级', () => {
    expect(check({ ...valid, citations: [] }).errorType).toBe('missing_citations');
  });
  it('手机号不在被引用条目中时降级', () => {
    expect(check({ ...valid, answer: '电话13800000002。' }).errorType).toBe('unsupported_phone');
  });
  it('金额不在被引用条目中时降级', () => {
    expect(check({ ...valid, answer: '费用为30元。' }).errorType).toBe('unsupported_amount');
  });
  it('无效类别回退综合事务', () => {
    expect(check({ ...valid, category: 'unknown' }).category).toBe(categoryId);
  });
});
