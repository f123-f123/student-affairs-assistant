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
const valid = { answerable: true, answer: '费用为20元。', citations: [itemId], category: categoryId };
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
  it('即使手机号出自知识，也只允许 contacts 提供', () => {
    expect(check({ ...valid, answer: '电话13800000001。' }).errorType).toBe('contact_from_model');
  });
  it('金额不在被引用条目中时降级', () => {
    expect(check({ ...valid, answer: '费用为30元。' }).errorType).toBe('unsupported_amount');
  });
  it('拒绝与引用不一致的截止日及签字要求', () => {
    const policy = [{ ...items[0], answer: '10月20日提交，无需导师签字。' }];
    const answer = { ...valid, answer: '11月30日提交，必须导师签字。' };
    expect(validateAnswer(JSON.stringify(answer), policy, categories).errorType).toBe('unsupported_date');
    expect(validateAnswer(JSON.stringify({ ...answer, answer: '10月20日提交，必须导师签字。' }), policy, categories).errorType).toBe('unsupported_procedure');
  });
  it('拒绝未见于引用的时刻、资格和材料', () => {
    const policy = [{ ...items[0], answer: '本院本科生于10月20日17时前提交学生证材料。' }];
    for (const answer of ['10月20日23时前提交学生证材料。', '外院研究生于10月20日17时前提交学生证材料。', '10月20日17时前提交成绩单材料。']) {
      expect(validateAnswer(JSON.stringify({ ...valid, answer }), policy, categories).answerable).toBe(false);
    }
  });
  it('不能把来源的年份换成另一个年份', () => {
    const policy = [{ ...items[0], answer: '2026年10月20日提交。' }];
    expect(validateAnswer(JSON.stringify({ ...valid, answer: '2027年10月20日提交。' }), policy, categories).errorType).toBe('unsupported_date');
  });
  it('无效类别回退综合事务', () => {
    expect(check({ ...valid, category: 'unknown' }).category).toBe(categoryId);
  });
});
