import { describe, expect, it } from 'vitest';
import { retrievalQuestion } from '../lib/followup-question';

describe('追问检索', () => {
  it('用同一对话的上一问题澄清指代', () => {
    expect(retrievalQuestion('那需要哪些材料？', '缓考怎么申请？')).toContain('缓考怎么申请？');
  });
  it('独立问题不混入旧话题', () => {
    expect(retrievalQuestion('宿舍如何报修？', '缓考怎么申请？')).toBe('宿舍如何报修？');
  });
});
