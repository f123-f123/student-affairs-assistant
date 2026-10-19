import { describe, expect, it } from 'vitest';
import { retrievalQuestion, topicFromHistory } from '../lib/followup-question';

describe('追问检索', () => {
  it('用同一对话的上一问题澄清指代', () => {
    expect(retrievalQuestion('那需要哪些材料？', '缓考怎么申请？')).toContain('缓考怎么申请？');
  });
  it('独立问题不混入旧话题', () => {
    expect(retrievalQuestion('宿舍如何报修？', '缓考怎么申请？')).toBe('宿舍如何报修？');
  });
  it('确认范围后同一项目的简称追问沿用范围，明确切换学院或奖项则更新主题', () => {
    const previous = '云峰学园2025级2025-2026学年浙江大学二等奖学金如何申请';
    expect(retrievalQuestion('二奖什么时候截止', previous)).toContain(previous);
    expect(retrievalQuestion('三奖怎么申请', previous)).toBe('三奖怎么申请');
    expect(retrievalQuestion('医学院二奖怎么申请', previous)).toBe('医学院二奖怎么申请');
  });
  it('省略主题的截止、能否申请与联系人追问沿用单一主题；出现其他学院时切换', () => {
    for (const question of ['什么时候截止', '还能申请吗', '找谁']) expect(retrievalQuestion(question, '云峰学园奖学金怎么申请')).toContain('云峰学园奖学金');
    expect(retrievalQuestion('那医学院的奖学金呢', '云峰学园奖学金怎么申请')).toBe('那医学院的奖学金呢');
  });
  it('旧会话按最近一条明确主题恢复，失败的新问题也会覆盖更早的主题', () => {
    expect(topicFromHistory([{ question: '什么时候截止' }, { question: '宿舍维修' }, { question: '奖学金', response_json: { topic_context: { question: '旧奖学金主题' } } }])).toBe('宿舍维修');
    expect(topicFromHistory([{ question: '什么时候截止', response_json: { topic_context: { question: '云峰学园奖学金' } } }, { question: '旧问题' }])).toBe('云峰学园奖学金');
  });
});
