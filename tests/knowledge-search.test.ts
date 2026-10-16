import { describe, expect, it } from 'vitest';
import { retrieveKnowledge } from '../lib/knowledge-search';
import type { Category, KnowledgeItem } from '../lib/types';

const category = '10000000-0000-4000-8000-000000000008';
const categories: Category[] = [{ id: category, name: '综合事务', description: '考试安排', sort_order: 1 }];
const item = (status?: string): KnowledgeItem => ({ id: 'one', category_id: category, question: '缓考如何申请', answer: '提交缓考申请表',
  aliases: ['延期考试'], source_level: 1, source_name: '老师审核', source_url: null, updated_at: '2026-01-01', categories: { name: '综合事务' },
  ...(status === 'expired' ? { valid_until: '2026-01-01' } : {}) });

describe('知识检索', () => {
  it('同义问法召回跨类别候选', () => expect(retrieveKnowledge('推迟考试怎么办', [item()], categories)).toHaveLength(1));
  it('无依据时不提供候选', () => expect(retrieveKnowledge('卫星发射时间', [item()], categories)).toHaveLength(0));
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
