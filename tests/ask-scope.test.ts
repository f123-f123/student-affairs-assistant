import { describe, expect, it } from 'vitest';
import { scopeClarification, scopeReply } from '../lib/ask-scope';
import type { KnowledgeItem } from '../lib/types';

const item: KnowledgeItem = { id: 'one', version: 2, question: '二奖申请', answer: '', category_id: 'awards', source_level: 2, source_name: '通知原名', source_url: 'https://example.org/notice', updated_at: '', categories: null, status: 'confirmed',
  scope: { units: ['云峰学园'], cohorts: ['2025级'], years: ['2025-2026学年'], projects: ['浙江大学二等奖学金'], conditions: [] } };
const topic = { question: '二奖怎么申请', scope_candidates: [{ id: item.id, version: 2 }] };
describe('范围澄清及确认', () => {
  it('提示实际找到的范围、缺少的字段和来源，不能声称符合资格', () => {
    const prompt = scopeClarification([item], topic.question);
    expect(prompt.notice).toContain('找到云峰学园、2025级、2025-2026学年、浙江大学二等奖学金通知');
    expect(prompt.notice).toContain('这不代表已认定你符合申请条件');
    expect(prompt.scope_candidates![0]).toMatchObject({ source_name: item.source_name, missing_fields: ['学院/学园', '年级', '年度/学年'] });
  });
  it('单一候选可确认并恢复原始问题；版本变化重新澄清，不用过期选择直接回答', () => {
    expect(scopeReply('是的', topic, [item])).toEqual({ query: '二奖怎么申请；咨询范围：云峰学园、2025级、2025-2026学年、浙江大学二等奖学金', accepted: true });
    expect(scopeReply('确认第1项', topic, [{ ...item, version: 3 }])).toEqual({ query: topic.question, accepted: false });
    expect(scopeReply('宿舍报修怎么办', topic, [item])).toBeNull();
  });
  it('多候选的“是的”不替用户选择，部分范围补充仍保留原问题', () => {
    expect(scopeReply('是的', { ...topic, scope_candidates: [...topic.scope_candidates, { id: 'two', version: 1 }] }, [item])?.accepted).toBe(false);
    expect(scopeReply('我是云峰学园2025级', topic, [item])?.query).toContain('二奖怎么申请；补充范围：我是云峰学园2025级');
    expect(scopeReply('我是医学院', { ...topic, question: '云峰学园二奖怎么申请' }, [item])?.query).not.toContain('云峰学园');
    expect(scopeReply('2025—2026学年', topic, [item])?.query).toContain('补充范围：2025—2026学年');
    expect(scopeReply('云峰学园2025级', topic, [item])?.query).toContain('补充范围：云峰学园2025级');
    expect(scopeClarification([item, { ...item, id: 'two', source_url: 'https://example.org/another-notice', source_name: '另一份通知' }], topic.question).scope_candidates).toHaveLength(2);
  });
});
