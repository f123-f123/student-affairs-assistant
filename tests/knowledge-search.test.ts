import { describe, expect, it } from 'vitest';
import { retrieveKnowledge } from '../lib/knowledge-search';
import type { Category, KnowledgeItem } from '../lib/types';
import { assessKnowledgeScope } from '../lib/knowledge-scope';

const category = '10000000-0000-4000-8000-000000000008';
const categories: Category[] = [{ id: category, name: '综合事务', description: '考试安排', sort_order: 1 }];
const item = (status?: string): KnowledgeItem => ({ id: 'one', category_id: category, question: '缓考如何申请', answer: '提交缓考申请表',
  aliases: ['延期考试'], source_level: 1, source_name: '老师审核', source_url: null, updated_at: '2026-01-01', categories: { name: '综合事务' },
  ...(status === 'expired' ? { valid_until: '2026-01-01' } : {}) });

describe('知识检索', () => {
  const scoped = { ...item(), question: '云峰学园2025级2025-2026学年浙江大学二等奖学金如何申请', answer: '云峰学园2025级2025-2026学年浙江大学二等奖学金在演示平台申请。',
    aliases: ['二奖咋申请', '校设二奖提交办法'], scope: { units: ['云峰学园'], cohorts: ['2025级'], years: ['2025-2026学年'], projects: ['浙江大学二等奖学金'], conditions: [] } };
  it('先召回笼统问题与已配置别名，缺范围保留用于澄清，明确其他学院才冲突', () => {
    for (const question of ['二奖怎么申请', '二等奖学金如何申请', '校设二奖提交办法']) {
      expect(retrieveKnowledge(question, [scoped], categories)).toHaveLength(1);
      expect(assessKnowledgeScope(question, scoped)).toEqual({ state: 'missing', missing: ['units', 'cohorts', 'years'] });
    }
    expect(retrieveKnowledge('医学院二奖怎么申请', [scoped], categories)).toHaveLength(1);
    expect(assessKnowledgeScope('医学院二奖怎么申请', scoped).state).toBe('conflict');
  });
  it('完整范围下项目简称与规范名称等价，不将不同奖项或年度混用', () => {
    for (const name of ['二奖', '二等奖学金', '浙江大学二等奖学金']) expect(assessKnowledgeScope(`我是云峰学园2025级，2025—2026学年${name}怎么申请`, scoped).state).toBe('match');
    for (const question of ['云峰学园2025级2025-2026学年三奖怎么申请', '云峰学园2024级2025-2026学年二奖怎么申请', '云峰学园2025级2024-2025学年二奖怎么申请']) expect(assessKnowledgeScope(question, scoped).state).toBe('conflict');
  });
  it('同义问法召回跨类别候选', () => expect(retrieveKnowledge('推迟考试怎么办', [item()], categories)).toHaveLength(1));
  it('无依据时不提供候选', () => expect(retrieveKnowledge('卫星发射时间', [item()], categories)).toHaveLength(0));
  it('不因共用“如何申请”等泛词召回无关政策，精确配置的别名仍可召回', () => {
    expect(retrieveKnowledge('卫星发射如何申请', [item()], categories)).toHaveLength(0);
    expect(retrieveKnowledge('如何申请', [{ ...item(), aliases: ['如何申请'] }], categories)).toHaveLength(1);
  });
  it('过期条目不参与', () => expect(retrieveKnowledge('缓考如何申请', [item('expired')], categories, new Date('2026-02-01'))).toHaveLength(0));
  it('遵守条数与文本预算', () => expect(retrieveKnowledge('缓考', [item()], categories, new Date('2025-01-01'), 8, 3)).toHaveLength(0));
  it('未来生效的替换知识保留旧政策，生效后只选新政策', () => {
    const old = item();
    const next = { ...item(), id: 'two', supersedes: old.id, valid_from: '2026-11-01T00:00:00Z', answer: '新的申请办法' };
    expect(retrieveKnowledge('缓考申请', [old, next], categories, new Date('2026-10-20')).map(entry => entry.id)).toEqual(['one']);
    expect(retrieveKnowledge('缓考申请', [old, next], categories, new Date('2026-11-02')).map(entry => entry.id)).toEqual(['two']);
  });
  it('已停用的替换知识不会让旧政策重新参与回答', () => {
    const old = { ...item(), status: 'confirmed' as const };
    const withdrawn = { ...item(), id: 'two', status: 'inactive' as const, supersedes: old.id, valid_from: '2026-10-01T00:00:00Z' };
    expect(retrieveKnowledge('缓考申请', [old, withdrawn], categories, new Date('2026-10-20'))).toEqual([]);
  });
});
